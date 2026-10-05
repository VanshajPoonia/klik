# Stripe integration: remaining steps

This file is the single source of truth for what is left on the Stripe Checkout
integration.

Local development works end to end against a sandbox, and the webhook now
records every payment, refund and subscription change. One step is outstanding
and it is not code: the migration has not been applied to the database.

Scenario B applied: no Checkout Session call existed anywhere in the repo, so a
new endpoint and a new page were added rather than existing parameters edited.

## Values to Replace

Nothing is left to fill in for local development. `.env.local` holds a working
sandbox secret key, publishable key and all three Price IDs.

Production is a different set of values and is still empty. Set these in Vercel
Project Settings and redeploy, since a variable added without a redeploy never
reaches the running build.

| Variable | What to set in Vercel |
|---|---|
| `STRIPE_SECRET_KEY` | The live secret key. Never the sandbox one. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | The live publishable key, `pk_live_51THQ9k...`. |
| `STRIPE_PRICE_EVENT` | `price_1UNGPeBaW05Ewcp3KnQo6a5b` |
| `STRIPE_PRICE_PREMIUM` | `price_1UNGQmBaW05Ewcp35QI0P63S` |
| `STRIPE_PRICE_VENUE_MONTHLY` | `price_1UNGQPBaW05Ewcp3cfrkX1WN` |

The live Price IDs above are from account `acct_1THQ9kBaW05Ewcp3`, Kreativ
Vantage, and are also recorded as comments at the bottom of `.env.local`.

Payment Link URLs are not Price IDs and cannot be used here. The links are
recorded under Payment Links below.

## The sandbox

Local development runs against a standalone sandbox, `acct_1UNHUaDaaergD8Nq`,
created with `stripe sandbox create --from-git`. Two things about it matter.

**It expires on 2026-10-12 unless claimed.** Run `stripe sandbox claim` before
then, or the keys in `.env.local` stop working and the three test products go
with them.

**It is a separate account, not a sandbox inside Kreativ Vantage.** It was
provisioned against the git email `vanshajtheunique@gmail.com`, which is not the
account the live products live in. Nothing created there is visible from the
Kreativ Vantage Dashboard. If you want a sandbox under the real account instead,
use `stripe switch` from a browser session signed in as Kreativ Vantage and
recreate the three prices there.

The three test prices were created to mirror live, same names and amounts:

| Plan | Test Price ID | Live Price ID |
|---|---|---|
| Klik Event, $39 one-time | `price_1UNHcIDaaergD8NqqBmiYvI8` | `price_1UNGPeBaW05Ewcp3KnQo6a5b` |
| Klik Premium, $89 one-time | `price_1UNHcKDaaergD8Nq9aRjGvde` | `price_1UNGQmBaW05Ewcp35QI0P63S` |
| Klik Venue, $69 per month | `price_1UNHcLDaaergD8NqEuHxwTD5` | `price_1UNGQPBaW05Ewcp3cfrkX1WN` |

## Configured Parameters

These came from Checkout Studio and are set correctly. Do not edit them here:
change them in Studio and re-run the integration, or the two drift apart with
nothing to detect it.

**Files containing these parameters:**
- [app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) (session parameters)
- [components/billing/embedded-checkout-form.tsx](components/billing/embedded-checkout-form.tsx) (appearance object)

| Parameter | Value |
|---|---|
| `ui_mode` | `form` |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: false }` |
| `payment_method_collection` | `always`, sent only in subscription mode, so only for Venue |
| `submit_type` | `auto` |
| `name_collection` | `{ individual: { enabled: true, optional: true } }` |
| `saved_payment_method_options` | `{ payment_method_save: "enabled" }` |
| `integration_identifier` | `custom_embedded_web_0001` |

One parameter is **not** from Studio. `customer_creation: "always"` is sent in
payment mode only. See resolved blocker 1.

`ui_mode` is `form` because the installed SDK is stripe 23.0.0, at or above the
21.0.0 threshold. Below that the value would have to be `custom`.

## Payment Links

Three Payment Links exist for the same products. They are a separate,
self-contained integration path: a hosted page at buy.stripe.com that bypasses
[app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) entirely.
Nothing in this repo references them. They are recorded so the two paths are not
confused for each other.

| Plan | Price | Link |
|---|---|---|
| Klik Event | $39.00 USD one-time | https://buy.stripe.com/8x27sK88b75LbVgbKS2cg03 |
| Klik Premium | $89.00 USD one-time | https://buy.stripe.com/dRmaEW2NR9dT6AW7uC2cg01 |
| Klik Venue | $69.00 USD per month | https://buy.stripe.com/cNifZg603bm1aRc6qy2cg02 |

A Payment Link grants nothing on its own either. Both paths need the webhook.

All three products carry the SaaS product tax code with tax not included in the
price, while `automatic_tax` is `{ enabled: false }` in the session. That is
consistent only while you have no tax registrations. Revisit it before selling
into a jurisdiction where you do.

## Outstanding

### 1. The migration has not been applied

[drizzle/0012_stripe_billing.sql](drizzle/0012_stripe_billing.sql) creates the
four tables everything below depends on. It is written, committed and reviewed,
but running it was blocked by the Claude Code auto mode classifier, which
flagged it as a production deploy. Nothing Stripe-related works until it runs,
and the code must not be pushed before it does: a deploy that references tables
the database does not have fails on the first webhook, in production, silently.

Apply it with:

```
npm run db:migrate -- 0012_stripe_billing.sql
```

It is additive only. Four `CREATE TABLE IF NOT EXISTS`, two check constraints and
four indexes. No existing table is altered and no data is touched, so it is safe
to run against production and safe to run twice.

### 2. A payment still does not grant a plan, by design

The webhook records money. It does not touch `users.planKey`. A superadmin sees
the payment in the admin panel under "Paid, awaiting activation" and grants the
plan with the control that was already there.

That is deliberate and it is your stated v1 model: ROADMAP ACT-2 says "This is
the v1 revenue mechanism: a human decides". Automating it means ACT-1, the
entitlement ledger, which retires `users.plan_key`, resolves the plpgsql
triggers that read it directly, and moves every `canX(plan.key)` call site.
ROADMAP sequences that behind the F-7 test harness for good reason.

Nothing here has to be unpicked when ACT-1 lands. The ledger reads from these
tables rather than replacing them, and `source = 'stripe'` rows will be written
from the same handlers.

## Resolved blockers

Kept as a record, because both were real and both were verified against the API
rather than reasoned about.

### 1. `saved_payment_method_options` needed a Customer. Fixed.

Studio enables saved payment methods, which Stripe permits only when the session
has a Customer. Subscription mode creates one by itself, so Venue always worked.
Payment mode does not, and rejected the create call outright, so Event and
Premium failed with `saved_payment_method_options requires a customer`.

[app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) now sends
`customer_creation: "always"` in payment mode. Confirmed working against the API.

This is interim. Once PAY-2 lands `stripe_customers`, look the customer up and
pass `customer` instead, so a returning organizer does not get a fresh Customer
record on every purchase.

### 2. Two API versions were specified. Settled.

The brief said `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1`, the
docs page beside it said `2026-08-26.dahlia; ...`, and the SDK pins
`2026-09-30.endive`. The brief's value was used, and the API accepts it: sessions
create successfully with `ui_mode: form` and return a client secret. No change
needed.

## Setup

### Environment variables

```
STRIPE_SECRET_KEY=rkcs_test_... or sk_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_... or pk_live_...
STRIPE_PRICE_EVENT=price_...
STRIPE_PRICE_PREMIUM=price_...
STRIPE_PRICE_VENUE_MONTHLY=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

All six are optional in [lib/env.ts](lib/env.ts), matching how Google and Resend
are treated: without `STRIPE_SECRET_KEY` the checkout route answers 503 and
nothing else in Klik changes, and a plan with no Price ID answers 503 on its own
without taking the other two down. Each is shape-checked when present, so a
truncated paste, the publishable and secret keys swapped into each other's slot,
or a Payment Link URL pasted where a Price ID belongs all fail at startup rather
than at the payment form.

`STRIPE_SECRET_KEY` accepts `sk_` and also `rk_` and `rkcs_`, the restricted keys
the CLI hands out for a sandbox. Those are real secret keys with a narrower
scope, and rejecting them would mean the documented way to get a test environment
fails validation at boot.

The `NEXT_PUBLIC_` prefix on the publishable key is load-bearing. Next inlines
only prefixed variables into the client bundle, so an unprefixed name is simply
`undefined` in the browser with no build error to explain why.

### Dependencies

`stripe@^23.0.0` in [package.json](package.json). Nothing else: Stripe.js is
loaded from the CDN, not bundled. The Stripe CLI is installed locally via
Homebrew and is not a project dependency.

### Files

```
lib/stripe.ts                                   Stripe client, pinned API version, plan to price map
lib/billing.ts                                  Customer lookup, and the record handlers the webhook calls
lib/billing-admin.ts                            The "who has paid and is still waiting" query
lib/billing.test.ts                             Charge mode per plan, and invoice shape parsing
drizzle/0012_stripe_billing.sql                 The four tables
app/api/billing/checkout/route.ts               POST { planKey }, returns { client_secret }
app/api/webhooks/stripe/route.ts                Signature check, idempotency claim, dispatch
app/checkout/page.tsx                           Signed-in page at /checkout?plan=event
components/billing/embedded-checkout-form.tsx   Client component, mounts the form
components/admin/pending-activations.tsx        Paid, awaiting activation panel
```

Changed: [lib/env.ts](lib/env.ts), [lib/schema.ts](lib/schema.ts),
[app/admin/page.tsx](app/admin/page.tsx), [.env.example](.env.example),
[package.json](package.json).

### How it works

1. A signed-in organizer opens `/checkout?plan=event`, `?plan=premium` or
   `?plan=venue`. An unknown plan 404s, and unauthenticated visitors are
   redirected to `/login`, matching every other page in the app.
2. The page loads `https://js.stripe.com/dahlia/stripe.js` directly from Stripe.
   It is never bundled or self-hosted, because serving a copy puts Klik in PCI
   scope. The `dahlia` build is the one carrying `initCheckoutFormSdk`.
3. The client component POSTs `{ planKey }` to `/api/billing/checkout`. That route
   checks the session with the existing `auth()` helper, validates the plan key
   against `PLAN_KEYS`, resolves the Price ID and mode on the server, creates a
   Checkout Session, and returns `{ client_secret }` as JSON.
4. The browser never sends a price or an amount, only which of three known plans
   it wants. A hand-edited query string can change what is being bought but not
   what it costs.
5. It returns JSON rather than redirecting to `session.url` on purpose. A 303
   would navigate the whole tab to Stripe's hosted page, quietly replacing the
   embedded integration with a different one that still happens to take money.
6. `initCheckoutFormSdk` receives the client secret and the Studio appearance,
   `createForm({ layout: "expanded" })` renders into `#checkout-form`, and
   `loadActions()` supplies the confirm action wired to the form's `confirm` event.
   Card details go from that iframe straight to Stripe and never touch Klik.
7. Separately, Stripe POSTs the event to `/api/webhooks/stripe`. That request is
   the only trustworthy signal that money moved: what the browser reports is a
   claim from a client we do not control, so nothing is recorded from it.
8. The webhook verifies the signature over the raw bytes, claims the event id in
   `stripe_webhook_events` so a redelivery is a no-op, records the purchase or
   subscription, and stamps `processed_at`. On failure it stores the error,
   releases the claim and answers 500 so Stripe retries.
9. A superadmin sees the payment in the admin panel and grants the plan.

### Testing

`npm run dev`, sign in, then open `/checkout?plan=event`. All three plans create a
session successfully now.

Test cards, with any future expiry, any CVC and any postal code:

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure authentication |
| 4000 0000 0000 9995 | Declined, insufficient funds |

Full list: https://docs.stripe.com/testing

A successful payment is recorded and then waits for a superadmin to grant the
plan. The organizer's access does not change by itself. That is the design, not
a regression. See Outstanding, item 2.

### Webhook setup

Locally:

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

That prints a `whsec_...` secret for `.env.local`. It is a different value from
the production one.

For the deployed app, add an endpoint in the Dashboard under Developers,
Webhooks, pointing at `https://<your domain>/api/webhooks/stripe`, subscribed to
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed` and `charge.refunded`. Put its signing secret in Vercel
and redeploy.

### Next steps

1. Apply the migration. Everything is blocked on this.
2. Claim the sandbox before 2026-10-12, or move to one under the Kreativ Vantage
   account.
3. Add the webhook endpoint and secret, locally and in the Dashboard.
4. Alert on the webhook route. ROADMAP F-9 names it alongside the cron as a route
   that fails silently by nature, and a webhook that stops processing looks
   exactly like a quiet week.
6. Link to `/checkout?plan=...` from the pricing page and the upgrade prompts in
   PAY-5. Nothing in the app points at the checkout page yet.
7. Add `STRIPE_PRICE_VENUE_ANNUAL` and an annual Venue price if you want the
   annual option PAY-3 describes. No annual product exists in Stripe today.
8. Decide whether the Studio appearance should match Klik. It specifies
   `Source Sans Pro` at `#0570de` on white, which is Stripe's default look, not
   Klik's volt-on-near-black. The form sits in a Stripe-hosted iframe that cannot
   read Klik's CSS variables, so this can only change in Checkout Studio.
9. Reconcile with ROADMAP. Payments were deferred out of v1 on 2026-10-01 and
   ROADMAP still reads "Stripe: nothing at all". Either update that decision or
   keep this behind a flag until it is revisited.

### Resources

- Stripe support: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
- Klik's own payment design: ROADMAP.md, Phase PAY
