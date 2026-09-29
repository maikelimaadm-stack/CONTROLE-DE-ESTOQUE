/**
 * COMPRAS-01 (decisão 267) — O CUSTO DE ENTRADA DA COMPRA.
 *
 * O valor de entrada de cada item é a PARTE DELE no valor total do documento, na proporção do total do item
 * sobre a soma dos totais dos itens. Assim frete, outras despesas e desconto do cabeçalho entram no custo de
 * quem foi comprado, na medida do que cada item pesa na compra.
 *
 *   · soma dos totais dos itens zero (tudo bonificado) → a proporção passa a ser a QUANTIDADE;
 *   · MAIOR RESTO: cada item recebe o PISO da sua parte exata, no centavo; os centavos que faltam para fechar
 *     o total vão, um a um, aos itens de MAIOR RESTO (empate → maior peso do item — valor, ou quantidade no
 *     caso bonificado —, depois a ordem do item). A soma é EXATAMENTE o valor total e nenhum item fica negativo;
 *   · custo unitário = valor de entrada ÷ quantidade, com 6 casas (`unitCost`, ROUND_HALF_EVEN — a regra da casa).
 *
 * FUNÇÃO PURA: sem banco, sem relógio; dinheiro em string decimal, conta em `decimal.js` (nunca ponto flutuante).
 */
import { D, unitCost, type DecimalString } from "@agro/shared";

export interface ItemParaCustoDeEntrada {
  quantidade: DecimalString;
  valorTotal: DecimalString;
}

export interface CustoDeEntradaDoItem {
  valorEntrada: DecimalString;
  custoUnitario: DecimalString;
}

export function ratearCustoDeEntrada(itens: readonly ItemParaCustoDeEntrada[], valorTotalDocumento: DecimalString): CustoDeEntradaDoItem[] {
  if (itens.length === 0) return [];
  const total = D(valorTotalDocumento);
  if (total.isNegative()) throw new RangeError("valor total do documento negativo");
  for (const i of itens) {
    if (!D(i.quantidade).gt(0)) throw new RangeError("quantidade do item precisa ser maior que zero");
    if (D(i.valorTotal).isNegative()) throw new RangeError("valor total do item negativo");
  }
  const somaValores = itens.reduce((a, i) => a.plus(D(i.valorTotal)), D(0));
  const peso = somaValores.isZero() ? (i: ItemParaCustoDeEntrada) => D(i.quantidade) : (i: ItemParaCustoDeEntrada) => D(i.valorTotal);
  const somaPesos = somaValores.isZero() ? itens.reduce((a, i) => a.plus(D(i.quantidade)), D(0)) : somaValores;

  // Parte exata de cada item e o seu piso no centavo (`toDecimalPlaces(2, 1)`: modo 1 = ROUND_DOWN; parte ≥ 0).
  const partes = itens.map((item) => total.times(peso(item)).div(somaPesos));
  const centavos = partes.map((p) => p.toDecimalPlaces(2, 1));
  const distribuido = centavos.reduce((a, v) => a.plus(v), D(0));
  let faltam = total.minus(distribuido).times(100).toDecimalPlaces(0).toNumber(); // inteiro em [0, n)
  const ordem = itens
    .map((item, n) => ({ n, resto: partes[n]!.minus(centavos[n]!), peso: peso(item) }))
    .sort((a, b) => b.resto.comparedTo(a.resto) || b.peso.comparedTo(a.peso) || a.n - b.n);
  for (const o of ordem) {
    if (faltam <= 0) break;
    centavos[o.n] = centavos[o.n]!.plus("0.01");
    faltam -= 1;
  }
  return itens.map((item, n) => ({ valorEntrada: centavos[n]!.toFixed(2), custoUnitario: unitCost(centavos[n]!.div(D(item.quantidade))) }));
}
