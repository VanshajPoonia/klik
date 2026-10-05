# Billing

Everything about taking money in Klik: what exists, how it works, what is
deliberately not automated, and what to do next.

## Status

| | |
|---|---|
| Embedded Stripe Checkout | Built, verified |
| Webhook, signed and idempotent | Built, verified against the live API |
| Database tables | Migrated, in production |
| Pricing page links | Live, and self-disabling until Stripe is configured |
| Production Stripe keys | **Not set.** Nothing can be bought on the live site |
| Dashboard webhook endpoint | **Not created.** Nothing reaches the webhook |
| A payment granting a plan | **Not automated, on purpose.** See "The grant is manual" |

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

### The Payment Links are a different thing

Three links at `buy.stripe.com` exist for the same products. They are a
self-contained hosted checkout that **bypasses all of the above**. Nothing in
this repo references them, and they are listed only so the two are not confused.

| Plan | Link |
|---|---|
| Klik Event | https://buy.stripe.com/8x27sK88b75LbVgbKS2cg03 |
| Klik Premium | https://buy.stripe.com/dRmaEW2NR9dT6AW7uC2cg01 |
| Klik Venue | https://buy.stripe.com/cNifZg603bm1aRc6qy2cg02 |

They need the webhook too. A Payment Link grants nothing on its own either.

## The grant is manual, on purpose

**The webhook never touches `users.planKey`.** A payment is recorded and then
waits for a superadmin, who sees it in `/admin` under "Paid, awaiting
activation" and grants the plan with the control already on that page.

This is ROADMAP ACT-2: "This is the v1 revenue mechanism: a human decides."

Automating it means ACT-1, the entitlement ledger, which retires
`users.plan_key`, resolves the plpgsql triggers that read that column directly,
and moves every `canX(plan.key)` call site. ROADMAP sequences that behind the
F-7 test harness, and [ROADMAP.md:984](ROADMAP.md#L984) explains why: doing it
without tests "is how an authorization bug ships quietly".

Nothing built here is wasted when ACT-1 lands. The ledger reads these tables
rather than replacing them, and `source = 'stripe'` rows come from the same
handlers.

The buyer is told this before paying, on the checkout page. Someone who is not
told reads the delay as a failure and asks for their money back.

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
| [components/marketing/pricing.tsx](components/marketing/pricing.tsx) | The three buy buttons |
| [lib/billing.test.ts](lib/billing.test.ts) | Charge mode per plan, invoice shape parsing |

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

### 1. Claim the sandbox

```
stripe sandbox claim
```

Deadline **2026-10-12**. Cheapest item here, hardest to recover if missed.

### 2. Run one real card payment locally

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

### 3. Wire production

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

The pricing page buttons point at `/login` until these are set, and switch
themselves to `/checkout?plan=...` the moment they are. Nothing to deploy twice.

### 4. Alert on the webhook

ROADMAP F-9 names this route alongside the purge cron as one that fails silently
by nature. A webhook that stops processing looks exactly like a quiet week.

### 5. Carry the plan through sign-in

A signed-out visitor clicking "Start with Event" reaches `/checkout?plan=event`,
is redirected to `/login`, signs in, and lands on `/dashboard` having lost the
plan they chose. Sign-in has no `callbackUrl` support, so fixing it means
touching the auth flow. It is the most visible rough edge in the funnel.

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
| Pricing page | renders all three `/checkout?plan=` links |
| Suite | 196 tests passing |

Test rows were deleted afterwards. All four tables are empty.

## Resources

- Stripe support: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
- Klik's own payment design: [ROADMAP.md](ROADMAP.md), Phase PAY and Phase ACT
