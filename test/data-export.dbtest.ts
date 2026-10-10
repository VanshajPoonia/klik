import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

/**
 * TRS-2: what someone gets when they ask for their data. Everything held about
 * them, nothing about anybody else, and no secrets.
 */

const session = { user: null as { id: string } | null };
const bucket = new Map<string, Buffer>();
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: {
    send: async (command: unknown) => {
      if (command instanceof GetObjectCommand) return { Body: Readable.from([bucket.get(command.input.Key!) ?? Buffer.alloc(0)]) };
      // Listings (exports, print designs) find nothing to delete here.
      return { Contents: [], IsTruncated: false };
    },
  },
  deleteBlobs: async (keys: string[]) => keys.forEach((key) => bucket.delete(key)),
}));

const { GET: guestDownload } = await import("@/app/api/e/[slug]/me/export/route");
const { GET: accountDownload } = await import("@/app/api/me/export/route");
const { signGuestSession, guestCookieName } = await import("@/lib/guest");
const { accountExport } = await import("@/lib/data-export");
const { grantEntitlement } = await import("@/lib/entitlements");
const { events, media, mediaComments, userPasskeys } = await import("@/lib/schema");
const { DELETE: deleteEvent } = await import("@/app/api/events/[id]/route");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session.user = null;
  bucket.clear();
  await resetDatabase();
});
afterAll(closeDatabase);

async function bodyOf(response: Response) {
  return Buffer.from(await response.arrayBuffer()).toString("latin1");
}

describe("TRS-2 a guest's download", () => {
  it("is a ZIP of only their own uploads, with a data.json, whatever the gallery's window says", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { isActive: false });
    const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
    const me = await makeGuest(eventId, { displayName: "Ana" });
    const other = await makeGuest(eventId, { displayName: "Bo" });
    const mine = await makeMedia(eventId, { guestId: me, blobPathname: "events/e/mine.jpg", mimeType: "image/jpeg" });
    await makeMedia(eventId, { guestId: other, blobPathname: "events/e/theirs.jpg", mimeType: "image/jpeg" });
    bucket.set("events/e/mine.jpg", Buffer.from("MY-PHOTO-BYTES"));
    bucket.set("events/e/theirs.jpg", Buffer.from("THEIR-PHOTO-BYTES"));

    const cookie = `${guestCookieName(eventId)}=${await signGuestSession({ guestId: me, eventId })}`;
    const response = await guestDownload(new Request(`https://example.test/api/e/${event.slug}/me/export`, { headers: { cookie } }), {
      params: Promise.resolve({ slug: event.slug }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("what-i-shared.zip");
    const zip = await bodyOf(response);
    expect(zip).toContain("data.json");
    expect(zip).toContain("MY-PHOTO-BYTES");
    expect(zip).not.toContain("THEIR-PHOTO-BYTES");
    expect(zip).toContain('"nameInThisGallery": "Ana"');
    expect(zip).toContain(`001-photo-${mine.slice(0, 8)}.jpg`);
    expect(zip).not.toContain("Bo");
  });

  it("refuses a kiosk and a stranger, and lets a signed-in account download what its guest shared", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
    const call = (cookie = "") =>
      guestDownload(new Request(`https://example.test/x`, { headers: { cookie } }), { params: Promise.resolve({ slug: event.slug }) });

    const kioskGuest = await makeGuest(eventId);
    const kioskCookie = `${guestCookieName(eventId)}=${await signGuestSession({ guestId: kioskGuest, eventId, kioskId: "k1" })}`;
    expect((await call(kioskCookie)).status).toBe(403);
    expect((await call()).status).toBe(401);

    const account = await makeUser();
    await makeGuest(eventId, { userId: account });
    session.user = { id: account };
    expect((await call()).status).toBe(200);
  });
});

describe("TRS-2 an account's download", () => {
  it("holds what is about them and none of their secrets", async () => {
    const id = await makeUser({ name: "Ana", passwordHash: "$2b$12$secret-hash-value" });
    await testDb.insert(userPasskeys).values({ id: "cred1", userId: id, publicKey: "PUBLIC-KEY-BYTES", deviceType: "multiDevice", name: "Ana's iPhone" });
    const eventId = await makeEvent(id, { name: "Our wedding", clientName: "Cy" });
    await grantEntitlement({ userId: id, planKey: "event", source: "admin", reason: "Paid by card", grantedBy: null, applyToEventId: eventId });
    const elsewhere = await makeEvent(await makeUser(), { name: "A friend's party" });
    const guestId = await makeGuest(elsewhere, { userId: id, displayName: "Ana R" });
    const photo = await makeMedia(elsewhere, { guestId });
    await testDb.insert(mediaComments).values({ id: "c1", eventId: elsewhere, mediaId: photo, userId: id, body: "Lovely!" });

    const data = await accountExport(id, "https://example.test");
    const text = JSON.stringify(data);
    expect(text).not.toContain("secret-hash-value");
    expect(text).not.toContain("PUBLIC-KEY-BYTES");
    expect(data?.signingIn).toMatchObject({ hasPassword: true, passkeys: [{ name: "Ana's iPhone", syncedAcrossDevices: true }] });
    expect(data?.plans[0]).toMatchObject({ plan: "event", reason: "Paid by card" });
    expect(data?.eventsYouRun[0]).toMatchObject({ name: "Our wedding", client: { name: "Cy" } });
    expect(data?.galleriesYouJoined[0]).toMatchObject({ name: "A friend's party", yourName: "Ana R", photosAndVideosYouShared: 1 });
    expect(data?.galleriesYouJoined[0].downloadWhatYouShared).toMatch(/\/me\/export$/);
    expect(data?.commentsYouWrote[0]).toMatchObject({ text: "Lovely!", hidden: false });

    session.user = { id };
    const response = await accountDownload();
    expect(response.headers.get("content-disposition")).toMatch(/klik-account-\d{4}-\d{2}-\d{2}\.json/);
  });
});

describe("TRS-2 erasing an event now", () => {
  it("reaches an event already in the trash, for its owner only, and takes the photos with it", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { deletedAt: new Date() });
    await makeMedia(eventId, { blobPathname: "events/x/a.jpg" });
    const erase = () =>
      deleteEvent(new Request(`https://example.test/api/events/${eventId}?erase=true`, { method: "DELETE" }), {
        params: Promise.resolve({ id: eventId }),
      });

    session.user = { id: await makeUser() };
    expect((await erase()).status).toBe(401);

    session.user = { id: owner };
    expect((await erase()).status).toBe(200);
    expect(await testDb.select().from(events).where(eq(events.id, eventId))).toHaveLength(0);
    expect(await testDb.select().from(media).where(eq(media.eventId, eventId))).toHaveLength(0);
  });
});
