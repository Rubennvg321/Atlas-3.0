import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Inkoopfacturen uploaden (PDF of foto van de telefoon), max. 15 MB per bestand.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
};

export default nextConfig;
