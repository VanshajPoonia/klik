import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { requireEventManagerSession } from "@/lib/roles";
import { extensionForMime, r2 } from "@/lib/storage";
import { buildDownloadBatches } from "@/lib/download-batches";

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

function mediaFilename(
  index: number,
  item: { id: string; kind: "photo" | "video"; mimeType: string },
) {
  const position = String(index + 1).padStart(3, "0");
  return `${position}-${item.kind}-${item.id.slice(0, 8)}.${extensionForMime(item.mimeType)}`;
}

async function createDownload(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  selectedMediaIds?: Set<string>,
) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireEventManagerSession(event.id, event.ownerId);
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
    .where(and(eq(media.eventId, event.id), eq(media.status, "approved")))
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

  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);

  void (async () => {
    for (const [index, item] of selectedItems.entries()) {
      const object = await r2.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: item.blobPathname,
        }),
      );
      if (!object.Body || !(object.Body instanceof Readable)) {
        throw new Error(`Media object ${item.id} did not return a readable body`);
      }

      const consumed = once(object.Body, "end");
      archive.append(object.Body, { name: mediaFilename(index, item) });
      await consumed;
    }
    await archive.finalize();
  })().catch((error) => output.destroy(error instanceof Error ? error : new Error(String(error))));

  return new NextResponse(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${archiveFilename(
        event.slug,
        requestedPart,
        batches.length,
        Boolean(selectedMediaIds),
      )}"`,
      "Content-Type": "application/zip",
      "X-Klik-Zip-Part": String(requestedPart),
      "X-Klik-Zip-Parts": String(batches.length),
    },
  });
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
