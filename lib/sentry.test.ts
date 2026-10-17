import { describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  createThrottle,
  envelope,
  envelopeUrl,
  parseDsn,
  parseStack,
  scrubUrl,
  serverReporter,
} from "./sentry";

const DSN = "https://abc123@o42.ingest.us.sentry.io/4507";

describe("the DSN", () => {
  it("splits into key, host and project", () => {
    expect(parseDsn(DSN)).toEqual({ publicKey: "abc123", host: "o42.ingest.us.sentry.io", projectId: "4507", protocol: "https" });
  });

  it("is refused when it is not one, so a bad paste reports nothing rather than throwing", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o42.ingest.sentry.io/4507")).toBeNull();
    expect(parseDsn("https://abc@o42.ingest.sentry.io/project")).toBeNull();
  });

  it("names the envelope endpoint with the public key in the query, so a browser needs no preflight", () => {
    expect(envelopeUrl(parseDsn(DSN)!)).toBe(
      "https://o42.ingest.us.sentry.io/api/4507/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=klik%2F1",
    );
  });
});

describe("URLs that reach Sentry", () => {
  it("lose the query and every path segment that is itself a secret", () => {
    expect(scrubUrl("https://klik.test/s/AbCdEf123?x=1")).toBe("https://klik.test/s/[token]");
    expect(scrubUrl("https://klik.test/api/s/AbCdEf123/items/m1")).toBe("https://klik.test/api/s/[token]/items/m1");
    expect(scrubUrl("/invite/tok_9")).toBe("/invite/[token]");
    expect(scrubUrl("/api/invites/tok_9")).toBe("/api/invite/[token]");
    expect(scrubUrl("/k/PAIRCODE")).toBe("/k/[code]");
    expect(scrubUrl("/api/recap/g1/m1/sig123")).toBe("/api/recap/[guest]/[media]/[sig]");
    expect(scrubUrl("/unsubscribe?e=a@b.c&s=sig")).toBe("/unsubscribe");
    expect(scrubUrl("/e/maya-and-leo#photo")).toBe("/e/maya-and-leo");
  });
});

describe("stack traces", () => {
  it("reads V8's format, oldest frame first, and tells app code from libraries", () => {
    const stack = [
      "Error: boom",
      "    at storeUpload (/var/task/.next/server/app/api/upload/route.js:10:5)",
      "    at async handler (/var/task/node_modules/next/dist/server.js:3:9)",
      "    at /var/task/.next/server/chunks/1.js:7:2",
    ].join("\n");
    const frames = parseStack(stack);
    expect(frames.map((frame) => frame.lineno)).toEqual([7, 3, 10]);
    expect(frames[2]).toMatchObject({ function: "storeUpload", colno: 5, in_app: true });
    expect(frames[1].in_app).toBe(false);
  });

  it("reads Safari and Firefox's format and masks a share token in a frame's URL", () => {
    const frames = parseStack("onClick@https://klik.test/s/SECRET/_next/static/chunks/a.js:1:200\n@https://klik.test/x.js:2:3");
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ function: "onClick", filename: "https://klik.test/s/[token]/_next/static/chunks/a.js", colno: 200 });
  });
});

describe("an event", () => {
  const error = new Error("database unreachable");

  it("groups by the stable event name and carries short ids as tags", () => {
    const event = buildEvent(error, {
      platform: "node",
      name: "upload.store_failed",
      environment: "production",
      release: "abc",
      context: { eventId: "ev1", mediaId: "m1", attempts: 3 },
      now: new Date("2026-10-11T00:00:00Z"),
      eventId: "f".repeat(32),
    });
    expect(event).toMatchObject({
      event_id: "f".repeat(32),
      timestamp: Date.parse("2026-10-11T00:00:00Z") / 1000,
      level: "error",
      fingerprint: ["upload.store_failed", "Error"],
      tags: { event: "upload.store_failed", eventId: "ev1", mediaId: "m1" },
      extra: { attempts: 3 },
      release: "abc",
    });
    expect((event.exception as { values: Array<{ value: string }> }).values[0].value).toBe("database unreachable");
  });

  it("never carries a secret from the context, by key or by shape", () => {
    const event = buildEvent(error, {
      platform: "node",
      context: { apiToken: "sk_live_x", note: "postgres://user:pass@host/db", error },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain("sk_live_x");
    expect(text).not.toContain("user:pass");
  });

  it("names the user by id only", () => {
    const event = buildEvent(error, { platform: "node", userId: "u_1" });
    expect(event.user).toEqual({ id: "u_1" });
  });

  it("goes out as three lines: envelope header, item header, the event", () => {
    const event = buildEvent(error, { platform: "node", eventId: "a".repeat(32) });
    const lines = envelope(event, new Date("2026-10-11T00:00:00Z")).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ event_id: "a".repeat(32), sent_at: "2026-10-11T00:00:00.000Z" });
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]).event_id).toBe("a".repeat(32));
  });
});

describe("the throttle", () => {
  it("lets one of each failure through per window", () => {
    const allow = createThrottle(60_000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 30_000)).toBe(false);
    expect(allow("b", 30_000)).toBe(true);
    expect(allow("a", 60_000)).toBe(true);
  });

  it("stays bounded however many different failures there are", () => {
    const allow = createThrottle(60_000, 3);
    for (const key of ["a", "b", "c", "d", "e"]) expect(allow(key, 0)).toBe(true);
    // Room was made by forgetting the oldest, so it may report again.
    expect(allow("a", 1)).toBe(true);
  });
});

describe("the server reporter", () => {
  it("is absent without a DSN, so nothing is registered", () => {
    expect(serverReporter(undefined)).toBeNull();
    expect(serverReporter("garbage")).toBeNull();
  });

  it("posts an envelope once per distinct failure and never throws", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const report = serverReporter(DSN, { fetchImpl: fetchImpl as unknown as typeof fetch, release: "r1" })!;
    report(new Error("boom"), { event: "jobs.dead", kind: "media.analyze" });
    report(new Error("boom"), { event: "jobs.dead", kind: "media.analyze" });
    report(new Error("other"), { event: "jobs.dead" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/4507/envelope/");
    const item = JSON.parse(String(init.body).split("\n")[2]);
    expect(item.tags).toMatchObject({ event: "jobs.dead", kind: "media.analyze" });
    expect(item.release).toBe("r1");

    const failing = serverReporter(DSN, { fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch })!;
    expect(() => failing(new Error("x"), { event: "y" })).not.toThrow();
  });

  it("hands each send to keepAlive, so the host does not freeze the function mid-send", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const keepAlive = vi.fn();
    const report = serverReporter(DSN, { fetchImpl: fetchImpl as unknown as typeof fetch, keepAlive })!;
    report(new Error("boom"), { event: "ops.test_error" });
    expect(keepAlive).toHaveBeenCalledTimes(1);
    await expect(keepAlive.mock.calls[0][0]).resolves.toBe(true);
  });
});
