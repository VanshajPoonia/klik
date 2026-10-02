import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.klik.kreativvantage.com",
      },
    ],
  },

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
  },
};

export default nextConfig;
