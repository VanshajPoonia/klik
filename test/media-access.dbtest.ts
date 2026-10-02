import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { fetchGalleryMedia } = await import("@/lib/media");
const { canViewMedia } = await import("@/lib/media-access");
const { MEDIA_STATUSES, MEDIA_VISIBILITIES } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase } = await import(
  "./harness"
);

beforeEach(resetDatabase);
afterAll(closeDatabase);

/**
 * The reason this file exists.
 *
 * Visibility is enforced in three places: the gallery query (SQL, because
 * filtering in JavaScript would mean fetching private rows and trusting the
 * client not to look), the content delivery route, and the download route. The
 * last two use a boolean. One rule, two expressions, and the way that breaks is
 * someone adding a visibility, updating the grid, and the direct URL happily
 * carrying on serving the photo.
 *
 * So rather than testing each expression against what its author believed, this
 * asserts the two agree with each other across **every** combination of
 * visibility, status and ownership, against a real database.
 */
describe("the SQL filter and the boolean check agree", () => {
  for (const uploaderSeesOwnPrivate of [true, false]) {
    for (const viewerIsUploader of [true, false]) {
      it(`for every visibility and status, uploaderSeesOwnPrivate=${uploaderSeesOwnPrivate}, viewerIsUploader=${viewerIsUploader}`, async () => {
        const owner = await makeUser();
        const eventId = await makeEvent(owner, { uploaderSeesOwnPrivate });
        const viewer = await makeGuest(eventId);
        const somebodyElse = await makeGuest(eventId);
        const uploader = viewerIsUploader ? viewer : somebodyElse;

        // One row per combination, so a single query exercises the whole matrix.
        const expected = new Map<string, boolean>();
        for (const visibility of MEDIA_VISIBILITIES) {
          for (const status of MEDIA_STATUSES) {
            const id = await makeMedia(eventId, { visibility, status, guestId: uploader });
            expected.set(
              id,
              canViewMedia(
                { visibility, status, guestId: uploader },
                { isManager: false, guestId: viewer },
                { uploaderSeesOwnPrivate },
              ),
            );
          }
        }

        const rows = await fetchGalleryMedia(eventId, {
          isOwner: false,
          guestId: viewer,
          event: { uploaderSeesOwnPrivate },
          limit: 100,
        });
        const returned = new Set(rows.map((row) => row.id));

        for (const [id, shouldSee] of expected) {
          expect(
            returned.has(id),
            `${id}: the query ${returned.has(id) ? "returned" : "hid"} it, canViewMedia said ${shouldSee}`,
          ).toBe(shouldSee);
        }
      });
    }
  }
});

describe("what a guest actually sees", () => {
  const setup = async (uploaderSeesOwnPrivate = true) => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { uploaderSeesOwnPrivate });
    const guest = await makeGuest(eventId);
    const other = await makeGuest(eventId);
    return { owner, eventId, guest, other };
  };

  const visibleTo = async (eventId: string, guestId: string | null, uploaderSeesOwnPrivate = true) =>
    new Set(
      (
        await fetchGalleryMedia(eventId, {
          isOwner: false,
          guestId,
          event: { uploaderSeesOwnPrivate },
          limit: 100,
        })
      ).map((row) => row.id),
    );

  it("hides a private photo from everyone but its uploader", async () => {
    const { eventId, guest, other } = await setup();
    const hidden = await makeMedia(eventId, { visibility: "private", guestId: other });

    expect(await visibleTo(eventId, guest)).not.toContain(hidden);
    expect(await visibleTo(eventId, other)).toContain(hidden);
  });

  it("hides it from the uploader too when the host turns the setting off", async () => {
    const { eventId, other } = await setup(false);
    const hidden = await makeMedia(eventId, { visibility: "private", guestId: other });

    expect(await visibleTo(eventId, other, false)).not.toContain(hidden);
  });

  /**
   * Link-only media is out of the room for everyone, including whoever uploaded
   * it. Marking something link-only is how a host takes it off the wall, so an
   * exception for the uploader would defeat the point.
   */
  it("hides link-only media from the gallery, uploader included", async () => {
    const { eventId, guest } = await setup();
    const linkOnly = await makeMedia(eventId, { visibility: "link", guestId: guest });

    expect(await visibleTo(eventId, guest)).not.toContain(linkOnly);
  });

  it("still shows a guest their own pending upload, which is the old rule", async () => {
    const { eventId, guest, other } = await setup();
    const mine = await makeMedia(eventId, { status: "pending", guestId: guest });
    const theirs = await makeMedia(eventId, { status: "pending", guestId: other });

    const seen = await visibleTo(eventId, guest);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
  });

  it("shows a signed-out visitor only approved gallery media", async () => {
    const { eventId, guest } = await setup();
    const open = await makeMedia(eventId);
    const pending = await makeMedia(eventId, { status: "pending", guestId: guest });
    const hidden = await makeMedia(eventId, { visibility: "private", guestId: guest });

    const seen = await visibleTo(eventId, null);
    expect(seen).toContain(open);
    expect(seen).not.toContain(pending);
    expect(seen).not.toContain(hidden);
  });

  /** Visibility and status are independent. A photo can be approved and hidden. */
  it("treats visibility and status as orthogonal", async () => {
    const { eventId, guest, other } = await setup();
    const approvedButHidden = await makeMedia(eventId, {
      status: "approved",
      visibility: "private",
      guestId: other,
    });

    expect(await visibleTo(eventId, guest)).not.toContain(approvedButHidden);
    // And it is still approved, so un-hiding it does not need re-moderating.
    expect(
      canViewMedia(
        { visibility: "gallery", status: "approved", guestId: other },
        { isManager: false, guestId: guest },
        { uploaderSeesOwnPrivate: true },
      ),
    ).toBe(true);
  });
});

describe("managers", () => {
  it("see everything, because moderating what you cannot see is impossible", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const guest = await makeGuest(eventId);

    const all: string[] = [];
    for (const visibility of MEDIA_VISIBILITIES) {
      for (const status of MEDIA_STATUSES) {
        all.push(await makeMedia(eventId, { visibility, status, guestId: guest }));
      }
    }

    const rows = await fetchGalleryMedia(eventId, {
      isOwner: true,
      guestId: null,
      event: { uploaderSeesOwnPrivate: true },
      limit: 100,
    });
    const seen = new Set(rows.map((row) => row.id));
    for (const id of all) expect(seen, id).toContain(id);
  });

  it("still never see soft-deleted media", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const trashed = await makeMedia(eventId, { deletedAt: new Date() });

    const rows = await fetchGalleryMedia(eventId, {
      isOwner: true,
      guestId: null,
      event: { uploaderSeesOwnPrivate: true },
      limit: 100,
    });
    expect(rows.map((row) => row.id)).not.toContain(trashed);
  });
});

describe("an unknown visibility", () => {
  /**
   * If a future migration adds a visibility and this module is not updated, the
   * two safe-looking options are "show it" and "hide it". Only one of those is
   * recoverable, so the default is to refuse.
   */
  it("is refused rather than guessed at", () => {
    expect(
      canViewMedia(
        // Deliberately not a valid MediaVisibility.
        { visibility: "something-new" as never, status: "approved", guestId: "g1" },
        { isManager: false, guestId: "g1" },
        { uploaderSeesOwnPrivate: true },
      ),
    ).toBe(false);
  });

  it("is still visible to a manager, so nothing becomes unreachable", () => {
    expect(
      canViewMedia(
        { visibility: "something-new" as never, status: "approved", guestId: "g1" },
        { isManager: true, guestId: null },
        { uploaderSeesOwnPrivate: true },
      ),
    ).toBe(true);
  });
});
