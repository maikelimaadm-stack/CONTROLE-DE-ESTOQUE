/**
 * COMPRAS-01 (decisão 267) — PRÉVIA, CONFIRMAÇÃO e ESTORNO da Compra, e a NOTA DUPLICADA.
 *
 * A Compra confirmada dá ENTRADA no estoque (custo rateado) e gera as CONTAS A PAGAR. O desenho é o da
 * confirmação da venda (`sales.ts`), sem mudar a venda: UMA função de planejamento (`planejarConfirmacao`)
 * serve a prévia e a confirmação — a prévia ANOTA as recusas, a confirmação LANÇA a primeira. Uma cópia
 * "equivalente" para a prévia divergiria na primeira fatia que mexesse numa das duas.
 *
 * ORDEM DAS TRAVAS na confirmação: documento (`for update`, em `lerDocumentoCompra`) → contador do ID Global
 * (`travarContadorIdGlobal`) → primeiro movimento (saldo → produto, pelo gatilho). É a ordem das rotas de
 * estoque (contador → produto): os títulos alocam ID Global DEPOIS da entrada, e sem a trava antecipada do
 * contador a ordem aqui seria produto → contador, o ciclo que a TOP-CONFIG-07 fechou.
 *
 * As rotas são registradas por `registrarConfirmacaoCompras(app)`, chamada pelo registro de `compras.ts`.
 *
 * OPERACOES-01 F6a (decisão 283) — A DIVERGÊNCIA COM O PEDIDO: a compra gerada de um pedido (com origem), cuja versão
 * congelada da TOP traz a seção `divergenciaPedido` fora de "Nenhuma", é comparada com o pedido no planejamento —
 * logo depois da aprovação, numa consulta só. "Avisar": a prévia mostra (`divergencia`, no fim do corpo). "Bloquear":
 * acima da tolerância, a prévia recusa e a confirmação (manual e automática) também — DIVERGENCIA_COM_O_PEDIDO, 409,
 * antes de qualquer efeito. Sem a seção (formatos 1 a 4, mesmo malformados, ou o neutro do 5) ou sem origem: nada muda.
 *
 * OPERACOES-01 F9b (decisão 286) — OS PADRÕES DA TOP NA COMPRA E A PROVISÃO DO PEDIDO: sem natureza e centro no
 * documento, o par da TOP (formato 5, versão congelada) classifica os títulos; o tipo de título e a conta prevista da TOP
 * e a TOP e a versão da compra vão para o título; a compra com origem trava o pedido logo depois de si (compra → pedido →
 * contador → estoque) e, confirmada ou estornada, refaz a provisão dele.
 *
 * OPERACOES-01 F7 (decisão 284) — O QUE A NOTA ANTIGA FAZIA, AGORA NA COMPRA: o item com "gera estoque" = não fica fora
 * da entrada; o peso do custo de entrada é o valor do item + IPI + ICMS-ST dele (`pesoDoCustoDeEntrada`; sem eles, o
 * de hoje); o item IMOBILIZADO cria o bem (equipamento, com ID Global) na confirmação, com o valor de entrada rateado,
 * antes de a compra virar confirmada; o título leva o tipo de título da compra (ou o da TOP), a classificação
 * CAPEX/OPEX, o tipo de documento fiscal, as duplicatas da nota (parcelas explícitas) e o rateio por valor ou por
 * produto (que substitui o par natureza/centro — do documento e da TOP); a prévia mostra `financeiro.rateio`; o
 * estorno baixa os bens. A NOTA REPETIDA pela chave: `travarChaveDeAcesso` e `conferirChaveDeAcessoLivre` moram em
 * `lib/nota-fiscal-xml.ts` e são reexportadas daqui (um lugar só; a mesma trava dos gatilhos da 0047).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, DomainError } from "@agro/shared";
import {
  resolverPoliticaEfetivaDaCompra, resumoDaPoliticaDaCompra, ratearCustoDeEntrada, pesoDoCustoDeEntrada, normalizeApportionment,
  type PoliticaEfetivaDaCompra, type ApportionmentLine,
  divergenciaPedidoDaVersaoTop, divergenciasDaCompra, MSG_DIVERGENCIA_COM_O_PEDIDO, type LinhaParaDivergencia, type ResultadoDivergencia,
} from "@agro/domain";
import { runService, idempotent, audit, assertPeriodOpen, nextCode } from "../lib/service.js";
import { notFound, validation, err, fromPgError } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { postStock, reverseStock, quantidadeLegivel } from "../services/stock-core.js";
import { createTitles, installmentPlanSchema, parcelasDoTitulo, exigirRateioAnalitico, type InstallmentPlan } from "../services/financial-core.js";
import { travarContadorIdGlobal, atribuirIdGlobal } from "../lib/id-global.js";
import { lerDocumentoCompra, REGRA_CLASSIFICACAO_COMPRA } from "./compras.js";
import { validarClassificacaoDoDocumento } from "../lib/documento-comercial.js";
import { travarPedidoDeOrigemDaCompra, reabrirPedidoDeOrigem } from "./compras-recebimento.js";
import { recusaDaAprovacao } from "../lib/aprovacao-documento.js";
// OPERACOES-01 F9b (decisão 286): os padrões financeiros da TOP na confirmação e a provisão do pedido de origem.
import { padroesDasVersoesParaExecucao } from "../lib/financeiro-top.js";
import { contaPadraoUtilizavel, MENSAGEM_CONTA_PADRAO_INUTILIZAVEL, type PadroesFinanceirosResolvidos } from "../lib/financeiro-padroes-top.js";
import { sincronizarProvisaoDoPedidoDeCompra, travarPedidoDeCompraDaProvisao } from "../lib/financeiro-provisao.js";
import { planoDaClassificacao, camposTrocadosDosPadroes, mensagemDosPadroesTrocados, MOTIVOS_DA_PROVISAO_COMPRA } from "@agro/domain";
// OPERACOES-01 F7 (decisão 284): a chave de acesso — UM lugar (a lib), reexportado daqui para as rotas de compras e estoque.
export { travarChaveDeAcesso, conferirChaveDeAcessoLivre } from "../lib/nota-fiscal-xml.js";

/** Versão do contrato da prévia. A web confere forma E versão antes de usar o corpo. */
export const CONTRATO_PREVIA_CONFIRMACAO_COMPRA = 1;

type PoliticaDaCompra = PoliticaEfetivaDaCompra;

/** O cabeçalho da Compra como a confirmação o lê (colunas da tabela, `lerDocumentoCompra`). */
export interface CompraParaConfirmar {
  id: string; especie: string; codigo: string; situacao: string; empresa_id: string; fornecedor_id: string;
  tipo_operacao_versao_id: string; data_documento: string; data_entrada: string | null; data_vencimento: string | null;
  numero_nota: string | null; serie_nota: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null;
  forma_pagamento_id: string | null; plano_parcelas: unknown; valor_total: string;
  /** OPERACOES-01 F6a: o pedido de onde a compra veio (nulo = compra direta). Decide se a divergência se aplica. */
  origem_documento_id: string | null;
  /** OPERACOES-01 F9b: a TOP da compra (sempre presente), que vai para o título com a versão. */
  tipo_operacao_id: string;
  /** OPERACOES-01 F7: os dados fiscais que a confirmação usa (nulos na compra de hoje). */
  tipo_titulo_id: string | null;
  classificacao_gasto: "capex" | "opex" | null;
  tipo_documento_fiscal: string | null;
  rateio_tipo: "por_valor" | "por_produto" | null;
  parcelas_nota: unknown;
}

/** O item como a confirmação o lê: a linha do item e o controle de estoque do produto. */
interface ItemDaCompra {
  id: string; produto_id: string; armazem_id: string | null; quantidade: string; valor_total: string; lote: string | null; validade: string | null;
  controla_estoque: boolean; produto: string; armazem: string | null;
  /** OPERACOES-01 F7: nulos no item de hoje (gera estoque, não é imobilizado, sem impostos nem par próprios). */
  gera_estoque: boolean | null; imobilizado: boolean | null; valor_ipi: string | null; valor_icms_st: string | null;
  categoria_financeira_id: string | null; centro_custo_id: string | null; descricao_do_bem: string;
}

const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** A trilha e a mensagem falam de "compra"; a variante já foi amarrada pela leitura. */
function comoCompra(d: Record<string, unknown>): CompraParaConfirmar {
  return {
    id: String(d.id), especie: String(d.especie), codigo: String(d.codigo), situacao: String(d.situacao), empresa_id: String(d.empresa_id),
    fornecedor_id: String(d.fornecedor_id), tipo_operacao_versao_id: String(d.tipo_operacao_versao_id),
    data_documento: dataIso(d.data_documento)!, data_entrada: dataIso(d.data_entrada), data_vencimento: dataIso(d.data_vencimento),
    numero_nota: (d.numero_nota as string | null) ?? null, serie_nota: (d.serie_nota as string | null) ?? null,
    categoria_financeira_id: (d.categoria_financeira_id as string | null) ?? null, centro_custo_id: (d.centro_custo_id as string | null) ?? null,
    forma_pagamento_id: (d.forma_pagamento_id as string | null) ?? null, plano_parcelas: d.plano_parcelas ?? null, valor_total: String(d.valor_total ?? "0"),
    origem_documento_id: (d.origem_documento_id as string | null) ?? null,
    // OPERACOES-01 F9b: a TOP da compra (NOT NULL na espécie compra).
    tipo_operacao_id: String(d.tipo_operacao_id),
    tipo_titulo_id: (d.tipo_titulo_id as string | null) ?? null,
    classificacao_gasto: (d.classificacao_gasto as "capex" | "opex" | null) ?? null,
    tipo_documento_fiscal: (d.tipo_documento_fiscal as string | null) ?? null,
    rateio_tipo: (d.rateio_tipo as "por_valor" | "por_produto" | null) ?? null,
    parcelas_nota: d.parcelas_nota ?? null,
  };
}

/** Os itens na ordem do documento, com o controle de estoque do produto — UMA consulta, sem N+1. */
async function itensDaCompra(ctx: ServiceCtx, documentoId: string): Promise<ItemDaCompra[]> {
  const r = await ctx.tx.query<ItemDaCompra>(
    `select i.id, i.produto_id, i.armazem_id, i.quantidade::text as quantidade, i.valor_total::text as valor_total, i.lote,
            to_char(i.validade, 'YYYY-MM-DD') as validade, p.control_stock as controla_estoque,
            p.code || ' - ' || p.description as produto, w.description as armazem,
            i.gera_estoque, i.imobilizado, i.valor_ipi::text as valor_ipi, i.valor_icms_st::text as valor_icms_st,
            i.categoria_financeira_id::text as categoria_financeira_id, i.centro_custo_id::text as centro_custo_id,
            coalesce(nullif(btrim(i.descricao_produto_nota), ''), p.description) as descricao_do_bem
       from erp.documentos_compra_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.warehouses w on w.id = i.armazem_id and w.organization_id = i.organization_id
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [documentoId, ctx.orgId]);
  return r.rows;
}

/**
 * A política da versão congelada — recusa tipada, nunca "então é o padrão". TOP-CONFIG-08 (decisão 277): devolve
 * também a versão congelada que acabou de ler (família e configuração), para o passo da aprovação conferir a MESMA
 * versão sem uma segunda consulta.
 */
async function politicaDaCompra(ctx: ServiceCtx, versaoId: string, execucaoConfiguradaHabilitada: boolean):
  Promise<{ politica: PoliticaDaCompra; versaoTop: { codigoBase: string; configuracao: unknown } }> {
  const r = await ctx.tx.query<{ configuracao: unknown; codigo_base: string }>(
    `select v.configuracao, t.codigo_base
       from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
      where v.id = $1 and v.organization_id = $2`, [versaoId, ctx.orgId]);
  const linha = r.rows[0];
  // A TOP é obrigatória na compra (NOT NULL + FK composta): sem a linha é corrupção, nunca "padrão".
  if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  const versaoTop = { codigoBase: linha.codigo_base, configuracao: linha.configuracao };
  const res = resolverPoliticaEfetivaDaCompra({ versaoCongelada: versaoTop, execucaoConfiguradaHabilitada });
  if (res.ok) return { politica: res.politica, versaoTop };
  const mensagem = res.motivo === "execucao_desligada"
    ? "A operação desta compra usa execução configurada, que ainda não está habilitada neste ambiente. A compra não foi confirmada."
    : res.motivo === "configuracao_ilegivel"
      ? MSG_CONFIGURACAO_ILEGIVEL
      : "A configuração da operação desta compra pede um efeito que esta versão do produto não executa. A compra não foi confirmada.";
  throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", mensagem,
    { motivo: res.motivo, recusas: res.recusas.map(({ motivo, caminho, mensagem: m }) => ({ motivo, caminho, mensagem: m })) });
}

/** A configuração da versão congelada que este servidor não lê: a política e a divergência recusam com o mesmo texto. */
const MSG_CONFIGURACAO_ILEGIVEL = "A configuração da operação desta compra está num formato que este servidor não executa. A compra não foi confirmada.";

/**
 * OPERACOES-01 F6a — AS LINHAS DA COMPRA PARA A CONTA DA DIVERGÊNCIA, numa consulta: cada linha da compra × o item do
 * pedido de origem (`origem_item_id`) × o produto, e o saldo do item do pedido ANTES desta compra (a quantidade do
 * item menos o ligado nas OUTRAS compras não canceladas, por subconsulta correlata). Os números saem como texto
 * decimal, na ordem do documento. Sob a RLS da transação: o pedido é da mesma empresa (o gatilho da origem garante).
 */
async function linhasParaDivergencia(ctx: ServiceCtx, compraId: string): Promise<LinhaParaDivergencia[]> {
  const r = await ctx.tx.query<{
    item_id: string; item_pedido_id: string; produto: string; quantidade_compra: string; valor_total_compra: string;
    quantidade_pedido: string; valor_total_pedido: string; saldo_antes: string;
  }>(
    `select i.id as item_id, i.origem_item_id as item_pedido_id, p.code || ' - ' || p.description as produto,
            i.quantidade::text as quantidade_compra, i.valor_total::text as valor_total_compra,
            ip.quantidade::text as quantidade_pedido, ip.valor_total::text as valor_total_pedido,
            (ip.quantidade - coalesce((
               select sum(o.quantidade)
                 from erp.documentos_compra_itens o
                 join erp.documentos_compra od on od.id = o.documento_id and od.organization_id = o.organization_id
                where o.origem_item_id = ip.id and o.organization_id = ip.organization_id
                  and o.documento_id <> i.documento_id and od.situacao <> 'cancelado'), 0))::text as saldo_antes
       from erp.documentos_compra_itens i
       join erp.documentos_compra_itens ip on ip.id = i.origem_item_id and ip.organization_id = i.organization_id
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [compraId, ctx.orgId]);
  return r.rows.map((l) => ({
    itemId: l.item_id, itemPedidoId: l.item_pedido_id, produto: l.produto,
    quantidadeCompra: l.quantidade_compra, valorTotalCompra: l.valor_total_compra,
    quantidadePedido: l.quantidade_pedido, valorTotalPedido: l.valor_total_pedido,
    saldoAntesDaCompra: l.saldo_antes,
  }));
}

/** Como o planejamento trata cada etapa — a única diferença entre confirmar e prever. */
interface ModoDoPlanejamento {
  trava: boolean;
  recusar(e: DomainError): void;
  conferirPeriodo(conferir: () => Promise<void>): Promise<void>;
}
const MODO_CONFIRMACAO: ModoDoPlanejamento = { trava: true, recusar: (e) => { throw e; }, conferirPeriodo: (c) => c() };

/** Uma linha de entrada planejada: o item, o valor de entrada rateado e o custo unitário. */
interface EntradaPlanejada { item: ItemDaCompra; valorEntrada: string; custoUnitario: string }
/** OPERACOES-01 F7: um parcela explícita do título (as duplicatas da nota guardadas na compra). */
interface ParcelaDoTitulo { dueDate: string; amount: string }

interface PlanoDaConfirmacao {
  politica: PoliticaDaCompra | null;
  daEntrada: boolean;
  geraTitulos: boolean;
  entradas: EntradaPlanejada[];
  /** Itens que NÃO entram (sem armazém, ou produto sem controle de estoque) quando a política dá entrada. */
  itensForaDaEntrada: number;
  classificacao: { categoriaFinanceiraId: string; centroCustoId: string } | null;
  plano: InstallmentPlan | null;
  dataEntrada: string;
  /**
   * OPERACOES-01 F6a: a divergência com o pedido — só quando se aplica (compra com origem e seção fora de "Nenhuma");
   * `null` nos outros casos, e a prévia então não ganha a chave.
   */
  divergencia: ResultadoDivergencia | null;
  /**
   * OPERACOES-01 F9b: os padrões financeiros da versão congelada (formato 5; `null` nos outros, ou sem padrões) — o tipo
   * de título e a conta prevista vão para os títulos — e se a classificação saiu do PAR da TOP (o documento não tinha).
   */
  padroes: PadroesFinanceirosResolvidos | null;
  classificacaoDaTop: boolean;
  /**
   * OPERACOES-01 F7: o rateio do título quando a compra tem rateio (por valor: as linhas gravadas; por produto: uma linha
   * por par natureza/centro dos itens) — com ele, `classificacao` fica nula; as duplicatas da nota (`parcelas`, nulas
   * sem elas) e os itens imobilizados com o valor de entrada rateado (o bem nasce com ele).
   */
  rateio: ApportionmentLine[] | null;
  parcelas: ParcelaDoTitulo[] | null;
  imobilizados: { item: ItemDaCompra; valorEntrada: string }[];
}

const MSG_NATUREZA_OBRIGATORIA = "Informe a natureza financeira e o centro de resultado: a confirmação gera contas a pagar.";
function lerPlano(bruto: unknown): InstallmentPlan | null {
  if (!bruto || typeof bruto !== "object" || !(bruto as { installments?: number }).installments) return null;
  return installmentPlanSchema.parse(bruto);
}

/**
 * As duplicatas da nota gravadas na compra (`parcelas_nota`, 0047) como parcelas do título. Sem elas, `null` (a conta de
 * hoje). Forma fora do contrato gravado é corrupção: recusa, nunca "sem parcelas".
 */
function lerParcelasDaNota(bruto: unknown): ParcelaDoTitulo[] | null {
  if (bruto === null || bruto === undefined) return null;
  const lista = Array.isArray(bruto) ? bruto : null;
  const parcelas = lista?.map((p) => {
    const x = p as { vencimento?: unknown; valor?: unknown };
    return typeof x.vencimento === "string" && (typeof x.valor === "string" || typeof x.valor === "number") ? { dueDate: x.vencimento.slice(0, 10), amount: String(x.valor) } : null;
  });
  if (!parcelas?.length || parcelas.some((p) => p === null)) throw validation("As parcelas da nota gravadas na compra estão num formato que este servidor não lê.");
  return parcelas as ParcelaDoTitulo[];
}

/** Valor, vencimento e plano (ou as parcelas da nota) dos títulos a pagar — o que `createTitles` recebe e o que a prévia mostra. */
function tituloDaCompra(d: CompraParaConfirmar, plano: InstallmentPlan | null, parcelas: ParcelaDoTitulo[] | null = null) {
  if (parcelas?.length) return { amount: d.valor_total, dueDate: parcelas[0]!.dueDate, plan: null, parcelas };
  return { amount: d.valor_total, dueDate: plano?.first_due_date ?? d.data_vencimento ?? d.data_documento, plan: plano };
}

/**
 * OPERACOES-01 F7 — O RATEIO DO TÍTULO da compra com rateio. POR VALOR: as linhas gravadas (natureza, centro, conta
 * contábil, safra e percentual), numa consulta. POR PRODUTO: uma linha por par natureza/centro dos itens, na ordem em
 * que o par aparece, com a soma dos `valor_total` dos itens do par; a diferença para o total da compra (frete, IPI,
 * ICMS-ST, seguro, outras − desconto) vai na ÚLTIMA linha (o molde da nota antiga); linha de valor zero sai. Sem linha,
 * item sem par ou última linha negativa: recusa (VALIDATION_ERROR), nunca título sem classificação.
 */
async function rateioDoTitulo(ctx: ServiceCtx, d: CompraParaConfirmar, itens: readonly ItemDaCompra[]): Promise<ApportionmentLine[]> {
  if (d.rateio_tipo === "por_valor") {
    const r = await ctx.tx.query<{ categoria_financeira_id: string; centro_custo_id: string; conta_contabil_id: string | null; safra_id: string | null; percentual: string }>(
      `select categoria_financeira_id::text as categoria_financeira_id, centro_custo_id::text as centro_custo_id, conta_contabil_id::text as conta_contabil_id,
              safra_id::text as safra_id, percentual::text as percentual
         from erp.documentos_compra_rateio where organization_id = $1 and documento_id = $2 order by posicao`, [ctx.orgId, d.id]);
    if (!r.rows.length) throw validation(MSG_RATEIO_SEM_LINHAS, [{ path: "rateio", message: MSG_RATEIO_SEM_LINHAS }]);
    return r.rows.map((l) => ({ financialCategoryId: l.categoria_financeira_id, costCenterId: l.centro_custo_id, chartAccountId: l.conta_contabil_id, harvestId: l.safra_id, percentage: l.percentual }));
  }
  const porPar = new Map<string, { financialCategoryId: string; costCenterId: string; soma: ReturnType<typeof D> }>();
  for (const it of itens) {
    if (!it.categoria_financeira_id || !it.centro_custo_id) throw validation(MSG_RATEIO_POR_PRODUTO_SEM_PAR, [{ path: "itens", message: MSG_RATEIO_POR_PRODUTO_SEM_PAR }]);
    const chave = `${it.categoria_financeira_id}|${it.centro_custo_id}`;
    const linha = porPar.get(chave);
    if (linha) linha.soma = linha.soma.plus(D(it.valor_total));
    else porPar.set(chave, { financialCategoryId: it.categoria_financeira_id, costCenterId: it.centro_custo_id, soma: D(it.valor_total) });
  }
  const linhas = [...porPar.values()];
  if (!linhas.length) throw validation(MSG_RATEIO_POR_PRODUTO_SEM_PAR, [{ path: "itens", message: MSG_RATEIO_POR_PRODUTO_SEM_PAR }]);
  const somaDosItens = linhas.reduce((a, l) => a.plus(l.soma), D(0));
  const ultima = linhas[linhas.length - 1]!;
  ultima.soma = ultima.soma.plus(D(d.valor_total).minus(somaDosItens));
  if (ultima.soma.isNegative()) throw validation(MSG_RATEIO_POR_PRODUTO_NAO_FECHA, [{ path: "rateio", message: MSG_RATEIO_POR_PRODUTO_NAO_FECHA }]);
  return linhas.filter((l) => l.soma.gt(0)).map((l) => ({ financialCategoryId: l.financialCategoryId, costCenterId: l.costCenterId, amount: money(l.soma) }));
}
const MSG_RATEIO_SEM_LINHAS = "A compra com rateio por valor não tem as linhas do rateio.";
const MSG_RATEIO_POR_PRODUTO_SEM_PAR = "Com rateio por produto, todo item precisa da natureza e do centro de resultado.";
const MSG_RATEIO_POR_PRODUTO_NAO_FECHA = "O rateio por produto não fecha o total da compra: o desconto do documento passa da última natureza.";

/**
 * O PLANEJAMENTO DA CONFIRMAÇÃO — UMA função, para a confirmação E para a prévia. Ordem: situação → política da
 * versão congelada e gate → aprovação (TOP-CONFIG-08) → exigências da política → período → classificação
 * financeira → custo de entrada.
 */
async function planejarConfirmacao(ctx: ServiceCtx, d: CompraParaConfirmar, itens: ItemDaCompra[], execucaoConfiguradaHabilitada: boolean, modo: ModoDoPlanejamento): Promise<PlanoDaConfirmacao> {
  const dataEntrada = d.data_entrada ?? d.data_documento;
  const plano: PlanoDaConfirmacao = { politica: null, daEntrada: false, geraTitulos: false, entradas: [], itensForaDaEntrada: 0, classificacao: null, plano: null, dataEntrada, divergencia: null,
    padroes: null, classificacaoDaTop: false, rateio: null, parcelas: null, imobilizados: [] };
  if (d.situacao === "confirmado") { modo.recusar(err("ALREADY_CONFIRMED", "Compra já confirmada")); return plano; }
  if (d.situacao === "cancelado") { modo.recusar(err("ALREADY_CANCELLED", "Compra cancelada")); return plano; }

  let politica: PoliticaDaCompra;
  let versaoTop: { codigoBase: string; configuracao: unknown };
  try {
    ({ politica, versaoTop } = await politicaDaCompra(ctx, d.tipo_operacao_versao_id, execucaoConfiguradaHabilitada));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    modo.recusar(e); return plano;
  }
  plano.politica = politica;
  // PADRÃO da compra: entrada dos itens com armazém e conta a pagar do total.
  plano.daEntrada = politica.estoque.autoridade === "padrao" || politica.estoque.efeito === "entrada";
  // Valor zero não gera título (nem exige natureza/centro) — a prévia e a confirmação leem a MESMA regra.
  // TOP-CONFIG-08: a compra SEM ITENS (formato 4 com "Permitido") cai na mesma regra — total 0 não gera título, e
  // o frete sozinho gera o título do total; sem item não há entrada (o rateio abaixo só roda com itens).
  plano.geraTitulos = (politica.financeiro.autoridade === "padrao" || politica.financeiro.efeito === "pagar") && D(d.valor_total).gt(0);
  plano.plano = lerPlano(d.plano_parcelas);
  // OPERACOES-01 F7: as duplicatas da nota (exclusivas com o plano, CHECK da 0047) são as parcelas do título.
  try {
    plano.parcelas = lerParcelasDaNota(d.parcelas_nota);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    modo.recusar(e);
  }

  // A APROVAÇÃO (TOP-CONFIG-08, decisão 277) — logo depois da política da versão e ANTES das exigências e de
  // qualquer efeito: a versão congelada no formato 4 que exige aprovação (Sempre, ou A partir de um valor com o
  // total ATUAL ≥ o mínimo) só confirma com a última decisão "aprovado". Pendente → 409 APROVACAO_PENDENTE;
  // reprovada → 409 APROVACAO_REPROVADA com o motivo. Na confirmação automática, a pendente é o
  // "aguardando_aprovacao" (`tentarConfirmacaoAutomatica`); na prévia, uma recusa como as outras, e
  // `podeConfirmar` fica falso. Formato 1 a 3 nunca exige: nada muda para eles. A compra não tem edição, então a
  // decisão vigente é a última (`versaoDocumento` nulo). A guarda de transição da 0041 barra o mesmo no banco;
  // aqui é quem EXPLICA.
  let recusaDaAprovacaoDoDocumento: DomainError | null;
  try {
    recusaDaAprovacaoDoDocumento = await recusaDaAprovacao(ctx,
      { modulo: "compras", documentoId: d.id, versaoDocumento: null, valorDocumento: d.valor_total, versaoTop });
  } catch (e) {
    // Fail-closed: formato 4 ilegível chega aqui como TIPO_OPERACAO_EXECUCAO_INDISPONIVEL (a política já recusaria antes).
    if (!(e instanceof DomainError)) throw e;
    recusaDaAprovacaoDoDocumento = e;
  }
  if (recusaDaAprovacaoDoDocumento) modo.recusar(recusaDaAprovacaoDoDocumento);

  // A DIVERGÊNCIA COM O PEDIDO (OPERACOES-01 F6a, decisão 283) — logo depois da aprovação e ANTES das exigências e de
  // qualquer efeito, só na compra gerada de um pedido. A seção é a da versão congelada DA COMPRA; ilegível recusa
  // (fail-closed; na prática a política já recusou antes). "Nenhuma" não consulta nada.
  if (d.origem_documento_id) {
    const secao = divergenciaPedidoDaVersaoTop(versaoTop);
    if (!secao.ok) {
      modo.recusar(new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", MSG_CONFIGURACAO_ILEGIVEL, { motivo: secao.motivo, recusas: [] }));
    } else if (secao.valor.modo !== "nenhuma") {
      const divergencia = divergenciasDaCompra(secao.valor, await linhasParaDivergencia(ctx, d.id));
      plano.divergencia = divergencia;
      if (divergencia.bloqueia) {
        modo.recusar(new DomainError("DIVERGENCIA_COM_O_PEDIDO", MSG_DIVERGENCIA_COM_O_PEDIDO,
          { itens: divergencia.itens.filter((i) => i.acimaDaTolerancia) }));
      }
    }
  }

  // AS EXIGÊNCIAS DA POLÍTICA — todas conferidas, todas juntas, antes de qualquer efeito.
  const exigencias: { caminho: string; mensagem: string }[] = [];
  // OPERACOES-01 F7: o item que não gera estoque não precisa de local (nem pode ter um).
  if (politica.estoque.autoridade === "configurada" && politica.estoque.efeito === "entrada" && politica.estoque.exigeArmazem
      && itens.some((it) => it.controla_estoque && !it.armazem_id && it.gera_estoque !== false)) {
    exigencias.push({ caminho: "estoque.exigeArmazem", mensagem: "Informe o local de estoque de todos os itens" });
  }
  // COMPRAS-03 (item 0): forma e vencimento só quando a compra GERA título (`plano.geraTitulos`: conta a pagar E
  // valor > 0) — a mesma regra do salvar (`conferirExigenciasDoTitulo`). Compra de valor zero não gera título, e
  // cobrar aqui o que o salvar dispensou travaria a confirmação de um documento que o próprio sistema aceitou.
  if (plano.geraTitulos && politica.financeiro.autoridade === "configurada" && politica.financeiro.efeito === "pagar") {
    if (politica.financeiro.exigeFormaPagamento && !d.forma_pagamento_id) exigencias.push({ caminho: "financeiro.exigeFormaPagamento", mensagem: "Informe a forma de pagamento" });
    if (politica.financeiro.exigeVencimento && !(plano.parcelas?.[0]?.dueDate ?? plano.plano?.first_due_date ?? d.data_vencimento)) exigencias.push({ caminho: "financeiro.exigeVencimento", mensagem: "Informe o vencimento" });
  }
  if (exigencias.length) {
    modo.recusar(new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA",
      `A operação desta compra exige dados que o documento não tem: ${exigencias.map((e) => e.mensagem.toLowerCase()).join("; ")}.`, { exigencias }));
  }

  // PERÍODO: a data do documento (títulos) e a de entrada (movimentos), quando for outra.
  await modo.conferirPeriodo(async () => {
    await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.data_documento);
    if (plano.daEntrada && dataEntrada !== d.data_documento) await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, dataEntrada);
  });

  // CLASSIFICAÇÃO: obrigatória quando HAVERÁ título — sem padrão silencioso ("primeira por código" não existe aqui).
  // OPERACOES-01 F9b (decisão 286): sem natureza e centro no documento, o PAR da TOP (formato 5, versão congelada — a
  // mesma linha que a política acabou de ler, sem reler) classifica, pela MESMA porta. Depois, a conta padrão
  // inutilizável e a troca proibida (o salvar já recusou a troca; aqui é a rede). Formatos 1 a 4: nenhuma consulta nova.
  if (plano.geraTitulos) {
    const fp = (await padroesDasVersoesParaExecucao(ctx, [{ id: d.tipo_operacao_versao_id, configuracao: versaoTop.configuracao, codigo_base: versaoTop.codigoBase }]))
      .get(d.tipo_operacao_versao_id.toLowerCase()) ?? null;
    plano.padroes = fp?.padroes ?? null;
    const recusaDaTop = (caminho: string, mensagem: string) => new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", mensagem, { exigencias: [{ caminho, mensagem }] });
    // OPERACOES-01 F7: com rateio, quem classifica é o RATEIO (por valor ou por produto): o par do documento (que não
    // existe, CHECK da 0047) e o par padrão da TOP não se aplicam — a exigência vira "o rateio existe e é analítico".
    if (d.rateio_tipo) {
      try {
        plano.rateio = await rateioDoTitulo(ctx, d, itens);
        await exigirRateioAnalitico(ctx, plano.rateio.map((l) => ({ financialCategoryId: l.financialCategoryId, costCenterId: l.costCenterId, chartAccountId: l.chartAccountId ?? null })));
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        plano.rateio = null;
        modo.recusar(e);
      }
    }
    const pc = !d.rateio_tipo && !d.categoria_financeira_id && !d.centro_custo_id && fp
      ? planoDaClassificacao({ documento: { naturezaId: null, centroCustoId: null }, padrao: fp.padroes, semClassificacao: "exigir" })
      : null;
    const par = pc?.tipo === "pronta" ? { categoriaFinanceiraId: pc.naturezaId, centroCustoId: pc.centroCustoId }
      : d.categoria_financeira_id && d.centro_custo_id ? { categoriaFinanceiraId: d.categoria_financeira_id, centroCustoId: d.centro_custo_id } : null;
    if (d.rateio_tipo) {
      // O rateio já foi lido e conferido acima.
    } else if (!par) {
      const campo = d.categoria_financeira_id ? "centro_custo_id" : "categoria_financeira_id";
      modo.recusar(validation(MSG_NATUREZA_OBRIGATORIA, [{ path: campo, message: MSG_NATUREZA_OBRIGATORIA }]));
    } else {
      // A porta única da classificação, com a regra da compra (a mesma do lançamento).
      try {
        plano.classificacao = await validarClassificacaoDoDocumento(ctx, REGRA_CLASSIFICACAO_COMPRA, par, "confirmacao", { trava: modo.trava });
        plano.classificacaoDaTop = pc?.tipo === "pronta";
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        modo.recusar(e);
      }
    }
    if (fp?.padroes?.contaBancariaId && !(await contaPadraoUtilizavel(ctx, fp.padroes.contaBancariaId, { trava: modo.trava }))) {
      modo.recusar(recusaDaTop("padroesFinanceiros.contaBancariaId", MENSAGEM_CONTA_PADRAO_INUTILIZAVEL));
    }
    if (fp?.padroes && !fp.secao.documentoTroca) {
      const campos = camposTrocadosDosPadroes(fp.padroes, { naturezaIds: [d.categoria_financeira_id], centroCustoIds: [d.centro_custo_id], formaPagamentoId: d.forma_pagamento_id });
      if (campos.length) modo.recusar(recusaDaTop("financeiroPadrao.documentoTroca", mensagemDosPadroesTrocados(campos)));
    }
  }

  // CUSTO DE ENTRADA: a parte de cada item no valor_total do documento (frete, outras e desconto entram no custo).
  // OPERACOES-01 F7: o peso de cada item é o valor dele + IPI + ICMS-ST dele (sem os dois, o de hoje); o item que não
  // gera estoque fica fora da entrada; o rateio é calculado para TODOS os itens — o imobilizado nasce com a parte dele,
  // mesmo quando a política não dá entrada.
  const temImobilizado = itens.some((it) => it.imobilizado === true);
  if ((plano.daEntrada || temImobilizado) && itens.length) {
    const rateio = ratearCustoDeEntrada(itens.map((it) => ({ quantidade: it.quantidade,
      valorTotal: pesoDoCustoDeEntrada({ valorTotal: it.valor_total, ipi: it.valor_ipi, icmsSt: it.valor_icms_st }) })), d.valor_total);
    itens.forEach((it, i) => {
      if (it.imobilizado === true) plano.imobilizados.push({ item: it, valorEntrada: rateio[i]!.valorEntrada });
      if (!plano.daEntrada) return;
      if (it.armazem_id && it.controla_estoque && it.gera_estoque !== false) plano.entradas.push({ item: it, valorEntrada: rateio[i]!.valorEntrada, custoUnitario: rateio[i]!.custoUnitario });
      else plano.itensForaDaEntrada++;
    });
  }
  return plano;
}

/**
 * CONFIRMAR a Compra — dentro da transação de quem chama. É a ÚNICA confirmação da compra (TOP-CONFIG-08, decisão
 * 277): o POST /confirm a chama sob a chave de idempotência, e a confirmação AUTOMÁTICA (o fim do POST e do receber
 * pedido, e o aprovar) a chama num savepoint (`tentarConfirmacaoAutomatica`). Mesmo planejamento, mesmas recusas,
 * mesmos efeitos — não existe segundo caminho de confirmação. O gate da execução configurada sai de `app.config`
 * aqui dentro, para nenhum chamador poder passar outro. `automatica` só acrescenta `automatica: true` ao metadata da
 * auditoria "confirm"; a da confirmação manual fica idêntica à de hoje, chave por chave.
 */
export async function confirmarCompraNaTransacao(app: FastifyInstance, ctx: ServiceCtx, id: string, o: { automatica: boolean }) {
  return confirmarCompra(ctx, id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED, o);
}

/** CONFIRMAR a Compra — o corpo de `confirmarCompraNaTransacao`. */
async function confirmarCompra(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean, o: { automatica: boolean }) {
  // 1ª TRAVA: o documento. A segunda confirmação espera aqui e relê `confirmado` (409, sem efeito).
  const d = comoCompra(await lerDocumentoCompra(ctx, id, "compra", { lock: true }) as Record<string, unknown>);
  // OPERACOES-01 F9b (decisão 286): a compra com origem trava o PEDIDO logo depois de si e ANTES do contador do ID Global e
  // do estoque (compra → pedido → contador → estoque): a provisão dele é refeita no fim, e o receber/encerrar (que pegam o
  // pedido primeiro) nunca esperam por esta compra. Sem origem: nada.
  if (d.origem_documento_id) await travarPedidoDeCompraDaProvisao(ctx, d.origem_documento_id);
  const itens = await itensDaCompra(ctx, d.id);
  const plano = await planejarConfirmacao(ctx, d, itens, execucaoConfiguradaHabilitada, MODO_CONFIRMACAO);
  const politica = plano.politica;
  if (!politica) throw new Error("planejarConfirmacao voltou sem política no modo da confirmação");

  // 2ª TRAVA: o contador do ID Global — antes do primeiro movimento (que trava saldo e produto).
  await travarContadorIdGlobal(ctx);

  // ESTOQUE: entrada 'receipt' com o custo rateado, lote e validade do item, na data de entrada.
  const movimentos: string[] = [];
  const produtosComEntrada = new Set<string>();
  for (const e of plano.entradas) {
    const r = await postStock(ctx, { empresaId: d.empresa_id, warehouseId: e.item.armazem_id!, productId: e.item.produto_id, movementType: "receipt", direction: 1,
      quantity: e.item.quantidade, unitCost: e.custoUnitario, providerLot: e.item.lote, expirationDate: e.item.validade,
      sourceType: "documentos_compra", sourceId: d.id, date: plano.dataEntrada, note: `Compra ${d.codigo}` });
    movimentos.push(...r.ids);
    produtosComEntrada.add(e.item.produto_id);
  }
  if (produtosComEntrada.size) {
    await ctx.tx.query("update erp.products set last_purchase_date = greatest(coalesce(last_purchase_date, $3::date), $3::date) where organization_id=$1 and id = any($2::uuid[])",
      [ctx.orgId, [...produtosComEntrada], plano.dataEntrada]);
  }

  // FINANCEIRO: contas a pagar do valor_total, para o fornecedor, natureza e centro 100%.
  // OPERACOES-01 F7: com rateio, as linhas dele; com as duplicatas da nota, uma parcela por duplicata; o tipo de título
  // da COMPRA vence o da TOP; a classificação CAPEX/OPEX e o tipo de documento fiscal da compra. Sem nada disso: o de hoje.
  let titulos: string[] = [];
  const apportionment: ApportionmentLine[] | null = plano.rateio
    ?? (plano.classificacao ? [{ financialCategoryId: plano.classificacao.categoriaFinanceiraId, costCenterId: plano.classificacao.centroCustoId, percentage: "100" }] : null);
  if (plano.geraTitulos && apportionment) {
    const t = await createTitles(ctx, { empresaId: d.empresa_id, direction: "payable", number: d.numero_nota?.trim() ? d.numero_nota.trim() : `CMP-${d.codigo}`,
      personId: d.fornecedor_id, ...tituloDaCompra(d, plano.plano, plano.parcelas), emissionDate: d.data_documento, note: `Compra ${d.codigo}`,
      apportionment,
      sourceType: "documentos_compra", sourceId: d.id,
      // OPERACOES-01 F9b: o tipo de título e a conta prevista da TOP (formato 5), e a TOP e a versão da compra (qualquer formato).
      titleTypeId: d.tipo_titulo_id ?? plano.padroes?.tipoTituloId ?? null, contaPrevistaId: plano.padroes?.contaBancariaId ?? null,
      tipoOperacaoId: d.tipo_operacao_id, tipoOperacaoVersaoId: d.tipo_operacao_versao_id,
      ...(d.classificacao_gasto ? { classification: d.classificacao_gasto } : {}),
      ...(d.tipo_documento_fiscal ? { documentType: d.tipo_documento_fiscal } : {}) });
    titulos = t.ids;
  }

  // OPERACOES-01 F7 — O BEM DO ITEM IMOBILIZADO (molde da nota antiga): um por item, com o valor de entrada rateado, na
  // data de entrada; ID Global (o contador já está preso); o item ganha `bem_id` (ROW COUNT) ANTES de a compra virar
  // confirmada — a guarda da 0036 congela o item fora do aberto.
  const bens: string[] = [];
  for (const { item, valorEntrada } of plano.imobilizados) {
    const bem = await inserirBemDaCompra(ctx, [d.empresa_id, item.descricao_do_bem, plano.dataEntrada.slice(0, 4), valorEntrada, plano.dataEntrada, d.fornecedor_id, item.produto_id]);
    const ligado = await ctx.tx.query("update erp.documentos_compra_itens set bem_id = $3 where id = $1 and organization_id = $2 and documento_id = $4 and bem_id is null",
      [item.id, ctx.orgId, bem, d.id]);
    // ROW COUNT SOB RLS: zero linha seria um bem sem o item que o criou.
    if (ligado.rowCount !== 1) throw notFound("Documento");
    bens.push(bem);
  }

  // ROW COUNT SOB RLS, com a transição conferida no `where`.
  const u = await ctx.tx.query("update erp.documentos_compra set situacao='confirmado', atualizado_em=now() where id=$1 and organization_id=$2 and especie='compra' and situacao='aberto'", [d.id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  // OPERACOES-01 F9b: a compra confirmada dá lugar, no pedido de origem, ao que ele ainda previa (total ou parcial).
  if (d.origem_documento_id) await sincronizarProvisaoDoPedidoDeCompra(ctx, d.origem_documento_id, MOTIVOS_DA_PROVISAO_COMPRA.compraConfirmada(d.codigo));
  await audit(ctx.tx, ctx, "documentos_compra", d.id, "confirm", {
    titulos, movimentos, tipoOperacaoVersaoId: d.tipo_operacao_versao_id,
    execucao: { origem: politica.origem, ...resumoDaPoliticaDaCompra(politica) },
    custoDeEntrada: plano.entradas.map((e) => ({ itemId: e.item.id, valorEntrada: e.valorEntrada, custoUnitario: e.custoUnitario })),
    // OPERACOES-01 F9b: a origem "padrão da TOP" só quando o par veio da TOP — sem ela, chave por chave a de hoje.
    ...(titulos.length && plano.classificacao
      ? { classificacaoFinanceira: plano.classificacaoDaTop ? { ...plano.classificacao, origem: "padrão da TOP" } : plano.classificacao }
      : {}),
    // OPERACOES-01 F6a: a divergência que a TOP mandou AVISAR (ou que ficou dentro da tolerância do "Bloquear"), só
    // quando houve — a auditoria de toda TOP sem a seção fica a de hoje, chave por chave.
    ...(plano.divergencia && plano.divergencia.itens.length ? { divergencia: { modo: plano.divergencia.modo, itens: plano.divergencia.itens } } : {}),
    // TOP-CONFIG-08: a chave existe SÓ na automática — a auditoria da manual não ganha `automatica: false`.
    ...(o.automatica ? { automatica: true } : {}),
    // OPERACOES-01 F7: só quando há (a auditoria da compra de hoje fica a de hoje, chave por chave).
    ...(titulos.length && plano.rateio ? { rateio: { tipo: d.rateio_tipo, linhas: plano.rateio } } : {}),
    ...(bens.length ? { bens } : {}),
  });
  return { id: d.id, situacao: "confirmado", titulo_ids: titulos, movimento_ids: movimentos };
}

/** Uma linha do rateio na prévia: natureza, centro, conta e safra com código e nome, o percentual e o valor. */
interface LinhaDoRateioNaPrevia {
  categoria: { id: string; codigo: string; nome: string }; centro: { id: string; codigo: string; nome: string };
  conta: { id: string; codigo: string; nome: string } | null; safra: { id: string; nome: string } | null;
  percentual: string; valor: string;
}

/**
 * OPERACOES-01 F7 — O RATEIO NA PRÉVIA: as linhas normalizadas pela MESMA conta do título (`normalizeApportionment`,
 * a de `createTitles`) e os nomes dos cadastros numa consulta só (nunca uma por linha).
 */
async function rateioParaAPrevia(ctx: ServiceCtx, total: string, linhas: readonly ApportionmentLine[]): Promise<LinhaDoRateioNaPrevia[]> {
  const normalizadas = normalizeApportionment(money(total), [...linhas]);
  const ids = (f: (l: (typeof normalizadas)[number]) => string | null | undefined) => [...new Set(normalizadas.flatMap((l) => { const v = f(l); return v ? [v] : []; }))];
  const r = await ctx.tx.query<{ t: string; id: string; codigo: string | null; nome: string }>(
    `select 'cat' as t, id::text as id, code as codigo, name as nome from erp.financial_categories where organization_id = $1 and id = any($2::uuid[])
     union all select 'cc', id::text, code, name from erp.cost_centers where organization_id = $1 and id = any($3::uuid[])
     union all select 'ca', id::text, code, description from erp.chart_accounts where organization_id = $1 and id = any($4::uuid[])
     union all select 'sf', id::text, null, description from erp.harvests where organization_id = $1 and id = any($5::uuid[])`,
    [ctx.orgId, ids((l) => l.financialCategoryId), ids((l) => l.costCenterId), ids((l) => l.chartAccountId), ids((l) => l.harvestId)]);
  const nome = new Map(r.rows.map((x) => [`${x.t}:${x.id}`, x]));
  const cadastro = (t: string, id: string) => { const x = nome.get(`${t}:${id}`); return { id, codigo: x?.codigo ?? "", nome: x?.nome ?? "" }; };
  return normalizadas.map((l) => ({
    categoria: cadastro("cat", l.financialCategoryId), centro: cadastro("cc", l.costCenterId),
    conta: l.chartAccountId ? cadastro("ca", l.chartAccountId) : null,
    safra: l.harvestId ? { id: l.harvestId, nome: nome.get(`sf:${l.harvestId}`)?.nome ?? "" } : null,
    percentual: l.percentage, valor: l.amount,
  }));
}

/** Quantos números do contador de bens a confirmação pula, no máximo, antes de recusar (o acervo ocupa a faixa). */
const PULOS_MAXIMOS_DO_CODIGO_DO_BEM = 1000;

/**
 * OPERACOES-01 F7 — O BEM DO ITEM IMOBILIZADO, com o código do contador da organização (`equipment`, o da nota antiga e
 * do cadastro). O inventário de bens tem códigos DIGITADOS no acervo (o contador não os conhece), e a unicidade
 * (`equipments_organization_id_code_key`) vale também para o bem de outra empresa, que a RLS não deixa ver: o número
 * ocupado é PULADO pela própria unicidade — o INSERT (e o ID Global do bem) num savepoint, e o 23505 daquela chave tenta o
 * próximo número.
 * `valores` = empresa, descrição, ano do modelo, valor de aquisição, data de aquisição, fornecedor e produto.
 */
async function inserirBemDaCompra(ctx: ServiceCtx, valores: readonly [string, string, string, string, string, string, string]): Promise<string> {
  for (let i = 0; i < PULOS_MAXIMOS_DO_CODIGO_DO_BEM; i++) {
    const codigo = await nextCode(ctx.tx, ctx.orgId, "equipment");
    await ctx.tx.query("savepoint bem_da_compra");
    try {
      const r = await ctx.tx.query<{ id: string }>(
        `insert into erp.equipments (organization_id, code, empresa_id, description, year_model, acquisition_value, acquisition_date, provider_id, product_id,
            equipment_type, hour_value, has_depreciation, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'own', 0, true, 'active') returning id::text as id`, [ctx.orgId, codigo, ...valores]);
      const bem = r.rows[0]!.id;
      // O bem é registro com identidade própria: recebe o ID Global (o contador já está preso pela confirmação).
      await atribuirIdGlobal(ctx, "equipments", bem);
      await ctx.tx.query("release savepoint bem_da_compra");
      return bem;
    } catch (e) {
      await ctx.tx.query("rollback to savepoint bem_da_compra");
      const pe = e as { code?: string; constraint?: string };
      if (pe.code === "23505" && pe.constraint === "equipments_organization_id_code_key") continue;
      throw e;
    }
  }
  throw err("CONFLICT", "Não foi possível gerar o código do bem: a faixa de números seguinte do inventário já está ocupada por códigos antigos.");
}

/** PRÉVIA da confirmação: o mesmo planejamento, sem trava, sem gravar nada. */
async function previaDaConfirmacao(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean) {
  const d = comoCompra(await lerDocumentoCompra(ctx, id, "compra", { lock: false }) as Record<string, unknown>);
  const itens = await itensDaCompra(ctx, d.id);
  const recusas: DomainError[] = [];
  const modo: ModoDoPlanejamento = {
    trava: false,
    recusar: (e) => { recusas.push(e); },
    conferirPeriodo: async (conferir) => {
      await ctx.tx.query("savepoint previa_compra_periodo");
      try {
        await conferir();
        await ctx.tx.query("release savepoint previa_compra_periodo");
      } catch (e) {
        await ctx.tx.query("rollback to savepoint previa_compra_periodo");
        const recusa = e instanceof DomainError ? e : fromPgError(e);
        if (!recusa) throw e;
        recusas.push(recusa);
      }
    },
  };
  const plano = await planejarConfirmacao(ctx, d, itens, execucaoConfiguradaHabilitada, modo);

  // OPERACOES-01 F9b: `padraoDaTop` só quando o par veio da TOP (aditivo, no fim do objeto).
  let classificacao: { categoria: { id: string; codigo: string; nome: string }; centro: { id: string; codigo: string; nome: string }; padraoDaTop?: true } | null = null;
  if (plano.classificacao) {
    const r = (await ctx.tx.query<{ cat_codigo: string; cat_nome: string; cc_codigo: string; cc_nome: string }>(
      `select c.code as cat_codigo, c.name as cat_nome, cc.code as cc_codigo, cc.name as cc_nome
         from erp.financial_categories c, erp.cost_centers cc
        where c.id = $1 and c.organization_id = $3 and cc.id = $2 and cc.organization_id = $3`,
      [plano.classificacao.categoriaFinanceiraId, plano.classificacao.centroCustoId, ctx.orgId])).rows[0];
    if (r) classificacao = { categoria: { id: plano.classificacao.categoriaFinanceiraId, codigo: r.cat_codigo, nome: r.cat_nome },
      centro: { id: plano.classificacao.centroCustoId, codigo: r.cc_codigo, nome: r.cc_nome },
      ...(plano.classificacaoDaTop ? { padraoDaTop: true as const } : {}) };
  }

  // OPERACOES-01 F7: o rateio do título, com nomes, SÓ quando a compra tem rateio (chave nova; sem ela, o corpo de hoje).
  let rateio: LinhaDoRateioNaPrevia[] | null = null;
  if (plano.rateio) {
    try {
      rateio = await rateioParaAPrevia(ctx, d.valor_total, plano.rateio);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      recusas.push(e);
    }
  }

  // As parcelas saem da MESMA conta que `createTitles` grava.
  let parcelas: { numero: number; entrada: boolean; vencimento: string; valor: string }[] = [];
  if (plano.politica && plano.geraTitulos && D(d.valor_total).gt(0)) {
    try {
      parcelas = parcelasDoTitulo(tituloDaCompra(d, plano.plano, plano.parcelas)).map((p) => ({ numero: p.number, entrada: p.isDownPayment, vencimento: p.dueDate, valor: money(p.amount) }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      recusas.push(e);
    }
  }

  return {
    contractVersion: CONTRATO_PREVIA_CONFIRMACAO_COMPRA,
    podeConfirmar: recusas.length === 0,
    recusas: recusas.map((e) => e.toJSON()),
    estoque: {
      efeito: plano.politica ? (plano.daEntrada ? "entrada" : "nenhum") : null,
      dataEntrada: plano.daEntrada ? plano.dataEntrada : null,
      itens: plano.entradas.map((e) => ({ item_id: e.item.id, produto_id: e.item.produto_id, produto: e.item.produto, armazem_id: e.item.armazem_id, armazem: e.item.armazem,
        quantidade: e.item.quantidade, lote: e.item.lote, validade: e.item.validade, valorEntrada: e.valorEntrada, custoUnitario: e.custoUnitario })),
      itensForaDaEntrada: plano.itensForaDaEntrada,
    },
    financeiro: {
      efeito: plano.politica ? (plano.geraTitulos ? "pagar" : "nenhum") : null,
      valor: plano.geraTitulos ? d.valor_total : null,
      numero: plano.geraTitulos ? (d.numero_nota?.trim() ? d.numero_nota.trim() : `CMP-${d.codigo}`) : null,
      parcelas,
      primeiroVencimento: parcelas.map((p) => p.vencimento).sort()[0] ?? null,
      classificacao,
      // OPERACOES-01 F7: no FIM do financeiro, e só com rateio (a classificação, então, é nula).
      ...(rateio ? { rateio } : {}),
    },
    politica: plano.politica ? { origem: plano.politica.origem, ...resumoDaPoliticaDaCompra(plano.politica) } : null,
    // OPERACOES-01 F6a: no FIM, e SÓ quando a divergência se aplica (compra com origem, seção fora de "Nenhuma"). Nos
    // outros casos a chave não existe: o corpo é o de hoje, chave por chave (o validador da web da base tolera a mais).
    ...(plano.divergencia ? { divergencia: plano.divergencia } : {}),
  };
}

/**
 * ESTORNO DE COMPRA CONFIRMADA — chamado pela rota `/cancel` (compras.ts) com o documento JÁ TRAVADO.
 * Trava os títulos em ordem de id; título com baixa → 409; estoque já consumido → 409 dizendo produto e
 * armazém (antes do estorno, nunca 500); `reverseStock`; títulos cancelados; situação cancelado; auditoria.
 * O estorno sai pelo CUSTO MÉDIO ATUAL do produto (o `reverseStock` de sempre), não pelo custo gravado na entrada;
 * `reversal` não passa pela guarda da reserva.
 *
 * COMPRAS-02 (decisão 268): a compra gerada de um PEDIDO trava o pedido LOGO DEPOIS da compra e ANTES dos títulos e
 * do estorno — nunca pedido depois de movimento: o recebimento trava pedido → contador do ID Global, e o estorno
 * trava saldo → produto (e pode alocar número); travar o pedido depois disso fecharia o ciclo. Cancelada a compra,
 * o saldo volta (é conta) e o pedido convertido SEM saldo encerrado reabre.
 */
export async function cancelarCompraConfirmada(ctx: ServiceCtx, doc: Record<string, unknown>, opcoes: { motivo?: string | null } = {}) {
  const id = String(doc.id);
  if (doc.situacao !== "confirmado") throw err("INVALID_STATUS_TRANSITION", "Só a compra confirmada é estornada");
  const pedidoDeOrigem = await travarPedidoDeOrigemDaCompra(ctx, doc);
  const titulos = await ctx.tx.query<{ id: string; paid_amount: string }>(
    "select id, paid_amount::text as paid_amount from erp.financial_titles where organization_id=$1 and source_type='documentos_compra' and source_id=$2 order by id for update",
    [ctx.orgId, id]);
  if (titulos.rows.some((t) => D(t.paid_amount).gt(0))) throw err("CONFLICT", "Títulos com baixa: cancele as baixas antes");

  // ESTOQUE CONSUMIDO: o saldo do (armazém, produto, lote) tem de cobrir o que a compra deu de entrada.
  // Trava os saldos em ordem fixa antes do estorno — o gatilho de saldo recusaria depois com mensagem genérica.
  const faltas = await ctx.tx.query<{ produto: string; armazem: string; lote: string | null; entrou: string; saldo: string }>(
    `with entrada as (
       select m.warehouse_id, m.product_id, coalesce(m.provider_lot, '') as lote, sum(m.quantity * m.direction) as q
         from erp.stock_movements m
        where m.organization_id=$1 and m.source_type='documentos_compra' and m.source_id=$2
        group by 1, 2, 3 having sum(m.quantity * m.direction) > 0),
     saldo as (
       select b.warehouse_id, b.product_id, coalesce(b.provider_lot, '') as lote, b.quantity
         from erp.stock_balances b join entrada e on e.warehouse_id=b.warehouse_id and e.product_id=b.product_id and e.lote=coalesce(b.provider_lot, '')
        where b.organization_id=$1
        order by b.warehouse_id, b.product_id, b.provider_lot
        for update of b)
     select p.code || ' - ' || p.description as produto, w.description as armazem, nullif(e.lote, '') as lote,
            e.q::text as entrou, coalesce(s.quantity, 0)::text as saldo
       from entrada e
       join erp.products p on p.id=e.product_id and p.organization_id=$1
       join erp.warehouses w on w.id=e.warehouse_id and w.organization_id=$1
       left join saldo s on s.warehouse_id=e.warehouse_id and s.product_id=e.product_id and s.lote=e.lote
      where coalesce(s.quantity, 0) < e.q
      order by 1, 2`, [ctx.orgId, id]);
  if (faltas.rows.length) {
    const linhas = faltas.rows.map((f) => `${f.produto} no local de estoque ${f.armazem}${f.lote ? ` (lote ${f.lote})` : ""}: entrou ${quantidadeLegivel(f.entrou)}, saldo ${quantidadeLegivel(f.saldo)}`);
    throw err("INSUFFICIENT_STOCK", `O estoque desta compra já foi consumido; o estorno deixaria o saldo negativo. ${linhas.join("; ")}.`,
      faltas.rows.map((f, i) => ({ produto: f.produto, armazem: f.armazem, lote: f.lote, entrou: f.entrou, saldo: f.saldo, message: linhas[i] })));
  }

  const estornos = await reverseStock(ctx, "documentos_compra", id, new Date().toISOString().slice(0, 10));
  const tc = await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where organization_id=$1 and source_type='documentos_compra' and source_id=$2 and status <> 'cancelled'", [ctx.orgId, id]);
  // OPERACOES-01 F7: os bens criados pelos itens imobilizados são BAIXADOS (como a nota antiga) — os ainda ativos,
  // travados antes, e a baixa confere o ROW COUNT contra eles.
  const bens = (await ctx.tx.query<{ id: string }>(
    `select e.id::text as id from erp.equipments e
       join erp.documentos_compra_itens i on i.bem_id = e.id and i.organization_id = e.organization_id
      where i.organization_id = $1 and i.documento_id = $2 and e.status <> 'written_off'
      order by e.id for update of e`, [ctx.orgId, id])).rows.map((b) => b.id);
  if (bens.length) {
    const baixa = await ctx.tx.query("update erp.equipments set status = 'written_off' where organization_id = $1 and id = any($2::uuid[]) and status <> 'written_off'", [ctx.orgId, bens]);
    if (baixa.rowCount !== bens.length) throw err("CONFLICT", "Os bens desta compra não foram baixados: tente de novo.");
  }
  const u = await ctx.tx.query("update erp.documentos_compra set situacao='cancelado', atualizado_em=now() where id=$1 and organization_id=$2 and situacao='confirmado'", [id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", id, "cancel", { ...(opcoes.motivo ? { motivo: opcoes.motivo } : {}), estornos, titulosCancelados: tc.rowCount ?? 0,
    ...(bens.length ? { bensBaixados: bens } : {}) });
  await reabrirPedidoDeOrigem(ctx, pedidoDeOrigem, id);
  // OPERACOES-01 F9b: o estorno devolve ao pedido de origem o que a compra realizou (e pode tê-lo reaberto).
  if (pedidoDeOrigem) await sincronizarProvisaoDoPedidoDeCompra(ctx, pedidoDeOrigem.id, MOTIVOS_DA_PROVISAO_COMPRA.compraCancelada(String(doc.codigo)));
  return { id, situacao: "cancelado" };
}

// ---------------------------------------------------------------------------------------------------
// NOTA DUPLICADA — mesmo fornecedor, número e série (série vazia = "1"), nos DOIS caminhos de entrada
// ---------------------------------------------------------------------------------------------------

export interface ChaveDaNota { fornecedorId: string; numero: string | null | undefined; serie: string | null | undefined }
const serieNormal = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "1");

/**
 * O id do fornecedor entra em MINÚSCULAS: o mesmo UUID escrito em maiúsculas por uma das portas cairia noutra chave.
 * Serializa as duas portas (Compra e Documento fiscal de Estoque) na MESMA chave de nota, até o fim da
 * transação: sem isto, uma Compra e um Documento fiscal simultâneos com a mesma nota passariam os dois.
 */
async function travarChaveDaNota(ctx: ServiceCtx, k: { fornecedorId: string; numero: string; serie: string }) {
  await ctx.tx.query("select pg_advisory_xact_lock(hashtextextended($1, 267))", [`nota:${ctx.orgId}:${k.fornecedorId.toLowerCase()}:${k.numero}:${k.serie}`]);
}

/** A Compra NÃO cancelada que já tem esta nota (o Documento fiscal de Estoque recusa por ela). */
export async function compraComANota(ctx: ServiceCtx, chave: ChaveDaNota & { excluirDocumentoId?: string | null }): Promise<string | null> {
  const numero = chave.numero?.trim();
  if (!numero) return null;
  const serie = serieNormal(chave.serie);
  await travarChaveDaNota(ctx, { fornecedorId: chave.fornecedorId, numero, serie });
  const r = await ctx.tx.query<{ codigo: string }>(
    `select codigo from erp.documentos_compra
      where organization_id=$1 and especie='compra' and situacao<>'cancelado' and fornecedor_id=$2
        and btrim(numero_nota)=$3 and coalesce(nullif(btrim(serie_nota), ''), '1')=$4 and ($5::uuid is null or id <> $5::uuid)
      order by created_at limit 1`, [ctx.orgId, chave.fornecedorId, numero, serie, chave.excluirDocumentoId ?? null]);
  return r.rows[0]?.codigo ?? null;
}

/** 409 DUPLICATE_DOCUMENT dizendo onde a nota está: "Compra <codigo>" ou "Documento fiscal de Estoque <código>". */
export async function conferirNotaDuplicada(ctx: ServiceCtx, chave: ChaveDaNota & { excluirDocumentoId?: string | null }): Promise<void> {
  const numero = chave.numero?.trim();
  if (!numero) return;
  const serie = serieNormal(chave.serie);
  const compra = await compraComANota(ctx, chave);
  if (compra) throw err("DUPLICATE_DOCUMENT", `A nota ${numero}/${serie} deste fornecedor já está na Compra ${compra}.`, { onde: "compra", codigo: compra });
  const nf = await ctx.tx.query<{ code: string }>(
    `select code from erp.invoices
      where organization_id=$1 and provider_id=$2 and btrim(number)=$3 and coalesce(nullif(btrim(series), ''), '1')=$4
        and status<>'cancelled' and deleted_at is null
      order by created_at limit 1`, [ctx.orgId, chave.fornecedorId, numero, serie]);
  const code = nf.rows[0]?.code;
  if (code) throw err("DUPLICATE_DOCUMENT", `A nota ${numero}/${serie} deste fornecedor já está no Documento fiscal de Estoque ${code}.`, { onde: "documento_fiscal_estoque", codigo: code });
}

const corpoVazio = z.object({}).strict();

/** Registra a prévia e a confirmação da Compra. Chamada no fim do registro de `compras.ts`. */
export function registrarConfirmacaoCompras(app: FastifyInstance) {
  app.get("/compras/compras/:id/previa-confirmacao", async (req) => runService(app, req, "compras.view",
    (ctx) => previaDaConfirmacao(ctx, (req.params as { id: string }).id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED)));
  app.post("/compras/compras/:id/confirm", async (req) => runService(app, req, "compras.edit", async (ctx) => {
    const { id } = req.params as { id: string };
    // Contrato estrito: o corpo, quando vem, é vazio — chave desconhecida é 422, nunca descartada.
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    // Visibilidade ANTES de reservar a chave: fora de escopo/inexistente é a MESMA 404 do GET.
    await lerDocumentoCompra(ctx, id, "compra", { lock: false });
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "confirm_documento_compra", sourceId: id, actorId: ctx.user.id },
      () => confirmarCompraNaTransacao(app, ctx, id, { automatica: false }))).result;
  }));
}
