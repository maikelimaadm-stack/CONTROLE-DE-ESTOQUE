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
 * também na falha `corpo` (2xx com corpo ilegível, acima do teto ou cortado pelo tempo máximo durante a leitura): a
 * resposta foi 2xx, e a chamada foi cobrada do mesmo jeito.
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
 * Corpo BINÁRIO (SAT-06, decisão 297: a imagem da Process API), como `Buffer`, com TETO de `maximoBytes` que não
 * depende de confiar no provedor:
 *  - `content-length` declarado acima do teto → recusa ANTES de ler um byte (o fluxo é cancelado);
 *  - com fluxo (`body.getReader()`, o caso do `fetch` real): lê em pedaços, contando, e CANCELA assim que passa do
 *    teto — o corpo inteiro nunca é carregado (o `fetch` descomprime gzip/br sozinho; a contagem é do corpo já
 *    descomprimido, então o teto vale para o que vai à memória);
 *  - sem fluxo: `arrayBuffer()` e a conferência depois de ler.
 * Resposta sem fluxo e sem `arrayBuffer`, corpo VAZIO ou acima do teto é corpo ilegível: nunca vira uma imagem vazia
 * ou cortada. Num 2xx, `enviarPost` devolve isso como falha `corpo` com o PU (cobrada, não repetida).
 */
export function leitorCorpoBinario(maximoBytes: number): LeitorCorpo {
  const acimaDoTeto = () => new Error("corpo binário acima do teto");
  return async (r) => {
    const fluxo = r.body && typeof r.body.getReader === "function" ? r.body.getReader() : null;
    const declarado = r.headers.get("content-length")?.trim() ?? null;
    if (declarado !== null && /^\d+$/.test(declarado) && Number(declarado) > maximoBytes) {
      if (fluxo) await fluxo.cancel().catch(() => {});
      throw acimaDoTeto();
    }
    let corpo: Buffer;
    if (fluxo) {
      const partes: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await fluxo.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maximoBytes) { await fluxo.cancel().catch(() => {}); throw acimaDoTeto(); }
        partes.push(value);
      }
      corpo = Buffer.concat(partes, total);
    } else {
      if (typeof r.arrayBuffer !== "function") throw new Error("resposta sem corpo binário");
      corpo = Buffer.from(await r.arrayBuffer());
    }
    if (corpo.length === 0) throw new Error("corpo binário vazio");
    if (corpo.length > maximoBytes) throw acimaDoTeto();
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
      // 2xx: o provedor JÁ respondeu e cobrou. Corpo ilegível, acima do teto ou cortado pelo tempo máximo DURANTE a
      // leitura é falha `corpo` com o PU — nunca `tempo`, que seria repetido (segunda chamada paga, e o PU da primeira
      // sumiria do ledger). Só um 3xx-5xx cortado pelo tempo é `tempo`.
      if (r.status < 300) return { tipo: "falha", motivo: "corpo", status: r.status, ...(pu !== null ? { processingUnits: pu } : {}) };
      if (controle.signal.aborted) return { tipo: "falha", motivo: "tempo", status: r.status };
    }
    return { tipo: "ok", status: r.status, corpo: json, tentarAposSegundos: segundosDoRetryAfter(r.headers.get("retry-after"), agoraMs()), ...(pu !== null ? { processingUnits: pu } : {}) };
  } finally { clearTimeout(timer); }
}
