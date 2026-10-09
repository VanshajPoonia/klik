import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// The host is set per test, the link holder's browser has no cookies, and R2
// is stubbed at the signing step, so every route runs for real up to the URL
// it would redirect to.
let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/storage", () => ({ r2: {}, extensionForMime: () => "jpg" }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.test/signed" }));

const shares = await import("@/lib/shares");
const { resolveShareRequest } = await import("@/lib/share-request");
const { POST: createShare, GET: listShares } = await import("@/app/api/events/[id]/shares/route");
const { GET: itemContent } = await import("@/app/api/s/[token]/items/[mediaId]/content/route");
const { GET: itemDownload } = await import("@/app/api/s/[token]/items/[mediaId]/download/route");
const { GET: itemsPage } = await import("@/app/api/s/[token]/items/route");
const { GET: zip } = await import("@/app/api/s/[token]/zip/route");
const { albums, events, media, mediaShareItems, mediaShares } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import(
  "./harness"
);

beforeEach(async () => {
  session = null;
  await resetDatabase();
});
afterAll(closeDatabase);

let folderSequence = 0;
async function makeFolder(eventId: string, overrides: Partial<typeof albums.$inferInsert> = {}) {
  const id = overrides.id ?? `alb_${(folderSequence += 1)}_${Date.now().toString(36)}`;
  await testDb.insert(albums).values({ id, eventId, name: `Folder ${folderSequence}`, ...overrides });
  return id;
}

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];
const shareRow = async (id: string) => (await testDb.select().from(mediaShares).where(eq(mediaShares.id, id)))[0];

/** The ids a link opens, in the order its page shows them. */
async function opened(shareId: string): Promise<string[]> {
  const share = await shareRow(shareId);
  const { items } = await shares.listCollectionItems(share, await eventRow(share.eventId), { limit: 500 });
  return items.map((item) => item.id);
}

async function makeSelection(eventId: string, mediaIds: string[], overrides: Partial<typeof mediaShares.$inferInsert> = {}) {
  const id = await makeShare(eventId, { scope: "selection", ...overrides });
  await testDb.insert(mediaShareItems).values(mediaIds.map((mediaId) => ({ shareId: id, mediaId })));
  return id;
}

describe("a folder link", () => {
  it("opens the folder and the folders inside it, approved photos in the gallery or link-only, and nothing else", async () => {
    const eventId = await makeEvent(await makeUser());
    const ceremony = await makeFolder(eventId);
    const vows = await makeFolder(eventId, { parentId: ceremony });
    const trashed = await makeFolder(eventId, { parentId: ceremony, deletedAt: new Date() });
    const party = await makeFolder(eventId);

    const inFolder = await makeMedia(eventId, { albumId: ceremony });
    const inSubfolder = await makeMedia(eventId, { albumId: vows });
    const linkOnly = await makeMedia(eventId, { albumId: vows, visibility: "link" });
    await makeMedia(eventId, { albumId: ceremony, visibility: "private" });
    await makeMedia(eventId, { albumId: ceremony, status: "pending" });
    await makeMedia(eventId, { albumId: ceremony, status: "rejected" });
    await makeMedia(eventId, { albumId: ceremony, deletedAt: new Date() });
    await makeMedia(eventId, { albumId: trashed });
    await makeMedia(eventId, { albumId: party });
    await makeMedia(eventId);
    await makeMedia(eventId, { albumId: ceremony, kind: "video", metadataState: "pending" });

    const link = await makeShare(eventId, { scope: "album", albumId: ceremony });
    expect((await opened(link)).sort()).toEqual([inFolder, inSubfolder, linkOnly].sort());

    // A window onto the folder: what is filed there later shows through it.
    const later = await makeMedia(eventId, { albumId: vows });
    expect(await opened(link)).toContain(later);
  });

  it("shows nothing while a disposable roll has not developed", async () => {
    const eventId = await makeEvent(await makeUser(), {
      disposableMode: true,
      developsAt: new Date(Date.now() + 3_600_000),
    });
    const folder = await makeFolder(eventId);
    await makeMedia(eventId, { albumId: folder });
    expect(await opened(await makeShare(eventId, { scope: "album", albumId: folder }))).toEqual([]);
  });

  it("stops working while its folder is in the trash", async () => {
    const eventId = await makeEvent(await makeUser());
    const folder = await makeFolder(eventId, { deletedAt: new Date() });
    const link = await makeShare(eventId, { scope: "album", albumId: folder });
    const resolved = await resolveShareRequest((await shareRow(link)).token);
    expect(resolved).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("serves only its own photos by id, never another folder's or another event's", async () => {
    const eventId = await makeEvent(await makeUser());
    const folder = await makeFolder(eventId);
    const mine = await makeMedia(eventId, { albumId: folder });
    const elsewhere = await makeMedia(eventId);
    const otherEvent = await makeMedia(await makeEvent(await makeUser()));
    const { token } = await shareRow(await makeShare(eventId, { scope: "album", albumId: folder, allowDownload: true }));

    const content = (mediaId: string) =>
      itemContent(new Request(`https://klik.test/api/s/${token}/items/${mediaId}/content`), {
        params: Promise.resolve({ token, mediaId }),
      });
    expect((await content(mine)).status).toBe(307);
    expect((await content(elsewhere)).status).toBe(404);
    expect((await content(otherEvent)).status).toBe(404);

    const download = (mediaId: string) =>
      itemDownload(new Request(`https://klik.test/api/s/${token}/items/${mediaId}/download`), {
        params: Promise.resolve({ token, mediaId }),
      });
    expect((await download(mine)).status).toBe(307);
    expect((await download(elsewhere)).status).toBe(404);
  });

  it("pages through everything, newest first, with nothing twice", async () => {
    const eventId = await makeEvent(await makeUser());
    const folder = await makeFolder(eventId);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await makeMedia(eventId, { albumId: folder, createdAt: new Date(Date.UTC(2026, 9, 1, 12, index)) }));
    }
    const link = await shareRow(await makeShare(eventId, { scope: "album", albumId: folder }));
    const event = await eventRow(eventId);

    const first = await shares.listCollectionItems(link, event, { limit: 2 });
    const second = await shares.listCollectionItems(link, event, { limit: 2, cursor: first.nextCursor });
    const third = await shares.listCollectionItems(link, event, { limit: 2, cursor: second.nextCursor });
    expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual([...ids].reverse());
    expect(third.nextCursor).toBeNull();

    const response = await itemsPage(new Request(`https://klik.test/api/s/${link.token}/items?cursor=${encodeURIComponent(first.nextCursor!)}`), {
      params: Promise.resolve({ token: link.token }),
    });
    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([ids[2], ids[1], ids[0]]);
  });
});

describe("a selection link", () => {
  it("opens exactly what was picked, hidden ones included, until one is rejected or deleted", async () => {
    const eventId = await makeEvent(await makeUser());
    const shown = await makeMedia(eventId);
    const hidden = await makeMedia(eventId, { visibility: "private" });
    const later = await makeMedia(eventId);
    const notPicked = await makeMedia(eventId);
    const link = await makeSelection(eventId, [shown, hidden, later]);
    expect((await opened(link)).sort()).toEqual([shown, hidden, later].sort());
    expect(await opened(link)).not.toContain(notPicked);

    await testDb.update(media).set({ status: "rejected" }).where(eq(media.id, later));
    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, hidden));
    expect(await opened(link)).toEqual([shown]);
  });

  it("loses a photo when its guest erases it, through the cascade", async () => {
    const eventId = await makeEvent(await makeUser());
    const guest = await makeGuest(eventId);
    const theirs = await makeMedia(eventId, { guestId: guest });
    const kept = await makeMedia(eventId);
    const link = await makeSelection(eventId, [theirs, kept]);
    await testDb.delete(media).where(eq(media.id, theirs));
    expect(await opened(link)).toEqual([kept]);
  });
});

describe("what a link does not open", () => {
  it("offers no ZIP and no single download when downloads are off", async () => {
    const eventId = await makeEvent(await makeUser());
    const folder = await makeFolder(eventId);
    const photo = await makeMedia(eventId, { albumId: folder });
    const { token } = await shareRow(await makeShare(eventId, { scope: "album", albumId: folder }));
    const zipped = await zip(new Request(`https://klik.test/api/s/${token}/zip?part=1`), { params: Promise.resolve({ token }) });
    expect(zipped.status).toBe(403);
    const saved = await itemDownload(new Request(`https://klik.test/api/s/${token}/items/${photo}/download`), {
      params: Promise.resolve({ token, mediaId: photo }),
    });
    expect(saved.status).toBe(403);
  });

  it("serves nothing below a single-photo link's items, not even its own photo", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    const { token } = await shareRow(await makeShare(eventId, { mediaId: photo }));
    const response = await itemContent(new Request(`https://klik.test/api/s/${token}/items/${photo}/content`), {
      params: Promise.resolve({ token, mediaId: photo }),
    });
    expect(response.status).toBe(404);
  });

  it("refuses a turned-off folder link at every page", async () => {
    const eventId = await makeEvent(await makeUser());
    const folder = await makeFolder(eventId);
    await makeMedia(eventId, { albumId: folder });
    const { token } = await shareRow(await makeShare(eventId, { scope: "album", albumId: folder, revokedAt: new Date() }));
    const response = await itemsPage(new Request(`https://klik.test/api/s/${token}/items`), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(410);
  });
});

describe("making links", () => {
  const post = (eventId: string, body: Record<string, unknown>) =>
    createShare(new Request(`https://klik.test/api/events/${eventId}/shares`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: eventId }),
    });

  it("makes a folder link for a folder in this event, and lists it on that folder", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const folder = await makeFolder(eventId, { name: "Ceremony" });

    const response = await post(eventId, { albumId: folder, allowDownload: true });
    expect(response.status).toBe(201);
    const { share } = await response.json();
    expect(share).toMatchObject({ scope: "album", albumId: folder, albumName: "Ceremony", allowDownload: true });

    const listed = await (
      await listShares(new Request(`https://klik.test/api/events/${eventId}/shares?albumId=${folder}`), {
        params: Promise.resolve({ id: eventId }),
      })
    ).json();
    expect(listed.shares.map((row: { id: string }) => row.id)).toEqual([share.id]);
  });

  it("refuses another event's folder, a smart folder, and two targets at once", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const theirs = await makeFolder(await makeEvent(await makeUser()));
    const smart = await makeFolder(eventId, { kind: "smart" });
    const mine = await makeFolder(eventId);

    expect((await post(eventId, { albumId: theirs })).status).toBe(404);
    expect((await post(eventId, { albumId: smart })).status).toBe(404);
    expect((await post(eventId, { albumId: mine, mediaId: await makeMedia(eventId) })).status).toBe(400);
  });

  it("makes a selection link holding the picked photos, and a photo link for a selection of one", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const picked = [await makeMedia(eventId), await makeMedia(eventId), await makeMedia(eventId)];

    const many = await (await post(eventId, { mediaIds: picked })).json();
    expect(many.share).toMatchObject({ scope: "selection", itemCount: 3 });
    expect((await opened(many.share.id)).sort()).toEqual([...picked].sort());

    const one = await (await post(eventId, { mediaIds: [picked[0]] })).json();
    expect(one.share).toMatchObject({ scope: "media", mediaId: picked[0] });
  });

  it("refuses a selection with a photo from another event or one that is not in the gallery", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const mine = await makeMedia(eventId);
    const theirs = await makeMedia(await makeEvent(await makeUser()));
    const rejected = await makeMedia(eventId, { status: "rejected" });

    expect((await post(eventId, { mediaIds: [mine, theirs] })).status).toBe(409);
    expect((await post(eventId, { mediaIds: [mine, rejected] })).status).toBe(409);
    expect(await testDb.select().from(mediaShares)).toEqual([]);
  });

  it("refuses anyone who may not manage links", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    session = { user: { id: await makeUser(), role: "organizer" } };
    expect((await post(eventId, { albumId: await makeFolder(eventId) })).status).toBe(401);
  });
});
