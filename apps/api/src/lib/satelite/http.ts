/**
 * PORTA HTTP DO PROVEDOR SATELITAL (SAT-01, decisão 293): POST para um host FIXO, com tempo máximo.
 *
 * Separada da porta das consultas de CEP/CNPJ (`lib/consultas/http.ts`) de propósito: aquelas não levam credencial
 * nenhuma, e esta leva (o corpo do pedido de token e o cabeçalho de autorização da Statistical API). A função de
 * saída é a mesma (`app.buscarExterno`, mock nos testes).
 *
 * Nenhum 3xx é seguido (nem para o mesmo host): repetir um POST com credencial noutro destino seria entregá-la a
 * quem respondeu o redirecionamento.
 */
import type { BuscarFn } from "../consultas/http.js";

/**
 * `processingUnits` (SAT-03, decisão 296): o valor BRUTO do cabeçalho `x-processingunits-spent` (o PU que o provedor
 * cobrou pela chamada), PRESENTE só quando o cabeçalho veio. Não é segredo; quem o lê e valida é `consumo.ts`.
 */
export type RespostaEnvio =
  | { tipo: "ok"; status: number; corpo: unknown; tentarAposSegundos: number | null; processingUnits?: string }
  | { tipo: "falha"; motivo: "tempo" | "rede" | "redirecionamento" | "corpo"; status?: number };

/**
 * `Retry-After` em segundos (número inteiro ou data HTTP). Ausente, ilegível ou no passado → null: quem chama
 * decide sem inventar espera.
 */
export function segundosDoRetryAfter(valor: string | null, agoraMs: number = Date.now()): number | null {
  if (!valor) return null;
  const t = valor.trim();
  if (/^\d{1,6}$/.test(t)) return Number(t);
  const data = Date.parse(t);
  if (Number.isNaN(data)) return null;
  const s = Math.ceil((data - agoraMs) / 1000);
  return s >= 0 ? s : null;
}

/**
 * POST para um host FIXO (constante do adaptador) com tempo máximo. Nenhum 3xx é seguido (vira falha). O corpo
 * JSON da resposta é devolvido também nos 4xx/5xx (sem ele, `corpo: null`), para o adaptador classificar o erro
 * — e o adaptador nunca o repassa ao cliente da API. Esta função não lança com o corpo ENVIADO: ele pode conter
 * credencial (token OAuth).
 */
export async function enviarPost(buscar: BuscarFn, host: string, caminho: string, corpo: string, headers: Record<string, string>, tempoMs: number, agoraMs: () => number = Date.now): Promise<RespostaEnvio> {
  const url = new URL(`https://${host}${caminho}`);
  if (url.host !== host || url.protocol !== "https:") throw new Error("URL de envio fora do host fixo");
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoMs);
  try {
    let r: Awaited<ReturnType<BuscarFn>>;
    try {
      r = await buscar(url.toString(), { signal: controle.signal, redirect: "manual", method: "POST", body: corpo, headers: { accept: "application/json", ...headers } });
    } catch {
      return { tipo: "falha", motivo: controle.signal.aborted ? "tempo" : "rede" };
    }
    if (r.status >= 300 && r.status < 400) return { tipo: "falha", motivo: "redirecionamento", status: r.status };
    let json: unknown = null;
    try { json = await r.json(); } catch {
      if (controle.signal.aborted) return { tipo: "falha", motivo: "tempo", status: r.status };
      if (r.status < 300) return { tipo: "falha", motivo: "corpo", status: r.status };
    }
    const pu = r.headers.get("x-processingunits-spent");
    return { tipo: "ok", status: r.status, corpo: json, tentarAposSegundos: segundosDoRetryAfter(r.headers.get("retry-after"), agoraMs()), ...(pu !== null ? { processingUnits: pu } : {}) };
  } finally { clearTimeout(timer); }
}
