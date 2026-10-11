import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Chromium for the cloud browser ships as compressed files that are read at runtime, so the
  // package stays external and its bin folder is copied into the functions that launch it.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/owner/browser": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/browser/health": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
