import { NextResponse } from "next/server";
import { resolveCollectionRequest } from "@/lib/share-request";
import { denialCopy, denialStatus, shareZipFilename } from "@/lib/share-access";
import { allCollectionItems } from "@/lib/shares";
import { INLINE_ZIP_LIMIT_BYTES, buildDownloadBatches } from "@/lib/download-batches";
import { clientIp, consume } from "@/lib/ratelimit";
import { streamZip } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Twenty ZIPs an hour per link per address. Each one streams up to 400 MB out
 * of storage, and a link can end up somewhere public; this is what keeps one
 * pasted link from being a way to run up the bill.
 */
const ZIPS_PER_HOUR = 20;

/**
 * Everything behind a folder or selection link, as ZIP files.
 *
 * Parts of at most 400 MB, the size the organizer's own download streams
 * inline (MED-7): a part has to reach the browser inside one function's five
 * minutes, and the person holding a share link is as likely to be on a phone
 * as on broadband. The page asks for each part by number.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveCollectionRequest(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: denialCopy(resolved.reason, true).title },
      { status: denialStatus(resolved.reason) },
    );
  }
  if (!resolved.share.allowDownload) {
    return NextResponse.json({ error: "This link does not allow downloads" }, { status: 403 });
  }

  const limit = await consume(`share:zip:${resolved.share.id}:${clientIp(request)}`, ZIPS_PER_HOUR, 3600);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many downloads from this link just now. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const batches = buildDownloadBatches(await allCollectionItems(resolved.share, resolved.event), INLINE_ZIP_LIMIT_BYTES);
  if (batches.length === 0) return NextResponse.json({ error: "There is nothing here to download" }, { status: 404 });

  const part = Number(new URL(request.url).searchParams.get("part") ?? "1");
  if (!Number.isInteger(part) || part < 1 || part > batches.length) {
    return NextResponse.json({ error: `Choose a part between 1 and ${batches.length}` }, { status: 400 });
  }

  return streamZip(batches[part - 1], shareZipFilename(part, batches.length), {
    "X-Klik-Zip-Part": String(part),
    "X-Klik-Zip-Parts": String(batches.length),
  });
}
