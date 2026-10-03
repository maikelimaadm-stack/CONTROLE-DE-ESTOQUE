import { D, DomainError, money } from "@agro/shared";

/**
 * Situação do título na Central Financeira (decisão 285). "A vencer" e "vencido" são CALCULADOS pela data (o banco
 * guarda só `open`). `previsto` é o título da PROVISÃO pela TOP (F9, decisão 286; `status = 'previsto'`, 0045): fora
 * das baixas e das listas padrão, só nasce quando uma TOP no formato 5 liga a provisão (`financeiro-provisao.ts`).
 */
export const SITUACOES_TITULO = ["a_vencer", "vencido", "parcial", "baixado", "previsto", "cancelado"] as const;
export type SituacaoTitulo = (typeof SITUACOES_TITULO)[number];

/**
 * As situações da LISTA PADRÃO da Central (sem filtro de situação): tudo menos o cancelado e o previsto — o previsto é
 * promessa de caixa, não lançamento, e aparece só pedido (o cartão "Previstos" ou a situação "Previsto").
 */
export const SITUACOES_TITULO_DA_LISTA: readonly SituacaoTitulo[] = Object.freeze(
  SITUACOES_TITULO.filter((s) => s !== "cancelado" && s !== "previsto"),
);

/** Situação exibida a partir do `status` gravado e do vencimento. Status desconhecido é erro, nunca "a vencer". */
export function situacaoDoTitulo(t: { status: string; dueDate: string }, hoje: string): SituacaoTitulo {
  switch (t.status) {
    case "cancelled": return "cancelado";
    case "paid": return "baixado";
    case "partially_paid": return "parcial";
    case "previsto": return "previsto";
    case "open": return t.dueDate.slice(0, 10) < hoje.slice(0, 10) ? "vencido" : "a_vencer";
    default: throw new DomainError("VALIDATION_ERROR", "Situação de título desconhecida", { status: t.status });
  }
}

/** Cartões do topo da lista de títulos (também filtram). `previstos` conta os títulos previstos da provisão (F9). */
export const CARTOES_TITULO = ["vencidos", "vence_hoje", "a_vencer", "pagos_no_periodo", "previstos"] as const;
export type CartaoTitulo = (typeof CARTOES_TITULO)[number];

/** Grupo da origem do título (`financial_titles.source_type`), usado no filtro "origem" e no rótulo. */
export type GrupoOrigem = "avulso" | "venda" | "compra" | "nota" | "folha" | "movimento" | "pecuaria" | "transferencia" | "credito" | "outros";

/**
 * `source_type` gravado por grupo. `avulso` também abrange o `source_type` NULO: a duplicação de título grava nulo
 * (o título duplicado é do usuário, não de um documento). Um `source_type` fora desta lista é `outros`.
 */
export const ORIGENS_DO_TITULO: Readonly<Record<Exclude<GrupoOrigem, "outros">, readonly string[]>> = {
  avulso: ["manual"],
  venda: ["sales_documents"],
  compra: ["documentos_compra", "purchase_requests"],
  nota: ["invoices", "dfe_documents"],
  folha: ["earnings", "salary_advances"],
  movimento: ["bank_movements"],
  pecuaria: ["animal_movements"],
  transferencia: ["warehouse_transfers"],
  credito: ["title_settlements"]
};

export function grupoDaOrigem(sourceType: string | null | undefined): GrupoOrigem {
  if (sourceType === null || sourceType === undefined) return "avulso";
  for (const [grupo, tipos] of Object.entries(ORIGENS_DO_TITULO) as [Exclude<GrupoOrigem, "outros">, readonly string[]][]) {
    if (tipos.includes(sourceType)) return grupo;
  }
  return "outros";
}

/** Título gerado por outro documento: valor, parceiro e rateio só mudam pela origem. Nulo e `manual` são avulsos. */
export function tituloDeDocumento(sourceType: string | null | undefined): boolean {
  return sourceType !== null && sourceType !== undefined && sourceType !== "manual";
}

/** Campos que, num título de documento, só a origem altera (o vencimento, a conta prevista e a observação ficam livres). */
export const CAMPOS_TRAVADOS_PELA_ORIGEM = ["empresa_id", "number", "person_id", "amount", "discount", "emission_date", "apportionment"] as const;
type CampoTravado = (typeof CAMPOS_TRAVADOS_PELA_ORIGEM)[number];

export interface TituloComparavel {
  empresa_id: string;
  number: string;
  person_id: string | null;
  amount: string;
  discount: string;
  emission_date: string;
  apportionment: { financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; area_id: string | null; percentage: string; amount: string }[];
}

const vazio = (v: unknown): boolean => v === null || v === undefined || v === "";
const idNormal = (v: unknown): string => (vazio(v) ? "" : String(v).trim().toLowerCase());
const dataNormal = (v: unknown): string => (vazio(v) ? "" : String(v).slice(0, 10));

/** Dinheiro igual pelo VALOR ("100" = "100.00"). Texto que não é número nunca é igual (conta como alteração). */
function mesmoValor(a: unknown, b: unknown): boolean {
  if (vazio(a) || vazio(b)) return vazio(a) && vazio(b);
  try {
    return D(String(a)).eq(D(String(b)));
  } catch {
    return false;
  }
}

/** Chave canônica de uma linha do rateio: ids em minúsculas e o número (percentual ou valor) em forma fixa. */
function chaveDaLinha(l: Record<string, unknown>, porValor: boolean): string | null {
  const numero = porValor ? l["amount"] : l["percentage"];
  if (vazio(numero)) return null;
  let fixo: string;
  try {
    fixo = porValor ? money(String(numero)) : D(String(numero)).toFixed(4);
  } catch {
    return null;
  }
  return [l["financial_category_id"], l["cost_center_id"], l["chart_account_id"], l["harvest_id"], l["area_id"]].map(idNormal).join("|") + "|" + fixo;
}

/**
 * Rateio igual como MULTICONJUNTO (a ordem das linhas não importa; linhas repetidas contam). O pedido decide a
 * medida, como `normalizeApportionment`: todas as linhas com valor → compara valores; senão → percentuais.
 */
function mesmoRateio(atual: TituloComparavel["apportionment"], pedido: unknown): boolean {
  if (!Array.isArray(pedido)) return false;
  if (pedido.some((l) => typeof l !== "object" || l === null || Array.isArray(l))) return false;
  const linhas = pedido as Record<string, unknown>[];
  const porValor = linhas.length > 0 && linhas.every((l) => !vazio(l["amount"]));
  const chavesPedido = linhas.map((l) => chaveDaLinha(l, porValor));
  if (chavesPedido.some((c) => c === null)) return false;
  const chavesAtual = atual.map((l) => chaveDaLinha(l, porValor));
  if (chavesAtual.some((c) => c === null) || chavesAtual.length !== chavesPedido.length) return false;
  const a = (chavesAtual as string[]).slice().sort();
  const p = (chavesPedido as string[]).slice().sort();
  return a.every((c, i) => c === p[i]);
}

function mesmoCampo(campo: CampoTravado, atual: TituloComparavel, valor: unknown): boolean {
  switch (campo) {
    case "empresa_id": return idNormal(atual.empresa_id) === idNormal(valor);
    case "person_id": return idNormal(atual.person_id) === idNormal(valor);
    case "number": return String(atual.number ?? "").trim() === (vazio(valor) ? "" : String(valor).trim());
    case "amount": return mesmoValor(atual.amount, valor);
    // Desconto ausente na gravação vale zero (o esquema do título tem `discount` padrão "0").
    case "discount": return mesmoValor(vazio(atual.discount) ? "0" : atual.discount, vazio(valor) ? "0" : valor);
    case "emission_date": return dataNormal(atual.emission_date) === dataNormal(valor);
    case "apportionment": return mesmoRateio(atual.apportionment, valor);
  }
}

/**
 * Campos travados que o pedido ALTERA: presentes no corpo e diferentes do gravado depois da normalização (ids em
 * minúsculas, datas pelos 10 primeiros caracteres, dinheiro pelo valor, rateio como multiconjunto). A web anterior
 * manda o corpo INTEIRO com os mesmos valores em outra forma ("100" × "100.00"): isso não é alteração.
 */
export function alteracoesTravadasPelaOrigem(atual: TituloComparavel, pedido: Record<string, unknown>): string[] {
  const alterados: string[] = [];
  for (const campo of CAMPOS_TRAVADOS_PELA_ORIGEM) {
    if (!Object.prototype.hasOwnProperty.call(pedido, campo) || pedido[campo] === undefined) continue;
    if (!mesmoCampo(campo, atual, pedido[campo])) alterados.push(campo);
  }
  return alterados;
}
