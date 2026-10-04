import type { NextConfig } from "next";

// The page talks to the services through the /api/probe route (see features/probe),
// so there is nothing to forward here and no CORS to set up.
const nextConfig: NextConfig = {};

export default nextConfig;
