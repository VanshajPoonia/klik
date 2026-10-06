# Claude Instructions

Before writing or changing any UI, read `DESIGN.md` and use it as the project's design reference. Treat it as the source of truth for visual direction, colors, typography, spacing, components, and interaction tone unless the user's current request explicitly overrides it.

Do not use em dashes in prose, UI copy, comments, commit messages, or documentation.

Before changing anything about payments, read `BILLING.md`. It is the source of truth for how money is taken, what is wired up and what is deliberately not. The short version, because it is easy to get wrong from the code alone: buying starts at a pricing button, which opens an explainer dialog, which goes to `/signup?plan=<key>`, which creates an account and then hands the buyer to a Stripe-hosted Payment Link. The embedded checkout at `/checkout`, the webhook at `/api/webhooks/stripe` and everything in `lib/billing*.ts` are built and working but reached from nowhere.

Two things about that are easy to break by accident. `users.plan_key` is `NOT NULL DEFAULT 'event'`, so a new account looks like it has the $39 plan; `users.activated_at` is what actually grants capability, and it is null until a superadmin assigns a plan. And no payment grants anything by itself, on either path: a human decides, and the queue they work from is "Signed up, not activated" on `/admin`.
