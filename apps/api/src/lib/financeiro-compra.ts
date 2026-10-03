/**
 * OS PADRÕES FINANCEIROS DA TOP NO SALVAR DA COMPRA E DO PEDIDO DE COMPRA (OPERACOES-01 F9b, decisão 286).
 *
 * A compra e o pedido de compra NÃO SE EDITAM (não há PUT): o que a TOP (a versão congelada, no formato 5) manda sobre
 * o documento é conferido aqui, no lançamento, antes do número — recusar só na confirmação ou na finalização deixaria
 * o documento preso (só cancelar). A confirmação e a finalização conferem de novo (um cadastro pode ter sido inativado
 * depois).
 *
 *   · a COMPRA que gera título: a troca proibida (`documentoTroca` desligado e o documento com natureza, centro ou
 *     forma diferentes do padrão) recusa; sem natureza e centro no documento e com o PAR na TOP, a compra é salva — a
 *     exigência de hoje ("Informe a natureza financeira e o centro de resultado…") é dispensada e a confirmação usa o
 *     par da TOP (`classificacaoDaTop`);
 *   · o PEDIDO cuja TOP provisiona, com QUALQUER total (zero inclusive): a troca proibida recusa, e a falta de
 *     classificação (nem o pedido nem a TOP têm o par) também — a compra não tem padrão legado, e sem o par a provisão
 *     não teria rateio. O total não conta porque o valor do pedido aberto ainda muda sem passar por aqui (o orçamento
 *     vencedor o grava, `compras-orcamento.ts`), e a classificação e a troca não dependem dele: pular o pedido de total
 *     zero deixaria o pedido preso no finalizar, com a TOP congelada.
 *
 * NEUTRO = HOJE: formatos 1 a 4, ou o 5 sem padrões e sem provisão → nada (o caminho de hoje). Custo: nenhuma consulta
 * quando a compra não gera título; senão (e em todo pedido), uma leitura da versão — e a dos padrões só quando a versão
 * executa (`padroesDaTopParaExecucao`).
 *
 * As famílias são PERGUNTADAS ao registry — nenhum código de família escrito aqui. Nada de `routes/`: a regra mora na
 * lib e as rotas de compras a chamam.
 */
import { DomainError } from "@agro/shared";
import {
  MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO, camposTrocadosDosPadroes, familiaOperacionalDeDocumentoCompra, mensagemDosPadroesTrocados,
  planoDaClassificacao, provisaoExecutavelNaFamilia
} from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { err } from "./errors.js";
import { padroesDaTopParaExecucao } from "./financeiro-top.js";

/** A família do pedido de compra, perguntada ao registry. */
const FAMILIA_DO_PEDIDO_DE_COMPRA: string | undefined = familiaOperacionalDeDocumentoCompra("pedido");

/** O que o documento informa e a TOP pode mandar: a natureza e o centro (o par do documento) e a forma de pagamento. */
export interface DocumentoDeCompraNoSalvar { naturezaId: string | null; centroCustoId: string | null; formaPagamentoId: string | null }

/**
 * Confere os padrões financeiros da TOP no SALVAR da compra (`especie = "compra"`) ou do pedido (`"pedido"`). Devolve
 * `classificacaoDaTop`: a natureza e o centro do título sairão do PAR da TOP (o documento não os trouxe) — quem salva
 * dispensa então a exigência de natureza e centro no documento. Recusas (422, antes do número):
 *   · a troca proibida → `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA` em `financeiroPadrao.documentoTroca`;
 *   · o pedido cuja TOP provisiona sem o par → `VALIDATION_ERROR` em `categoria_financeira_id`
 *     (`MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO`), o formato da recusa de hoje do salvar da compra.
 */
export async function padroesDaTopNoSalvarDaCompra(ctx: ServiceCtx, p: {
  especie: "compra" | "pedido";
  versaoId: string;
  /** A compra vai gerar título (a política prevê conta a pagar E o total > 0)? Só a compra usa. */
  geraTitulo: boolean;
  documento: DocumentoDeCompraNoSalvar;
}): Promise<{ classificacaoDaTop: boolean }> {
  const nada = { classificacaoDaTop: false };
  // 1. A compra sem título a gerar: nenhuma regra financeira a conferir, nem consulta. O PEDIDO segue com qualquer total:
  //    o vencedor do orçamento grava o valor dele depois, sem passar por aqui (ver o cabeçalho).
  if (p.especie === "compra" && !p.geraTitulo) return nada;

  // 2. Só o formato 5 executa a seção e os padrões.
  const fin = await padroesDaTopParaExecucao(ctx, p.versaoId);
  if (!fin.formato5) return nada;

  // 3. O pedido só gera título (previsto) com a provisão ligada: sem ela, nada a conferir, como hoje.
  if (p.especie === "pedido") {
    const ligada = fin.secao.provisao && fin.familia !== null && fin.familia === FAMILIA_DO_PEDIDO_DE_COMPRA
      && provisaoExecutavelNaFamilia(fin.familia);
    if (!ligada) return nada;
  }

  // 4. A troca proibida: o documento informou outro valor num campo que a TOP padroniza.
  const doc = p.documento;
  if (fin.padroes && !fin.secao.documentoTroca) {
    const campos = camposTrocadosDosPadroes(fin.padroes, { naturezaIds: [doc.naturezaId], centroCustoIds: [doc.centroCustoId], formaPagamentoId: doc.formaPagamentoId });
    if (campos.length) {
      const m = mensagemDosPadroesTrocados(campos);
      throw new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", m, { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: m }] });
    }
  }

  // 5. A classificação: documento (par) → padrão da TOP (par) → "exigir" (a compra não tem padrão legado).
  const pc = planoDaClassificacao({ documento: { naturezaId: doc.naturezaId, centroCustoId: doc.centroCustoId }, padrao: fin.padroes, semClassificacao: "exigir" });

  // 6. O pedido cuja TOP provisiona sem o par: a provisão não teria rateio.
  if (p.especie === "pedido" && pc.tipo === "exigir") {
    throw err("VALIDATION_ERROR", MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO, [{ path: "categoria_financeira_id", message: MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO }]);
  }

  // 7. O par saiu da TOP. Na compra sem o par (nem no documento, nem na TOP), a recusa é a de hoje, de quem salva.
  return { classificacaoDaTop: pc.tipo === "pronta" && pc.origem === "padrão da TOP" };
}
