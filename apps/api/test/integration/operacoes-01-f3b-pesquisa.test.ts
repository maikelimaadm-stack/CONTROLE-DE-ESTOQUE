import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, seedDemo, type Db } from "@agro/db";
import { CHAVES_MODULO_EMPRESA, moduloDaPermissao } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * OPERACOES-01 F3b (decisão 280) — `GET /api/produtos/pesquisa` com página, "só com saldo" e a capacidade (PS-1..PS-8).
 *
 * Os parâmetros novos (`pagina`, `com_saldo`, `controla_estoque`) são aditivos e estritos; a resposta ganha, ao fim,
 * `pagina`, `temMais` e `filtradoPorSaldo`. "Só com saldo" filtra no SQL antes do LIMIT, e SÓ para quem vê o saldo
 * do local: para qualquer outro o parâmetro é ignorado e a resposta é idêntica à do pedido sem ele (sem oráculo do
 * saldo). A capacidade mora em `GET /api/produtos/pesquisa/capacidades`. O contrato de antes continua provado, sem
 * edição, por `anexos-pesquisa-01-pesquisa.test.ts` (PQ-1..PQ-6).
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
type Item = { id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null; estoque: string | null };
type Pesquisa = { itens: Item[]; estoqueDoArmazem: boolean; pagina: number; temMais: boolean; filtradoPorSaldo: boolean };
type Produto = { id: string; code: string };
const TAG = `F3b${Math.random().toString(36).slice(2, 7)}`;
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;
const pesquisar = (qs: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url: `/api/produtos/pesquisa?${qs}`, headers });
async function ok(qs: string, headers?: Hdr): Promise<Pesquisa> { const r = await pesquisar(qs, headers); expect(r.statusCode, `${qs}: ${r.body}`).toBe(200); return r.json() as Pesquisa; }
const idsDe = (p: Pesquisa) => p.itens.map((x) => x.id);

let grupo: string; let unidade: string; let categoria: string;
let outraOrg: { armazem: string };
/**
 * `com`: vê produtos e estoque, só a empresa 1 (a do local W), em todos os módulos. `sem`: só produtos, mesma empresa.
 * `misto`: vê produtos e estoque; no ESTOQUE só a empresa 1, nos outros módulos as duas — o local da empresa 2 passa
 * pela RLS (o módulo da pesquisa é indefinido: a união das empresas visíveis) e só o escopo de estoque o recusa.
 */
let com: Hdr; let sem: Hdr; let misto: Hdr;
type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
async function produto(description: string, extra: Record<string, unknown> = {}, headers: Hdr = h.headers()): Promise<Produto> {
  const r = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: { ...headers, "content-type": "application/json" }, payload: { description, group_id: grupo, measurement_id: unidade, control_stock: false, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  const id = (r.json() as { id: string }).id;
  const code = (await admin.query<{ code: string }>("select code::text as code from erp.products where id=$1", [id])).rows[0]!.code;
  return { id, code };
}
/** Produto que CONTROLA estoque: o banco exige a natureza de custo analítica (`chk_product_fin_cat`). */
const controlado = (description: string) => produto(description, { control_stock: true, financial_category_id: categoria });
async function membro(nome: string, perms: string[], escopos: readonly Escopo[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@f3b.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escopos } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
const premissa = (id: string | undefined): string => { if (!id) throw new Error("premissa: local do seed"); return id; };
/** Saldo gravado pela conexão TESTEMUNHA (superusuário), como no PQ-4: o teste mede a leitura, não o lançamento. */
const saldo = (wh: string | undefined, prod: string, lote: string, q: string) =>
  admin.query("insert into erp.stock_balances (organization_id, warehouse_id, product_id, provider_lot, quantity, average_cost, total_value) values ($1,$2,$3,$4,$5,1,$5)", [h.demo.orgId, premissa(wh), prod, lote, q]);
/** Soma por produto e local, lida pela testemunha (a premissa de cada cenário). */
async function somas(produtos: string[]): Promise<Record<string, string>> {
  const r = await admin.query<{ chave: string; soma: string }>(
    "select product_id::text || '@' || warehouse_id::text as chave, round(sum(quantity), 4)::text as soma from erp.stock_balances where product_id = any($1::uuid[]) group by product_id, warehouse_id", [produtos]);
  return Object.fromEntries(r.rows.map((x) => [x.chave, x.soma]));
}

/**
 * O cenário das saídas, com descrições que ordenam A < B < C < D < E. W = `I.warehouse` (empresa 1), W2 =
 * `I.warehouse2` (outro local da MESMA empresa).
 *   A controla, saldo 2 + 1 em dois lotes em W  → passa ("3.0000")
 *   B controla, linha de saldo 0 em W           → não passa
 *   C controla, saldo 100 só em W2              → não passa em W
 *   D NÃO controla, sem saldo                   → passa (não tem saldo a conferir; "0.0000")
 *   E controla, lotes +5 e −5 em W               → não passa (o saldo é a SOMA dos lotes, não "algum lote > 0")
 */
async function cenario(T: string) {
  const a = await controlado(`${T} A com saldo`);
  const b = await controlado(`${T} B saldo zero`);
  const c = await controlado(`${T} C saldo noutro local`);
  const d = await produto(`${T} D sem controle`);
  const e = await controlado(`${T} E lotes que se anulam`);
  await saldo(I.warehouse, a.id, "L1", "2"); await saldo(I.warehouse, a.id, "L2", "1");
  await saldo(I.warehouse, b.id, "", "0");
  await saldo(I.warehouse2, c.id, "", "100");
  await saldo(I.warehouse, e.id, "L1", "5"); await saldo(I.warehouse, e.id, "L2", "-5");
  // premissas, lidas pela testemunha: quem controla estoque e quanto há em cada local
  const todos = [a, b, c, d, e].map((x) => x.id);
  const ctl = await admin.query<{ id: string; control_stock: boolean }>("select id::text as id, control_stock from erp.products where id = any($1::uuid[])", [todos]);
  expect(Object.fromEntries(ctl.rows.map((x) => [x.id, x.control_stock]))).toEqual({ [a.id]: true, [b.id]: true, [c.id]: true, [d.id]: false, [e.id]: true });
  expect(await somas(todos)).toEqual({ [`${a.id}@${I.warehouse}`]: "3.0000", [`${b.id}@${I.warehouse}`]: "0.0000", [`${c.id}@${I.warehouse2}`]: "100.0000", [`${e.id}@${I.warehouse}`]: "0.0000" });
  return { a, b, c, d, e, todos };
}

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  grupo = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' order by code limit 1", [h.demo.orgId])).rows[0]!.id;
  unidade = (await admin.query<{ id: string }>("select id from erp.measurement_units where (organization_id=$1 or organization_id is null) order by symbol limit 1", [h.demo.orgId])).rows[0]!.id;
  const cat = (await admin.query<{ id: string; kind: string }>("select id::text as id, kind from erp.financial_categories where id=$1", [I.category])).rows[0]!;
  expect(cat.kind, "premissa: a natureza de custo do seed é analítica").toBe("analytic");
  categoria = cat.id;
  const o = await seedDemo(admin, { orgName: "[TEST] Org F3b", adminEmail: "admin-f3b@demo.local", adminPassword: "Demo@12345", slug: "orgf3b" }, () => {});
  const armazem = (await admin.query<{ id: string }>("select id::text as id from erp.warehouses where organization_id=$1 order by initials limit 1", [o.orgId])).rows[0]!.id;
  outraOrg = { armazem };
  com = await membro("Pesquisa F3b Estoque", ["products.view", "stocks.view"], escoposDeTodosOsModulos([I.empresa]));
  sem = await membro("Pesquisa F3b Sem Estoque", ["products.view"], escoposDeTodosOsModulos([I.empresa]));
  // premissa do `misto`: o saldo responde ao módulo de ESTOQUE; a pesquisa (products.view, cadastro da organização)
  // não tem módulo — a RLS responde pela união das empresas visíveis
  expect([moduloDaPermissao("stocks.view"), moduloDaPermissao("products.view")]).toEqual(["estoque", null]);
  misto = await membro("Pesquisa F3b Misto", ["products.view", "stocks.view"], CHAVES_MODULO_EMPRESA.map((modulo) =>
    ({ modulo, modo: "selecionadas" as const, empresas: modulo === "estoque" ? [I.empresa] : [I.empresa, I.empresa2] })));
  // premissa: W e W2 são da empresa 1 (no escopo de estoque dos três membros); o local da empresa 2 (WE2) fica FORA
  const empresaDe = async (w: string | undefined) => (await admin.query<{ e: string }>("select empresa_id::text as e from erp.warehouses where id=$1", [premissa(w)])).rows[0]!.e;
  expect([await empresaDe(I.warehouse), await empresaDe(I.warehouse2), await empresaDe(I.warehouseEmpresa2)]).toEqual([I.empresa, I.empresa, I.empresa2]);
  expect(I.empresa2).not.toBe(I.empresa);
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PS-1 — a capacidade: GET /api/produtos/pesquisa/capacidades", () => {
  it("declara { pesquisaDeProdutos: 1 } a qualquer membro autenticado; sem sessão, 401", async () => {
    const so = await membro("Pesquisa F3b Só Produtos", ["products.view"], escoposDeTodosOsModulos([I.empresa]));
    // premissa: o membro está autenticado e NÃO tem stocks.view
    const contexto = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: so });
    expect(contexto.statusCode, contexto.body).toBe(200);
    const perms = (contexto.json() as { permissions: string[] }).permissions;
    expect(perms).toContain("products.view");
    expect(perms).not.toContain("stocks.view");
    for (const headers of [h.headers(), so]) {
      const r = await h.app.inject({ method: "GET", url: "/api/produtos/pesquisa/capacidades", headers });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ capacidades: { pesquisaDeProdutos: 1 } });
      expect(r.body).toBe('{"capacidades":{"pesquisaDeProdutos":1}}');
    }
    const anonimo = await h.app.inject({ method: "GET", url: "/api/produtos/pesquisa/capacidades", headers: { "x-org-id": h.demo.orgId } });
    expect(anonimo.statusCode, anonimo.body).toBe(401);
  });
});

describe("PS-2 — query estrita nos parâmetros novos: 422", () => {
  it("pagina só em dígitos canônicos de 1 a 1000; com_saldo e controla_estoque só true|false; com_saldo=true exige armazem_id", async () => {
    const base = `busca=${TAG}`;
    // premissa: a mesma query sem o parâmetro novo responde 200
    expect((await pesquisar(base)).statusCode).toBe(200);
    expect((await pesquisar(`${base}&armazem_id=${I.warehouse}`)).statusCode).toBe(200);
    const recusas = [
      "pagina=0", "pagina=1001", "pagina=1.5", "pagina=1e1", "pagina=%202", "pagina=01", "pagina=", "pagina=-1", "pagina=1&pagina=2",
      "com_saldo=1", "com_saldo=sim", "com_saldo=True", "com_saldo=true", `com_saldo=true&com_saldo=true&armazem_id=${I.warehouse}`,
      "controla_estoque=1", "controla_estoque=TRUE", "controla_estoque=true&controla_estoque=false"
    ];
    for (const qs of recusas) {
      const r = await pesquisar(`${base}&${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
      expect((r.json() as { error: { code: string } }).error.code, qs).toBe("VALIDATION_ERROR");
    }
    // a recusa cruzada diz qual parâmetro e por quê
    const cruzada = await pesquisar(`${base}&com_saldo=true`);
    expect((cruzada.json() as { error: { details: unknown } }).error.details).toEqual([{ path: "com_saldo", message: "com_saldo exige armazem_id" }]);
    for (const qs of ["pagina=1", "pagina=1000", "com_saldo=false", `com_saldo=true&armazem_id=${I.warehouse}`, "controla_estoque=false", "controla_estoque=true"]) {
      const r = await pesquisar(`${base}&${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(200);
    }
    expect((await ok(`${base}&pagina=1000`)).pagina).toBe(1000);
  });
});

describe("PS-3 — saída 'só com saldo' para quem vê o saldo do local", () => {
  it("com_saldo=true traz só quem controla com saldo > 0 em W e quem não controla; com_saldo=false é o pedido sem ele", async () => {
    const T = `${TAG}s`;
    const p = await cenario(T);
    const qs = `busca=${T}&armazem_id=${I.warehouse}`;
    // premissa: sem o filtro, o membro que vê estoque acha os cinco, com o saldo de W
    const semFiltro = await pesquisar(qs, com);
    const todos = JSON.parse(semFiltro.body) as Pesquisa;
    expect(todos.itens.map((x) => [x.id, x.estoque])).toEqual([[p.a.id, "3.0000"], [p.b.id, "0.0000"], [p.c.id, "0.0000"], [p.d.id, "0.0000"], [p.e.id, "0.0000"]]);
    expect(todos).toMatchObject({ estoqueDoArmazem: true, filtradoPorSaldo: false, pagina: 1, temMais: false });

    const filtrado = await ok(`${qs}&com_saldo=true`, com);
    expect(filtrado.itens.map((x) => [x.id, x.estoque])).toEqual([[p.a.id, "3.0000"], [p.d.id, "0.0000"]]);
    expect(filtrado).toMatchObject({ estoqueDoArmazem: true, filtradoPorSaldo: true, pagina: 1, temMais: false });
    // o dono (vê tudo) filtra igual
    expect(idsDe(await ok(`${qs}&com_saldo=true`))).toEqual([p.a.id, p.d.id]);
    // com_saldo=false é, byte a byte, o pedido sem o parâmetro
    expect((await pesquisar(`${qs}&com_saldo=false`, com)).body).toBe(semFiltro.body);

    // página vazia COM o filtro: o local é visível, e a resposta diz isso (a tela mantém o controle e explica o vazio)
    const zero = `busca=${encodeURIComponent(`${T} zero`)}&armazem_id=${I.warehouse}`;
    expect(idsDe(await ok(zero, com)), "premissa: a busca acha B sem o filtro").toEqual([p.b.id]);
    expect(await ok(`${zero}&com_saldo=true`, com)).toEqual({ itens: [], estoqueDoArmazem: true, pagina: 1, temMais: false, filtradoPorSaldo: true });
  });
});

describe("PS-4 — sem oráculo: para quem não vê o saldo do local, com_saldo é ignorado", () => {
  it("sem stocks.view, empresa fora do escopo (também só no de estoque), outra organização, local excluído e inexistente: corpo idêntico ao sem com_saldo, e iguais entre si", async () => {
    const T = `${TAG}v`;
    const p = await cenario(T);
    const qs = `busca=${T}`;
    // o local da OUTRA empresa também tem saldo de A: lá o filtro, se valesse, também esconderia B, C e E
    await saldo(I.warehouseEmpresa2, p.a.id, "", "9");
    // um local da empresa 1 (no escopo de `com`) com saldo de A, que será EXCLUÍDO
    const excluido = (await admin.query<{ id: string }>("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id::text as id",
      [h.demo.orgId, I.empresa, `F3B${unico()}`, `${T} local que será excluído`])).rows[0]!.id;
    await saldo(excluido, p.a.id, "", "4");

    // premissas: quem VÊ o saldo filtra — `com` e `misto` em W, `com` no local ainda vivo, o dono no local da outra
    // empresa
    expect(idsDe(await ok(`${qs}&armazem_id=${I.warehouse}&com_saldo=true`, com))).toEqual([p.a.id, p.d.id]);
    expect(idsDe(await ok(`${qs}&armazem_id=${I.warehouse}&com_saldo=true`, misto))).toEqual([p.a.id, p.d.id]);
    expect(idsDe(await ok(`${qs}&armazem_id=${excluido}&com_saldo=true`, com))).toEqual([p.a.id, p.d.id]);
    expect(idsDe(await ok(`${qs}&armazem_id=${I.warehouseEmpresa2}&com_saldo=true`))).toEqual([p.a.id, p.d.id]);
    await admin.query("update erp.warehouses set deleted_at = now() where id=$1", [excluido]);
    // premissas dos outros "nãos", lidas pela testemunha: o da outra organização existe; o inexistente não
    expect((await admin.query("select 1 from erp.warehouses where id=$1 and organization_id<>$2", [outraOrg.armazem, h.demo.orgId])).rowCount).toBe(1);
    expect((await admin.query("select 1 from erp.warehouses where id=$1", [NAO_ACHADO])).rowCount).toBe(0);

    const naos: [string, Hdr, string][] = [
      ["sem stocks.view", sem, premissa(I.warehouse)],
      ["empresa fora do escopo", com, premissa(I.warehouseEmpresa2)],
      ["empresa fora do escopo de ESTOQUE, visível em outro módulo", misto, premissa(I.warehouseEmpresa2)],
      ["outra organização", com, outraOrg.armazem],
      ["local excluído", com, excluido],
      ["inexistente", com, NAO_ACHADO]
    ];
    const corpos: string[] = [];
    for (const [nome, headers, armazem] of naos) {
      const semParametro = await pesquisar(`${qs}&armazem_id=${armazem}`, headers);
      const comParametro = await pesquisar(`${qs}&armazem_id=${armazem}&com_saldo=true`, headers);
      expect(comParametro.statusCode, `${nome}: ${comParametro.body}`).toBe(200);
      expect(comParametro.body, nome).toBe(semParametro.body);
      corpos.push(comParametro.body);
    }
    for (const c of corpos) expect(c).toBe(corpos[0]);
    const nao = JSON.parse(corpos[0]!) as Pesquisa;
    expect(nao).toMatchObject({ estoqueDoArmazem: false, filtradoPorSaldo: false, pagina: 1, temMais: false });
    // nenhum some, e nenhum saldo sai
    expect(idsDe(nao)).toEqual(p.todos);
    for (const x of nao.itens) expect(x.estoque).toBeNull();
  });
});

describe("PS-5 — página no servidor: pagina, temMais e o filtro antes do LIMIT", () => {
  it("cinco produtos em páginas de 2; com o filtro, a página não sai curta", async () => {
    const T = `${TAG}p`;
    const cinco: Produto[] = [];
    for (const letra of ["A", "B", "C", "D", "E"]) cinco.push(await produto(`${T} ${letra}`));
    const lista = await ok(`busca=${T}&limite=50`);
    expect(idsDe(lista), "premissa: os cinco, na ordem da descrição").toEqual(cinco.map((x) => x.id));
    const paginas: Pesquisa[] = [];
    for (let n = 1; n <= 4; n++) paginas.push(await ok(`busca=${T}&limite=2&pagina=${n}`));
    expect(paginas.map((x) => [x.pagina, x.itens.length, x.temMais])).toEqual([[1, 2, true], [2, 2, true], [3, 1, false], [4, 0, false]]);
    expect(paginas.flatMap(idsDe)).toEqual(idsDe(lista));
    // sem `pagina` é a página 1
    expect((await pesquisar(`busca=${T}&limite=2`)).body).toBe((await pesquisar(`busca=${T}&limite=2&pagina=1`)).body);

    // filtro: 1, 3 e 5 com saldo em W; 2 e 4 controlam sem saldo — intercalados, para que um filtro DEPOIS do LIMIT
    // deixasse a página 1 com um só
    const U = `${TAG}q`;
    const f: Produto[] = [];
    for (const letra of ["A", "B", "C", "D", "E"]) f.push(await controlado(`${U} ${letra}`));
    await saldo(I.warehouse, f[0]!.id, "", "1"); await saldo(I.warehouse, f[2]!.id, "", "2"); await saldo(I.warehouse, f[4]!.id, "", "3");
    const qs = `busca=${U}&limite=2&armazem_id=${I.warehouse}`;
    expect(idsDe(await ok(qs, com)), "premissa: sem o filtro, a página 1 tem um produto sem saldo").toEqual([f[0]!.id, f[1]!.id]);
    const p1 = await ok(`${qs}&com_saldo=true&pagina=1`, com);
    expect(p1.itens.map((x) => [x.id, x.estoque])).toEqual([[f[0]!.id, "1.0000"], [f[2]!.id, "2.0000"]]);
    expect(p1).toMatchObject({ pagina: 1, temMais: true, filtradoPorSaldo: true });
    const p2 = await ok(`${qs}&com_saldo=true&pagina=2`, com);
    expect(p2.itens.map((x) => [x.id, x.estoque])).toEqual([[f[4]!.id, "3.0000"]]);
    expect(p2).toMatchObject({ pagina: 2, temMais: false, filtradoPorSaldo: true });
  });
});

describe("PS-6 — controla_estoque=true: só produto que controla estoque", () => {
  it("tira quem não controla; combinado com o saldo, só quem controla e tem saldo", async () => {
    const T = `${TAG}c`;
    const p = await cenario(T);
    // premissa: sem o parâmetro, D (que não controla) aparece
    expect(idsDe(await ok(`busca=${T}`, com))).toEqual(p.todos);
    expect(idsDe(await ok(`busca=${T}&controla_estoque=true`, com))).toEqual([p.a.id, p.b.id, p.c.id, p.e.id]);
    expect(idsDe(await ok(`busca=${T}&controla_estoque=true&com_saldo=true&armazem_id=${I.warehouse}`, com))).toEqual([p.a.id]);
    // controla_estoque=false é o pedido sem ele
    expect((await pesquisar(`busca=${T}&controla_estoque=false`, com)).body).toBe((await pesquisar(`busca=${T}`, com)).body);
  });
});

describe("PS-7 — consultas fixas: com o filtro, o local, os produtos e os saldos; nunca N+1", () => {
  async function contar(qs: string, headers: Hdr): Promise<{ produtos: number; armazens: number; saldos: number; itens: number; filtradoPorSaldo: boolean }> {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const r = await ok(qs, headers);
      const sqls = espiao.mock.calls.map((c) => c[0]).filter((x): x is string => typeof x === "string");
      const de = (forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
      return { produtos: de(/from erp\.products\b/), armazens: de(/from erp\.warehouses\b/), saldos: de(/erp\.stock_balances\b/), itens: r.itens.length, filtradoPorSaldo: r.filtradoPorSaldo };
    } finally { espiao.mockRestore(); }
  }
  it("2 e 12 produtos: as mesmas contagens; sem com_saldo, nenhuma consulta nova", async () => {
    const P = `${TAG}x`; const G = `${TAG}y`;
    for (let i = 0; i < 2; i++) { const x = await controlado(`${P} ${i}`); await saldo(I.warehouse, x.id, "", "1"); }
    for (let i = 0; i < 12; i++) { const x = await controlado(`${G} ${i}`); await saldo(I.warehouse, x.id, "", "1"); }
    const filtro = `armazem_id=${I.warehouse}&com_saldo=true&limite=50`;
    const poucos = await contar(`busca=${P}&${filtro}`, com);
    const muitos = await contar(`busca=${G}&${filtro}`, com);
    // premissa: as duas buscas passaram pelo filtro e trouxeram 2 e 12
    expect([poucos.itens, muitos.itens, poucos.filtradoPorSaldo, muitos.filtradoPorSaldo]).toEqual([2, 12, true, true]);
    // Q0 (o local), Q1 (produtos, com o saldo no WHERE) e Q2 (saldos, com o mesmo local): três consultas fixas
    expect(poucos).toMatchObject({ produtos: 1, armazens: 2, saldos: 2 });
    expect({ ...muitos, itens: 0 }).toEqual({ ...poucos, itens: 0 });
    // sem com_saldo, as consultas de antes: produtos e saldos (o local conferido DENTRO da de saldos)
    const antes = await contar(`busca=${G}&armazem_id=${I.warehouse}&limite=50`, com);
    expect(antes).toEqual({ produtos: 1, armazens: 1, saldos: 1, itens: 12, filtradoPorSaldo: false });
    // quem não vê estoque: com_saldo não dispara consulta alguma ao local nem aos saldos
    const semVer = await contar(`busca=${G}&${filtro}`, sem);
    expect(semVer).toEqual({ produtos: 1, armazens: 0, saldos: 0, itens: 12, filtradoPorSaldo: false });
    // quem vê estoque, com um local que NÃO vê (fora do escopo, de outra organização, inexistente): Q0 roda do mesmo
    // jeito, visível ou não — o local, os produtos (sem o filtro) e os saldos (sem linha): três consultas, como no
    // local visível acima, nunca uma a menos para o "não"
    for (const invisivel of [premissa(I.warehouseEmpresa2), outraOrg.armazem, NAO_ACHADO]) {
      const n = await contar(`busca=${G}&armazem_id=${invisivel}&com_saldo=true&limite=50`, com);
      expect(n, `local invisível ${invisivel}`).toEqual({ produtos: 1, armazens: 2, saldos: 1, itens: 12, filtradoPorSaldo: false });
    }
  });
});

describe("PS-8 — o contrato de antes, sem parâmetro novo", () => {
  it("as chaves na ordem, pagina 1, sem filtro; itens e estoqueDoArmazem como antes", async () => {
    const T = `${TAG}k`;
    const comSaldo = await controlado(`${T} A com saldo`);
    const semSaldo = await produto(`${T} B sem saldo`);
    await saldo(I.warehouse, comSaldo.id, "", "5");
    const r = await pesquisar(`busca=${T}&armazem_id=${I.warehouse}`, com);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = JSON.parse(r.body) as Pesquisa;
    expect(Object.keys(corpo)).toEqual(["itens", "estoqueDoArmazem", "pagina", "temMais", "filtradoPorSaldo"]);
    for (const x of corpo.itens) expect(Object.keys(x)).toEqual(["id", "codigo", "descricao", "referencia", "unidade", "estoque"]);
    expect(corpo).toMatchObject({ estoqueDoArmazem: true, pagina: 1, temMais: false, filtradoPorSaldo: false });
    // o produto sem saldo aparece (sem filtro), com "0.0000" — o local é visível
    expect(corpo.itens.map((x) => [x.id, x.codigo, x.descricao, x.estoque])).toEqual([[comSaldo.id, comSaldo.code, `${T} A com saldo`, "5.0000"], [semSaldo.id, semSaldo.code, `${T} B sem saldo`, "0.0000"]]);
    // sem local: estoque nulo e estoqueDoArmazem falso, como antes
    const semLocal = await ok(`busca=${T}`, com);
    expect(semLocal).toMatchObject({ estoqueDoArmazem: false, pagina: 1, temMais: false, filtradoPorSaldo: false });
    expect(semLocal.itens.map((x) => [x.id, x.estoque])).toEqual([[comSaldo.id, null], [semSaldo.id, null]]);
  });
});
