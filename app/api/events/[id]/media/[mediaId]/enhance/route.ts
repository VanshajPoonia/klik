import { after, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { kickJobRunner } from "@/lib/jobs";
import { ENHANCE_REFUSALS, EnhanceError, enhancementAllowance, requestEnhancement } from "@/lib/enhancements";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/observability";

/**
 * AI-5: the team asks for one photo to be sharpened and enlarged. Answers at
 * once; the run happens in the job queue and the dashboard watches for it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.moderate");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const enhancement = await requestEnhancement({ event, mediaId, userId: actor.session.user.id });
    await recordAudit({
      actor: actor.session,
      action: "media.enhanced",
      targetType: "media",
      targetId: mediaId,
      eventId: event.id,
      detail: "Sharpen and enlarge requested.",
    });
    after(kickJobRunner);
    return NextResponse.json({ enhancement, allowance: await enhancementAllowance(event) }, { status: 202 });
  } catch (error) {
    if (error instanceof EnhanceError) {
      const status = error.code === "not_configured" ? 503 : error.code === "not_found" ? 404 : 409;
      return NextResponse.json({ error: ENHANCE_REFUSALS[error.code], code: error.code }, { status });
    }
    reportError("enhance.request_failed", error, { eventId: event.id, mediaId });
    return NextResponse.json({ error: "That did not work" }, { status: 500 });
  }
}
