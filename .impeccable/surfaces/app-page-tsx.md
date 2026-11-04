---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["components/marketing/hero.tsx"]
---

## Scope and mode

The marketing home page (`app/page.tsx`, `components/marketing/*`). Persuade.

## Audience, job, action

Hosts first (weddings, birthdays, parties), venues second. They should understand within one screen that guests' own phones fill one live album, and press "Create your event" or reach pricing. Buying flow is unchanged: pricing button, explainer dialog, `/signup?plan=<key>`, Stripe-hosted link (BILLING.md).

## Proof and constraints

- Only the six illustrative sample photos and loops cut from them (`components/marketing/sample-media.ts`). No reviews, ratings, counts or logos exist; never invent them.
- Kept in full by request (2026-10-16): every plan feature, the consent notice word for word (from `lib/consent.ts`), the support phone, all six organizer features.
- Visual remaster only: no feature, flow, price or factual copy changes.

## Direction: The Contact Sheet (seed 4afca374)

The page is one camera roll. Every photo sits in a strip of film (rebate, punched sprocket holes, edge print in dim volt with frame numbers that run on across the page). Volt is the grease pencil that circles keepers. Hero: a draggable CSS 3D reel of stills and loops on a cylinder. Steps develop from black as they arrive. Use cases sit on a cream light table as black and white strips, keepers in colour. Host controls are animated dashboard vignettes in frames. Consent is the real entry sheet on a phone turning in 3D, with the tick circled.

Memorable moment: dragging the reel and watching the circled keeper come round.

## Motion rules

Scroll-driven CSS (`animation-timeline: view()`) only under `@supports` and `prefers-reduced-motion: no-preference`; everything rests in its finished state otherwise. Vignette loops run only on screen (`InView`, `.vg-run`). Videos play only when visible and facing the viewer. Pricing cards never fade.

## Open

- DESIGN.md still documents an Apple-blue system the site never adopted; recording the shipped world there needs the user's go-ahead.
- Real event footage, when there is some with permission, replaces the generated loops by changing paths in `sample-media.ts`.
