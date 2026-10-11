import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customerHost, playsFromStream, verifyStreamWebhook } from "./stream";

describe("Stream's webhook signature", () => {
  const secret = "stream-secret";
  const body = JSON.stringify({ uid: "a".repeat(32), readyToStream: true });
  const now = Date.parse("2026-10-11T12:00:00Z");
  const time = String(now / 1000);
  const sig = createHmac("sha256", secret).update(`${time}.${body}`).digest("hex");

  it("accepts the right one", () => {
    expect(verifyStreamWebhook(secret, `time=${time},sig1=${sig}`, body, now)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, an old time or a missing header", () => {
    expect(verifyStreamWebhook(secret, `time=${time},sig1=${sig}`, body + " ", now)).toBe(false);
    expect(verifyStreamWebhook("other", `time=${time},sig1=${sig}`, body, now)).toBe(false);
    expect(verifyStreamWebhook(secret, `time=${time},sig1=${sig}`, body, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyStreamWebhook(secret, null, body, now)).toBe(false);
    expect(verifyStreamWebhook(secret, `time=${time}`, body, now)).toBe(false);
  });
});

describe("the playback host", () => {
  it("is read off a Stream HLS address and nothing else", () => {
    expect(customerHost("https://customer-abc123.cloudflarestream.com/uid/manifest/video.m3u8")).toBe(
      "customer-abc123.cloudflarestream.com",
    );
    expect(customerHost("https://evil.example/customer-abc.cloudflarestream.com")).toBeNull();
    expect(customerHost(null)).toBeNull();
  });
});

describe("whether a video plays from Stream", () => {
  it("needs a uid and a ready copy", () => {
    expect(playsFromStream({ streamUid: "a".repeat(32), streamState: "ready" })).toBe(true);
    expect(playsFromStream({ streamUid: "a".repeat(32), streamState: "pending" })).toBe(false);
    expect(playsFromStream({ streamUid: null, streamState: "ready" })).toBe(false);
  });
});
