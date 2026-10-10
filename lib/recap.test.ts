import { describe, expect, it } from "vitest";
import {
  emailHash,
  normalizeEmail,
  recapDueAt,
  recapImageSignature,
  unsubscribeSignature,
  unsubscribeUrls,
  validTimeZone,
  verifyRecapImage,
  verifyUnsubscribe,
  zonedTime,
} from "./recap";
import { recapEmail } from "./emails/recap";

describe("GRW-1 when a recap goes", () => {
  it("finds nine in the morning in a guest's own zone, through a clock change", () => {
    expect(zonedTime("2026-10-11", 9, "America/New_York").toISOString()).toBe("2026-10-11T13:00:00.000Z");
    expect(zonedTime("2026-10-11", 9, "Asia/Kolkata").toISOString()).toBe("2026-10-11T03:30:00.000Z");
    expect(zonedTime("2026-10-11", 9, "UTC").toISOString()).toBe("2026-10-11T09:00:00.000Z");
    // New York leaves daylight time at 02:00 on 1 November 2026.
    expect(zonedTime("2026-11-01", 9, "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("is the morning after the event, or after joining for someone who came later", () => {
    const eventDate = new Date("2026-10-10T00:00:00Z");
    // Saturday 23:30 in Los Angeles is already Sunday in UTC; the morning after is still Sunday's.
    const late = new Date("2026-10-11T06:30:00Z");
    expect(recapDueAt({ eventDate, joinedAt: late, timeZone: "America/Los_Angeles" }).toISOString()).toBe(
      "2026-10-11T16:00:00.000Z",
    );
    // Joined a week before the party: still the morning after the party.
    expect(recapDueAt({ eventDate, joinedAt: new Date("2026-10-03T12:00:00Z"), timeZone: "Europe/Madrid" }).toISOString()).toBe(
      "2026-10-11T07:00:00.000Z",
    );
    // Opened the gallery three days later: the morning after that.
    expect(recapDueAt({ eventDate, joinedAt: new Date("2026-10-13T20:00:00Z"), timeZone: "Europe/Madrid" }).toISOString()).toBe(
      "2026-10-14T07:00:00.000Z",
    );
    // No date and no usable zone: the next morning, UTC.
    expect(recapDueAt({ eventDate: null, joinedAt: new Date("2026-10-10T15:00:00Z"), timeZone: "Mars/Olympus" }).toISOString()).toBe(
      "2026-10-11T09:00:00.000Z",
    );
    expect(validTimeZone("Mars/Olympus")).toBeNull();
  });
});

describe("GRW-1 addresses and links", () => {
  it("takes ordinary addresses, lower-cased, and refuses the rest", () => {
    expect(normalizeEmail("  Maya@Example.COM ")).toBe("maya@example.com");
    for (const bad of ["maya", "maya@", "@example.com", "maya@example", "a b@example.com", "<x>@example.com"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("hashes an address the same however it is written, and never contains it", () => {
    expect(emailHash("Maya@Example.com")).toBe(emailHash("maya@example.com"));
    expect(emailHash("maya@example.com")).toMatch(/^[0-9a-f]{64}$/);
    expect(unsubscribeUrls("https://klik.test", "maya@example.com").page).not.toContain("maya");
  });

  it("signs links so they cannot be pointed at someone else", () => {
    const hash = emailHash("maya@example.com");
    expect(verifyUnsubscribe(hash, unsubscribeSignature(hash))).toBe(true);
    expect(verifyUnsubscribe(emailHash("leo@example.com"), unsubscribeSignature(hash))).toBe(false);
    expect(verifyUnsubscribe("not-a-hash", unsubscribeSignature("not-a-hash"))).toBe(false);
    expect(verifyRecapImage("g1", "m1", recapImageSignature("g1", "m1"))).toBe(true);
    expect(verifyRecapImage("g2", "m1", recapImageSignature("g1", "m1"))).toBe(false);
    expect(verifyRecapImage("g1", "m2", recapImageSignature("g1", "m1"))).toBe(false);
  });
});

describe("GRW-1 the email", () => {
  const base = {
    eventName: "Anna & Leo <3",
    eventDate: new Date("2026-10-10T00:00:00Z"),
    photos: Array.from({ length: 4 }, (_, i) => ({ src: `https://klik.test/api/recap/g/m${i}/s`, href: `https://klik.test/e/x?m=m${i}` })),
    photoCount: 140,
    contributorCount: 31,
    galleryUrl: "https://klik.test/e/x",
    hostUrl: "https://klik.test/r/abc",
    unsubscribeUrl: "https://klik.test/unsubscribe?e=1&s=2",
    privacyUrl: "https://klik.test/privacy",
    postalAddress: "Kreativ Vantage, 1 Main St, Austin, TX 78701, USA",
  };

  it("carries the photos, the way back, the reason, the way out and the address", () => {
    const { subject, html, text } = recapEmail({ ...base, locale: "en" });
    expect(subject).toBe("Your photos from Anna & Leo <3");
    expect(html).toContain("Anna &amp; Leo &lt;3");
    expect(html).not.toContain("Leo <3");
    expect(html.match(/<img /g)).toHaveLength(4);
    for (const part of [html, text]) {
      expect(part).toContain("unsubscribe?e=1");
      expect(part).toContain("1 Main St");
      expect(part).toContain("140 photos shared by 31 people");
    }
    // The photos come before "host your own".
    expect(html.indexOf("m3")).toBeLessThan(html.indexOf("Hosting something"));
    expect(html + text).not.toMatch(/—|–/);
  });

  it("speaks Spanish to a guest who joined in Spanish", () => {
    const { subject, text } = recapEmail({ ...base, locale: "es" });
    expect(subject).toBe("Tus fotos de Anna & Leo <3");
    expect(text).toContain("10 de octubre de 2026");
    expect(text).toContain("No volver a enviarme un resumen");
  });
});
