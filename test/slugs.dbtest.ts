import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { changeEventSlug, findEventBySlug, listFormerSlugs, validateCustomSlug } = await import("@/lib/slugs");
const { events } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("validateCustomSlug", () => {
  it("accepts a plain address and lowercases it", () => {
    expect(validateCustomSlug("Anna-And-Leo")).toEqual({ ok: true, slug: "anna-and-leo" });
  });
  it.each(["ab", "with space", "-edge", "edge-", "dou--ble", "admin", "x".repeat(61)])("refuses %s", (value) => {
    expect(validateCustomSlug(value).ok).toBe(false);
  });
});

describe("changing an address", () => {
  it("keeps the old one working", async () => {
    const eventId = await makeEvent(await makeUser());
    const old = `${eventId}-slug`;
    expect(await changeEventSlug(eventId, "anna-and-leo")).toEqual({ ok: true });
    expect((await findEventBySlug("anna-and-leo"))?.event.id).toBe(eventId);
    expect(await findEventBySlug(old)).toMatchObject({ viaAlias: true, event: { id: eventId } });
    expect(await listFormerSlugs(eventId)).toEqual([old]);
  });

  it("refuses an address another event has, now or ever had", async () => {
    const owner = await makeUser();
    const first = await makeEvent(owner);
    const second = await makeEvent(owner);
    const firstOriginal = `${first}-slug`;
    await changeEventSlug(first, "taken-name");
    expect((await changeEventSlug(second, "taken-name")).ok).toBe(false);
    expect((await changeEventSlug(second, firstOriginal)).ok).toBe(false);
  });

  it("can go back to one of its own former addresses", async () => {
    const eventId = await makeEvent(await makeUser());
    const old = `${eventId}-slug`;
    await changeEventSlug(eventId, "new-name");
    expect(await changeEventSlug(eventId, old)).toEqual({ ok: true });
    expect((await findEventBySlug(old))?.viaAlias).toBe(false);
    expect(await listFormerSlugs(eventId)).toEqual(["new-name"]);
  });

  /**
   * The security property: a printed QR code from any point in an event's life
   * must never start leading to somebody else's gallery, even years later and
   * after the event and its row are gone.
   */
  it("never releases a deleted event's addresses, current or former", async () => {
    const owner = await makeUser();
    const gone = await makeEvent(owner);
    await changeEventSlug(gone, "the-old-wedding");
    await testDb.delete(events).where(eq(events.id, gone));

    const newcomer = await makeEvent(owner);
    expect((await changeEventSlug(newcomer, "the-old-wedding")).ok).toBe(false);
    expect((await changeEventSlug(newcomer, `${gone}-slug`)).ok).toBe(false);
    await expect(makeEvent(owner, { slug: "the-old-wedding" })).rejects.toThrow();
    expect(await findEventBySlug("the-old-wedding")).toBeNull();
  });

  it("never serves a soft-deleted event through any of its addresses", async () => {
    const eventId = await makeEvent(await makeUser());
    await changeEventSlug(eventId, "soon-gone");
    await testDb.update(events).set({ deletedAt: new Date() }).where(eq(events.id, eventId));
    expect(await findEventBySlug("soon-gone")).toBeNull();
    expect(await findEventBySlug(`${eventId}-slug`)).toBeNull();
  });
});
