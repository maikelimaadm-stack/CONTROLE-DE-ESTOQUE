import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agro/domain", "@agro/shared"],
  // standalone só fora da Vercel (Docker); na Vercel o tracing é feito pela plataforma
  output: process.env.VERCEL ? undefined : "standalone",
  typescript: { ignoreBuildErrors: false },
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] }
};
export default nextConfig;
