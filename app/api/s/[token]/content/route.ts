import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { resolveShareRequest } from "@/lib/share-request";
import { denialStatus, DENIAL_COPY } from "@/lib/share-access";
import { videoHeldBack } from "@/lib/media-access";

/**
 * The bytes behind a share link.
 *
 * Never the bucket URL, always a freshly signed one, and the gate runs on every
 * single request. That is what makes revocation real: a public bucket URL, or a
 * long-lived signature handed out once, would keep working for as long as it
 * lived no matter what the host did afterwards.
 *
 * This route deliberately does not touch `view_count`. It is called by an `img`
 * tag, so counting here would charge several views for one visit and would make
 * the cap depend on how a browser decided to load the page.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const resolved = await resolveShareRequest(token);

  if (!resolved.ok) {
    return NextResponse.json(
      { error: DENIAL_COPY[resolved.reason].title },
      { status: denialStatus(resolved.reason) },
    );
  }

  const { item } = resolved;
  const wantsPoster =
    new URL(request.url).searchParams.get("poster") === "1" && item.posterPathname;

  if (!wantsPoster) {
    // MED-8: a link holder is never the person who filmed it, so a video still
    // being cleaned of its location waits.
    if (videoHeldBack(item, { isManager: false, guestId: null })) {
      return NextResponse.json({ error: "This video is still being prepared. Try again in a minute." }, { status: 409 });
    }
  }

  // Same reasoning as the gallery content route: a photo is one request, so a
  // short signature is plenty, while a video keeps issuing range requests
  // against the resolved URL for buffering and for every seek, and a 60-second
  // signature kills playback a minute in.
  const expiresIn = wantsPoster ? 60 * 60 : item.kind === "video" ? 6 * 60 * 60 : 60;

  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: wantsPoster ? item.posterPathname! : item.blobPathname,
      ResponseContentType: wantsPoster ? "image/jpeg" : item.mimeType,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn },
  );

  return NextResponse.redirect(url, {
    status: 307,
    // No caching anywhere. A cached redirect is a copy of the grant that
    // outlives revocation, which is the one thing this route must not allow.
    headers: { "Cache-Control": "private, no-store" },
  });
}
