import type { NextConfig } from "next";
import path from "node:path";
import { LEGACY_REDIRECTS } from "./redirects.mjs";
const nextConfig: NextConfig = {
  // monorepo: raiz do rastreamento de arquivos para o output standalone (Docker)
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  reactStrictMode: true,
  transpilePackages: ["@agro/domain", "@agro/shared"],
  // standalone só fora da Vercel (Docker); na Vercel o tracing é feito pela plataforma
  output: process.env.VERCEL ? undefined : "standalone",
  typescript: { ignoreBuildErrors: false },
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
  // rotas antigas → áreas unificadas (compatibilidade de links, favoritos e notificações)
  async redirects() { return LEGACY_REDIRECTS; }
};
export default nextConfig;
