import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV2 } from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * COMPRAS-01_R1 — correções da revisão da PR #76 no lançamento e na confirmação da Compra.
 *
 * R1-1 valor zero confirma sem título (prévia = confirmação) · R1-2 salvar compra que gera título sem natureza/centro
 * ou sem as exigências da política → 422 no campo · R1-3 lote/validade só em produto que os controla · R1-4 casas
 * decimais, série sem número, `parcelas_ajustadas` derivado · R1-5 lista única: parâmetro repetido e empresa
 * selecionada · R1-6 nota numa Compra que o usuário não vê → 409 sem dizer onde.
 * Efeitos são LIDOS NO BANCO por conexão própria; status HTTP sozinho não prova nada.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } };

let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

async function top(configuracao?: unknown): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `8${String(++seq).padStart(3, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase: "compras.compra", nome: `Compra R1 ${seq}`, ...(configuracao ? { configuracao } : {}) } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
async function produto(lote: "nenhum" | "lote" | "lote_validade" = "nenhum"): Promise<string> {
  const m = (await admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [I.product2])).rows[0]!;
  const s = unico();
  return (await admin.query<{ id: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, controle_lote, has_lot)
     values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10) returning id`,
    [h.demo.orgId, `R1${s}`, `Produto R1 ${s}`, m.measurement_id, m.group_id, m.category_id, m.kind_id, m.financial_category_id, lote, lote !== "nenhum"])).rows[0]!.id;
}
const corpo = (topId: string, o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: "2026-09-10",
  categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: [{ produto_id: I.product2!, armazem_id: I.warehouse!, quantidade: "1", valor_unitario: "10" }], ...o,
});
const lancar = (payload: unknown, headers = h.headers(), app: FastifyInstance = h.app) =>
  app.inject({ method: "POST", url: "/api/compras/compras", headers, payload: payload as Record<string, unknown> });
const campo = (r: Resposta) => ((j(r).error?.details as { path: string }[] | undefined) ?? [])[0]?.path;
const contagem = async (id: string) => {
  const mov = Number((await admin.query("select count(*) n from erp.stock_movements where source_type='documentos_compra' and source_id=$1", [id])).rows[0]!.n);
  const tit = Number((await admin.query("select count(*) n from erp.financial_titles where source_type='documentos_compra' and source_id=$1", [id])).rows[0]!.n);
  return { mov, tit };
};
const documentosNoBanco = async () => Number((await admin.query("select count(*) n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);

describe("R1-1 valor zero", () => {
  it("compra de valor 0 sem natureza/centro salva e confirma: entrada, nenhum título; a prévia disse o mesmo", async () => {
    const topId = await top(); const p = await produto();
    const r = await lancar(corpo(topId, { categoria_financeira_id: null, centro_custo_id: null,
      itens: [{ produto_id: p, armazem_id: I.warehouse, quantidade: "3", valor_unitario: "0" }] }));
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    expect(j(r).valor_total).toBe("0.00");
    const pv = j(await h.app.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers: h.headers() })) as unknown as
      { podeConfirmar: boolean; recusas: unknown[]; estoque: { efeito: string; itens: { produto_id: string; custoUnitario: string }[] }; financeiro: { efeito: string; parcelas: unknown[]; valor: unknown } };
    expect(pv.podeConfirmar, JSON.stringify(pv.recusas)).toBe(true);
    expect([pv.estoque.efeito, pv.financeiro.efeito, pv.financeiro.parcelas.length, pv.financeiro.valor]).toEqual(["entrada", "nenhum", 0, null]);
    const c = await h.app.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(), payload: {} });
    expect(c.statusCode, c.body).toBe(200);
    expect(await contagem(id)).toEqual({ mov: 1, tit: 0 });
    const custo = (await admin.query<{ product_id: string; unit_cost: string }>("select product_id, unit_cost::text from erp.stock_movements where source_type='documentos_compra' and source_id=$1", [id])).rows;
    expect(pv.estoque.itens.map((i) => [i.produto_id, i.custoUnitario])).toEqual(custo.map((m) => [m.product_id, m.unit_cost]));
  });
});

describe("R1-2 salvar compra que gera título", () => {
  it("sem natureza → 422 em categoria_financeira_id; sem centro → 422 em centro_custo_id; nada gravado", async () => {
    const topId = await top();
    // a tela sabe que esta TOP gera contas a pagar (natureza/centro com "*")
    const rg = await h.app.inject({ method: "GET", url: `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${topId}`, headers: h.headers() });
    expect(rg.statusCode, rg.body).toBe(200);
    expect(j(rg).geraTitulos).toBe(true);
    const antes = await documentosNoBanco();
    for (const [o, esperado] of [[{ categoria_financeira_id: null, centro_custo_id: null }, "categoria_financeira_id"], [{ centro_custo_id: null }, "centro_custo_id"]] as const) {
      const r = await lancar(corpo(topId, o));
      expect(r.statusCode, r.body).toBe(422);
      expect(campo(r), r.body).toBe(esperado);
    }
    expect(await documentosNoBanco()).toBe(antes);
    // premissa: com a classificação, salva
    expect((await lancar(corpo(topId))).statusCode).toBe(201);
  });

  it("exigências da política (forma de pagamento, vencimento, armazém) conferidas ao salvar, 422 no campo", async () => {
    const cfg = configuracaoNeutraTopV2();
    cfg.execucao = { estoque: "configurada", financeiro: "configurada" };
    (cfg.estoque as { atualizacao: string; exigeArmazem: boolean }).atualizacao = "entrada";
    (cfg.estoque as { exigeArmazem: boolean }).exigeArmazem = true;
    (cfg.financeiro as { atualizacao: string }).atualizacao = "pagar";
    (cfg.financeiro as { exigeFormaPagamento: boolean }).exigeFormaPagamento = true;
    (cfg.financeiro as { exigeVencimento: boolean }).exigeVencimento = true;
    const topId = await top(cfg);
    const forma = (await admin.query<{ id: string }>("select id from erp.payment_methods where (organization_id=$1 or organization_id is null) and is_active order by name limit 1", [h.demo.orgId])).rows[0]!.id;
    const completo = { forma_pagamento_id: forma, data_vencimento: "2026-10-01" };
    const casos: [Record<string, unknown>, string][] = [
      [{ ...completo, forma_pagamento_id: null }, "forma_pagamento_id"],
      [{ ...completo, data_vencimento: null }, "data_vencimento"],
      [{ ...completo, itens: [{ produto_id: I.product2, armazem_id: null, quantidade: "1", valor_unitario: "10" }] }, "itens[0].armazem_id"],
    ];
    for (const [o, esperado] of casos) {
      const r = await lancar(corpo(topId, o), h.headers(), ligada);
      expect(r.statusCode, r.body).toBe(422);
      expect(campo(r), r.body).toBe(esperado);
    }
    // premissa: completo, salva e confirma
    const ok = await lancar(corpo(topId, completo), h.headers(), ligada);
    expect(ok.statusCode, ok.body).toBe(201);
    const c = await ligada.inject({ method: "POST", url: `/api/compras/compras/${j(ok).id as string}/confirm`, headers: h.headers(), payload: {} });
    expect(c.statusCode, c.body).toBe(200);
  });
});

describe("R1-3 lote e validade do item", () => {
  it("lote em produto sem controle, validade em produto só com lote → 422 no item; com controle, passa", async () => {
    const topId = await top();
    const semLote = await produto("nenhum"); const soLote = await produto("lote"); const loteValidade = await produto("lote_validade");
    const item = (produto_id: string, extra: Record<string, unknown>) => [{ produto_id, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10", ...extra }];
    const casos: [Record<string, unknown>[], string][] = [
      [item(semLote, { lote: "L1" }), "itens[0].lote"],
      [item(semLote, { validade: "2027-01-01" }), "itens[0].validade"],
      [item(soLote, { lote: "L1", validade: "2027-01-01" }), "itens[0].validade"],
    ];
    for (const [itens, esperado] of casos) {
      const r = await lancar(corpo(topId, { itens }));
      expect(r.statusCode, r.body).toBe(422);
      expect(campo(r), r.body).toBe(esperado);
    }
    expect((await lancar(corpo(topId, { itens: item(soLote, { lote: "L1" }) }))).statusCode).toBe(201);
    expect((await lancar(corpo(topId, { itens: item(loteValidade, { lote: "L1", validade: "2027-01-01" }) }))).statusCode).toBe(201);
  });
});

describe("R1-4 forma do documento", () => {
  it("quantidade com 5 casas e valor unitário com 7 → 422 no item; série sem número → 422; parcelas_ajustadas é do servidor", async () => {
    const topId = await top();
    const casos: [Record<string, unknown>, string][] = [
      [{ itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1.00001", valor_unitario: "10" }] }, "itens[0].quantidade"],
      [{ itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10" }, { produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "0.1234567" }] }, "itens[1].valor_unitario"],
      [{ serie_nota: "1" }, "serie_nota"],
      // CHECKs da 0036 (total exato, desconto_percentual ≤ 100): recusados ANTES do banco, nunca 500.
      [{ frete: "1.005" }, "frete"],
      [{ outras_despesas: "0.001" }, "outras_despesas"],
      [{ desconto: "0.125" }, "desconto"],
      [{ itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10", desconto_percentual: "100.01" }] }, "itens[0].desconto_percentual"],
    ];
    for (const [o, esperado] of casos) {
      const r = await lancar(corpo(topId, o));
      expect(r.statusCode, r.body).toBe(422);
      expect(campo(r), r.body).toBe(esperado);
    }
    // 4 e 6 casas passam, gravadas como vieram
    const ok = await lancar(corpo(topId, { itens: [{ produto_id: I.product2, armazem_id: I.warehouse, quantidade: "1.2345", valor_unitario: "0.123456" }] }));
    expect(ok.statusCode, ok.body).toBe(201);
    const it = (await admin.query<{ quantidade: string; valor_unitario: string }>("select quantidade::text, valor_unitario::text from erp.documentos_compra_itens where documento_id=$1", [j(ok).id])).rows[0]!;
    expect([it.quantidade, it.valor_unitario]).toEqual(["1.2345", "0.123456"]);
    // parcelas_ajustadas no corpo → 422 (contrato estrito); derivado: plano próprio sobre uma condição = true
    expect((await lancar(corpo(topId, { parcelas_ajustadas: true }))).statusCode).toBe(422);
    const s = unico();
    const cond = (await admin.query<{ id: string }>(
      "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,2,30,'intervalo',30,false) returning id",
      [h.demo.orgId, `R1-${s}`, `Condição R1 ${s}`])).rows[0]!.id;
    const plano = { installments: 2, first_due_date: "2026-10-15", mode: "interval", interval_days: 30 };
    const comAjuste = await lancar(corpo(topId, { condicao_pagamento_id: cond, plano_parcelas: plano }));
    const semAjuste = await lancar(corpo(topId, { condicao_pagamento_id: cond }));
    const soPlano = await lancar(corpo(topId, { plano_parcelas: plano }));
    const lido = async (r: Resposta) => (await admin.query<{ p: boolean }>("select parcelas_ajustadas p from erp.documentos_compra where id=$1", [j(r).id])).rows[0]!.p;
    expect([await lido(comAjuste), await lido(semAjuste), await lido(soPlano)]).toEqual([true, false, false]);
  });
});

describe("R1-5 lista única", () => {
  it("parâmetro repetido → 422 (nunca 500), nas duas portas", async () => {
    for (const url of ["/api/compras/documentos?especie=compra&especie=pedido", "/api/compras/compras?situacao=aberto&situacao=cancelado", "/api/compras/documentos?page=1&page=2"]) {
      const r = await h.app.inject({ method: "GET", url, headers: h.headers() });
      expect(r.statusCode, `${url}: ${r.body}`).toBe(422);
    }
  });
  it("a empresa selecionada no cabeçalho não recorta a lista única (como Vendas); a lista da espécie continua recortando", async () => {
    const topId = await top();
    const empresa2 = await lancar(corpo(topId, { empresa_id: I.empresa2, itens: [{ produto_id: I.product2, armazem_id: I.warehouseEmpresa2, quantidade: "1", valor_unitario: "10" }] }));
    expect(empresa2.statusCode, empresa2.body).toBe(201);
    const idE2 = j(empresa2).id as string;
    const ids_ = async (url: string) => ((j(await h.app.inject({ method: "GET", url, headers: h.headers({ "x-empresa-id": I.empresa }) })) as { items: { id: string }[] }).items).map((x) => x.id);
    expect(await ids_("/api/compras/documentos?pageSize=100&search=" + encodeURIComponent(j(empresa2).codigo as string))).toContain(idE2);
    expect(await ids_("/api/compras/compras?pageSize=100&search=" + encodeURIComponent(j(empresa2).codigo as string))).not.toContain(idE2);
  });
});

describe("R1-6 nota numa Compra que o usuário não vê", () => {
  it("409 DUPLICATE_DOCUMENT sem dizer onde; nada gravado", async () => {
    const topId = await top();
    const nota = `R1N${unico()}`;
    const outra = await lancar(corpo(topId, { empresa_id: I.empresa2, numero_nota: nota, itens: [{ produto_id: I.product2, armazem_id: I.warehouseEmpresa2, quantidade: "1", valor_unitario: "10" }] }));
    expect(outra.statusCode, outra.body).toBe(201);
    const email = `r1-compras-${unico()}@demo.local`;
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `R1 ${email}`, permissions: ["compras.view", "compras.create"] } });
    expect(papel.statusCode, papel.body).toBeLessThan(300);
    const u = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: email, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([I.empresa]) } });
    expect(u.statusCode, u.body).toBeLessThan(300);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const restrito = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
    // premissa: o restrito não vê a Compra da empresa 2
    expect((await h.app.inject({ method: "GET", url: `/api/compras/compras/${j(outra).id as string}`, headers: restrito })).statusCode).toBe(404);
    const antes = await documentosNoBanco();
    const r = await lancar(corpo(topId, { numero_nota: nota }), restrito);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("DUPLICATE_DOCUMENT");
    expect(j(r).error!.message).toBe("Esta nota já foi lançada nesta organização.");
    expect(r.body).not.toContain(j(outra).codigo as string);
    expect(await documentosNoBanco()).toBe(antes);
    // premissa: outra nota, o mesmo usuário lança
    expect((await lancar(corpo(topId, { numero_nota: `${nota}X` }), restrito)).statusCode).toBe(201);
  });
});
