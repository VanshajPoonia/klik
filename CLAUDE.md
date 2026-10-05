# Claude Instructions

Before writing or changing any UI, read `DESIGN.md` and use it as the project's design reference. Treat it as the source of truth for visual direction, colors, typography, spacing, components, and interaction tone unless the user's current request explicitly overrides it.

Do not use em dashes in prose, UI copy, comments, commit messages, or documentation.

Before changing anything about payments, read `BILLING.md`. It is the source of truth for how money is taken, what is wired up and what is deliberately not. The short version, because it is easy to get wrong from the code alone: the site sells through Stripe-hosted Payment Links, and the embedded checkout at `/checkout`, the webhook at `/api/webhooks/stripe` and everything in `lib/billing*.ts` are built and working but linked from nowhere. No payment grants a plan by itself; a superadmin activates it by hand.
