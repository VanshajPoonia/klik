import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * MED-12: a team-only folder hides itself and everything beneath it from
 * guests, follows photos filed into or out of it and folders moved under or
 * out from it, and still opens through a folder link.
 */

const jar = new Map<string, string>();
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
vi.mock("@/lib/roles", () => ({ requireEventManagerSession: async () => null }));

const { updateFolder, galleryFolderPayload } = await import("@/lib/folders");
const { fetchGalleryMedia } = await import("@/lib/media");
const { listCollectionItems } = await import("@/lib/shares");
const { POST: arrange } = await import("@/app/api/e/[slug]/me/media/route");
const { guestCookieName, signGuestSession } = await import("@/lib/guest");
const { grantEntitlement } = await import("@/lib/entitlements");
const { albums, events, media, mediaShares } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  jar.clear();
  await resetDatabase();
});
afterAll(closeDatabase);

const event = { uploaderSeesOwnPrivate: true, disposableMode: false, developsAt: null };
const hiddenOf = async (id: string) => (await testDb.select({ h: media.folderHidden }).from(media).where(eq(media.id, id)))[0].h;

async function setUp() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  await grantEntitlement({ userId: owner, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
  await testDb.insert(albums).values([
    { id: "alb_a", eventId, name: "Getting ready" },
    { id: "alb_b", eventId, name: "Inside A", parentId: "alb_a" },
    { id: "alb_c", eventId, name: "Ceremony" },
  ]);
  const me = await makeGuest(eventId);
  const someone = await makeGuest(eventId);
  return { owner, eventId, me, someone };
}

describe("MED-12 team-only folders", () => {
  it("hides a folder and the one inside it from guests, but not from the uploader or the team", async () => {
    const { eventId, me, someone } = await setUp();
    const inA = await makeMedia(eventId, { albumId: "alb_a", guestId: someone });
    const inB = await makeMedia(eventId, { albumId: "alb_b", guestId: me });
    const inC = await makeMedia(eventId, { albumId: "alb_c" });

    await updateFolder(eventId, "alb_a", { teamOnly: true });
    expect([await hiddenOf(inA), await hiddenOf(inB), await hiddenOf(inC)]).toEqual([true, true, false]);

    const forMe = (await fetchGalleryMedia(eventId, { isOwner: false, guestId: me, event, limit: 50 })).map((row) => row.id);
    expect(forMe.sort()).toEqual([inB, inC].sort());
    const forAnyone = (await fetchGalleryMedia(eventId, { isOwner: false, guestId: null, event, limit: 50 })).map((row) => row.id);
    expect(forAnyone).toEqual([inC]);
    const forTeam = await fetchGalleryMedia(eventId, { isOwner: true, guestId: null, event, limit: 50 });
    expect(forTeam).toHaveLength(3);

    const guestFolders = await galleryFolderPayload(eventId, { isManager: false });
    expect(guestFolders.map((folder) => folder.id)).toEqual(["alb_c"]);
    const teamFolders = await galleryFolderPayload(eventId, { isManager: true });
    expect(Object.fromEntries(teamFolders.map((folder) => [folder.id, folder.teamOnly]))).toEqual({ alb_a: true, alb_b: true, alb_c: false });
  });

  it("follows photos filed in or out, and folders moved under or out from it", async () => {
    const { eventId } = await setUp();
    await updateFolder(eventId, "alb_a", { teamOnly: true });
    const filedIn = await makeMedia(eventId, { albumId: "alb_b" });
    expect(await hiddenOf(filedIn)).toBe(true);
    await testDb.update(media).set({ albumId: "alb_c" }).where(eq(media.id, filedIn));
    expect(await hiddenOf(filedIn)).toBe(false);

    const inB = await makeMedia(eventId, { albumId: "alb_b" });
    await updateFolder(eventId, "alb_b", { parentId: null });
    expect(await hiddenOf(inB)).toBe(false);
    await updateFolder(eventId, "alb_b", { parentId: "alb_a" });
    expect(await hiddenOf(inB)).toBe(true);

    await updateFolder(eventId, "alb_a", { teamOnly: false });
    expect(await hiddenOf(inB)).toBe(false);
  });

  it("still opens through a folder link, which is how one folder reaches particular people", async () => {
    const { eventId } = await setUp();
    const photo = await makeMedia(eventId, { albumId: "alb_a" });
    await updateFolder(eventId, "alb_a", { teamOnly: true });
    const shareId = await makeShare(eventId, { scope: "album", albumId: "alb_a" });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
    const [eventRow] = await testDb.select().from(events).where(eq(events.id, eventId));
    const page = await listCollectionItems(share, eventRow);
    expect(page.items.map((item) => item.id)).toEqual([photo]);
  });

  it("does not let a guest file their photo into a folder kept from them", async () => {
    const { eventId, me } = await setUp();
    await updateFolder(eventId, "alb_a", { teamOnly: true });
    const mine = await makeMedia(eventId, { guestId: me });
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: me, eventId }));
    const slug = `${eventId}-slug`;
    const response = await arrange(
      new Request(`https://klik.test/api/e/${slug}/me/media`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.30" },
        body: JSON.stringify({ action: "move", ids: [mine], albumId: "alb_b" }),
      }),
      { params: Promise.resolve({ slug }) },
    );
    expect(response.status).toBe(404);
  });
});
