import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

const deleteBlobs = vi.fn(async (keys: string[]) => {
  void keys;
});
const sendEmail = vi.fn(async (message: { to: string; subject: string }) => {
  void message;
  return { sent: true };
});
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  deleteBlobs,
}));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));

const { setReaction, reactedIds, withViewerReactions } = await import("@/lib/reactions");
const {
  addComment,
  adminResolveComment,
  cleanCommentBody,
  commentAuthorName,
  deleteOwnComment,
  fileCommentReport,
  listComments,
  listOpenCommentReports,
  moderateComment,
  reportedComments,
} = await import("@/lib/comments");
const { eraseGuest } = await import("@/lib/erasure");
const { eventInsights } = await import("@/lib/insights");
const { commentReports, eventCoHosts, events, media, mediaComments, mediaReactions } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const counts = async (id: string) =>
  (
    await testDb
      .select({ hearts: media.reactionCount, comments: media.commentCount, changedAt: media.changedAt })
      .from(media)
      .where(eq(media.id, id))
  )[0];

/** An event with comments and hearts on, its owner, and one photo. */
async function gallery() {
  const ownerId = await makeUser({ name: "Priya Host" });
  const eventId = await makeEvent(ownerId, { reactionsEnabled: true, commentsEnabled: true });
  const photo = await makeMedia(eventId);
  return { ownerId, eventId, photo };
}

/** A signed-in guest: an account, and their guest row at this event. */
async function signedInGuest(eventId: string, name: string | null, accountName: string | null = null) {
  const userId = await makeUser({ name: accountName, username: `gen_${Math.random().toString(36).slice(2, 8)}` });
  const guestId = await makeGuest(eventId, { displayName: name, userId });
  return { userId, guestId };
}

beforeEach(async () => {
  deleteBlobs.mockClear();
  sendEmail.mockClear();
  process.env.ALERT_EMAIL = "ops@example.test";
  await resetDatabase();
});

afterAll(closeDatabase);

describe("hearts", () => {
  it("counts one heart per person however often they tap, and takes it back", async () => {
    const { eventId, photo } = await gallery();
    const guestId = await makeGuest(eventId);
    expect(await setReaction(photo, { guestId }, true)).toEqual({ reacted: true, count: 1 });
    expect(await setReaction(photo, { guestId }, true)).toEqual({ reacted: true, count: 1 });
    expect(await setReaction(photo, { guestId }, false)).toEqual({ reacted: false, count: 0 });
    expect(await setReaction(photo, { guestId }, false)).toEqual({ reacted: false, count: 0 });
  });

  it("keeps a guest's heart and the host's apart", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const guestId = await makeGuest(eventId);
    await setReaction(photo, { guestId }, true);
    expect((await setReaction(photo, { userId: ownerId }, true)).count).toBe(2);
    expect([...(await reactedIds([photo], { userId: ownerId }))]).toEqual([photo]);
    expect([...(await reactedIds([photo], { guestId: await makeGuest(eventId) }))]).toEqual([]);
  });

  it("tells each viewer which items they hearted, and skips the query with hearts off", async () => {
    const { eventId, photo } = await gallery();
    const other = await makeMedia(eventId);
    const guestId = await makeGuest(eventId);
    await setReaction(photo, { guestId }, true);
    const decorated = await withViewerReactions([{ id: photo }, { id: other }], { reactionsEnabled: true }, { guestId });
    expect(decorated.map((item) => item.reacted)).toEqual([true, false]);
    const off = await withViewerReactions([{ id: photo }], { reactionsEnabled: false }, { guestId });
    expect(off[0].reacted).toBe(false);
  });

  it("moves the item's change stamp, so every phone's sync brings the new count", async () => {
    const { eventId, photo } = await gallery();
    await testDb.update(media).set({ changedAt: sql`now() - interval '1 hour'` }).where(eq(media.id, photo));
    await testDb.update(events).set({ mediaChangedAt: sql`now() - interval '1 hour'` }).where(eq(events.id, eventId));
    const before = await counts(photo);
    await setReaction(photo, { guestId: await makeGuest(eventId) }, true);
    const after = await counts(photo);
    expect(after.changedAt.getTime()).toBeGreaterThan(before.changedAt.getTime());
    const [event] = await testDb.select({ at: events.mediaChangedAt }).from(events).where(eq(events.id, eventId));
    expect(event.at.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("refuses a heart whose reactor does not match the id it carries", async () => {
    const { ownerId, photo } = await gallery();
    await expect(
      testDb.insert(mediaReactions).values({ mediaId: photo, reactor: "g:someone", userId: ownerId }),
    ).rejects.toThrow();
  });

  it("goes with the guest who gave it, and the count follows", async () => {
    const { eventId, photo } = await gallery();
    const leaving = await makeGuest(eventId);
    await setReaction(photo, { guestId: leaving }, true);
    await setReaction(photo, { guestId: await makeGuest(eventId) }, true);
    await eraseGuest(leaving, eventId, null);
    expect((await counts(photo)).hearts).toBe(1);
  });

  it("does not get in the way of deleting the photo itself", async () => {
    const { eventId, photo } = await gallery();
    await setReaction(photo, { guestId: await makeGuest(eventId) }, true);
    await testDb.delete(media).where(eq(media.id, photo));
    expect(await testDb.select().from(mediaReactions)).toHaveLength(0);
  });
});

describe("comment text", () => {
  it("cleans what was typed and refuses what is empty or too long", () => {
    expect(cleanCommentBody("  so lovely  ")).toBe("so lovely");
    expect(cleanCommentBody("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
    expect(cleanCommentBody("hi\u0007‮there")).toBe("hithere");
    expect(cleanCommentBody("   \n ")).toBeNull();
    expect(cleanCommentBody("x".repeat(501))).toBeNull();
    expect(cleanCommentBody("x".repeat(500))).toHaveLength(500);
  });

  it("names a guest by the name they gave this gallery, never by their generated username", () => {
    expect(commentAuthorName({ team: false, userName: "Account Name", guestName: "Sam" })).toBe("Sam");
    expect(commentAuthorName({ team: false, userName: "Account Name", guestName: " " })).toBe("Account Name");
    expect(commentAuthorName({ team: false, userName: null, guestName: null })).toBe("Guest");
    expect(commentAuthorName({ team: true, userName: null, guestName: null })).toBe("Host");
  });
});

describe("comments", () => {
  it("shows guests the visible thread plus their own hidden comments, and the team everything", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const sam = await signedInGuest(eventId, "Sam");
    const alex = await signedInGuest(eventId, "Alex");
    const base = { eventId, eventOwnerId: ownerId, mediaId: photo };
    const kept = await addComment({ ...base, userId: sam.userId, body: "Gorgeous", isManager: false });
    const rude = await addComment({ ...base, userId: alex.userId, body: "Rude thing", isManager: false });
    await moderateComment({ eventId, mediaId: photo, commentId: rude.id, action: "hide", byUserId: ownerId });

    const asSam = await listComments({ ...base, viewer: { userId: sam.userId, isManager: false } });
    expect(asSam.map((comment) => comment.id)).toEqual([kept.id]);
    expect(asSam[0].hidden).toBeNull();
    expect(asSam[0].openReports).toBeUndefined();

    const asAlex = await listComments({ ...base, viewer: { userId: alex.userId, isManager: false } });
    expect(asAlex.map((comment) => [comment.body, comment.hidden, comment.mine])).toEqual([
      ["Gorgeous", null, false],
      ["Rude thing", "host", true],
    ]);

    const asTeam = await listComments({ ...base, viewer: { userId: ownerId, isManager: true } });
    expect(asTeam).toHaveLength(2);
    expect(asTeam[1].hidden).toBe("host");
  });

  it("marks the team, co-hosts included, and names everyone else from this gallery", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const coHost = await makeUser({ name: "Jo Cohost" });
    await testDb.insert(eventCoHosts).values({ eventId, userId: coHost, role: "moderator" });
    const guest = await signedInGuest(eventId, "Sam", "Samuel Account");
    const base = { eventId, eventOwnerId: ownerId, mediaId: photo };
    await addComment({ ...base, userId: ownerId, body: "Thanks all", isManager: true });
    await addComment({ ...base, userId: coHost, body: "Lovely", isManager: true });
    await addComment({ ...base, userId: guest.userId, body: "Wow", isManager: false });
    const thread = await listComments({ ...base, viewer: { userId: null, isManager: false } });
    expect(thread.map((comment) => comment.author)).toEqual([
      { name: "Priya Host", team: true },
      { name: "Jo Cohost", team: true },
      { name: "Sam", team: false },
    ]);
  });

  it("counts visible comments on the photo as they are hidden, shown and deleted", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const guest = await signedInGuest(eventId, "Sam");
    const base = { eventId, eventOwnerId: ownerId, mediaId: photo, userId: guest.userId, isManager: false };
    const first = await addComment({ ...base, body: "one" });
    await addComment({ ...base, body: "two" });
    expect((await counts(photo)).comments).toBe(2);
    await moderateComment({ eventId, mediaId: photo, commentId: first.id, action: "hide", byUserId: ownerId });
    expect((await counts(photo)).comments).toBe(1);
    await moderateComment({ eventId, mediaId: photo, commentId: first.id, action: "show", byUserId: ownerId });
    expect((await counts(photo)).comments).toBe(2);
    expect(await deleteOwnComment(first.id, photo, ownerId)).toBe(false);
    expect(await deleteOwnComment(first.id, photo, guest.userId)).toBe(true);
    expect((await counts(photo)).comments).toBe(1);
  });

  it("refuses an empty or oversized comment at the database too", async () => {
    const { eventId, photo } = await gallery();
    const guest = await signedInGuest(eventId, "Sam");
    await expect(
      testDb.insert(mediaComments).values({ id: "c1", eventId, mediaId: photo, userId: guest.userId, body: "" }),
    ).rejects.toThrow();
    await expect(
      testDb
        .insert(mediaComments)
        .values({ id: "c2", eventId, mediaId: photo, userId: guest.userId, body: "x".repeat(501) }),
    ).rejects.toThrow();
  });

  it("goes with what a signed-in guest added when they remove everything, and only at that event", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const elsewhere = await makeEvent(ownerId, { commentsEnabled: true });
    const elsewherePhoto = await makeMedia(elsewhere);
    const guest = await signedInGuest(eventId, "Sam");
    await addComment({ eventId, eventOwnerId: ownerId, mediaId: photo, userId: guest.userId, body: "here", isManager: false });
    await addComment({
      eventId: elsewhere,
      eventOwnerId: ownerId,
      mediaId: elsewherePhoto,
      userId: guest.userId,
      body: "there",
      isManager: false,
    });
    await eraseGuest(guest.guestId, eventId, null);
    const left = await testDb.select({ body: mediaComments.body }).from(mediaComments);
    expect(left.map((row) => row.body)).toEqual(["there"]);
    expect((await counts(photo)).comments).toBe(0);
  });
});

describe("comment reports", () => {
  async function reportedSetup() {
    const { ownerId, eventId, photo } = await gallery();
    const author = await signedInGuest(eventId, "Alex");
    const comment = await addComment({
      eventId,
      eventOwnerId: ownerId,
      mediaId: photo,
      userId: author.userId,
      body: "Something unkind",
      isManager: false,
    });
    return { ownerId, eventId, photo, commentId: comment.id };
  }
  const reportIt = (eventId: string, commentId: string, reason: "harassment" | "child_safety", ip: string) =>
    fileCommentReport({ eventId, commentId, reason, reporter: { ip } });

  it("takes one report per person, and hides the comment after three people", async () => {
    const { eventId, photo, commentId } = await reportedSetup();
    expect((await reportIt(eventId, commentId, "harassment", "1.1.1.1")).created).toBe(true);
    expect((await reportIt(eventId, commentId, "harassment", "1.1.1.1")).created).toBe(false);
    await reportIt(eventId, commentId, "harassment", "2.2.2.2");
    expect((await counts(photo)).comments).toBe(1);
    const third = await reportIt(eventId, commentId, "harassment", "3.3.3.3");
    expect(third.hidden).toBe(true);
    const [row] = await testDb.select().from(mediaComments).where(eq(mediaComments.id, commentId));
    expect(row.hiddenReason).toBe("reports");
    expect((await counts(photo)).comments).toBe(0);
    // Three reports on a comment are not three on the photo under it.
    expect((await testDb.select().from(media).where(eq(media.id, photo)))[0].status).toBe("approved");
  });

  it("emails the host once however many reports arrive", async () => {
    const { eventId, commentId } = await reportedSetup();
    await reportIt(eventId, commentId, "harassment", "1.1.1.1");
    await reportIt(eventId, commentId, "harassment", "2.2.2.2");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain("comment");
  });

  it("hides a child-safety report at once, tells Klik and not the host, and only Klik can show it", async () => {
    const { ownerId, eventId, photo, commentId } = await reportedSetup();
    const result = await reportIt(eventId, commentId, "child_safety", "1.1.1.1");
    expect(result.hidden).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe("ops@example.test");

    expect(await moderateComment({ eventId, mediaId: photo, commentId, action: "show", byUserId: ownerId })).toBe(
      "klik_only",
    );
    // Hiding is fine, and leaves the report open for Klik.
    expect(await moderateComment({ eventId, mediaId: photo, commentId, action: "hide", byUserId: ownerId })).toBe(
      "hidden",
    );
    const [open] = await reportedComments(eventId);
    expect(open?.safetyHold).toBe(true);
  });

  it("closes the reports when the host keeps a comment up, and says so in the outcome", async () => {
    const { ownerId, eventId, photo, commentId } = await reportedSetup();
    await reportIt(eventId, commentId, "harassment", "1.1.1.1");
    expect(await reportedComments(eventId)).toHaveLength(1);
    expect(await moderateComment({ eventId, mediaId: photo, commentId, action: "show", byUserId: ownerId })).toBe(
      "kept",
    );
    expect(await reportedComments(eventId)).toHaveLength(0);
    const [report] = await testDb.select().from(commentReports);
    expect(report.resolution).toBe("Kept by the host.");
  });

  it("lets Klik keep what reports hid, but never undoes the host's own hide", async () => {
    const { ownerId, eventId, photo, commentId } = await reportedSetup();
    await moderateComment({ eventId, mediaId: photo, commentId, action: "hide", byUserId: ownerId });
    await reportIt(eventId, commentId, "harassment", "1.1.1.1");
    const admin = await makeUser({ role: "superadmin" });
    await adminResolveComment(commentId, { action: "keep", byUserId: admin, note: "Fine by our rules" });
    const [row] = await testDb.select().from(mediaComments).where(eq(mediaComments.id, commentId));
    expect(row.hiddenReason).toBe("host");
    expect(await listOpenCommentReports()).toHaveLength(0);
  });

  it("hides as Klik, which the host cannot reverse, or deletes outright", async () => {
    const { ownerId, eventId, photo, commentId } = await reportedSetup();
    await reportIt(eventId, commentId, "harassment", "1.1.1.1");
    const admin = await makeUser({ role: "superadmin" });
    const queue = await listOpenCommentReports();
    expect(queue.map((row) => [row.commentId, row.body, row.authorName])).toEqual([
      [commentId, "Something unkind", "Alex"],
    ]);
    await adminResolveComment(commentId, { action: "hide", byUserId: admin, note: "Harassment" });
    expect(await moderateComment({ eventId, mediaId: photo, commentId, action: "show", byUserId: ownerId })).toBe(
      "klik_only",
    );
    await adminResolveComment(commentId, { action: "delete", byUserId: admin, note: "Removing" });
    expect(await testDb.select().from(mediaComments).where(eq(mediaComments.id, commentId))).toHaveLength(0);
    expect(await testDb.select().from(commentReports)).toHaveLength(0);
  });
});

describe("insights", () => {
  it("adds up hearts and comments, and ranks the favourites", async () => {
    const { ownerId, eventId, photo } = await gallery();
    const second = await makeMedia(eventId);
    const guests = await Promise.all([makeGuest(eventId), makeGuest(eventId)]);
    for (const guestId of guests) await setReaction(second, { guestId }, true);
    await setReaction(photo, { guestId: guests[0] }, true);
    const guest = await signedInGuest(eventId, "Sam");
    await addComment({ eventId, eventOwnerId: ownerId, mediaId: second, userId: guest.userId, body: "Yes", isManager: false });

    const insights = await eventInsights(eventId);
    expect(insights.hearts).toBe(3);
    expect(insights.comments).toBe(1);
    expect(insights.mostLoved).toEqual([
      { id: second, kind: "photo", hearts: 2, comments: 1 },
      { id: photo, kind: "photo", hearts: 1, comments: 0 },
    ]);
    // A deleted favourite is not one.
    await testDb.update(media).set({ deletedAt: new Date() }).where(and(eq(media.id, second)));
    expect((await eventInsights(eventId)).mostLoved.map((item) => item.id)).toEqual([photo]);
  });
});
