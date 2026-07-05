import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mysql2 is a server-only dependency; keep it out of the client/edge bundle.
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
