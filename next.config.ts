import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "https://preview-chat-d35f931f-736d-4ec7-b184-0109ff502f8a.space-z.ai",
    "*.space-z.ai",
  ],
};

export default nextConfig;
