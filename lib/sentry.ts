import { redact } from "./observability";

/**
 * F-9: errors to Sentry, without Sentry's SDK.
 *
 * Sentry accepts events as a plain HTTP "envelope", and an envelope is three
 * lines of JSON. Sending that ourselves keeps the parts of Sentry that matter
 * here (grouping, history, release tracking, alerts) and avoids what the SDK
 * would cost: a wrapper around the whole build, a few tens of kilobytes in
 * every guest's first page load on venue wifi, and a vendor library threaded
 * into the module graph. The one thing given up is readable stack traces for
 * minified browser code, which needs the SDK's source map upload. Server
 * traces, where the uploads, jobs, crons and webhooks run, are readable as
 * they are. Decided 2026-10-11; see ROADMAP.md section C.
 *
 * Isomorphic: the server registers it as an error reporter in
 * `instrumentation.ts`, and the browser uses it from
 * `components/error-reporting.tsx`. Nothing here imports Node or the DOM.
 *
 * **Privacy.** Context goes through the same `redact` as the log, so a token
 * or a connection string is never sent. URLs lose their query string, and the
 * path segments that are themselves secrets (share tokens, invite tokens,
 * kiosk pairing codes, recap signatures) are masked. The user is an id, never
 * a name or an email. Sentry's own "Prevent storing of IP addresses" setting
 * covers the connection's address (LAUNCH.md).
 */

export interface SentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: "https" | "http";
}

/** `https://<key>@<host>/<project>`; anything else is not a DSN. */
export function parseDsn(dsn: string | undefined | null): SentryDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !/^\d+$/.test(projectId)) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return {
      publicKey: url.username,
      host: url.host,
      projectId,
      protocol: url.protocol === "https:" ? "https" : "http",
    };
  } catch {
    return null;
  }
}

/**
 * The key rides in the query string so a browser can send this as a "simple"
 * request with no CORS preflight. It is the DSN's public half, which is
 * public by design.
 */
export function envelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(dsn.publicKey)}&sentry_client=klik%2F1`;
}

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/**
 * Chrome, Node and Edge write "at fn (file:1:2)"; Safari and Firefox write
 * "fn@file:1:2". Sentry wants the frames oldest first, which is the reverse
 * of both.
 */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(0, 60)) {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!match) continue;
    const [, fn, file, lineno, colno] = match;
    const filename = scrubUrl(file);
    frames.push({
      function: fn || undefined,
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !/node_modules|^node:|^internal\//.test(file),
    });
  }
  return frames.reverse();
}

/**
 * Path segments that are secrets in their own right. A share link's token is
 * the share; logging it hands the gallery to whoever reads the log.
 */
const SECRET_PATHS: Array<[RegExp, string]> = [
  [/\/(api\/)?s\/[^/?#]+/g, "/$1s/[token]"],
  [/\/(api\/)?invites?\/[^/?#]+/g, "/$1invite/[token]"],
  [/\/k\/[^/?#]+/g, "/k/[code]"],
  [/\/api\/recap\/[^/?#]+\/[^/?#]+\/[^/?#]+/g, "/api/recap/[guest]/[media]/[sig]"],
];

/** Drops the query and fragment and masks the secret segments above. */
export function scrubUrl(raw: string): string {
  let url = raw.replace(/[?#].*$/, "");
  for (const [pattern, replacement] of SECRET_PATHS) url = url.replace(pattern, replacement);
  return url;
}

export interface EventOptions {
  platform: "node" | "javascript";
  environment?: string;
  release?: string;
  url?: string;
  userId?: string | null;
  /** The stable event name, `upload.store_failed`, which Sentry groups and alerts on. */
  name?: string;
  context?: Record<string, unknown>;
  now?: Date;
  eventId?: string;
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exceptionOf(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || "Error", value: error.message, stack: error.stack };
  if (typeof error === "string") return { type: "Error", value: error };
  try {
    return { type: "Error", value: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: "Error", value: String(error) };
  }
}

/**
 * Only short scalar values become tags, since Sentry indexes and searches
 * them. Everything else goes to `extra`, already redacted.
 */
const TAG_KEYS = ["event", "kind", "jobId", "eventId", "mediaId", "route", "routeType", "digest"];

export function buildEvent(error: unknown, options: EventOptions): Record<string, unknown> {
  const exception = exceptionOf(error);
  const context = (redact(options.context ?? {}) as Record<string, unknown>) ?? {};
  const tags: Record<string, string> = {};
  if (options.name) tags.event = options.name;
  for (const key of TAG_KEYS) {
    const value = context[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).length <= 200) {
      tags[key] = String(value);
    }
  }
  const extra = Object.fromEntries(Object.entries(context).filter(([key]) => key !== "error" && !(key in tags)));
  const now = options.now ?? new Date();

  return {
    event_id: options.eventId ?? randomHex(16),
    timestamp: now.getTime() / 1000,
    platform: options.platform,
    level: "error",
    logger: "klik",
    environment: options.environment ?? "production",
    ...(options.release ? { release: options.release } : {}),
    // The event name first, so two different failures with the same message
    // ("fetch failed") are two issues and one failure with changing ids is one.
    fingerprint: options.name ? [options.name, exception.type] : ["{{ default }}"],
    tags,
    extra,
    ...(options.userId ? { user: { id: options.userId } } : {}),
    ...(options.url ? { request: { url: scrubUrl(options.url) } } : {}),
    exception: {
      values: [
        {
          type: exception.type,
          value: exception.value.slice(0, 2000),
          ...(exception.stack ? { stacktrace: { frames: parseStack(exception.stack) } } : {}),
        },
      ],
    },
  };
}

/** The wire format: a header line, an item header line, the item. */
export function envelope(event: Record<string, unknown>, now = new Date()): string {
  const body = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString() }),
    JSON.stringify({ type: "event" }),
    body,
  ].join("\n");
}

/**
 * Sends one event and never throws. `keepalive` lets a browser finish the
 * request while the page unloads, which is often exactly when a crash happens.
 */
export async function sendEvent(
  dsn: SentryDsn,
  event: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(envelopeUrl(dsn), {
      method: "POST",
      // text/plain keeps the browser's request "simple": no preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: envelope(event),
      keepalive: true,
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The same failure a hundred times a minute is one issue in Sentry and one
 * request from us, so a broken route at a busy party does not spend the
 * project's quota in an hour. Keyed on name and message.
 */
export function createThrottle(windowMs = 60_000, maxKeys = 200) {
  const seen = new Map<string, number>();
  return (key: string, now = Date.now()): boolean => {
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    if (seen.size >= maxKeys) {
      for (const [stale, at] of seen) if (now - at >= windowMs) seen.delete(stale);
      if (seen.size >= maxKeys) seen.delete(seen.keys().next().value as string);
    }
    seen.set(key, now);
    return true;
  };
}

/**
 * The server's reporter, for `registerErrorReporter`. Null when there is no
 * DSN, or outside a deployed build, so local development never reports.
 */
export function serverReporter(
  dsnValue: string | undefined,
  options: { environment?: string; release?: string; fetchImpl?: typeof fetch } = {},
): ((error: unknown, context: Record<string, unknown>) => void) | null {
  const dsn = parseDsn(dsnValue);
  if (!dsn) return null;
  const allow = createThrottle();
  return (error, context) => {
    const name = typeof context.event === "string" ? context.event : undefined;
    if (!allow(`${name}:${exceptionOf(error).value}`)) return;
    const userId = typeof context.userId === "string" ? context.userId : null;
    const url = typeof context.path === "string" ? context.path : undefined;
    const event = buildEvent(error, {
      platform: "node",
      environment: options.environment,
      release: options.release,
      name,
      userId,
      url,
      context,
    });
    void sendEvent(dsn, event, options.fetchImpl);
  };
}
