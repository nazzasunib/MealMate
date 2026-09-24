import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Pictures are sent as downsized data-URLs; legacy JSON imports can be a few MB.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
