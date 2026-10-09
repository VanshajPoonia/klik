import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// The host is set per test; storage is stubbed, and every key deleted is kept
// so a test can see what an erasure took with it.
let session: { user: { id: string; role: string } } | null = null;
const deleted: string[] = [];
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/storage", () => ({
  r2: { send: async () => ({ ContentLength: 2048, ContentType: "image/png" }) },
  deleteBlobs: async (keys: string[]) => {
    deleted.push(...keys);
  },
  extensionForMime: () => "jpg",
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.test/signed" }));

const { POST: create, GET: list } = await import("@/app/api/events/[id]/designs/route");
const { PATCH: save, GET: read } = await import("@/app/api/events/[id]/designs/[designId]/route");
const { POST: restore, GET: versions } = await import("@/app/api/events/[id]/designs/[designId]/versions/route");
const { POST: confirm, DELETE: removeAsset } = await import("@/app/api/events/[id]/designs/assets/[assetId]/route");
const { eraseEvent } = await import("@/lib/erasure");
const { grantEntitlement } = await import("@/lib/entitlements");
const { MAX_VERSIONS } = await import("@/lib/print-designs");
const { printDesignVersions, printDesigns } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session = null;
  deleted.length = 0;
  await resetDatabase();
});
afterAll(closeDatabase);

const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function premiumEvent(name = "Ana & Leo") {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, { name });
  await grantEntitlement({ userId: owner, planKey: "premium", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
  session = { user: { id: owner, role: "organizer" } };
  return { owner, eventId };
}

async function fromTemplate(eventId: string, template = "poster-volt") {
  const response = await create(new Request(`https://klik.test/api/events/${eventId}/designs`, json({ template })), {
    params: Promise.resolve({ id: eventId }),
  });
  return { status: response.status, body: await response.json() };
}

const patch = (eventId: string, designId: string, body: Record<string, unknown>) =>
  save(new Request(`https://klik.test/api/events/${eventId}/designs/${designId}`, json(body, "PATCH")), {
    params: Promise.resolve({ id: eventId, designId }),
  });

async function docOf(eventId: string, designId: string) {
  const response = await read(new Request(`https://klik.test/x`), { params: Promise.resolve({ id: eventId, designId }) });
  return (await response.json()).design;
}

describe("who may use the print studio", () => {
  it("is the team on Premium or Venue, for a live event", async () => {
    const { eventId } = await premiumEvent();
    expect((await fromTemplate(eventId)).status).toBe(201);

    const basic = await makeUser();
    const basicEvent = await makeEvent(basic);
    await grantEntitlement({ userId: basic, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: basicEvent });
    session = { user: { id: basic, role: "organizer" } };
    expect((await fromTemplate(basicEvent)).status).toBe(403);

    const drafting = await makeUser();
    session = { user: { id: drafting, role: "organizer" } };
    expect((await fromTemplate(await makeEvent(drafting, { planKey: "premium" }))).status).toBe(409);

    session = { user: { id: await makeUser(), role: "organizer" } };
    expect((await fromTemplate(eventId)).status).toBe(401);
  });
});

describe("a design", () => {
  it("starts from a template filled with the event's name, and lists", async () => {
    const { eventId } = await premiumEvent("Ana & Leo");
    const { body } = await fromTemplate(eventId);
    expect(body.design).toMatchObject({ name: "Poster", preset: "a4", widthMm: 210, heightMm: 297, revision: 1 });
    const design = await docOf(eventId, body.design.id);
    expect(design.doc.elements.some((element: { bind?: string; text?: string }) => element.bind === "eventName" && element.text === "Ana & Leo")).toBe(true);

    const listed = await (await list(new Request("https://klik.test/x"), { params: Promise.resolve({ id: eventId }) })).json();
    expect(listed.designs.map((row: { id: string }) => row.id)).toEqual([body.design.id]);
  });

  it("refuses a save from a copy someone else has moved past, and keeps it when the host chooses", async () => {
    const { eventId } = await premiumEvent();
    const { body } = await fromTemplate(eventId);
    const design = await docOf(eventId, body.design.id);
    const edited = { ...design.doc, background: { ...design.doc.background, color: "#123456" } };

    const first = await patch(eventId, design.id, { doc: edited, baseRevision: 1 });
    expect(first.status).toBe(200);
    expect((await first.json()).design.revision).toBe(2);

    const stale = await patch(eventId, design.id, { doc: design.doc, baseRevision: 1 });
    expect(stale.status).toBe(409);
    const conflict = await stale.json();
    expect(conflict.current.revision).toBe(2);
    expect(conflict.current.doc.background.color).toBe("#123456");

    const forced = await patch(eventId, design.id, { doc: design.doc, baseRevision: 1, force: true });
    expect(forced.status).toBe(200);
    expect((await docOf(eventId, design.id)).doc.background.color).toBe(design.doc.background.color);
  });

  it("refuses a scene it cannot read, and a photo from another event", async () => {
    const { eventId } = await premiumEvent();
    const { body } = await fromTemplate(eventId);
    expect((await patch(eventId, body.design.id, { doc: { schemaVersion: 99 }, baseRevision: 1 })).status).toBe(400);

    const design = await docOf(eventId, body.design.id);
    const borrowed = { ...design.doc, background: { color: "#ffffff", assetId: "someone-elses-photo" } };
    expect((await patch(eventId, body.design.id, { doc: borrowed, baseRevision: 1 })).status).toBe(400);
  });
});

describe("versions", () => {
  it("keep the replaced state every few minutes, the last ten at most, and a restore can itself be undone", async () => {
    const { eventId } = await premiumEvent();
    const { body } = await fromTemplate(eventId);
    const design = await docOf(eventId, body.design.id);
    let revision = 1;

    for (let step = 0; step < MAX_VERSIONS + 3; step += 1) {
      const doc = { ...design.doc, background: { ...design.doc.background, color: `#0000${String(step).padStart(2, "0")}` } };
      const response = await patch(eventId, design.id, { doc, baseRevision: revision });
      revision = (await response.json()).design.revision;
      // As if the next save came long after this one.
      await testDb.execute(sql`UPDATE print_design_versions SET created_at = created_at - interval '1 hour'`);
    }
    const kept = await testDb.select().from(printDesignVersions).where(eq(printDesignVersions.designId, design.id));
    expect(kept).toHaveLength(MAX_VERSIONS);

    // Two saves a moment apart keep one version, not two.
    await testDb.delete(printDesignVersions);
    for (const color of ["#aaaaaa", "#bbbbbb"]) {
      const response = await patch(eventId, design.id, { doc: { ...design.doc, background: { ...design.doc.background, color } }, baseRevision: revision });
      revision = (await response.json()).design.revision;
    }
    const listed = await (await versions(new Request("https://klik.test/x"), { params: Promise.resolve({ id: eventId, designId: design.id }) })).json();
    expect(listed.versions).toHaveLength(1);

    const restored = await (
      await restore(new Request("https://klik.test/x", json({ versionId: listed.versions[0].id })), {
        params: Promise.resolve({ id: eventId, designId: design.id }),
      })
    ).json();
    expect(restored.design.doc.background.color).toBe("#000012");
    const after = await testDb.select().from(printDesignVersions).where(eq(printDesignVersions.designId, design.id));
    expect(after.map((version) => (version.doc as { background: { color: string } }).background.color)).toContain("#bbbbbb");
  });
});

describe("uploaded images", () => {
  it("are recorded once uploaded, refused for deletion while a design draws them, and erased with the event", async () => {
    const { eventId } = await premiumEvent();
    const assetId = "asset_abcdefghij";
    const confirmed = await confirm(new Request("https://klik.test/x", json({ mimeType: "image/png", width: 3000, height: 2000 })), {
      params: Promise.resolve({ id: eventId, assetId }),
    });
    expect(confirmed.status).toBe(201);

    const { body } = await fromTemplate(eventId);
    const design = await docOf(eventId, body.design.id);
    const withPhoto = { ...design.doc, background: { color: "#ffffff", assetId } };
    expect((await patch(eventId, design.id, { doc: withPhoto, baseRevision: 1 })).status).toBe(200);

    const refused = await removeAsset(new Request("https://klik.test/x", { method: "DELETE" }), { params: Promise.resolve({ id: eventId, assetId }) });
    expect(refused.status).toBe(409);

    await testDb.update(printDesigns).set({ thumbnailKey: `designs/${eventId}/${design.id}-thumb.jpg` });
    await eraseEvent(eventId, null);
    expect(deleted).toEqual(expect.arrayContaining([`designs/${eventId}/${assetId}.png`, `designs/${eventId}/${design.id}-thumb.jpg`]));
  });
});
