import { z } from "zod";

/**
 * The id a browser picks for an upload, and the one rule that keeps it from
 * naming somebody else's object.
 *
 * Every object a photo owns is its id plus a suffix: `<id>-thumb.jpg`,
 * `<id>-poster.jpg`, and since MED-10 `<id>-proof.jpg`. The upload id is chosen
 * by the client, so without this an upload asking to be called
 * `<another photo's id>-thumb` was handed a signed PUT for that photo's
 * thumbnail and could replace what every guest sees in its tile. An id ending
 * in a suffix the server derives keys with is therefore never an upload id.
 */
export const DERIVED_KEY_SUFFIXES = ["-thumb", "-poster", "-proof"] as const;

export function isReservedMediaId(id: string): boolean {
  return DERIVED_KEY_SUFFIXES.some((suffix) => id.toLowerCase().endsWith(suffix));
}

export const uploadMediaId = z
  .string()
  .min(10)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((id) => !isReservedMediaId(id), "Invalid upload identifier");
