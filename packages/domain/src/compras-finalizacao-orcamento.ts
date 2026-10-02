/**
 * OPERACOES-01 F6a (decisão 283) — COMPRAS: O PEDIDO FINALIZADO, O ORÇAMENTO DE COMPRA E A DIVERGÊNCIA COM O PEDIDO.
 *
 * O que a API pergunta ao domínio nesta fase, num dono só:
 *   1. a CAPACIDADE que o servidor publica em `GET /compras/{pedidos,compras,orcamentos}/operation-types`
 *      (`capacidades.finalizacaoEOrcamento`) — a tela da F6b só mostra Finalizar, Aprovado para orçamento, os
 *      orçamentos e Escolher vencedor com ela;
 *   2. a LEITURA das duas seções do formato 5 pela EXECUÇÃO, na versão congelada que o documento cita
 *      (`fluxoCompraDaVersaoTop` no receber, `divergenciaPedidoDaVersaoTop` na confirmação da compra) — fail-closed;
 *   3. a CONTA DA DIVERGÊNCIA da compra com o pedido (`divergenciasDaCompra`), em decimal (nunca ponto flutuante);
 *   4. as MENSAGENS das recusas, texto exato, ditas igual na API e na tela.
 *
 * Este arquivo NÃO lê banco, NÃO grava, NÃO conhece rota nem permissão. Quem executa é a API; o banco é o fundo
 * (a guarda de finalização da 0044 e a conferência da aprovação).
 */
import { D, Decimal } from "@agro/shared";
import {
  lerConfiguracaoTop,
  secoesExtensaoDaVersaoTop,
  versaoSchemaDaConfiguracaoTop,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V5,
} from "./tipo-operacao-configuracao.js";
import { SECAO_FLUXO_COMPRA, type FluxoCompraTop } from "./tipo-operacao-secao-fluxo-compra.js";
import {
  SECAO_DIVERGENCIA_PEDIDO,
  type DivergenciaPedidoTop,
  type ModoDivergenciaPedido,
} from "./tipo-operacao-secao-divergencia-pedido.js";

// ---------------------------------------------------------------------------------------------------
// 1. A CAPACIDADE
// ---------------------------------------------------------------------------------------------------

/**
 * Capacidade de `GET /compras/{pedidos,compras,orcamentos}/operation-types` (chave `finalizacaoEOrcamento`).
 * `1` = este servidor tem: finalizar o pedido (e a prévia), a aprovação do pedido na fila, aprovado para orçamento,
 * os orçamentos de compra (criar, editar, cancelar, listar, ler), escolher o vencedor, o receber que respeita
 * `fluxoCompra.exigeFinalizar` e a divergência na prévia da confirmação da compra.
 */
export const CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA = 1;

// ---------------------------------------------------------------------------------------------------
// 2. A LEITURA DAS SEÇÕES PELA EXECUÇÃO — a versão congelada do documento
// ---------------------------------------------------------------------------------------------------

/** A versão congelada que o documento cita, como a API a lê (`null` = documento sem TOP). */
export type VersaoTopDaSecaoCompra = { codigoBase: string; configuracao: unknown } | null;

/** O resultado da leitura de uma seção pela execução. */
export type LeituraDaSecaoCompraTop<T> = { ok: true; valor: T } | { ok: false; motivo: "configuracao_ilegivel" };

/**
 * A seção de extensão `escolher` da versão, pela regra única — a ORDEM das perguntas é a de `regrasGeraisDaVersaoTop`
 * (decisão 277, regra 4) e a do §18.2 do contrato da TOP:
 *   1. sem versão congelada        → o neutro (documento sem TOP: o comportamento de hoje);
 *   2. formato desconhecido        → `configuracao_ilegivel` (ninguém sabe o que ela decidiu, e a execução não adivinha);
 *   3. formatos 1 a 4              → o neutro, SEM LER a configuração: a seção não existia quando a versão foi gravada,
 *                                    e uma versão 1 a 4 que o leitor estrito recusaria (uma chave a mais, por exemplo)
 *                                    nunca vira recusa nova — o receber e a confirmação de hoje seguem iguais;
 *   4. formato 5 malformado        → `configuracao_ilegivel` (fail-closed: o 5 é o formato que DIZ a seção);
 *   5. formato 5                   → a seção como a versão a diz, lida e normalizada (`secoesExtensaoDaVersaoTop`).
 * `codigoBase` viaja junto por ser a mesma entrada das outras leituras da versão; a leitura não o usa.
 */
function secaoDaVersaoTop<T>(
  versao: VersaoTopDaSecaoCompra,
  neutro: () => T,
  escolher: (secoes: ReturnType<typeof secoesExtensaoDaVersaoTop>) => T,
): LeituraDaSecaoCompraTop<T> {
  if (!versao) return { ok: true, valor: neutro() };
  const formato = versaoSchemaDaConfiguracaoTop(versao.configuracao);
  if (formato === null) return { ok: false, motivo: "configuracao_ilegivel" };
  if (formato !== VERSAO_SCHEMA_CONFIGURACAO_TOP_V5) return { ok: true, valor: neutro() };
  const lida = lerConfiguracaoTop(versao.configuracao);
  if (!lida.ok) return { ok: false, motivo: "configuracao_ilegivel" };
  return { ok: true, valor: escolher(secoesExtensaoDaVersaoTop(lida.valor)) };
}

/** `fluxoCompra` da versão congelada do PEDIDO (o receber pergunta se exige o pedido finalizado). */
export function fluxoCompraDaVersaoTop(versao: VersaoTopDaSecaoCompra): LeituraDaSecaoCompraTop<FluxoCompraTop> {
  return secaoDaVersaoTop(versao, () => SECAO_FLUXO_COMPRA.neutro(), (s) => s.fluxoCompra);
}

/** `divergenciaPedido` da versão congelada da COMPRA (a confirmação pergunta se compara com o pedido). */
export function divergenciaPedidoDaVersaoTop(versao: VersaoTopDaSecaoCompra): LeituraDaSecaoCompraTop<DivergenciaPedidoTop> {
  return secaoDaVersaoTop(versao, () => SECAO_DIVERGENCIA_PEDIDO.neutro(), (s) => s.divergenciaPedido);
}

// ---------------------------------------------------------------------------------------------------
// 3. A CONTA DA DIVERGÊNCIA
// ---------------------------------------------------------------------------------------------------

/**
 * Uma linha da COMPRA ligada ao pedido — uma consulta só na API: a linha da compra × o item do pedido de origem ×
 * o recebido nas OUTRAS compras não canceladas. Todos os números em TEXTO decimal, como o banco os devolve.
 */
export interface LinhaParaDivergencia {
  /** A linha da compra. */
  itemId: string;
  /** O item do pedido de origem (`origem_item_id`). */
  itemPedidoId: string;
  /** "código - descrição" do produto. */
  produto: string;
  quantidadeCompra: string;
  valorTotalCompra: string;
  quantidadePedido: string;
  valorTotalPedido: string;
  /**
   * A quantidade do item do pedido menos a soma ligada a ele nas OUTRAS compras não canceladas — o saldo antes
   * desta compra. O mesmo valor em todas as linhas do mesmo item do pedido.
   */
  saldoAntesDaCompra: string;
}

/** Uma divergência: de preço (por linha da compra) ou de quantidade (por item do pedido). */
export interface DivergenciaDoItem {
  campo: "preco" | "quantidade";
  itemPedidoId: string;
  /** As linhas da compra envolvidas: a linha (preço) ou todas as do item do pedido (quantidade; o lote divide linhas). */
  itemIds: string[];
  produto: string;
  /** Preço: o líquido unitário do pedido (6 casas). Quantidade: o saldo do pedido antes desta compra (4 casas). */
  valorPedido: string;
  /** Preço: o líquido unitário da compra (6 casas). Quantidade: a soma recebida por esta compra (4 casas). */
  valorCompra: string;
  /** (compra − pedido) / pedido × 100, 2 casas, com sinal. `null` quando a base (o pedido) é zero. */
  diferencaPercentual: string | null;
  /** |diferença| acima da tolerância do campo (comparação exata, antes de arredondar); base zero → sempre. */
  acimaDaTolerancia: boolean;
}

export interface ResultadoDivergencia {
  modo: ModoDivergenciaPedido;
  toleranciaPrecoPercentual: string;
  toleranciaQuantidadePercentual: string;
  /**
   * Só o que diverge (diferença ≠ 0). Agrupado por item do pedido, na ordem em que o item aparece nas linhas da
   * compra; dentro do item, primeiro o preço de cada linha (na ordem das linhas), depois a quantidade do item.
   */
  itens: DivergenciaDoItem[];
  /** Modo "bloqueia" E algum item acima da tolerância. */
  bloqueia: boolean;
}

const CASAS_PRECO_LIQUIDO = 6;
const CASAS_QUANTIDADE = 4;
const CASAS_PERCENTUAL = 2;

/**
 * O preço unitário LÍQUIDO da linha: valor total ÷ quantidade, 6 casas, meio para cima. A quantidade é sempre > 0
 * (o banco a exige); uma linha com zero — só alcançável por erro de quem chama — tem líquido zero, e nunca uma
 * divisão por zero.
 */
const liquidoUnitario = (valorTotal: string, quantidade: string): Decimal => {
  const q = D(quantidade);
  return q.isZero() ? D(0) : D(valorTotal).div(q).toDecimalPlaces(CASAS_PRECO_LIQUIDO, Decimal.ROUND_HALF_UP);
};

/** (compra − base) × 100 ÷ base — a multiplicação antes da divisão, para o caso exato continuar exato. */
const percentual = (compra: Decimal, base: Decimal): Decimal => compra.minus(base).times(100).div(base);

const textoPercentual = (pct: Decimal): string => pct.toFixed(CASAS_PERCENTUAL, Decimal.ROUND_HALF_UP);

/**
 * A DIVERGÊNCIA DA COMPRA COM O PEDIDO, pelas regras da seção (`divergenciaPedido` da TOP da compra):
 *   · PREÇO, por LINHA da compra: o líquido unitário dos dois lados. Base (pedido) zero → diverge se o da compra
 *     não é zero, sem percentual, sempre acima da tolerância. Senão o percentual entra quando ≠ 0, e está acima
 *     quando |percentual| > tolerância (exata; o igual NÃO passa). Para mais e para menos.
 *   · QUANTIDADE, por ITEM DO PEDIDO: a soma das linhas da compra ligadas a ele contra o saldo antes desta compra.
 *     Entra quando a soma ≠ saldo; acima quando |percentual| > tolerância. Saldo zero → não entra (não há o que
 *     comparar). O banco impede passar do saldo: na prática o percentual é ≤ 0 (a entrega parcial).
 *   · Os itens do pedido que esta compra não recebe NÃO entram.
 *   · Modo "nenhuma" → nada (a API nem chama a conta); "avisa" → os itens, sem bloquear; "bloqueia" → bloqueia se
 *     algum item está acima da tolerância.
 */
export function divergenciasDaCompra(secao: DivergenciaPedidoTop, linhas: readonly LinhaParaDivergencia[]): ResultadoDivergencia {
  const base = {
    modo: secao.modo,
    toleranciaPrecoPercentual: secao.toleranciaPrecoPercentual,
    toleranciaQuantidadePercentual: secao.toleranciaQuantidadePercentual,
  };
  if (secao.modo === "nenhuma") return { ...base, itens: [], bloqueia: false };

  const tolPreco = D(secao.toleranciaPrecoPercentual);
  const tolQuantidade = D(secao.toleranciaQuantidadePercentual);

  // O agrupamento por item do pedido, na ordem em que cada item aparece nas linhas da compra.
  const grupos = new Map<string, LinhaParaDivergencia[]>();
  for (const l of linhas) {
    const g = grupos.get(l.itemPedidoId);
    if (g) g.push(l);
    else grupos.set(l.itemPedidoId, [l]);
  }

  const itens: DivergenciaDoItem[] = [];
  for (const [itemPedidoId, doItem] of grupos) {
    for (const l of doItem) {
      const pedido = liquidoUnitario(l.valorTotalPedido, l.quantidadePedido);
      const compra = liquidoUnitario(l.valorTotalCompra, l.quantidadeCompra);
      const valores = { valorPedido: pedido.toFixed(CASAS_PRECO_LIQUIDO), valorCompra: compra.toFixed(CASAS_PRECO_LIQUIDO) };
      if (pedido.isZero()) {
        if (!compra.isZero()) {
          itens.push({ campo: "preco", itemPedidoId, itemIds: [l.itemId], produto: l.produto, ...valores, diferencaPercentual: null, acimaDaTolerancia: true });
        }
        continue;
      }
      const pct = percentual(compra, pedido);
      if (pct.isZero()) continue;
      itens.push({
        campo: "preco", itemPedidoId, itemIds: [l.itemId], produto: l.produto, ...valores,
        diferencaPercentual: textoPercentual(pct), acimaDaTolerancia: pct.abs().gt(tolPreco),
      });
    }

    const primeira = doItem[0]!;
    const saldo = D(primeira.saldoAntesDaCompra);
    if (saldo.isZero()) continue;
    const soma = doItem.reduce((acc, l) => acc.plus(D(l.quantidadeCompra)), D(0));
    if (soma.eq(saldo)) continue;
    const pct = percentual(soma, saldo);
    itens.push({
      campo: "quantidade",
      itemPedidoId,
      itemIds: doItem.map((l) => l.itemId),
      produto: primeira.produto,
      valorPedido: saldo.toFixed(CASAS_QUANTIDADE, Decimal.ROUND_HALF_UP),
      valorCompra: soma.toFixed(CASAS_QUANTIDADE, Decimal.ROUND_HALF_UP),
      diferencaPercentual: textoPercentual(pct),
      acimaDaTolerancia: pct.abs().gt(tolQuantidade),
    });
  }

  return { ...base, itens, bloqueia: secao.modo === "bloqueia" && itens.some((i) => i.acimaDaTolerancia) };
}

// ---------------------------------------------------------------------------------------------------
// 4. AS MENSAGENS — texto exato, usadas pela API (e pela tela da F6b)
// ---------------------------------------------------------------------------------------------------

export const MSG_FINALIZAR_SO_PEDIDO_ABERTO = "Só pedido aberto é finalizado.";
export const MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER = "Este pedido precisa ser finalizado antes de ser recebido.";
export const MENSAGEM_APROVACAO_PENDENTE_PEDIDO = "Este pedido precisa de aprovação antes de ser finalizado.";
export const MSG_APROVAR_ORCAMENTO_SO_PEDIDO_ABERTO = "Só pedido aberto é aprovado para orçamento.";
export const MSG_PEDIDO_JA_APROVADO_PARA_ORCAMENTO = "Este pedido já está aprovado para orçamento.";
export const MSG_ORCAMENTO_SO_PEDIDO_ABERTO = "Só pedido aberto recebe orçamento.";
export const MSG_PEDIDO_NAO_APROVADO_PARA_ORCAMENTO = "Este pedido não está aprovado para orçamento.";
export const MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO = "A TOP deste pedido não tem orçamento nas próximas operações.";
export const MSG_ORCAMENTO_FORNECEDOR_REPETIDO = "Este pedido já tem orçamento deste fornecedor.";
export const MSG_PEDIDO_JA_TEM_VENCEDOR = "Este pedido já tem orçamento vencedor.";
export const MSG_ORCAMENTO_NAO_ABERTO = "Este orçamento não está aberto.";
export const MSG_ORCAMENTO_PEDIDO_NAO_ABERTO = "O pedido deste orçamento não está aberto.";
export const MSG_VENCEDOR_SO_PEDIDO_ABERTO = "O vencedor só é escolhido com o pedido aberto.";
export const MSG_VENCEDOR_PEDIDO_COM_COMPRA = "Este pedido já gerou compra: o orçamento vencedor não pode mais ser escolhido.";
export const MSG_ORCAMENTO_NAO_COBRE_O_PEDIDO = "O orçamento não cobre os itens do pedido.";
export const MSG_ORCAMENTO_PRECO_DOS_ITENS = "Informe o preço de cada item do orçamento, uma vez cada.";
export const MSG_ORCAMENTO_ITEM_DE_OUTRO_PEDIDO = "Item que não é deste pedido.";
export const MSG_ORCAMENTO_VALIDADE_ANTES_DA_DATA = "A validade do orçamento não pode ser anterior à data do documento.";
export const MSG_DIVERGENCIA_COM_O_PEDIDO = "A compra diverge do pedido além da tolerância desta operação.";
