import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createPool, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import { configDeTeste, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * OPERACOES-01 F12 (decisão 288, dívidas de segurança) — O ESCOPO DE EMPRESA AMARRADO À LINHA.
 *
 * A dívida: `empresaScopeSql(ctx, "empresa_id", …)` numa consulta SEM alias gera
 * `exists (select 1 from erp.membro_empresas me where … and me.empresa_id=empresa_id)` — e dentro da subconsulta o
 * `empresa_id` solto é a coluna de erp.membro_empresas (o nome mais perto), não a da linha. O predicado vira
 * "o membro tem ALGUMA empresa no módulo" (InitPlan constante), não "a empresa DESTA linha está no escopo". Com o
 * alias (ou a coluna qualificada pela tabela), a subconsulta se amarra à linha.
 *
 * Cada endpoint consertado, com um usuário de escopo SÓ da empresa A em todos os módulos e as permissões funcionais:
 *   • a linha de B (premissa: existe e é de B) responde EXATAMENTE como um id inexistente e nada é gravado nela;
 *   • a linha de A funciona (o predicado não é simplesmente "falso").
 * E isso duas vezes:
 *   • "com RLS" — a API de sempre, pelo papel da aplicação (o caminho real: RLS e API juntas);
 *   • "só a API" — a MESMA API sobre um papel de banco que ATRAVESSA a RLS (premissa provada abaixo). Aqui a única
 *     barreira é o SQL da rota: é o que reprova sem o conserto (a linha de B seria gravada/lida) e passa com ele.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
let admin: Db; let poolSemRls: Db; let apiSemRls: FastifyInstance;
let A = ""; let B = ""; let WH_A = ""; let WH_B = ""; let SO_A: Record<string, string> = {};
const PAPEL_SEM_RLS = "erp_app_sem_rls_test";
const PERMS = ["requisitions.edit", "dfe.view", "dfe.manifest", "dfe_drafts.ignore", "depreciations.create", "depreciation_forecast.view",
  "earnings.view", "earnings.edit", "service_orders.rate", "service_orders.monitor", "warehouses.view"];

type Api = () => FastifyInstance;
const APIS: [string, Api][] = [["com RLS", () => h.app], ["só a API", () => apiSemRls]];
const chamar = (api: Api, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) =>
  api().inject({ method, url, headers: SO_A, ...(payload ? { payload } : {}) });
const resposta = (r: LightMyRequestResponse) => ({ status: r.statusCode, corpo: r.json() as unknown });
const j = (r: LightMyRequestResponse) => r.json() as Record<string, unknown>;
const um = async <T>(sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0] as T;

let seq = 0;
async function inserir(tabela: string, v: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(v);
  return (await admin.query<{ id: string }>(`insert into erp.${tabela} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(v))).rows[0]!.id;
}
const porEmpresa = async (fn: (empresa: string, sufixo: "A" | "B") => Promise<string>) => ({ a: await fn(A, "A"), b: await fn(B, "B") });
/** PREMISSA de toda linha "de B": existe, é da organização e é de B. */
async function deB(tabela: string, id: string): Promise<void> {
  expect(await um<{ empresa_id: string; organization_id: string }>(`select empresa_id, organization_id from erp.${tabela} where id = $1`, [id]))
    .toEqual({ empresa_id: B, organization_id: h.demo.orgId });
}
/** A linha de B responde EXATAMENTE como um id inexistente (`ignorarId`: o corpo ecoa o id pedido). */
async function comoInexistente(api: Api, metodo: "GET" | "POST", url: (id: string) => string, idB: string, payload?: Record<string, unknown>, ignorarId = false) {
  const rB = resposta(await chamar(api, metodo, url(idB), payload));
  const rX = resposta(await chamar(api, metodo, url(randomUUID()), payload));
  const semId = (x: { status: number; corpo: unknown }) => (ignorarId ? { ...x, corpo: { ...(x.corpo as Record<string, unknown>), id: "?" } } : x);
  expect(semId(rB)).toEqual(semId(rX));
  return rB;
}

beforeAll(async () => {
  h = await harness(); I = await ids(h); A = I.empresa; B = I.empresa2;
  WH_A = I.warehouse ?? ""; WH_B = I.warehouseEmpresa2 ?? "";
  expect([WH_A, WH_B].every(Boolean), "a semente tem um local de estoque em A e outro em B").toBe(true);
  admin = createPool(TEST_URL, { max: 2 });
  // O papel "só a API": membro do erp_app (os MESMOS privilégios de tabela) e com BYPASSRLS — a RLS fica de fora.
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${PAPEL_SEM_RLS}') then
    create role ${PAPEL_SEM_RLS} login password '${PAPEL_SEM_RLS}' bypassrls in role erp_app; end if; end $$;`);
  const url = new URL(TEST_URL); url.username = PAPEL_SEM_RLS; url.password = PAPEL_SEM_RLS;
  poolSemRls = createPool(url.toString(), { max: 4 });
  apiSemRls = await buildApp({ config: configDeTeste(), db: poolSemRls, logger: false });

  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Perfil F12 só A", permissions: PERMS } });
  expect(papel.statusCode, papel.body).toBe(201);
  const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: "F12 só A", email: "f12-so-a@demo.local", password: "Escopo@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([A]) } });
  expect(membro.statusCode, membro.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "f12-so-a@demo.local", password: "Escopo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  SO_A = { authorization: `Bearer ${j(login).token as string}`, "x-org-id": h.demo.orgId };
}, 300_000);
afterAll(async () => {
  await apiSemRls?.close(); await poolSemRls?.end();
  await admin?.query(`drop role if exists ${PAPEL_SEM_RLS}`).catch(() => {});
  await admin?.end(); await h?.app.close(); await h?.db.end();
});

describe("OPERACOES-01 F12 — escopo de empresa amarrado à linha (alias)", () => {
  it("PREMISSA: o usuário só de A; as empresas A e B; a instância 'só a API' atravessa a RLS e a de sempre não", async () => {
    expect(A).not.toBe(B);
    const r = await um<{ id: string }>("insert into erp.requisitions (organization_id, empresa_id, code, requisition_date) values ($1, $2, 'F12-PREMISSA', '2026-10-01') returning id",
      [h.demo.orgId, B]);
    // Sem GUC nenhuma: o papel da aplicação não vê nada (tenant); o papel "só a API" vê a linha de B.
    expect((await h.db.query("select 1 from erp.requisitions where id = $1", [r.id])).rowCount).toBe(0);
    expect((await poolSemRls.query("select 1 from erp.requisitions where id = $1", [r.id])).rowCount).toBe(1);
    expect(await um("select rolbypassrls b, pg_has_role($1, 'erp_app', 'member') m from pg_roles where rolname = $1", [PAPEL_SEM_RLS])).toEqual({ b: true, m: true });
    // O escopo do usuário: selecionadas [A] nos módulos destes endpoints.
    const escopo = (await admin.query<{ modulo: string; empresa_id: string }>(
      `select me.modulo, me.empresa_id from erp.membro_empresas me join erp.organization_members m on m.id = me.membro_id join erp.users u on u.id = m.user_id
        where u.email = 'f12-so-a@demo.local' and me.modulo in ('estoque', 'frota_ativos', 'pessoas_rh', 'ordens_servico') order by 1`)).rows;
    expect(escopo).toEqual(["estoque", "frota_ativos", "ordens_servico", "pessoas_rh"].map((modulo) => ({ modulo, empresa_id: A })));
  });

  it.each(APIS)("POST /stock/requisitions/:id/sign (%s): B como inexistente e nada gravado; A assina", async (_n, api) => {
    seq += 1;
    const req = await porEmpresa((empresa, s) => inserir("requisitions", { organization_id: h.demo.orgId, empresa_id: empresa, code: `F12-R${seq}${s}`, requisition_date: "2026-10-01" }));
    await deB("requisitions", req.b);
    expect((await comoInexistente(api, "POST", (id) => `/api/stock/requisitions/${id}/sign`, req.b, {})).status).toBe(404);
    expect(await um("select signature_status from erp.requisitions where id = $1", [req.b])).toEqual({ signature_status: "awaiting_signature" });
    const ok = await chamar(api, "POST", `/api/stock/requisitions/${req.a}/sign`, {});
    expect([ok.statusCode, j(ok)]).toEqual([200, { id: req.a, signature_status: "signed" }]);
    expect(await um("select signature_status from erp.requisitions where id = $1", [req.a])).toEqual({ signature_status: "signed" });
  });

  /** DF-e de A, de B e uma SEM empresa (da organização: visível a quem enxerga alguma empresa do módulo). */
  async function dfes() {
    seq += 1;
    const marca = `[TEST] F12 DFe ${seq} ${randomUUID().slice(0, 8)}`;
    const chave = () => Array.from({ length: 44 }, () => randomInt(10)).join("");
    const nova = (empresa: string | null) => inserir("dfe_documents", { organization_id: h.demo.orgId, empresa_id: empresa, access_key: chave(), issuer_name: marca });
    return { marca, a: await nova(A), b: await nova(B), semEmpresa: await nova(null) };
  }

  it.each(APIS)("GET /stock/dfe (%s): lista a de A e a sem empresa, nunca a de B", async (_n, api) => {
    const d = await dfes();
    await deB("dfe_documents", d.b);
    const r = await chamar(api, "GET", `/api/stock/dfe?search=${encodeURIComponent(d.marca)}&pageSize=50`);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as { items: { id: string }[]; total: number };
    expect([corpo.items.map((x) => x.id).sort(), corpo.total]).toEqual([[d.a, d.semEmpresa].sort(), 2]);
  });

  it.each(APIS)("POST /stock/dfe/:id/manifest (%s): B como inexistente e nada gravado; A manifesta", async (_n, api) => {
    const d = await dfes();
    await deB("dfe_documents", d.b);
    expect((await comoInexistente(api, "POST", (id) => `/api/stock/dfe/${id}/manifest`, d.b, { status: "confirmed" })).status).toBe(404);
    expect(await um("select manifest_status from erp.dfe_documents where id = $1", [d.b])).toEqual({ manifest_status: "none" });
    const ok = await chamar(api, "POST", `/api/stock/dfe/${d.a}/manifest`, { status: "confirmed" });
    expect([ok.statusCode, j(ok)]).toEqual([200, { id: d.a, manifest_status: "confirmed" }]);
    expect(await um("select manifest_status from erp.dfe_documents where id = $1", [d.a])).toEqual({ manifest_status: "confirmed" });
  });

  it.each(APIS)("POST /stock/dfe/:id/ignore (%s): B como inexistente e nada gravado; A é ignorada", async (_n, api) => {
    const d = await dfes();
    await deB("dfe_documents", d.b);
    expect((await comoInexistente(api, "POST", (id) => `/api/stock/dfe/${id}/ignore`, d.b, {})).status).toBe(404);
    expect(await um("select launch_status from erp.dfe_documents where id = $1", [d.b])).toEqual({ launch_status: "pending" });
    const ok = await chamar(api, "POST", `/api/stock/dfe/${d.a}/ignore`, {});
    expect([ok.statusCode, j(ok)]).toEqual([200, { id: d.a, launch_status: "ignored" }]);
    expect(await um("select launch_status from erp.dfe_documents where id = $1", [d.a])).toEqual({ launch_status: "ignored" });
  });

  /** Bens com depreciação em A e em B (12.000,00 em 1 ano, sem residual: 1.000,00 por mês). */
  const bens = () => { seq += 1; const n = seq; return porEmpresa((empresa, s) => inserir("equipments", {
    organization_id: h.demo.orgId, empresa_id: empresa, code: `F12-E${n}${s}`, description: `[TEST] Bem F12 ${n} ${s}`, has_depreciation: true,
    acquisition_value: "12000.00", life_years: "1", depreciation_type: "without_residual" })); };

  it.each(APIS.map(([n, api], i) => [n, api, `2026-0${7 + i}-01`] as [string, Api, string]))(
    "POST /assets/depreciations/run (%s): deprecia o bem de A, nunca o de B", async (_n, api, mes) => {
      const eq = await bens();
      await deB("equipments", eq.b);
      const r = await chamar(api, "POST", "/api/assets/depreciations/run", { period_month: mes });
      expect(r.statusCode, r.body).toBe(201);
      expect((await admin.query<{ equipment_id: string; amount: string }>(
        "select equipment_id, amount from erp.depreciations where equipment_id = any($1::uuid[]) order by period_month", [[eq.a, eq.b]])).rows)
        .toEqual([{ equipment_id: eq.a, amount: "1000.00" }]);
      expect(await um("select depreciated_value from erp.equipments where id = $1", [eq.b])).toEqual({ depreciated_value: "0.00" });
    });

  it.each(APIS)("GET /assets/depreciation-forecast (%s): prevê o bem de A, nunca o de B", async (_n, api) => {
    const eq = await bens();
    await deB("equipments", eq.b);
    const r = await chamar(api, "GET", "/api/assets/depreciation-forecast?months=1");
    expect(r.statusCode, r.body).toBe(200);
    const ids = (j(r).items as { equipment_id: string }[]).map((x) => x.equipment_id);
    expect([ids.includes(eq.a), ids.includes(eq.b)]).toEqual([true, false]);
  });

  /** Apurações de ganhos (abertas) em A e em B — uma por mês por empresa (a competência é única). */
  const ganhos = () => { seq += 1; const n = seq; return porEmpresa((empresa, s) => inserir("earnings", {
    organization_id: h.demo.orgId, empresa_id: empresa, code: `F12-G${n}${s}`, reference_month: `${2000 + n}-09-01` })); };

  it.each(APIS)("GET /hr/earnings/:id (%s): B como inexistente; A é lida", async (_n, api) => {
    const g = await ganhos();
    await deB("earnings", g.b);
    expect((await comoInexistente(api, "GET", (id) => `/api/hr/earnings/${id}`, g.b)).status).toBe(404);
    const ok = await chamar(api, "GET", `/api/hr/earnings/${g.a}`);
    expect([ok.statusCode, j(ok).id, j(ok).empresa_id]).toEqual([200, g.a, A]);
  });

  it.each(APIS)("POST /hr/earnings/:id/close (%s): B como inexistente e nada gravado; A fecha", async (_n, api) => {
    const g = await ganhos();
    await deB("earnings", g.b);
    // A rota não confere o ROW COUNT (dívida declarada à parte): inexistente e fora do escopo respondem o MESMO 200
    // sem efeito. O que esta fatia prova é que a linha de B não é fechada.
    expect((await comoInexistente(api, "POST", (id) => `/api/hr/earnings/${id}/close`, g.b, {}, true)).status).toBe(200);
    expect(await um("select status from erp.earnings where id = $1", [g.b])).toEqual({ status: "open" });
    const ok = await chamar(api, "POST", `/api/hr/earnings/${g.a}/close`, {});
    expect([ok.statusCode, j(ok)]).toEqual([200, { id: g.a, status: "closed" }]);
    expect(await um("select status from erp.earnings where id = $1", [g.a])).toEqual({ status: "closed" });
  });

  /** OS finalizadas (para avaliar) e atrasadas em andamento (para o monitoramento), em A e em B. */
  const ordens = (status: string, prazo: string | null = null) => { seq += 1; const n = seq; return porEmpresa((empresa, s) => inserir("service_orders", {
    organization_id: h.demo.orgId, empresa_id: empresa, code: `F12-OS${n}${s}`, description: `[TEST] OS F12 ${n} ${s}`, order_date: "2020-01-01", status, planned_end: prazo })); };

  it.each(APIS)("POST /service-orders/:id/rate (%s): B como inexistente e nada gravado; A é avaliada", async (_n, api) => {
    const os = await ordens("finished");
    await deB("service_orders", os.b);
    expect((await comoInexistente(api, "POST", (id) => `/api/service-orders/${id}/rate`, os.b, { rating: 5 })).status).toBe(409);
    expect(await um("select status, rating from erp.service_orders where id = $1", [os.b])).toEqual({ status: "finished", rating: null });
    const ok = await chamar(api, "POST", `/api/service-orders/${os.a}/rate`, { rating: 5 });
    expect([ok.statusCode, j(ok)]).toEqual([200, { id: os.a, rating: 5 }]);
    expect(await um("select status, rating from erp.service_orders where id = $1", [os.a])).toEqual({ status: "evaluated", rating: 5 });
  });

  it.each(APIS)("GET /service-orders-monitoring (%s): totais e atrasadas só de A", async (_n, api) => {
    const atrasadas = await ordens("in_progress", "2020-01-15");
    await deB("service_orders", atrasadas.b);
    const r = await chamar(api, "GET", "/api/service-orders-monitoring");
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as { by_status: { status: string; n: number; total: string }[]; late: { id: string }[] };
    const deA = (await admin.query<{ status: string; n: number; total: string }>(
      `select status, count(*)::int n, coalesce(sum(total), 0) total from erp.service_orders
        where organization_id = $1 and empresa_id = $2 and deleted_at is null group by status order by status`, [h.demo.orgId, A])).rows;
    const deAeB = (await admin.query<{ n: number }>("select count(*)::int n from erp.service_orders where organization_id = $1 and deleted_at is null", [h.demo.orgId])).rows[0]!.n;
    expect(deA.reduce((s, x) => s + x.n, 0), "premissa: B tem OS (a soma de A é menor que a da organização)").toBeLessThan(deAeB);
    expect([...corpo.by_status].sort((x, y) => x.status.localeCompare(y.status))).toEqual(deA);
    const late = corpo.late.map((x) => x.id);
    expect([late.includes(atrasadas.a), late.includes(atrasadas.b)]).toEqual([true, false]);
  });

  it.each(APIS)("GET /resources/warehouses (%s): só os locais de A", async (_n, api) => {
    await deB("warehouses", WH_B);
    const r = await chamar(api, "GET", "/api/resources/warehouses?pageSize=200");
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as { items: { id: string }[]; total: number };
    const deA = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id = $1 and empresa_id = $2 and deleted_at is null order by id",
      [h.demo.orgId, A])).rows.map((x) => x.id);
    expect(deA).toContain(WH_A);
    expect([corpo.items.map((x) => x.id).sort(), corpo.total]).toEqual([deA, deA.length]);
  });

  it.each(APIS)("GET /resources/warehouses/:id (%s): o de B como inexistente; o de A é lido", async (_n, api) => {
    await deB("warehouses", WH_B);
    expect((await comoInexistente(api, "GET", (id) => `/api/resources/warehouses/${id}`, WH_B)).status).toBe(404);
    const ok = await chamar(api, "GET", `/api/resources/warehouses/${WH_A}`);
    expect([ok.statusCode, j(ok).id]).toEqual([200, WH_A]);
  });
});
