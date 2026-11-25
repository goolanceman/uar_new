import type { NextConfig } from "next";

// The backend is a standalone Express service (see backend/). All /api/*
// requests are transparently proxied to it so the SPA's relative fetches
// (fetch("/api/...")) keep working unchanged.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
