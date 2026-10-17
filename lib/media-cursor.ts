const CURSOR_SEPARATOR = "~";

export function encodeMediaCursor(item: { id: string; createdAt: Date | string }): string {
  return `${new Date(item.createdAt).toISOString()}${CURSOR_SEPARATOR}${item.id}`;
}

export function decodeMediaCursor(value: string): { id: string | null; createdAt: Date } | null {
  const separatorIndex = value.lastIndexOf(CURSOR_SEPARATOR);
  const dateValue = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
  const id = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : null;
  const createdAt = new Date(dateValue);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { id: id || null, createdAt };
}

const RANK_SEPARATOR = "!";

/**
 * MED-16: a cursor for a list in folder order, which carries the photo's
 * place as well as its time. A cursor without one (from before) reads as
 * unplaced, which is where every photo was before anyone arranged a folder.
 */
export function encodeRankedCursor(item: { id: string; createdAt: Date | string }, rank: number): string {
  return `${rank}${RANK_SEPARATOR}${encodeMediaCursor(item)}`;
}

export function decodeRankedCursor(value: string, unplaced: number): { rank: number; id: string | null; createdAt: Date } | null {
  const separatorIndex = value.indexOf(RANK_SEPARATOR);
  const rank = separatorIndex >= 0 ? Number(value.slice(0, separatorIndex)) : unplaced;
  if (!Number.isInteger(rank)) return null;
  const rest = decodeMediaCursor(separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value);
  return rest ? { rank, ...rest } : null;
}
