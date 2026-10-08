import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const deleteBlobs = vi.fn(async () => {});
vi.mock("./storage", () => ({ r2: { send }, deleteBlobs }));

const { acceptDerivedObject } = await import("./derived-objects");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(0)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)]);

function bucketHolding(size: number, bytes: Uint8Array) {
  send.mockImplementation(async (command: { constructor: { name: string } }) =>
    command.constructor.name === "HeadObjectCommand"
      ? { ContentLength: size }
      : { Body: { transformToByteArray: async () => bytes } },
  );
}

const expected = "events/e/m-thumb.jpg";
const accept = (claimed: string | undefined) =>
  acceptDerivedObject({ claimed, expected, maxBytes: 1000, label: "thumbnail" });

beforeEach(() => {
  send.mockReset();
  deleteBlobs.mockClear();
});

describe("acceptDerivedObject", () => {
  it("accepts a JPEG at the key this media id was given", async () => {
    bucketHolding(500, JPEG);
    expect(await accept(expected)).toBe(expected);
    expect(deleteBlobs).not.toHaveBeenCalled();
  });

  it("refuses somebody else's key without touching it, which was the hole", async () => {
    expect(await accept("events/other-event/their-photo.jpg")).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(deleteBlobs).not.toHaveBeenCalled();
  });

  it("deletes and drops one over its size cap", async () => {
    bucketHolding(5000, JPEG);
    expect(await accept(expected)).toBeNull();
    expect(deleteBlobs).toHaveBeenCalledWith([expected]);
  });

  it("deletes and drops one that is not a JPEG", async () => {
    bucketHolding(500, PNG);
    expect(await accept(expected)).toBeNull();
    expect(deleteBlobs).toHaveBeenCalledWith([expected]);
  });

  it("drops one that never arrived", async () => {
    send.mockRejectedValue(Object.assign(new Error("NotFound"), { name: "NotFound" }));
    expect(await accept(expected)).toBeNull();
  });

  it("treats no claim as no still", async () => {
    expect(await accept(undefined)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
