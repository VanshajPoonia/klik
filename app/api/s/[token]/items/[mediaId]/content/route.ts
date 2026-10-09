import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { resolveCollectionRequest } from "@/lib/share-request";
import { denialCopy, denialStatus } from "@/lib/share-access";
import { collectionItem } from "@/lib/shares";

/**
 * One photo behind a folder or selection link: the link's gate, then whether
 * the link opens this photo, then a freshly signed URL. What a tile or the
 * viewer falls back to once the page's own signatures have lapsed, and what a
 * video plays from. `?thumb=1` and `?poster=1` serve the stills, through the
 * same checks.
 *
 * A photo the link does not open is a 404, the same as one that does not
 * exist, so the route cannot be used to learn what else is in the event.
 */
export async function GET(
  request: Request,
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

  const item = await collectionItem(resolved.share, resolved.event, mediaId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const search = new URL(request.url).searchParams;
  const stillKey =
    search.get("thumb") === "1"
      ? (item.thumbPathname ?? (item.kind === "video" ? item.posterPathname : null))
      : search.get("poster") === "1"
        ? item.posterPathname
        : null;

  // A photo is one request, so a minute is plenty; a video keeps making range
  // requests against the resolved URL for as long as it plays, the same
  // reasoning as the single-photo route.
  const key = stillKey ?? item.blobPathname;
  const expiresIn = stillKey ? 10 * 60 : item.kind === "video" ? 6 * 60 * 60 : 60;
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ResponseContentType: stillKey ? "image/jpeg" : item.mimeType,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn },
  );

  return NextResponse.redirect(url, {
    status: 307,
    // A cached redirect is a copy of the grant that outlives revocation.
    headers: { "Cache-Control": "private, no-store" },
  });
}
