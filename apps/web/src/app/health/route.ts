import { encaminharParaApi } from "@/server/erp-api-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  return encaminharParaApi(req);
}

export const GET = handle;
export const HEAD = handle;
