import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS Fase 5 — RH: FUNCIONÁRIOS (migration 0028). RH-1..RH-5; R1-3 (CPF-1..CPF-4: parceiro existente exige people.edit; CPF-5: a porta não reativa nem regrava ficha de RH existente).
 * Toda recusa confere o BANCO (nada gravado); todo aceite confere a linha gravada.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const get = (url: string, headers = h.headers()) => h.app.inject({ method: "GET", url, headers });
const porCpf = (payload: Record<string, unknown>, headers = hdr()) => h.app.inject({ method: "POST", url: "/api/hr/funcionarios/por-cpf", headers, payload });
const put = (id: string, payload: Record<string, unknown>, headers = hdr()) => h.app.inject({ method: "PUT", url: `/api/resources/funcionarios/${id}`, headers, payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);
const nome = (s: string) => `RH ${s} ${Math.random().toString(36).slice(2, 8)}`;
const porDoc = (doc: string) => n("select count(*)::text n from erp.people where organization_id=$1 and document=$2 and deleted_at is null", [h.demo.orgId, doc]);

const CPF_NOVO = "39053344705"; const CPF_CLIENTE = "98765432100"; const CPF_B = "12312312387"; const CPF_C = "11144477735"; const CPF_D = "52998224725";
let EMPRESA = ""; let FUNCAO = ""; let EQUIPE = ""; let EVENTO = ""; let CBO = "";

/** Membro com as permissões pedidas (e mais nada). */
async function membro(email: string, perms: string[]) {
  const hash = (await um<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'"))!.password_hash;
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`]))!.id;
  for (const p of perms) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash]))!.id;
  await admin.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true)", [h.demo.orgId, u, papel]);
  const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } })).token as string;
  return { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId, "content-type": "application/json" };
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  const org = h.demo.orgId;
  EMPRESA = h.demo.empresaIds[0]!;
  FUNCAO = (await um<{ id: string }>("insert into erp.job_functions(organization_id,name,base_salary,hour_value) values ($1,'RH Tratorista',3000,15) returning id", [org]))!.id;
  EQUIPE = (await um<{ id: string }>("insert into erp.teams(organization_id,name) values ($1,'RH Equipe A') returning id", [org]))!.id;
  EVENTO = (await um<{ id: string }>("insert into erp.hr_events(organization_id,name,periodicity,method,condition) values ($1,'RH Insalubridade','monthly','fixed','add') returning id", [org]))!.id;
  CBO = (await um<{ codigo: string }>("select codigo from erp.cbo_ocupacoes order by codigo limit 1"))!.codigo;
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("RH-1 — novo funcionário pelo CPF", () => {
  it("CPF novo cria parceiro (tipo Funcionário) + ficha de RH; o mesmo CPF de novo NÃO duplica", async () => {
    const x = nome("novo");
    const r = await porCpf({ document: "390.533.447-05", name: x });
    expect(r.statusCode, r.body).toBe(201);
    const { id, criado } = j(r) as { id: string; criado: boolean };
    expect(criado).toBe(true);
    expect(await um("select name, document, person_type, is_employee, code is not null as tem_codigo from erp.people where id=$1", [id])).toEqual({ name: x, document: CPF_NOVO, person_type: "natural", is_employee: true, tem_codigo: true });
    expect(await um("select is_active, organization_id::text o from erp.employee_profiles where person_id=$1", [id])).toEqual({ is_active: true, o: h.demo.orgId });
    const de_novo = await porCpf({ document: CPF_NOVO, name: "outro nome" });
    expect(de_novo.statusCode, de_novo.body).toBe(200);
    expect(j(de_novo)).toEqual({ id, criado: false });
    expect(await porDoc(CPF_NOVO)).toBe(1);
    expect(await um("select name from erp.people where id=$1", [id])).toEqual({ name: x });
  });

  it("CPF de parceiro existente (proprietário do seed) abre ESTE parceiro e marca Funcionário, mantendo os outros tipos", async () => {
    const cli = (await um<{ id: string }>("select id::text from erp.people where organization_id=$1 and document=$2 and is_proprietary and not is_employee", [h.demo.orgId, CPF_CLIENTE]))!.id;
    const r = await porCpf({ document: "987.654.321-00" });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: cli, criado: false });
    expect(await um("select is_proprietary, is_employee from erp.people where id=$1", [cli])).toEqual({ is_proprietary: true, is_employee: true });
    expect(await n("select count(*)::text n from erp.employee_profiles where person_id=$1", [cli])).toBe(1);
    expect(await porDoc(CPF_CLIENTE)).toBe(1);
  });

  it("CPF inválido, CNPJ, CPF novo sem nome e chave desconhecida → 422, nada gravado; porta genérica recusada", async () => {
    const antes = await n("select count(*)::text n from erp.people where organization_id=$1", [h.demo.orgId]);
    for (const body of [{ document: "390.533.447-00", name: "x" }, { document: "00000000000191", name: "x" }, { document: CPF_B }, { document: CPF_B, name: "x", salario: 1 }]) {
      const r = await porCpf(body);
      expect(r.statusCode, r.body).toBe(422);
    }
    const gen = await h.app.inject({ method: "POST", url: "/api/resources/funcionarios", headers: hdr(), payload: { name: "y", document: CPF_B } });
    expect(gen.statusCode, gen.body).toBe(422);
    expect(await n("select count(*)::text n from erp.people where organization_id=$1", [h.demo.orgId])).toBe(antes);
  });

  it("sem employees.create → 403, nada gravado", async () => {
    const hv = await membro("rh1-view@demo.local", ["employees.view"]);
    const r = await porCpf({ document: CPF_C, name: "sem permissão" }, hv);
    expect(r.statusCode, r.body).toBe(403);
    expect(await porDoc(CPF_C)).toBe(0);
  });
});

describe("RH-2 — ficha de RH em abas", () => {
  it("grava admissão, remuneração, documentos, equipes e eventos numa transação; GET devolve nas mesmas chaves", async () => {
    const id = (j(await porCpf({ document: CPF_B, name: nome("ficha") })) as { id: string }).id;
    const r = await put(id, {
      rh_admissao: { matricula: " M-001 ", admission_date: "2031-01-10", empresa_id: EMPRESA, function_id: FUNCAO, tipo_vinculo: "clt_determinado", trabalhador_rural: true },
      rh_remuneracao: { base_salary: "3500.00", hour_value: "15.90", jornada_semanal: "44" },
      rh_documentos: { pis_nis: "12345678901", cnh_categoria: "AB", cnh_numero: "12345678901", cnh_validade: "2033-02-01" },
      equipes: [{ team_id: EQUIPE, member_type: "employee" }],
      eventos: [{ event_id: EVENTO, amount: "250.00" }]
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(await um("select matricula, empresa_id::text e, tipo_vinculo, trabalhador_rural, base_salary::text s, jornada_semanal::text jr, pis_nis, cnh_categoria from erp.employee_profiles where person_id=$1", [id]))
      .toEqual({ matricula: "M-001", e: EMPRESA, tipo_vinculo: "clt_determinado", trabalhador_rural: true, s: "3500.00", jr: "44.00", pis_nis: "12345678901", cnh_categoria: "AB" });
    expect(await n("select count(*)::text n from erp.team_members where person_id=$1 and team_id=$2", [id, EQUIPE])).toBe(1);
    expect(await n("select count(*)::text n from erp.employee_events where person_id=$1 and event_id=$2 and organization_id=$3", [id, EVENTO, h.demo.orgId])).toBe(1);
    const g = j(await get(`/api/resources/funcionarios/${id}`));
    expect(g.rh_admissao.matricula).toBe("M-001"); expect(g.rh_remuneracao.base_salary).toBe("3500.00"); expect(g.equipes).toHaveLength(1); expect(g.eventos).toHaveLength(1);
    // lista: só parceiros do tipo Funcionário
    const lista = j(await get(`/api/resources/funcionarios?pageSize=200`)) as { items: { id: string; is_employee?: boolean }[] };
    const cliente = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and is_client and not is_employee limit 1", [h.demo.orgId]))!.id;
    expect(lista.items.some((x) => x.id === id)).toBe(true);
    expect(lista.items.some((x) => x.id === cliente)).toBe(false);
    // seletor e valores distintos seguem o MESMO recorte fixo
    const opcoes = (await get(`/api/resources/funcionarios/options?include_inactive=1`)).body;
    expect(opcoes).toContain(id); expect(opcoes).not.toContain(cliente);
    const nomeCliente = (await um<{ name: string }>("select name from erp.people where id=$1", [cliente]))!.name;
    const distintos = await get(`/api/resources/funcionarios/distinct?field=name`);
    expect(distintos.statusCode, distintos.body).toBe(200); expect(distintos.body).not.toContain(nomeCliente);
    // parceiro que NÃO é funcionário: a mesma 404 de inexistente
    expect((await get(`/api/resources/funcionarios/${cliente}`)).statusCode).toBe(404);
    expect((await put(cliente, { rh_admissao: { matricula: "X" } })).statusCode).toBe(404);
    expect(await n("select count(*)::text n from erp.employee_profiles where person_id=$1", [cliente])).toBe(0);
  });

  it("erro numa aba (PIS inválido) → 422 apontando a aba; NADA gravado (nem as outras abas)", async () => {
    const id = (j(await porCpf({ document: CPF_C, name: nome("atomico") })) as { id: string }).id;
    const r = await put(id, { rh_admissao: { matricula: "M-ATOM" }, eventos: [{ event_id: EVENTO, amount: "10" }], rh_documentos: { pis_nis: "123" } });
    expect(r.statusCode, r.body).toBe(422);
    expect(JSON.stringify(j(r).error.details)).toContain("documentos");
    expect(await um("select matricula from erp.employee_profiles where person_id=$1", [id])).toEqual({ matricula: null });
    expect(await n("select count(*)::text n from erp.employee_events where person_id=$1", [id])).toBe(0);
  });

  it("matrícula única entre VIVOS: repetida → 409 com o dono; o trigger recusa a gravação direta; excluído libera", async () => {
    const dono = (await um<{ id: string; code: string }>("select p.id::text, p.code from erp.people p join erp.employee_profiles e on e.person_id=p.id where e.matricula='M-001'"))!;
    const outro = (j(await porCpf({ document: CPF_D, name: nome("matricula") })) as { id: string }).id;
    const r = await put(outro, { rh_admissao: { matricula: "M-001" } });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error.message).toContain(dono.code);
    const e = await admin.query("update erp.employee_profiles set matricula='M-001' where person_id=$1", [outro]).then(() => null, (x: { code?: string }) => x);
    expect(e?.code).toBe("23505");
    await admin.query("update erp.people set deleted_at=now() where id=$1", [dono.id]);
    const ok = await put(outro, { rh_admissao: { matricula: "M-001" } });
    expect(ok.statusCode, ok.body).toBe(200);
    await admin.query("update erp.people set deleted_at=null where id=$1", [dono.id]).catch(() => undefined);
  });

  it("conta de pagamento de OUTRO parceiro → 422; conta adicional do próprio → grava", async () => {
    const id = (j(await porCpf({ document: CPF_CLIENTE })) as { id: string }).id;
    const org = h.demo.orgId;
    const alheio = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and id<>$2 limit 1", [org, id]))!.id;
    const deOutro = (await um<{ id: string }>("insert into erp.parceiro_contas(organization_id,person_id,conta) values ($1,$2,'1') returning id", [org, alheio]))!.id;
    const minha = (await um<{ id: string }>("insert into erp.parceiro_contas(organization_id,person_id,conta) values ($1,$2,'2') returning id", [org, id]))!.id;
    expect((await put(id, { rh_pagamento: { conta_pagamento_id: deOutro } })).statusCode).toBe(422);
    expect(await um("select conta_pagamento_id from erp.employee_profiles where person_id=$1", [id])).toEqual({ conta_pagamento_id: null });
    const ok = await put(id, { rh_pagamento: { conta_pagamento_id: minha } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await um("select conta_pagamento_id::text c from erp.employee_profiles where person_id=$1", [id])).toEqual({ c: minha });
    // o banco é a autoridade: conta alheia pela gravação direta viola a FK composta
    const e = await admin.query("update erp.employee_profiles set conta_pagamento_id=$2 where person_id=$1", [id, deOutro]).then(() => null, (x: { code?: string }) => x);
    expect(e?.code).toBe("23503");
  });

  it("outra organização não lê nem grava a ficha (404)", async () => {
    const id = (await um<{ person_id: string }>("select person_id::text from erp.employee_profiles where matricula='M-001' limit 1"))!.person_id;
    const adm = createPool(TEST_URL, { max: 1 });
    const b = await seedDemo(adm, { orgName: "[TEST] Org RH", adminEmail: "adminrh@demo.local", adminPassword: "Demo@12345", slug: "orgrh" }, () => {}); await adm.end();
    const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "adminrh@demo.local", password: "Demo@12345" } })).token as string;
    const hb = { authorization: `Bearer ${tok}`, "x-org-id": b.orgId, "content-type": "application/json" };
    expect((await get(`/api/resources/funcionarios/${id}`, hb)).statusCode).toBe(404);
    expect((await put(id, { rh_admissao: { matricula: "ROUBO" } }, hb)).statusCode).toBe(404);
    expect(await n("select count(*)::text n from erp.employee_profiles where matricula='ROUBO'")).toBe(0);
  });
});

describe("RH-3 — sigilo de salário e valor hora; aba Pessoal exige people.edit", () => {
  it("employees.view NÃO recebe salário nem valor hora (ficha e lista); employees.edit recebe", async () => {
    const id = (await um<{ person_id: string }>("select person_id::text from erp.employee_profiles where base_salary = 3500 limit 1"))!.person_id;
    const hv = await membro("rh3-view@demo.local", ["employees.view"]);
    const ficha = await get(`/api/resources/funcionarios/${id}`, hv);
    expect(ficha.statusCode, ficha.body).toBe(200);
    const f = j(ficha);
    expect(f.rh_remuneracao).not.toHaveProperty("base_salary");
    expect(f.rh_remuneracao).not.toHaveProperty("hour_value");
    expect(f.rh_remuneracao.jornada_semanal).toBe("44.00");
    expect(ficha.body).not.toContain("3500");
    const lista = await get(`/api/resources/funcionarios?pageSize=200`, hv);
    expect(lista.statusCode).toBe(200);
    expect(lista.body).not.toContain("base_salary"); expect(lista.body).not.toContain("hour_value");
    const he = await membro("rh3-edit@demo.local", ["employees.view", "employees.edit"]);
    expect(j(await get(`/api/resources/funcionarios/${id}`, he)).rh_remuneracao.base_salary).toBe("3500.00");
  });

  it("gravar salário sem a permissão do sigilo → 403; aba Pessoal sem people.edit → 403; as outras abas gravam", async () => {
    const id = (await um<{ person_id: string }>("select person_id::text from erp.employee_profiles where base_salary = 3500 limit 1"))!.person_id;
    const he = await membro("rh3-edit2@demo.local", ["employees.view", "employees.edit"]);
    const nomeAntes = (await um<{ name: string }>("select name from erp.people where id=$1", [id]))!.name;
    const p = await put(id, { name: "trocado sem people.edit", rh_documentos: { rg_numero: "111" } }, he);
    expect(p.statusCode, p.body).toBe(403);
    expect(await um("select name from erp.people where id=$1", [id])).toEqual({ name: nomeAntes });
    expect(await um("select rg_numero from erp.employee_profiles where person_id=$1", [id])).toEqual({ rg_numero: null });
    const ok = await put(id, { rh_documentos: { rg_numero: "111", rg_orgao: "SSP/TO" } }, he);
    expect(ok.statusCode, ok.body).toBe(200);
    // o dono (todas as permissões) grava a aba Pessoal
    expect((await put(id, { phone: "63 3333-0000" })).statusCode).toBe(200);
    // employees.view não edita nada
    const hv = await membro("rh3-view2@demo.local", ["employees.view"]);
    expect((await put(id, { rh_documentos: { rg_numero: "222" } }, hv)).statusCode).toBe(403);
  });
});

describe("RH-4 — folha continua lendo employee_profiles; regra do desligado", () => {
  it("desligado ANTES do mês fica fora; desligado DENTRO do mês entra", async () => {
    const a = (j(await porCpf({ document: "71428793860", name: nome("desligado antes") })) as { id: string }).id;
    const b = (j(await porCpf({ document: "86288366757", name: nome("desligado no mes") })) as { id: string }).id;
    expect((await put(a, { rh_remuneracao: { base_salary: "1000" }, rh_desligamento: { dismissal_date: "2031-04-30", motivo_desligamento: "pedido_demissao" } })).statusCode).toBe(200);
    expect((await put(b, { rh_remuneracao: { base_salary: "2000" }, rh_desligamento: { dismissal_date: "2031-05-10", motivo_desligamento: "acordo" } })).statusCode).toBe(200);
    const r = await h.app.inject({ method: "POST", url: "/api/hr/earnings/calculate", headers: hdr(), payload: { empresa_id: EMPRESA, reference_month: "2031-05-01" } });
    expect(r.statusCode, r.body).toBe(201);
    const earning = (j(r) as { id: string }).id;
    expect(await n("select count(*)::text n from erp.earning_lines where earning_id=$1 and person_id=$2", [earning, a])).toBe(0);
    expect(await n("select count(*)::text n from erp.earning_lines where earning_id=$1 and person_id=$2 and description='Salário base'", [earning, b])).toBe(1);
  });
});

describe("RH-5 — Funções com CBO oficial", () => {
  const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/api/resources/job_functions", headers: hdr(), payload });
  const base = { base_salary: "2000", monthly_hours: 220, hour_value: "10", description: "RH-5" };
  it("CBO da busca grava; CBO fora da tabela → 422 e nada gravado; acervo com CBO livre continua editável", async () => {
    const ok = await post({ ...base, name: nome("f ok"), cbo_code: CBO });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await um("select cbo_code from erp.job_functions where id=$1", [j(ok).id])).toEqual({ cbo_code: CBO });
    const x = nome("f ruim");
    const ruim = await post({ ...base, name: x, cbo_code: "000000" });
    expect(ruim.statusCode, ruim.body).toBe(422);
    expect(await n("select count(*)::text n from erp.job_functions where name=$1", [x])).toBe(0);
    // gravação direta: a FK da 0028 é a autoridade
    const e = await admin.query("insert into erp.job_functions(organization_id,name,cbo_code) values ($1,'RH5 direto','000000')", [h.demo.orgId]).then(() => null, (y: { code?: string }) => y);
    expect(e?.code).toBe("23503");
    // acervo anterior (FK NOT VALID): a função com CBO livre é editada sem tocar no CBO
    await admin.query("alter table erp.job_functions disable trigger all");
    const legado = (await um<{ id: string }>("insert into erp.job_functions(organization_id,name,cbo_code) values ($1,'RH5 legado','LIVRE') returning id", [h.demo.orgId]))!.id;
    await admin.query("alter table erp.job_functions enable trigger all");
    const ed = await h.app.inject({ method: "PUT", url: `/api/resources/job_functions/${legado}`, headers: hdr(), payload: { name: "RH5 legado renomeado" } });
    expect(ed.statusCode, ed.body).toBe(200);
  });
});

/**
 * R1-3 — "Novo funcionário pelo CPF" com parceiro que JÁ existe. `employees.create` basta para CPF NOVO; marcar o
 * tipo Funcionário num parceiro vivo que ainda não é funcionário exige TAMBÉM `people.edit` (conferida na
 * transação do `runService`). Cada caso monta o próprio membro com as permissões EXATAS e confere o banco antes e
 * depois: a linha inteira do parceiro (inclusive `updated_at`), a trilha de auditoria dele, a ficha de RH e o
 * total de parceiros da organização.
 */
describe("R1-3 — novo funcionário pelo CPF: parceiro existente exige people.edit", () => {
  const MSG_403 = "CPF já cadastrado como parceiro: quem edita parceiros precisa marcar o tipo Funcionário";
  const MSG_INATIVO = "parceiro inativo: reative no cadastro de parceiros";
  const MSG_FICHA_INATIVA = "ficha de RH inativa: o novo funcionário pelo CPF não reativa a ficha de quem está fora da folha";
  const org = () => h.demo.orgId;

  /** CPF válido (dígitos verificadores calculados) que ninguém desta organização usa, vivo ou excluído. */
  async function cpfLivre(): Promise<string> {
    for (;;) {
      const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
      if (new Set(d).size === 1) continue;
      for (const k of [10, 11]) { const s = d.reduce((a, x, i) => a + x * (k - i), 0); const r = (s * 10) % 11; d.push(r === 10 ? 0 : r); }
      const cpf = d.join("");
      if (await n("select count(*)::text n from erp.people where organization_id=$1 and document=$2", [org(), cpf]) === 0) return cpf;
    }
  }
  /** Parceiro plantado DIRETO no banco (fora da API), pessoa física com o CPF, nos tipos e na situação pedidos. */
  async function plantar(tipos: Record<string, boolean>, situacao: { is_active?: boolean; excluido?: boolean } = {}) {
    const cpf = await cpfLivre();
    const code = `R13-${Math.random().toString(36).slice(2, 8)}`;
    const id = (await um<{ id: string }>(
      `insert into erp.people (organization_id, code, name, person_type, document, is_client, is_provider, is_transporter, is_employee, is_proprietary, is_active, deleted_at)
       values ($1, $2, $3, 'natural', $4, $5, $6, $7, $8, $9, $10, case when $11 then now() end) returning id::text id`,
      [org(), code, nome("R13 parceiro"), cpf, Boolean(tipos["is_client"]), Boolean(tipos["is_provider"]), Boolean(tipos["is_transporter"]), Boolean(tipos["is_employee"]), Boolean(tipos["is_proprietary"]), situacao.is_active ?? true, Boolean(situacao.excluido)]))!.id;
    return { id, cpf, code };
  }
  /**
   * Retrato do que a porta poderia gravar: a linha inteira do parceiro e a auditoria dele, a linha inteira da ficha
   * de RH e a auditoria DELA (a 0028 audita `employee_profiles`: qualquer UPDATE, mesmo sem mudar valor, deixa trilha)
   * e o total de parceiros.
   */
  async function retrato(id: string) {
    return {
      parceiro: (await um<{ r: unknown }>("select to_jsonb(p) r from erp.people p where id=$1", [id]))!.r,
      auditoria: await n("select count(*)::text n from erp.audit_logs where entity='people' and entity_id=$1", [id]),
      fichas: await n("select count(*)::text n from erp.employee_profiles where person_id=$1", [id]),
      ficha: (await um<{ r: unknown }>("select to_jsonb(e) r from erp.employee_profiles e where person_id=$1", [id]))?.r ?? null,
      auditoriaDaFicha: await n("select count(*)::text n from erp.audit_logs where entity='employee_profiles' and entity_id=$1", [id]),
      parceiros: await n("select count(*)::text n from erp.people where organization_id=$1", [org()])
    };
  }
  /** Parceiro plantado com a ficha de RH JÁ existente (direto no banco), na situação pedida. */
  async function plantarComFicha(tipos: Record<string, boolean>, fichaAtiva: boolean) {
    const p = await plantar(tipos);
    await admin.query("insert into erp.employee_profiles (person_id, organization_id, is_active, matricula) values ($1, $2, $3, $4)", [p.id, org(), fichaAtiva, `R13-${Math.random().toString(36).slice(2, 8)}`]);
    return p;
  }

  it("CPF-1 — CPF de parceiro vivo (cliente), sem people.edit → 403 com a mensagem exata; NADA gravado", async () => {
    // tudo de parceiros MENOS people.edit: nem people.create basta para marcar o tipo num parceiro existente
    const hc = await membro("r13-cpf1@demo.local", ["employees.view", "employees.create", "people.view", "people.create"]);
    const p = await plantar({ is_client: true });
    const antes = await retrato(p.id);
    const formatado = `${p.cpf.slice(0, 3)}.${p.cpf.slice(3, 6)}.${p.cpf.slice(6, 9)}-${p.cpf.slice(9)}`;
    for (const document of [p.cpf, formatado]) {
      const r = await porCpf({ document, name: "tentativa sem people.edit" }, hc);
      expect(r.statusCode, r.body).toBe(403);
      expect(j(r).error).toMatchObject({ code: "PERMISSION_DENIED", message: MSG_403 });
      // a recusa revela que o CPF existe (declarado), e SÓ isso: nada do parceiro sai no corpo
      expect(r.body).not.toContain(p.id); expect(r.body).not.toContain(p.code);
    }
    expect(await retrato(p.id)).toEqual(antes);
    expect(await um("select is_client, is_employee from erp.people where id=$1", [p.id])).toEqual({ is_client: true, is_employee: false });
    expect(antes.fichas).toBe(0);
  });

  it("CPF-1b — parceiro que JÁ é Funcionário, sem people.edit → 200 com ele; o parceiro NÃO é tocado", async () => {
    const hc = await membro("r13-cpf1b@demo.local", ["employees.create"]);
    const p = await plantar({ is_employee: true, is_provider: true });
    const antes = await retrato(p.id);
    const r = await porCpf({ document: p.cpf }, hc);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: p.id, criado: false });
    const depois = await retrato(p.id);
    // a linha do parceiro e a auditoria dele ficam iguais (nenhum UPDATE); só a ficha de RH é garantida
    expect(depois.parceiro).toEqual(antes.parceiro);
    expect(depois.auditoria).toBe(antes.auditoria);
    expect(depois.parceiros).toBe(antes.parceiros);
    expect(depois.fichas).toBe(1);
  });

  it("CPF-2 — CPF de parceiro vivo (proprietário), com people.edit → marca Funcionário (mantém os outros tipos) e cria a ficha de RH", async () => {
    const he = await membro("r13-cpf2@demo.local", ["employees.create", "people.edit"]);
    const p = await plantar({ is_proprietary: true });
    const antes = await retrato(p.id);
    const r = await porCpf({ document: p.cpf, name: "nome ignorado para parceiro existente" }, he);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: p.id, criado: false });
    expect(await um("select is_proprietary, is_client, is_provider, is_transporter, is_employee, is_active, person_type, document from erp.people where id=$1", [p.id]))
      .toEqual({ is_proprietary: true, is_client: false, is_provider: false, is_transporter: false, is_employee: true, is_active: true, person_type: "natural", document: p.cpf });
    expect(await um("select is_active, organization_id::text o from erp.employee_profiles where person_id=$1", [p.id])).toEqual({ is_active: true, o: org() });
    const depois = await retrato(p.id);
    expect(depois.fichas).toBe(1);
    expect(depois.parceiros).toBe(antes.parceiros);
    expect(depois.auditoria).toBe(antes.auditoria + 1);
    expect(await porDoc(p.cpf)).toBe(1);
  });

  it("CPF-3 — CPF novo, SÓ employees.create → 201; parceiro pessoa física SÓ com o tipo Funcionário; corpo com tipo extra → 422", async () => {
    const hc = await membro("r13-cpf3@demo.local", ["employees.create"]);
    const cpf = await cpfLivre();
    const total = await n("select count(*)::text n from erp.people where organization_id=$1", [org()]);
    // nenhum outro tipo nem campo do parceiro vem do corpo: chave fora de {document, name} é RECUSADA, não ignorada
    for (const extra of [{ is_client: true }, { is_provider: true }, { person_type: "legal" }, { is_active: false }]) {
      const x = await porCpf({ document: cpf, name: "com tipo extra", ...extra }, hc);
      expect(x.statusCode, x.body).toBe(422);
    }
    expect(await n("select count(*)::text n from erp.people where organization_id=$1", [org()])).toBe(total);
    const x = nome("cpf3");
    const r = await porCpf({ document: cpf, name: x }, hc);
    expect(r.statusCode, r.body).toBe(201);
    const { id, criado } = j(r) as { id: string; criado: boolean };
    expect(criado).toBe(true);
    expect(await um("select name, document, person_type, is_client, is_provider, is_transporter, is_proprietary, is_employee, is_active from erp.people where id=$1", [id]))
      .toEqual({ name: x, document: cpf, person_type: "natural", is_client: false, is_provider: false, is_transporter: false, is_proprietary: false, is_employee: true, is_active: true });
    expect(await um("select is_active from erp.employee_profiles where person_id=$1", [id])).toEqual({ is_active: true });
    expect(await n("select count(*)::text n from erp.people where organization_id=$1", [org()])).toBe(total + 1);
  });

  it("CPF-3b — parceiro EXCLUÍDO com o CPF não conta como existente: SÓ employees.create cria um parceiro novo e não toca no excluído", async () => {
    const hc = await membro("r13-cpf3b@demo.local", ["employees.create"]);
    const ex = await plantar({ is_client: true }, { excluido: true });
    const antes = await retrato(ex.id);
    const r = await porCpf({ document: ex.cpf, name: nome("cpf3b") }, hc);
    expect(r.statusCode, r.body).toBe(201);
    const { id, criado } = j(r) as { id: string; criado: boolean };
    expect(criado).toBe(true); expect(id).not.toBe(ex.id);
    expect(await um("select is_client, is_employee, document from erp.people where id=$1", [id])).toEqual({ is_client: false, is_employee: true, document: ex.cpf });
    const depois = await retrato(ex.id);
    expect(depois.parceiro).toEqual(antes.parceiro);
    expect(depois.auditoria).toBe(antes.auditoria);
    expect(depois.fichas).toBe(0);
    expect(depois.parceiros).toBe(antes.parceiros + 1);
    expect(await porDoc(ex.cpf)).toBe(1);
  });

  it("CPF-4 — CPF de parceiro INATIVO → 422 com a mensagem exata; nada gravado (também quando ele já é Funcionário)", async () => {
    const he = await membro("r13-cpf4@demo.local", ["employees.create", "people.edit"]);
    const inativo = await plantar({ is_client: true }, { is_active: false });
    const antes = await retrato(inativo.id);
    const r = await porCpf({ document: inativo.cpf }, he);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_INATIVO });
    expect(await retrato(inativo.id)).toEqual(antes);
    // o dono (todas as permissões) recebe a MESMA recusa
    const dono = await porCpf({ document: inativo.cpf });
    expect(dono.statusCode, dono.body).toBe(422);
    expect(await retrato(inativo.id)).toEqual(antes);
    // funcionário inativo: não há o que marcar, mas a porta também não reabre a ficha dele
    const func = await plantar({ is_employee: true }, { is_active: false });
    const antesF = await retrato(func.id);
    const rf = await porCpf({ document: func.cpf }, await membro("r13-cpf4b@demo.local", ["employees.create"]));
    expect(rf.statusCode, rf.body).toBe(422);
    expect(j(rf).error.message).toBe(MSG_INATIVO);
    expect(await retrato(func.id)).toEqual(antesF);
  });

  it("CPF-4b — inativo que NÃO é Funcionário, sem people.edit → 403 (a capacidade vem antes da situação); nada gravado", async () => {
    const hc = await membro("r13-cpf4c@demo.local", ["employees.create"]);
    const inativo = await plantar({ is_provider: true }, { is_active: false });
    const antes = await retrato(inativo.id);
    const r = await porCpf({ document: inativo.cpf }, hc);
    expect(r.statusCode, r.body).toBe(403);
    expect(j(r).error.message).toBe(MSG_403);
    expect(await retrato(inativo.id)).toEqual(antes);
  });

  it("CPF-5 — ficha de RH INATIVA: a porta NÃO a reativa — 422 com a mensagem exata e nada gravado (só employees.create, o dono, e o ex-funcionário com people.edit)", async () => {
    // o cenário da revisão: funcionário ATIVO no cadastro de parceiros com a ficha de RH INATIVA (fora da folha)
    const func = await plantarComFicha({ is_employee: true }, false);
    const antes = await retrato(func.id);
    expect(antes.ficha).toMatchObject({ is_active: false });
    for (const [quem, headers] of [["só employees.create", await membro("r13-cpf5@demo.local", ["employees.create"])], ["o dono", hdr()]] as const) {
      const r = await porCpf({ document: func.cpf }, headers);
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(422);
      expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_FICHA_INATIVA });
      expect(await retrato(func.id), quem).toEqual(antes);
    }
    // ex-funcionário: o tipo foi desmarcado e a ficha ficou inativa. Com people.edit a porta não marca o tipo nem reabre a ficha
    const ex = await plantarComFicha({ is_client: true }, false);
    const antesEx = await retrato(ex.id);
    const r = await porCpf({ document: ex.cpf }, await membro("r13-cpf5b@demo.local", ["employees.create", "people.edit"]));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.message).toBe(MSG_FICHA_INATIVA);
    expect(await retrato(ex.id)).toEqual(antesEx);
    expect(antesEx.parceiro).toMatchObject({ is_client: true, is_employee: false });
    // sem people.edit a capacidade vem antes da situação: o mesmo 403 de sempre, sem revelar a ficha
    const semEdit = await porCpf({ document: ex.cpf }, await membro("r13-cpf5c@demo.local", ["employees.create"]));
    expect(semEdit.statusCode, semEdit.body).toBe(403);
    expect(j(semEdit).error.message).toBe(MSG_403);
    expect(await retrato(ex.id)).toEqual(antesEx);
  });

  it("CPF-5b — ficha de RH ATIVA que já existe: 200 com o parceiro e a ficha NÃO é regravada (linha e trilha dela iguais)", async () => {
    const hc = await membro("r13-cpf5d@demo.local", ["employees.create"]);
    const p = await plantarComFicha({ is_employee: true }, true);
    const antes = await retrato(p.id);
    const r = await porCpf({ document: p.cpf }, hc);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: p.id, criado: false });
    expect(await retrato(p.id)).toEqual(antes);
  });
});
