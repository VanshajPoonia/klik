export function mediaContentPath(slug: string, mediaId: string): string {
  return `/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/content`;
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
    albumId: string | null;
    createdAt: Date;
    mine?: boolean;
  },
  slug: string,
) {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    albumId: item.albumId,
    createdAt: item.createdAt,
    mine: Boolean(item.mine),
    blobUrl: mediaContentPath(slug, item.id),
  };
}
