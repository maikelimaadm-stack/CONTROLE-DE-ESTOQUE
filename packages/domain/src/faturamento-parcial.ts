/**
 * FATURAR EM PARTES — AS CONTAS DE UMA CONVERSÃO PARCIAL (TOP-CONFIG-06, decisão 265).
 *
 * Um documento de origem (orçamento ou pedido) pode ser convertido várias vezes, item a item e por
 * quantidade, quando a aresta da TOP de origem declara "Em partes". Este arquivo NÃO executa nada: ele diz
 * o saldo de cada item, confere os itens pedidos para uma parte e calcula, de forma pura, os valores que a
 * parte leva. A API não tem conta própria — ela lê do banco, chama estas funções e grava o resultado.
 *
 * ┌─ POR QUE PROPORCIONAL COM O RESTO NA ÚLTIMA PARTE ────────────────────────────────────────────────┐
 * │ Frete de 100 em três partes iguais dá 33,333… — arredondar cada parte para 2 casas perde um centavo │
 * │ (33,33 × 3 = 99,99). A soma das partes tem de ser EXATAMENTE o valor da origem, senão o faturado    │
 * │ diverge do pedido sem ninguém ter decidido. Por isso cada parte leva a proporção arredondada, e a   │
 * │ parte que zera o saldo leva o RESTO (origem − o que já foi para partes não canceladas).            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { D, money } from "@agro/shared";
import { itemTotal } from "./sales.js";

/** Quantidade: até 4 casas, sempre positiva numa parte. */
const CASAS_QUANTIDADE = 4;
const qtd = (v: Parameters<typeof D>[0]) => D(v).toDecimalPlaces(CASAS_QUANTIDADE).toFixed(CASAS_QUANTIDADE);

/** Um item do documento de origem, com o que já foi para partes NÃO canceladas. */
export interface ItemDeOrigem {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  discountPercent: string;
  /** Soma das quantidades ligadas a este item em partes não canceladas. */
  faturado: string;
  /** Soma do desconto em VALOR já levado por partes não canceladas deste item. */
  descontoAlocado: string;
}

/** Valores do cabeçalho que se repartem proporcionalmente. `entrada` só existe no plano sem condição. */
export interface ValoresDoCabecalho {
  freight: string;
  freightIcms: string;
  otherValues: string;
  discount: string;
  entrada: string;
}
const CHAVES_CABECALHO = ["freight", "freightIcms", "otherValues", "discount", "entrada"] as const;

/** Saldo do item = quantidade − faturado (partes não canceladas). Nunca negativo na leitura. */
export function saldoDoItem(i: Pick<ItemDeOrigem, "quantity" | "faturado">): string {
  const s = D(i.quantity).minus(i.faturado);
  return qtd(s.lt(0) ? 0 : s);
}

/** Um item pedido para a parte, como o cliente envia (depois do zod). */
export interface ItemPedidoDaParte { itemId: string; quantidade: string }

export type RecusaItemDaParte =
  | { motivo: "sem_itens" }
  | { motivo: "item_desconhecido"; itemId: string }
  | { motivo: "item_repetido"; itemId: string }
  | { motivo: "quantidade_invalida"; itemId: string }
  | { motivo: "acima_do_saldo"; itemId: string; saldo: string };

export const MSG_ITENS_DA_PARTE: Record<RecusaItemDaParte["motivo"], string> = {
  sem_itens: "Escolha pelo menos um item com saldo para converter.",
  item_desconhecido: "O item informado não é deste documento.",
  item_repetido: "O mesmo item foi informado mais de uma vez.",
  quantidade_invalida: "A quantidade deve ser maior que zero, com no máximo 4 casas decimais.",
  acima_do_saldo: "A quantidade é maior que o saldo do item.",
};

const QUANTIDADE_VALIDA = /^\d+(\.\d{1,4})?$/;

/**
 * Confere os itens pedidos contra o documento de origem. Pura: o saldo vem de quem leu o banco DEPOIS de
 * travar a origem. Sem recusas, devolve os itens NORMALIZADOS (quantidade canônica, ordem da origem).
 */
export function validarItensDaParte(
  origem: readonly ItemDeOrigem[],
  pedidos: readonly ItemPedidoDaParte[],
): { ok: true; itens: ItemPedidoDaParte[] } | { ok: false; recusas: RecusaItemDaParte[] } {
  if (pedidos.length === 0) return { ok: false, recusas: [{ motivo: "sem_itens" }] };
  const porId = new Map(origem.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  const recusas: RecusaItemDaParte[] = [];
  const aceitos = new Map<string, string>();
  for (const p of pedidos) {
    const item = porId.get(p.itemId);
    if (!item) { recusas.push({ motivo: "item_desconhecido", itemId: p.itemId }); continue; }
    if (vistos.has(p.itemId)) { recusas.push({ motivo: "item_repetido", itemId: p.itemId }); continue; }
    vistos.add(p.itemId);
    if (!QUANTIDADE_VALIDA.test(p.quantidade) || D(p.quantidade).lte(0)) { recusas.push({ motivo: "quantidade_invalida", itemId: p.itemId }); continue; }
    const saldo = saldoDoItem(item);
    if (D(p.quantidade).gt(saldo)) { recusas.push({ motivo: "acima_do_saldo", itemId: p.itemId, saldo }); continue; }
    aceitos.set(p.itemId, qtd(p.quantidade));
  }
  if (recusas.length) return { ok: false, recusas };
  return { ok: true, itens: origem.filter((i) => aceitos.has(i.id)).map((i) => ({ itemId: i.id, quantidade: aceitos.get(i.id)! })) };
}

/** A parte "inteira": o saldo de todos os itens com saldo — o que a conversão sem `itens` pede. */
export function itensDoSaldoInteiro(origem: readonly ItemDeOrigem[]): ItemPedidoDaParte[] {
  return origem.filter((i) => D(saldoDoItem(i)).gt(0)).map((i) => ({ itemId: i.id, quantidade: saldoDoItem(i) }));
}

/**
 * Chave canônica dos itens para o hash da idempotência: ordem por id, quantidade canônica. A mesma parte
 * pedida em outra ordem, ou "4" versus "4.0000", tem de produzir o mesmo hash.
 */
export function itensCanonicosDaParte(itens: readonly ItemPedidoDaParte[] | undefined): { item_id: string; quantidade: string }[] | null {
  if (!itens) return null;
  return [...itens]
    .map((i) => ({ item_id: i.itemId, quantidade: QUANTIDADE_VALIDA.test(i.quantidade) ? qtd(i.quantidade) : i.quantidade }))
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
}

export interface ItemCalculadoDaParte {
  origemItemId: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  discountPercent: string;
}

export interface CalculoDaParte {
  itens: ItemCalculadoDaParte[];
  cabecalho: ValoresDoCabecalho;
  /** Esta parte zera o saldo de TODOS os itens do documento de origem. */
  zeraOSaldo: boolean;
}

/**
 * Os valores de uma parte.
 *
 *   · preço unitário e desconto %: os da origem;
 *   · desconto em VALOR do item: proporcional à quantidade; a parte que zera o saldo DAQUELE item leva o
 *     resto (desconto do item − o que partes não canceladas já levaram dele);
 *   · frete, ICMS do frete, outros valores, desconto do cabeçalho e entrada fixa: proporcionais ao valor
 *     dos itens desta parte sobre o valor dos itens da origem, com 2 casas; a parte que zera o saldo do
 *     DOCUMENTO leva o resto (valor da origem − `jaAlocado`, a soma das partes não canceladas).
 *
 * `itens` já validados (`validarItensDaParte`). Quem chama garante isso.
 */
export function calcularParte(
  origem: readonly ItemDeOrigem[],
  cabecalhoDaOrigem: ValoresDoCabecalho,
  jaAlocado: ValoresDoCabecalho,
  itens: readonly ItemPedidoDaParte[],
): CalculoDaParte {
  const porId = new Map(origem.map((i) => [i.id, i]));
  const pedidos = new Map(itens.map((i) => [i.itemId, i.quantidade]));

  const calculados: ItemCalculadoDaParte[] = [];
  for (const o of origem) {
    const q = pedidos.get(o.id);
    if (q === undefined) continue;
    const zeraItem = D(q).eq(saldoDoItem(o));
    const discount = zeraItem
      ? money(D(o.discount).minus(o.descontoAlocado))
      : money(D(o.discount).mul(q).div(D(o.quantity).isZero() ? 1 : o.quantity));
    calculados.push({ origemItemId: o.id, productId: o.productId, quantity: qtd(q), unitPrice: o.unitPrice, discount, discountPercent: o.discountPercent });
  }

  const zeraOSaldo = origem.every((o) => D(saldoDoItem(o)).minus(pedidos.get(o.id) ?? 0).lte(0));

  const valorDaOrigem = origem.reduce((a, o) => a.plus(itemTotal({ quantity: o.quantity, unitPrice: o.unitPrice, discount: o.discount, discountPercent: o.discountPercent })), D(0));
  const valorDaParte = calculados.reduce((a, i) => a.plus(itemTotal({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, discountPercent: i.discountPercent })), D(0));
  const razao = valorDaOrigem.isZero() ? D(0) : valorDaParte.div(valorDaOrigem);

  const cabecalho = {} as ValoresDoCabecalho;
  for (const k of CHAVES_CABECALHO) {
    cabecalho[k] = zeraOSaldo
      ? money(D(cabecalhoDaOrigem[k]).minus(jaAlocado[k]))
      : money(D(cabecalhoDaOrigem[k]).mul(razao));
  }
  return { itens: calculados, cabecalho, zeraOSaldo };
}
