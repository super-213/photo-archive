import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "exifr"],
  images: { unoptimized: true, localPatterns: [] },
};

export default nextConfig;
