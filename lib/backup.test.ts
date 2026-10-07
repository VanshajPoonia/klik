import { describe, expect, it } from "vitest";
import { planBackupCopies, type BackupObject } from "./backup";

/**
 * These pin down what counts as "already backed up". The interesting cases are
 * all about not being falsely reassured: an object that is present but the
 * wrong size looks like protection and is not.
 */

const object = (key: string, size: number): BackupObject => ({ key, size });

describe("planBackupCopies", () => {
  it("copies nothing when the backup already matches", () => {
    const primary = [object("a.jpg", 10), object("b.jpg", 20)];
    expect(planBackupCopies(primary, primary)).toEqual([]);
  });

  it("copies what the backup has never seen", () => {
    const primary = [object("a.jpg", 10), object("b.jpg", 20)];
    expect(planBackupCopies(primary, [object("a.jpg", 10)])).toEqual(["b.jpg"]);
  });

  /**
   * The case this exists for. A truncated copy is worse than an absent one,
   * because a key that is present reads as backed up to anyone checking.
   */
  it("re-copies a key whose size does not match", () => {
    const primary = [object("a.jpg", 100)];
    expect(planBackupCopies(primary, [object("a.jpg", 42)])).toEqual(["a.jpg"]);
  });

  /**
   * The backup keeps objects the primary no longer has, on purpose: that is the
   * entire point after a delete. The sweep must not read them as work to do,
   * and must never be the thing that removes them.
   */
  it("ignores objects that exist only in the backup", () => {
    const primary = [object("a.jpg", 10)];
    const backup = [object("a.jpg", 10), object("deleted-last-week.jpg", 99)];
    expect(planBackupCopies(primary, backup)).toEqual([]);
  });

  /**
   * Smallest first, so a run that exhausts its time budget has protected as
   * many distinct objects as it could rather than spending the whole window on
   * one video.
   */
  it("orders smallest first so a short run still covers the most objects", () => {
    const primary = [object("big.mov", 50_000_000), object("small.jpg", 1_000), object("mid.png", 500_000)];
    expect(planBackupCopies(primary, [])).toEqual(["small.jpg", "mid.png", "big.mov"]);
  });

  it("handles an empty primary and an empty backup", () => {
    expect(planBackupCopies([], [])).toEqual([]);
    expect(planBackupCopies([], [object("orphan.jpg", 1)])).toEqual([]);
  });

  /** A zero-byte object is still an object, and `0` must not read as falsy. */
  it("treats a zero-byte object as backed up when the backup has it", () => {
    expect(planBackupCopies([object("empty.bin", 0)], [object("empty.bin", 0)])).toEqual([]);
    expect(planBackupCopies([object("empty.bin", 0)], [])).toEqual(["empty.bin"]);
  });
});
