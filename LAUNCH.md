# Your steps

**What this file is.** The things only you can do: accounts, money, legal,
dashboards, and anything needing a credential or a decision that is yours to
make. `ROADMAP.md` is the other half, what gets built, by task ID.

Keep this file. Tick things off in it rather than in chat, so the next person
reading the repo can see what was actually done and when.

**No launch date.** On 2026-10-08 the weekend target was dropped in favour of
finishing the whole of `ROADMAP.md`. Claude works through it in order and adds
anything that needs you to this file as it comes up.

---

## Do these now

They make what already exists safe, whatever gets built next.

### 1. Create the contact mailbox

`hello@klik.kreativvantage.com` is printed on both legal pages and is the
**DMCA notice address**. It does not exist yet. Until it does, every privacy
request and every copyright notice goes nowhere, which for DMCA purposes is
worse than publishing no page at all.

Create it, or tell Claude the right address. It lives in one line of
`lib/legal.ts`.

- [ ] Mailbox exists and somebody reads it

### 2. Confirm two facts Claude had to guess

Both are in `lib/legal.ts`, one line each.

- [ ] **Governing law.** The terms say **Missouri**, inferred from the 314 area
      code on the support line. Wrong if the entity is registered elsewhere.
- [ ] **Legal entity name.** The pages say **Kreativ Vantage**. It must match
      the registered name exactly, and must match the DMCA filing.

### 3. Read what you are publishing

You declined legal review, which is your call. Read both pages anyway:
[/terms](https://klik.kreativvantage.com/terms) and
[/privacy](https://klik.kreativvantage.com/privacy). They make specific
promises, including that deletion completes everywhere within 31 days.

- [ ] Read both, end to end

### 4. Turn on error alerts

Without this, the first production failure is found by a customer.

```bash
printf 'you@yourdomain.com' | vercel env add ALERT_EMAIL production
vercel --prod
```

- [ ] Set, deployed, and Claude has confirmed a test error actually arrives

### 5. Check whether your database has a backup at all

`ROADMAP.md` says this plainly: Neon point-in-time restore depends on your
plan, and **no restore has ever been tested**. An untested backup is a belief.
Media is now safe in a locked second bucket; the database is not.

Check the Neon dashboard for your plan's PITR window. If it is zero, that is a
launch blocker, not a nicety.

- [ ] PITR window confirmed, and the number written here: ______

### 6. Move Vercel to Pro before the first real customer

Klik is on **Hobby**, which Vercel licenses for **non-commercial use only**. A
product that takes payments is commercial, so this is a terms problem before it
is a technical one, and Vercel can pause a Hobby project that breaks them.

Pro is $20 a month and also lifts the two limits Claude is working around:

- cron once a day becomes once a minute, so failed background jobs retry
  within a minute instead of waiting for the next upload or the 04:00 cron
- functions get up to 800 seconds and 4 GB, which large ZIP exports want

Vercel, **Settings, Billing**, upgrade the team. Then tell Claude, which changes
one line in `vercel.json`.

- [ ] On Pro

### 7. Walk the funnel yourself

**The highest-value hour you can spend on this.** Every test so far has been
synthetic: API calls and curl. No human has been through it.

On a real phone, as a stranger would:

1. Open the pricing page, pick a plan
2. Sign up, pay
3. Wait for the activation email, check it actually arrives
4. Open the dashboard from the link in that email
5. Create an event
6. Print the QR sign
7. Scan it on a second phone, agree to the consent notice
8. Upload a photo and a video
9. View the gallery, open the lightbox
10. Download the zip

Send Claude anything that breaks. The CORS bug found this week is proof that
this category of failure exists and that no test suite catches it.

- [ ] Walked end to end on a real device

---

## Keys Claude will ask for, in the order the work needs them

Nothing here is needed today. Each row says what it unblocks, so you can do it
early if you would rather not be asked mid-task.

| Needed for | What to create | What to give Claude |
|---|---|---|
| **OPS-1** video transcoding | Cloudflare dashboard, **Stream**, subscribe (from $5 a month). Then **My Profile, API Tokens, Create Token**, custom token, permission **Account, Stream, Edit**, scoped to this account only | The token, as `CLOUDFLARE_STREAM_API_TOKEN` in `.env.local` and Vercel Production. Claude creates the signing key and the webhook through the API, so you do not have to |
| **F-9** Sentry | sentry.io, project type **Next.js**, named `klik`. Then **Settings, Auth Tokens** with `project:releases` | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| **AI** phase (scene search, duplicates, safety screening) | Cloudflare **API Tokens**, permission **Account, Workers AI, Read** | `CLOUDFLARE_AI_API_TOKEN` |
| **ACC** sign in with Google, optional | Google Cloud Console OAuth client. Redirect URI `https://klik.kreativvantage.com/api/auth/callback/google` | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |

---

## Soon

- [ ] **File the DMCA designation.** Brief already sent. $6, renews every three
      years. Not retroactive, so cover starts the day it is filed.
- [ ] **Diary the DMCA renewal**, three years out
- [ ] **Decide sales tax nexus** with an accountant (`ROADMAP.md` LAW-6)

---

## Done

| Date | What |
|---|---|
| 2026-10-07 | Activation loop closed: assigning a plan grants access and emails the organizer |
| 2026-10-07 | Account history table, with the seven-step chain on `/admin` |
| 2026-10-08 | **OPS-4**: media bucket moved off EU jurisdiction to ENAM. Storage round trips 437ms to 104ms |
| 2026-10-08 | CORS policy restored on the new bucket. Uploads had been silently broken |
| 2026-10-08 | Backup bucket live, Bucket Lock verified by a refused delete. Nightly sweep at 02:00, verified in production |
| 2026-10-08 | R2 credentials rolled; the exposed secret confirmed dead |
| 2026-10-08 | Public bucket domain rejected as an architectural decision, see `ARCHITECTURE.md` section 8 |
| 2026-10-08 | Terms of Service and Privacy Policy published |
| 2026-10-08 | Error alerting by email, throttled per event |
| 2026-10-08 | Stripe payment links checked |
| 2026-10-08 | Decided: Hobby for now, payments keep human approval, video through Cloudflare Stream, no face grouping |
| 2026-10-08 | **F-5** background job queue live, with the **SEC-2** orphan reaper as its first job |
| 2026-10-08 | Gallery rebuilt for a 200-guest wedding: thumbnails, one request per page instead of one per photo, and deleted or hidden photos now vanish from guests' phones without a reload |
| 2026-10-08 | QR sign downloads protected from the native-library failure that took uploads down on 2 October |
