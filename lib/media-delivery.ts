export function mediaContentPath(slug: string, mediaId: string): string {
  return `/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/content`;
}

/** Poster still for a video, served through the same authenticated route. */
export function mediaPosterPath(slug: string, mediaId: string): string {
  return `${mediaContentPath(slug, mediaId)}?poster=1`;
}

export function withProtectedMediaUrl<T extends { id: string; blobUrl: string }>(
  item: T,
  slug: string,
): T {
  return {
    ...item,
    blobUrl: mediaContentPath(slug, item.id),
  };
}

export function toPublicMedia(
  item: {
    id: string;
    kind: "photo" | "video";
    status: "pending" | "approved" | "rejected";
    visibility: "gallery" | "private" | "link";
    albumId: string | null;
    createdAt: Date;
    mine?: boolean;
    posterPathname?: string | null;
    durationS?: number | null;
    reactionCount?: number;
    commentCount?: number;
    momentId?: string | null;
    burstId?: string | null;
  },
  slug: string,
) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    // Safe to publish: the access rule means a guest only ever receives media
    // they may see, and the only non-gallery media that reaches a guest is
    // their own. Without it they get a photo back with no hint that the host
    // took it out of the gallery, which looks like nothing happened.
    visibility: item.visibility,
    albumId: item.albumId,
    createdAt: item.createdAt,
    mine: Boolean(item.mine),
    blobUrl: mediaContentPath(slug, item.id),
    // Null when the clip predates poster extraction or the browser could not
    // decode it; the grid falls back to loading video metadata in that case.
    posterUrl: item.posterPathname ? mediaPosterPath(slug, item.id) : null,
    durationS: item.durationS ?? null,
    // MED-9. Sent whether or not the event has them on; the gallery decides
    // whether to draw them from the event's own switches.
    reactionCount: item.reactionCount ?? 0,
    commentCount: item.commentCount ?? 0,
    // AI-1. Which moment it was taken in, and the burst it stacks under.
    momentId: item.momentId ?? null,
    burstId: item.burstId ?? null,
  };
}

