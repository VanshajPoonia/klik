import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { editableOriginal } = await import("@/lib/media-edits");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

const team = { isManager: true, guestId: null, kioskId: null };

describe("who may edit which photo", () => {
  it("lets the team edit any photo, and a guest only their own", async () => {
    const eventId = await makeEvent(await makeUser());
    const event = { id: eventId, disposableMode: false };
    const ana = await makeGuest(eventId);
    const sam = await makeGuest(eventId);
    const anas = await makeMedia(eventId, { guestId: ana });

    expect("original" in (await editableOriginal(event, anas, team))).toBe(true);
    expect("original" in (await editableOriginal(event, anas, { isManager: false, guestId: ana, kioskId: null }))).toBe(true);
    expect(await editableOriginal(event, anas, { isManager: false, guestId: sam, kioskId: null })).toEqual({ refused: "not_found" });
    expect(await editableOriginal(event, anas, { isManager: false, guestId: null, kioskId: null })).toEqual({ refused: "not_found" });
  });

  it("never edits a video, a trashed photo, or one from another event", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const event = { id: eventId, disposableMode: false };
    const clip = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const trashed = await makeMedia(eventId, { deletedAt: new Date() });
    const elsewhere = await makeMedia(await makeEvent(owner));
    for (const id of [clip, trashed, elsewhere]) {
      expect(await editableOriginal(event, id, team)).toEqual({ refused: "not_found" });
    }
  });

  it("refuses a kiosk, and a guest on a disposable camera, but not the host", async () => {
    const eventId = await makeEvent(await makeUser(), { disposableMode: true });
    const guest = await makeGuest(eventId);
    const photo = await makeMedia(eventId, { guestId: guest });
    const disposable = { id: eventId, disposableMode: true };
    expect(await editableOriginal(disposable, photo, { isManager: false, guestId: guest, kioskId: null })).toEqual({
      refused: "disposable",
    });
    expect(await editableOriginal(disposable, photo, { isManager: false, guestId: guest, kioskId: "k1" })).toEqual({
      refused: "kiosk",
    });
    expect("original" in (await editableOriginal(disposable, photo, team))).toBe(true);
  });
});
