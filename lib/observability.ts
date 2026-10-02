/**
 * Structured logging and a single place errors are reported from.
 *
 * The gap this closes is the one named at the top of ROADMAP.md's "what does
 * not protect us yet": nothing tells you when something breaks. A 500 on the
 * upload path at a Saturday wedding surfaces as a support email on Monday, if
 * at all.
 *
 * **Deliberately vendor-free.** Sentry is coming, but the useful half of F-9
 * does not depend on it. Vercel captures stdout, and one JSON object per line
 * is queryable there today, so the logging is worth having on its own and the
 * reporter below is the single seam Sentry plugs into later. Writing it this
 * way round means adding Sentry is a few lines in one file rather than an
 * import threaded through forty call sites.
 *
 * **What not to put in here.** Never log a connection string, an R2 key, an
 * auth token, a guest cookie, or a gallery password. `redact` below handles the
 * obvious keys, but it is a safety net and not permission to pass secrets in.
 */

export type Severity = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

/**
 * Field names whose values never belong in a log line, matched case
 * insensitively and as substrings, so `R2_SECRET_ACCESS_KEY` and `passwordHash`
 * are both caught.
 */
const SECRET_KEY_PATTERN =
  /(secret|password|token|authorization|cookie|credential|apikey|api_key|connection|dsn)/i;

/** Values that look like a connection string, whatever the key is called. */
const SECRET_VALUE_PATTERN = /(postgres(ql)?:\/\/|https?:\/\/[^\s]*:[^\s]*@)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return SECRET_VALUE_PATTERN.test(value) ? "[redacted]" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 12).join("\n"),
      cause: value.cause ? redact(value.cause, depth + 1) : undefined,
    };
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * A reporter is anything that wants to hear about errors: Sentry, once it has
 * a DSN, and nothing else today. Kept as an array so adding one does not mean
 * replacing one, and so a reporter that throws cannot take down the request it
 * was reporting on.
 */
type Reporter = (error: unknown, context: LogContext) => void;
const reporters: Reporter[] = [];

export function registerErrorReporter(reporter: Reporter): void {
  reporters.push(reporter);
}

function emit(severity: Severity, event: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    severity,
    event,
    at: new Date().toISOString(),
    ...(redact(context) as LogContext),
  });

  // Vercel routes stderr and stdout to the same place, but keeping the split
  // means local development still colours errors differently.
  if (severity === "error") console.error(line);
  else if (severity === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
};

/**
 * The one way an unexpected failure gets recorded.
 *
 * `event` is a stable, greppable name for *what* failed ("purge.event_failed"),
 * not a sentence. Alerts are built on these, and a message that changes wording
 * breaks every rule that matched it.
 */
export function reportError(event: string, error: unknown, context: LogContext = {}): void {
  emit("error", event, { ...context, error });

  for (const reporter of reporters) {
    try {
      reporter(error, { event, ...context });
    } catch {
      // A broken reporter must never escalate into a broken request. There is
      // deliberately no logging here either, because the thing that would do
      // the logging is what just failed.
    }
  }
}

/**
 * Wraps a route handler so an unhandled throw is recorded rather than becoming
 * an opaque 500 that nobody hears about.
 *
 * It re-throws. The point is observation, not swallowing: Next's error boundary
 * still renders, the request still fails, and the difference is that it is now
 * in the log with a name attached.
 */
export function withErrorReporting<Args extends unknown[], Result>(
  event: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      reportError(event, error);
      throw error;
    }
  };
}
