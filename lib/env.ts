import { z } from "zod";

/**
 * Environment validation, parsed once at module load.
 *
 * The failure this prevents: every consumer used to read `process.env` directly,
 * some with non-null assertions (`process.env.R2_ACCESS_KEY_ID!`). A missing or
 * misspelled variable therefore surfaced as a runtime error on whichever request
 * first touched that code path, in production, to a guest at an event, rather
 * than at deploy time. `AUTH_SECRET` was the worst of them: it throws from
 * `lib/guest.ts` on the first guest session, so a bad deploy looked fine until
 * somebody actually scanned a QR code.
 *
 * Required here means "the app cannot function without it". Optional providers
 * (Google, Resend, Stripe) stay optional, because the code already degrades
 * correctly when they are absent, but their shape is still checked when present
 * so a truncated paste fails loudly instead of at the first API call.
 */

/**
 * `.env` files set an unset key to an empty string, not to undefined, so a line
 * like `AUTH_GOOGLE_ID=` produces "" rather than a missing key. `z.optional()`
 * only permits undefined, so without this every commented-out-but-present
 * provider would fail validation and take the whole build down with it.
 */
const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled connection string)"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (generate with: npx auth secret)"),

  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required"),

  // The S3 endpoint for the bucket above. Optional, and when it is absent
  // `lib/storage.ts` falls back to R2's EU-jurisdiction host, which is where
  // `klik-media` lives and must stay reachable.
  //
  // It exists so OPS-4 can be done as a configuration change rather than a
  // deploy. Jurisdiction is fixed at bucket creation, so moving off the EU
  // means a different bucket at a different host, and having to ship code in
  // the middle of a data migration is how a cutover ends up half applied. Set
  // this and R2_BUCKET_NAME together, and nothing else has to change.
  //
  // Delete the fallback once no bucket is on the EU host.
  R2_ENDPOINT: optionalString(z.string().url("R2_ENDPOINT must be a full https URL")),

  // The second bucket the nightly sweep copies into. Optional: without it the
  // sweep reports that it is unconfigured rather than failing, because a
  // deployment with no backup is a valid one and a silent success that protects
  // nothing is not. R2 has no object versioning, so this is the only recovery
  // path from a bug in `deleteBlobs`. See `lib/backup.ts`.
  R2_BACKUP_BUCKET: optionalString(z.string().min(1)),

  // No trailing slash: QR codes and share links concatenate onto this, and a
  // double slash breaks slug matching in ways that are tedious to trace back.
  APP_URL: optionalString(
    z.string().url().refine((value) => !value.endsWith("/"), "APP_URL must not end with a slash"),
  ),

  CRON_SECRET: optionalString(z.string().min(1)),

  AUTH_GOOGLE_ID: optionalString(z.string().min(1)),
  AUTH_GOOGLE_SECRET: optionalString(z.string().min(1)),
  AUTH_RESEND_KEY: optionalString(z.string().min(1)),

  // The address sign-in emails come from. Resend rejects any domain that is not
  // verified in your account, so this must match a domain you have actually set
  // up there, not the product's marketing domain.
  AUTH_EMAIL_FROM: optionalString(z.string().min(3)),

  // Stripe. Optional, in the same way as the providers above: without the
  // secret key the checkout route answers 503 and nothing else in Klik
  // changes. The prefix checks catch the mistake that actually happens here,
  // which is the publishable and secret keys being pasted into each other's
  // slot, since both are long opaque strings that look interchangeable.
  // Accepts a standard secret key (sk_) and the restricted keys the CLI hands
  // out for a sandbox (rk_, rkcs_). Those are real secret keys with a narrower
  // scope, so rejecting them would mean the documented way to get a test
  // environment fails validation at boot, which is a confusing place to learn
  // that your test keys are the wrong shape.
  STRIPE_SECRET_KEY: optionalString(
    z.string().regex(/^(sk|rk)/, "STRIPE_SECRET_KEY must be a secret key, starting sk_ or rk_"),
  ),

  // Read in the browser, so the NEXT_PUBLIC_ prefix is load-bearing: Next
  // inlines only prefixed variables into the client bundle, and an unprefixed
  // name is simply undefined there, with no build error to say why.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString(
    z.string().regex(/^pk_/, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with pk_"),
  ),

  // One Price per plan in `lib/plans.ts`. These live in the environment rather
  // than in code because the client must never name its own price: a request
  // that chooses what it pays for is a request that chooses to pay less. They
  // also differ between test and live mode, which code cannot express.
  STRIPE_PRICE_EVENT: optionalString(
    z.string().regex(/^price_/, "STRIPE_PRICE_EVENT must be a Price ID, starting price_"),
  ),
  STRIPE_PRICE_PREMIUM: optionalString(
    z.string().regex(/^price_/, "STRIPE_PRICE_PREMIUM must be a Price ID, starting price_"),
  ),
  STRIPE_PRICE_VENUE_MONTHLY: optionalString(
    z.string().regex(/^price_/, "STRIPE_PRICE_VENUE_MONTHLY must be a Price ID, starting price_"),
  ),

  // Signs the webhook. Without it the route answers 503 rather than trusting an
  // unverified body, because anyone can POST to a public URL and the payload is
  // only evidence once the signature says Stripe sent it. Local development
  // gets one from `stripe listen`, and it differs from the production secret.
  STRIPE_WEBHOOK_SECRET: optionalString(
    z.string().regex(/^whsec_/, "STRIPE_WEBHOOK_SECRET must start with whsec_"),
  ),

  // PAY-5 and PAY-8: Stripe's no-code customer portal login link
  // (Dashboard, Settings, Billing, Customer portal), where a customer updates a
  // card and downloads invoices by email, with no Stripe customer id in Klik.
  // Without it the billing page and the payment emails say to write to us.
  STRIPE_BILLING_PORTAL_URL: optionalString(
    z.string().url().refine((value) => value.startsWith("https://"), "STRIPE_BILLING_PORTAL_URL must be https"),
  ),

  // A URL the purge cron pings after a successful run, for a heartbeat monitor
  // (UptimeRobot, Better Stack, Healthchecks.io). Optional: without it the cron
  // behaves exactly as before. Its absence is the normal state locally, which
  // is why it must not be required.
  CRON_HEARTBEAT_URL: optionalString(z.string().url()),
});

function parseEnv() {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${problems}\n\n` +
      "Copy .env.example to .env.local and fill these in. On Vercel, set them in " +
      "Project Settings and redeploy: a variable added without a redeploy does not " +
      "reach the running build.",
  );
}

export const env = parseEnv() as z.infer<typeof schema>;

/**
 * Resolves the app's public base URL for QR codes and share links: an explicit
 * APP_URL wins, otherwise fall back to Vercel's own ambient deployment URL so
 * things work correctly before a custom domain is configured.
 *
 * The fallback is a convenience, not a default to rely on. A QR code generated
 * against a preview deployment URL scans fine today and 404s once that
 * deployment is superseded, which is a particularly cruel failure for something
 * that was printed and stuck to a wall.
 */
export function getAppUrl(): string {
  if (env.APP_URL) return env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
