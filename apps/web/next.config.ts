import type { NextConfig } from "next";
import path from "node:path";
import { LEGACY_REDIRECTS } from "./redirects.mjs";
/**
 * ORIGEM DO PREVIEW DA SANDBOX (Base44) — só em ambiente de preview local.
 *
 * O preview chega ao dev server pelo proxy do sandbox: o `Host` da requisição é
 * `<porta>-<id-da-sandbox>.<domínio>` e o `Origin` que o navegador manda é o host PÚBLICO
 * (`https://3000-<sufixo>`). Como os dois não coincidem, o Next recusa os assets e o HMR de
 * origem cruzada — a página carrega e o JavaScript não. A lista acrescenta a origem PÚBLICA,
 * e só com `BASE44_PREVIEW_MODE=1` (o sandbox liga; qualquer outro valor ou ausente mantém o
 * comportamento de sempre). Nenhum host resolvido é gravado aqui: vem do ambiente.
 */
const origemDoPreviewBase44 =
  process.env.BASE44_PREVIEW_MODE === "1" && process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`]
    : undefined;

const nextConfig: NextConfig = {
  // monorepo: raiz do rastreamento de arquivos para o output standalone (Docker)
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  ...(origemDoPreviewBase44 ? { allowedDevOrigins: origemDoPreviewBase44 } : {}),
  reactStrictMode: true,
  transpilePackages: ["@agro/domain", "@agro/shared"],
  // Fastify + pg na ponte da API (mesmo projeto Vercel; Hobby não cria segundo projeto)
  serverExternalPackages: [
    "fastify",
    "@fastify/cors",
    "@fastify/helmet",
    "@fastify/rate-limit",
    "pg",
    "pino",
    "exceljs",
    "bcryptjs",
    "jose",
    "tar-stream"
  ],
  // standalone só fora da Vercel (Docker); na Vercel o tracing é feito pela plataforma
  output: process.env.VERCEL ? undefined : "standalone",
  typescript: { ignoreBuildErrors: false },
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
  // rotas antigas → áreas unificadas (compatibilidade de links, favoritos e notificações)
  async redirects() { return LEGACY_REDIRECTS; }
};
export default nextConfig;
