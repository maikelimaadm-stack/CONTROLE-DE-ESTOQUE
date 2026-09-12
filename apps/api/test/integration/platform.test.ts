import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { assignGlobalId, resolveGlobalRecord } from "../../src/lib/global-id.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * FUNDAÇÃO DE PLATAFORMA (PRE-BASE2-01): ID Global e preferência de idioma.
 *
 * O que precisa estar provado aqui: a sequência é única POR ORGANIZAÇÃO e compartilhada entre as empresas
 * dela; a alocação é atômica sob concorrência e idempotente por registro; e a resolução de `#N` respeita
 * organização, permissão e escopo de empresa — sempre com 404, nunca revelando existência.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };

/** Contexto de serviço direto (as rotas de escrita só passam a alocar ID Global em PRE-BASE2-04). */
async function asService<T>(fn: (ctx: ServiceCtx) => Promise<T>, opts: { farmIds?: string[]; perms?: string[] } = {}): Promise<T> {
  return withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId }, (tx) =>
    fn({
      tx,
      user: { id: h.demo.adminUserId, email: h.demo.adminEmail, name: "Administrador" },
      orgId: h.demo.orgId,
      farmId: null,
      membership: { orgId: h.demo.orgId, orgName: "demo", roleId: null, isOwner: !opts.perms, farmIds: opts.farmIds ?? [] },
      permissions: new Set(opts.perms ?? [])
    }));
}

const PERMS = ["animals.view", "input_entries.view", "products.view"];
async function member(name: string, email: string, farmIds: string[], perms: string[] = PERMS): Promise<Hdr> {
  const role = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${name}`, permissions: perms } });
  expect(role.statusCode, role.body).toBe(201);
  const mem = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name, email, password: "Matriz@12345", role_id: j(role).id, farm_ids: farmIds } });
  expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Matriz@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("ID Global — alocação", () => {
  it("é sequencial por organização e compartilhado pelas empresas da organização", async () => {
    const a = await asService((ctx) => assignGlobalId(ctx, "animals", I.animal!, { farm_id: I.farm }));
    const b = await asService((ctx) => assignGlobalId(ctx, "products", I.product!, {}));
    expect(b).toBe(a + 1);
    // registros de empresas diferentes continuam na MESMA sequência da organização
    const entry = await h.app.inject({ method: "POST", url: "/api/stock/input-entries", headers: h.headers(), payload: { farm_id: I.farm2, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "5", unit_value: "2", warehouse_id: I.warehouseFarm2 }] } });
    expect(entry.statusCode, entry.body).toBe(201);
    const c = await asService((ctx) => assignGlobalId(ctx, "input_entries", j(entry).id as string, { farm_id: I.farm2 }));
    expect(c).toBe(b + 1);
  });

  it("é idempotente: o mesmo registro nunca recebe dois ID Globais", async () => {
    const first = await asService((ctx) => assignGlobalId(ctx, "products", I.product2!, {}));
    const again = await asService((ctx) => assignGlobalId(ctx, "products", I.product2!, {}));
    expect(again).toBe(first);
  });

  it("sob concorrência não duplica nem colide (alocações simultâneas)", async () => {
    const admin = createPool(TEST_URL, { max: 12 });
    try {
      const rows = await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 order by code limit 10", [h.demo.orgId]);
      const targets = rows.rows.map((r) => r.id);
      expect(targets.length).toBeGreaterThanOrEqual(5);
      const allocated = await Promise.all(targets.map((id) => asService((ctx) => assignGlobalId(ctx, "people", id, {}))));
      expect(new Set(allocated).size).toBe(targets.length);
      const dup = await admin.query<{ n: string }>("select count(*) n from (select global_id from erp.global_records where organization_id=$1 group by global_id having count(*)>1) x", [h.demo.orgId]);
      expect(Number(dup.rows[0]!.n)).toBe(0);
    } finally { await admin.end(); }
  });

  it("recusa entidade não elegível (linha técnica) e rota sem discriminador", async () => {
    await expect(asService((ctx) => assignGlobalId(ctx, "input_entry_items", I.product!, {}))).rejects.toThrow(/sem ID Global/i);
    await expect(asService((ctx) => assignGlobalId(ctx, "animal_handlings", I.animal!, { farm_id: I.farm }))).rejects.toThrow(/rota canônica/i);
  });

  it("grava a rota canônica resolvida a partir do registro", async () => {
    const admin = createPool(TEST_URL, { max: 1 });
    try {
      const r = await admin.query<{ canonical_route: string; empresa_id: string | null; module: string }>(
        "select canonical_route, empresa_id, module from erp.global_records where organization_id=$1 and entity_type='animals' and entity_id=$2", [h.demo.orgId, I.animal]);
      expect(r.rows[0]!.canonical_route).toBe(`/pecuaria/animais/${I.animal}`);
      expect(r.rows[0]!.empresa_id).toBe(I.farm);
      expect(r.rows[0]!.module).toBe("pecuaria");
    } finally { await admin.end(); }
  });
});

describe("ID Global — resolução e escopo", () => {
  it("resolve #N no registro real, aceitando as duas grafias", async () => {
    const globalId = await asService((ctx) => assignGlobalId(ctx, "animals", I.animal!, { farm_id: I.farm }));
    for (const path of [String(globalId), `%23${globalId}`]) {
      const r = await h.app.inject({ method: "GET", url: `/api/global-records/${path}`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ globalId, entityType: "animals", entityId: I.animal, route: `/pecuaria/animais/${I.animal}`, module: "pecuaria" });
    }
  });

  it("ID Global inexistente ou inválido responde 404 (nunca 500)", async () => {
    for (const v of ["999999", "abc", "0", "-1"]) {
      const r = await h.app.inject({ method: "GET", url: `/api/global-records/${v}`, headers: h.headers() });
      expect(r.statusCode, `${v}: ${r.body}`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });

  it("não atravessa organizações: o mesmo número em outro tenant não vaza", async () => {
    const admin = createPool(TEST_URL, { max: 2 });
    try {
      const orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org Global','orgglobal') returning id")).rows[0]!.id;
      const target = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await admin.query("insert into erp.global_records(organization_id, global_id, entity_type, entity_id, module, canonical_route) values ($1, 1, 'animals', $2, 'pecuaria', '/pecuaria/animais/x')", [orgB, target]);
      const r = await h.app.inject({ method: "GET", url: "/api/global-records/1", headers: h.headers() });
      expect(r.statusCode).toBe(200);
      expect(j(r).entityId).not.toBe(target);
    } finally { await admin.end(); }
  });

  it("respeita o escopo de empresa: registro de outra empresa responde 404", async () => {
    const entry = await h.app.inject({ method: "POST", url: "/api/stock/input-entries", headers: h.headers(), payload: { farm_id: I.farm2, entry_date: "2026-09-02", items: [{ product_id: I.product, quantity: "3", unit_value: "2", warehouse_id: I.warehouseFarm2 }] } });
    expect(entry.statusCode, entry.body).toBe(201);
    const globalId = await asService((ctx) => assignGlobalId(ctx, "input_entries", j(entry).id as string, { farm_id: I.farm2 }));
    const onlyFarmA = await member("Empresa A", "empresa.a@demo.local", [I.farm]);
    const denied = await h.app.inject({ method: "GET", url: `/api/global-records/${globalId}`, headers: onlyFarmA });
    expect(denied.statusCode, denied.body).toBe(404);
    expect(j(denied).error?.code).toBe("NOT_FOUND");
    const allowed = await h.app.inject({ method: "GET", url: `/api/global-records/${globalId}`, headers: h.headers() });
    expect(allowed.statusCode).toBe(200);
  });

  it("respeita permissão: sem a permissão de leitura da entidade responde 404", async () => {
    const globalId = await asService((ctx) => assignGlobalId(ctx, "animals", I.animal!, { farm_id: I.farm }));
    const semAnimais = await member("Sem Animais", "sem.animais@demo.local", [], ["products.view"]);
    const r = await h.app.inject({ method: "GET", url: `/api/global-records/${globalId}`, headers: semAnimais });
    expect(r.statusCode, r.body).toBe(404);
  });

  it("resolução direta no serviço concorda com a rota HTTP", async () => {
    const globalId = await asService((ctx) => assignGlobalId(ctx, "products", I.product!, {}));
    const direct = await asService((ctx) => resolveGlobalRecord(ctx, globalId));
    expect(direct).toMatchObject({ globalId, entityType: "products", entityId: I.product, companyId: null });
  });
});

describe("preferência de idioma", () => {
  it("organização nasce em pt-BR e o usuário herda quando não escolhe", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/platform/language", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ organization: "pt-BR", user: null, effective: "pt-BR" });
    expect(j(r).supported).toEqual(["pt-BR"]);
  });

  it("usuário define e limpa o próprio idioma; limpar volta a seguir a organização", async () => {
    const set = await h.app.inject({ method: "PUT", url: "/api/platform/language", headers: h.headers(), payload: { language: "pt" } });
    expect(set.statusCode, set.body).toBe(200);
    expect(j(set)).toMatchObject({ user: "pt-BR", effective: "pt-BR" });
    const clear = await h.app.inject({ method: "PUT", url: "/api/platform/language", headers: h.headers(), payload: { language: null } });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(j(clear).user).toBeNull();
  });

  it("idioma sem catálogo publicado é recusado (nunca grava preferência inválida)", async () => {
    const r = await h.app.inject({ method: "PUT", url: "/api/platform/language", headers: h.headers(), payload: { language: "ja-JP" } });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.code).toBe("VALIDATION_ERROR");
  });

  it("o contexto da organização informa o idioma efetivo para a interface", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).language).toMatchObject({ organization: "pt-BR", effective: "pt-BR" });
  });
});
