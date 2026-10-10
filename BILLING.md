# Billing

Everything about taking money in Klik: what exists, how it works, what is
deliberately not automated, and what to do next.

## Status

| | |
|---|---|
| Embedded Stripe Checkout | Built, verified |
| Webhook, signed and idempotent | Built, verified against the live API |
| Database tables | Migrated, in production |
| Pricing page buttons | Open an explainer dialog, then signup, then Stripe's **hosted** page |
| Buying without an account | Not possible. The hosted link is never rendered to a signed-out visitor |
| Onboarding email | Built, **cannot send**: no Resend key and no verified sender |
| How money is taken today | Stripe-hosted Payment Links. No keys, no webhook, nothing to deploy |
| Embedded checkout at `/checkout` | Built and working, **not linked from anywhere**. Waiting on a decision, not on code |
| Production Stripe keys | Not set. Only the embedded path needs them |
| Dashboard webhook endpoint | Not created. Only the embedded path needs it |
| A payment granting a plan | **Never automatic.** True of both paths. See "The grant is manual" |
| What grants capability | **The `entitlements` ledger** (ACT-1, 2026-10-08). A pass licenses one event; Venue licenses up to its limits. `users.plan_key` is retired and read nowhere |
| What a grant was paid | **Recorded by the superadmin when granting** (2026-10-10): the list price by default, 0 for a comp, plus Stripe's payment reference if wanted. Feeds `/admin/revenue`. Klik still charges nothing itself |
| A failed Venue payment | **A 7-day grace a superadmin starts** on the grant (PAY-8), with three emails to the organizer; recording the payment ends it, and the daily reconcile lapses it otherwise |
| Receipts and card changes | **Stripe's**, through its no-code customer portal link (`STRIPE_BILLING_PORTAL_URL`) when set, a person otherwise. Shown on `/dashboard/billing` |
| A new account's capability | **Drafts only.** It can create events and set them up; none goes live, shows a QR code or takes a guest until a superadmin grants something |

## The two Stripe accounts

They are unrelated, and confusing them is the easiest mistake to make here.

| Account | ID | Holds | For |
|---|---|---|---|
| Kreativ Vantage, live | `acct_1THQ9kBaW05Ewcp3` | The real products, the Payment Links, the live keys | Production |
| Sandbox | `acct_1UNHUaDaaergD8Nq` | Copies of the three products | Local development only |

The sandbox was provisioned from the git email `vanshajtheunique@gmail.com`, so
it is a standalone account rather than a sandbox inside Kreativ Vantage. Nothing
in it is visible from the real Dashboard.

**It expires 2026-10-12 unless claimed.** `stripe sandbox claim`. After that the
keys in `.env.local` stop working and the three test products go with them.

| Plan | Live Price | Sandbox Price |
|---|---|---|
| Klik Event, $39 one-time | `price_1UNGPeBaW05Ewcp3KnQo6a5b` | `price_1UNHcIDaaergD8NqqBmiYvI8` |
| Klik Premium, $89 one-time | `price_1UNGQmBaW05Ewcp35QI0P63S` | `price_1UNHcKDaaergD8Nq9aRjGvde` |
| Klik Venue, $69 per month | `price_1UNGQPBaW05Ewcp3cfrkX1WN` | `price_1UNHcLDaaergD8NqEuHxwTD5` |

## How it works

### The payment is embedded, not a redirect

Stripe's form renders in an iframe inside Klik's own `/checkout` page. The
customer never leaves the site.

```
organizer clicks a plan on /#pricing
  -> /checkout?plan=event                 Klik's page, signed-in only
     (signed out: /login?next=... and back here after)
  -> POST /api/billing/checkout           body is {planKey} and nothing else
  -> Klik asks Stripe for a Session       Price resolved server side, from env
  -> { client_secret } back to browser    never a redirect to session.url
  -> form mounts in a Stripe iframe       card details go iframe -> Stripe
  -> customer confirms                    browser reports success

meanwhile, separately:
Stripe -> POST /api/webhooks/stripe       signed, server to server
       -> purchase recorded

later:
superadmin -> /admin -> grants the plan
```

Three things in that diagram are load-bearing.

**The browser never names a price.** It sends `{planKey: "event"}`. The server
maps that to a Price ID from the environment. A hand-edited request can change
which plan is bought but never what it costs.

**It returns JSON rather than redirecting.** A 303 to `session.url` would send
the whole tab to Stripe's hosted page, silently swapping the embedded
integration for a different one that still happens to take money. That is a very
hard bug to see in review.

**The browser's success is not evidence.** It is a claim from a client we do not
control, so nothing is written from it. The webhook is the record.

### The webhook is the only thing trusted

[app/api/webhooks/stripe/route.ts](app/api/webhooks/stripe/route.ts), in order:

1. Reads the **raw bytes**. The signature is over the bytes, and parsing then
   re-serialising breaks the check for reasons that look nothing like the cause.
2. Rejects anything whose signature does not verify. Anyone can POST to a public
   URL, so an unsigned body is not evidence of anything.
3. **Claims the event id** in `stripe_webhook_events` before any work. Stripe
   delivers at least once and retries for days, so duplicates are normal. The
   primary key does the excluding, so two concurrent deliveries cannot both win.
   A duplicate answers 200, since Stripe should stop retrying something done.
4. Records the purchase, subscription or refund.
5. On a throw: stores the error, releases the claim, answers 500 so the retry
   can work. An event that keeps its claim after failing never completes, and
   that row is the only trace of a payment that did not land.

### Buying starts with an account

A plan button on the pricing page does not link to Stripe. It opens
[components/marketing/plan-dialog.tsx](components/marketing/plan-dialog.tsx),
which says what the next few minutes hold, and its one link goes to
`/signup?plan=<key>`.

```
visitor clicks a plan on /#pricing
  -> dialog: pay, kit ready within 24 hours, support number
  -> /signup?plan=event
     already signed in: 307 straight to the Payment Link
     signed out:        the form, then POST /api/signup
  -> account created, activated_at NULL, welcome email sent
  -> signed in, then window.location.replace(PAYMENT_LINKS.event)
  -> Stripe's hosted page takes the money

meanwhile:
organizer signs in, creates their event as a draft, sets it up
  -> optionally presses "Ask Klik to activate it", which emails ALERT_EMAIL
     and puts the draft at the top of /admin under "Waiting to go live"

later:
superadmin -> Stripe Dashboard, find the payment by email
           -> /admin, grant a pass with a reason
           -> the pass lands on their waiting draft, which goes live
           -> access email goes out automatically, naming that event
  -> gallery, QR code and printable sign exist from that moment
```

### Nothing about activation is silent

Assigning a plan sends the access email itself, through
[lib/activation-notice.ts](lib/activation-notice.ts). There is no second button
to remember, for the same reason assigning a plan is also what sets
`activated_at`: a grant that needs two clicks gets one, and the person who
forgets the second is never the person who waits.

Three details worth knowing before changing any of it.

**It fires on the transition only.** The route reads `activated_at` *before* its
own update, because `COALESCE` makes the column look identical afterwards either
way. Correcting somebody's plan a month later sends nothing, since "you are all
set" arriving out of nowhere reads as a billing problem.

**The timestamp means the provider accepted it.** `users.activation_email_sent_at`
is written after the send, never before. The column exists to answer one support
question, "I paid and never heard anything", and an optimistic timestamp answers
it with a yes worth nothing.

**The send can never cost the grant.** `sendActivationNotice` reports its outcome
instead of throwing, and the result travels back in the PATCH response so the
superadmin sees it while they are still looking at the screen. An account with no
email on file is a normal outcome, not an error: `/admin/new` creates accounts
with a username and no address, and the panel says so rather than implying a
mail went out.

Re-sending is `POST /api/admin/clients/[userId]/activation-email`, surfaced as
"Send again" on the client card. It refuses an account that is not active yet,
because the mail says their access is open. It is rate limited per recipient, not
per admin: the thing being protected is one person's inbox against a
double-click, and the route already demands a superadmin.

### The chain, and the history behind it

Every client card on `/admin` carries seven steps, always in the same order and
including the ones already done, so a page of accounts can be scanned for the one
that is stuck:

```
1. Account created      users.created_at
2. Welcome email        account_timeline
3. Payment confirmed    NOT OBSERVABLE: see below
4. Plan assigned        users.activated_at
5. Access email         users.activation_email_sent_at
6. Event created        events, excluding soft-deleted
7. Guests uploading     media, excluding soft-deleted
```

Each step is `done`, `waiting`, `action` or `unknown`, and **only `action` is
coloured**. That distinction is the point: most incomplete steps are the
customer's turn, and a panel where everything incomplete looks urgent stops being
read. `resolveChain` in [lib/timeline.ts](lib/timeline.ts) is a pure function and
[lib/timeline.test.ts](lib/timeline.test.ts) is where its judgement is pinned
down.

**Step 3 is the honest one.** A Stripe-hosted Payment Link reports to Stripe and
tells this application nothing, so there is no way to tick it from data. It reads
`action` with the address to search Stripe for, and flips to `done` the moment a
plan is assigned, because assigning the plan *is* a human confirming the payment.
That is the whole workflow, so recording it twice would be theatre.

**The chain is derived, never stored.** The state columns and `account_timeline`
are the inputs. A stored copy of the answer would be one more thing to disagree
with them.

`account_timeline` is append-only: rows are written and never updated or deleted,
and a correction is another row. It carries what present state cannot, which is
everything that *happened* rather than everything that is currently true: emails
that were refused, who granted a plan, and a plan corrected twice. `actor_label`
denormalises the admin's name at the time, because the FK goes null when an
account is removed and "somebody granted this" is worth much less than a name.

Two deliberate choices in [drizzle/0015_account_timeline.sql](drizzle/0015_account_timeline.sql).
There is **no CHECK constraint on `kind`**, because a rejected insert loses a
record and this table exists so records are not lost; an unrecognised kind is a
cosmetic problem, a refused insert is a hole in the history. And `user_id`
**cascades**, despite this being a log, because `lib/erasure.ts` hard-deletes the
users row and an erasure that leaves someone's address in an audit trail is not
an erasure.

`recordAccountEvent` never throws. Every call site is more important than its own
log entry: losing the entry is a worse history, but letting the entry lose the
activation is a customer who paid and got nothing.

Three things about the buying flow are load-bearing.

**The plan key crosses the gap, never a URL.** `/signup?plan=venue` carries one
of three known keys and the destination is resolved from `PAYMENT_LINKS` on the
server. A `?next=` would hand the choice of redirect target to whoever wrote the
link, and [lib/safe-redirect.ts](lib/safe-redirect.ts) cannot help here because
the legitimate destination is off-origin by design.

**The dialog needs no session, so `/` stays static.** Resolving signed-in state
in `Pricing` would make the marketing home page server-rendered on every visit.
Instead both cases go to `/signup?plan=`, and that page redirects whoever is
already signed in. Confirmed: `/` is still prerendered after this change.

**A signed-out visitor is never shown a `buy.stripe.com` URL.** It is not in the
page, not in the client bundle, and `PAYMENT_LINKS` is imported only by server
components. Buying therefore cannot happen without an email address attached to
an account, which is the only thing that later joins the payment to the buyer.

### What grants capability: the entitlement ledger

**Rewritten 2026-10-08 for ACT-1.** This section used to say `users.activated_at`
gates event creation. It no longer does, and `users.plan_key` is read nowhere.

`users.plan_key` was `NOT NULL DEFAULT 'event'`, so every account looked like it
owned the $39 plan, and because the plan sat on the account, one $39 pass meant
one new event every month for ever. The ledger replaces it
([drizzle/0018_entitlements.sql](drizzle/0018_entitlements.sql),
[lib/entitlements.ts](lib/entitlements.ts)):

| Grant | Shape | Licenses |
|---|---|---|
| Klik Event, Klik Premium | A **pass**, `scope = 'event'` | Exactly one event, once. `applied_at` marks it spent permanently, so a purged event never hands its pass back |
| Klik Venue | An **account grant**, `scope = 'account'` | Any of the owner's events, up to `max_active_events` and `max_events_per_month` copied onto the grant when it was made |

An event is a **draft** until something licenses it (`events.licensed_at` null):
the organizer can name it, date it and design it, and nobody else can see it, upload
to it, or get a QR code for it. **Live** when `events.entitlement_id` is set.
**Lapsed** when a licence is revoked or a grant ends: guests keep the gallery for the
rest of its window and uploads stop. Upload and gallery windows run from going live,
not from creation, so a draft made months ahead does not arrive already closed.

Limits are enforced by the trigger in 0018, which locks the grant row first, so two
events racing for the last Venue slot or for the same pass cannot both win. The old
plpgsql triggers that hard-coded "venue is 5, everything else is 1" are gone; the
numbers now come from the grant, which got them from `lib/plans.ts`.

`users.activated_at` still exists and still means "this account has been granted
something at least once". It decides whether the dashboard says "No plan yet" and
whether a grant sends the access email, and nothing else.

Every grant carries `source`. Today every row is `admin`, because of the rule below.

### The Payment Links are what the site actually uses

Three links at `buy.stripe.com`, one per plan, held in
[lib/billing-plans.ts](lib/billing-plans.ts) and reached through signup. They are
a self-contained hosted checkout that **bypasses everything above**: Stripe hosts
the page, the customer leaves Klik to pay, and no key, webhook or deploy is
involved.

The trade is that Klik learns nothing. A purchase through one appears in the
Stripe Dashboard and nowhere else: no row in `purchases`, no `stripe_customers`
entry, and no way for any code here to know it happened. It is matched to an
account by the email the buyer typed, and activated by hand.

What changed is who can reach them. The links are no longer rendered to a
visitor: they are resolved in [app/signup/page.tsx](app/signup/page.tsx), a
server component, so the buyer has an account with an email on it by the time
Stripe's page opens. That email is the whole of the audit trail.

**Switching to the embedded form is one line**, and it has moved. It is the
`payUrl` in [app/signup/page.tsx](app/signup/page.tsx): point it at
`/checkout?plan=${planKey}` instead of `PAYMENT_LINKS[planKey]`, once the keys
and the webhook endpoint from step 4 are in place. The signup gate, the dialog
and the activation column all work unchanged either way, because none of them
know or care which Stripe integration takes the money.

| Plan | Link |
|---|---|
| Klik Event | https://buy.stripe.com/8x27sK88b75LbVgbKS2cg03 |
| Klik Premium | https://buy.stripe.com/dRmaEW2NR9dT6AW7uC2cg01 |
| Klik Venue | https://buy.stripe.com/cNifZg603bm1aRc6qy2cg02 |

A Payment Link grants nothing on its own. Nothing does: see below.

## The grant is manual, on purpose

**The webhook never writes an entitlement.** A payment is recorded and then waits
for a superadmin, who grants a pass or Venue with the control on each client's card on
`/admin`, with a required reason. `POST /api/admin/clients/[userId]/entitlements`
does the grant; `POST /api/admin/entitlements/[id]/revoke` takes one back, also with a
reason, lapsing what it licensed and deleting nothing. Confirmed on 2026-10-08: payments
keep human approval. Automating it would be one handler writing `source = 'stripe'`
rows, and nothing else would change.

There are two queues on that page, and only one of them has anything in it.

| Panel | Reads | State today |
|---|---|---|
| "Paid, awaiting activation" | `purchases` | **Always empty.** Only the webhook writes that table, and the hosted Payment Links reach no webhook |
| "Signed up, not activated" | `users` where `activated_at IS NULL` and (`organizer_intent_at IS NOT NULL` or they own an event) | The real queue, with the email needed to find the payment in Stripe |

The second exists because of what the first cannot see. A Payment Link payment
appears in the Stripe Dashboard carrying an email and nothing else, and before
this panel a self-signup appeared nowhere in `/admin` at all: the client list is
built from accounts that already have an event, and a new signup has neither an
event nor a plan. Matching money to a person was impossible, not merely manual.

**Since ACC-2 (2026-10-09) not every account without a plan is a customer.** A guest
can sign in with an email code to keep the galleries they joined, which makes a `users`
row with no plan and no intention of buying one. Listing those would bury the real
queue, so the panel reads `users.organizer_intent_at`, which is set by:

- `POST /api/signup`, because that form is for running events;
- `/signup?plan=<key>` when the visitor is already signed in, **before** the redirect to
  the Payment Link, so a guest account that buys still lands in the queue.

Every pricing button goes through `/signup?plan=`, so every purchase made through the
site sets it. A Payment Link opened directly, from a shared URL, does not; that buyer is
found by email on `/admin/search`. Accounts that existed before this were backfilled
with their `created_at`.

This is ROADMAP ACT-2: "This is the v1 revenue mechanism: a human decides."

ACT-1 shipped on 2026-10-08, tested against a real Postgres including the trigger,
concurrent spends of one pass, and the migration's backfill run straight out of the
SQL file (`test/entitlements.dbtest.ts`).

The buyer is told this before paying, on the checkout page. Someone who is not
told reads the delay as a failure and asks for their money back.

## Billing after the sale (PAY-5, PAY-8, ADM-2), 2026-10-10

Built to fit the rule above rather than to work around it: nothing here charges,
refunds or grants by itself.

- **Grants say what was paid.** The grant form on `/admin` now asks "Paid $… "
  (prefilled with the plan's list price from `lib/plans.ts`, `priceCents`) or
  "Comp", and takes Stripe's payment or receipt number optionally. Stored on
  `entitlements.amount_cents` and `stripe_ref` (`drizzle/0043_grant_payments.sql`).
  Grants made before this have `amount_cents` null and count as "not recorded".
- **`/admin/revenue`** (ADM-2) adds up what was recorded: this month by plan, the
  last twelve months, what running Venue plans bring in a month, and referral
  credit owed. It says plainly that Stripe's Dashboard is the record of money.
  The `purchases` and `subscriptions` tables stay empty and unused, as before.
- **`/dashboard/billing`** (PAY-5) shows an organizer their passes (used, unused)
  and Venue plan, their credit, how to buy another event (through `/signup?plan=`,
  like the pricing buttons), and receipts and card changes: Stripe's customer
  portal when `STRIPE_BILLING_PORTAL_URL` is set, the support email and phone
  otherwise.
- **A failed Venue payment** (PAY-8). Stripe tells you, not Klik. Press **Payment
  failed** on that Venue grant on `/admin`: everything keeps working for 7 days
  (decision C-6), `ends_at` is set a week out, and the organizer is emailed now,
  on day 3 and on day 6 (`notify.grace` jobs, `lib/billing-grace.ts`), each
  pointing at the portal when there is one. **Payment received** clears the end
  date and silences the reminders. If nothing is pressed, the daily reconcile
  lapses the plan at the end: galleries stop taking photos and stay viewable and
  downloadable, and nothing is deleted. Stripe's own failed-payment emails and
  Smart Retries are worth turning on as well; they cost nothing.

## What each piece is for

### Environment

| Variable | For | Read by |
|---|---|---|
| `STRIPE_SECRET_KEY` | Authenticates the server to Stripe | [lib/stripe.ts](lib/stripe.ts) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Initialises Stripe.js in the browser. Public by design | [embedded-checkout-form.tsx](components/billing/embedded-checkout-form.tsx) |
| `STRIPE_PRICE_EVENT` | What Klik Event costs | [lib/billing-plans.ts](lib/billing-plans.ts) |
| `STRIPE_PRICE_PREMIUM` | What Klik Premium costs | [lib/billing-plans.ts](lib/billing-plans.ts) |
| `STRIPE_PRICE_VENUE_MONTHLY` | What Klik Venue costs | [lib/billing-plans.ts](lib/billing-plans.ts) |
| `STRIPE_WEBHOOK_SECRET` | Proves a webhook came from Stripe | [webhooks/stripe/route.ts](app/api/webhooks/stripe/route.ts) |
| `AUTH_RESEND_KEY` | Sends the onboarding email. Shared with sign-in links, same account | [lib/email.ts](lib/email.ts) |
| `AUTH_EMAIL_FROM` | Who the onboarding email comes from. No default on purpose: Resend rejects any unverified domain, and a fallback would turn "nobody set this" into "the provider refuses every send" | [lib/email.ts](lib/email.ts) |

All six are optional in [lib/env.ts](lib/env.ts), like Google and Resend. Without
the secret key the checkout route answers 503 and nothing else in Klik changes. A
plan with no Price answers 503 on its own without affecting the other two.

Each is shape-checked when present, so a truncated paste, the publishable and
secret keys swapped into each other's slot, or a Payment Link URL pasted where a
Price ID belongs all fail at boot rather than at someone's payment form.
`STRIPE_SECRET_KEY` accepts `sk_`, `rk_` and `rkcs_`, because the sandbox keys
the CLI issues are restricted keys and rejecting them would mean the documented
way to get a test environment fails validation.

The `NEXT_PUBLIC_` prefix is load-bearing: Next inlines only prefixed variables
into the client bundle, so an unprefixed name is `undefined` in the browser with
no build error to say why.

### Code

| File | Job |
|---|---|
| [lib/billing-plans.ts](lib/billing-plans.ts) | Plan to Price and charge mode, and whether a plan is buyable. No Stripe SDK, so the marketing page can ask without pulling it in |
| [lib/stripe.ts](lib/stripe.ts) | The Stripe client and the pinned API version |
| [lib/billing.ts](lib/billing.ts) | Customer lookup, and the handlers the webhook calls |
| [lib/billing-admin.ts](lib/billing-admin.ts) | "Who paid and is still waiting", and "who pays for Venue but is not on Venue" |
| [app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) | Creates the Session, returns the client secret |
| [app/api/webhooks/stripe/route.ts](app/api/webhooks/stripe/route.ts) | Verify, claim, dispatch |
| [app/checkout/page.tsx](app/checkout/page.tsx) | Auth gate, plan validation, expectations |
| [components/billing/embedded-checkout-form.tsx](components/billing/embedded-checkout-form.tsx) | Loads Stripe.js, mounts the iframe, wires confirm |
| [components/admin/pending-activations.tsx](components/admin/pending-activations.tsx) | The panel at the top of `/admin` |
| [components/marketing/pricing.tsx](components/marketing/pricing.tsx) | The three buy buttons, each opening the dialog rather than linking out |
| [components/marketing/plan-dialog.tsx](components/marketing/plan-dialog.tsx) | What a plan button does now: pay, wait, who to call. Native `<dialog>`, so the focus trap and Escape are the browser's |
| [app/signup/page.tsx](app/signup/page.tsx) | Resolves `?plan=` to a Payment Link server side, and redirects anyone already signed in |
| [app/api/signup/route.ts](app/api/signup/route.ts) | Creates the account with `activated_at` null, then sends the welcome email |
| [lib/signup.ts](lib/signup.ts) | The rules for a valid signup, kept pure so they are testable |
| [lib/email.ts](lib/email.ts) | Resend wrapper. Reports instead of throwing, because an account must survive a failed send |
| [lib/emails/onboarding.ts](lib/emails/onboarding.ts) | The welcome email, HTML and text |
| [lib/support.ts](lib/support.ts) | The support number and the stated wait, in one place |
| [lib/entitlements.ts](lib/entitlements.ts) | The ledger: grant, spend a pass, license, revoke, reconcile |
| [lib/license.ts](lib/license.ts) | Pure: is an event a draft, live or lapsed, and which plan governs it. Read from the event row, no query |
| [components/admin/grant-control.tsx](components/admin/grant-control.tsx) | Grant a pass or Venue, with a reason, to the next event or a named one |
| [components/admin/entitlement-list.tsx](components/admin/entitlement-list.tsx) | Every grant an account has had, with revoke |
| [components/dashboard/license-banner.tsx](components/dashboard/license-banner.tsx) | What a draft or lapsed event is waiting for, and the button that moves it on |
| [components/admin/pending-signups.tsx](components/admin/pending-signups.tsx) | The queue that actually has rows in it |
| [components/dashboard/awaiting-activation.tsx](components/dashboard/awaiting-activation.tsx) | What a signed-up, unactivated account sees |
| [components/dashboard/support-card.tsx](components/dashboard/support-card.tsx) | The support number on every organizer's dashboard |
| [lib/billing.test.ts](lib/billing.test.ts) | Charge mode per plan, invoice shape parsing |
| [lib/signup.test.ts](lib/signup.test.ts) | Email normalisation, the bcrypt 72-byte ceiling, a password that restates the address |
| [lib/emails/onboarding.test.ts](lib/emails/onboarding.test.ts) | The welcome email links to the plans, states the wait, and escapes the name |
| [lib/safe-redirect.ts](lib/safe-redirect.ts) | Narrows an untrusted `?next=` to a path inside Klik, so sign-in cannot be turned into an open redirect |

### Tables

Created by [drizzle/0012_stripe_billing.sql](drizzle/0012_stripe_billing.sql).

| Table | Holds | Why it is shaped that way |
|---|---|---|
| `stripe_customers` | One Customer per organizer | A returning buyer keeps saved cards and appears once in the Dashboard, not once per purchase |
| `purchases` | Event and Premium, one row per payment | `consumed_at IS NULL` is an unused pass. The unique session id is what stops a retry double-granting |
| `subscriptions` | Venue, mirrored from Stripe | `/admin` reads a table instead of calling Stripe on page load. `status` has no check constraint, because the vocabulary is Stripe's and an unknown value must be stored rather than bounce the webhook into endless retries |
| `stripe_webhook_events` | Every event id seen | The idempotency ledger, claimed before any work |

Amounts are integer minor units. Money is never a float.

## Next steps

### 0. Apply the migration, before deploying

```
npm run db:migrate -- 0013_self_signup.sql
```

**Before the push, not after.** `lib/auth.ts` reads the whole `users` row when a
credential login is checked, so the deployed code selects `activated_at` and
`created_at` the moment it is live. Deploying first means every sign-in on Klik
fails until this runs.

### 0b. Configure the sender, or the welcome email never goes out

```
AUTH_RESEND_KEY    re_...                            (both are empty today)
AUTH_EMAIL_FROM    Klik <no-reply@klik.kreativvantage.com>
```

The address has to be on a domain verified in the Resend account. Both variables
also gate "Continue with email" on the login page, which is deliberate: the
provider is not registered without a sender, so a button shown on the key alone
would fail on every click. Until they are set, `/api/signup` logs `email.not_configured` and creates
the account anyway: somebody who has paid must never lose an account because a
welcome message could not be sent.

### 1. Test a Payment Link

Open https://buy.stripe.com/8x27sK88b75LbVgbKS2cg03 and pay the $39 with a real
card, or refund yourself afterwards. These are live links taking real money, so
this is the one check worth doing before anyone else clicks them: confirm the
page looks right, the product name and price are correct, and the payment lands
in your Stripe Dashboard.

Nothing else is needed to start selling. Everything below is optional.

### 2. Claim the sandbox

```
stripe sandbox claim
```

Deadline **2026-10-12**. Cheapest item here, hardest to recover if missed.

### 3. Run one real card payment locally (only for the embedded path)

The only part not yet exercised through the UI. Two terminals:

```
stripe listen --api-key <sandbox secret> --forward-to localhost:3000/api/webhooks/stripe
npm run dev
```

Sign in, open `/checkout?plan=event`, pay with `4242 4242 4242 4242`, any future
expiry, any CVC. Expect: the form renders in the page, `stripe listen` prints
`checkout.session.completed`, and `/admin` grows a "Paid, awaiting activation"
panel. Repeat with `?plan=venue`, which is the subscription path and different
code.

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure |
| 4000 0000 0000 9995 | Declined, insufficient funds |

Full list: https://docs.stripe.com/testing

### 4. Wire production (only for the embedded path)

Only after step 2 passes.

Dashboard, live mode, Developers, Webhooks, add endpoint
`https://klik.kreativvantage.com/api/webhooks/stripe` subscribed to:
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`, `charge.refunded`.

Then six variables in Vercel Project Settings **and a redeploy**, since a
variable added without one never reaches the running build:

```
STRIPE_SECRET_KEY                   sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  pk_live_...
STRIPE_PRICE_EVENT                  price_1UNGPeBaW05Ewcp3KnQo6a5b
STRIPE_PRICE_PREMIUM                price_1UNGQmBaW05Ewcp35QI0P63S
STRIPE_PRICE_VENUE_MONTHLY          price_1UNGQPBaW05Ewcp3cfrkX1WN
STRIPE_WEBHOOK_SECRET               whsec_...  (from the endpoint above, not the local one)
```

The pricing buttons point at the hosted Payment Links and will keep doing so
until someone changes that one line. Setting these variables does not switch
them over by itself.

### 5. Alert on the webhook (only for the embedded path)

ROADMAP F-9 names this route alongside the purge cron as one that fails silently
by nature. A webhook that stops processing looks exactly like a quiet week.

### 6. Smaller, whenever

- Replace `customer_creation` thinking with a real customer lookup once PAY-2's
  `stripe_customers` is populated, and pass `client_reference_id` and `eventId`
  in metadata so the webhook knows which event a pass was meant for.
- The Checkout Studio appearance is Stripe's default blue on white with Source
  Sans Pro, which looks foreign inside Klik. Only changeable in Studio, since the
  form is an iframe that cannot read Klik's CSS.
- Add `STRIPE_PRICE_VENUE_ANNUAL` and an annual Venue price if you want the
  annual option PAY-3 describes. No annual product exists today.
- All three products carry the SaaS tax code with tax not included, while
  `automatic_tax` is off. Consistent only while you have no tax registrations.

## What was verified, and how

Not assumed. Run against the sandbox and the production database.

| Check | Result |
|---|---|
| Four tables exist in production | present, none missing |
| Checkout Session, payment mode | creates, returns a client secret |
| Checkout Session, subscription mode | creates, returns a client secret |
| Pinned API version `2026-03-25.dahlia` | accepted by the API |
| Checkout API, signed out | 401 |
| `/checkout?plan=event`, signed out | 307 to `/login` |
| Webhook, no signature | 400 |
| Webhook, forged signature | 400 |
| Webhook, valid signature | 200, purchase recorded |
| **Same event delivered twice** | 200, then 200 duplicate |
| **Purchase rows after two deliveries** | **1, not 2** |
| Pricing page, signed out | renders zero `buy.stripe.com` links, three `/signup?plan=` links |
| `/` after the dialog change | still statically prerendered |
| `/signup?plan=venue` | names Klik Venue, $69 per month |
| `/signup?plan=bogus` | falls back to the generic page, does not 404 or throw |
| Suite after signup and email tests | 236 passing, up from 210 |
| `/checkout?plan=venue`, signed out | 307 to `/login?next=%2Fcheckout%3Fplan%3Dvenue` |
| `/login?next=https://evil.example` | stays on login, value never becomes a link |
| `/login?next=//evil.example` | same |
| Suite | 210 tests passing |

Test rows were deleted afterwards. All four tables are empty.

## Resources

- Stripe support: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
- Klik's own payment design: [ROADMAP.md](ROADMAP.md), Phase PAY and Phase ACT
