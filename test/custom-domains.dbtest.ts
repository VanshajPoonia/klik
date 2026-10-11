import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { addDomain, refreshDomain, removeDomain, reapDomains, venueForHost, domainFor, venueEntryUrl } = await import(
  "@/lib/custom-domains"
);
const { grantEntitlement } = await import("@/lib/entitlements");
const { proxy } = await import("@/proxy");
const { customDomains, domainRemovals, users } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

/** The fake Vercel project: which names it holds, and how each is set up. */
const project = new Set<string>();
let verified = true;
let misconfigured = true;
const calls: Array<{ method: string; path: string }> = [];

function vercel(url: string, init?: RequestInit): Response {
  const parsed = new URL(url);
  const method = init?.method ?? "GET";
  calls.push({ method, path: parsed.pathname });
  const match = /\/projects\/[^/]+\/domains(?:\/([^/]+))?(\/verify)?$/.exec(parsed.pathname);
  const config = /\/v6\/domains\/([^/]+)\/config$/.exec(parsed.pathname);
  const domain = (name: string) => ({
    name,
    apexName: name.split(".").slice(-2).join("."),
    projectId: "prj",
    verified,
    verification: verified ? [] : [{ type: "TXT", domain: `_vercel.${name.split(".").slice(-2).join(".")}`, value: "vc-domain-verify=x", reason: "pending" }],
  });
  if (match && method === "POST" && !match[1]) {
    const { name } = JSON.parse(String(init?.body));
    if (name === "taken.example.com") return Response.json({ error: { code: "domain_taken", message: "in use" } }, { status: 409 });
    project.add(name);
    return Response.json(domain(name));
  }
  if (match && match[1] && match[2] && method === "POST") return Response.json(domain(decodeURIComponent(match[1])));
  if (match && match[1] && method === "GET") return Response.json(domain(decodeURIComponent(match[1])));
  if (match && match[1] && method === "DELETE") {
    project.delete(decodeURIComponent(match[1]));
    return Response.json({});
  }
  if (config) {
    return Response.json({
      misconfigured,
      configuredBy: misconfigured ? null : "CNAME",
      acceptedChallenges: [],
      recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com." }],
      recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }],
    });
  }
  return Response.json({ error: { message: "unexpected" } }, { status: 400 });
}

async function venue(slug = "the-barn") {
  const id = await makeUser({ venueSlug: slug });
  await grantEntitlement({ userId: id, planKey: "venue", source: "admin", reason: "Paid", grantedBy: null });
  return id;
}

beforeEach(async () => {
  project.clear();
  calls.length = 0;
  verified = true;
  misconfigured = true;
  process.env.VERCEL_API_TOKEN = "vercel-token-for-tests";
  process.env.VERCEL_PROJECT_ID = "prj_test";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => vercel(String(input), init)));
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VERCEL_API_TOKEN;
  delete process.env.VERCEL_PROJECT_ID;
});
afterAll(closeDatabase);

describe("adding a domain", () => {
  it("is for Venue accounts, one each, never Klik's own, and refused when taken elsewhere", async () => {
    const plain = await makeUser();
    await expect(addDomain(plain, "photos.plain.com")).rejects.toMatchObject({ code: "not_venue" });
    const owner = await venue();
    await expect(addDomain(owner, "example.test")).rejects.toMatchObject({ code: "invalid" });
    await expect(addDomain(owner, "taken.example.com")).rejects.toMatchObject({ code: "taken" });
    await addDomain(owner, "Photos.TheBarn.com");
    await expect(addDomain(owner, "other.thebarn.com")).rejects.toMatchObject({ code: "exists" });
    delete process.env.VERCEL_API_TOKEN;
    await expect(addDomain(await venue("b"), "x.b.com")).rejects.toMatchObject({ code: "not_configured" });
  });

  it("shows the records to set until DNS is right, then goes live", async () => {
    const owner = await venue();
    verified = false;
    const pending = await addDomain(owner, "photos.thebarn.com");
    expect(project.has("photos.thebarn.com")).toBe(true);
    expect(pending.activeAt).toBeNull();
    expect(pending.records).toEqual([{ type: "CNAME", name: "photos", value: "abc.vercel-dns-017.com" }]);
    expect(pending.verification).toEqual([{ type: "TXT", name: "_vercel", value: "vc-domain-verify=x" }]);
    expect(calls.some((call) => call.path.endsWith("/verify"))).toBe(true);
    expect(await venueForHost("photos.thebarn.com")).toBeNull();
    expect(await venueEntryUrl(owner, "the-barn")).toBe("https://example.test/v/the-barn");

    verified = true;
    misconfigured = false;
    const live = await refreshDomain(pending.id);
    expect(live.activeAt).toBeInstanceOf(Date);
    expect(await venueForHost("photos.thebarn.com")).toBe("the-barn");
    expect(await venueEntryUrl(owner, "the-barn")).toBe("https://photos.thebarn.com");
  });
});

describe("serving a venue's domain", () => {
  async function live() {
    const owner = await venue();
    misconfigured = false;
    await addDomain(owner, "photos.thebarn.com");
    return owner;
  }
  const request = (url: string) => new NextRequest(url, { headers: { host: new URL(url).host } });

  it("leaves Klik's own host and unknown hosts alone", async () => {
    await live();
    expect((await proxy(request("https://example.test/dashboard"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("https://klik-abc.vercel.app/admin"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("https://stranger.com/dashboard"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("serves the venue hub at its root and galleries as they are, and sends everything else to Klik", async () => {
    await live();
    const root = await proxy(request("https://photos.thebarn.com/"));
    expect(root.headers.get("x-middleware-rewrite")).toBe("https://photos.thebarn.com/v/the-barn");
    expect((await proxy(request("https://photos.thebarn.com/e/maya"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("https://photos.thebarn.com/api/upload"))).headers.get("x-middleware-next")).toBe("1");
    const login = await proxy(request("https://photos.thebarn.com/login?next=/dashboard"));
    expect(login.status).toBe(308);
    expect(login.headers.get("location")).toBe("https://example.test/login?next=/dashboard");
  });

  it("stops serving when the Venue grant ends", async () => {
    const owner = await live();
    const { entitlements } = await import("@/lib/schema");
    await testDb.update(entitlements).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(entitlements.userId, owner));
    // Past the minute's cache.
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      expect(await venueForHost("photos.thebarn.com")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("removing a domain", () => {
  it("takes it off the project at once when it can, and queues it when it cannot", async () => {
    const owner = await venue();
    await addDomain(owner, "photos.thebarn.com");
    expect(await removeDomain(owner)).toBe(true);
    expect(project.has("photos.thebarn.com")).toBe(false);
    expect(await testDb.select().from(domainRemovals)).toHaveLength(0);
    expect(await domainFor(owner)).toBeNull();
  });

  it("follows the account when it is erased, and the reaper finishes the job", async () => {
    const owner = await venue();
    await addDomain(owner, "photos.thebarn.com");
    await testDb.delete(users).where(eq(users.id, owner));
    expect((await testDb.select().from(domainRemovals)).map((row) => row.hostname)).toEqual(["photos.thebarn.com"]);
    expect(project.has("photos.thebarn.com")).toBe(true);
    await reapDomains();
    expect(project.has("photos.thebarn.com")).toBe(false);
    expect(await testDb.select().from(domainRemovals)).toHaveLength(0);
  });

  it("leaves a name on the project that someone has claimed again since", async () => {
    const first = await venue("a");
    await addDomain(first, "photos.shared.com");
    await testDb.delete(customDomains).where(eq(customDomains.ownerId, first));
    const second = await venue("b");
    await addDomain(second, "photos.shared.com");
    // Adding it again cleared the queued removal, and the reaper would skip it anyway.
    await reapDomains();
    expect(project.has("photos.shared.com")).toBe(true);
  });
});
