import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the bug that took guest uploads down in production, silently, for an
 * unknown length of time.
 *
 * `sharp` ships its native binary as a set of per-platform optional packages.
 * The lockfile had `sharp` at 0.35.3 while every `@img/sharp-*` binary had
 * resolved to 0.34.5, which bundles an older libvips. On Vercel that produced:
 *
 *     ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
 *
 * Nothing caught it. It cannot fail locally, because a Mac resolves
 * `darwin-arm64` and that one happened to work. It cannot fail at build time,
 * because the module only loads at runtime. And because `sharp` is imported at
 * the top of `app/api/e/[slug]/media/route.ts`, the failure took down **every**
 * handler in that file, including the GET that never touches sharp. Guests
 * could load a gallery server-rendered and then neither poll it nor upload to
 * it.
 *
 * So this asserts the one property that was violated: every platform binary in
 * the lockfile is at the same version as the package that loads it.
 */

const lockfile = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "package-lock.json"), "utf8"),
) as { packages: Record<string, { version?: string }> };

/** Platforms the app actually runs on. Vercel is linux-x64; the rest is local. */
const REQUIRED_PLATFORMS = ["linux-x64", "darwin-arm64"] as const;

/**
 * Exact top-level lookup, never `endsWith`.
 *
 * Next ships its own nested copy of sharp (`node_modules/next/node_modules/
 * sharp`, currently 0.34.5) with a matching set of binaries. That copy is
 * internally consistent and none of our business. A loose match finds it and
 * compares the wrong pair, which is how this test first failed against a
 * lockfile that was by then already correct.
 *
 * The original bug was npm hoisting *Next's* 0.34.5 binaries to the top level,
 * where our sharp 0.35.3 then loaded them.
 */
function topLevelVersion(packageName: string): string | null {
  return lockfile.packages[`node_modules/${packageName}`]?.version ?? null;
}

describe("sharp's native binaries", () => {
  const sharpVersion = topLevelVersion("sharp");

  it("is in the lockfile at all", () => {
    expect(sharpVersion).toBeTruthy();
  });

  it.each(REQUIRED_PLATFORMS)(
    "ships a %s binary, so the platform is installable",
    (platform) => {
      expect(
        topLevelVersion(`@img/sharp-${platform}`),
        `@img/sharp-${platform} is missing from the lockfile. Vercel runs linux-x64, and a lockfile ` +
          "generated on a Mac can omit it entirely, which fails only at runtime in production.",
      ).toBeTruthy();
    },
  );

  it.each(REQUIRED_PLATFORMS)(
    "has its %s binary on the same version as sharp itself",
    (platform) => {
      const binary = topLevelVersion(`@img/sharp-${platform}`);
      expect(
        binary,
        `sharp is ${sharpVersion} but @img/sharp-${platform} is ${binary}. A mismatch means the ` +
          "binary bundles the wrong libvips, which throws ERR_DLOPEN_FAILED at runtime and takes " +
          "down every route in the file that imports sharp. Fix with: npm uninstall sharp && npm install sharp",
      ).toBe(sharpVersion);
    },
  );

  /**
   * The libvips packages are versioned separately from sharp, so they cannot be
   * compared to it. What they must not be is inconsistent *with each other*:
   * two platforms on different libvips majors means the lockfile was written by
   * two different resolutions and one of them is stale.
   */
  it("resolves one libvips version across every platform", () => {
    const libvips = Object.keys(lockfile.packages)
      // Top level only, for the same reason as above.
      .filter((entry) => entry.startsWith("node_modules/@img/sharp-libvips-"))
      .map((entry) => lockfile.packages[entry]?.version)
      .filter((version): version is string => Boolean(version));

    expect(libvips.length).toBeGreaterThan(0);
    expect(new Set(libvips).size, `libvips versions found: ${[...new Set(libvips)].join(", ")}`).toBe(1);
  });
});
