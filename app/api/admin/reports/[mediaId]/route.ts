import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { releaseLegalHold, resolveReports } from "@/lib/reports";
import { log } from "@/lib/observability";

const requestSchema = z.object({
  action: z.enum(["dismiss", "remove", "release_hold", "reported_to_ncmec"]),
  note: z.string().trim().min(3, "Say what you found, for the record").max(300),
});

/**
 * ADM-5: Klik's side of the reports queue.
 *
 * - `dismiss`: looked at it, it stays. Refused for a held photo; release the
 *   hold first, deliberately, rather than by accident.
 * - `remove`: soft-deleted, as any host delete is.
 * - `release_hold`: the report was false. The hold lifts and the photo returns
 *   to the gallery.
 * - `reported_to_ncmec`: it was what was reported, and it has been reported to
 *   the CyberTipline. The photo stays hidden and held, because the law requires
 *   it be preserved after a report; nothing here ever deletes held material.
 */
export async function POST(request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { mediaId } = await params;
  const [item] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { action, note } = parsed.data;
  const by = session.user.id;

  switch (action) {
    case "dismiss":
      if (item.legalHoldAt) {
        return NextResponse.json({ error: "Release the hold first if the report was false." }, { status: 409 });
      }
      await resolveReports(mediaId, { byUserId: by, resolution: `Kept by Klik. ${note}` });
      break;
    case "remove":
      await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, mediaId));
      await resolveReports(mediaId, { byUserId: by, resolution: `Removed by Klik. ${note}` });
      break;
    case "release_hold":
      await releaseLegalHold(mediaId);
      await db.update(media).set({ status: "approved" }).where(eq(media.id, mediaId));
      await resolveReports(mediaId, { byUserId: by, resolution: `Hold released, report was false. ${note}` });
      break;
    case "reported_to_ncmec":
      // Hidden from everyone and kept, under the hold. Never deleted here.
      await db.update(media).set({ status: "rejected" }).where(eq(media.id, mediaId));
      await resolveReports(mediaId, { byUserId: by, resolution: `Reported to NCMEC. ${note}` });
      break;
  }

  log.info("reports.admin_action", { mediaId, action });
  await recordAudit({
    actor: session,
    action: "report.resolved",
    targetType: "media",
    targetId: mediaId,
    eventId: item.eventId,
    detail: `${action}. ${note}`,
  });
  return NextResponse.json({ ok: true });
}
