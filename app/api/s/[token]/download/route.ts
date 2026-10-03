import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extensionForMime, r2 } from "@/lib/storage";
import { resolveShareRequest } from "@/lib/share-request";
import { denialStatus, DENIAL_COPY, shareDownloadFilename } from "@/lib/share-access";

export async function GET(
  _request: Request,
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

  const { share, item } = resolved;

  // Downloading is viewing with a copy kept, so it is a separate permission and
  // defaults to off. A host who shares a photo to be looked at has not thereby
  // agreed to it being saved, reposted and outliving the link entirely.
  if (!share.allowDownload) {
    return NextResponse.json(
      { error: "This link does not allow downloads" },
      { status: 403 },
    );
  }

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
