/**
 * A PROVISÃO DO PEDIDO DE VENDA (OPERACOES-01 F9, decisão 286) — os títulos PREVISTOS que o pedido promete.
 *
 * O pedido de venda cuja versão CONGELADA da TOP está no formato 5 com `financeiroPadrao.provisao` ligada promete o
 * caixa ao ser salvo: nascem títulos a receber na situação `previsto` (0045: fora das baixas, das listas e dos totais
 * padrão; o banco recusa baixa e qualquer mudança que não seja cancelar). A regra pura (o ALVO, as parcelas iguais, os
 * motivos) mora no domínio (`financeiro-provisao.ts`); aqui fica a gravação.
 *
 * UMA FUNÇÃO IDEMPOTENTE, chamada em todo evento que muda o que o pedido ainda promete: gravar o pedido (criar, PUT,
 * PATCH, conversão do orçamento), confirmar uma venda dele ("Faturado na venda …"), cancelar uma venda dele, encerrar o
 * saldo e cancelar o pedido. Ela recalcula o ALVO = (o total do pedido, ou só as partes geradas se não há mais nada a
 * gerar — saldo encerrado ou pedido convertido) − Σ vendas CONFIRMADAS dele — zero quando o pedido está cancelado ou a
 * TOP não provisiona — e compara os previstos atuais com o que o alvo pede:
 *   · iguais (as mesmas parcelas, a mesma empresa, o mesmo cliente, a mesma versão da TOP e, quando já decidida, a mesma
 *     natureza e o mesmo centro) → NADA muda: os mesmos ids continuam (salvar o pedido sem mudar o que ele promete não
 *     mexe no financeiro);
 *   · diferentes → os atuais são CANCELADOS com trilha (motivo, quando, quem; NUNCA apagados — decisão 247) e, com
 *     alvo > 0, nascem os novos.
 *
 * NEUTRO = HOJE: TOP nos formatos 1 a 4, sem TOP, ou no 5 com a provisão desligada (o neutro), e sem previsto gravado
 * → três leituras e nenhum efeito (nem trilha). A provisão do PEDIDO DE COMPRA finalizado é da F9b (a regra do domínio
 * está declarada com `executa: false`).
 *
 * TRAVA: o pedido `for update` primeiro (é o coordenador: as vendas dele, a edição, o cancelamento e o encerramento se
 * serializam nele) e os previstos `for update`. Quem chama de uma venda trava a venda e logo o pedido
 * (`travarPedidoDaProvisao`) ANTES dos efeitos — a ordem é sempre venda → pedido → contadores, nunca o contrário.
 *
 * O detalhe do pedido (`GET /sales/orders/:id`, `titles`) lista os previstos dele (vivos e cancelados), com a situação.
 */
import { D, DomainError, todayISO } from "@agro/shared";
import {
  MENSAGEM_EXIGE_CLASSIFICACAO, MOTIVOS_DA_PROVISAO, alvoDaProvisao, camposTrocadosDosPadroes, familiaOperacionalDeDocumentoVenda,
  mensagemDosPadroesTrocados, mesmasParcelas, planoDaClassificacao, provisaoExecutavelNaFamilia,
  type ParteDaProvisao, type PlanoDaClassificacao
} from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { audit } from "./service.js";
import { err, validation } from "./errors.js";
import { padroesDaTopParaExecucao } from "./financeiro-top.js";
import { contaPadraoUtilizavel, MENSAGEM_CONTA_PADRAO_INUTILIZAVEL } from "./financeiro-padroes-top.js";
import { classificacaoLegada, MENSAGEM_SEM_CLASSIFICACAO_LEGADA } from "./financeiro-classificacao.js";
import { createTitles, installmentPlanSchema, parcelasDoTitulo, type InstallmentPlan } from "../services/financial-core.js";

/** O que a sincronização fez: os previstos cancelados, os criados e o alvo (string decimal, 2 casas). */
export interface ResultadoDaProvisao { cancelados: string[]; criados: string[]; alvo: string }

/** A família do pedido de venda, perguntada ao registry (nenhum código de família escrito aqui). */
const FAMILIA_DO_PEDIDO: string | undefined = familiaOperacionalDeDocumentoVenda("order");

/** O pedido como a provisão o lê (uma linha, travada). */
interface PedidoDaProvisao {
  id: string; code: string; empresa_id: string; client_id: string; status: string; saldo_encerrado: boolean; total: string;
  document_date: string; due_date: string | null; installment_plan: unknown;
  tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null;
  categoria_financeira_id: string | null; centro_custo_id: string | null; payment_method_id: string | null;
}

/** Um previsto atual do pedido, com o que entra na comparação (a 1ª linha do rateio: o previsto tem uma só). */
interface PrevistoAtual {
  id: string; valor: string; vencimento: string; empresa_id: string; person_id: string | null; tipo_operacao_versao_id: string | null;
  natureza_id: string | null; centro_custo_id: string | null;
}

/** Ids comparados como texto em minúsculas; nulo só é igual a nulo. */
const mesmo = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ? a.toLowerCase() : null) === (b ? b.toLowerCase() : null);

/** O parcelamento gravado no pedido (o mesmo critério da confirmação da venda); ilegível = sem plano (parcela única). */
function planoDoPedido(bruto: unknown): InstallmentPlan | null {
  if (bruto === null || typeof bruto !== "object" || !(bruto as { installments?: unknown }).installments) return null;
  const lido = installmentPlanSchema.safeParse(bruto);
  return lido.success ? lido.data : null;
}

/**
 * As parcelas do previsto: o plano do pedido aplicado ao ALVO, no vencimento que a venda usaria (1º vencimento do plano,
 * senão o vencimento do pedido, senão a data dele). Se o plano não cabe no alvo (a entrada do plano maior que o que
 * falta prever depois de uma venda parcial), o previsto é UMA parcela no mesmo vencimento — a promessa de caixa não pode
 * recusar o salvar do pedido nem a confirmação da venda.
 */
function parcelasDaProvisao(alvo: string, d: PedidoDaProvisao): { plan: InstallmentPlan | null; dueDate: string; parcelas: { amount: string; dueDate: string }[] } {
  const plan = planoDoPedido(d.installment_plan);
  const dueDate = plan?.first_due_date ?? d.due_date ?? d.document_date;
  try {
    return { plan, dueDate, parcelas: parcelasDoTitulo({ amount: alvo, dueDate, plan }) };
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return { plan: null, dueDate, parcelas: parcelasDoTitulo({ amount: alvo, dueDate, plan: null }) };
  }
}

/** A situação da venda gerada do pedido, como a provisão a conta. */
const situacaoDaParte = (status: string): ParteDaProvisao["situacao"] =>
  status === "cancelled" ? "cancelada" : status === "confirmed" || status === "invoiced" ? "confirmada" : "aberta";

/** A recusa da TOP (`TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA`, 422), no formato das exigências da venda. */
const exigencia = (caminho: string, mensagem: string) =>
  new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", mensagem, { exigencias: [{ caminho, mensagem }] });

/**
 * TRAVA O PEDIDO DE ORIGEM de uma venda ANTES dos efeitos dela (estoque, títulos, numeração). A sincronização trava o
 * pedido de novo no fim (a mesma transação: já é dela); sem esta trava adiantada, a venda seguraria os contadores
 * (código do título, ID Global, movimentos) enquanto espera o pedido, e a edição desse pedido — que segura o pedido e
 * pede os mesmos contadores para os previstos — fecharia um ciclo (deadlock). Com ela, a ordem é sempre venda → pedido
 * → contadores. Origem que não é pedido de venda vivo desta organização (orçamento) → nada travado.
 */
export async function travarPedidoDaProvisao(ctx: ServiceCtx, pedidoId: string): Promise<void> {
  await ctx.tx.query("select 1 from erp.sales_documents where id = $1 and organization_id = $2 and kind = 'order' and deleted_at is null for update", [pedidoId, ctx.orgId]);
}

/**
 * Recalcula os previstos do pedido de VENDA `pedidoId`. Idempotente. `motivo` vai para o `cancel_reason` dos previstos
 * que saem (`MOTIVOS_DA_PROVISAO`); quando a TOP do pedido deixou de provisionar, o motivo é o dela ("A operação do
 * pedido não provisiona mais"). Id que não é de um pedido de venda vivo desta organização (o orçamento de origem de uma
 * venda, por exemplo) → nada.
 *
 * Recusas (422, nada gravado — quem chama está na mesma transação): com previsto a criar, a TOP que não deixa o
 * documento trocar os padrões e o documento informou outro (natureza, centro, forma); "exigir" sem natureza e centro no
 * pedido nem na TOP; e o padrão legado sem par na organização (o texto de hoje).
 */
export async function sincronizarProvisaoDoPedido(ctx: ServiceCtx, pedidoId: string, motivo: string): Promise<ResultadoDaProvisao> {
  const d = (await ctx.tx.query<PedidoDaProvisao>(
    `select id::text as id, code, empresa_id::text as empresa_id, client_id::text as client_id, status,
            (saldo_encerrado_em is not null) as saldo_encerrado, total::text as total,
            document_date::text as document_date, due_date::text as due_date, installment_plan,
            tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            categoria_financeira_id::text as categoria_financeira_id, centro_custo_id::text as centro_custo_id,
            payment_method_id::text as payment_method_id
       from erp.sales_documents
      where id = $1 and organization_id = $2 and kind = 'order' and deleted_at is null
        for update`,
    [pedidoId, ctx.orgId])).rows[0];
  if (!d) return { cancelados: [], criados: [], alvo: "0.00" };

  const fin = await padroesDaTopParaExecucao(ctx, d.tipo_operacao_versao_id);
  const provisaoLigada = fin.formato5 && fin.secao.provisao && fin.familia !== null && fin.familia === FAMILIA_DO_PEDIDO
    && provisaoExecutavelNaFamilia(fin.familia);

  const atuais = (await ctx.tx.query<PrevistoAtual>(
    `select t.id::text as id, t.amount::text as valor, t.due_date::text as vencimento, t.empresa_id::text as empresa_id,
            t.person_id::text as person_id, t.tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            a.financial_category_id::text as natureza_id, a.cost_center_id::text as centro_custo_id
       from erp.financial_titles t
       left join lateral (select x.financial_category_id, x.cost_center_id from erp.title_apportionments x
                           where x.title_id = t.id order by x.amount desc, x.id limit 1) a on true
      where t.organization_id = $1 and t.source_type = 'sales_documents' and t.source_id = $2 and t.status = 'previsto'
        and t.deleted_at is null
      order by t.due_date, t.installment_number, t.id
        for update of t`,
    [ctx.orgId, d.id])).rows;
  // NEUTRO = HOJE: a TOP não provisiona e não há previsto → nenhum efeito, nem trilha.
  if (!provisaoLigada && atuais.length === 0) return { cancelados: [], criados: [], alvo: "0.00" };

  const partes: ParteDaProvisao[] = provisaoLigada
    ? (await ctx.tx.query<{ total: string; status: string }>(
      "select total::text as total, status from erp.sales_documents where organization_id = $1 and origin_document_id = $2 and kind = 'sale' and deleted_at is null",
      [ctx.orgId, d.id])).rows.map((p) => ({ total: p.total, situacao: situacaoDaParte(p.status) }))
    : [];
  // NADA MAIS A GERAR: o saldo encerrado e o pedido CONVERTIDO (inteiro, ou em partes até o saldo zerar) só esperam o que
  // já virou venda — o total das partes vivas, e não o do pedido (a venda pode ter saído com outro valor; a diferença
  // ficaria prevista para sempre num pedido que não fatura mais). Cancelar uma parte devolve o pedido a "aberto".
  const nadaMaisAGerar = d.saldo_encerrado || d.status === "converted";
  const alvo = alvoDaProvisao({ provisaoLigada, cancelado: d.status === "cancelled", saldoEncerrado: nadaMaisAGerar, totalDoDocumento: d.total, partes });
  const vaiPrever = D(alvo).gt(0);

  // AS REGRAS DA TOP, conferidas no documento a cada gravação em que há o que prever — antes de qualquer efeito.
  let classificacao: PlanoDaClassificacao | null = null;
  if (vaiPrever) {
    if (fin.padroes && !fin.secao.documentoTroca) {
      const campos = camposTrocadosDosPadroes(fin.padroes, { naturezaIds: [d.categoria_financeira_id], centroCustoIds: [d.centro_custo_id], formaPagamentoId: d.payment_method_id });
      if (campos.length) throw exigencia("financeiroPadrao.documentoTroca", mensagemDosPadroesTrocados(campos));
    }
    classificacao = planoDaClassificacao({
      documento: { naturezaId: d.categoria_financeira_id, centroCustoId: d.centro_custo_id },
      padrao: fin.padroes, semClassificacao: fin.secao.semClassificacao
    });
    if (classificacao.tipo === "exigir") throw exigencia("financeiroPadrao.semClassificacao", MENSAGEM_EXIGE_CLASSIFICACAO);
  }

  const alvoDasParcelas = vaiPrever ? parcelasDaProvisao(alvo, d) : null;
  const pronta = classificacao?.tipo === "pronta" ? classificacao : null;
  const iguais = mesmasParcelas(
    atuais.map((a) => ({ valor: a.valor, vencimento: a.vencimento })),
    (alvoDasParcelas?.parcelas ?? []).map((p) => ({ valor: p.amount, vencimento: p.dueDate })))
    && atuais.every((a) => mesmo(a.empresa_id, d.empresa_id) && mesmo(a.person_id, d.client_id) && mesmo(a.tipo_operacao_versao_id, d.tipo_operacao_versao_id)
      && (pronta === null || (mesmo(a.natureza_id, pronta.naturezaId) && mesmo(a.centro_custo_id, pronta.centroCustoId))));
  if (iguais) return { cancelados: [], criados: [], alvo };
  // A conta padrão vai para os previstos NOVOS: inativada ou excluída depois de gravada a TOP → recusa antes de qualquer
  // efeito (a natureza e o centro são conferidos pelo rateio, em `createTitles`).
  if (alvoDasParcelas && fin.padroes?.contaBancariaId && !(await contaPadraoUtilizavel(ctx, fin.padroes.contaBancariaId, { trava: true }))) {
    throw exigencia("padroesFinanceiros.contaBancariaId", MENSAGEM_CONTA_PADRAO_INUTILIZAVEL);
  }

  // OS ATUAIS SAEM CANCELADOS, com trilha — nunca apagados (decisão 247). ROW COUNT: travados acima, todos têm de mudar.
  const motivoEfetivo = !provisaoLigada && d.status !== "cancelled" ? MOTIVOS_DA_PROVISAO.semProvisao : motivo;
  const cancelados = atuais.map((a) => a.id);
  if (cancelados.length) {
    const u = await ctx.tx.query(
      "update erp.financial_titles set status='cancelled', cancel_reason=$3, cancelled_at=now(), cancelled_by=$4, version=version+1 where id = any($1::uuid[]) and organization_id=$2 and status='previsto'",
      [cancelados, ctx.orgId, motivoEfetivo, ctx.user.id]);
    if (u.rowCount !== cancelados.length) throw err("CONCURRENCY_CONFLICT", "Os títulos previstos do pedido mudaram durante a gravação; tente novamente");
  }

  // OS NOVOS: a classificação na ordem documento → padrão da TOP → (exigir já recusou) → padrão legado no que faltar.
  let criados: string[] = [];
  if (alvoDasParcelas && classificacao) {
    let naturezaId = classificacao.naturezaId;
    let centroCustoId = classificacao.centroCustoId;
    if (classificacao.tipo === "legado") {
      const legado = await classificacaoLegada(ctx, "income", { natureza: naturezaId === null, centro: centroCustoId === null });
      naturezaId = naturezaId ?? legado.naturezaId;
      centroCustoId = centroCustoId ?? legado.centroCustoId;
    }
    if (!naturezaId || !centroCustoId) throw validation(MENSAGEM_SEM_CLASSIFICACAO_LEGADA);
    const t = await createTitles(ctx, {
      previsto: true, empresaId: d.empresa_id, direction: "receivable", number: `PED-${d.code}`, personId: d.client_id,
      amount: alvo, dueDate: alvoDasParcelas.dueDate, plan: alvoDasParcelas.plan, emissionDate: todayISO(), note: `Previsto do pedido ${d.code}`,
      isDeductible: Boolean((d.installment_plan as { is_deductible?: boolean } | null)?.is_deductible),
      titleTypeId: fin.padroes?.tipoTituloId ?? null, contaPrevistaId: fin.padroes?.contaBancariaId ?? null,
      apportionment: [{ financialCategoryId: naturezaId, costCenterId: centroCustoId, percentage: "100" }],
      sourceType: "sales_documents", sourceId: d.id, tipoOperacaoId: d.tipo_operacao_id, tipoOperacaoVersaoId: d.tipo_operacao_versao_id
    });
    criados = t.ids;
  }
  await audit(ctx.tx, ctx, "sales_documents", d.id, "provisao", { motivo: motivoEfetivo, alvo, cancelados, criados });
  return { cancelados, criados, alvo };
}
