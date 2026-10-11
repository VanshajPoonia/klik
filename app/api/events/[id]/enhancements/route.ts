import { after, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { kickJobRunner } from "@/lib/jobs";
import { enhancementAllowance, isEnhanceAvailable, listEnhancements } from "@/lib/enhancements";

/**
 * AI-5: the event's enhancements and its allowance. The dashboard asks every
 * few seconds while one is running, and each ask nudges the job queue, so a
 * run finishes promptly even on a plan whose cron is daily.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.moderate");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rows, allowance] = await Promise.all([listEnhancements(event.id), enhancementAllowance(event)]);
  if (rows.some((row) => row.status === "queued" || row.status === "running")) after(kickJobRunner);
  return NextResponse.json(
    {
      available: isEnhanceAvailable(),
      allowance,
      enhancements: rows.map((row) => ({
        id: row.id,
        mediaId: row.mediaId,
        resultMediaId: row.resultMediaId,
        status: row.status,
        choice: row.choice,
        error: row.status === "failed" ? "It did not work this time. It has not used up an enhancement." : null,
        createdAt: row.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
