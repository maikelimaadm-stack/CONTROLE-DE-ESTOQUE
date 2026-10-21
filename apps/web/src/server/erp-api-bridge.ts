import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { buildApp } from "@agro/api/server";

/**
 * Ponte Next ↔ Fastify no MESMO projeto Vercel (plano Hobby = um projeto).
 * A API deixa de depender do Railway: `/health` e `/api/*` (exceto `/api/build` do web)
 * passam por `inject` no processo Node do Next.
 */
let appPronto: Promise<FastifyInstance> | null = null;

function appDaApi(): Promise<FastifyInstance> {
  if (!appPronto) {
    appPronto = buildApp().catch((erro) => {
      appPronto = null;
      throw erro;
    });
  }
  return appPronto;
}

function cabecalhosDaResposta(headers: InjectResponse["headers"]): Headers {
  const out = new Headers();
  for (const [chave, valor] of Object.entries(headers)) {
    if (valor === undefined) continue;
    const nome = chave.toLowerCase();
    if (nome === "transfer-encoding" || nome === "connection") continue;
    if (Array.isArray(valor)) for (const item of valor) out.append(chave, String(item));
    else out.set(chave, String(valor));
  }
  return out;
}

type MetodoInject = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "OPTIONS";
const METODOS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export async function encaminharParaApi(req: Request): Promise<Response> {
  const app = await appDaApi();
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((valor, chave) => {
    if (chave.toLowerCase() === "host") return;
    headers[chave] = valor;
  });
  const metodoBruto = req.method.toUpperCase();
  if (!METODOS.has(metodoBruto)) {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const metodo = metodoBruto as MetodoInject;
  const temCorpo = metodo !== "GET" && metodo !== "HEAD";
  const payload = temCorpo ? Buffer.from(await req.arrayBuffer()) : undefined;
  const injetado = await app.inject({
    method: metodo,
    url: `${url.pathname}${url.search}`,
    headers,
    payload,
    remoteAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
  }) as InjectResponse;
  return new Response(new Uint8Array(injetado.rawPayload), {
    status: injetado.statusCode,
    headers: cabecalhosDaResposta(injetado.headers)
  });
}
