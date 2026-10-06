import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3302";

const nextConfig: NextConfig = {
  // Browser calls /api/* on this app; Next forwards it to the URL shortener service.
  // This avoids CORS, so the backend needs no changes.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;
