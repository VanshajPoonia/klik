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

On a real phone, as a stranger would. **Use a fresh account and a fresh event:**
all four test events in production are past their 30-day upload window (created
in July), so uploads to them are correctly refused.

1. Open the pricing page, pick a plan
2. Sign up, pay
3. Create your event straight away: it saves as a **draft**, and the page says
   what it is waiting for. Press **Ask Klik to activate it**
4. Check the request email reached `ALERT_EMAIL`, and that the draft is at the
   top of `/admin` under **Waiting to go live**
5. On `/admin`, grant that account a pass with a reason. The draft should go
   live, and the access email should name the event
6. Open the dashboard from the link in that email
7. Print the QR sign
8. Scan it on a second phone, agree to the consent notice
9. Upload a photo and a video. The tiles should appear within seconds on the
   first phone too
10. On the first phone, delete one of them. It should vanish from the second
    phone within a few seconds, without a reload
11. View the gallery, open the lightbox
12. Download the zip

Send Claude anything that breaks. The CORS bug found this week is proof that
this category of failure exists and that no test suite catches it.

- [ ] Walked end to end on a real device

### 8. Register with NCMEC's CyberTipline

Guests can now report a photo as child sexual abuse material. When they do, Klik
hides it, freezes it under a legal hold, and emails `ALERT_EMAIL` as urgent. US law
(18 U.S.C. 2258A) then requires the provider to report it to NCMEC, and the Terms
promise exactly that. You cannot file as a provider until you are registered.

1. Go to report.cybertip.org and register **Kreativ Vantage** as an electronic
   service provider. Use the same legal name and contact as the DMCA filing.
2. When a report arrives: review it on `/admin` under **Reports**, file it with the
   CyberTipline if it is what was reported, and press **Reported to NCMEC, keep
   held** with the report number. Do not download, copy or forward the image.

- [ ] Registered as an ESP

### 9. Read the incident plan, and fill its blanks

`INCIDENTS.md` is what to do if data is ever exposed: what to rotate, where to look,
and who must be told by when. It has a short checklist at the end, the first item
being a lawyer's number written down before you need it.

- [ ] Read `INCIDENTS.md` and filled in the checklist at the bottom

### 10. Look at the screens built today

The browser extension was not connected, so none of the new screens has been looked
at by eye. Each works and is tested, but layout bugs only show on a screen. On a
laptop and a phone, open: an event's **Insights** and **Trash** tabs, the **QR code**
tab (try each style and the story image), **Settings** (gallery address, disposable
camera), the selection bar's **Actions**, `/admin` (grants, reports, waiting to go
live) and `/admin/search`, `/admin/capacity`, `/admin/audit`, and the **live display**
from a Premium event. Send anything that looks wrong.

Added later the same day: **teams**. On a Premium event's **Settings** tab, invite an
email address that has no Klik account (use a second address of yours), open the
email on your phone, and follow it through creating the account. Then, back as the
owner, hand the event to that person with the arrows button next to their name, and
accept it from the other account. Check the **Team activity** card shows all of it.

- [ ] Looked at each
- [ ] Walked an invitation and a handover with a second email address

And the **Account** page, linked from the top of your dashboard: change your name, choose
a username (the old generated one is held for you for 30 days), and change your password.
Changing the password signs every other device out, which is intended. Do not press
"Delete my account" on an account you want to keep; it is real and immediate.

- [ ] Chose a username and changed a password on a test account

And guest accounts. On your phone, open one of your galleries **signed out**, scroll to
the bottom and tap "Sign in with your email". You should get a six-digit code by email:
type it in, and you land back in the gallery. Then open `/me`: the gallery is listed.
Try a wrong code once to see the message. The code email is new, so check it does not
land in spam.

- [ ] Signed in from a gallery with an email code, and saw it on `/me`

**The Privacy Policy changed on 9 October**, to match what was built: guests may now
sign in (optional), videos have their location removed too, and accounts can be deleted
from the Account page. Read the "What we collect from guests", "Location and camera
data is removed" and "Your choices" sections before you rely on it.

- [ ] Re-read the three changed sections of `/privacy`

And **hearts and comments**. They are off on every event until you turn them on: open
an event's **Settings** tab, tick "Guests can heart photos" and "Guests can comment",
and save. Then, on your phone, open the gallery as a guest, open a photo, and tap the
heart (or double-tap the photo). Tap the speech bubble, sign in with your email when it
asks, and write a comment. On your laptop, open the same event's gallery tab: the photo
shows its counts, and opening it shows the comment with a **Hide** link. Report the
comment from a third browser to see it reach the **Reported comments** card on the event
page and on `/admin`.

The **Privacy Policy and Terms** changed again the same day, for comments: the Privacy
Policy's "What we collect from guests", "Who can see a photo" and "Your choices", and the
Terms' "Your content stays yours" and "What you must not upload or write".

- [ ] Turned on hearts and comments for a test event, hearted and commented from a phone
- [ ] Hid a comment, and saw a reported one on the event page and `/admin`
- [ ] Re-read the comment paragraphs in `/privacy` and `/terms`

And **folders**, which replaced albums on Premium and Venue events. On a laptop, open a
Premium event's gallery tab: make a folder ("Ceremony"), open it, make one inside it
("Vows"), and drag a few photos onto each card. Select several and drag them together.
Inside a folder, press "Use as folder cover" on a photo. Then on your phone, open the
gallery as a guest: a row of folder tabs appears, and a second row when you open
"Ceremony". Delete "Ceremony" on the laptop and restore it from the **Trash** tab: both
folders come back, with their photos in place.

- [ ] Made nested folders, dragged photos into them, and saw the tabs on a phone
- [ ] Deleted and restored a folder with a folder inside it

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
| 2026-10-08 | **ACT-1 to ACT-4**: plans granted through a ledger with a reason. A $39 pass now licenses one event, not one a month for ever. Events start as drafts, organizers can ask for activation, and you get an email when they do |
| 2026-10-08 | Gallery password guessing rate limited |
| 2026-10-08 | **MED-7**: galleries over 400 MB download as ZIPs built in the background, with an email when ready, instead of timing out |
| 2026-10-08 | Guests can delete their own uploads, as the Privacy Policy already promised, and report a photo. Child-safety reports hide and preserve the photo and alert you |
| 2026-10-08 | Trash and restore are on screen, for photos, folders and whole events. Deleting an event takes typing its name |
| 2026-10-08 | Storage limits per event (25 GB Event, 100 GB Premium and Venue) with a meter, warnings at 75%, 90% and full, and reminders 30, 7 and 1 days before a gallery closes |
| 2026-10-08 | Large videos upload in parts that survive wifi drops, instead of restarting from zero |
| 2026-10-08 | **VEN-1**: a live slideshow for a projector or TV, with a QR code in the corner and a one-minute delay before new photos appear |
| 2026-10-08 | **CAM-4**: disposable camera mode. A roll of shots per guest, and nobody sees anything until it develops |
| 2026-10-08 | **Security**: Next.js 16.4.0 and Auth.js updated, clearing two critical advisories (a middleware bypass and an auth check that could fail open) and image-library CVEs. Production dependencies audit clean |
| 2026-10-08 | Custom gallery addresses that never break printed signs, styled QR codes checked to scan, and sharing the code straight to WhatsApp or as a story |
| 2026-10-08 | Bulk actions on a selection with undo, and an Insights tab showing what happened at each event |
