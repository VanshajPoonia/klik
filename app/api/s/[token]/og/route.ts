import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { reportError } from "@/lib/observability";
import { resolveShareRequest } from "@/lib/share-request";
import { collectionItem, listCollectionItems } from "@/lib/shares";
import type { Media } from "@/lib/schema";

/**
 * The preview image a chat app draws for a share link.
 *
 * This exists instead of pointing the OG tag at the photo itself for one
 * practical reason: WhatsApp, iMessage and Slack all refuse to render a preview
 * image above a size limit, and a phone photo straight off the camera is several
 * megabytes. Pointing at the original produced no preview at all, which defeats
 * the point of a link that travels by being pasted into a group chat.
 *
 * It is gated exactly like every other share surface, and crawlers carry no
 * cookies, so a password-protected link previews as nothing rather than as the
 * photo. That is the correct outcome: a link whose whole purpose is that only
 * the password holder sees the photo must not put the photo in a chat thumbnail
 * for the entire group.
 */

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveShareRequest(token);

  // No image rather than a placeholder. A chat app that gets a 404 here falls
  // back to the title and description, which is what a dead link should look
  // like.
  if (!resolved.ok) return new NextResponse(null, { status: 404 });

  // A folder link previews as its cover, if the link shows the cover, else
  // as its newest photo; a selection as its newest. Whatever it is, it is a
  // photo the link opens, picked through the same rule as the page.
  let item: Media | null = resolved.item;
  if (!item) {
    const cover = resolved.folder?.coverMediaId
      ? await collectionItem(resolved.share, resolved.event, resolved.folder.coverMediaId)
      : null;
    item = cover ?? (await listCollectionItems(resolved.share, resolved.event, { limit: 1 })).items[0] ?? null;
  }
  if (!item) return new NextResponse(null, { status: 404 });

  // A video previews as the still extracted at upload time. Without one there is
  // nothing to show, and asking sharp to decode an mp4 would fail anyway.
  const key = item.kind === "video" ? item.posterPathname : item.blobPathname;
  if (!key) return new NextResponse(null, { status: 404 });

  const sourceUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: 60 },
  );

  /**
   * Lazy, like every other sharp import in this codebase. At module scope a
   * failed native load takes down every handler in the file, which is how a
   * packaging problem became a dead gallery once already. See ARCHITECTURE.md
   * constraint 7, and note that this route needs its own
   * `outputFileTracingIncludes` entry in `next.config.ts` or libvips is simply
   * not deployed alongside it.
   */
  try {
    const { default: sharp } = await import("sharp");
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`R2 returned ${response.status}`);

    const resized = await sharp(Buffer.from(await response.arrayBuffer()))
      .rotate()
      .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();

    return new NextResponse(new Uint8Array(resized), {
      headers: {
        "Content-Type": "image/jpeg",
        /**
         * Never cached, for the same reason the content route is not: a cached
         * response is a copy of the grant that outlives revocation.
         *
         * This shipped as `public, max-age=600` first, on the reasoning that a
         * crawler is anonymous and a preview cannot be recalled anyway. Checking
         * it in production showed what that actually bought: `x-vercel-cache:
         * HIT`, `age: 42`, the CDN still handing out the photo 42 seconds after
         * the host revoked the link, and willing to for ten minutes.
         *
         * Two different things had been run together. A preview a chat app
         * already drew into a thread genuinely cannot be recalled, and the share
         * sheet says so. Our own edge continuing to serve the pixels afterwards
         * is avoidable, so it is avoided. The cost is that sharp runs per
         * preview fetch, which is a bounded and measurable cost, where a leak
         * after revocation is neither.
         */
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    reportError("share.og_render_failed", error, { token: token.slice(0, 4) });
    // Falling back to the full-size original. A preview that some clients will
    // skip for being too large still beats no preview at all, and it keeps a
    // sharp problem from silently making every share link look broken in chat.
    return NextResponse.redirect(sourceUrl, { status: 307 });
  }
}
