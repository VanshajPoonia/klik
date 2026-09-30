# Klik Roadmap

> **How to use this file.** Every task has a stable ID (for example `PAY-4`). To start work, say "do PAY-4" or "do PAY-1 through PAY-5". Tasks are ordered so that dependencies come first; each one lists what it blocks and what blocks it. Section A is the work you asked for. Section B is work I proposed myself, kept separate so you can approve or cut it before any of it is scheduled. Section C holds decisions I could not make for you.
>
> **Rules that apply to every task:** read `DESIGN.md` for structure and use the shipped tokens in `app/globals.css` for colour (near-black canvas, cream paper, volt yellow, never a hard-coded hex). No em dashes anywhere. Every organizer route checks capability, not just login. Every input is Zod validated.

---

## 0. Where the code actually is today

`ARCHITECTURE.md` is stale and will mislead any agent that reads it. The real state:

**Built and working**
- Next.js 16 App Router, Drizzle on Neon, Auth.js v5 with JWT sessions.
- Storage is **Cloudflare R2**, not Vercel Blob. `lib/storage.ts` uses the S3 SDK against an EU-jurisdiction endpoint. The bucket is private and media is delivered through `GET /api/e/[slug]/media/[mediaId]/content` with short-lived signed URLs.
- Three roles exist in `users.role`: `organizer` and `superadmin`, plus anonymous guests who never get a row in `users` (they get a row in `guests` plus an HMAC cookie).
- Event CRUD, slug generation, QR PNG/SVG, one printable sign in three fixed templates, access gate (public / password / private), guest entry sheet with consent, direct-to-R2 upload with server-side HEIC conversion and compression, moderation queue, streaming ZIP download with batching, expiry cron, lightbox with a working slideshow, in-app camera with six client-side looks.
- `albums` (flat, Premium only), `event_co_hosts` (add by username or email, capped at 5), `venue_clients`, venue hub at `/v/[venueSlug]`, superadmin console at `/admin` with quick-create and password reset.
- Plans exist as static definitions in `lib/plans.ts` with capability helpers, and are enforced on event creation and on feature gates.

**Not built at all**
- Stripe, or any payment. `users.plan_key` is set by hand by a superadmin.
- Any usage measurement. Nothing counts storage, media, or guests, so nothing can warn about limits.
- Self-serve signup. There is a `/login` page and no `/signup`. Usernames exist only on admin-provisioned credential accounts.
- Guest accounts, guest event history, guest to organizer upgrade.
- Per-photo visibility, per-photo share links, revocable access, nested folders.
- Any AI beyond client-side CSS filters.
- A canvas print editor. The "sign" is a hard-coded SVG string in the QR route.
- Rate limiting (`lib/ratelimit.ts` does not exist), any tests, any error tracking, any transactional email, any background job runner.

---

# SECTION A: the work you asked for

## Phase SEC: severity findings (2026-09-30 code audit)

Found while verifying claims made elsewhere in this document. **SEC-1 is the most dangerous thing in the codebase and it sits directly in the path of PAY-1.** These are ordered by severity, not by effort.

### SEC-1. The purge cron can permanently delete every gallery on the platform
**Size:** S to fix. **Severity: critical.** **Must be fixed before PAY-1 migrates `users.plan_key`.**

`app/api/cron/purge-expired/route.ts` decides what to permanently delete like this:

```ts
const plan = getPlan(planKey);                              // users.plan_key, read now
return getPlanDeadline(createdAt, plan.galleryAccessDays) <= now;
```

and `getPlan` falls back silently: `PLANS[planKey ?? "event"] ?? PLANS.event`, where the `event` plan has the **shortest** window at 180 days. Three consequences, each bad:

1. **The retention window is computed from a mutable field, at purge time.** Change an account from Premium (365 days) to Event (180 days) and every event of theirs older than 180 days becomes eligible for permanent deletion on the next nightly run. No warning, no grace, no soft delete. `deleteBlobs()` then `db.delete(media)` is irreversible.
2. **PAY-1 removes `users.plan_key`.** If that column is dropped or nulled during the migration, `getPlan(undefined)` returns the Event plan for **every account on the platform**, and the next cron run permanently deletes the media of every event created more than 180 days ago. This is a one-line migration away from being unrecoverable.
3. **It contradicts C-6, which you decided an hour ago.** You chose "never delete as a payment lever". A lapsed Venue subscription that downgrades `plan_key` does exactly that, automatically, at 3am.

**PARTIALLY FIXED 2026-09-30.** Two mitigations shipped, and they remove the catastrophic case:
- An unresolvable plan key now means "leave this event alone" instead of "apply the shortest window", so consequence 2 above can no longer happen. `getPlan()`'s fallback stays conservative everywhere else, where the worst case is a feature staying locked rather than data being destroyed.
- A circuit breaker aborts the run when more than 25 events are eligible **and** they make up over half of all un-purged events, which is the shape a retention misconfiguration takes rather than a genuine backlog. Normal runs also now cap at 25 events and report the deferred remainder.

**FIXED 2026-09-30** (migration `0003_soft_delete_and_retention.sql`). `events.retention_until` is now pinned at creation from the owner's plan at that moment, and the cron reads only that column. A null means "we do not know" and the event is skipped, never defaulted, because "we do not know" must not resolve to "delete it". Admin plan changes move retention outward via `GREATEST()` and can no longer shorten it. Existing rows were backfilled to the window that applied yesterday, so nothing became newly eligible because of the migration.

**Still outstanding:** warning emails at 30, 7, and 1 days before a purge (needs F-8).

### SEC-2. Abandoned uploads are permanent, untracked, unbilled storage
**Size:** M. **Severity: high.**
The honest upload path is genuinely well built: `POST /api/e/[slug]/media` does a `HeadObject`, rejects any mismatch between declared and actual size, rejects oversize, and deletes the object in both cases. Credit where it is due, that is better than most implementations.

The hole is the path where the client **never calls that endpoint at all**. `POST /api/upload` hands out a presigned PUT that binds the key and content type but **not `ContentLength`**, so the bytes can be any size, and nothing reaps an object that never got a `media` row. The purge cron iterates `media` rows, so an orphan is invisible to it forever.

Combined with the complete absence of rate limiting (SEC-3), a script with a public gallery link can request presigned URLs in a loop and PUT arbitrarily large objects into your bucket indefinitely. That is an unbounded R2 bill with no product signal that anything is wrong.

**PARTIALLY FIXED 2026-09-30.** `ContentLength` is now passed to the presigned `PutObjectCommand`, which puts `content-length` into `X-Amz-SignedHeaders` (verified against the SDK, not assumed), so R2 rejects any PUT whose body is not exactly the size already checked against the plan cap. The browser sets that header itself from the blob and scripts cannot override it, so no client change was needed and the honest path matches automatically. The existing `HeadObject` check stays as the belt to that braces.

**Rate limiting added 2026-09-30:** `/api/upload` now consumes a per-IP bucket (200/hour) before any database work and a per-guest bucket (60/hour) after the viewer resolves. Organizers are exempt from the guest bucket since they legitimately bulk-upload. The two buckets exist because a whole venue shares one NAT address.

**Still outstanding:** an object uploaded at the declared size and then abandoned is still an orphan nothing reaps. It is now bounded (plan cap per object, rate limit per hour) rather than unbounded, but it still needs the reaper job (F-5) listing `events/` and deleting anything with no matching `media` row older than an hour.

### SEC-3. No brute-force protection on a login that holds superadmin credentials
**Size:** M. **Severity: high.** This is F-2, escalated.
`lib/auth.ts` has a Credentials provider, the superadmin account authenticates through it with a username and password, and there was no rate limiting anywhere in the codebase. An unthrottled password endpoint guarding platform-wide admin is the highest-value target in the system.

**FIXED 2026-09-30.** `lib/ratelimit.ts` added: Postgres counters, incremented inside a single `INSERT ... ON CONFLICT` so two concurrent requests cannot both read a stale count and both pass, which is precisely the case a rate limiter exists to stop. Wired into the credential login at 10 per IP and 5 per username per 15 minutes, checked **before** the database lookup and the cost-12 bcrypt compare, since that hash is expensive enough to be a CPU exhaustion vector on its own. A throttled attempt is indistinguishable from a wrong password, so probing cannot enumerate usernames. Counters are swept by the purge cron.

**Still outstanding:** the remaining call sites from F-2 (guest session creation, gallery password attempts, username availability, OTP, share links). Those land with their own phases.

### SEC-4. Event deletion is instant, irreversible, and unlogged
**Size:** S. **Severity: medium-high.**
`DELETE /api/events/[id]` deleted every R2 object and cascaded the row immediately. `requireOwnerSession` passes for any superadmin, so an admin on the wrong row destroyed a customer's entire wedding gallery with no undo and no way to answer the support ticket that followed.

**FIXED 2026-09-30 (30-day soft delete, decided with C-8).** Both `DELETE /api/events/[id]` and `DELETE .../media/[mediaId]` now set `deleted_at` instead of destroying anything, and the purge cron removes rows and objects once the window closes. Every read path filters soft-deleted rows: `lib/media.ts` (the gallery chokepoint), all 20 event and media query sites across API routes and pages.

Two things this surfaced that were not obvious:
- **The plan-limit triggers had to be taught about it.** `enforce_event_plan_limits()` counts events created this month, so without `AND deleted_at IS NULL` a soft delete would silently consume the owner's monthly allowance and leave them unable to create a replacement. The `events_owner_featured_unique` partial index had the same problem. Both fixed in the migration, and the trigger now also fires on `deleted_at` so a freed slot is re-evaluated immediately.
- **The two "upload identifier already in use" checks deliberately still see deleted rows.** A soft-deleted row owns its R2 pathname for 30 days, so allowing an id to be reused would overwrite an object sitting in the trash. Both sites are commented so this is not later "fixed" into a bug.

**EXTENDED 2026-09-30** (migration `0006`) to every remaining delete path. `db.delete()` now appears nowhere outside the purge cron and the erasure module.
- **Albums** were the worst of the three. Media references an album with `ON DELETE SET NULL`, so deleting a folder silently unfiled every photo in it. Sorting 2,000 wedding photos into folders is real work, and one mis-tap discarded it with no undo. Media keeps its `album_id` while the folder sits in the trash, which is what lets a restore put the photos back exactly where they were.
- **Venue clients** had the same shape: `events.client_id` is `ON DELETE SET NULL`, so deleting a client detached every event they had ever had, along with their contact details.
- **Co-hosts stay a hard delete, deliberately.** Removing a co-host is access revocation, not data loss: nothing is destroyed and re-adding one is typing a username. Soft-deleting a membership would mean every permission check has to remember `isNull(deletedAt)`, and a single missed filter silently hands a removed co-host continued access to the gallery. That is a real security risk traded for no recovery benefit.

**Restore now exists.** `GET /api/events/[id]/trash` lists what is in the bin with previews and purge dates, `POST` to the same route restores media and albums, and `POST /api/events/[id]/restore` brings back a deleted event. Restoring an event leaves uploads disabled, since re-opening a gallery to guests should be a deliberate act rather than a side effect of undoing a delete. Trashed media previews for event managers only; guests get the same 404 they would for a row that was genuinely gone.

**Still outstanding:** UI for the trash screen, typed confirmation naming the event, and an audit entry (ADM-4). The API is there; nothing in the dashboard calls it yet.

### SEC-5. The purge cron will time out and leave galleries half-deleted
**Size:** S. **Severity: medium.**
**FIXED 2026-09-30.** Rows are now deleted before objects, in both the purge cron and `DELETE /api/events/[id]`, so a failure between the two statements leaves sweepable orphans in the bucket rather than a gallery of broken images still listed in the dashboard. The per-run cap from SEC-1 also bounds how much work a single invocation attempts.

**Still outstanding:** moving the loop onto the job runner (F-5) with per-event idempotency, so a large backlog drains reliably rather than depending on how many events fit inside 300 seconds.

### SEC-9. R2 does not enforce the signed content type
**Size:** S. **Severity: low.** Found 2026-09-30 while verifying SEC-2 against the real bucket, not from reading code.
The presigned upload binds `Content-Length` (SEC-2, verified: a 50x oversize body is rejected with a 403). It also *signs* `Content-Type`, and I assumed that bound it too. It does not. R2 accepted a `application/zip` body against a URL signed for `image/jpeg` and returned 200.

**Why this is low and not high.** The delivery route sets `ResponseContentType` from the `media` row, never from the stored object, and the row's mime was validated against the allowlist at registration. So the bytes come back declared as `image/jpeg` with an inline disposition: a browser tries to render an image and fails. There is no path to serving `text/html`, so this is not an XSS vector. Size caps, rate limits, and needing gallery access all still apply.

**What it does allow** is storing non-image bytes in the bucket, which amounts to using Klik as an obscure and rather bad file locker.

**FIXED 2026-09-30.** `lib/file-signature.ts` reads the actual leading bytes. Registration does one ranged 32-byte read and rejects anything whose real format does not match the declared family, deleting the object rather than leaving it (an object with no media row is invisible to the purge cron and would sit in the bucket forever).

Covers JPEG, PNG, WebP, HEIC and AVIF as images; MP4, QuickTime and WebM as video, matched on ISO `ftyp` **brand** rather than extension, which is what distinguishes an iPhone `.mov` from a HEIC still since both are ISO containers. An unrecognised ISO brand is accepted as video on purpose: phone vendors invent brands, and rejecting a guest's genuine recording is worse than storing a container we cannot name precisely. 15 cases tested, including ZIP, PDF, HTML, ELF, and a WAV file (which shares WebP's RIFF header and must not pass).

**On PDFs, which were asked about:** left out deliberately. Nothing renders them (`media.kind` is `photo | video`), so one would upload successfully and then appear as a broken tile. They also carry real surface that images do not, since PDF supports embedded JavaScript and the delivery route uses `Content-Disposition: inline`. If organizers need to attach documents, that wants its own upload path with an `attachment` disposition and its own UI, not a widened gallery allowlist.

### SEC-10. The guest event payload was a denylist, and it had already failed
**Size:** S. **Severity: low as found, high as a pattern. FIXED 2026-09-30.**
`toPublicEvent()` stripped known-private fields and spread everything else. That meant **every column added to `events` was published to guests by default**, and became private only if someone remembered to exclude it. It fails open, which is the wrong direction for a function whose entire job is deciding what strangers can see.

It had already failed. Verified by inspecting the real payload: `retentionUntil`, `deletedAt` and `purgedAt`, all added earlier the same day, were being handed to every guest. None are secrets, which is why this is low severity as an incident. The pattern is what matters, because the next column might be.

Now an explicit allowlist of 15 fields. Forgetting to add a field shows up as a missing value in the gallery, which is a bug you notice. Forgetting to remove one showed up as a silent disclosure, which is a bug you do not.

### SEC-7. Video playback broke one minute in
**Size:** S. **Severity: medium-high. FIXED 2026-09-30.**
`GET .../media/[mediaId]/content` redirects to a presigned R2 URL with a 60-second signature. For a photo that is one request and 60 seconds is plenty. Video does not work that way: the browser follows the redirect once, then issues **range requests against the resolved URL** for the rest of playback, for buffering and for every seek. One minute in, those range requests started returning 403 from R2.

The practical effect is that any clip longer than about a minute died mid-playback, and seeking back into a video someone had been watching failed outright. Exactly the 4K-phone-video case, on exactly the venue wifi where buffering takes longest. The signature window is now 6 hours for video and unchanged at 60 seconds for photos. The trade is that a resolved video URL is a bearer token for that object while it lives, which is still far tighter than a public bucket and well short of a gallery session.

### SEC-8. Guest personal data outlived the media it described
**Size:** S. **Severity: medium. FIXED 2026-09-30** (migration `0004_erasure_log.sql`).
A purge deletes an event's media but deliberately keeps the event row so the dashboard can explain what happened. It also kept every `guests` row: display names and consent timestamps, retained indefinitely, whose only purpose was attributing photos that no longer exist. The cron now deletes guest rows alongside the media, and the migration cleans up any that had already accumulated.

### SEC-6. `events.expires_at` and the purge path
**Size:** none. **CORRECTION 2026-09-30: this finding was overstated and there is nothing to fix.**
I reported that the field "silently does nothing". That was wrong. `lib/access.ts` does honour it: `isExpired()` reads `expires_at`, and both `canViewGallery()` and `canUpload()` gate on it, so an expired event already goes read-only and hidden exactly as intended.

What is true is narrower: the **purge cron** does not read it, and per C-8 it should not. Expiry ends the guest-facing life of a gallery; retention decides when the bytes go. Keeping those separate is correct, and conflating them would turn a date typed into a settings form into the moment someone's photos are destroyed. No change made.

---

## Phase F: Foundations

These are not glamorous but four of them are hard blockers. Do F-1 through F-5 before anything in Phase PAY, MED, or AI.

### F-1. Rewrite ARCHITECTURE.md to match reality
**Size:** S. **Blocks:** everything, because agents treat it as source of truth and it currently describes a storage layer the code abandoned.
Rewrite §1 (R2 not Blob), §3 (add albums, co-hosts, venue clients, plan fields, accent colours, access version), §4 (the real route tree), §6 (the real upload path including HEIC conversion and compression), §9 (mark what shipped), §10 (co-hosts shipped, so remove it from open questions). Add a "last verified against commit" line at the top so drift is visible next time.

### F-2. Rate limiting
**Size:** M. **Blocks:** PAY (webhook abuse), ACC (OTP abuse), ID (username enumeration), MED (share link password brute force).
Create table `rate_limits` (key text primary key, window_start timestamptz, count integer) and `lib/ratelimit.ts` exposing `consume(key, limit, windowSeconds)` as a single upsert with a conditional increment so it is atomic under concurrency. Key format `<scope>:<identifier>:<bucket>`. Wire to: upload token handshake (60 per guest per hour, 200 per IP per hour), guest session creation (10 per IP per hour), gallery password attempts (10 per IP per hour), credential login (10 per IP per 15 min, plus 5 per username per 15 min), username availability checks (30 per IP per minute), OTP requests (5 per email per hour), share link password attempts (10 per token per hour). Return `429` with `Retry-After`. Sweep expired rows in the existing purge cron.

### F-3. Permissions resolver
**Size:** M. **Blocks:** ORG, MED, ADM.
`lib/permissions.ts` replaces the three ad-hoc guards in `lib/roles.ts` with one resolver: `getEventCapabilities(eventId)` returns a typed set such as `{ viewDashboard, manageSettings, moderate, manageMedia, manageFolders, manageCoHosts, manageBilling, rotateQr, deleteEvent, exportAll }`. It resolves superadmin, owner, co-host role (ORG-2), and the owner's effective plan in one query. Every organizer route switches to it. Keep `lib/roles.ts` as thin wrappers during migration, then delete it.

### F-4. Usage accounting
**Size:** M. **Blocks:** PAY-7 (limit warnings), ADM-3.
Counting with `COUNT(*)` on every dashboard load will not survive a 3000-photo wedding. Add a rollup table `event_usage` (event_id primary key, photo_count, video_count, bytes_used bigint, guest_count, updated_at) incremented in the same request that inserts or deletes a media row, and an `account_usage` view or rollup keyed by user. Add `lib/usage.ts` with `getEventUsage(eventId)` and `getAccountUsage(userId)`, both returning percentages against the effective plan. Add a reconciliation job (F-5) that recomputes from `media` nightly so drift self-heals. Extend `PlanDefinition` with `maxMediaPerEvent`, `maxStorageBytesPerEvent`, `maxCoHosts`, `maxAlbums`, `aiCreditsPerEvent`.

**Quota shape (decided 2026-09-30): storage is the enforced cap, photo count is the headline.** Photos land around 1.5 MB after the existing compression pass, so count is cheap to give away and video is the actual cost driver. Show organizers and guests a photo count they can reason about; enforce the GB ceiling behind it.

| | Event ($39) | Premium ($89) | Venue ($69/mo) |
|---|---|---|---|
| Photos per event (headline) | 1,000 | 5,000 | 5,000 per event |
| Storage per event (enforced) | 25 GB | 100 GB | 100 GB per event |
| Max video size | 200 MB | 500 MB | 500 MB |
| Co-hosts | 1 | 10 | 10 |
| Folders | 1 | 50 | 50 |
| AI credits per event | 0 | 200 | 200 |

Treat these as the starting point, not gospel: instrument real usage from day one (ADM-3) and revisit after 20 real events. Two rules that must hold whatever the numbers become. First, **hitting the photo headline is a warning, hitting the storage ceiling is a block**, because a guest at a wedding must never be told "no" over a number the organizer could have raised. Second, a single 4K-video-heavy event can cost more in R2 than a $39 pass earns, so the video size cap plus the storage ceiling are what protect the margin, not the photo count.

### F-5. Background job runner
**Size:** M. **Blocks:** AI-2, AI-3, AI-7, MED-7, GRW-1, GRW-2, NEW-8, NEW-19.
AI embeddings, transcoding, large exports, and email all need work that outlives a request. Add table `jobs` (id, kind, payload jsonb, status, attempts, run_after, locked_at, locked_by, last_error, created_at) and `lib/jobs.ts` with `enqueue(kind, payload)` plus a claim query using `FOR UPDATE SKIP LOCKED`. A Vercel cron hits `/api/cron/jobs` every minute and drains up to N jobs within the function time budget, with exponential backoff and a dead-letter status. Do not reach for Redis or a queue service yet; Postgres handles this volume fine and keeps the stack at two services.

### F-6. Zod env validation and boot checks
**Size:** S.
`lib/env.ts` currently reads `process.env` ad hoc and `lib/storage.ts` uses non-null assertions on R2 credentials, which fails at request time instead of at deploy time. Add a Zod schema for every variable, parsed once at module load, with a clear error naming the missing key.

### F-7. Test harness
**Size:** M.
There is not a single test in the repo, and Phase PAY introduces money. Add Vitest for `lib/` (access rules, plan gating, usage maths, permissions matrix, cursor encoding, rate limiter concurrency) and Playwright for four flows: guest joins and uploads, organizer moderates and downloads, checkout completes and the plan applies, share link expires. Run both in CI.

### F-8. Transactional email
**Size:** S. **Depends on:** F-5.
Resend is already a dependency for magic links. Add `lib/email/` with typed templates: co-host invite, quota warning at 75 and 90 percent, payment receipt, payment failed, gallery expiring in 7 days, media purged, guest recap. Send through the job runner so a slow SMTP call never blocks a request.

### F-9. Error tracking and structured logging
**Size:** S.
Sentry for client and server, with the event ID and user ID as tags but never guest display names or emails in breadcrumbs.

---

## Phase ID: Global usernames

You need usernames before co-host invites and before guests can be referenced by anything other than an email address.

### ID-1. Username data model and validation
**Size:** M. **Blocks:** ID-2, ORG-3, ACC-4.
`users.username` exists but is only ever set by the admin quick-create form, and uniqueness is case-sensitive, so `Anita` and `anita` are both claimable. Fix properly:
- Add `users.username_lower` with a unique index, written on every save. Keep `username` for display casing.
- Add `users.username_changed_at`.
- Add table `username_reservations` (username_lower primary key, released_at, user_id nullable, reason) holding both the reserved-word list and handles parked after a change.
- Rules in `lib/username.ts`: 3 to 20 characters, `[a-z0-9_]`, must start with a letter, no consecutive or trailing underscore, not a reserved word. Reserved list seeded with every top-level route (`admin`, `api`, `e`, `v`, `s`, `u`, `dashboard`, `login`, `signup`, `settings`, `pricing`, `privacy`, `terms`, `support`, `help`, `about`, `new`, `me`, `klik`, `www`) plus common impersonation targets.
- Changing a username parks the old one for 30 days and is allowed once per 30 days.

### ID-2. Claim and availability flow
**Size:** M. **Depends on:** ID-1, F-2.
`GET /api/username/available?u=` (rate limited, returns `{ available, reason }` and never leaks whether a taken handle belongs to a real person beyond "taken"). An onboarding step at `/onboarding/username` that any signed-in account without a username is redirected into, with three suggested handles derived from their name. Settings page allows a change with the 30-day rule surfaced clearly.

### ID-3. Username search endpoint
**Size:** S. **Depends on:** ID-1. **Blocks:** ORG-3.
`GET /api/users/search?q=` returning at most 5 matches by prefix on `username_lower`, name only, never email. Used by the co-host picker. Rate limited and requires a session.

---

## Phase ACC: Guest accounts and the guest to organizer path

Today a guest is a cookie. You want an optional account that is trivial to create, remembers past events, and can become an organizer account without a second identity.

### ACC-1. One identity, three capacities
**Size:** S (design task, affects everything after).
Decide and document: there is one `users` table. `role` stays `organizer | superadmin`. "Guest" is not a role, it is a state (a `guests` row with `user_id` null). A signed-in person is a guest at events they joined and an organizer at events they own. This avoids a second account system and means the upgrade path is free.
- Add `guests.user_id` nullable FK to `users`, with an index.

### ACC-2. Passwordless sign-up
**Size:** M. **Depends on:** F-2, F-8.
Passwords are the wrong friction for someone standing at a wedding. Ship email OTP as the primary path:
- Customise the existing Auth.js Resend provider with `generateVerificationToken` producing a 6-digit numeric code and a `sendVerificationRequest` that sends the code rather than a link, so the person can type it into the tab they are already in. Keep the magic link as a fallback in the same email.
- Keep Google as a one-tap option.
- Keep the Credentials provider for admin-provisioned venue logins only, and hide it behind a "venue login" disclosure on `/login`.
- New `/signup` page. Copy: name optional, email, code. Nothing else. Username is claimed after (ID-2), not during.
- **Recommended addition:** passkeys via `@simplewebauthn` once OTP ships, since returning guests on the same phone then sign in with a thumb. Listed as NEW-1.

### ACC-3. Claiming anonymous history
**Size:** M. **Depends on:** ACC-1, ACC-2. This is the feature that makes accounts worth creating.
When someone signs in, the browser still holds every `klik_g_<eventId>` cookie from events they joined anonymously. `POST /api/me/claim-guests` reads all of them, verifies each HMAC, and sets `guests.user_id` on the matching rows. Run it automatically on the first authenticated page load after sign-in, and expose it as "Find my past events" in settings. Cookies are per-event and HMAC-signed, so this cannot be used to claim someone else's uploads.

### ACC-4. The `/me` surface
**Size:** M. **Depends on:** ACC-3.
One page, two lists: "Events you joined" (from `guests.user_id`, showing your own uploads per event and a link back to each gallery, including password-protected ones without re-entering the password since the account now proves access) and "Events you host". Plus a primary "Create an event" button that is the entire guest to organizer upgrade path. Since there is no free organizer tier (C-7), that button leads to plan selection and checkout, so the copy has to carry its weight: show what they get, not a price wall with no context. This is the single highest-friction moment in the product and deserves real design attention rather than a link. Also: "My uploads" across all events, and per-event "delete everything I uploaded" which is both decent and a GDPR requirement.

### ACC-5. Signed-in guest upload identity
**Size:** S. **Depends on:** ACC-1.
When a signed-in person uploads, attribute the media to their account as well as the guest row, so the gallery can show a real name and avatar and so contributions survive a cleared cookie. Uploading must still work with no account, unchanged. Guard the response shape so an account email never reaches a guest-facing payload.

### ACC-6. Passkeys for returning guests
**Size:** M. Depends on ACC-2. One thumb print to sign in on the phone they already used. `@simplewebauthn/server` plus a `user_credentials` table. Makes the "super simple account" promise real on the second visit.

---

## Phase ORG: Multiple organizers per event

`event_co_hosts` exists but is a flat membership list with a hard-coded cap of 5, no roles, and no way to invite someone who does not yet have an account.

### ORG-1. Roles on membership
**Size:** M. **Depends on:** F-3.
Add `event_co_hosts.role` with `manager | moderator | contributor`, default `manager`. The owner is not stored here, they are `events.owner_id`.
- `manager`: everything except billing, deleting the event, and transferring ownership.
- `moderator`: approve, reject, delete media, manage folders. No settings, no QR rotation, no co-host changes.
- `contributor`: upload on behalf of the event and see private media. Nothing else. This is the role for a hired photographer.
Encode the matrix once in `lib/permissions.ts` (F-3) and test it exhaustively (F-7).

### ORG-2. Move the co-host cap into plan config
**Size:** S. **Depends on:** F-4.
Replace the literal `>= 5` in the co-hosts route with `plan.maxCoHosts`. The current route also gates on the owner's plan being exactly `premium`, which will break the moment Venue accounts want co-hosts; gate on a capability, not a plan key.

### ORG-3. Invite by username, with a real invite flow
**Size:** M. **Depends on:** ID-3, F-8.
Table `event_invites` (id, event_id, invited_user_id nullable, invited_email nullable, role, token unique, invited_by, expires_at, accepted_at, revoked_at).
- Picker searches usernames (ID-3) and shows an avatar plus handle so you cannot mis-invite a stranger with a similar name.
- Inviting an email with no account sends an invite that survives sign-up: they accept, the account is created, the membership is applied.
- Invites expire in 14 days, are revocable, and are listed with status on the dashboard.
- Accepting requires being signed in as the invited identity, or, for email invites, proving the email.

### ORG-4. Ownership transfer and activity attribution
**Size:** M. **Depends on:** ORG-1.
Transfer flow (owner picks a manager, that person accepts, billing responsibility moves with it, both get an email). Plus an `event_activity` feed so co-hosts can see who approved, deleted, or shared what. This matters the moment more than one person can delete a guest's photo.

---

## Phase PAY: Stripe, plans, and limit warnings

### PAY-1. One entitlement model, two ways to grant it
**Size:** M. **Blocks:** all of PAY. Read this one carefully, it is the architectural decision in this phase.
**Decision (2026-09-30): Stripe and the admin panel are both first-class grant sources, and neither may overwrite the other.** The admin panel is how things are controlled today and it stays that way after Stripe ships, so the model cannot be "Stripe is truth and admin is a hack".

`users.plan_key` puts the plan on the **account**, but Klik Event ($39) and Klik Premium ($89) are **one-time per event**. As soon as someone buys a second pass, or buys Premium for a wedding and Event for a birthday, the account-level field is wrong. Replace it with an entitlement ledger:
- Table `entitlements` (id, user_id, event_id nullable, plan_key, source `stripe | admin | promo`, status `active | consumed | revoked | expired`, granted_by_user_id nullable, reason text, stripe_ref nullable, starts_at, ends_at nullable, created_at, revoked_at). An `event_id`-null active row is an unused pass the dashboard offers to apply to a new event.
- `lib/account-plans.ts` becomes `lib/entitlements.ts`. The effective plan for an event resolves in this precedence order, highest first:
  1. an active `admin` entitlement scoped to that event,
  2. an active `stripe` entitlement scoped to that event (a consumed pass),
  3. an active account-level `admin` grant,
  4. an active account-level `stripe` subscription (Venue),
  5. nothing. **There is no free organizer tier** (C-7, answered). An account with no active entitlement has no live event.
- **Admin grants outrank Stripe and webhooks must never touch them.** A superadmin comping a venue, fixing a failed charge, or running a pilot must not be silently downgraded when a subscription lapses. PAY-4's handlers filter on `source = 'stripe'` in every write. Test this explicitly (F-7); it is the single easiest way to lose a customer's access at the worst moment.
- Every admin grant requires a `reason` and writes to the audit log (ADM-4). Ungoverned comps are how revenue quietly disappears.
- Guests never hold entitlements. Guest access is free at every tier, always, because the organizer is the payer (C-1, answered).
- **A pass is bought before the event exists, not after.** Checkout produces an `event_id`-null active entitlement; creating an event consumes it and stamps `event_id`. This avoids needing a half-built draft event just to have something for Stripe to attach to, and it means an organizer can buy three passes up front. An admin grant is the same row with `source = 'admin'`, so the comp path and the paid path converge immediately and only one of them needs testing in depth.
- Event creation with no unconsumed entitlement returns a 402 carrying the checkout action, not a 403. The dashboard turns that into "Choose a plan", never a dead end.
- Keep `events.plan_key` as a denormalised cache of the resolved plan, refreshed whenever entitlements change, so the hot path is one column read rather than a ledger walk. Recompute it in the nightly reconciliation job (F-4).
- Every `canX(plan.key)` call site moves to the event-scoped resolver.

### PAY-1b. Admin plan control surface
**Size:** M. **Depends on:** PAY-1. Pull this forward if you want admin control working before Stripe.
The admin panel already sets `users.plan_key` through `POST /api/admin/clients/[userId]/plan`. Rework it against the ledger: grant a plan to an account or to one specific event, with a reason, an optional end date, and an explicit revoke. Show the grant source on every event in the admin list so it is obvious at a glance whether an account is paying or comped. This task is independent of Stripe and can ship first.

### PAY-2. Stripe data model
**Size:** M. **Depends on:** PAY-1.
- `stripe_customers` (user_id primary key, stripe_customer_id unique).
- `subscriptions` (id, user_id, stripe_subscription_id unique, plan_key, status, current_period_end, cancel_at_period_end, created_at, updated_at).
- `purchases` (id, user_id, event_id nullable, stripe_checkout_session_id unique, stripe_payment_intent_id, plan_key, amount_cents, currency, status, consumed_at, refunded_at). A purchase with `consumed_at` null is an unused event pass the dashboard offers to apply to a new event.
- `stripe_webhook_events` (stripe_event_id primary key, type, received_at, processed_at, error). This is the idempotency ledger; without it a retried webhook double-grants a plan.

### PAY-3. Checkout
**Size:** M. **Depends on:** PAY-2.
`POST /api/billing/checkout` taking `{ planKey, eventId? }`, creating or reusing a Stripe customer, and returning a Checkout Session URL. Price IDs come from env (`STRIPE_PRICE_EVENT`, `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_VENUE_MONTHLY`, `STRIPE_PRICE_VENUE_ANNUAL`), never from the client. Mode is `payment` for Event and Premium, `subscription` for Venue. Pass `client_reference_id` as the user ID and the intended `eventId` in metadata. Success returns to the event dashboard with a pending state; the grant happens in the webhook, not on the success page, because the success page is not a trustworthy signal.

### PAY-4. Webhook
**Size:** M. **Depends on:** PAY-2. Highest-risk task in the phase.
`POST /api/webhooks/stripe` with `export const runtime = "nodejs"`, reading the **raw** body for signature verification (Next's App Router gives this via `await request.text()`; do not parse first). Insert into `stripe_webhook_events` before processing and skip if already present. Handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Every handler must be idempotent and must never trust amounts from the client. On refund, revoke the grant and mark the event downgraded rather than deleting media.

### PAY-5. Billing surface for organizers
**Size:** M. **Depends on:** PAY-3, PAY-4.
`/dashboard/billing`: current plan per event, unused passes, subscription status and renewal date, invoice history, "Manage billing" opening the Stripe Customer Portal (`POST /api/billing/portal`), and an upgrade path from any event that hits a gated feature. Upgrade prompts should appear at the point of friction (the locked folder button), not only on a pricing page.

### PAY-6. Plan enforcement at the edges
**Size:** M. **Depends on:** PAY-1, F-4.
Every limit currently enforced only at event creation needs enforcing where it actually bites: the upload token handshake checks media count, storage bytes, and upload window; the co-host route checks `maxCoHosts`; the folder route checks `maxAlbums`; AI routes check credits. Each refusal returns a message that names the plan and the upgrade action, because a bare 403 at a wedding is a support ticket.

### PAY-7. Approaching-limit warnings
**Size:** M. **Depends on:** F-4, PAY-6. This is the warning behaviour you asked for.
- A `<UsageMeter>` component on the organizer event dashboard showing storage, photo count, and days left in the upload window, using the volt token with a warning treatment at 75 percent and a stronger one at 90 percent. Never a red alert bar at 60 percent; false urgency trains people to ignore it.
- A dismissible banner at 75 percent, a persistent one at 90, and a blocking state at 100 with a one-click upgrade.
- Email at 75 and 90 percent (F-8), once each per event, not per upload.
- Guest-facing copy at 100 percent: "This gallery is full. Ask the host to add space." Never expose the plan name to guests.
- Admin dashboard gets the same data across all accounts (ADM-3).

### PAY-8. Proration, dunning, and grace
**Size:** M. **Depends on:** PAY-4.
Venue subscription past due: 7-day grace with galleries still readable, then read-only, then the normal purge window. Never delete media because a card expired. Dunning emails at day 1, 3, and 6.

---

## Phase MED: Per-photo control, share links, folders

### MED-1. Per-media visibility
**Size:** M. **Depends on:** F-3. This is your "make certain pictures private and public".
Add `media.visibility` with `gallery | private | link`:
- `gallery` (default): everyone with gallery access sees it.
- `private`: only event managers, plus the guest who uploaded it if `events.uploader_sees_own_private` is on.
- `link`: hidden from the grid, reachable only through an active share link (MED-2).
Enforce in exactly one place, the media query builder in `lib/media.ts`, and in the content route. Add a single-item toggle in the lightbox and dashboard grid, and a bulk action (MED-5). Note this is orthogonal to `status`; a photo can be approved and private.

### MED-2. Share links
**Size:** L. **Depends on:** MED-1, F-2. This is "each picture should get its own sharable link".
Table `media_shares` (id, token unique, event_id, media_id nullable, album_id nullable, scope `media | album | event`, created_by_user_id nullable, created_by_guest_id nullable, allow_download, password_hash nullable, expires_at nullable, max_views nullable, view_count, revoked_at, created_at).
- Public route `/s/[token]`: server-rendered, checks revoked, expiry, view cap, password. Serves media through a fresh short-lived signed R2 URL, never the bucket URL. Shows a minimal Klik-branded frame with an optional "See the full gallery" call to action if the event is public.
- The token must not leak the event slug or media ID, so use a 22-character nanoid and look up by token only.
- OG tags so the link previews properly in WhatsApp and iMessage, which is how these links will actually travel. Generate an OG image per share.
- `view_count` increments on page view, not on asset fetch, so a re-render does not burn the cap.

### MED-3. Access management UI
**Size:** M. **Depends on:** MED-2. This is "ability to modify access".
A share sheet per photo listing every active link with its settings, a revoke button, expiry editing, and a copy button. An event-level "Links" tab listing every share link across the event, since an organizer will lose track. Revoking is instant and the `/s/[token]` page must check `revoked_at` on every request, not from a cache.

### MED-4. Folders
**Size:** L. **Depends on:** F-3. This is "make folders".
Evolve `albums` rather than adding a parallel concept. Rename the user-facing label to "Folders", keep the table name.
- Add `albums.parent_id` self-referencing FK, `albums.position` integer, `albums.cover_media_id`, `albums.kind` (`manual | smart`), `albums.query` jsonb for smart folders (AI-4).
- Cap nesting at 3 levels and enforce it server-side with a recursive CTE check so a cycle is impossible.
- Media stays in one folder (`media.album_id`). Many-to-many is tempting and almost always the wrong call for a photo app; if a photo needs to be in two places, that is what smart folders are for.
- UI: breadcrumb navigation, drag to move, multi-select move, folder covers, counts per folder, and an "Unfiled" pseudo-folder.
- Guest gallery gets folder tabs when the event has more than one folder, which is how folders earn their keep.

### MED-5. Bulk operations
**Size:** M. **Depends on:** MED-1, MED-4.
Selection mode already partially exists in the dashboard grid. Extend to: set visibility, move to folder, approve or reject, delete, create one share link for the selection (as an ad-hoc album), download selection as ZIP. Operate in batches server-side with a progress response, and make delete undoable for 30 seconds before the R2 objects are actually removed.

### MED-6. Uploader self-service
**Size:** S. **Depends on:** ACC-5.
A guest can delete or hide their own upload from the guest gallery. Non-negotiable for consent, currently impossible.

### MED-7. Export improvements
**Size:** M. **Depends on:** F-5.
The current ZIP route streams inline and 413s above 2 GB. Move large exports to a job that writes a ZIP to R2 and emails a signed link that expires in 48 hours. Keep the inline path for small events. Add "export by folder" and "export originals versus web-size".

### MED-8. Strip EXIF and GPS from stored media
**Size:** S. **Promoted from NEW-10 on 2026-09-30.** Do this early; it is a live leak, not a feature.
Phone photos carry GPS coordinates, device serial hints, and capture software in EXIF, and right now all of it survives into R2 and straight out again through the ZIP export. A guest uploading a photo from inside someone's home is publishing that address to everyone the organizer shares the gallery with.
- Strip on the existing server-side compression pass. `sharp` already re-encodes every photo there, so this costs almost nothing: drop the metadata by default rather than copying it through.
- **Keep two fields**: orientation (or the image renders sideways) and `DateTimeOriginal`, which AI-1 needs for time clustering. Copy those two onto the `media` row so the pixel data can be stripped clean while the roadmap's grouping features still work.
- Backfill existing media through a job (F-5), since everything uploaded to date still carries full EXIF.
- Add an organizer setting "keep full photo metadata", default off, for the professional-photographer case where EXIF is part of the deliverable.
- Videos carry location too and `sharp` does not touch them. Either strip with ffmpeg in the transcode pass (NEW-8) or document plainly that video metadata is preserved.

### MED-9. Reactions and comments
**Size:** M. **Depends on:** ACC-5. **Decided 2026-09-30 (C-5).**
- **Reactions are open to anonymous guests.** The existing per-event guest cookie attributes them well enough, and a heart is close to unabusable. One reaction per guest per item, toggleable.
- **Comments require a signed-in account** (ACC-2), because free-text from anonymous strangers is a moderation queue you will have to staff.
- Both **off by default per event**; the organizer opts in. Both feed the report flow (NEW-9) and the admin queue (ADM-5).
- Tables `media_reactions` (media_id, guest_id, kind, created_at, primary key on the first three) and `media_comments` (id, media_id, user_id, body, created_at, hidden_at, hidden_by).
- Rate limit both (F-2). Reaction counts render from a denormalised counter on `media`, not a live `COUNT(*)`, for the same reason as F-4.

### MED-10. Watermarking for professionals
**Size:** M. A photographer co-host (the `contributor` role from ORG-1) uploads proofs with a watermark, and clients buy the clean versions. Pairs with NEW-15.

---

## Phase AI: Automatic grouping and enhancement

Build this in three layers, cheapest first. Layer 1 alone covers most of the real value and costs nothing.

### AI-1. Moments: time and burst clustering
**Size:** M. **Depends on:** MED-4. No ML, no cost, ship it first.
Cluster an event's media by capture-time gaps (a new moment when the gap exceeds the adaptive threshold derived from the event's own upload density, floor 20 minutes). Surface as auto-generated smart folders: "Getting ready", "Ceremony", "First dance" are just named moments the organizer renames. Also collapse bursts (more than 4 photos inside 10 seconds from the same guest) into a stack in the grid, showing one with a count, which single-handedly makes a 3000-photo gallery browsable.
Use EXIF `DateTimeOriginal` when present, falling back to `created_at`, since upload time and capture time diverge badly when someone uploads a day later.

### AI-2. Visual embeddings and similarity grouping
**Size:** L. **Depends on:** F-5, AI-1.
- Enable `pgvector` on Neon. Table `media_embeddings` (media_id primary key, model, embedding vector(768), created_at). Add `media.ai_status` (`pending | done | failed | skipped`).
- A job (F-5) generates a CLIP-style embedding per photo. Provider behind `lib/ai/vision.ts` so it can swap per operation. **Provider split (decided 2026-09-30, C-4):** Cloudflare Workers AI for the high-volume per-photo path (embeddings, scene labels, NSFW screening) where egress and cost dominate and the bytes never leave the network the R2 bucket already lives in; Replicate for low-volume user-initiated work (AI-5 restoration and upscaling) where model quality outweighs cost. Only the Workers AI path touches every photo, so only it needs to be cheap.
- Group by agglomerative clustering on cosine distance with a tuned threshold, run per event as a job after upload settles.
- The same embeddings give you natural-language search for free: embed the query text, nearest-neighbour search with an HNSW index. "photos of the cake" is a genuinely delightful feature and it is the same column.
- Auto-label scenes (cake, speech, dance, group, portrait, decor, venue) with a small zero-shot classification pass against a fixed label set, and drive smart folders from labels.

### AI-3. Face grouping: consent and compliance
**Size:** L. **Depends on:** AI-2, NEW-19. **Decision (2026-09-30): approved, with a real consent flow. Build AI-3a before AI-3b. Do not ship AI-3b without a lawyer signing off on AI-3a.**

**The thing to understand before anything else:** the person who uploads a photo is not the data subject for the other faces in it. Guest consent at the entry sheet covers *their own* uploads and *their own* face. It does not and cannot cover the twelve other people in the frame, half of whom never scanned the QR code and have no relationship with Klik at all. Every product that gets sued over this got it wrong in exactly that spot. So the design is not "collect consent once at the door", it is "detect narrowly, retain briefly, and give any person in a photo a real way to say no".

**Updated 2026-09-30 for a US-only market.** GDPR Article 9 was the original frame; for a US product the dominant risk is **Illinois BIPA**, which carries **statutory damages of $1,000 per negligent violation and $5,000 per reckless one, per person, with a private right of action**. That is worse than the GDPR framing, not better: it is why BIPA generates class actions, and why standard general liability policies usually exclude them. **Texas CUBI** and **Washington HB 1493** are similar but state-enforced. **COPPA** applies to under-13s and reinforces the decision to exclude minors. **CCPA/CPRA** only bites above revenue and volume thresholds you are far below. This remains the only feature in this document that can produce a liability larger than the company.

#### AI-3a. The consent and governance layer (build first, ship alone)
- **Off by default, everywhere.** A per-event organizer opt-in with plain-language copy explaining what is processed, that it stays inside this one event, and how long it is kept. The organizer affirms they have authority to enable it for their event.
- **Layered guest consent, unbundled.** The entry sheet gets a separate, unticked, optional checkbox for face grouping, distinct from the existing upload consent. Declining must not block joining, viewing, or uploading, or the consent is not freely given under GDPR and is worthless.
- **A published retention schedule.** BIPA requires a publicly available written policy with a retention schedule and a destruction guideline, and requires you to actually follow it. Concretely: face embeddings are destroyed when the event's gallery access window ends, when the event is deleted, or within 30 days of a removal request, whichever comes first. Publish this at `/privacy/biometrics` and enforce it in the purge cron, not just in prose.
- **Removal for non-users.** A route anyone can use, no account required, to have their face cluster deleted from an event: reachable from the gallery footer and from `/privacy/biometrics`. This is the mechanism that covers the people who never consented because they never used the app.
- **Right to erasure reaching embeddings.** NEW-19's delete path must cascade into `face_detections` and `person_clusters`, not just `media`. Deleting the photo but keeping the embedding is the exact failure regulators look for.
- **No cross-event identity graph. This is the bright line.** Clusters are scoped to one event and never joined across events, never used to build a persistent person record, never used for advertising, never sold or licensed. BIPA separately prohibits profiting from biometric data. Keeping this line is what makes the feature defensible; crossing it converts Klik from a photo app into a face-recognition company with everything that implies.
- **No minors. DECIDED (2026-09-30): exclude them from detection.** Events have children at them and there is no workable consent path for a child's biometrics from a wedding guest list. Run age estimation ahead of embedding and drop any face below the threshold, discarding the crop and writing no row. Set the threshold conservatively, because a false positive costs you one ungrouped photo and a false negative costs you a COPPA or BIPA exposure. The estimator is imperfect, so document it as a good-faith measure rather than a guarantee, and let counsel loosen it later. Starting strict and relaxing is recoverable; the reverse is not.
- **A DPIA.** GDPR Article 35 effectively mandates a Data Protection Impact Assessment for large-scale special-category processing. Write it before launch, not after an inquiry.
- **Provider contracts.** A signed DPA with whoever runs the model and written confirmation they do not train on the data. With a US-only market and the bucket moving to a US jurisdiction (OPS-4), cross-border transfer mechanisms stop being the concern; provider retention and training terms become it.
- **Jurisdiction gating.** Hard-disable in Illinois, Texas, and Washington unless counsel clears it, since those are where the private right of action and the statutory damages live. In a US-only product this is not an edge case to handle later, it is the main control.
- **Audit logging.** Every enable, disable, detection run, and deletion lands in `audit_log` (ADM-4). When someone asks what you did with their face, "we do not know" is not an answer.
- **Insurance.** Check whether your policy excludes biometric claims before launch. Most do.

#### AI-3b. The technical layer (only after AI-3a is signed off)
- Tables `face_detections` (id, media_id, event_id, bbox, quality, embedding vector(512), created_at) and `person_clusters` (id, event_id, label nullable, cover_face_id, created_at), plus `face_detections.cluster_id`. Both carry `event_id` directly so the scoping rule above is enforced by the schema rather than by discipline.
- Detection runs as a job (F-5), only on media in events where the organizer opted in, skipping any media whose uploader declined.
- Store the embedding, never a cropped face image. A crop is a photograph of a person; an embedding is at least harder to misuse, and there is no product reason to keep the crop.
- Clustering by cosine distance within the event, with a conservative threshold: a false merge shows someone a stranger's photos, which is worse than a false split.
- **Guest payoff, "Find my photos":** a guest takes one selfie, it is embedded in-memory, matched, and **the selfie and its embedding are both discarded within the request**. Nothing about the selfie is written to disk, ever. Say so in the UI at the moment of capture, because that is when people decide whether to trust it.
- A visible per-person control in the gallery: "this is not me" to split a cluster, and "remove me from this event" to delete it.

**If AI-3a looks like too much to carry:** AI-2 visual grouping gets you scene, time, and similarity clustering with none of this exposure, and covers most of the organizer's actual sorting problem. Faces are the last 20 percent of the value at 100 percent of the legal risk.

### AI-4. Smart folders
**Size:** M. **Depends on:** AI-1 or AI-2, MED-4.
A folder whose `kind = 'smart'` holds a stored query (time range, label, person cluster, uploader, similarity to a seed photo) and is evaluated live. Nothing is copied, so a photo can appear in several smart folders without violating the one-folder rule in MED-4.

### AI-5. AI enhancement, two tiers
**Size:** L. **Depends on:** CAM-2.
- **On-device tier (free, instant):** extend the existing `lib/image-enhance.ts` looks with auto white balance, shadow and highlight recovery, and light denoise. Keep everything as a single pixel pass so the preview and the saved file stay identical, which the current file already does well.
- **Cloud tier (costs credits):** `lib/ai/enhance.ts` with operations for restore and upscale (Real-ESRGAN), face restoration (GFPGAN or CodeFormer), low-light lift, and background cleanup. Charged against `plan.aiCreditsPerEvent`.
- **Always non-destructive.** The enhanced result is a new `media` row with `derived_from_id` set, the original is retained, and the organizer picks which is shown in the gallery. Never silently replace someone's photo.

### AI-6. Safety screening
**Size:** M. **Depends on:** F-5.
A public QR at a public venue will eventually receive something you do not want in a shared gallery. Run an NSFW and violence classifier on upload; anything flagged goes to `pending` regardless of the moderation setting, with a reason shown to the organizer only. Cheap insurance, and it belongs in the same job pipeline as AI-2.

### AI-7. Duplicate and quality cleanup
**Size:** M. **Depends on:** AI-2. **Promoted from NEW-6 on 2026-09-30.**
Organizers will reach for this on every single event, which is more than can be said for most of Phase AI.
- **Exact duplicates** by `content_hash`, which the schema already stores and nothing currently reads. ARCHITECTURE specced a duplicate badge and it was never built, so start by finally shipping that.
- **Near-duplicates** by embedding distance (AI-2): the nine near-identical frames everyone shoots of the same toast.
- **Blur scoring** by variance of the Laplacian, computed server-side on the compression pass and stored on the `media` row, so it costs one pass rather than a second fetch.
- The payoff is one action: "47 similar photos, keep the sharpest of each group", with a preview of exactly what will be hidden and an undo. **Hide, do not delete**, at least on the first pass. Deleting a guest's photo because an algorithm called it blurry is not a mistake you can take back, and the sharpest frame is not always the best one.

### AI-8. Highlight selection
**Size:** M. **Depends on:** AI-2, AI-7. **Blocks:** GRW-1, GRW-2.
Score each photo for recap-worthiness: sharpness (AI-7), faces present and looking at the camera (or scene labels if AI-3 is skipped), exposure, composition, and diversity so the top 20 are not twenty shots of one moment. Spread the selection across the moments from AI-1 so a recap tells the story of the night rather than showing the best-lit ten minutes of it. Expose it as "Highlights" in the dashboard with manual override, because the organizer's judgement beats the score and they will want the shot of their grandmother whether or not it scored well.

---

## Phase QR: QR control and the in-app print studio

### QR-1. Many slugs, one gallery (permanent aliases)
**Size:** M. This is "should be able to change the QR code". **Decision (2026-09-30): aliases are permanent, never expiring.**
A QR encodes `${APP_URL}/e/${slug}`, so renaming means a new slug, and printed signage already in the world would break. The model is therefore not "rotate and retire" but **many slugs pointing at one gallery, all permanently reserved to that event**:
- Table `event_slugs` (slug primary key, event_id, is_primary boolean, created_at, retired_at nullable). Every slug an event has ever held stays in this table forever. `events.slug` becomes a denormalised pointer to the current primary, or is dropped in favour of a `where is_primary` lookup.
- **A retired slug is never released back into the pool.** This is the security property that matters: if a retired slug could be claimed by someone else, every printed QR code from the old run would silently start pointing at a stranger's gallery. Permanent reservation removes that entire class of attack, and it is why aliases do not expire.
- `/e/[slug]` resolves through `event_slugs`. A non-primary slug serves the gallery directly rather than redirecting, because a 301 to a different URL in a guest's address bar looks like a phishing hop on a phone. Set the canonical link tag to the primary instead.
- Renaming adds a new primary and flips the old one to `is_primary = false`. Nothing is deleted, so a rename is fully reversible and an organizer can run two signs (an old poster and a new table tent) against the same gallery at once.
- Custom slugs allowed on Premium and Venue, validated against the same reserved-word list as usernames (ID-1) and checked against **every** row in `event_slugs`, retired ones included.
- Show the organizer the full list of slugs pointing at their gallery, with the note that old printed codes keep working. That is a reassurance, not a warning, so drop the typed-confirmation gate.
- Migration: backfill one `event_slugs` row per existing event with `is_primary = true`.

### QR-2. Styled QR codes
**Size:** M.
Replace the plain `qrcode` render for display purposes with a styled renderer: rounded or dot modules, custom module and background colour drawn from the event's accent colour, optional logo in the centre, optional frame with a call-to-action caption ("Scan to share your photos").
- Use error correction level H whenever a logo is overlaid, and cap logo coverage at 20 percent of the code area.
- **Verify scannability programmatically.** Decode the rendered PNG with `jsqr` in a test before any download is allowed. A pretty QR that does not scan is worse than an ugly one that does, and this failure mode is common with styling libraries.
- Keep the plain high-contrast version as the default and as a one-click fallback.

### QR-3. Share the QR properly
**Size:** S. This is "and share the QR code".
- Web Share API with the PNG as an actual file (`navigator.share({ files: [...] })`) so it goes straight into WhatsApp as an image.
- Direct WhatsApp, Messages, and email intents with pre-written copy.
- Copy link, copy short link, and a wallet-style "Add to home screen" QR card for the organizer's phone so they can show it when signage fails.
- A `GET /api/events/[id]/qr?format=story` export sized 1080x1920 for Instagram stories.

### QR-4. Print studio, the canvas editor
**Size:** XL. This is the "canvas editing built inside the app so they do not take the print separately". Break it into QR-4a through QR-4f; each is shippable.

**Library choice:** Konva with react-konva (MIT). Fabric.js v6 is the alternative. Konva wins here for React integration, a clean layer model, and `stage.toDataURL({ pixelRatio })` making 300 DPI export a one-liner. Do not build a canvas engine by hand.

- **QR-4a. Document model and persistence.** Table `print_designs` (id, event_id, name, preset, width_mm, height_mm, bleed_mm, doc jsonb, thumbnail_key, created_by, created_at, updated_at). The `doc` is a serialised scene graph, versioned with a `schema_version` field so old designs survive editor changes. Autosave on a debounce, and keep the last 10 versions so a mis-click is recoverable.
- **QR-4b. Canvas and tooling.** Stage sized in millimetres and rendered at a screen scale. Elements: QR (aspect-locked, quiet zone enforced, live-bound to the event so rotating the slug updates every design), text, image, shape, line, background. Tools: move, resize with handles, rotate, snapping to edges and centres, alignment and distribution, layer panel with reorder and lock, undo and redo via a state stack, zoom and pan, rulers and guides.
- **QR-4c. Typography and assets.** Curated font list starting with the two already loaded (Fraunces for display, Geist for text) plus a handful of Google fonts, subset and self-hosted so the server-side export renders identically. Image upload to R2 under `designs/<eventId>/`, with size limits and the same mime allowlist. A small library of Klik-brand marks and icons.
- **QR-4d. Templates.** Ship 10 to 12 starter templates as `doc` JSON, authored in the shipped identity (volt on near-black, cream on black, minimal cream on white): A4 poster, A5 flyer, 4x6 table tent, sticker sheet, welcome sign, bar sign, menu insert, place card, thank-you card, Instagram story, save-the-date. Templates are the actual product here; a blank canvas makes people leave.
- **QR-4e. Export.** PNG at 300 DPI, PDF via `pdf-lib` with the correct physical page size, optional 3 mm bleed with crop marks, and CMYK-safe warnings. Start with client-side export from Konva (fonts are already loaded and correct in the browser), and add a server-side render only if you need exports without a browser. Filename `klik-<slug>-<preset>.pdf`.
- **QR-4f. Print guardrails.** Before allowing export, warn when: the QR renders smaller than 2.5 cm at the chosen physical size (below reliable scan distance), the contrast ratio between QR modules and whatever is behind them is under 4.5:1, any element crosses the bleed line, or an uploaded image is below 150 DPI at its placed size. These four checks are what separate this from a toy.
- **Mobile:** the full editor is desktop-first. On phones, offer template selection, text editing, and export only. Say so in the UI rather than shipping a broken drag experience.

---

## Phase CAM: Camera, editor, sharing

### CAM-1. Camera gaps
**Size:** M.
The in-app camera is already good (six looks, torch, zoom, focus tap, timer, front and back). Missing: burst mode, a level and grid overlay (grid exists, level does not), correct mirroring on the front camera for the saved file versus the preview, a shot counter, and graceful degradation when `getUserMedia` is blocked (currently the failure path needs a clear recovery message pointing at the system file picker).

### CAM-2. Open-source image editor
**Size:** L. This is "find some open source image editor and integrate it".
**Recommendation: Filerobot Image Editor** (MIT, actively maintained, React component, crop with aspect presets, rotate, flip, filters, annotate, text, resize, watermark). Alternatives considered: `tui.image-editor` (MIT but effectively unmaintained), Cropper.js (excellent but crop only, you would build the rest), Photopea embed (not open source, free tier has conditions, heavyweight).
- Integration: `components/media/image-editor.tsx` loaded with `next/dynamic({ ssr: false })` because it touches `window` on import. Feed it the signed content URL, receive a Blob on save, then push that Blob through the **existing** upload path so compression, quotas, and moderation all apply unchanged.
- Saved edits create a new media row with `derived_from_id`; never overwrite the original.
- Theme it to the Klik tokens rather than accepting its default chrome, or it will look bolted on.
- Available to both organizers (dashboard) and guests (on their own uploads).

### CAM-3. Sharing from the gallery
**Size:** M. **Depends on:** MED-2.
Per-item: copy share link, Web Share API with the file attached, download original, download web-size, and a 9:16 story export with the event QR in the corner so a guest sharing a photo also advertises the gallery. That last one is a growth loop, not a nicety.

### CAM-4. Disposable camera mode
**Size:** M. **Promoted from NEW-2 on 2026-09-30.** The name of the app, finally doing the thing.
Two per-event settings and a reveal job, and it changes the entire feel of the product.
- **A shot limit per guest** (default 24, like a real roll), configurable, with the counter shown prominently in the camera UI. Scarcity makes people compose instead of spraying, and it incidentally caps your storage cost per guest.
- **Photos hidden until the roll is developed**: nobody sees anything, including the uploader, until the organizer taps "Develop" or the event's end time passes. The reveal the next morning is a shared moment rather than a feed that was already scrolled at the venue.
- Implementation: `events.disposable_mode`, `events.shots_per_guest`, `events.developed_at`, plus a guest-side counter on the `guests` row. The gallery query already filters on status, so the reveal is one more predicate in `lib/media.ts` rather than a new access path. A scheduled job flips `developed_at` at the event end time.
- Edge cases that need deciding in the build: does the organizer see photos before developing (yes, they are moderating), does a guest get more shots if they ask (organizer-grantable top-up), and what happens to uploads arriving after development (they appear immediately).
- The camera needs a genuinely different mood in this mode: no preview after the shot, a counter, a wind-on sound. Lean into it or do not ship it, because a half-hearted version is just a photo limit.

---

## Phase GRW: Growth loops

### GRW-1. Guest recap email
**Size:** M. **Depends on:** F-5, F-8, AI-8. **Promoted from NEW-5 on 2026-09-30.**
The morning after an event, every guest who left an email gets the highlights (AI-8) with a link back to the gallery. Every recipient is someone who just experienced Klik at an event and might host the next one, which makes this the strongest organic loop available to a product like this.
- Requires capturing an optional email at the guest entry sheet, which it currently does not do. Optional, clearly labelled as "get the photos after", never required to join, and a separate consent tick from the upload consent.
- Send through the job runner, once, with a one-click unsubscribe and full CAN-SPAM and GDPR compliance in the footer. One email per guest per event, no drip, no follow-up sequence. The moment this becomes marketing it stops being welcome.
- Include a soft "host your own" call to action, below the photos, not above them.

### GRW-2. Highlight reel
**Size:** L. **Depends on:** GRW-1, NEW-8.
A 30-second video assembled from the highlights with a beat-matched cut and a title card carrying the event name. Rendered server-side with ffmpeg in a job, stored in R2, shareable with its own link (MED-2) and downloadable as a 9:16 story export.
- Music is the trap here: shipping with recognisable tracks is a licensing problem, so use a small library of cleared or CC0 beds and let organizers upload their own at their own risk.
- Gate behind Premium and Venue. It is the most shareable artefact the product can produce and a genuinely good reason to pay the extra $50.

### GRW-3. Photo challenges
**Size:** M. The organizer sets prompts ("a photo with someone you just met", "the worst dance move"). Guests see them as cards in the upload sheet, completed prompts get a checkmark, and a leaderboard shows top contributors. At weddings this reliably multiplies upload volume, which is the metric that makes the gallery worth paying for.

### GRW-4. Public profile at /u/[username]
**Size:** M. Depends on ID-1. Gives the global username system a visible purpose: a photographer or venue shows their public events. Opt-in, off by default.

### GRW-5. Referral credits
**Size:** M. Every organizer got there by attending someone else's event. A referral code granting both sides credit makes that path explicit.

### GRW-6. Physical print fulfilment
**Size:** L. "Order prints" and "order a photo book" from the gallery, fulfilled through Prodigi or a similar print API with a margin. Turns the print studio (QR-4) into a revenue line rather than a cost centre, and guests are already in a buying mood the day after an event.

### GRW-7. Organizer analytics
**Size:** M. QR scans over time, uploads per hour, unique contributors, top contributors, gallery views, share link clicks. Answers "was this worth $89" and justifies renewal for venues.

---

## Phase VEN: Venue surfaces

### VEN-1. Live venue display
**Size:** M. `/e/[slug]/live` as a full-screen auto-advancing slideshow for a projector or TV, with the QR in a corner, new photos animating in, and a moderation-safe delay. The slideshow component already exists in the lightbox; this is a different surface for it. Venues will ask for this by name.

### VEN-2. Kiosk mode
**Size:** M. A tablet at the venue entrance in a locked-down capture-only mode, no gallery browsing, no settings, auto-reset between guests. Venues ask for this, and it is mostly a constrained route over the existing camera.

### VEN-3. Custom domains for venues
**Size:** L. `photos.thevenue.com` pointing at a Klik gallery, via the Vercel Domains API plus a `custom_domains` table. A clear Venue-tier upsell and a strong retention hook.

---

## Phase OPS: Platform and delivery

### OPS-1. Video transcoding and poster frames
**Size:** L. **Depends on:** F-5. Raised in priority 2026-09-30: this is the honest answer to "how are we handling big 4K videos", and today the answer is "barely".

**What happens now.** A video is size-capped at upload (200 MB on Event, 500 MB on Premium and Venue) and then stored and served completely untouched. The photo pipeline resizes to 2560px and re-encodes at quality 80; `kind === "video"` skips all of it. There is no transcoding, no compression, no poster frame, and no duration limit beyond what fits in the size cap.

**One correction to something I said earlier in this document:** I described serving originals as "expensive in R2 egress". That was wrong. R2 charges **zero egress**, which is the main reason it was the right choice over Vercel Blob. Video cost here is storage ($0.015/GB/month) and Class B operations, not bandwidth. The problem with untranscoded 4K is the viewing experience, not the bill.

**What actually hurts, in order:**
1. **Every viewer downloads the full original.** A 200 MB 4K clip is 200 MB per person who taps it, on venue wifi, to watch fifteen seconds. This is the whole problem.
2. **No poster frames.** The grid renders `<video preload="metadata">` to get a first frame. iPhone `.mov` files frequently store the `moov` atom at the **end** of the file, so "just the metadata" can mean fetching a long way into a large file, once per video tile on screen. Generating real poster images is arguably worth more than the transcode itself, and is much cheaper.
3. **No duration cap.** A 10-minute 4K recording fits inside 500 MB and nothing stops it.
4. **Download-all ZIP.** Videos dominate the total and push events toward the 2 GB inline limit quickly, which is what MED-7 moves to a job.
5. SEC-7 (playback dying at 60 seconds) came out of this same area and is already fixed.

**PARTIALLY FIXED 2026-09-30.** Three of the five are addressed without any server-side video infrastructure:

- **Poster frames, extracted client side** (`lib/video-poster.ts`, migration `0005`). The uploader's own device seeks 0.15s into the clip, draws a frame to a canvas, and uploads a small JPEG alongside the video. The grid now renders that image with `preload="none"`, so problem 2 is gone entirely: nobody reaches for a moov atom any more. It costs the uploader one seek they never notice and removes the cost for every viewer. Clips uploaded before this fall back to the old behaviour, so nothing breaks.
- **Duration cap per plan** (`maxVideoSeconds`: 60s on Event, 180s on Premium and Venue). Checked on the client before upload with a clear message, and again server-side at registration. Client-reported duration is advisory, so this is a cap on honest uploads rather than a security boundary; real enforcement needs container probing, which arrives with the transcode job.
- **SEC-7**, playback dying at 60 seconds, fixed separately.

**Still outstanding, and this is the part that genuinely needs a server:** every viewer still downloads the full original to play it. That is problem 1, the big one, and it needs transcoding to 720p H.264 HLS through the job runner (F-5), keeping the original for download and serving the rendition for playback. Also still outstanding: `faststart` remuxing so the moov atom moves to the front of the original file, and MED-7's move of large ZIP exports to a job.

**Why this split was worth making:** posters and the duration cap remove most of the pain for a fraction of the work, and they hold up on their own. The transcode is the expensive half and it can wait until there is revenue to justify the compute.

### OPS-2. Resumable uploads
**Size:** M. R2 supports S3 multipart. A 200 MB video that fails at 90 percent currently restarts. Chunk and resume.

### OPS-4. Move the media bucket to a US jurisdiction
**Size:** S today, L after launch. **Do this before anything else in the plan.**
`klik-media` was created as an EU-jurisdiction R2 bucket, which is why `lib/storage.ts` has to use the `.eu.` endpoint. For a US-only product every upload and every video playback crosses the Atlantic, which hurts exactly the 200 MB 4K case OPS-1 is about.

**Jurisdiction is fixed at bucket creation and cannot be changed**, so this means a new bucket plus a migration. Right now that is 12 objects. After launch it is a migration project with downtime, which is why this sits at the top of the build order despite being nobody's idea of exciting work.

**EXPANDED 2026-09-30: this now also carries the caching work, and both are in v1.** They are the same question ("how do bytes reach the viewer") and the same cutover, so doing them separately means migrating delivery twice.

Steps: create `klik-media-us` with a US jurisdiction; copy objects with `rclone` or a short script; attach the custom domain `media.klik.kreativvantage.com` (already present in `next.config.ts`'s `remotePatterns`, so this was always the intent); switch public-gallery delivery from signed **URLs** to signed **cookies** so Cloudflare's edge can actually cache; flip `R2_BUCKET_NAME` and drop the `.eu.` endpoint in `lib/storage.ts`; verify a full upload and playback round trip; delete the old bucket once nothing references it. `blob_pathname` is bucket-relative, so no database change is needed.

**Keep private and password galleries on signed URLs.** Caching is only safe where the content is genuinely public; a cached response for a password-gated gallery is a disclosure. The split has to be explicit in the delivery route, not incidental.

### OPS-3. Offline upload queue
**Size:** L. Venue wifi is reliably bad. A service worker queues uploads with IndexedDB and drains them when connectivity returns, with a visible queue state. Turns the worst real-world failure into a non-event.

---

## Phase TRS: Trust, safety, and compliance

### TRS-1. Guest reporting
**Size:** S. A "report this photo" action on every item, feeding ADM-5. Required for a public-facing UGC product and currently absent.

### TRS-2. GDPR data export and deletion
**Deletion side largely BUILT 2026-09-30.** `lib/erasure.ts` implements hard deletion as a separate concept from the 30-day soft delete, because "we moved it to a trash folder" is not an answer to "remove my data". Nothing it does is recoverable and nothing waits.

Three things worth knowing about how it works:
- **Ordering is deliberately the opposite of the purge cron.** The cron deletes rows first so a crash leaves sweepable orphans rather than broken galleries. Erasure deletes **bytes first**, because the failure it must never produce is telling someone their data is gone while it still sits in the bucket. If the object delete fails the operation aborts with rows intact, so a retry still knows what to remove.
- **Foreign keys cascade the database, but R2 knows nothing about foreign keys.** Deleting a `users` row cascades events, guests, albums, co-host rows, venue clients, OAuth accounts and sessions, and would have silently orphaned every object those events owned. Pathnames are collected and deleted explicitly first.
- **Erasure takes soft-deleted rows too.** Verified by test: a row sitting in the 30-day trash must not survive an erasure, or "deleted" data outlives the deletion request.

Endpoints: `DELETE /api/me` (self-service, requires typing your own username or email back, superadmins blocked so the platform cannot be locked out), `DELETE /api/admin/clients/[userId]` (requires confirmation and a reason), `DELETE /api/e/[slug]/me` (a guest erases their own uploads and identity, **no account required**, proved by the signed per-event cookie they already hold), and `DELETE /api/events/[id]?erase=true` for an event.

`erasure_log` records that an erasure happened without keeping what was erased: the subject is stored as a SHA-256 hash, since a raw identifier would recreate in the audit trail exactly the record the request was meant to remove.

**Still outstanding:** the export half ("download everything you have on me"), UI for all four endpoints, and a scheduled job for bulk requests.

### TRS-2 original scope
**Size:** M. Depends on F-5. Self-service "download everything you have on me" and "delete my account and uploads". Becomes mandatory rather than optional the moment AI-3 ships.

### TRS-3. Accessibility and internationalisation pass
**Size:** L. Keyboard navigation in the lightbox already exists. Missing: focus management in sheets and modals, screen-reader labelling on the camera controls, contrast verification for custom gallery colours (a Premium organizer can currently pick a colour combination that fails WCAG and Klik will happily render it), reduced-motion handling for the grain and animations, and a translation layer for the guest-facing surface, which is the one strangers actually read.

---

## Phase ADM: Admin console

### ADM-1. Global search and drill-down
**Size:** M. **Depends on:** F-3.
Search across users, usernames, events, slugs, and venue clients from one field. Open any event's dashboard as an admin (already supported by the permission model).

### ADM-2. Revenue and subscriptions
**Size:** M. **Depends on:** PAY-4.
MRR, one-time revenue this month, active subscriptions, failed payments needing attention, refunds. Read from local `subscriptions` and `purchases` tables (kept current by the webhook) rather than calling Stripe on page load.

### ADM-3. Limits and capacity view
**Size:** M. **Depends on:** F-4, PAY-7. This is the "update on admin dashboard" you asked for.
A table of accounts and events sorted by percentage of plan consumed, with everyone over 75 percent surfaced first, total R2 storage and its cost, and a one-click plan override with a required reason field that writes to the audit log.

### ADM-4. Audit log and impersonation
**Size:** M.
Table `audit_log` (id, actor_user_id, action, target_type, target_id, metadata jsonb, ip, created_at). Log every admin action, plan override, password reset, ownership transfer, and media deletion. Impersonation is allowed but shows a persistent banner to the impersonating admin and writes an audit entry on entry and exit.

### ADM-5. Abuse and reports queue
**Size:** M. **Depends on:** AI-6, NEW-9.
Guest-reported media and AI-flagged media in one queue, with actions to hide, delete, notify the organizer, or suspend an event.

---

# SECTION B: proposals (all accepted 2026-09-30)

Every proposal in this section was approved and promoted into Section A with a real task ID. This section is kept only as a record of where each one came from and what it was originally argued for. Nothing here is pending.

### NEW-1. Passkeys for returning guests
**PROMOTED 2026-09-30 to ACC-6 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-2. Disposable camera mode
**PROMOTED 2026-09-30 to CAM-4 in Section A.** Approved, scheduled, no longer a proposal.

### NEW-3. Photo challenges
**PROMOTED 2026-09-30 to GRW-3 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-4. Live venue display
**PROMOTED 2026-09-30 to VEN-1 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-5. Guest recap email and highlight reel
**PROMOTED 2026-09-30 to GRW-1 and GRW-2 in Section A.** Approved, scheduled, no longer a proposal.

### NEW-6. Duplicate and quality cleanup
**PROMOTED 2026-09-30 to AI-7 in Section A.** Approved, scheduled, no longer a proposal.

### NEW-7. Organizer analytics
**PROMOTED 2026-09-30 to GRW-7 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-8. Video transcoding to HLS
**PROMOTED 2026-09-30 to OPS-1 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-9. Guest reporting
**PROMOTED 2026-09-30 to TRS-1 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-10. EXIF stripping and GPS privacy
**PROMOTED 2026-09-30 to MED-8 in Section A.** Approved, scheduled, no longer a proposal.

### NEW-11. Offline upload queue
**PROMOTED 2026-09-30 to OPS-3 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-12. Resumable uploads
**PROMOTED 2026-09-30 to OPS-2 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-13. Custom domains for venues
**PROMOTED 2026-09-30 to VEN-3 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-14. Public profile at /u/[username]
**PROMOTED 2026-09-30 to GRW-4 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-15. Physical print fulfilment
**PROMOTED 2026-09-30 to GRW-6 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-16. Watermarking for professionals
**PROMOTED 2026-09-30 to MED-10 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-17. Referral credits
**PROMOTED 2026-09-30 to GRW-5 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-18. Kiosk mode
**PROMOTED 2026-09-30 to VEN-2 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-19. GDPR data export and deletion
**PROMOTED 2026-09-30 to TRS-2 in Section A.** Approved, scheduled, no longer a proposal.
### NEW-20. Accessibility and internationalisation pass
**PROMOTED 2026-09-30 to TRS-3 in Section A.** Approved, scheduled, no longer a proposal.
---

# SECTION C: decisions

## Answered (2026-09-30)

### C-1 / C-7. Guests free, organizers paid only. ANSWERED
The organizer is the payer. Guests view, upload, download, and share at every tier with no account and no cost, and no guest-facing surface ever mentions a plan. **There is no free organizer tier**: signup leads to plan selection, and a superadmin comps anyone who needs it through PAY-1b. Reflected in PAY-1, PAY-7, ACC-4.

### C-2. Per-event passes. ANSWERED
Klik Event and Premium are one-time passes tied to a single event, matching the pricing page. Venue is the only subscription. PAY-1's ledger already assumes this.

### C-6. Grace, then read-only, never delete. ANSWERED
A lapsed Venue subscription gets a 7-day grace with everything working, then galleries go read-only but stay viewable and downloadable. Media is never deleted as a payment lever. PAY-8 already assumes this; the thing to hold onto is that guests did nothing wrong and should never lose access to their own memories over someone else's expired card.

### C-3. Face grouping: approved, with a real consent flow. ANSWERED
AI-3 was rewritten into AI-3a (consent and governance) and AI-3b (the technical layer). AI-3a ships first and alone, and AI-3b does not start until counsel signs off on it. The full list of what "proper consent" actually requires is in AI-3a; the short version is that guest consent at the door does not cover the other people in the frame, so the design also needs a retention schedule you publish and honour, a removal route for people who never used the app, erasure reaching embeddings, no cross-event identity graph, a minors decision, a DPIA, a provider DPA, and jurisdiction gating for Illinois, Texas, and Washington.

### QR slugs: permanent aliases, one gallery. ANSWERED
Many slugs point at one event, every slug an event has ever held stays reserved to it forever, and nothing is redirected or released. QR-1 rewritten. This is better than the 90-day grace I originally proposed: a released slug could be re-claimed by someone else, and every printed code from the old run would then point at a stranger's gallery.

### Admin and Stripe both control plans. ANSWERED
PAY-1 replaces `users.plan_key` with an entitlement ledger carrying a `source` of `stripe | admin | promo`. Admin grants outrank Stripe and webhooks may never overwrite them. PAY-1b is the admin control surface and can ship before any Stripe code.

### C-4. AI provider: split by operation. ANSWERED
Workers AI for the high-volume per-photo path (embeddings, labels, NSFW screening), Replicate for low-volume user-initiated restoration and upscaling. Only the Workers AI path touches every photo, so only it has to be cheap, and the bytes on that path never leave the network the R2 bucket already lives in. Reflected in AI-2 and AI-5.

### C-5. Reactions open, comments signed-in. ANSWERED
Both off by default per event. Now MED-9.

### Plan quotas: storage enforced, photo count as the headline. ANSWERED
Concrete table in F-4. Photos are cheap after compression, video drives cost, so the enforced ceiling is GB and the number people see is a photo count. Hitting the photo headline warns; hitting the storage ceiling blocks.

### C-8. Destructive actions: 30-day soft delete everywhere. ANSWERED
Media, events, and purges all set `deleted_at` first; a second pass removes the bytes 30 days later. Costs some R2 storage, makes every support ticket recoverable, and makes MED-5's undo trivial. Shipped 2026-09-30 for media and events (SEC-4). Also settled that `expires_at` means read-only and hidden, never deletion (SEC-6), and that rate limiting starts with the login and upload paths (SEC-3).

### Section B triage. ANSWERED
Four proposals approved and promoted into Section A with real IDs: disposable camera mode (CAM-4), EXIF and GPS stripping (MED-8), duplicate and blur cleanup (AI-7, plus AI-8 for highlight selection), recap email and highlight reel (GRW-1, GRW-2). The remaining Section B items are still unreviewed.

## Still open

Nothing is blocking. The open items below are judgement calls that can wait until the relevant phase starts.

- **AI-3a legal sign-off.** AI-3b cannot start until counsel clears the consent and governance layer. Everything else in Phase AI is unblocked.
- **GRW-2 music licensing.** Needs a cleared or CC0 audio library before a highlight reel ships publicly.

---

## v1 scope, jurisdiction, and build order (decided 2026-09-30)

### The v1 line

**v1 is: paid events, no AI.** Phases SEC, F, PAY, MED, QR, ACC, **plus LAW** (added 2026-09-30: you cannot take money from US consumers for user-generated content hosting without terms, a privacy policy, and DMCA registration). The product already works; v1 makes it sellable. Phases AI, GRW, VEN, OPS and TRS come after revenue exists.

**One thing I want to flag about that boundary, because I drew it and you picked it.** The option I wrote excluded **Phase ID (global usernames)** and **Phase ORG (multiple organizers per event)**, and both were explicit asks in your original brief. ORG-3 (invite a co-host by username) also depends on ID. I have parked them as **v1.1, immediately after v1**, rather than silently dropping them. If multi-organizer is something you expect to sell on, move it up and say so, because it changes the order below.

### Jurisdiction: US only

This overturns an assumption baked into several places, and one of them is time-sensitive.

**Your media bucket is in the wrong hemisphere.** `lib/storage.ts` talks to `<account>.eu.r2.cloudflarestorage.com`, because `klik-media` was created as an **EU-jurisdiction** bucket. Serving a US-only product from it means every upload and every video playback crosses the Atlantic. For the 4K video case in OPS-1, a 200 MB clip shot at a wedding in Texas travels to Frankfurt and back before a guest can watch it.

**R2 jurisdiction cannot be changed on an existing bucket.** It is fixed at creation, so fixing it means creating a new bucket and migrating the objects. Today that is 12 objects and about ten minutes of work. After launch it is a migration project with downtime. This is the cheapest it will ever be, and it is the single most time-sensitive item in this document. Scheduled as **OPS-4**.

**The legal picture changes shape.** GDPR was the frame for AI-3a; for a US-only product the dominant risk becomes **BIPA (Illinois)**, with **CUBI (Texas)** and **Washington HB 1493** behind it. That is worse, not better: BIPA carries a private right of action and statutory damages of $1,000 to $5,000 per person per violation, which is why it generates class actions that general liability policies usually exclude. Add **COPPA** for under-13s, which reinforces the decision to exclude minors from face detection. **CCPA/CPRA** applies only above revenue and volume thresholds you are nowhere near yet, so it is a later problem. AI-3a's substance stands; its framing needs a pass before AI-3b, and that is post-v1 anyway.

**Also:** US sales tax has nexus rules that vary by state and can apply to digital services. Worth one conversation with an accountant before the first invoice, not before the first line of code.

### Build order, single-threaded

One person, so nothing below assumes parallel work, and each block ends somewhere you could stop.

**Block 0, this week, cheap and time-sensitive**
1. ~~Set `APP_URL`~~ done 2026-09-30 (`https://klik.kreativvantage.com`; still needs setting in Vercel)
2. **MED-8** strip EXIF and GPS (a live privacy leak, and small)
3. **F-1** rewrite ARCHITECTURE.md, **F-6** Zod env validation
4. **LAW-2** register the DMCA agent (an afternoon, and safe harbor is not retroactive)

**Block 0.5, the delivery cutover, before real traffic**
5. **OPS-4** US bucket **plus** custom domain **plus** signed-cookie caching, as one migration (decided 2026-09-30)

**Block 1, the floor under the money**
5. **F-7** test harness, before anything touches payments
6. **F-3** permissions resolver, **F-4** usage accounting

**Block 2, revenue**
7. **PAY-1** entitlement ledger, **PAY-1b** admin grants (no Stripe needed; this is also the migration that retires `users.plan_key`, so re-read SEC-1 first)
8. **PAY-2**, **PAY-3**, **PAY-4** Stripe customers, checkout, webhook
9. **PAY-5**, **PAY-6**, **PAY-7** billing surface, enforcement, limit warnings

**You could stop here and charge money.**

**Block 3, the product people are paying for**
10. **F-5** job runner, **F-8** transactional email, then **PAY-8** dunning
11. **ACC-1** through **ACC-5** guest accounts and signup
12. **MED-1**, **MED-2**, **MED-3** per-photo visibility, share links, access management
13. **MED-4**, **MED-5** folders and bulk operations

**Block 4, the differentiator**
14. **QR-1**, **QR-2**, **QR-3** slugs, styling, sharing
15. **QR-4a** through **QR-4f** the print studio
16. **F-2** remaining rate limits, **F-9** error tracking

**v1.1:** ID-1 through ID-3, then ORG-1 through ORG-4.

### Account setup

All four are being set up, so nothing is blocked on access. What each needs:

| Service | Env vars | Notes |
|---|---|---|
| **Resend** | `AUTH_RESEND_KEY` | Verify the sending domain with SPF and DKIM before any volume, or signup codes land in spam. Highest leverage key on the list. |
| **Domain** | `APP_URL` (no trailing slash) | Set in Vercel too, not only locally. `lib/env.ts` falls back to the Vercel deployment URL, which silently produces working but wrong QR codes. |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_EVENT`, `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_VENUE_MONTHLY`, `STRIPE_PRICE_VENUE_ANNUAL` | Event and Premium are one-time prices, Venue is recurring. Test mode first; `stripe listen` forwards webhooks locally. |
| **Google OAuth** | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Redirect URI is `<APP_URL>/api/auth/callback/google`, so it needs the real domain first. |

Add every one to `.env.example` as it lands, and to Vercel, not just `.env.local`.

### The gap that needs nothing from you

**F-7, tests.** Still none. Recent work touched deletion, erasure, retention and rate limiting, and the confidence behind it rests on two throwaway scripts that were deleted afterwards. It is Block 1 for a reason.

---

## How we handle things going wrong

An honest audit of what happens today when something fails, because "we will add monitoring later" is how outages become mysteries.

### What already protects us

| Risk | Control | Where |
|---|---|---|
| Mass accidental deletion | 30-day soft delete on media and events | SEC-4 |
| A retention misconfiguration wiping the platform | Circuit breaker: abort when over 25 events **and** over half of all events are eligible | SEC-1 |
| A plan change shortening retention | `retention_until` pinned at creation, only ever extended | SEC-1 |
| Credential stuffing, CPU exhaustion | Rate limits before the bcrypt compare | SEC-3 |
| Unbounded storage from forged uploads | `ContentLength` bound into the presigned signature | SEC-2 |
| Double-charging on a Stripe retry | Idempotency ledger, `stripe_webhook_events` | PAY-2 (designed, not built) |
| Unhandled exceptions showing a framework error page | `error.tsx`, `global-error.tsx`, `not-found.tsx` | added 2026-09-30 |

### What does not protect us yet, worst first

1. **Nothing tells you when something breaks.** No error tracking, no alerting, no uptime check. A 500 on the upload path at a Saturday wedding surfaces as a support email on Monday, if at all. F-9 is one afternoon of work and it is the highest-value unbuilt item in this table.
2. **R2 has no versioning, so deletion is absolute.** Soft delete protects against a user mistake. It does not protect against a *bug* in the erasure or purge code, because those call `DeleteObjects` for real. If `eraseUser` ever selects the wrong rows, the objects are gone with no recovery path. Enable R2 object versioning with a 30-day lifecycle rule; it costs little at this scale and it is the only thing standing between a logic bug and permanent loss of someone's wedding.
3. **No verified database backup.** Neon provides point-in-time restore on paid tiers, but nobody has confirmed the retention window or tested a restore. An untested backup is a belief, not a backup.
4. **No staging environment.** Migrations have been applied straight to the one database that exists. That was fine at 12 media rows and stops being fine the day a real customer's event is in there.
5. **The cron is unmonitored.** If `/api/cron/purge-expired` starts failing, or the circuit breaker trips every night, nothing says so. The breaker returns a 500 specifically so a monitor can catch it, once a monitor exists.
6. **No tests.** Still the honest gap. See F-7.

### What to do about it, cheapest first

- **Enable R2 object versioning now.** One setting, no code. Insurance against the class of bug that has no other recovery.
- **Confirm the Neon plan's PITR window, then actually test a restore** into a branch.
- **F-9 error tracking**, with an alert on the cron route and the Stripe webhook specifically, since both fail silently by nature.
- **A second Neon branch as staging** before the first paying customer, so migrations stop going straight to production.

---

---

## Phase LAW: US compliance (nothing here was in the plan before 2026-09-30)

These were genuine omissions, not deferred items. A US consumer product that hosts user-uploaded photos and takes card payments needs all of it, and none of it existed.

### LAW-1. Terms of Service and Privacy Policy
**Size:** M. **Blocks:** PAY-3 in practice, and LAW-2 and LAW-3 depend on it.
There is no privacy policy, no terms, no legal page anywhere in `app/`, and nothing links to one. ARCHITECTURE.md §7.8 promised "a simple privacy note page" and it was never built.

This is load-bearing for more than tidiness. Without published terms you cannot enforce your own rules (no acceptable-use basis to remove content or suspend an event), you have no stated retention policy to point at when someone asks why their gallery vanished at 180 days, Stripe frequently asks for both during onboarding, and BIPA specifically requires a **publicly available** written retention schedule before any biometric processing (AI-3a).

**DECIDED 2026-09-30: I draft both, you have a lawyer review rather than draft.** A template would describe retention and processing that do not match the code, which is worse than nothing once someone relies on it. These will be written from what the system actually does: the real `retention_until` windows, the real 30-day trash, the real sub-processors, and the erasure routes that exist.

Needs: privacy policy covering what is collected from guests who never signed up (display name, IP, EXIF timestamps, photos), the retention schedule that matches `retention_until` and the 30-day trash, sub-processors (Neon, Cloudflare, Vercel, Resend, Stripe), and the erasure routes built in TRS-2. Terms need acceptable use, the uploader's warranty that they have the right to share what they upload, a licence to host and display it, and the limits of that licence (see LAW-4).

### LAW-2. DMCA safe harbor
**Size:** S. **Cheap, easy to miss, and expensive to have missed.**
Klik hosts photographs uploaded by third parties, which is exactly the situation 17 U.S.C. §512 safe harbor exists for. It is not automatic. To qualify you must **designate an agent with the US Copyright Office** through their electronic system (a small fee, renewable every three years), publish that agent's contact details on the site, operate a notice-and-takedown process, and have a repeat-infringer policy you actually follow.

Skip the registration and you do not get the safe harbor, which means direct liability exposure for whatever a guest uploads. Registering is an afternoon and a few dollars. TRS-1's reporting flow gives you most of the takedown machinery already.

### LAW-3. COPPA and the age question
**Size:** M. **Needs a product decision, see the questions below.**
There is no age gate anywhere. Children attend weddings and birthday parties, they will be handed a phone and told to take photos, and the guest flow collects a display name, an IP address, and their photographs with no account and no age check. If you have actual knowledge of under-13 users, COPPA applies, and penalties are assessed per violation.

**DECIDED 2026-09-30: terms only, no friction at the door.** Prohibit under-13 in the terms, do not knowingly collect, delete on notice. An age affirmation would add friction to the single flow the whole product depends on, and at this stage that trade is not worth a stronger position on a risk that has not materialised. This is deliberately reversible: the entry sheet already has a consent checkbox, so adding an affirmation later is a small change if the risk picture shifts.

Carry-through: LAW-1's terms must actually contain the under-13 prohibition and a deletion-on-notice commitment, and TRS-1's report flow is the route by which notice arrives. This also interacts with AI-3a, where excluding minors from face detection is already decided.

### LAW-4. Guest consent does not cover marketing use
**Size:** S. **This one is a live mismatch, not a hypothetical.**
`events.venue_featured` plus `/v/[venueSlug]` publishes an event's gallery on a venue's public page. The consent a guest actually gave says their photos "may be visible to everyone with access to this event gallery". A venue's public marketing page is not that, and using someone's likeness to promote a business is squarely right-of-publicity territory in most US states.

**DECIDED 2026-09-30: the organizer curates what goes public.** A venue page shows only media the organizer explicitly selected, never the whole gallery. Narrowest exposure, no need to widen the consent copy at the door (where broader language costs conversions at the worst moment), and it matches what a venue actually wants anyway since no venue publishes every blurry shot.

Build: a `venue_showcase` selection (media ids chosen per event by the organizer) that `/v/[venueSlug]` reads instead of the event's media. The existing `events.venue_featured` boolean is not enough on its own, since it publishes everything. Until this ships, treat public venue galleries as not safe to use with real guest photos.

### LAW-5. Breach notification readiness
**Size:** M. **Depends on:** ADM-4, F-9.
All fifty states have breach notification statutes, most with deadlines measured in days. Responding to one requires knowing **what** was accessed and **whose** it was, which today is unanswerable: there is no audit log, no error tracking, and no access logging. ADM-4 and F-9 are the prerequisites; the missing piece after those is a written incident response plan naming who decides, who notifies, and within what window.

### LAW-6. Business and tax setup
**Size:** S, but not a coding task.
An entity and EIN for Stripe, a decision on sales tax nexus (SaaS and photo services are taxable in some states and not others, and Stripe Tax can handle collection once someone decides what is owed where), and a check on whether your insurance excludes biometric claims before AI-3b ships. One conversation with an accountant, one with a broker.

---

---

## What breaks first, in order

A scalability read of the current architecture against one realistic worst case: a 200-guest wedding, 2,000 photos, everyone scrolling at once.

| # | What gives | Why | Fix |
|---|---|---|---|
| 1 | **Media delivery** | Every thumbnail is a Vercel invocation plus a Neon query plus an R2 signature plus a redirect, and `no-store` means nothing caches anywhere, ever. 200 guests scrolling 2,000 photos is hundreds of thousands of invocations for one event. | Custom R2 domain and signed **cookies** instead of signed URLs, so Cloudflare's edge serves public galleries. See architecture note 3. |
| 2 | **Gallery polling** | SWR polls every 8 seconds. 200 phones is about **1,500 requests a minute** hitting a full keyset query before anyone opens a photo. | A cheap `HEAD`-style endpoint returning only `max(created_at)`, so the expensive query runs only when something actually changed. |
| 3 | **Video playback** | Every viewer downloads the full original. One 200 MB 4K clip watched by 50 guests is 10 GB moved to play 15 seconds. Egress is free on R2, so this is a latency and experience problem, not a bill. | OPS-1 transcoding. Posters and duration caps (done) blunt it; they do not solve it. |
| 4 | **ZIP export** | Streams inline, blocks a function up to 300s, hard-fails past 2 GB, and video makes 2 GB arrive quickly. | MED-7, move to the job runner with a signed link by email. |
| 5 | **Correctness under concurrency** | `neon-http` has no transactions, so multi-step deletes are not atomic. Load makes partial failures likelier, not rarer. | Architecture note 1, switch to the WebSocket `Pool`. |

**Indexing is handled** as of migration `0007`: partial indexes on the live-row predicates (`WHERE deleted_at IS NULL`) for the gallery, owner dashboards and album lists, and separate partial indexes on the trash predicates for the purge cron. Partial is the right shape for soft delete: the gallery never reads trashed rows, so excluding them keeps the index small and makes the predicate free rather than a post-scan filter.

**Fixed 2026-09-30:** bulk restore was one `UPDATE` per id, so restoring a 500-photo selection meant 500 sequential round trips to Neon, slow enough to blow the function timeout on exactly the bulk operation the endpoint exists for. Now one statement per table via `inArray`.

### Data loss prevention, honestly

| Layer | State |
|---|---|
| User mistake | Covered. 30-day soft delete everywhere, restore API built. |
| Retention misconfiguration | Covered. Pinned `retention_until`, circuit breaker, null means skip. |
| **Bug in deletion code** | **Not covered.** Erasure and purge call `DeleteObjects` for real. R2 has no versioning enabled, so a logic error is unrecoverable. One browser setting fixes this. |
| **Database loss** | **Unverified.** Neon PITR depends on plan, and no restore has ever been tested. An untested backup is a belief. |
| **Bad migration** | **Not covered.** No staging. Four migrations have gone straight to the only database that exists. |

---

---

## Production hardening pass, 2026-09-30

### Nothing user-facing hard-deletes any more

`db.delete()` now appears in exactly three places, all of them terminal by design:
- **`lib/erasure.ts`**, which is the "remove my data" path. It must destroy, or the product does not do what it says.
- **The purge cron's trash sweep**, the final step of a soft delete after 30 days.
- **Failed-upload cleanup**, which removes an object that never got a media row. Nothing references it and the purge cron cannot see it, so leaving it would be a permanent orphan.

Two paths changed in this pass:

**Retention expiry used to destroy immediately.** An event crossing `retention_until` had every photo hard-deleted at 3am with no grace and no recovery. It now soft-deletes: the gallery empties on schedule, which is the promised behaviour, but the bytes live the same 30 days as any other deletion. Finding out a retention window was miscalculated should not cost someone their wedding photos, which is the failure SEC-1 was about.

**Guest personal data moved to the terminal step.** It was deleted at the retention moment; it now goes when the media genuinely goes. Restoring photos within the grace window without their guest rows would have lost every attribution.

**Co-host removal is now soft too**, which needed care rather than a column. That row grants *access*, so unlike other soft-deleted records a missed filter does not show stale data, it leaves a removed co-host still able to manage the gallery. Exactly one query reads that table for authorization (`requireEventManagerSession`), the revocation predicate lives there, and three display queries were fixed alongside it. Two real bugs surfaced doing this:
- The dashboard's co-hosted list filtered neither the membership nor the event, so a removed co-host kept seeing an event, and a soft-deleted event kept appearing for co-hosts after the owner deleted it.
- Re-adding a removed co-host would have violated the `(event_id, user_id)` primary key and surfaced as a 500 on a perfectly reasonable action. It now revives the existing row.

### Consent is one source of truth

Consent text was hard-coded in `entry-sheet.tsx`, paraphrased differently on the marketing page, and recorded as a bare `consented_at` timestamp. That cannot answer the only question that matters when someone objects: **what exactly did this person agree to?** A timestamp proves when a box was ticked, not what it said, and the copy could change underneath everyone who had already agreed.

`lib/consent.ts` now holds versioned text. The entry sheet renders it, the marketing page quotes it verbatim instead of paraphrasing (so the public promise cannot drift from the actual notice), and `guests.consent_version` records which version each guest saw. Existing guests were backfilled to `2026-09-30`, which is accurate rather than convenient: that string is byte-for-byte what was previously hard-coded.

The text stays deliberately narrow, covering this one gallery and nothing else. It does **not** cover promotional use on a venue page, which is why LAW-4 is being solved by organizer curation rather than by widening this wording.

### Environment validation (F-6, done)

Every consumer read `process.env` directly, some with non-null assertions. A missing variable surfaced as a runtime error on whichever request first touched that path, in production. `AUTH_SECRET` was the worst: it threw from `lib/guest.ts` on the first guest session, so a bad deploy looked healthy until somebody scanned a QR code.

Now parsed once at load with a message naming what is missing. One subtlety worth keeping: `.env` files set an unset key to an **empty string**, not undefined, so `AUTH_GOOGLE_ID=` produces `""`. Zod's `.optional()` only permits `undefined`, so a naive schema fails on every commented-out provider and takes the build down. Caught during this pass, handled with a preprocessor.

---

## Architecture decisions worth your review

Not bugs. Decisions already baked into the codebase that will shape what is cheap and what is expensive later, surfaced because you asked to review them rather than inherit them.

### 1. `neon-http` cannot do transactions, and correctness depends on that

`lib/db.ts` uses the HTTP driver, which supports `db.batch()` but **not `db.transaction()`**. ARCHITECTURE.md documents this as a constraint; what it does not say is how much now rests on it. Erasure deletes objects, then media rows, then guests, then the event. The purge cron does the same. Soft-deleting media also clears an event's cover in a second statement. **None of those sequences is atomic.** A failure part way through leaves a state no single step intended.

I wrote the ordering in each case so the surviving state is the recoverable one (bytes before rows for erasure, rows before bytes for purge), which is mitigation, not atomicity.

**The decision to review:** `@neondatabase/serverless` also ships a WebSocket `Pool` that *does* support real transactions. Switching `lib/db.ts` is a small change with a real payoff for exactly the operations that destroy data. The cost is a connection model less suited to serverless. Worth doing before PAY writes money-related rows.

### 2. Plan limits live in two places and already disagree in shape

`lib/plans.ts` defines limits in TypeScript. Migration `0002` also enforces them in **plpgsql triggers**, which hard-code `venue → 5, everything else → 1`. Two sources of truth, and the database one wins silently.

Right now they agree. They agree by coincidence. Change `maxActiveEvents` in `lib/plans.ts` and the trigger will keep enforcing the old number with a `P0001` exception that surfaces as a confusing 409. **PAY-1 makes this materially worse**, because the entitlement ledger moves plan resolution out of `users.plan_key` entirely, and the triggers read exactly that column.

**The decision to review:** either the triggers become the single source of truth and TypeScript only reports what they enforce, or they are dropped and enforcement moves fully into the application. Keeping both is the option that bites. PAY-1 has to resolve this, so decide before starting it, not during.

### 3. Every image view costs a function invocation and a database query

Media is delivered by redirecting to a signed R2 URL with a 60-second TTL and `Cache-Control: private, no-store`. Correct for privacy, and it means **nothing is ever cached anywhere**. Each thumbnail a guest scrolls past is a Vercel invocation, a Neon query, a signature, and a redirect.

Two hundred guests scrolling a 2,000-photo gallery is not a hypothetical at a wedding, and neither is the polling on top: SWR polls every 8 seconds, so 200 phones generate roughly **1,500 requests a minute** against the media endpoint before anyone opens a photo.

`next.config.ts` already lists `media.klik.kreativvantage.com` as a remote pattern, so a custom R2 domain was clearly intended at some point. That plus signed cookies (rather than signed URLs) would let Cloudflare's edge cache public galleries properly.

**The decision to review:** whether public galleries get cacheable delivery. It is the difference between this architecture holding at one big event and buckling. Also pairs naturally with OPS-4, since both are "how do bytes reach the viewer" questions.

### 4. JWT sessions mean you cannot revoke a login

`session: { strategy: "jwt" }` is forced by the Credentials provider, and ARCHITECTURE.md explains why correctly. The consequence it does not draw out: **there is no server-side session record, so there is no way to sign someone out.** Credential accounts have an escape hatch in `credentialVersion`, which a password reset increments. Google and email accounts have none. A stolen laptop stays signed in until the JWT expires.

**The decision to review:** whether "sign out all devices" matters to you. If it does, the fix is a `sessionVersion` on `users` checked in the `jwt` callback, mirroring what `credentialVersion` already does. Cheap now, awkward to retrofit once ACC-2 brings self-serve accounts.

### 5. A guest's identity is a 30-day bearer cookie with no server-side state

The `klik_g_<eventId>` cookie is a signed JWT holding a guest id. Nothing server-side tracks whether it is still valid, so it cannot be revoked, and `events.access_version` (which does invalidate gallery password unlocks) does not cover it. A guest who loses their phone has their upload identity travelling with it, and changing a gallery password does not evict them.

**The decision to review:** acceptable for a party gallery, probably. Worth a conscious yes rather than a default, especially once MED-6 lets a guest delete their own uploads, because then the cookie authorises destruction and not just attribution.

### 6. Duplicate detection was specced, built halfway, and never wired up

`media.content_hash` exists, has an index, and is populated. **Nothing reads it.** ARCHITECTURE.md §3 describes a duplicate badge that was never built. AI-7 now covers it properly. Noting it because a populated, indexed, unread column is the kind of thing that reads as working when it is not.

---

## Dependency order, if you want to just run it

```
SEC-1                                   (do this first, it is a live data-loss risk)
SEC-2  SEC-3  SEC-4  SEC-5  SEC-6
F-1  F-6  F-9                      (do these first, they are cheap)
F-2  F-3  F-4  F-5  F-7  F-8       (foundations, block most phases)
ID-1 -> ID-2 -> ID-3
ACC-1 -> ACC-2 -> ACC-3 -> ACC-4 -> ACC-5
ORG-1 -> ORG-2 -> ORG-3 -> ORG-4        (needs F-3, ID-3)
PAY-1 -> PAY-1b                         (PAY-1b ships without Stripe)
PAY-1 -> PAY-2 -> PAY-3 -> PAY-4 -> PAY-5 -> PAY-6 -> PAY-7 -> PAY-8
MED-1 -> MED-2 -> MED-3                 (needs F-3, F-2)
MED-4 -> MED-5 -> MED-6 -> MED-7
MED-8                                   (independent, do it early, it is a live GPS leak)
MED-9                                   (needs ACC-5)
QR-1  QR-2  QR-3                        (independent, ship any time)
QR-4a -> QR-4b -> QR-4c -> QR-4d -> QR-4e -> QR-4f
AI-1 -> AI-4                            (needs MED-4)
AI-2 -> AI-3a -> AI-3b                  (AI-3b blocked on legal sign-off of AI-3a)
AI-5  AI-6
AI-2 -> AI-7 -> AI-8 -> GRW-1 -> GRW-2  (GRW-2 also needs NEW-8)
CAM-1  CAM-2 -> CAM-3                   (CAM-3 needs MED-2)
CAM-4                                   (independent of everything, ship whenever)
GRW-3  GRW-4  GRW-5  GRW-6  GRW-7      (GRW-4 needs ID-1; GRW-6 needs QR-4)
VEN-1  VEN-2                            (VEN-3 needs PAY-1)
OPS-1 -> GRW-2                          (OPS-2, OPS-3 independent)
TRS-1 -> ADM-5    TRS-2    TRS-3        (TRS-2 needs F-5, blocks AI-3b)
ADM-1 -> ADM-2 -> ADM-3 -> ADM-4 -> ADM-5
```

**If you want the shortest path to something that visibly changes the product:** SEC-1 and SEC-3 first (they are cheap and they are live risks), then F-1 and F-4, then PAY-1 through PAY-7 (money and warnings), then MED-1 through MED-3 (per-photo control and share links), then QR-4 (the print studio).
