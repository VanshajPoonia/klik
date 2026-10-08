/**
 * Next.js calls this once when the server starts, before any request.
 *
 * It is the only place error reporting can be registered without importing a
 * reporter into `lib/observability.ts` itself, which would invert the
 * dependency: observability is imported by nearly everything, and having it
 * reach back out to the database and the mail client would put both into the
 * module graph of every page that merely logs a line.
 */
export async function register() {
  // Node only. The edge runtime has neither the database driver nor the mail
  // client, and importing them there fails the build rather than the request.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerEmailAlerts } = await import("./lib/alerts");
  registerEmailAlerts();
}
