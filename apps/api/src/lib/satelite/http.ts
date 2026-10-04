/**
 * PORTA HTTP DO PROVEDOR SATELITAL (SAT-01, decisão 293): POST para um host FIXO, com tempo máximo.
 *
 * Separada da porta das consultas de CEP/CNPJ (`lib/consultas/http.ts`) de propósito: aquelas não levam credencial
 * nenhuma, e esta leva (o corpo do pedido de token e o cabeçalho de autorização da Statistical API). A função de
 * saída é a mesma (`app.buscarExterno`, mock nos testes).
 *
 * Nenhum 3xx é seguido (nem para o mesmo host): repetir um POST com credencial noutro destino seria entregá-la a
 * quem respondeu o redirecionamento.
 *
 * SAT-06 (decisão 297): a Process API devolve a imagem (binário); o mesmo `enviarPost` a lê com `leitorCorpoBinario`.
 */
import type { BuscarFn } from "../consultas/http.js";

/**
 * `processingUnits` (SAT-03, decisão 296): o valor BRUTO do cabeçalho `x-processingunits-spent` (o PU que o provedor
 * cobrou pela chamada), PRESENTE só quando o cabeçalho veio. Não é segredo; quem o lê e valida é `consumo.ts`. Vem
 * também na falha `corpo` (2xx com corpo ilegível): a resposta foi 2xx, e a chamada foi cobrada do mesmo jeito.
 */
export type RespostaEnvio =
  | { tipo: "ok"; status: number; corpo: unknown; tentarAposSegundos: number | null; processingUnits?: string }
  | { tipo: "falha"; motivo: "tempo" | "rede" | "redirecionamento" | "corpo"; status?: number; processingUnits?: string };

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

/** Como o corpo da resposta é lido. Lançar = corpo ilegível (2xx → falha `corpo`; outro status → `corpo: null`). */
export type LeitorCorpo = (r: Awaited<ReturnType<BuscarFn>>) => Promise<unknown>;

/** Corpo JSON (o padrão: token e Statistical API). */
export const lerCorpoJson: LeitorCorpo = (r) => r.json();

/**
 * Corpo BINÁRIO (SAT-06, decisão 297: a imagem da Process API), como `Buffer`. Resposta sem `arrayBuffer`, corpo
 * VAZIO ou maior que `maximoBytes` é corpo ilegível: nunca vira uma imagem vazia ou cortada.
 */
export function leitorCorpoBinario(maximoBytes: number): LeitorCorpo {
  return async (r) => {
    if (typeof r.arrayBuffer !== "function") throw new Error("resposta sem corpo binário");
    const corpo = Buffer.from(await r.arrayBuffer());
    if (corpo.length === 0 || corpo.length > maximoBytes) throw new Error("corpo binário vazio ou acima do teto");
    return corpo;
  };
}

/**
 * POST para um host FIXO (constante do adaptador) com tempo máximo. Nenhum 3xx é seguido (vira falha). O corpo
 * da resposta (JSON, ou o que `ler` devolver) é devolvido também nos 4xx/5xx (sem ele, `corpo: null`), para o
 * adaptador classificar o erro — e o adaptador nunca o repassa ao cliente da API. Esta função não lança com o corpo
 * ENVIADO: ele pode conter credencial (token OAuth).
 */
export async function enviarPost(buscar: BuscarFn, host: string, caminho: string, corpo: string, headers: Record<string, string>, tempoMs: number, agoraMs: () => number = Date.now, ler: LeitorCorpo = lerCorpoJson): Promise<RespostaEnvio> {
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
    const pu = r.headers.get("x-processingunits-spent");
    let json: unknown = null;
    try { json = await ler(r); } catch {
      if (controle.signal.aborted) return { tipo: "falha", motivo: "tempo", status: r.status };
      if (r.status < 300) return { tipo: "falha", motivo: "corpo", status: r.status, ...(pu !== null ? { processingUnits: pu } : {}) };
    }
    return { tipo: "ok", status: r.status, corpo: json, tentarAposSegundos: segundosDoRetryAfter(r.headers.get("retry-after"), agoraMs()), ...(pu !== null ? { processingUnits: pu } : {}) };
  } finally { clearTimeout(timer); }
}
