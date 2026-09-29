import type { ServiceCtx } from "../lib/context.js";
import { denied } from "../lib/errors.js";
import { D, qty as fqty } from "@agro/shared";

/**
 * RESERVA DE ESTOQUE — A LEITURA DA API (TOP-CONFIG-07, decisão 266).
 *
 * A conta do reservado mora no banco (`erp.reserva_estoque`, 0035): pedidos com reserva abertos (saldo a faturar)
 * + vendas abertas geradas deles. A API não refaz a conta — chama a porta exposta UMA vez por lote de pares
 * (armazém, produto) e soma o físico numa consulta só. Uma página inteira custa duas consultas, nunca uma por linha.
 *
 * FAIL CLOSED: a porta devolve uma linha por par distinto quando quem pergunta tem capacidade de estoque ou de
 * venda, e ZERO linhas quando não tem. Par sem linha nunca vira "reservado 0" — isso liberaria estoque prometido
 * a quem não pode ver a promessa. Faltou linha → 403.
 */
export interface ParDeEstoque { warehouseId: string; productId: string }
export interface SaldoDoPar { fisico: string; reservado: string; disponivel: string }

/**
 * Chave estável de um par — a mesma nos três mapas —, em MINÚSCULAS: o zod (`z.string().uuid()`) e o parâmetro de
 * rota aceitam UUID em maiúsculas, e o banco devolve sempre em minúsculas. Sem normalizar, o par pedido não se acha
 * entre as linhas lidas: o reservado "falta" (403) e o físico some (disponível 0).
 */
export const chaveDoPar = (warehouseId: string, productId: string) => `${warehouseId.toLowerCase()}:${productId.toLowerCase()}`;

function distintos(pares: readonly ParDeEstoque[]): ParDeEstoque[] {
  const vistos = new Map<string, ParDeEstoque>();
  for (const p of pares) if (p.warehouseId && p.productId) vistos.set(chaveDoPar(p.warehouseId, p.productId), p);
  return [...vistos.values()];
}

/** Máximo de pares numa chamada — o mesmo limite da porta exposta no banco. */
export const MAX_PARES_POR_CHAMADA = 1000;

/**
 * Reservado por par, numa chamada da porta exposta. `excluirDocumentoId` tira da conta o próprio documento: o
 * pedido que está sendo salvo (a parte A dele) ou a venda que está sendo confirmada (a parte B dela).
 */
export async function reservadoEmLote(ctx: ServiceCtx, pares: readonly ParDeEstoque[], excluirDocumentoId: string | null = null): Promise<Map<string, string>> {
  const lista = distintos(pares);
  const saida = new Map<string, string>();
  if (lista.length === 0) return saida;
  if (lista.length > MAX_PARES_POR_CHAMADA) throw new Error(`reservadoEmLote: ${lista.length} pares numa chamada (máximo ${MAX_PARES_POR_CHAMADA})`);
  const r = await ctx.tx.query<{ warehouse_id: string; product_id: string; reservado: string }>(
    "select warehouse_id, product_id, reservado from erp.reserva_estoque($1::uuid[], $2::uuid[], $3::uuid)",
    [lista.map((p) => p.warehouseId), lista.map((p) => p.productId), excluirDocumentoId]);
  for (const row of r.rows) saida.set(chaveDoPar(row.warehouse_id, row.product_id), fqty(row.reservado));
  // Os dois lados passam por `chaveDoPar` (minúsculas): par pedido em maiúsculas acha a linha que o banco devolveu.
  if (lista.some((p) => !saida.has(chaveDoPar(p.warehouseId, p.productId)))) throw denied("reserva de estoque");
  return saida;
}

/** Físico por par: a soma de TODOS os lotes do produto no armazém, numa consulta. */
export async function fisicoEmLote(ctx: ServiceCtx, pares: readonly ParDeEstoque[]): Promise<Map<string, string>> {
  const lista = distintos(pares);
  const saida = new Map<string, string>();
  if (lista.length === 0) return saida;
  const r = await ctx.tx.query<{ warehouse_id: string; product_id: string; fisico: string }>(
    `select x.w as warehouse_id, x.p as product_id, coalesce(sum(b.quantity), 0) as fisico
       from unnest($2::uuid[], $3::uuid[]) as x(w, p)
       left join erp.stock_balances b on b.organization_id = $1 and b.warehouse_id = x.w and b.product_id = x.p
      group by x.w, x.p`,
    [ctx.orgId, lista.map((p) => p.warehouseId), lista.map((p) => p.productId)]);
  for (const row of r.rows) saida.set(chaveDoPar(row.warehouse_id, row.product_id), fqty(row.fisico));
  return saida;
}

/** Físico, reservado e disponível (físico − reservado; pode ser negativo depois de um acerto de inventário). */
export async function saldoComReservaEmLote(ctx: ServiceCtx, pares: readonly ParDeEstoque[], excluirDocumentoId: string | null = null): Promise<Map<string, SaldoDoPar>> {
  const fisico = await fisicoEmLote(ctx, pares);
  const reservado = await reservadoEmLote(ctx, pares, excluirDocumentoId);
  const saida = new Map<string, SaldoDoPar>();
  for (const [chave, f] of fisico) {
    const r = reservado.get(chave) ?? "0";
    saida.set(chave, { fisico: f, reservado: fqty(r), disponivel: fqty(D(f).minus(r)) });
  }
  return saida;
}
