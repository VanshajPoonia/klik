import { afterEach, describe, expect, it } from "vitest";
import { open, seal } from "./sealed";

const original = process.env.AUTH_SECRET;
afterEach(() => {
  process.env.AUTH_SECRET = original;
});

describe("sealed provider secrets", () => {
  it("open what they sealed, and differ every time they seal", () => {
    process.env.AUTH_SECRET = "first secret, long enough";
    const one = seal("signing key");
    expect(one).not.toBe(seal("signing key"));
    expect(one).not.toContain("signing key");
    expect(open(one)).toBe("signing key");
  });

  it("open nothing tampered with, malformed, or sealed under another AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "first secret, long enough";
    const sealed = seal("signing key");
    const [version, iv, body, tag] = sealed.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA");
    expect(open([version, iv, flipped, tag].join("."))).toBeNull();
    expect(open("v1.nope")).toBeNull();
    expect(open("")).toBeNull();
    process.env.AUTH_SECRET = "a rotated secret entirely";
    expect(open(sealed)).toBeNull();
  });
});
