/**
 * COMPRAS-02 (decisão 268) — RECEBER O PEDIDO DE COMPRA: O SALDO DE CADA ITEM E A CONFERÊNCIA DOS ITENS.
 *
 * Receber é LANÇAR UMA COMPRA COM ORIGEM: a compra gerada é uma compra comum (confirma, estorna e cancela como
 * na COMPRAS-01), e cada item dela aponta para o item do pedido de onde veio. Este arquivo NÃO executa nada:
 * diz o saldo de cada item do pedido e confere os itens pedidos para UM recebimento. A API lê o pedido
 * TRAVADO, chama estas funções, e só então chama a MESMA função que lança uma compra — nenhuma cópia das
 * regras de lançamento mora aqui.
 *
 * ┌─ O SALDO É SÓ DE QUANTIDADE ─────────────────────────────────────────────────────────────────────────┐
 * │ Na venda em partes, preço, desconto e cabeçalho da parte SAEM da origem (é o mesmo negócio, faturado │
 * │ aos poucos). Na compra, quem manda no valor é a NOTA do fornecedor: o preço unitário e os descontos   │
 * │ vêm do corpo do recebimento, e o pedido só controla QUANTO ainda falta chegar. Por isso não há rateio │
 * │ de cabeçalho aqui: somar valores de notas diferentes contra o valor do pedido criaria um "saldo em    │
 * │ dinheiro" que ninguém decidiu e que nenhuma nota respeita.                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ TODA COMPRA DE PEDIDO LIGA OS ITENS, COM OU SEM "EM PARTES" ────────────────────────────────────────┐
 * │ A aresta SEM "Em partes" não é "sem ligação": é "de uma vez só". Ela exige TODOS os itens com saldo,  │
 * │ cada um com a quantidade IGUAL ao saldo — e liga cada linha ao item de origem do mesmo jeito. Assim   │
 * │ o recebido, o cancelamento que devolve o saldo e o gatilho do banco (soma ≤ quantidade) valem para as │
 * │ duas arestas, sem um segundo caminho para a mesma pergunta.                                           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FUNÇÃO PURA: sem banco, sem relógio; quantidade em string decimal, conta em `decimal.js` (nunca ponto
 * flutuante). O saldo que entra aqui é o que a API leu DEPOIS de travar o pedido; a última palavra continua
 * sendo o gatilho do banco, que trava o item de origem e confere a soma.
 */
import { D } from "@agro/shared";

/** Quantidade: até 4 casas — a escala de `erp.documentos_compra_itens.quantidade`. */
const CASAS_QUANTIDADE = 4;
const qtd = (v: Parameters<typeof D>[0]) => D(v).toDecimalPlaces(CASAS_QUANTIDADE).toFixed(CASAS_QUANTIDADE);
const QUANTIDADE_VALIDA = /^\d+(\.\d{1,4})?$/;

/** Um item do pedido de compra, com o que já foi recebido em compras NÃO canceladas ligadas a ele. */
export interface ItemDoPedido {
  id: string;
  produtoId: string;
  quantidade: string;
  /** Soma das quantidades ligadas a este item (`origem_item_id`) em compras não canceladas. */
  recebido: string;
}

/** Saldo do item = quantidade − recebido. 4 casas; nunca negativo na leitura. */
export function saldoDoItemDoPedido(i: Pick<ItemDoPedido, "quantidade" | "recebido">): string {
  const s = D(i.quantidade).minus(i.recebido);
  return qtd(s.lt(0) ? 0 : s);
}

/** Um item pedido para o recebimento, como o cliente o envia (depois do zod): o item do pedido e a quantidade. */
export interface ItemDoRecebimento { itemOrigemId: string; quantidade: string }

/**
 * Por que um item do recebimento foi recusado. `posicao` é o índice da linha no CORPO — é o que a API usa
 * para apontar `itens[N].…` na resposta 422. Recusa sem `posicao` fala do recebimento inteiro (`itens`).
 */
export type RecusaItemDoRecebimento =
  | { motivo: "sem_itens" }
  | { motivo: "item_desconhecido"; posicao: number; itemOrigemId: string }
  | { motivo: "item_repetido"; posicao: number; itemOrigemId: string }
  | { motivo: "quantidade_invalida"; posicao: number; itemOrigemId: string }
  | { motivo: "item_sem_saldo"; posicao: number; itemOrigemId: string }
  | { motivo: "acima_do_saldo"; posicao: number; itemOrigemId: string; saldo: string }
  /**
   * Aresta SEM "Em partes": um item com saldo ficou de fora (sem `posicao`) ou veio com quantidade diferente
   * do saldo (com a `posicao` da linha). `saldo` diz quanto a linha tinha de trazer.
   */
  | { motivo: "recebimento_incompleto"; posicao?: number; itemOrigemId: string; saldo: string };

export type MotivoRecusaItemDoRecebimento = RecusaItemDoRecebimento["motivo"];

/** Os textos da recusa — da COMPRA ("pedido de compra", "receber"), nunca os da venda em partes. */
export const MSG_ITENS_DO_RECEBIMENTO: Record<MotivoRecusaItemDoRecebimento, string> = {
  sem_itens: "Informe pelo menos um item do pedido de compra com saldo para receber.",
  item_desconhecido: "O item informado não é deste pedido de compra.",
  item_repetido: "O mesmo item do pedido de compra foi informado mais de uma vez.",
  quantidade_invalida: "A quantidade deve ser maior que zero, com no máximo 4 casas decimais.",
  item_sem_saldo: "Este item do pedido de compra não tem saldo a receber.",
  acima_do_saldo: "A quantidade é maior que o saldo do item no pedido de compra.",
  recebimento_incompleto: "Esta operação recebe o pedido inteiro: informe todos os itens com saldo, cada um com a quantidade do saldo."
};

/**
 * CONFERE OS ITENS DE UM RECEBIMENTO contra os itens do pedido (já com o recebido de agora).
 *
 * Por linha, na ordem do corpo: item do pedido? repetido? quantidade > 0 com até 4 casas? o item ainda tem
 * saldo? a quantidade cabe no saldo? Depois, SÓ na aresta sem "Em partes": todo item com saldo tem de estar
 * no corpo, com a quantidade IGUAL ao saldo — receber menos do que falta, numa aresta que não admite partes,
 * deixaria o pedido pendurado num saldo que ninguém mais pode receber.
 *
 * Devolve TODAS as recusas, não só a primeira: corrigir um campo por vez é pior para quem digita, e um teste
 * com dois defeitos passaria mostrando um só. Sem recusas, devolve os itens NORMALIZADOS (quantidade com 4
 * casas) NA ORDEM DO CORPO — o índice N do resultado é a linha N do corpo, porque o preço, o lote e o armazém
 * da linha continuam no corpo e quem chama os casa pela posição.
 */
export function validarItensDoRecebimento(
  itensPedido: readonly ItemDoPedido[],
  pedidos: readonly ItemDoRecebimento[],
  opcoes: { emPartes: boolean }
): { ok: true; itens: ItemDoRecebimento[] } | { ok: false; recusas: RecusaItemDoRecebimento[] } {
  if (pedidos.length === 0) return { ok: false, recusas: [{ motivo: "sem_itens" }] };
  const porId = new Map(itensPedido.map((i) => [i.id, i]));
  const citados = new Set<string>();
  const recusas: RecusaItemDoRecebimento[] = [];
  const aceitos: ItemDoRecebimento[] = [];
  /** Linha aceita de cada item do pedido — a conferência do "inteiro" olha só para estas. */
  const aceitoPorItem = new Map<string, { posicao: number; quantidade: string }>();

  pedidos.forEach((p, posicao) => {
    const itemOrigemId = p.itemOrigemId;
    const item = porId.get(itemOrigemId);
    if (!item) { recusas.push({ motivo: "item_desconhecido", posicao, itemOrigemId }); return; }
    if (citados.has(itemOrigemId)) { recusas.push({ motivo: "item_repetido", posicao, itemOrigemId }); return; }
    citados.add(itemOrigemId);
    if (typeof p.quantidade !== "string" || !QUANTIDADE_VALIDA.test(p.quantidade) || D(p.quantidade).lte(0)) {
      recusas.push({ motivo: "quantidade_invalida", posicao, itemOrigemId }); return;
    }
    const saldo = saldoDoItemDoPedido(item);
    if (D(saldo).lte(0)) { recusas.push({ motivo: "item_sem_saldo", posicao, itemOrigemId }); return; }
    if (D(p.quantidade).gt(saldo)) { recusas.push({ motivo: "acima_do_saldo", posicao, itemOrigemId, saldo }); return; }
    const quantidade = qtd(p.quantidade);
    aceitos.push({ itemOrigemId, quantidade });
    aceitoPorItem.set(itemOrigemId, { posicao, quantidade });
  });

  if (!opcoes.emPartes) {
    for (const item of itensPedido) {
      const saldo = saldoDoItemDoPedido(item);
      if (D(saldo).lte(0)) continue;
      const aceito = aceitoPorItem.get(item.id);
      if (aceito) {
        if (!D(aceito.quantidade).eq(saldo)) recusas.push({ motivo: "recebimento_incompleto", posicao: aceito.posicao, itemOrigemId: item.id, saldo });
      } else if (!citados.has(item.id)) {
        // Citado mas recusado por outra razão já tem a recusa própria; aqui fica só quem NÃO veio.
        recusas.push({ motivo: "recebimento_incompleto", itemOrigemId: item.id, saldo });
      }
    }
  }

  if (recusas.length) return { ok: false, recusas };
  return { ok: true, itens: aceitos };
}

/** O pedido foi TODO recebido? Pedido sem item nenhum não conta como recebido (fail-closed). */
export function pedidoTotalmenteRecebido(itensPedido: readonly Pick<ItemDoPedido, "quantidade" | "recebido">[]): boolean {
  return itensPedido.length > 0 && itensPedido.every((i) => D(saldoDoItemDoPedido(i)).lte(0));
}

/**
 * Este recebimento (já validado) ZERA o saldo de todos os itens do pedido? — a mesma pergunta de
 * `pedidoTotalmenteRecebido`, feita ANTES de gravar, com o recebido de agora mais o que está entrando.
 */
export function recebimentoZeraOPedido(itensPedido: readonly ItemDoPedido[], itens: readonly ItemDoRecebimento[]): boolean {
  const entrando = new Map<string, string>();
  for (const i of itens) entrando.set(i.itemOrigemId, D(entrando.get(i.itemOrigemId) ?? 0).plus(i.quantidade).toFixed());
  return pedidoTotalmenteRecebido(itensPedido.map((i) => ({
    quantidade: i.quantidade,
    recebido: D(i.recebido).plus(entrando.get(i.id) ?? 0).toFixed()
  })));
}
