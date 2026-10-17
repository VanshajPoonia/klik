/**
 * Sends a selection in batches of `size`, one after another, and gathers what
 * each batch reports as changed. Stops at the first batch that fails and says
 * why, keeping what the batches before it changed, because those changes are
 * real on the server and the screen should show them.
 */
export async function sendInBatches(
  ids: string[],
  size: number,
  send: (batch: string[]) => Promise<string[]>,
): Promise<{ changed: Set<string>; failure: string | null }> {
  const changed = new Set<string>();
  try {
    for (let start = 0; start < ids.length; start += size) {
      for (const id of await send(ids.slice(start, start + size))) changed.add(id);
    }
    return { changed, failure: null };
  } catch (error) {
    return { changed, failure: error instanceof Error ? error.message : "Could not update the selection." };
  }
}
