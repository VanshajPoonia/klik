# Stripe integration: remaining steps

This file is the single source of truth for everything left to do on the Stripe
Checkout integration. The code compiles, lints and builds, but it will not take a
real payment until the blockers below are cleared.

Scenario B applied: no Checkout Session call existed anywhere in the repo, so a
new endpoint and a new page were added rather than existing parameters edited.

## Values to Replace

No placeholders remain in code. What is left is three environment values.

**Files containing placeholders:**
- [.env.example](.env.example)

| Field | Current Value | What to Set |
|---|---|---|
| `STRIPE_PRICE_EVENT` | empty | The Price ID behind Klik Event, $39 one-time. |
| `STRIPE_PRICE_PREMIUM` | empty | The Price ID behind Klik Premium, $89 one-time. |
| `STRIPE_PRICE_VENUE_MONTHLY` | empty | The Price ID behind Klik Venue, $69 per month. |

A Price ID starts `price_`. Find them in the Dashboard under Product catalogue,
open the product, and read the Pricing section, or run `stripe prices list`. Test
mode and live mode have different IDs for the same product, so these have to
change whenever the API keys change.

The Payment Link URLs are not Price IDs and cannot be used here. They are
recorded under Payment Links below.

`mode` is no longer a placeholder. [lib/stripe.ts](lib/stripe.ts) resolves it per
plan: `payment` for Event and Premium, `subscription` for Venue.

## Configured Parameters

These parameters came from Checkout Studio and are already set correctly. Do not
edit them here: change them in Studio and re-run the integration, or the two
drift apart with nothing to detect it.

**Files containing these parameters:**
- [app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) (session parameters)
- [components/billing/embedded-checkout-form.tsx](components/billing/embedded-checkout-form.tsx) (appearance object)

| Parameter | Value |
|---|---|
| `ui_mode` | `form` |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: false }` |
| `payment_method_collection` | `always`, sent only when `mode` is `subscription`, so only for Venue |
| `submit_type` | `auto` |
| `name_collection` | `{ individual: { enabled: true, optional: true } }` |
| `saved_payment_method_options` | `{ payment_method_save: "enabled" }` |
| `integration_identifier` | `custom_embedded_web_0001` |

`ui_mode` is `form` because the installed SDK is stripe 23.0.0, which is at or
above 21.0.0. Below 21.0.0 the value would have to be `custom`.

## Payment Links

Three Payment Links already exist for the same products. They are a separate,
self-contained integration path: a hosted page at buy.stripe.com that bypasses
[app/api/billing/checkout/route.ts](app/api/billing/checkout/route.ts) entirely.
Nothing in this repo references them. They are recorded so the two paths are not
confused for each other.

| Plan | Price | Link |
|---|---|---|
| Klik Event | $39.00 USD one-time | https://buy.stripe.com/8x27sK88b75LbVgbKS2cg03 |
| Klik Premium | $89.00 USD one-time | https://buy.stripe.com/dRmaEW2NR9dT6AW7uC2cg01 |
| Klik Venue | $69.00 USD per month | https://buy.stripe.com/cNifZg603bm1aRc6qy2cg02 |

Both paths still need the webhook in blocker 3. A Payment Link grants nothing on
its own either.

All three products carry the SaaS product tax code with tax not included in the
price, while `automatic_tax` is `{ enabled: false }` in the session. That is
consistent only while you have no tax registrations. Revisit it before selling
into a jurisdiction where you do.

## Blockers

Three things will stop this working, in descending order of how soon you hit them.

### 1. `saved_payment_method_options` needs a Customer

`payment_method_save` only applies when the session has a Customer attached. This
splits by plan:

- **Venue** is `subscription` mode, where Stripe creates the Customer itself. It
  is fine.
- **Event and Premium** are `payment` mode with no `customer` and no
  `customer_creation`, so Stripe rejects the create call and the first request to
  `/api/billing/checkout` returns an error instead of a client secret.

This was left exactly as Checkout Studio configured it, because Studio values are
authoritative and inventing an extra parameter here would hide the mismatch. Fix
it in one of two ways:

- Add `customer_creation: "always"` to the session parameters, or
- Look up or create the Stripe customer for the signed-in user and pass
  `customer`. This is what ROADMAP PAY-2's `stripe_customers` table exists for,
  and is the right answer once that table lands.

If you do not want saved payment methods at all, turn the setting off in Checkout
Studio instead of deleting the line here.

### 2. Two different API versions were specified

The integration brief says to pin `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1`.
The Stripe docs page shown alongside it uses `2026-08-26.dahlia; custom_checkout_payment_form_preview=v1`.
The installed SDK pins `2026-09-30.endive` by default, newer than both.

[lib/stripe.ts](lib/stripe.ts) uses the brief's value, `2026-03-25.dahlia`, since
that was the explicit instruction. Confirm which is correct in the Dashboard under
Developers, API versions, and change `STRIPE_API_VERSION` if it is the other one.
Getting this wrong fails at the `checkout.sessions.create` call, not at build
time, so it will not surface until someone opens the checkout page.

### 3. Nothing grants a plan after a successful payment

There is no webhook handler. A customer can complete payment and receive nothing,
because entitlements in Klik are granted by a ledger write, and only the admin
panel writes to it today.

This was out of scope for the integration brief, which covers the Checkout Session
and the form only. It is fully designed in ROADMAP PAY-4: `POST /api/webhooks/stripe`
with `runtime = "nodejs"`, reading the raw body via `await request.text()` for
signature verification, inserting into a `stripe_webhook_events` idempotency table
before processing, and handling `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.paid`,
`invoice.payment_failed` and `charge.refunded`.

Two constraints from that design matter and are easy to get wrong:

- Every handler filters on `source = 'stripe'`. Admin grants outrank Stripe and a
  webhook must never overwrite one, or a comped venue silently loses access when
  a subscription lapses.
- The grant happens in the webhook, never on the success page. The success page is
  not a trustworthy signal.

`STRIPE_WEBHOOK_SECRET` was deliberately not added to [.env.example](.env.example),
since nothing reads it yet. Add it with the handler.

## Setup

### Environment variables

Add to `.env.local`, and to Vercel Project Settings followed by a redeploy, since
a variable added without a redeploy never reaches the running build.

```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_EVENT=price_...
STRIPE_PRICE_PREMIUM=price_...
STRIPE_PRICE_VENUE_MONTHLY=price_...
```

All five are optional in [lib/env.ts](lib/env.ts), matching how Google and Resend
are treated: without `STRIPE_SECRET_KEY` the checkout route answers 503 and
nothing else in Klik changes, and a plan with no Price ID answers 503 on its own
without taking the other two down. Every one is shape-checked when present, so a
truncated paste, a swap of the publishable and secret keys, or a Payment Link URL
pasted where a Price ID belongs all fail at startup rather than at the form.

The `NEXT_PUBLIC_` prefix on the publishable key is load-bearing. Next inlines only
prefixed variables into the client bundle, so an unprefixed name is simply
`undefined` in the browser with no build error to explain why.

Get the keys from https://dashboard.stripe.com/test/apikeys. Use test keys until
the blockers are cleared. The buy button snippet in the Dashboard shows a
`pk_live_` key, which is live mode and will take real money.

### Dependencies

`stripe@^23.0.0` was added to [package.json](package.json). Nothing else was
installed: Stripe.js is loaded from the CDN, not bundled.

### New files

```
lib/stripe.ts                                   Stripe client, pinned API version, plan to price map
app/api/billing/checkout/route.ts               POST { planKey }, returns { client_secret }
app/checkout/page.tsx                           Signed-in page at /checkout?plan=event
components/billing/embedded-checkout-form.tsx   Client component, mounts the form
```

Changed: [lib/env.ts](lib/env.ts), [.env.example](.env.example),
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

### Testing

Use test mode keys and these card numbers, with any future expiry, any CVC and any
postal code:

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure authentication |
| 4000 0000 0000 9995 | Declined, insufficient funds |

Full list: https://docs.stripe.com/testing

Venue can be tested as soon as the Price IDs are set. Event and Premium cannot,
until blocker 1 is cleared.

### Next steps

1. Fill in the three Price IDs.
2. Clear blocker 1 so Event and Premium can create a session at all.
3. Confirm the API version in blocker 2.
4. Build PAY-2's tables and PAY-4's webhook so a payment actually grants something.
5. Pass `client_reference_id` (the user ID) and the intended `eventId` in metadata.
   These were left out because they are not Checkout Studio parameters, but the
   webhook needs them to know who paid for what.
6. Link to `/checkout?plan=...` from the pricing page and from the upgrade prompts
   described in PAY-5. Nothing in the app points at the checkout page yet.
7. Add `STRIPE_PRICE_VENUE_ANNUAL` and an annual Venue price if you want the annual
   option PAY-3 describes. No annual product exists in Stripe today.
8. Decide whether the Studio appearance should match Klik. It currently specifies
   `Source Sans Pro` at `#0570de` on white, which is Stripe's default look, not
   Klik's volt-on-near-black. The form sits in a Stripe-hosted iframe that cannot
   read Klik's CSS variables, so this can only be changed in Checkout Studio.
9. Reconcile with ROADMAP. Payments were deferred out of v1 on 2026-10-01 and
   ROADMAP still reads "Stripe: nothing at all". Either update that decision or
   keep this integration behind a flag until it is revisited.

### Resources

- Stripe support: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
- Klik's own payment design: ROADMAP.md, Phase PAY
