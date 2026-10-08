import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { usernameReservations, users } from "./schema";
import { isUniqueViolation, raisedBy } from "./db-errors";
import { USERNAME_CHANGE_DAYS, likePrefix, suggestUsernames, validateUsername } from "./username";

/**
 * ID-1 to ID-3, the parts that need the database: is a handle free, take one,
 * find someone by theirs.
 */

export type Availability = { available: boolean; reason: string | null; username: string | null };

/**
 * Whether `raw` could be taken by `viewerId` right now. "Taken" is all anyone
 * learns about a handle in use, which is no more than trying to sign up with it
 * would tell them.
 */
export async function usernameAvailability(raw: string, viewerId: string | null): Promise<Availability> {
  const check = validateUsername(raw);
  if (!check.ok) return { available: false, reason: check.reason, username: null };
  const { username } = check;

  const [holder] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .limit(1);
  if (holder) {
    return holder.id === viewerId
      ? { available: true, reason: "This is your username.", username }
      : { available: false, reason: "Taken.", username };
  }
  const [parked] = await db
    .select({ userId: usernameReservations.userId })
    .from(usernameReservations)
    .where(and(eq(usernameReservations.usernameLower, username), gt(usernameReservations.releasedAt, sql`now()`)))
    .limit(1);
  if (parked && parked.userId !== viewerId) return { available: false, reason: "Taken.", username };
  return { available: true, reason: null, username };
}

export type UsernameChange =
  | { ok: true; username: string }
  | { ok: false; status: 400 | 409 | 429; reason: string; nextChangeAt?: string };

/**
 * Changes a handle, at most once per 30 days. The rule is in the statement's
 * WHERE, so two tabs pressing save at once make one change; the unique index
 * and the parking trigger decide whether the handle is free, so a check made a
 * moment earlier cannot be raced.
 */
export async function changeUsername(userId: string, raw: string): Promise<UsernameChange> {
  const check = validateUsername(raw);
  if (!check.ok) return { ok: false, status: 400, reason: check.reason };

  const [current] = await db
    .select({ username: users.username, changedAt: users.usernameChangedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!current) return { ok: false, status: 400, reason: "Account not found." };
  if (current.username === check.username) return { ok: true, username: check.username };

  try {
    const [updated] = await db
      .update(users)
      .set({ username: check.username, usernameChangedAt: sql`now()` })
      .where(
        and(
          eq(users.id, userId),
          sql`(${users.usernameChangedAt} IS NULL OR ${users.usernameChangedAt} <= now() - (${USERNAME_CHANGE_DAYS}::int * interval '1 day'))`,
        ),
      )
      .returning({ username: users.username });
    if (!updated) {
      const next = new Date((current.changedAt?.getTime() ?? Date.now()) + USERNAME_CHANGE_DAYS * 86_400_000);
      return {
        ok: false,
        status: 429,
        reason: `You can change your username once every ${USERNAME_CHANGE_DAYS} days.`,
        nextChangeAt: next.toISOString(),
      };
    }
    return { ok: true, username: check.username };
  } catch (error) {
    if (isUniqueViolation(error) || raisedBy(error, "username_reserved")) {
      return { ok: false, status: 409, reason: "That username is taken." };
    }
    throw error;
  }
}

/** Suggestions for an account, filtered to the ones free right now. */
export async function availableSuggestions(
  userId: string,
  name: string | null,
  email: string | null,
): Promise<string[]> {
  const candidates = suggestUsernames(name, email);
  const results = await Promise.all(candidates.map((candidate) => usernameAvailability(candidate, userId)));
  return candidates.filter((_, index) => results[index].available).slice(0, 3);
}

export interface UserMatch {
  id: string;
  username: string;
  name: string | null;
}

/**
 * ID-3: organizers whose handle starts with `query`, for the co-host picker.
 * Name and handle only, never an email, and never a superadmin: staff accounts
 * are not somebody an organizer adds to their wedding.
 */
export async function searchUsers(query: string, excludeUserId: string): Promise<UserMatch[]> {
  const prefix = query.trim().replace(/^@/, "").toLowerCase();
  if (prefix.length < 2 || !/^[a-z0-9_.]+$/.test(prefix)) return [];
  const rows = await db
    .select({ id: users.id, username: users.username, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.role, "organizer"),
        ne(users.id, excludeUserId),
        sql`lower(${users.username}) LIKE ${likePrefix(prefix)}`,
      ),
    )
    .orderBy(sql`length(${users.username})`, users.username)
    .limit(5);
  return rows.flatMap((row) => (row.username ? [{ id: row.id, username: row.username, name: row.name }] : []));
}
