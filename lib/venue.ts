import { customAlphabet } from "nanoid";

const venueSuffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

export function createVenueSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "venue"}-${venueSuffix()}`;
}
