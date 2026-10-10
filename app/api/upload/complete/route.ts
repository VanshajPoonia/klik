import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadMediaId } from "@/lib/media-id";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { resolveEventViewer } from "@/lib/event-viewer";
import { blobPathnameFor, extensionForMime, isAllowedMime, r2 } from "@/lib/storage";
import { partSizes } from "@/lib/upload-parts";
import { reportError } from "@/lib/observability";

const requestSchema = z.object({
  eventId: z.string().min(1),
  mediaId: uploadMediaId,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  uploadId: z.string().min(1).max(1024),
});

/**
 * OPS-2: joins the parts of a multipart upload into one object.
 *
 * The parts' ETags come from R2 itself (ListParts), not from the browser. A
 * browser can only read an ETag the bucket's CORS rule exposes, and asking R2
 * also means the server checks the parts rather than trusting a list: every
 * part must be there, at exactly the length the cut says, or nothing is joined
 * and the upload is aborted so R2 keeps no stray parts. After this the object
 * is registered like any other upload, through the same signature and size
 * checks.
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { eventId, mediaId, mimeType, sizeBytes, uploadId } = parsed.data;
  if (!isAllowedMime(mimeType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!canUpload(event)) return NextResponse.json({ error: "Uploads are closed for this event" }, { status: 403 });
  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed || (!viewer.ownerSession && !viewer.guestId)) {
    return NextResponse.json({ error: "Not authorized to upload to this event" }, { status: 401 });
  }

  // Derived, never taken from the request, so an upload id can only ever be
  // completed at the key this media id was given in this event.
  const key = blobPathnameFor(event.id, mediaId, extensionForMime(mimeType));
  const bucket = process.env.R2_BUCKET_NAME;
  const abort = () =>
    r2.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })).catch(() => {});

  const parts: Part[] = [];
  try {
    let marker: string | undefined;
    do {
      const page = await r2.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      parts.push(...(page.Parts ?? []));
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
  } catch {
    return NextResponse.json({ error: "That upload could not be found. Try again." }, { status: 404 });
  }

  const expected = partSizes(sizeBytes);
  const sorted = parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
  const complete =
    sorted.length === expected.length &&
    sorted.every((part, index) => part.PartNumber === index + 1 && part.Size === expected[index] && part.ETag);
  if (!complete) {
    await abort();
    return NextResponse.json({ error: "Part of the file did not arrive. Try again." }, { status: 400 });
  }

  try {
    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: sorted.map((part) => ({ ETag: part.ETag!, PartNumber: part.PartNumber! })) },
      }),
    );
  } catch (error) {
    reportError("upload.multipart_complete_failed", error, { eventId, mediaId });
    await abort();
    return NextResponse.json({ error: "The upload could not be finished. Try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, pathname: key });
}
