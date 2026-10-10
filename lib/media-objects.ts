import { media } from "./schema";

/**
 * Every object a media row owns in the bucket, in one place.
 *
 * A photo is not one object. A video has a poster still, both have a grid
 * thumbnail, and OPS-1 will add more. Each of the paths that delete bytes
 * (erasure, the purge, the orphan reaper's idea of "referenced") used to name
 * the poster column itself, which works exactly until someone adds a rendition
 * and updates two of the three. Then a guest's erasure request leaves their
 * thumbnail in the bucket, which is the failure erasure exists to prevent.
 *
 * So the list lives here, and `lib/media-objects.test.ts` reads the schema and
 * fails if any `*_pathname` column on `media` is missing from it.
 */
export const MEDIA_OBJECT_COLUMNS = {
  blobPathname: media.blobPathname,
  posterPathname: media.posterPathname,
  thumbPathname: media.thumbPathname,
  // MED-10: a locked proof's clean original, which `blobPathname` does not name.
  proofOriginalPathname: media.proofOriginalPathname,
} as const;

export type MediaObjectRow = {
  [K in keyof typeof MEDIA_OBJECT_COLUMNS]: K extends "blobPathname" ? string : string | null;
};

/** The keys to delete for these rows. Nulls dropped, duplicates collapsed. */
export function mediaObjectKeys(rows: Iterable<Partial<MediaObjectRow>>): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(MEDIA_OBJECT_COLUMNS) as Array<keyof MediaObjectRow>) {
      const key = row[column];
      if (key) keys.add(key);
    }
  }
  return [...keys];
}
