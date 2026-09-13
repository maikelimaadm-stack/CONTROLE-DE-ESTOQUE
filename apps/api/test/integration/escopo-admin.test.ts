import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * BORDA DE ADMINISTRAÇÃO DO ACESSO POR EMPRESA (PRE-BASE2-02 §6-§12).
 *
 * O que precisa estar provado aqui: quem concede acesso não consegue conceder o impossível. Empresa excluída,
 * empresa de outra organização e identificador inexistente são recusados com erro CONTROLADO (nunca um erro
 * cru de integridade virando 500, nunca revelando dados de outro tenant). Empresa inativa é aceita — histórico
 * continua consultável. Payload incorreto (empresa repetida, módulo repetido, "todas" com lista) é recusado em
 * vez de normalizado em silêncio. E toda alteração de escopo vira evento de auditoria com antes e depois.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string }; id?: string; member_id?: string; items?: Record<string, unknown>[] };
let empresaOutraOrg = ""; let empresaExcluida = ""; let empresaInativa = ""; let papel = "";
let seq = 0;

const post = (url: string, payload: Record<string, unknown>, headers: Hdr = h.headers()) => h.app.inject({ method: "POST", url, headers, payload });
const put = (url: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url, headers: h.headers(), payload });

/** Cria um membro novo a cada caso (a borda é testada no CREATE e no UPDATE, sem estado compartilhado). */
async function criarMembro(escopos: unknown): Promise<{ status: number; body: ReturnType<typeof j> }> {
  seq += 1;
  const r = await post("/api/admin/members", { name: `Borda ${seq}`, email: `borda-${seq}@demo.local`, password: "Borda@12345", role_id: papel, escopos_empresas: escopos });
  return { status: r.statusCode, body: j(r) };
}

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  const admin = createPool(TEST_URL, { max: 2 });
  try {
    const orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org Borda','orgborda') returning id")).rows[0]!.id;
    empresaOutraOrg = (await admin.query<{ id: string }>("insert into erp.farms(organization_id,code,name) values ($1,911,'Outra organização') returning id", [orgB])).rows[0]!.id;
    empresaExcluida = (await admin.query<{ id: string }>("insert into erp.farms(organization_id,code,name,deleted_at) values ($1,912,'Excluída',now()) returning id", [h.demo.orgId])).rows[0]!.id;
    empresaInativa = (await admin.query<{ id: string }>("insert into erp.farms(organization_id,code,name,is_active) values ($1,913,'Inativa',false) returning id", [h.demo.orgId])).rows[0]!.id;
  } finally { await admin.end(); }
  const r = await post("/api/admin/roles", { name: "Perfil borda", permissions: ["stocks.view", "payables.view"] });
  papel = j(r).id as string;
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("validação das empresas atribuídas", () => {
  it("A) empresa ativa da organização é aceita", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: [I.farm] }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
  it("B) empresa INATIVA da organização é aceita (histórico continua consultável)", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: [empresaInativa] }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
  it("C) empresa EXCLUÍDA é recusada com erro controlado", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: [empresaExcluida] }]);
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("VALIDATION_ERROR");
  });
  it("D) empresa de OUTRA organização é recusada, sem revelar nada do outro tenant", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: [empresaOutraOrg] }]);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toContain("Outra organização");
  });
  it("E) identificador inexistente é recusado", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: ["99999999-9999-4999-8999-999999999999"] }]);
    expect(r.status).toBe(422);
  });
  it("F) empresa repetida no mesmo módulo é recusada — payload errado não é normalizado em silêncio", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "selecionadas", empresas: [I.farm, I.farm] }]);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/repetida/i);
  });
  it("G) módulo repetido é recusado", async () => {
    const r = await criarMembro([
      { modulo: "estoque", modo: "selecionadas", empresas: [I.farm] },
      { modulo: "estoque", modo: "todas", empresas: [] }
    ]);
    expect(r.status).toBe(422);
  });
  it("H) modo \"todas\" com lista de empresas é recusado", async () => {
    const r = await criarMembro([{ modulo: "estoque", modo: "todas", empresas: [I.farm] }]);
    expect(r.status).toBe(422);
  });
  it("os dois contratos juntos (canônico + legado) são recusados", async () => {
    seq += 1;
    const r = await post("/api/admin/members", { name: `Borda ${seq}`, email: `borda-${seq}@demo.local`, password: "Borda@12345", role_id: papel, farm_ids: [I.farm], escopos_empresas: [{ modulo: "estoque", modo: "todas", empresas: [] }] });
    expect(r.statusCode).toBe(422);
  });
});

describe("modo selecionadas com lista VAZIA = nenhuma empresa (fail-closed explícito)", () => {
  it("é aceito na configuração e resulta em zero acesso no runtime", async () => {
    seq += 1;
    const email = `vazio-${seq}@demo.local`;
    const papelLeitura = await post("/api/admin/roles", { name: `Perfil vazio ${seq}`, permissions: ["input_entries.view", "stocks.view"] });
    const criado = await post("/api/admin/members", { name: "Vazio", email, password: "Borda@12345", role_id: j(papelLeitura).id, escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [] }] });
    expect(criado.statusCode, criado.body).toBe(201);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Borda@12345" } });
    const hd = { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
    const lista = await h.app.inject({ method: "GET", url: "/api/stock/input-entries", headers: hd });
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json() as { items: unknown[] }).items, "selecionadas com lista vazia é NENHUMA empresa").toEqual([]);
    // e a configuração devolvida é a canônica, sem virar "todas" no caminho de volta
    const membros = await h.app.inject({ method: "GET", url: `/api/admin/members?search=${encodeURIComponent(email)}`, headers: h.headers() });
    const item = (membros.json() as { items: { escopos_empresas: { modulo: string; modo: string; empresas: string[] }[] }[] }).items[0]!;
    expect(item.escopos_empresas).toEqual([{ modulo: "estoque", modo: "selecionadas", empresas: [] }]);
  });
});

describe("a borda LEGADA farm_ids não desvia da validação canônica", () => {
  const casos: [string, () => string][] = [
    ["empresa de outra organização", () => empresaOutraOrg],
    ["empresa excluída", () => empresaExcluida],
    ["identificador inexistente", () => "88888888-8888-4888-8888-888888888888"]
  ];
  it.each(casos)("farm_ids com %s é recusado", async (_nome, empresa) => {
    seq += 1;
    const r = await post("/api/admin/members", { name: `Legado ${seq}`, email: `legado-${seq}@demo.local`, password: "Borda@12345", role_id: papel, farm_ids: [empresa()] });
    expect(r.statusCode, r.body).toBe(422);
  });
  it("farm_ids com empresa inativa continua aceito", async () => {
    seq += 1;
    const r = await post("/api/admin/members", { name: `Legado ${seq}`, email: `legado-${seq}@demo.local`, password: "Borda@12345", role_id: papel, farm_ids: [empresaInativa] });
    expect(r.statusCode, r.body).toBe(201);
  });
});

describe("ausência de configuração é NENHUMA empresa, nunca todas", () => {
  it("membro criado sem escopos_empresas e sem farm_ids não enxerga empresa alguma", async () => {
    // O fallback antigo traduzia a ausência dos dois campos em modo `todas` nos onze módulos: o membro
    // nascia enxergando a organização inteira porque o pedido foi OMISSO, não porque alguém concedeu.
    seq += 1;
    const email = `sem-escopo-${seq}@demo.local`;
    const criado = await post("/api/admin/members", { name: "Sem escopo", email, password: "Borda@12345", role_id: papel });
    expect(criado.statusCode, criado.body).toBe(201);
    const membroId = j(criado).member_id as string;

    const c = createPool(TEST_URL, { max: 1 });
    try {
      const escopos = await c.query<{ n: string }>("select count(*) n from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2", [h.demo.orgId, membroId]);
      expect(Number(escopos.rows[0]!.n), "nenhum módulo configurado").toBe(0);
      // e a autoridade do banco concorda: nenhuma empresa, em nenhum módulo
      const acesso = await c.query<{ ok: boolean }>("select erp.tem_acesso_empresa($1,$2,'estoque',$3) as ok", [h.demo.orgId, j(criado).id as string, I.farm]);
      expect(acesso.rows[0]!.ok, "sem configuração = sem acesso").toBe(false);
    } finally { await c.end(); }
  });

  it("farm_ids explicitamente vazio continua sendo o legado \"todas\"", async () => {
    // A tradução legada só vale para o campo ENVIADO: lá, lista vazia sempre significou todas as empresas,
    // e mudar isso reescreveria o passado de quem já usa a API antiga.
    seq += 1;
    const criado = await post("/api/admin/members", { name: "Legado vazio", email: `legado-vazio-${seq}@demo.local`, password: "Borda@12345", role_id: papel, farm_ids: [] });
    expect(criado.statusCode, criado.body).toBe(201);
    const c = createPool(TEST_URL, { max: 1 });
    try {
      const modos = await c.query<{ modo: string }>("select distinct modo from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2", [h.demo.orgId, j(criado).member_id as string]);
      expect(modos.rows.map((x) => x.modo)).toEqual(["todas"]);
    } finally { await c.end(); }
  });
});

describe("auditoria de mudança de escopo (evento de segurança)", () => {
  it("registra ator, membro, antes, depois e módulos alterados — sem segredo algum", async () => {
    seq += 1;
    const email = `auditoria-${seq}@demo.local`;
    const criado = await post("/api/admin/members", { name: "Auditado", email, password: "Borda@12345", role_id: papel, escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [I.farm] }] });
    expect(criado.statusCode, criado.body).toBe(201);
    const userId = j(criado).id as string; const membroId = j(criado).member_id as string;

    const alterado = await put(`/api/admin/members/${userId}`, { escopos_empresas: [
      { modulo: "estoque", modo: "selecionadas", empresas: [I.farm2] },
      { modulo: "financeiro", modo: "selecionadas", empresas: [I.farm] }
    ] });
    expect(alterado.statusCode, alterado.body).toBe(200);

    type Escopo = { modulo: string; modo: string; empresas: string[] };
    const c = createPool(TEST_URL, { max: 1 });
    try {
      // `before`/`after` são COLUNAS de erp.audit_logs desde sempre; até PRE-BASE2-02 o helper só escrevia
      // `metadata`, então a foto antes/depois ia empilhada lá dentro — invisível para qualquer consulta de
      // auditoria, que procura nas colunas. Este teste trava as colunas E a ausência de duplicação.
      const logs = await c.query<{ user_id: string; organization_id: string; metadata: Record<string, unknown>; before: Escopo[] | null; after: Escopo[] | null }>(
        "select user_id, organization_id, metadata, before, after from erp.audit_logs where entity='member_company_scopes' and entity_id=$1 order by created_at", [membroId]);
      expect(logs.rowCount, "criação e alteração precisam estar auditadas").toBe(2);
      const criacao = logs.rows[0]!; const update = logs.rows[1]!;
      expect(criacao.organization_id).toBe(h.demo.orgId);
      expect(criacao.user_id).toBe(h.demo.adminUserId); // o ATOR, não o membro alterado
      expect(criacao.before, "quem nasce não tinha escopo anterior").toEqual([]);

      const antes = update.before!; const depois = update.after!;
      expect(antes.find((e) => e.modulo === "estoque")?.empresas).toEqual([I.farm]);
      expect(depois.find((e) => e.modulo === "estoque")?.empresas).toEqual([I.farm2]);
      expect(depois.find((e) => e.modulo === "financeiro")?.empresas).toEqual([I.farm]);

      // metadata guarda o que NÃO é foto: quem foi alterado e quais módulos mudaram. Repetir as fotos aqui
      // devolveria a inconsistência — duas verdades para o mesmo fato, divergindo na primeira alteração.
      expect(update.metadata["modulos_alterados"]).toEqual(["estoque", "financeiro"]);
      expect(update.metadata["membro_id"]).toBe(membroId);
      expect(update.metadata["before"], "foto não se duplica no metadata").toBeUndefined();
      expect(update.metadata["after"], "foto não se duplica no metadata").toBeUndefined();

      // nenhum dos três campos pode carregar segredo: o evento de segurança é lido por quem audita, não por quem opera
      const texto = JSON.stringify([update.metadata, update.before, update.after, criacao.metadata, criacao.before, criacao.after]).toLowerCase();
      for (const segredo of ["password", "senha", "hash", "token", "authorization", "borda@12345"]) expect(texto, segredo).not.toContain(segredo);
    } finally { await c.end(); }
  });

  it("alteração só de perfil não inventa evento de escopo", async () => {
    seq += 1;
    const email = `somente-perfil-${seq}@demo.local`;
    const criado = await post("/api/admin/members", { name: "Só perfil", email, password: "Borda@12345", role_id: papel, escopos_empresas: [{ modulo: "estoque", modo: "todas", empresas: [] }] });
    const userId = j(criado).id as string; const membroId = j(criado).member_id as string;
    const outroPapel = j(await post("/api/admin/roles", { name: `Outro papel ${seq}`, permissions: ["stocks.view"] })).id as string;
    await put(`/api/admin/members/${userId}`, { role_id: outroPapel });
    const c = createPool(TEST_URL, { max: 1 });
    try {
      const logs = await c.query<{ n: string }>("select count(*) n from erp.audit_logs where entity='member_company_scopes' and entity_id=$1", [membroId]);
      expect(Number(logs.rows[0]!.n), "só a criação").toBe(1);
    } finally { await c.end(); }
  });
});
