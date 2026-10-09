import { and, asc, count, desc, eq, inArray, isNotNull, isNull, min, notExists, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { challenges, guests, kiosks, media, type Challenge, type Event } from "./schema";
import { mediaVisibilityFilter } from "./media-access";
import { LEADERBOARD_SIZE, MAX_CHALLENGES, MAX_PROMPT_LENGTH } from "./challenge-limits";

export { LEADERBOARD_SIZE, MAX_CHALLENGES, MAX_PROMPT_LENGTH, SUGGESTED_PROMPTS } from "./challenge-limits";

/**
 * GRW-3: photo challenges. The host sets prompts ("a photo with someone you
 * just met", "the worst dance move"); guests see them as cards in the gallery,
 * take a photo for one, and get a tick; a leaderboard, if the host turns it on,
 * shows who has shared most.
 *
 * **Counts are what everyone can see.** A challenge's count and the
 * leaderboard read only approved gallery photos, through the same rule as a
 * visitor's grid, so a hidden photo is never counted and a disposable roll
 * gives nothing away before it develops. A guest's own tick includes their
 * photos waiting for the host, because they did take it.
 *
 * **The leaderboard names only people who gave a name**, never a kiosk (it is
 * a queue of people, and would win every time), and never the host's team.
 */

export interface ChallengeCard {
  id: string;
  prompt: string;
  /** Photos everyone can see that were taken for it. */
  count: number;
}

export interface ChallengeBoard {
  challenges: ChallengeCard[];
  /** The challenges this guest has taken a photo for. */
  done: string[];
  /** Null when the host has it off. */
  leaderboard: Array<{ name: string; count: number }> | null;
}

export async function listChallenges(eventId: string): Promise<Challenge[]> {
  return db
    .select()
    .from(challenges)
    .where(and(eq(challenges.eventId, eventId), isNull(challenges.deletedAt)))
    .orderBy(asc(challenges.position), asc(challenges.createdAt));
}

export class ChallengeError extends Error {}

/** Normalizes a host's list: trimmed, non-empty, de-duplicated, within limits. */
export function cleanPrompts(input: Array<{ id?: string | null; prompt: string }>): Array<{ id: string | null; prompt: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string | null; prompt: string }> = [];
  for (const entry of input) {
    const prompt = entry.prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_LENGTH);
    const key = prompt.toLowerCase();
    if (!prompt || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: entry.id ?? null, prompt });
  }
  if (out.length > MAX_CHALLENGES) throw new ChallengeError(`Up to ${MAX_CHALLENGES} challenges`);
  return out;
}

/**
 * Makes the event's challenges exactly this list, in this order. Ones that
 * keep their id keep their photos; ones left out are soft-deleted, so photos
 * taken for them still point somewhere.
 */
export async function saveChallenges(
  eventId: string,
  input: Array<{ id?: string | null; prompt: string }>,
): Promise<Challenge[]> {
  const wanted = cleanPrompts(input);
  const existing = await listChallenges(eventId);
  const existingIds = new Set(existing.map((row) => row.id));

  for (const [position, entry] of wanted.entries()) {
    if (entry.id && existingIds.has(entry.id)) {
      const before = existing.find((row) => row.id === entry.id)!;
      if (before.prompt !== entry.prompt || before.position !== position) {
        await db.update(challenges).set({ prompt: entry.prompt, position }).where(eq(challenges.id, entry.id));
      }
    } else {
      await db.insert(challenges).values({ id: nanoid(), eventId, prompt: entry.prompt, position });
    }
  }
  const keep = new Set(wanted.map((entry) => entry.id).filter(Boolean));
  const gone = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (gone.length > 0) {
    await db.update(challenges).set({ deletedAt: new Date() }).where(inArray(challenges.id, gone));
  }
  return listChallenges(eventId);
}

/** A live challenge of this event, or null, for an upload claiming one. */
export async function liveChallengeId(eventId: string, challengeId: string | null | undefined): Promise<string | null> {
  if (!challengeId) return null;
  const [row] = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, eventId), isNull(challenges.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

type BoardEvent = Pick<Event, "id" | "leaderboardEnabled" | "uploaderSeesOwnPrivate" | "disposableMode" | "developsAt">;

/** Everything the gallery shows about challenges, for one viewer. */
export async function challengeBoard(event: BoardEvent, viewer: { guestId: string | null }): Promise<ChallengeBoard> {
  const list = await listChallenges(event.id);
  // What a visitor with no uploads of their own would see: the public count.
  const everyone = mediaVisibilityFilter({ isManager: false, guestId: null }, event);
  const visible = and(eq(media.eventId, event.id), isNull(media.deletedAt), everyone);

  const [counts, done, leaderboard] = await Promise.all([
    list.length === 0
      ? Promise.resolve([])
      : db
          .select({ challengeId: media.challengeId, count: count() })
          .from(media)
          .where(and(visible, isNotNull(media.challengeId)))
          .groupBy(media.challengeId),
    list.length === 0 || !viewer.guestId
      ? Promise.resolve([])
      : db
          .selectDistinct({ challengeId: media.challengeId })
          .from(media)
          .where(
            and(
              eq(media.eventId, event.id),
              eq(media.guestId, viewer.guestId),
              isNull(media.deletedAt),
              isNotNull(media.challengeId),
            ),
          ),
    event.leaderboardEnabled ? leaderboardFor(event, visible) : Promise.resolve(null),
  ]);

  const byChallenge = new Map(counts.map((row) => [row.challengeId, Number(row.count)]));
  const live = new Set(list.map((row) => row.id));
  return {
    challenges: list.map((row) => ({ id: row.id, prompt: row.prompt, count: byChallenge.get(row.id) ?? 0 })),
    done: done.map((row) => row.challengeId).filter((id): id is string => Boolean(id && live.has(id))),
    leaderboard,
  };
}

async function leaderboardFor(event: BoardEvent, visible: ReturnType<typeof and>) {
  const shared = count(media.id);
  const first = min(media.createdAt);
  const rows = await db
    .select({ name: guests.displayName, count: shared })
    .from(media)
    .innerJoin(guests, eq(guests.id, media.guestId))
    .where(
      and(
        visible,
        isNotNull(guests.displayName),
        sql`btrim(${guests.displayName}) <> ''`,
        notExists(db.select({ one: sql`1` }).from(kiosks).where(eq(kiosks.guestId, guests.id))),
      ),
    )
    .groupBy(guests.id, guests.displayName)
    .orderBy(desc(shared), asc(first))
    .limit(LEADERBOARD_SIZE);
  return rows.map((row) => ({ name: (row.name ?? "").trim(), count: Number(row.count) }));
}
