import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, mediaExports } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { r2 } from "@/lib/storage";

/**
 * One part of a finished export, for whoever may export this event right now.
 *
 * The authorization runs on every click and the link it hands out lives an
 * hour, which is long enough to start a multi-gigabyte download (R2 checks the
 * signature when the request starts, not as bytes flow) and short enough that a
 * copied link is not a standing key to the gallery. The email points here via
 * the dashboard rather than at R2 for the same reason.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; exportId: string; part: string }> },
) {
  const { id, exportId, part } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.exportAll");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db
    .select()
    .from(mediaExports)
    .where(and(eq(mediaExports.id, exportId), eq(mediaExports.eventId, event.id)))
    .limit(1);
  const number = Number(part);
  const entry = row && Number.isInteger(number) ? row.parts[number - 1] : undefined;
  if (!row || row.status !== "ready" || !entry?.key) {
    return NextResponse.json({ error: "That download is not available" }, { status: 404 });
  }

  const filename =
    row.partCount > 1
      ? `klik-${event.slug}-part-${number}-of-${row.partCount}.zip`
      : `klik-${event.slug}.zip`;
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: entry.key,
      ResponseContentType: "application/zip",
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 60 * 60 },
  );
  return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
}
