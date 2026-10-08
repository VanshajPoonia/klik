# Klik Roadmap

> **How to use this file.** Every task has a stable ID (for example `PAY-4`). To start work, say "do PAY-4" or "do PAY-1 through PAY-5". Tasks are ordered so that dependencies come first; each one lists what it blocks and what blocks it. Section A is the work you asked for. Section B is work I proposed myself, kept separate so you can approve or cut it before any of it is scheduled. Section C holds decisions I could not make for you.
>
> **Rules that apply to every task:** read `DESIGN.md` for structure and use the shipped tokens in `app/globals.css` for colour (near-black canvas, cream paper, volt yellow, never a hard-coded hex). No em dashes anywhere. Every organizer route checks capability, not just login. Every input is Zod validated.

---

## 0. Where the code actually is today

`ARCHITECTURE.md` was rewritten against the code in F-1 and is accurate as of the "last verified against commit" line in its own header. Check that line against `git log` before trusting it, and read this section for whatever landed afterwards. The real state:

**Built and working**
- Next.js 16 App Router, Drizzle on Neon, Auth.js v5 with JWT sessions.
- Storage is **Cloudflare R2**, not Vercel Blob. `lib/storage.ts` uses the S3 SDK against an EU-jurisdiction endpoint. The bucket is private and media is delivered through `GET /api/e/[slug]/media/[mediaId]/content` with short-lived signed URLs.
- Three roles exist in `users.role`: `organizer` and `superadmin`, plus anonymous guests who never get a row in `users` (they get a row in `guests` plus an HMAC cookie).
- Event CRUD, slug generation, QR PNG/SVG, one printable sign in three fixed templates, access gate (public / password / private), guest entry sheet with consent, direct-to-R2 upload with server-side HEIC conversion and compression, moderation queue, streaming ZIP download with batching, expiry cron, lightbox with a working slideshow, in-app camera with six client-side looks.
- `albums` (flat, Premium only), `event_co_hosts` (add by username or email, capped at 5), `venue_clients`, venue hub at `/v/[venueSlug]`, superadmin console at `/admin` with quick-create and password reset.
- Plans exist as static definitions in `lib/plans.ts` with capability helpers, and are enforced on event creation and on feature gates.
- **Self-serve signup at `/signup`, shipped 2026-10-06, and it is now how buying works.** A pricing button opens an explainer dialog, which links to `/signup?plan=<key>`, which creates the account and then redirects to a Stripe-hosted Payment Link. Email plus password, which is **not** ACC-2's OTP design; see that task for what it means for the rest of ACC. `BILLING.md` is the full record.
- **`users.activated_at` is what grants capability.** A new account has it null and can create nothing until a superadmin assigns a plan. This matters more than it looks: `users.plan_key` is `NOT NULL DEFAULT 'event'`, so every new account reads as owning the $39 plan, and anything deciding access from that column is wrong.
- Rate limiting in `lib/ratelimit.ts`: Postgres counters incremented inside a single upsert, wired into credential login and into the signup route per IP and per email.
- Transactional email through Resend in `lib/email.ts`, used by the signup welcome mail (`lib/emails/onboarding.ts`). Absent configuration is a normal state that reports itself rather than throwing, so a failed send never costs the account that was just created.
- Two test suites: Vitest with no database and no network, plus `npm run test:db` against a throwaway local Postgres cluster.
- The activation loop is closed, 2026-10-06. Assigning a plan on `/admin` sets `activated_at` **and** emails the organizer their dashboard link and the steps to get live, recorded in `users.activation_email_sent_at` with a resend control on the client card. Part of ACT-3, done at account level rather than per event.
- **Gallery read path rebuilt, 2026-10-08.** Pages sign their tiles in one request, tiles use thumbnails, and phones sync deltas from `/media/changes`, including removals. See ARCHITECTURE.md section 8.
- An append-only account history, `account_timeline`, 2026-10-07. Records what happened rather than what is currently true: email sends and refusals, who granted a plan, plan corrections. `/admin` derives a seven-step chain from it per client, marking only the steps a superadmin has to act on. This is a narrow slice of ADM-4's audit log, built because the activation loop needed somewhere to record a failed send; ADM-4 can widen it rather than start over.

- **Entitlement ledger, 2026-10-08 (ACT-1 to ACT-4).** Passes license one event, Venue licenses up to its limits, drafts exist before payment, and a superadmin grants with a reason. `users.plan_key` is retired. See `BILLING.md`.

**Not built at all**
- Granting a plan automatically. **Deliberately**, confirmed 2026-10-08: payments keep human approval. The ledger has a `source` column so automating it later is one webhook handler.
- Any usage measurement. Nothing counts storage, media, or guests, so nothing can warn about limits.
- Passwordless sign-up. `/signup` exists but asks for a password, so ACC-2's email-code path is still unbuilt, and usernames are auto-generated at signup rather than claimed (ID-2).
- Guest accounts, guest event history, guest to organizer upgrade.
- Nested folders (MED-4). Per-photo visibility, share links and revocable access **are** built: MED-1 through MED-3 shipped 2026-10-02 and 2026-10-03 as `drizzle/0011_media_visibility_and_shares.sql`, `lib/shares.ts` and `lib/share-access.ts`.
- Any AI beyond client-side CSS filters.
- A canvas print editor. The "sign" is a hard-coded SVG string in the QR route.
- Error tracking (F-9 shipped structured logging and email alerts; Sentry is wired but has no DSN). The background job runner **is** built as of 2026-10-08 (F-5), with SEC-2's orphan reaper as its first job.


## Contents

**This file is the whole plan.** Everything is here: phases, tasks, decisions, findings and build order. There is no second document.

| Section | What it holds |
|---|---|
| §0 Where the code actually is | Real state of the codebase, including whatever is newer than ARCHITECTURE.md's last-verified line |
| Phase SEC | Security findings from the audit, most already fixed |
| Phase F | Foundations: tests, permissions, usage, jobs, email, env, error tracking |
| Phase ID | Global usernames (v1.1) |
| Phase ACC | Guest accounts and the guest-to-organizer path |
| Phase ORG | Multiple organizers per event (v1.1) |
| **Phase ACT** | **Event activation by admin. The v1 replacement for payments** |
| Phase PAY | Stripe. Deferred out of v1 |
| Phase MED | Per-photo visibility, share links, folders, EXIF stripping |
| Phase AI | Grouping, enhancement, safety screening. Post-v1 |
| Phase QR | QR control and the in-app print studio |
| Phase CAM | Camera, image editor, disposable mode |
| Phase GRW | Growth loops: recap email, challenges, referrals |
| Phase VEN | Venue surfaces: live display, kiosk, custom domains |
| Phase OPS | Transcoding, resumable uploads, the US bucket move |
| Phase TRS | Trust, safety, compliance, accessibility |
| Phase ADM | Admin console |
| Phase LAW | US compliance: terms, DMCA, COPPA, consent scope |
| Section B | Proposals, all accepted and promoted |
| Section C | Every decision made, with reasoning |
| Production hardening pass | What changed on 2026-09-30 and why |
| What breaks first | Scalability read against a 200-guest wedding |
| Architecture decisions | Six things worth reviewing rather than inheriting |
| v1 scope and build order | The single-threaded order to actually work through |
| Credentials and setup | Which accounts to create, how, and the gotchas, plus a click-by-click runbook |

Work is requested by task ID: "do MED-8", or "do F-1 through F-5".

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

**Warning emails DONE 2026-10-08.** `notify.retention` runs daily and emails the organizer at 30, 7 and 1 days before `retention_until`, once each, recorded on `events.retention_warned_days`. A window that moves out (an upgrade) resets them, so the new date gets its own warnings. Drafts are never warned, since no window is running.

### SEC-2. Abandoned uploads are permanent, untracked, unbilled storage
**Size:** M. **Severity: high.**
The honest upload path is genuinely well built: `POST /api/e/[slug]/media` does a `HeadObject`, rejects any mismatch between declared and actual size, rejects oversize, and deletes the object in both cases. Credit where it is due, that is better than most implementations.

The hole is the path where the client **never calls that endpoint at all**. `POST /api/upload` hands out a presigned PUT that binds the key and content type but **not `ContentLength`**, so the bytes can be any size, and nothing reaps an object that never got a `media` row. The purge cron iterates `media` rows, so an orphan is invisible to it forever.

Combined with the complete absence of rate limiting (SEC-3), a script with a public gallery link can request presigned URLs in a loop and PUT arbitrarily large objects into your bucket indefinitely. That is an unbounded R2 bill with no product signal that anything is wrong.

**PARTIALLY FIXED 2026-09-30.** `ContentLength` is now passed to the presigned `PutObjectCommand`, which puts `content-length` into `X-Amz-SignedHeaders` (verified against the SDK, not assumed), so R2 rejects any PUT whose body is not exactly the size already checked against the plan cap. The browser sets that header itself from the blob and scripts cannot override it, so no client change was needed and the honest path matches automatically. The existing `HeadObject` check stays as the belt to that braces.

**Rate limiting added 2026-09-30:** `/api/upload` now consumes a per-IP bucket (200/hour) before any database work and a per-guest bucket (60/hour) after the viewer resolves. Organizers are exempt from the guest bucket since they legitimately bulk-upload. The two buckets exist because a whole venue shares one NAT address.

**FIXED 2026-10-08, the reaper.** `lib/job-handlers/reap-orphans.ts` runs daily on the F-5 queue. It lists `events/`, and deletes objects that no media row references, **soft-deleted rows included** so the trash keeps its bytes. The grace is 24 hours rather than the hour first proposed, since a slow 500 MB upload on venue wifi is not abandoned at sixty minutes, and an orphan costs a fraction of a cent a day. It shares the purge's circuit breaker shape (over 25 **and** a majority), walks the bucket a page at a time across runs, and has a `dryRun` mode. Before it shipped, a read-only dry run against production found all 12 objects referenced.

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

**UI DONE 2026-10-08.** A Trash tab on each event (managers only) shows deleted photos and folders with their purge dates and restores a selection; the main dashboard lists recently deleted events with Restore; deleting an event takes typing its name; and the photo delete dialog no longer claims "this cannot be undone", which was false and made people afraid to tidy their galleries. **Still outstanding:** the audit entry (ADM-4).

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
**Size:** S. **DONE 2026-10-02.**

Replaced rather than patched. The old file described Vercel Blob, Next.js 15, a domain the project does not own, and a security checklist for features later built differently, which is worse than having no document because an agent reads it as fact.

The new one is organised around what actually causes bugs here rather than around the old section numbering. Section 3, "six constraints that will bite you", is the load-bearing part: no transactions on `neon-http`, JWT sessions meaning logins cannot be revoked, plan limits duplicated between `lib/plans.ts` and the plpgsql triggers, soft-delete filters being load-bearing, R2 signing but not enforcing `Content-Type`, and every image view costing an invocation plus a query. Section 7 separates soft delete, retention purge and erasure, which are three different things that get confused into either data loss or a missed legal obligation.

It carries a "last verified against commit" line, so the next person can see at a glance how far it has drifted.

### F-2. Rate limiting
**Size:** M. **Blocks:** PAY (webhook abuse), ACC (OTP abuse), ID (username enumeration), MED (share link password brute force).
Create table `rate_limits` (key text primary key, window_start timestamptz, count integer) and `lib/ratelimit.ts` exposing `consume(key, limit, windowSeconds)` as a single upsert with a conditional increment so it is atomic under concurrency. Key format `<scope>:<identifier>:<bucket>`. Wire to: upload token handshake (60 per guest per hour, 200 per IP per hour), guest session creation (10 per IP per hour), gallery password attempts (10 per IP per hour, **done 2026-10-08**, plus 100 per event so a script cannot spread across one gallery from many addresses), credential login (10 per IP per 15 min, plus 5 per username per 15 min), username availability checks (30 per IP per minute), OTP requests (5 per email per hour), share link password attempts (10 per token per hour). Return `429` with `Retry-After`. Sweep expired rows in the existing purge cron.

### F-3. Permissions resolver
**Size:** M. **Blocks:** ORG, MED, ADM.
`lib/permissions.ts` replaces the three ad-hoc guards in `lib/roles.ts` with one resolver: `getEventCapabilities(eventId)` returns a typed set such as `{ viewDashboard, manageSettings, moderate, manageMedia, manageFolders, manageCoHosts, manageBilling, rotateQr, deleteEvent, exportAll }`. It resolves superadmin, owner, co-host role (ORG-2), and the owner's effective plan in one query. Every organizer route switches to it. Keep `lib/roles.ts` as thin wrappers during migration, then delete it.

### F-4. Usage accounting
**DONE 2026-10-08** (`drizzle/0021_usage.sql`, `lib/usage.ts`, `test/usage.dbtest.ts`). Not a separate `event_usage` table: `events.media_count` and `events.media_bytes`, kept by statement-level triggers on `media` (insert, delete, and update as "old row leaves, new row arrives", which covers soft delete, restore and re-encodes in one rule), and recomputed nightly by `usage.reconcile` so drift heals. Live media only: the trash costs storage but is not what the organizer can be asked to make room in, and empties within 30 days. `PlanDefinition` gained `maxStorageBytesPerEvent`, `photoHeadline` and `maxAlbums` per the table below; co-hosts were already there. Account-level usage and AI credits wait for ADM-3 and the AI phase.

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
**DONE 2026-10-08** (`drizzle/0016_jobs.sql`, `lib/jobs.ts`, `lib/job-runner.ts`, `test/jobs.dbtest.ts`). Built as designed below with one change forced by the plan: **Vercel Hobby allows cron once a day**, so the per-minute cron cannot be the trigger. The enqueue is instead. `kickJobRunner()` runs in `after()` and posts to `/api/jobs/run`, which answers 202 and drains in its own 300-second function; `/api/cron/jobs` at 04:00 UTC is the backstop and is safe to poll every minute from outside. A drainer also waits in-process for any retry due inside its own budget, so the first two retries do not depend on a second kick. Claims are one `UPDATE ... SKIP LOCKED` statement, proven by firing eight concurrent claimers at one job. Dead jobs alert through `reportError`. ARCHITECTURE.md section 7 has the details.

Writing the tests also fixed the test database itself: `scripts/test-db.sh` now applies every migration over the pushed schema, because three share-link tests had only ever passed on a cluster that happened to have 0011 applied by hand.

**Size:** M. **Blocks:** AI-2, AI-3, AI-7, MED-7, GRW-1, GRW-2, NEW-8, NEW-19.
AI embeddings, transcoding, large exports, and email all need work that outlives a request. Add table `jobs` (id, kind, payload jsonb, status, attempts, run_after, locked_at, locked_by, last_error, created_at) and `lib/jobs.ts` with `enqueue(kind, payload)` plus a claim query using `FOR UPDATE SKIP LOCKED`. A Vercel cron hits `/api/cron/jobs` every minute and drains up to N jobs within the function time budget, with exponential backoff and a dead-letter status. Do not reach for Redis or a queue service yet; Postgres handles this volume fine and keeps the stack at two services.

### F-6. Zod env validation and boot checks
**Size:** S.
`lib/env.ts` currently reads `process.env` ad hoc and `lib/storage.ts` uses non-null assertions on R2 credentials, which fails at request time instead of at deploy time. Add a Zod schema for every variable, parsed once at module load, with a clear error naming the missing key.

### F-7. Test harness
**Size:** M. **Started 2026-10-01. Pure-logic half done, database half blocked.**

Vitest is set up (`vitest.config.mts`, `npm test`), with 66 tests across three files. `@types/node` went from 20 to 24 in the same change, because vitest 5 requires it and the old pin did not match the Node 24 the project actually runs on Vercel.

Coverage was chosen on one rule: **cover what already went wrong once.**
- `lib/file-signature.test.ts` pins SEC-9. A zip, a PDF, an SVG, a WAV and an AVI are all refused, QuickTime and HEIC are separated by ISO brand rather than extension, and the deliberate "unknown brand is probably video" trade is pinned so it cannot be reversed by accident.
- `lib/events.test.ts` pins SEC-10, and does it structurally. Beyond asserting the allowlist, it reads the `events` columns out of the Drizzle schema and fails if any column is neither published nor listed as withheld **with a reason**. That turns "someone forgot to exclude the new column" from a silent disclosure into a failing build. This is the single most valuable test in the repo.
- `lib/exif.test.ts` pins MED-8, including the claim the roadmap got wrong: that the pipeline output carries no EXIF. It also pins that the lenient retry decodes a truncated file the strict pass throws on, so the retry cannot quietly become dead code.

**Found a real bug while writing these.** `slugifyEventName` deleted accented characters instead of folding them, so "Café Münch" became `caf-mnch` and "Renée's Party" became `rene-s-party`. The slug is the organizer-facing gallery URL and it goes on a printed QR sign, which is the worst place for it to look broken. Fixed with NFD normalisation, plus a trailing-dash fix where the 40-character truncation landed on a separator. Names in non-Latin scripts still fall back to `event` plus the random suffix, which is now tested rather than incidental.

**UNBLOCKED AND DONE 2026-10-02.** This did not need Neon after all. PostgreSQL 16 was already installed locally, so `scripts/test-db.sh` brings up a throwaway cluster under `/tmp` on a non-default port, pushes the schema, and `npm run test:db` runs 30 tests against it. Production uses `neon-http`, which cannot talk to a local server, so these use `node-postgres` against the same schema; the SQL is identical and that is what is under test. The one divergence is that `node-postgres` supports transactions, so **nothing in these tests may use `db.transaction()`**, or it passes here and fails in production.

`test/harness.ts` refuses to run unless the database is literally named `klik_test` and is not on Neon, because the suite truncates every table.

What the 30 cover:
- **The circuit breaker**, three ways: it fires when 40 of 50 events are suddenly eligible **and deletes nothing on the way to aborting**; it does not fire on 30 of 200, because both the count and the ratio condition are required; it does not fire on 5 of 5, which is what stops a new install tripping it on day one.
- **SEC-1 itself:** a null `retention_until` is skipped, not defaulted. Reaching a deadline soft-deletes rather than destroys, and the bytes survive the usual 30 days.
- **Erasure:** includes media already in the trash, which is the whole point, since by the time someone demands erasure some of their uploads are already soft-deleted. Video posters named explicitly. **A failed object delete leaves the rows and writes no log entry**, so the log never claims an erasure that did not happen. `eraseUser` collects objects across every owned event before the cascade removes the rows, because R2 knows nothing about foreign keys.
- **The co-host revocation predicate**, which is the highest-consequence query in the codebase: a soft-deleted membership is refused, a non-Premium owner's co-host is refused, a co-host of a different event is refused, and a removed co-host can be restored through the composite-key conflict path.

The type checker caught a mistake while writing these: there is no `"free"` plan key, only `event`, `premium` and `venue`.

Still to do: rate limiter concurrency under real contention, and Playwright for four flows (guest joins and uploads, organizer moderates and downloads, activation applies, share link expires). Run all of it in CI.

### F-8. Transactional email
**Size:** S. **Depends on:** F-5.
Resend is already a dependency for magic links. Add `lib/email/` with typed templates: co-host invite, quota warning at 75 and 90 percent, payment receipt, payment failed, gallery expiring in 7 days, media purged, guest recap. Send through the job runner so a slow SMTP call never blocks a request.

### F-9. Error tracking and structured logging
**Size:** S. **Vendor-free half DONE 2026-10-02. Sentry pending a DSN.**

Done without waiting for a vendor, because the useful part never needed one. Vercel captures stdout, so one JSON object per line is queryable there today.

- `lib/observability.ts` emits structured lines and holds `reportError`, the single seam Sentry plugs into later. Doing it this way round means adding Sentry is a few lines in one file rather than an import threaded through forty call sites. A registered reporter that throws is swallowed: Sentry being down is not a reason for an upload to fail.
- **Redaction is the load-bearing part**, and it is where the tests are. A secret in a log leaks without anything breaking, no test failing and nobody noticing, then sits in an aggregator for the whole retention window. Values are redacted by key name (`secret`, `password`, `token`, `authorization`, `cookie`, `dsn`, and more) *and* by shape, so a connection string under an innocent-looking key is still caught. Nested objects and arrays included.
- Every `console.error` on the critical paths is now a named, greppable event: `purge.circuit_breaker_tripped`, `purge.event_failed`, `upload.store_failed`, `upload.heic_convert_failed`, and the rest. Alerts get built on these names, so they are deliberately stable rather than sentences.
- The cron logs `purge.completed` on success too. A monitor that only ever sees failures cannot tell "nothing went wrong" from "the cron stopped firing", which is the failure a nightly job is most likely to have.
- **`GET /api/health`** checks the database and R2 and returns 503 when either is gone. Monitoring the homepage proves Vercel is up, not that Klik works, because the marketing page is static and returns 200 with the database on fire. Public, since an uptime monitor cannot authenticate, so the body carries statuses and durations and nothing else; failure detail goes to the log. Cached 30 seconds so a burst of pollers cannot turn into a burst of R2 calls. Verified live: database up in 1797ms cold, storage in 764ms, second call served from cache in 18ms.

**Still to do, and it needs you.** A Sentry DSN, then `registerErrorReporter` gets its one caller, with event ID and user ID as tags but never guest display names or emails in breadcrumbs. Separately, point an uptime monitor at `/api/health`: free tiers at UptimeRobot or Better Stack are enough, and until something polls it the endpoint only helps whoever thinks to look.

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
**Size:** M, reduced. **Depends on:** F-2, F-8.

**Partly overtaken 2026-10-06.** A `/signup` page shipped ahead of this phase because buying needed an account to attach a payment to, and it takes **email plus a password**, not a code. So the page, the route, its rate limits, the welcome email and the Credentials path all exist; what is still open here is the OTP itself and the choices around it. Re-scope before starting rather than building the page again:

- The page, `POST /api/signup`, per-IP and per-email rate limits, and the onboarding email are **done**. Reuse them.
- Usernames are **auto-generated** from the email at signup, which pre-empts the "claimed after, via ID-2" decision below. Either accept generated usernames and cut that part of ID-2, or add a rename flow.
- The Credentials provider is now the **main** signup path, not an admin-only one, so hiding it behind a "venue login" disclosure no longer makes sense.

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
**DONE 2026-10-02.** **Size:** M.
Add `event_co_hosts.role` with `manager | moderator | contributor`, default `manager`. The owner is not stored here, they are `events.owner_id`.
- `manager`: everything except billing, deleting the event, and transferring ownership.
- `moderator`: approve, reject, delete media, manage folders. No settings, no QR rotation, no co-host changes.
- `contributor`: upload on behalf of the event and see private media. Nothing else. This is the role for a hired photographer.
Encode the matrix once in `lib/permissions.ts` (F-3) and test it exhaustively (F-7).

**Shipped.** `lib/permissions.ts` holds the matrix, written out per role rather than composed by spreading a narrower role into a wider one: spreading reads nicely and hides the thing worth seeing, which is that adding a capability should force a decision on every row instead of silently granting it to whoever inherits. `resolveEventActor` in `lib/roles.ts` returns the actor and their role; `requireEventCapability` is what routes now call. `requireEventManagerSession` survives as the coarse "are you on the team at all" check, because ten call sites use it and most of them only need that.

Capabilities are bound to real routes, which is the part that makes roles mean anything: settings and QR rotation need `event.settings` and `event.qr`, media moderation and deletion are separate capabilities, albums, trash and the export ZIP each have their own. A contributor can upload and view and nothing else, which is the hired-photographer case the role exists for.

Migration `0010` adds the column with a `CHECK` constraint, defaulting to `manager`, which is exactly what every existing row already was in practice, so the backfill records reality rather than changing it. Deliberately not a Postgres enum: adding a value to one needs a migration and a lock, and this set is expected to grow.

Tested both ways. `lib/permissions.test.ts` spells the matrix out a second time, independently, because a test that imports the table it is checking proves only that an array equals itself; it also asserts the ladder property, that each role holds strictly less than the one above it, and that nobody below manager can change the team. `test/roles.dbtest.ts` covers the same rules through a real database.

### ORG-2. Move the co-host cap into plan config
**DONE 2026-10-02.** **Size:** S.
`maxCoHosts` is now part of the plan definition: Event 0, Premium 5, Venue 10. The literal `>= 5` is gone, and `canUseCoHosts` is derived from `maxCoHosts > 0` rather than compared against `"premium"`. That second part was a latent bug rather than a tidy-up: Venue accounts would have been refused co-hosts despite paying for a plan built entirely around running events for other people.

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

## Phase ACT: Event activation (the v1 replacement for payments)

### ACT-1. One entitlement model, admin-granted first
**DONE 2026-10-08** (`drizzle/0018_entitlements.sql`, `lib/entitlements.ts`, `lib/license.ts`, `test/entitlements.dbtest.ts`). Built close to the design below, with these differences, each deliberate:

- **Two shapes, not a status machine.** A pass (`scope = 'event'`) is spent by `applied_at`, which is never cleared, so a pass cannot come back if its event is purged. An account grant (`scope = 'account'`, Venue) carries `max_active_events` and `max_events_per_month` copied from `lib/plans.ts` at grant time, the way retention is pinned. Status is only `active | revoked`; "consumed" is `applied_at`, and "expired" is `ends_at`.
- **Architecture note 2 is resolved.** The 0002/0003 triggers are dropped. One new trigger, `events_entitlement_limits`, enforces "one pass, one event", owner match, and the Venue limits, reading its numbers from the grant row after locking it. `lib/plans.ts` is the only place a limit is written down.
- **The plan lives on the event.** `events.plan_key`, `entitlement_id` and `licensed_at`, so every hot path answers from the row it already loaded, which also removed a query from about twenty routes. `users.plan_key` is retired and read nowhere.
- **Windows run from going live**, not from creation, so a draft made months before a wedding does not arrive with its upload window already spent.
- **The backfill** gave every account exactly what it had: a spent pass per existing event, an unused pass for an activated account with no event, an account grant for Venue, and nothing for anyone never activated. It is tested by running the block straight out of the migration file.
- **The revenue leak is closed:** a $39 pass used to mean one new event every month indefinitely, because the plan was on the account.

**Size:** M. **Blocks:** ACT-2, ACT-3, and later all of PAY. Formerly PAY-1; renamed 2026-10-01 when payments left v1.
**Decision: the admin panel and (later) Stripe are both first-class grant sources, and neither may overwrite the other.** The admin panel is how things run today and stays that way after Stripe ships, so the model cannot be "Stripe is truth and admin is a hack". Building the human path first is the point: Stripe later adds a `source`, not a new concept.

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

### ACT-2. Admin activation surface
**DONE 2026-10-08.** Each client card on `/admin` has a grant form (plan, required reason, "their next event" or a named one) and the full grant history with revoke, which also needs a reason and deletes nothing. Every event shows live, draft, lapsed or deleted. A grant on an already active account emails "your event is live" about that event; the first grant's access email names the draft it put live instead of saying "create your event". `/admin/new` provisions through the same ledger.

**Size:** M. **Depends on:** ACT-1. Formerly PAY-1b. **This is the v1 revenue mechanism: a human decides.**
The admin panel already sets `users.plan_key` through `POST /api/admin/clients/[userId]/plan`. Rework it against the ledger: grant a plan to an account or to one specific event, with a reason, an optional end date, and an explicit revoke. Show the grant source on every event in the admin list so it is obvious at a glance whether an account is paying or comped.

### ACT-3. The organizer's side of activation
**DONE 2026-10-08.** Anyone signed in can create an event; without a pass or grant it is a draft (up to five), which the organizer sets up while guests see "not open yet". A banner on the event says what is pending and offers the one thing that moves it on: "Use my plan and go live" when the account holds something, otherwise "Ask Klik to activate it". The QR tab and both QR routes refuse a draft, and the venue hub never redirects into one. All three points below are met.

**Size:** M. **Depends on:** ACT-1. New 2026-10-01.
An organizer creates an event and it is **inactive**: no live QR, no guest access, no uploads. They can still name it, set the date, pick colours and design the print sign, so the waiting time is useful rather than dead. The dashboard states plainly what is pending and what unlocks when it is activated.

Three things this has to get right, because they are what turn a waiting screen into a support ticket:
- **Never a dead end.** A blocked action says what is happening and who is doing it, not "403".
- **The organizer must know when it flips. SHIPPED 2026-10-06, at account level.** Assigning a plan now sends the access email itself (`lib/activation-notice.ts`, `lib/emails/activation.ts`), carrying the dashboard link and the five steps from signing in to downloading the zip. `users.activation_email_sent_at` records it and `/admin` offers a resend, because the support call this answers is "I paid and never heard anything". What is **not** done is the event-scoped version this task actually describes: ACT-1's ledger can grant a plan for one event, and an organizer with three events needs to know which one just went live. Reuse the template, change what it is addressed about.
- **The QR must not exist until activation.** A QR generated against an inactive event either 404s or silently starts working later; both are worse than not offering it yet. This interacts with QR-1: a slug is permanent once printed, so it should not be mintable before the event is real.

### ACT-4. Activation requests and queue
**DONE 2026-10-08.** `events.activation_requested_at`, set by the organizer's button, rate limited, and recorded in `account_timeline`. `/admin` lists requests under "Waiting to go live", soonest event first, with anything within three days marked. The request emails `ALERT_EMAIL`. The decision reaches the organizer through the emails in ACT-2.

**Size:** S. **Depends on:** ACT-2, ACT-3.
An organizer asks for activation; the request lands in a queue on the admin dashboard with the event, the requester, and the date it is needed by. Without this the trigger is a WhatsApp message and the failure mode is an event going live an hour late. Notify the admin on request, notify the organizer on decision, record both in the audit log (ADM-4).

---

## Phase PAY: Stripe (deferred 2026-10-01, partly shipped 2026-10-06)

**PAY-2 and PAY-4 shipped on 2026-10-06, and PAY-3 shipped in part. `BILLING.md` is the record of what exists.** The site itself sells through Stripe-hosted Payment Links, and everything built here is linked from nowhere until someone changes one line in `components/marketing/pricing.tsx`. Read `BILLING.md` before touching any of it: the code is close to impossible to read correctly on its own, because it is all working and all unused.

What shipped records money. It does not grant capability, and that line is the whole design. Everything below still stands for the same reason it always did: ACT-1's ledger was designed for exactly this, so Stripe becomes a second `source` writing rows a human already writes today. Start it when you want to stop activating events by hand.

**One thing to re-read before starting:** architecture note 2 below. Plan limits are enforced both in `lib/plans.ts` and in plpgsql triggers that hard-code `venue -> 5, else 1` and read `users.plan_key` directly. ACT-1 moves plan resolution off that column, so the triggers have to be resolved as part of ACT-1, not left for PAY. They agree today only by coincidence.

### PAY-2. Stripe data model. SHIPPED 2026-10-06
**Size:** M. **Depends on:** PAY-1. Built as `drizzle/0012_stripe_billing.sql`, applied to production, typed in `lib/schema.ts`. All four tables are as designed below. `subscriptions.status` deliberately carries no check constraint: the vocabulary is Stripe's, and an unknown value must be stored rather than bounce the webhook into endless retries.
- `stripe_customers` (user_id primary key, stripe_customer_id unique).
- `subscriptions` (id, user_id, stripe_subscription_id unique, plan_key, status, current_period_end, cancel_at_period_end, created_at, updated_at).
- `purchases` (id, user_id, event_id nullable, stripe_checkout_session_id unique, stripe_payment_intent_id, plan_key, amount_cents, currency, status, consumed_at, refunded_at). A purchase with `consumed_at` null is an unused event pass the dashboard offers to apply to a new event.
- `stripe_webhook_events` (stripe_event_id primary key, type, received_at, processed_at, error). This is the idempotency ledger; without it a retried webhook double-grants a plan.

### PAY-3. Checkout. SHIPPED IN PART 2026-10-06
**Size:** M. **Depends on:** PAY-2. Built as `POST /api/billing/checkout` plus an embedded form at `/checkout?plan=...`, with the Stripe customer reused from `stripe_customers` and Price IDs read from env. Three deviations from the design below, all deliberate. It returns a **client secret rather than a Session URL**, because the form is embedded in a Klik page rather than hosted by Stripe, and a 303 would silently swap one integration for another. It takes `{ planKey }` only: **`eventId` is not carried yet**, so the webhook cannot tell which event a pass was bought for. And there is **no `STRIPE_PRICE_VENUE_ANNUAL`**, because no annual product exists in Stripe.
`POST /api/billing/checkout` taking `{ planKey, eventId? }`, creating or reusing a Stripe customer, and returning a Checkout Session URL. Price IDs come from env (`STRIPE_PRICE_EVENT`, `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_VENUE_MONTHLY`, `STRIPE_PRICE_VENUE_ANNUAL`), never from the client. Mode is `payment` for Event and Premium, `subscription` for Venue. Pass `client_reference_id` as the user ID and the intended `eventId` in metadata. Success returns to the event dashboard with a pending state; the grant happens in the webhook, not on the success page, because the success page is not a trustworthy signal.

### PAY-4. Webhook. SHIPPED 2026-10-06
**Size:** M. **Depends on:** PAY-2. Highest-risk task in the phase. Built as designed below, and verified against the live API: a forged signature is refused, and the same event delivered twice produces one purchase row rather than two.

**One deviation, and it is the important one.** The handlers record money and never touch `users.plan_key`, in either direction. A refund marks the purchase refunded and revokes nothing, because granting and revoking capability needs ACT-1's ledger first, and a webhook writing the single plan column is precisely how a comped venue gets silently downgraded. Paid purchases surface in `/admin` under "Paid, awaiting activation" and a superadmin grants the plan by hand. When ACT-1 lands, these same handlers write `source = 'stripe'` rows and the manual step goes away.
`POST /api/webhooks/stripe` with `export const runtime = "nodejs"`, reading the **raw** body for signature verification (Next's App Router gives this via `await request.text()`; do not parse first). Insert into `stripe_webhook_events` before processing and skip if already present. Handle `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Every handler must be idempotent and must never trust amounts from the client. On refund, revoke the grant and mark the event downgraded rather than deleting media.

### PAY-5. Billing surface for organizers
**Size:** M. **Depends on:** PAY-3, PAY-4.
`/dashboard/billing`: current plan per event, unused passes, subscription status and renewal date, invoice history, "Manage billing" opening the Stripe Customer Portal (`POST /api/billing/portal`), and an upgrade path from any event that hits a gated feature. Upgrade prompts should appear at the point of friction (the locked folder button), not only on a pricing page.

### PAY-6. Plan enforcement at the edges
**DONE 2026-10-08 for storage and folders.** The upload handshake refuses a file that would take the event past its storage, before a byte is sent, and tells guests "This gallery is full. Ask the host to make room", never a plan name; the gallery page hides its upload buttons at that point rather than offering ones that fail. Folders are capped by `plan.maxAlbums` instead of a literal 20 that disagreed with the pricing page. Co-hosts were already enforced, the upload window has been since ACT-1, and AI credits wait for the AI phase.

**Size:** M. **Depends on:** PAY-1, F-4.
Every limit currently enforced only at event creation needs enforcing where it actually bites: the upload token handshake checks media count, storage bytes, and upload window; the co-host route checks `maxCoHosts`; the folder route checks `maxAlbums`; AI routes check credits. Each refusal returns a message that names the plan and the upgrade action, because a bare 403 at a wedding is a support ticket.

### PAY-7. Approaching-limit warnings
**DONE 2026-10-08.** A usage meter on each live event's page: storage against the plan, photos against the headline, and upload days left. Quiet below 75 percent, amber at 75 and 90, red only when full. An email goes at 75, 90 and full, once each per event, claimed by a conditional update on `events.usage_warned_percent` and sent from the job queue so an upload is never kept waiting. Not done: banners beyond the meter, and the admin-wide view (ADM-3).

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
**DONE 2026-10-02.** **Size:** M. This is your "make certain pictures private and public".
Add `media.visibility` with `gallery | private | link`:
- `gallery` (default): everyone with gallery access sees it.
- `private`: only event managers, plus the guest who uploaded it if `events.uploader_sees_own_private` is on.
- `link`: hidden from the grid, reachable only through an active share link (MED-2).
Enforce in exactly one place, the media query builder in `lib/media.ts`, and in the content route. Add a single-item toggle in the lightbox and dashboard grid, and a bulk action (MED-5). Note this is orthogonal to `status`; a photo can be approved and private.

**Shipped.** The spec said two enforcement points. There were **three**: the gallery query, the content route, and the download route, which had its own quietly diverging copy of the rule. All three now go through `lib/media-access.ts`.

That module holds the rule twice on purpose, as SQL for the grid (filtering in JavaScript would mean fetching private rows and trusting the client not to look) and as a boolean for the single-row routes. Two expressions of one rule is precisely how a disclosure bug happens, so `test/media-access.dbtest.ts` asserts they agree across **every** combination of visibility, status and ownership against a real database, rather than testing each against what its author believed.

Decisions worth knowing:
- **`events.uploader_sees_own_private` defaults to true.** The alternative is cruel: a guest uploads a photo, the host hides it, and from the guest's side it silently vanished. Hosts who need a real back room can turn it off.
- **Link-only media is hidden from its uploader too.** Marking something link-only is how a host takes it out of the room, so an exception for the uploader would defeat the point.
- **An unknown visibility is refused, not guessed.** If a later migration adds one and this module is not updated, the two available guesses are "show it" and "hide it", and only one of those is recoverable. Managers still see it, so nothing becomes unreachable.
- **A 404, never a 403**, for media a viewer may not see. A 403 confirms the photo exists, which for a hidden photo is already the disclosure.
- Guests receive `visibility` in their payload. Safe, because the access rule means the only non-gallery media reaching a guest is their own, and without it their hidden photo is simply there with no hint the host moved it.

The dashboard grid has a per-photo control and a badge on the tile, because an organizer scanning two hundred photos should see which are hidden without opening each dropdown. The guest side shows "Only you can see this" on their own hidden uploads.

### MED-2. Share links
**DONE 2026-10-03.** **Size:** L. This is "each picture should get its own sharable link".

Per-photo links at `/s/[token]`, with expiry, an open limit, an optional password and a downloads switch. The token is 22 characters of nanoid and the lookup is by token alone, so the URL carries no event slug and no media id.

**Shipped.** The rule for whether a link opens lives in `lib/share-access.ts`, split from the queries in `lib/shares.ts` the same way `media-access.ts` is split from `media.ts`, and for an additional reason: the pure half is imported by client components, so it must not drag the database into a browser bundle. Four surfaces go through one gate (the page, the OG image, the content redirect, the download), because the way they stop agreeing is one of them growing its own copy, which is precisely what had happened to `media.visibility` before MED-1.

Decisions worth knowing:
- **The view cap is enforced inside a conditional `UPDATE ... RETURNING`.** Reading `view_count` and writing it back would let two concurrent opens of a one-view link both observe zero and both pass, and `neon-http` has no transactions, so this is not the tidy option but the only correct one. `test/shares.dbtest.ts` fires five simultaneous opens at a one-view link and asserts exactly one gets through. The read-then-write version was written deliberately and run against that test: it let two through.
- **The view is counted by a request from the loaded page, not while rendering it.** WhatsApp and iMessage fetch the page to build a preview, in a group chat potentially once per member. Counting at render time would spend a one-view link on a preview card before the recipient ever tapped it. Crawlers do not run JavaScript, so this is what separates a person looking from a chat app drawing a thumbnail. Two consequences accepted knowingly: a viewer with JavaScript off is never counted, and two simultaneous opens of the last view can both get in. **`max_views` is therefore a courtesy limit on how far a link travels, not a security boundary.** Revocation is the hard control, checked on every request with no caching anywhere.
- **The cap counts browsers, not page loads.** A viewer who spent a view keeps access, because the alternative is someone opening a one-view link, rotating their phone, and being locked out by their own reload. Carried in a signed per-share cookie that also holds the unlocked flag, keyed by share id so a cookie minted for one link is not accepted for another.
- **The gate deliberately does not consult `media.visibility`.** A host who creates a link for a hidden photo has said by that act that this token may see it. The link *is* the grant, which is what `link` visibility means.
- **The OG image is a resized copy, not the original.** Every client refuses a preview image above a size limit, and a phone photo off the camera is several megabytes, so pointing the tag at the original produced no preview at all. `/api/s/[token]/og` cover-crops to 1200x630 with sharp, and therefore needed its own `outputFileTracingIncludes` entry. See ARCHITECTURE.md constraint 7.
- **No surface is cached, the OG image included.** That route first shipped with `public, max-age=600`, on the reasoning that a crawler is anonymous and a chat preview cannot be recalled anyway. Production said otherwise: `x-vercel-cache: HIT`, `age: 42`, the CDN still serving the photo 42 seconds after revocation and willing to for ten minutes. Two different things had been run together. A preview already drawn into a thread genuinely cannot be recalled; our own edge continuing to serve the pixels afterwards is avoidable, so it is avoided.
- **A password-protected link previews as nothing.** Crawlers carry no cookies, so the gate refuses and the OG route 404s. Putting the photo in a group chat thumbnail would defeat the password entirely.
- **Downloads default to off**, and are a separate permission from viewing. Sharing a photo to be looked at is not agreeing to it being saved, reposted and outliving the link.
- **Album and event scope are not built.** The columns and the CHECK constraint exist from migration `0011`, and the create route only mints `media` scope. Album links want folders (MED-4) and a selection link wants bulk operations (MED-5), so building them now would mean guessing at both.

### MED-3. Access management UI
**DONE 2026-10-03.** **Size:** M. This is "ability to modify access".

A share sheet per photo, reachable from the dashboard tile and from the lightbox, listing every link on that photo with its settings, state, open count, a revoke button and a settings editor. An event-level **Links** tab lists every link across the event with the photo it points at, filtered to live ones by default.

**Shipped.** Both surfaces share `useShareLinks` and `ShareLinkRow`, so the two cannot describe the same link differently, which for a screen whose job is answering "did I turn that off?" would be the whole failure.

Decisions worth knowing:
- **Nothing here is optimistic**, which is a deliberate exception to how the rest of this dashboard works. Elsewhere a failed optimistic update is a wrong label for a second; here a link shown as turned off while the server still has it live is a photo the host believes is unreachable and is not.
- **The share button uses `navigator.share` before the clipboard.** On a phone that opens the real OS sheet, which is how one of these links actually reaches WhatsApp: the host is standing at the event, not sitting at a desk pasting URLs. A blocked clipboard says so rather than failing silently, with the link left selectable beside it.
- **The settings editor shows "leave as is" rather than the current value.** Raising an open limit resets the spent count on the server, so a form pre-filled with the current limit would hand the views back whenever somebody only meant to toggle downloads.
- **Revoking is final and cannot be edited back to life.** A host who wants it working again creates a new link, which leaves the revocation on the record, where it is the thing `revoked_at` exists to show.
- **`shares.manage` is a new capability, owner and manager only.** A moderator cannot add a co-host, so they must not be able to grant the same access by sending the photo out directly. The dashboard page now resolves the actor rather than a bare session, because the old coarse check counted a moderator as a manager.
- **The sheet says plainly that revoking does not unsend a preview** already drawn into a chat thread. It is the one thing about these links a host cannot undo, and finding out afterwards is worse.

Links are revoked, never deleted, so one organizer cannot quietly erase the evidence that a photo was shared.

### MED-4. Folders
**Size:** L. **Depends on:** F-3. This is "make folders".
Evolve `albums` rather than adding a parallel concept. Rename the user-facing label to "Folders", keep the table name.
- Add `albums.parent_id` self-referencing FK, `albums.position` integer, `albums.cover_media_id`, `albums.kind` (`manual | smart`), `albums.query` jsonb for smart folders (AI-4).
- Cap nesting at 3 levels and enforce it server-side with a recursive CTE check so a cycle is impossible.
- Media stays in one folder (`media.album_id`). Many-to-many is tempting and almost always the wrong call for a photo app; if a photo needs to be in two places, that is what smart folders are for.
- UI: breadcrumb navigation, drag to move, multi-select move, folder covers, counts per folder, and an "Unfiled" pseudo-folder.
- Guest gallery gets folder tabs when the event has more than one folder, which is how folders earn their keep.

### MED-5. Bulk operations
**DONE 2026-10-08** (`app/api/events/[id]/media/bulk/route.ts`, `test/bulk.dbtest.ts`), except the selection share link, which waits on album-scope shares. The selection bar gains an actions menu: hide, show, link only, move to a folder, reject, delete. One statement per action, scoped to the event in the WHERE clause so foreign ids match nothing, with the same capabilities as the single-photo controls; held photos are skipped and the bar says how many could not change. Delete is the soft delete with an Undo toast, which restores the same ids and puts them back on screen without a reload; the trash still holds them for 30 days after. Download of a selection already existed and now uses MED-7 above 400 MB.

**Size:** M. **Depends on:** MED-1, MED-4.
Selection mode already partially exists in the dashboard grid. Extend to: set visibility, move to folder, approve or reject, delete, create one share link for the selection (as an ad-hoc album), download selection as ZIP. Operate in batches server-side with a progress response, and make delete undoable for 30 seconds before the R2 objects are actually removed.

### MED-6. Uploader self-service
**DONE 2026-10-08**, without waiting on ACC-5: the per-event guest cookie already proves who uploaded what. A guest's own uploads carry a delete control in the lightbox, and the gallery footer offers "Remove everything I added". Both **erase** rather than soft-delete, because a soft delete would land in the host's trash where the host could restore it, turning "delete my photo" into a request. Prepared ZIPs containing the photo go with it. This was also a live mismatch with the Privacy Policy, which already promised guests they could delete their own uploads.

**Size:** S. **Depends on:** ACC-5.
A guest can delete or hide their own upload from the guest gallery. Non-negotiable for consent, currently impossible.

### MED-7. Export improvements
**DONE 2026-10-08** (`drizzle/0019_exports.sql`, `lib/exports.ts`, `lib/job-handlers/export.ts`, `test/exports.dbtest.ts`). Galleries over 400 MB, and selections over it, are packed in the background: one `export.part` job per ZIP part streams photos out of R2, through archiver, and back into R2 with a multipart upload, so no byte crosses the organizer's connection until they choose to download. Parts download from storage through a route that re-checks `media.exportAll` on every click and hands out an hour's link. The organizer is emailed when it is ready, at a link to the dashboard rather than to the files. Exports last 7 days; a daily job deletes them, fails any stuck building for a day, and sweeps anything under `exports/` older than that with or without a row. Erasure deletes an event's exports outright. The backup sweep now copies only `events/`, so exports are never backed up.

The streamed ZIP stays for anything at or under 400 MB, which is most events, because it starts instantly. **Why the cut-over matters:** a streamed 1.8 GB part had to reach the browser inside one function's five minutes, which on ordinary home broadband it could not, so large galleries failed part way through. Folder export is in the API (`albumId`) and waits on MED-4 for its button. "Originals versus web-size" is moot: Klik stores only the re-encoded photo.

**Size:** M. **Depends on:** F-5.
The current ZIP route streams inline and 413s above 2 GB. Move large exports to a job that writes a ZIP to R2 and emails a signed link that expires in 48 hours. Keep the inline path for small events. Add "export by folder" and "export originals versus web-size".

### MED-8. Strip EXIF and GPS from stored media
**Size:** S. **Promoted from NEW-10 on 2026-09-30.** Do this early; it is a live leak, not a feature.
**Scope corrected 2026-10-01 after reading the code properly. It is narrower than I first described.** `sharp` drops metadata unless you call `.withMetadata()`, and the pipeline does not, so photos that go through the server compression pass are already stripped and `.rotate()` already bakes in orientation. Client-compressed photos go through a canvas re-encode, which also strips. Most photos are therefore already clean.

Three real gaps remain:
1. **The compression fallback.** When the pass throws (a HEIC convert failure, a corrupt file, a timeout) the `catch` stores the original **untouched, with full EXIF including GPS**. It is a narrow path, but it is exactly the path an unusual file takes, and it fails open.
2. **Videos are never touched at all.** QuickTime and MP4 store location in a `©xyz` atom and `sharp` cannot help. This is the bigger leak now, and it needs ffmpeg, which means it rides along with OPS-1's transcode job rather than being fixed alone.
3. **`DateTimeOriginal` is being thrown away.** AI-1 needs capture time for its moment clustering, and the current pass discards it with everything else. It has to be read and stored on the `media` row *before* stripping, or that feature quietly has nothing to work with.
**DONE 2026-10-01 for gaps 1 and 3.** Gap 2 (video) stays open and rides with OPS-1.

- `lib/exif.ts` reads `DateTimeOriginal` and nothing else. Hand-written rather than a dependency, because the same code has to run server-side over a Buffer from R2 and in the browser over the original `File`, before the canvas compression pass destroys it.
- `media.captured_at` is a **zone-less** `timestamp` (migration `0009`). EXIF carries no offset, so storing an instant would mean inventing one. Null means "we do not know" and is deliberately not backfilled from `created_at`: upload time is a different fact the row already records, and copying it across would turn an honest gap into a confident wrong answer that AI-1 would then cluster on.
- **The fallback is closed, and the rule is now "we store only bytes we produced."** `sanitizePhoto` tries the normal pass, then retries with `failOn: "none"` and without mozjpeg, which measurably rescues a truncated file the strict pass throws on (verified: strict threw, lenient decoded). If both fail, the upload is rejected with a 422 and the object is deleted. A failed HEIC convert and a failed `PutObject` now take the same path, where both previously left the original in place.
- **This is a behaviour change**: a photo that cannot be decoded is now refused rather than stored intact. That is a worse upload experience and a much better privacy guarantee, and it was the right way round because the bytes a camera produces carry GPS, a device serial and often the owner's name, into a gallery whose whole purpose is a shareable link.
- **HEIC keeps no capture time.** Its metadata lives in an ISO base media container, not a JPEG APP1 segment, and `heic-convert` does not carry EXIF across. iPhone photos fall back to upload time until OPS-1 puts a real decoder in the pipeline. Documented in `lib/exif.ts` rather than left to be rediscovered.

Still open here:
- **Videos.** QuickTime and MP4 store location in a `©xyz` atom and `sharp` cannot help. This is now the only remaining leak, and it needs ffmpeg, so it rides with OPS-1.
- Add an organizer setting "keep full photo metadata", default off, for the professional-photographer case where EXIF is part of the deliverable.

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
**CUT 2026-10-08.** Decided in Section C: no face grouping. Kept below as the record of why it is expensive, which is what anyone reconsidering it needs to read first.

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
**DONE 2026-10-08** (`drizzle/0023_slugs.sql`, `lib/slugs.ts`, `test/slugs.dbtest.ts`). `events.slug` stays the current address and `event_slugs` holds every former one, all of which keep serving the gallery directly (no redirect) with a canonical link to the current address. **No address is ever released**: when an event is deleted, a trigger turns all its addresses into hashed `slug_reservations` (hashed, so an erasure does not leave "anna-and-leo" in plain text), and triggers on both tables refuse any address in use or reserved. Changing an address is one statement, so the old one is never briefly free. Custom addresses on Premium and Venue, from settings, which lists the old addresses that still work. The reserved-word list lives in `lib/slugs.ts` until ID-1 shares one.

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
**DONE 2026-10-08** (`lib/qr-style.ts`). Classic, dots and rounded, drawn as SVG from the code's own module matrix in the event's accent when it has the contrast a camera needs (otherwise dark on white). **Every styled code is decoded with jsQR before it is served**, and one that does not decode is replaced by the classic code. That guard earned its place immediately: the first dot and rounded designs did not decode, and keeping the code's structural modules (timing, alignment, format) square fixed it, verified across three URLs at four sizes. No logo yet, which would need an upload path for brand assets.

**Size:** M.
Replace the plain `qrcode` render for display purposes with a styled renderer: rounded or dot modules, custom module and background colour drawn from the event's accent colour, optional logo in the centre, optional frame with a call-to-action caption ("Scan to share your photos").
- Use error correction level H whenever a logo is overlaid, and cap logo coverage at 20 percent of the code area.
- **Verify scannability programmatically.** Decode the rendered PNG with `jsqr` in a test before any download is allowed. A pretty QR that does not scan is worse than an ugly one that does, and this failure mode is common with styling libraries.
- Keep the plain high-contrast version as the default and as a one-click fallback.

### QR-3. Share the QR properly
**DONE 2026-10-08.** "Share QR code" sends the image itself through the phone's share sheet (straight into a WhatsApp group), with a download fallback; prefilled WhatsApp, Messages and email links; and a 1080x1920 story image. The story and the printable sign are now **drawn in the browser** (`lib/qr-compose.ts`) with the page's own Fraunces and Geist, because the server-rendered sign depended on fonts a Vercel function does not have. Not done: a short link, and the "add to home screen" card.

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
**DONE 2026-10-08** (`drizzle/0022_disposable.sql`, `lib/disposable.ts`, `test/disposable.dbtest.ts`). A setting on any plan: shots per guest (default 24) and a develop time. Decisions on the open questions below: the **host sees everything before developing** (they moderate); a guest sees nothing, their own shots included, until then; **uploads after developing appear immediately**; a guest **cannot pick from their camera roll**, only shoot; top-ups are not built. Development is **compared at read time** in `lib/media-access.ts` (`rollUndeveloped`), not flipped by a job, so it is exact on Hobby, and the changes endpoint tells every phone to start over when the moment passes. A shot is spent by one conditional update at registration, tested with five uploads racing for the last frame. The camera gets a frame counter instead of a review tray, photo mode only, and a synthesized wind-on sound. "Develop now" in settings sets the time to the present.

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
**DONE 2026-10-08** (`lib/insights.ts`, `components/dashboard/insights-panel.tsx`). An Insights tab on every live event: photos and videos shared as the one hero number; gallery opens, guests joined, guests who shared and share-link opens as tiles; uploads by hour (by day past three days) as a single-series column chart with the quiet hours filled in, hover and keyboard tooltips and a table view; and the five guests who shared most. Gallery opens are a new counter (`events.gallery_opens`), bumped after the page is sent and never for the event's own team; everything else is counted from existing rows. QR scans are not distinguished from other opens, which would need a tagged URL on the sign.

**Size:** M. QR scans over time, uploads per hour, unique contributors, top contributors, gallery views, share link clicks. Answers "was this worth $89" and justifies renewal for venues.

---

## Phase VEN: Venue surfaces

### VEN-1. Live venue display
**DONE 2026-10-08** (`app/e/[slug]/live/page.tsx`, `components/live/live-display.tsx`). Opened from the event page by its team on a Premium or Venue live event; never by a guest, because a screen in a room is a broadcast. It shows only what a guest would see, never hidden or private photos, even though whoever opened it could. Photos crossfade every 7 seconds, new uploads join after a 60-second delay so a host can pull one before it is ten feet tall, and removals or hides leave the screen within one poll via the changes endpoint. A QR code in the corner says "Scan to add yours". It holds a screen wake lock, hides the cursor and controls when idle, refreshes its signed URLs every 10 minutes for an all-night run, and turns its fade off for reduced motion. Videos show their poster still.

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
**DONE 2026-10-08** (`lib/upload-parts.ts`, `lib/multipart-client.ts`, `app/api/upload/complete/route.ts`). Files over 32 MB, which in practice means video, go up as 8 MB parts, three at a time. Each part URL binds its exact length, so the plan's size check still holds (verified against R2: an oversized part is refused with a 403). A failed part retries on its own with backoff, and while the phone reports itself offline it waits up to five minutes for the connection instead of spending its attempts. The server joins the parts using R2's own list of them rather than ETags from the browser, which a browser can read only if the bucket's CORS rule exposes them, and refuses to join unless every part is present at exactly the expected length. An abandoned upload is aborted by R2's default lifecycle rule after seven days.

Not done: resuming across a page reload, which is OPS-3's territory.

**Size:** M. R2 supports S3 multipart. A 200 MB video that fails at 90 percent currently restarts. Chunk and resume.

### OPS-4. Move the media bucket to a US jurisdiction
**Size:** S today, L after launch. **Do this before anything else in the plan.**

> **IN PROGRESS 2026-10-07. The bytes have moved; production has not.**
> `klik-media-us` and `klik-media-backup` exist, both unpinned (jurisdiction
> `default`) with an ENAM location hint, and all 12 objects are copied and
> verified against the source by count, total size and content type. `.env.local`
> points at the new bucket and a signed read through the app's own code path
> returns 200.
>
> **Still to do:** the four Vercel variables (`R2_BUCKET_NAME`, `R2_ENDPOINT`,
> `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) in both Production and Preview,
> then a redeploy, then re-run `scripts/copy-bucket.mjs` to sweep up anything
> uploaded during the window. `klik-media` is untouched and still serving
> production, so there is no hurry and no broken state to fix.
>
> **Note on "US jurisdiction", which this task's title gets slightly wrong.**
> R2 does offer a `us` jurisdiction, and it was not used. A jurisdiction is a
> residency guarantee that pins the data and cannot be undone, which is the
> exact property that made the EU setting expensive. The new buckets take a
> location hint instead: same placement, no lock. If a customer ever requires
> contractual US residency, a pinned bucket can be created for them then.
>
> **The custom domain and the caching half are deliberately not done.** See the
> paragraph below about signed cookies: attaching `media.klik.kreativvantage.com`
> as a plain public domain would hand out permanent unrevocable URLs for private
> galleries, which is a regression, not a step forward.
`klik-media` was created as an EU-jurisdiction R2 bucket, which is why `lib/storage.ts` has to use the `.eu.` endpoint. For a US-only product every upload and every video playback crosses the Atlantic, which hurts exactly the 200 MB 4K case OPS-1 is about.

**Jurisdiction is fixed at bucket creation and cannot be changed**, so this means a new bucket plus a migration. Right now that is 12 objects. After launch it is a migration project with downtime, which is why this sits at the top of the build order despite being nobody's idea of exciting work.

**EXPANDED 2026-09-30, then NARROWED 2026-10-07.** The caching half was folded in here on the reasoning that it is the same question ("how do bytes reach the viewer") and the same cutover. **The custom domain and the caching are now rejected outright, and this task is the bucket move alone.**

The reason is that a cached response never reaches the route that authorizes it, and five live controls depend on being asked every time: revocation, view caps, per-media visibility, trash, and retention. The full argument is in `ARCHITECTURE.md` section 8, which is where it belongs, because it is a property of the system rather than a step in a migration. The latency problem this clause existed to solve was solved by the bucket move itself: storage round trips went from 437ms to 104ms.

**Do not "finish" this task by attaching `media.klik.kreativvantage.com` to the bucket.** That would hand out permanent, unrevocable URLs for private galleries and would silently break MED-2's revocable share links. `R2_PUBLIC_URL` and the `remotePatterns` entry that pointed at that hostname were removed on 2026-10-07 so the half-built invitation is gone.

Steps: create `klik-media-us` with a US jurisdiction; ~~create `klik-media-backup` beside it, with the app's token scoped to the primary bucket only and a copy step writing every new object across~~ **DONE 2026-10-08**, though not as written: the app's token does reach the backup, and what makes the backup safe is Bucket Lock rather than token scope, which holds even if that token leaks. `lib/backup.ts` and the 02:00 sweep, with the reasoning in `ARCHITECTURE.md` section 7; copy existing objects with `rclone` or a short script; ~~attach the custom domain; switch public-gallery delivery to signed cookies~~ **both rejected 2026-10-07, see above**; **copy the CORS policy onto the new bucket, which does not travel with the objects and whose absence breaks every upload while leaving the gallery working**; flip `R2_BUCKET_NAME` and set `R2_ENDPOINT`; verify a full upload and playback round trip; delete the old bucket once nothing references it. `blob_pathname` is bucket-relative, so no database change is needed.

**Superseded 2026-10-07: everything stays on signed URLs, so there is no split to get right.** This paragraph was correct about the danger and wrong about the remedy. It assumed the public/private line could be drawn per gallery, but `canViewMedia` decides per object, so a public gallery can contain hidden photos and the split it describes does not exist at the granularity it assumes.

### OPS-3. Offline upload queue
**Size:** L. Venue wifi is reliably bad. A service worker queues uploads with IndexedDB and drains them when connectivity returns, with a visible queue state. Turns the worst real-world failure into a non-event.

---

## Phase TRS: Trust, safety, and compliance

### TRS-1. Guest reporting
**DONE 2026-10-08** (`drizzle/0020_reports.sql`, `lib/reports.ts`, `test/reports.dbtest.ts`). A flag in the lightbox, eight reasons, one report per person per photo. Three different reporters hide a photo until the host looks. A **child-safety** report hides it from everyone, sets `media.legal_hold_at`, and emails `ALERT_EMAIL` as urgent; while held, the purge, erasure and the uploader's own delete all leave it alone, because 18 U.S.C. 2258A requires a provider that reports such material to preserve it, and the Terms promise it is "reported rather than merely removed". Hosts see reported tiles and can keep a photo or delete it, but cannot touch a held one. `/admin` has the queue (the start of ADM-5) with keep, remove, release, and "reported to NCMEC, keep held". Copyright reports point to the DMCA notice process, which a button cannot stand in for.

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

## Answered (2026-10-08)

Asked when the launch deadline was lifted and the goal became finishing the whole plan.

### Vercel plan: Hobby. ANSWERED
Hobby allows cron once a day and functions of at most 300 seconds on 1 vCPU. F-5 was built so the enqueue triggers the work and the daily cron is only a backstop, which works on either plan. **Worth knowing:** Vercel licenses Hobby for non-commercial use only, so a paid Klik belongs on Pro, and on Pro the job cron becomes per-minute by changing one line in `vercel.json`. Tracked in `LAUNCH.md`.

### Payments keep human approval. ANSWERED
A Stripe payment records money and grants nothing; a superadmin activates. This keeps `BILLING.md`'s rule exactly as it is. ACT-1 still builds the entitlement ledger, because per-event grants, revocation, and an honest record of who granted what all need it, but no webhook writes a `stripe` grant. The ledger keeps the `source` column so automating it later is one handler, not a redesign.

### Video: Cloudflare Stream. ANSWERED
OPS-1 transcodes through Stream rather than ffmpeg in a function. Hobby's 300 seconds, one vCPU and 500 MB of `/tmp` are the wrong shape for a 500 MB 4K original, and Stream is in the Cloudflare account that already holds the bucket. Playback uses Stream's signed tokens, which fits the per-request authorization model in ARCHITECTURE.md section 8. The original stays in R2 for download and export.

### Face grouping: skipped. ANSWERED
AI-3a and AI-3b are cut. Every other AI task stands. AI-4 smart folders and AI-8 highlights fall back to time, scene labels and similarity, which is what AI-3's own note said covers most of the value. Reversible later, but only with counsel, for the BIPA reasons written in AI-3.

## Still open

Nothing is blocking. The open items below are judgement calls that can wait until the relevant phase starts.

- **GRW-2 music licensing.** Needs a cleared or CC0 audio library before a highlight reel ships publicly.

---

## v1 scope, jurisdiction, and build order (decided 2026-09-30)

### The v1 line

**v1 is: admin-activated events, no payments, no AI.** Phases SEC, F, LAW, ACT, MED, QR, ACC.

**Payments deferred (decided 2026-10-01).** An organizer creates an event; it stays inactive until a **superadmin activates it from the admin dashboard**, which is close to how the business already runs. Stripe (PAY-2 onward) moves out of v1 entirely.

This is a better sequence than it might look. Activation still needs the entitlement model underneath it (ACT-1, formerly PAY-1), because "who is allowed what" has to be answered the same way whether a human or a webhook grants it. Building that against a human grant first means Stripe later becomes a second **source** writing to a ledger that already exists and is already proven, rather than a rewrite of how capability works. It also takes LAW-1 off the critical path for launch, since you are not taking card payments yet, though it stays in v1 because you are still hosting user photos. The product already works; v1 makes it sellable. Phases AI, GRW, VEN, OPS and TRS come after revenue exists.

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
1. ~~Set `APP_URL`~~ done in code 2026-09-30 (`https://klik.kreativvantage.com`); still needs setting in Vercel, see the runbook below
2. **MED-8** metadata handling, at its corrected narrower scope
3. **F-7** test harness. **Moved up from Block 1 on 2026-10-01.** ACT-1 rewrites how every capability check resolves, on top of six migrations that went to production with nothing behind them. Doing that with no tests is how an authorization bug ships quietly.
4. **F-1** rewrite ARCHITECTURE.md (**F-6** done 2026-09-30)
5. **LAW-2** register the DMCA agent (an afternoon, and safe harbor is not retroactive)

**Block 0.5, the delivery cutover, before real traffic**
5. **OPS-4** US bucket **plus** custom domain **plus** signed-cookie caching, as one migration (decided 2026-09-30)

**Block 1, the floor under activation**
6. **F-3** permissions resolver, **F-4** usage accounting (**F-7** moved into Block 0)

**Block 2, activation (replaces the old payments block)**
7. **ACT-1** entitlement ledger. This is the migration that retires `users.plan_key`, so re-read SEC-1 **and** architecture note 2 first: the plpgsql plan-limit triggers read that column directly and must be resolved here, not later.
8. **ACT-2** admin activation surface, **ACT-3** the organizer's inactive-event experience
9. ~~**F-8** transactional email~~ **DONE 2026-10-06**, **F-5** job runner, then **ACT-4** the activation request queue

**You could stop here and run the business by hand, which is the plan.** As of 2026-10-07 you genuinely can, and that is a change from when this line was written. Signup takes the money through a Payment Link, assigning a plan on `/admin` grants capability and emails the organizer their dashboard link and the steps, and `account_timeline` keeps the record of who granted what and whether the mail landed. What the rest of ACT adds is a ledger a webhook may write to, per-event scope instead of per-account, and a queue instead of a WhatsApp message.

**Block 3, the product itself**
10. **ACC-1** through **ACC-5** guest accounts and signup
11. ~~**MED-1**, **MED-2**, **MED-3** per-photo visibility, share links, access management~~ **DONE 2026-10-03**
12. **MED-4**, **MED-5** folders and bulk operations

**Block 4, the differentiator**
13. **QR-1**, **QR-2**, **QR-3** slugs, styling, sharing
14. **QR-4a** through **QR-4f** the print studio
15. **F-2** remaining rate limits, **F-9** error tracking
16. **LAW-1** terms and privacy policy, **LAW-4** venue curation

**v1.1:** ID-1 through ID-3, then ORG-1 through ORG-4.
**Later:** Phase PAY, when activating events by hand stops being worth the time.

### Credentials and setup

**Recommendation on sequencing: build first, with two exceptions.** Almost everything in v1 is testable without external services, and code written against a clean interface does not need refactoring when a key arrives. The exceptions are things where the *shape* of the integration is decided by the provider, and those are worth settling now so nothing gets rebuilt: **Resend** (because ACC-2's whole signup flow is email codes, and it is untestable without a key) and the **R2 bucket plus custom domain** (because jurisdiction is fixed at bucket creation and cannot be changed later).

Stripe is no longer needed at all for v1.

#### 1. Resend, needed for Block 2 onward

**Get it:** resend.com, add a domain, choose a **subdomain** such as `mail.klik.kreativvantage.com` rather than the root. A deliverability problem on a subdomain never damages the root domain's sending reputation, and you cannot undo that mistake quickly. Add the DKIM, SPF and DMARC records it gives you to Cloudflare DNS, wait for verification, then create an API key scoped to **sending only**.

```
AUTH_RESEND_KEY=re_...
AUTH_EMAIL_FROM="Klik <no-reply@mail.klik.kreativvantage.com>"
```

**Already fixed for you:** the sender was hard-coded to `no-reply@klik.app`, a domain this project does not own. Resend refuses unverified domains, so every sign-in email would have failed the moment a key was added, and it would have looked like a bad key rather than a bad sender. It is now `AUTH_EMAIL_FROM`.

**The gotcha that costs a week:** send nothing from a brand-new domain in volume on day one. Warm it gradually, and set up DMARC in monitoring mode (`p=none`) before anything stricter, or you will be debugging deliverability at the same time as debugging the signup flow.

#### 2. Cloudflare R2, a US bucket plus a custom domain (OPS-4)

**Get it:** in the existing Cloudflare account, create a new bucket with a **US jurisdiction** (or none). Jurisdiction is set at creation and cannot be changed, which is the whole reason this is not deferrable indefinitely. Then attach `media.klik.kreativvantage.com` as a custom domain to it, which requires the zone to be on Cloudflare (it is, since the app domain is there).

```
R2_BUCKET_NAME=klik-media-us
```

`next.config.ts` already lists that hostname in `remotePatterns`, so this was always the intent.

**Create a second bucket in the same step: `klik-media-backup`, also US.** An earlier version of this file told you to enable object versioning here. That was wrong, and corrected on 2026-10-01: **R2 has no object versioning.** See the data-loss note for what was checked and why Bucket Lock, the nearest feature, breaks both the rejected-upload cleanup and the erasure path.

The protection is structural instead. The app's R2 token is scoped to the primary bucket only, a copy step writes each new object into the backup bucket, and nothing the app can reach can delete from it. A bug in erasure or purge then cannot destroy the only copy, and a genuine erasure request becomes a deliberate two-step action, which is what it should have been anyway.

#### 3. Sentry, for F-9

**Get it:** sentry.io, free tier is enough, create a **Next.js** project. You need the DSN (safe to expose, it is in client bundles by design) and, for readable stack traces, an auth token for source map upload.

```
SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=...
```

**Why it matters more than it sounds:** right now nothing tells you when something breaks. A 500 on the upload path at a Saturday wedding surfaces as a support email on Monday, if at all. Alert specifically on the cron route and, later, the Stripe webhook, because both fail silently by nature.

#### 4. Google OAuth, optional

**Get it:** Google Cloud Console, OAuth consent screen (External, no sensitive scopes so no verification review), then credentials.

Authorised redirect URI, exactly: `https://klik.kreativvantage.com/api/auth/callback/google`, plus `http://localhost:3000/api/auth/callback/google` for local work.

```
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

Genuinely optional. Resend alone makes signup work, and this is a conversion improvement rather than a dependency.

#### 5. Vercel, already yours

Set **every** variable in Project Settings, not only `.env.local`, and redeploy. A variable added without a redeploy does not reach the running build. `APP_URL` especially: without it `lib/env.ts` falls back to the ambient deployment URL, which produces QR codes that scan today and 404 once that deployment is superseded.

Also set `CRON_SECRET`, or the purge route is open to anyone who finds it.

#### 6. Not an API, but on the critical path

**DMCA agent registration (LAW-2).** dmca.copyright.gov, a small fee, renewable every three years. Safe harbor is **not retroactive**, so every day unregistered is a day of uncovered exposure for photos guests upload. An afternoon.

**Neon.** Confirm your plan's point-in-time-restore window and then actually test a restore into a branch. An untested backup is a belief, not a backup. Also create a second branch as **staging**: six migrations have now gone straight to the only database that exists, which was fine at 12 rows and stops being fine the day a real customer's event is in there.

### Setup runbook, in order, click by click

Four things need a browser. This order matters: Resend first because DNS has to propagate while other work happens, Vercel second because the purge cron has been failing closed without it, then Neon, then the DMCA filing whenever there is an afternoon.

#### Step 1. Resend, about 20 minutes plus propagation

1. Sign up at resend.com with an account that will own production email long term. Moving a verified domain between Resend accounts means verifying it again.
2. **Domains, then Add Domain.** Enter `mail.klik.kreativvantage.com` and pick the **US region**, matching the product's jurisdiction. Not the root `klik.kreativvantage.com`: a subdomain keeps a deliverability problem away from the root domain's sending reputation, and that is not a mistake you can undo quickly.
3. Resend shows three or four DNS records. Open a second tab on **Cloudflare, the `kreativvantage.com` zone, DNS, Records**, and add each one. The shape is:
   - `MX` on `send.mail.klik`, pointing at a `feedback-smtp.<region>.amazonses.com` host, priority 10
   - `TXT` on `send.mail.klik`, value `v=spf1 include:amazonses.com ~all`
   - `TXT` on `resend._domainkey.mail.klik`, value the long `p=MIGf...` public key
   - `TXT` on `_dmarc.mail.klik`, value `v=DMARC1; p=none;`

   Copy the real values from the Resend page, not from here. The MX host and the DKIM key differ per account and per region.
4. **The Cloudflare gotcha that wastes an hour.** Cloudflare appends the zone name to whatever goes in the Name field, and Resend displays fully qualified hostnames. Pasting `send.mail.klik.kreativvantage.com` produces `send.mail.klik.kreativvantage.com.kreativvantage.com`. Type only the part before `.kreativvantage.com`, then read the saved record list back and confirm the names are what you intended.
5. Back in Resend, **Verify DNS Records**. On Cloudflare this is usually minutes. When it stalls, the cause is almost always a doubled name from step 4.
6. **API Keys, then Create API Key.** Permission **Sending access**, restricted to this domain. Copy the `re_...` value immediately; it is shown once.
7. Record both values, for `.env.local` now and Vercel in step 2:

```
AUTH_RESEND_KEY=re_...
AUTH_EMAIL_FROM="Klik <no-reply@mail.klik.kreativvantage.com>"
```

8. Leave DMARC at `p=none` until sign-in emails have been landing reliably for a few weeks. Tightening it early means debugging deliverability and the signup flow at the same time, and they look identical from the outside.

#### Step 2. Vercel environment, about 10 minutes

1. Generate a cron secret locally: `openssl rand -base64 32`.
2. **Vercel, the Klik project, Settings, Environment Variables.** Add for Production and Preview:
   - `APP_URL` = `https://klik.kreativvantage.com`
   - `CRON_SECRET` = the value from step 1
   - `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` from the Resend step
3. Confirm `DATABASE_URL`, `AUTH_SECRET` and the four `R2_*` variables are already present. `lib/env.ts` parses at module load, so a missing one now fails the build rather than a guest's request, which is the entire point of F-6.
4. **Deployments, the latest one, Redeploy.** A variable added without a redeploy does not reach the running build.
5. Then open **Settings, Cron Jobs** and look at the last run. `isAuthorized` in `app/api/cron/purge-expired/route.ts` returns false whenever `CRON_SECRET` is unset, so every nightly run to date has returned 401 and nothing has ever been purged. That was the correct failure mode, but it means the purge path has never executed in production. The first run after this redeploy is its first real exercise, so check the response rather than assuming.

#### Step 3. Neon, about 30 minutes

1. **Neon console, the project, Settings, Storage**, and read the actual **history retention** window. The free tier is short. Write the number down: it is the real answer to "how far back can we recover", and until it is written down that answer is a guess.
2. **Branches, New Branch.** Name it `staging`, from `production` at the current timestamp. Put its connection string into a Preview-scoped `DATABASE_URL` in Vercel, so preview deployments and future migrations stop landing on the only database that exists. Eight migrations have now gone straight to production. That was fine at 12 media rows.
3. **Test a restore, once, now.** Create a throwaway branch from a timestamp an hour in the past, connect with `psql`, and run `select count(*) from media;`. A plausible count means point-in-time restore is real. Delete the branch afterwards. An untested backup is a belief, not a backup.

#### Step 4. DMCA agent, an afternoon

1. dmca.copyright.gov, create an account for the service provider rather than for yourself personally.
2. Designate an agent: the provider's legal name plus any alternate names the service is known by (include `Klik`), a physical address, a phone number, and an email address somebody actually reads.
3. Pay the fee. It is small, and the registration needs renewing every three years or it lapses.
4. Safe harbor is **not retroactive**, which is why this is not deferrable: every day unregistered is a day of uncovered exposure for photos guests upload. The agent's contact details also have to be published on the site, which is the code half of LAW-2.

#### Step 5. Uptime and heartbeat monitors, about 15 minutes

**Why this one is first among what is left.** Every other gap on the list is something that might go wrong. This one is the reason you would not find out. The marketing page is static, so it returns 200 with the database on fire; monitoring it proves Vercel is up, not that Klik works.

Two monitors, and they catch different failures.

**5a. The health monitor, catches "it is broken".**

1. Sign up at uptimerobot.com. The free tier covers 50 monitors at a 5-minute interval, which is more than enough. Better Stack is the nicer product if you would rather pay later; the setup below is the same shape.
2. **New monitor**, type **HTTPS**.
3. URL: `https://klik.kreativvantage.com/api/health`
4. Interval: **5 minutes**. Do not go below 1 minute: the endpoint caches for 30 seconds, so faster polling returns the same answer while still costing you a function invocation.
5. Alert contacts: an email you actually read, and a phone number if the service allows it on your tier. An alert nobody sees is the same as no alert.
6. Nothing else needs configuring. The endpoint returns **503** when the database or R2 is unreachable, so a plain status check already catches it.
7. Optional, as insurance against a future code change: make it a **Keyword** monitor instead, with keyword `"ok":true` and "alert when keyword not present". That still fires if someone later makes the route return 200 unconditionally.

**5b. The heartbeat monitor, catches "it silently stopped".**

This is the one people skip, and it covers the failure a nightly job is most likely to have. A cron that stops firing produces no logs, no errors and no alert. It looks exactly like a quiet night, for weeks.

1. In UptimeRobot, **New monitor**, type **Heartbeat** (Better Stack calls these **Heartbeats**; Healthchecks.io does only this and is free).
2. Name it "Klik nightly purge".
3. Expected period: **1 day**. Grace: **2 hours**. The cron runs at 03:00 UTC, so this alerts if a run is ever missed rather than the moment it is a minute late.
4. Copy the URL it gives you.
5. In **Vercel, Settings, Environment Variables**, add `CRON_HEARTBEAT_URL` with that URL, Production only, then redeploy.
6. The cron pings it **after** a successful run, never before, so a heartbeat means the work actually happened rather than that the function started. A monitor being unreachable is logged and ignored rather than failing the purge.

#### Step 6. Sentry, about 20 minutes, whenever you are ready

Not urgent now that structured logging and `/api/health` exist. What Sentry adds on top is stack traces with the request context attached, and grouping, so twenty occurrences of one bug read as one problem.

1. sentry.io, sign up, **Create project**, platform **Next.js**. Name it `klik`.
2. It shows a **DSN** immediately, of the shape `https://<key>@o<org>.ingest.sentry.io/<project>`. That value is safe to expose, it ships in client bundles by design.
3. For readable stack traces you also want source map upload, which needs three more values: **Settings, Auth Tokens, Create New Token** with the `project:releases` scope, plus your org slug and project slug.
4. Put all of it in `.env.local` and in Vercel:

```
SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=klik
```

5. Tell me they are there. `registerErrorReporter` in `lib/observability.ts` is the one seam it plugs into, so wiring it is a few lines rather than an import threaded through every route.
6. **Set up alert rules, or it is just a nicer log viewer.** At minimum, alert on any event named `purge.circuit_breaker_tripped`, and on the first occurrence of any new issue in the upload path. Both fail silently by nature.

#### Step 7. The Neon staging branch, about 20 minutes, and it unblocks me

This is the one that stops you being the bottleneck on every schema change.

1. **Neon console**, your project, **Branches**, **New branch**. Parent `production`, from the current timestamp, named `staging`.
2. Copy its pooled connection string.
3. In **Vercel, Settings, Environment Variables**, edit `DATABASE_URL` so the **Preview** scope uses the staging string. Production keeps pointing at production. Today Preview points at production, which means every preview deployment reads and writes live data.
4. While you are there, add `AUTH_SECRET` to the **Preview** scope with a **newly generated** value (`openssl rand -base64 32`), not a copy of production's. Preview deployments currently fail to boot at module load because it is missing, and a separate secret means a preview can never mint a token that production accepts.
5. **Test a restore once**, which is the only way an untested backup becomes a backup. Create a throwaway branch from a timestamp an hour in the past, connect with `psql`, run `select count(*) from media;`. A plausible count means point-in-time restore is real. Delete the branch.
6. Optionally create a **Neon API key** (Account settings, API keys) and put it in `.env.local` as `NEON_API_KEY`. With it I can create and drop branches myself, which means migrations get tested on a real copy before they reach you.

#### Deliberately not now

- **Do not create the US bucket yet.** OPS-4 is a single cutover: US bucket, backup bucket, object copy, custom domain, signed-cookie delivery, and removing the `.eu.` endpoint. Doing the bucket half early means running two buckets and migrating delivery twice.
- **Do not go looking for R2 object versioning.** It does not exist. See the corrected note above.
- **Stripe: takes money, grants nothing.** Embedded Checkout, a signed idempotent webhook and the PAY-2 tables shipped 2026-10-06, ahead of the deferral decision below. What is still deferred is automatic granting, which waits on ACT-1. A superadmin activates from `/admin` as before.
- **Sentry: when F-9 comes up**, not before. The DSN takes two minutes and all of its value is in alert rules that need the code first.

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
2. **Deletion from R2 is absolute, and there is no versioning to undo it.** Soft delete protects against a user mistake. It does not protect against a *bug* in the erasure or purge code, because those call `DeleteObjects` for real. If `eraseUser` ever selects the wrong rows, the objects are gone with no recovery path.

   **Corrected 2026-10-01.** This used to say "enable R2 object versioning", as though it were one toggle. **R2 has no object versioning.** Checked against Cloudflare's own API surface: an R2 bucket exposes CORS, lifecycle, lock, sippy, custom domains and event notifications, and nothing that keeps a version history. The nearest feature is **Bucket Lock**, which blocks deletes and overwrites for an age, until a date, or indefinitely, and it does not fit this codebase as a blanket rule for two concrete reasons. `app/api/e/[slug]/media/route.ts` deletes the object it just uploaded whenever validation rejects it, so an age-based lock would leave every rejected upload as a permanent orphan, silently, because those calls are `.catch(() => {})`. And `lib/erasure.ts` could not honour a deletion request for anything recent, which is the one deletion path that is legally required to work.

   The fix that does fit is structural: a **second bucket the application holds no credentials to delete from**. Folded into OPS-4, since that cutover is already creating buckets.
3. **No verified database backup.** Neon provides point-in-time restore on paid tiers, but nobody has confirmed the retention window or tested a restore. An untested backup is a belief, not a backup.
4. **No staging environment.** Migrations have been applied straight to the one database that exists. That was fine at 12 media rows and stops being fine the day a real customer's event is in there.
5. **The cron is unmonitored.** If `/api/cron/purge-expired` starts failing, or the circuit breaker trips every night, nothing says so. The breaker returns a 500 specifically so a monitor can catch it, once a monitor exists.
6. **No tests.** Still the honest gap. See F-7.

### What to do about it, cheapest first

- **Scope the R2 API token to the one bucket**, if it is currently account-wide. Two minutes, no code, and it caps what a leaked key or a wrong bucket name can reach. Real byte-level recovery needs the backup bucket in OPS-4; there is no toggle for it.
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
| 1 | ~~**Media delivery**~~ **FIXED 2026-10-08** | Every thumbnail was a Vercel invocation plus a Neon query plus an R2 signature plus a redirect. | Not the fix this row first named: the custom domain and edge caching were rejected (ARCHITECTURE.md section 8). Instead the gallery request signs a page of URLs at once, rounded to 15-minute windows so browsers cache them, and tiles load a ~480px thumbnail rather than a full photo. Fifty tiles went from fifty authorized round trips to one, and from about 75 MB to about 3 MB. |
| 2 | ~~**Gallery polling**~~ **FIXED 2026-10-08** | SWR polled a full keyset query every 8 seconds, about **1,500 requests a minute** at a 200-guest wedding, and only ever added rows. | `/media/changes` answers a quiet gallery from `events.media_changed_at`, kept by a trigger, with no media query at all. Phones back off to 60 seconds when nothing changes and pause in background tabs. It also fixed a real bug: a photo the host deleted or hid stayed on every guest's screen until they reloaded. |
| 3 | **Video playback** | Every viewer downloads the full original. One 200 MB 4K clip watched by 50 guests is 10 GB moved to play 15 seconds. Egress is free on R2, so this is a latency and experience problem, not a bill. | OPS-1 transcoding. Posters and duration caps (done) blunt it; they do not solve it. |
| 4 | ~~**ZIP export**~~ **FIXED 2026-10-08** | Streamed inline, so a large part had to download inside one function's 300s. | MED-7: over 400 MB is built into storage by the job queue and downloaded straight from R2, with an email when ready. |
| 5 | **Correctness under concurrency** | `neon-http` has no transactions, so multi-step deletes are not atomic. Load makes partial failures likelier, not rarer. | Architecture note 1, switch to the WebSocket `Pool`. |

**Indexing is handled** as of migration `0007`: partial indexes on the live-row predicates (`WHERE deleted_at IS NULL`) for the gallery, owner dashboards and album lists, and separate partial indexes on the trash predicates for the purge cron. Partial is the right shape for soft delete: the gallery never reads trashed rows, so excluding them keeps the index small and makes the predicate free rather than a post-scan filter.

**Fixed 2026-09-30:** bulk restore was one `UPDATE` per id, so restoring a 500-photo selection meant 500 sequential round trips to Neon, slow enough to blow the function timeout on exactly the bulk operation the endpoint exists for. Now one statement per table via `inArray`.

### Data loss prevention, honestly

| Layer | State |
|---|---|
| User mistake | Covered. 30-day soft delete everywhere, restore API built. |
| Retention misconfiguration | Covered. Pinned `retention_until`, circuit breaker, null means skip. |
| Bug in deletion code | **Covered 2026-10-08.** `klik-media-backup` holds a second copy, swept nightly at 02:00 by `lib/backup.ts`. Bucket Lock makes it immutable for 30 days, so the app cannot delete from it even with its own credentials, verified by a refused delete returning `ObjectLockedByBucketPolicy`. A lifecycle rule expires objects at 31 days, which is also why erasure now completes everywhere within 31 days rather than instantly. |
| **Database loss** | **Still unverified, and now the weakest layer.** Neon PITR depends on plan, and no restore has ever been tested. An untested backup is a belief. The media is protected as of 2026-10-08 and the database is not, so this is the one to close next. Tracked in `LAUNCH.md`. |
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

**RESOLVED 2026-10-08 by ACT-1.** The triggers read their limits from the grant row, which copies them from `lib/plans.ts`. One source.


`lib/plans.ts` defines limits in TypeScript. Migration `0002` also enforces them in **plpgsql triggers**, which hard-code `venue → 5, everything else → 1`. Two sources of truth, and the database one wins silently.

Right now they agree. They agree by coincidence. Change `maxActiveEvents` in `lib/plans.ts` and the trigger will keep enforcing the old number with a `P0001` exception that surfaces as a confusing 409. **PAY-1 makes this materially worse**, because the entitlement ledger moves plan resolution out of `users.plan_key` entirely, and the triggers read exactly that column.

**The decision to review:** either the triggers become the single source of truth and TypeScript only reports what they enforce, or they are dropped and enforcement moves fully into the application. Keeping both is the option that bites. PAY-1 has to resolve this, so decide before starting it, not during.

### 3. Every image view costs a function invocation and a database query

Media is delivered by redirecting to a signed R2 URL with a 60-second TTL and `Cache-Control: private, no-store`. Correct for privacy, and it means **nothing is ever cached anywhere**. Each thumbnail a guest scrolls past is a Vercel invocation, a Neon query, a signature, and a redirect.

Two hundred guests scrolling a 2,000-photo gallery is not a hypothetical at a wedding, and neither is the polling on top: SWR polls every 8 seconds, so 200 phones generate roughly **1,500 requests a minute** against the media endpoint before anyone opens a photo.

`next.config.ts` already lists `media.klik.kreativvantage.com` as a remote pattern, so a custom R2 domain was clearly intended at some point. That plus signed cookies (rather than signed URLs) would let Cloudflare's edge cache public galleries properly.

**The decision to review:** whether public galleries get cacheable delivery. It is the difference between this architecture holding at one big event and buckling. Also pairs naturally with OPS-4, since both are "how do bytes reach the viewer" questions.

**DECIDED 2026-10-07, BUILT 2026-10-08.** No edge cache; batched signed URLs instead. See "What breaks first", rows 1 and 2.

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
