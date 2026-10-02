import { D, money } from "@agro/shared";
import { ratearPorProporcao, rotuloFinanceiro, type ChaveNaturezaPadrao, type ComponenteBaixa } from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { audit } from "./service.js";
import { err, fromPgError, validation } from "./errors.js";
import { createBankMovement, createTitles } from "../services/financial-core.js";

/**
 * A BAIXA DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — as peças que a `settle()` de `routes/financial.ts`
 * usa: naturezas padrão da baixa, componentes em lançamentos separados, tarifa do lote, crédito do excedente e a
 * conferência de tenant das referências do título.
 *
 * Toda criação de título e de movimento passa por `createTitles`/`createBankMovement` (ID Global, período,
 * conta viva); as colunas novas da 0042 entram por UPDATE logo depois, sempre com ROW COUNT conferido — sob a RLS
 * uma linha fora do recorte responde zero, e zero sem conferência viraria sucesso sem efeito.
 */

/** As nove naturezas padrão da organização (`erp.financeiro_naturezas_padrao`); nula = não configurada. */
export type NaturezasPadrao = Readonly<Record<ChaveNaturezaPadrao, string | null>>;

const SEM_NATUREZAS: NaturezasPadrao = {
  juros_pagos_id: null, juros_recebidos_id: null, multa_paga_id: null, multa_recebida_id: null,
  acrescimo_pago_id: null, acrescimo_recebido_id: null, desconto_obtido_id: null, desconto_concedido_id: null,
  tarifa_bancaria_id: null
};

/**
 * Lê a configuração UMA vez por operação (a baixa em lote passa o resultado adiante, sem uma leitura por título).
 * Organização sem linha = nenhuma natureza configurada: os componentes ficam como hoje, dentro do movimento
 * principal, e só a tarifa (campo novo) é recusada.
 */
export async function lerNaturezasPadrao(ctx: ServiceCtx): Promise<NaturezasPadrao> {
  const r = await ctx.tx.query<Record<ChaveNaturezaPadrao, string | null>>(
    "select juros_pagos_id, juros_recebidos_id, multa_paga_id, multa_recebida_id, acrescimo_pago_id, acrescimo_recebido_id,"
    + " desconto_obtido_id, desconto_concedido_id, tarifa_bancaria_id from erp.financeiro_naturezas_padrao where organization_id=$1",
    [ctx.orgId]);
  const linha = r.rows[0];
  return linha ? { ...SEM_NATUREZAS, ...linha } : SEM_NATUREZAS;
}

export const MENSAGEM_TARIFA_SEM_NATUREZA = "Configure a natureza padrão da tarifa bancária em Configurações › Financeiro";
/** Título sem rateio (acervo): a tarifa e o crédito do excedente tiram centro e safra do rateio do título. */
export const MENSAGEM_TITULO_SEM_RATEIO = "O título não tem rateio (natureza e centro de resultado): a tarifa e o excedente da baixa usam o rateio do título — baixe sem eles";
export const MENSAGEM_LOTE_SEM_RATEIO = "Nenhum título do lote tem rateio (natureza e centro de resultado): a tarifa do lote usa o rateio dos títulos — baixe o lote sem tarifa";

/** "A natureza padrão de juros está inativa…" — o rótulo do componente, em minúsculas, no meio da frase. */
const nomeDoComponente = (c: ComponenteBaixa): string => rotuloFinanceiro("componente_baixa", c).toLowerCase();

/**
 * A natureza padrão de cada componente lançado em separado tem de estar viva, ATIVA e ser ANALÍTICA nesta
 * organização (a regra do rateio novo, decisão 256): a configuração pode ter envelhecido desde que foi gravada.
 * Uma consulta para todos os componentes; a recusa nomeia o componente. Roda ANTES de qualquer gravação.
 */
export async function conferirNaturezasPadrao(ctx: ServiceCtx, itens: readonly { componente: ComponenteBaixa; naturezaId: string }[]): Promise<void> {
  if (!itens.length) return;
  const ids = [...new Set(itens.map((i) => i.naturezaId.toLowerCase()))];
  const r = await ctx.tx.query<{ id: string }>(
    "select id::text as id from erp.financial_categories where organization_id=$1 and id = any($2::uuid[]) and deleted_at is null and is_active and kind='analytic'",
    [ctx.orgId, ids]);
  const ok = new Set(r.rows.map((x) => x.id.toLowerCase()));
  const ruim = itens.find((i) => !ok.has(i.naturezaId.toLowerCase()));
  if (ruim) throw validation(`A natureza padrão de ${nomeDoComponente(ruim.componente)} está inativa: revise em Configurações › Financeiro`);
}

/** Linha do rateio GRAVADO do título — a base dos centros e safras dos componentes. */
export interface LinhaDoRateioDoTitulo { financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; percentage: string }

/**
 * Natureza padrão × centros e safras do rateio do título, escalados ao valor do componente. A base é o PERCENTUAL
 * gravado (sempre > 0 pelo CHECK de `title_apportionments`), não o valor: um título de líquido zero ainda tem
 * proporção. Linhas com o mesmo centro e a mesma safra se juntam. A conta contábil não é copiada: ela é da
 * natureza do título, não da natureza do componente.
 */
export function rateioDoComponente(naturezaId: string, valor: string, base: readonly LinhaDoRateioDoTitulo[]) {
  const escaladas = ratearPorProporcao(valor, base.map((l) => ({ costCenterId: l.cost_center_id, harvestId: l.harvest_id, amount: l.percentage })));
  const porChave = new Map<string, { financialCategoryId: string; costCenterId: string; harvestId: string | null; chartAccountId: null; amount: string }>();
  for (const l of escaladas) {
    const chave = `${l.costCenterId}|${l.harvestId ?? ""}`;
    const atual = porChave.get(chave);
    if (atual) atual.amount = money(D(atual.amount).plus(l.amount));
    else porChave.set(chave, { financialCategoryId: naturezaId, costCenterId: l.costCenterId, harvestId: l.harvestId, chartAccountId: null, amount: l.amount });
  }
  return [...porChave.values()].filter((l) => !D(l.amount).isZero());
}

export interface ComponenteSeparado { componente: ComponenteBaixa; valor: string; naturezaId: string }
export interface TituloDaBaixa { id: string; direction: "payable" | "receivable"; empresa_id: string; number: string; person_id: string | null; proprietary_id: string | null; harvest_id: string | null; is_deductible: boolean }

/**
 * Juros, multa e acréscimo (com natureza configurada) e a tarifa viram MOVIMENTOS PRÓPRIOS da mesma conta e data:
 * cada um com a sua natureza, e o vínculo com a baixa (`title_settlement_id`, `componente_baixa`) gravado logo
 * depois — é por ele que o estorno da baixa acha e cancela os componentes. A tarifa é sempre SAÍDA (despesa do
 * banco); os outros seguem o sentido do título.
 */
export async function lancarComponentesDaBaixa(ctx: ServiceCtx, p: {
  baixaId: string; titulo: TituloDaBaixa; contaId: string; data: string; componentes: readonly ComponenteSeparado[]; rateioDoTitulo: readonly LinhaDoRateioDoTitulo[];
}): Promise<{ componente: ComponenteBaixa; valor: string; bank_movement_id: string }[]> {
  const out: { componente: ComponenteBaixa; valor: string; bank_movement_id: string }[] = [];
  for (const c of p.componentes) {
    const tipo = c.componente === "tarifa" ? "out" : p.titulo.direction === "payable" ? "out" : "in";
    const rotulo = rotuloFinanceiro("componente_baixa", c.componente);
    const id = await createBankMovement(ctx, {
      empresaId: p.titulo.empresa_id, bankAccountId: p.contaId, date: p.data, type: tipo, amount: c.valor, interest: "0",
      document: p.titulo.number, note: `${rotulo} da baixa do título ${p.titulo.number}`, proprietaryId: p.titulo.proprietary_id,
      personId: p.titulo.person_id, harvestId: p.titulo.harvest_id, isDeductible: p.titulo.is_deductible,
      sourceType: "title_settlements", sourceId: p.titulo.id,
      apportionment: rateioDoComponente(c.naturezaId, c.valor, p.rateioDoTitulo), rateioJaGravado: true
    });
    const v = await ctx.tx.query("update erp.bank_movements set title_settlement_id=$2, componente_baixa=$3 where id=$1 and organization_id=$4", [id, p.baixaId, c.componente, ctx.orgId]);
    if (v.rowCount !== 1) throw err("NOT_FOUND", "Movimento não encontrado");
    out.push({ componente: c.componente, valor: money(c.valor), bank_movement_id: id });
  }
  return out;
}

/**
 * A tarifa do LOTE é um movimento só (saída, natureza da tarifa bancária), com os centros e safras da UNIÃO dos
 * rateios dos títulos do lote, e o vínculo `lote_baixa_id` — o estorno da última baixa do lote o cancela.
 */
export async function lancarTarifaDoLote(ctx: ServiceCtx, p: {
  loteId: string; empresaId: string; contaId: string; data: string; valor: string; naturezaId: string; rateioBase: readonly LinhaDoRateioDoTitulo[]; nota: string;
}): Promise<string> {
  const id = await createBankMovement(ctx, {
    empresaId: p.empresaId, bankAccountId: p.contaId, date: p.data, type: "out", amount: p.valor, interest: "0", note: p.nota,
    sourceType: "title_settlement_batch", sourceId: p.loteId, apportionment: rateioDoComponente(p.naturezaId, p.valor, p.rateioBase), rateioJaGravado: true
  });
  const v = await ctx.tx.query("update erp.bank_movements set lote_baixa_id=$2, componente_baixa='tarifa' where id=$1 and organization_id=$3", [id, p.loteId, ctx.orgId]);
  if (v.rowCount !== 1) throw err("NOT_FOUND", "Movimento não encontrado");
  return id;
}

/**
 * O EXCEDENTE vira crédito do parceiro: um título de ADIANTAMENTO da MESMA direção, parceiro e empresa, já baixado
 * pelo MESMO movimento da baixa (o dinheiro que saiu ou entrou a mais está nele). `source_type='title_settlements'`
 * e `source_id` = a baixa: é assim que o estorno da baixa encontra o crédito e recusa estornar se ele já foi usado.
 */
export async function gerarCreditoDoExcedente(ctx: ServiceCtx, p: {
  baixaId: string; titulo: TituloDaBaixa; data: string; contaId: string; movimentoId: string; valor: string; loteId: string | null; rateioDoTitulo: readonly LinhaDoRateioDoTitulo[];
}): Promise<{ titulo_id: string; valor: string }> {
  const nota = `Crédito do excedente da baixa do título ${p.titulo.number}`;
  const criado = await createTitles(ctx, {
    empresaId: p.titulo.empresa_id, direction: p.titulo.direction, number: `${p.titulo.number}-CR`, personId: p.titulo.person_id,
    proprietaryId: p.titulo.proprietary_id, paymentType: "advance", amount: p.valor, emissionDate: p.data, dueDate: p.data, note: nota,
    harvestId: p.titulo.harvest_id, isDeductible: p.titulo.is_deductible,
    apportionment: p.rateioDoTitulo.map((l) => ({ financialCategoryId: l.financial_category_id, costCenterId: l.cost_center_id, chartAccountId: l.chart_account_id, harvestId: l.harvest_id, percentage: l.percentage })),
    sourceType: "title_settlements", sourceId: p.baixaId
  });
  const tituloId = criado.ids[0]!;
  const baixa = await ctx.tx.query<{ id: string }>(
    "insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_account_id,bank_movement_id,amount,net_amount,lote_id,note,created_by) values ($1,$2,$3,'bank_movement',$4,$5,$6,$6,$7,$8,$9) returning id",
    [ctx.orgId, tituloId, p.data, p.contaId, p.movimentoId, money(p.valor), p.loteId, nota, ctx.user.id]);
  await audit(ctx.tx, ctx, "financial_titles", tituloId, "create", { count: 1, credito_da_baixa: p.baixaId });
  await audit(ctx.tx, ctx, "title_settlements", baixa.rows[0]!.id, "create", { title: tituloId, net: money(p.valor), credito_da_baixa: p.baixaId });
  return { titulo_id: tituloId, valor: money(p.valor) };
}

/**
 * REFERÊNCIAS DO TENANT DO TÍTULO. As FKs de `person_id`, `proprietary_id`, `title_type_id`, `harvest_id` e
 * `branch_id` (e as de safra e área do rateio) são de COLUNA ÚNICA: provam que o UUID existe, não que é desta
 * organização. Sem esta conferência, um título da organização A gravaria o parceiro da B. Uma consulta para tudo;
 * inexistente, de outra organização e excluído caem na MESMA recusa por campo (sem oráculo de existência).
 * O tipo de título aceita os PADRÕES do sistema (`organization_id` nulo). A conta prevista precisa estar ativa.
 */
export interface ReferenciasDoTitulo {
  person_id?: string | null; proprietary_id?: string | null; title_type_id?: string | null; harvest_id?: string | null;
  branch_id?: string | null; conta_prevista_id?: string | null;
  apportionment?: readonly { harvest_id?: string | null; area_id?: string | null }[];
}
const CAMPOS_DE_REFERENCIA: readonly { chave: keyof Omit<ReferenciasDoTitulo, "apportionment">; mensagem: string }[] = [
  { chave: "person_id", mensagem: "Parceiro inválido" },
  { chave: "proprietary_id", mensagem: "Proprietário inválido" },
  { chave: "title_type_id", mensagem: "Tipo de título inválido" },
  { chave: "harvest_id", mensagem: "Safra inválida" },
  { chave: "branch_id", mensagem: "Filial inválida" },
  { chave: "conta_prevista_id", mensagem: "Conta prevista inválida" }
];
export async function conferirReferenciasDoTitulo(ctx: ServiceCtx, refs: ReferenciasDoTitulo): Promise<void> {
  const v = (x: string | null | undefined) => (x ? x.toLowerCase() : null);
  const safras = [...new Set((refs.apportionment ?? []).flatMap((l) => (l.harvest_id ? [l.harvest_id.toLowerCase()] : [])))];
  const areas = [...new Set((refs.apportionment ?? []).flatMap((l) => (l.area_id ? [l.area_id.toLowerCase()] : [])))];
  const r = await ctx.tx.query<{ person_id: boolean; proprietary_id: boolean; title_type_id: boolean; harvest_id: boolean; branch_id: boolean; conta_prevista_id: boolean; safras: boolean; areas: boolean }>(
    "select"
    + " ($2::uuid is null or exists (select 1 from erp.people x where x.id=$2 and x.organization_id=$1 and x.deleted_at is null)) as person_id,"
    + " ($3::uuid is null or exists (select 1 from erp.people x where x.id=$3 and x.organization_id=$1 and x.deleted_at is null)) as proprietary_id,"
    + " ($4::uuid is null or exists (select 1 from erp.title_types x where x.id=$4 and (x.organization_id=$1 or x.organization_id is null))) as title_type_id,"
    + " ($5::uuid is null or exists (select 1 from erp.harvests x where x.id=$5 and x.organization_id=$1 and x.deleted_at is null)) as harvest_id,"
    + " ($6::uuid is null or exists (select 1 from erp.provider_branches x join erp.people pe on pe.id=x.person_id where x.id=$6 and pe.organization_id=$1)) as branch_id,"
    + " ($7::uuid is null or exists (select 1 from erp.bank_accounts x where x.id=$7 and x.organization_id=$1 and x.deleted_at is null and x.is_active)) as conta_prevista_id,"
    + " ((select count(*) from erp.harvests x where x.id = any($8::uuid[]) and x.organization_id=$1 and x.deleted_at is null) = cardinality($8::uuid[])) as safras,"
    + " ((select count(*) from erp.areas x where x.id = any($9::uuid[]) and x.organization_id=$1 and x.deleted_at is null) = cardinality($9::uuid[])) as areas",
    [ctx.orgId, v(refs.person_id), v(refs.proprietary_id), v(refs.title_type_id), v(refs.harvest_id), v(refs.branch_id), v(refs.conta_prevista_id), safras, areas]);
  const ok = r.rows[0]!;
  for (const c of CAMPOS_DE_REFERENCIA) if (!ok[c.chave]) throw validation(c.mensagem, [{ path: c.chave, message: c.mensagem }]);
  if (!ok.safras) throw validation("Safra inválida no rateio", [{ path: "apportionment.harvest_id", message: "Safra inválida no rateio" }]);
  if (!ok.areas) throw validation("Área inválida no rateio", [{ path: "apportionment.area_id", message: "Área inválida no rateio" }]);
}

/**
 * Congelamento conferido por item DENTRO de um lote: uma exceção do PostgreSQL sem savepoint aborta a transação
 * inteira (o lote todo), e o item congelado tem de virar "pulado" com motivo, não um 409 que desfaz os outros.
 */
export async function periodoAbertoNoLote(ctx: ServiceCtx, empresaId: string | null, data: string): Promise<boolean> {
  await ctx.tx.query("savepoint f8_item");
  try {
    await ctx.tx.query("select erp.assert_period_open($1,$2,$3)", [ctx.orgId, empresaId, data]);
    await ctx.tx.query("release savepoint f8_item");
    return true;
  } catch (e) {
    await ctx.tx.query("rollback to savepoint f8_item");
    if (fromPgError(e)?.code === "PERIOD_FROZEN") return false;
    throw e;
  }
}
