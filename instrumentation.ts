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

  // F-9: Sentry, once there is a DSN, and only in a deployed build so local
  // development never reports. One public DSN serves the server and the
  // browser, which is why it carries the NEXT_PUBLIC_ prefix.
  if (process.env.NODE_ENV === "production") {
    const [{ serverReporter }, { registerErrorReporter }] = await Promise.all([
      import("./lib/sentry"),
      import("./lib/observability"),
    ]);
    const reporter = serverReporter(process.env.NEXT_PUBLIC_SENTRY_DSN, {
      environment: process.env.VERCEL_ENV ?? "production",
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
    if (reporter) registerErrorReporter(reporter);
  }
}

/**
 * F-9: a throw nothing caught, in a page, a route handler or a server action.
 * Until this existed such a failure reached only Next's own console line,
 * which no alert matched. Now it is a named event like every other, so it
 * reaches the email alert and Sentry. Redirects and not-found are control
 * flow and never arrive here.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ reportError, wasReported }, { scrubUrl }] = await Promise.all([
    import("./lib/observability"),
    import("./lib/sentry"),
  ]);
  // A route wrapped in `withErrorReporting` has already named it.
  if (wasReported(error)) return;
  reportError("request.unhandled", error, {
    path: scrubUrl(request.path),
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    digest: (error as { digest?: string } | null)?.digest,
  });
}
