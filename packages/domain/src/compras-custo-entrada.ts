/**
 * COMPRAS-01 (decisão 267) — O CUSTO DE ENTRADA DA COMPRA.
 *
 * O valor de entrada de cada item é a PARTE DELE no valor total do documento, na proporção do total do item
 * sobre a soma dos totais dos itens. Assim frete, outras despesas e desconto do cabeçalho entram no custo de
 * quem foi comprado, na medida do que cada item pesa na compra.
 *
 *   · soma dos totais dos itens zero (tudo bonificado) → a proporção passa a ser a QUANTIDADE;
 *   · cada item, menos o último, é truncado no centavo (para baixo — assim o último nunca fica negativo); o
 *     centavo que sobra vai para o ÚLTIMO item, e a soma dos valores de entrada é EXATAMENTE o valor total;
 *   · custo unitário = valor de entrada ÷ quantidade, com 4 casas.
 *
 * FUNÇÃO PURA: sem banco, sem relógio; dinheiro em string decimal, conta em `decimal.js` (nunca ponto flutuante).
 */
import { D, money, qty, type DecimalString } from "@agro/shared";

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

  const valores: DecimalString[] = [];
  let acumulado = D(0);
  // `toDecimalPlaces(2, 1)`: o modo 1 do decimal.js é ROUND_DOWN (trunca em direção ao zero).
  itens.forEach((item, n) => {
    const v = n === itens.length - 1 ? money(total.minus(acumulado)) : total.times(peso(item)).div(somaPesos).toDecimalPlaces(2, 1).toFixed(2);
    acumulado = acumulado.plus(D(v));
    valores.push(v);
  });
  return itens.map((item, n) => ({ valorEntrada: valores[n]!, custoUnitario: qty(D(valores[n]!).div(D(item.quantidade)), 4) }));
}
