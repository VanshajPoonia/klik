import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "./storage";

/**
 * Direct, signed R2 URLs for a gallery page, issued by the request that already
 * decided what this viewer may see.
 *
 * **The problem.** Every tile used to point at `/api/e/[slug]/media/[id]/content`,
 * which re-loaded the event, re-resolved the viewer, re-checked visibility and
 * then redirected to a 60-second signature. Fifty tiles was fifty function
 * invocations and fifty database round trips, for a decision the gallery query
 * had made once already. At a 200-guest wedding that was the first thing to
 * fall over (ROADMAP.md, "What breaks first", row 1).
 *
 * **What changed, and what did not.** The gallery query signs the URLs it
 * returns, so one authorized request covers a page. Nothing is cached at an edge
 * and nothing is public: ARCHITECTURE.md section 8 still holds, because every
 * URL here was issued by a request that ran the full access rule. What moves is
 * the length of the bearer window, from 60 seconds to between 15 and 30 minutes,
 * which is the price of not asking the database fifty times.
 *
 * **Why the signing time is rounded.** A presigned URL embeds its signing time,
 * so signing at `Date.now()` makes every poll return different URLs for the same
 * photos, and a browser treats each as a new image to download. Rounding the
 * signing time down to a 15-minute boundary makes the URL identical for every
 * request inside that window, so the browser cache works. Validity runs for two
 * windows, so a URL handed out at the very end of one is still good for a full
 * window afterwards.
 *
 * Tiles fall back to the authorized content route when a signed URL fails, which
 * covers a gallery left open past the window.
 */

export const SIGNING_WINDOW_MS = 15 * 60 * 1000;

export function signingWindow(now: number) {
  return {
    signingDate: new Date(Math.floor(now / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS),
    expiresIn: (2 * SIGNING_WINDOW_MS) / 1000,
  };
}

/**
 * One signed GET. `private` caching only: the browser that was allowed to see
 * these bytes may keep them for the life of the URL, and no shared cache may.
 */
export function signObjectUrl(
  key: string,
  contentType: string,
  now: number,
): Promise<string> {
  const { signingDate, expiresIn } = signingWindow(now);
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: "inline",
      ResponseCacheControl: `private, max-age=${expiresIn}`,
    }),
    { expiresIn, signingDate },
  );
}

export interface SignableMedia {
  kind: "photo" | "video";
  mimeType: string;
  blobPathname: string;
  posterPathname: string | null;
  thumbPathname: string | null;
}

export interface SignedMediaUrls {
  /** The full photo, for the lightbox. Null for video, which still plays
   *  through the content route because playback outlives these windows. */
  src: string | null;
  /** What a grid tile shows: the thumbnail if one exists, else the photo or
   *  the video's poster. Null only for a video with neither. */
  thumbSrc: string | null;
  /** A video's poster still, for the player's `poster` attribute. */
  posterSrc: string | null;
}

export async function signMediaUrls(item: SignableMedia, now = Date.now()): Promise<SignedMediaUrls> {
  const thumb = item.thumbPathname ? signObjectUrl(item.thumbPathname, "image/jpeg", now) : null;

  if (item.kind === "video") {
    const poster = item.posterPathname ? await signObjectUrl(item.posterPathname, "image/jpeg", now) : null;
    return { src: null, thumbSrc: (await thumb) ?? poster, posterSrc: poster };
  }

  const src = await signObjectUrl(item.blobPathname, item.mimeType, now);
  return { src, thumbSrc: (await thumb) ?? src, posterSrc: null };
}
