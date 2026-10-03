import { expect } from "vitest";
import {
  configuracaoNeutraTopV5, familiaOperacionalDeDocumentoCompra,
  type ConfiguracaoTipoOperacaoV5, type SecaoFinanceiroPadrao
} from "@agro/domain";
import { c, DATA, j, top, cfg4, versaoAtualNoBanco, corpoReceber, unico, type Hdr, type Resposta } from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F9b (decisão 286) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DA PROVISÃO DO PEDIDO DE COMPRA E DOS PADRÕES DA
 * TOP NA COMPRA (`f9b-provisao-compra`, `f9b-compra-padroes-top`).
 *
 * Sobre o cenário `c` de `./top-config-08-ajuda.js`: cada arquivo sobe o PRÓPRIO harness (`iniciar()`, banco recriado), a
 * instância `ligada` (o gate da execução configurada ligado, o de produção) e a testemunha `c.admin` (superusuário, sem
 * RLS). Este arquivo só acrescenta o que a F9b precisa:
 *
 *   · as TOPs de COMPRA e de PEDIDO DE COMPRA no FORMATO 5, PELA API (`top(…)`), com `padroesFinanceiros` no CORPO
 *     quando pedidos — a gravação dos padrões pela porta administrativa é parte do que se prova (a premissa lê a linha
 *     da tabela da versão no banco); o pedido sempre com o destino "Em partes" para a TOP de compra;
 *   · os cadastros próprios (natureza de DESPESA e centro, analíticos, fora do topo da ordem por código) e as contas
 *     novas (fixtures do superusuário, como na F9a);
 *   · as chamadas (lançar o pedido, finalizar, receber, confirmar e a prévia dela, cancelar, encerrar o saldo, a cotação
 *     da F6a até o vencedor) e as leituras da testemunha (os títulos da origem com tudo o que a F9b grava, o rateio, a
 *     trilha "provisao" e as contagens).
 *
 * O pedido padrão: 10 × 100 = 1000, em 2 parcelas (`2026-10-10` e `2026-11-09`), SEM natureza e centro (salvo `extra`).
 */

/** As famílias, perguntadas ao registry. */
export const PEDIDO_DE_COMPRA = familiaOperacionalDeDocumentoCompra("pedido")!;
export const COMPRA = familiaOperacionalDeDocumentoCompra("compra")!;
export const ORCAMENTO_DE_COMPRA = familiaOperacionalDeDocumentoCompra("orcamento")!;
/** O plano de parcelas do pedido e os vencimentos que ele dá. */
export const PLANO = { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30 };
export const VENCIMENTOS = ["2026-10-10", "2026-11-09"] as const;

// ─────────────── a configuração e as TOPs ───────────────

/** O FORMATO 5 neutro (o do domínio) com a seção `financeiroPadrao` ajustada. Cada chamada devolve um objeto novo. */
export function cfg5Fin(secao: Partial<SecaoFinanceiroPadrao> = {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  x.financeiroPadrao = { ...x.financeiroPadrao, ...secao };
  return x;
}

/** Os padrões financeiros no CORPO da TOP (a porta administrativa). Ausente = sem padrão naquele campo. */
export type PadroesNoCorpo = Partial<Record<"naturezaId" | "centroCustoId" | "tipoTituloId" | "formaPagamentoId" | "contaBancariaId", string>>;
export interface TopNo5 { id: string; versaoId: string }

interface LinhaDosPadroes {
  natureza_id: string | null; centro_custo_id: string | null; tipo_titulo_id: string | null; forma_pagamento_id: string | null; conta_bancaria_id: string | null;
}

/**
 * Uma TOP da família no FORMATO 5, pela API, com a seção e (se pedidos) os padrões no corpo. Premissas lidas no banco:
 * a versão corrente está no formato 5 e a linha dos padrões dela é EXATAMENTE a pedida (nenhuma linha sem padrões).
 */
async function topNo5(codigoBase: string, o: { secao?: Partial<SecaoFinanceiroPadrao>; padroes?: PadroesNoCorpo; extra?: Record<string, unknown> }): Promise<TopNo5> {
  const id = await top(codigoBase, { configuracao: cfg5Fin(o.secao), ...(o.padroes ? { padroesFinanceiros: o.padroes } : {}), ...(o.extra ?? {}) });
  const v = await versaoAtualNoBanco(id);
  expect(v.configuracao_schema_version, `premissa: a TOP ${codigoBase} está no formato 5`).toBe(5);
  const linhas = (await c.admin.query<LinhaDosPadroes>(
    `select natureza_id::text, centro_custo_id::text, tipo_titulo_id::text, forma_pagamento_id::text, conta_bancaria_id::text
       from erp.tipos_operacao_versao_financeiro where origem_versao_id = $1`, [v.id])).rows;
  const p = o.padroes;
  expect(linhas, "premissa: a API gravou os padrões da versão (ou nenhum)").toEqual(p ? [{
    natureza_id: p.naturezaId ?? null, centro_custo_id: p.centroCustoId ?? null, tipo_titulo_id: p.tipoTituloId ?? null,
    forma_pagamento_id: p.formaPagamentoId ?? null, conta_bancaria_id: p.contaBancariaId ?? null
  }] : []);
  return { id, versaoId: v.id };
}

/** Uma TOP de COMPRA no formato 5 (a seção e os padrões dados; sem nada, o neutro). */
export const topCompraNo5 = (o: { secao?: Partial<SecaoFinanceiroPadrao>; padroes?: PadroesNoCorpo } = {}): Promise<TopNo5> => topNo5(COMPRA, o);

/**
 * Uma TOP de PEDIDO DE COMPRA no formato 5, com o destino "Em partes" para a TOP de compra `topCompra` e, com `orcamento`,
 * também o destino para essa TOP de orçamento (sem ele, o pedido não recebe orçamento).
 */
export const topPedidoNo5 = (topCompra: string, o: { secao?: Partial<SecaoFinanceiroPadrao>; padroes?: PadroesNoCorpo; orcamento?: string } = {}): Promise<TopNo5> =>
  topNo5(PEDIDO_DE_COMPRA, {
    ...(o.secao ? { secao: o.secao } : {}), ...(o.padroes ? { padroes: o.padroes } : {}),
    extra: { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes: true }, ...(o.orcamento ? [{ tipoOperacaoId: o.orcamento, ordem: 1, emPartes: false }] : [])] },
  });

/** Uma TOP de ORÇAMENTO DE COMPRA no formato 4 neutro (o cenário da cotação da F6a). Premissa: o banco a guardou no 4. */
export async function topOrcamentoNo4(): Promise<string> {
  const id = await top(ORCAMENTO_DE_COMPRA, { configuracao: cfg4() });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, "premissa: a TOP de orçamento de compra está no formato 4").toBe(4);
  return id;
}

// ─────────────── cadastros (superusuário) ───────────────

/** Uma natureza de DESPESA analítica e ativa, nova (código fora do topo da ordem: nunca a "1ª por código"). */
export async function cadastroDespesa(nome: string): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,'expense','analytic',true) returning id::text as id",
    [c.h.demo.orgId, `9.F9B.${unico()}`, nome])).rows[0]!.id;
}
/** Um centro de resultado analítico e ativo, novo (fora do topo da ordem). */
export async function centro(nome: string): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id::text as id",
    [c.h.demo.orgId, `9.F9B.${unico()}`, nome])).rows[0]!.id;
}
/** Uma conta bancária NOVA e ativa da organização, para ser inativada pelo caso. */
export async function contaNova(): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type) values ($1,$2,$3,'checking') returning id::text as id",
    [c.h.demo.orgId, `F9B${unico()}`.toUpperCase().slice(0, 20), "Conta padrão da TOP (F9b)"])).rows[0]!.id;
}
/** Ativa ou inativa a conta (superusuário). */
export async function ativarConta(id: string, ativa: boolean): Promise<void> {
  const r = await c.admin.query("update erp.bank_accounts set is_active=$2 where id=$1", [id, ativa]);
  expect(r.rowCount, "premissa: a conta mudou").toBe(1);
}
/** Um tipo de título do SISTEMA (organização nula) ou da organização: o primeiro pelo nome. */
export async function umTipoDeTitulo(): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "select id::text as id from erp.title_types where organization_id is null or organization_id = $1 order by name, id limit 1", [c.h.demo.orgId])).rows[0]!.id;
}

// ─────────────── chamadas ───────────────

const chamar = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });

/** O código de um documento de compra (o banco). */
export async function codigoDe(id: string): Promise<string> {
  return (await c.admin.query<{ codigo: string }>("select codigo from erp.documentos_compra where id=$1", [id])).rows[0]!.codigo;
}

export interface PedidoCompra { id: string; codigo: string; itemId: string }

/** O corpo do PEDIDO DE COMPRA: 10 × 100 = 1000 do produto dado, no plano de 2 parcelas, sem natureza e centro. */
export const corpoPedido = (topId: string, produtoId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  empresa_id: c.I.empresa, tipo_operacao_id: topId, fornecedor_id: c.I.provider, data_documento: DATA, plano_parcelas: PLANO,
  itens: [{ produto_id: produtoId, armazem_id: c.I.warehouse, quantidade: "10", valor_unitario: "100.00" }], ...extra,
});
export const lancarPedido = (corpo: Record<string, unknown>): Promise<Resposta> => chamar("POST", "/api/compras/pedidos", corpo);

/** Um pedido de compra de 1000 (10 × 100) em 2 parcelas, pela API, na TOP dada. Premissa: nasce aberto. */
export async function pedidoCompra(topId: string, produtoId: string, extra: Record<string, unknown> = {}): Promise<PedidoCompra> {
  const r = await lancarPedido(corpoPedido(topId, produtoId, extra));
  expect(r.statusCode, `premissa: o pedido de compra nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  expect(await situacaoDe(id), "premissa: o pedido nasce aberto").toBe("aberto");
  const item = (await c.admin.query<{ id: string }>("select id::text as id from erp.documentos_compra_itens where documento_id=$1 order by posicao, id limit 1", [id])).rows[0]!.id;
  return { id, codigo: await codigoDe(id), itemId: item };
}

export const finalizar = (pedidoId: string): Promise<Resposta> => chamar("POST", `/api/compras/pedidos/${pedidoId}/finalizar`, {});
/** Finaliza e confere o 200. */
export async function finalizado(pedidoId: string): Promise<Record<string, unknown>> {
  const r = await finalizar(pedidoId);
  expect(r.statusCode, `premissa: o pedido é finalizado — ${r.body}`).toBe(200);
  return j(r);
}

/**
 * O RECEBER do pedido para a TOP de compra: `quantidade` do item, a `valorUnitario`, com a natureza e o centro do seed
 * (troque por `extra`). Devolve a resposta crua.
 */
export const receber = (p: PedidoCompra, topCompra: string, quantidade: string, valorUnitario = "100.00", extra: Record<string, unknown> = {}): Promise<Resposta> =>
  chamar("POST", `/api/compras/pedidos/${p.id}/convert`, corpoReceber(topCompra, [{ item_origem_id: p.itemId, quantidade, valor_unitario: valorUnitario }], extra));
/** Recebe e confere o 201: a compra gerada (id e código). */
export async function recebido(p: PedidoCompra, topCompra: string, quantidade: string, valorUnitario = "100.00", extra: Record<string, unknown> = {}): Promise<{ id: string; codigo: string }> {
  const r = await receber(p, topCompra, quantidade, valorUnitario, extra);
  expect(r.statusCode, `premissa: o pedido é recebido — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  return { id, codigo: await codigoDe(id) };
}

export const confirmar = (compraId: string): Promise<Resposta> => chamar("POST", `/api/compras/compras/${compraId}/confirm`, {});
/** Confirma a compra e confere o 200. */
export async function confirmada(compraId: string): Promise<void> {
  const r = await confirmar(compraId);
  expect(r.statusCode, `premissa: a compra é confirmada — ${r.body}`).toBe(200);
}
export const cancelar = (segmento: "pedidos" | "compras", id: string, motivo?: string): Promise<Resposta> =>
  chamar("POST", `/api/compras/${segmento}/${id}/cancel`, motivo ? { motivo } : {});
export const encerrar = (pedidoId: string, motivo: string): Promise<Resposta> =>
  chamar("POST", `/api/compras/pedidos/${pedidoId}/encerrar-saldo`, { motivo });
/** A prévia da confirmação da compra (crua). */
export const previaDaConfirmacao = (compraId: string): Promise<Resposta> => chamar("GET", `/api/compras/compras/${compraId}/previa-confirmacao`);

/**
 * A COTAÇÃO do pedido ABERTO (o fluxo da F6a), pela API: aprovado para orçamento → um orçamento do fornecedor do pedido
 * na TOP `topOrc`, com `valorUnitario` em cada item → o vencedor escolhido. O vencedor grava o valor no pedido sem passar
 * pelo salvar. Premissas: cada passo responde o de hoje.
 */
export async function vencedorEscolhido(p: PedidoCompra, topOrc: string, valorUnitario: string): Promise<void> {
  const ap = await chamar("POST", `/api/compras/pedidos/${p.id}/aprovar-para-orcamento`, {});
  expect(ap.statusCode, `premissa: o pedido é aprovado para orçamento — ${ap.body}`).toBe(200);
  const orc = await chamar("POST", `/api/compras/pedidos/${p.id}/orcamentos`,
    { tipo_operacao_id: topOrc, fornecedor_id: c.I.provider, data_documento: DATA, itens: [{ item_pedido_id: p.itemId, valor_unitario: valorUnitario }] });
  expect(orc.statusCode, `premissa: o orçamento nasce — ${orc.body}`).toBe(201);
  const v = await chamar("POST", `/api/compras/pedidos/${p.id}/orcamentos/${j(orc).id as string}/escolher`, {});
  expect(v.statusCode, `premissa: o vencedor é escolhido — ${v.body}`).toBe(200);
}

// ─────────────── testemunhas (superusuário, sem RLS) ───────────────

/** A situação do documento de compra no banco. */
export async function situacaoDe(id: string): Promise<string | null> {
  return (await c.admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]?.situacao ?? null;
}

export interface TituloNoBanco {
  id: string; number: string; direction: string; status: string; amount: string; due_date: string; person_id: string; empresa_id: string;
  cancel_reason: string | null; cancelled_by: string | null; title_type_id: string | null; conta_prevista_id: string | null;
  tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; paid_amount: string;
}
/** Os títulos de um documento de compra (origem `documentos_compra`), com tudo o que a F9b grava, na ordem das parcelas. */
export async function titulosDe(id: string): Promise<TituloNoBanco[]> {
  return (await c.admin.query<TituloNoBanco>(
    `select id::text as id, number, direction, status, amount::text as amount, due_date::text as due_date, person_id::text as person_id,
            empresa_id::text as empresa_id, cancel_reason, cancelled_by::text as cancelled_by, title_type_id::text as title_type_id,
            conta_prevista_id::text as conta_prevista_id, tipo_operacao_id::text as tipo_operacao_id,
            tipo_operacao_versao_id::text as tipo_operacao_versao_id, paid_amount::text as paid_amount
       from erp.financial_titles where source_type='documentos_compra' and source_id=$1
      order by created_at, due_date, installment_number, id`, [id])).rows;
}
/** Os títulos do PEDIDO, divididos: todos, os previstos VIVOS e os cancelados. */
export async function previstos(pedidoId: string): Promise<{ todos: TituloNoBanco[]; vivos: TituloNoBanco[]; cancelados: TituloNoBanco[] }> {
  const todos = await titulosDe(pedidoId);
  return { todos, vivos: todos.filter((t) => t.status === "previsto"), cancelados: todos.filter((t) => t.status === "cancelled") };
}
/** As parcelas como pares [valor, vencimento]. */
export const parcelas = (ts: readonly { amount: string; due_date: string }[]): [string, string][] => ts.map((t) => [t.amount, t.due_date]);
/** O rateio de um título. */
export async function rateio(tituloId: string): Promise<{ natureza: string; centro: string; percentage: string; amount: string }[]> {
  return (await c.admin.query<{ natureza: string; centro: string; percentage: string; amount: string }>(
    "select financial_category_id::text as natureza, cost_center_id::text as centro, percentage::numeric(9,2)::text as percentage, amount::text as amount from erp.title_apportionments where title_id=$1 order by id",
    [tituloId])).rows;
}
export interface TrilhaDaProvisao { user_id: string | null; metadata: { motivo: string; alvo: string; cancelados: string[]; criados: string[] } }
/** A trilha "provisao" do pedido de compra, em ordem. */
export async function trilhaProvisao(pedidoId: string): Promise<TrilhaDaProvisao[]> {
  return (await c.admin.query<TrilhaDaProvisao>(
    "select user_id::text as user_id, metadata from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action='provisao' order by id", [pedidoId])).rows;
}
/** A contagem de linhas de uma tabela da organização (para "nada gravado" e "nada apagado"). Tabela literal do teste. */
export async function contar(tabela: "financial_titles" | "documentos_compra" | "stock_movements"): Promise<number> {
  return Number((await c.admin.query<{ n: string }>(`select count(*)::text as n from erp.${tabela} where organization_id=$1`, [c.h.demo.orgId])).rows[0]!.n);
}
/** As baixas de um título. */
export async function baixasDe(tituloId: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text as n from erp.title_settlements where title_id=$1", [tituloId])).rows[0]!.n);
}
