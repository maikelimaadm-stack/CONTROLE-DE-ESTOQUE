import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import {
  configuracaoNeutraTopV3, configuracaoTopParaEdicao, CAPACIDADE_CONDICAO_PAGAMENTO, CAPACIDADE_LAYOUT_DOCUMENTO,
  CAPACIDADE_REGRAS_DA_OPERACAO, type ConfiguracaoTipoOperacaoV3,
} from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-05 (decisão 263) — A4: CONVERSÃO conferida contra a TOP DESTINO e `/regras-da-operacao`.
 *
 * Versões do formato 3 são montadas por SQL (superusuário de teste): esta suíte prova a ROTA DE VENDAS, não o
 * editor. Toda recusa vem com a PREMISSA ao lado (o mesmo cenário, com o que falta, converte) e com a contagem
 * de documentos ANTES/DEPOIS (nada gravado, fonte continua aberta).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let transportadora: string;
beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  transportadora = await comPool(async (c) => (await c.query<{ id: string }>(
    "select id from erp.people where organization_id=$1 order by is_transporter desc, code limit 1", [h.demo.orgId])).rows[0]!.id);
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

let seq = 0;
async function criarTop(kind: keyof typeof FAMILIA): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `35${String(++seq).padStart(2, "0")}`, codigoBase: FAMILIA[kind], nome: `TOP A4 ${seq}` } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/** Grava uma versão NOVA (atual) da TOP com a configuração dada, no formato dado, e as condições permitidas. */
async function versaoNova(topId: string, configuracao: unknown, formato: 2 | 3, condicoes: string[] = []): Promise<string> {
  return comPool(async (c) => {
    const v = (await c.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, $2::jsonb, $3
         from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
        where t.id = $1 returning id`, [topId, JSON.stringify(configuracao), formato])).rows[0]!.id;
    expect((await c.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [topId])).rowCount).toBe(1);
    for (const cond of condicoes) {
      await c.query("insert into erp.tipos_operacao_versao_condicoes (organization_id, origem_versao_id, origem_tipo_operacao_id, condicao_pagamento_id) values ($1,$2,$3,$4)",
        [h.demo.orgId, v, topId, cond]);
    }
    return v;
  });
}
function v3(mut: (c: ConfiguracaoTipoOperacaoV3) => void = () => {}): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3(); mut(c); return c;
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return comPool(async (c) => (await c.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,2,30,'intervalo',30,false) returning id",
    [h.demo.orgId, `A4-${n}`, `Condição A4 ${n}`])).rows[0]!.id);
}

const ITEM = () => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "50.00" });
async function pedido(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/sales/orders", headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM()], ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const converter = (id: string, topVenda: string) => h.app.inject({ method: "POST", url: `/api/sales/orders/${id}/convert`, headers: h.headers(),
  payload: { tipo_operacao_id: topVenda } });
const contagem = () => comPool(async (c) => Number((await c.query<{ n: string }>(
  "select count(*)::text as n from erp.sales_documents where organization_id=$1", [h.demo.orgId])).rows[0]!.n));
const statusDe = (id: string) => comPool(async (c) => (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status);

/** A recusa não grava NADA: nenhum documento novo, fonte continua `open`. */
async function recusaSemEfeito(id: string, topVenda: string): Promise<Erro> {
  const antes = await contagem();
  const r = await converter(id, topVenda);
  expect(r.statusCode, r.body).toBe(422);
  expect(await contagem()).toBe(antes);
  expect(await statusDe(id)).toBe("open");
  return j(r).error!;
}

describe("TR-A5 — conversão conferida contra a versão ATUAL da TOP destino (formato 3)", () => {
  it("TR-A5 exigência: TOP de venda v3 exige transportadora; pedido sem transportadora NÃO converte (nada gravado); com ela converte", async () => {
    const topVenda = await criarTop("sale");
    await versaoNova(topVenda, v3((c) => { c.geral.exigeTransportadora = true; }), 3);
    const semTransp = await pedido();
    const e = await recusaSemEfeito(semTransp, topVenda);
    expect(e.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(e.details).toEqual({ exigencias: [{ caminho: "transporter_id", mensagem: "Transportadora é obrigatório nesta operação." }] });
    // PREMISSA: o mesmo pedido COM transportadora converte pela mesma TOP.
    const comTransp = await pedido({ transporter_id: transportadora });
    const r = await converter(comTransp, topVenda);
    expect(r.statusCode, r.body).toBe(201);
    expect(await statusDe(comTransp)).toBe("converted");
  });

  it("TR-A5 condição: a condição do pedido não permitida pela TOP de venda → 422 CONDICAO_PAGAMENTO_NAO_PERMITIDA; a permitida converte", async () => {
    const [condPedido, condPermitida] = [await condicao(), await condicao()];
    const topVenda = await criarTop("sale");
    await versaoNova(topVenda, v3(), 3, [condPermitida]);
    const fora = await pedido({ condicao_pagamento_id: condPedido });
    const e = await recusaSemEfeito(fora, topVenda);
    expect(e.code).toBe("CONDICAO_PAGAMENTO_NAO_PERMITIDA");
    expect(e.details).toEqual({ campo: "condicao_pagamento_id" });
    const dentro = await pedido({ condicao_pagamento_id: condPermitida });
    const r = await converter(dentro, topVenda);
    expect(r.statusCode, r.body).toBe(201);
  });

  it("TR-A5 destino formato 2 converte COMO HOJE (a exigência v2 não executa) — alvo da reversa do formato", async () => {
    const topVenda = await criarTop("sale");
    const cfg2 = configuracaoTopParaEdicao(configuracaoNeutraTopV3());
    cfg2.geral.exigeObservacao = true;
    await versaoNova(topVenda, cfg2, 2);
    const semNota = await pedido();
    const r = await converter(semNota, topVenda);
    expect(r.statusCode, r.body).toBe(201);
    expect(await statusDe(semNota)).toBe("converted");
  });

  it("TR-A5 destino formato 3 com a MESMA exigência de observação recusa (a reversa do caso anterior)", async () => {
    const topVenda = await criarTop("sale");
    await versaoNova(topVenda, v3((c) => { c.geral.exigeObservacao = true; }), 3);
    const e = await recusaSemEfeito(await pedido(), topVenda);
    expect(e.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
  });

  // POR ÚLTIMO: grava um título vencido do cliente de teste (afetaria as outras conversões com "bloqueia").
  it("TR-A5 atraso: cliente com título vencido e TOP de venda 'bloqueia' → 422 CLIENTE_EM_ATRASO; 'avisa' converte", async () => {
    const bloqueia = await criarTop("sale");
    await versaoNova(bloqueia, v3((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; }), 3);
    const avisa = await criarTop("sale");
    await versaoNova(avisa, v3((c) => { c.financeiro.clienteEmAtraso = "avisa"; }), 3);
    // PREMISSA: sem título vencido, "bloqueia" converte.
    const antesDoTitulo = await pedido();
    expect((await converter(antesDoTitulo, bloqueia)).statusCode).toBe(201);
    await comPool((c) => c.query(
      "insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, amount, emission_date, due_date) values ($1,$2,'TA4-1','receivable','TA4-1',$3,'123.45',current_date - 40, current_date - 30)",
      [h.demo.orgId, I.empresa, I.client]));
    const e = await recusaSemEfeito(await pedido(), bloqueia);
    expect(e.code).toBe("CLIENTE_EM_ATRASO");
    expect(e.details).toMatchObject({ campo: "client_id", total: "123.45" });
    expect((e.details as { titulos: number }).titulos).toBeGreaterThanOrEqual(1);
    const r = await converter(await pedido(), avisa);
    expect(r.statusCode, r.body).toBe(201);
  });
});

describe("TR-A6 — GET /regras-da-operacao e a capacidade nova", () => {
  const regras = (variante: string, q: string) => h.app.inject({ method: "GET", url: `/api/sales/${variante}/regras-da-operacao${q}`, headers: h.headers() });

  it("TR-A6 formato 3: exigências, condições permitidas e política de atraso da versão ATUAL", async () => {
    const cond = await condicao();
    const t = await criarTop("sale");
    await versaoNova(t, v3((c) => { c.geral.exigeTransportadora = true; c.financeiro.clienteEmAtraso = "avisa"; c.financeiro.toleranciaAtrasoDias = 5; }), 3, [cond]);
    const r = await regras("sales", `?tipo_operacao_id=${t}`);
    expect(r.statusCode, r.body).toBe(200);
    // TOP-CONFIG-07: `reservaEstoque` é aditivo e só o pedido pode ter true — na venda, sempre false.
    expect(r.json()).toEqual({ formato: 3, exigencias: ["transporter_id"], condicoesPermitidas: [cond], clienteEmAtraso: { politica: "avisa", toleranciaDias: 5 }, reservaEstoque: false });
  });

  it("TR-A6 formato 2: resposta NEUTRA (mesmo com exigência v2 ligada)", async () => {
    const t = await criarTop("sale");
    const cfg2 = configuracaoTopParaEdicao(configuracaoNeutraTopV3());
    cfg2.geral.exigeObservacao = true;
    await versaoNova(t, cfg2, 2);
    const r = await regras("sales", `?tipo_operacao_id=${t}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ formato: 2, exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 }, reservaEstoque: false });
  });

  it("TR-A6 404 idênticas: inexistente, id malformado, família errada, ausente, inativa", async () => {
    const deOrcamento = await criarTop("budget");
    const inativa = await criarTop("sale");
    await comPool((c) => c.query("update erp.tipos_operacao set ativo=false where id=$1", [inativa]));
    const corpos: string[] = [];
    for (const q of [`?tipo_operacao_id=${crypto.randomUUID()}`, "?tipo_operacao_id=nao-e-uuid", `?tipo_operacao_id=${deOrcamento}`, "", `?tipo_operacao_id=${inativa}`]) {
      const r = await regras("sales", q);
      expect(r.statusCode, `${q} → ${r.body}`).toBe(404);
      corpos.push(r.body);
    }
    expect(new Set(corpos).size).toBe(1);
    // A mesma TOP de orçamento é visível pela SUA variante (a 404 acima é família, não existência).
    expect((await regras("budgets", `?tipo_operacao_id=${deOrcamento}`)).statusCode).toBe(200);
  });

  it("TR-A6 capacidades: regrasDaOperacao por ÚLTIMO, as anteriores intactas", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/sales/sales/operation-types", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const cap = j(r).capacidades as Record<string, number>;
    expect(Object.keys(cap)).toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"]);
    expect(cap).toMatchObject({ condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO });
  });
});
