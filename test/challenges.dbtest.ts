import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// The viewer is set per test, as in gallery-sync; the rest is the real code.
const viewer = {
  access: { allowed: true } as { allowed: boolean },
  guestId: null as string | null,
  kioskId: null as string | null,
  kioskAlbumId: null as string | null,
  ownerSession: null as unknown,
};
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));

const { challengeBoard, cleanPrompts, liveChallengeId, saveChallenges, ChallengeError, MAX_CHALLENGES } = await import(
  "@/lib/challenges"
);
const { GET: changes } = await import("@/app/api/e/[slug]/media/changes/route");
const { challenges, events, kiosks, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];

beforeEach(async () => {
  viewer.access = { allowed: true };
  viewer.guestId = null;
  viewer.kioskId = null;
  viewer.ownerSession = null;
  await resetDatabase();
});

afterAll(closeDatabase);

describe("a host's list", () => {
  it("is cleaned: trimmed, without blanks or repeats, and capped", () => {
    expect(cleanPrompts([{ prompt: "  The  best dance " }, { prompt: "" }, { prompt: "the best dance" }])).toEqual([
      { id: null, prompt: "The best dance" },
    ]);
    const tooMany = Array.from({ length: MAX_CHALLENGES + 1 }, (_, index) => ({ prompt: `Prompt ${index}` }));
    expect(() => cleanPrompts(tooMany)).toThrow(ChallengeError);
  });

  it("keeps a challenge's id through edits and reordering, and soft-deletes what is left out", async () => {
    const eventId = await makeEvent(await makeUser());
    const [first, second] = await saveChallenges(eventId, [{ prompt: "Someone new" }, { prompt: "Dance move" }]);
    const photo = await makeMedia(eventId, { challengeId: first.id });

    const after = await saveChallenges(eventId, [
      { id: second.id, prompt: "Worst dance move" },
      { prompt: "Best table" },
    ]);
    expect(after.map((row) => row.prompt)).toEqual(["Worst dance move", "Best table"]);
    expect(after[0].id).toBe(second.id);

    const [removed] = await testDb.select().from(challenges).where(eq(challenges.id, first.id));
    expect(removed.deletedAt).not.toBeNull();
    expect((await testDb.select().from(media).where(eq(media.id, photo)))[0].challengeId).toBe(first.id);
    expect(await liveChallengeId(eventId, first.id)).toBeNull();
  });

  it("is never borrowed by another event's upload", async () => {
    const owner = await makeUser();
    const [mine] = await saveChallenges(await makeEvent(owner), [{ prompt: "Mine" }]);
    expect(await liveChallengeId(await makeEvent(owner), mine.id)).toBeNull();
  });
});

describe("the board", () => {
  it("counts what everyone can see, and ticks what this guest took, waiting photos included", async () => {
    const eventId = await makeEvent(await makeUser());
    const [dance] = await saveChallenges(eventId, [{ prompt: "Dance" }, { prompt: "Table" }]);
    const guest = await makeGuest(eventId);
    await makeMedia(eventId, { challengeId: dance.id });
    await makeMedia(eventId, { challengeId: dance.id, status: "pending", guestId: guest });
    await makeMedia(eventId, { challengeId: dance.id, visibility: "private" });
    await makeMedia(eventId, { challengeId: dance.id, deletedAt: new Date() });

    const board = await challengeBoard(await eventRow(eventId), { guestId: guest });
    expect(board.challenges.map((row) => [row.prompt, row.count])).toEqual([
      ["Dance", 1],
      ["Table", 0],
    ]);
    expect(board.done).toEqual([dance.id]);
    expect(board.leaderboard).toBeNull();
  });

  it("gives nothing away before a disposable roll develops", async () => {
    const eventId = await makeEvent(await makeUser(), {
      disposableMode: true,
      developsAt: new Date(Date.now() + 3_600_000),
      leaderboardEnabled: true,
    });
    const [dance] = await saveChallenges(eventId, [{ prompt: "Dance" }]);
    await makeMedia(eventId, { challengeId: dance.id, guestId: await makeGuest(eventId, { displayName: "Ana" }) });
    const board = await challengeBoard(await eventRow(eventId), { guestId: null });
    expect(board.challenges[0].count).toBe(0);
    expect(board.leaderboard).toEqual([]);
  });

  it("ranks named guests by what everyone can see, never a kiosk, a nameless guest or the team", async () => {
    const eventId = await makeEvent(await makeUser(), { leaderboardEnabled: true });
    const ana = await makeGuest(eventId, { displayName: "Ana" });
    const sam = await makeGuest(eventId, { displayName: " Sam " });
    const nameless = await makeGuest(eventId, { displayName: null });
    const booth = await makeGuest(eventId, { displayName: "Entrance kiosk" });
    await testDb.insert(kiosks).values({ id: "kiosk_1", eventId, guestId: booth, name: "Entrance kiosk" });
    for (let index = 0; index < 3; index += 1) await makeMedia(eventId, { guestId: sam });
    for (let index = 0; index < 2; index += 1) await makeMedia(eventId, { guestId: ana });
    await makeMedia(eventId, { guestId: ana, status: "pending" });
    for (let index = 0; index < 5; index += 1) await makeMedia(eventId, { guestId: nameless });
    for (let index = 0; index < 9; index += 1) await makeMedia(eventId, { guestId: booth });
    for (let index = 0; index < 7; index += 1) await makeMedia(eventId);

    const board = await challengeBoard(await eventRow(eventId), { guestId: null });
    expect(board.leaderboard).toEqual([
      { name: "Sam", count: 3 },
      { name: "Ana", count: 2 },
    ]);
  });
});

describe("the change sync", () => {
  it("sends the board with a delta that carries photos, and not with an empty poll", async () => {
    const eventId = await makeEvent(await makeUser());
    const { slug } = await eventRow(eventId);
    const [dance] = await saveChallenges(eventId, [{ prompt: "Dance" }]);
    const guest = await makeGuest(eventId);
    viewer.guestId = guest;
    await testDb.execute(sql`UPDATE events SET updated_at = now() - interval '1 hour' WHERE id = ${eventId}`);

    const ask = async (since: Date) =>
      (await changes(new Request(`https://klik.test/api/e/${slug}/media/changes?since=${since.toISOString()}`), {
        params: Promise.resolve({ slug }),
      })).json();

    const quiet = await ask(new Date(Date.now() - 60_000));
    expect(quiet.board).toBeUndefined();

    await makeMedia(eventId, { challengeId: dance.id, guestId: guest });
    const busy = await ask(new Date(Date.now() - 60_000));
    expect(busy.upserts).toHaveLength(1);
    expect(busy.upserts[0].challengeId).toBe(dance.id);
    expect(busy.board.challenges[0].count).toBe(1);
    expect(busy.board.done).toEqual([dance.id]);
  });
});
