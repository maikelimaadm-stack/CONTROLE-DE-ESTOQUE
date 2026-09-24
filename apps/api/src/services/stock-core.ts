import type { ServiceCtx } from "../lib/context.js";
import { validation, err } from "../lib/errors.js";
import { money, qty as fqty, D } from "@agro/shared";

export interface StockPost {
  empresaId: string; warehouseId: string; productId: string; movementType: string; direction: 1 | -1; quantity: string; unitCost?: string | null;
  providerLot?: string | null; expirationDate?: string | null; costCenterId?: string | null; harvestId?: string | null; cultivationId?: string | null;
  sourceType: string; sourceId: string; date: string; note?: string | null;
}

/** Um movimento gravado no ledger: UM lote e a quantidade que entrou ou saiu dele. */
export interface ParteDoMovimento {
  id: string; lote: string | null; validade: string | null; quantidade: string; unitCost: string; balanceAfter: string; avgCostAfter: string;
}

/**
 * O resultado de `postStock`. Uma saída SEM lote de produto com controle de lote pode virar VÁRIOS movimentos
 * (um por lote escolhido, R1-1): `partes` lista cada um, na ordem em que foram gravados.
 *   · `id` é o do primeiro movimento e `ids` são todos — quem registra os movimentos da origem usa `ids`;
 *   · `unitCost` é o custo médio PONDERADO pelas quantidades das partes (com uma parte só, é o custo dela).
 */
export interface ResultadoDoMovimento { id: string; ids: string[]; unitCost: string; partes: ParteDoMovimento[] }

/** Um lote candidato à escolha automática: saldo positivo do produto no armazém. */
export interface LoteCandidato { lote: string; validade: string | null; quantidade: string }

const alfabetica = new Intl.Collator("pt-BR", { sensitivity: "variant" });

/**
 * A ORDEM DA ESCOLHA AUTOMÁTICA DE LOTE (R1-1, decisão do Maike): validade mais próxima primeiro; lote sem
 * validade por último; empate pelo lote em ordem alfabética. O desempate final é por ponto de código, para
 * que dois lotes diferentes nunca empatem — o resultado é sempre o mesmo para o mesmo saldo.
 * `validade` é a data ISO (`YYYY-MM-DD`) que o banco devolve, e por isso a comparação de texto é a de datas.
 */
export function compararLotesPorValidade(a: Pick<LoteCandidato, "lote" | "validade">, b: Pick<LoteCandidato, "lote" | "validade">): number {
  if (a.validade !== b.validade) {
    if (a.validade === null) return 1;
    if (b.validade === null) return -1;
    return a.validade < b.validade ? -1 : 1;
  }
  const porNome = alfabetica.compare(a.lote, b.lote);
  if (porNome !== 0) return porNome;
  return a.lote < b.lote ? -1 : a.lote > b.lote ? 1 : 0;
}

/**
 * Divide `quantidade` pelos lotes na ordem da escolha automática. Devolve as partes e o que FALTOU (zero quando
 * os lotes bastam). Aritmética decimal (decimal.js), nunca ponto flutuante.
 */
export function dividirPorValidade(candidatos: readonly LoteCandidato[], quantidade: string): { partes: LoteCandidato[]; falta: string } {
  let falta = D(fqty(quantidade));
  const partes: LoteCandidato[] = [];
  for (const c of [...candidatos].sort(compararLotesPorValidade)) {
    if (falta.lte(0)) break;
    const disponivel = D(c.quantidade);
    if (disponivel.lte(0)) continue;
    const q = falta.lt(disponivel) ? falta : disponivel;
    partes.push({ lote: c.lote, validade: c.validade, quantidade: fqty(q) });
    falta = falta.minus(q);
  }
  return { partes, falta: fqty(falta) };
}

const quantidadeLegivel = (v: string) => D(v).toFixed().replace(".", ",");

/**
 * SAÍDA SEM LOTE de produto com controle de lote: escolhe os lotes pela validade (R1-1 a).
 *
 * TRAVA ANTES DE ESCOLHER. As linhas de saldo candidatas (lote preenchido — só espaços é "sem lote", como na borda
 * da API e no gatilho da 0029 —, quantidade > 0, não vencidas na data do movimento) são travadas `for update` na ordem da CHAVE (`provider_lot`) — a mesma ordem em qualquer
 * transação, e por isso duas saídas simultâneas do mesmo produto e armazém fazem fila em vez de travar uma à
 * outra (deadlock). Sob READ COMMITTED, a linha que outra transação alterou é relida depois da espera, com o
 * saldo NOVO: a escolha é feita sobre o que está de fato no armazém, não sobre a foto de antes da fila.
 *
 * Lote VENCIDO na data do movimento fica FORA da escolha: só sai quando o usuário informa o lote. Faltou saldo
 * nos lotes válidos → 409 INSUFFICIENT_STOCK dizendo quanto há em lotes válidos e quanto em vencidos, antes de
 * qualquer gravação.
 */
async function escolherLotesPorValidade(ctx: ServiceCtx, p: StockPost): Promise<LoteCandidato[]> {
  const validos = await ctx.tx.query<{ provider_lot: string; quantity: string; expiration_date: string | null }>(
    `select provider_lot, quantity, expiration_date from erp.stock_balances
      where organization_id=$1 and warehouse_id=$2 and product_id=$3 and btrim(provider_lot) <> '' and quantity > 0
        and (expiration_date is null or expiration_date >= $4::date)
      order by provider_lot
      for update`,
    [ctx.orgId, p.warehouseId, p.productId, p.date]);
  const candidatos = validos.rows.map((r) => ({ lote: r.provider_lot, validade: r.expiration_date, quantidade: r.quantity }));
  const { partes, falta } = dividirPorValidade(candidatos, p.quantity);
  if (D(falta).gt(0)) {
    const vencidos = await ctx.tx.query<{ q: string }>(
      `select coalesce(sum(quantity),0) as q from erp.stock_balances
        where organization_id=$1 and warehouse_id=$2 and product_id=$3 and btrim(provider_lot) <> '' and quantity > 0 and expiration_date < $4::date`,
      [ctx.orgId, p.warehouseId, p.productId, p.date]);
    const emValidos = fqty(candidatos.reduce((a, c) => a.plus(c.quantidade), D(0)));
    const emVencidos = fqty(vencidos.rows[0]!.q);
    throw err("INSUFFICIENT_STOCK",
      `Saldo insuficiente nos lotes válidos: pedido ${quantidadeLegivel(p.quantity)}, há ${quantidadeLegivel(emValidos)} em lotes válidos e ${quantidadeLegivel(emVencidos)} em lotes vencidos. Lote vencido só sai com o lote informado no movimento.`,
      { produto_id: p.productId, armazem_id: p.warehouseId, solicitado: fqty(p.quantity), em_lotes_validos: emValidos, em_lotes_vencidos: emVencidos });
  }
  return partes;
}

async function gravarMovimento(ctx: ServiceCtx, p: StockPost, lote: string | null, validade: string | null, quantidade: string): Promise<ParteDoMovimento> {
  const r = await ctx.tx.query<{ id: string; balance_after: string; avg_cost_after: string; unit_cost: string }>(
    "insert into erp.stock_movements(organization_id,empresa_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,provider_lot,expiration_date,cost_center_id,harvest_id,cultivation_id,source_type,source_id,movement_date,note,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, balance_after, avg_cost_after, unit_cost",
    [ctx.orgId, p.empresaId, p.warehouseId, p.productId, p.movementType, p.direction, fqty(quantidade), p.unitCost ? D(p.unitCost).toFixed(6) : "0", lote, validade, p.costCenterId ?? null, p.harvestId ?? null, p.cultivationId ?? null, p.sourceType, p.sourceId, p.date, p.note ?? null, ctx.user.id]);
  const row = r.rows[0]!;
  return { id: row.id, lote, validade, quantidade: fqty(quantidade), unitCost: row.unit_cost, balanceAfter: row.balance_after, avgCostAfter: row.avg_cost_after };
}

/**
 * Valida produto/armazém e lança no ledger. O ÚNICO caminho de escrita de movimento de estoque da API: toda
 * saída (venda, abastecimento, manutenção, OS, manejo, dieta, ração, requisição, baixa, transferência, correção)
 * passa por aqui — e por isso a escolha automática de lote mora aqui, uma vez.
 */
export async function postStock(ctx: ServiceCtx, p: StockPost): Promise<ResultadoDoMovimento> {
  const prod = await ctx.tx.query<{ control_stock: boolean; has_lot: boolean; is_active: boolean; controle_lote: string | null }>("select control_stock, has_lot, is_active, to_jsonb(p)->>'controle_lote' as controle_lote from erp.products p where id=$1 and organization_id=$2 and deleted_at is null", [p.productId, ctx.orgId]);
  if (!prod.rows[0]) throw validation("Produto inválido");
  if (!prod.rows[0].control_stock) throw err("PRODUCT_NOT_STOCK_CONTROLLED", "Produto não controla estoque");
  const wh = await ctx.tx.query<{ empresa_id: string; is_active: boolean }>("select empresa_id, is_active from erp.warehouses where id=$1 and organization_id=$2 and deleted_at is null", [p.warehouseId, ctx.orgId]);
  if (!wh.rows[0]) throw validation("Armazém inválido");
  if (wh.rows[0].empresa_id !== p.empresaId) throw err("WAREHOUSE_FARM_MISMATCH", "Armazém não pertence à fazenda informada");
  if (D(p.quantity).lte(0)) throw validation("Quantidade deve ser positiva");
  const lot = p.providerLot?.trim() ? p.providerLot.trim() : null;
  // CADASTROS Fase 6 (0029): o CONTROLE de lote exige o lote em todo movimento gravado — o gatilho da 0029 repete
  // a regra em todo INSERT. Na SAÍDA sem lote informado a API ESCOLHE os lotes pela validade antes de gravar
  // (R1-1); com o lote informado, vale o informado (inclusive vencido: é escolha explícita). Na ENTRADA o lote
  // continua obrigatório, e "lote + validade" exige a validade.
  const controle = prod.rows[0].controle_lote ?? (prod.rows[0].has_lot ? "lote" : "nenhum");
  if (controle !== "nenhum" && !lot) {
    if (p.direction === -1) {
      const escolhidos = await escolherLotesPorValidade(ctx, p);
      const partes: ParteDoMovimento[] = [];
      for (const l of escolhidos) partes.push(await gravarMovimento(ctx, p, l.lote, l.validade, l.quantidade));
      const custo = partes.length === 1 ? partes[0]!.unitCost
        : partes.reduce((a, x) => a.plus(D(x.quantidade).mul(x.unitCost)), D(0)).div(fqty(p.quantity)).toFixed(6);
      return { id: partes[0]!.id, ids: partes.map((x) => x.id), unitCost: custo, partes };
    }
    throw validation("O produto controla lote: informe o lote no movimento.", [{ path: "provider_lot", message: "Informe o lote" }]);
  }
  if (controle === "lote_validade" && p.direction === 1 && !p.expirationDate && p.movementType !== "transfer_in" && p.movementType !== "farm_transfer_in") throw validation("O produto controla lote e validade: informe a validade na entrada.", [{ path: "expiration_date", message: "Informe a validade" }]);
  // SAÍDA com lote informado: o movimento grava a validade DO LOTE que saiu (a do saldo), como a escolha
  // automática já faz — nunca uma validade vinda de quem chama: o gatilho de saldo faz `coalesce(validade do
  // movimento, a do saldo)`, e uma validade na saída reescreveria a do lote que fica. É esta validade que a
  // perna de entrada da transferência leva ao destino (R1-1 c).
  const validade = p.direction === -1 ? (lot ? await validadeDoLote(ctx, p, lot) : null) : (p.expirationDate ?? null);
  const parte = await gravarMovimento(ctx, p, lot, validade, p.quantity);
  return { id: parte.id, ids: [parte.id], unitCost: parte.unitCost, partes: [parte] };
}

/** A validade gravada no saldo do lote naquele armazém (null quando o lote não tem validade ou não tem saldo). */
async function validadeDoLote(ctx: ServiceCtx, p: StockPost, lote: string): Promise<string | null> {
  const r = await ctx.tx.query<{ expiration_date: string | null }>(
    "select expiration_date from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and provider_lot=$4",
    [ctx.orgId, p.warehouseId, p.productId, lote]);
  return r.rows[0]?.expiration_date ?? null;
}

/**
 * Estorna todos os movimentos de uma origem (lança o inverso). Usado em cancelamentos. Cada movimento da origem é
 * estornado com o SEU lote — uma saída que a escolha automática dividiu em dois lotes volta aos dois.
 */
export async function reverseStock(ctx: ServiceCtx, sourceType: string, sourceId: string, date: string): Promise<number> {
  const ms = await ctx.tx.query<{ id: string; empresa_id: string; warehouse_id: string; product_id: string; direction: number; quantity: string; unit_cost: string; provider_lot: string | null; cost_center_id: string | null; harvest_id: string | null }>(
    "select id,empresa_id,warehouse_id,product_id,direction,quantity,unit_cost,provider_lot,cost_center_id,harvest_id from erp.stock_movements where organization_id=$1 and source_type=$2 and source_id=$3 and reversed_by is null and movement_type<>'reversal' order by created_at", [ctx.orgId, sourceType, sourceId]);
  for (const m of ms.rows) {
    const rev = await ctx.tx.query<{ id: string }>("insert into erp.stock_movements(organization_id,empresa_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,provider_lot,cost_center_id,harvest_id,source_type,source_id,movement_date,note,created_by) values ($1,$2,$3,$4,'reversal',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id",
      [ctx.orgId, m.empresa_id, m.warehouse_id, m.product_id, -m.direction, m.quantity, m.unit_cost, m.provider_lot, m.cost_center_id, m.harvest_id, sourceType, sourceId, date, `estorno de ${m.id}`, ctx.user.id]);
    // marca o original como estornado via coluna (ledger imutável => usamos tabela de vínculo pela coluna reversed_by no estorno através de update permitido? não: ledger é imutável)
    void rev;
  }
  return ms.rowCount ?? 0;
}

export async function currentBalance(ctx: ServiceCtx, warehouseId: string, productId: string, lot: string | null = null) {
  const r = await ctx.tx.query<{ quantity: string; average_cost: string }>("select coalesce(sum(quantity),0) as quantity, coalesce(sum(total_value)/nullif(sum(quantity),0),0) as average_cost from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and ($4::text is null or provider_lot=$4)", [ctx.orgId, warehouseId, productId, lot]);
  return { quantity: fqty(r.rows[0]!.quantity), averageCost: D(r.rows[0]!.average_cost).toFixed(6) };
}
export const lineTotal = (q: string, u: string) => money(D(q).mul(u));
