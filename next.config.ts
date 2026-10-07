import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * No `images.remotePatterns`. It listed `media.klik.kreativvantage.com`, a
   * public bucket domain that was never attached and was rejected outright on
   * 2026-10-07 (ARCHITECTURE.md section 8). Every image this app renders is
   * same-origin: either a static asset or `/api/e/.../content`, which authorizes
   * the request before redirecting to a signed URL. Re-adding a remote host here
   * means media is being fetched without passing that check.
   */

  /**
   * `sharp` is a native module: a thin JS binding that dlopens a libvips shared
   * object. Bundling that is meaningless, so it has to stay external and be
   * present in node_modules at runtime.
   */
  serverExternalPackages: ["sharp"],

  /**
   * And external is not enough on its own. Next traces the files each function
   * needs by following imports, but sharp reaches its binary through a runtime
   * `require` that tracing does not see, so the function shipped the binding
   * without the library and failed with:
   *
   *   ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.7: cannot open shared object file
   *
   * Naming the directory forces it in. On Vercel the only platform installed is
   * linux-x64, so this adds that one binary rather than every platform's.
   */
  outputFileTracingIncludes: {
    "/api/e/[slug]/media": ["./node_modules/@img/**"],
    // The health check encodes a test image, so it needs the same files. It was
    // missing them, which is informative: the binding package loads far enough
    // to attempt a dlopen and only then fails on the shared object, so the
    // thing tracing misses is specifically the libvips `.so`, which is opened
    // by the OS and is invisible to any JavaScript tracer.
    "/api/health": ["./node_modules/@img/**"],
    // Resizes a photo down to a chat-preview thumbnail. Every route added here
    // is a route that would otherwise fail only in production, only on Linux,
    // and only once somebody pasted a link into WhatsApp.
    "/api/s/[token]/og": ["./node_modules/@img/**"],
  },
};

export default nextConfig;
