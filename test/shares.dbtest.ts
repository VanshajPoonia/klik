import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { countShareView, createMediaShare, listEventShares, loadShareByToken, revokeShare } =
  await import("@/lib/shares");
const { evaluateShare } = await import("@/lib/share-access");
const { events, media, mediaShares } = await import("@/lib/schema");
const {
  closeDatabase,
  daysFromNow,
  makeEvent,
  makeMedia,
  makeShare,
  makeUser,
  resetDatabase,
  testDb,
} = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

/**
 * The share-link queries, against a real Postgres.
 *
 * The view cap is the reason this file exists. It is enforced inside a
 * conditional `UPDATE ... RETURNING`, because `neon-http` has no transactions
 * and reading `view_count` before writing it back would let two concurrent opens
 * of a one-view link both observe zero and both pass. A test that mocks the
 * query cannot tell the correct version from the broken one: both return "true"
 * when asked nicely. Only a real database with real row locking can.
 */

async function scaffold() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  const mediaId = await makeMedia(eventId);
  return { owner, eventId, mediaId };
}

async function tokenFor(shareId: string): Promise<string> {
  const [row] = await testDb
    .select({ token: mediaShares.token })
    .from(mediaShares)
    .where(eq(mediaShares.id, shareId))
    .limit(1);
  return row.token;
}

async function read(shareId: string) {
  const [row] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId)).limit(1);
  return row;
}

describe("countShareView", () => {
  it("spends one view", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, maxViews: 3 });

    await expect(countShareView(await tokenFor(shareId))).resolves.toBe(true);
    expect((await read(shareId)).viewCount).toBe(1);
  });

  /**
   * The test this file was written for.
   *
   * Five simultaneous opens of a one-view link. Exactly one may succeed. The
   * read-then-write version of this function passes every sequential test and
   * fails this one, which is the whole point of having it.
   */
  it("spends exactly one view when five requests arrive at once", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, maxViews: 1 });
    const token = await tokenFor(shareId);

    const results = await Promise.all(Array.from({ length: 5 }, () => countShareView(token)));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await read(shareId)).viewCount).toBe(1);
  });

  it("never exceeds the cap under a burst larger than it", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, maxViews: 3 });
    const token = await tokenFor(shareId);

    const results = await Promise.all(Array.from({ length: 10 }, () => countShareView(token)));

    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await read(shareId)).viewCount).toBe(3);
  });

  it("refuses once the cap is reached", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, maxViews: 1, viewCount: 1 });

    await expect(countShareView(await tokenFor(shareId))).resolves.toBe(false);
    expect((await read(shareId)).viewCount).toBe(1);
  });

  it("refuses a revoked link, so revocation cannot be outrun", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, revokedAt: new Date() });

    await expect(countShareView(await tokenFor(shareId))).resolves.toBe(false);
    expect((await read(shareId)).viewCount).toBe(0);
  });

  it("refuses an expired link", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, expiresAt: daysFromNow(-1) });

    await expect(countShareView(await tokenFor(shareId))).resolves.toBe(false);
  });

  /** Expiry is compared in the database with `now()`, not against a timestamp
   *  computed in Node, so a clock difference between app and database cannot
   *  open a link the gate just closed. */
  it("allows a link expiring in the future", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId, expiresAt: daysFromNow(1) });

    await expect(countShareView(await tokenFor(shareId))).resolves.toBe(true);
  });

  it("counts an uncapped link without limit, since the number is also a statistic", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });
    const token = await tokenFor(shareId);

    for (let open = 0; open < 4; open += 1) {
      await expect(countShareView(token)).resolves.toBe(true);
    }
    expect((await read(shareId)).viewCount).toBe(4);
  });

  it("refuses an unknown token without touching anything", async () => {
    await expect(countShareView("nope-not-a-real-token")).resolves.toBe(false);
  });
});

describe("revokeShare", () => {
  it("turns the link off", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await expect(revokeShare(shareId, eventId)).resolves.toBe(true);
    expect((await read(shareId)).revokedAt).toBeInstanceOf(Date);
  });

  /**
   * Revoking twice keeps the first timestamp. "When did we turn this off" is the
   * question the column exists to answer, and an idempotent overwrite would
   * quietly re-answer it with the time somebody clicked the button again.
   */
  it("keeps the original timestamp when revoked again", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await revokeShare(shareId, eventId);
    const first = (await read(shareId)).revokedAt;

    await expect(revokeShare(shareId, eventId)).resolves.toBe(false);
    expect((await read(shareId)).revokedAt).toEqual(first);
  });

  it("refuses to revoke a link belonging to another event", async () => {
    const { eventId, mediaId } = await scaffold();
    const otherOwner = await makeUser();
    const otherEvent = await makeEvent(otherOwner);
    const shareId = await makeShare(eventId, { mediaId });

    await expect(revokeShare(shareId, otherEvent)).resolves.toBe(false);
    expect((await read(shareId)).revokedAt).toBeNull();
  });
});

describe("loadShareByToken", () => {
  it("returns the share with its event and photo", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    const resolved = await loadShareByToken(await tokenFor(shareId));
    expect(resolved?.share.id).toBe(shareId);
    expect(resolved?.event.id).toBe(eventId);
    expect(resolved?.item?.id).toBe(mediaId);
  });

  it("returns null for a token that does not exist", async () => {
    await expect(loadShareByToken("definitely-not-a-token")).resolves.toBeNull();
  });

  /** The predicate that makes deletion, retention expiry and purge all close a
   *  link without anyone having to remember to revoke it. */
  it("drops the photo once it is soft-deleted", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, mediaId));

    const resolved = await loadShareByToken(await tokenFor(shareId));
    expect(resolved).not.toBeNull();
    expect(resolved?.item).toBeNull();
  });

  it("returns nothing at all once the event is soft-deleted", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await testDb.update(events).set({ deletedAt: new Date() }).where(eq(events.id, eventId));

    await expect(loadShareByToken(await tokenFor(shareId))).resolves.toBeNull();
  });
});

describe("createMediaShare", () => {
  it("mints a usable link that the gate opens", async () => {
    const { owner, eventId, mediaId } = await scaffold();

    const share = await createMediaShare({
      eventId,
      mediaId,
      createdByUserId: owner,
      allowDownload: true,
    });

    expect(share.token).toHaveLength(22);
    expect(share.scope).toBe("media");
    expect(share.viewCount).toBe(0);
    expect(evaluateShare(share, { unlocked: false, counted: false })).toEqual({ ok: true });
  });

  it("gives every link its own token", async () => {
    const { owner, eventId, mediaId } = await scaffold();
    const first = await createMediaShare({ eventId, mediaId, createdByUserId: owner });
    const second = await createMediaShare({ eventId, mediaId, createdByUserId: owner });
    expect(first.token).not.toBe(second.token);
  });
});

describe("listEventShares", () => {
  it("returns every link on the event, revoked ones included", async () => {
    const { eventId, mediaId } = await scaffold();
    await makeShare(eventId, { mediaId });
    const revoked = await makeShare(eventId, { mediaId, revokedAt: new Date() });

    const rows = await listEventShares(eventId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.share.id)).toContain(revoked);
  });

  it("narrows to one photo when asked", async () => {
    const { eventId, mediaId } = await scaffold();
    const otherMedia = await makeMedia(eventId);
    await makeShare(eventId, { mediaId });
    await makeShare(eventId, { mediaId: otherMedia });

    const rows = await listEventShares(eventId, { mediaId });
    expect(rows).toHaveLength(1);
    expect(rows[0].share.mediaId).toBe(mediaId);
  });

  it("does not return another event's links", async () => {
    const { eventId, mediaId } = await scaffold();
    const other = await scaffold();
    await makeShare(eventId, { mediaId });
    await makeShare(other.eventId, { mediaId: other.mediaId });

    const rows = await listEventShares(eventId);
    expect(rows).toHaveLength(1);
  });
});

/**
 * The constraints in migration 0011, verified rather than assumed. These are the
 * guard rails that make the three nullable target columns safe: without them a
 * row could claim one scope while pointing at another, or at nothing.
 */
describe("the media_shares constraints", () => {
  it("rejects a media-scoped link with no photo attached", async () => {
    const { eventId } = await scaffold();
    await expect(makeShare(eventId, { scope: "media", mediaId: null })).rejects.toThrow();
  });

  it("rejects a link that points at both a photo and an album", async () => {
    const { eventId, mediaId } = await scaffold();
    const [album] = await testDb
      .insert((await import("@/lib/schema")).albums)
      .values({ id: "alb_for_constraint", eventId, name: "Folder" })
      .returning();

    await expect(
      makeShare(eventId, { scope: "media", mediaId, albumId: album.id }),
    ).rejects.toThrow();
  });

  it("rejects a scope that is not one of the three", async () => {
    const { eventId, mediaId } = await scaffold();
    await expect(
      makeShare(eventId, {
        scope: "everything" as unknown as "media",
        mediaId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate token", async () => {
    const { eventId, mediaId } = await scaffold();
    await makeShare(eventId, { mediaId, token: "duplicate-token-aaaa" });
    await expect(
      makeShare(eventId, { mediaId, token: "duplicate-token-aaaa" }),
    ).rejects.toThrow();
  });

  /**
   * Hard-deleting a photo takes its links with it, which is the reason
   * `media_id` is a real foreign key rather than one column of a polymorphic
   * target. Erasure under SEC-7 deletes rows outright, and a surviving share row
   * would be a link pointing at an object that is gone.
   */
  it("deletes a link when its photo is hard-deleted", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await testDb.delete(media).where(eq(media.id, mediaId));

    expect(await read(shareId)).toBeUndefined();
  });

  it("deletes a link when its event is hard-deleted", async () => {
    const { eventId, mediaId } = await scaffold();
    const shareId = await makeShare(eventId, { mediaId });

    await testDb.delete(events).where(eq(events.id, eventId));

    expect(await read(shareId)).toBeUndefined();
  });
});
