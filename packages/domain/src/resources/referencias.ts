/**
 * BUSCAS DE REFERÊNCIA OFICIAL (CADASTROS Fase 3) — parte do Resource Registry.
 *
 * Tabelas GLOBAIS, só leitura, carregadas pela migration 0026 a partir das fontes oficiais (IBGE, BCB,
 * Siscomex, MTE). Diferem dos cadastros do `REGISTRY_RESOURCES`: não têm organização, não têm uuid e o
 * valor gravado no cadastro que as usa é o CÓDIGO oficial (município = código IBGE inteiro; banco = COMPE;
 * NCM = 8 dígitos). É por isso que um campo as usa por `FieldDef.busca`, e não por `type: "ref"`.
 *
 * Esta lista é a WHITELIST estática da API (`GET /api/referencias/:chave`): tabela e colunas saem daqui,
 * nunca da requisição.
 */

export type ChaveReferencia = "municipios" | "bancos" | "ncm" | "cbo";

export interface ReferenciaDeBusca {
  chave: ChaveReferencia;
  label: string;
  labelPlural: string;
  /** tabela no schema erp */
  tabela: string;
  /** coluna do código gravado no cadastro que usa a busca */
  colunaCodigo: string;
  /** coluna do nome/descrição */
  colunaNome: string;
  /** coluna extra que entra no rótulo (UF do município) */
  colunaExtra?: string;
  /** o código é inteiro (município) ou texto */
  codigoInteiro: boolean;
  /** formato aceito do código (normalizado: só dígitos) */
  padraoCodigo: string;
  /**
   * Condição fixa do que é ESCOLHÍVEL (só NCM de 8 dígitos vigente). Texto estático desta lista —
   * nenhum trecho vem do cliente.
   */
  escolhivel?: string;
}

export const REFERENCIAS_DE_BUSCA: readonly ReferenciaDeBusca[] = [
  { chave: "municipios", label: "Município", labelPlural: "Municípios", tabela: "cities", colunaCodigo: "id", colunaNome: "name", colunaExtra: "state_code", codigoInteiro: true, padraoCodigo: "^[0-9]{7}$" },
  { chave: "bancos", label: "Banco", labelPlural: "Bancos", tabela: "banks", colunaCodigo: "code", colunaNome: "name", codigoInteiro: false, padraoCodigo: "^[0-9]{3}$" },
  { chave: "ncm", label: "NCM", labelPlural: "NCM", tabela: "ncm", colunaCodigo: "code", colunaNome: "descricao_completa", codigoInteiro: false, padraoCodigo: "^[0-9]{8}$", escolhivel: "nivel = 8 and vigencia_inicio <= current_date and vigencia_fim >= current_date" },
  { chave: "cbo", label: "Ocupação (CBO)", labelPlural: "Ocupações (CBO)", tabela: "cbo_ocupacoes", colunaCodigo: "codigo", colunaNome: "titulo", codigoInteiro: false, padraoCodigo: "^[0-9]{6}$" }
];

const porChave = new Map(REFERENCIAS_DE_BUSCA.map((r) => [r.chave, r]));
export function getReferencia(chave: string): ReferenciaDeBusca | undefined { return porChave.get(chave as ChaveReferencia); }

/** NCM de 8 dígitos no formato de exibição 0000.00.00. */
export function formatarNcm(codigo: string): string {
  const d = String(codigo ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
}

/**
 * Rótulo único de uma linha de referência (CADASTROS AJUSTES 01): código · nome.
 *   município "5106752 · Pontes e Lacerda - MT" · banco "001 · Banco do Brasil S.A."
 *   NCM "0102.21.10 - …" · CBO "622005 - …" (sem mudança).
 */
export function rotuloDaReferencia(chave: ChaveReferencia, linha: { codigo: string | number; nome: string; extra?: string | null }): string {
  switch (chave) {
    case "municipios": return `${linha.codigo} · ${linha.nome}${linha.extra ? ` - ${linha.extra}` : ""}`;
    case "bancos": return `${String(linha.codigo).padStart(3, "0")} · ${linha.nome}`;
    case "ncm": return `${formatarNcm(String(linha.codigo))} - ${linha.nome}`;
    default: return `${linha.codigo} - ${linha.nome}`;
  }
}

/** Busca sem acento e sem diferenciar maiúsculas ("sao paulo" acha "São Paulo"). Mesma tabela usada no SQL. */
export const ACENTOS_DE = "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
export const ACENTOS_PARA = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";
export function semAcento(s: string): string {
  let o = ""; for (const c of String(s)) { const i = ACENTOS_DE.indexOf(c); o += i >= 0 ? ACENTOS_PARA[i] : c; } return o.toLowerCase();
}
