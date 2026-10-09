import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { moduloDaPermissao } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-01 (decisão 305) — as rotas dos OBJETOS DO MAPA (`/api/mapa/objetos`, `erp.objetos_de_mapa`), MM-9a..MM-9d.
 *
 *   MM-9a  criar, listar (filtros area_id e tipo; paginação no servidor com total), detalhe, editar e exclusão LÓGICA
 *          (depois: detalhe 404, fora da lista, e a linha continua no banco com deleted_at — contada pela testemunha).
 *   MM-9b  cada capacidade separada (view, create, edit, delete, nenhuma → 403); outro tenant, fora do escopo, excluído
 *          e id malformado → a MESMA 404, corpo idêntico ao do inexistente.
 *   MM-9c  geometria inválida → 422 em `geometria` (o gatilho do banco julga); chave desconhecida, capacidade como
 *          número, forma que não é a do tipo, PATCH vazio → 422; área de outra empresa → 422 em `area_id`; código
 *          repetido → 409.
 *   MM-9d  CAMADA 5.2: cocho numa área de OUTRA empresa, de outra organização, excluído ou inexistente → a MESMA 422
 *          em `trough_id`; cocho sem área e cocho de área da mesma empresa → aceitos.
 *
 * O cenário é semeado pela testemunha (superusuário: `admin`), que também confere o efeito no banco.
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
type Objeto = {
  id: string; organization_id: string; empresa_id: string; area_id: string | null; tipo: string; forma: string; geometria: unknown;
  code: string | null; name: string; descricao: string | null; capacidade: string | null; unidade_capacidade: string | null;
  trough_id: string | null; is_active: boolean; created_at: string; updated_at: string;
};
type Lista = { itens: Objeto[]; total: number; page: number; pageSize: number };
type Erro = { error: { code: string; message: string; details?: { path: string; message: string }[] } };
type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };

const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
const MALFORMADO = "nao-e-um-uuid";
const PONTO = { type: "Point", coordinates: [-55.1, -15.2] };
let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;

let E1: string; let E2: string;
let areaE1: string; let areaE1Pag: string; let areaE2: string;
let outraOrg: { orgId: string; empresa: string; objeto: string; cocho: string };
let cochoSemArea: string; let cochoAreaE1: string; let cochoAreaE2: string; let cochoExcluido: string;

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: Hdr = h.headers(), payload?: unknown) =>
  h.app.inject({ method, url, headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
async function criar(corpo: Record<string, unknown>, headers: Hdr = h.headers()): Promise<Objeto> {
  const r = await req("POST", "/api/mapa/objetos", headers, corpo);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Objeto;
}
const cocho = (extra: Record<string, unknown> = {}) => ({ empresa_id: E1, tipo: "cocho", geometria: PONTO, name: `Cocho ${unico()}`, ...extra });
const erro = (body: string) => JSON.parse(body) as Erro;
/** A 422 com o caminho do campo: código, e o `path` em details. */
function recusadoEm(r: { statusCode: number; body: string }, path: string): Erro {
  expect(r.statusCode, r.body).toBe(422);
  const e = erro(r.body);
  expect(e.error.code).toBe("VALIDATION_ERROR");
  expect(e.error.details?.map((d) => d.path)).toEqual([path]);
  return e;
}

async function area(empresa: string, nome: string, org = h.demo.orgId): Promise<string> {
  return (await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
     values ($1,$2,$3,$4,10,10,'pastagem','ativa','propria') returning id::text as id`, [org, empresa, `MM9-${unico()}`, nome])).rows[0]!.id;
}
async function cochoCadastrado(areaId: string | null, org = h.demo.orgId, excluido = false): Promise<string> {
  return (await admin.query<{ id: string }>(
    `insert into erp.troughs (organization_id, code, type, description, area_id, deleted_at)
     values ($1,$2,'covered','Cocho cadastrado MM9',$3, case when $4 then now() end) returning id::text as id`, [org, `MM9-${unico()}`, areaId, excluido])).rows[0]!.id;
}
async function membro(nome: string, perms: string[], escopos: readonly Escopo[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@mm9.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escopos } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
/** Linhas na tabela (testemunha, sem RLS): vivas e excluídas por id. */
async function noBanco(id: string): Promise<{ vivo: boolean; name: string; trough_id: string | null; geometria: unknown } | null> {
  const r = await admin.query<{ vivo: boolean; name: string; trough_id: string | null; geometria: unknown }>(
    "select deleted_at is null as vivo, name, trough_id::text as trough_id, geometria from erp.objetos_de_mapa where id=$1", [id]);
  return r.rows[0] ?? null;
}
const contarPorNome = async (name: string) => Number((await admin.query<{ n: string }>("select count(*) n from erp.objetos_de_mapa where name=$1", [name])).rows[0]!.n);

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2, "premissa: duas empresas no seed").toBeTruthy();
  expect(E1).not.toBe(E2);
  expect(moduloDaPermissao("map_objects.view"), "premissa: o módulo de escopo é pecuária").toBe("pecuaria");
  areaE1 = await area(E1, "Piquete MM9 E1");
  areaE1Pag = await area(E1, "Piquete MM9 paginação");
  areaE2 = await area(E2, "Piquete MM9 E2");
  cochoSemArea = await cochoCadastrado(null);
  cochoAreaE1 = await cochoCadastrado(areaE1);
  cochoAreaE2 = await cochoCadastrado(areaE2);
  cochoExcluido = await cochoCadastrado(null, h.demo.orgId, true);
  const o = await seedDemo(admin, { orgName: "[TEST] Org MM9", adminEmail: "admin-mm9@demo.local", adminPassword: "Demo@12345", slug: "orgmm9" }, () => {});
  const empresaOutra = o.empresaIds[0]!;
  const objetoOutra = (await admin.query<{ id: string }>(
    `insert into erp.objetos_de_mapa (organization_id, empresa_id, tipo, forma, geometria, name)
     values ($1,$2,'cocho','ponto',$3::jsonb,'Cocho de outra organização') returning id::text as id`, [o.orgId, empresaOutra, JSON.stringify(PONTO)])).rows[0]!.id;
  outraOrg = { orgId: o.orgId, empresa: empresaOutra, objeto: objetoOutra, cocho: await cochoCadastrado(null, o.orgId) };
  // premissas lidas pela testemunha: as áreas e os cochos estão onde o cenário diz
  const areas = await admin.query<{ id: string; empresa_id: string }>("select id::text as id, empresa_id::text as empresa_id from erp.areas where id = any($1::uuid[])", [[areaE1, areaE1Pag, areaE2]]);
  expect(Object.fromEntries(areas.rows.map((a) => [a.id, a.empresa_id]))).toEqual({ [areaE1]: E1, [areaE1Pag]: E1, [areaE2]: E2 });
  const cochos = await admin.query<{ id: string; organization_id: string; area_id: string | null; vivo: boolean }>(
    "select id::text as id, organization_id::text as organization_id, area_id::text as area_id, deleted_at is null as vivo from erp.troughs where id = any($1::uuid[]) order by code", [[cochoSemArea, cochoAreaE1, cochoAreaE2, cochoExcluido, outraOrg.cocho]]);
  expect(cochos.rows.length).toBe(5);
  expect(Object.fromEntries(cochos.rows.map((c) => [c.id, [c.organization_id === h.demo.orgId, c.area_id, c.vivo]]))).toEqual({
    [cochoSemArea]: [true, null, true], [cochoAreaE1]: [true, areaE1, true], [cochoAreaE2]: [true, areaE2, true],
    [cochoExcluido]: [true, null, false], [outraOrg.cocho]: [false, null, true],
  });
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("MM-9a — criar, listar, detalhe, editar e exclusão lógica", () => {
  it("cria com os campos do contrato; a forma vem do tipo; capacidade volta como texto decimal", async () => {
    const nome = `Cocho grande ${unico()}`;
    const r = await req("POST", "/api/mapa/objetos", h.headers(), { empresa_id: E1, tipo: "cocho", geometria: PONTO, code: `CG-${unico()}`, name: nome, descricao: "perto da porteira", capacidade: "12.5", unidade_capacidade: "m", area_id: areaE1 });
    expect(r.statusCode, r.body).toBe(201);
    const o = r.json() as Objeto;
    expect(o).toMatchObject({ organization_id: h.demo.orgId, empresa_id: E1, area_id: areaE1, tipo: "cocho", forma: "ponto", geometria: PONTO, name: nome, descricao: "perto da porteira", capacidade: "12.500", unidade_capacidade: "m", trough_id: null, is_active: true });
    expect(Object.keys(o).sort()).toEqual(["area_id", "capacidade", "code", "created_at", "descricao", "empresa_id", "forma", "geometria", "id", "is_active", "name", "organization_id", "tipo", "trough_id", "unidade_capacidade", "updated_at"]);
    expect(await contarPorNome(nome)).toBe(1);
    // forma explícita igual à do tipo é aceita
    const d = await criar({ empresa_id: E1, tipo: "deposito_a_pasto", forma: "ponto", geometria: PONTO, name: `Depósito ${unico()}`, capacidade: "3", unidade_capacidade: "t" });
    expect([d.tipo, d.forma, d.capacidade]).toEqual(["deposito_a_pasto", "ponto", "3.000"]);
  });

  it("lista com filtro por área e por tipo, paginação no servidor com total e ordem estável", async () => {
    const tag = `PG${unico()}`;
    const semeados: string[] = [];
    for (let i = 0; i < 5; i++) semeados.push((await criar(cocho({ name: `${tag} cocho ${i}`, area_id: areaE1Pag }))).id);
    for (let i = 0; i < 2; i++) semeados.push((await criar({ empresa_id: E1, tipo: "deposito_a_pasto", geometria: PONTO, name: `${tag} depósito ${i}`, area_id: areaE1Pag })).id);
    // um fora da área (mesma empresa) não entra no filtro
    await criar(cocho({ name: `${tag} fora da área` }));
    const pag = (qs: string) => req("GET", `/api/mapa/objetos?${qs}`);
    const p1 = await pag(`area_id=${areaE1Pag}&pageSize=3&page=1`);
    expect(p1.statusCode, p1.body).toBe(200);
    const l1 = p1.json() as Lista;
    expect([l1.total, l1.page, l1.pageSize, l1.itens.length]).toEqual([7, 1, 3, 3]);
    const l2 = (await pag(`area_id=${areaE1Pag}&pageSize=3&page=2`)).json() as Lista;
    expect([l2.total, l2.page, l2.itens.length]).toEqual([7, 2, 3]);
    const l3 = (await pag(`area_id=${areaE1Pag}&pageSize=3&page=3`)).json() as Lista;
    expect([l3.total, l3.itens.length]).toEqual([7, 1]);
    const todos = [...l1.itens, ...l2.itens, ...l3.itens];
    expect(new Set(todos.map((x) => x.id)).size).toBe(7);
    expect(todos.map((x) => x.id).sort()).toEqual([...semeados].sort());
    // ordem estável: por nome
    expect(todos.map((x) => x.name)).toEqual([...todos.map((x) => x.name)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(todos.every((x) => x.area_id === areaE1Pag)).toBe(true);
    const dep = (await pag(`area_id=${areaE1Pag}&tipo=deposito_a_pasto`)).json() as Lista;
    expect([dep.total, dep.itens.length, dep.itens.every((x) => x.tipo === "deposito_a_pasto")]).toEqual([2, 2, true]);
    const coc = (await pag(`area_id=${areaE1Pag}&tipo=cocho&pageSize=100`)).json() as Lista;
    expect([coc.total, coc.itens.length]).toEqual([5, 5]);
    // a consulta é estrita: filtro desconhecido e tipo fora do catálogo → 422
    expect((await pag("cor=azul")).statusCode).toBe(422);
    expect((await pag("tipo=cerca")).statusCode).toBe(422);
    // paginação fora da forma canônica é recusada, nunca traduzida (1e1 → 10, 0x2 → 2, " 3" → 3, "2.0" → 2)
    for (const qs of ["page=1e1", "pageSize=0x2", "page=%203", "page=2.0", "page=01", "page=0", "pageSize=1001", "page=100001", "page=", "page=-1"]) {
      const r = await pag(`area_id=${areaE1Pag}&${qs}`);
      expect([qs, r.statusCode]).toEqual([qs, 422]);
    }
    // a forma canônica continua aceita no limite
    expect([(await pag(`area_id=${areaE1Pag}&pageSize=1000&page=100000`)).statusCode]).toEqual([200]);
  });

  it("detalhe, edição parcial e exclusão lógica (a linha fica no banco com deleted_at)", async () => {
    const o = await criar(cocho({ area_id: areaE1, capacidade: "1" }));
    const d = await req("GET", `/api/mapa/objetos/${o.id}`);
    expect(d.statusCode, d.body).toBe(200);
    expect((d.json() as Objeto).id).toBe(o.id);

    const novo = `Cocho renomeado ${unico()}`;
    const e = await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { name: novo, capacidade: "7.25", descricao: "coberto", area_id: null, geometria: { type: "Point", coordinates: [-54, -14] } });
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json()).toMatchObject({ id: o.id, name: novo, capacidade: "7.250", descricao: "coberto", area_id: null, tipo: "cocho", forma: "ponto", empresa_id: E1, geometria: { type: "Point", coordinates: [-54, -14] } });
    expect(await noBanco(o.id)).toEqual({ vivo: true, name: novo, trough_id: null, geometria: { type: "Point", coordinates: [-54, -14] } });

    // tipo muda: a forma acompanha (a do tipo)
    const t = await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { tipo: "deposito_a_pasto", unidade_capacidade: "t" });
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json()).toMatchObject({ tipo: "deposito_a_pasto", forma: "ponto", unidade_capacidade: "t" });

    const lista = async () => ((await req("GET", `/api/mapa/objetos?pageSize=1000`)).json() as Lista);
    const antes = await lista();
    expect(antes.itens.some((x) => x.id === o.id)).toBe(true);

    const x = await req("DELETE", `/api/mapa/objetos/${o.id}`);
    expect(x.statusCode, x.body).toBe(200);
    expect(x.json()).toEqual({ id: o.id, deleted: true });

    expect((await req("GET", `/api/mapa/objetos/${o.id}`)).statusCode).toBe(404);
    const depois = await lista();
    expect(depois.itens.some((y) => y.id === o.id)).toBe(false);
    expect(depois.total).toBe(antes.total - 1);
    // a linha continua no banco, com deleted_at (exclusão lógica, nunca física)
    const fisico = await admin.query<{ n: string; excluidas: string }>("select count(*) n, count(*) filter (where deleted_at is not null) excluidas from erp.objetos_de_mapa where id=$1", [o.id]);
    expect(fisico.rows[0]).toEqual({ n: "1", excluidas: "1" });
    // ROW COUNT: excluir de novo, ou editar o excluído, não é sucesso sem efeito
    expect((await req("DELETE", `/api/mapa/objetos/${o.id}`)).statusCode).toBe(404);
    expect((await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { name: "ressuscitado" })).statusCode).toBe(404);
    expect(await noBanco(o.id)).toMatchObject({ vivo: false, name: novo });
  });
});

describe("MM-9b — capacidade por capacidade (403) e a MESMA 404 para quem não deve saber", () => {
  const todasAsEmpresas = () => escoposDeTodosOsModulos([]);

  it("cada capacidade sozinha abre só a sua porta", async () => {
    const alvo = await criar(cocho());
    const soView = await membro("MM9 view", ["map_objects.view"], todasAsEmpresas());
    const soCreate = await membro("MM9 create", ["map_objects.create"], todasAsEmpresas());
    const soEdit = await membro("MM9 edit", ["map_objects.edit"], todasAsEmpresas());
    const soDelete = await membro("MM9 delete", ["map_objects.delete"], todasAsEmpresas());
    const nenhuma = await membro("MM9 nenhuma", ["products.view"], todasAsEmpresas());

    const status = async (headers: Hdr) => ({
      lista: (await req("GET", "/api/mapa/objetos", headers)).statusCode,
      detalhe: (await req("GET", `/api/mapa/objetos/${alvo.id}`, headers)).statusCode,
      cria: (await req("POST", "/api/mapa/objetos", headers, cocho())).statusCode,
      edita: (await req("PATCH", `/api/mapa/objetos/${alvo.id}`, headers, { descricao: `por ${unico()}` })).statusCode,
    });
    expect(await status(soView)).toEqual({ lista: 200, detalhe: 200, cria: 403, edita: 403 });
    expect((await req("DELETE", `/api/mapa/objetos/${alvo.id}`, soView)).statusCode).toBe(403);
    expect(await status(soCreate)).toEqual({ lista: 403, detalhe: 403, cria: 201, edita: 403 });
    expect((await req("DELETE", `/api/mapa/objetos/${alvo.id}`, soCreate)).statusCode).toBe(403);
    expect(await status(soEdit)).toEqual({ lista: 403, detalhe: 403, cria: 403, edita: 200 });
    expect((await req("DELETE", `/api/mapa/objetos/${alvo.id}`, soEdit)).statusCode).toBe(403);
    expect(await status(nenhuma)).toEqual({ lista: 403, detalhe: 403, cria: 403, edita: 403 });
    expect((await req("DELETE", `/api/mapa/objetos/${alvo.id}`, nenhuma)).statusCode).toBe(403);
    // o 403 é da capacidade, com o código de sempre
    const negado = erro((await req("GET", "/api/mapa/objetos", nenhuma)).body);
    expect(negado.error.code).toBe("PERMISSION_DENIED");
    // nenhuma das recusas mudou a linha
    expect(await noBanco(alvo.id)).toMatchObject({ vivo: true, name: alvo.name });
    // só delete exclui (e não edita)
    expect((await req("PATCH", `/api/mapa/objetos/${alvo.id}`, soDelete, { name: "x" })).statusCode).toBe(403);
    expect((await req("DELETE", `/api/mapa/objetos/${alvo.id}`, soDelete)).statusCode).toBe(200);
    expect(await noBanco(alvo.id)).toMatchObject({ vivo: false });
  });

  it("outro tenant, fora do escopo, excluído e id malformado: a MESMA 404 do inexistente, corpo idêntico", async () => {
    const inexistente = await req("GET", `/api/mapa/objetos/${NAO_ACHADO}`);
    expect(inexistente.statusCode).toBe(404);
    expect(erro(inexistente.body).error.code).toBe("NOT_FOUND");
    const corpo404 = inexistente.body;
    const mesma404 = (r: { statusCode: number; body: string }) => { expect(r.statusCode, r.body).toBe(404); expect(r.body).toBe(corpo404); };

    // premissa: o objeto da outra organização existe (testemunha)
    expect(await noBanco(outraOrg.objeto)).toMatchObject({ vivo: true, name: "Cocho de outra organização" });
    mesma404(await req("GET", `/api/mapa/objetos/${outraOrg.objeto}`));
    mesma404(await req("PATCH", `/api/mapa/objetos/${outraOrg.objeto}`, h.headers(), { name: "invasão" }));
    mesma404(await req("DELETE", `/api/mapa/objetos/${outraOrg.objeto}`));
    expect(await noBanco(outraOrg.objeto)).toMatchObject({ vivo: true, name: "Cocho de outra organização" });

    // fora do escopo: membro com tudo de map_objects, mas pecuária só na empresa 1
    const soE1 = await membro("MM9 escopo E1", ["map_objects.view", "map_objects.create", "map_objects.edit", "map_objects.delete"], escoposDeTodosOsModulos([E1]));
    const deE1 = await criar(cocho());
    const deE2 = await criar({ empresa_id: E2, tipo: "cocho", geometria: PONTO, name: `Cocho E2 ${unico()}` });
    expect((await req("GET", `/api/mapa/objetos/${deE1.id}`, soE1)).statusCode, "premissa: o membro lê a empresa 1").toBe(200);
    mesma404(await req("GET", `/api/mapa/objetos/${deE2.id}`, soE1));
    mesma404(await req("PATCH", `/api/mapa/objetos/${deE2.id}`, soE1, { name: "fora" }));
    mesma404(await req("DELETE", `/api/mapa/objetos/${deE2.id}`, soE1));
    const listaE1 = (await req("GET", "/api/mapa/objetos?pageSize=1000", soE1)).json() as Lista;
    expect(listaE1.itens.some((x) => x.id === deE1.id)).toBe(true);
    expect(listaE1.itens.every((x) => x.empresa_id === E1)).toBe(true);
    expect(await noBanco(deE2.id)).toMatchObject({ vivo: true, name: deE2.name });
    // criar na empresa 2, fora do escopo: o pedido de empresa não é autorização
    const naE2 = await req("POST", "/api/mapa/objetos", soE1, { empresa_id: E2, tipo: "cocho", geometria: PONTO, name: "não pode" });
    expect(naE2.statusCode, naE2.body).toBe(422);

    // excluído
    const excl = await criar(cocho());
    expect((await req("DELETE", `/api/mapa/objetos/${excl.id}`)).statusCode).toBe(200);
    mesma404(await req("GET", `/api/mapa/objetos/${excl.id}`));
    mesma404(await req("PATCH", `/api/mapa/objetos/${excl.id}`, h.headers(), { name: "volta" }));
    mesma404(await req("DELETE", `/api/mapa/objetos/${excl.id}`));

    // id malformado
    mesma404(await req("GET", `/api/mapa/objetos/${MALFORMADO}`));
    mesma404(await req("PATCH", `/api/mapa/objetos/${MALFORMADO}`, h.headers(), { name: "x" }));
    mesma404(await req("DELETE", `/api/mapa/objetos/${MALFORMADO}`));
    // inexistente nas escritas
    mesma404(await req("PATCH", `/api/mapa/objetos/${NAO_ACHADO}`, h.headers(), { name: "x" }));
    mesma404(await req("DELETE", `/api/mapa/objetos/${NAO_ACHADO}`));
  });
});

describe("MM-9c — entrada fora do contrato e geometria inválida (422 com caminho); código repetido (409)", () => {
  it("geometria inválida → 422 em geometria: Polygon numa forma ponto, longitude 200, type desconhecido", async () => {
    const invalidas = [
      { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-55, -15]]] },
      { type: "Point", coordinates: [200, -15] },
      { type: "Ponto", coordinates: [-55, -15] },
    ];
    for (const g of invalidas) {
      const nome = `Geometria ruim ${unico()}`;
      const e = recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, geometria: g })), "geometria");
      expect(e.error.details![0]!.message).toMatch(/^Geometria do objeto inválida/);
      expect(e.error.message).toMatch(/^geometria: Geometria do objeto inválida/);
      expect(await contarPorNome(nome)).toBe(0);
    }
    // na edição, a mesma recusa, e a linha não muda
    const o = await criar(cocho());
    recusadoEm(await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { geometria: { type: "Point", coordinates: [-55, 95] } }), "geometria");
    expect(await noBanco(o.id)).toMatchObject({ geometria: PONTO });
  });

  it("chave desconhecida, capacidade como número, forma que não é a do tipo, PATCH vazio → 422", async () => {
    const nome = `Contrato ${unico()}`;
    const desconhecida = await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, cor: "azul" }));
    expect(desconhecida.statusCode, desconhecida.body).toBe(422);
    expect(erro(desconhecida.body).error.code).toBe("VALIDATION_ERROR");
    expect(erro(desconhecida.body).error.details?.map((d) => d.message)).toEqual(["Campo não reconhecido"]);
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, capacidade: 12.5 })), "capacidade");
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, capacidade: "-1" })), "capacidade");
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, capacidade: "1.2345" })), "capacidade");
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, forma: "linha" })), "forma");
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, tipo: "cerca" })), "tipo");
    expect(await contarPorNome(nome)).toBe(0);
    const o = await criar(cocho());
    expect((await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), {})).statusCode).toBe(422);
    expect((await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { empresa_id: E2 })).statusCode).toBe(422);
    recusadoEm(await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { capacidade: 3 }), "capacidade");
    expect(await noBanco(o.id)).toMatchObject({ vivo: true, name: o.name });
  });

  it("área de outra empresa (ou inexistente) → 422 em area_id; código repetido em (empresa, tipo) → 409", async () => {
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ area_id: areaE2 })), "area_id");
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), cocho({ area_id: NAO_ACHADO })), "area_id");
    const o = await criar(cocho());
    recusadoEm(await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { area_id: areaE2 }), "area_id");

    const code = `REP-${unico()}`;
    await criar(cocho({ code }));
    const rep = await req("POST", "/api/mapa/objetos", h.headers(), cocho({ code }));
    expect(rep.statusCode, rep.body).toBe(409);
    expect(erro(rep.body).error.code).toBe("CONFLICT");
    // outro tipo, ou outra empresa, com o mesmo código: aceito
    await criar({ empresa_id: E1, tipo: "deposito_a_pasto", geometria: PONTO, name: `Dep ${unico()}`, code });
    await criar({ empresa_id: E2, tipo: "cocho", geometria: PONTO, name: `E2 ${unico()}`, code });
    const vivos = await admin.query<{ n: string }>("select count(*) n from erp.objetos_de_mapa where code=$1 and deleted_at is null", [code]);
    expect(vivos.rows[0]!.n).toBe("3");
  });
});

describe("MM-9d — CAMADA 5.2: o cocho cadastrado não atravessa empresas", () => {
  it("cocho numa área de OUTRA empresa, de outra organização, excluído ou inexistente → a MESMA 422 em trough_id", async () => {
    const nome = `Cocho 5.2 ${unico()}`;
    const corpos: string[] = [];
    for (const t of [cochoAreaE2, outraOrg.cocho, cochoExcluido, NAO_ACHADO]) {
      const r = await req("POST", "/api/mapa/objetos", h.headers(), cocho({ name: nome, trough_id: t }));
      const e = recusadoEm(r, "trough_id");
      expect(e.error.details![0]!.message).toBe("Cocho indisponível para este objeto.");
      corpos.push(r.body);
    }
    expect(new Set(corpos).size, "não revela qual dos quatro casos").toBe(1);
    expect(await contarPorNome(nome)).toBe(0);

    // na edição: ligar a um objeto da empresa 1 o cocho da área da empresa 2 → a mesma recusa, nada muda
    const o = await criar(cocho());
    const e = await req("PATCH", `/api/mapa/objetos/${o.id}`, h.headers(), { trough_id: cochoAreaE2 });
    recusadoEm(e, "trough_id");
    expect(e.body).toBe(corpos[0]);
    expect(await noBanco(o.id)).toMatchObject({ trough_id: null });
  });

  it("cocho sem área e cocho de área da mesma empresa são aceitos; só o tipo cocho se liga a cocho", async () => {
    const a = await criar(cocho({ trough_id: cochoSemArea }));
    expect(a.trough_id).toBe(cochoSemArea);
    const b = await criar(cocho({ trough_id: cochoAreaE1, area_id: areaE1 }));
    expect(b.trough_id).toBe(cochoAreaE1);
    expect((await noBanco(a.id))?.trough_id).toBe(cochoSemArea);
    expect((await noBanco(b.id))?.trough_id).toBe(cochoAreaE1);
    // edição: trocar para outro cocho válido
    const c = await criar(cocho());
    const e = await req("PATCH", `/api/mapa/objetos/${c.id}`, h.headers(), { trough_id: cochoAreaE1 });
    expect(e.statusCode, e.body).toBe(200);
    expect((e.json() as Objeto).trough_id).toBe(cochoAreaE1);
    // depósito a pasto não se liga a cocho; e o cocho ligado impede trocar o tipo
    recusadoEm(await req("POST", "/api/mapa/objetos", h.headers(), { empresa_id: E1, tipo: "deposito_a_pasto", geometria: PONTO, name: `Dep ${unico()}`, trough_id: cochoSemArea }), "trough_id");
    recusadoEm(await req("PATCH", `/api/mapa/objetos/${a.id}`, h.headers(), { tipo: "deposito_a_pasto" }), "trough_id");
    // a empresa 2 liga o cocho da área dela (o mesmo cocho que a empresa 1 não pode)
    const deE2 = await criar({ empresa_id: E2, tipo: "cocho", geometria: PONTO, name: `Cocho E2 ${unico()}`, trough_id: cochoAreaE2 });
    expect(deE2.trough_id).toBe(cochoAreaE2);
  });
});
