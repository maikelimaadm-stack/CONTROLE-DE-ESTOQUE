/**
 * A PROVISÃO DO PEDIDO (OPERACOES-01 F9, decisão 286) — os títulos PREVISTOS que o pedido promete: a do pedido de
 * VENDA (a receber, ao SALVAR) e, desde a F9b, a do pedido de COMPRA (a pagar, ao FINALIZAR).
 *
 * O pedido cuja versão CONGELADA da TOP está no formato 5 com `financeiroPadrao.provisao` ligada promete o caixa: nascem
 * títulos na situação `previsto` (0045: fora das baixas, das listas e dos totais padrão; o banco recusa baixa e
 * qualquer mudança que não seja cancelar). O pedido de venda promete ao ser salvo; o pedido de compra, ao ser
 * FINALIZADO (`documentos_compra.finalizado_em`, 0044, que nunca se apaga: o convertido e o reaberto depois de
 * finalizados continuam prometendo; o nunca finalizado, não). A regra pura (o ALVO, as parcelas iguais, os motivos)
 * mora no domínio (`financeiro-provisao.ts`); aqui fica a gravação.
 *
 * UM NÚCLEO, DUAS FONTES (`sincronizar` e `FonteDaProvisao`): a venda (`sales_documents`) e a compra
 * (`documentos_compra`) só diferem no que a fonte declara — como o pedido é lido, quais são as partes, a direção, o
 * número, a nota, a regra sem classificação e a sua recusa, o padrão legado e o dedutível. Uma cópia "equivalente" para
 * a compra divergiria na primeira mudança. A venda não muda: as mesmas recusas, a mesma trilha, o mesmo resultado.
 *
 * UMA FUNÇÃO IDEMPOTENTE POR FONTE, chamada em todo evento que muda o que o pedido ainda promete:
 *   · venda: gravar o pedido (criar, PUT, PATCH, conversão do orçamento), confirmar uma venda dele ("Faturado na venda
 *     …"), cancelar uma venda dele, encerrar o saldo e cancelar o pedido;
 *   · compra (F9b): finalizar o pedido, receber (a compra gerada pode zerar o saldo → convertido), confirmar a compra
 *     gerada (manual ou automática — a mesma função), cancelar a compra gerada (confirmada ou aberta: pode reabrir o
 *     pedido), encerrar o saldo e cancelar o pedido.
 * Ela recalcula o ALVO = (o total do pedido, ou só as partes geradas se não há mais nada a gerar — saldo encerrado ou
 * pedido convertido) − Σ partes CONFIRMADAS dele — zero quando o pedido está cancelado ou a TOP não provisiona — e
 * compara os previstos atuais com o que o alvo pede:
 *   · iguais (as mesmas parcelas, a mesma empresa, a mesma pessoa, a mesma versão da TOP e, quando já decidida, a mesma
 *     natureza e o mesmo centro) → NADA muda: os mesmos ids continuam (salvar o pedido sem mudar o que ele promete não
 *     mexe no financeiro);
 *   · diferentes → os atuais são CANCELADOS com trilha (motivo, quando, quem; NUNCA apagados — decisão 247) e, com
 *     alvo > 0, nascem os novos.
 *
 * NEUTRO = HOJE: TOP nos formatos 1 a 4, sem TOP, ou no 5 com a provisão desligada (o neutro), e sem previsto gravado
 * → três leituras e nenhum efeito (nem trilha). O pedido de compra nunca finalizado → uma leitura e nenhum efeito.
 *
 * TRAVA: o pedido `for update` primeiro (é o coordenador: as partes dele, a edição, o cancelamento e o encerramento se
 * serializam nele) e os previstos `for update`. Quem chama de uma parte (a venda, a compra) trava a parte e logo o pedido
 * (`travarPedidoDaProvisao`, `travarPedidoDeCompraDaProvisao`) ANTES dos efeitos — a ordem é sempre parte → pedido →
 * contadores, nunca o contrário.
 *
 * O detalhe do pedido (`GET /sales/orders/:id`, `titles`; `GET /compras/pedidos/:id`, `titulos`) lista os previstos dele
 * (vivos e cancelados), com a situação.
 */
import { D, DomainError, todayISO } from "@agro/shared";
import {
  MENSAGEM_EXIGE_CLASSIFICACAO, MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO, MOTIVOS_DA_PROVISAO, alvoDaProvisao, camposTrocadosDosPadroes,
  familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda, mensagemDosPadroesTrocados, mesmasParcelas, planoDaClassificacao,
  provisaoExecutavelNaFamilia,
  type DirecaoDoTitulo, type ParteDaProvisao, type PlanoDaClassificacao, type SemClassificacaoTop
} from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { audit } from "./service.js";
import { err, validation } from "./errors.js";
import { padroesDaTopParaExecucao, type FinanceiroDaVersao } from "./financeiro-top.js";
import { contaPadraoUtilizavel, MENSAGEM_CONTA_PADRAO_INUTILIZAVEL } from "./financeiro-padroes-top.js";
import { classificacaoLegada, MENSAGEM_SEM_CLASSIFICACAO_LEGADA } from "./financeiro-classificacao.js";
import { createTitles, installmentPlanSchema, parcelasDoTitulo, type InstallmentPlan } from "../services/financial-core.js";

/** O que a sincronização fez: os previstos cancelados, os criados e o alvo (string decimal, 2 casas). */
export interface ResultadoDaProvisao { cancelados: string[]; criados: string[]; alvo: string }

/** A família do pedido de venda, perguntada ao registry (nenhum código de família escrito aqui). */
const FAMILIA_DO_PEDIDO: string | undefined = familiaOperacionalDeDocumentoVenda("order");
/** A família do pedido de compra, perguntada ao registry (OPERACOES-01 F9b). */
const FAMILIA_DO_PEDIDO_DE_COMPRA: string | undefined = familiaOperacionalDeDocumentoCompra("pedido");

/**
 * O pedido como o núcleo o lê (uma linha, travada). As duas fontes mapeiam as colunas delas para estes nomes:
 *   · `cancelado` — venda: `status = 'cancelled'`; compra: `situacao = 'cancelado'`;
 *   · `nada_mais_a_gerar` — venda: saldo encerrado ou `converted`; compra: saldo encerrado ou `convertido`;
 *   · `em_estado_que_provisiona` — venda: sempre; compra: `finalizado_em is not null`.
 */
interface PedidoDaProvisao {
  id: string; code: string; empresa_id: string; person_id: string;
  cancelado: boolean; nada_mais_a_gerar: boolean; em_estado_que_provisiona: boolean;
  total: string; document_date: string; due_date: string | null; installment_plan: unknown;
  tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null;
  categoria_financeira_id: string | null; centro_custo_id: string | null; payment_method_id: string | null;
}

/** O par natureza/centro que o padrão legado completa (só a venda o tem). */
type Legado = (ctx: ServiceCtx, faltam: { natureza: boolean; centro: boolean }) => Promise<{ naturezaId: string | null; centroCustoId: string | null }>;

/** O que distingue a provisão de um tipo de pedido. Tudo o mais é o núcleo. */
interface FonteDaProvisao {
  /** A origem do previsto (`financial_titles.source_type`) E a entidade da trilha "provisao". */
  sourceType: "sales_documents" | "documentos_compra";
  /** A família do pedido, a do registry (nunca literal). */
  familia: string | undefined;
  /** A direção do previsto: venda a receber, compra a pagar. */
  direcao: DirecaoDoTitulo;
  /** O pedido desta organização, travado (`for update`); `undefined` = não é um pedido desta fonte. */
  ler(ctx: ServiceCtx, id: string): Promise<PedidoDaProvisao | undefined>;
  /** As partes geradas do pedido (as vendas ou as compras), de qualquer situação. */
  partes(ctx: ServiceCtx, id: string): Promise<ParteDaProvisao[]>;
  /** O número do previsto (as parcelas ganham o sufixo de `createTitles`). */
  numero(code: string): string;
  /** A observação do previsto. */
  nota(code: string): string;
  /** O que fazer sem natureza e centro nem no documento nem na TOP. */
  semClassificacao(fin: FinanceiroDaVersao): SemClassificacaoTop;
  /** A recusa de "exigir" (422 `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA`). */
  recusaSemClassificacao: { caminho: string; mensagem: string };
  /** O padrão legado (a 1ª natureza e o 1º centro por código), ou `null` — a fonte que nunca chega ao legado. */
  legado: Legado | null;
  /** O previsto é dedutível? */
  dedutivel(d: PedidoDaProvisao): boolean;
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
 * As parcelas do previsto: o plano do pedido aplicado ao ALVO, no vencimento que a parte usaria (1º vencimento do plano,
 * senão o vencimento do pedido, senão a data dele). Se o plano não cabe no alvo (a entrada do plano maior que o que
 * falta prever depois de uma parte), o previsto é UMA parcela no mesmo vencimento — a promessa de caixa não pode
 * recusar o salvar do pedido nem a confirmação da parte.
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
const situacaoDaVenda = (status: string): ParteDaProvisao["situacao"] =>
  status === "cancelled" ? "cancelada" : status === "confirmed" || status === "invoiced" ? "confirmada" : "aberta";

/** A situação da compra gerada do pedido de compra, como a provisão a conta (OPERACOES-01 F9b). */
const situacaoDaCompra = (situacao: string): ParteDaProvisao["situacao"] =>
  situacao === "cancelado" ? "cancelada" : situacao === "confirmado" ? "confirmada" : "aberta";

/** A recusa da TOP (`TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA`, 422), no formato das exigências da venda. */
const exigencia = (caminho: string, mensagem: string) =>
  new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", mensagem, { exigencias: [{ caminho, mensagem }] });

// ─────────────── as fontes ───────────────

/** O PEDIDO DE VENDA (F9a): a receber, ao salvar. As consultas são as de antes do núcleo, com os nomes do núcleo. */
const FONTE_VENDA: FonteDaProvisao = {
  sourceType: "sales_documents",
  familia: FAMILIA_DO_PEDIDO,
  direcao: "receivable",
  ler: async (ctx, id) => (await ctx.tx.query<PedidoDaProvisao>(
    `select id::text as id, code, empresa_id::text as empresa_id, client_id::text as person_id,
            (status = 'cancelled') as cancelado,
            (saldo_encerrado_em is not null or status = 'converted') as nada_mais_a_gerar,
            true as em_estado_que_provisiona, total::text as total,
            document_date::text as document_date, due_date::text as due_date, installment_plan,
            tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            categoria_financeira_id::text as categoria_financeira_id, centro_custo_id::text as centro_custo_id,
            payment_method_id::text as payment_method_id
       from erp.sales_documents
      where id = $1 and organization_id = $2 and kind = 'order' and deleted_at is null
        for update`,
    [id, ctx.orgId])).rows[0],
  partes: async (ctx, id) => (await ctx.tx.query<{ total: string; status: string }>(
    "select total::text as total, status from erp.sales_documents where organization_id = $1 and origin_document_id = $2 and kind = 'sale' and deleted_at is null",
    [ctx.orgId, id])).rows.map((p) => ({ total: p.total, situacao: situacaoDaVenda(p.status) })),
  numero: (code) => `PED-${code}`,
  nota: (code) => `Previsto do pedido ${code}`,
  semClassificacao: (fin) => fin.secao.semClassificacao,
  recusaSemClassificacao: { caminho: "financeiroPadrao.semClassificacao", mensagem: MENSAGEM_EXIGE_CLASSIFICACAO },
  legado: (ctx, faltam) => classificacaoLegada(ctx, "income", faltam),
  dedutivel: (d) => Boolean((d.installment_plan as { is_deductible?: boolean } | null)?.is_deductible),
};

/**
 * O PEDIDO DE COMPRA (OPERACOES-01 F9b): a pagar, ao FINALIZAR. A compra não tem padrão legado (sem o par no documento
 * nem na TOP, ela recusa desde a COMPRAS-01): a regra é sempre "exigir", com a recusa da provisão do pedido de compra.
 * Não dedutível. As partes são as compras geradas dele (`origem_documento_id`).
 */
const FONTE_COMPRA: FonteDaProvisao = {
  sourceType: "documentos_compra",
  familia: FAMILIA_DO_PEDIDO_DE_COMPRA,
  direcao: "payable",
  ler: async (ctx, id) => (await ctx.tx.query<PedidoDaProvisao>(
    `select id::text as id, codigo as code, empresa_id::text as empresa_id, fornecedor_id::text as person_id,
            (situacao = 'cancelado') as cancelado,
            (saldo_encerrado_em is not null or situacao = 'convertido') as nada_mais_a_gerar,
            (finalizado_em is not null) as em_estado_que_provisiona,
            valor_total::text as total, data_documento::text as document_date, data_vencimento::text as due_date,
            plano_parcelas as installment_plan,
            tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            categoria_financeira_id::text as categoria_financeira_id, centro_custo_id::text as centro_custo_id,
            forma_pagamento_id::text as payment_method_id
       from erp.documentos_compra
      where id = $1 and organization_id = $2 and especie = 'pedido'
        for update`,
    [id, ctx.orgId])).rows[0],
  partes: async (ctx, id) => (await ctx.tx.query<{ total: string; situacao: string }>(
    "select valor_total::text as total, situacao from erp.documentos_compra where organization_id = $1 and origem_documento_id = $2 and especie = 'compra'",
    [ctx.orgId, id])).rows.map((p) => ({ total: p.total, situacao: situacaoDaCompra(p.situacao) })),
  numero: (code) => `PC-${code}`,
  nota: (code) => `Previsto do pedido de compra ${code}`,
  semClassificacao: () => "exigir",
  recusaSemClassificacao: { caminho: "financeiroPadrao.provisao", mensagem: MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO },
  legado: null,
  dedutivel: () => false,
};

// ─────────────── o núcleo ───────────────

/**
 * O NÚCLEO DA SINCRONIZAÇÃO — o mesmo algoritmo para as duas fontes. `motivo` vai para o `cancel_reason` dos previstos
 * que saem; quando a TOP do pedido deixou de provisionar, o motivo é o dela ("A operação do pedido não provisiona
 * mais"). Recusas (422, nada gravado — quem chama está na mesma transação): com previsto a criar, a troca proibida, a
 * falta de classificação ("exigir", a recusa da fonte), a conta padrão inutilizável e o padrão legado sem par (só a
 * venda chega lá).
 */
async function sincronizar(ctx: ServiceCtx, fonte: FonteDaProvisao, pedidoId: string, motivo: string): Promise<ResultadoDaProvisao> {
  const d = await fonte.ler(ctx, pedidoId);
  if (!d) return { cancelados: [], criados: [], alvo: "0.00" };
  // O pedido de compra nunca finalizado nunca provisionou (finalizado não volta a aberto, 0044): nada a ler nem a fazer.
  // A venda sempre está num estado que provisiona.
  if (!d.em_estado_que_provisiona) return { cancelados: [], criados: [], alvo: "0.00" };

  const fin = await padroesDaTopParaExecucao(ctx, d.tipo_operacao_versao_id);
  const provisaoLigada = fin.formato5 && fin.secao.provisao && fin.familia !== null && fin.familia === fonte.familia
    && provisaoExecutavelNaFamilia(fin.familia);

  // A origem é PARÂMETRO (`$3`), nunca concatenada: a mesma consulta para as duas fontes.
  const atuais = (await ctx.tx.query<PrevistoAtual>(
    `select t.id::text as id, t.amount::text as valor, t.due_date::text as vencimento, t.empresa_id::text as empresa_id,
            t.person_id::text as person_id, t.tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            a.financial_category_id::text as natureza_id, a.cost_center_id::text as centro_custo_id
       from erp.financial_titles t
       left join lateral (select x.financial_category_id, x.cost_center_id from erp.title_apportionments x
                           where x.title_id = t.id order by x.amount desc, x.id limit 1) a on true
      where t.organization_id = $1 and t.source_type = $3 and t.source_id = $2 and t.status = 'previsto'
        and t.deleted_at is null
      order by t.due_date, t.installment_number, t.id
        for update of t`,
    [ctx.orgId, d.id, fonte.sourceType])).rows;
  // NEUTRO = HOJE: a TOP não provisiona e não há previsto → nenhum efeito, nem trilha.
  if (!provisaoLigada && atuais.length === 0) return { cancelados: [], criados: [], alvo: "0.00" };

  const partes: ParteDaProvisao[] = provisaoLigada ? await fonte.partes(ctx, d.id) : [];
  // NADA MAIS A GERAR: o saldo encerrado e o pedido CONVERTIDO (inteiro, ou em partes até o saldo zerar) só esperam o que
  // já virou parte — o total das partes vivas, e não o do pedido (a parte pode ter saído com outro valor; a diferença
  // ficaria prevista para sempre num pedido que não gera mais nada). Cancelar uma parte devolve o pedido ao andamento.
  const alvo = alvoDaProvisao({ provisaoLigada, cancelado: d.cancelado, saldoEncerrado: d.nada_mais_a_gerar, totalDoDocumento: d.total, partes });
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
      padrao: fin.padroes, semClassificacao: fonte.semClassificacao(fin)
    });
    if (classificacao.tipo === "exigir") throw exigencia(fonte.recusaSemClassificacao.caminho, fonte.recusaSemClassificacao.mensagem);
  }

  const alvoDasParcelas = vaiPrever ? parcelasDaProvisao(alvo, d) : null;
  const pronta = classificacao?.tipo === "pronta" ? classificacao : null;
  const iguais = mesmasParcelas(
    atuais.map((a) => ({ valor: a.valor, vencimento: a.vencimento })),
    (alvoDasParcelas?.parcelas ?? []).map((p) => ({ valor: p.amount, vencimento: p.dueDate })))
    && atuais.every((a) => mesmo(a.empresa_id, d.empresa_id) && mesmo(a.person_id, d.person_id) && mesmo(a.tipo_operacao_versao_id, d.tipo_operacao_versao_id)
      && (pronta === null || (mesmo(a.natureza_id, pronta.naturezaId) && mesmo(a.centro_custo_id, pronta.centroCustoId))));
  if (iguais) return { cancelados: [], criados: [], alvo };
  // A conta padrão vai para os previstos NOVOS: inativada ou excluída depois de gravada a TOP → recusa antes de qualquer
  // efeito (a natureza e o centro são conferidos pelo rateio, em `createTitles`).
  if (alvoDasParcelas && fin.padroes?.contaBancariaId && !(await contaPadraoUtilizavel(ctx, fin.padroes.contaBancariaId, { trava: true }))) {
    throw exigencia("padroesFinanceiros.contaBancariaId", MENSAGEM_CONTA_PADRAO_INUTILIZAVEL);
  }

  // OS ATUAIS SAEM CANCELADOS, com trilha — nunca apagados (decisão 247). ROW COUNT: travados acima, todos têm de mudar.
  const motivoEfetivo = !provisaoLigada && !d.cancelado ? MOTIVOS_DA_PROVISAO.semProvisao : motivo;
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
      // Só a fonte com padrão legado chega aqui; a outra classifica com "exigir", que já recusou acima.
      if (!fonte.legado) throw new Error(`A provisão de ${fonte.sourceType} não tem padrão legado e não pode chegar a ele`);
      const legado = await fonte.legado(ctx, { natureza: naturezaId === null, centro: centroCustoId === null });
      naturezaId = naturezaId ?? legado.naturezaId;
      centroCustoId = centroCustoId ?? legado.centroCustoId;
    }
    if (!naturezaId || !centroCustoId) throw validation(MENSAGEM_SEM_CLASSIFICACAO_LEGADA);
    const t = await createTitles(ctx, {
      previsto: true, empresaId: d.empresa_id, direction: fonte.direcao, number: fonte.numero(d.code), personId: d.person_id,
      amount: alvo, dueDate: alvoDasParcelas.dueDate, plan: alvoDasParcelas.plan, emissionDate: todayISO(), note: fonte.nota(d.code),
      isDeductible: fonte.dedutivel(d),
      titleTypeId: fin.padroes?.tipoTituloId ?? null, contaPrevistaId: fin.padroes?.contaBancariaId ?? null,
      apportionment: [{ financialCategoryId: naturezaId, costCenterId: centroCustoId, percentage: "100" }],
      sourceType: fonte.sourceType, sourceId: d.id, tipoOperacaoId: d.tipo_operacao_id, tipoOperacaoVersaoId: d.tipo_operacao_versao_id
    });
    criados = t.ids;
  }
  await audit(ctx.tx, ctx, fonte.sourceType, d.id, "provisao", { motivo: motivoEfetivo, alvo, cancelados, criados });
  return { cancelados, criados, alvo };
}

// ─────────────── a venda (F9a) ───────────────

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
 * pedido nem na TOP; a conta padrão inutilizável; e o padrão legado sem par na organização (o texto de hoje).
 */
export async function sincronizarProvisaoDoPedido(ctx: ServiceCtx, pedidoId: string, motivo: string): Promise<ResultadoDaProvisao> {
  return sincronizar(ctx, FONTE_VENDA, pedidoId, motivo);
}

// ─────────────── a compra (OPERACOES-01 F9b) ───────────────

/**
 * TRAVA O PEDIDO DE COMPRA de origem ANTES dos efeitos da compra (o contador do ID Global, o estoque, os títulos): a
 * ordem é compra → pedido → contador do ID Global → estoque. Sem ela, a confirmação seguraria o contador esperando o
 * pedido que um receber segura pedindo o contador. Id que não é de um pedido de compra desta organização → nada travado.
 */
export async function travarPedidoDeCompraDaProvisao(ctx: ServiceCtx, pedidoId: string): Promise<void> {
  await ctx.tx.query("select 1 from erp.documentos_compra where id = $1 and organization_id = $2 and especie = 'pedido' for update", [pedidoId, ctx.orgId]);
}

/**
 * Recalcula os previstos do PEDIDO DE COMPRA `pedidoId` (a pagar, ao finalizar). Idempotente. `motivo` vai para o
 * `cancel_reason` dos previstos que saem (`MOTIVOS_DA_PROVISAO_COMPRA`; encerrar o saldo e cancelar o pedido usam os de
 * `MOTIVOS_DA_PROVISAO`). Id que não é de um pedido de compra desta organização, ou pedido nunca finalizado → nada.
 *
 * Recusas (422, nada gravado — quem chama está na mesma transação): a troca proibida, a falta de classificação
 * (`MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO`, em `financeiroPadrao.provisao`) e a conta padrão inutilizável; e as do
 * rateio de `createTitles` (natureza ou centro inativados).
 */
export async function sincronizarProvisaoDoPedidoDeCompra(ctx: ServiceCtx, pedidoId: string, motivo: string): Promise<ResultadoDaProvisao> {
  return sincronizar(ctx, FONTE_COMPRA, pedidoId, motivo);
}
