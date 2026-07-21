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
};

export default nextConfig;
