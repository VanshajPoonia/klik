import { eq } from "drizzle-orm";
import { db } from "./db";
import { getPlan } from "./plans";
import { users } from "./schema";

export async function getAccountPlan(ownerId: string) {
  const [account] = await db
    .select({ planKey: users.planKey })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);

  return getPlan(account?.planKey);
}
