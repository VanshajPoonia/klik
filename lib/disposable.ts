import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { guests } from "./schema";

/**
 * CAM-4: spends one shot from a guest's roll, or reports that it is finished.
 *
 * One conditional UPDATE, so five uploads racing for the last frame give
 * exactly one success: on neon-http there is no transaction to read the count
 * and write it back inside, and a read-then-write would let them all through.
 */
export async function spendShot(guestId: string, shotsPerGuest: number): Promise<boolean> {
  const rows = await db
    .update(guests)
    .set({ shotsUsed: sql`${guests.shotsUsed} + 1` })
    .where(and(eq(guests.id, guestId), lt(guests.shotsUsed, shotsPerGuest)))
    .returning({ shotsUsed: guests.shotsUsed });
  return rows.length > 0;
}
