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

And **moments**. They need photos taken at least twenty minutes apart, so the quickest
test is a real one: upload photos from two different times of day from your camera roll
to a test gallery. Within a minute the gallery shows a row of tabs such as "Afternoon"
and "Evening"; rename one to "Ceremony" from the dashboard's gallery tab and check the
name holds after you add more. Hold the shutter on your phone's camera for a burst,
upload it, and it shows as one photo with a count. Moments can be turned off for guests
in **Settings**.

- [ ] Saw moments on a test gallery, renamed one, and saw a burst stack

And **sharing**. On your phone, open a gallery as a guest, open a photo and tap the share
arrow at the top. Try each: **Send photo** (pick WhatsApp or Messages and send it to
yourself), **Story with QR** (check the preview, then share it to an Instagram story, or
save it and scan the QR code on it with another phone), **Copy link** (paste it into a
message, open it on another phone, and the gallery opens on that photo once it has
joined), and both **Save** rows. Then on your laptop, the same button on the dashboard has
**Make a share link** at the top. One behaviour changed: with "Guests can download" off,
a guest can still save and send **their own** uploads. The setting now says so.

- [ ] Sent a photo, posted a story image and scanned its QR, and opened a copied link

And **kiosks**, on a Premium or Venue event. On your laptop, open the event's **QR code**
tab: a **Kiosks** card sits beside the QR code. Name one ("Entrance") and press **Set up a
kiosk**. Scan the code it shows with an iPad or a spare phone that is **not signed in to
Klik**, tap **Make it a kiosk**, and allow the camera. Take a photo with the countdown,
press **Add to the gallery**, and check it appears in the gallery (or the moderation
queue). Leave it alone for a minute and it goes back to the start screen. Then press
**Switch off** on the laptop and try to take another: the tablet says it has been switched
off. Before a real event, lock the tablet to the page: on an iPad, Settings, Accessibility,
Guided Access.

The **Privacy Policy** gained one paragraph for this, under "What we collect from guests".

- [ ] Paired a tablet as a kiosk, took a photo on it, and switched it off
- [ ] Read the kiosk paragraph in `/privacy`

And **photo challenges**, on any event. Open the event's **Settings** tab: the
**Photo challenges** card is on the right. Tap two or three of the suggestions (or write
your own), tick "Show a leaderboard in the gallery" if you want one, and press **Save
challenges**. On your phone, open the gallery as a guest with a name: a row of challenge
cards sits above the photos. Press **Take it** on one, take a photo, and the card gets a
tick and a count. Tap the card to see only its photos. If you turned the leaderboard on,
your name appears under "Most photos shared".

The **Privacy Policy** gained a paragraph for this too, under "What we collect from guests".

- [ ] Set challenges, took one from a phone, and saw the tick, the count and the leaderboard
- [ ] Read the challenges paragraph in `/privacy`

And the **camera**, on a phone, from any gallery's Camera button:

- **Burst:** press and hold the round shutter. It keeps shooting ("Burst 8" at the top)
  until you let go. Add them, and in the gallery they stack as one photo with a count.
- **Level:** tap the grid button at the top. On an iPhone it asks to use motion the first
  time; allow it. A line across the middle follows the horizon and turns yellow when the
  phone is straight.
- **Selfies:** take one with writing behind you. The preview is a mirror; the saved photo
  reads the right way round.
- **Blocked camera:** in Safari, tap aA, Website Settings, set Camera to Deny, and open the
  camera again. It explains how to undo that, and offers your phone's own camera and your
  library instead. Set it back to Allow afterwards.

- [ ] Tried a burst, the level, a selfie with writing, and the blocked-camera screen

And the **photo editor**. Open a photo you uploaded (on your phone, as a guest) and tap
the pencil at the top. Crop it square, try a filter, add some text, and press **Save**. It
appears as a new photo next to the original, and you are offered **Remove the original**.
On your laptop, the same pencil is on every photo in the event page's viewer; an edit made
there sits beside the guest's original. Then, as the guest, delete the original: the edited
copy goes with it, yours included. That is on purpose, and the Privacy Policy now says so
(one new paragraph under "Who can see a photo").

- [ ] Edited a photo as a guest and as the host, and saw the copy go when the guest deleted the original

And **share links for a folder or a selection**. On your laptop, open a Premium event's
gallery tab and open a folder: its row of buttons now starts with **Share link**. Tick
"Allow downloads", press **Create link**, and open the link on your phone in a private
tab: you see the folder's photos (and those of the folders inside it) as a grid, open any
of them, and **Download all** gives a ZIP. Then go back to the laptop, select a few photos
from anywhere, and choose **Make a share link** from the selection bar's Actions. Check the
**Links** tab lists both, one with the folder's name and one with the photo count. Press
**Turn off** on the folder link and reload it on the phone: it says it was turned off.
Note what a folder link shows: photos added to that folder later appear through it, but a
photo you hid never does.

The **Privacy Policy** changed for this, the "Who can see a photo" section, dated 10 October.

- [ ] Shared a folder and a selection, opened both on a phone, and turned one off
- [ ] Read the share link paragraph in `/privacy`

And the **print studio**, on a Premium or Venue event that is live. Open the event's **QR code**
tab and press **Open the print studio**. Every template shows your event's own name and code.
On a laptop:

- Pick **Poster**. Click the event name and change the typeface on the right; drag the QR code
  around (it snaps to the middle of the page); press Cmd+Z to undo. Wait a second and it says
  "Saved". Close the tab and open the design again: your changes are there.
- Upload a logo (a PNG with a transparent background is best) from **Your photos and logos**
  and place it.
- Press **Export**. The checks should say the code scans. Download the **PDF for printing** with
  bleed and crop marks, open it, and print one page at actual size on your own printer: scan
  the code from across a table.
- Make the QR code small (about 2 cm) and press Export again to see the warning. Undo.
- Open the same design in a second tab, change something in each, and see the second one ask
  which copy to keep.

On your phone, open the studio: you can choose a template, change the words and export, and it
tells you moving things needs a computer. Before sending a real order to a print shop, ask them
whether they want bleed and crop marks (most do; the studio adds them by default).

The **Privacy Policy** gained one line under "What we collect from organizers".

- [ ] Made a poster, uploaded a logo, exported a PDF, printed it and scanned the code
- [ ] Saw the small-code warning, and the "which copy to keep" choice across two tabs
- [ ] Opened the studio on a phone

And the **offline upload queue**. This needs an event that is still taking uploads: every test
event in production is on the Event plan, whose 30-day upload window has closed, so use a new
pass or a Premium event. Then, as a guest:

- On an **iPhone**, open the gallery, turn on Airplane mode and add three photos. The box above
  the photos says you are offline and that they are saved on this phone. Swipe Safari away
  completely. Turn Airplane mode off and open the gallery again: they send and appear.
- On an **Android phone in Chrome**, do the same, but after closing the tab do not open Klik
  again. Turn Airplane mode off and wait a minute, then look at the gallery on another device:
  they arrived on their own.
- Add a **long video** (a minute or more) and turn on Airplane mode when it is about half way.
  Close the tab, go back online and open the gallery: it carries on from about half, not zero.
- Pick a photo and tap its tile in the upload box: **Don't send** takes it out before it goes.

On a **kiosk tablet**, turn the wifi off and take two photos: each guest is done straight away,
the done screen says it goes to the gallery when the wifi is back, and the start screen shows
two photos waiting. Turn the wifi on and watch them go.

The **Privacy Policy** gained one line under "Technical information": photos waiting to upload are kept on
the guest's own device until they are sent.

- [ ] Sent photos picked in Airplane mode, on an iPhone and on an Android phone
- [ ] Saw a half-sent video carry on after closing the tab
- [ ] Took photos on a kiosk with the wifi off and saw them arrive

And **passkeys**, which need nothing but your phone:

- On your **iPhone**, sign in at `/login` with an email code (or your password). Open
  `/me`: a card offers **Sign in faster next time**. Tap **Add a passkey** and use Face ID.
  You get an email saying a passkey was added; check it arrived and does not look like spam.
- Sign out, open `/login` again and tap the email field: the passkey is offered above
  the keyboard. Pick it, use Face ID, and you are in. Try the **Sign in with a passkey**
  button too.
- On a laptop, open **Your account** (`/dashboard/account`): the passkey is listed with when
  it was last used. Rename it, then add one for the laptop. On a Mac the passkey usually syncs
  through iCloud Keychain, so the iPhone one may already work there.
- Remove one of them and try to sign in with it: it is refused, and the message says it was
  removed.

- [ ] Added a passkey on an iPhone and signed in with it
- [ ] Got the "passkey added" email
- [ ] Removed a passkey and saw it refused

And **watermarked proofs**, which need a Premium or Venue event that is taking uploads and
two accounts (yours as the owner, and a second as the photographer):

- As the photographer, open **Your account** and fill in **Watermark for proofs**: your
  words, a logo if you have one, a corner or "All over", and a note such as "Full photos are
  $15 each" with your email. The preview shows what your photos will look like. Save.
- Invite the photographer to the event's team (Contributor is enough). As the photographer,
  open the gallery, tap **Proofs off** so it reads **Proofs on**, and add three photos.
- On the dashboard, as the photographer: the three say **Your proof** and look clean, and a
  card counts them. As the owner: they say **Proof** and carry the watermark, and so does
  the download. As a guest on a phone: the watermark, and under the photo, your note and an
  **Ask about the full photo** link.
- As the photographer, select one and choose **Release clean photos**. Within a minute the
  owner and the guest see it clean. Then **Release all**.
- With proofs on, pick a video: the gallery says videos cannot be watermarked yet.

The **Privacy Policy** gained two lines under "What we collect from organizers": passkeys
(only the public key, never a face or fingerprint) and watermarks and proofs.

- [ ] Set up a watermark and uploaded proofs as a photographer
- [ ] Saw the watermark as the owner and as a guest, with the note and link
- [ ] Released one proof, then all of them

And **public profiles**, which need nothing but your own account:

- On **Your account**, open **Public profile**, tick **Make my profile public**, write a line
  about yourself and add your website. Save, then **View it**: it is at `/u/<your username>`.
- On one of your live events, open **Settings** and tick **List on my public profile**. Reload
  your profile: the event is there by name and date, and opens the gallery. A password
  gallery says "Password needed" and asks for it.
- Untick **Make my profile public**: the page is gone (it shows "not found").

- [ ] Made my profile public and listed an event
- [ ] Turned it off again, or left it on deliberately

And **referral credits**. Read the new "Referral credit" paragraph in the Terms and the
cookie line in the Privacy Policy first: both are new today. Then:

- Open **Your account** and copy your link from **Invite someone running an event**. Open it
  in a private window: it lands on the home page. Pick a plan: the signup page says
  "Invited by" you.
- Sign up there with a second email address. On `/admin`, find that account and grant it a
  plan as you normally would. Both accounts now show **$10** of credit, and your first
  account gets a "You earned $10" email.
- **How to honour credit:** when a customer with credit pays, refund that much of their
  payment in the Stripe Dashboard, then press **Use credit** on their card on `/admin` and
  record it, for example "Refunded $10 of their Premium payment". Nothing else is automatic.
- On a branded gallery (Klik Event plan), the line at the bottom now reads "Shared with klik ·
  Make a gallery for your own event", and links with the host's code.

If $10 each is the wrong amount, tell Claude; it is one line.

- [ ] Read the new Terms paragraph and the cookie line
- [ ] Followed a referral link through to a grant and saw both credits
- [ ] Know how to honour credit in Stripe

And **"download my data"**, which answers the requests you would otherwise handle by hand:

- On **Your account**, press **Download my data** and open the file. Check nothing in it
  surprises you; it is what anyone who asks will get.
- As a guest on a phone, at the bottom of a gallery you added photos to, press **Download
  everything I added**: a ZIP with your photos and a `data.json`.
- **When someone emails asking to be deleted:** for an organizer, use **Erase this account**
  at the bottom of their card on `/admin`, with a reason. For a whole event, delete it, then
  **Erase now** under "Recently deleted" on your dashboard.

The **Privacy Policy** now says guests and organizers can download their data themselves.

- [ ] Downloaded my own data and read the file
- [ ] Downloaded a guest's ZIP from a gallery

And **Spanish**, which every guest screen now speaks:

- **Have the Spanish consent checked by your lawyer** with the English one. It is in
  `lib/consent.ts`, under `translations`, and it is what Spanish-speaking guests agree to.
  A guest who agreed in Spanish is recorded as such.
- On your phone, open a gallery and tap **Español** at the bottom: everything a guest sees
  changes, including the camera and the upload box. Tap **English** to go back.
- On a phone set to Spanish, open a gallery you have never visited: it starts in Spanish.
- In an event's **Settings**, **Language guests see** can force Spanish (or English) for
  everyone, for a family wedding say. Guests can still switch.
- Have someone who speaks Spanish read the screens once, and send Claude anything that sounds
  stiff. The words are in `lib/i18n/guest.ts`.

Also new for everyone: a Premium gallery's custom colours are now kept readable (Settings
shows a preview), keyboard users stay inside the camera and viewer while they are open, and
"reduce motion" on a phone stops the animations.

- [ ] Spanish consent reviewed
- [ ] Switched a gallery to Español and back
- [ ] A Spanish speaker read the guest screens

And **billing after the sale**, three small habits and one setting:

- **When you grant a plan on `/admin`**, the form now asks what was paid: leave the
  list price for a normal sale, change it for a deal, or pick **Comp**. Paste the Stripe
  payment or receipt number if you like. `/admin/revenue` adds these up.
- **Turn on Stripe's customer portal** so customers can change their card and download
  invoices themselves: Stripe Dashboard, **Settings, Billing, Customer portal**, activate
  the "login link", and copy it (it starts `https://billing.stripe.com/p/login/`). Add it
  in Vercel as `STRIPE_BILLING_PORTAL_URL` (Production), then redeploy. Until then the
  billing page and payment emails give your email and phone instead.
- **Turn on Stripe's failed-payment emails and Smart Retries**: Stripe Dashboard,
  **Settings, Billing, Subscriptions and emails**. They retry the card for you.
- **When a Venue payment fails** (Stripe emails you), press **Payment failed** on that
  customer's Venue plan on `/admin`. They keep everything for 7 days and get three emails.
  When they pay, press **Payment received**. If they never do, their galleries stop taking
  photos after the 7 days; nothing is deleted.
- Organizers see all of it at **Billing** in their dashboard header.

- [ ] Granted a plan with the amount filled in, and saw it on /admin/revenue
- [ ] Set STRIPE_BILLING_PORTAL_URL in Vercel
- [ ] Turned on Stripe's failed-payment emails and Smart Retries

And one setting for photographers: **Keep camera details on the team's photos**, in a
Premium or Venue event's **Settings**. With it on, JPEGs the team uploads keep the camera,
lens, settings and copyright (and are not shrunk), and the location is still removed. The
Privacy Policy gained a paragraph saying so. Try it with one photo from a real camera and
check the details in your computer's file info after downloading it.

- [ ] Uploaded a camera JPEG with the setting on and saw its details kept, location gone

And two new dashboard views for every event, both built without any AI key:

- **Tidy up**, on the gallery tab, appears once there is something to tidy: the same photo
  sent twice, bursts of near-identical shots, and photos far blurrier than the rest. Each
  set shows which photo stays (tap another to keep that one instead) and nothing is deleted:
  the others are hidden from guests, with an Undo. Try it on a gallery with a few bursts.
- **Highlights**, a new tab: up to 20 photos picked for being sharp, well lit and loved, in
  the order they were taken, spread across the night. Pin or remove any of them; from the
  gallery, select photos and choose **Pin to highlights**. Older photos are measured by the
  04:00 job, so a gallery from before today fills in over the next day or two.

- [ ] Opened Tidy up and Highlights on an event with photos

And for you on `/admin`, under **Reports**: each reported photo can now be **sent to its
organizer to review** (they get an email saying what it was reported for, never who
reported it) or have its **whole gallery paused**. Pausing asks for the words the organizer
will read, apart from your note: never put a report number or what you found in that box.
A paused gallery shuts to guests, uploads and share links, its organizer keeps everything,
and **Paused galleries** on `/admin` reopens it. Try it once on a test event of your own.

- [ ] Paused and reopened a test gallery, and read both emails

### 11. Turn on the morning-after email

Guests can now leave their email when they join, with its own tick, and get **one** email
the morning after (9am where they are) with the 12 best photos and a link back. Then Klik
deletes the address. It is switched off until you do two things, because US law (CAN-SPAM)
requires a postal address in the footer of any email like it:

1. In Vercel, **Settings, Environment Variables**, add `COMPANY_POSTAL_ADDRESS` for
   Production: a real address where the business receives mail, on one line, for example
   `Kreativ Vantage, 123 Example St, Suite 4, Austin, TX 78701, USA`. A PO box or a
   registered mail service is fine. Redeploy. The entry sheet then shows the email field.
2. **Check your Resend plan.** The free plan sends 100 emails a day and 3,000 a month, and a
   single 200-guest wedding can pass the daily limit on its own morning. Resend **Pro** ($20 a
   month, 50,000 a month) removes the problem. Sends that are refused are retried twice, six
   hours apart, and then dropped.

Then try it: join one of your galleries on your phone, signed out, with your own email and
the tick. The email comes at 9am the next day (on Vercel Hobby, at the first job run after
that, which may be the 04:00 UTC cron; Pro, step 6, makes it on time). Check it is not in
spam, that the photos show, and that "Never email me a recap again" works. Hosts can turn the
offer off per event in **Settings**.

- [ ] Set COMPANY_POSTAL_ADDRESS in Vercel and redeployed
- [ ] Checked the Resend plan against the size of the events you expect
- [ ] Received a recap on a test event and pressed its unsubscribe link

---

## Keys Claude will ask for, in the order the work needs them

Nothing here is needed today. Each row says what it unblocks, so you can do it
early if you would rather not be asked mid-task.

| Needed for | What to create | What to give Claude |
|---|---|---|
| **OPS-1** video transcoding | Cloudflare dashboard, **Stream**, subscribe (from $5 a month). Then **My Profile, API Tokens, Create Token**, custom token, permission **Account, Stream, Edit**, scoped to this account only | The token, as `CLOUDFLARE_STREAM_API_TOKEN` in `.env.local` and Vercel Production. Claude creates the signing key and the webhook through the API, so you do not have to |
| **F-9** Sentry | sentry.io, project type **Next.js**, named `klik`. Then **Settings, Auth Tokens** with `project:releases` | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| **AI-2, AI-6** scene search, similar-scene grouping, safety screening (duplicates and highlights already work without it) | Cloudflare **API Tokens**, permission **Account, Workers AI, Read** | `CLOUDFLARE_AI_API_TOKEN` |
| **AI-5** cloud enhancement (restore, upscale, low light) | replicate.com, **Account, API tokens** | `REPLICATE_API_TOKEN` |
| **VEN-3** custom domains for venues | Vercel, **Account Settings, Tokens**, scoped to this team, plus the team id | `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID` |
| **GRW-6** print orders | prodigi.com, sign up, **Settings, API**: start with the sandbox key | `PRODIGI_API_KEY` (sandbox first) |
| **ACC** sign in with Google, optional | Google Cloud Console OAuth client. Redirect URI `https://klik.kreativvantage.com/api/auth/callback/google` | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |

---

## Soon

- [ ] **File the DMCA designation.** Brief already sent. $6, renews every three
      years. Not retroactive, so cover starts the day it is filed.
- [ ] **Diary the DMCA renewal**, three years out
- [ ] **Decide sales tax nexus** with an accountant (`ROADMAP.md` LAW-6)
- [ ] **Delete the old EU bucket**, `klik-media`, once you are happy nothing needs it.
      Production moved to `klik-media-us` on 7 October and the backup is
      `klik-media-backup`; the old one holds the original 12 test objects and costs
      next to nothing, so there is no hurry. Cloudflare dashboard, **R2**, the bucket,
      **Settings**, **Delete bucket**. Check the name twice.

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
