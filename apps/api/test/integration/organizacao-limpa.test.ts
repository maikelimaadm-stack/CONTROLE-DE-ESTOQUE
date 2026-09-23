import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedOrganizacaoLimpa, lerConfiguracaoOrganizacaoLimpa, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * GO-LIVE-01 — a organização limpa ABRE e começa a numerar do zero.
 * L2: o dono loga e só enxerga a organização nova; o contexto carrega sem erro.
 * L3: a primeira empresa cadastrada pela tela recebe código 1 e ID Global 1.
 * E a marca de origem não pode ser trocada pela tela de parâmetros (é ela que blinda o seed demo).
 */
const SENHA = "Senha-Forte-Go-Live-2026";
let h: Harness;
let admin: Db;
let orgId: string;
let token: string;
const j = (r: { body: string }) => JSON.parse(r.body);

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  const r = await seedOrganizacaoLimpa(admin, lerConfiguracaoOrganizacaoLimpa({ ORG_NAME: "Agro Real", ORG_SLUG: "agro-real", ADMIN_NAME: "Maike", ADMIN_EMAIL: "dono@real.example", ADMIN_PASSWORD: SENHA }), () => {});
  orgId = r.orgId;
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "dono@real.example", password: SENHA } });
  expect(login.statusCode, login.body).toBe(200);
  token = j(login).token;
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

const hdr = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "x-org-id": orgId, ...extra });

describe("organização limpa na API", () => {
  it("L2: /auth/me devolve só a organização nova; /auth/context carrega, dono, sem empresa", async () => {
    const me = await h.app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(j(me).organizations).toEqual([{ id: orgId, name: "Agro Real", is_owner: true, role_name: "Administrador" }]);
    const ctx = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: hdr() });
    expect(ctx.statusCode, ctx.body).toBe(200);
    const c = j(ctx);
    expect(c.organization).toMatchObject({ id: orgId, name: "Agro Real" });
    expect(c.isOwner).toBe(true);
    expect(c.empresas).toEqual([]);
    expect(c.permissions.length).toBeGreaterThan(100);
    // Ninguém da demo enxerga a organização nova.
    const demoMe = await h.app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${h.token}` } });
    expect(j(demoMe).organizations.map((o: { id: string }) => o.id)).not.toContain(orgId);
  });

  it("L3: a primeira empresa recebe código 1; o primeiro registro com ID Global recebe 1", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/resources/empresas", headers: hdr({ "content-type": "application/json" }), payload: { name: "Unidade Real 1", is_active: true } });
    expect(r.statusCode, r.body).toBe(201);
    expect(Number(j(r).code)).toBe(1);
    // A empresa aparece no contexto do dono (escopo "todas").
    const ctx = j(await h.app.inject({ method: "GET", url: "/api/auth/context", headers: hdr() }));
    expect(ctx.empresas.map((e: { id: string }) => e.id)).toEqual([j(r).id]);
    // Empresa não é entidade de ID Global (o catálogo é de registros transacionais); a primeira
    // solicitação de compra é. Sem produto: tipo serviço, que só exige a empresa.
    expect((await admin.query("select 1 from erp.sequencias_id_global where organization_id=$1", [orgId])).rowCount).toBe(0);
    const sc = await h.app.inject({ method: "POST", url: "/api/supply/requests", headers: hdr(), payload: { empresa_id: j(r).id, request_date: "2026-09-23", request_type: "service", description: "Primeira compra real", justification: "go-live", items: [{ description: "Serviço", quantity: "1", amount: "10" }] } });
    expect(sc.statusCode, sc.body).toBe(201);
    const g = await admin.query<{ id_global: string }>("select id_global::text from erp.registros_globais where organization_id=$1", [orgId]);
    expect(g.rows).toEqual([{ id_global: "1" }]);
    const det = await h.app.inject({ method: "GET", url: `/api/supply/requests/${j(sc).id}`, headers: hdr() });
    expect(det.statusCode).toBe(200);
    expect(Number(j(det).code)).toBe(1);
  });

  it("a marca de origem não muda pela tela de parâmetros; reenviar o valor atual continua permitido", async () => {
    const put = (body: Record<string, unknown>) => h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: hdr({ "content-type": "application/json" }), payload: body });
    const forjar = await put({ origem_seed: "demo" });
    expect(forjar.statusCode).toBe(422);
    const apagar = await put({ origem_seed: null });
    expect(apagar.statusCode).toBe(422);
    const mesmo = await put({ origem_seed: "organizacao_limpa", calc_icms_desonerado: true });
    expect(mesmo.statusCode, mesmo.body).toBe(200);
    const p = await admin.query("select parameters from erp.organizations where id=$1", [orgId]);
    expect(p.rows[0]).toEqual({ parameters: { origem_seed: "organizacao_limpa", calc_icms_desonerado: true } });
    // Na demo (sem a chave na organização antiga seria null; aqui marcada), forjar "organizacao_limpa" também é recusado.
    const demo = await h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: h.headers({ "content-type": "application/json" }), payload: { origem_seed: "organizacao_limpa" } });
    expect(demo.statusCode).toBe(422);
  });
});
