import { describe, expect, it } from "vitest";
import { dnsRecordsFor, isGuestPath, isReservedHostname, normalizeHostname } from "./custom-domains";

describe("a venue's hostname", () => {
  it("is cleaned of scheme, path, port, case and a trailing dot", () => {
    expect(normalizeHostname(" https://Photos.TheVenue.com/gallery?x=1 ")).toBe("photos.thevenue.com");
    expect(normalizeHostname("photos.thevenue.com:443")).toBe("photos.thevenue.com");
    expect(normalizeHostname("thevenue.com.")).toBe("thevenue.com");
  });

  it("is refused when it is not a public name", () => {
    for (const bad of ["localhost", "venue", "192.168.1.1", "-bad.com", "a..b.com", "x".repeat(64) + ".com", "has space.com"]) {
      expect(normalizeHostname(bad)).toBeNull();
    }
  });

  it("can never be Klik's own, or a platform's", () => {
    const app = "klik.kreativvantage.com";
    expect(isReservedHostname("klik.kreativvantage.com", app)).toBe(true);
    expect(isReservedHostname("kreativvantage.com", app)).toBe(true);
    expect(isReservedHostname("evil.kreativvantage.com", app)).toBe(true);
    expect(isReservedHostname("klik-git-main.vercel.app", app)).toBe(true);
    expect(isReservedHostname("customer-x.cloudflarestream.com", app)).toBe(true);
    expect(isReservedHostname("photos.thevenue.com", app)).toBe(false);
  });
});

describe("the DNS records a venue is shown", () => {
  const config = {
    recommendedCNAME: [
      { rank: 2, value: "cname.vercel-dns.com." },
      { rank: 1, value: "d1a2b3.vercel-dns-017.com." },
    ],
    recommendedIPv4: [{ rank: 1, value: ["216.198.79.1", "64.29.17.1"] }],
  };

  it("is Vercel's first choice of CNAME for a subdomain, named relative to the apex", () => {
    const { records, verification } = dnsRecordsFor("photos.thevenue.com", { apexName: "thevenue.com", verified: true }, config);
    expect(records).toEqual([{ type: "CNAME", name: "photos", value: "d1a2b3.vercel-dns-017.com" }]);
    expect(verification).toEqual([]);
  });

  it("is an A record for an apex, plus the TXT proof when Vercel asks for one", () => {
    const { records, verification } = dnsRecordsFor(
      "thevenue.com",
      {
        apexName: "thevenue.com",
        verified: false,
        verification: [{ type: "TXT", domain: "_vercel.thevenue.com", value: "vc-domain-verify=thevenue.com,abc", reason: "pending" }],
      },
      config,
    );
    expect(records).toEqual([{ type: "A", name: "@", value: "216.198.79.1" }]);
    expect(verification).toEqual([{ type: "TXT", name: "_vercel", value: "vc-domain-verify=thevenue.com,abc" }]);
  });

  it("falls back to Vercel's documented defaults when it recommends nothing", () => {
    const empty = { recommendedCNAME: [], recommendedIPv4: [] };
    expect(dnsRecordsFor("photos.a.com", { apexName: "a.com", verified: true }, empty).records[0].value).toBe("cname.vercel-dns.com");
    expect(dnsRecordsFor("a.com", { apexName: "a.com", verified: true }, empty).records[0].value).toBe("76.76.21.21");
  });
});

describe("what a custom domain serves", () => {
  it("is the guest side", () => {
    for (const path of [
      "/",
      "/e/maya-and-leo",
      "/v/the-barn",
      "/s/token",
      "/k/CODE",
      "/api/e/maya/media",
      "/api/upload",
      "/api/upload/complete",
      "/api/s/token/view",
      "/api/auth/session",
      "/privacy",
      "/terms",
      "/_next/data/x.json",
      "/upload-sw.js",
      "/images/logo.png",
    ]) {
      expect(isGuestPath(path), path).toBe(true);
    }
  });

  it("is never sign-in, the dashboard, admin or the account's APIs", () => {
    for (const path of ["/login", "/signup", "/dashboard", "/dashboard/events/x", "/admin", "/api/auth/signin", "/api/me/domain", "/api/events/x", "/api/admin/x", "/api/jobs/run"]) {
      expect(isGuestPath(path), path).toBe(false);
    }
  });
});
