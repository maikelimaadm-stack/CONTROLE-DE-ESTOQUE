import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { RESOURCES } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";
import { CADASTROS_COM_REGRA_PROPRIA_DE_USO, MENSAGEM_ANALITICO_EM_USO, MENSAGEM_ANALITICO_SEM_VISAO_TOTAL, REFERENCIAS_DE_USO } from "../../src/lib/analitico-em-uso.js";
import { MENSAGEM_REGISTRO_COM_FILHOS } from "../../src/lib/arvore-cadastro.js";
import { MENSAGEM_RATEIO_CENTRO, MENSAGEM_RATEIO_NATUREZA } from "../../src/services/financial-core.js";

/**
 * CADASTROS R1-5 — ÁRVORE E ANALÍTICO (decisão 256).
 *
 * AR-5  registro com filho VIVO não muda de superior nem de código (422 no campo); a folha muda; filho
 *       excluído não conta; vale também para árvore sem código (Endereçamentos).
 * AN-1  analítico EM USO (qualquer referência viva pelas FKs do catálogo) não vira sintético; sem uso, vira.
 *       A conferência roda sob a RLS de quem grava: sem visão da organização inteira, a troca é recusada.
 * AN-2  rateio: id de outra organização, inexistente, excluído, inativo ou sintético → a MESMA recusa; e a
 *       leitura é `for share` (uma inativação concorrente é vista, não atropelada).
 * AN-3  perfil de RH: centro de resultado sintético → 422; o recuo do adiantamento só escolhe analítico ativo.
 * CAT   a whitelist de "em uso" é o catálogo de FKs do banco migrado — FK nova não coberta reprova aqui.
 *
 * Toda recusa confere também o banco (nada mudou) e todo aceite confere a linha gravada.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
/** Funcionário COM ficha de RH (o `I.employee` do harness pode ser parceiro sem ficha). */
let funcionario: string;
type Resp = { statusCode: number; body: string };
type Hdr = Record<string, string>;
const j = (r: Resp) => JSON.parse(r.body);
const hdr = (base?: Hdr) => ({ ...(base ?? h.headers()), "content-type": "application/json" });
const post = (url: string, payload: Record<string, unknown>, base?: Hdr) => h.app.inject({ method: "POST", url, headers: hdr(base), payload });
const put = (key: string, id: string, payload: Record<string, unknown>, base?: Hdr) => h.app.inject({ method: "PUT", url: `/api/resources/${key}/${id}`, headers: hdr(base), payload });
const del = (key: string, id: string) => h.app.inject({ method: "DELETE", url: `/api/resources/${key}/${id}`, headers: h.headers() });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
const cadastrar = async (key: string, payload: Record<string, unknown>) => criado(await post(`/api/resources/${key}`, payload));
const erroDoCampo = (r: Resp) => { const d = (j(r).error.details as { path: string[] | string; message: string }[])[0]!; return { path: ([] as string[]).concat(d.path), message: d.message }; };
const linha = async <T extends Record<string, unknown>>(sql: string, p: unknown[]) => (await admin.query<T>(sql, p)).rows[0]!;
const contarTitulos = async (nota: string) => Number((await linha<{ n: string }>("select count(*)::text n from erp.financial_titles where organization_id=$1 and note=$2", [h.demo.orgId, nota])).n);
const titulo = (nota: string, cat: string | undefined, cc: string | undefined, extra: Record<string, unknown> = {}, empresa?: string) => ({
  empresa_id: empresa ?? I.empresa, number: `${nota}-${Math.random().toString(36).slice(2, 8)}`, person_id: I.provider, amount: "100.00",
  emission_date: "2026-09-01", due_date: "2026-09-30", note: nota, apportionment: [{ financial_category_id: cat, cost_center_id: cc, percentage: "100", ...extra }]
});

async function membroRestrito(nome: string, perms: string[], empresas: string[]): Promise<Hdr> {
  const role = await post("/api/admin/roles", { name: `Perfil ${nome}`, permissions: perms });
  expect(role.statusCode, role.body).toBe(201);
  const email = `${nome.toLowerCase().replace(/\W+/g, "-")}@demo.local`;
  const mem = await post("/api/admin/members", { name: nome, email, password: "Restrito@12345", role_id: j(role).id, escopos_empresas: escoposDeTodosOsModulos(empresas) });
  expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 3 }); I = await ids(h);
  funcionario = (await linha<{ id: string }>("select p.id from erp.people p join erp.employee_profiles e on e.person_id = p.id where p.organization_id=$1 and p.is_employee and p.deleted_at is null order by p.code limit 1", [h.demo.orgId])).id;
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("AR-5 — registro com filhos não muda de superior nem de código", () => {
  let raiz: string; let meio: string; let folha: string; let outraRaiz: string;
  beforeAll(async () => {
    raiz = await cadastrar("financial_categories", { code: "5", name: "AR5 Raiz", nature: "income", kind: "synthetic" });
    meio = await cadastrar("financial_categories", { code: "5.01", name: "AR5 Meio", nature: "income", kind: "synthetic", parent_id: raiz });
    folha = await cadastrar("financial_categories", { code: "5.01.001", name: "AR5 Folha", nature: "income", kind: "analytic", parent_id: meio });
    outraRaiz = await cadastrar("financial_categories", { code: "6", name: "AR5 Outra", nature: "income", kind: "synthetic" });
  });
  const estado = (id: string) => linha("select code, parent_id from erp.financial_categories where id=$1", [id]);

  it("AR-5a: mover registro COM filho → 422 no superior; renumerar → 422 no código; nada muda", async () => {
    const mover = await put("financial_categories", meio, { parent_id: outraRaiz, code: "6.01" });
    expect(mover.statusCode, mover.body).toBe(422);
    expect(erroDoCampo(mover)).toEqual({ path: ["parent_id"], message: MENSAGEM_REGISTRO_COM_FILHOS });
    // só o superior (o código fica): a recusa é a dos FILHOS, antes da conferência do prefixo do código
    const soSuperior = await put("financial_categories", meio, { parent_id: outraRaiz });
    expect(soSuperior.statusCode, soSuperior.body).toBe(422);
    expect(erroDoCampo(soSuperior)).toEqual({ path: ["parent_id"], message: MENSAGEM_REGISTRO_COM_FILHOS });
    const renumerar = await put("financial_categories", meio, { code: "5.02" });
    expect(renumerar.statusCode, renumerar.body).toBe(422);
    expect(erroDoCampo(renumerar)).toEqual({ path: ["code"], message: MENSAGEM_REGISTRO_COM_FILHOS });
    expect(await estado(meio)).toEqual({ code: "5.01", parent_id: raiz });
    // outro campo do registro com filhos continua editável (a regra é só de superior e código)
    const nome = await put("financial_categories", meio, { name: "AR5 Meio renomeado", code: "5.01", parent_id: raiz });
    expect(nome.statusCode, nome.body).toBe(200);
  });

  it("AR-5b: mover a FOLHA → 200 com superior e código novos", async () => {
    const r = await put("financial_categories", folha, { parent_id: outraRaiz, code: "6.01" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await estado(folha)).toEqual({ code: "6.01", parent_id: outraRaiz });
  });

  it("AR-5c: filho EXCLUÍDO não conta — sem filho vivo, o registro renumera e muda de superior", async () => {
    const extra = await cadastrar("financial_categories", { code: "5.01.002", name: "AR5 Excluída", nature: "income", kind: "analytic", parent_id: meio });
    expect((await put("financial_categories", meio, { code: "5.02" })).statusCode, "premissa: com o filho vivo, recusa").toBe(422);
    expect((await del("financial_categories", extra)).statusCode).toBe(200);
    const r = await put("financial_categories", meio, { code: "6.02", parent_id: outraRaiz });
    expect(r.statusCode, r.body).toBe(200);
    expect(await estado(meio)).toEqual({ code: "6.02", parent_id: outraRaiz });
  });

  it("AR-5d: árvore SEM código (Endereçamentos) — com filho não muda de superior; a folha muda", async () => {
    const galpao = await cadastrar("addressings", { description: "AR5 Galpão A" });
    const prateleira = await cadastrar("addressings", { description: "AR5 Prateleira", parent_id: galpao });
    const outro = await cadastrar("addressings", { description: "AR5 Galpão B" });
    const r = await put("addressings", galpao, { parent_id: outro });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r)).toEqual({ path: ["parent_id"], message: MENSAGEM_REGISTRO_COM_FILHOS });
    expect(await linha("select parent_id from erp.addressings where id=$1", [galpao])).toEqual({ parent_id: null });
    const ok = await put("addressings", prateleira, { parent_id: outro });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await linha("select parent_id from erp.addressings where id=$1", [prateleira])).toEqual({ parent_id: outro });
  });
});

describe("AN-1 — analítico em uso não vira sintético", () => {
  let natRaiz: string; let ccRaiz: string; let caRaiz: string;
  beforeAll(async () => {
    natRaiz = await cadastrar("financial_categories", { code: "7", name: "AN1 Despesas", nature: "expense", kind: "synthetic" });
    ccRaiz = await cadastrar("cost_centers", { code: "8", name: "AN1 Centros", kind: "synthetic" });
    caRaiz = await cadastrar("chart_accounts", { code: "9", description: "AN1 Contas", condition: "debit", kind: "synthetic" });
  });
  const natureza = (code: string, nome: string) => cadastrar("financial_categories", { code, name: nome, nature: "expense", kind: "analytic", parent_id: natRaiz });
  const kindDe = async (tabela: "financial_categories" | "cost_centers" | "chart_accounts", id: string) => (await linha<{ kind: string }>(`select kind from erp.${tabela} where id=$1`, [id])).kind;

  it("AN-1a: natureza analítica com título → 422 no campo; sem uso → vira sintética", async () => {
    const usada = await natureza("7.01", "AN1 Usada");
    criado(await post("/api/financial/payables", titulo("AN1a", usada, I.costCenter)));
    const r = await put("financial_categories", usada, { kind: "synthetic" });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r)).toEqual({ path: ["kind"], message: MENSAGEM_ANALITICO_EM_USO });
    expect(await kindDe("financial_categories", usada)).toBe("analytic");
    const livre = await natureza("7.02", "AN1 Livre");
    const ok = await put("financial_categories", livre, { kind: "synthetic" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await kindDe("financial_categories", livre)).toBe("synthetic");
  });

  it("AN-1b: referência EXCLUÍDA não é uso — produto vivo bloqueia; excluído o produto, a natureza vira sintética", async () => {
    const nat = await natureza("7.03", "AN1 Do Produto");
    const grupo = (await linha<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1", [h.demo.orgId])).id;
    const unidade = (await linha<{ id: string }>("select id from erp.measurement_units where organization_id=$1 or organization_id is null order by symbol limit 1", [h.demo.orgId])).id;
    const produto = await cadastrar("products", { description: `AN1 produto ${Date.now()}`, measurement_id: unidade, group_id: grupo, control_stock: false, financial_category_id: nat });
    const r = await put("financial_categories", nat, { kind: "synthetic" });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r).message).toBe(MENSAGEM_ANALITICO_EM_USO);
    expect((await del("products", produto)).statusCode).toBe(200);
    const ok = await put("financial_categories", nat, { kind: "synthetic" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("AN-1c: centro de resultado (rateio e perfil de RH) e conta contábil (rateio) em uso também não viram sintéticos", async () => {
    const ccTitulo = await cadastrar("cost_centers", { code: "8.01", name: "AN1 CC Título", kind: "analytic", parent_id: ccRaiz });
    criado(await post("/api/financial/payables", titulo("AN1c", I.category, ccTitulo)));
    const ccPerfil = await cadastrar("cost_centers", { code: "8.02", name: "AN1 CC Perfil", kind: "analytic", parent_id: ccRaiz });
    await admin.query("update erp.employee_profiles set cost_center_id=$2 where person_id=$1", [funcionario, ccPerfil]);
    const conta = await cadastrar("chart_accounts", { code: "9.01", description: "AN1 Conta", condition: "debit", kind: "analytic", parent_id: caRaiz });
    criado(await post("/api/financial/payables", titulo("AN1c", I.category, I.costCenter, { chart_account_id: conta })));
    for (const [key, id] of [["cost_centers", ccTitulo], ["cost_centers", ccPerfil], ["chart_accounts", conta]] as const) {
      const r = await put(key, id, { kind: "synthetic" });
      expect(r.statusCode, `${key} ${r.body}`).toBe(422);
      expect(erroDoCampo(r)).toEqual({ path: ["kind"], message: MENSAGEM_ANALITICO_EM_USO });
      expect(await kindDe(key, id)).toBe("analytic");
    }
  });

  it("AN-1d: uso INVISÍVEL para quem grava (empresa fora do escopo) não vira 'livre' — sem visão total, a troca é recusada", async () => {
    const naOutraEmpresa = await natureza("7.04", "AN1 Empresa 2");
    criado(await post("/api/financial/payables", titulo("AN1d", naOutraEmpresa, I.costCenter, {}, I.empresa2)));
    const livre = await natureza("7.05", "AN1 Livre 2");
    const restrito = await membroRestrito("Restrito Arvore", ["financial_categories.view", "financial_categories.edit"], [I.empresa]);
    // premissa: quem enxerga tudo vê o uso na empresa 2
    const dono = await put("financial_categories", naOutraEmpresa, { kind: "synthetic" });
    expect(erroDoCampo(dono).message, "premissa: está em uso").toBe(MENSAGEM_ANALITICO_EM_USO);
    // o restrito não vê o título da empresa 2: sem a exigência de visão total, a troca passaria
    for (const id of [naOutraEmpresa, livre]) {
      const r = await put("financial_categories", id, { kind: "synthetic" }, restrito);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDoCampo(r)).toEqual({ path: ["kind"], message: MENSAGEM_ANALITICO_SEM_VISAO_TOTAL });
      expect(await kindDe("financial_categories", id)).toBe("analytic");
    }
    // e o restrito continua editando o resto do cadastro
    expect((await put("financial_categories", livre, { name: "AN1 Livre 2 (editada)" }, restrito)).statusCode).toBe(200);
    const ok = await put("financial_categories", livre, { kind: "synthetic" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("AN-1e: lançamento CONCORRENTE ainda não confirmado: a troca espera a trava da natureza e vê o uso", async () => {
    const nat = await natureza("7.06", "AN1 Concorrente");
    const tid = criado(await post("/api/financial/payables", titulo("AN1e", I.category, I.costCenter)));
    const outro = new pg.Client({ connectionString: TEST_URL });
    await outro.connect();
    try {
      await outro.query("begin");
      // um rateio novo apontando a natureza, ainda NÃO confirmado (a FK segura `for key share` na natureza)
      await outro.query("insert into erp.title_apportionments(title_id,financial_category_id,cost_center_id,percentage,amount) values ($1,$2,$3,100,1)", [tid, nat, I.costCenter]);
      const troca = put("financial_categories", nat, { kind: "synthetic" });
      let esperando = false;
      for (let i = 0; i < 50 && !esperando; i++) {
        const w = await admin.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%financial_categories%for update%'");
        esperando = Boolean(w.rowCount);
        if (!esperando) await new Promise((ok) => setTimeout(ok, 100));
      }
      await outro.query("commit");
      const r = await troca;
      expect(esperando, "a troca esperou a trava da natureza").toBe(true);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDoCampo(r)).toEqual({ path: ["kind"], message: MENSAGEM_ANALITICO_EM_USO });
    } finally { await outro.query("rollback").catch(() => undefined); await outro.end(); }
    expect(await kindDe("financial_categories", nat)).toBe("analytic");
  });
});

describe("AN-2 — rateio: todo id existe NA organização, vivo, ativo e analítico", () => {
  let catOutraOrg: string; let ccOutraOrg: string;
  beforeAll(async () => {
    const outra = (await linha<{ id: string }>("insert into erp.organizations(name,slug) values ('Outra AN2','an2-outra') returning id", [])).id;
    catOutraOrg = (await linha<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,'1','Alheia AN2','expense','analytic') returning id", [outra])).id;
    ccOutraOrg = (await linha<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind) values ($1,'1','Alheio AN2','analytic') returning id", [outra])).id;
  });

  it("AN-2a: natureza de outra organização, inexistente, excluída, inativa ou sintética → a MESMA 422; nada gravado", async () => {
    const pai = (await linha<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='2.01'", [h.demo.orgId])).id;
    const excluida = await cadastrar("financial_categories", { code: "2.01.901", name: "AN2 Excluída", nature: "expense", kind: "analytic", parent_id: pai });
    expect((await del("financial_categories", excluida)).statusCode).toBe(200);
    const inativa = await cadastrar("financial_categories", { code: "2.01.902", name: "AN2 Inativa", nature: "expense", kind: "analytic", parent_id: pai, is_active: false });
    const casos: [string, string][] = [["outra organização", catOutraOrg], ["inexistente", "00000000-0000-4000-8000-0000000000a2"], ["excluída", excluida], ["inativa", inativa], ["sintética", pai]];
    const antes = await contarTitulos("AN2a");
    for (const [nome, id] of casos) {
      const r = await post("/api/financial/payables", titulo("AN2a", id, I.costCenter));
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error.message, nome).toBe(MENSAGEM_RATEIO_NATUREZA);
      expect(j(r).error.details[0], nome).toEqual({ path: ["apportionment", "financial_category_id"], message: MENSAGEM_RATEIO_NATUREZA });
    }
    expect(await contarTitulos("AN2a")).toBe(antes);
    criado(await post("/api/financial/payables", titulo("AN2a", I.category, I.costCenter)));
  });

  it("AN-2b: centro de outra organização, excluído ou inativo → a MESMA 422 (título, movimento bancário e edição do rateio)", async () => {
    const pai = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and code='1.01'", [h.demo.orgId])).id;
    const excluido = await cadastrar("cost_centers", { code: "1.01.901", name: "AN2 CC Excluído", kind: "analytic", parent_id: pai });
    expect((await del("cost_centers", excluido)).statusCode).toBe(200);
    const inativo = await cadastrar("cost_centers", { code: "1.01.902", name: "AN2 CC Inativo", kind: "analytic", parent_id: pai, is_active: false });
    for (const id of [ccOutraOrg, excluido, inativo]) {
      const r = await post("/api/financial/payables", titulo("AN2b", I.category, id));
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error.details[0]).toEqual({ path: ["apportionment", "cost_center_id"], message: MENSAGEM_RATEIO_CENTRO });
    }
    expect(await contarTitulos("AN2b")).toBe(0);
    const mov = await post("/api/financial/bank-movements", { empresa_id: I.empresa, bank_account_id: I.bankAccount, movement_date: "2026-09-02", type: "out", amount: "10.00", note: "AN2b", apportionment: [{ financial_category_id: catOutraOrg, cost_center_id: I.costCenter, percentage: "100" }] });
    expect(mov.statusCode, mov.body).toBe(422);
    expect(j(mov).error.message).toBe(MENSAGEM_RATEIO_NATUREZA);
    const ok = await post("/api/financial/payables", titulo("AN2b", I.category, I.costCenter));
    const tid = criado(ok);
    const e = await h.app.inject({ method: "PUT", url: `/api/financial/payables/${tid}`, headers: hdr(), payload: { apportionment: [{ financial_category_id: I.category, cost_center_id: inativo, percentage: "100" }] } });
    expect(e.statusCode, e.body).toBe(422);
    expect((await admin.query<{ cost_center_id: string }>("select cost_center_id from erp.title_apportionments where title_id=$1", [tid])).rows).toEqual([{ cost_center_id: I.costCenter }]);
  });

  it("AN-2c: leitura FOR SHARE — inativação concorrente ainda não confirmada: o lançamento ESPERA e vê a inativação", async () => {
    const pai = (await linha<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='2.01'", [h.demo.orgId])).id;
    const cat = await cadastrar("financial_categories", { code: "2.01.903", name: "AN2 Concorrente", nature: "expense", kind: "analytic", parent_id: pai });
    const outro = new pg.Client({ connectionString: TEST_URL });
    await outro.connect();
    try {
      await outro.query("begin");
      await outro.query("update erp.financial_categories set is_active=false where id=$1", [cat]);
      const lancamento = post("/api/financial/payables", titulo("AN2c", cat, I.costCenter));
      // espera o lançamento ficar BLOQUEADO na linha da natureza (sem `for share` ele não esperaria nada)
      let esperando = false;
      for (let i = 0; i < 50 && !esperando; i++) {
        const w = await admin.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%financial_categories%for share%'");
        esperando = Boolean(w.rowCount);
        if (!esperando) await new Promise((ok) => setTimeout(ok, 100));
      }
      await outro.query("commit");
      const r = await lancamento;
      expect(esperando, "o lançamento esperou a trava da natureza").toBe(true);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error.message).toBe(MENSAGEM_RATEIO_NATUREZA);
    } finally { await outro.query("rollback").catch(() => undefined); await outro.end(); }
    expect(await contarTitulos("AN2c")).toBe(0);
  });
});

describe("AN-3 — perfil de RH e recuo do adiantamento só em centro analítico", () => {
  let sintetico: string;
  beforeAll(async () => {
    sintetico = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and code='2.01'", [h.demo.orgId])).id;
  });
  const ccDoPerfil = async () => (await linha<{ cost_center_id: string | null }>("select cost_center_id from erp.employee_profiles where person_id=$1", [funcionario])).cost_center_id;

  it("AN-3a: centro sintético (ou de outra organização) na aba Admissão → 422 apontando o perfil; analítico grava", async () => {
    const antes = await ccDoPerfil();
    const outra = (await linha<{ id: string }>("insert into erp.organizations(name,slug) values ('Outra AN3','an3-outra') returning id", [])).id;
    const alheio = (await linha<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind) values ($1,'1','Alheio AN3','analytic') returning id", [outra])).id;
    for (const cc of [sintetico, alheio]) {
      const r = await put("funcionarios", funcionario, { rh_admissao: { cost_center_id: cc } });
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error.details[0]).toMatchObject({ path: "rh_admissao.cost_center_id", perfil: "rh_admissao", message: expect.stringMatching(/Centro de resultado: escolha um registro analítico/) });
      expect(await ccDoPerfil()).toBe(antes);
    }
    const analitico = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and code='2.01.002'", [h.demo.orgId])).id;
    const ok = await put("funcionarios", funcionario, { rh_admissao: { cost_center_id: analitico } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await ccDoPerfil()).toBe(analitico);
    // valor que não muda não é reconferido (acervo sintético gravado fora da API continua editável)
    await admin.query("update erp.employee_profiles set cost_center_id=$2 where person_id=$1", [funcionario, sintetico]);
    const mesmo = await put("funcionarios", funcionario, { rh_admissao: { cost_center_id: sintetico, office: "AN3" } });
    expect(mesmo.statusCode, mesmo.body).toBe(200);
  });

  it("AN-3b: adiantamento sem centro — perfil com centro sintético ou inativo cai no 1º analítico ATIVO; perfil válido é usado", async () => {
    const esperado = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1", [h.demo.orgId])).id;
    const pai = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and code='2.01'", [h.demo.orgId])).id;
    const inativo = await cadastrar("cost_centers", { code: "2.01.903", name: "AN3 Inativo", kind: "analytic", parent_id: pai, is_active: false });
    const valido = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and code='2.01.003'", [h.demo.orgId])).id;
    const adiantar = async () => {
      const r = await post("/api/hr/advances", { empresa_id: I.empresa, advance_date: "2026-09-05", person_id: funcionario, amount: "50", financial_category_id: I.category });
      expect(r.statusCode, r.body).toBe(201);
      return (await linha<{ cost_center_id: string }>("select cost_center_id from erp.title_apportionments where title_id=$1", [j(r).title_ids[0]])).cost_center_id;
    };
    for (const [caso, cc] of [["sintético", sintetico], ["inativo", inativo]] as const) {
      await admin.query("update erp.employee_profiles set cost_center_id=$2 where person_id=$1", [funcionario, cc]);
      expect(await adiantar(), caso).toBe(esperado);
    }
    await admin.query("update erp.employee_profiles set cost_center_id=$2 where person_id=$1", [funcionario, valido]);
    expect(await adiantar(), "o centro válido do perfil continua valendo").toBe(valido);
  });
});

describe("CAT — a whitelist de 'em uso' é o catálogo de FKs do banco migrado", () => {
  it("CAT-1: cada cadastro em árvore com Analítica está na whitelist ou tem regra própria; nenhuma chave sobra", () => {
    const comKind = RESOURCES.filter((d) => d.tree && d.fields.some((f) => f.name === "kind"));
    expect(comKind.length, "premissa: há cadastros em árvore com Analítica").toBeGreaterThanOrEqual(4);
    for (const d of comKind) expect(d.table in REFERENCIAS_DE_USO || CADASTROS_COM_REGRA_PROPRIA_DE_USO.includes(d.key), d.key).toBe(true);
    expect(Object.keys(REFERENCIAS_DE_USO).every((t) => comKind.some((d) => d.table === t))).toBe(true);
    // `exigeAnalitico` só é conferido no principal e nos perfis: detalhe em grade não pode declarar
    for (const d of RESOURCES) for (const g of d.detalhes ?? []) for (const f of g.fields) expect(Boolean(f.ref?.exigeAnalitico), `${d.key}.${g.key}.${f.name}`).toBe(false);
  });

  it("CAT-2: FK nova (ou sumida) para natureza, centro ou conta reprova; a marca de exclusão lógica bate com a coluna real", async () => {
    const tabelas = Object.keys(REFERENCIAS_DE_USO);
    const cat = await admin.query<{ referenciada: string; tabela: string; coluna: string; logica: boolean }>(
      `select rt.relname::text as referenciada, n.nspname || '.' || t.relname as tabela, a.attname::text as coluna,
              exists (select 1 from pg_attribute d where d.attrelid = c.conrelid and d.attname = 'deleted_at' and not d.attisdropped) as logica
         from pg_constraint c
         join pg_class rt on rt.oid = c.confrelid join pg_namespace rn on rn.oid = rt.relnamespace
         join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
         cross join lateral unnest(c.conkey, c.confkey) as k(col, refcol)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.col
         join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = k.refcol
        where c.contype = 'f' and rn.nspname = 'erp' and rt.relname = any($1::text[]) and ra.attname = 'id' and c.conrelid <> c.confrelid`, [tabelas]);
    for (const tabela of tabelas) {
      const doCatalogo = cat.rows.filter((x) => x.referenciada === tabela).map((x) => `${x.tabela}.${x.coluna}:${x.logica ? "logica" : "fisica"}`).sort();
      const daLista = REFERENCIAS_DE_USO[tabela]!.map((x) => `erp.${x.tabela}.${x.coluna}:${x.exclusaoLogica ? "logica" : "fisica"}`).sort();
      expect(doCatalogo.length, `premissa: o catálogo tem FKs para ${tabela}`).toBeGreaterThan(0);
      expect(daLista, `whitelist de ${tabela} = catálogo de FKs`).toEqual(doCatalogo);
    }
  });
});
