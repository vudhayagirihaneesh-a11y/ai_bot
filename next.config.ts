import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use dynamic requires / native-ish loaders that must not be
  // bundled into the server runtime by webpack — keep them external.
  serverExternalPackages: ["pdfjs-dist", "mammoth"],

  // Increase the body size limit for API routes (default is 4.5 MB on Vercel).
  // This must match or exceed MAX_UPLOAD_MB (default 25 MB).
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;