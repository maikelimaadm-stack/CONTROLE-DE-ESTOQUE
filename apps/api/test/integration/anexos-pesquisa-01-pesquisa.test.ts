import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, seedDemo, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ANEXOS-PESQUISA-01 · item 2.2 — `GET /api/produtos/pesquisa` (PQ-1..PQ-6).
 * Busca por palavras (código começa com, descrição e referência contêm; E entre palavras; `%`/`_` literais), só
 * produto ativo, vivo e da organização; unidade = `measurement_id_label` da ficha; estoque só com `stocks.view` e
 * armazém visível, e todo "não" responde igual; query estrita; UMA consulta de produtos e UMA de saldos.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
type Item = { id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null; estoque: string | null };
type Pesquisa = { itens: Item[]; estoqueDoArmazem: boolean };
const TAG = `Pq${Math.random().toString(36).slice(2, 7)}`;
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;
const pesquisar = (qs: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url: `/api/produtos/pesquisa?${qs}`, headers });
async function ok(qs: string, headers?: Hdr): Promise<Pesquisa> { const r = await pesquisar(qs, headers); expect(r.statusCode, r.body).toBe(200); return r.json() as Pesquisa; }

let grupo: string; let unidade: string; let unidadeSimbolo: string;
let outraOrg: { headers: Hdr; armazem: string };
async function produto(description: string, extra: Record<string, unknown> = {}, headers: Hdr = h.headers(), g = grupo, u = unidade): Promise<{ id: string; code: string }> {
  const r = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: { ...headers, "content-type": "application/json" }, payload: { description, group_id: g, measurement_id: u, control_stock: false, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  const id = (r.json() as { id: string }).id;
  const code = (await admin.query<{ code: string }>("select code::text as code from erp.products where id=$1", [id])).rows[0]!.code;
  return { id, code };
}
async function membro(nome: string, perms: string[], empresas: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@ap01.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
const premissa = (id: string | undefined): string => { if (!id) throw new Error("premissa: armazém do seed"); return id; };
const saldo = (wh: string | undefined, prod: string, lote: string, q: string, org = h.demo.orgId) =>
  admin.query("insert into erp.stock_balances (organization_id, warehouse_id, product_id, provider_lot, quantity, average_cost, total_value) values ($1,$2,$3,$4,$5,1,$5)", [org, premissa(wh), prod, lote, q]);

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  grupo = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' order by code limit 1", [h.demo.orgId])).rows[0]!.id;
  const u = (await admin.query<{ id: string; symbol: string }>("select id, symbol from erp.measurement_units where (organization_id=$1 or organization_id is null) order by symbol limit 1", [h.demo.orgId])).rows[0]!;
  unidade = u.id; unidadeSimbolo = u.symbol;
  const o = await seedDemo(admin, { orgName: "[TEST] Org AP01", adminEmail: "admin-ap01@demo.local", adminPassword: "Demo@12345", slug: "orgap01" }, () => {});
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-ap01@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  const headers = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId };
  const armazem = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 order by initials limit 1", [o.orgId])).rows[0]!.id;
  outraOrg = { headers, armazem };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PQ-1 — código (começo), descrição e referência (pedaço); palavras com E; % e _ literais", () => {
  it("cada campo acha; duas palavras exigem as duas; curingas são texto", async () => {
    const a = await produto(`${TAG} Adubo Azul`, { reference: `REFX-${TAG}-99` });
    const b = await produto(`${TAG} Adubo Verde`);
    const pct = await produto(`${TAG} desconto 50%off`);
    const pctX = await produto(`${TAG} desconto 50Xoff`);
    const sub = await produto(`${TAG} peca a_b`);
    const subX = await produto(`${TAG} peca aXb`);
    const idsDe = (p: Pesquisa) => p.itens.map((x) => x.id).sort();
    // código: começa com (o código inteiro também é começo)
    expect((await ok(`busca=${encodeURIComponent(a.code)}`)).itens[0]!.id).toBe(a.id);
    // código: pedaço do meio NÃO acha pelo código (só pelo começo)
    if (a.code.length > 2) expect((await ok(`busca=${encodeURIComponent(a.code.slice(1))}${encodeURIComponent(` ${TAG}`)}&limite=50`)).itens.map((x) => x.id)).not.toContain(a.id);
    // descrição: pedaço, sem diferenciar maiúsculas
    expect(idsDe(await ok(`busca=${encodeURIComponent(`${TAG.toUpperCase()} dubo`)}&limite=50`))).toEqual([a.id, b.id].sort());
    // referência: pedaço
    const porRef = await ok(`busca=${encodeURIComponent(`${TAG}-9`)}`);
    expect(porRef.itens.map((x) => x.id)).toEqual([a.id]);
    expect(porRef.itens[0]!.referencia).toBe(`REFX-${TAG}-99`);
    // E entre palavras
    expect(idsDe(await ok(`busca=${encodeURIComponent(`${TAG} azul`)}`))).toEqual([a.id]);
    expect((await ok(`busca=${encodeURIComponent(`${TAG} azul verde`)}`)).itens).toEqual([]);
    // % e _ literais
    expect(idsDe(await ok(`busca=${encodeURIComponent(`${TAG} 50%`)}`))).toEqual([pct.id]);
    expect(idsDe(await ok(`busca=${encodeURIComponent(`${TAG} a_b`)}`))).toEqual([sub.id]);
    expect(pctX.id).not.toBe(pct.id); expect(subX.id).not.toBe(sub.id);
    // sem referência → null
    expect((await ok(`busca=${encodeURIComponent(`${TAG} verde`)}`)).itens[0]!.referencia).toBeNull();
  });
});

describe("PQ-2 — inativo, excluído, outra organização não aparecem; limite e ordem", () => {
  it("filtra, limita e ordena (código igual primeiro, depois descrição)", async () => {
    const T = `${TAG}o`;
    const ativo = await produto(`${T} Bbb ativo`);
    const inativo = await produto(`${T} Aaa inativo`, { is_active: false });
    const excluido = await produto(`${T} Aaa excluido`);
    const del = await h.app.inject({ method: "DELETE", url: `/api/resources/products/${excluido.id}`, headers: h.headers() });
    expect(del.statusCode, del.body).toBe(200);
    const g2 = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=(select organization_id from erp.warehouses where id=$1) and kind='analytic' order by code limit 1", [outraOrg.armazem])).rows[0]!.id;
    const deLa = await produto(`${T} Aaa outra org`, {}, outraOrg.headers, g2, unidade);
    const r = await ok(`busca=${T}&limite=50`);
    expect(r.itens.map((x) => x.id)).toEqual([ativo.id]);
    for (const nao of [inativo.id, excluido.id, deLa.id]) expect(r.itens.map((x) => x.id)).not.toContain(nao);

    const U = `${TAG}u`;
    const c = await produto(`${U} Ccc`); const bb = await produto(`${U} Bbb`); const aa = await produto(`${U} Aaa`);
    expect((await ok(`busca=${U}`)).itens.map((x) => x.id)).toEqual([aa.id, bb.id, c.id]);
    expect((await ok(`busca=${U}&limite=2`)).itens.map((x) => x.id)).toEqual([aa.id, bb.id]);
    // código igual ao texto vem antes da ordem por descrição
    const porCodigo = await ok(`busca=${encodeURIComponent(c.code)}&limite=50`);
    expect(porCodigo.itens[0]!.id).toBe(c.id);
    // busca vazia: primeiros por descrição, padrão 20 (completa até 20 com produtos novos se o seed tiver menos)
    const vivos = async () => Number((await admin.query<{ n: string }>("select count(*)::text as n from erp.products where organization_id=$1 and deleted_at is null and is_active", [h.demo.orgId])).rows[0]!.n);
    for (let n = await vivos(); n < 21; n++) await produto(`${TAG}z preenche ${n}`);
    const vazia = await ok("");
    const pg = (await admin.query<{ id: string }>("select id::text as id from erp.products where organization_id=$1 and deleted_at is null and is_active order by description, id limit 20", [h.demo.orgId])).rows.map((x) => x.id);
    expect(pg.length, "premissa: há mais de 20 produtos vivos").toBe(20);
    expect(vazia.itens.map((x) => x.id)).toEqual(pg);
  });
});

describe("PQ-3 — unidade = measurement_id_label de GET /api/resources/products/:id", () => {
  it("mesmo rótulo da ficha", async () => {
    const p = await produto(`${TAG} unidade`);
    const ficha = await h.app.inject({ method: "GET", url: `/api/resources/products/${p.id}`, headers: h.headers() });
    expect(ficha.statusCode, ficha.body).toBe(200);
    const rotulo = (ficha.json() as { measurement_id_label: string }).measurement_id_label;
    expect(rotulo).toBe(unidadeSimbolo);
    const r = await ok(`busca=${encodeURIComponent(`${TAG} unidade`)}`);
    expect(r.itens.map((x) => x.unidade)).toEqual([rotulo]);
  });
});

describe("PQ-4 — estoque: soma dos lotes com stocks.view e armazém no escopo; os cinco 'não' idênticos", () => {
  it("soma e respostas iguais", async () => {
    const T = `${TAG}e`;
    const p1 = await produto(`${T} um`); const p2 = await produto(`${T} dois`);
    await saldo(I.warehouse, p1.id, "L1", "10.5");
    await saldo(I.warehouse, p1.id, "L2", "2.25");
    await saldo(I.warehouse2, p1.id, "", "100"); // outro armazém: não entra
    await saldo(I.warehouseEmpresa2, p2.id, "", "7");
    const com = await membro("Pesquisa Estoque", ["products.view", "stocks.view"], [I.empresa]);
    const sem = await membro("Pesquisa Sem Estoque", ["products.view"], [I.empresa]);
    const qs = `busca=${T}`;
    const sim = await ok(`${qs}&armazem_id=${I.warehouse}`, com);
    expect(sim.estoqueDoArmazem).toBe(true);
    expect(sim.itens.map((x) => [x.descricao, x.estoque])).toEqual([[`${T} dois`, "0.0000"], [`${T} um`, "12.7500"]]);
    // dono vê a outra empresa
    const dono = await ok(`${qs}&armazem_id=${I.warehouseEmpresa2}`);
    expect(dono.itens.map((x) => x.estoque)).toEqual(["7.0000", "0.0000"]);

    const naos = [
      await pesquisar(`${qs}&armazem_id=${I.warehouse}`, sem), // sem stocks.view
      await pesquisar(qs, com), // sem armazem_id
      await pesquisar(`${qs}&armazem_id=${I.warehouseEmpresa2}`, com), // empresa fora do escopo
      await pesquisar(`${qs}&armazem_id=${outraOrg.armazem}`, com), // outra organização
      await pesquisar(`${qs}&armazem_id=${NAO_ACHADO}`, com) // inexistente
    ];
    for (const r of naos) expect(r.statusCode, r.body).toBe(200);
    const corpo0 = naos[0]!.body;
    for (const r of naos) expect(r.body).toBe(corpo0);
    const nao = JSON.parse(corpo0) as Pesquisa;
    expect(nao.estoqueDoArmazem).toBe(false);
    expect(nao.itens.length).toBe(2);
    for (const x of nao.itens) expect(x.estoque).toBeNull();
  });
});

describe("PQ-5 — query estrita: 422", () => {
  it("chave desconhecida, limite 0 e 51, armazem_id malformado, busca > 100", async () => {
    for (const qs of ["xpto=1", "limite=0", "limite=51", "armazem_id=nao-e-uuid", `busca=${"a".repeat(101)}`]) {
      const r = await pesquisar(qs);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
    }
    // aparada: espaços em volta não contam para o limite de 100
    expect((await pesquisar(`busca=${encodeURIComponent(`  ${"a".repeat(100)}  `)}`)).statusCode).toBe(200);
    expect((await pesquisar("limite=50")).statusCode).toBe(200);
    expect((await pesquisar("limite=1")).statusCode).toBe(200);
  });
});

describe("PQ-6 — consultas: uma de produtos e, com estoque, uma de saldos, independente do número de produtos", () => {
  async function contar(qs: string): Promise<{ produtos: number; saldos: number; itens: number }> {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const r = await ok(qs);
      const sqls = espiao.mock.calls.map((c) => c[0]).filter((x): x is string => typeof x === "string");
      return { produtos: sqls.filter((s) => /from erp\.products\b/.test(s)).length, saldos: sqls.filter((s) => /erp\.stock_balances\b/.test(s)).length, itens: r.itens.length };
    } finally { espiao.mockRestore(); }
  }
  it("2 produtos e 12 produtos: mesmas contagens, com e sem estoque", async () => {
    const P = `${TAG}c`; const G = `${TAG}g`;
    for (let i = 0; i < 2; i++) await produto(`${P} ${i}`);
    for (let i = 0; i < 12; i++) await produto(`${G} ${i}`);
    const poucos = await contar(`busca=${P}&armazem_id=${I.warehouse}`);
    const muitos = await contar(`busca=${G}&armazem_id=${I.warehouse}`);
    expect([poucos.itens, muitos.itens]).toEqual([2, 12]);
    expect(poucos).toMatchObject({ produtos: 1, saldos: 1 });
    expect(muitos).toMatchObject({ produtos: 1, saldos: 1 });
    const semPoucos = await contar(`busca=${P}`);
    const semMuitos = await contar(`busca=${G}`);
    expect(semPoucos).toMatchObject({ produtos: 1, saldos: 0 });
    expect(semMuitos).toMatchObject({ produtos: 1, saldos: 0 });
  });
});
