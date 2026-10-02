import { z } from "zod";
import { isISODate, money } from "@agro/shared";
import {
  CARTOES_TITULO, SITUACOES_TITULO, ORIGENS_DO_TITULO, grupoDaOrigem, rotuloFinanceiro, situacaoDoTitulo, tituloDeDocumento,
  type CartaoTitulo, type GrupoOrigem, type SituacaoTitulo
} from "@agro/domain";
import { empresaScope, type ServiceCtx } from "./context.js";
import { validation } from "./errors.js";
import { EH_ADIANTAMENTO_SQL } from "./financeiro-estorno.js";
import { paginaComIdGlobal } from "./id-global.js";

/**
 * A CONSULTA DE TÍTULOS DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — `GET /financeiro/titulos` e a
 * exportação usam o MESMO recorte. Tudo no servidor: filtros, cartões, totais, ordenação (whitelist) e paginação;
 * o escopo de empresa entra no WHERE antes do LIMIT; a página é enriquecida numa consulta com `= any($ids)`.
 * "Hoje" é o `current_date` do banco (a mesma régua do vencido/a vencer em toda consulta).
 */
export type Direcao = "payable" | "receivable";
export const DIRECOES: readonly Direcao[] = ["payable", "receivable"];

export const GRUPOS_DE_ORIGEM = ["avulso", "venda", "compra", "nota", "folha", "movimento", "pecuaria", "transferencia", "credito", "outros"] as const satisfies readonly GrupoOrigem[];
const lista = <T extends readonly [string, ...string[]]>(valores: T, max = 20) =>
  z.string().transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(valores)).min(1).max(max));
const dataISO = z.string().refine(isISODate, "Data inválida");
const decimal = z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "Valor inválido");
const uuid = z.string().uuid();

export const consultaDeTitulosSchema = z.object({
  direcao: z.enum(["receivable", "payable", "todos"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["vencimento", "emissao", "valor", "saldo", "numero", "codigo", "parceiro"]).default("vencimento"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  cartao: z.enum(CARTOES_TITULO).optional(),
  situacao: lista(SITUACOES_TITULO).optional(),
  periodo_campo: z.enum(["vencimento", "emissao", "competencia", "baixa"]).optional(),
  periodo_de: dataISO.optional(),
  periodo_ate: dataISO.optional(),
  pessoa_id: uuid.optional(),
  natureza_id: uuid.optional(),
  centro_id: uuid.optional(),
  safra_id: uuid.optional(),
  area_id: uuid.optional(),
  conta_id: uuid.optional(),
  empresa_id: uuid.optional(),
  tipo_titulo_id: uuid.optional(),
  origem: lista(GRUPOS_DE_ORIGEM).optional(),
  tipo_operacao_id: uuid.optional(),
  busca: z.string().trim().min(1).max(100).optional(),
  valor_de: decimal.optional(),
  valor_ate: decimal.optional(),
  adiantamento: z.enum(["0", "1"]).optional(),
  ids: z.string().transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(uuid).min(1).max(200)).optional()
}).strict();
export type ConsultaDeTitulos = z.infer<typeof consultaDeTitulosSchema>;
export const exportacaoDeTitulosSchema = consultaDeTitulosSchema.extend({ formato: z.enum(["csv", "xlsx"]) }).strict();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const ORDEM: Readonly<Record<ConsultaDeTitulos["sort"], string>> = {
  // "valor" é o LÍQUIDO (o que a coluna Valor mostra e a exportação leva), não o bruto `amount`.
  vencimento: "t.due_date", emissao: "t.emission_date", valor: "t.net_amount", saldo: "t.balance", numero: "t.number", codigo: "t.code", parceiro: "p.name"
};
const PREDICADO_DA_SITUACAO: Readonly<Record<SituacaoTitulo, string>> = {
  a_vencer: "(t.status='open' and t.due_date >= current_date)",
  vencido: "(t.status='open' and t.due_date < current_date)",
  parcial: "t.status='partially_paid'",
  baixado: "t.status='paid'",
  // A provisão (F9) ainda não existe: nenhum título está "previsto" (o CHECK do banco nem admite o valor).
  previsto: "t.status='previsto'",
  cancelado: "t.status='cancelled'"
};
const ABERTO = "t.status in ('open','partially_paid')";

/** O que a consulta monta: FROM, WHERE da base (cartões), WHERE da lista (base + cartão + situação) e o período "pagos". */
export interface ConsultaMontada {
  from: string;
  /** Base: tudo menos cartão e situação — é o recorte dos CARTÕES. */
  where: string[];
  /** Cartão e situação: somados à base, são o recorte da LISTA e dos TOTAIS. */
  filtroDaLista: string[];
  /** Predicado (com placeholders) de "baixa confirmada no período" — o cartão pagos_no_periodo. */
  baixaNoPeriodo: string;
  params: unknown[];
}

export const FROM_TITULOS = "erp.financial_titles t left join erp.people p on p.id=t.person_id";

/**
 * Monta o recorte. `dirs` são as direções que a porta já autorizou (nunca vem do cliente sozinha): entra no WHERE
 * como `t.direction = any(...)`, então a direção sem capacidade simplesmente não existe para a consulta.
 * A empresa da query é PEDIDO; a autorização (`empresaScope`, módulo financeiro) entra por cima, sempre.
 */
export function montarConsultaDeTitulos(ctx: ServiceCtx, q: ConsultaDeTitulos, dirs: readonly Direcao[]): ConsultaMontada {
  const params: unknown[] = [ctx.orgId, [...dirs]];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["t.organization_id=$1", "t.deleted_at is null", "t.direction = any($2::text[])"];
  if (q.empresa_id) where.push(`t.empresa_id=${add(q.empresa_id)}`); else if (ctx.empresaId) where.push(`t.empresa_id=${add(ctx.empresaId)}`);
  where.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
  if (q.pessoa_id) where.push(`t.person_id=${add(q.pessoa_id)}`);
  if (q.tipo_titulo_id) where.push(`t.title_type_id=${add(q.tipo_titulo_id)}`);
  // Natureza e centro incluem os DESCENDENTES pela árvore (`union`, não `union all`: um ciclo no cadastro para).
  if (q.natureza_id) where.push(`exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.financial_category_id in (with recursive arv(id) as (select id from erp.financial_categories where id=${add(q.natureza_id)} and organization_id=$1 union select c.id from erp.financial_categories c join arv on c.parent_id=arv.id where c.organization_id=$1) select id from arv))`);
  if (q.centro_id) where.push(`exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.cost_center_id in (with recursive arv(id) as (select id from erp.cost_centers where id=${add(q.centro_id)} and organization_id=$1 union select c.id from erp.cost_centers c join arv on c.parent_id=arv.id where c.organization_id=$1) select id from arv))`);
  if (q.safra_id) { const s = add(q.safra_id); where.push(`(t.harvest_id=${s} or exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.harvest_id=${s}))`); }
  if (q.area_id) where.push(`exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.area_id=${add(q.area_id)})`);
  if (q.conta_id) { const c = add(q.conta_id); where.push(`(t.conta_prevista_id=${c} or exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.status='confirmed' and s.bank_account_id=${c}))`); }
  if (q.origem) {
    const conhecidos = Object.values(ORIGENS_DO_TITULO).flat();
    const partes = q.origem.map((g) => {
      if (g === "avulso") return `(t.source_type is null or t.source_type = any(${add([...ORIGENS_DO_TITULO.avulso])}::text[]))`;
      if (g === "outros") return `(t.source_type is not null and not (t.source_type = any(${add(conhecidos)}::text[])))`;
      return `t.source_type = any(${add([...ORIGENS_DO_TITULO[g]])}::text[])`;
    });
    where.push(`(${partes.join(" or ")})`);
  }
  if (q.tipo_operacao_id) {
    const top = add(q.tipo_operacao_id);
    where.push(`((t.source_type='sales_documents' and exists (select 1 from erp.sales_documents sd where sd.id=t.source_id and sd.organization_id=$1 and sd.tipo_operacao_id=${top}))`
      + ` or (t.source_type='documentos_compra' and exists (select 1 from erp.documentos_compra dc where dc.id=t.source_id and dc.organization_id=$1 and dc.tipo_operacao_id=${top})))`);
  }
  if (q.busca) { const b = add(`%${escapeLike(q.busca)}%`); where.push(`(t.number ilike ${b} or t.code ilike ${b} or t.note ilike ${b} or p.name ilike ${b})`); }
  if (q.valor_de) where.push(`(t.amount - t.discount) >= ${add(q.valor_de)}::numeric`);
  if (q.valor_ate) where.push(`(t.amount - t.discount) <= ${add(q.valor_ate)}::numeric`);
  if (q.adiantamento === "1") where.push(EH_ADIANTAMENTO_SQL("t"));
  if (q.adiantamento === "0") where.push(`not ${EH_ADIANTAMENTO_SQL("t")}`);
  if (q.ids) where.push(`t.id = any(${add(q.ids.map((x) => x.toLowerCase()))}::uuid[])`);

  // Período: de/até sem o campo valem pelo VENCIMENTO; de > até é recusado.
  if (q.periodo_de && q.periodo_ate && q.periodo_de > q.periodo_ate) throw validation("Período inválido: a data inicial é maior que a final");
  const campo = q.periodo_campo ?? (q.periodo_de || q.periodo_ate ? "vencimento" : undefined);
  const de = q.periodo_de ? `${add(q.periodo_de)}::date` : null;
  const ate = q.periodo_ate ? `${add(q.periodo_ate)}::date` : null;
  const entre = (col: string) => [de ? `${col} >= ${de}` : null, ate ? `${col} <= ${ate}` : null].filter((x): x is string => x !== null);
  // "Baixados no período": o período pedido quando o campo é a baixa; senão o mês corrente (do banco).
  const baixaNoPeriodo = campo === "baixa"
    ? ["s.status='confirmed'", ...entre("s.settlement_date")].join(" and ")
    : "s.status='confirmed' and s.settlement_date between date_trunc('month', current_date)::date and (date_trunc('month', current_date) + interval '1 month - 1 day')::date";
  if (campo === "vencimento") where.push(...entre("t.due_date"));
  if (campo === "emissao") where.push(...entre("t.emission_date"));
  if (campo === "competencia") where.push(...entre("coalesce(t.data_competencia, t.emission_date)"));
  if (campo === "baixa" && (de || ate)) where.push(`exists (select 1 from erp.title_settlements s where s.title_id=t.id and ${baixaNoPeriodo})`);

  const filtroDaLista: string[] = [];
  if (q.cartao) filtroDaLista.push(predicadoDoCartao(q.cartao, baixaNoPeriodo));
  const situacoes: readonly SituacaoTitulo[] = q.situacao ?? SITUACOES_TITULO.filter((s) => s !== "cancelado");
  filtroDaLista.push(`(${situacoes.map((s) => PREDICADO_DA_SITUACAO[s]).join(" or ")})`);
  return { from: FROM_TITULOS, where, filtroDaLista, baixaNoPeriodo, params };
}

/** Os cartões são CONTAGEM e SOMA do saldo dos títulos abertos por vencimento (< hoje, = hoje, > hoje) — e filtram. */
export function predicadoDoCartao(cartao: CartaoTitulo, baixaNoPeriodo: string): string {
  switch (cartao) {
    case "vencidos": return `(${ABERTO} and t.due_date < current_date)`;
    case "vence_hoje": return `(${ABERTO} and t.due_date = current_date)`;
    case "a_vencer": return `(${ABERTO} and t.due_date > current_date)`;
    case "pagos_no_periodo": return `exists (select 1 from erp.title_settlements s where s.title_id=t.id and ${baixaNoPeriodo})`;
    case "previstos": return "t.status='previsto'";
  }
}

interface Agregado {
  n: string; hoje: string; mes_de: string; mes_ate: string;
  p_valor: string; p_pago: string; p_saldo: string; r_valor: string; r_pago: string; r_saldo: string;
  vencidos_n: string; vencidos_v: string; vence_hoje_n: string; vence_hoje_v: string; a_vencer_n: string; a_vencer_v: string; pagos_n: string; pagos_v: string;
}
interface LinhaDaPagina {
  id: string; direction: Direcao; code: string; number: string; empresa_id: string; empresa_nome: string; person_id: string | null; pessoa_nome: string | null;
  emission_date: string; data_competencia: string | null; due_date: string; installment_number: number; installment_count: number;
  amount: string; discount: string; net_amount: string; paid_amount: string; balance: string; status: string; source_type: string | null; source_id: string | null;
  eh_adiantamento: boolean; conta_prevista_id: string | null; tipo_titulo_nome: string | null; version: number; note: string;
}

/** Lista da Central: UMA consulta de contagem + totais + cartões, UMA da página, UMA de enriquecimento (+ o ID Global). */
export async function listarTitulosDaCentral(ctx: ServiceCtx, q: ConsultaDeTitulos, dirs: readonly Direcao[]) {
  const m = montarConsultaDeTitulos(ctx, q, dirs);
  const base = m.where.join(" and ");
  const lista = [...m.where, ...m.filtroDaLista].join(" and ");
  const L = m.filtroDaLista.join(" and ");
  const cartao = (c: CartaoTitulo) => predicadoDoCartao(c, m.baixaNoPeriodo);
  const agg = await ctx.tx.query<Agregado>(
    `select count(*) filter (where ${L})::text as n, current_date::text as hoje,`
    + ` to_char(date_trunc('month', current_date),'YYYY-MM-DD') as mes_de, to_char(date_trunc('month', current_date) + interval '1 month - 1 day','YYYY-MM-DD') as mes_ate,`
    + ` coalesce(sum(t.amount - t.discount) filter (where ${L} and t.direction='payable'),0)::text as p_valor, coalesce(sum(t.paid_amount) filter (where ${L} and t.direction='payable'),0)::text as p_pago, coalesce(sum(t.balance) filter (where ${L} and t.direction='payable'),0)::text as p_saldo,`
    + ` coalesce(sum(t.amount - t.discount) filter (where ${L} and t.direction='receivable'),0)::text as r_valor, coalesce(sum(t.paid_amount) filter (where ${L} and t.direction='receivable'),0)::text as r_pago, coalesce(sum(t.balance) filter (where ${L} and t.direction='receivable'),0)::text as r_saldo,`
    + ` count(*) filter (where ${cartao("vencidos")})::text as vencidos_n, coalesce(sum(t.balance) filter (where ${cartao("vencidos")}),0)::text as vencidos_v,`
    + ` count(*) filter (where ${cartao("vence_hoje")})::text as vence_hoje_n, coalesce(sum(t.balance) filter (where ${cartao("vence_hoje")}),0)::text as vence_hoje_v,`
    + ` count(*) filter (where ${cartao("a_vencer")})::text as a_vencer_n, coalesce(sum(t.balance) filter (where ${cartao("a_vencer")}),0)::text as a_vencer_v,`
    + ` count(*) filter (where ${cartao("pagos_no_periodo")})::text as pagos_n, coalesce(sum((select sum(s.amount) from erp.title_settlements s where s.title_id=t.id and ${m.baixaNoPeriodo})) filter (where ${cartao("pagos_no_periodo")}),0)::text as pagos_v`
    + ` from ${m.from} where ${base}`, m.params);
  const a = agg.rows[0]!;
  const offset = (q.page - 1) * q.pageSize;
  const pagina = await ctx.tx.query<LinhaDaPagina>(
    `select t.id::text as id, t.direction, t.code, t.number, t.empresa_id::text as empresa_id, e.name as empresa_nome, t.person_id::text as person_id, p.name as pessoa_nome,`
    + ` t.emission_date, t.data_competencia, t.due_date, t.installment_number, t.installment_count, t.amount::text as amount, t.discount::text as discount, t.net_amount::text as net_amount,`
    + ` t.paid_amount::text as paid_amount, t.balance::text as balance, t.status, t.source_type, t.source_id::text as source_id, ${EH_ADIANTAMENTO_SQL("t")} as eh_adiantamento,`
    + ` t.conta_prevista_id::text as conta_prevista_id, tt.name as tipo_titulo_nome, t.version, t.note`
    + ` from ${m.from} join erp.empresas e on e.id=t.empresa_id left join erp.title_types tt on tt.id=t.title_type_id`
    + ` where ${lista} order by ${ORDEM[q.sort]} ${q.dir === "desc" ? "desc" : "asc"} nulls last, t.code, t.id limit ${q.pageSize} offset ${offset}`, m.params);
  const ids = pagina.rows.map((r) => r.id);
  const extra = ids.length
    ? (await ctx.tx.query<{ id: string; ultima_baixa: string | null; anexos: number; conta_prevista_descricao: string | null }>(
      "select t.id::text as id, (select max(s.settlement_date) from erp.title_settlements s where s.title_id=t.id and s.status='confirmed')::text as ultima_baixa,"
      + " (select count(*) from erp.attachments x where x.organization_id=t.organization_id and x.entity='financial_titles' and x.entity_id=t.id)::int as anexos, cp.description as conta_prevista_descricao"
      + " from erp.financial_titles t left join erp.bank_accounts cp on cp.id=t.conta_prevista_id where t.id = any($1::uuid[]) and t.organization_id=$2", [ids, ctx.orgId])).rows
    : [];
  const porId = new Map(extra.map((x) => [x.id, x]));
  const items = pagina.rows.map((r) => linhaDoTitulo(r, a.hoje, porId.get(r.id)));
  const totais: { payable?: { valor: string; pago: string; saldo: string }; receivable?: { valor: string; pago: string; saldo: string } } = {};
  // `coalesce(sum(…),0)` sem linhas sai "0" (escala do literal): o dinheiro da resposta é sempre "0.00".
  if (dirs.includes("payable")) totais.payable = { valor: money(a.p_valor), pago: money(a.p_pago), saldo: money(a.p_saldo) };
  if (dirs.includes("receivable")) totais.receivable = { valor: money(a.r_valor), pago: money(a.r_pago), saldo: money(a.r_saldo) };
  const baixa = (q.periodo_campo ?? null) === "baixa";
  const cartoes = {
    vencidos: { quantidade: Number(a.vencidos_n), valor: money(a.vencidos_v) },
    vence_hoje: { quantidade: Number(a.vence_hoje_n), valor: money(a.vence_hoje_v) },
    a_vencer: { quantidade: Number(a.a_vencer_n), valor: money(a.a_vencer_v) },
    pagos_no_periodo: { quantidade: Number(a.pagos_n), valor: money(a.pagos_v), de: baixa ? (q.periodo_de ?? null) : a.mes_de, ate: baixa ? (q.periodo_ate ?? null) : a.mes_ate },
    // Provisão pela TOP (F9): o cartão existe e é declarado indisponível — nunca um zero que finge ter conferido.
    previstos: { quantidade: 0, valor: "0.00", disponivel: false }
  };
  return paginaComIdGlobal(ctx, "financial_titles", { items, total: Number(a.n), page: q.page, pageSize: q.pageSize, direcoes: [...dirs], totais, cartoes });
}

/** A linha da Central. Dinheiro em texto decimal; situação calculada no domínio com o "hoje" do banco. */
export function linhaDoTitulo(r: LinhaDaPagina, hoje: string, extra?: { ultima_baixa: string | null; anexos: number; conta_prevista_descricao: string | null }) {
  const situacao = situacaoDoTitulo({ status: r.status, dueDate: r.due_date }, hoje);
  return {
    id: r.id, direcao: r.direction, codigo: r.code, numero: r.number, empresa_id: r.empresa_id, empresa_nome: r.empresa_nome,
    pessoa_id: r.person_id, pessoa_nome: r.pessoa_nome, emissao: r.emission_date, competencia: r.data_competencia ?? r.emission_date, vencimento: r.due_date,
    parcela: { numero: r.installment_number, total: r.installment_count },
    valor: r.amount, desconto: r.discount, liquido: r.net_amount, pago: r.paid_amount, saldo: r.balance,
    status: r.status, situacao, situacao_rotulo: rotuloFinanceiro("situacao_titulo", situacao),
    origem: { tipo: r.source_type, id: r.source_id, grupo: grupoDaOrigem(r.source_type) },
    bloqueado_pela_origem: tituloDeDocumento(r.source_type), eh_adiantamento: r.eh_adiantamento,
    conta_prevista: r.conta_prevista_id ? { id: r.conta_prevista_id, descricao: extra?.conta_prevista_descricao ?? null } : null,
    tipo_titulo_nome: r.tipo_titulo_nome, ultima_baixa: extra?.ultima_baixa ?? null, anexos: extra?.anexos ?? 0, version: r.version, observacao: r.note
  };
}

export const LIMITE_DA_EXPORTACAO = 10_000;
export const COLUNAS_DA_EXPORTACAO = ["Código", "Nº do documento", "Direção", "Empresa", "Parceiro", "Emissão", "Competência", "Vencimento", "Parcela", "Valor", "Pago", "Saldo", "Situação", "Origem", "Conta prevista", "Observação"] as const;

/**
 * Linhas da exportação: o MESMO recorte da lista (base + cartão + situação), na ordem pedida, até 10.000 (mais →
 * 422 — a exportação não corta em silêncio). Dinheiro vai como TEXTO decimal (o valor é o líquido, para
 * Valor − Pago = Saldo), nunca convertido para número.
 */
export async function linhasDaExportacao(ctx: ServiceCtx, q: ConsultaDeTitulos, dirs: readonly Direcao[]): Promise<string[][]> {
  const m = montarConsultaDeTitulos(ctx, q, dirs);
  const lista = [...m.where, ...m.filtroDaLista].join(" and ");
  const n = await ctx.tx.query<{ n: string; hoje: string }>(`select count(*)::text as n, current_date::text as hoje from ${m.from} where ${lista}`, m.params);
  if (Number(n.rows[0]!.n) > LIMITE_DA_EXPORTACAO) throw validation("Filtre mais: a exportação aceita até 10.000 títulos");
  const r = await ctx.tx.query<{ code: string; number: string; direction: Direcao; empresa: string; pessoa: string | null; emission_date: string; competencia: string; due_date: string; installment_number: number; installment_count: number; liquido: string; pago: string; saldo: string; status: string; source_type: string | null; conta: string | null; note: string }>(
    "select t.code, t.number, t.direction, e.name as empresa, p.name as pessoa, t.emission_date, coalesce(t.data_competencia, t.emission_date)::text as competencia, t.due_date,"
    + " t.installment_number, t.installment_count, t.net_amount::text as liquido, t.paid_amount::text as pago, t.balance::text as saldo, t.status, t.source_type, cp.description as conta, t.note"
    + ` from ${m.from} join erp.empresas e on e.id=t.empresa_id left join erp.bank_accounts cp on cp.id=t.conta_prevista_id where ${lista} order by ${ORDEM[q.sort]} ${q.dir === "desc" ? "desc" : "asc"} nulls last, t.code, t.id limit ${LIMITE_DA_EXPORTACAO}`,
    m.params);
  const hoje = n.rows[0]!.hoje;
  return r.rows.map((x) => [
    x.code, x.number, x.direction === "payable" ? "A pagar" : "A receber", x.empresa, x.pessoa ?? "", x.emission_date, x.competencia, x.due_date,
    `${x.installment_number}/${x.installment_count}`, x.liquido, x.pago, x.saldo,
    rotuloFinanceiro("situacao_titulo", situacaoDoTitulo({ status: x.status, dueDate: x.due_date }, hoje)), rotuloFinanceiro("origem_titulo", grupoDaOrigem(x.source_type)), x.conta ?? "", x.note
  ]);
}

/**
 * Texto que uma planilha leria como FÓRMULA (começa com `=`, `+`, `-`, `@`, tabulação ou retorno) ganha um apóstrofo
 * na frente: observação, nome do parceiro e número do documento são digitados por usuário e não podem virar
 * `=HYPERLINK(…)` ao abrir o CSV. Dinheiro e datas não são tocados (um decimal com sinal continua número).
 */
export function semFormula(v: string): string {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** CSV com `;`, BOM e aspas quando o campo tem `;`, aspas ou quebra de linha; nenhum campo vira fórmula. */
export function csvDaExportacao(linhas: readonly (readonly string[])[]): string {
  const campo = (bruto: string) => { const v = semFormula(bruto); return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return "﻿" + [COLUNAS_DA_EXPORTACAO, ...linhas].map((l) => l.map(campo).join(";")).join("\r\n");
}
