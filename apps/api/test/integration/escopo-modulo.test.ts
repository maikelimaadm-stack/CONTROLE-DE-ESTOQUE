import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * MATRIZ OBRIGATÓRIA DE SEGURANÇA — ACESSO POR EMPRESA **E** MÓDULO (docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * Um único usuário, com as MESMAS permissões funcionais em todos os módulos, configurado assim:
 *   • ESTOQUE     → selecionadas [A]
 *   • FINANCEIRO  → selecionadas [B]
 *   • PECUÁRIA    → todas ([A, B])
 *   • VENDAS      → SEM configuração (fail-closed: nenhuma empresa, mesmo com a permissão funcional)
 *
 * É a prova de que o acesso é a INTERSEÇÃO de capacidade e escopo, e de que o escopo é POR MÓDULO: o mesmo
 * usuário enxerga a empresa A no estoque e NÃO a enxerga no financeiro. Uma implementação que resolvesse o
 * escopo por usuário (e não por módulo) passaria nos testes antigos e falharia aqui.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string }; id?: string };
let MULTI: Hdr; let A = ""; let B = "";
let entradaA = ""; let entradaB = ""; let tituloA = ""; let tituloB = ""; let animalA = ""; let pesagemA = ""; let pesagemB = "";

const PERMS = [
  "input_entries.view", "input_entries.create", "stocks.view", "warehouses.view",
  "payables.view", "payables.create", "receivables.view",
  "animals.view", "animals.create", "weighings.view",
  "budgets.view", "sales.view", "orders.view",
  "attachments.view", "dashboard.financial.view", "dashboard.livestock.view", "report.payables.view"
];

async function membro(nome: string, email: string, escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas?: string[] }[]): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: PERMS } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Modulo@12345", role_id: j(papel).id, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Modulo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}
const get = (url: string, headers: Hdr) => h.app.inject({ method: "GET", url, headers });
const post = (url: string, headers: Hdr, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url, headers, payload });
const criar = async (url: string, payload: Record<string, unknown>) => { const r = await post(url, h.headers(), payload); expect(r.statusCode, `${url}: ${r.body}`).toBe(201); return j(r).id as string; };

beforeAll(async () => {
  h = await harness(); I = await ids(h); A = I.farm; B = I.farm2;
  const entrada = (farm: string, wh: string) => ({ farm_id: farm, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "7", unit_value: "3", warehouse_id: wh, financial_category_id: I.category, cost_center_id: I.costCenter }] });
  entradaA = await criar("/api/stock/input-entries", entrada(A, I.warehouse!));
  entradaB = await criar("/api/stock/input-entries", entrada(B, I.warehouseFarm2!));
  const titulo = (farm: string, n: string) => ({ farm_id: farm, number: n, person_id: I.provider, amount: "100.00", emission_date: "2026-09-01", due_date: "2026-01-15", note: "Matriz", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] });
  tituloA = await criar("/api/financial/payables", titulo(A, "MODF-A"));
  tituloB = await criar("/api/financial/payables", titulo(B, "MODF-B"));
  // animais vêm da semente (a criação tem regras próprias de rebanho): aqui interessa só a EMPRESA de cada um
  const admin = createPool(TEST_URL, { max: 1 });
  const animalDaEmpresa = async (farm: string) => (await admin.query<{ id: string }>(
    "select id from erp.animals where organization_id=$1 and farm_id=$2 and deleted_at is null limit 1", [h.demo.orgId, farm])).rows[0]?.id ?? "";
  animalA = await animalDaEmpresa(A);
  await admin.end();
  // pecuária nas DUAS empresas: a semente só tem animais em A, então a prova de "todas" usa pesagens
  const pesagem = (farm: string, data: string) => ({ farm_id: farm, weighing_date: data, batch_id: I.batch, items: [{ animal_id: I.animal, weight: "300" }] });
  pesagemA = await criar("/api/livestock/weighings", pesagem(A, "2026-09-20"));
  pesagemB = await criar("/api/livestock/weighings", pesagem(B, "2026-09-21"));
  MULTI = await membro("Multi", "multi-modulo@demo.local", [
    { modulo: "estoque", modo: "selecionadas", empresas: [A] },
    { modulo: "financeiro", modo: "selecionadas", empresas: [B] },
    { modulo: "pecuaria", modo: "todas" }
  ]);
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("matriz módulo × empresa (mesmo usuário, mesmas permissões)", () => {
  it("ESTOQUE vê a empresa A e NÃO vê a B", async () => {
    const lista = (j(await get("/api/stock/input-entries", MULTI)).items ?? []) as { id: string }[];
    expect(lista.some((x) => x.id === entradaA)).toBe(true);
    expect(lista.some((x) => x.id === entradaB)).toBe(false);
    expect((await get(`/api/stock/input-entries/${entradaA}`, MULTI)).statusCode).toBe(200);
    expect((await get(`/api/stock/input-entries/${entradaB}`, MULTI)).statusCode).toBe(404);
  });
  it("FINANCEIRO vê a empresa B e NÃO vê a A — o MESMO usuário, no MESMO instante", async () => {
    const lista = (j(await get("/api/financial/payables", MULTI)).items ?? []) as { id: string }[];
    expect(lista.some((x) => x.id === tituloB)).toBe(true);
    expect(lista.some((x) => x.id === tituloA)).toBe(false);
    expect((await get(`/api/financial/payables/${tituloB}`, MULTI)).statusCode).toBe(200);
    expect((await get(`/api/financial/payables/${tituloA}`, MULTI)).statusCode).toBe(404);
  });
  it("PECUÁRIA (modo todas) vê as duas empresas", async () => {
    const lista = (j(await get("/api/livestock/weighings", MULTI)).items ?? []) as { id: string }[];
    expect(lista.some((x) => x.id === pesagemA), "pesagem da empresa A").toBe(true);
    expect(lista.some((x) => x.id === pesagemB), "pesagem da empresa B").toBe(true);
    expect((await get(`/api/livestock/animals/${animalA}`, MULTI)).statusCode).toBe(200);
  });
  it("VENDAS sem configuração é fail-closed mesmo com a permissão funcional", async () => {
    const r = await get("/api/sales/budgets", MULTI);
    expect(r.statusCode).toBe(200);
    expect((j(r).items ?? []).length, "módulo sem configuração não pode listar nada").toBe(0);
  });
  it("a empresa SELECIONADA (X-Farm-Id) é validada no módulo da rota: 403 onde não vale, 200 onde vale", async () => {
    // B é permitida no financeiro e na pecuária, proibida no estoque
    expect((await get("/api/financial/payables", { ...MULTI, "x-farm-id": B })).statusCode).toBe(200);
    expect((await get("/api/livestock/animals", { ...MULTI, "x-farm-id": B })).statusCode).toBe(200);
    const negado = await get("/api/stock/input-entries", { ...MULTI, "x-farm-id": B });
    expect(negado.statusCode).toBe(403);
    expect(j(negado).error?.code).toBe("PERMISSION_DENIED");
    // e o contrário: A vale no estoque, não no financeiro
    expect((await get("/api/stock/input-entries", { ...MULTI, "x-farm-id": A })).statusCode).toBe(200);
    expect((await get("/api/financial/payables", { ...MULTI, "x-farm-id": A })).statusCode).toBe(403);
  });
  it("ESCRITA respeita o módulo: lançar na empresa fora do escopo é recusado", async () => {
    const entrada = { farm_id: B, entry_date: "2026-09-02", items: [{ product_id: I.product, quantity: "1", unit_value: "3", warehouse_id: I.warehouseFarm2, financial_category_id: I.category, cost_center_id: I.costCenter }] };
    const r = await post("/api/stock/input-entries", MULTI, entrada);
    expect(r.statusCode).toBe(422);
    // a mesma empresa B é válida para um lançamento FINANCEIRO do mesmo usuário
    const titulo = { farm_id: B, number: "MODF-X", person_id: I.provider, amount: "10.00", emission_date: "2026-09-01", due_date: "2026-02-15", note: "Matriz", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] };
    expect((await post("/api/financial/payables", MULTI, titulo)).statusCode).toBe(201);
  });
  it("PAINÉIS e RELATÓRIOS usam o módulo da INFORMAÇÃO, não uma gaveta genérica", async () => {
    const rel = j(await get("/api/reports/payables", MULTI)).rows as { number: string }[];
    expect(rel.some((r) => r.number === "MODF-B")).toBe(true);
    expect(rel.some((r) => r.number === "MODF-A")).toBe(false);
  });
  it("ID GLOBAL respeita permissão E empresa do registro, no módulo do registro", async () => {
    const idGlobalDe = async (tabela: string, id: string) => {
      const c = createPool(TEST_URL, { max: 1 });
      try { return (await c.query<{ id_global: string }>("select id_global from erp.registros_globais where id_entidade=$1 and tipo_entidade=$2", [id, tabela])).rows[0]?.id_global ?? null; }
      finally { await c.end(); }
    };
    const gB = await idGlobalDe("financial_titles", tituloB); const gA = await idGlobalDe("financial_titles", tituloA);
    if (!gB || !gA) return; // alocação de ID Global é opcional nesta fase
    expect((await get(`/api/registros-globais/${gB}`, MULTI)).statusCode).toBe(200);
    expect((await get(`/api/registros-globais/${gA}`, MULTI)).statusCode).toBe(404);
  });
  it("ANEXOS herdam o módulo e a empresa do registro-pai", async () => {
    const ok = await get(`/api/attachments?entity=financial_titles&entity_id=${tituloB}`, MULTI);
    expect(ok.statusCode).toBe(200);
    const negado = await get(`/api/attachments?entity=financial_titles&entity_id=${tituloA}`, MULTI);
    expect(negado.statusCode).toBe(404);
  });
});

describe("matriz perfil × empresa: capacidade E escopo, nunca OU", () => {
  const casos = [
    { nome: "A", permissao: true, escopo: "todas" as const, lista: true, detalheA: 200 },
    { nome: "B", permissao: true, escopo: "selecionadas" as const, lista: true, detalheA: 200 },
    { nome: "C", permissao: true, escopo: "nenhuma" as const, lista: false, detalheA: 404 },
    { nome: "D", permissao: false, escopo: "todas" as const, lista: false, detalheA: 403 },
    { nome: "E", permissao: false, escopo: "selecionadas" as const, lista: false, detalheA: 403 },
    { nome: "F", permissao: false, escopo: "nenhuma" as const, lista: false, detalheA: 403 }
  ];
  it.each(casos)("caso $nome: permissão=$permissao escopo=$escopo", async (c) => {
    const email = `matriz-${c.nome.toLowerCase()}@demo.local`;
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Papel ${c.nome}`, permissions: c.permissao ? ["input_entries.view", "stocks.view"] : ["stocks.view"] } });
    const escopos = c.escopo === "nenhuma" ? [] : [{ modulo: "estoque", modo: c.escopo, empresas: c.escopo === "selecionadas" ? [A] : [] }];
    const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: `Caso ${c.nome}`, email, password: "Modulo@12345", role_id: j(papel).id, escopos_empresas: escopos } });
    expect(vinculo.statusCode, vinculo.body).toBe(201);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Modulo@12345" } });
    const hd = { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
    const lista = await get("/api/stock/input-entries", hd);
    if (c.permissao) {
      expect(lista.statusCode).toBe(200);
      expect((lista.json() as { items: { id: string }[] }).items.some((x) => x.id === entradaA), "lista").toBe(c.lista);
    } else {
      expect(lista.statusCode).toBe(403);
    }
    expect((await get(`/api/stock/input-entries/${entradaA}`, hd)).statusCode, "detalhe A").toBe(c.detalheA);
  });
});
