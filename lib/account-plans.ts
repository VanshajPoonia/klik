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

/**
 * Whether a superadmin has granted this account its plan yet.
 *
 * A deliberately separate function rather than another field on
 * `getAccountPlan`, which is called from more than twenty places that all want
 * a `PlanDefinition` and nothing else. Only two callers care about activation:
 * creating an event, and the dashboard that offers to.
 *
 * Null means an account that signed itself up and is waiting. It can sign in and
 * see its dashboard, because being locked out entirely while waiting reads as a
 * broken signup, and it cannot create an event, because `users.plan_key`
 * defaults to 'event' and that would be the paid product for free. See
 * drizzle/0013_self_signup.sql.
 *
 * An account that does not exist is reported as not activated. The caller is
 * about to refuse either way, and "missing row" is not a reason to grant.
 */
export async function isAccountActivated(userId: string): Promise<boolean> {
  const [account] = await db
    .select({ activatedAt: users.activatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(account?.activatedAt);
}
