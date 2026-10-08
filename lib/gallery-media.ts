import { toPublicMedia } from "./media-delivery";
import { signMediaUrls, type SignableMedia } from "./media-urls";

/**
 * The gallery payload: the public fields plus signed URLs, so a tile loads
 * straight from R2 instead of costing a function invocation each. `blobUrl` and
 * `posterUrl` stay as the authorized routes, for video playback, downloads, and
 * as the fallback a tile switches to when its signed URL has expired. See
 * lib/media-urls.ts for why this does not weaken ARCHITECTURE.md section 8.
 *
 * Separate from lib/media-delivery.ts because that module is imported by client
 * components, and this one carries the S3 client.
 */
export async function toGalleryMedia(
  items: Array<Parameters<typeof toPublicMedia>[0] & SignableMedia>,
  slug: string,
  now = Date.now(),
) {
  return Promise.all(
    items.map(async (item) => ({ ...toPublicMedia(item, slug), ...(await signMediaUrls(item, now)) })),
  );
}

export type GalleryMedia = Awaited<ReturnType<typeof toGalleryMedia>>[number];
