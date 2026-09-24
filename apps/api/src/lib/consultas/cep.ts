/**
 * CONSULTA DE CEP (CADASTROS Fase 3): ViaCEP principal, BrasilAPI reserva. Mesma resposta nas duas.
 * O município é resolvido DEPOIS, contra erp.cities (código IBGE; na falta dele, nome + UF).
 */
import { obterJson, type BuscarFn } from "./http.js";

export interface DadosCep { cep: string; logradouro: string | null; complemento: string | null; bairro: string | null; municipioIbge: number | null; municipioNome: string | null; uf: string | null }
type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | null => { if (v === null || v === undefined) return null; const t = String(v).trim(); return t ? t : null; };
const n = (v: unknown): number | null => { const t = s(v); return t && /^\d{7}$/.test(t) ? Number(t) : null; };

export interface FonteCep { nome: "viacep" | "brasilapi"; host: string; caminho: (cep: string) => string; interpretar: (status: number, corpo: unknown, cep: string) => DadosCep | "inexistente" | "falha" }

export const FONTES_CEP: FonteCep[] = [
  {
    nome: "viacep", host: "viacep.com.br", caminho: (c) => `/ws/${c}/json/`,
    interpretar: (status, corpo, cep) => {
      const d = o(corpo);
      if (status === 400 || (status === 200 && (d["erro"] === true || d["erro"] === "true"))) return "inexistente";
      if (status !== 200) return "falha";
      return { cep, logradouro: s(d["logradouro"]), complemento: s(d["complemento"]), bairro: s(d["bairro"]), municipioIbge: n(d["ibge"]), municipioNome: s(d["localidade"]), uf: s(d["uf"]) };
    }
  },
  {
    nome: "brasilapi", host: "brasilapi.com.br", caminho: (c) => `/api/cep/v1/${c}`,
    interpretar: (status, corpo, cep) => {
      const d = o(corpo);
      if (status === 404) return "inexistente";
      if (status !== 200) return "falha";
      return { cep, logradouro: s(d["street"]), complemento: null, bairro: s(d["neighborhood"]), municipioIbge: n(o(d["ibge"])["city"]), municipioNome: s(d["city"]), uf: s(d["state"]) };
    }
  }
];

export const TEMPO_POR_FONTE_CEP_MS = 3_000;

export async function consultarCepNasFontes(buscar: BuscarFn, cep: string, tempoMs = TEMPO_POR_FONTE_CEP_MS): Promise<{ tipo: "ok"; fonte: string; dados: DadosCep } | { tipo: "inexistente" } | { tipo: "indisponivel" }> {
  let inexistente = 0;
  for (const f of FONTES_CEP) {
    const r = await obterJson(buscar, f.host, f.caminho, cep, tempoMs);
    if (r.tipo === "falha") continue;
    const v = f.interpretar(r.status, r.corpo, cep);
    if (v === "inexistente") { inexistente++; continue; }
    if (v === "falha") continue;
    return { tipo: "ok", fonte: f.nome, dados: v };
  }
  return inexistente === FONTES_CEP.length ? { tipo: "inexistente" } : { tipo: "indisponivel" };
}
