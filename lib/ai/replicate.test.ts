import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { outputUrl, verifyWebhook } from "./replicate";

const secret = `whsec_${Buffer.from("a very secret key, 32 bytes long").toString("base64")}`;
const sign = (id: string, timestamp: string, body: string) =>
  createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${timestamp}.${body}`).digest("base64");

describe("Replicate's webhook signature", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const timestamp = String(now / 1000);
  const body = JSON.stringify({ id: "pred_1", status: "succeeded" });

  it("accepts the right signature among several", () => {
    const signature = `v1,${Buffer.from("not this one").toString("base64")} v1,${sign("msg_1", timestamp, body)}`;
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature }, body, now)).toBe(true);
  });

  it("refuses a changed body, a different id, a missing header or an old timestamp", () => {
    const signature = `v1,${sign("msg_1", timestamp, body)}`;
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature }, body.replace("pred_1", "pred_2"), now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_2", timestamp, signature }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature: null }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature }, body, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature: `v2,${sign("msg_1", timestamp, body)}` }, body, now)).toBe(false);
  });
});

describe("a finished run's output", () => {
  it("is one https URL, from a string or a list", () => {
    expect(outputUrl("https://replicate.delivery/x.png")).toBe("https://replicate.delivery/x.png");
    expect(outputUrl(["https://replicate.delivery/y.png"])).toBe("https://replicate.delivery/y.png");
    expect(outputUrl("http://insecure/x.png")).toBeNull();
    expect(outputUrl(null)).toBeNull();
    expect(outputUrl({ url: "https://x" })).toBeNull();
  });
});
