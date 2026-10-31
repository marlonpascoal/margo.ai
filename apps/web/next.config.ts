import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No dev overlay badge in the F02 screenshots.
  devIndicators: false,
  transpilePackages: ["@margoai/contracts"],
};

export default nextConfig;
