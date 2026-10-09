import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extensionForMime, r2 } from "@/lib/storage";
import { resolveCollectionRequest } from "@/lib/share-request";
import { denialCopy, denialStatus, shareDownloadFilename } from "@/lib/share-access";
import { collectionItem } from "@/lib/shares";

/** Saving one photo from a folder or selection link, when the link allows it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await params;
  const resolved = await resolveCollectionRequest(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: denialCopy(resolved.reason, true).title },
      { status: denialStatus(resolved.reason) },
    );
  }

  // Asked before which photo, so a link without downloads says so plainly
  // rather than as a missing photo.
  if (!resolved.share.allowDownload) {
    return NextResponse.json({ error: "This link does not allow downloads" }, { status: 403 });
  }

  const item = await collectionItem(resolved.share, resolved.event, mediaId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filename = shareDownloadFilename(item, extensionForMime(item.mimeType));
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: item.blobPathname,
      ResponseContentType: item.mimeType,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 60 },
  );

  return NextResponse.redirect(url, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}
