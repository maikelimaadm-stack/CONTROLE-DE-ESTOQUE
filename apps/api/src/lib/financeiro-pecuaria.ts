/**
 * O TÍTULO DA COMPRA E DA VENDA DE ANIMAIS PELA TOP PADRÃO (OPERACOES-01 F10r, decisão 287) — a pecuária sai do legado.
 *
 * O movimento de animais (`POST /api/livestock/movements`) não grava TOP no registro (a tabela não tem a coluna): vale a
 * TOP PADRÃO da família na organização, na versão corrente — o MOLDE da solicitação de compra (`routes/supply.ts`, a
 * finalização com título, e `financeiroDaTopPadrao`). A diferença: o documento do movimento INFORMA natureza e centro
 * (a solicitação não informa nenhum). Por isso:
 *   · a classificação é POR CAMPO (`planoDaClassificacaoPorCampo`): o documento com os dois ganha; senão cada campo é o
 *     do documento ou, sem ele, o padrão da TOP — o campo informado no documento NUNCA é descartado (o movimento de
 *     hoje usa a natureza OU o centro informados sozinhos);
 *   · a troca proibida (`documentoTroca` desligado) é conferida contra o que o documento informou.
 *
 * A ordem (só chamada quando haverá título, e ANTES de qualquer gravação do movimento):
 *   1. a família é PERGUNTADA ao registry (`erp.animal_movements` pelo `movement_type`) — nenhum código literal aqui;
 *   2. a TOP padrão da família (versão corrente, `for share` no pai); sem ela → `sem_top`;
 *   3. a seção `financeiroPadrao` e os padrões da versão (só o formato 5 executa);
 *   4. SEM padrões na TOP (fora do 5, ou no 5 neutro) e sem "exigir" → `sem_top`, COM OU SEM natureza e centro no
 *      documento: quem chama faz o código de hoje INTACTO, sem TOP no título nem `financeiro` na trilha (o contrato do
 *      skew, sentido 2); senão, o plano por campo;
 *   5. a troca proibida → 422 (`details` nos campos do corpo);
 *   6. "exigir" sem o par → 422 (`details` nos campos que faltam);
 *   7. a conta padrão inativada ou excluída depois de gravada a TOP → 422 (`for share`: não muda até gravar o título);
 *   8. a TOP, a natureza e o centro (o `null` sai do legado do movimento, por quem chama), o tipo de título, a conta e a
 *      origem de cada campo do par (para a trilha).
 * A natureza e o centro (da TOP e do documento) são revalidados pela conferência do rateio de `createTitles`
 * (`exigirRateioAnalitico`); o tipo de título não tem ativo nem exclusão — a mesma porta da solicitação.
 */
import {
  MENSAGEM_EXIGE_CLASSIFICACAO, camposTrocadosDosPadroes, mensagemDosPadroesTrocados, planoDaClassificacaoPorCampo, resolverTipoOperacao
} from "@agro/domain";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";
import { topPadraoDaFamilia, type TopPadraoDaFamilia } from "./financeiro-classificacao.js";
import { contaPadraoUtilizavel, MENSAGEM_CONTA_PADRAO_INUTILIZAVEL } from "./financeiro-padroes-top.js";
import { padroesDaTopParaExecucao } from "./financeiro-top.js";

/** O tipo de movimento de animais que gera título. */
export type MovimentoDeAnimaisComTitulo = "purchase" | "sale";

/** A natureza e o centro que o corpo do movimento informou (`financial_category_id`, `cost_center_id`). */
export interface ClassificacaoDoMovimento { naturezaId: string | null; centroCustoId: string | null }

/**
 * O que a TOP padrão manda no título do movimento:
 *   · `sem_top` — sem TOP padrão, fora do 5 ou sem padrões com "padrão legado" (com ou sem os campos no documento):
 *                 o código de hoje, intacto;
 *   · `top`     — a TOP agiu: a natureza e o centro (`null` = o legado do movimento naquele campo), o tipo de título, a
 *                 conta, e a TOP e a versão vão para o título.
 */
export type FinanceiroDoMovimentoDeAnimais =
  | { tipo: "sem_top" }
  | {
      tipo: "top"; top: TopPadraoDaFamilia; naturezaId: string | null; centroCustoId: string | null;
      tipoTituloId: string | null; contaBancariaId: string | null; origem: OrigemDaClassificacaoDoMovimento;
    };

/** De onde veio cada campo do par (a trilha): o documento, o padrão da TOP ou o legado do movimento. */
export type OrigemDoCampo = "documento" | "padrão da TOP" | "padrão legado";
export interface OrigemDaClassificacaoDoMovimento { natureza: OrigemDoCampo; centro: OrigemDoCampo }

/** O campo do corpo do movimento que recebe a recusa de cada parte do par. */
const CAMPO_DO_CORPO = { natureza: "financial_category_id", centro: "cost_center_id" } as const;

/**
 * A origem de UM campo, na ordem do plano por campo: o documento que o informou; senão o padrão da TOP; senão o legado.
 * Com o documento completo o plano é o do documento, e cada campo diz "documento" — o mesmo resultado.
 */
const temValor = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";
const origemDoCampo = (doDocumento: string | null, daTop: string | null | undefined): OrigemDoCampo =>
  temValor(doDocumento) ? "documento" : temValor(daTop) ? "padrão da TOP" : "padrão legado";

/** A regra da TOP padrão no título da compra (`purchase`) ou da venda (`sale`) de animais. Lança 422 nas recusas. */
export async function financeiroDoMovimentoDeAnimais(ctx: ServiceCtx, tipo: MovimentoDeAnimaisComTitulo, documento: ClassificacaoDoMovimento): Promise<FinanceiroDoMovimentoDeAnimais> {
  const familia = resolverTipoOperacao("erp.animal_movements", tipo)?.codigo;
  if (!familia) return { tipo: "sem_top" };
  const top = await topPadraoDaFamilia(ctx, familia);
  if (!top) return { tipo: "sem_top" };
  const fin = await padroesDaTopParaExecucao(ctx, top.tipoOperacaoVersaoId);
  // A TOP sem padrões e sem "exigir" não age: nem quando o documento informa os dois campos (senão a TOP no 4, ou no 5
  // neutro, entraria no título só porque o documento veio completo).
  if (fin.padroes === null && fin.secao.semClassificacao !== "exigir") return { tipo: "sem_top" };
  const plano = planoDaClassificacaoPorCampo({ documento, padrao: fin.padroes, semClassificacao: fin.secao.semClassificacao });

  if (fin.padroes && !fin.secao.documentoTroca) {
    const campos = camposTrocadosDosPadroes(fin.padroes, { naturezaIds: [documento.naturezaId], centroCustoIds: [documento.centroCustoId] });
    if (campos.length) {
      const m = mensagemDosPadroesTrocados(campos);
      throw validation(m, campos.flatMap((c) => (c === "natureza" || c === "centro" ? [{ path: [CAMPO_DO_CORPO[c]], message: m }] : [])));
    }
  }
  if (plano.tipo === "exigir") {
    throw validation(MENSAGEM_EXIGE_CLASSIFICACAO, plano.faltam.map((f) => ({ path: [CAMPO_DO_CORPO[f]], message: MENSAGEM_EXIGE_CLASSIFICACAO })));
  }
  const contaBancariaId = fin.padroes?.contaBancariaId ?? null;
  if (contaBancariaId && !(await contaPadraoUtilizavel(ctx, contaBancariaId, { trava: true }))) throw validation(MENSAGEM_CONTA_PADRAO_INUTILIZAVEL);

  return {
    tipo: "top", top,
    naturezaId: plano.naturezaId, centroCustoId: plano.centroCustoId,
    tipoTituloId: fin.padroes?.tipoTituloId ?? null, contaBancariaId,
    origem: {
      natureza: origemDoCampo(documento.naturezaId, fin.padroes?.naturezaId),
      centro: origemDoCampo(documento.centroCustoId, fin.padroes?.centroCustoId)
    }
  };
}
