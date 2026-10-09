import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { buildDownloadBatches } from "@/lib/download-batches";
import { streamZip } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const maxDuration = 300;

function archiveFilename(
  slug: string,
  part: number,
  totalParts: number,
  selectedMedia: boolean,
) {
  if (selectedMedia) return `klik-${slug}-selected.zip`;
  return totalParts > 1
    ? `klik-${slug}-part-${part}-of-${totalParts}.zip`
    : `klik-${slug}.zip`;
}

async function createDownload(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  selectedMediaIds?: Set<string>,
) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A contributor may add to the gallery but may not walk off with all of it.
  const session = (await requireEventCapability(event.id, event.ownerId, "media.exportAll"))?.session ?? null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const approvedItems = await db
    .select({
      id: media.id,
      kind: media.kind,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      blobPathname: media.blobPathname,
    })
    .from(media)
    .where(and(eq(media.eventId, event.id), eq(media.status, "approved"), isNull(media.deletedAt)))
    .orderBy(asc(media.createdAt));

  const items = selectedMediaIds
    ? approvedItems.filter((item) => selectedMediaIds.has(item.id))
    : approvedItems;

  if (selectedMediaIds && items.length !== selectedMediaIds.size) {
    return NextResponse.json(
      { error: "Some selected media is no longer available" },
      { status: 400 },
    );
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "There is no approved media to download" }, { status: 404 });
  }

  const batches = buildDownloadBatches(items);
  if (selectedMediaIds && batches.length > 1) {
    return NextResponse.json(
      { error: "This selection is too large for one ZIP file" },
      { status: 413 },
    );
  }
  const requestedPartValue = new URL(request.url).searchParams.get("part");
  const requestedPart = selectedMediaIds ? 1 : requestedPartValue ? Number(requestedPartValue) : 1;
  if (!Number.isInteger(requestedPart) || requestedPart < 1 || requestedPart > batches.length) {
    return NextResponse.json(
      { error: `Choose a ZIP part between 1 and ${batches.length}` },
      { status: 400 },
    );
  }
  const selectedItems = batches[requestedPart - 1];

  return streamZip(
    selectedItems,
    archiveFilename(event.slug, requestedPart, batches.length, Boolean(selectedMediaIds)),
    {
      "X-Klik-Zip-Part": String(requestedPart),
      "X-Klik-Zip-Parts": String(batches.length),
    },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return createDownload(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const formData = await request.formData();
  const selectedMediaIds = new Set(
    formData
      .getAll("mediaId")
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );

  if (selectedMediaIds.size === 0) {
    return NextResponse.json({ error: "Select at least one photo" }, { status: 400 });
  }

  return createDownload(request, context, selectedMediaIds);
}
