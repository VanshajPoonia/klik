# Your steps

**What this file is.** The things only you can do: accounts, money, legal,
dashboards, and anything needing a credential or a decision that is yours to
make. `ROADMAP.md` is the other half, what gets built, by task ID.

Keep this file. Tick things off in it rather than in chat, so the next person
reading the repo can see what was actually done and when.

**Keys.** Every key and setting Klik still needs, with each click, is in "Keys and
settings, step by step", below.

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

Without this, the first production failure is found by a customer. Steps 1 and 2 of
"Keys and settings, step by step", below, set it up and check it.

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
  payment in the Stripe Dashboard, then press **Use credit** on their page under `/admin` and
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
  on their page under `/admin` (find them in the Clients list), with a reason. For a whole event, delete it, then
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
2. **Know the daily cap.** Resend's free plan sends 100 emails a day, resetting at midnight
   UTC, so Klik stops itself at 80 (`lib/email.ts`). Recaps stop at 60, keeping the last 20
   for sign-in codes. Recaps over the cap are not lost: they go out after midnight UTC,
   oldest first, so a 200-guest wedding's recaps can take a few days. Resend **Pro** ($20 a
   month, no daily cap) makes them all go the same morning; raise `EMAIL_DAILY_LIMIT` and
   `BULK_EMAIL_DAILY_LIMIT` when you upgrade.

Then try it: join one of your galleries on your phone, signed out, with your own email and
the tick. The email comes at 9am the next day (on Vercel Hobby, at the first job run after
that, which may be the 04:00 UTC cron; Pro, step 6, makes it on time). Check it is not in
spam, that the photos show, and that "Never email me a recap again" works. Hosts can turn the
offer off per event in **Settings**.

- [ ] Set COMPANY_POSTAL_ADDRESS in Vercel and redeployed
- [ ] Decided whether the 80-a-day cap is enough for the events you expect
- [ ] Received a recap on a test event and pressed its unsubscribe link

### 12. Make a highlight reel (works today, no key)

On a Premium event with a dozen or so photos, open the **Highlights** tab and press **Make
the reel**, once without music and once with a song file from your computer. It takes
seconds in Chrome or Safari on a laptop. Watch it: the title card, the photos, the cut on
the beat, the end card with the QR code. Try **Add to the gallery**, and download one and
post it to a story from your phone to see how it looks there. Only use music you have the
right to post.

- [ ] Made a reel with and without music, and watched both

---

## Keys and settings, step by step

Checked on 2026-10-12 against what is in Vercel. **Already set and working:** the
database, `AUTH_SECRET`, sign-in emails (Resend), R2 storage and its backup bucket,
`CRON_SECRET` and `APP_URL`. **Everything below is not set yet.** Each one switches on
something already built and deployed; they are independent, so skip any you like.
Paths were checked against each provider's own documentation on 2026-10-12; if a screen
has moved, the provider's search box finds it by the name in bold.

Keys go into Vercel only, never into a chat or a file in the repo. When you have
redeployed, tell Claude which steps you did and it checks production.

| Step | Turns on | Variables | Time | Cost |
|---|---|---|---|---|
| 1 | Error emails to you | `ALERT_EMAIL` | 2 min | Free |
| 2 | Sentry error tracking | `NEXT_PUBLIC_SENTRY_DSN` | 10 min | Free |
| 3 | Continue with Google | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | 20 min | Free |
| 4 | Guests' morning-after email | `COMPANY_POSTAL_ADDRESS` | 2 min | Free; capped at 80 emails a day |
| 5 | An alarm if the nightly cleanup stops | `CRON_HEARTBEAT_URL` | 5 min | Free |
| 6 | Search, scenes, smart folders, screening | `CLOUDFLARE_AI_API_TOKEN` | 5 min | Under $1 for a 2,000-photo wedding |
| 7 | Videos play as streams | `CLOUDFLARE_STREAM_API_TOKEN` | 10 min | From $5 a month |
| 8 | Sharpen and enlarge | `REPLICATE_API_TOKEN` | 5 min | A fraction of a cent a photo |
| 9 | Venues' own domains | `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID` | 10 min | Free; when a Venue customer asks |
| 10 | Customers manage their own invoices | `STRIPE_BILLING_PORTAL_URL` | 5 min | Free; a link, not an API key |
| 11 | Prints | `STRIPE_SECRET_KEY`, `PRODIGI_API_KEY` | | Later: waits for Stripe's API |

### Adding a variable in Vercel (every step ends with this)

1. Open <https://vercel.com/vanshaj-poonias-projects/klik/settings/environment-variables>.
   (By hand: vercel.com → the **klik** project → **Settings** → **Environment Variables**
   in the left sidebar.)
2. In the form at the top of the page:
   - **Type**: **Secret** for tokens, keys and secrets, **Config** for everything else.
     Each step says which. A Secret can be replaced later but never read again.
   - **Key**: the name exactly as the step writes it.
   - **Value**: paste what you copied. No quotes, no spaces before or after.
   - **Environments**: tick **Production** only. Untick **Preview** and **Development**.
3. Press **Save**.

**Redeploying**, once after each batch, because a variable only reaches deployments made
after it:

1. At the top of the project, the **Deployments** tab.
2. The top row, marked **Production** and **Current**: press **⋯** at its right end, then
   **Redeploy**.
3. In the box, untick **Use existing Build Cache**, then press **Redeploy**.
4. Wait for **Ready**, about two minutes.

If a value has the wrong shape, that build fails with "Invalid environment configuration"
and the variable's name in its log, and the live site stays on the version before. Fix the
value (**⋯** → **Edit** on that variable's row) and redeploy again.

### 1. Error emails: `ALERT_EMAIL`

Also where organizers' messages to Klik are emailed (MSG-1), unless `SUPPORT_INBOX_EMAIL` is set to a different address. Optional: without either, messages still arrive on `/admin/messages`, only without an email.


Klik emails you when something fails in production, at most once per kind of failure
every 15 minutes.

1. Vercel: Type **Config**, Key `ALERT_EMAIL`, Value: the address that should get them.
2. Redeploy, or carry on and redeploy after step 2. The check is at the end of step 2.

### 2. Sentry: `NEXT_PUBLIC_SENTRY_DSN`

Sentry keeps every error from the server and from browsers, grouped, with where in the
code it happened and how often. Klik sends to it without Sentry's code library, and
strips names, emails and gallery links first.

1. <https://sentry.io/signup/>: sign up with email, Google or GitHub.
2. **Organization name**: `Kreativ Vantage`. **Data storage location**: **United States**.
   If it asks for a plan, the free **Developer** plan.
3. **Select a platform**: type `browser` in its search box and choose **Browser
   JavaScript**.
4. **Set your alert frequency**: leave **Alert me on high priority issues**. Klik's own
   alert email already covers every error.
5. **Project name**: `klik`. **Team**: leave it. Press **Create Project**.
6. The next page explains how to install Sentry's code. Ignore it: Klik needs none of it.
7. Left sidebar, **Settings** (the gear) → **Projects** → **klik** → in the project menu,
   **Client Keys (DSN)**. Press the copy button beside **DSN**. It looks like
   `https://1a2b3c4d@o4501234.ingest.us.sentry.io/4501234567`.
8. Same project menu → **Security & Privacy**. Under **Data Scrubbing**, turn on **Prevent
   Storing of IP Addresses**, and check **Data Scrubber** and **Use Default Scrubbers** are
   on. Changes save by themselves.
9. Vercel: Type **Config**, Key `NEXT_PUBLIC_SENTRY_DSN`, Value: the DSN. It is public by
   design: it can only send errors.
10. Redeploy.

**Check steps 1 and 2:**

1. Signed in to Klik as yourself, open <https://klik.kreativvantage.com/admin>.
2. Right click anywhere → **Inspect** → the **Console** tab.
3. Paste this and press Enter. If Chrome warns about pasting, type `allow pasting`, press
   Enter, and paste again.
   ```js
   fetch("/api/admin/test-error", { method: "POST" }).then((r) => r.json())
   ```
4. It prints `{ok: true, sentry: true, email: true}`.
5. Within a minute, Sentry's **Issues** page shows "A test error sent from /admin", and the
   `ALERT_EMAIL` inbox has an email about it.
6. In Sentry, open the issue and press **Resolve**.

### 3. Google sign-in: `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`

Adds **Continue with Google** to the sign-in page. Klik asks Google for name, email and
profile picture only, which the Privacy Policy already says. Worth knowing first:

- Someone new who continues with Google gets a Klik account, as with an email code.
- An email that already has a Klik account (made with a password or a code) cannot then
  use Google: it is told "That email already has a Klik account. Sign in the way you first
  did, or with an email code." That is Auth.js's safe default. Since Google confirms its
  users' emails, linking the two automatically is a small change; ask Claude if you want it.

**Make the project**

1. <https://console.cloud.google.com>, signed in with the Google account that should own
   this. A business account is better than a personal one. Accept the terms if asked.
2. In the top bar, the project picker (beside the Google Cloud logo) → **New project**.
   **Project name**: `Klik`. Leave **Location**. Press **Create**.
3. When the notification says it is ready, press **Select project**. From here on the top
   bar must say **Klik**.

**Set up the sign-in screen**

4. Open <https://console.cloud.google.com/auth/overview>, or search the top bar for
   **Google Auth Platform**. Press **Get started**.
5. **App Information**: **App name** `Klik`. **User support email**: choose your address
   in the dropdown. **Next**.
6. **Audience**: **External**. **Next**.
7. **Contact Information**: your email address. **Next**.
8. **Finish**: tick the box agreeing to the **Google API Services: User Data Policy**.
   **Continue**, then **Create**.
9. Left menu, **Branding**:
   - **Application home page**: `https://klik.kreativvantage.com`
   - **Application privacy policy link**: `https://klik.kreativvantage.com/privacy`
   - **Application terms of service link**: `https://klik.kreativvantage.com/terms`
   - **Authorized domains** → **Add domain** → `kreativvantage.com`
   - Leave **App logo** empty: a logo waits for Google's review before it shows.
   - Press **Save** at the bottom.
10. Left menu, **Data Access** → **Add or remove scopes**. In the panel, tick the three
    rows `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `openid`. Press
    **Update**, then **Save** at the bottom of the page.
11. Left menu, **Audience**. **Publishing status** says **Testing**: press **Publish app**,
    then **Confirm**. It now says **In production**. Without this, only test users you list
    by hand can sign in. These three scopes need no review from Google.

**Make the keys**

12. Left menu, **Clients** → **Create client**.
13. **Application type**: **Web application**. **Name**: `Klik production`.
14. **Authorized JavaScript origins** → **Add URI** → `https://klik.kreativvantage.com`
15. **Authorized redirect URIs** → **Add URI** →
    `https://klik.kreativvantage.com/api/auth/callback/google`
    exactly, with no slash at the end.
16. Press **Create**. A box shows the **Client ID** and **Client secret**. Press **Download
    JSON**, and copy both now: Google never shows the secret again. If it is ever lost,
    open the client, **Add secret**, and delete the old one.
17. Vercel: Type **Config**, Key `AUTH_GOOGLE_ID`, Value: the Client ID (ends
    `.apps.googleusercontent.com`).
18. Vercel: Type **Secret**, Key `AUTH_GOOGLE_SECRET`, Value: the Client secret (starts
    `GOCSPX-`).
19. Redeploy.

**Check:**

1. In a private window, open <https://klik.kreativvantage.com/login>. **Continue with
   Google** is there.
2. Use a Google account whose email has never used Klik. You land signed in, and
   <https://klik.kreativvantage.com/me> shows it.
3. Sign out and try a Google account whose email already has a Klik account. You see the
   "already has a Klik account" message.

If Google says `Error 400: redirect_uri_mismatch`, the URI in step 15 differs by a
character: fix it on the client's page (no redeploy needed) and wait a few minutes, as
Google's changes take a little while to apply. Google's screen shows your domain rather
than "Klik" until the branding is verified; that is normal. **Branding** → **Verify
branding** does it later, once you prove you own the domain.

### 4. Morning-after email: `COMPANY_POSTAL_ADDRESS`

1. Vercel: Type **Config**, Key `COMPANY_POSTAL_ADDRESS`, Value: one line, such as
   `Kreativ Vantage, 123 Example St, Suite 4, Austin, TX 78701, USA`. A real address where
   the business receives mail; a PO box or virtual mailbox is fine. US law (CAN-SPAM)
   requires it in the footer.
2. Redeploy.

Klik sends at most 80 emails a day (Resend's free plan allows 100), and recaps at most 60
of them, so sign-in codes always have room. Recaps past that go out the next day. Upgrade
Resend to **Pro** only if that wait matters.

**Check:** on your phone, signed out, join one of your galleries and leave your email with
the tick. The email arrives the next morning, after the 04:00 UTC job on Hobby. Check it is
not in spam, the photos show, and "Never email me a recap again" works.

### 5. Nightly cleanup alarm: `CRON_HEARTBEAT_URL`

Each night at about 03:00 UTC Klik deletes expired galleries, then pings this address. If
Vercel ever stopped running it, nothing would error; it would just go quiet. The monitor
emails you when a night's ping does not arrive.

1. <https://healthchecks.io> → **Sign Up** → your email → open the link it sends.
2. It opens a project. Press **Add Check** at the bottom of the list (or use the check it
   made for you), then click the check to open it.
3. Beside its name, **Edit**: name it `klik nightly cleanup`, **Save**.
4. **Change Schedule…** → the **Cron** tab: **Cron Expression** `0 3 * * *`, **Time Zone**
   `UTC`, **Grace Time** 2 hours (on Hobby a cron can run any time in its hour). **Save**.
5. Copy the **ping URL** shown on the check (`https://hc-ping.com/...`).
6. Vercel: Type **Secret**, Key `CRON_HEARTBEAT_URL`, Value: the ping URL.
7. Redeploy.

**Check:** the next morning, after 04:00 UTC, the check is green and says **up**. Alerts go
to your signup email; **Integrations** adds others.

### 6. Search, scenes, smart folders and screening: `CLOUDFLARE_AI_API_TOKEN`

Each photo gets a one-sentence description, never of who is in it, so guests can search
"the cake", photos group into scene chips, any search can be saved as a smart folder, and
nudity, gore and hate symbols are held back for the organizer.

1. <https://dash.cloudflare.com>, and pick the account that holds the `klik-media-us`
   bucket.
2. Search the dashboard (the search box at the top, or ⌘K) for **Workers AI** and open it.
3. Press **Use REST API**.
4. Press **Create a Workers AI API Token**. The form comes filled in, with Workers AI
   **Read** and **Edit** for your account; both are needed, so change nothing. Press
   **Create API Token**.
5. Press **Copy API Token**; it is shown once. Then **Finish**. The Account ID on that
   page is not needed.
6. Vercel: Type **Secret**, Key `CLOUDFLARE_AI_API_TOKEN`.
7. Redeploy.

Cost: Workers AI has a free allowance each day. On Cloudflare's free Workers plan, calls
past it fail until the next day, so once real events run, search the dashboard for
**Workers plans** and choose **Workers Paid** ($5 a month), which bills past the allowance
instead. Klik uses Meta's Llama 4 Scout model; if Cloudflare asks for Meta's licence to be
accepted, Klik accepts it by itself.

**Check:** upload three photos to a test event: a cake, people dancing, anything. Within a
minute or two the gallery shows a search box; search "cake". Once four photos share a
scene, scene chips appear. `/admin` shows nothing new under Reports for ordinary photos.
Photos already uploaded are described by the nightly job, newest first, 500 a night.

### 7. Videos as streams: `CLOUDFLARE_STREAM_API_TOKEN`

Optional. Videos are already made smaller and converted to H.264, which plays everywhere,
on the guest's own phone before they upload. A clip goes up as filmed only where the phone's
browser cannot convert it (an older phone, or HEVC in a browser that cannot decode it), and
in a browser without HEVC that one shows "This video won't play here" with a download.
Stream turns those into copies that play everywhere, gives any video without a preview
picture one, and streams long clips in pieces instead of downloading the whole file, which
helps on venue wifi.

1. Cloudflare dashboard, search for **Stream** and open it. If it offers plans, choose the
   smallest and complete the purchase. It bills by minutes of video stored and watched.
2. Open <https://dash.cloudflare.com/profile/api-tokens> (or the profile icon, top right
   → **Profile** → **API Tokens**) → **Create Token**.
3. Scroll to **Custom token** → **Get started**.
4. **Token name**: `klik stream`.
5. **Permissions**, the three dropdowns in one row: **Account**, **Stream**, **Edit**.
6. **Account Resources**: **Include**, then your account.
7. Leave **Client IP Address Filtering** and **TTL** empty.
8. **Continue to summary** → **Create Token** → **Copy**. It is shown once.
9. Vercel: Type **Secret**, Key `CLOUDFLARE_STREAM_API_TOKEN`.
10. Redeploy.

Klik makes its own signing key and points Stream's webhook at itself when the first video
goes up. Stream allows one webhook per Cloudflare account, so do not point it anywhere
else later.

**Check:** upload a short video to a test event. A few minutes later, open it on a laptop
in Chrome with **Inspect** → **Network** open: it loads `video.m3u8` from
`customer-....cloudflarestream.com`, not the whole file. Older videos are copied over by
the nightly job.

### 8. Sharpen and enlarge: `REPLICATE_API_TOKEN`

1. <https://replicate.com> → **Sign in**, with GitHub or email.
2. <https://replicate.com/account/billing>: add a card. Replicate bills per run, a
   fraction of a cent a photo; Klik allows 25 per event on Event and 100 on Premium and
   Venue.
3. <https://replicate.com/account/api-tokens>: **Token name** `klik-production` →
   **Create token** → copy it. It starts `r8_`.
4. Vercel: Type **Secret**, Key `REPLICATE_API_TOKEN`.
5. Redeploy. Klik finds the model's version and the webhook secret by itself.

**Check:** on the dashboard, open a photo, press the wand and confirm. Within a minute or
two the gallery tab's **Enhancements** panel shows the copy; try **Show it instead** and
look at it full size.

### 9. Venues' own domains: `VERCEL_API_TOKEN` and `VERCEL_TEAM_ID`

Do this when a Venue customer asks for `photos.theirvenue.com`. Nothing shows until then.

1. <https://vercel.com/account/settings/tokens>, the **Create Token** form:
   - **Token Name**: `klik domains`
   - **Scope**: **Vanshaj Poonia's projects**
   - **Expiration**: **No Expiration**, or a year with a reminder in your diary
   - **Create**, then **Copy**. It is shown once.
2. Vercel variables: Type **Secret**, Key `VERCEL_API_TOKEN`, Value: the token. Then Type
   **Config**, Key `VERCEL_TEAM_ID`, Value: `team_aLW6Esi8FZsGYiHtzCHZl99O` (the team's ID,
   from this repo's Vercel link; it is not a secret).
3. Cloudflare dashboard, search for **R2** → **R2 Object Storage** → the `klik-media-us`
   bucket → the **Settings** tab → **CORS Policy** → **Edit**. In the JSON, change only the
   origins line, which today lists `https://klik.kreativvantage.com` and
   `http://localhost:3000`, to `"AllowedOrigins": ["*"],` and press **Save**. This is safe:
   every upload and download link is signed and expires, and the rule only says which
   pages may use one. (The stricter choice is adding each venue's `https://` address to
   that list as it goes live.)
4. Redeploy.

**Check:** on a Venue account's dashboard, **Your own address**: add a subdomain you
control, add the records it shows at your DNS provider, and press **Check again** until it
says **Live**. Then open it on your phone, join, and upload a photo.

### 10. Billing portal link: `STRIPE_BILLING_PORTAL_URL` (optional)

A link copied from Stripe's dashboard, not an API key, so it fits selling through Payment
Links.

1. <https://dashboard.stripe.com/settings/billing/portal>, in live mode (the test mode
   switch off).
   Check the account name at the top left is Kreativ Vantage, not the sandbox.
2. Under **Ways to get started**, press **Activate link**.
3. Further down the same page, set what customers may do, then **Save**:
   - **Cancel subscription**: turn it **off** (it starts on). Klik does not hear from
     Stripe, so a cancel there would leave Venue switched on in Klik. Customers ask you,
     and you end it on `/admin`.
   - **Invoice history** and **Payment methods**: leave on, so customers find receipts
     and fix a failed card themselves.
   - **Switch plan**: leave off. There is one Venue plan.
   - **Terms of service link**: `https://klik.kreativvantage.com/terms`.
   - **Default redirect link**: `https://klik.kreativvantage.com/dashboard/billing`.
4. Copy the login link. It starts `https://billing.stripe.com/p/login/`.
5. Vercel: Type **Config**, Key `STRIPE_BILLING_PORTAL_URL`.
6. Redeploy. Until then, the billing page and payment emails give your email and phone
   instead.
7. <https://dashboard.stripe.com/settings/emails>: turn on **Successful payments**, so every
   buyer gets Stripe's receipt by email. The portal finds a customer by email, and a
   one-time pass bought through a Payment Link may be saved as a guest it cannot find, so
   this receipt is what pass buyers have.

**Check:** signed in, `/dashboard/billing` links to `billing.stripe.com`. Enter a Venue
customer's email there and Stripe emails them a sign-in link.

### 11. Later: prints (needs Stripe's API)

Plans keep selling through Payment Links, which need no key. Prints need
`STRIPE_SECRET_KEY`, because each order's price is made up at checkout, so they stay off,
with no button anywhere, until you decide to use Stripe's API. Do not set a Prodigi key
before then; on its own it does nothing. When you are ready:

1. Ask an accountant whether Klik must collect sales tax on prints.
2. <https://dashboard.prodigi.com>: sign up, **Settings** → **Integrations**, and copy the
   **sandbox** key.
3. Set Stripe's **test mode** secret key (`sk_test_...`, see `BILLING.md`) as
   `STRIPE_SECRET_KEY` and the Prodigi sandbox key as `PRODIGI_API_KEY`, both **Secret**.
   Redeploy.
4. On `/admin`, **Check the catalogue**. Order a 4×6 from a test gallery with card
   `4242 4242 4242 4242`, then on `/admin` press **What will Prodigi charge?** and **Send
   to the printer**.
5. When that works, set the live Stripe secret key, the live Prodigi key,
   `PRODIGI_ENV=live` and `PRINTS_ENABLED=1` together, and redeploy. Until
   `PRINTS_ENABLED=1` is set, prints stay off whatever keys exist, and the Terms
   and Privacy pages do not mention them. Set it in step 3 as well to test.

### Ticks

- [ ] 1. `ALERT_EMAIL` set
- [ ] 2. Sentry DSN set, and the test error seen in Sentry and by email
- [ ] 3. Google sign-in: a new account made, and the "already has an account" message seen
- [ ] 4. `COMPANY_POSTAL_ADDRESS` set
- [ ] 5. Heartbeat set, and the check says up the next morning
- [ ] 6. Workers AI token set, and a search that found something
- [ ] 7. Stream token set, and one video playing as a stream
- [ ] 8. Replicate token set, and one photo enhanced
- [ ] 9. Vercel token and team ID set, R2 CORS changed, and one venue domain live
- [ ] 10. Billing portal link set
- [ ] 11. Later, with Stripe's API: a sandbox print order end to end, then live keys

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
