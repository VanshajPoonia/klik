# Claude Instructions

Before writing or changing any UI, read `DESIGN.md` and use it as the project's design reference. Treat it as the source of truth for visual direction, colors, typography, spacing, components, and interaction tone unless the user's current request explicitly overrides it.

Do not use em dashes in prose, UI copy, comments, commit messages, or documentation.

Before changing anything about payments, read `BILLING.md`. It is the source of truth for how money is taken, what is wired up and what is deliberately not. The short version, because it is easy to get wrong from the code alone: buying starts at a pricing button, which opens an explainer dialog, which goes to `/signup?plan=<key>`, which creates an account and then hands the buyer to a Stripe-hosted Payment Link. The embedded checkout at `/checkout`, the webhook at `/api/webhooks/stripe` and everything in `lib/billing*.ts` are built and working but reached from nowhere.

Two things about that are easy to break by accident. Capability comes from the `entitlements` ledger (`lib/entitlements.ts`, ACT-1): a pass licenses one event, Venue licenses up to its limits, and each event carries its own `plan_key` and `entitlement_id`. `users.plan_key` is retired and must not be read again: it defaults to `'event'`, so it describes a $39 plan nobody granted. And no payment grants anything by itself, on either path: a human grants it on `/admin`, with a reason, and the queues they work from are "Waiting to go live" and "Signed up, not activated".
