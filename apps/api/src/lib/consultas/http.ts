/**
 * CHAMADA HTTP DAS CONSULTAS EXTERNAS (CEP, CNPJ) — a única porta de saída da API para terceiros.
 *
 * SSRF: o host vem de uma lista FIXA do adaptador, nunca da requisição; o parâmetro (CEP/CNPJ) é validado
 * ANTES de montar a URL e só pode conter [0-9A-Z]; redirecionamento não é seguido para outro host (um
 * 3xx para o MESMO host é seguido uma vez; qualquer outro vira falha da fonte). Tempo máximo por fonte.
 */

export type BuscarFn = (url: string, init: { signal: AbortSignal; redirect: "manual"; headers: Record<string, string> }) => Promise<{ status: number; headers: { get(n: string): string | null }; json(): Promise<unknown> }>;

export type RespostaHttp =
  | { tipo: "ok"; status: number; corpo: unknown }
  | { tipo: "falha"; motivo: "tempo" | "rede" | "redirecionamento" | "corpo"; status?: number };

const PARAMETRO_SEGURO = /^[0-9A-Z]{1,20}$/;

export async function obterJson(buscar: BuscarFn, host: string, caminho: (parametro: string) => string, parametro: string, tempoMs: number): Promise<RespostaHttp> {
  if (!PARAMETRO_SEGURO.test(parametro)) throw new Error("parametro de consulta fora do formato");
  let url = new URL(`https://${host}${caminho(parametro)}`);
  if (url.host !== host || url.protocol !== "https:") throw new Error("URL de consulta fora do host fixo");
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoMs);
  try {
    for (let saltos = 0; saltos < 2; saltos++) {
      let r: Awaited<ReturnType<BuscarFn>>;
      try {
        r = await buscar(url.toString(), { signal: controle.signal, redirect: "manual", headers: { accept: "application/json" } });
      } catch {
        return { tipo: "falha", motivo: controle.signal.aborted ? "tempo" : "rede" };
      }
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get("location");
        const prox = destino ? new URL(destino, url) : null;
        if (!prox || prox.host !== host || prox.protocol !== "https:") return { tipo: "falha", motivo: "redirecionamento", status: r.status };
        url = prox; continue;
      }
      let corpo: unknown = null;
      try { corpo = await r.json(); } catch { if (r.status < 300) return { tipo: "falha", motivo: "corpo", status: r.status }; }
      return { tipo: "ok", status: r.status, corpo };
    }
    return { tipo: "falha", motivo: "redirecionamento" };
  } finally { clearTimeout(timer); }
}

/** Janela deslizante simples em memória (por processo): N por minuto por chave. */
export class LimitePorMinuto {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly maximo: number, private readonly agora: () => number = Date.now) {}
  permitir(chave: string): boolean {
    const t = this.agora(); const lista = (this.marcas.get(chave) ?? []).filter((x) => t - x < 60_000);
    if (lista.length >= this.maximo) { this.marcas.set(chave, lista); return false; }
    lista.push(t); this.marcas.set(chave, lista); return true;
  }
}
