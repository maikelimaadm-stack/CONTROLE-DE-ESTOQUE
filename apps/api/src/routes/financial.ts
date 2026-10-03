import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, sum, isISODate, todayISO, MAX_PAGE_SIZE } from "@agro/shared";
import {
  displayTitleStatus, settlementNet, assertSettlementWithinBalance, recurrenceDates, normalizeApportionment, enumLabel,
  conferirValoresDaBaixa, chaveDaNaturezaPadrao, alteracoesTravadasPelaOrigem, exigirRateioFechado, grupoDaOrigem, tituloDeDocumento,
  ratearPorProporcao, lerOfx, sugerirConciliacao, rotuloFinanceiro, camposTrocadosDosPadroes, mensagemDosPadroesTrocados,
  familiaOperacionalDeDocumentoVenda, familiaOperacionalDeDocumentoCompra, chaveI18nDaFamiliaOperacional,
  type TitleStatus, type TituloComparavel, type ComponenteBaixa, type CamposInformadosNoDocumento
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, idempotent, audit, assertPeriodOpen, nextCode, requirePermission } from "../lib/service.js";
import { notFound, validation, err } from "../lib/errors.js";
import { empresaScope, exigirEmpresaDeLancamento, exigirEmpresaVisivel, empresaPermitida, empresaScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { createTitles, createBankMovement, apportionmentSchema, installmentPlanSchema, exigirRateioAnalitico } from "../services/financial-core.js";
import { atribuirIdGlobal , paginaComIdGlobal } from "../lib/id-global.js";
import { estornarBaixa, EH_ADIANTAMENTO_SQL } from "../lib/financeiro-estorno.js";
import { resolverTopParaLancamento, type TopDoLancamento } from "../lib/documento-comercial.js";
import { familiaDaDirecao, FAMILIA_DO_MOVIMENTO, padroesDaTopParaExecucao } from "../lib/financeiro-top.js";
import { conferirImovelRural, resolverImovelDaBaixa, resolverImovelDoMovimento, MENSAGEM_IMOVEL_NA_COMPENSACAO, MENSAGEM_IMOVEL_NA_TRANSFERENCIA } from "../lib/imovel-rural.js";
import {
  lerNaturezasPadrao, conferirNaturezasPadrao, lancarComponentesDaBaixa, lancarTarifaDoLote, gerarCreditoDoExcedente, conferirReferenciasDoTitulo, periodoAbertoNoLote,
  MENSAGEM_TARIFA_SEM_NATUREZA, MENSAGEM_TITULO_SEM_RATEIO, MENSAGEM_LOTE_SEM_RATEIO, type NaturezasPadrao, type ComponenteSeparado, type LinhaDoRateioDoTitulo, type TituloDaBaixa
} from "../lib/financeiro-baixa.js";

/**
 * Valor decimal da API (número ou texto). Texto que não é número finito é RECUSADO aqui (422) — antes ele chegava
 * ao `decimal.js` e estourava como erro interno (500).
 */
const dec = z.union([z.number(), z.string()]).transform(String).refine((v) => { try { return D(v.trim()).isFinite(); } catch { return false; } }, "Valor inválido");
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const idem = (req: { headers: Record<string, unknown> }) => req.headers["idempotency-key"] as string | undefined;
const permOf = (dir: string, action: string) => `${dir === "payable" ? "payables" : "receivables"}.${action}`;
/** Adiantamento = `payment_type='advance'` OU tipo de título `is_advance` (decisão 285: o tipo de título passa a ser lido). */
const EH_ADIANTAMENTO = EH_ADIANTAMENTO_SQL("t");
/** Ids de lote: a web anterior manda a SELEÇÃO de uma página (até MAX_PAGE_SIZE); repetido é recusado (nada de dedupe calado). */
const idsDoLote = z.array(uuid).min(1).max(MAX_PAGE_SIZE).refine((ids) => new Set(ids.map((x) => x.toLowerCase())).size === ids.length, "Título repetido no lote");
const MOTIVO = z.string().trim().min(1).max(500);
const tr = criarTradutor(ptBR);

/**
 * O TÍTULO PREVISTO (OPERACOES-01 F9, decisão 286; `status = 'previsto'`, 0045) é a provisão de um documento pela TOP:
 * promessa de caixa, não lançamento. Ele fica fora das baixas (o banco recusa também: `erp.refresh_title_status`), não
 * se edita nem se duplica, e só sai da previsão CANCELADO pela origem (o documento faturado, encerrado ou cancelado). As
 * listas e os totais padrão o deixam de fora; ele aparece só pedido (`status=previsto`).
 */
const MENSAGEM_PREVISTO_SEM_BAIXA = "Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado.";
const MENSAGEM_PREVISTO_SEM_EDICAO = "Título previsto muda pelo documento de origem.";
const MENSAGEM_PREVISTO_SEM_DUPLICAR = "Título previsto não se duplica.";
/** A TOP do título é a do lançamento (snapshot): a edição não a troca (a família decide o que ela trouxe). */
const MENSAGEM_TOP_NAO_MUDA = "A operação do título não muda na edição.";
const mesmoId = (a: unknown, b: string | null) => (a === null || a === undefined ? null : String(a).toLowerCase()) === (b === null ? null : b.toLowerCase());

/**
 * O DOCUMENTO NÃO TROCA OS PADRÕES (F9): a TOP no formato 5 com `documentoTroca` desligado recusa o lançamento que
 * informa natureza, centro, tipo de título ou conta DIFERENTES dos padrões dela (vazio não é troca). Sem padrões ou
 * com a troca liberada, nada a conferir. A recusa nomeia os campos (`details[].path`).
 */
async function conferirTrocaDosPadroes(ctx: ServiceCtx, top: TopDoLancamento | null, doc: CamposInformadosNoDocumento): Promise<Awaited<ReturnType<typeof padroesDaTopParaExecucao>> | null> {
  if (!top) return null;
  const fin = await padroesDaTopParaExecucao(ctx, top.tipoOperacaoVersaoId);
  if (fin.padroes && !fin.secao.documentoTroca) {
    const campos = camposTrocadosDosPadroes(fin.padroes, doc);
    if (campos.length) { const m = mensagemDosPadroesTrocados(campos); throw validation(m, campos.map((c) => ({ path: [c], message: m }))); }
  }
  return fin;
}

/**
 * O NOME DA ORIGEM do título (F9): "Pedido de venda 0003", "Compra 12"… — o rótulo da família do documento (o mesmo
 * da TOP, `pt-BR`) e o código dele; avulso → "Avulso"; outra origem (ou documento que a RLS não mostra) → o rótulo do
 * `source_type`. Nunca o valor técnico cru. UMA consulta, estática por tipo (nenhum identificador vem da entrada).
 */
async function nomeDaOrigem(ctx: ServiceCtx, sourceType: string | null, sourceId: string | null): Promise<string> {
  if (!sourceType || sourceType === "manual") return "Avulso";
  if (sourceId && (sourceType === "sales_documents" || sourceType === "documentos_compra")) {
    const venda = sourceType === "sales_documents";
    const r = await ctx.tx.query<{ especie: string; codigo: string }>(venda
      ? "select kind as especie, code as codigo from erp.sales_documents where id=$1 and organization_id=$2"
      : "select especie, codigo from erp.documentos_compra where id=$1 and organization_id=$2", [sourceId, ctx.orgId]);
    const doc = r.rows[0];
    const familia = doc ? (venda ? familiaOperacionalDeDocumentoVenda(doc.especie) : familiaOperacionalDeDocumentoCompra(doc.especie)) : undefined;
    const chave = familia ? chaveI18nDaFamiliaOperacional(familia) : undefined;
    if (doc && chave) return `${tr(chave)} ${doc.codigo}`;
  }
  return enumLabel("source_type", sourceType);
}

const titleSchema = z.object({
  empresa_id: uuid, number: z.string().min(1).max(40), title_type_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), branch_id: uuid.optional().nullable(),
  payment_type: z.enum(["single", "installments", "recurring", "advance", "invoice_group"]).default("single"), recurrence_type: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional().nullable(), recurrence_count: z.number().int().min(1).max(60).optional(),
  classification: z.enum(["unclassified", "capex", "opex"]).default("unclassified"), document_type: z.enum(["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"]).optional().nullable(),
  is_deductible: z.boolean().default(false), is_tax: z.boolean().default(false), amount: dec, discount: dec.default("0"), emission_date: date, due_date: date, note: z.string().min(1), harvest_id: uuid.optional().nullable(),
  appropriation: z.enum(["direct", "indirect"]).default("direct"), appropriation_type: z.enum(["indirect", "livestock", "area", "maintenance", "fuel"]).optional().nullable(), appropriations: z.array(z.object({ kind: z.enum(["livestock", "area", "maintenance", "fuel"]), target: z.record(z.string(), z.unknown()), amount: dec })).optional(),
  apportionment: apportionmentSchema, plan: installmentPlanSchema.optional().nullable(),
  auto_settle: z.object({ bank_account_id: uuid, date: date }).optional().nullable(),
  // F8 (decisão 285): competência do DRE e conta prevista do fluxo — opcionais; a web anterior não manda.
  data_competencia: date.optional().nullable(), conta_prevista_id: uuid.optional().nullable(),
  // F9 (decisão 286): a TOP do lançamento avulso (família da direção). Ausente = sem TOP, como hoje.
  tipo_operacao_id: uuid.optional().nullable()
});
/** Edição: o `version` otimista é opcional (a web anterior não manda); quando vem, decide. */
const tituloEdicaoSchema = titleSchema.partial().extend({ version: z.number().int().optional() });

/** O rateio veio por VALOR (todas as linhas com `amount`)? Aí ele tem de fechar no líquido, sem tolerância. */
const rateioPorValor = (linhas: readonly { amount?: string | number | null }[]) => linhas.length > 0 && linhas.every((l) => l.amount !== undefined && l.amount !== null && l.amount !== "");

/** Mensagem única da trava de origem (PUT, cancelamento, cancelamento em lote). */
const mensagemDaOrigem = (sourceType: string | null) => `Título gerado por ${enumLabel("source_type", sourceType)}: valor, parceiro e rateio só mudam pela origem. Altere pela origem.`;

async function listTitles(ctx: ServiceCtx, direction: "payable" | "receivable", query: Record<string, unknown>) {
  const q = pageQuerySchema.parse(query); const f = query as Record<string, string>;
  const where = ["t.organization_id=$1", "t.direction=$2", "t.deleted_at is null"]; const params: unknown[] = [ctx.orgId, direction];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.empresa_id) add("t.empresa_id=?", f.empresa_id); else if (ctx.empresaId) add("t.empresa_id=?", ctx.empresaId);
  where.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
  if (f.person_id) add("t.person_id=?", f.person_id);
  if (f.proprietary_id) add("t.proprietary_id=?", f.proprietary_id);
  if (f.document_type) add("t.document_type=?", f.document_type);
  if (f.number) add("t.number ilike ?", `%${f.number}%`);
  if (f.note) add("t.note ilike ?", `%${f.note}%`);
  if (f.amount) add("t.amount=?", f.amount);
  if (f.title_type_id) add("t.title_type_id=?", f.title_type_id);
  if (f.payment_type) add("t.payment_type=?", f.payment_type);
  if (f.harvest_id) add("t.harvest_id=?", f.harvest_id);
  if (f.classification) add("t.classification=?", f.classification);
  // Tributos (`/financial/tax-accounts`): o recorte entra no WHERE, ANTES da paginação — filtrar a página depois
  // devolvia página curta e `total` de todos os títulos.
  if (f.is_tax === "true") where.push("t.is_tax");
  if (f.start_date) add("t.due_date>=?", f.start_date); if (f.end_date) add("t.due_date<=?", f.end_date);
  if (f.start_emission_date) add("t.emission_date>=?", f.start_emission_date); if (f.end_emission_date) add("t.emission_date<=?", f.end_emission_date);
  if (f.start_write_off_date) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.status='confirmed' and s.settlement_date>=?)", f.start_write_off_date);
  if (f.end_write_off_date) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.status='confirmed' and s.settlement_date<=?)", f.end_write_off_date);
  if (f.category_id) add("exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.financial_category_id=?)", f.category_id);
  if (f.center_id) add("exists (select 1 from erp.title_apportionments a where a.title_id=t.id and a.cost_center_id=?)", f.center_id);
  if (f.account_id) add("exists (select 1 from erp.title_settlements s where s.title_id=t.id and s.bank_account_id=?)", f.account_id);
  if (f.product) add("exists (select 1 from erp.invoices i join erp.invoice_items ii on ii.invoice_id=i.id join erp.products p on p.id=ii.product_id where t.source_type='invoices' and t.source_id=i.id and p.description ilike ?)", `%${f.product}%`);
  if (f.due_soon === "1") where.push("t.status in ('open','partially_paid') and t.due_date <= current_date + 3");
  const st = f.status;
  // O adiantamento é lido pelos DOIS sinais: `payment_type='advance'` e o tipo de título marcado `is_advance` (o
  // "Ad. Fornecedor" com forma de pagamento "single" era contado como conta comum a vencer).
  if (st === "open") where.push(`t.status='open' and t.due_date >= current_date and not ${EH_ADIANTAMENTO} and t.payment_type<>'invoice_group'`);
  else if (st === "overdue") where.push("t.status in ('open','partially_paid') and t.due_date < current_date");
  else if (st === "partially_paid") where.push("t.status='partially_paid'");
  else if (st === "paid") where.push("t.status='paid'");
  else if (st === "advance_pending") where.push(`${EH_ADIANTAMENTO} and t.status<>'paid'`);
  else if (st === "advance_paid") where.push(`${EH_ADIANTAMENTO} and t.status='paid'`);
  else if (st === "invoice_pending") where.push("t.payment_type='invoice_group' and t.status<>'paid'");
  else if (st === "invoice_paid") where.push("t.payment_type='invoice_group' and t.status='paid'");
  else if (st === "cancelled") where.push("t.status='cancelled'");
  else if (!st) where.push("t.status<>'cancelled'");
  // F9: o PREVISTO só aparece pedido; fora de `status=previsto`, nenhum recorte (nem os totais) o vê.
  if (st === "previsto") where.push("t.status='previsto'"); else where.push("t.status<>'previsto'");
  const w = where.join(" and ");
  const sort = ["due_date", "emission_date", "amount", "number", "code", "balance"].includes(q.sort ?? "") ? q.sort : "due_date";
  const wl = wrapListing(`select t.*, ${EH_ADIANTAMENTO} as eh_adiantamento, p.name as person_name, pr.name as proprietary_name, tt.name as title_type_name, f.name as empresa_name, (select max(settlement_date) from erp.title_settlements s where s.title_id=t.id and s.status='confirmed') as last_settlement_date, (select count(*) from erp.attachments a where a.organization_id=t.organization_id and a.entity='financial_titles' and a.entity_id=t.id)::int as attachment_count from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.empresas f on f.id=t.empresa_id where ${w} order by t.${sort} ${q.dir ?? "asc"}, t.code`, params, query, q, ", coalesce(sum(t.amount - t.discount),0)::text amount, coalesce(sum(t.balance),0)::text balance, coalesce(sum(t.paid_amount),0)::text paid");
  const tot = await ctx.tx.query<{ n: string; amount: string; balance: string; paid: string }>(wl.countSql, wl.params);
  const r = await ctx.tx.query(wl.pageSql, wl.params);
  const today = todayISO();
  return paginaComIdGlobal(ctx, "financial_titles", { items: r.rows.map((x) => { const y = x as { status: TitleStatus; due_date: string; payment_type: string; eh_adiantamento: boolean }; return { ...(x as Record<string, unknown>), status_label: displayTitleStatus({ status: y.status, dueDate: y.due_date, paymentType: y.eh_adiantamento ? "advance" : y.payment_type }, today) }; }), total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { amount: tot.rows[0]!.amount, balance: tot.rows[0]!.balance, paid: tot.rows[0]!.paid } });
}
/**
 * FRONTEIRA DE VARIANTE — `direction` FAZ PARTE DA AUTORIZAÇÃO, NÃO É FILTRO DE CONVENIÊNCIA.
 *
 * `erp.financial_titles` é UMA tabela com DUAS variantes, e cada variante tem a sua própria família
 * de capacidades (`payables.*` × `receivables.*`). A capacidade da ROTA não substitui a variante do
 * REGISTRO: quem tem `receivables.view` não pode ler um pagável só porque pediu o UUID dele pela rota
 * de recebíveis. Autorização efetiva = CAPACIDADE DA ROTA ∧ DIRECTION DO REGISTRO ∧ TENANT ∧ ESCOPO
 * DE EMPRESA, combinadas com AND.
 *
 * Por isso `expectedDirection` é OBRIGATÓRIO e entra no `where`, não numa conferência posterior:
 * conferir depois de ler já teria lido. Variante errada responde a MESMA 404 de inexistente — não
 * revela que o UUID existe na variante vizinha, nem redireciona para ela.
 *
 * Os placeholders são montados aqui em vez de por `scopedById` porque aquele helper fixa
 * `params=[id, org]` e constrói o escopo a partir de `$3`; acrescentar a direction por fora colidiria
 * com o primeiro placeholder do escopo. O helper global não muda por causa deste caso.
 */
async function getTitle(ctx: ServiceCtx, id: string, expectedDirection: "payable" | "receivable") {
  const params: unknown[] = [id, ctx.orgId, expectedDirection];
  const escopo = empresaScopeSql(ctx, "t", params);
  // F8 (aditivo): adiantamento, conta prevista e o crédito já usado vêm na MESMA consulta do título. F9 (aditivo): a TOP
  // e a versão de origem (pelo par gravado no título) na mesma consulta.
  const r = await ctx.tx.query(`select t.*, ${EH_ADIANTAMENTO} as eh_adiantamento, cp.description as conta_prevista_nome, (select coalesce(sum(u.amount),0) from erp.title_settlements u where u.adiantamento_id=t.id and u.status='confirmed')::text as credito_usado, p.name as person_name, p.document as person_document, pr.name as proprietary_name, tt.name as title_type_name, f.name as empresa_name, h.description as harvest_name, u.name as created_by_name, tpo.codigo as top_codigo, tov.nome as top_nome, tov.versao as top_versao from erp.financial_titles t left join erp.people p on p.id=t.person_id left join erp.people pr on pr.id=t.proprietary_id left join erp.title_types tt on tt.id=t.title_type_id join erp.empresas f on f.id=t.empresa_id left join erp.harvests h on h.id=t.harvest_id left join erp.users u on u.id=t.created_by left join erp.bank_accounts cp on cp.id=t.conta_prevista_id left join erp.tipos_operacao tpo on tpo.id=t.tipo_operacao_id and tpo.organization_id=t.organization_id left join erp.tipos_operacao_versoes tov on tov.id=t.tipo_operacao_versao_id and tov.organization_id=t.organization_id where t.id=$1 and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null` + escopo, params);
  if (!r.rows[0]) throw notFound("Título");
  const { credito_usado: creditoUsado, top_codigo: topCodigo, top_nome: topNome, top_versao: topVersao, ...t } = r.rows[0] as Record<string, unknown> & { status: TitleStatus; due_date: string; payment_type: string; group_id: string | null; empresa_name: string; number: string; code: string; person_name: string | null; amount: string; net_amount: string; note: string; source_type: string | null; source_id: string | null; eh_adiantamento: boolean; paid_amount: string; credito_usado: string; tipo_operacao_id: string | null; top_codigo: string | null; top_nome: string | null; top_versao: number | null };
  const app_ = await ctx.tx.query("select a.*, fc.code as category_code, fc.name as category_name, cc.name as cost_center_name, ca.description as chart_account_name, ar.name as area_name, h.description as harvest_name from erp.title_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id left join erp.chart_accounts ca on ca.id=a.chart_account_id left join erp.areas ar on ar.id=a.area_id left join erp.harvests h on h.id=a.harvest_id where a.title_id=$1", [id]);
  const appr = await ctx.tx.query("select * from erp.title_appropriations where title_id=$1", [id]);
  // F9 (aditivo): o imóvel rural do LCDPR de cada baixa (o id já vem em `s.*`), com o nome.
  const settlements = await ctx.tx.query<Record<string, unknown> & { id: string; settlement_date: string; net_amount: string }>("select s.*, ba.description as bank_account_name, u.name as created_by_name, ir.nome as imovel_rural_nome from erp.title_settlements s left join erp.bank_accounts ba on ba.id=s.bank_account_id left join erp.users u on u.id=s.created_by left join erp.imoveis_rurais ir on ir.id=s.imovel_rural_id and ir.organization_id=s.organization_id where s.title_id=$1 order by s.created_at", [id]);
  // Os componentes de TODAS as baixas numa consulta (juros, multa, acréscimo e tarifa lançados em separado).
  const sids = settlements.rows.map((s) => s.id);
  const comps = sids.length
    ? (await ctx.tx.query<{ id: string; baixa_id: string; componente: string; valor: string; status: string; natureza_nome: string | null }>(
      "select m.id, m.title_settlement_id::text as baixa_id, m.componente_baixa as componente, m.amount::text as valor, m.status,"
      + " (select fc.name from erp.bank_movement_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id where a.movement_id=m.id order by a.amount desc, fc.name limit 1) as natureza_nome"
      + " from erp.bank_movements m where m.organization_id=$1 and m.title_settlement_id = any($2::uuid[]) order by m.created_at, m.code", [ctx.orgId, sids])).rows
    : [];
  const siblings = t.group_id ? (await ctx.tx.query("select id, code, number, installment_number, due_date, amount, balance, status from erp.financial_titles where group_id=$1 order by installment_number", [t.group_id])).rows : [];
  const attachments = await ctx.tx.query("select id, file_name, description, object_path, created_at from erp.attachments where organization_id=$2 and entity='financial_titles' and entity_id=$1", [id, ctx.orgId]);
  return {
    ...(t as Record<string, unknown>), ...t,
    status_label: displayTitleStatus({ status: t.status, dueDate: t.due_date, paymentType: t.eh_adiantamento ? "advance" : t.payment_type }, todayISO()),
    bloqueado_pela_origem: tituloDeDocumento(t.source_type), origem_grupo: grupoDaOrigem(t.source_type),
    // F9 (aditivos): a origem pelo NOME e a TOP de origem com a versão.
    origem_nome: await nomeDaOrigem(ctx, t.source_type, t.source_id),
    tipo_operacao: t.tipo_operacao_id && topCodigo !== null && topNome !== null && topVersao !== null ? { id: t.tipo_operacao_id, codigo: topCodigo, nome: topNome, versao: topVersao } : null,
    credito_disponivel: t.eh_adiantamento ? money(D(t.paid_amount).minus(creditoUsado)) : null,
    apportionments: app_.rows, appropriations: appr.rows,
    settlements: settlements.rows.map((s) => ({ ...s, componentes: comps.filter((c) => c.baixa_id === s.id).map(({ baixa_id: _baixa, ...c }) => c) })),
    installments: siblings, attachments: attachments.rows
  };
}

/** Resposta da baixa: as chaves de sempre + lote, componentes, tarifa e crédito (aditivos, F8). */
interface ResultadoDaBaixa {
  settlement_id: string; title_id: string; net_amount: string; status: string; balance: string; bank_movement_id: string | null;
  lote_id: string | null; componentes: { componente: ComponenteBaixa; valor: string; bank_movement_id: string }[];
  tarifa_movimento_id: string | null; credito: { titulo_id: string; valor: string } | null;
}
interface PedidoDeBaixa {
  settlement_date: string; settlement_kind: "bank_movement" | "cross_settlement" | "advance_compensation"; bank_account_id?: string | null; cross_title_id?: string | null;
  amount: string; discount?: string; penalty?: string; interest?: string; increase?: string; foreign_amount?: string | null; ptax_rate?: string | null;
  exchange_adjustment?: string; note?: string | null; movement_mode: "separate" | "single"; shared_movement_id?: string | null;
  tarifa?: string; excedente?: "credito" | null; adiantamento_id?: string | null;
  /** F9: o imóvel rural do LCDPR (ausente = o padrão da empresa do título; nulo = nenhum). Só na baixa bancária. */
  imovel_rural_id?: string | null;
  /** Internos (lote e "gera obrigação"): nunca vêm do corpo da rota individual. */
  lote_id?: string | null; naturezas?: NaturezasPadrao;
}

export default async function financialRoutes(app: FastifyInstance) {
  for (const dir of ["payable", "receivable"] as const) {
    const base = dir === "payable" ? "/financial/payables" : "/financial/receivables";
    app.get(base, async (req) => runService(app, req, permOf(dir, "view"), (ctx) => listTitles(ctx, dir, req.query as Record<string, unknown>)));
    app.get(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "view"), (ctx) => getTitle(ctx, (req.params as { id: string }).id, dir)));
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "create"), async (ctx) => {
      const d = titleSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.empresa_id);
      if (dir === "receivable" && !d.person_id) throw validation("Cliente obrigatório"); if (dir === "payable" && !d.person_id) throw validation("Fornecedor obrigatório");
      /**
       * F9 (decisão 286) — A TOP PRIMEIRO. Com `tipo_operacao_id`, a TOP da família da direção (a mesma 422 para a de
       * outra família, inativa, excluída ou de outra organização), a versão CORRENTE congelada pelo servidor, e os
       * padrões dela (só no formato 5): o tipo de título e a conta prevista entram SÓ onde o corpo não informou; com
       * `documentoTroca` desligado, o que o corpo informar diferente dos padrões é recusado. Sem TOP: como hoje.
       */
      const top = d.tipo_operacao_id ? await resolverTopParaLancamento(ctx, familiaDaDirecao(dir), d.tipo_operacao_id) : null;
      const fin = await conferirTrocaDosPadroes(ctx, top, {
        naturezaIds: d.apportionment.map((a) => a.financial_category_id), centroCustoIds: d.apportionment.map((a) => a.cost_center_id),
        tipoTituloId: d.title_type_id, contaBancariaId: d.conta_prevista_id
      });
      const tipoTituloId = d.title_type_id ?? fin?.padroes?.tipoTituloId ?? null;
      const contaPrevistaId = d.conta_prevista_id ?? fin?.padroes?.contaBancariaId ?? null;
      // F8: referências do TENANT (FKs de coluna única não provam organização) e o rateio em R$ fechando no líquido. F9:
      // o tipo de título e a conta EFETIVOS (o padrão da TOP também é conferido: o cadastro pode ter envelhecido).
      await conferirReferenciasDoTitulo(ctx, { person_id: d.person_id, proprietary_id: d.proprietary_id, title_type_id: tipoTituloId, harvest_id: d.harvest_id, branch_id: d.branch_id, conta_prevista_id: contaPrevistaId, apportionment: d.apportionment });
      if (rateioPorValor(d.apportionment)) exigirRateioFechado(money(D(d.amount).minus(d.discount)), d.apportionment);
      if (d.data_competencia) await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.data_competencia);
      return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
        const lines = d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, areaId: a.area_id ?? null, percentage: a.percentage, amount: a.amount }));
        // A TOP e a versão vão em TODAS as parcelas e recorrências; o tipo de título e a conta prevista são os efetivos.
        const base = { ...mapTitle(d, dir), titleTypeId: tipoTituloId, contaPrevistaId, tipoOperacaoId: top?.tipoOperacaoId ?? null, tipoOperacaoVersaoId: top?.tipoOperacaoVersaoId ?? null };
        const ids: string[] = [];
        if (d.payment_type === "recurring" && d.recurrence_type) {
          const dates = recurrenceDates(d.due_date, d.recurrence_type, d.recurrence_count ?? 12);
          const groupId = (await ctx.tx.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id;
          for (const [i, due] of dates.entries()) { const c = await createTitles(ctx, { ...base, number: `${d.number}-${i + 1}`, dueDate: due, apportionment: lines, plan: null }); ids.push(...c.ids); await ctx.tx.query("update erp.financial_titles set group_id=$2, installment_number=$3, installment_count=$4 where id=$1", [c.ids[0], groupId, i + 1, dates.length]); }
        } else { const c = await createTitles(ctx, { ...base, apportionment: lines, plan: d.plan ?? null }); ids.push(...c.ids); }
        // A competência (0042) depois do `createTitles` (a conta prevista já entra no INSERT): ROW COUNT = os criados.
        if (d.data_competencia) {
          const u = await ctx.tx.query("update erp.financial_titles set data_competencia=$2 where id = any($1::uuid[]) and organization_id=$3", [ids, d.data_competencia, ctx.orgId]);
          if (u.rowCount !== ids.length) throw notFound("Título");
        }
        if (d.appropriations?.length) for (const a of d.appropriations) await ctx.tx.query("insert into erp.title_appropriations(title_id,kind,target,amount) values ($1,$2,$3,$4)", [ids[0], a.kind, JSON.stringify(a.target), money(a.amount)]);
        if (d.auto_settle) for (const id of ids) await settle(ctx, id, dir, { settlement_date: d.auto_settle.date, settlement_kind: "bank_movement", bank_account_id: d.auto_settle.bank_account_id, amount: (await ctx.tx.query<{ b: string }>("select balance b from erp.financial_titles where id=$1", [id])).rows[0]!.b, movement_mode: "separate" });
        await audit(ctx.tx, ctx, "financial_titles", ids[0]!, "create", { count: ids.length, ...(top ? { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId } : {}) });
        return { ids, id: ids[0] };
      })).result;
    })));
    /**
     * EDIÇÃO DO TÍTULO (F8, decisão 285). A presença de um campo é lida no corpo BRUTO: o esquema do título tem
     * padrões (`discount` "0", `is_tax` false, `classification`…) que o `partial()` do zod 4 PREENCHE — e antes isso
     * zerava o desconto e as marcas de quem mandava só a observação, e tornava todo título com baixa ineditável.
     * Ordem: cancelado → versão → trava da origem → empresa/forma → valor de título com baixa → rateio do valor novo
     * → congelamento (emissão atual e, se mudarem, a nova emissão e a nova competência) → referências do tenant →
     * rateio em R$ fechado → UPDATE com ROW COUNT.
     */
    app.put(`${base}/:id`, async (req) => runService(app, req, permOf(dir, "edit"), async (ctx) => {
      const { id } = req.params as { id: string };
      const bruto = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const d = tituloEdicaoSchema.parse(bruto);
      const veio = (k: keyof z.infer<typeof tituloEdicaoSchema>) => Object.prototype.hasOwnProperty.call(bruto, k) && bruto[k] !== undefined;
      const params: unknown[] = [id, ctx.orgId, dir];
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; empresa_id: string; emission_date: string; data_competencia: string | null; version: number; source_type: string | null; payment_type: string; number: string; person_id: string | null; amount: string; discount: string; tipo_operacao_id: string | null }>(
        "select t.status, t.paid_amount, t.empresa_id, t.emission_date, t.data_competencia, t.version, t.source_type, t.payment_type, t.number, t.person_id, t.amount, t.discount, t.tipo_operacao_id::text as tipo_operacao_id from erp.financial_titles t where t.id=$1 and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null"
        + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " for update", params);
      const c = cur.rows[0];
      if (!c) throw notFound("Título"); await exigirEmpresaVisivel(ctx, c.empresa_id, "Título");
      // F9: o previsto não se edita (muda pela origem) — antes de tudo o que leria ou mexeria nele.
      if (c.status === "previsto") throw err("CONFLICT", MENSAGEM_PREVISTO_SEM_EDICAO);
      if (c.status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado");
      if (d.version !== undefined && d.version !== c.version) throw err("CONCURRENCY_CONFLICT", "O título mudou desde que foi aberto. Recarregue e tente de novo.");
      if (tituloDeDocumento(c.source_type)) {
        const rateio = await ctx.tx.query<TituloComparavel["apportionment"][number]>("select financial_category_id, cost_center_id, chart_account_id, harvest_id, area_id, percentage, amount from erp.title_apportionments where title_id=$1", [id]);
        const travados = alteracoesTravadasPelaOrigem({ empresa_id: c.empresa_id, number: c.number, person_id: c.person_id, amount: c.amount, discount: c.discount, emission_date: c.emission_date, apportionment: rateio.rows }, bruto);
        if (travados.length) throw err("CONFLICT", mensagemDaOrigem(c.source_type), { campos: travados });
      }
      if ((veio("empresa_id") && String(d.empresa_id).toLowerCase() !== c.empresa_id.toLowerCase()) || (veio("payment_type") && d.payment_type !== c.payment_type)) throw validation("Empresa e forma de pagamento não mudam na edição");
      // F9: a TOP presente e DIFERENTE da gravada (nulo contra uma TOP também) é recusada; a mesma passa e nada muda.
      if (veio("tipo_operacao_id") && !mesmoId(d.tipo_operacao_id, c.tipo_operacao_id)) throw validation(MENSAGEM_TOP_NAO_MUDA, [{ path: ["tipo_operacao_id"], message: MENSAGEM_TOP_NAO_MUDA }]);
      const novoValor = veio("amount") && !D(d.amount!).eq(c.amount) ? d.amount! : null;
      const novoDesconto = veio("discount") && !D(d.discount!).eq(c.discount) ? d.discount! : null;
      if (D(c.paid_amount).gt(0) && (novoValor !== null || novoDesconto !== null)) throw err("CONFLICT", "Título com baixa: valor não pode ser alterado (cancele a baixa)");
      if ((novoValor !== null || novoDesconto !== null) && !veio("apportionment")) throw validation("Informe o rateio para o novo valor do título");
      await assertPeriodOpen(ctx.tx, ctx.orgId, c.empresa_id, c.emission_date);
      if (veio("emission_date") && d.emission_date !== c.emission_date) await assertPeriodOpen(ctx.tx, ctx.orgId, c.empresa_id, d.emission_date!);
      if (veio("data_competencia") && d.data_competencia && d.data_competencia !== c.data_competencia) await assertPeriodOpen(ctx.tx, ctx.orgId, c.empresa_id, d.data_competencia);
      await conferirReferenciasDoTitulo(ctx, { person_id: veio("person_id") ? d.person_id : null, proprietary_id: veio("proprietary_id") ? d.proprietary_id : null, title_type_id: veio("title_type_id") ? d.title_type_id : null, harvest_id: veio("harvest_id") ? d.harvest_id : null, branch_id: veio("branch_id") ? d.branch_id : null, conta_prevista_id: veio("conta_prevista_id") ? d.conta_prevista_id : null, apportionment: veio("apportionment") ? d.apportionment : [] });
      const liquido = money(D(novoValor ?? c.amount).minus(novoDesconto ?? c.discount));
      if (veio("apportionment") && d.apportionment && rateioPorValor(d.apportionment)) exigirRateioFechado(liquido, d.apportionment);
      // Campos de hoje: ausente (ou nulo) mantém o gravado — como o `coalesce` sempre fez. Competência e conta prevista
      // (novas): presentes decidem, e nulo LIMPA.
      const p = <K extends keyof z.infer<typeof tituloEdicaoSchema>>(k: K) => (veio(k) ? (d[k] ?? null) : null);
      const u = await ctx.tx.query("update erp.financial_titles set number=coalesce($3,number), title_type_id=coalesce($4,title_type_id), proprietary_id=coalesce($5,proprietary_id), person_id=coalesce($6,person_id), classification=coalesce($7,classification), document_type=coalesce($8,document_type), is_deductible=coalesce($9,is_deductible), is_tax=coalesce($10,is_tax), amount=coalesce($11,amount), discount=coalesce($12,discount), emission_date=coalesce($13,emission_date), due_date=coalesce($14,due_date), note=coalesce($15,note), harvest_id=coalesce($16,harvest_id), appropriation=coalesce($17,appropriation), appropriation_type=coalesce($18,appropriation_type), branch_id=coalesce($19,branch_id), data_competencia=case when $20::boolean then $21::date else data_competencia end, conta_prevista_id=case when $22::boolean then $23::uuid else conta_prevista_id end, version=version+1 where id=$1 and organization_id=$2 and direction=$24 and deleted_at is null",
        [id, ctx.orgId, p("number"), p("title_type_id"), p("proprietary_id"), p("person_id"), p("classification"), p("document_type"), p("is_deductible"), p("is_tax"), novoValor, novoDesconto, p("emission_date"), p("due_date"), p("note"), p("harvest_id"), p("appropriation"), p("appropriation_type"), p("branch_id"), veio("data_competencia"), d.data_competencia ?? null, veio("conta_prevista_id"), d.conta_prevista_id ?? null, dir]);
      if (u.rowCount !== 1) throw notFound("Título");
      if (veio("apportionment") && d.apportionment) {
        await exigirRateioAnalitico(ctx, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id })));
        const lines = normalizeApportionment(liquido, d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, areaId: a.area_id ?? null, percentage: a.percentage, amount: a.amount })));
        await ctx.tx.query("delete from erp.title_apportionments where title_id=$1", [id]);
        for (const l of lines) await ctx.tx.query("insert into erp.title_apportionments(title_id,financial_category_id,chart_account_id,cost_center_id,area_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.areaId, l.harvestId, l.percentage, l.amount]);
      }
      await ctx.tx.query("select erp.refresh_title_status($1)", [id]);
      await audit(ctx.tx, ctx, "financial_titles", id, "update", { campos: Object.keys(bruto).filter((k) => bruto[k] !== undefined) });
      return getTitle(ctx, id, dir);
    }));
    /** Cancelamento: o MOTIVO passa a ser gravado (antes o corpo era ignorado); título de documento cai pela origem. */
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => {
      const { id } = req.params as { id: string };
      const d = z.object({ reason: MOTIVO.optional() }).parse(req.body ?? {});
      const cur = await ctx.tx.query<{ status: string; paid_amount: string; empresa_id: string; emission_date: string; source_type: string | null }>("select status, paid_amount, empresa_id, emission_date, source_type from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [id, ctx.orgId, dir]);
      if (!cur.rows[0]) throw notFound("Título"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Título"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado"); if (D(cur.rows[0].paid_amount).gt(0)) throw err("CONFLICT", "Título com baixa: cancele a baixa antes");
      if (tituloDeDocumento(cur.rows[0].source_type)) throw err("CONFLICT", mensagemDaOrigem(cur.rows[0].source_type));
      await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].emission_date);
      const u = await ctx.tx.query("update erp.financial_titles set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, version=version+1 where id=$1 and organization_id=$2 and status<>'cancelled'", [id, ctx.orgId, d.reason ?? null, ctx.user.id]);
      if (u.rowCount !== 1) throw notFound("Título");
      await audit(ctx.tx, ctx, "financial_titles", id, "cancel", { reason: d.reason ?? null });
      return { id, status: "cancelled" };
    }));
    /**
     * Cancelamento em LOTE: cada título sai com o seu resultado — "cancelado" ou "pulado" com o MOTIVO (antes o lote
     * pulava em silêncio). O congelamento é conferido por título com SAVEPOINT: o congelado é pulado, os outros seguem.
     * As chaves de hoje (`cancelled`, `skipped`) continuam.
     */
    app.post(`${base}/cancel-batch`, async (req) => runService(app, req, permOf(dir, "delete"), async (ctx) => {
      const d = z.object({ ids: idsDoLote, reason: MOTIVO.optional() }).parse(req.body);
      const params: unknown[] = [d.ids.map((x) => x.toLowerCase()), ctx.orgId, dir];
      const lidos = await ctx.tx.query<{ id: string; status: string; paid_amount: string; empresa_id: string; emission_date: string; source_type: string | null }>(
        "select t.id::text as id, t.status, t.paid_amount, t.empresa_id, t.emission_date, t.source_type from erp.financial_titles t where t.id = any($1::uuid[]) and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null"
        + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " order by t.id for update", params);
      const porId = new Map(lidos.rows.map((x) => [x.id.toLowerCase(), x]));
      const itens: { id: string; resultado: "cancelado" | "pulado"; motivo?: string }[] = [];
      for (const pedido of d.ids) {
        const t = porId.get(pedido.toLowerCase());
        const pular = (motivo: string) => itens.push({ id: pedido, resultado: "pulado", motivo });
        if (!t || !(await empresaPermitida(ctx, t.empresa_id))) { pular("nao_encontrado"); continue; }
        if (t.status === "cancelled") { pular("ja_cancelado"); continue; }
        if (D(t.paid_amount).gt(0)) { pular("com_baixa"); continue; }
        if (tituloDeDocumento(t.source_type)) { pular("origem"); continue; }
        if (!(await periodoAbertoNoLote(ctx, t.empresa_id, t.emission_date))) { pular("periodo_congelado"); continue; }
        const u = await ctx.tx.query("update erp.financial_titles set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, version=version+1 where id=$1 and organization_id=$2 and status<>'cancelled' and paid_amount=0", [t.id, ctx.orgId, d.reason ?? null, ctx.user.id]);
        if (u.rowCount !== 1) { pular("situacao"); continue; }
        await audit(ctx.tx, ctx, "financial_titles", t.id, "cancel", { reason: d.reason ?? null, lote: true });
        itens.push({ id: pedido, resultado: "cancelado" });
      }
      const n = itens.filter((i) => i.resultado === "cancelado").length;
      return { cancelled: n, skipped: d.ids.length - n, itens };
    }));
    app.post(`${base}/:id/duplicate`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "duplicate"), async (ctx) => {
      const { id } = req.params as { id: string }; const t = await getTitle(ctx, id, dir) as Record<string, unknown> & { apportionments: { financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; area_id: string | null; percentage: string }[] };
      if (t.status === "previsto") throw err("CONFLICT", MENSAGEM_PREVISTO_SEM_DUPLICAR);
      const c = await createTitles(ctx, { empresaId: t.empresa_id as string, direction: dir, number: `${t.number}-C`, titleTypeId: t.title_type_id as string | null, personId: t.person_id as string | null, proprietaryId: t.proprietary_id as string | null, classification: t.classification as "unclassified", documentType: t.document_type as string | null, isDeductible: t.is_deductible as boolean, isTax: t.is_tax as boolean, amount: t.amount as string, discount: t.discount as string, emissionDate: todayISO(), dueDate: t.due_date as string, note: t.note as string, harvestId: t.harvest_id as string | null, apportionment: t.apportionments.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id, harvestId: a.harvest_id, areaId: a.area_id, percentage: a.percentage })) });
      return { id: c.ids[0] };
    })));
    // Baixa (individual ou em lote: "Baixar Contas")
    const settleSchema = z.object({ settlement_date: date, settlement_kind: z.enum(["bank_movement", "cross_settlement", "advance_compensation"]).default("bank_movement"), bank_account_id: uuid.optional().nullable(), cross_title_id: uuid.optional().nullable(), amount: dec, discount: dec.default("0"), penalty: dec.default("0"), interest: dec.default("0"), increase: dec.default("0"), foreign_amount: dec.optional().nullable(), ptax_rate: dec.optional().nullable(), exchange_adjustment: dec.default("0"), note: z.string().optional().nullable(), movement_mode: z.enum(["separate", "single"]).default("separate"),
      // F8 (aditivos; a web anterior não manda): tarifa, excedente que vira crédito e uso do crédito de um adiantamento.
      tarifa: dec.default("0"), excedente: z.enum(["credito"]).optional().nullable(), adiantamento_id: uuid.optional().nullable(),
      // F9 (aditivo): o imóvel rural do LCDPR da baixa bancária. Ausente = o padrão da empresa do título; nulo = nenhum.
      imovel_rural_id: uuid.optional().nullable() });
    app.post(`${base}/:id/settle`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => { const { id } = req.params as { id: string }; const d = settleSchema.parse(req.body); return (await idempotent(ctx.tx, ctx.orgId, idem(req), { id, ...d }, () => settle(ctx, id, dir, d))).result; })));
    /**
     * BAIXA EM LOTE (F8). O furo: `empresaPermitida` é ASSÍNCRONA e era chamada sem `await` — `!Promise` é sempre
     * falso, e o recorte por escopo nunca disparava (o gate do escopo só procura o NOME). Agora o escopo entra no SQL
     * E a conferência é aguardada; o que não pode ser baixado é PULADO com motivo e não soma no total.
     * Todas as baixas do lote recebem o mesmo `lote_id`. "Único (agrupado)": um movimento só, na empresa DOS títulos
     * (todos da mesma, senão 422) e com o RATEIO da união dos títulos — antes nascia na empresa selecionada (às vezes
     * nula) e sem rateio. A tarifa do lote é UM movimento de saída com a natureza da tarifa bancária.
     */
    app.post(`${base}/settle-batch`, async (req, reply) => reply.status(201).send(await runService(app, req, permOf(dir, "settle"), async (ctx) => {
      const itemSchema = z.object({ id: uuid, valor: dec.optional(), desconto: dec.optional(), juros: dec.optional(), multa: dec.optional(), acrescimo: dec.optional() }).strict();
      const d = z.object({ ids: idsDoLote.optional(), itens: z.array(itemSchema).min(1).max(200).refine((xs) => new Set(xs.map((x) => x.id.toLowerCase())).size === xs.length, "Título repetido no lote").optional(), settlement_date: date, bank_account_id: uuid, movement_mode: z.enum(["separate", "single"]).default("separate"), note: z.string().optional().nullable(), tarifa: dec.optional(),
        // F9 (aditivo): o imóvel rural do lote, com a regra da baixa de um título (`resolverImovelDaBaixa`): ausente = o
        // padrão da empresa de cada título; `null` = nenhum ("Sem imóvel"); um id = conferido contra a empresa de cada um.
        imovel_rural_id: uuid.optional().nullable() }).parse(req.body);
      if (d.ids && d.itens) throw validation("Informe os títulos por ids ou por itens, não pelos dois");
      const pedidos = d.itens ?? (d.ids ?? []).map((id) => ({ id, valor: undefined, desconto: undefined, juros: undefined, multa: undefined, acrescimo: undefined }));
      if (!pedidos.length) throw validation("Informe os títulos do lote");
      return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
        const params: unknown[] = [pedidos.map((p) => p.id.toLowerCase()), ctx.orgId, dir];
        const lidos = await ctx.tx.query<{ id: string; balance: string; empresa_id: string; status: string }>(
          "select t.id::text as id, t.balance, t.empresa_id, t.status from erp.financial_titles t where t.id = any($1::uuid[]) and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null"
          + empresaScopeSql(ctx, "t", params, { ignoreSelected: true }) + " order by t.id for update", params);
        const porId = new Map(lidos.rows.map((x) => [x.id.toLowerCase(), x]));
        const pulados: { id: string; motivo: string }[] = [];
        const elegiveis: { id: string; empresaId: string; valor: string; desconto: string; juros: string; multa: string; acrescimo: string; liquido: string }[] = [];
        for (const p of pedidos) {
          const t = porId.get(p.id.toLowerCase());
          if (!t || !(await empresaPermitida(ctx, t.empresa_id))) { pulados.push({ id: p.id, motivo: "nao_encontrado" }); continue; }
          if (t.status !== "open" && t.status !== "partially_paid") { pulados.push({ id: p.id, motivo: "situacao" }); continue; }
          const v = conferirValoresDaBaixa(t.balance, { valor: p.valor ?? t.balance, desconto: p.desconto, juros: p.juros, multa: p.multa, acrescimo: p.acrescimo });
          elegiveis.push({ id: t.id, empresaId: t.empresa_id, valor: v.aplicado, desconto: v.desconto, juros: v.juros, multa: v.multa, acrescimo: v.acrescimo, liquido: v.liquidoTotal });
        }
        const empresas = [...new Set(elegiveis.map((e) => e.empresaId))];
        // F9: o imóvel informado é de UMA empresa — conferido contra a de CADA título elegível, antes de qualquer gravação.
        if (d.imovel_rural_id) for (const empresa of empresas) await conferirImovelRural(ctx, d.imovel_rural_id, empresa);
        const total = sum(elegiveis.map((e) => e.liquido));
        const tarifa = d.tarifa ?? "0";
        const naturezas = await lerNaturezasPadrao(ctx);
        if (d.movement_mode === "single" && empresas.length > 1) throw validation("Movimento único exige títulos da mesma empresa");
        if (D(tarifa).lt(0)) throw validation("Juros, multa, acréscimo, desconto e tarifa não podem ser negativos");
        // Sem título elegível não há lote, e a tarifa não é lançada (a resposta mostra `settled` 0 e os pulados).
        const comTarifa = D(tarifa).gt(0) && elegiveis.length > 0;
        if (comTarifa) {
          if (!naturezas.tarifa_bancaria_id) throw validation(MENSAGEM_TARIFA_SEM_NATUREZA);
          // A tarifa do lote tira centro e safra da união dos rateios: nenhum título com rateio (acervo) → recusa com o
          // motivo, antes de qualquer gravação (antes saía o técnico "Rateio base vazio" no fim do lote).
          const comRateio = await ctx.tx.query("select 1 from erp.title_apportionments where title_id = any($1::uuid[]) limit 1", [elegiveis.map((e) => e.id)]);
          if (!comRateio.rowCount) throw validation(MENSAGEM_LOTE_SEM_RATEIO);
          if (empresas.length > 1) throw validation("Tarifa do lote exige títulos da mesma empresa");
          await conferirNaturezasPadrao(ctx, [{ componente: "tarifa", naturezaId: naturezas.tarifa_bancaria_id }]);
        }
        const loteId = elegiveis.length ? (await ctx.tx.query<{ id: string }>("select gen_random_uuid()::text id")).rows[0]!.id : null;
        // Rateio dos títulos elegíveis numa consulta: base do movimento único e da tarifa do lote.
        const rateios = elegiveis.length ? (await ctx.tx.query<LinhaDoRateioDoTitulo & { title_id: string }>("select title_id::text as title_id, financial_category_id, cost_center_id, chart_account_id, harvest_id, percentage from erp.title_apportionments where title_id = any($1::uuid[])", [elegiveis.map((e) => e.id)])).rows : [];
        let sharedMovement: string | null = null;
        if (d.movement_mode === "single" && total.gt(0)) {
          sharedMovement = await createBankMovement(ctx, { empresaId: empresas[0]!, bankAccountId: d.bank_account_id, date: d.settlement_date, type: dir === "payable" ? "out" : "in", amount: money(total), note: d.note ?? `Baixa em lote de ${elegiveis.length} títulos`, sourceType: "title_settlement_batch", sourceId: elegiveis[0]!.id, apportionment: rateioDoMovimentoUnico(elegiveis, rateios), rateioJaGravado: true, imovelRuralId: d.imovel_rural_id });
          const v = await ctx.tx.query("update erp.bank_movements set lote_baixa_id=$2 where id=$1 and organization_id=$3", [sharedMovement, loteId, ctx.orgId]);
          if (v.rowCount !== 1) throw notFound("Movimento");
        }
        const results: ResultadoDaBaixa[] = [];
        for (const e of elegiveis) results.push(await settle(ctx, e.id, dir, { settlement_date: d.settlement_date, settlement_kind: "bank_movement", bank_account_id: d.bank_account_id, amount: e.valor, discount: e.desconto, interest: e.juros, penalty: e.multa, increase: e.acrescimo, note: d.note ?? null, movement_mode: d.movement_mode, shared_movement_id: sharedMovement, lote_id: loteId, naturezas, imovel_rural_id: d.imovel_rural_id }));
        // Centros e safras da tarifa: a união dos rateios, cada título pesando o seu líquido no lote.
        const pesoDaTarifa = rateios.map((r) => ({ ...r, percentage: D(r.percentage).mul(elegiveis.find((e) => e.id.toLowerCase() === r.title_id.toLowerCase())?.liquido ?? "0").toFixed(6) })).filter((r) => !D(r.percentage).isZero());
        const tarifaMovimento = comTarifa && loteId ? await lancarTarifaDoLote(ctx, { loteId, empresaId: empresas[0]!, contaId: d.bank_account_id, data: d.settlement_date, valor: money(tarifa), naturezaId: naturezas.tarifa_bancaria_id!, rateioBase: pesoDaTarifa.length ? pesoDaTarifa : rateios, nota: `Tarifa da baixa em lote de ${elegiveis.length} títulos`, imovelRuralId: d.imovel_rural_id }) : null;
        return { settled: results.length, total: money(total), items: results, lote_id: loteId, pulados, tarifa_movimento_id: tarifaMovimento };
      })).result;
    })));
    app.post(`${base}/:id/settlements/:sid/cancel`, async (req) => runService(app, req, permOf(dir, "cancel_settlement"), async (ctx) => {
      const { id, sid } = req.params as { id: string; sid: string }; const d = z.object({ reason: z.string().min(1) }).parse(req.body);
      // O corpo do estorno mora em `lib/financeiro-estorno.ts` (com a fronteira de variante, a cardinalidade do
      // espelho e a simetria da trilha), para valer igual no estorno em lote e no estorno do lote inteiro.
      await estornarBaixa(ctx, { tituloId: id, baixaId: sid, direcao: dir, motivo: d.reason });
      return getTitle(ctx, id, dir);
    }));
    app.get(`${base}/:id/receipt`, async (req) => runService(app, req, permOf(dir, "receipt"), async (ctx) => {
      const t = await getTitle(ctx, (req.params as { id: string }).id, dir);
      // F8: cada baixa lista também os componentes lançados em separado (juros, multa, acréscimo, tarifa).
      const baixas = (t.settlements as { settlement_date: string; net_amount: string; componentes: { componente: string; valor: string; status: string }[] }[]).filter(Boolean).map((s) => {
        const comps = s.componentes.filter((c) => c.status === "confirmed").map((c) => `${rotuloFinanceiro("componente_baixa", c.componente)} R$ ${c.valor}`);
        return `${s.settlement_date}: R$ ${s.net_amount}${comps.length ? ` (lançados em separado: ${comps.join("; ")})` : ""}`;
      });
      return { title: t, receipt_text: `RECIBO — ${t.empresa_name}\nTítulo ${t.number} (${t.code})\n${dir === "payable" ? "Pago a" : "Recebido de"}: ${t.person_name ?? "-"}\nValor: R$ ${t.amount} (líquido R$ ${t.net_amount})\nBaixas: ${baixas.join("; ") || "nenhuma"}\nHistórico: ${t.note}` };
    }));
  }

  /**
   * A BAIXA. Ordem: título `for update` escopado → cancelado/baixado → período → um de três ramos:
   *   • USO DO CRÉDITO de um adiantamento (`adiantamento_id`): compensação sem banco, mesma direção, parceiro e
   *     empresa; o gatilho `trg_ts_credito_conferir` (0042) é a segunda linha;
   *   • CRUZADA (`cross_settlement` / `advance_compensation` com título contrário): igual a antes;
   *   • BANCÁRIA, na semântica B (decisão 285): `amount` é o valor baixado do título e inclui o desconto; o caixa é
   *     `amount − desconto + juros + multa + acréscimo ± ajuste`. Juros, multa e acréscimo com natureza padrão
   *     configurada (e `movement_mode` "separate") viram movimentos próprios; sem natureza ficam DENTRO do
   *     principal, como antes. A tarifa é sempre um movimento de saída próprio. O excedente vira crédito.
   */
  async function settle(ctx: ServiceCtx, titleId: string, expectedDirection: "payable" | "receivable", d: PedidoDeBaixa): Promise<ResultadoDaBaixa> {
    const t = await ctx.tx.query<{ direction: "payable" | "receivable"; balance: string; status: string; empresa_id: string; number: string; person_id: string | null; proprietary_id: string | null; harvest_id: string | null; is_deductible: boolean }>("select direction, balance, status, empresa_id, number, person_id, proprietary_id, harvest_id, is_deductible from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [titleId, ctx.orgId, expectedDirection]);
    const title = t.rows[0]; if (!title) throw notFound("Título"); await exigirEmpresaVisivel(ctx, title.empresa_id, "Título"); if (title.status === "cancelled") throw err("ALREADY_CANCELLED", "Título cancelado"); if (title.status === "paid") throw err("ALREADY_CONFIRMED", "Título já baixado");
    // F9: o previsto não recebe baixa (o banco recusa também, pela `refresh_title_status`; aqui a recusa vem antes de gravar).
    if (title.status === "previsto") throw err("CONFLICT", MENSAGEM_PREVISTO_SEM_BAIXA);
    await assertPeriodOpen(ctx.tx, ctx.orgId, title.empresa_id, d.settlement_date);
    // F9: a compensação (crédito de adiantamento, cruzada) não movimenta caixa — o imóvel do LCDPR não cabe nela.
    if ((d.adiantamento_id || d.settlement_kind !== "bank_movement") && d.imovel_rural_id) throw validation(MENSAGEM_IMOVEL_NA_COMPENSACAO, [{ path: ["imovel_rural_id"], message: MENSAGEM_IMOVEL_NA_COMPENSACAO }]);
    const tarifa = d.tarifa ?? "0";
    const depois = async () => (await ctx.tx.query<{ status: string; balance: string }>("select status, balance from erp.financial_titles where id=$1", [titleId])).rows[0]!;

    // ---- uso do crédito de um adiantamento ----
    if (d.adiantamento_id) {
      if (d.settlement_kind !== "advance_compensation") throw validation("Use a compensação de adiantamento para usar crédito");
      const extras = [d.discount, d.penalty, d.interest, d.increase, d.exchange_adjustment, tarifa].some((x) => x !== undefined && x !== null && !D(x).isZero());
      if (extras || d.excedente || d.cross_title_id || d.bank_account_id) throw validation("A compensação com adiantamento usa só o valor");
      const adt = await ctx.tx.query<{ id: string; paid_amount: string; usado: string }>(
        `select t.id::text as id, t.paid_amount, (select coalesce(sum(u.amount),0) from erp.title_settlements u where u.adiantamento_id=t.id and u.status='confirmed')::text as usado from erp.financial_titles t where t.id=$1 and t.organization_id=$2 and t.direction=$3 and t.deleted_at is null and t.status not in ('cancelled','previsto') and ${EH_ADIANTAMENTO} and t.person_id is not distinct from $4 and t.empresa_id=$5 and t.id<>$6 for update`,
        [d.adiantamento_id, ctx.orgId, expectedDirection, title.person_id, title.empresa_id, titleId]);
      const a = adt.rows[0]; if (!a) throw notFound("Adiantamento");
      if (D(d.amount).gt(D(a.paid_amount).minus(a.usado))) throw err("PAYMENT_EXCEEDS_BALANCE", "Crédito do adiantamento insuficiente", { disponivel: money(D(a.paid_amount).minus(a.usado)), pedido: money(d.amount) });
      assertSettlementWithinBalance(title.balance, { amount: d.amount });
      const valor = money(d.amount);
      const s = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,amount,net_amount,adiantamento_id,note,lote_id,created_by) values ($1,$2,$3,'advance_compensation',$4,$4,$5,$6,$7,$8) returning id",
        [ctx.orgId, titleId, d.settlement_date, valor, d.adiantamento_id, d.note ?? `Compensação com o adiantamento`, d.lote_id ?? null, ctx.user.id]);
      await audit(ctx.tx, ctx, "title_settlements", s.rows[0]!.id, "create", { title: titleId, net: valor, adiantamento_id: d.adiantamento_id });
      const af = await depois();
      return { settlement_id: s.rows[0]!.id, title_id: titleId, net_amount: valor, status: af.status, balance: af.balance, bank_movement_id: null, lote_id: d.lote_id ?? null, componentes: [], tarifa_movimento_id: null, credito: null };
    }
    if (d.settlement_kind !== "bank_movement" && (D(tarifa).gt(0) || d.excedente)) throw validation("Tarifa e excedente valem só na baixa com conta bancária");

    // ---- baixa cruzada / compensação com título contrário: como antes ----
    if (d.settlement_kind === "cross_settlement" || d.settlement_kind === "advance_compensation") {
      const input = { amount: d.amount, discount: d.discount ?? "0", penalty: d.penalty ?? "0", interest: d.interest ?? "0", increase: d.increase ?? "0", exchangeAdjustment: d.exchange_adjustment ?? "0" };
      assertSettlementWithinBalance(title.balance, input);
      const net = settlementNet(input);
      /**
       * O QUE O TÍTULO CONTRÁRIO ABATE (semântica B, decisão 285): `amount` é o valor baixado do principal e JÁ INCLUI
       * o desconto, então o que se compensa com o contrário é `amount − desconto` — o desconto é do principal e não
       * existe do outro lado. Antes da semântica B o corpo equivalente era `amount` 90 + desconto 10 e o espelho
       * abatia 90; gravar `amount` (100) no espelho quitaria 10 a mais no contrário. Juros, multa e acréscimo ficam
       * como sempre ficaram: no principal, sem tocar o contrário. Desconto do valor inteiro não deixa nada para
       * compensar → 422 (um espelho de zero não é baixa).
       */
      const compensado = money(D(d.amount).minus(input.discount));
      if (!D(compensado).gt(0)) throw validation("Na baixa cruzada o desconto não pode ser o valor inteiro: não sobra nada para compensar com o título contrário");
      if (!d.cross_title_id) throw validation("Título contrário obrigatório para baixa cruzada");
      /**
       * AUTORIZAÇÃO COMPOSTA — A OPERAÇÃO MUTA DOIS TÍTULOS, ENTÃO EXIGE AS DUAS CAPACIDADES.
       *
       * A PR #42 fechou a fronteira da ROTA (capacidade da rota ∧ direction do registro). Mas a baixa
       * cruzada é, por projeto, uma operação sobre um PAR de variantes opostas: ela grava uma linha de
       * baixa no título contrário. Exigir só `payables.settle` para gravar num recebível seria a
       * capacidade de uma família autorizando escrita na outra — o mesmo OR que a decisão 184 proibiu,
       * agora por dentro. Escopo de empresa e RLS NÃO substituem capacidade: respondem a outra pergunta.
       *
       * A conferência vem ANTES de tocar no registro contrário de propósito. Assim o 403 fala apenas do
       * CHAMADOR — não revela que aquele UUID existe, nem de que variante ele é. Depois disso, tudo que
       * é do REGISTRO (inexistente, outro tenant, fora de escopo, excluído, direction errada) cai na
       * MESMA 404, como no resto da entidade.
       */
      const contraria = expectedDirection === "payable" ? "receivable" : "payable";
      requirePermission(ctx, permOf(contraria, "settle"));
      const ct = await ctx.tx.query<{ direction: string; balance: string; status: string; empresa_id: string }>("select direction, balance, status, empresa_id from erp.financial_titles where id=$1 and organization_id=$2 and direction=$3 and deleted_at is null for update", [d.cross_title_id, ctx.orgId, contraria]);
      if (!ct.rows[0]) throw notFound("Título");
      await exigirEmpresaVisivel(ctx, ct.rows[0].empresa_id, "Título");
      /**
       * ELEGIBILIDADE DE ESTADO DO CONTRÁRIO — A MESMA QUE O PRINCIPAL JÁ TINHA.
       *
       * O principal recusa `cancelled` e `paid` logo acima; o contrário carregava `status` e NÃO o usava.
       * Isso não é assimetria estética, é inconsistência de ledger, e o schema explica por quê:
       *
       *   - `balance` é COLUNA GERADA: `amount - discount - paid_amount` (0004_financial.sql). Cancelar um
       *     título sem baixa não zera nada — a porta oficial de cancelamento exige `paid_amount = 0` —,
       *     então um título CANCELADO continua com `balance > 0` e passa direto pela conferência de saldo.
       *   - `erp.refresh_title_status` começa com `if v_status = 'cancelled' then return`. O gatilho
       *     DELIBERADAMENTE não recalcula título cancelado.
       *
       * Juntando os dois: a linha de baixa entraria `confirmed`, o gatilho não mexeria em
       * `paid_amount`/`status`, e sobraria um settlement confirmado pendurado num título cancelado, com
       * o `balance` gerado sem refletir a baixa. Ledger inconsistente, escrito pela própria operação que
       * esta fatia certifica.
       *
       * Só `open` e `partially_paid` seguem — `partially_paid` continua elegível de propósito: barrar
       * tudo que não fosse `open` seria correção excessiva e quebraria baixa cruzada parcial legítima.
       * Estado de negócio de um registro que o chamador JÁ está autorizado a operar não se disfarça de
       * 404: a uniformização da decisão 184 é para inexistência, tenant, escopo, direction e exclusão.
       */
      if (ct.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Título contrário cancelado");
      if (ct.rows[0].status === "paid") throw err("ALREADY_CONFIRMED", "Título contrário já baixado");
      if (ct.rows[0].status === "previsto") throw err("CONFLICT", MENSAGEM_PREVISTO_SEM_BAIXA);
      /**
       * PERÍODO DOS DOIS LADOS. `assertPeriodOpen` já roda para a empresa do título PRINCIPAL. O título
       * contrário pode ser de OUTRA empresa — não existe no contrato nenhuma regra que exija mesma
       * empresa numa baixa cruzada, e inventar uma aqui seria mudar negócio dentro de um hotfix de
       * autorização. Preservada a possibilidade, a proteção tem de valer para quem for gravado: fechar
       * o período de uma empresa precisa barrar a gravação nela, venha ela por qual porta vier.
       */
      await assertPeriodOpen(ctx.tx, ctx.orgId, ct.rows[0].empresa_id, d.settlement_date);
      if (D(ct.rows[0].balance).lt(compensado)) throw err("PAYMENT_EXCEEDS_BALANCE", "Saldo do título contrário insuficiente");
      // A linha ESPELHO recebe trilha própria: são duas linhas de `title_settlements`, e um auditor
      // precisa reconstruir os DOIS lados. Sem `returning id` só o lado principal tinha rastro.
      const espelho = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,cross_title_id,amount,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$6,$7,$8) returning id", [ctx.orgId, d.cross_title_id, d.settlement_date, d.settlement_kind, titleId, compensado, d.note ?? `Baixa cruzada com ${title.number}`, ctx.user.id]);
      await audit(ctx.tx, ctx, "title_settlements", espelho.rows[0]!.id, "create", { title: d.cross_title_id, cruzada_com: titleId, lado: "espelho", net: compensado });
      // Preenchido só na operação cruzada: é o que dá ao lado PRINCIPAL a mesma nomeação do par que o
      // espelho já tinha. Baixa comum não inventa metadata de par.
      const ladoPrincipal = { cruzada_com: d.cross_title_id, lado: "principal" as const };
      const s = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,cross_title_id,amount,discount,penalty,interest,increase,foreign_amount,ptax_rate,exchange_adjustment,net_amount,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id",
        [ctx.orgId, titleId, d.settlement_date, d.settlement_kind, d.bank_account_id ?? null, null, d.cross_title_id ?? null, money(d.amount), money(input.discount), money(input.penalty), money(input.interest), money(input.increase), d.foreign_amount ?? null, d.ptax_rate ?? null, money(input.exchangeAdjustment), net, d.note ?? null, ctx.user.id]);
      await audit(ctx.tx, ctx, "title_settlements", s.rows[0]!.id, "create", { title: titleId, net, ...ladoPrincipal });
      const af = await depois();
      return { settlement_id: s.rows[0]!.id, title_id: titleId, net_amount: net, status: af.status, balance: af.balance, bank_movement_id: null, lote_id: null, componentes: [], tarifa_movimento_id: null, credito: null };
    }

    // ---- baixa bancária (semântica B) ----
    const v = conferirValoresDaBaixa(title.balance, { valor: d.amount, desconto: d.discount, juros: d.interest, multa: d.penalty, acrescimo: d.increase, ajusteCambial: d.exchange_adjustment, tarifa, excedente: d.excedente ?? null });
    if (!d.bank_account_id) throw validation("Conta bancária obrigatória");
    const naturezas = d.naturezas ?? await lerNaturezasPadrao(ctx);
    // o movimento COPIA o rateio gravado no título e não o reconfere (`rateioJaGravado`, decisão 256): natureza ou
    // centro inativado/excluído depois da emissão não pode deixar o título em aberto sem baixa
    const lines = await ctx.tx.query<LinhaDoRateioDoTitulo>("select financial_category_id, cost_center_id, chart_account_id, harvest_id, percentage from erp.title_apportionments where title_id=$1", [titleId]);
    // Título SEM rateio (acervo): os componentes não têm de onde tirar centro e safra. Juros, multa e acréscimo ficam
    // dentro do principal (como sem natureza configurada); a tarifa e o excedente, que só existem separados, são
    // recusados com o motivo — antes saía o técnico "Rateio base vazio".
    const semRateio = lines.rows.length === 0;
    if (semRateio && (D(v.tarifa).gt(0) || D(v.credito).gt(0))) throw validation(MENSAGEM_TITULO_SEM_RATEIO);
    // Componentes em lançamentos separados: só com "separate", sem movimento compartilhado (o "Único" do lote é um
    // movimento só) e com a natureza padrão configurada para a direção. Sem natureza: dentro do principal, como hoje.
    const separados: ComponenteSeparado[] = [];
    if (d.movement_mode === "separate" && !d.shared_movement_id && !semRateio) {
      for (const [componente, valor] of [["juros", v.juros], ["multa", v.multa], ["acrescimo", v.acrescimo]] as const) {
        const naturezaId = naturezas[chaveDaNaturezaPadrao(componente, expectedDirection)];
        if (D(valor).gt(0) && naturezaId) separados.push({ componente, valor, naturezaId });
      }
    }
    if (D(v.tarifa).gt(0)) {
      if (!naturezas.tarifa_bancaria_id) throw validation(MENSAGEM_TARIFA_SEM_NATUREZA);
      separados.push({ componente: "tarifa", valor: v.tarifa, naturezaId: naturezas.tarifa_bancaria_id });
    }
    await conferirNaturezasPadrao(ctx, separados);
    // F9: o imóvel rural do LCDPR da baixa — o MESMO no principal, nos componentes, na baixa e no crédito do excedente.
    const imovelRuralId = await resolverImovelDaBaixa(ctx, d.imovel_rural_id, title.empresa_id);
    const principalValor = money(D(v.liquidoTotal).minus(sum(separados.filter((c) => c.componente !== "tarifa").map((c) => c.valor))));
    let movementId: string | null = d.shared_movement_id ?? null;
    // Desconto de 100% (o título inteiro abatido): não há caixa, então não há movimento principal.
    if (!movementId && D(principalValor).gt(0)) {
      movementId = await createBankMovement(ctx, { empresaId: title.empresa_id, bankAccountId: d.bank_account_id, date: d.settlement_date, type: title.direction === "payable" ? "out" : "in", amount: principalValor, interest: "0", document: title.number, note: d.note ?? `Baixa do título ${title.number}`, proprietaryId: title.proprietary_id, personId: title.person_id, harvestId: title.harvest_id, isDeductible: title.is_deductible, sourceType: "title_settlements", sourceId: titleId, apportionment: lines.rows.map((l) => ({ financialCategoryId: l.financial_category_id, costCenterId: l.cost_center_id, chartAccountId: l.chart_account_id, harvestId: l.harvest_id, percentage: l.percentage })), rateioJaGravado: true, imovelRuralId });
    }
    const net = money(D(v.liquidoTotal).minus(v.credito));
    const naturezaDesconto = D(v.desconto).gt(0) ? naturezas[chaveDaNaturezaPadrao("desconto", expectedDirection)] : null;
    const s = await ctx.tx.query<{ id: string }>("insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,cross_title_id,amount,discount,penalty,interest,increase,foreign_amount,ptax_rate,exchange_adjustment,net_amount,note,created_by,tarifa,lote_id,natureza_desconto_id,imovel_rural_id) values ($1,$2,$3,'bank_movement',$4,$5,null,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id",
      [ctx.orgId, titleId, d.settlement_date, d.bank_account_id, movementId, v.aplicado, v.desconto, v.multa, v.juros, v.acrescimo, d.foreign_amount ?? null, d.ptax_rate ?? null, v.ajusteCambial, net, d.note ?? null, ctx.user.id, D(v.tarifa).gt(0) ? v.tarifa : null, d.lote_id ?? null, naturezaDesconto, imovelRuralId]);
    const sid = s.rows[0]!.id;
    await audit(ctx.tx, ctx, "title_settlements", sid, "create", { title: titleId, net, ...(d.lote_id ? { lote_id: d.lote_id } : {}) });
    const tituloDaBaixa: TituloDaBaixa = { id: titleId, direction: title.direction, empresa_id: title.empresa_id, number: title.number, person_id: title.person_id, proprietary_id: title.proprietary_id, harvest_id: title.harvest_id, is_deductible: title.is_deductible };
    const lancados = await lancarComponentesDaBaixa(ctx, { baixaId: sid, titulo: tituloDaBaixa, contaId: d.bank_account_id, data: d.settlement_date, componentes: separados, rateioDoTitulo: lines.rows, imovelRuralId });
    const credito = D(v.credito).gt(0) ? await gerarCreditoDoExcedente(ctx, { baixaId: sid, titulo: tituloDaBaixa, data: d.settlement_date, contaId: d.bank_account_id, movimentoId: movementId!, valor: v.credito, loteId: d.lote_id ?? null, rateioDoTitulo: lines.rows, imovelRuralId }) : null;
    const af = await depois();
    return {
      settlement_id: sid, title_id: titleId, net_amount: net, status: af.status, balance: af.balance, bank_movement_id: movementId, lote_id: d.lote_id ?? null,
      componentes: lancados.filter((c) => c.componente !== "tarifa"), tarifa_movimento_id: lancados.find((c) => c.componente === "tarifa")?.bank_movement_id ?? null, credito
    };
  }

  /**
   * Rateio do movimento ÚNICO do lote: a união dos rateios dos títulos, cada um escalado ao líquido daquele título
   * (`ratearPorProporcao`, pelo percentual gravado), somado por natureza × centro × conta × safra. Título sem rateio
   * (acervo) deixa o movimento sem rateio, como antes.
   */
  function rateioDoMovimentoUnico(elegiveis: readonly { id: string; liquido: string }[], rateios: readonly (LinhaDoRateioDoTitulo & { title_id: string })[]) {
    const porChave = new Map<string, { financialCategoryId: string; costCenterId: string; chartAccountId: string | null; harvestId: string | null; amount: string }>();
    for (const e of elegiveis) {
      const base = rateios.filter((r) => r.title_id.toLowerCase() === e.id.toLowerCase());
      if (!base.length) return undefined;
      if (D(e.liquido).isZero()) continue;
      for (const l of ratearPorProporcao(e.liquido, base.map((b) => ({ ...b, amount: b.percentage })))) {
        const chave = [l.financial_category_id, l.cost_center_id, l.chart_account_id ?? "", l.harvest_id ?? ""].join("|");
        const atual = porChave.get(chave);
        if (atual) atual.amount = money(D(atual.amount).plus(l.amount));
        else porChave.set(chave, { financialCategoryId: l.financial_category_id, costCenterId: l.cost_center_id, chartAccountId: l.chart_account_id, harvestId: l.harvest_id, amount: l.amount });
      }
    }
    const linhas = [...porChave.values()].filter((l) => !D(l.amount).isZero());
    return linhas.length ? linhas : undefined;
  }

  // ---------- Movimentos bancários ----------
  const bmSchema = z.object({ empresa_id: uuid.optional().nullable(), bank_account_id: uuid, movement_date: date, type: z.enum(["in", "out"]), category_type: z.enum(["in", "out", "internal_transfer", "financing", "check_return"]).default("in"), destination_account_id: uuid.optional().nullable(), amount: dec, interest: dec.default("0"), document: z.string().optional().nullable(), generates_obligation: z.boolean().default(false), is_deductible: z.boolean().default(false), note: z.string().optional().nullable(), proprietary_id: uuid.optional().nullable(), person_id: uuid.optional().nullable(), harvest_id: uuid.optional().nullable(), apportionment: apportionmentSchema.optional(),
    // F9 (aditivos; a web anterior não manda): a TOP do movimento e o imóvel rural do LCDPR (ausente = o padrão da empresa).
    tipo_operacao_id: uuid.optional().nullable(), imovel_rural_id: uuid.optional().nullable() });
  app.get("/financial/bank-movements", async (req) => runService(app, req, "bank_movements.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    const where = ["m.organization_id=$1", "m.deleted_at is null"]; const params: unknown[] = [ctx.orgId];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (f.bank_account_id) add("m.bank_account_id=?", f.bank_account_id);
    if (f.start_date) add("m.movement_date>=?", f.start_date); if (f.end_date) add("m.movement_date<=?", f.end_date);
    if (f.start_value) add("m.amount>=?", f.start_value); if (f.end_value) add("m.amount<=?", f.end_value);
    if (f.proprietary_id) add("m.proprietary_id=?", f.proprietary_id); if (f.harvest_id) add("m.harvest_id=?", f.harvest_id); if (f.person_id) add("m.person_id=?", f.person_id);
    if (f.type) add("m.type=?", f.type); if (f.category_type) add("m.category_type=?", f.category_type);
    if (f.category_id) add("exists (select 1 from erp.bank_movement_apportionments a where a.movement_id=m.id and a.financial_category_id=?)", f.category_id);
    if (f.status) add("m.status=?", f.status); else where.push("m.status='confirmed'");
    if (f.empresa_id) add("m.empresa_id=?", f.empresa_id);
    where.push(...empresaScope(ctx, "m", params, { nullable: true, ignoreSelected: Boolean(f.empresa_id) }));
    const w = where.join(" and ");
    const tot = await ctx.tx.query<{ n: string; in_amount: string; out_amount: string; interest: string }>(`select count(*) n, coalesce(sum(case when m.type='in' then m.amount end),0) in_amount, coalesce(sum(case when m.type='out' then m.amount end),0) out_amount, coalesce(sum(m.interest),0) interest from erp.bank_movements m where ${w}`, params);
    const r = await ctx.tx.query(`select m.*, ba.code as account_code, ba.agency, ba.account_number, ba.description as bank_account_name, p.name as person_name, pr.name as proprietary_name, u.name as created_by_name, (select count(*) from erp.attachments a where a.entity='bank_movement' and a.entity_id=m.id)::int as attachment_count from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.users u on u.id=m.created_by where ${w} order by m.movement_date desc, m.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return paginaComIdGlobal(ctx, "bank_movements", { items: r.rows as Record<string, unknown>[], total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { in: tot.rows[0]!.in_amount, out: tot.rows[0]!.out_amount, interest: tot.rows[0]!.interest, net: money(D(tot.rows[0]!.in_amount).minus(tot.rows[0]!.out_amount)) } });
  }));
  app.get("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.view", async (ctx) => {
    const { id } = req.params as { id: string };
    // F9 (aditivos): o nome do imóvel rural do LCDPR e a TOP do movimento (as colunas já vêm em `m.*`).
    const r = await ctx.tx.query("select m.*, ba.description as bank_account_name, ba.bank_code, ba.agency, ba.account_number, f.name as empresa_name, p.name as person_name, p.document as person_document, pr.name as proprietary_name, da.description as destination_account_name, ir.nome as imovel_rural_nome, tpo.codigo as tipo_operacao_codigo, tov.nome as tipo_operacao_nome, tov.versao as tipo_operacao_versao from erp.bank_movements m join erp.bank_accounts ba on ba.id=m.bank_account_id left join erp.empresas f on f.id=m.empresa_id left join erp.people p on p.id=m.person_id left join erp.people pr on pr.id=m.proprietary_id left join erp.bank_accounts da on da.id=m.destination_account_id left join erp.imoveis_rurais ir on ir.id=m.imovel_rural_id and ir.organization_id=m.organization_id left join erp.tipos_operacao tpo on tpo.id=m.tipo_operacao_id and tpo.organization_id=m.organization_id left join erp.tipos_operacao_versoes tov on tov.id=m.tipo_operacao_versao_id and tov.organization_id=m.organization_id where m.id=$1 and m.organization_id=$2 and m.deleted_at is null" + scopedById(ctx, "m", id, { nullable: true }).sql, scopedById(ctx, "m", id, { nullable: true }).params); if (!r.rows[0]) throw notFound("Movimento");
    const app_ = await ctx.tx.query("select a.*, fc.name as category_name, fc.code as category_code, cc.name as cost_center_name, ca.description as chart_account_name from erp.bank_movement_apportionments a join erp.financial_categories fc on fc.id=a.financial_category_id join erp.cost_centers cc on cc.id=a.cost_center_id left join erp.chart_accounts ca on ca.id=a.chart_account_id where a.movement_id=$1", [id]);
    // F8 (aditivo): `direction` de cada título, para a web ligar a baixa à rota certa da variante.
    const settlements = await ctx.tx.query("select s.id, s.title_id, t.number, t.code, t.direction, s.net_amount from erp.title_settlements s join erp.financial_titles t on t.id=s.title_id where s.bank_movement_id=$1 and s.status='confirmed'", [id]);
    return { ...r.rows[0], apportionments: app_.rows, settlements: settlements.rows };
  }));
  app.post("/financial/bank-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "bank_movements.create", async (ctx) => {
    const d = bmSchema.parse(req.body);
    if (d.category_type === "internal_transfer" && !d.destination_account_id) throw validation("Conta destino obrigatória em transferência interna");
    if (d.category_type === "internal_transfer" && d.imovel_rural_id) throw validation(MENSAGEM_IMOVEL_NA_TRANSFERENCIA, [{ path: ["imovel_rural_id"], message: MENSAGEM_IMOVEL_NA_TRANSFERENCIA }]);
    if (d.category_type !== "internal_transfer" && !d.apportionment?.length) throw validation("Rateio (natureza/centro de resultado) obrigatório");
    const geraObrigacao = d.generates_obligation && Boolean(d.person_id) && Boolean(d.apportionment?.length);
    // "Gera obrigação": o título gerado precisa de EMPRESA. Antes, sem empresa no corpo nem selecionada, ele caía na
    // 1ª empresa por código (que o usuário podia nem enxergar) e o movimento ficava nulo. Agora: a empresa pedida
    // (ou a selecionada), conferida; nenhuma → 422. Movimento e título nascem nela.
    const empresaDoMovimento = d.empresa_id ?? ctx.empresaId ?? null;
    if (geraObrigacao && !empresaDoMovimento) throw validation("Informe a empresa: o título gerado pelo movimento precisa de empresa");
    await exigirEmpresaDeLancamento(ctx, geraObrigacao ? empresaDoMovimento : d.empresa_id);
    /**
     * F9 (decisão 286): a TOP da família do movimento (a mesma 422 para a de outra família, inativa, excluída ou de
     * outra organização), com a versão corrente; `documentoTroca` desligado recusa a natureza, o centro e a conta
     * diferentes dos padrões. O imóvel rural: o informado (conferido contra a empresa do movimento), nenhum (`null`) ou,
     * ausente, o padrão da empresa — resolvido AQUI para o movimento e a baixa do "gera obrigação" levarem o mesmo.
     */
    const top = d.tipo_operacao_id ? await resolverTopParaLancamento(ctx, FAMILIA_DO_MOVIMENTO, d.tipo_operacao_id) : null;
    await conferirTrocaDosPadroes(ctx, top, {
      naturezaIds: (d.apportionment ?? []).map((a) => a.financial_category_id), centroCustoIds: (d.apportionment ?? []).map((a) => a.cost_center_id), contaBancariaId: d.bank_account_id
    });
    const imovelRuralId = await resolverImovelDoMovimento(ctx, { pedido: d.imovel_rural_id, empresaId: empresaDoMovimento, categoria: d.category_type });
    return (await idempotent(ctx.tx, ctx.orgId, idem(req), d, async () => {
      const id = await createBankMovement(ctx, { empresaId: empresaDoMovimento, bankAccountId: d.bank_account_id, date: d.movement_date, type: d.type, categoryType: d.category_type, destinationAccountId: d.destination_account_id ?? null, amount: d.amount, interest: d.interest, document: d.document, note: d.note, proprietaryId: d.proprietary_id, personId: d.person_id, harvestId: d.harvest_id, isDeductible: d.is_deductible, generatesObligation: d.generates_obligation, sourceType: "manual", sourceId: undefined, apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, chartAccountId: a.chart_account_id ?? null, harvestId: a.harvest_id ?? null, percentage: a.percentage, amount: a.amount })),
        imovelRuralId, tipoOperacaoId: top?.tipoOperacaoId ?? null, tipoOperacaoVersaoId: top?.tipoOperacaoVersaoId ?? null });
      // "Gera obrigação": cria título correspondente já baixado por este movimento (ex.: saída sem título prévio).
      // A baixa passa pela `settle` (saldo conferido, trilha) com o movimento já criado — não mais um INSERT cru. F9: o
      // título leva a TOP do movimento, e a baixa o mesmo imóvel do movimento.
      if (geraObrigacao && empresaDoMovimento && d.person_id && d.apportionment?.length) {
        const c = await createTitles(ctx, { empresaId: empresaDoMovimento, direction: d.type === "out" ? "payable" : "receivable", number: d.document ?? `MOV-${id.slice(0, 8)}`, personId: d.person_id, amount: money(d.amount), emissionDate: d.movement_date, dueDate: d.movement_date, note: d.note ?? "Gerado pelo movimento bancário", isDeductible: d.is_deductible, apportionment: d.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })), sourceType: "bank_movements", sourceId: id,
          tipoOperacaoId: top?.tipoOperacaoId ?? null, tipoOperacaoVersaoId: top?.tipoOperacaoVersaoId ?? null });
        await settle(ctx, c.ids[0]!, d.type === "out" ? "payable" : "receivable", { settlement_date: d.movement_date, settlement_kind: "bank_movement", bank_account_id: d.bank_account_id, amount: money(d.amount), note: "Baixa automática pelo movimento", movement_mode: "single", shared_movement_id: id, imovel_rural_id: imovelRuralId });
      }
      await audit(ctx.tx, ctx, "bank_movements", id, "create", top || imovelRuralId ? { ...(top ? { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId } : {}), ...(imovelRuralId ? { imovelRuralId } : {}) } : undefined);
      return { id };
    })).result;
  })));
  /**
   * MOVIMENTO CONFIRMADO É IMUTÁVEL (F8, decisão 285; o gatilho `trg_bm_confirmado_imutavel` da 0042 é o fundo).
   * Só a observação e o documento mudam; qualquer outro campo presente e DIFERENTE do gravado — data, valor, juros,
   * conta, tipo, categoria, destino, empresa, pessoa, proprietário, safra, dedutível, "gera obrigação" — ou um
   * rateio → 409: a correção é estorno + movimento novo. O rateio não é mais apagado e regravado (o `erp_app` perdeu
   * DELETE em `bank_movement_apportionments`). A presença é lida no corpo BRUTO (o esquema tem padrões).
   */
  app.put("/financial/bank-movements/:id", async (req) => runService(app, req, "bank_movements.edit", async (ctx) => {
    const { id } = req.params as { id: string };
    const bruto = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const d = bmSchema.partial().parse(bruto);
    const veio = (k: string) => Object.prototype.hasOwnProperty.call(bruto, k) && bruto[k] !== undefined;
    const cur = await ctx.tx.query<{ source_type: string | null; empresa_id: string | null; movement_date: string; status: string; bank_account_id: string; type: string; category_type: string; destination_account_id: string | null; amount: string; interest: string; person_id: string | null; proprietary_id: string | null; harvest_id: string | null; is_deductible: boolean; generates_obligation: boolean; imovel_rural_id: string | null; tipo_operacao_id: string | null }>(
      "select source_type, empresa_id, movement_date, status, bank_account_id, type, category_type, destination_account_id, amount, interest, person_id, proprietary_id, harvest_id, is_deductible, generates_obligation, imovel_rural_id::text as imovel_rural_id, tipo_operacao_id::text as tipo_operacao_id from erp.bank_movements where id=$1 and organization_id=$2 and deleted_at is null for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Movimento");
    const c = cur.rows[0];
    if (c.status === "cancelled") throw err("ALREADY_CANCELLED", "Movimento cancelado");
    if (c.source_type && c.source_type !== "manual") throw err("CONFLICT", "Movimento gerado por outro documento: altere pela origem");
    const mudou = [
      veio("movement_date") && d.movement_date !== c.movement_date,
      veio("amount") && !D(d.amount!).eq(c.amount),
      veio("interest") && !D(d.interest!).eq(c.interest),
      veio("bank_account_id") && !mesmoId(d.bank_account_id, c.bank_account_id),
      veio("type") && d.type !== c.type,
      veio("category_type") && d.category_type !== c.category_type,
      veio("destination_account_id") && !mesmoId(d.destination_account_id, c.destination_account_id),
      veio("empresa_id") && !mesmoId(d.empresa_id, c.empresa_id),
      veio("person_id") && !mesmoId(d.person_id, c.person_id),
      veio("proprietary_id") && !mesmoId(d.proprietary_id, c.proprietary_id),
      veio("harvest_id") && !mesmoId(d.harvest_id, c.harvest_id),
      veio("is_deductible") && d.is_deductible !== c.is_deductible,
      veio("generates_obligation") && d.generates_obligation !== c.generates_obligation,
      veio("apportionment"),
      // F9: o imóvel rural e a TOP do movimento confirmado também não mudam (a correção é estorno + movimento novo).
      veio("imovel_rural_id") && !mesmoId(d.imovel_rural_id, c.imovel_rural_id),
      veio("tipo_operacao_id") && !mesmoId(d.tipo_operacao_id, c.tipo_operacao_id)
    ].some(Boolean);
    if (mudou) throw err("CONFLICT", "Movimento bancário confirmado não se altera: estorne e lance outro.");
    await assertPeriodOpen(ctx.tx, ctx.orgId, c.empresa_id, c.movement_date);
    const u = await ctx.tx.query("update erp.bank_movements set document=coalesce($3,document), note=coalesce($4,note), updated_at=now() where id=$1 and organization_id=$2 and status='confirmed'", [id, ctx.orgId, veio("document") ? (d.document ?? null) : null, veio("note") ? (d.note ?? null) : null]);
    if (u.rowCount !== 1) throw notFound("Movimento");
    await audit(ctx.tx, ctx, "bank_movements", id, "update", { campos: Object.keys(bruto).filter((k) => bruto[k] !== undefined) });
    return { id };
  }));
  /**
   * Estorno do movimento: o MOTIVO é gravado nas DUAS pontas (antes era descartado). Conciliado → desfazer a
   * conciliação antes; componente da baixa (juros, tarifa…) → estornar a baixa. ROW COUNT = 1 ou 2 (o par).
   */
  app.post("/financial/bank-movements/:id/cancel", async (req) => runService(app, req, "bank_movements.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const d = z.object({ reason: MOTIVO.optional() }).parse(req.body ?? {});
    const cur = await ctx.tx.query<{ status: string; empresa_id: string | null; movement_date: string; transfer_pair_id: string | null; reconciled_at: string | null; componente: boolean }>("select status, empresa_id, movement_date, transfer_pair_id::text as transfer_pair_id, reconciled_at::text as reconciled_at, (title_settlement_id is not null or lote_baixa_id is not null) as componente from erp.bank_movements where id=$1 and organization_id=$2 and deleted_at is null for update", [id, ctx.orgId]); if (!cur.rows[0]) throw notFound("Movimento"); await exigirEmpresaVisivel(ctx, cur.rows[0].empresa_id, "Movimento"); if (cur.rows[0].status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
    const pontas = [...new Set([id.toLowerCase(), ...(cur.rows[0].transfer_pair_id ? [cur.rows[0].transfer_pair_id.toLowerCase()] : [])])];
    const conciliado = await ctx.tx.query("select 1 from erp.bank_movements where id = any($1::uuid[]) and organization_id=$2 and reconciled_at is not null", [pontas, ctx.orgId]);
    if (conciliado.rowCount) throw err("CONFLICT", "Movimento conciliado: desfaça a conciliação antes");
    if (cur.rows[0].componente) throw err("CONFLICT", "Movimento de baixa: estorne a baixa");
    const linked = await ctx.tx.query("select 1 from erp.title_settlements where bank_movement_id=$1 and status='confirmed' limit 1", [id]); if (linked.rowCount) throw err("CONFLICT", "Movimento vinculado a baixa de título: cancele a baixa");
    await assertPeriodOpen(ctx.tx, ctx.orgId, cur.rows[0].empresa_id, cur.rows[0].movement_date);
    const u = await ctx.tx.query("update erp.bank_movements set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, updated_at=now() where id = any($1::uuid[]) and organization_id=$2 and status='confirmed'", [pontas, ctx.orgId, d.reason ?? null, ctx.user.id]);
    if (u.rowCount !== pontas.length) throw notFound("Movimento");
    await audit(ctx.tx, ctx, "bank_movements", id, "cancel", { reason: d.reason ?? null, pontas: pontas.length });
    return { id, status: "cancelled" };
  }));
  /**
   * SALDO DE CONTA BANCÁRIA É NÚMERO DA ORGANIZAÇÃO (docs/MULTI-COMPANY-CONTRACT.md §7, "Saldo bancário").
   *
   * A conta é cadastro da organização e o `opening_balance` dela não tem empresa — não é decomponível por
   * empresa sem inventar rateio. Por isso a porta exige CAPACIDADE DE ORGANIZAÇÃO (`bank_accounts.view`), e
   * não apenas a permissão financeira de empresa: uma permissão company-scoped não pode devolver em silêncio
   * um agregado que soma movimentos de empresas que o usuário não enxerga. A permissão financeira continua
   * exigida por cima — ninguém passa a ver o que não via antes.
   */
  app.get("/financial/bank-accounts/balances", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "bank_movements.view");
    // O saldo sai de `erp.movimentos_conta_organizacao`, não da view: a view respeita a RLS empresarial de
    // `erp.bank_movements` (corretamente, para leitura normal), e sob ela o `opening_balance` da ORGANIZAÇÃO
    // somaria só os movimentos das empresas do usuário — um saldo que não fecha com o extrato do banco.
    const r = await ctx.tx.query("select a.id, a.code, a.description, a.type, a.bank_code, a.agency, a.account_number, a.opening_balance, a.credit_limit, (a.opening_balance + coalesce(s.delta,0))::text as balance from erp.bank_accounts a left join (select bank_account_id, sum(case when type='in' then amount+interest else -(amount+interest) end) delta from erp.movimentos_conta_organizacao() group by 1) s on s.bank_account_id=a.id where a.organization_id=$1 and a.deleted_at is null and a.is_active order by a.code", [ctx.orgId]);
    return { items: r.rows, total_balance: money(r.rows.reduce((s, x) => s.plus((x as { balance: string }).balance), D(0))) };
  }));
  // Saldo inicial de conta (tela "Saldo Inicial"): movimento de abertura
  app.post("/financial/opening-movements", async (req, reply) => reply.status(201).send(await runService(app, req, "opening_movements.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, date: date, amount: dec, proprietary_id: uuid.optional().nullable(), document: z.string().optional().nullable(), note: z.string().optional().nullable(), apportionment: apportionmentSchema.optional() }).parse(req.body);
    const exists = await ctx.tx.query("select 1 from erp.bank_movements where organization_id=$1 and bank_account_id=$2 and category_type='opening_balance' and status='confirmed'", [ctx.orgId, d.bank_account_id]); if (exists.rowCount) throw err("DUPLICATE_DOCUMENT", "Conta já possui saldo inicial lançado");
    const id = await createBankMovement(ctx, { empresaId: ctx.empresaId, bankAccountId: d.bank_account_id, date: d.date, type: "in", categoryType: "opening_balance", amount: d.amount, document: d.document, note: d.note ?? "Saldo inicial", proprietaryId: d.proprietary_id, sourceType: "opening_movement", apportionment: d.apportionment?.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
    return { id };
  })));

  // ---------- Fluxo bancário (análise) ----------
  // Fluxo de caixa por CONTA: parte do `opening_balance` da conta (sem empresa) e acumula saldo — mesmo
  // contrato do saldo bancário: capacidade de organização + a permissão financeira por cima.
  app.get("/financial/cash-flow", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "cash_flow.view");
    const q = z.object({ account_ids: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(","))), period: z.enum(["daily", "monthly", "yearly"]).default("monthly"), mode: z.enum(["synthetic", "analytic"]).default("synthetic"), start_date: date, end_date: date }).parse(req.query);
    const trunc = q.period === "daily" ? "day" : q.period === "monthly" ? "month" : "year";
    // Mesmo contrato do saldo: a conta é da organização, então o acumulado dela também é.
    const opening = await ctx.tx.query<{ v: string }>("select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end) from erp.movimentos_conta_organizacao($2::uuid[]) m where m.movement_date < $3),0) as v from erp.bank_accounts a where a.organization_id=$1 and a.id = any($2::uuid[])", [ctx.orgId, q.account_ids, q.start_date]);
    const rows = await ctx.tx.query<{ period: string; in_amount: string; out_amount: string }>(`select to_char(date_trunc('${trunc}', movement_date),'YYYY-MM-DD') as period, coalesce(sum(case when type='in' then amount+interest end),0) in_amount, coalesce(sum(case when type='out' then amount+interest end),0) out_amount from erp.movimentos_conta_organizacao($1::uuid[], $2, $3) group by 1 order by 1`, [q.account_ids, q.start_date, q.end_date]);
    let bal = D(opening.rows[0]!.v);
    const periods = rows.rows.map((r) => { bal = bal.plus(r.in_amount).minus(r.out_amount); return { ...r, balance: money(bal) }; });
    // O analítico mostra os movimentos DA CONTA, com a mesma autoridade do sintético — inclusive as
    // categorias, que a função já traz (as linhas-filhas herdam a visibilidade do movimento pai).
    const detail = q.mode === "analytic" ? (await ctx.tx.query("select id, movement_date, type, amount, interest, note, document, account_code, categories from erp.movimentos_conta_organizacao($1::uuid[], $2, $3) order by movement_date, created_at", [q.account_ids, q.start_date, q.end_date])).rows : [];
    return { opening_balance: money(opening.rows[0]!.v), closing_balance: money(bal), periods, movements: detail };
  }));

  // ---------- Conciliação OFX ----------
  app.get("/financial/ofx-imports", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => { const f = req.query as Record<string, string>; const where = ["i.organization_id=$1", "i.deleted_at is null"]; const params: unknown[] = [ctx.orgId]; if (f.bank_account_id) { params.push(f.bank_account_id); where.push(`i.bank_account_id=$${params.length}`); } if (f.description) { params.push(`%${f.description}%`); where.push(`i.description ilike $${params.length}`); } if (f.start_date) { params.push(f.start_date); where.push(`i.start_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`i.end_date<=$${params.length}`); } const r = await ctx.tx.query(`select i.*, ba.description as bank_account_name, (select count(*) from erp.ofx_transactions t where t.import_id=i.id)::int as transaction_count, (select count(*) from erp.ofx_transactions t where t.import_id=i.id and t.status='matched')::int as matched_count from erp.ofx_imports i join erp.bank_accounts ba on ba.id=i.bank_account_id where ${where.join(" and ")} order by i.created_at desc`, params); return paginaComIdGlobal(ctx, "ofx_imports", { items: r.rows as Record<string, unknown>[], total: r.rowCount }); }));
  /**
   * Importa OFX (conteúdo textual). F8: a CONTA é conferida (desta organização, viva e ativa — senão a MESMA 422
   * para inexistente, de outra organização, excluída ou inativa); o extrato é lido em DECIMAL pelo domínio (vírgula
   * decimal, milhar; antes `Number(...)` virava NaN em "1.234,56"); transação ilegível vai para `recusadas` com o
   * motivo; e a conciliação AUTOMÁTICA só acontece no "Encontrado" ÚNICO (mesma data, mesmo valor com sinal, um
   * só candidato e 1:1 no arquivo), com ROW COUNT no movimento — zero linhas deixa a transação pendente.
   */
  app.post("/financial/ofx-imports", async (req, reply) => reply.status(201).send(await runService(app, req, "ofx_imports.create", async (ctx) => {
    const d = z.object({ bank_account_id: uuid, description: z.string().min(1), content: z.string().min(10) }).parse(req.body);
    const conta = await ctx.tx.query("select 1 from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null and is_active", [d.bank_account_id, ctx.orgId]);
    if (conta.rowCount !== 1) throw validation("Conta bancária inválida", [{ path: "bank_account_id", message: "Conta bancária inválida" }]);
    const leitura = lerOfx(d.content);
    const txs = leitura.transacoes; if (!txs.length) throw validation("Nenhuma transação encontrada no OFX", leitura.recusadas.length ? { recusadas: leitura.recusadas } : undefined);
    const dates = txs.map((t) => t.data).sort(); const code = await nextCode(ctx.tx, ctx.orgId, "ofx_import");
    const r = await ctx.tx.query<{ id: string }>("insert into erp.ofx_imports(organization_id,code,description,bank_account_id,start_date,end_date,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id", [ctx.orgId, code, d.description, d.bank_account_id, dates[0], dates[dates.length - 1], ctx.user.id]);
    await atribuirIdGlobal(ctx, "ofx_imports", r.rows[0]!.id);
    // Candidatos numa consulta (sem uma por transação): confirmados, não conciliados, da conta, nas datas do arquivo.
    const candidatos = await ctx.tx.query<{ id: string; data: string; valor: string }>(
      "select m.id::text as id, m.movement_date as data, (case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end)::text as valor from erp.bank_movements m"
      + " where m.organization_id=$1 and m.bank_account_id=$2 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null and m.movement_date between $3 and $4",
      [ctx.orgId, d.bank_account_id, dates[0], dates[dates.length - 1]]);
    // Só o "Encontrado" interessa aqui (mesma data e valor, 1:1 no arquivo): janela zero e sem soma de vários.
    const sugestoes = new Map(sugerirConciliacao(txs.map((t) => ({ id: t.fitid, data: t.data, valor: t.valor })), candidatos.rows, { janelaDias: 0, maxItensSoma: 1 }).map((s) => [s.transacaoId, s]));
    let matched = 0;
    for (const t of txs) {
      const ins = await ctx.tx.query<{ id: string }>("insert into erp.ofx_transactions(import_id,organization_id,fitid,posted_date,amount,memo,check_number,bank_movement_id,status) values ($1,$2,$3,$4,$5,$6,$7,null,'pending') on conflict (import_id,fitid) do nothing returning id", [r.rows[0]!.id, ctx.orgId, t.fitid, t.data, t.valor, t.memo, t.numeroCheque]);
      const sug = sugestoes.get(t.fitid);
      if (!ins.rows[0] || sug?.tipo !== "encontrado") continue;
      const movimento = sug.grupos[0]![0]!;
      const m = await ctx.tx.query("update erp.bank_movements set reconciled_at=now(), ofx_transaction_id=$2 where id=$1 and organization_id=$3 and bank_account_id=$4 and status='confirmed' and reconciled_at is null", [movimento, ins.rows[0].id, ctx.orgId, d.bank_account_id]);
      if (m.rowCount !== 1) continue; // fora do recorte da RLS ou conciliado no meio: a transação fica pendente
      const x = await ctx.tx.query("update erp.ofx_transactions set status='matched', bank_movement_id=$2 where id=$1 and organization_id=$3", [ins.rows[0].id, movimento, ctx.orgId]);
      if (x.rowCount !== 1) throw notFound("Transação");
      matched++;
    }
    return { id: r.rows[0]!.id, code, transactions: txs.length, matched, recusadas: leitura.recusadas };
  })));
  app.get("/financial/ofx-imports/:id", async (req) => runService(app, req, "ofx_imports.view", async (ctx) => { const { id } = req.params as { id: string }; const i = await ctx.tx.query("select * from erp.ofx_imports where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]); if (!i.rows[0]) throw notFound(); const t = await ctx.tx.query("select t.*, m.code as movement_code, m.note as movement_note from erp.ofx_transactions t left join erp.bank_movements m on m.id=t.bank_movement_id where t.import_id=$1 order by t.posted_date", [id]); return { ...i.rows[0], transactions: t.rows }; }));
  /**
   * Vínculo manual de uma transação do extrato (F8): a importação é desta organização e viva; transação já
   * conciliada ou ignorada → 409 (desfazer antes — re-conciliar deixava o movimento anterior com `reconciled_at`
   * órfão); o movimento tem de ser da MESMA conta, confirmado, não conciliado e com o MESMO valor com sinal; toda
   * gravação confere ROW COUNT; ignorar também recalcula a situação da importação.
   */
  app.post("/financial/ofx-imports/:id/transactions/:tid/match", async (req) => runService(app, req, "ofx_imports.reconcile", async (ctx) => {
    const { id, tid } = req.params as { id: string; tid: string }; const d = z.object({ bank_movement_id: uuid.optional().nullable(), ignore: z.boolean().default(false), create: z.object({ note: z.string().optional(), apportionment: apportionmentSchema }).optional() }).parse(req.body);
    const imp = await ctx.tx.query<{ bank_account_id: string }>("select bank_account_id from erp.ofx_imports where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!imp.rows[0]) throw notFound("Transação");
    const t = await ctx.tx.query<{ posted_date: string; amount: string; memo: string | null; status: string }>("select posted_date, amount, memo, status from erp.ofx_transactions where id=$1 and import_id=$2 and organization_id=$3 for update", [tid, id, ctx.orgId]); if (!t.rows[0]) throw notFound("Transação");
    if (t.rows[0].status !== "pending") throw err("CONFLICT", "Transação já conciliada ou ignorada: desfaça antes");
    const recalcular = async () => {
      const pending = await ctx.tx.query<{ n: string }>("select count(*) n from erp.ofx_transactions where import_id=$1 and status='pending'", [id]);
      await ctx.tx.query("update erp.ofx_imports set status=$2 where id=$1 and organization_id=$3", [id, Number(pending.rows[0]!.n) === 0 ? "reconciled" : "reconciling", ctx.orgId]);
    };
    if (d.ignore) {
      const g = await ctx.tx.query("update erp.ofx_transactions set status='ignored' where id=$1 and organization_id=$2 and status='pending'", [tid, ctx.orgId]);
      if (g.rowCount !== 1) throw notFound("Transação");
      await recalcular();
      return { id: tid, status: "ignored" };
    }
    let mid = d.bank_movement_id ?? null;
    if (mid) {
      const m = await ctx.tx.query<{ valor: string }>(
        "select (case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end)::text as valor from erp.bank_movements m where m.id=$1 and m.organization_id=$2 and m.bank_account_id=$3 and m.status='confirmed' and m.reconciled_at is null and m.deleted_at is null",
        [mid, ctx.orgId, imp.rows[0].bank_account_id]);
      if (!m.rows[0]) throw notFound("Movimento");
      if (!D(m.rows[0].valor).eq(t.rows[0].amount)) throw validation("O valor do movimento difere do valor do extrato");
    } else if (d.create) {
      mid = await createBankMovement(ctx, { empresaId: ctx.empresaId, bankAccountId: imp.rows[0].bank_account_id, date: t.rows[0].posted_date, type: D(t.rows[0].amount).gte(0) ? "in" : "out", amount: D(t.rows[0].amount).abs().toFixed(2), note: d.create.note ?? t.rows[0].memo ?? "Conciliação OFX", sourceType: "ofx", sourceId: tid, apportionment: d.create.apportionment.map((a) => ({ financialCategoryId: a.financial_category_id, costCenterId: a.cost_center_id, percentage: a.percentage, amount: a.amount })) });
    }
    if (!mid) throw validation("Informe o movimento ou os dados para criar um");
    const mv = await ctx.tx.query("update erp.bank_movements set reconciled_at=now(), ofx_transaction_id=$2 where id=$1 and organization_id=$3 and bank_account_id=$4 and status='confirmed' and reconciled_at is null", [mid, tid, ctx.orgId, imp.rows[0].bank_account_id]);
    if (mv.rowCount !== 1) throw notFound("Movimento");
    const tx = await ctx.tx.query("update erp.ofx_transactions set bank_movement_id=$2, status='matched' where id=$1 and organization_id=$3 and status='pending'", [tid, mid, ctx.orgId]);
    if (tx.rowCount !== 1) throw notFound("Transação");
    await recalcular();
    return { id: tid, status: "matched", bank_movement_id: mid };
  }));
  // Conciliação OFX: `erp.ofx_transactions` é da CONTA (não tem empresa) — agregado de organização.
  app.get("/financial/ofx-report", async (req) => runService(app, req, "bank_accounts.view", async (ctx) => {
    requirePermission(ctx, "ofx_report.view"); const r = await ctx.tx.query("select ba.code as account_code, ba.description as account_name, to_char(t.posted_date,'YYYY-MM') as month, count(*)::int as transactions, count(*) filter (where t.status='matched')::int as matched, count(*) filter (where t.status='pending')::int as pending, count(*) filter (where t.status='ignored')::int as ignored from erp.ofx_transactions t join erp.ofx_imports i on i.id=t.import_id join erp.bank_accounts ba on ba.id=i.bank_account_id where t.organization_id=$1 group by 1,2,3 order by 3 desc, 1", [ctx.orgId]); return { items: r.rows.map((x) => ({ ...(x as Record<string, unknown>), reconciled: (x as { pending: number }).pending === 0 })) }; }));

  // ---------- Previsão orçamentária (valores por categoria × mês) ----------
  app.get("/financial/budget-plannings/:id/values", async (req) => runService(app, req, "budget_plannings.view", async (ctx) => {
    const { id } = req.params as { id: string }; const p = await ctx.tx.query<{ year: number; empresa_id: string | null }>("select year, empresa_id from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "empresa_id", id, { nullable: true }).sql, scopedById(ctx, "empresa_id", id, { nullable: true }).params); if (!p.rows[0]) throw notFound();
    const cats = await ctx.tx.query("select id, code, name, nature, kind, parent_id from erp.financial_categories where organization_id=$1 and deleted_at is null and is_active order by code", [ctx.orgId]);
    const vals = await ctx.tx.query<{ financial_category_id: string; month: number; amount: string }>("select financial_category_id, month, amount from erp.budget_planning_values where planning_id=$1", [id]);
    // O realizado do ano anterior é agregado de TÍTULOS, que têm empresa própria. O filtro pela empresa do
    // PLANEJAMENTO não basta: planejamento da organização (empresa_id nulo) tornava o predicado `true` e somava
    // o realizado de todas as empresas para quem enxerga uma só. O escopo do módulo entra por cima.
    const pp: unknown[] = [ctx.orgId, p.rows[0].year - 1, p.rows[0].empresa_id];
    const prev = await ctx.tx.query<{ financial_category_id: string; total: string }>("select a.financial_category_id, sum(a.amount) total from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.organization_id=$1 and t.status not in ('cancelled','previsto') and extract(year from t.due_date)=$2 and ($3::uuid is null or t.empresa_id=$3)" + empresaScopeSql(ctx, "t.empresa_id", pp) + " group by 1", pp);
    const prevMap = new Map(prev.rows.map((r) => [r.financial_category_id, r.total]));
    return { year: p.rows[0].year, categories: cats.rows.map((c) => ({ ...(c as Record<string, unknown>), previous_year: prevMap.get((c as { id: string }).id) ?? "0.00", months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, vals.rows.find((v) => v.financial_category_id === (c as { id: string }).id && v.month === i + 1)?.amount ?? "0.00"])) })) };
  }));
  app.put("/financial/budget-plannings/:id/values", async (req) => runService(app, req, "budget_plannings.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = z.array(z.object({ financial_category_id: uuid, month: z.number().int().min(1).max(12), amount: dec })).parse(req.body);
    const p = await ctx.tx.query("select 1 from erp.budget_plannings where id=$1 and organization_id=$2" + scopedById(ctx, "empresa_id", id, { nullable: true }).sql, scopedById(ctx, "empresa_id", id, { nullable: true }).params); if (!p.rowCount) throw notFound();
    for (const v of d) await ctx.tx.query("insert into erp.budget_planning_values(planning_id,financial_category_id,month,amount) values ($1,$2,$3,$4) on conflict (planning_id,financial_category_id,month) do update set amount=excluded.amount", [id, v.financial_category_id, v.month, money(v.amount)]);
    return { saved: d.length };
  }));
  // Contas tributárias (títulos marcados como tributo): o recorte `is_tax` vai no SQL da listagem, antes da página.
  app.get("/financial/tax-accounts", async (req) => runService(app, req, "report.tax_accounts.view", async (ctx) => listTitles(ctx, "payable", { ...(req.query as Record<string, unknown>), is_tax: "true" })));
}

/**
 * Parser OFX (SGML ou XML) para STMTTRN — delega ao domínio (`lerOfx`, decimal). `amount` sai como TEXTO decimal
 * com sinal ("-150.50"), nunca `number`: o parser antigo fazia `Number("1.234,56")` = NaN. Transação ilegível não
 * entra (a rota devolve as recusadas com o motivo).
 */
export function parseOfx(content: string): { fitid: string; date: string; amount: string; memo: string | null; checkNumber: string | null }[] {
  return lerOfx(content).transacoes.map((t) => ({ fitid: t.fitid, date: t.data, amount: t.valor, memo: t.memo, checkNumber: t.numeroCheque }));
}
function mapTitle(d: z.infer<typeof titleSchema>, dir: "payable" | "receivable") {
  return { empresaId: d.empresa_id, direction: dir, number: d.number, titleTypeId: d.title_type_id ?? null, personId: d.person_id ?? null, proprietaryId: d.proprietary_id ?? null, branchId: d.branch_id ?? null, paymentType: d.payment_type, recurrenceType: d.recurrence_type ?? null, classification: d.classification, documentType: d.document_type ?? null, isDeductible: d.is_deductible, isTax: d.is_tax, amount: d.amount, discount: d.discount, emissionDate: d.emission_date, dueDate: d.due_date, note: d.note, harvestId: d.harvest_id ?? null, appropriation: d.appropriation, appropriationType: d.appropriation_type ?? null, sourceType: "manual" } as const;
}
