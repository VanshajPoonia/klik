# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a person hosting one gathering (a wedding, birthday, graduation, reunion, baby shower or company party) who wants every guest's photos and videos in one place without asking anyone to install an app. They find Klik before the event, usually on a phone, and buy once.

Secondary: venues and event professionals who run several events a month and want one reusable QR code, a client dashboard and downloadable signs. Confirmed 2026-10-16: the home page speaks to hosts first and venues second.

Third audience, never the buyer: the guests themselves, who scan a QR code on a table, sign, or screen, and upload from their own phone's browser.

## Product Purpose

Klik turns every phone in the room into the event's camera. The host gets a QR code; guests scan it, add photos and videos from their own phone, and watch one shared gallery fill up live. No app, no guest account. Success is a host who puts the QR out, and a gallery that fills before the night ends.

## Positioning

A browser-only guest flow (scan, optional first name, upload) feeding a live shared gallery the host controls: moderation, privacy level, download rules and an expiry date. Pricing is a one-time pass per event, not a subscription, except for venues.

## Operating Context

- Buying: a pricing button opens an explainer dialog, which goes to `/signup?plan=<key>`, which creates an account and hands off to a Stripe-hosted Payment Link. A person then grants the plan by hand on `/admin`; the kit is ready within 24 hours (`KIT_WAIT_HOURS`). See BILLING.md.
- At the event: printed QR signs (print studio with templates), a live full-screen slideshow on a venue screen, an optional kiosk tablet, an in-app camera with looks, hearts and comments on photos, photo challenges.
- After: download-all ZIP, highlights, a morning-after recap email.
- Klik sells nothing physical. Photo prints are built and switched off (`PRINTS_ENABLED`, see BILLING.md), and nothing on the site offers or promises them.

## Capabilities and Constraints

- Plans and their feature lists live in `lib/plans.ts`: Klik Event $39 one-time, Klik Premium $89 one-time, Klik Venue $69 per month with a 3-month minimum and a $690 annual option.
- Guest consent text lives in `lib/consent.ts` and is versioned; marketing quotes it, never paraphrases it.
- Support phone and kit wait time live in `lib/support.ts`.
- Guest screens speak English and Spanish.
- Capability comes from the entitlements ledger; `users.plan_key` is retired.

## Brand Commitments

- Name: Klik, lowercase wordmark "klik" beside the yellow mark (`public/klik-mark.png`).
- Shipped identity: near-black canvas, cream paper, one volt yellow accent, Geist for UI and Fraunces for display. Tokens in `app/globals.css`; never hard-code hex in components. The user likes this identity and asked for a remaster, not a rebrand (2026-10-16).
- No em dashes anywhere, and no spaced hyphens used as dashes.
- Voice: plain, warm, concrete. Names what happens at the event rather than abstract benefits.

## Evidence on Hand

- Six sample event photos in `public/images/sample-events/` (birthday, wedding reception, company party, family reunion, baby shower, graduation). These are illustrative, not customer photos.
- No reviews, ratings, customer counts, press or customer logos exist. Do not invent any (confirmed 2026-10-16).
- No real event video exists. Motion loops cut from the sample photos are allowed, as long as nothing presents them as customer footage.

## Product Principles

1. Guests do nothing but scan and share. Anything that adds a step for a guest is wrong.
2. The host stays in control: every promise about privacy and moderation must be true in the product today.
3. Show the gallery filling, do not describe it.
4. Money is explained before it is taken: the wait between paying and going live is said up front.
5. Every fact on the marketing page comes from the same source the product uses (plans, consent, support), so the two cannot drift.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` (motion arrives at once), `prefers-contrast: more` and forced colors (atmospheric effects drop away). Visible focus rings in volt. Guests include older relatives on older phones, so pages must stay fast and readable on modest devices.
