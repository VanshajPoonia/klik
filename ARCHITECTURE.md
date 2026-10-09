# Klik: how the system actually works

> **What this file is.** A description of the code as it exists on 2026-10-02, written for whoever picks it up next. It describes **what is**, not what is planned. Plans, task IDs and sequencing live in `ROADMAP.md`, and work is requested from there by ID ("do ACT-1").
>
> **Why it was rewritten.** The previous version described Vercel Blob, Next.js 15, a domain the project does not own, and a security checklist for features that were later built differently. It was confidently wrong in ways that would send anyone reading it down the wrong path, which is worse than having no document. If you change the system and do not change this file, you are recreating that problem.
>
> **Last verified against commit `0e7fe18` on 2026-10-02.** Every claim here was read out of the code at that
> commit, not recalled. If this line is far behind `git log`, trust the code and fix this file.
>
> **Design rules are elsewhere.** Read `DESIGN.md` before touching any UI, and use the tokens in `app/globals.css` rather than hex values.

---

## 1. What the product is

Every event gets a page and a QR code. Guests scan it, optionally give a display name, agree to a consent statement, and upload photos and videos into one shared gallery. No app, no account. Organizers manage events from a dashboard. A superadmin provisions and activates accounts by hand.

Three kinds of people use it, and they authenticate in three completely different ways. Section 4 is the one to read first, because conflating them is the easiest way to introduce a security bug here.

---

## 2. Stack, as actually deployed

| Concern | What it really is |
|---|---|
| Framework | Next.js **16.2.10**, App Router, React 19.2, TypeScript |
| Hosting | Vercel. Production branch is `main` and deploys on push |
| Database | Neon Postgres via `@neondatabase/serverless` **1.1**, `neon-http` driver |
| ORM | Drizzle **0.45**. Schema in `lib/schema.ts`, raw SQL migrations in `drizzle/` |
| Media storage | **Cloudflare R2**, via the AWS S3 SDK. Bucket `klik-media-us`, unpinned with an ENAM location hint, endpoint from `R2_ENDPOINT`. A locked second bucket, `klik-media-backup`, holds a copy (section 7) |
| Organizer auth | Auth.js v5 beta, **JWT session strategy**, credentials plus optional Google and Resend |
| Guest identity | Per-event JWT in a cookie, signed with `AUTH_SECRET` using `jose`. Never a `users` row |
| Styling | Tailwind **v4**, tokens in `app/globals.css` |
| Image processing | `sharp` 0.35 server side, `heic-convert` for iPhone HEIC, canvas in the browser |
| Validation | Zod 4, on every API input and on the environment at boot |
| Live gallery | SWR polling. No websockets |
| Rate limiting | Postgres counters, `lib/ratelimit.ts` |
| Background work | Postgres `jobs` table, `lib/jobs.ts` to enqueue, `lib/job-runner.ts` to drain. No queue vendor (section 7, "Background jobs") |
| Tests | Vitest. `npm test` for pure logic, `npm run test:db` against a throwaway Postgres (section 11) |

---

## 3. Nine constraints that will bite you

These are not style preferences. Each one has already caused a bug or came within one commit of causing one.

**1. `neon-http` cannot do transactions.** There is no `db.transaction()`. Only `db.batch()`, which sends statements together but gives weaker guarantees than a real transaction. Every multi-step write in this codebase is therefore ordered so that a failure halfway through leaves something recoverable rather than something wrong. When you add one, decide explicitly which half is safe to have happen alone.

**2. Sessions are JWTs, and that is forced.** The Credentials provider does not work with database sessions in Auth.js v5. The consequence is that **a login cannot be revoked**. Changing a password or demoting a user does not invalidate their existing token; it stays valid until it expires. Anything that needs immediate revocation has to check state in the database on each request, which is exactly what `requireEventManagerSession` does.

**3. What an event may do comes from the event, and what an account holds comes from the ledger.** Since ACT-1 (`drizzle/0018_entitlements.sql`) each event carries `plan_key`, `entitlement_id` and `licensed_at`: use `eventPlan(event)` and `eventLicenseState(event)` from `lib/license.ts`, which need no query. Account-level questions (the venue hub, client records) use `hasVenueGrant`. **`users.plan_key` is retired**: it defaults to `'event'`, so reading it again would make every account look like it bought the $39 plan. Limits are enforced by one trigger that reads its numbers from the grant row; the 0002/0003 triggers that hard-coded a second copy of `lib/plans.ts` are gone. Draft, live and lapsed are three different states, and only a live event takes uploads.

**4. Soft delete is everywhere, and the filters are load-bearing.** Almost nothing hard-deletes. Rows carry `deleted_at` and every read path filters on it. Miss the filter and you show deleted content; miss it on `event_co_hosts` and you grant access to someone who was removed. The soft-delete indexes are **partial** (`WHERE deleted_at IS NULL`) and live in `drizzle/0007_soft_delete_indexes.sql`, deliberately not declared in `lib/schema.ts`, because `drizzle-kit push` would recreate them as full indexes and silently undo that.

**5. R2 signs `Content-Type` but does not enforce it.** Verified against the live bucket: a URL presigned for `image/jpeg` returns 200 for a ZIP body. The signature binds the key, the type and the length, and none of that stops the client sending different bytes. This is why `lib/file-signature.ts` exists and why the upload path does a ranged read of the first 32 bytes before trusting anything.

**6. `sharp` is a native module and its shared library is invisible to file tracing.** This caused a real outage on 2026-10-02 in which guest uploads were dead for hours. Three things combined: the lockfile had `sharp` at one version and its `@img/*` binaries at another, because npm hoisted Next's own nested sharp binaries to the top level; Next traces a function's files by following imports, and `libvips-cpp.so` is opened by the OS, so no JavaScript tracer can see it; and `sharp` was imported at module scope, so the failed import took down **every** handler in the file, including the `GET` that lists a gallery and never touches an image library.

The fix is all three: the linux binaries are explicit `optionalDependencies`, `next.config.ts` names `./node_modules/@img/**` in `outputFileTracingIncludes` **for every route that touches sharp**, and the import is lazy, inside `sanitizePhoto`. Any new route that uses sharp needs its own tracing entry; forgetting one fails only at runtime, only on Linux. `/api/health` encodes an 8x8 JPEG specifically to catch that, and `lib/native-deps.test.ts` guards the lockfile half. Routes currently holding an entry: `/api/e/[slug]/media`, `/api/health`, `/api/s/[token]/og`, the two QR routes, and the two job routes that run the thumbnail handler. **`lib/native-deps.test.ts` now enforces the rule**: it scans every `route.ts` for `sharp` or the job runner and fails when one has no entry. On its first run it found both QR routes missing, each importing sharp at module scope, so the printable sign and every plain QR download were one native-load failure from a 500.

**7. A signed URL is a bearer token for its whole window.** Since 2026-10-08 a gallery page signs its tiles in the request that ran the access rule (section 8), and those URLs live 15 to 30 minutes. Hiding or deleting a photo stops new URLs being issued for it at once and removes the tile from every phone within one poll, but a URL already handed out keeps working until it expires. Anything that must stop **instantly**, which today means share-link revocation, must not be batched this way; `/s/[token]` still authorizes per request.

**8. Drizzle wraps every database error, so `error.code` is always undefined.** Since 0.45 a failed query throws a `DrizzleQueryError` whose message is the SQL text and whose `cause` is the driver's error, which is where the SQLSTATE and a trigger's `RAISE` message actually are. Found 2026-10-08: four "someone got there first" branches checked `error.code === "23505"` or `error.message.includes(...)` directly and had never once matched, so signup's username retry, the admin quick-create retry, the featured-event race and the Venue live-limit refusal all surfaced as 500s. Use `pgErrorCode`, `isUniqueViolation` and `raisedBy` from `lib/db-errors.ts`, which walk the cause chain.

**9. In a single-table select list, Drizzle drops the table name from columns, including inside a subquery.** A selected field written as an `sql` fragment such as `EXISTS (SELECT 1 FROM "comment_reports" r WHERE r."comment_id" = ${mediaComments.id})`, in a query that reads only `media_comments`, renders the column as a bare `"id"`. Inside the subquery that means `r.id`, so the check compares a row with itself. The same query with a join, or the same fragment in `WHERE`, is qualified and correct, which is why it passes most tests and fails in the one path that reads a single table. Found 2026-10-09 in MED-9's child-safety check. In a correlated subquery, write the outer table's column out by name (`"media_comments"."id"`), as `lib/comments.ts` does.

---

## 4. Identity: three kinds, never interchangeable

**Superadmin.** `users.role = 'superadmin'`. Full access to every event through `requireSuperadmin` and the `role === "superadmin"` branches in `lib/roles.ts`. Provisions accounts, sets plans, resets passwords, and in the v1 model **activates events**.

**Organizer.** A `users` row. Owns events (`events.owner_id`) or is a co-host (`event_co_hosts`). Authenticated by Auth.js. Co-hosts are capped by plan (`maxCoHosts`: Premium 5, Venue 10), with open invitations counted against the cap. Since ORG-3 someone without an account is invited by email (`event_invites`, `lib/team.ts`); the invitation itself grants nothing, and only becomes an `event_co_hosts` row when accepted by an account signed in with that address. Since ORG-4 an owner can hand an event to a manager on its team, who must accept; the event's licence stays where it was.

**Guest.** **Never needs a `users` row.** Since ACC-1 a guest *may* also be signed in, and then `guests.user_id` points at their account; that adds memory across phones and nothing else, and no join or upload path may ever require it. A guest gets a row in `guests` plus a JWT cookie named `klik_g_{eventId}`, signed with `AUTH_SECRET`, valid 30 days, scoped to one event. There is no server-side session record, so **the cookie is the identity**: anyone holding it is that guest, and it cannot be revoked individually. Treat it as a bearer token, because it is one.

A second cookie, `klik_unlock_{eventId}`, proves a password gallery was unlocked. It carries `accessVersion`, so bumping `events.access_version` invalidates every outstanding unlock at once. That is the revocation mechanism for gallery passwords.

### Where authorization is decided

`lib/roles.ts`, and nowhere else:

- `requireSuperadmin()`
- `requireOwnerSession(eventOwnerId)`: owner or superadmin
- `requireEventManagerSession(eventId, eventOwnerId)`: owner, superadmin, or an active co-host

The third one contains the entire co-host revocation rule, as one predicate in the one query that grants access:

```ts
isNull(eventCoHosts.deletedAt),
eq(users.planKey, "premium"),
```

**Nothing else may read `event_co_hosts` to make an authorization decision.** A removed co-host keeps their row for 30 days so the removal is reversible, which means any other query that joins that table without this predicate hands access back.

For guests, `lib/event-viewer.ts` resolves a viewer and `lib/access.ts` decides what they can see. `canViewGallery` is the single source of truth and is used by both pages and API routes.

---

## 5. Data model

Twelve tables in `lib/schema.ts`.

**Auth:** `users`, `accounts`, `sessions`, `verification_tokens`. The Auth.js shape, plus `role`, `plan_key`, `username`, `password_hash` on `users`. `sessions` exists for the adapter and is effectively unused, because the strategy is JWT.

**Core:** `events`, `guests`, `media`, `albums`.

**Collaboration and sales:** `event_co_hosts` (composite PK on `event_id, user_id`, soft-deleted), `venue_clients`.

**Operational:** `erasure_log`, `rate_limits`.

### The fields that are easy to get wrong

`events.retention_until` is **pinned at creation** and only ever extended, never shortened. This is SEC-1. The purge cron used to resolve retention from the mutable `users.plan_key`, and `getPlan()` falls back to the shortest window for an unknown key, so a plan change or a typo could have set every gallery on the platform to the minimum retention and deleted them on the next run.

`events.access_version` is the password-unlock revocation counter. `events.purged_at` and `events.deleted_at` are separate facts: soft-deleted but not yet purged, versus bytes actually gone.

`media.captured_at` is a **zone-less** `timestamp`, read from EXIF `DateTimeOriginal` before the pipeline strips it. Null means "we do not know" and is deliberately not backfilled from `created_at`, which is upload time and a different fact.

`guests.consent_version` records *which* consent text someone agreed to. A timestamp alone proves when a box was ticked, not what the box said, and the copy can change.

`erasure_log` stores a SHA-256 of the subject identifier, never the raw id. A log of who asked to be erased that contains their identifier defeats its own purpose.

---

## 6. The upload path

This is the critical path and the most security-sensitive code in the repo. `POST /api/upload` then `POST /api/e/[slug]/media`.

1. **Sign.** `/api/upload` checks the viewer may upload, then presigns an R2 PUT binding the key, the content type **and the content length** (SEC-2: without `ContentLength` a signed URL was an unbounded free-storage grant).
2. **Client prepares.** The browser reads EXIF capture time off the original, then compresses via canvas, which strips metadata. Videos get a poster frame and a duration extracted on-device (`lib/video-poster.ts`), because asking a browser for `metadata` on an iPhone `.mov` means reaching to the end of the file for the moov atom.
3. **Client uploads** straight to R2. Bytes never pass through a function.

   **This step depends on the bucket's CORS policy, which is bucket configuration and lives nowhere in this repo.** The PUT sets `Content-Type` explicitly, which makes it a non-simple request, so the browser sends a preflight first. A bucket with no CORS rule fails that preflight and every upload dies as an `onerror` with status 0, which `putWithRetry` reads as a network blip and retries three times before giving up. Nothing in a build, a test or a type check can catch it, and the gallery still loads perfectly, so the only symptom is that uploads stop.

   It bit us on 2026-10-07: OPS-4's new bucket was created through the API, the objects were copied and verified, production cut over cleanly, and uploads were broken until the policy was copied across. The rule needs `content-type` in `allowed.headers` and the app's origins in `allowed.origins`; `https://klik.kreativvantage.com` and `http://localhost:3000` today. **Any new bucket needs this set before it serves traffic.**
4. **Register.** `/api/e/[slug]/media` then does, in order:
   - `HeadObject` to confirm the object exists and its real size matches the claim.
   - Size against the plan limit.
   - **A ranged read of the first 32 bytes**, through `detectMediaSignature`. Unrecognised bytes, or an image claiming to be a video, delete the object and reject. An object with no media row is invisible to the purge cron and would sit in the bucket forever.
   - Advisory duration check for videos.
   - For server-compressed photos: read capture time, convert HEIC if needed, then `sanitizePhoto`.
   - Insert the row.

**Large files go up in parts (OPS-2).** Over 32 MB, `/api/upload` starts a multipart upload and returns one length-bound URL per 8 MB part; the browser retries parts individually and waits out offline spells; `/api/upload/complete` joins them from R2's own part list after checking every length. Registration then proceeds exactly as for a single PUT.

### The rule that governs step 4

**We store only bytes we produced.** `sanitizePhoto` tries the normal pass, then retries with `failOn: "none"` and without mozjpeg, which measurably rescues a truncated file the strict pass throws on. If both fail, the upload is **rejected** and the object deleted.

This used to fall through to "store the original untouched", which failed open on exactly the unusual files most likely to carry GPS coordinates, a device serial and the owner's name, into a gallery whose whole point is a shareable link. The current behaviour refuses photos it previously stored. That is deliberate.

Re-encoding is also what strips metadata. `sharp` discards EXIF unless `.withMetadata()` is called, and it is **never** called here. If you add it for orientation reasons, `lib/exif.test.ts` fails, which is the intended outcome.

---

## 7. Deletion, retention and erasure are three different things

Confusing these is how you either lose data or fail a legal obligation.

**Soft delete.** User-facing. Sets `deleted_at`. Reversible for 30 days through the trash and restore routes. Nothing user-facing hard-deletes.

**Retention purge.** `app/api/cron/purge-expired/route.ts`, nightly at 03:00 UTC, authorized by `Authorization: Bearer $CRON_SECRET`, which Vercel sends automatically when `CRON_SECRET` is set. It soft-deletes galleries past `retention_until` (a 30-day grace, not an immediate wipe), then permanently removes things already soft-deleted for 30 days.

Three safety properties, all deliberate:
- **A circuit breaker.** Over 25 events **and** over half of all events eligible in one run aborts with a 500. Deleting a few galleries a night is normal; deleting most of the platform means something upstream changed retention for everyone, which is what a bad migration looks like.
- **A null guard.** No `retention_until` means skip, never "use the default".
- **Rows before bytes.** If it dies halfway, rows point at objects that are gone, which shows as broken media. The reverse would be orphaned bytes nobody can find or bill for.

**Erasure.** `lib/erasure.ts`. A legal data-removal request. Hard, immediate, irreversible, and it deliberately runs **bytes before rows**, the opposite order to the purge, so the system never reports data as erased while it is still sitting in the bucket. It includes soft-deleted rows and deletes video posters explicitly.

**Orphan reaping.** `lib/job-handlers/reap-orphans.ts`, queued once a day. Deletes objects under `events/` that no media row references, which is the one kind of stored byte neither the purge nor erasure can see, since both walk rows. "Referenced" is checked against every row for the event **including soft-deleted ones**, so a photo in the trash keeps its object. Nothing younger than 24 hours is judged, and the same majority-plus-threshold circuit breaker as the purge stops the walk if most of what it sees looks unreferenced. A `dryRun` payload reports instead of deleting.

### Background jobs

`jobs` is a queue in Postgres (`drizzle/0016_jobs.sql`). A job is claimed by one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` statement, which is what makes it safe on `neon-http` with no transactions: the lock and the status change happen inside one statement. Failures retry at 30 seconds, then 2, 8 and 32 minutes, then land in `dead`, which is the state that alerts. A function killed mid-job leaves the row `running`; the next claim takes it back after 15 minutes.

**How jobs run on the Hobby plan, which allows cron once a day.** The enqueue is the trigger. `kickJobRunner()`, called from `after()`, posts to `/api/jobs/run`, which answers 202 and drains in its own function for up to 280 seconds. `/api/cron/jobs` (daily at 04:00 UTC) schedules the daily jobs, prunes old rows and drains whatever a kick missed. It is safe to call every minute, so an external heartbeat can make retries prompt. On Pro, change its schedule to `* * * * *` and nothing else.

Two properties to keep when adding a job kind. Declare the payload in `JOB_PAYLOADS`, so a malformed job is refused at enqueue rather than dying unseen. And make the handler idempotent: a job can run twice, because a reclaimed stale job may have done some of its work before it was killed.

### Legal holds override everything above

A child-safety report (TRS-1, `lib/reports.ts`) sets `media.legal_hold_at`. While it is set, the purge skips the row and any deleted event containing it, every erasure function throws `LegalHoldError` (routes answer 409), a guest cannot delete it, and the organizer cannot approve or change it. Only `/admin` clears it. The law requires a provider that reports such material to preserve it, and an erasure request does not override that.

### Exports, which are copies and are treated as copies

`exports/<eventId>/<exportId>/part-N.zip`, built by the job queue for galleries over 400 MB (MED-7). They are deleted after 7 days, by row and also by age under the prefix, so a ZIP whose event cascaded away is still caught. Erasure deletes an event's exports straight away, and the backup sweep copies only `events/`, so an export is never kept longer than its week anywhere. Downloads go through `GET /api/events/[id]/exports/[exportId]/parts/[n]`, which checks `media.exportAll` and then redirects to an hour-long signed URL.

### The backup, and why it is locked

**`klik-media-backup` holds a second copy of every object for 30 days, and nothing in this codebase can delete from it.** `lib/backup.ts` copies; `app/api/cron/backup-sweep/route.ts` runs nightly at 02:00 UTC.

R2 has no object versioning, so until 2026-10-07 a bug in `deleteBlobs` would have destroyed the only copy of a customer's gallery. The old EU bucket was an accidental second copy and OPS-4 removed it, which is what forced this.

Four decisions worth not re-litigating:

- **Bucket Lock, 30 days.** `ROADMAP.md` rejected Bucket Lock for the *primary* bucket, where immutability would break rejected-upload cleanup and erasure. On the backup it is the whole point: a backup the application can delete from does not protect against the one thing it exists for. Verified by attempting a delete with the app's own credentials and getting `ObjectLockedByBucketPolicy 409`.
- **A lifecycle rule at 31 days**, one day after the lock releases. The backup is a rolling window, not an archive, so a photo somebody asked you to erase does not live here forever. The gap avoids racing the lock expiry.
- **02:00, an hour before the purge at 03:00.** The purge is the most likely thing to delete something it should not have. Copying first means the night's backup comes from a bucket the purge has not touched, so a purge bug is recoverable from that night's copy instead of being faithfully replicated into it.
- **Server-side `CopyObject`, not read-then-write.** Both buckets are the same account and the same jurisdiction, so the bytes move inside R2 and never enter the function. A 54 MB video is a 7 second call rather than a memory problem. This is why the sweep can afford to be a single cron rather than a queue.

**What this means for an erasure request.** The primary is cleared immediately, as it always was, and the request is recorded in the erasure log from `drizzle/0004_erasure_log.sql`. The backup copy cannot be removed early, by design, and expires on the rotation. So erasure completes everywhere **within 31 days**, not instantly, and that is the promise to make to customers rather than a stricter one you cannot keep. Decided 2026-10-08; the alternative was an unlocked backup that erases instantly and offers no protection from the bug it exists for.

`R2_BACKUP_BUCKET` is optional. Unset, the sweep reports itself unconfigured rather than failing, the same way `lib/email.ts` treats a missing key, because a deployment with no backup is a valid one and a silent success that protects nothing is not.

---

## 8. Delivery and access

**A gallery page signs its own tiles.** `GET /api/e/[slug]/media`, the page's server render, `/media/changes` and the dashboard run the access rule once for a page of media and return direct signed R2 URLs alongside the rows (`lib/media-urls.ts`, `lib/gallery-media.ts`). Fifty tiles used to be fifty authorized round trips through the content route; now they are one. Signing time is rounded to a 15-minute boundary so the same photo gets the same URL for a whole window, which is what lets the browser cache it, and URLs stay valid for two windows. Responses ask for `private` caching only, so no shared cache keeps the bytes. Tiles use a ~480px thumbnail (`media.thumb_pathname`), made in the uploader's browser, by the registration route when it re-encodes, or by the `media.thumbnail` job.

**The content route is still the authority**, for video playback (a viewing session outlives the window), downloads, share links, and as the fallback every tile switches to when its signed URL fails. `?thumb=1` and `?poster=1` serve the stills through the same checks.

**The gallery stays current by asking what changed.** Triggers from `drizzle/0017_gallery_sync.sql` stamp `media.changed_at` when anything a viewer can see changes, and roll it up to `events.media_changed_at`. `/api/e/[slug]/media/changes?since=` answers a quiet gallery from the event row alone, and otherwise returns the changed rows split into what this viewer may now see and the ids they should drop. A host deleting a photo removes it from guests' screens within one poll, which polling for new rows never did. Phones poll at 8 seconds while things change, back off to 60 when nothing does, and pause in a background tab.

`GET /api/e/[slug]/media/[mediaId]/content` resolves event, media, plan and viewer, then redirects to a short-lived signed R2 URL. The bucket is private and has no public access.

Visibility rules, in the order they are applied:
- Soft-deleted media stays visible to event managers only, so the trash screen can show what is about to be restored. Guests get a 404, which from their side is the truth.
- A guest sees `approved` media, plus their own `pending` uploads when moderation is on.
- Private and password galleries are gated by `canViewGallery` before any of this.

**Every URL is issued by a request that ran the full access rule, and that is a closed decision, not a pending optimization.** Either the content route issues it per request (60 seconds for a photo, 6 hours for video so range requests survive a viewing session), or a gallery request issues a page of them at once (15 to 30 minutes, above). The bucket is private, has no public custom domain, and is not fronted by a cache.

The obvious optimization is a public R2 custom domain with CDN caching, and `ROADMAP.md` OPS-4 originally carried it. It was rejected on 2026-10-07 because a cached response never reaches this route, and five live controls here depend on being asked every time:

- **Revocation.** `lib/share-access.ts` checks `revokedAt` first on every request precisely because it is the only control a host keeps after a link has left their hands.
- **View caps.** `maxViews` is counted against `viewCount`, a counter this route increments. A cache hit cannot increment it, so a one-open link becomes unlimited.
- **Per-media visibility.** `canViewMedia` decides per object, so "this gallery is public, cache it" is not a valid split: a public gallery can hold hidden photos.
- **Trash.** Soft-deleted media stays visible to managers only. A cached copy serves it to everyone.
- **Retention.** `resolveEventViewer` reads `galleryAccessDays`, and the plan route moves `retentionUntil`. Cached bytes outlive a downgrade.

`lib/media-access.ts` and `lib/share-access.ts` are pure and shared so the page, the OG image, the content redirect and the download cannot disagree about who may see what. A CDN would be a fifth consumer of those bytes that is structurally unable to call either function.

The cost of this decision was a database round trip per media request, and on 2026-10-08 it was paid down the way this paragraph said it should be: by batching the authorization, not by making the bytes public. What batching gave up is constraint 7 in section 3, a bearer window of up to 30 minutes instead of 60 seconds for tiles; what it kept is that no URL exists that a request running `canViewMedia` did not issue. The latency argument for caching was answered by OPS-4 instead: the bucket is now in ENAM rather than the EU, and storage round trips fell from 437ms to 104ms without weakening a single control above.

`toPublicEvent` in `lib/events.ts` is an **allowlist** of 15 fields. It used to be a denylist, which meant every new column was published to guests by default, and it had already leaked `retentionUntil`, `deletedAt` and `purgedAt`. `lib/events.test.ts` now reads the column list out of the schema and fails if any column is neither published nor explicitly withheld with a reason, so a new column cannot default to public.

---

## 9. Rate limiting

`lib/ratelimit.ts`, backed by the `rate_limits` table. One atomic `INSERT ... ON CONFLICT DO UPDATE` does the whole window: a `CASE` resets the counter when the window has expired and increments it otherwise. There is no read-then-write, so concurrent requests cannot both pass a stale check. Verified: ten parallel requests against a limit of five let exactly five through.

Applied to credential login **before** the bcrypt compare, so an attacker cannot burn server CPU by guessing. Verified live: 12 attempts, exactly 7 throttled.

---

## 10. Environment

`lib/env.ts` validates with Zod **at module load**, so a missing variable fails the build rather than a guest's request. `AUTH_SECRET` was the worst case before this existed: it threw from `lib/guest.ts` on the first guest session, so a bad deploy looked healthy until somebody scanned a QR code.

Required: `DATABASE_URL`, `AUTH_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
Optional: `APP_URL`, `CRON_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`.

**The gotcha:** a `.env` file sets an unset key to `""`, not `undefined`, and `z.optional()` only accepts `undefined`. Every optional value therefore goes through a preprocessor that maps `""` to `undefined`. Without it, a commented-out provider takes the whole build down.

`getAppUrl()` falls back to Vercel's ambient deployment URL when `APP_URL` is unset. That fallback is a convenience, not something to rely on: a QR code generated against a preview URL scans fine today and 404s once that deployment is superseded, which is a cruel failure for something printed and stuck to a wall.

---

## 11. Tests

`npm test`. Vitest, Node environment, no database and no network. `vitest.config.mts` supplies a fake environment because `lib/env.ts` validates at import.

Coverage was chosen on one rule: **cover what already went wrong once.** `lib/file-signature.test.ts` pins SEC-9, `lib/events.test.ts` pins SEC-10 structurally, `lib/exif.test.ts` pins the metadata behaviour.

`/api/health` checks the database, R2 **and** that the server can encode an image, because a native dependency failing only at runtime on one platform is exactly what a health check is for. It returned 200 throughout the outage above while uploads were dead, which is why the third check exists.

`npm run test:db` is the second suite, against a real Postgres, covering the paths that destroy data or decide access: the purge circuit breaker, `lib/erasure.ts`, the co-host revocation predicate, the media access rule, share links and the job queue's claim. These cannot be written any other way, because the predicates *are* the behaviour and a test that mocks the query away tests nothing.

Bring the database up with `scripts/test-db.sh`. It creates a throwaway cluster under `/tmp` on port 55433, so it is neither a system service nor your development database. It pushes `lib/schema.ts` and then applies **every migration** on top, because constraints, partial indexes and triggers exist only in the SQL files; every migration must therefore be re-runnable. The 0003 plan-limit triggers are then dropped, since fixtures create many events per owner and ACT-1 replaces them. `test/harness.ts` refuses to run unless the target is named `klik_test` and is not hosted on Neon, because the suite truncates every table.

**One rule for that suite:** production runs `neon-http`, which has no transactions, while the tests run `node-postgres`, which does. Nothing in `test/*.dbtest.ts` may use `db.transaction()`. It would pass there and fail in production, which is worse than no test.

---

## 12. What is not built

> **This section was corrected on 2026-10-06 and again on 2026-10-07, later than the header's last-verified commit.** Four things it listed as missing had in fact shipped: self-serve signup, per-photo visibility, per-photo share links and transactional email. The rest of this file has not been re-read against the code since `0e7fe18`.

**The entitlement ledger, 2026-10-08.** See constraint 3 and `BILLING.md`. Grants are made on `/admin` with a reason; payments never grant anything themselves.

Folder share links. Any AI that needs a model. The canvas print studio (the QR sign is a hard-coded SVG string). Error tracking beyond structured logging and email alerts, since Sentry is wired but has no DSN. Video transcoding. Passkeys.

**Built since the last-verified commit, and easy to miss:** `/signup` with `users.activated_at` as the capability gate (see `BILLING.md`, and note that `users.plan_key` defaults to `'event'` so a new account reads as paid when it is not), per-media visibility and `media_shares` from `drizzle/0011_media_visibility_and_shares.sql`, the Stripe tables from `0012`, and Resend email in `lib/email.ts`.

**The activation loop, 2026-10-07.** Assigning a plan through `PATCH /api/admin/clients/[userId]/plan` is the single action that grants capability: it sets `activated_at`, sends the organizer their dashboard link and the steps through `lib/activation-notice.ts`, and stamps `users.activation_email_sent_at` only once the provider has accepted. Every outcome, including a refusal, is appended to `account_timeline` (`drizzle/0015_account_timeline.sql`), which is history rather than current state. `lib/timeline.ts` derives a seven-step chain from it for `/admin` and stores none of it. The table has no `CHECK` on `kind` on purpose, because a rejected insert loses the record this table exists to keep.

**Teams, 2026-10-08 (ORG-3, ORG-4).** Invitations by email with 14-day links, ownership handover with acceptance, and a team activity feed on the event page read from `audit_log` through an allowlist in `lib/activity.ts`. Single-photo approve, reject and hide are not in the audit log, so the feed shows deletions and bulk actions but not those.

**Usernames and the account page, 2026-10-08 (ID-1 to ID-3).** Handles are unique without case (`users_username_lower_idx`), stored lowercase, and follow `lib/username.ts`; older generated ones are grandfathered. A changed handle is parked for 30 days by a trigger in `drizzle/0027_usernames.sql`, and the JWT callback now refreshes `token.username` from the row it already reads. `/dashboard/account` holds name, handle, password and deletion.

**Guest accounts, 2026-10-09 (ACC-1 to ACC-5).** A guest is still a cookie and still needs no account. When they have one, `guests.user_id` links the two: set on join while signed in, claimed from cookies on `/me` and on gallery load, and resumed on a new phone. Email sign-in sends a six-digit code, limited in the Auth.js route wrapper. `users.organizer_intent_at` separates people who came to run events from guests keeping a gallery, and the admin signup queue reads it. Passkeys (ACC-6) are not built.

**Video location removal, 2026-10-09 (MED-8).** Videos are scrubbed in place by the `media.scrub_video` job; `media.metadata_state` says where each one is, and `videoHeldBack` in `lib/media-access.ts` keeps a pending or failed one to its uploader. The Privacy Policy now says so.

**Hearts and comments, 2026-10-09 (MED-9).** Both off per event (`events.reactions_enabled`, `events.comments_enabled`). A heart needs only the guest cookie, or the host's account; a comment needs an account. Counts live on `media.reaction_count` and `media.comment_count`, kept by triggers in `drizzle/0030_reactions_and_comments.sql`, and they move `media.changed_at`, so phones receive new counts through the existing change sync rather than a second channel. `reacted` is added per viewer by `withViewerReactions` in `lib/reactions.ts` at each of the three places a gallery payload is built. Comments come down by being hidden, with `hidden_reason` saying by whom; comment reports are their own table so they never hide the photo underneath, and appear on the event page and on `/admin`.

**Folders, 2026-10-09 (MED-4).** Still the `albums` table, now a tree: `parent_id`, `position` and `cover_media_id`, with the shape held by the `albums_check_tree` trigger in `drizzle/0031_folders.sql` (same event, no cycles, three levels counting the moved subtree, under a per-event advisory lock). The arithmetic is `lib/folder-tree.ts`, pure and shared by the dashboard, the gallery and the routes; reads and writes are `lib/folders.ts`. A folder change stamps `events.updated_at`, so open galleries resync and receive the new folders with it. A photo stays in one folder; "inside" means anywhere beneath when browsing from above, and "Unfiled" includes photos whose folder is in the trash.

**Moments and bursts, 2026-10-09 (AI-1).** Worked out from capture times by `lib/moments.ts` (pure) and stored by the `moments.refresh` job: moments as `albums` rows of kind `smart` with their span in `query`, and on each photo as `media.moment_id`; bursts as `media.burst_id`, the first photo's id. A refresh that changes anything stamps `events.updated_at`, so galleries resync and receive the new moments. Smart rows are left out of every folder list and of the folder limit, and only their name can change.

**Sharing from the gallery, 2026-10-09 (CAM-3).** All on the viewer's phone and nothing stored: `lib/media-share.ts` fetches the file (signed URL first, then the authorized route, never with cookies across origins), draws the smaller copy and the story image, and makes the QR code from the gallery address with the `qrcode` package loaded on demand. A link to a photo is `/e/<slug>?m=<id>`; the page reads it with `fetchGalleryMedia`'s `id` option, which is the grid's query and visibility rule narrowed to one row, so a link can never show more than the grid. The download route lets a guest save their own upload when the host has downloads off.

**Kiosks, 2026-10-09 (VEN-2).** `kiosks` rows (`drizzle/0033_kiosks.sql`) each own a `guests` row, and a paired tablet holds an ordinary guest cookie with a `kioskId` claim; it never holds a user session. `resolveEventViewer` checks the claim against the row on every request and returns `kioskId`, so a switched-off kiosk is no guest at all, and the routes that delete (`DELETE /api/e/[slug]/media/[mediaId]`, `DELETE /api/e/[slug]/me`) refuse a kiosk outright. The gallery page redirects a kiosk to `/e/[slug]/kiosk`, `claimGuestCookies` skips it, and registration files its photos into the kiosk's folder whatever the client sends. The browser upload path now lives in `lib/upload-client.ts`, shared by the gallery and the kiosk.

`ROADMAP.md` has all of it with task IDs and an order.

## 13. Known operational gaps

- `AUTH_SECRET` is absent from Vercel's **Preview** scope, so preview deployments fail to boot at module load.
- Preview `DATABASE_URL` points at **production**. The `R2_*` variables no longer do: `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` were dropped from the Preview scope during the OPS-4 cutover on 2026-10-07 and deliberately not restored. A preview deployment that could write to the production media bucket was the worse state, and previews cannot boot anyway while `AUTH_SECRET` is missing. Restoring previews means fixing both, plus adding the preview origin to the bucket's CORS rule, or uploads will fail there even once it boots.
- The project is on Vercel's **Hobby** plan, which Vercel licenses for non-commercial use only, and which limits cron to once a day. The job queue is built to work there (section 7), but a paid product belongs on Pro.
- No staging database. Seventeen migrations have gone straight to the only database that exists.
