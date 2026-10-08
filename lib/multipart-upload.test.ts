import { describe, expect, it } from "vitest";
import { takeBytes } from "./multipart-upload";

describe("takeBytes", () => {
  it("cuts exactly the size asked for across chunk boundaries", () => {
    const queue = [Buffer.from("abc"), Buffer.from("defg"), Buffer.from("hi")];
    expect(takeBytes(queue, 5).toString()).toBe("abcde");
    expect(queue.map((chunk) => chunk.toString())).toEqual(["fg", "hi"]);
  });

  it("returns whatever is left when asked for more", () => {
    const queue = [Buffer.from("xy")];
    expect(takeBytes(queue, 10).toString()).toBe("xy");
    expect(queue).toHaveLength(0);
  });
});
