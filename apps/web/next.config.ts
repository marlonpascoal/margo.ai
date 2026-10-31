import type { NextConfig } from "next";

// Test-only pages are named page.e2e.tsx and exist only when the e2e web server sets MARGO_E2E_ROUTES=1
// (playwright.config.ts). `next build` for preview and production never compiles them.
const e2eRoutes = process.env.MARGO_E2E_ROUTES === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  pageExtensions: e2eRoutes ? ["tsx", "ts", "jsx", "js", "e2e.tsx"] : ["tsx", "ts", "jsx", "js"],
  // No dev overlay badge in the F02 screenshots.
  devIndicators: false,
  // Marlon opens `pnpm dev` from his other devices over Tailscale (100.64.0.0/10 and MagicDNS names).
  allowedDevOrigins: ["100.*.*.*", "*.ts.net"],
  transpilePackages: ["@margoai/contracts"],
  // C07: statements are uploaded through a server action; a month of iFood exports runs to a few MB.
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
