# Klik - Event Photo Sharing: Architecture

> **Status:** Milestones 1–4 (basic) built and deployed; see §11 for the service-side (superadmin + sales-provisioned venues) addition. This document is the source of truth for agents building on it.
> **Elevator pitch:** Every event gets a unique webpage + QR code. Guests scan, optionally enter a name, and upload photos/videos into one shared, live-updating gallery - no app, no account. Organizers manage everything from a dashboard. Events can be self-serve or provisioned for a venue by an internal sales team (§11).

---

## 1. Stack (decided - do not re-litigate)

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15+ (App Router, TypeScript)** | Single app: marketing, guest gallery, dashboard, API |
| Deployment | **Vercel** | Serverless/fluid functions, Vercel Cron for cleanup |
| Database | **Neon Postgres** | Metadata only: events, guests, media records, settings. Use `@neondatabase/serverless` driver |
| ORM | **Drizzle ORM** | Schema in code, `drizzle-kit` migrations |
| Media storage | **Vercel Blob** | Actual photo/video bytes. Client-side uploads (bypasses the 4.5 MB serverless body limit). *Neon cannot store media - it is a relational DB.* If storage cost becomes an issue post-MVP, swap to Cloudflare R2 behind the same `lib/storage.ts` interface |
| Organizer auth | **Auth.js (NextAuth v5)** with Google + email magic link, Drizzle adapter | Guests never authenticate |
| Guest identity | Anonymous **signed cookie session** (per event) + optional display name | No account, ever |
| Styling / UI | Tailwind CSS + shadcn/ui | Brand: yellow `#E8F000`-ish K on black (see logo in repo root) |
| QR codes | `qrcode` npm package | Server-generated SVG/PNG, downloadable |
| Live gallery updates | **Polling** (SWR, 8s interval, cursor-based) | No websockets on Vercel serverless. Upgrade path: Pusher/Ably. Do NOT build realtime infra in MVP |
| Zip download | Streaming zip in a route handler (`archiver` or `client-zip`) | See §7.6 |
| Validation | Zod everywhere (API inputs, env vars) | |
| Rate limiting | Postgres-based counters in MVP (per guest session + per IP) | Upgrade path: Upstash Ratelimit. Don't add Redis in MVP |

**Environment variables** (define in `.env.example`):

```
DATABASE_URL=            # Neon pooled connection string
AUTH_SECRET=             # Auth.js
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_RESEND_KEY=         # magic-link email (Resend)
BLOB_READ_WRITE_TOKEN=   # Vercel Blob
APP_URL=                 # e.g. https://klik.app - used in QR codes
CRON_SECRET=             # protects cron route
```

---

## 2. Top-level user flows

### Guest flow (no account)
1. Scan QR → lands on `/e/[slug]`.
2. Access gate: if event is `private` → blocked (organizer-only). If `password` → password form, success sets a signed per-event cookie. If `public` → straight in.
3. First visit: bottom sheet asks for optional display name + **required consent checkbox** ("Photos you upload may be visible to everyone with access to this gallery"). Stores a signed guest-session cookie scoped to the event.
4. Upload photos/videos directly from phone (camera or gallery picker, multi-select).
5. Browse the live gallery (masonry grid, lightbox), download/share individual items if the organizer enabled downloads.
6. New uploads from other guests appear via polling.

### Organizer flow
1. Sign up / sign in at `/login` (Google or magic link).
2. Dashboard: create event (name, date, cover image, settings).
3. Get QR code + short link; download QR as PNG/SVG for signage.
4. Manage gallery: approve/reject (if moderation on), delete, toggle settings, download-all zip.
5. Event expires at `expires_at` → gallery goes read-only/hidden; media purged by cron after a grace period.

---

## 3. Data model (Drizzle → Neon)

All IDs are `text` primary keys generated with `nanoid`. Timestamps are `timestamptz`.

```sql
-- Auth.js tables (users, accounts, sessions, verification_tokens)
-- come from the standard Drizzle adapter schema. "users" = organizers only.

CREATE TABLE events (
  id               text PRIMARY KEY,
  owner_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             text NOT NULL UNIQUE,          -- short, URL-safe, e.g. "anita-wedding-x7k2"
  name             text NOT NULL,
  event_date       timestamptz,
  cover_media_id   text,                          -- FK to media, nullable, set after upload
  visibility       text NOT NULL DEFAULT 'public',-- 'public' | 'password' | 'private'
  password_hash    text,                          -- bcrypt, only when visibility='password'
  moderation       boolean NOT NULL DEFAULT false,-- true => uploads start as 'pending'
  downloads_enabled boolean NOT NULL DEFAULT true,
  uploads_enabled  boolean NOT NULL DEFAULT true, -- organizer can freeze uploads
  expires_at       timestamptz,                   -- gallery hidden after this; NULL = never
  purged_at        timestamptz,                   -- set by cron when blobs are deleted
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_owner_idx ON events(owner_id);

CREATE TABLE guests (
  id           text PRIMARY KEY,
  event_id     text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name text,                              -- optional, guest-entered
  consented_at timestamptz NOT NULL,              -- consent is required before first upload
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guests_event_idx ON guests(event_id);

CREATE TABLE media (
  id           text PRIMARY KEY,
  event_id     text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id     text REFERENCES guests(id) ON DELETE SET NULL, -- NULL if organizer uploaded
  kind         text NOT NULL,                     -- 'photo' | 'video'
  status       text NOT NULL DEFAULT 'approved',  -- 'pending' | 'approved' | 'rejected'
  blob_url     text NOT NULL,                     -- Vercel Blob URL (original)
  blob_pathname text NOT NULL,                    -- for deletion
  content_hash text,                              -- sha-256 of file, for duplicate detection
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  width        integer,
  height       integer,
  duration_s   real,                              -- videos only
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_event_status_created_idx ON media(event_id, status, created_at DESC);
CREATE INDEX media_event_hash_idx ON media(event_id, content_hash);
```

Design notes:
- **Duplicate detection:** compute SHA-256 client-side before upload; the create-record endpoint flags `content_hash` collisions within the event so the dashboard can show a "possible duplicate" badge. Do not hard-reject.
- **Thumbnails:** do not build a thumbnail pipeline. Serve grid images through `next/image` pointed at the Blob URL (Vercel Image Optimization resizes/caches). Videos: show a `<video preload="metadata">` poster; cap video size instead.
- **`status` when moderation is off:** `approved` on insert. When moderation is on: `pending`. Toggling moderation off later auto-approves nothing - organizer bulk-approves explicitly.

---

## 4. Routes & project structure

```
app/
  (marketing)/page.tsx            # landing page
  login/page.tsx                  # organizer auth
  dashboard/
    page.tsx                      # event list + create
    events/[id]/page.tsx          # gallery management (tabs: Photos, Pending, Settings, QR)
  e/[slug]/
    page.tsx                      # guest gallery (server component shell)
    gate.tsx                      # password / private gate
  api/
    auth/[...nextauth]/route.ts
    events/route.ts               # POST create (organizer)
    events/[id]/route.ts          # PATCH settings, DELETE event (organizer)
    events/[id]/qr/route.ts       # GET → SVG/PNG QR (organizer)
    events/[id]/zip/route.ts      # GET → streaming zip of approved media (organizer)
    events/[id]/media/[mediaId]/route.ts  # PATCH status, DELETE (organizer)
    e/[slug]/session/route.ts     # POST guest session (name + consent) / password unlock
    e/[slug]/media/route.ts       # GET gallery page (cursor) | POST register uploaded blob
    upload/route.ts               # POST → Vercel Blob client-upload token handshake
    cron/purge/route.ts           # GET, CRON_SECRET-protected: purge expired events
lib/
  db.ts        # Neon + Drizzle client
  schema.ts    # Drizzle schema (source of truth for §3)
  auth.ts      # Auth.js config
  storage.ts   # Blob put/delete wrapper - the ONLY file that touches Vercel Blob
  guest.ts     # signed guest-cookie helpers (jose HMAC, cookie name klik_g_<eventId>)
  access.ts    # event access checks (visibility/password/expiry) - used by pages AND api
  ratelimit.ts # postgres counter rate limiter
components/    # gallery grid, lightbox, upload sheet, consent sheet, qr card, ...
```

---

## 5. API contract (summary)

All bodies validated with Zod. Errors: `{ error: string }` with proper status codes. Organizer routes require Auth.js session **and** event ownership check. Guest routes require a valid guest cookie for writes.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/events` | organizer | Create event `{ name, eventDate?, visibility, password?, moderation, expiresAt? }` → generates unique `slug` |
| `PATCH /api/events/[id]` | owner | Update any setting; setting `visibility='password'` requires `password`; re-hash |
| `DELETE /api/events/[id]` | owner | Delete event + all blobs (iterate `blob_pathname`, then cascade delete rows) |
| `GET /api/events/[id]/qr?format=png\|svg&size=1024` | owner | QR encoding `${APP_URL}/e/${slug}` |
| `GET /api/events/[id]/zip` | owner | Streaming zip of approved originals; filename `klik-<slug>.zip` |
| `PATCH /api/events/[id]/media/[mediaId]` | owner | `{ status: 'approved' \| 'rejected' }` |
| `DELETE /api/events/[id]/media/[mediaId]` | owner | Delete row + blob |
| `POST /api/e/[slug]/session` | none | `{ name?, consent: true, password? }` → creates guest row, sets signed cookie. Password checked here for password-visibility events |
| `GET /api/e/[slug]/media?cursor=<createdAt_id>&limit=50` | gallery access | Approved media only, newest first, keyset pagination. Guests' own `pending` items are included (flagged `mine: true, pending: true`) so uploaders see their photos immediately |
| `POST /api/upload` | guest cookie or owner | Vercel Blob `handleUpload` token exchange. Enforces: event exists, uploads enabled, not expired, mime allowlist, size caps, rate limit |
| `POST /api/e/[slug]/media` | guest cookie or owner | After client upload completes: `{ blobUrl, pathname, hash, mime, size, width?, height?, duration? }` → insert media row with correct initial `status` |
| `GET /api/cron/purge` | `Authorization: Bearer CRON_SECRET` | For events where `expires_at + 30 days < now()` and `purged_at IS NULL`: delete blobs, set `purged_at` |

---

## 6. Upload flow (the critical path - build this carefully)

Client-side direct upload to Vercel Blob (`@vercel/blob/client`), because serverless request bodies cap at 4.5 MB and phone videos are far bigger.

```
Guest browser                      Next.js API                      Vercel Blob
     │  select files (multi)            │                                │
     │  per file: downscale photo to    │                                │
     │  max 2560px via canvas,          │                                │
     │  compute sha-256                 │                                │
     │──POST /api/upload (token req)──▶ │ checks: cookie, event open,    │
     │                                  │ mime, size, rate limit         │
     │◀─────────upload token────────────│                                │
     │───────────────upload bytes (direct, resumable)──────────────────▶ │
     │◀──────────────────────blob url + pathname───────────────────────  │
     │──POST /api/e/[slug]/media──────▶ │ insert row (status per         │
     │                                  │ moderation setting)            │
     │◀──media record───────────────────│                                │
```

Rules enforced server-side in the token handshake (never trust the client):
- Mime allowlist: `image/jpeg, image/png, image/webp, image/heic, video/mp4, video/quicktime, video/webm`
- Size caps: photos **25 MB**, videos **200 MB**
- Blob pathname convention: `events/<eventId>/<mediaId>.<ext>` - random, unguessable, and groupable for purge
- Rate limit: **60 uploads / guest session / hour**, **200 / IP / hour**
- Reject when: event expired, `uploads_enabled=false`, event purged

Client UX requirements: parallel uploads (max 3 concurrent), per-file progress, retry on failure, works on iOS Safari + Android Chrome (this is 90% of traffic - test HEIC from iPhone explicitly).

---

## 7. Feature specs

### 7.1 Access control (`lib/access.ts` - single source of truth)
- `public`: anyone with the link/QR can view + upload.
- `password`: viewing and uploading require the per-event unlock cookie (HMAC-signed `{ eventId, exp }`, 30-day expiry). Password verified with bcrypt.
- `private`: only the owner (dashboard session) can view; guest page shows "This gallery is private."
- Expired (`expires_at < now`): gallery shows "This event has ended"; uploads blocked; owner can still view/download until purge.
- Blob URLs are unguessable but public - acceptable for MVP; note in README that password protection gates the *gallery*, not raw blob URLs.

### 7.2 Moderation
- Dashboard "Pending" tab with approve/reject (single + bulk). Approved items appear in the guest gallery on the next poll.
- Uploader always sees their own pending items (marked "Waiting for host approval").

### 7.3 QR code
- Dashboard QR card: preview + download PNG (1024px) and SVG. Encodes `${APP_URL}/e/${slug}`.
- Also show the short link as copyable text for invitations.

### 7.4 Live updates
- SWR polling every 8s with keyset cursor; new items animate in at the top. Pause polling when tab hidden (`visibilitychange`).

### 7.5 Downloads
- Per-item: if `downloads_enabled`, show download button (fetch blob → `a[download]`) and Web Share API button on mobile.
- If disabled: hide buttons (understood that screenshots can't be prevented).

### 7.6 Download-all zip (organizer)
- Route handler streams a zip of approved originals (fetch each blob sequentially, pipe through `archiver` into the response stream). Set `export const maxDuration = 300` (Vercel fluid compute).
- Guard: if total size > 2 GB, return 413 with a clear message; dashboard then offers "download in batches of 200" (same endpoint with `?cursor=` ranges). This keeps MVP simple - no background jobs, no email links.

### 7.7 Expiration & purge
- `vercel.json` cron: `0 3 * * *` → `/api/cron/purge`.
- Grace period: blobs deleted **30 days after** `expires_at`; rows kept (with `purged_at` set) so the dashboard can explain what happened.

### 7.8 Consent
- Consent checkbox is required before the guest session is created; `consented_at` stored on the guest row. Copy: *"I understand that photos and videos I upload may be visible to everyone with access to this event gallery, and I have the right to share them."*
- Footer of guest page links to a simple privacy note page.

---

## 8. Security checklist (agents: verify each before calling a task done)

- [ ] Every organizer API route checks session **and** `event.owner_id === session.user.id` (ownership, not just login).
- [ ] Guest cookies are HMAC-signed (jose), scoped per event, `httpOnly`, `sameSite=lax`.
- [ ] All inputs Zod-validated; slugs generated server-side only (`nanoid` suffix, collision-checked).
- [ ] Password hashes: bcrypt (cost 10). Never return `password_hash` in any API response.
- [ ] Upload token handshake re-checks every rule (§6) - client-supplied mime/size are advisory only; Blob token itself restricts `allowedContentTypes` and `maximumSizeInBytes`.
- [ ] Rate limits on: guest session creation (10/IP/hour), password attempts (10/IP/hour), uploads (§6).
- [ ] Cron route rejects requests without `CRON_SECRET`.
- [ ] No PII beyond optional display name; document this in the privacy note.

---

## 9. Build order (milestones for agents)

Each milestone must end with the app deployable and the listed flows working end-to-end.

1. **Scaffold & foundations** ✅ - Next.js + Tailwind, Drizzle schema + Neon migration, Auth.js login, `.env.example`, `lib/db.ts`, `lib/storage.ts`, `lib/guest.ts`, `lib/access.ts`.
2. **Events CRUD + QR** ✅ - dashboard create/list/edit/delete, settings form, QR generation/download.
3. **Guest page + uploads** ✅ - access gate, consent/name sheet, upload flow (§6, now with server-side photo compression - see §11), gallery grid + polling.
4. **Moderation + media management** ✅ (basic) - pending section, approve/reject/delete. Duplicate-badge UI and per-item guest download/share buttons are not yet built.
5. **Zip download, expiration cron purge, rate limits, security pass (§8) - not yet built.**
6. **Polish** - landing page ✅. Empty/error states, mobile QA, OG images - not yet built.

Out of scope for MVP (do not build): realtime websockets, face recognition, AI moderation, guest likes/comments, payments/plans, email notifications, EXIF-based sorting, background job queues, video transcoding.

---

## 10. Open questions (defaults chosen - override only with the user)

- **Multi-organizer events / co-hosts:** not in MVP; `owner_id` is a single user.
- **Video length cap:** enforced by the 200 MB size cap only.
- **Storage costs:** Vercel Blob is fine for MVP scale; revisit R2 (via `lib/storage.ts` swap) if events regularly exceed ~50 GB.

---

## 11. Service-side: superadmin + sales-provisioned venues

On top of the self-serve product (Google/email sign-up), Klik also supports a B2B motion: a sales team approaches a venue directly and a superadmin provisions their event for them - generating a QR code and a username/password login - instead of the venue signing up itself. Guests are unaffected either way: they never get accounts, regardless of how the event was created (§2).

### Data model

No new tables. An admin-provisioned venue is just a `users` row like any other, owning `events` the same way a self-serve organizer would (`events.owner_id`).

- `users.role`: `'organizer' | 'superadmin'`, default `'organizer'`.
- `users.username` / `users.password_hash`: nullable, set only for credential-based accounts (superadmin + sales-provisioned venues). Self-serve OAuth/email users leave these null.
- `users.email` is nullable (was `NOT NULL`) since admin-provisioned venues don't have one.

### Auth

`lib/auth.ts` adds a `Credentials` provider (username/password, bcrypt) alongside Google/Resend (which are only registered when their env vars are present). **Session strategy is `"jwt"`, not `"database"` - this is required, not a preference.** Reading Auth.js's own source: a Credentials sign-in always issues a JWT-encoded cookie, but reading the session back branches on the *global* `session.strategy` setting - so `"database"` would make credential logins look logged-out on the very next request. Google/Resend work identically under JWT strategy; `DrizzleAdapter` stays wired for OAuth account-linking and magic-link tokens (the `sessions` table just goes unused).

Credential JWTs carry the user's `credential_version`. Auth checks that version against the database whenever a credential session is accessed. `POST /api/admin/clients/[userId]/reset-password` increments the version, so the old password and previously issued client sessions stop working.

Account-credential passwords are hashed at cost 12 (`lib/credentials.ts`) - higher than the cost-10 convention for event gallery passwords (§8), since account access is higher-stakes than a gallery view-password.

### Routes

- **Superadmin** (`role === 'superadmin'` required): `/admin` (list all provisioned clients/events), `/admin/new` (quick-create form - venue/contact name, event name, date, expiry, moderation, visibility → generates username + password + event + QR in one call, shown once). `POST /api/admin/clients`, `GET /api/admin/clients`, `POST /api/admin/clients/[userId]/reset-password`.
- **Organizer dashboard** (used by both self-serve and admin-provisioned organizers, plus superadmin can open any event's dashboard): `/dashboard`, `/dashboard/events/[id]` (Gallery / Settings / QR tabs).
- **Guest page**: unchanged from §2/§4, at `/e/[slug]`.

`lib/roles.ts` is the ownership/role guard (`requireSuperadmin`, `requireOwnerSession` - the latter also passes for a superadmin, which is why no separate admin-only gallery UI was needed).

Creating a venue's login and their event together is one `db.batch([...])` call, not two sequential inserts - **`neon-http` has no `db.transaction()` support**, only `db.batch()`. `lib/events.ts`'s `prepareEventInsert()` builds (but doesn't execute) the event insert so it can be composed into that batch.

### Photo compression (the "should automatically get compressed" requirement)

Plugs into the existing upload flow (§6) at the step that already existed there - `POST /api/e/[slug]/media`, called by the client right after the direct-to-Blob upload of the original finishes:

- Photos: fetch the original blob, resize to fit within 2560×2560 (`fit: "inside"`, no upscaling), re-encode as JPEG quality 80 with `mozjpeg`, re-upload to the *same* pathname (`allowOverwrite: true` - one copy stored, not two), store the compressed size/dimensions in the `media` row.
- **HEIC/HEIF (iPhone's default photo format) needs an extra step**: the `sharp` binary in this environment can decode AVIF but not HEIC/HEIF input (verified via `sharp.format.heif` - output-only). Since ARCHITECTURE.md §6 already flags HEIC as ~90% of real traffic, those mime types are converted to JPEG via `heic-convert` *before* handing off to `sharp` for the resize/quality step.
- Wrapped in try/catch: any compression failure falls back to storing the original untouched rather than failing the guest's upload.
- Videos: unchanged, pass through with the existing size cap only - no transcoding.

### Explicitly deferred from this pass

Payments/pricing, zip download-all, cron purge/expiration enforcement, rate limiting (including brute-force protection on the new `/login` credentials form - a new surface this feature introduces), Google/Resend live wiring (code is in place but no keys supplied yet - those buttons are hidden unless the env vars are set), video transcoding, multi-admin management UI beyond the one seeded superadmin, true session revocation.

### Deployment notes (for whoever touches infra next)

- `vercel.json` pins `"framework": "nextjs"` explicitly. Without it, this project's Vercel dashboard setting was stuck on "Other" with `public/` as a static output directory, which serves nothing but the literal files in `public/` and 404s every real route - a nasty, silent failure mode where the build succeeds and the deployment shows "Ready" but every route 404s. If routes ever start 404ing on Vercel again, check the Framework Preset first.
- The Blob store on this project is connected via the newer OIDC-based mechanism (`BLOB_STORE_ID`, no classic token by default). `@vercel/blob@2.6.1`'s `handleUpload()` (used by `/api/upload`) only supports the classic `BLOB_READ_WRITE_TOKEN` env var - no OIDC fallback in this SDK version - so that token has to be pulled from the Vercel dashboard (Storage → the store → the ".env.local"/Quickstart tab) and set manually. It is not derivable via the `vercel` CLI.
- `scripts/seed-superadmin.ts` (`npm run seed:superadmin`) upserts a superadmin by username, keyed off `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD`/`SUPERADMIN_NAME` env vars passed at invocation time - never hardcode credentials into the script.
