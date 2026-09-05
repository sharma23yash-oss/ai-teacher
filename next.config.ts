import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  devIndicators: {
    position: "bottom-right",
  },
  // pdf-parse (via pdfjs-dist) resolves its worker file relative to its own
  // module location at runtime; bundling it rewrites that path and breaks
  // the lookup. Keep it external so Node resolves it straight from node_modules.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
