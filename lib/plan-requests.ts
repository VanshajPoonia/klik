import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { planRequests } from "./schema";
import { getPlan, type PlanKey } from "./plans";
import { OCCASIONS, type OccasionKey } from "./gallery-templates";
import { recordAccountEvent } from "./timeline";
import { reportError } from "./observability";

/**
 * ADM-6: who asked for which plan. A row is written when a plan's button
 * reaches /signup, by the signup form or for an account already signed in,
 * so /admin can answer the first question about a signup that has not paid:
 * what were they trying to buy, and for what.
 *
 * It grants nothing. BILLING.md: a person grants a plan on /admin, with a
 * reason, and this is only what they read before doing it.
 */

/** A reload or a second tap on the same button is the same request. */
const SAME_REQUEST_MS = 10 * 60 * 1000;

export interface PlanRequestInput {
  userId: string;
  planKey: PlanKey;
  occasion?: OccasionKey | null;
  /** YYYY-MM-DD, as a date picker gives it. */
  eventDate?: string | null;
  source: "signup" | "signed_in";
}

/** Never throws: nothing here is worth failing a signup or a payment over. */
export async function recordPlanRequest(input: PlanRequestInput): Promise<void> {
  try {
    const [recent] = await db
      .select({ id: planRequests.id })
      .from(planRequests)
      .where(
        and(
          eq(planRequests.userId, input.userId),
          eq(planRequests.planKey, input.planKey),
          gt(planRequests.createdAt, new Date(Date.now() - SAME_REQUEST_MS)),
        ),
      )
      .limit(1);
    if (recent) return;
    await db.insert(planRequests).values({
      id: nanoid(),
      userId: input.userId,
      planKey: input.planKey,
      occasion: input.occasion ?? null,
      eventDate: input.eventDate ?? null,
      source: input.source,
    });
    await recordAccountEvent({
      userId: input.userId,
      kind: "plan_requested",
      detail: `Asked for ${describePlanRequest(input)}${input.source === "signup" ? " when signing up" : ""}.`,
    });
  } catch (error) {
    reportError("plan_request.record_failed", error, { userId: input.userId });
  }
}

/** "Klik Premium, for a wedding on 13 Jun 2026". */
export function describePlanRequest(request: {
  planKey: PlanKey;
  occasion?: string | null;
  eventDate?: string | null;
}): string {
  const plan = getPlan(request.planKey).name;
  const occasion = OCCASIONS.find((option) => option.key === request.occasion);
  const kind = occasion && occasion.key !== "other" ? occasion.label.toLowerCase() : null;
  const date = request.eventDate ? formatRequestDate(request.eventDate) : null;
  if (kind && date) return `${plan}, for a ${kind} on ${date}`;
  if (kind) return `${plan}, for a ${kind}`;
  if (date) return `${plan}, for an event on ${date}`;
  return plan;
}

function formatRequestDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export type LatestPlanRequest = {
  planKey: PlanKey;
  occasion: string | null;
  eventDate: string | null;
  createdAt: Date;
  summary: string;
};

/** Each account's most recent request, for the admin queue and client list. */
export async function latestPlanRequests(userIds: string[]): Promise<Map<string, LatestPlanRequest>> {
  const out = new Map<string, LatestPlanRequest>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select()
    .from(planRequests)
    .where(inArray(planRequests.userId, userIds))
    .orderBy(desc(planRequests.createdAt));
  for (const row of rows) {
    if (out.has(row.userId)) continue;
    out.set(row.userId, {
      planKey: row.planKey,
      occasion: row.occasion,
      eventDate: row.eventDate,
      createdAt: row.createdAt,
      summary: describePlanRequest(row),
    });
  }
  return out;
}

/** Every request one account made, newest first, for its page on /admin. */
export async function planRequestsFor(userId: string) {
  const rows = await db
    .select()
    .from(planRequests)
    .where(eq(planRequests.userId, userId))
    .orderBy(desc(planRequests.createdAt));
  return rows.map((row) => ({ ...row, summary: describePlanRequest(row) }));
}
