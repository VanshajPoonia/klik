import { describe, expect, it } from "vitest";
import { formatEventDay, normalizeWebsite } from "./profiles";

describe("GRW-4 profile website", () => {
  it("keeps https, adds it to a bare domain, and refuses anything else", () => {
    expect(normalizeWebsite("https://studio.com/about")).toEqual({ ok: true, url: "https://studio.com/about" });
    expect(normalizeWebsite("studio.com")).toEqual({ ok: true, url: "https://studio.com/" });
    expect(normalizeWebsite("")).toEqual({ ok: true, url: null });
    expect(normalizeWebsite("http://studio.com")).toEqual({ ok: false });
    expect(normalizeWebsite("javascript:alert(1)")).toEqual({ ok: false });
    expect(normalizeWebsite("https://user:pass@studio.com")).toEqual({ ok: false });
    expect(normalizeWebsite("https://localhost")).toEqual({ ok: false });
  });
});

describe("GRW-4 event dates", () => {
  it("reads the calendar day the host picked, whatever the server's zone", () => {
    expect(formatEventDay(new Date("2026-10-12T00:00:00.000Z"))).toBe("October 12, 2026");
  });
});
