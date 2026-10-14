import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * XML-04 (decisão 318) · o cadastro da FORMA DE PAGAMENTO DA NF-e — a ligação do código tPag da nota a uma forma de
 * pagamento — pelo motor genérico /api/resources/formas_pagamento_da_nfe, com a 0064 como autoridade: o gatilho recusa a
 * forma de outra organização (422, nunca 500), o índice único parcial recusa dois vivos com o mesmo código, a exclusão é
 * lógica e libera o código, e a RLS isola a organização. Permissão: `sales` (a mesma das Formas de pagamento).
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Hdr = Record<string, string>;
const j = (r: Resp) => JSON.parse(r.body);
const URL_ = "/api/resources/formas_pagamento_da_nfe";
const hdr = (): Hdr => h.headers({ "content-type": "application/json" });
const post = (payload: Record<string, unknown>, headers: Hdr = hdr()) => h.app.inject({ method: "POST", url: URL_, headers, payload }) as unknown as Promise<Resp>;
const put = (id: string, payload: Record<string, unknown>, headers: Hdr = hdr()) => h.app.inject({ method: "PUT", url: `${URL_}/${id}`, headers, payload }) as unknown as Promise<Resp>;
const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers }) as unknown as Promise<Resp>;
/** O DELETE vai sem `content-type` (corpo JSON vazio é 400 do Fastify, antes da permissão). */
const semCorpo = (headers: Hdr): Hdr => Object.fromEntries(Object.entries(headers).filter(([k]) => k !== "content-type"));
const del = (id: string, headers: Hdr = h.headers()) => h.app.inject({ method: "DELETE", url: `${URL_}/${id}`, headers: semCorpo(headers) }) as unknown as Promise<Resp>;
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const linha = async (id: string) => (await um("select * from erp.formas_pagamento_da_nfe where id=$1", [id]))!;
const contar = async (org: string, codigo?: string) => Number((await um<{ n: string }>(
  `select count(*)::text n from erp.formas_pagamento_da_nfe where organization_id=$1 ${codigo ? "and codigo_tpag=$2" : ""}`, codigo ? [org, codigo] : [org]))!.n);

const MSG_FORMA = "A forma de pagamento precisa existir e ser desta organização ou do sistema.";
let SISTEMA = ""; let SISTEMA_NOME = ""; let PROPRIA = ""; let OUTRA_ORG = ""; let DA_OUTRA = "";
let hOutra: Hdr; let hSemSales: Hdr; let hSoVer: Hdr;

/** Membro novo (papel próprio, senha do operador da demo) numa organização, com as permissões e os escopos dados. */
async function membro(org: string, email: string, perms: string[], o: { dono?: boolean; escopos?: { modulo: string; modo: "todas" }[] } = {}): Promise<Hdr> {
  const hash = (await um<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'"))!.password_hash;
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [org, `[TEST] ${email}`]))!.id;
  for (const p of perms) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash]))!.id;
  const m = (await um<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,$4,true) returning id", [org, u, papel, Boolean(o.dono)]))!.id;
  for (const e of o.escopos ?? []) await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [org, m, e.modulo, e.modo]);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token as string}`, "x-org-id": org, "content-type": "application/json" };
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  const sis = await um<{ id: string; name: string }>("select id::text, name from erp.payment_methods where organization_id is null and is_active order by name limit 1");
  expect(sis, "premissa: a semente de referência traz formas do SISTEMA").toBeTruthy();
  SISTEMA = sis!.id; SISTEMA_NOME = sis!.name;
  PROPRIA = (await um<{ id: string }>("insert into erp.payment_methods(organization_id,name) values ($1,'XML-04 Própria da demo') returning id::text", [h.demo.orgId]))!.id;
  OUTRA_ORG = (await um<{ id: string }>("insert into erp.organizations(name) values ('XML-04 Outra organização') returning id::text"))!.id;
  DA_OUTRA = (await um<{ id: string }>("insert into erp.payment_methods(organization_id,name) values ($1,'XML-04 Da outra organização') returning id::text", [OUTRA_ORG]))!.id;
  hOutra = await membro(OUTRA_ORG, "xml04-outra@demo.local", ["sales.view", "sales.create", "sales.edit", "sales.delete"], { dono: true });
  hSemSales = await membro(h.demo.orgId, "xml04-sem-sales@demo.local", ["products.view", "payables.view"], { escopos: [{ modulo: "vendas", modo: "todas" }] });
  hSoVer = await membro(h.demo.orgId, "xml04-so-ver@demo.local", ["sales.view"], { escopos: [{ modulo: "vendas", modo: "todas" }] });
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("o cadastro no registry e na API genérica", () => {
  it("a definição sai com os códigos do leiaute ('15 — Boleto bancário') e a referência às Formas de pagamento", async () => {
    const r = await get(`${URL_}/definition`);
    expect(r.statusCode, r.body).toBe(200);
    const def = j(r) as { permission: string; softDelete: boolean; fields: { name: string; type: string; required?: boolean; options?: { value: string; label: string }[]; ref?: { resource: string } }[] };
    expect(def).toMatchObject({ permission: "sales", softDelete: true });
    expect(def.fields.map((f) => f.name)).toEqual(["codigo_tpag", "forma_pagamento_id"]);
    const codigo = def.fields[0]!;
    expect(codigo).toMatchObject({ type: "select", required: true });
    expect(codigo.options).toContainEqual({ value: "15", label: "15 — Boleto bancário" });
    expect(codigo.options).toContainEqual({ value: "01", label: "01 — Dinheiro" });
    expect(codigo.options?.every((o) => /^[0-9]{2}$/.test(o.value))).toBe(true);
    expect(def.fields[1]).toMatchObject({ type: "ref", required: true, ref: { resource: "payment_methods" } });
  });

  it("o seletor da forma oferece as do SISTEMA e as da PRÓPRIA organização — nunca as de outra", async () => {
    const r = await get("/api/resources/payment_methods/options");
    expect(r.statusCode, r.body).toBe(200);
    const ids = (j(r) as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(SISTEMA);
    expect(ids).toContain(PROPRIA);
    expect(ids).not.toContain(DA_OUTRA);
  });
});

describe("criar: a forma é do sistema ou da organização; a de outra organização é recusada pelo gatilho da 0064", () => {
  it("forma do SISTEMA → 201, gravada na organização da sessão, com o rótulo da forma", async () => {
    const r = await post({ codigo_tpag: "15", forma_pagamento_id: SISTEMA });
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as Record<string, unknown>;
    expect(b).toMatchObject({ codigo_tpag: "15", forma_pagamento_id: SISTEMA, forma_pagamento_id_label: SISTEMA_NOME, deleted_at: null });
    expect(await linha(String(b["id"]))).toMatchObject({ organization_id: h.demo.orgId, codigo_tpag: "15", forma_pagamento_id: SISTEMA, deleted_at: null });
    const audit = await um<{ n: string }>("select count(*)::text n from erp.audit_logs where entity='formas_pagamento_da_nfe' and entity_id=$1", [b["id"]]);
    expect(Number(audit!.n), "a ligação entra na auditoria (erp.audit_row)").toBeGreaterThan(0);
  });

  it("forma da PRÓPRIA organização → 201; a mesma forma recebe vários códigos (17 e 20 → a mesma forma)", async () => {
    const a = await post({ codigo_tpag: "17", forma_pagamento_id: PROPRIA });
    expect(a.statusCode, a.body).toBe(201);
    const b = await post({ codigo_tpag: "20", forma_pagamento_id: PROPRIA });
    expect(b.statusCode, b.body).toBe(201);
    expect(j(a)).toMatchObject({ forma_pagamento_id: PROPRIA, forma_pagamento_id_label: "XML-04 Própria da demo" });
  });

  it("forma de OUTRA organização → 422 legível (nunca 500), nada gravado; a forma INEXISTENTE recebe a MESMA recusa", async () => {
    const antes = await contar(h.demo.orgId);
    const outra = await post({ codigo_tpag: "03", forma_pagamento_id: DA_OUTRA });
    expect(outra.statusCode, outra.body).toBe(422);
    expect(j(outra).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_FORMA });
    const inexistente = await post({ codigo_tpag: "03", forma_pagamento_id: "00000000-0000-4000-8000-000000000318" });
    expect(inexistente.statusCode, inexistente.body).toBe(422);
    expect(j(inexistente).error, "negar não revela existência: a mesma resposta").toEqual(j(outra).error);
    expect(await contar(h.demo.orgId), "nada gravado").toBe(antes);
  });

  it("trocar (PUT) a forma para a de outra organização → 422, a linha fica como estava; para a do sistema → 200", async () => {
    const c = await post({ codigo_tpag: "04", forma_pagamento_id: PROPRIA });
    expect(c.statusCode, c.body).toBe(201);
    const id = j(c).id as string;
    const r = await put(id, { forma_pagamento_id: DA_OUTRA });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_FORMA });
    expect((await linha(id))["forma_pagamento_id"]).toBe(PROPRIA);
    const s = await put(id, { forma_pagamento_id: SISTEMA });
    expect(s.statusCode, s.body).toBe(200);
    expect((await linha(id))["forma_pagamento_id"]).toBe(SISTEMA);
  });

  it("código fora do leiaute → 422 no campo codigo_tpag ('1', 'ABC', '07', vazio, número); nada gravado", async () => {
    const antes = await contar(h.demo.orgId);
    for (const codigo of ["1", "ABC", "07", "", 15, "015"]) {
      const r = await post({ codigo_tpag: codigo, forma_pagamento_id: SISTEMA });
      expect(r.statusCode, `${JSON.stringify(codigo)}: ${r.body}`).toBe(422);
      expect((j(r).error.details as { path: string }[]).map((d) => d.path), JSON.stringify(codigo)).toEqual(["codigo_tpag"]);
    }
    const sem = await post({ forma_pagamento_id: SISTEMA });
    expect(sem.statusCode, sem.body).toBe(422);
    expect((j(sem).error.details as { path: string }[]).map((d) => d.path)).toEqual(["codigo_tpag"]);
    const semForma = await post({ codigo_tpag: "05" });
    expect(semForma.statusCode, semForma.body).toBe(422);
    expect((j(semForma).error.details as { path: string }[]).map((d) => d.path)).toEqual(["forma_pagamento_id"]);
    expect(await contar(h.demo.orgId)).toBe(antes);
  });
});

describe("uma forma por código entre as VIVAS; excluir é lógico e libera o código", () => {
  it("dois vivos com o mesmo código → 409 (índice único da 0064), nunca 500; nem pelo POST, nem pelo PUT", async () => {
    const a = await post({ codigo_tpag: "16", forma_pagamento_id: SISTEMA });
    expect(a.statusCode, a.body).toBe(201);
    const b = await post({ codigo_tpag: "16", forma_pagamento_id: PROPRIA });
    expect(b.statusCode, b.body).toBe(409);
    expect(j(b).error).toMatchObject({ code: "CONFLICT", message: "Registro duplicado", details: { constraint: "ux_formas_pagamento_da_nfe_codigo_vivo" } });
    expect(await contar(h.demo.orgId, "16")).toBe(1);
    const c = await post({ codigo_tpag: "18", forma_pagamento_id: PROPRIA });
    expect(c.statusCode, c.body).toBe(201);
    const t = await put(j(c).id as string, { codigo_tpag: "16" });
    expect(t.statusCode, t.body).toBe(409);
    expect((await linha(j(c).id as string))["codigo_tpag"]).toBe("18");
  });

  it("excluir (lógico): some da lista e da ficha (404), fica no banco com deleted_at; recriar o MESMO código → 201", async () => {
    const a = await post({ codigo_tpag: "99", forma_pagamento_id: SISTEMA });
    expect(a.statusCode, a.body).toBe(201);
    const id = j(a).id as string;
    const d = await del(id);
    expect(d.statusCode, d.body).toBe(200);
    expect((await linha(id))["deleted_at"], "exclusão lógica: a linha fica, como histórico").not.toBeNull();
    expect((await get(`${URL_}/${id}`)).statusCode).toBe(404);
    const lista = j(await get(`${URL_}?codigo_tpag=99`)) as { items: { id: string }[]; total: number };
    expect(lista.total).toBe(0);
    const deNovo = await post({ codigo_tpag: "99", forma_pagamento_id: PROPRIA });
    expect(deNovo.statusCode, deNovo.body).toBe(201);
    expect(await contar(h.demo.orgId, "99"), "a excluída e a viva").toBe(2);
    const viva = j(await get(`${URL_}?codigo_tpag=99`)) as { items: { id: string; forma_pagamento_id: string }[]; total: number };
    expect(viva.items.map((x) => [x.id, x.forma_pagamento_id])).toEqual([[j(deNovo).id, PROPRIA]]);
  });
});

describe("isolamento e capacidade", () => {
  it("outra organização não vê a ligação: lista vazia, ficha/edição/exclusão → a MESMA 404; e a dela não aparece aqui", async () => {
    const minha = await post({ codigo_tpag: "10", forma_pagamento_id: SISTEMA });
    expect(minha.statusCode, minha.body).toBe(201);
    const id = j(minha).id as string;
    expect((j(await get(URL_)) as { total: number }).total, "premissa: a demo tem ligações vivas").toBeGreaterThan(0);
    const lista = await get(URL_, hOutra);
    expect(lista.statusCode, lista.body).toBe(200);
    expect(j(lista)).toMatchObject({ items: [], total: 0 });
    const ficha = await get(`${URL_}/${id}`, hOutra);
    expect(ficha.statusCode, ficha.body).toBe(404);
    const inexistente = await get(`${URL_}/00000000-0000-4000-8000-000000000318`, hOutra);
    expect(j(ficha).error, "a mesma 404 de inexistente").toEqual(j(inexistente).error);
    expect((await put(id, { forma_pagamento_id: DA_OUTRA }, hOutra)).statusCode).toBe(404);
    expect((await del(id, hOutra)).statusCode).toBe(404);
    expect(await linha(id)).toMatchObject({ forma_pagamento_id: SISTEMA, deleted_at: null });
    // a outra organização liga o MESMO código à forma dela (o índice é por organização) e não usa a forma da demo
    const dela = await post({ codigo_tpag: "10", forma_pagamento_id: DA_OUTRA }, hOutra);
    expect(dela.statusCode, dela.body).toBe(201);
    const comAMinha = await post({ codigo_tpag: "11", forma_pagamento_id: PROPRIA }, hOutra);
    expect(comAMinha.statusCode, comAMinha.body).toBe(422);
    expect(j(comAMinha).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_FORMA });
    const daDemo = j(await get(`${URL_}?codigo_tpag=10`)) as { items: { id: string }[] };
    expect(daDemo.items.map((x) => x.id)).toEqual([id]);
  });

  it("sem a permissão 'sales' → 403 na lista, na ficha, na criação, na edição e na exclusão; só 'sales.view' lê e não grava", async () => {
    const c = await post({ codigo_tpag: "12", forma_pagamento_id: SISTEMA });
    expect(c.statusCode, c.body).toBe(201);
    const id = j(c).id as string;
    const antes = await contar(h.demo.orgId);
    for (const r of [
      await get(URL_, hSemSales), await get(`${URL_}/${id}`, hSemSales), await post({ codigo_tpag: "13", forma_pagamento_id: SISTEMA }, hSemSales),
      await put(id, { forma_pagamento_id: PROPRIA }, hSemSales), await del(id, hSemSales)
    ]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(j(r).error.code).toBe("PERMISSION_DENIED");
    }
    const lista = await get(URL_, hSoVer);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((j(lista) as { items: { id: string }[] }).items.map((x) => x.id)).toContain(id);
    expect((await post({ codigo_tpag: "13", forma_pagamento_id: SISTEMA }, hSoVer)).statusCode).toBe(403);
    expect((await put(id, { forma_pagamento_id: PROPRIA }, hSoVer)).statusCode).toBe(403);
    expect((await del(id, hSoVer)).statusCode).toBe(403);
    expect(await contar(h.demo.orgId)).toBe(antes);
    expect(await linha(id)).toMatchObject({ forma_pagamento_id: SISTEMA, deleted_at: null });
  });
});
