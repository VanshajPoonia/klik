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
