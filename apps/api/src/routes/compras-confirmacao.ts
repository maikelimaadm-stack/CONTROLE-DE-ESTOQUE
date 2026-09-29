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
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, DomainError } from "@agro/shared";
import { resolverPoliticaEfetivaDaCompra, resumoDaPoliticaDaCompra, ratearCustoDeEntrada, type PoliticaEfetivaDaCompra } from "@agro/domain";
import { runService, idempotent, audit, assertPeriodOpen } from "../lib/service.js";
import { notFound, validation, err, fromPgError } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { postStock, reverseStock, quantidadeLegivel } from "../services/stock-core.js";
import { createTitles, installmentPlanSchema, parcelasDoTitulo, type InstallmentPlan } from "../services/financial-core.js";
import { travarContadorIdGlobal } from "../lib/id-global.js";
import { lerDocumentoCompra } from "./compras.js";

/** Versão do contrato da prévia. A web confere forma E versão antes de usar o corpo. */
export const CONTRATO_PREVIA_CONFIRMACAO_COMPRA = 1;

type PoliticaDaCompra = PoliticaEfetivaDaCompra;

/** O cabeçalho da Compra como a confirmação o lê (colunas da tabela, `lerDocumentoCompra`). */
export interface CompraParaConfirmar {
  id: string; especie: string; codigo: string; situacao: string; empresa_id: string; fornecedor_id: string;
  tipo_operacao_versao_id: string; data_documento: string; data_entrada: string | null; data_vencimento: string | null;
  numero_nota: string | null; serie_nota: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null;
  forma_pagamento_id: string | null; plano_parcelas: unknown; valor_total: string;
}

/** O item como a confirmação o lê: a linha do item e o controle de estoque do produto. */
interface ItemDaCompra {
  id: string; produto_id: string; armazem_id: string | null; quantidade: string; valor_total: string; lote: string | null; validade: string | null;
  controla_estoque: boolean; produto: string; armazem: string | null;
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
  };
}

/** Os itens na ordem do documento, com o controle de estoque do produto — UMA consulta, sem N+1. */
async function itensDaCompra(ctx: ServiceCtx, documentoId: string): Promise<ItemDaCompra[]> {
  const r = await ctx.tx.query<ItemDaCompra>(
    `select i.id, i.produto_id, i.armazem_id, i.quantidade::text as quantidade, i.valor_total::text as valor_total, i.lote,
            to_char(i.validade, 'YYYY-MM-DD') as validade, p.control_stock as controla_estoque,
            p.code || ' - ' || p.description as produto, w.description as armazem
       from erp.documentos_compra_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.warehouses w on w.id = i.armazem_id and w.organization_id = i.organization_id
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [documentoId, ctx.orgId]);
  return r.rows;
}

/** A política da versão congelada — recusa tipada, nunca "então é o padrão". */
async function politicaDaCompra(ctx: ServiceCtx, versaoId: string, execucaoConfiguradaHabilitada: boolean): Promise<PoliticaDaCompra> {
  const r = await ctx.tx.query<{ configuracao: unknown; codigo_base: string }>(
    `select v.configuracao, t.codigo_base
       from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
      where v.id = $1 and v.organization_id = $2`, [versaoId, ctx.orgId]);
  const linha = r.rows[0];
  // A TOP é obrigatória na compra (NOT NULL + FK composta): sem a linha é corrupção, nunca "padrão".
  if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  const res = resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: linha.codigo_base, configuracao: linha.configuracao }, execucaoConfiguradaHabilitada });
  if (res.ok) return res.politica;
  const mensagem = res.motivo === "execucao_desligada"
    ? "A operação desta compra usa execução configurada, que ainda não está habilitada neste ambiente. A compra não foi confirmada."
    : res.motivo === "configuracao_ilegivel"
      ? "A configuração da operação desta compra está num formato que este servidor não executa. A compra não foi confirmada."
      : "A configuração da operação desta compra pede um efeito que esta versão do produto não executa. A compra não foi confirmada.";
  throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", mensagem,
    { motivo: res.motivo, recusas: res.recusas.map(({ motivo, caminho, mensagem: m }) => ({ motivo, caminho, mensagem: m })) });
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
}

const MSG_NATUREZA_OBRIGATORIA = "Informe a natureza financeira e o centro de resultado: a confirmação gera contas a pagar.";
const MSG_NATUREZA_INVALIDA = "Natureza financeira inválida: escolha uma natureza de despesa analítica e ativa.";
const MSG_CENTRO_INVALIDO = "Centro de resultado inválido: escolha um centro de resultado analítico e ativo.";

/** Natureza de DESPESA (ou ambas), analítica e ativa; centro analítico e ativo. Mesma recusa para inexistente/alheio. */
async function conferirClassificacao(ctx: ServiceCtx, categoriaId: string, centroId: string, trava: boolean): Promise<string | null> {
  const lock = trava ? " for share" : "";
  const c = await ctx.tx.query("select 1 from erp.financial_categories where id=$1 and organization_id=$2 and nature in ('expense','both') and kind='analytic' and is_active and deleted_at is null" + lock, [categoriaId, ctx.orgId]);
  if (!c.rowCount) return "natureza";
  const cc = await ctx.tx.query("select 1 from erp.cost_centers where id=$1 and organization_id=$2 and kind='analytic' and is_active and deleted_at is null" + lock, [centroId, ctx.orgId]);
  if (!cc.rowCount) return "centro";
  return null;
}

function lerPlano(bruto: unknown): InstallmentPlan | null {
  if (!bruto || typeof bruto !== "object" || !(bruto as { installments?: number }).installments) return null;
  return installmentPlanSchema.parse(bruto);
}

/** Valor, vencimento e plano dos títulos a pagar — o que `createTitles` recebe e o que a prévia mostra. */
function tituloDaCompra(d: CompraParaConfirmar, plano: InstallmentPlan | null) {
  return { amount: d.valor_total, dueDate: plano?.first_due_date ?? d.data_vencimento ?? d.data_documento, plan: plano };
}

/**
 * O PLANEJAMENTO DA CONFIRMAÇÃO — UMA função, para a confirmação E para a prévia. Ordem: situação → política da
 * versão congelada e gate → exigências da política → período → classificação financeira → custo de entrada.
 */
async function planejarConfirmacao(ctx: ServiceCtx, d: CompraParaConfirmar, itens: ItemDaCompra[], execucaoConfiguradaHabilitada: boolean, modo: ModoDoPlanejamento): Promise<PlanoDaConfirmacao> {
  const dataEntrada = d.data_entrada ?? d.data_documento;
  const plano: PlanoDaConfirmacao = { politica: null, daEntrada: false, geraTitulos: false, entradas: [], itensForaDaEntrada: 0, classificacao: null, plano: null, dataEntrada };
  if (d.situacao === "confirmado") { modo.recusar(err("ALREADY_CONFIRMED", "Compra já confirmada")); return plano; }
  if (d.situacao === "cancelado") { modo.recusar(err("ALREADY_CANCELLED", "Compra cancelada")); return plano; }

  let politica: PoliticaDaCompra;
  try {
    politica = await politicaDaCompra(ctx, d.tipo_operacao_versao_id, execucaoConfiguradaHabilitada);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    modo.recusar(e); return plano;
  }
  plano.politica = politica;
  // PADRÃO da compra: entrada dos itens com armazém e conta a pagar do total.
  plano.daEntrada = politica.estoque.autoridade === "padrao" || politica.estoque.efeito === "entrada";
  plano.geraTitulos = politica.financeiro.autoridade === "padrao" || politica.financeiro.efeito === "pagar";
  plano.plano = lerPlano(d.plano_parcelas);

  // AS EXIGÊNCIAS DA POLÍTICA — todas conferidas, todas juntas, antes de qualquer efeito.
  const exigencias: { caminho: string; mensagem: string }[] = [];
  if (politica.estoque.autoridade === "configurada" && politica.estoque.efeito === "entrada" && politica.estoque.exigeArmazem
      && itens.some((it) => it.controla_estoque && !it.armazem_id)) {
    exigencias.push({ caminho: "estoque.exigeArmazem", mensagem: "Informe o armazém de todos os itens" });
  }
  if (politica.financeiro.autoridade === "configurada" && politica.financeiro.efeito === "pagar") {
    if (politica.financeiro.exigeFormaPagamento && !d.forma_pagamento_id) exigencias.push({ caminho: "financeiro.exigeFormaPagamento", mensagem: "Informe a forma de pagamento" });
    if (politica.financeiro.exigeVencimento && !(plano.plano?.first_due_date ?? d.data_vencimento)) exigencias.push({ caminho: "financeiro.exigeVencimento", mensagem: "Informe o vencimento" });
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
  if (plano.geraTitulos) {
    if (!d.categoria_financeira_id || !d.centro_custo_id) {
      modo.recusar(validation(MSG_NATUREZA_OBRIGATORIA, [{ path: ["categoria_financeira_id"], message: MSG_NATUREZA_OBRIGATORIA }]));
    } else {
      const falha = await conferirClassificacao(ctx, d.categoria_financeira_id, d.centro_custo_id, modo.trava);
      if (falha === "natureza") modo.recusar(validation(MSG_NATUREZA_INVALIDA, [{ path: ["categoria_financeira_id"], message: MSG_NATUREZA_INVALIDA }]));
      else if (falha === "centro") modo.recusar(validation(MSG_CENTRO_INVALIDO, [{ path: ["centro_custo_id"], message: MSG_CENTRO_INVALIDO }]));
      else plano.classificacao = { categoriaFinanceiraId: d.categoria_financeira_id, centroCustoId: d.centro_custo_id };
    }
  }

  // CUSTO DE ENTRADA: a parte de cada item no valor_total do documento (frete, outras e desconto entram no custo).
  if (plano.daEntrada && itens.length) {
    const rateio = ratearCustoDeEntrada(itens.map((it) => ({ quantidade: it.quantidade, valorTotal: it.valor_total })), d.valor_total);
    itens.forEach((it, i) => {
      if (it.armazem_id && it.controla_estoque) plano.entradas.push({ item: it, valorEntrada: rateio[i]!.valorEntrada, custoUnitario: rateio[i]!.custoUnitario });
      else plano.itensForaDaEntrada++;
    });
  }
  return plano;
}

/** CONFIRMAR a Compra — dentro da transação da rota, sob a chave de idempotência. */
async function confirmarCompra(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean) {
  // 1ª TRAVA: o documento. A segunda confirmação espera aqui e relê `confirmado` (409, sem efeito).
  const d = comoCompra(await lerDocumentoCompra(ctx, id, "compra", { lock: true }) as Record<string, unknown>);
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
  let titulos: string[] = [];
  if (plano.geraTitulos && plano.classificacao) {
    const t = await createTitles(ctx, { empresaId: d.empresa_id, direction: "payable", number: d.numero_nota?.trim() ? d.numero_nota.trim() : `CMP-${d.codigo}`,
      personId: d.fornecedor_id, ...tituloDaCompra(d, plano.plano), emissionDate: d.data_documento, note: `Compra ${d.codigo}`,
      apportionment: [{ financialCategoryId: plano.classificacao.categoriaFinanceiraId, costCenterId: plano.classificacao.centroCustoId, percentage: "100" }],
      sourceType: "documentos_compra", sourceId: d.id });
    titulos = t.ids;
  }

  // ROW COUNT SOB RLS, com a transição conferida no `where`.
  const u = await ctx.tx.query("update erp.documentos_compra set situacao='confirmado', atualizado_em=now() where id=$1 and organization_id=$2 and especie='compra' and situacao='aberto'", [d.id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", d.id, "confirm", {
    titulos, movimentos, tipoOperacaoVersaoId: d.tipo_operacao_versao_id,
    execucao: { origem: politica.origem, ...resumoDaPoliticaDaCompra(politica) },
    custoDeEntrada: plano.entradas.map((e) => ({ itemId: e.item.id, valorEntrada: e.valorEntrada, custoUnitario: e.custoUnitario })),
    ...(titulos.length && plano.classificacao ? { classificacaoFinanceira: plano.classificacao } : {}),
  });
  return { id: d.id, situacao: "confirmado", titulo_ids: titulos, movimento_ids: movimentos };
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

  let classificacao: { categoria: { id: string; codigo: string; nome: string }; centro: { id: string; codigo: string; nome: string } } | null = null;
  if (plano.classificacao) {
    const r = (await ctx.tx.query<{ cat_codigo: string; cat_nome: string; cc_codigo: string; cc_nome: string }>(
      `select c.code as cat_codigo, c.name as cat_nome, cc.code as cc_codigo, cc.name as cc_nome
         from erp.financial_categories c, erp.cost_centers cc
        where c.id = $1 and c.organization_id = $3 and cc.id = $2 and cc.organization_id = $3`,
      [plano.classificacao.categoriaFinanceiraId, plano.classificacao.centroCustoId, ctx.orgId])).rows[0];
    if (r) classificacao = { categoria: { id: plano.classificacao.categoriaFinanceiraId, codigo: r.cat_codigo, nome: r.cat_nome },
      centro: { id: plano.classificacao.centroCustoId, codigo: r.cc_codigo, nome: r.cc_nome } };
  }

  // As parcelas saem da MESMA conta que `createTitles` grava.
  let parcelas: { numero: number; entrada: boolean; vencimento: string; valor: string }[] = [];
  if (plano.politica && plano.geraTitulos && D(d.valor_total).gt(0)) {
    try {
      parcelas = parcelasDoTitulo(tituloDaCompra(d, plano.plano)).map((p) => ({ numero: p.number, entrada: p.isDownPayment, vencimento: p.dueDate, valor: money(p.amount) }));
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
    },
    politica: plano.politica ? { origem: plano.politica.origem, ...resumoDaPoliticaDaCompra(plano.politica) } : null,
  };
}

/**
 * ESTORNO DE COMPRA CONFIRMADA — chamado pela rota `/cancel` (compras.ts) com o documento JÁ TRAVADO.
 * Trava os títulos em ordem de id; título com baixa → 409; estoque já consumido → 409 dizendo produto e
 * armazém (antes do estorno, nunca 500); `reverseStock`; títulos cancelados; situação cancelado; auditoria.
 * Estorno pelo custo gravado no movimento (o `reverseStock` de sempre); `reversal` não passa pela guarda da reserva.
 */
export async function cancelarCompraConfirmada(ctx: ServiceCtx, doc: Record<string, unknown>, opcoes: { motivo?: string | null } = {}) {
  const id = String(doc.id);
  if (doc.situacao !== "confirmado") throw err("INVALID_STATUS_TRANSITION", "Só a compra confirmada é estornada");
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
    const linhas = faltas.rows.map((f) => `${f.produto} no armazém ${f.armazem}${f.lote ? ` (lote ${f.lote})` : ""}: entrou ${quantidadeLegivel(f.entrou)}, saldo ${quantidadeLegivel(f.saldo)}`);
    throw err("INSUFFICIENT_STOCK", `O estoque desta compra já foi consumido; o estorno deixaria o saldo negativo. ${linhas.join("; ")}.`,
      faltas.rows.map((f, i) => ({ produto: f.produto, armazem: f.armazem, lote: f.lote, entrou: f.entrou, saldo: f.saldo, message: linhas[i] })));
  }

  const estornos = await reverseStock(ctx, "documentos_compra", id, new Date().toISOString().slice(0, 10));
  const tc = await ctx.tx.query("update erp.financial_titles set status='cancelled', version=version+1 where organization_id=$1 and source_type='documentos_compra' and source_id=$2 and status <> 'cancelled'", [ctx.orgId, id]);
  const u = await ctx.tx.query("update erp.documentos_compra set situacao='cancelado', atualizado_em=now() where id=$1 and organization_id=$2 and situacao='confirmado'", [id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", id, "cancel", { ...(opcoes.motivo ? { motivo: opcoes.motivo } : {}), estornos, titulosCancelados: tc.rowCount ?? 0 });
  return { id, situacao: "cancelado" };
}

// ---------------------------------------------------------------------------------------------------
// NOTA DUPLICADA — mesmo fornecedor, número e série (série vazia = "1"), nos DOIS caminhos de entrada
// ---------------------------------------------------------------------------------------------------

export interface ChaveDaNota { fornecedorId: string; numero: string | null | undefined; serie: string | null | undefined }
const serieNormal = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "1");

/**
 * Serializa as duas portas (Compra e Documento fiscal de Estoque) na MESMA chave de nota, até o fim da
 * transação: sem isto, uma Compra e um Documento fiscal simultâneos com a mesma nota passariam os dois.
 */
async function travarChaveDaNota(ctx: ServiceCtx, k: { fornecedorId: string; numero: string; serie: string }) {
  await ctx.tx.query("select pg_advisory_xact_lock(hashtextextended($1, 267))", [`nota:${ctx.orgId}:${k.fornecedorId}:${k.numero}:${k.serie}`]);
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
      order by criado_em limit 1`, [ctx.orgId, chave.fornecedorId, numero, serie, chave.excluirDocumentoId ?? null]);
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
      () => confirmarCompra(ctx, id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED))).result;
  }));
}
