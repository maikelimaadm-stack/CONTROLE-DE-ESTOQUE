/**
 * OPERACOES-01 F9 (decisão 286) — A PROVISÃO PELA TOP: O TÍTULO PREVISTO.
 *
 * O título PREVISTO (`erp.financial_titles.status = 'previsto'`, 0045) é a promessa de caixa de um documento que
 * ainda não foi faturado. Ele fica FORA das baixas (o banco recusa a baixa) e das listas, totais e relatórios padrão;
 * aparece no cartão "Previstos", na situação "Previsto" e numa série separada do fluxo de caixa. Quando o documento
 * é faturado (a venda, a entrada), o previsto DÁ LUGAR ao título de verdade, no todo ou em parte; encerrar o saldo ou
 * cancelar o documento o remove. "Remover" é CANCELAR o previsto com trilha (motivo, quando, quem) — NUNCA apagar
 * (decisão 247: dado de produção nunca é apagado).
 *
 * ESTE ARQUIVO É A REGRA PURA, sem banco: QUEM provisiona (a família e a direção), QUANDO (o momento), QUANTO falta
 * prever (o ALVO, recalculado a cada evento — a sincronização é idempotente) e se as parcelas mudaram. Quem grava é a
 * API (`apps/api/src/lib/financeiro-provisao.ts`), nas duas regras que ela executa:
 *   · o PEDIDO DE VENDA provisiona A RECEBER — chamada ao salvar o pedido, confirmar ou cancelar a venda dele, encerrar
 *     o saldo e cancelar o pedido;
 *   · o PEDIDO DE COMPRA provisiona A PAGAR ao ser FINALIZADO (`documentos_compra.finalizado_em`, 0044) — chamada ao
 *     finalizar, receber, confirmar ou cancelar a compra gerada dele, encerrar o saldo e cancelar o pedido (OPERACOES-01
 *     F9b). O pedido de compra nunca finalizado não provisiona.
 *
 * A REGRA QUE TRAVA NASCE DESLIGADA (decisão 281, item (4) da 240): a provisão só vale numa TOP gravada no formato 5
 * com `financeiroPadrao.provisao` ligada, TOP por TOP. Nenhuma TOP de hoje provisiona.
 *
 * As famílias são PERGUNTADAS ao registry (`tipo-operacao.ts`) pela tabela e pela variante — nenhum código de família
 * escrito aqui (`familia-operacional-ssot-audit`). Registry sem a variante = regra ausente (fail-closed).
 */
import { D, money } from "@agro/shared";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "./tipo-operacao-configurado.js";

/** A direção do título que a provisão gera, como o banco a grava (`financial_titles.direction`). */
export type DirecaoDoTitulo = "payable" | "receivable";

/** Quando o documento passa a prometer o caixa. */
export type MomentoDaProvisao = "ao_salvar_o_pedido" | "ao_finalizar_o_pedido";

/** Uma regra de provisão: a família que provisiona, a direção do previsto, o momento e se a API já a executa. */
export interface RegraDeProvisao {
  readonly familia: string;
  readonly direcao: DirecaoDoTitulo;
  readonly momento: MomentoDaProvisao;
  /**
   * A API executa esta regra? As duas regras de hoje executam: a do pedido de venda desde a F9a e a do pedido de
   * COMPRA desde a F9b (depois da situação "finalizado" do pedido, 0044, F6a). Regra com `executa: false` fica só
   * DECLARADA: a TOP da família não aceita a provisão ligada (`recusasDoFinanceiroPadraoDaFamilia`).
   */
  readonly executa: boolean;
}

/** Uma regra, congelada — ou nada, quando o registry não declara a família (fail-closed: nunca uma vizinha). */
const regra = (familia: string | undefined, direcao: DirecaoDoTitulo, momento: MomentoDaProvisao, executa: boolean): RegraDeProvisao[] =>
  typeof familia === "string" ? [Object.freeze({ familia, direcao, momento, executa })] : [];

/**
 * AS REGRAS DE PROVISÃO, por família (as duas executam):
 *   · o PEDIDO DE VENDA provisiona A RECEBER ao ser SALVO (criar, editar, converter o orçamento) — o pedido de venda
 *     não tem confirmação (F9a);
 *   · o PEDIDO DE COMPRA provisiona A PAGAR ao ser FINALIZADO (`finalizado_em`, que a 0044 nunca apaga: o convertido e
 *     o reaberto depois de finalizado continuam provisionando; o nunca finalizado, não) — OPERACOES-01 F9b.
 */
export const REGRAS_DE_PROVISAO: readonly RegraDeProvisao[] = Object.freeze([
  ...regra(familiaOperacionalDeDocumentoVenda("order"), "receivable", "ao_salvar_o_pedido", true),
  ...regra(familiaOperacionalDeDocumentoCompra("pedido"), "payable", "ao_finalizar_o_pedido", true),
]);

/** A regra de provisão da família, ou `undefined` (a família não provisiona). */
export function regraDeProvisaoDaFamilia(familia: string): RegraDeProvisao | undefined {
  return REGRAS_DE_PROVISAO.find((r) => r.familia === familia);
}

/** A família provisiona HOJE (tem regra e a API a executa)? É a pergunta da seção, do editor e da API. */
export const provisaoExecutavelNaFamilia = (familia: string): boolean => regraDeProvisaoDaFamilia(familia)?.executa === true;

/** Uma parte faturada do documento (a venda ou a compra gerada do pedido), pela situação que conta para a provisão. */
export interface ParteDaProvisao {
  /** O total da parte, em string decimal. */
  readonly total: string;
  /** `confirmada` = faturada (confirmada ou com nota); `aberta` = ainda não faturada; `cancelada` = não conta. */
  readonly situacao: "aberta" | "confirmada" | "cancelada";
}

/** O que a provisão precisa saber do documento para dizer quanto falta prever. */
export interface EntradaDoAlvoDaProvisao {
  /** A TOP do documento provisiona (formato 5, seção ligada, família com regra executável)? */
  readonly provisaoLigada: boolean;
  /** O documento está cancelado? */
  readonly cancelado: boolean;
  /**
   * Não há mais nada a gerar do documento — o saldo foi encerrado ou o pedido foi convertido (só o que já foi gerado
   * continua esperado)?
   */
  readonly saldoEncerrado: boolean;
  /** O total do documento, em string decimal. */
  readonly totalDoDocumento: string;
  /** As partes faturadas do documento (as vendas ou as compras geradas dele), de qualquer situação. */
  readonly partes: readonly ParteDaProvisao[];
}

/**
 * O ALVO DA PROVISÃO: quanto o documento ainda promete de caixa, em string com 2 casas, NUNCA negativo.
 *   · TOP que não provisiona, ou documento cancelado → `"0.00"` (o previsto sai inteiro);
 *   · esperado = com o saldo ENCERRADO (ou o pedido convertido: nada mais a gerar), a soma das partes não canceladas
 *     (o que foi gerado); senão, o total do documento;
 *   · realizado = a soma das partes CONFIRMADAS (elas já têm os títulos de verdade);
 *   · alvo = max(0, esperado − realizado). A parte ainda aberta continua prevista até ser confirmada.
 * Dinheiro em `decimal.js`, nunca ponto flutuante. Valor que não é decimal LANÇA (é defeito de quem chama).
 */
export function alvoDaProvisao(p: EntradaDoAlvoDaProvisao): string {
  if (!p.provisaoLigada || p.cancelado) return money(0);
  const vivas = p.partes.filter((x) => x.situacao !== "cancelada");
  const esperado = p.saldoEncerrado ? vivas.reduce((s, x) => s.plus(D(x.total)), D(0)) : D(p.totalDoDocumento);
  const realizado = vivas.filter((x) => x.situacao === "confirmada").reduce((s, x) => s.plus(D(x.total)), D(0));
  const alvo = esperado.minus(realizado);
  return money(alvo.gt(0) ? alvo : 0);
}

/** Uma parcela prevista: o valor (string decimal) e o vencimento (ISO; só a data conta). */
export interface ParcelaPrevista {
  readonly valor: string;
  readonly vencimento: string;
}

/** A chave canônica da parcela: o valor pelo VALOR ("100" = "100.00") e o vencimento pelos 10 primeiros caracteres. */
function chaveDaParcela(p: ParcelaPrevista): string | null {
  try {
    return `${D(p.valor).toFixed()}|${String(p.vencimento).slice(0, 10)}`;
  } catch {
    return null;
  }
}

/**
 * As duas listas têm as MESMAS parcelas, como MULTICONJUNTO (a ordem não importa; parcela repetida conta)? É o que
 * decide se a sincronização é um no-op (os mesmos previstos ficam, com os mesmos ids) ou se os atuais são cancelados
 * e nascem outros. Valor que não é decimal nunca é igual (conta como mudança).
 */
export function mesmasParcelas(a: readonly ParcelaPrevista[], b: readonly ParcelaPrevista[]): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map(chaveDaParcela);
  const kb = b.map(chaveDaParcela);
  if (ka.some((k) => k === null) || kb.some((k) => k === null)) return false;
  const sa = (ka as string[]).slice().sort();
  const sb = (kb as string[]).slice().sort();
  return sa.every((k, i) => k === sb[i]);
}

/** Os motivos gravados no previsto CANCELADO (`financial_titles.cancel_reason`) — a trilha de por que ele saiu. */
export const MOTIVOS_DA_PROVISAO = Object.freeze({
  pedidoGravado: "Pedido alterado",
  faturado: (codigo: string): string => `Faturado na venda ${codigo}`,
  vendaCancelada: (codigo: string): string => `Venda ${codigo} cancelada`,
  saldoEncerrado: (motivo: string): string => `Saldo do pedido encerrado: ${motivo}`,
  pedidoCancelado: (motivo: string | null): string => (motivo?.trim() ? `Pedido cancelado: ${motivo.trim()}` : "Pedido cancelado"),
  semProvisao: "A operação do pedido não provisiona mais",
} as const);

/**
 * Os motivos gravados no previsto do PEDIDO DE COMPRA que sai cancelado (`cancel_reason`). Encerrar o saldo, cancelar o
 * pedido e a TOP que deixou de provisionar usam os de `MOTIVOS_DA_PROVISAO` (o mesmo texto da venda).
 */
export const MOTIVOS_DA_PROVISAO_COMPRA = Object.freeze({
  pedidoFinalizado: "Pedido finalizado",
  recebido: (codigo: string): string => `Recebido na compra ${codigo}`,
  compraConfirmada: (codigo: string): string => `Compra ${codigo} confirmada`,
  compraCancelada: (codigo: string): string => `Compra ${codigo} cancelada`,
} as const);

/**
 * 422 — o pedido de compra cuja TOP provisiona e que não tem natureza e centro, nem no documento nem nos padrões da TOP. A
 * compra não tem "padrão legado" (a 1ª por código): sem o par, a provisão não tem rateio.
 */
export const MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO =
  "Esta operação provisiona contas a pagar ao finalizar o pedido: informe a natureza financeira e o centro de resultado, ou configure os padrões da TOP.";
