import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server build for a minimal Docker runtime image.
  output: "standalone",
  // mysql2 is a server-only dependency; keep it out of the client/edge bundle.
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
