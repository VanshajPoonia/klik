# When something goes wrong: the incident plan

**What this file is.** The plan for a security incident or a data breach, written
before one happens, because during one there is no time to work out who decides,
what to rotate, or who must be told by when. It names this system's real
credentials, logs and tables. Read it once now; follow it in order when it
matters.

**Not legal advice.** Notification law differs by state and changes. When step 4
applies, call a lawyer the same day. This plan gets you to that call with the facts
already gathered.

---

## Who decides

| Role | Who | Does |
|---|---|---|
| Incident lead | The account owner of Klik (today, Vanshaj) | Declares the incident, makes every call below, keeps the log |
| Engineering | Whoever holds the Vercel, Neon and Cloudflare logins | Contains and investigates |
| Legal | Outside counsel, chosen before you need one | Decides on notification wording and deadlines |

Write a single incident log from the first minute: a plain document with times,
what was seen, what was done and by whom. Regulators and insurers ask for it.

---

## 1. Contain, within the hour

Stop it first, understand it second. Each of these is safe to do on suspicion.

| If this may be exposed | Do this | What it breaks |
|---|---|---|
| **R2 keys** | Cloudflare, R2, Manage API Tokens, **Roll** the token, then update `R2_SECRET_ACCESS_KEY` in Vercel and redeploy. Rolling keeps the key id and changes the secret | Uploads and media until the redeploy lands, about two minutes |
| **`AUTH_SECRET`** | Generate a new one (`openssl rand -base64 32`), set it in Vercel, redeploy | Every organizer is signed out, and every guest must re-join their gallery. Unlock cookies for password galleries are invalidated too |
| **`DATABASE_URL`** | Neon, reset the role's password, update Vercel, redeploy | Everything for about two minutes |
| **`CRON_SECRET`** | New value in Vercel, redeploy | Nothing visible |
| **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`** | Stripe Dashboard, roll the key or endpoint secret, update Vercel | The embedded checkout, which nothing links to today |
| **`AUTH_RESEND_KEY`** | Resend, revoke and create a key, update Vercel | Outgoing email until updated |
| **One organizer's account** | `/admin`, reset their password. Changing the password increments `credential_version`, which ends that account's sessions on its next request | Their sessions |
| **One gallery** | Set it to private in its settings, or delete it (recoverable for 30 days) | Guest access to it |
| **A share link** | Revoke it from the event's Links tab. Revocation is checked on every request | That link, permanently |

A note on sessions: logins are JWTs, so there is no server-side list of sessions to
clear. Rotating `AUTH_SECRET` is the only way to end every session at once.

---

## 2. Work out what happened, within a day

Answer three questions, in the log: **what** was accessed, **whose** it was, and
**when** it started and stopped.

| Source | What it tells you | Where |
|---|---|---|
| `audit_log` table, `/admin/audit` | Every grant, revocation, delete, restore, address change, bulk change, team change and report decision, with who did it | Neon, or `/admin/audit` |
| `account_timeline` | Per account: grants, emails sent and refused | Neon, and the chain on `/admin` |
| `erasure_log` | Every erasure, with hashed subjects | Neon |
| Function logs | Every request's structured events (`upload.*`, `jobs.*`, `reports.*`, `purge.*`) | Vercel, Logs. Retention depends on the Vercel plan, so **export what you need on day one** |
| Error alerts | Anything reported through `reportError` | The `ALERT_EMAIL` inbox |
| R2 | Objects, and their last-modified times | Cloudflare, R2 |
| Neon point-in-time restore | The database as it was before | Neon, Branches. Restore to a **new branch** to look, never over production |

What Klik holds, so you know what a breach could touch:

| Who | What | Sensitivity |
|---|---|---|
| Guests | A display name (optional), consent time, an IP address for 24 hours in rate-limit keys, and their photos and videos. **No email, no account** | Photos can show faces, children, and where people were |
| Organizers | Name, email, username, a bcrypt password hash, their events and their customers' names, emails and phone numbers (Venue) | Personal information under most state laws |
| Payments | Stripe holds card details. Klik holds customer ids and amounts | Klik never sees a card number |

---

## 3. Fix the cause, and check the fix

Find the root cause, fix it, and verify the fix in production the way
`ARCHITECTURE.md` describes: against the real endpoints, not a green build. Then
restore anything the incident damaged, from the trash (30 days), the locked backup
bucket (31 days) or a Neon branch.

---

## 4. Decide who must be told

Every US state has a breach-notification law. In broad terms they apply when
**unencrypted personal information** was acquired, or reasonably believed acquired,
by someone unauthorized. What counts as personal information differs: most states
include a name with a password or account credentials, and several include
biometric data and photographs in some contexts.

Deadlines are short. Several states require notice within **30 days** of discovery,
many within 45 or 60, and the rest "without unreasonable delay". Some require
notice to the **state attorney general** as well once enough residents are
affected. Count the clock from when you knew, not from when you finished
investigating.

Call counsel with the log from step 2. Have ready: the number of people affected,
their states (organizers give a billing country through Stripe; guests give none,
which counsel will need to know), what was exposed, and what has been done.

**Child sexual abuse material is a separate duty**, not a breach question. If any
reaches Klik, a report to NCMEC's CyberTipline is required, and `/admin` Reports is
where it is handled (see `LAUNCH.md`).

---

## 5. Tell people, plainly

Whatever counsel says the law requires, the message to the people affected should
say what happened, what of theirs was involved, what Klik has done, and what they
should do. Organizers are emailed through Resend from the same address as account
mail. Guests have no email on file, so reaching them goes through the organizer of
their event.

---

## 6. Afterwards

Within two weeks, write down what happened, why, and what changes so it cannot
happen the same way again, and add those changes to `ROADMAP.md`. Then update this
file with anything it should have said.

---

## Before you need it

- [ ] Choose outside counsel and keep their number here: ______
- [ ] Check whether your insurance covers a data breach, and how to claim
- [ ] Confirm Neon point-in-time restore is on (`LAUNCH.md`, step 5)
- [ ] Set `ALERT_EMAIL`, so you hear about problems (`LAUNCH.md`, step 4)
- [ ] Practise step 1 once: roll the R2 secret on a quiet day and time it
