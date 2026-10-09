import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { ChallengeError, listChallenges, MAX_CHALLENGES, MAX_PROMPT_LENGTH, saveChallenges } from "@/lib/challenges";

const putSchema = z.object({
  challenges: z
    .array(z.object({ id: z.string().min(1).max(64).nullable().optional(), prompt: z.string().max(MAX_PROMPT_LENGTH * 2) }))
    .max(MAX_CHALLENGES * 2),
  leaderboard: z.boolean(),
});

/** GRW-3: the event's photo challenges, for whoever may change its settings. */
async function getManagedEvent(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, actor: null };
  return { event, actor: await requireEventCapability(event.id, event.ownerId, "event.settings") };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const list = await listChallenges(id);
  return NextResponse.json({
    challenges: list.map((row) => ({ id: row.id, prompt: row.prompt })),
    leaderboard: event.leaderboardEnabled,
  });
}

/**
 * Replaces the list. Stamps the event, so galleries already open resync and
 * show the new cards without a reload.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the challenges and try again" }, { status: 400 });

  try {
    const list = await saveChallenges(id, parsed.data.challenges);
    await db
      .update(events)
      .set({ leaderboardEnabled: parsed.data.leaderboard, updatedAt: new Date() })
      .where(eq(events.id, id));
    return NextResponse.json({
      challenges: list.map((row) => ({ id: row.id, prompt: row.prompt })),
      leaderboard: parsed.data.leaderboard,
    });
  } catch (error) {
    if (error instanceof ChallengeError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
