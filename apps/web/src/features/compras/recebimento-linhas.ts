import { D, money } from "@agro/shared";
import type { ItemRow, Row } from "@/features/docs/shared";

/**
 * AS LINHAS DO RECEBIMENTO DE UM PEDIDO DE COMPRA (COMPRAS-02, decisão 268) — contas PURAS, sem React e sem rede,
 * para a Central de Compras em modo receber. Separadas do hook (`receber-pedido.ts`) para serem exercitadas sem
 * navegador. Nada aqui decide saldo: o `/convert` confere cada quantidade contra o saldo de AGORA.
 */

/** O saldo do item como o servidor declarou; ausente (API anterior) = a quantidade inteira. */
export const saldoLidoDoItem = (it: Row): string => {
  const s = it["saldo"];
  return s === undefined || s === null ? String(it["quantidade"] ?? "0") : String(s);
};

/** O item do pedido com o recebido e o saldo que o servidor declarou (API da COMPRAS-02). */
export const temRecebimentoDeclarado = (itens: Row[]): boolean => itens.some((it) => it["saldo"] !== undefined && it["saldo"] !== null);

/** O item ainda tem saldo a receber? (Apresentação: quem confere é o servidor.) */
export const temSaldo = (it: Row): boolean => { try { return D(saldoLidoDoItem(it)).gt(0); } catch { return false; } };
/** Decimal do servidor sem os zeros de escala ("10.000000" → "10"), para o campo não mostrar seis casas. */
const semZeros = (v: unknown): string => { try { return D(String(v ?? "0")).toFixed(); } catch { return "0"; } };
const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * O DESCONTO EM VALOR DO PEDIDO, NA PROPORÇÃO DA QUANTIDADE DESTA LINHA — a mesma conta da venda em partes
 * (`features/sales/faturar-em-partes.ts`). O desconto do pedido é do item INTEIRO: copiá-lo cru numa parte de 2 de 10
 * daria um desconto maior que a linha. `null` quando a quantidade digitada ainda não é um número (a linha fica como
 * está até ser).
 */
export function descontoNaProporcao(it: ItemRow): string | null {
  const total = texto(it["desconto_do_pedido"]); const doPedido = texto(it["quantidade_do_pedido"]);
  try {
    const q = D(it.quantity); const base = D(doPedido);
    if (q.lt(0) || base.lte(0)) return null;
    const d = D(total || "0").mul(q).div(base);
    return d.isZero() ? "" : money(d);
  } catch { return null; }
}

/**
 * As linhas iniciais do recebimento: SÓ os itens com saldo, na ordem do pedido. Cada linha guarda de onde veio
 * (`item_origem_id`), o saldo e o que o pedido disse (quantidade e desconto) — é o que a tela mostra e o que o corpo
 * do `/convert` leva. Armazém vem do pedido quando ele o tinha; lote e validade, a pessoa informa.
 */
export function linhasDoRecebimento(itens: Row[]): ItemRow[] {
  return itens.filter(temSaldo).map((it) => {
    const saldo = semZeros(saldoLidoDoItem(it));
    const linha: ItemRow = {
      product_id: texto(it["produto_id"]),
      warehouse_id: texto(it["armazem_id"]),
      quantity: saldo,
      unit_value: semZeros(it["valor_unitario"]),
      discount_percent: D(semZeros(it["desconto_percentual"])).isZero() ? "" : semZeros(it["desconto_percentual"]),
      provider_lot: "",
      expiration_date: "",
      item_origem_id: texto(it["id"]),
      saldo,
      quantidade_do_pedido: texto(it["quantidade"]),
      desconto_do_pedido: texto(it["desconto"] ?? "0")
    };
    return { ...linha, discount: descontoNaProporcao(linha) ?? "" };
  });
}

/**
 * O desconto em valor ACOMPANHA a quantidade enquanto a pessoa não mexeu nele (na proporção do pedido). Mexeu, vale o
 * que ela digitou até o fim — é o desconto da nota. A linha é reconhecida pelo item de origem, nunca pela posição
 * (remover uma linha desloca as de baixo).
 */
export function acompanharDescontoDaOrigem(antes: ItemRow[], depois: ItemRow[]): ItemRow[] {
  const porOrigem = new Map(antes.map((it) => [texto(it["item_origem_id"]), it]));
  return depois.map((it) => {
    const a = porOrigem.get(texto(it["item_origem_id"]));
    if (!a) return it;
    if (it["desconto_manual"] === true) return it;
    if ((a.discount ?? "") !== (it.discount ?? "")) return { ...it, desconto_manual: true };
    if (a.quantity === it.quantity) return it;
    const d = descontoNaProporcao(it);
    return d === null ? it : { ...it, discount: d };
  });
}

/** O cabeçalho que vem do pedido e pode mudar na Central (valem os da nota). Campo ausente no pedido fica vazio. */
export function cabecalhoDoPedido(p: Row): { transportadora_id: string; categoria_financeira_id: string; centro_custo_id: string; condicao_pagamento_id: string; forma_pagamento_id: string; observacao: string } {
  return {
    transportadora_id: texto(p["transportadora_id"]),
    categoria_financeira_id: texto(p["categoria_financeira_id"]),
    centro_custo_id: texto(p["centro_custo_id"]),
    condicao_pagamento_id: texto(p["condicao_pagamento_id"]),
    forma_pagamento_id: texto(p["forma_pagamento_id"]),
    observacao: texto(p["observacao"])
  };
}
