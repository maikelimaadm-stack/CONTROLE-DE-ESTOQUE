import { encaminharParaApi } from "@/server/erp-api-bridge";

/**
 * Encaminha a API Fastify. `/api/build` continua na rota estática do web
 * (mais específica que este catch-all).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  return encaminharParaApi(req);
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
