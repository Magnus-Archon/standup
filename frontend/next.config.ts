import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",   // tihis is requird by the Docker.frontend
};

export default nextConfig;
