import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { configuracaoNeutraTopV3, familiaOperacionalDeDocumentoVenda, type ConfiguracaoTipoOperacaoV3 } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-05 · A3 — `GET /api/sales/<variante>/situacao-cliente` (decisão 263).
 *  TR-A5g  política da versão ATUAL: formato 2 / nao_valida → só `{ politica }`; avisa/bloqueia com e sem título
 *          vencido; tolerância; usuário só de vendas (sem financeiro, escopo sem a empresa do título) VÊ o atraso.
 *  TR-A4 rota  404 idênticas (cliente e TOP), query estrita (422) e 403 sem `sales.create`.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const FAMILIA = familiaOperacionalDeDocumentoVenda("sale")!;
const BASE = "/api/sales/sales";
let seq = 0;
const situacao = (clientId: string, topId: string, headers = h.headers()) =>
  h.app.inject({ method: "GET", url: `${BASE}/situacao-cliente?client_id=${encodeURIComponent(clientId)}&tipo_operacao_id=${encodeURIComponent(topId)}`, headers });

async function criarTop(codigoBase = FAMILIA, headers = h.headers()): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: { codigo: `SC${Date.now().toString(36).slice(-4)}${++seq}`, codigoBase, nome: `TOP A3 ${codigoBase} ${seq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}
/** Fixture: versão NOVA no formato 3 (como superusuário) e passa a ser a atual da TOP. */
async function versaoV3(topId: string, financeiro: Partial<ConfiguracaoTipoOperacaoV3["financeiro"]>): Promise<void> {
  const base = configuracaoNeutraTopV3();
  const config: ConfiguracaoTipoOperacaoV3 = { ...base, financeiro: { ...base.financeiro, ...financeiro } };
  const r = await admin.query<{ versao: number }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
     select t.organization_id, t.id, t.versao_atual + 1, v.nome, $2::jsonb, 3
       from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
      where t.id = $1 returning versao`, [topId, JSON.stringify(config)]);
  expect(r.rowCount, "premissa: versão v3 gravada").toBe(1);
  const u = await admin.query("update erp.tipos_operacao set versao_atual = $2 where id = $1", [topId, r.rows[0]!.versao]);
  expect(u.rowCount, "premissa: versão atual trocada").toBe(1);
}
async function criarCliente(orgId = h.demo.orgId): Promise<string> {
  const r = await admin.query<{ id: string }>("insert into erp.people (organization_id, code, name, is_client) values ($1, $2, $3, true) returning id", [orgId, `A3C${Date.now().toString(36)}${++seq}`, `Cliente A3 ${seq}`]);
  return r.rows[0]!.id;
}
async function diaRelativo(dias: number): Promise<string> {
  return (await admin.query<{ d: string }>("select (current_date + $1::int)::text as d", [dias])).rows[0]!.d;
}
async function receber(clienteId: string, valor: string, vencimento: string, empresa = I.empresa): Promise<void> {
  const r = await h.app.inject({ method: "POST", url: "/api/financial/receivables", headers: h.headers(), payload: { empresa_id: empresa, number: `A3-${++seq}`, person_id: clienteId, amount: valor, emission_date: await diaRelativo(-200), due_date: vencimento, note: "TOP-CONFIG-05 A3", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] } });
  expect([200, 201], r.body).toContain(r.statusCode);
}
async function login(permissions: string[], empresas: string[]): Promise<Record<string, string>> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil A3 ${++seq}`, permissions } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `a3-sc-${seq}-${Date.now().toString(36)}@demo.local`;
  const m = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: `Usuário A3 ${seq}`, email, password: "Variante@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(m.statusCode, m.body).toBe(201);
  const l = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Variante@12345" } });
  expect(l.statusCode, l.body).toBe(200);
  return { authorization: `Bearer ${j(l).token as string}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); I = await ids(h); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("TR-A5g situação do cliente pela política da versão ATUAL da TOP", () => {
  it("TR-A5g formato 2 (TOP recém-criada) → só { politica: nao_valida }, mesmo com título vencido", async () => {
    const top = await criarTop();
    const cli = await criarCliente();
    await receber(cli, "100.00", await diaRelativo(-40));
    const r = await situacao(cli, top);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ politica: "nao_valida" });
  });

  it("TR-A5g formato 3 com nao_valida → só { politica }, sem agregados", async () => {
    const top = await criarTop();
    await versaoV3(top, { clienteEmAtraso: "nao_valida", toleranciaAtrasoDias: 0 });
    const cli = await criarCliente();
    await receber(cli, "100.00", await diaRelativo(-40));
    const r = await situacao(cli, top);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ politica: "nao_valida" });
  });

  it("TR-A5g avisa e bloqueia SEM título vencido → emAtraso=false, zeros", async () => {
    for (const politica of ["avisa", "bloqueia"] as const) {
      const top = await criarTop();
      await versaoV3(top, { clienteEmAtraso: politica, toleranciaAtrasoDias: 0 });
      const cli = await criarCliente();
      await receber(cli, "80.00", await diaRelativo(15)); // a vencer: não conta
      const r = await situacao(cli, top);
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toEqual({ politica, emAtraso: false, titulos: 0, total: "0", vencimentoMaisAntigo: null });
    }
  });

  it("TR-A5g avisa e bloqueia COM título vencido → agregados (quantidade, total, mais antigo)", async () => {
    for (const politica of ["avisa", "bloqueia"] as const) {
      const top = await criarTop();
      await versaoV3(top, { clienteEmAtraso: politica, toleranciaAtrasoDias: 0 });
      const cli = await criarCliente();
      const antigo = await diaRelativo(-60);
      await receber(cli, "150.00", antigo);
      await receber(cli, "200.00", await diaRelativo(-5), I.empresa2);
      await receber(cli, "999.00", await diaRelativo(20)); // a vencer: fora
      const r = await situacao(cli, top);
      expect(r.statusCode, r.body).toBe(200);
      const b = j(r);
      expect(b).toMatchObject({ politica, emAtraso: true, titulos: 2, vencimentoMaisAntigo: antigo });
      expect(Number(b.total)).toBe(350);
    }
  });

  it("TR-A5g tolerância: vencido há 10 dias não conta com tolerância 30, conta com tolerância 5", async () => {
    const cli = await criarCliente();
    const venc = await diaRelativo(-10);
    await receber(cli, "70.00", venc);
    const tolerante = await criarTop();
    await versaoV3(tolerante, { clienteEmAtraso: "bloqueia", toleranciaAtrasoDias: 30 });
    const r1 = await situacao(cli, tolerante);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(j(r1)).toEqual({ politica: "bloqueia", emAtraso: false, titulos: 0, total: "0", vencimentoMaisAntigo: null });
    const estrita = await criarTop();
    await versaoV3(estrita, { clienteEmAtraso: "avisa", toleranciaAtrasoDias: 5 });
    const r2 = await situacao(cli, estrita);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toMatchObject({ politica: "avisa", emAtraso: true, titulos: 1, vencimentoMaisAntigo: venc });
    expect(Number(j(r2).total)).toBe(70);
  });

  it("TR-A5g usuário SÓ de vendas (sem financeiro, escopo sem a empresa do título) VÊ o atraso — porta estreita", async () => {
    const top = await criarTop();
    await versaoV3(top, { clienteEmAtraso: "bloqueia", toleranciaAtrasoDias: 0 });
    const cli = await criarCliente();
    const venc = await diaRelativo(-30);
    await receber(cli, "123.45", venc, I.empresa);
    const hdr = await login(["sales.view", "sales.create"], [I.empresa2]);
    // premissa: este usuário NÃO enxerga o título pelo financeiro
    const fin = await h.app.inject({ method: "GET", url: "/api/financial/receivables", headers: hdr });
    expect(fin.statusCode, "premissa: sem permissão financeira").toBe(403);
    const r = await situacao(cli, top, hdr);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ politica: "bloqueia", emAtraso: true, titulos: 1, total: "123.45", vencimentoMaisAntigo: venc });
  });
});

describe("TR-A4 rota situacao-cliente — porta, 404 idênticas, query estrita, 403", () => {
  it("TR-A4 rota cliente malformado, inexistente, de outra organização e excluído → a MESMA 404", async () => {
    const top = await criarTop();
    await versaoV3(top, { clienteEmAtraso: "bloqueia", toleranciaAtrasoDias: 0 });
    const o = await seedDemo(admin, { orgName: "[TEST] Org A3 SC", adminEmail: "admin-a3sc@demo.local", adminPassword: "Demo@12345", slug: "orga3sc" }, () => {});
    const deOutra = await criarCliente(o.orgId);
    const excluido = await criarCliente();
    await admin.query("update erp.people set deleted_at = now() where id = $1", [excluido]);
    const respostas = await Promise.all(["nao-e-uuid", "00000000-0000-4000-8000-000000000000", deOutra, excluido].map((c) => situacao(c, top)));
    for (const r of respostas) expect(r.statusCode, r.body).toBe(404);
    expect(new Set(respostas.map((r) => r.body)).size, "corpos idênticos").toBe(1);
    // controle positivo: o cliente vivo desta organização passa
    expect((await situacao(await criarCliente(), top)).statusCode).toBe(200);
  });

  it("TR-A4 rota TOP malformada, inexistente, de outra organização, de outra família e excluída → a MESMA 404", async () => {
    const cli = await criarCliente();
    const o = await seedDemo(admin, { orgName: "[TEST] Org A3 SC2", adminEmail: "admin-a3sc2@demo.local", adminPassword: "Demo@12345", slug: "orga3sc2" }, () => {});
    const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-a3sc2@demo.local", password: "Demo@12345" } })).token as string;
    const deOutra = await criarTop(FAMILIA, { authorization: `Bearer ${tok}`, "x-org-id": o.orgId });
    const compras = await criarTop("compras.solicitacao");
    const excluida = await criarTop();
    await admin.query("update erp.tipos_operacao set excluido_em = now() where id = $1", [excluida]);
    const respostas = await Promise.all(["nao-e-uuid", "00000000-0000-4000-8000-000000000000", deOutra, compras, excluida].map((t) => situacao(cli, t)));
    for (const r of respostas) expect(r.statusCode, r.body).toBe(404);
    expect(new Set(respostas.map((r) => r.body)).size, "corpos idênticos").toBe(1);
  });

  it("TR-A4 rota query estrita: chave desconhecida ou ausente → 422", async () => {
    const top = await criarTop();
    const cli = await criarCliente();
    const extra = await h.app.inject({ method: "GET", url: `${BASE}/situacao-cliente?client_id=${cli}&tipo_operacao_id=${top}&extra=1`, headers: h.headers() });
    expect(extra.statusCode, extra.body).toBe(422);
    const falta = await h.app.inject({ method: "GET", url: `${BASE}/situacao-cliente?client_id=${cli}`, headers: h.headers() });
    expect(falta.statusCode, falta.body).toBe(422);
  });

  it("TR-A4 rota usuário sem sales.create → 403, como /layout-efetivo", async () => {
    const top = await criarTop();
    await versaoV3(top, { clienteEmAtraso: "bloqueia", toleranciaAtrasoDias: 0 });
    const cli = await criarCliente();
    const hdr = await login(["sales.view"], []);
    const r = await situacao(cli, top, hdr);
    expect(r.statusCode, r.body).toBe(403);
    const vizinha = await h.app.inject({ method: "GET", url: `${BASE}/layout-efetivo?tipo_operacao_id=${top}`, headers: hdr });
    expect(vizinha.statusCode, vizinha.body).toBe(403);
  });
});
