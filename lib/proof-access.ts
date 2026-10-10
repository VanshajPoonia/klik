/**
 * MED-10: the two questions every path asks about a proof, with nothing
 * imported, so a route that only serves bytes does not pull the stamping code
 * (and sharp) in with it. See lib/proofs.ts for the model.
 */

type ProofFields = { proofBy: string | null; proofOriginalPathname: string | null; proofReleasedAt: Date | null };

/** Whether a row is a proof still under its watermark. */
export function isLockedProof(item: Pick<ProofFields, "proofOriginalPathname" | "proofReleasedAt">): boolean {
  return Boolean(item.proofOriginalPathname) && !item.proofReleasedAt;
}

/**
 * A locked proof's clean original, for the photographer and nobody else, or
 * null. Every other caller serves `blob_pathname`, which is the watermark.
 */
export function cleanOriginalFor(item: ProofFields, userId: string | null | undefined): string | null {
  if (!isLockedProof(item) || !userId) return null;
  return item.proofBy === userId ? item.proofOriginalPathname : null;
}
