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

/**
 * PARTES DE UM ITEM DE REFERÊNCIA (CADASTROS AJUSTES 02, 2.1): cada parte é um CAMPO na tela — o nome na busca, o
 * código (e a UF do município) em caixas próprias, só leitura. Tudo sai de `nome`/`extra`/`codigo` do item da API,
 * nunca recortando o `rotulo`: o nome NUNCA contém o código. Item sem `nome` (resposta sem o campo) → `nome` null,
 * e a tela mostra "carregando…"/aviso — nunca o código no lugar do nome.
 *   municípios → { nome: "Pontes e Lacerda", codigo: "5106752", extra: "MT" }
 *   bancos     → { nome: "Banco do Brasil S.A.", codigo: "001", extra: null }
 *   ncm        → { nome: "<descrição>", codigo: "0102.21.10", extra: null }
 *   cbo        → { nome: "Trabalhador agropecuário em geral", codigo: "621005", extra: null }
 */
export interface PartesDaReferencia { nome: string | null; codigo: string; extra: string | null }
export function partesDaReferencia(chave: ChaveReferencia, item: { codigo: string | number; nome?: string | null; extra?: string | null }): PartesDaReferencia {
  const bruto = String(item.codigo ?? "").trim();
  const codigo = chave === "bancos" && /^\d{1,3}$/.test(bruto) ? bruto.padStart(3, "0") : chave === "ncm" ? formatarNcm(bruto) : bruto;
  const nome = typeof item.nome === "string" && item.nome.trim() !== "" ? item.nome.trim() : null;
  const extra = chave === "municipios" && typeof item.extra === "string" && item.extra.trim() !== "" ? item.extra.trim() : null;
  return { nome, codigo, extra };
}

/** Rótulos das partes de cada referência (2.1). A busca é a única parte editável. */
export const ROTULOS_DAS_PARTES: Record<ChaveReferencia, { busca: string; codigo: string; extra?: string }> = {
  municipios: { busca: "Cidade", codigo: "Código IBGE", extra: "UF" },
  cbo: { busca: "Ocupação (CBO)", codigo: "Código CBO" },
  bancos: { busca: "Banco", codigo: "Código do banco" },
  ncm: { busca: "Descrição do NCM", codigo: "NCM" }
};

/** Nome de exibição de um município ("Pontes e Lacerda - MT"), pelas partes. */
export function nomeDoMunicipio(p: PartesDaReferencia): string | null { return p.nome === null ? null : p.extra ? `${p.nome} - ${p.extra}` : p.nome; }
