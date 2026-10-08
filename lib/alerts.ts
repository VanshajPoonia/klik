import { consume } from "./ratelimit";
import { sendEmail, isEmailConfigured } from "./email";
import { registerErrorReporter } from "./observability";
import { escapeHtml } from "./emails/theme";

/**
 * Telling a human that something broke.
 *
 * **This is a stopgap, and the roadmap's F-9 (Sentry) is still the real
 * answer.** It exists because launching with structured logs and nothing that
 * reaches a person means the first production failure is discovered by a
 * customer on a Saturday night, and because wiring Sentry properly adds a
 * build-affecting dependency and needs an account that does not exist yet.
 * What this gives up against Sentry: no stack traces, no grouping, no release
 * tracking, no history. What it gives: an email, within a minute, for free, on
 * infrastructure already proven in production today.
 *
 * Two things it deliberately gets right, because an alerting system that gets
 * them wrong is worse than none:
 *
 * **It throttles.** One email per distinct event name per window. A failing
 * route called a hundred times a minute sends one mail, not a hundred, because
 * the second hundred would train the reader to filter the whole lot.
 *
 * **It cannot break the request it reports on.** Every path here swallows its
 * own failures. `reportError` already guards reporters, and this adds a second
 * layer, because the one moment this code runs is the moment something else has
 * already gone wrong.
 */

/** Where alerts go. Absent, nothing is sent and the structured log is all there is. */
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? null;

/**
 * One alert per event name per fifteen minutes.
 *
 * Keyed on the event name rather than the message, because `reportError` names
 * events as stable greppable strings for exactly this reason: ten different
 * messages from `purge.event_failed` are one problem, and the point of the
 * window is to say so once.
 */
const ALERT_WINDOW_SECONDS = 15 * 60;

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function deliver(event: string, error: unknown, context: Record<string, unknown>) {
  if (!ALERT_EMAIL || !isEmailConfigured()) return;

  // Throttle BEFORE composing. The database round trip is the cheap part and
  // the send is the expensive one, and a burst should cost one of each.
  const gate = await consume(`alert:${event}`, 1, ALERT_WINDOW_SECONDS);
  if (!gate.allowed) return;

  const summary = describe(error);
  const stack = error instanceof Error && error.stack ? error.stack : null;
  const details = Object.entries(context)
    .filter(([key]) => key !== "error")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");

  // Plain, ugly and complete. This email is read on a phone by somebody who
  // needs to know whether to get their laptop out, so the event name is the
  // subject and everything else is below the fold.
  await sendEmail({
    to: ALERT_EMAIL,
    subject: `Klik error: ${event}`,
    text: [
      `${event}`,
      ``,
      summary,
      ``,
      details || "(no context)",
      ``,
      stack ?? "(no stack)",
      ``,
      `Further alerts for "${event}" are suppressed for ${ALERT_WINDOW_SECONDS / 60} minutes.`,
    ].join("\n"),
    html: [
      `<p style="font:600 15px -apple-system,sans-serif">${escapeHtml(event)}</p>`,
      `<p style="font:14px -apple-system,sans-serif">${escapeHtml(summary)}</p>`,
      details
        ? `<pre style="font:12px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(details)}</pre>`
        : "",
      stack
        ? `<pre style="font:12px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(stack)}</pre>`
        : "",
      `<p style="font:12px -apple-system,sans-serif;color:#666">Further alerts for this event are suppressed for ${ALERT_WINDOW_SECONDS / 60} minutes.</p>`,
    ].join(""),
  });
}

let registered = false;

/**
 * Registers the email reporter once.
 *
 * Idempotent because `instrumentation.ts` can run more than once in
 * development, and registering twice would double every alert.
 */
export function registerEmailAlerts(): void {
  if (registered || !ALERT_EMAIL) return;
  registered = true;

  registerErrorReporter((error, context) => {
    const event = typeof context.event === "string" ? context.event : "unknown";
    // Floating on purpose. `reportError` is synchronous and called from inside
    // error paths all over the codebase; making it awaitable would mean
    // touching every one of them to report a failure that has already happened.
    // The structured log is the record of truth and is already written by the
    // time this runs. On a serverless host this send can occasionally be cut
    // short when the function freezes, which is the honest cost of the choice
    // and the main thing Sentry would fix.
    void deliver(event, error, context).catch(() => {});
  });
}
