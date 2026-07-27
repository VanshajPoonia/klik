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
