import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo, type Db } from "@agro/db";
import { configuracaoNeutraTopV3, type ConfiguracaoTipoOperacaoV3 } from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * O DOCUMENTO DE COMPRA (COMPRAS-01, decisão 267) — CO-1..CO-8 da missão.
 *
 * O QUE CONTA COMO PROVA. Nenhuma asserção decisiva é só status HTTP: movimentos de estoque, saldos, títulos
 * a pagar, situação do documento e registro do ID Global são LIDOS NO BANCO por conexão própria (superusuário,
 * sem RLS), por origem (`source_type='documentos_compra'`, `source_id`). Toda asserção de "zero efeito" vem com
 * a PREMISSA ao lado: o mesmo cenário, corrigido, produz o efeito.
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco: `h.app` com o gate da execução configurada DESLIGADO e `ligada`
 * com `TOP_EFFECTS_RUNTIME_V1_ENABLED=1` (o de produção). TOPs são cadastradas pela `ligada`, como a porta exige.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

const COMPRA = "compras.compra";
const PEDIDO = "compras.pedido";
const DATA = "2026-09-10";

let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

// ---------------------------------------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------------------------------------
async function top(codigoBase: string, configuracao?: unknown, headers: Hdr = h.headers()): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers,
    payload: { codigo: `9${String(++seq).padStart(3, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase, nome: `TOP ${codigoBase} ${seq}`, ...(configuracao ? { configuracao } : {}) } });
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
type Eixo = "legado" | "nenhum" | "efeito";
function execucao(estoque: Eixo, financeiro: Eixo, ajuste: (c: ConfiguracaoTipoOperacaoV3) => void = () => {}): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  c.execucao = { estoque: estoque === "legado" ? "legado" : "configurada", financeiro: financeiro === "legado" ? "legado" : "configurada" };
  if (estoque === "efeito") c.estoque.atualizacao = "entrada";
  if (financeiro === "efeito") c.financeiro.atualizacao = "pagar";
  ajuste(c);
  return c;
}

/** Produto NOVO por SQL (admin), no modelo de um do seed: cada cenário lê o próprio saldo, sem herdar de outro. */
async function produto(opcoes: { controla?: boolean; lote?: "nenhum" | "lote" | "lote_validade" } = {}): Promise<{ id: string; nome: string }> {
  const m = (await admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [I.product2])).rows[0]!;
  const s = unico();
  const lote = opcoes.lote ?? "nenhum";
  const r = await admin.query<{ id: string; description: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, controle_lote, has_lot)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, description`,
    [h.demo.orgId, `CO${s}`, `Produto CO ${s}`, m.measurement_id, m.group_id, m.category_id, m.kind_id, m.financial_category_id, opcoes.controla ?? true, lote, lote !== "nenhum"]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.description };
}

async function condicao(parcelas: number, dias = 30, intervalo = 30): Promise<string> {
  const s = unico();
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,$4,$5,'intervalo',$6,false) returning id",
    [h.demo.orgId, `CO-${s}`, `Condição CO ${s}`, parcelas, dias, intervalo])).rows[0]!.id;
}

type Item = { produto_id: string; armazem_id?: string | null; quantidade: string; valor_unitario: string; desconto?: string; lote?: string; validade?: string };
const rota = (especie: "pedido" | "compra") => (especie === "pedido" ? "/api/compras/pedidos" : "/api/compras/compras");

function lancar(especie: "pedido" | "compra", topId: string, itens: Item[], extra: Record<string, unknown> = {}, headers: Hdr = h.headers(), app: FastifyInstance = h.app) {
  return app.inject({ method: "POST", url: rota(especie), headers,
    payload: { empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
      categoria_financeira_id: I.category, centro_custo_id: I.costCenter, itens, ...extra } });
}
async function lancada(especie: "pedido" | "compra", topId: string, itens: Item[], extra: Record<string, unknown> = {}): Promise<string> {
  const r = await lancar(especie, topId, itens, extra);
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const confirmar = (app: FastifyInstance, id: string, chave?: string) =>
  app.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(chave ? { "idempotency-key": chave } : {}), payload: {} });
const cancelar = (app: FastifyInstance, id: string, especie: "pedido" | "compra" = "compra") =>
  app.inject({ method: "POST", url: `${rota(especie)}/${id}/cancel`, headers: h.headers(), payload: {} });
async function confirmada(app: FastifyInstance, id: string) {
  const r = await confirmar(app, id);
  expect(r.statusCode, r.body).toBe(200);
  return r;
}

/** Tudo o que a confirmação materializa ou o cancelamento estorna — contado no banco. */
async function efeitos(id: string) {
  const doc = (await admin.query<{ situacao: string; codigo: string; valor_total: string; especie: string }>(
    "select situacao, codigo, valor_total::text, especie from erp.documentos_compra where id=$1", [id])).rows[0]!;
  const mov = (await admin.query<{ movement_type: string; direction: number; quantity: string; unit_cost: string; total_cost: string; product_id: string; warehouse_id: string; provider_lot: string | null; expiration_date: string | null; movement_date: string }>(
    `select movement_type, direction, quantity::text, unit_cost::text, total_cost::text, product_id, warehouse_id, provider_lot,
            to_char(expiration_date,'YYYY-MM-DD') as expiration_date, to_char(movement_date,'YYYY-MM-DD') as movement_date
       from erp.stock_movements where source_type='documentos_compra' and source_id=$1 order by created_at, id`, [id])).rows;
  const tit = (await admin.query<{ id: string; status: string; direction: string; amount: string; due_date: string; number: string; person_id: string; installment_number: number }>(
    `select id, status, direction, amount::text, to_char(due_date,'YYYY-MM-DD') as due_date, number, person_id, installment_number
       from erp.financial_titles where source_type='documentos_compra' and source_id=$1 order by installment_number, created_at`, [id])).rows;
  return {
    situacao: doc.situacao, codigo: doc.codigo, valorTotal: doc.valor_total, especie: doc.especie,
    entradas: mov.filter((m) => m.movement_type === "receipt"),
    estornos: mov.filter((m) => m.movement_type === "reversal").length,
    titulos: tit,
    titulosAtivos: tit.filter((t) => t.status !== "cancelled").length,
  };
}
const saldo = async (armazem: string | undefined, produtoId: string) =>
  (await admin.query<{ q: string }>("select coalesce(sum(quantity),0)::text as q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [armazem, produtoId])).rows[0]!.q;

/** O campo apontado pelo 422: `details` (lista {path} ou objeto {campo}) tem de nomeá-lo. */
function campoDoErro(r: Resposta): string {
  const e = j(r).error; return JSON.stringify(e?.details ?? null) + " " + (e?.message ?? "");
}

// ---------------------------------------------------------------------------------------------------------
// CO-1 — lançar com a TOP da família certa
// ---------------------------------------------------------------------------------------------------------
describe("CO-1 — lançar Compra e Pedido de compra com a TOP da família certa", () => {
  it("CO-1a compra e pedido → 201, versão congelada, código por espécie e ID Global; TOP de outra família → 422", async () => {
    const topCompra = await top(COMPRA); const topPedido = await top(PEDIDO); const topVenda = await top("vendas.venda");
    const p = await produto();
    const antes = Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);

    const compra = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "10.00" }], { numero_nota: `N${unico()}` });
    const pedido = await lancada("pedido", topPedido, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "10.00" }]);

    const linhas = (await admin.query<{ id: string; especie: string; situacao: string; codigo: string; tipo_operacao_id: string; tipo_operacao_versao_id: string; valor_total: string }>(
      "select id, especie, situacao, codigo, tipo_operacao_id, tipo_operacao_versao_id, valor_total::text from erp.documentos_compra where id = any($1) order by especie", [[compra, pedido]])).rows;
    expect(linhas.map((l) => [l.especie, l.situacao])).toEqual([["compra", "aberto"], ["pedido", "aberto"]]);
    expect(Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n)).toBe(antes + 2);
    for (const [l, topId] of [[linhas[0]!, topCompra], [linhas[1]!, topPedido]] as const) {
      const vAtual = (await admin.query<{ id: string }>("select v.id from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id=t.id and v.versao=t.versao_atual where t.id=$1", [topId])).rows[0]!.id;
      expect([l.tipo_operacao_id, l.tipo_operacao_versao_id], "a versão atual da TOP fica congelada").toEqual([topId, vAtual]);
      expect(l.codigo, "número do documento").toMatch(/\S/);
      expect(l.valor_total).toBe("20.00");
      const gid = (await admin.query<{ id_global: string }>("select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade='documentos_compra' and id_entidade=$2", [h.demo.orgId, l.id])).rows;
      expect(gid.length, "ID Global alocado").toBe(1);
    }
    // A leitura devolve a TOP congelada.
    const lida = await h.app.inject({ method: "GET", url: `/api/compras/compras/${compra}`, headers: h.headers() });
    expect(lida.statusCode, lida.body).toBe(200);
    expect(j(lida)).toMatchObject({ id: compra, especie: "compra", situacao: "aberto", tipo_operacao: { id: topCompra, codigoBase: COMPRA } });
    expect((j(lida).itens as unknown[]).length).toBe(1);

    // TOP de outra família: a da venda, a do pedido na compra e a da compra no pedido.
    for (const [especie, topId] of [["compra", topVenda], ["compra", topPedido], ["pedido", topCompra]] as const) {
      const r = await lancar(especie, topId, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }]);
      expect(r.statusCode, `${especie} com TOP de outra família: ${r.body}`).toBe(422);
      expect(campoDoErro(r)).toMatch(/tipo_operacao_id|tipo de operação/i);
    }
    expect(Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n), "as recusas não gravaram nada").toBe(antes + 2);
  });

  it("CO-1b a mesma Idempotency-Key devolve o mesmo documento (um só no banco)", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const corpo = [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "5.00" }];
    const r1 = await lancar("compra", topCompra, corpo, {}, h.headers({ "idempotency-key": `co1b-${unico()}` }));
    const chave = `co1b-${unico()}`;
    const a = await lancar("compra", topCompra, corpo, {}, h.headers({ "idempotency-key": chave }));
    const b = await lancar("compra", topCompra, corpo, {}, h.headers({ "idempotency-key": chave }));
    expect([r1.statusCode, a.statusCode, b.statusCode]).toEqual([201, 201, 201]);
    expect(j(b).id).toBe(j(a).id);
    expect(j(r1).id).not.toBe(j(a).id);
  });

  it("CO-1c contrato estrito: chave desconhecida → 422; pedido com lote/validade/nota → 422", async () => {
    const topCompra = await top(COMPRA); const topPedido = await top(PEDIDO); const p = await produto();
    const item = { produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "5.00" };
    expect((await lancar("compra", topCompra, [item], { campo_inventado: 1 })).statusCode).toBe(422);
    for (const extra of [{ numero_nota: "1" }, { serie_nota: "1" }]) expect((await lancar("pedido", topPedido, [item], extra)).statusCode, JSON.stringify(extra)).toBe(422);
    expect((await lancar("pedido", topPedido, [{ ...item, lote: "L1" }])).statusCode).toBe(422);
    expect((await lancar("pedido", topPedido, [{ ...item, validade: "2027-01-01" }])).statusCode).toBe(422);
    // premissa: o mesmo pedido sem esses campos é aceito
    expect((await lancar("pedido", topPedido, [item])).statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-2 — recusas no lançamento, no campo
// ---------------------------------------------------------------------------------------------------------
describe("CO-2 — recusas no lançamento → 422 no campo; serviço sem armazém salva", () => {
  it("CO-2 não fornecedor · natureza de receita · armazém de outra empresa · produto com lote sem lote", async () => {
    const topCompra = await top(COMPRA);
    const p = await produto(); const comLote = await produto({ lote: "lote" }); const comValidade = await produto({ lote: "lote_validade" });
    const naoFornecedor = (await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 and not is_provider order by code limit 1", [h.demo.orgId])).rows[0]!.id;
    const item = { produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "5.00" };
    const antes = Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);

    const casos: [string, Promise<Resposta>, string][] = [
      ["pessoa que não é fornecedor", lancar("compra", topCompra, [item], { fornecedor_id: naoFornecedor }), "fornecedor_id"],
      ["natureza de receita", lancar("compra", topCompra, [item], { categoria_financeira_id: I.incomeCategory }), "categoria_financeira_id"],
      ["armazém de outra empresa", lancar("compra", topCompra, [{ ...item, armazem_id: I.warehouseEmpresa2 }]), "armazem_id"],
      ["produto com lote sem lote", lancar("compra", topCompra, [{ ...item, produto_id: comLote.id }]), "lote"],
      ["produto com lote e validade sem validade", lancar("compra", topCompra, [{ ...item, produto_id: comValidade.id, lote: "LV1" }]), "validade"],
    ];
    for (const [nome, prom, campo] of casos) {
      const r = await prom;
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(campoDoErro(r), `${nome}: o 422 aponta o campo`).toContain(campo);
    }
    expect(Number((await admin.query<{ n: string }>("select count(*) as n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n), "nenhuma recusa gravou").toBe(antes);

    // PREMISSAS: cada um, corrigido, salva.
    expect((await lancar("compra", topCompra, [{ ...item, produto_id: comLote.id, lote: "L-CO2" }])).statusCode).toBe(201);
    expect((await lancar("compra", topCompra, [{ ...item, produto_id: comValidade.id, lote: "LV-CO2", validade: "2027-12-31" }])).statusCode).toBe(201);
    expect((await lancar("compra", topCompra, [item])).statusCode).toBe(201);
  });

  it("CO-2b serviço (sem controle de estoque) sem armazém salva — e, confirmado, não entra no estoque", async () => {
    const topCompra = await top(COMPRA); const s = await produto({ controla: false }); const p = await produto();
    const id = await lancada("compra", topCompra, [
      { produto_id: s.id, quantidade: "1", valor_unitario: "40.00" },
      { produto_id: p.id, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "30.00" },
    ]);
    await confirmada(h.app, id);
    const e = await efeitos(id);
    expect(e.entradas.map((m) => m.product_id), "só o produto que controla estoque entra").toEqual([p.id]);
    expect(e.titulos.reduce((a, t) => a + Number(t.amount), 0), "o título cobre os dois itens").toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-3 — confirmar com a TOP padrão
// ---------------------------------------------------------------------------------------------------------
describe("CO-3 — confirmar com TOP padrão: entrada com custo rateado e títulos a pagar nas parcelas", () => {
  it("CO-3 frete, outras e desconto entram no custo; centavo no último; 2 parcelas; a prévia mostra exatamente isso", async () => {
    const topCompra = await top(COMPRA);
    const a = await produto(); const b = await produto();
    const cond = await condicao(2, 30, 30);
    const nota = `N${unico()}`;
    // itens: A 10 × 10,00 = 100,00 · B 4 × 12,50 = 50,00 → 150,00; + frete 15 + outras 5 − desconto 10 = 160,00.
    // Rateio pelo total do item, cada parte arredondada PARA BAIXO no centavo e o que sobra no último:
    // A 100/150 × 160 = 106,666… → 106,66 · B (último) = 160 − 106,66 = 53,34.
    const id = await lancada("compra", topCompra, [
      { produto_id: a.id, armazem_id: I.warehouse, quantidade: "10", valor_unitario: "10.00" },
      { produto_id: b.id, armazem_id: I.warehouse, quantidade: "4", valor_unitario: "12.50" },
    ], { frete: "15.00", outras_despesas: "5.00", desconto: "10.00", condicao_pagamento_id: cond, numero_nota: nota, serie_nota: "1", data_entrada: "2026-09-12" });
    expect((await efeitos(id)).valorTotal, "total calculado no servidor").toBe("160.00");
    expect([await saldo(I.warehouse, a.id), await saldo(I.warehouse, b.id)], "premissa: produtos novos, sem saldo").toEqual(["0", "0"]);

    const previa = await h.app.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers: h.headers() });
    expect(previa.statusCode, previa.body).toBe(200);
    expect(await efeitos(id), "a prévia não produz efeito").toMatchObject({ situacao: "aberto", entradas: [], titulos: [] });

    await confirmada(h.app, id);
    const e = await efeitos(id);
    expect(e.situacao).toBe("confirmado");
    const porProduto = (pid: string) => e.entradas.filter((m) => m.product_id === pid);
    expect(e.entradas.length).toBe(2);
    expect(porProduto(a.id).map((m) => [m.direction, m.quantity, m.total_cost, m.movement_date, Number(m.unit_cost)])).toEqual([[1, "10.0000", "106.66", "2026-09-12", 10.666]]);
    expect(porProduto(b.id).map((m) => [m.direction, m.quantity, m.total_cost, m.movement_date, Number(m.unit_cost)])).toEqual([[1, "4.0000", "53.34", "2026-09-12", 13.335]]);
    expect(e.entradas.reduce((x, m) => x + Math.round(Number(m.total_cost) * 100), 0), "as entradas fecham com o total do documento").toBe(16000);
    expect([await saldo(I.warehouse, a.id), await saldo(I.warehouse, b.id)]).toEqual(["10.0000", "4.0000"]);
    const custoMedio = (await admin.query<{ c: string }>("select average_cost::text as c from erp.stock_balances where warehouse_id=$1 and product_id=$2", [I.warehouse, a.id])).rows[0]!.c;
    expect(Number(custoMedio), "o saldo carrega o custo rateado").toBe(10.666);
    const compra = (await admin.query<{ d: string | null }>("select to_char(last_purchase_date,'YYYY-MM-DD') as d from erp.products where id=$1", [a.id])).rows[0]!.d;
    expect(compra, "última compra do produto").toBe("2026-09-12");

    expect(e.titulos.map((t) => [t.direction, t.status, t.amount, t.person_id, t.number, t.installment_number])).toEqual([
      // número = o da nota; com parcelas, o createTitles de sempre acrescenta "-<parcela>".
      ["payable", "open", "80.00", I.provider, `${nota}-1`, 1],
      ["payable", "open", "80.00", I.provider, `${nota}-2`, 2],
    ]);
    expect(e.titulos[0]!.due_date < e.titulos[1]!.due_date, "vencimentos em sequência").toBe(true);
    const rateio = (await admin.query<{ financial_category_id: string; cost_center_id: string; percentage: string }>(
      "select financial_category_id, cost_center_id, percentage::text from erp.title_apportionments where title_id=$1", [e.titulos[0]!.id])).rows;
    expect(rateio).toEqual([{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100.0000" }]);

    // A PRÉVIA mostrou exatamente isso: os mesmos valores de entrada, custos, parcelas e vencimentos.
    const texto = previa.body;
    for (const v of ["106.66", "53.34", "80.00", e.titulos[0]!.due_date, e.titulos[1]!.due_date]) expect(texto, `a prévia mostra ${v}`).toContain(v);
    expect(texto).toMatch(/10\.666/);
    expect(texto).toMatch(/13\.335/);
  });

  it("CO-3b sem nota, o título é \"CMP-<código>\"; confirmar de novo não duplica", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "7.00" }]);
    await confirmada(h.app, id);
    const e = await efeitos(id);
    expect(e.titulos.map((t) => t.number)).toEqual([`CMP-${e.codigo}`]);
    const de_novo = await confirmar(h.app, id);
    expect(de_novo.statusCode).toBeGreaterThanOrEqual(400);
    const f = await efeitos(id);
    expect([f.entradas.length, f.titulos.length]).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-4 — TOP configurada
// ---------------------------------------------------------------------------------------------------------
describe("CO-4 — TOP configurada: o que a versão diz é o que acontece", () => {
  const caso = async (estoque: Eixo, financeiro: Eixo) => {
    const topId = await top(COMPRA, execucao(estoque, financeiro));
    const p = await produto();
    const id = await lancada("compra", topId, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "3", valor_unitario: "10.00" }]);
    await confirmada(ligada, id);
    return { e: await efeitos(id), p };
  };
  it("CO-4a só estoque (Entrada + Não gera): uma entrada, zero título", async () => {
    const { e, p } = await caso("efeito", "nenhum");
    expect([e.situacao, e.entradas.length, e.titulos.length]).toEqual(["confirmado", 1, 0]);
    expect(await saldo(I.warehouse, p.id)).toBe("3.0000");
  });
  it("CO-4b só financeiro (Não movimenta + A pagar): zero entrada, um título a pagar", async () => {
    const { e, p } = await caso("nenhum", "efeito");
    expect([e.situacao, e.entradas.length, e.titulos.length]).toEqual(["confirmado", 0, 1]);
    expect([e.titulos[0]!.direction, e.titulos[0]!.amount]).toEqual(["payable", "30.00"]);
    expect(await saldo(I.warehouse, p.id)).toBe("0");
  });
  it("CO-4c exigeArmazem recusa item sem armazém com ZERO efeito; com armazém, confirma", async () => {
    const topId = await top(COMPRA, execucao("efeito", "efeito", (c) => { c.estoque.exigeArmazem = true; }));
    const p = await produto();
    const id = await lancada("compra", topId, [
      { produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" },
      { produto_id: p.id, armazem_id: null, quantidade: "1", valor_unitario: "10.00" },
    ]);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(await efeitos(id)).toMatchObject({ situacao: "aberto", entradas: [], titulos: [] });
    const certa = await lancada("compra", topId, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" }]);
    await confirmada(ligada, certa);
    expect((await efeitos(certa)).entradas.length).toBe(1);
  });
  it("CO-4d TOP configurada com o gate DESLIGADO: 409 e ZERO efeito (nunca cai no padrão)", async () => {
    const topId = await top(COMPRA, execucao("efeito", "nenhum"));
    const p = await produto();
    const id = await lancada("compra", topId, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" }]);
    const r = await confirmar(h.app, id);
    expect(r.statusCode, r.body).toBe(409);
    expect(await efeitos(id)).toMatchObject({ situacao: "aberto", entradas: [], titulos: [] });
  });
  it("CO-4e \"Cliente em atraso\" ≠ não valida numa TOP de compra → 422 no campo", async () => {
    const alvo = configuracaoNeutraTopV3();
    alvo.financeiro.clienteEmAtraso = "bloqueia";
    for (const familia of [COMPRA, PEDIDO]) {
      const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
        payload: { codigo: `8${String(++seq).padStart(4, "0")}`, codigoBase: familia, nome: "TOP com atraso", configuracao: alvo } });
      expect(r.statusCode, `${familia}: ${r.body}`).toBe(422);
      expect(campoDoErro(r)).toContain("clienteEmAtraso");
    }
    // premissa: a mesma configuração numa TOP de venda é aceita
    await top("vendas.venda", alvo);
  });
});
// ---------------------------------------------------------------------------------------------------------
// CO-5 — cancelar
// ---------------------------------------------------------------------------------------------------------
describe("CO-5 — cancelar: aberto; confirmada com estorno; título baixado → 409; estoque consumido → 409", () => {
  it("CO-5a cancelar ABERTO: sem efeito de estoque nem título; pedido também", async () => {
    const topCompra = await top(COMPRA); const topPedido = await top(PEDIDO); const p = await produto();
    const compra = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }]);
    const pedido = await lancada("pedido", topPedido, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }]);
    expect((await cancelar(h.app, compra)).statusCode).toBe(200);
    expect((await cancelar(h.app, pedido, "pedido")).statusCode).toBe(200);
    expect(await efeitos(compra)).toMatchObject({ situacao: "cancelado", entradas: [], titulos: [], estornos: 0 });
    expect((await efeitos(pedido)).situacao).toBe("cancelado");
  });

  it("CO-5b cancelar CONFIRMADA: estorno do estoque e títulos cancelados", async () => {
    const topCompra = await top(COMPRA); const p = await produto(); const cond = await condicao(2);
    const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "5", valor_unitario: "8.00" }], { condicao_pagamento_id: cond });
    await confirmada(h.app, id);
    const antes = await efeitos(id);
    expect([antes.entradas.length, antes.titulosAtivos, await saldo(I.warehouse, p.id)], "premissa: confirmada").toEqual([1, 2, "5.0000"]);
    const r = await cancelar(h.app, id);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect([e.situacao, e.estornos, e.titulosAtivos, e.titulos.length]).toEqual(["cancelado", 1, 0, 2]);
    expect(await saldo(I.warehouse, p.id)).toBe("0.0000");
  });

  it("CO-5c título com baixa → 409 \"cancele as baixas antes\" e ZERO efeito; desfeita a baixa, cancela", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "25.00" }]);
    await confirmada(h.app, id);
    const titulo = (await efeitos(id)).titulos[0]!;
    const baixa = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titulo.id}/settle`, headers: h.headers(),
      payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "10.00" } });
    expect(baixa.statusCode, `premissa: a baixa parcial é gravada — ${baixa.body}`).toBe(201);
    const r = await cancelar(h.app, id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.message).toMatch(/cancele as baixas antes/i);
    expect(await efeitos(id)).toMatchObject({ situacao: "confirmado", estornos: 0, titulosAtivos: 1 });
    expect(await saldo(I.warehouse, p.id)).toBe("2.0000");
    const sid = (j(baixa) as { settlement_id: string }).settlement_id;
    const desfaz = await h.app.inject({ method: "POST", url: `/api/financial/payables/${titulo.id}/settlements/${sid}/cancel`, headers: h.headers(), payload: { reason: "teste CO-5c" } });
    expect(desfaz.statusCode, desfaz.body).toBe(200);
    expect((await cancelar(h.app, id)).statusCode).toBe(200);
    expect((await efeitos(id)).situacao).toBe("cancelado");
  });

  it("CO-5d estoque já consumido → 409 dizendo produto e armazém (nunca 500), ZERO efeito", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "3", valor_unitario: "4.00" }]);
    await confirmada(h.app, id);
    const w = await h.app.inject({ method: "POST", url: "/api/stock/writeoffs", headers: h.headers(),
      payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date: "2026-09-13", reason: "consumption", justification: "consumo CO-5d", items: [{ product_id: p.id, quantity: "2" }] } });
    expect(w.statusCode, `premissa: 2 das 3 unidades consumidas — ${w.body}`).toBe(201);
    expect(await saldo(I.warehouse, p.id)).toBe("1.0000");
    const r = await cancelar(h.app, id);
    expect(r.statusCode, r.body).toBe(409);
    const armazem = (await admin.query<{ description: string }>("select description from erp.warehouses where id=$1", [I.warehouse])).rows[0]!.description;
    expect(j(r).error!.message).toContain(p.nome);
    expect(j(r).error!.message).toContain(armazem);
    expect(await efeitos(id)).toMatchObject({ situacao: "confirmado", estornos: 0, titulosAtivos: 1 });
    expect(await saldo(I.warehouse, p.id)).toBe("1.0000");
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-6 — concorrência
// ---------------------------------------------------------------------------------------------------------
describe("CO-6 — duas confirmações simultâneas", () => {
  it("CO-6 uma entrada e um conjunto de títulos (sem chave e com chaves diferentes)", async () => {
    const topCompra = await top(COMPRA); const cond = await condicao(3);
    for (const chaves of [[undefined, undefined], [`co6-${unico()}`, `co6-${unico()}`]] as const) {
      const p = await produto();
      const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "6", valor_unitario: "5.00" }], { condicao_pagamento_id: cond });
      const rs = await Promise.all([confirmar(h.app, id, chaves[0]), confirmar(ligada, id, chaves[1])]);
      expect(rs.map((r) => r.statusCode).sort(), rs.map((r) => r.body).join(" | ")).toEqual([200, 409]);
      const e = await efeitos(id);
      expect([e.situacao, e.entradas.length, e.titulos.length]).toEqual(["confirmado", 1, 3]);
      expect(await saldo(I.warehouse, p.id)).toBe("6.0000");
    }
  });
  it("CO-6b a MESMA chave duas vezes: um conjunto de efeitos e a mesma resposta", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const id = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "5.00" }]);
    const chave = `co6b-${unico()}`;
    const a = await confirmar(h.app, id, chave); const b = await confirmar(h.app, id, chave);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.json()).toEqual(a.json());
    const e = await efeitos(id);
    expect([e.entradas.length, e.titulos.length]).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-7 — lista única e superfície de recusa
// ---------------------------------------------------------------------------------------------------------
async function membro(nome: string, perms: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@co01.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Compra@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Compra@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
type Linha = { id: string; especie: string };
const listar = (headers: Hdr, q = "") => h.app.inject({ method: "GET", url: `/api/compras/documentos?pageSize=200${q}`, headers });
const linhas = (r: Resposta) => { const b = j(r) as { data?: Linha[]; rows?: Linha[]; items?: Linha[] }; return (b.data ?? b.rows ?? b.items ?? []) as Linha[]; };

describe("CO-7 — lista única: recorte por capacidade, 403 sem capacidade, 404 de outra organização", () => {
  it("CO-7 só pedidos_compra.view → só pedidos; nenhuma capacidade → 403; outra organização → 404", async () => {
    const topCompra = await top(COMPRA); const topPedido = await top(PEDIDO); const p = await produto();
    const item = [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }];
    const compra = await lancada("compra", topCompra, item); const pedido = await lancada("pedido", topPedido, item);

    // PREMISSA: o administrador vê as duas espécies, inclusive os dois documentos deste cenário.
    const tudo = await listar(h.headers());
    expect(tudo.statusCode, tudo.body).toBe(200);
    const ids = linhas(tudo).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([compra, pedido]));
    expect(new Set(linhas(tudo).map((l) => l.especie))).toEqual(new Set(["pedido", "compra"]));

    const soPedidos = await membro("So Pedidos", ["pedidos_compra.view"]);
    const r = await listar(soPedidos);
    expect(r.statusCode, r.body).toBe(200);
    const vistos = linhas(r);
    expect(vistos.length, "premissa: há pedidos para ver").toBeGreaterThan(0);
    expect(vistos.map((l) => l.id)).toContain(pedido);
    expect(vistos.every((l) => l.especie === "pedido"), "nenhuma compra vaza").toBe(true);
    // O filtro de espécie só intersecta: pedir compras não amplia.
    const pedeCompras = await listar(soPedidos, "&especie=compra");
    expect([200, 403]).toContain(pedeCompras.statusCode);
    if (pedeCompras.statusCode === 200) expect(linhas(pedeCompras).filter((l) => l.especie === "compra")).toEqual([]);
    // A leitura direta da compra por quem só vê pedidos também não sai.
    expect((await h.app.inject({ method: "GET", url: `/api/compras/compras/${compra}`, headers: soPedidos })).statusCode).toBe(403);

    const nenhuma = await membro("Sem Compras", ["stocks.view"]);
    expect((await listar(nenhuma)).statusCode).toBe(403);

    // OUTRA ORGANIZAÇÃO: uma compra real dela, lida pelo administrador desta → a MESMA 404 de um id inexistente.
    const demoB = await seedDemo(admin, { slug: `co01b${unico()}`, orgName: "[TEST] Org CO-7", adminEmail: `admin-b-${unico()}@co01.local`, adminPassword: "Compra@12345" }, () => {});
    const lb = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: demoB.adminEmail, password: demoB.adminPassword } });
    expect(lb.statusCode, lb.body).toBe(200);
    const hB = { authorization: `Bearer ${(lb.json() as { token: string }).token}`, "x-org-id": demoB.orgId };
    const um = async (sql: string) => (await admin.query<{ id: string }>(sql, [demoB.orgId])).rows[0]!.id;
    const topB = await top(COMPRA, undefined, hB);
    const rB = await h.app.inject({ method: "POST", url: "/api/compras/compras", headers: hB, payload: {
      empresa_id: demoB.empresaIds[0], tipo_operacao_id: topB, data_documento: DATA,
      fornecedor_id: await um("select id from erp.people where organization_id=$1 and is_provider order by code limit 1"),
      categoria_financeira_id: await um("select id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' order by code limit 1"),
      centro_custo_id: await um("select id from erp.cost_centers where organization_id=$1 and kind='analytic' order by code limit 1"),
      itens: [{ produto_id: await um("select id from erp.products where organization_id=$1 and description like 'Ração%'"), quantidade: "1", valor_unitario: "1.00" }] } });
    expect(rB.statusCode, `premissa: a compra da outra organização existe — ${rB.body}`).toBe(201);
    const idB = (j(rB) as { id: string }).id;
    expect((await h.app.inject({ method: "GET", url: `/api/compras/compras/${idB}`, headers: hB })).statusCode, "premissa: o dono lê").toBe(200);
    const deFora = await h.app.inject({ method: "GET", url: `/api/compras/compras/${idB}`, headers: h.headers() });
    const inexistente = await h.app.inject({ method: "GET", url: "/api/compras/compras/00000000-0000-4000-8000-000000000000", headers: h.headers() });
    expect(deFora.statusCode).toBe(404);
    expect([deFora.statusCode, j(deFora).error?.code, j(deFora).error?.message]).toEqual([inexistente.statusCode, j(inexistente).error?.code, j(inexistente).error?.message]);
    expect(linhas(await listar(h.headers())).map((l) => l.id)).not.toContain(idB);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CO-8 — nota duplicada nos dois caminhos
// ---------------------------------------------------------------------------------------------------------
describe("CO-8 — nota duplicada → 409 DUPLICATE_DOCUMENT dizendo onde está", () => {
  const nf = (numero: string, serie = "1", extra: Record<string, unknown> = {}) => h.app.inject({ method: "POST", url: "/api/stock/invoices", headers: h.headers(),
    payload: { empresa_id: I.empresa, number: numero, series: serie, provider_id: I.provider, emission_date: DATA,
      items: [{ product_id: I.product2, quantity: "1", unit_value: "3", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }], ...extra } });

  it("CO-8a Compra × Compra (série vazia = \"1\"); cancelada libera", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const numero = `C${unico()}`;
    const item = [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }];
    const primeira = await lancada("compra", topCompra, item, { numero_nota: numero, serie_nota: "" });
    const codigo = (await efeitos(primeira)).codigo;
    const r = await lancar("compra", topCompra, item, { numero_nota: numero, serie_nota: "1" });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(r).error!.message).toContain(`Compra ${codigo}`);
    // premissa: outra série, ou outro fornecedor, é outra nota
    expect((await lancar("compra", topCompra, item, { numero_nota: numero, serie_nota: "2" })).statusCode).toBe(201);
    expect((await cancelar(h.app, primeira)).statusCode).toBe(200);
    expect((await lancar("compra", topCompra, item, { numero_nota: numero, serie_nota: "1" })).statusCode, "cancelada não ocupa a nota").toBe(201);
  });

  it("CO-8b Compra × Documento fiscal de Estoque", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const numero = `F${unico()}`;
    const n = await nf(numero);
    expect(n.statusCode, `premissa: o Documento fiscal entra — ${n.body}`).toBe(201);
    const cod = (await admin.query<{ code: string }>("select code from erp.invoices where organization_id=$1 and number=$2", [h.demo.orgId, numero])).rows[0]?.code;
    const r = await lancar("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }], { numero_nota: numero, serie_nota: "1" });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(r).error!.message).toContain("Documento fiscal de Estoque");
    if (cod) expect(j(r).error!.message).toContain(cod);
  });

  it("CO-8c Documento fiscal de Estoque × Compra (e nenhum movimento do Documento fiscal)", async () => {
    const topCompra = await top(COMPRA); const p = await produto();
    const numero = `G${unico()}`;
    const compra = await lancada("compra", topCompra, [{ produto_id: p.id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "1.00" }], { numero_nota: numero });
    const codigo = (await efeitos(compra)).codigo;
    const antes = (await admin.query<{ n: string }>("select count(*) as n from erp.invoices where organization_id=$1", [h.demo.orgId])).rows[0]!.n;
    const r = await nf(numero);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(r).error!.message).toContain(`Compra ${codigo}`);
    expect((await admin.query<{ n: string }>("select count(*) as n from erp.invoices where organization_id=$1", [h.demo.orgId])).rows[0]!.n).toBe(antes);
    // premissa: outra nota entra
    expect((await nf(`${numero}X`)).statusCode).toBe(201);
  });
});
