import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, registerErrorReporter, reportError, withErrorReporting } from "./observability";

/** Captures the single JSON line each call emits, parsed back out. */
function captured(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalled();
  return JSON.parse(spy.mock.calls.at(-1)![0] as string);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("the shape of a log line", () => {
  it("is one JSON object with a severity, a stable event name and a timestamp", () => {
    log.info("purge.completed", { eventsPurged: 3 });
    const line = captured(logSpy);
    expect(line.severity).toBe("info");
    expect(line.event).toBe("purge.completed");
    expect(line.eventsPurged).toBe(3);
    expect(typeof line.at).toBe("string");
    expect(Number.isNaN(Date.parse(line.at as string))).toBe(false);
  });

  it("sends errors to stderr and warnings to stderr's quieter sibling", () => {
    reportError("upload.store_failed", new Error("nope"));
    expect(errorSpy).toHaveBeenCalledOnce();
    log.warn("upload.compression_retry");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("serialises an Error into something readable rather than {}", () => {
    reportError("upload.store_failed", new Error("R2 unavailable"));
    const error = captured(errorSpy).error as Record<string, unknown>;
    expect(error.name).toBe("Error");
    expect(error.message).toBe("R2 unavailable");
    expect(typeof error.stack).toBe("string");
  });
});

/**
 * The reason this file exists.
 *
 * Logs are the one place a secret leaks without anyone noticing: nothing breaks,
 * no test fails, and the value sits in a log aggregator for as long as the
 * retention window allows. Every case below is a value that genuinely passes
 * through this codebase.
 */
describe("redaction", () => {
  it.each([
    ["DATABASE_URL", "postgres://user:hunter2@ep-x.neon.tech/neondb"],
    ["POSTGRES_URL", "postgresql://user:pw@host:5432/db"],
    ["a presigned URL with credentials in it", "https://key:secret@account.r2.cloudflarestorage.com/x"],
  ])("removes %s even when the key name looks innocent", (_label, value) => {
    log.info("test", { somethingHarmlessSounding: value });
    expect(captured(logSpy).somethingHarmlessSounding).toBe("[redacted]");
  });

  it.each([
    "R2_SECRET_ACCESS_KEY",
    "passwordHash",
    "AUTH_SECRET",
    "authorization",
    "cookie",
    "sessionToken",
    "apiKey",
    "api_key",
    "SENTRY_DSN",
    "credentials",
  ])("removes anything under a key named %s", (key) => {
    log.info("test", { [key]: "the-actual-value" });
    expect(captured(logSpy)[key]).toBe("[redacted]");
  });

  it("redacts inside nested objects and arrays, not just at the top level", () => {
    log.info("test", {
      request: { headers: { authorization: "Bearer abc123" } },
      accounts: [{ password: "hunter2" }, { email: "fine@example.test" }],
    });
    const line = captured(logSpy);
    const request = line.request as { headers: Record<string, unknown> };
    expect(request.headers.authorization).toBe("[redacted]");
    const accounts = line.accounts as Array<Record<string, unknown>>;
    expect(accounts[0].password).toBe("[redacted]");
    expect(accounts[1].email).toBe("fine@example.test");
  });

  it("keeps the things that are actually useful", () => {
    log.info("purge.completed", {
      eventId: "evt_123",
      eventsPurged: 25,
      ok: false,
      at: new Date("2026-10-02T00:00:00Z"),
    });
    const line = captured(logSpy);
    expect(line.eventId).toBe("evt_123");
    expect(line.eventsPurged).toBe(25);
    expect(line.ok).toBe(false);
  });

  it("does not hang or blow the stack on a circular structure", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(() => log.info("test", { circular })).not.toThrow();
  });
});

describe("reporters", () => {
  it("passes the error and the event name to anything registered", () => {
    const reporter = vi.fn();
    registerErrorReporter(reporter);
    const failure = new Error("boom");

    reportError("purge.event_failed", failure, { eventId: "evt_1" });

    expect(reporter).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ event: "purge.event_failed", eventId: "evt_1" }),
    );
  });

  /**
   * A broken reporter must never escalate into a broken request. Sentry being
   * down is not a reason for an upload to fail.
   */
  it("survives a reporter that throws", () => {
    registerErrorReporter(() => {
      throw new Error("the reporter itself is down");
    });
    expect(() => reportError("upload.store_failed", new Error("original"))).not.toThrow();
    // The original error still reached the log, which is the point.
    expect(captured(errorSpy).event).toBe("upload.store_failed");
  });
});

describe("withErrorReporting", () => {
  it("records a throw and then re-throws it", async () => {
    const wrapped = withErrorReporting("route.failed", async () => {
      throw new Error("handler exploded");
    });

    await expect(wrapped()).rejects.toThrow("handler exploded");
    expect(captured(errorSpy).event).toBe("route.failed");
  });

  it("stays out of the way when nothing fails", async () => {
    const wrapped = withErrorReporting("route.failed", async (value: number) => value * 2);
    await expect(wrapped(21)).resolves.toBe(42);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
