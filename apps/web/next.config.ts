import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agro/domain", "@agro/shared"],
  output: "standalone",
  typescript: { ignoreBuildErrors: false },
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] }
};
export default nextConfig;
