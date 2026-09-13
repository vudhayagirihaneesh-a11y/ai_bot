import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use dynamic requires / native-ish loaders that must not be
  // bundled into the server runtime by webpack — keep them external.
  serverExternalPackages: ["pdfjs-dist", "mammoth"],
};

export default nextConfig;