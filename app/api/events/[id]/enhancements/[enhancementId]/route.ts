import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { chooseEnhancement } from "@/lib/enhancements";

const schema = z.object({ choice: z.enum(["instead", "both", "discarded"]) });

/** AI-5: show the result instead of the original, beside it, or not at all. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; enhancementId: string }> }) {
  const { id, enhancementId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.moderate");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  if (!(await chooseEnhancement(event.id, enhancementId, parsed.data.choice))) {
    return NextResponse.json({ error: "That result is gone" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
