import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { extensionForMime, r2 } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

function archiveFilename(slug: string) {
  return `klik-${slug}.zip`;
}

function mediaFilename(
  index: number,
  item: { id: string; kind: "photo" | "video"; mimeType: string },
) {
  const position = String(index + 1).padStart(3, "0");
  return `${position}-${item.kind}-${item.id.slice(0, 8)}.${extensionForMime(item.mimeType)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await db
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

  if (items.length === 0) {
    return NextResponse.json({ error: "There is no approved media to download" }, { status: 404 });
  }

  const totalBytes = items.reduce((total, item) => total + item.sizeBytes, 0);
  if (totalBytes > MAX_ARCHIVE_BYTES) {
    return NextResponse.json(
      { error: "This gallery is over 2 GB. Download individual items from the gallery." },
      { status: 413 },
    );
  }

  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);

  void (async () => {
    for (const [index, item] of items.entries()) {
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
      "Content-Disposition": `attachment; filename="${archiveFilename(event.slug)}"`,
      "Content-Type": "application/zip",
    },
  });
}
