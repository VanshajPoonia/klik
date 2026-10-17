import { describe, expect, it, vi } from "vitest";
import { sendInBatches } from "./bulk-batches";
import { MEDIA_BULK_LIMIT } from "./media-constants";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `m${index}`);

describe("sendInBatches", () => {
  it("sends a selection bigger than the route takes as several requests, none over the limit", async () => {
    const send = vi.fn(async (batch: string[]) => batch);
    const { changed, failure } = await sendInBatches(ids(1_234), MEDIA_BULK_LIMIT, send);
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([500, 500, 234]);
    expect(changed.size).toBe(1_234);
    expect(failure).toBeNull();
  });

  it("sends a small selection as one request, and reports only what the server changed", async () => {
    const send = vi.fn(async (batch: string[]) => batch.slice(1));
    const { changed } = await sendInBatches(ids(3), MEDIA_BULK_LIMIT, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect([...changed]).toEqual(["m1", "m2"]);
  });

  it("stops at a failed batch, keeping what the earlier ones changed", async () => {
    const send = vi.fn(async (batch: string[]) => {
      if (batch[0] === "m500") throw new Error("Could not update the selection.");
      return batch;
    });
    const { changed, failure } = await sendInBatches(ids(1_200), MEDIA_BULK_LIMIT, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(changed.size).toBe(500);
    expect(failure).toBe("Could not update the selection.");
  });
});
