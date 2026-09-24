/**
 * CONSULTA DE CNPJ — adaptadores das fontes GRATUITAS e sem chave (CADASTROS Fase 3; decisão do Maike:
 * nenhuma fonte paga, nenhum gancho de credencial). Cada adaptador devolve a MESMA resposta
 * (`DadosCnpj`), montada campo a campo: o quadro societário (QSA / members / socios) NUNCA é copiado —
 * não existe caminho do corpo da fonte para a resposta além dos campos listados aqui.
 *
 * Ordem e escolha das fontes: `CONSULTA_CNPJ_FONTES` (config.ts). Passa para a próxima fonte quando a
 * atual estoura o tempo, responde 5xx, 429 (e fica em pausa por 60 s) ou "não encontrado". 404 só quando
 * TODAS disseram que não existe; todas fora → 503.
 */
import { obterJson, type BuscarFn } from "./http.js";

export type NomeFonteCnpj = "brasilapi" | "cnpja" | "cnpjws";

export interface DadosCnpj {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: { descricao: string | null; data: string | null; motivo: string | null };
  abertura: string | null;
  naturezaJuridica: { codigo: string | null; descricao: string | null };
  porte: string | null;
  cnaePrincipal: { codigo: string; descricao: string | null } | null;
  cnaesSecundarios: { codigo: string; descricao: string | null }[];
  endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null; municipioIbge: number | null; municipioNome: string | null; uf: string | null };
  telefones: string[];
  email: string | null;
  simples: { optante: boolean; desde: string | null } | null;
  mei: { optante: boolean; desde: string | null } | null;
  matriz: boolean | null;
  /** data da informação na fonte, quando a fonte informa */
  dataDaInformacao: string | null;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | null => { if (v === null || v === undefined) return null; const t = String(v).trim(); return t ? t : null; };
const n = (v: unknown): number | null => { const t = s(v); return t && /^\d+$/.test(t) ? Number(t) : null; };
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const juntar = (...partes: unknown[]) => s(partes.map(s).filter(Boolean).join(" "));
const sn = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "Sim" ? true : v === "Não" || v === "Nao" ? false : null);
const telefone = (ddd: unknown, num: unknown) => { const t = `${s(ddd) ?? ""}${s(num) ?? ""}`.replace(/\D/g, ""); return t.length >= 10 ? t : null; };

export interface FonteCnpj {
  nome: NomeFonteCnpj;
  host: string;
  caminho: (cnpj: string) => string;
  /**
   * A fonte consulta CNPJ ALFANUMÉRICO? Falso nas três até haver prova com um CNPJ alfanumérico REAL
   * existente (em 2026-09-24 as três respondem 404 a um CNPJ com letras de DV válido, o que mostra que
   * aceitam o formato, não que tenham os dados). Com todas falsas, CNPJ com letras → 422 sem chamada.
   */
  aceitaAlfanumerico: boolean;
  mapear: (corpo: unknown, cnpj: string) => DadosCnpj;
}

export const FONTES_CNPJ: Record<NomeFonteCnpj, FonteCnpj> = {
  brasilapi: {
    nome: "brasilapi", host: "brasilapi.com.br", caminho: (c) => `/api/cnpj/v1/${c}`, aceitaAlfanumerico: false,
    mapear: (corpo, cnpj) => {
      const d = o(corpo);
      const simples = d["opcao_pelo_simples"]; const mei = d["opcao_pelo_mei"];
      return {
        cnpj, razaoSocial: s(d["razao_social"]), nomeFantasia: s(d["nome_fantasia"]),
        situacao: { descricao: s(d["descricao_situacao_cadastral"]), data: s(d["data_situacao_cadastral"]), motivo: s(d["descricao_motivo_situacao_cadastral"]) },
        abertura: s(d["data_inicio_atividade"]),
        naturezaJuridica: { codigo: s(d["codigo_natureza_juridica"]), descricao: s(d["natureza_juridica"]) },
        porte: s(d["porte"]),
        cnaePrincipal: s(d["cnae_fiscal"]) ? { codigo: s(d["cnae_fiscal"])!, descricao: s(d["cnae_fiscal_descricao"]) } : null,
        cnaesSecundarios: lista(d["cnaes_secundarios"]).map((x) => ({ codigo: s(o(x)["codigo"]) ?? "", descricao: s(o(x)["descricao"]) })).filter((x) => x.codigo && x.codigo !== "0"),
        endereco: { logradouro: juntar(d["descricao_tipo_de_logradouro"], d["logradouro"]), numero: s(d["numero"]), complemento: s(d["complemento"]), bairro: s(d["bairro"]), cep: s(d["cep"]), municipioIbge: n(d["codigo_municipio_ibge"]), municipioNome: s(d["municipio"]), uf: s(d["uf"]) },
        telefones: [s(d["ddd_telefone_1"]), s(d["ddd_telefone_2"])].map((t) => (t ? t.replace(/\D/g, "") : null)).filter((t): t is string => Boolean(t && t.length >= 10)),
        email: s(d["email"]),
        simples: typeof simples === "boolean" ? { optante: simples, desde: simples ? s(d["data_opcao_pelo_simples"]) : null } : null,
        mei: typeof mei === "boolean" ? { optante: mei, desde: mei ? s(d["data_opcao_pelo_mei"]) : null } : null,
        matriz: d["identificador_matriz_filial"] === 1 ? true : d["identificador_matriz_filial"] === 2 ? false : null,
        dataDaInformacao: null
      };
    }
  },
  cnpja: {
    nome: "cnpja", host: "open.cnpja.com", caminho: (c) => `/office/${c}`, aceitaAlfanumerico: false,
    mapear: (corpo, cnpj) => {
      const d = o(corpo); const emp = o(d["company"]); const end = o(d["address"]); const st = o(d["status"]);
      const nat = o(emp["nature"]); const size = o(emp["size"]); const main = o(d["mainActivity"]);
      const simples = o(emp["simples"]); const simei = o(emp["simei"]);
      return {
        cnpj, razaoSocial: s(emp["name"]), nomeFantasia: s(d["alias"]),
        situacao: { descricao: s(st["text"]), data: s(d["statusDate"]), motivo: s(o(d["reason"])["text"]) },
        abertura: s(d["founded"]),
        naturezaJuridica: { codigo: s(nat["id"]), descricao: s(nat["text"]) },
        porte: s(size["acronym"]) ?? s(size["text"]),
        cnaePrincipal: s(main["id"]) ? { codigo: s(main["id"])!, descricao: s(main["text"]) } : null,
        cnaesSecundarios: lista(d["sideActivities"]).map((x) => ({ codigo: s(o(x)["id"]) ?? "", descricao: s(o(x)["text"]) })).filter((x) => x.codigo),
        endereco: { logradouro: s(end["street"]), numero: s(end["number"]), complemento: s(end["details"]), bairro: s(end["district"]), cep: s(end["zip"]), municipioIbge: n(end["municipality"]), municipioNome: s(end["city"]), uf: s(end["state"]) },
        telefones: lista(d["phones"]).map((p) => telefone(o(p)["area"], o(p)["number"])).filter((t): t is string => Boolean(t)),
        email: s(o(lista(d["emails"])[0])["address"]),
        simples: typeof simples["optant"] === "boolean" ? { optante: simples["optant"] as boolean, desde: s(simples["since"]) } : null,
        mei: typeof simei["optant"] === "boolean" ? { optante: simei["optant"] as boolean, desde: s(simei["since"]) } : null,
        matriz: typeof d["head"] === "boolean" ? (d["head"] as boolean) : null,
        dataDaInformacao: s(d["updated"])
      };
    }
  },
  cnpjws: {
    nome: "cnpjws", host: "publica.cnpj.ws", caminho: (c) => `/cnpj/${c}`, aceitaAlfanumerico: false,
    mapear: (corpo, cnpj) => {
      const d = o(corpo); const e = o(d["estabelecimento"]); const nat = o(d["natureza_juridica"]); const main = o(e["atividade_principal"]);
      const simples = d["simples"] ? o(d["simples"]) : null; const motivo = e["motivo_situacao_cadastral"];
      const optSimples = simples ? sn(simples["simples"]) : null; const optMei = simples ? sn(simples["mei"]) : null;
      return {
        cnpj, razaoSocial: s(d["razao_social"]), nomeFantasia: s(e["nome_fantasia"]),
        situacao: { descricao: s(e["situacao_cadastral"]), data: s(e["data_situacao_cadastral"]), motivo: typeof motivo === "object" ? s(o(motivo)["descricao"]) : s(motivo) },
        abertura: s(e["data_inicio_atividade"]),
        naturezaJuridica: { codigo: s(nat["id"]), descricao: s(nat["descricao"]) },
        porte: s(o(d["porte"])["descricao"]),
        cnaePrincipal: s(main["id"]) ? { codigo: s(main["id"])!, descricao: s(main["descricao"]) } : null,
        cnaesSecundarios: lista(e["atividades_secundarias"]).map((x) => ({ codigo: s(o(x)["id"]) ?? "", descricao: s(o(x)["descricao"]) })).filter((x) => x.codigo),
        endereco: { logradouro: juntar(e["tipo_logradouro"], e["logradouro"]), numero: s(e["numero"]), complemento: s(e["complemento"]), bairro: s(e["bairro"]), cep: s(e["cep"]), municipioIbge: n(o(e["cidade"])["ibge_id"]), municipioNome: s(o(e["cidade"])["nome"]), uf: s(o(e["estado"])["sigla"]) },
        telefones: [telefone(e["ddd1"], e["telefone1"]), telefone(e["ddd2"], e["telefone2"])].filter((t): t is string => Boolean(t)),
        email: s(e["email"]),
        simples: optSimples === null ? null : { optante: optSimples, desde: optSimples ? s(simples!["data_opcao_simples"]) : null },
        mei: optMei === null ? null : { optante: optMei, desde: optMei ? s(simples!["data_opcao_mei"]) : null },
        matriz: e["tipo"] === "Matriz" ? true : e["tipo"] === "Filial" ? false : null,
        dataDaInformacao: s(d["atualizado_em"])
      };
    }
  }
};

export type ResultadoFontes =
  | { tipo: "ok"; fonte: NomeFonteCnpj; dados: DadosCnpj }
  | { tipo: "inexistente" }
  | { tipo: "indisponivel" }
  | { tipo: "sem_suporte_alfanumerico" };

/** Pausa de fonte que respondeu 429 (60 s), por instância da API. */
export class PausaDeFontes {
  private readonly ate = new Map<string, number>();
  constructor(private readonly agora: () => number = Date.now) {}
  pausar(fonte: string) { this.ate.set(fonte, this.agora() + 60_000); }
  pausada(fonte: string) { return (this.ate.get(fonte) ?? 0) > this.agora(); }
}

export const TEMPO_POR_FONTE_CNPJ_MS = 5_000;

/**
 * Tenta as fontes em ordem. `inexistente` só se TODAS as fontes tentadas disseram "não encontrado"; uma
 * fonte fora (tempo, rede, 5xx, 429, pausada) torna o resultado `indisponivel` se nenhuma achar.
 */
export async function consultarCnpjNasFontes(buscar: BuscarFn, cnpj: string, ordem: readonly NomeFonteCnpj[], pausa: PausaDeFontes, tempoMs = TEMPO_POR_FONTE_CNPJ_MS): Promise<ResultadoFontes> {
  const alfanumerico = /[A-Z]/.test(cnpj);
  const fontes = ordem.map((f) => FONTES_CNPJ[f]).filter((f) => !alfanumerico || f.aceitaAlfanumerico);
  if (!fontes.length) return alfanumerico && ordem.length ? { tipo: "sem_suporte_alfanumerico" } : { tipo: "indisponivel" };
  let naoEncontrado = 0;
  for (const f of fontes) {
    if (pausa.pausada(f.nome)) continue;
    const r = await obterJson(buscar, f.host, f.caminho, cnpj, tempoMs);
    if (r.tipo === "falha") continue;
    if (r.status === 429) { pausa.pausar(f.nome); continue; }
    if (r.status === 404) { naoEncontrado++; continue; }
    if (r.status >= 200 && r.status < 300) {
      const dados = f.mapear(r.corpo, cnpj);
      if (!dados.razaoSocial) continue; // corpo sem o mínimo: trata como fonte fora, não como achado
      return { tipo: "ok", fonte: f.nome, dados };
    }
    // 4xx diferente de 404/429 (ex.: 400 da fonte) e 5xx: fonte não serviu, tenta a próxima
  }
  return naoEncontrado === fontes.length ? { tipo: "inexistente" } : { tipo: "indisponivel" };
}
