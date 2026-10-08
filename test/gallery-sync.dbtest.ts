import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// Who is asking is decided by cookies and an Auth.js session, neither of which
// exists in a test. The viewer is set per test instead; everything after that
// (the event read, the changed-row query, the access rule) is the real code
// against a real Postgres carrying the real triggers from 0017.
const viewer = { access: { allowed: true } as { allowed: boolean; reason?: string }, guestId: null as string | null, ownerSession: null as unknown };
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));

const { GET } = await import("@/app/api/e/[slug]/media/changes/route");
const { events, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import(
  "./harness"
);

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];
const mediaRow = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

async function changes(slug: string, since: Date) {
  const response = await GET(
    new Request(`https://klik.test/api/e/${slug}/media/changes?since=${since.toISOString()}`),
    { params: Promise.resolve({ slug }) },
  );
  return { status: response.status, body: await response.json() };
}

/** Moves every timestamp an event and its media carry into the past, so a
 * test can then ask "what changed since a minute ago" and get a clean answer. */
async function age(eventId: string) {
  await testDb.execute(sql`
    UPDATE events SET updated_at = now() - interval '1 hour', media_changed_at = now() - interval '1 hour'
    WHERE id = ${eventId}`);
  // With the triggers off, or the update that ages the rows would itself count
  // as a change and stamp them back to now.
  await testDb.execute(sql`ALTER TABLE media DISABLE TRIGGER USER`);
  await testDb.execute(sql`
    UPDATE media SET created_at = now() - interval '1 hour', changed_at = now() - interval '1 hour'
    WHERE event_id = ${eventId}`);
  await testDb.execute(sql`ALTER TABLE media ENABLE TRIGGER USER`);
}

const aMinuteAgo = () => new Date(Date.now() - 60_000);

beforeEach(async () => {
  viewer.access = { allowed: true };
  viewer.guestId = null;
  // The host, unless a test is about what a guest sees.
  viewer.ownerSession = { user: { id: "owner" } };
  await resetDatabase();
});

afterAll(closeDatabase);

describe("the triggers", () => {
  it("roll a new upload up to its event", async () => {
    const eventId = await makeEvent(await makeUser());
    await age(eventId);
    const before = (await eventRow(eventId)).mediaChangedAt;
    await makeMedia(eventId);
    expect((await eventRow(eventId)).mediaChangedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("stamp a row when something a viewer can see changes", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    await age(eventId);
    await testDb.update(media).set({ status: "rejected" }).where(eq(media.id, id));
    expect((await mediaRow(id)).changedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect((await eventRow(eventId)).mediaChangedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it("leave both alone when the change is invisible to viewers, so phones are not woken for nothing", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    await age(eventId);
    const before = (await mediaRow(id)).changedAt;
    await testDb.update(media).set({ capturedAt: "2026-10-01 12:00:00" }).where(eq(media.id, id));
    // A rewrite of a watched column to the value it already had counts as no change too.
    await testDb.update(media).set({ status: "approved" }).where(eq(media.id, id));
    expect((await mediaRow(id)).changedAt).toEqual(before);
    expect((await eventRow(eventId)).mediaChangedAt.getTime()).toBeLessThan(Date.now() - 30 * 60_000);
  });
});

describe("GET /api/e/[slug]/media/changes", () => {
  it("answers a quiet gallery without anything to send", async () => {
    const eventId = await makeEvent(await makeUser());
    await makeMedia(eventId);
    await age(eventId);
    const { status, body } = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(status).toBe(200);
    expect(body).toMatchObject({ upserts: [], removed: [] });
    expect(body.resync).toBeUndefined();
  });

  it("sends a new photo, with signed URLs", async () => {
    const eventId = await makeEvent(await makeUser());
    await age(eventId);
    const id = await makeMedia(eventId);
    const { body } = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(body.upserts.map((item: { id: string }) => item.id)).toEqual([id]);
    expect(body.upserts[0].src).toContain("X-Amz-Signature");
  });

  it("tells every phone to drop a photo the host deleted", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    await age(eventId);
    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, id));
    const { body } = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(body.removed).toEqual([id]);
    expect(body.upserts).toEqual([]);
  });

  it("tells a guest to drop a photo that was hidden, and keeps it for the host", async () => {
    const eventId = await makeEvent(await makeUser(), { uploaderSeesOwnPrivate: false });
    const id = await makeMedia(eventId);
    await age(eventId);
    await testDb.update(media).set({ visibility: "private" }).where(eq(media.id, id));

    viewer.ownerSession = null;
    viewer.guestId = await makeGuest(eventId);
    expect((await changes(`${eventId}-slug`, aMinuteAgo())).body.removed).toEqual([id]);

    viewer.guestId = null;
    viewer.ownerSession = { user: { id: "owner" } };
    const host = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(host.body.upserts.map((item: { id: string }) => item.id)).toEqual([id]);
  });

  it("does not announce a hidden photo the phone never had", async () => {
    const eventId = await makeEvent(await makeUser());
    await age(eventId);
    await makeMedia(eventId, { status: "pending" });
    viewer.ownerSession = null;
    viewer.guestId = await makeGuest(eventId);
    const { body } = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(body).toMatchObject({ upserts: [], removed: [] });
  });

  it("shows a guest their own upload while it waits for approval", async () => {
    const eventId = await makeEvent(await makeUser());
    await age(eventId);
    viewer.ownerSession = null;
    viewer.guestId = await makeGuest(eventId);
    const id = await makeMedia(eventId, { status: "pending", guestId: viewer.guestId });
    const { body } = await changes(`${eventId}-slug`, aMinuteAgo());
    expect(body.upserts).toHaveLength(1);
    expect(body.upserts[0]).toMatchObject({ id, mine: true });
  });

  it("asks the phone to start over when the host changed a setting", async () => {
    const eventId = await makeEvent(await makeUser());
    await age(eventId);
    await testDb.update(events).set({ moderation: true, updatedAt: new Date() }).where(eq(events.id, eventId));
    expect((await changes(`${eventId}-slug`, aMinuteAgo())).body.resync).toBe(true);
  });

  it("refuses a viewer the gallery would refuse", async () => {
    const eventId = await makeEvent(await makeUser());
    viewer.access = { allowed: false, reason: "password_required" };
    expect((await changes(`${eventId}-slug`, aMinuteAgo())).status).toBe(403);
  });

  it("refuses someone who has neither joined nor manages the event", async () => {
    const eventId = await makeEvent(await makeUser());
    viewer.ownerSession = null;
    expect((await changes(`${eventId}-slug`, aMinuteAgo())).status).toBe(401);
  });

  it("refuses a nonsense timestamp", async () => {
    const eventId = await makeEvent(await makeUser());
    const response = await GET(new Request(`https://klik.test/api/e/${eventId}-slug/media/changes?since=yesterday`), {
      params: Promise.resolve({ slug: `${eventId}-slug` }),
    });
    expect(response.status).toBe(400);
  });
});
