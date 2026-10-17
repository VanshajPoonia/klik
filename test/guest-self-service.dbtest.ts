import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

/**
 * MED-11: a guest hides, shows and files their own uploads and sends links to
 * them, never anyone else's, and never undoes what the host decided.
 */

const jar = new Map<string, string>();
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
vi.mock("@/lib/roles", () => ({ requireEventManagerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const { POST: arrange } = await import("@/app/api/e/[slug]/me/media/route");
const { GET: listLinks, POST: makeLink, PATCH: limitLink, DELETE: turnOff } = await import("@/app/api/e/[slug]/me/shares/route");
const { evaluateShare } = await import("@/lib/share-access");
const guestInvites = await import("@/app/api/e/[slug]/me/shares/[shareId]/invites/route");
const { POST: makeFolder } = await import("@/app/api/e/[slug]/me/folders/route");
const { events } = await import("@/lib/schema");
const { verifySharePassword } = await import("@/lib/shares");
const { guestCookieName, signGuestSession } = await import("@/lib/guest");
const { fetchGalleryMedia } = await import("@/lib/media");
const { grantEntitlement } = await import("@/lib/entitlements");
const { albums, media, mediaShareItems, mediaShares } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  jar.clear();
  await resetDatabase();
});
afterAll(closeDatabase);

async function setUp(overrides: Parameters<typeof makeEvent>[1] = {}) {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, overrides);
  await grantEntitlement({ userId: owner, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
  const me = await makeGuest(eventId);
  const someone = await makeGuest(eventId);
  jar.set(guestCookieName(eventId), await signGuestSession({ guestId: me, eventId }));
  return { owner, eventId, slug: `${eventId}-slug`, me, someone };
}

const call = (handler: typeof arrange, slug: string, body: unknown) =>
  handler(
    new Request(`https://klik.test/api/e/${slug}/me/media`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
const rowsOf = (ids: string[]) => testDb.select().from(media).where(inArray(media.id, ids));

describe("MED-11 hiding and showing", () => {
  it("hides only the guest's own, keeps it in their view, and hides it from everyone else", async () => {
    const { eventId, slug, me, someone } = await setUp({ uploaderSeesOwnPrivate: false });
    const mine = await makeMedia(eventId, { guestId: me });
    const theirs = await makeMedia(eventId, { guestId: someone });

    const response = await call(arrange, slug, { action: "hide", ids: [mine, theirs] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: [mine], skipped: [theirs] });
    const [mineRow, theirsRow] = await Promise.all([rowsOf([mine]), rowsOf([theirs])]);
    expect(mineRow[0]).toMatchObject({ visibility: "private", uploaderHidden: true });
    expect(theirsRow[0].visibility).toBe("gallery");

    // The host turned off "uploaders keep seeing their private photos", and
    // still the guest sees the one they hid themselves.
    const event = { uploaderSeesOwnPrivate: false, disposableMode: false, developsAt: null };
    const forMe = await fetchGalleryMedia(eventId, { isOwner: false, guestId: me, event, limit: 50 });
    const forSomeone = await fetchGalleryMedia(eventId, { isOwner: false, guestId: someone, event, limit: 50 });
    expect(forMe.map((row) => row.id)).toContain(mine);
    expect(forSomeone.map((row) => row.id)).not.toContain(mine);

    expect(await (await call(arrange, slug, { action: "show", ids: [mine] })).json()).toEqual({ changed: [mine], skipped: [] });
    expect((await rowsOf([mine]))[0]).toMatchObject({ visibility: "gallery", uploaderHidden: false });
  });

  it("never shows what the host hid, even after the guest hid it first", async () => {
    const { eventId, slug, me } = await setUp();
    const hostHid = await makeMedia(eventId, { guestId: me, visibility: "private" });
    const both = await makeMedia(eventId, { guestId: me });
    await call(arrange, slug, { action: "hide", ids: [both] });
    // The team takes it to link-only, then back to hidden: their decision now.
    await testDb.update(media).set({ visibility: "link" }).where(eq(media.id, both));
    await testDb.update(media).set({ visibility: "private" }).where(eq(media.id, both));
    expect((await rowsOf([both]))[0].uploaderHidden).toBe(false);

    const response = await call(arrange, slug, { action: "show", ids: [hostHid, both] });
    expect((await response.json()).changed).toEqual([]);
    expect((await rowsOf([hostHid, both])).map((row) => row.visibility)).toEqual(["private", "private"]);
  });

  it("hides all of a guest's uploads at once", async () => {
    const { eventId, slug, me, someone } = await setUp();
    const ids = [await makeMedia(eventId, { guestId: me }), await makeMedia(eventId, { guestId: me })];
    const theirs = await makeMedia(eventId, { guestId: someone });
    const response = await call(arrange, slug, { action: "hide", all: true });
    expect((await response.json()).changed.sort()).toEqual([...ids].sort());
    expect((await rowsOf([theirs]))[0].visibility).toBe("gallery");
  });

  it("refuses without a guest cookie", async () => {
    const { eventId, slug, me } = await setUp();
    const mine = await makeMedia(eventId, { guestId: me });
    jar.clear();
    expect((await call(arrange, slug, { action: "hide", ids: [mine] })).status).toBe(401);
  });
});

describe("MED-11 folders", () => {
  it("files the guest's own into this event's folders only", async () => {
    const { eventId, slug, me, someone } = await setUp();
    const otherEvent = await makeEvent(await makeUser());
    await testDb.insert(albums).values([
      { id: "alb_here", eventId, name: "Ceremony" },
      { id: "alb_there", eventId: otherEvent, name: "Elsewhere" },
    ]);
    const mine = await makeMedia(eventId, { guestId: me });
    const theirs = await makeMedia(eventId, { guestId: someone });

    expect((await call(arrange, slug, { action: "move", ids: [mine, theirs], albumId: "alb_here" })).status).toBe(200);
    expect((await rowsOf([mine]))[0].albumId).toBe("alb_here");
    expect((await rowsOf([theirs]))[0].albumId).toBeNull();
    expect((await call(arrange, slug, { action: "move", ids: [mine], albumId: "alb_there" })).status).toBe(404);
    await call(arrange, slug, { action: "move", ids: [mine], albumId: null });
    expect((await rowsOf([mine]))[0].albumId).toBeNull();
  });
});

describe("MED-11 links", () => {
  const linkCall = (handler: typeof makeLink, slug: string, init: RequestInit = {}, query = "") =>
    handler(
      new Request(`https://klik.test/api/e/${slug}/me/shares${query}`, {
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.21" },
        ...init,
      }),
      { params: Promise.resolve({ slug }) },
    );

  it("makes a photo link for one and a selection for several, of their own only, and turns them off", async () => {
    const { eventId, slug, me, someone } = await setUp();
    const a = await makeMedia(eventId, { guestId: me });
    const b = await makeMedia(eventId, { guestId: me });
    const theirs = await makeMedia(eventId, { guestId: someone });

    const one = await linkCall(makeLink, slug, { method: "POST", body: JSON.stringify({ ids: [a] }) });
    expect(one.status).toBe(201);
    const several = await linkCall(makeLink, slug, { method: "POST", body: JSON.stringify({ ids: [a, b, theirs] }) });
    expect(await several.json()).toMatchObject({ count: 2, skipped: 1 });
    expect((await linkCall(makeLink, slug, { method: "POST", body: JSON.stringify({ ids: [theirs] }) })).status).toBe(404);

    const shares = await testDb.select().from(mediaShares).where(eq(mediaShares.createdByGuestId, me));
    expect(shares.map((share) => share.scope).sort()).toEqual(["media", "selection"]);
    const selection = shares.find((share) => share.scope === "selection")!;
    const items = await testDb.select().from(mediaShareItems).where(eq(mediaShareItems.shareId, selection.id));
    expect(items.map((item) => item.mediaId).sort()).toEqual([a, b].sort());

    const listed = await (await linkCall(listLinks, slug)).json();
    expect(listed.links).toHaveLength(2);
    expect((await linkCall(turnOff, slug, { method: "DELETE" }, `?id=${selection.id}`)).status).toBe(200);
    const [after] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, selection.id));
    expect(after.revokedAt).not.toBeNull();

    // Someone else's link is not theirs to turn off.
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: someone, eventId }));
    const mediaLink = shares.find((share) => share.scope === "media")!;
    expect((await linkCall(turnOff, slug, { method: "DELETE" }, `?id=${mediaLink.id}`)).status).toBe(404);
  });

  it("gives the guest's own link an end and a password, and takes them off again", async () => {
    const { eventId, slug, me, someone } = await setUp();
    const a = await makeMedia(eventId, { guestId: me });
    const made = await (await linkCall(makeLink, slug, { method: "POST", body: JSON.stringify({ ids: [a] }) })).json();
    expect(made.id).toEqual(expect.any(String));
    const limit = (body: unknown) => linkCall(limitLink, slug, { method: "PATCH", body: JSON.stringify(body) });

    const before = Date.now();
    const response = await limit({ id: made.id, expiresInDays: 7, password: "aisle" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ locked: true });
    const [row] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, made.id));
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(row.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + week - 1000);
    expect(row.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + week);
    expect(await verifySharePassword("aisle", row.passwordHash!)).toBe(true);
    // Whoever has the link is asked for the password, and a week on it has ended.
    expect(evaluateShare(row, { unlocked: false, counted: false })).toEqual({ ok: false, reason: "password" });
    expect(evaluateShare(row, { unlocked: true, counted: false }, new Date(Date.now() + week + 60_000))).toEqual({ ok: false, reason: "expired" });

    const listed = await (await linkCall(listLinks, slug)).json();
    expect(listed.links[0]).toMatchObject({ id: made.id, locked: true, expiresAt: row.expiresAt!.toISOString() });

    const short = await limit({ id: made.id, expiresInDays: null, password: "abc" });
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("password_short");
    expect((await limit({ id: made.id, expiresInDays: 3, password: null })).status).toBe(400);

    expect((await limit({ id: made.id, expiresInDays: null, password: null })).status).toBe(200);
    const [cleared] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, made.id));
    expect(cleared).toMatchObject({ expiresAt: null, passwordHash: null });

    // Not someone else's link, and not one already turned off.
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: someone, eventId }));
    expect((await limit({ id: made.id, expiresInDays: 1, password: null })).status).toBe(404);
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: me, eventId }));
    await linkCall(turnOff, slug, { method: "DELETE" }, `?id=${made.id}`);
    expect((await limit({ id: made.id, expiresInDays: 1, password: null })).status).toBe(404);
  });

  it("sends the guest's own link to particular people, ten at a time, and nobody else's", async () => {
    const { eventId, slug, me, someone } = await setUp();
    const a = await makeMedia(eventId, { guestId: me });
    const made = await (await linkCall(makeLink, slug, { method: "POST", body: JSON.stringify({ ids: [a] }) })).json();
    const invite = (shareId: string, emails: string) =>
      guestInvites.POST(
        new Request(`https://klik.test/api/e/${slug}/me/shares/${shareId}/invites`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.22" },
          body: JSON.stringify({ emails }),
        }),
        { params: Promise.resolve({ slug, shareId }) },
      );

    const tooMany = await invite(made.id, Array.from({ length: 11 }, (_, index) => `p${index}@example.test`).join(","));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).code).toBe("too_many");

    const response = await invite(made.id, "aunt@example.test");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inviteOnly: true, invites: [expect.objectContaining({ email: "aunt@example.test" })] });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, made.id));
    expect(share.inviteOnly).toBe(true);

    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: someone, eventId }));
    expect((await invite(made.id, "x@example.test")).status).toBe(404);
  });
});

describe("MED-15 a guest's own folders", () => {
  const folderCall = (slug: string, body: unknown) =>
    makeFolder(
      new Request(`https://klik.test/api/e/${slug}/me/folders`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.23" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ slug }) },
    );

  it("makes a top-level folder the guest can file their own photos into, marked as theirs", async () => {
    const { eventId, slug, me } = await setUp();
    const mine = await makeMedia(eventId, { guestId: me });
    const response = await folderCall(slug, { name: "  Dance floor  " });
    expect(response.status).toBe(201);
    const { folder } = await response.json();
    expect(folder).toMatchObject({ name: "Dance floor", parentId: null });
    const [row] = await testDb.select().from(albums).where(eq(albums.id, folder.id));
    expect(row.createdByGuestId).toBe(me);

    expect((await call(arrange, slug, { action: "move", ids: [mine], albumId: folder.id })).status).toBe(200);
    expect((await rowsOf([mine]))[0].albumId).toBe(folder.id);
  });

  it("stops at five per guest, needs a name, and is off when the host says so", async () => {
    const { eventId, slug } = await setUp();
    for (let index = 0; index < 5; index++) expect((await folderCall(slug, { name: `F${index}` })).status).toBe(201);
    const sixth = await folderCall(slug, { name: "F5" });
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).code).toBe("guest_limit");
    expect((await folderCall(slug, { name: "   " })).status).toBe(400);

    await testDb.update(events).set({ guestFolders: false }).where(eq(events.id, eventId));
    const off = await folderCall(slug, { name: "Nope" });
    expect(off.status).toBe(403);
    expect((await off.json()).code).toBe("hosts_only");
  });

  it("refuses without a guest", async () => {
    const { slug } = await setUp();
    jar.clear();
    expect((await folderCall(slug, { name: "X" })).status).toBe(401);
  });
});
