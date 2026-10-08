import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

const { POST } = await import("@/app/api/events/[id]/media/bulk/route");
const { albums, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const run = (eventId: string, body: Record<string, unknown>) =>
  POST(new Request(`https://klik.test/api/events/${eventId}/media/bulk`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: eventId }),
  });
const rows = async (ids: string[]) => testDb.select().from(media).where(inArray(media.id, ids));

beforeEach(async () => {
  session = null;
  await resetDatabase();
});
afterAll(closeDatabase);

describe("POST /api/events/[id]/media/bulk", () => {
  it("changes only this event's photos, whatever ids it is sent", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const other = await makeEvent(await makeUser());
    const mine = [await makeMedia(eventId), await makeMedia(eventId)];
    const theirs = await makeMedia(other);

    const response = await run(eventId, { action: "visibility", visibility: "private", ids: [...mine, theirs] });
    const body = await response.json();
    expect(body.changed.sort()).toEqual([...mine].sort());
    expect((await rows([theirs]))[0].visibility).toBe("gallery");
  });

  it("skips anything under a legal hold", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const held = await makeMedia(eventId, { status: "rejected", legalHoldAt: new Date() });
    const body = await (await run(eventId, { action: "approve", ids: [held] })).json();
    expect(body.changed).toEqual([]);
    expect((await rows([held]))[0].status).toBe("rejected");
  });

  it("moves a deletion into the trash and back again", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const ids = [await makeMedia(eventId), await makeMedia(eventId)];
    await run(eventId, { action: "delete", ids });
    expect((await rows(ids)).every((row) => row.deletedAt)).toBe(true);
    await run(eventId, { action: "restore", ids });
    expect((await rows(ids)).every((row) => !row.deletedAt)).toBe(true);
  });

  it("refuses a folder from another event", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner, { planKey: "premium" });
    const otherEvent = await makeEvent(owner, { planKey: "premium" });
    await testDb.insert(albums).values({ id: "alb_elsewhere_1", eventId: otherEvent, name: "Theirs" });
    const id = await makeMedia(eventId);
    const response = await run(eventId, { action: "move", albumId: "alb_elsewhere_1", ids: [id] });
    expect(response.status).toBe(404);
    expect((await rows([id]))[0].albumId).toBeNull();
  });

  it("refuses someone with no session", async () => {
    const eventId = await makeEvent(await makeUser());
    expect((await run(eventId, { action: "approve", ids: ["x"] })).status).toBe(401);
  });
});
