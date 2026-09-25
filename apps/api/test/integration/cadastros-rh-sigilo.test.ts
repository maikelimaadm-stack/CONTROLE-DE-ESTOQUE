import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * R1-2 — SIGILO DE SALÁRIO (decisão 255). Dado de salário = `employee_profiles.base_salary, hour_value, goal_salary,
 * commission_percent` e `job_functions.base_salary, hour_value`, sob `employees.edit`.
 *
 *  SG-1  só employees.view: ficha, lista, Funções, Eventos fixos e o relatório de ativos (tela, CSV e XLSX) — nenhum valor;
 *  SG-2  filtro, ordenação, /distinct, seletor, exportação e relatório salvo por campo sigiloso sem a permissão → 403
 *        com o nome do campo; gravar/criar Função sem a permissão → 403; o seletor genérico de employee_events (as
 *        linhas da grade Eventos fixos) exige employee_events.view;
 *  SG-3  employees.edit vê tudo (e as mesmas perguntas respondem);
 *  SG-4  a FOLHA (exceção declarada): apuração e cálculo mensal com o salário para quem tem a permissão dela;
 *  SG-5  editar aba de RH de perfil INATIVO → continua inativo (fora da folha);
 *  SG-6  limpar data de desligamento, salário e conta de pagamento (PUT null) → null gravado;
 *  SG-7  auditoria: quem, quando e QUAL campo de salário mudou, sem o valor (trilha, /admin/audit e histórico);
 *  SG-8  grades de OUTRO cadastro: Eventos fixos = employee_events.*, Equipes = teams.*, por operação.
 *
 * Cada recusa confere o BANCO pelo papel administrativo (nada gravado); cada membro tem as permissões EXATAS.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string; rawPayload: Buffer };
type Hdr = Record<string, string>;
const j = (r: { body: string }) => JSON.parse(r.body);
const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers }) as unknown as Promise<Resp>;
const envia = (method: "POST" | "PUT", url: string, payload: unknown, headers: Hdr = h.headers({ "content-type": "application/json" })) => h.app.inject({ method, url, headers, payload: payload as Record<string, unknown> }) as unknown as Promise<Resp>;
const put = (id: string, payload: Record<string, unknown>, headers?: Hdr) => envia("PUT", `/api/resources/funcionarios/${id}`, payload, headers);
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);

// valores DISTINTOS, procurados como texto em cada resposta: nenhum deles pode aparecer para quem não tem o sigilo.
// Todos têm 3+ dígitos antes da vírgula: um carimbo de hora ("…:17.171234") nunca os forma por acaso. A comissão
// (máx. 100) é conferida pela AUSÊNCIA da propriedade, não por texto.
const SALARIO = "5432.10"; const HORA = "124.69"; const META = "8765.43"; const COMISSAO = "87.6543";
const SAL_FUNCAO = "3777.77"; const HORA_FUNCAO = "117.17"; const EVENTO_VALOR = "321.09";
const VALORES = ["5432.1", HORA, META, SAL_FUNCAO, HORA_FUNCAO, EVENTO_VALOR];
const semSalario = (texto: string, onde: string) => { for (const v of VALORES) expect(texto.includes(v), `${onde}: vazou ${v}`).toBe(false); };

let F1 = ""; let F2 = ""; let FUNCAO = ""; let EVENTO = ""; let EQUIPE = ""; let EQUIPE2 = ""; let EMPRESA = "";
let hView: Hdr; let hEdit: Hdr; let hFolha: Hdr;

async function membro(email: string, perms: string[], escopos: { modulo: string; modo: "todas" }[] = []): Promise<Hdr> {
  const hash = (await um<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'"))!.password_hash;
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`]))!.id;
  for (const p of perms) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash]))!.id;
  const m = (await um<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel]))!.id;
  for (const e of escopos) await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [h.demo.orgId, m, e.modulo, e.modo]);
  const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } })).token as string;
  return { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId, "content-type": "application/json" };
}
const porCpf = async (document: string, name: string) => (j(await envia("POST", "/api/hr/funcionarios/por-cpf", { document, name })) as { id: string }).id;
const xlsxTexto = async (r: Resp) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
  const celulas: string[] = [];
  wb.worksheets[0]!.eachRow((row) => row.eachCell((c) => celulas.push(String(c.value ?? ""))));
  return celulas;
};
const recusaComCampo = (r: Resp, campo: string, rotulo: string) => {
  expect(r.statusCode, r.body).toBe(403);
  const msg = String(j(r).error.message);
  expect(msg).toContain(campo); expect(msg).toContain(rotulo); expect(msg).toContain("employees.edit");
  semSalario(r.body, `recusa ${campo}`);
};

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  const org = h.demo.orgId;
  EMPRESA = h.demo.empresaIds[0]!;
  FUNCAO = (await um<{ id: string }>("insert into erp.job_functions(organization_id,name,description,base_salary,hour_value) values ($1,'SG Operador','SG',$2,$3) returning id", [org, SAL_FUNCAO, HORA_FUNCAO]))!.id;
  EVENTO = (await um<{ id: string }>("insert into erp.hr_events(organization_id,name,periodicity,method,condition) values ($1,'SG Periculosidade','monthly','fixed','add') returning id", [org]))!.id;
  EQUIPE = (await um<{ id: string }>("insert into erp.teams(organization_id,name) values ($1,'SG Equipe A') returning id", [org]))!.id;
  EQUIPE2 = (await um<{ id: string }>("insert into erp.teams(organization_id,name) values ($1,'SG Equipe B') returning id", [org]))!.id;
  // F1: salário PRÓPRIO, meta, comissão, evento fixo e equipe; F2: sem salário próprio (vale o da FUNÇÃO)
  F1 = await porCpf("39053344705", "SG Funcionário Um");
  F2 = await porCpf("12312312387", "SG Funcionário Dois");
  const r1 = await put(F1, { rh_admissao: { function_id: FUNCAO, admission_date: "2030-01-10" }, rh_remuneracao: { base_salary: SALARIO, hour_value: HORA, goal_salary: META, commission_percent: COMISSAO, jornada_semanal: "44" }, eventos: [{ event_id: EVENTO, amount: EVENTO_VALOR }], equipes: [{ team_id: EQUIPE, member_type: "employee" }] });
  expect(r1.statusCode, r1.body).toBe(200);
  const r2 = await put(F2, { rh_admissao: { function_id: FUNCAO } });
  expect(r2.statusCode, r2.body).toBe(200);
  // A exportação genérica exige `<cadastro>.export`, que o catálogo de Funções não tem (hoje só o proprietário exporta
  // Funções). A capacidade é criada SÓ neste banco de teste para exercitar a porta genérica de exportação com um
  // membro que exporta mas não tem o sigilo — o caso de qualquer cadastro futuro com sigilo e exportação.
  await admin.query("insert into erp.permissions(key,module,resource,action,label) values ('job_functions.export','Administrativo > Gestão Pessoal','Funções','export','Exportar') on conflict do nothing");
  const consulta = ["employees.view", "job_functions.view", "job_functions.export", "report.active_employees.view", "report.active_employees.export", "saved_reports.view", "saved_reports.create"];
  hView = await membro("sg-view@demo.local", consulta);
  hEdit = await membro("sg-edit@demo.local", [...consulta, "employees.edit", "job_functions.edit"]);
  hFolha = await membro("sg-folha@demo.local", ["earnings.view", "earnings.create", "report.monthly_calculation.view"], [{ modulo: "pessoas_rh", modo: "todas" }]);
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("SG-1 — só employees.view: nenhum valor de salário sai", () => {
  it("ficha de RH, lista de funcionários, Funções e Eventos fixos", async () => {
    const ficha = await get(`/api/resources/funcionarios/${F1}`, hView);
    expect(ficha.statusCode, ficha.body).toBe(200);
    const f = j(ficha);
    // a aba Remuneração continua com o que NÃO é salário (jornada); salário, valor hora, meta e comissão não saem
    expect(f.rh_remuneracao).toEqual({ is_active: true, jornada_semanal: "44.00" });
    // Eventos fixos (employee_events.view) e Equipes (teams.view) são de OUTRO cadastro: sem a permissão, a chave não vem
    expect(f).not.toHaveProperty("eventos"); expect(f).not.toHaveProperty("equipes");
    expect(f.rh_admissao.function_id).toBe(FUNCAO);
    semSalario(ficha.body, "ficha");
    const lista = await get(`/api/resources/funcionarios?pageSize=200`, hView);
    expect(lista.statusCode).toBe(200); expect((j(lista).items as { id: string }[]).some((x) => x.id === F1)).toBe(true);
    semSalario(lista.body, "lista");
    const funcoes = await get(`/api/resources/job_functions?pageSize=200`, hView);
    expect(funcoes.statusCode).toBe(200);
    const fn = (j(funcoes).items as Record<string, unknown>[]).find((x) => x["id"] === FUNCAO)!;
    expect(fn["name"]).toBe("SG Operador"); expect(fn).not.toHaveProperty("base_salary"); expect(fn).not.toHaveProperty("hour_value");
    semSalario(funcoes.body, "lista de funções");
    const funcao = await get(`/api/resources/job_functions/${FUNCAO}`, hView);
    expect(funcao.statusCode).toBe(200); expect(j(funcao)).not.toHaveProperty("base_salary"); expect(j(funcao).monthly_hours).toBe(220);
    semSalario(funcao.body, "ficha da função");
  });

  it("relatório Funcionários ativos: sem a coluna de salário e sem o total — na tela (JSON), no CSV e no XLSX", async () => {
    const tela = await get("/api/reports/active_employees", hView);
    expect(tela.statusCode, tela.body).toBe(200);
    const r = j(tela) as { columns: { key: string }[]; rows: Record<string, unknown>[]; totals: Record<string, string> };
    expect(r.columns.map((c) => c.key)).toEqual(["person", "document", "function", "admission_date", "cost_center"]);
    expect(r.totals).toEqual({});
    const nomes = r.rows.map((x) => x["person"]);
    expect(nomes).toContain("SG Funcionário Um"); expect(nomes).toContain("SG Funcionário Dois");
    for (const row of r.rows) expect(row).not.toHaveProperty("base_salary");
    semSalario(tela.body, "relatório (tela)");
    const csv = await get("/api/reports/active_employees?format=csv", hView);
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split("\n")[0]).not.toContain("Salário base"); expect(csv.body).toContain("SG Funcionário Um");
    semSalario(csv.body, "relatório (CSV)");
    const xlsx = await get("/api/reports/active_employees?format=xlsx", hView);
    expect(xlsx.statusCode).toBe(200);
    const celulas = await xlsxTexto(xlsx);
    expect(celulas).toContain("Funcionário"); expect(celulas).not.toContain("Salário base"); expect(celulas).toContain("SG Funcionário Um");
    semSalario(celulas.join("|"), "relatório (XLSX)");
  });
});

describe("SG-2 — campo sigiloso não serve de pergunta nem é gravado sem employees.edit (403 com o nome do campo)", () => {
  it("filtro (campo__op, campo=valor, campo_from), ordenação, valores distintos e filtro do seletor", async () => {
    recusaComCampo(await get(`/api/resources/job_functions?base_salary__gt=1000`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/resources/job_functions?base_salary=${SAL_FUNCAO}`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/resources/job_functions?base_salary_from=1000`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/resources/job_functions?hour_value__lt=100`, hView), "hour_value", "Valor da hora");
    recusaComCampo(await get(`/api/resources/job_functions?sort=base_salary&dir=desc`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/resources/job_functions?sort=hour_value`, hView), "hour_value", "Valor da hora");
    recusaComCampo(await get(`/api/resources/job_functions/distinct?field=base_salary`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/resources/job_functions/options?base_salary=${SAL_FUNCAO}`, hView), "base_salary", "Salário base");
    // a pergunta pelo que NÃO é sigiloso continua respondendo
    const nome = await get(`/api/resources/job_functions?name__contains=SG&sort=name`, hView);
    expect(nome.statusCode, nome.body).toBe(200); expect(j(nome).items.length).toBeGreaterThan(0);
    const distinto = await get(`/api/resources/job_functions/distinct?field=name`, hView);
    expect(distinto.statusCode).toBe(200);
  });

  it("seletor genérico (/options) de employee_events: sem employee_events.view → 403 antes de consultar — nem a lista dos eventos fixos da pessoa, nem a pergunta pelo valor; com a leitura responde; o seletor dos cadastros referenciados continua sem permissão própria", async () => {
    // a ficha esconde a grade Eventos fixos de quem não tem employee_events.view (SG-1); o seletor lê as MESMAS linhas
    for (const [quem, hh] of [["employees.view", hView], ["nenhuma permissão", await membro("sg-opt0@demo.local", [])]] as const) {
      for (const q of [`person_id=${F1}`, `person_id=${F1}&amount=${EVENTO_VALOR}`, "search=SG"]) {
        const r = await get(`/api/resources/employee_events/options?${q}`, hh);
        expect(r.statusCode, `${quem} ${q}: ${r.body}`).toBe(403);
        expect(j(r).error.message).toContain("employee_events.view");
        expect(r.body).not.toContain("SG Periculosidade"); semSalario(r.body, `/options ${q}`);
      }
    }
    const hl = await membro("sg-opt1@demo.local", ["employee_events.view"]);
    const ok = await get(`/api/resources/employee_events/options?person_id=${F1}&amount=${EVENTO_VALOR}`, hl);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((j(ok) as { label: string }[]).map((x) => x.label)).toEqual(["SG Periculosidade"]);
    // o seletor de cadastro REFERENCIADO continua a porta sem permissão própria (o Evento da grade, a Função da ficha)
    for (const recurso of ["hr_events", "job_functions"]) {
      const r = await get(`/api/resources/${recurso}/options?search=SG`, hView);
      expect(r.statusCode, `${recurso}: ${r.body}`).toBe(200); expect((j(r) as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("exportação: a coluna sigilosa não entra no arquivo; ordenar ou filtrar por ela → 403", async () => {
    for (const formato of ["csv", "xlsx"]) {
      const r = await get(`/api/exports/job_functions?format=${formato}`, hView);
      expect(r.statusCode, r.body).toBe(200);
      const texto = formato === "csv" ? r.body : (await xlsxTexto(r)).join("|");
      expect(texto).toContain("SG Operador"); expect(texto).not.toContain("Salário base");
      semSalario(texto, `exportação ${formato}`);
    }
    recusaComCampo(await get(`/api/exports/job_functions?format=csv&sort=base_salary`, hView), "base_salary", "Salário base");
    recusaComCampo(await get(`/api/exports/job_functions?format=xlsx&base_salary__gte=1`, hView), "base_salary", "Salário base");
  });

  it("relatório salvo: coluna, filtro, ordenação, agrupamento e total por campo sigiloso → 403 (rodar, exportar e salvar); nada salvo", async () => {
    const run = (definition: Record<string, unknown>, format?: string) => envia("POST", "/api/saved-reports/run", { resource_key: "job_functions", definition, ...(format ? { format } : {}) }, hView);
    recusaComCampo(await run({ columns: ["name", "base_salary"] }), "base_salary", "Salário base");
    recusaComCampo(await run({ columns: ["name", "base_salary"] }, "csv"), "base_salary", "Salário base");
    recusaComCampo(await run({ columns: ["name"], filters: { base_salary__gt: "1000" } }), "base_salary", "Salário base");
    recusaComCampo(await run({ columns: ["name"], sort: { key: "base_salary", dir: "desc" } }), "base_salary", "Salário base");
    recusaComCampo(await run({ columns: ["name"], groupBy: "hour_value" }), "hour_value", "Valor da hora");
    recusaComCampo(await run({ columns: ["name"], totals: ["base_salary"] }), "base_salary", "Salário base");
    const ok = await run({ columns: ["name", "monthly_hours"] }, "csv");
    expect(ok.statusCode, ok.body).toBe(200); semSalario(ok.body, "relatório salvo sem sigilo");
    // salvar com o campo sigiloso também não
    const antes = await n("select count(*)::text n from erp.saved_reports where organization_id=$1", [h.demo.orgId]);
    recusaComCampo(await envia("POST", "/api/saved-reports", { resource_key: "job_functions", name: "SG salário", definition: { columns: ["name", "base_salary"] } }, hView), "base_salary", "Salário base");
    expect(await n("select count(*)::text n from erp.saved_reports where organization_id=$1", [h.demo.orgId])).toBe(antes);
    // relatório COMPARTILHADO salvo por quem vê o salário: quem não vê não o roda
    const salvo = await envia("POST", "/api/saved-reports", { resource_key: "job_functions", name: "SG salários (dono)", is_shared: true, definition: { columns: ["name", "base_salary"], totals: ["base_salary"] } });
    expect(salvo.statusCode, salvo.body).toBe(201);
    recusaComCampo(await run(j(salvo).definition as Record<string, unknown>), "base_salary", "Salário base");
    // o montador não oferece o campo a quem não o vê
    const campos = (j(await get("/api/saved-reports/resources", hView)) as { key: string; fields: { name: string }[] }[]).find((x) => x.key === "job_functions")!.fields.map((f) => f.name);
    expect(campos).toContain("name"); expect(campos).not.toContain("base_salary"); expect(campos).not.toContain("hour_value");
  });

  it("gravar salário da Função, ou criar Função (salário é obrigatório), sem employees.edit → 403; o resto grava", async () => {
    const hFunc = await membro("sg-funcoes@demo.local", ["job_functions.view", "job_functions.create", "job_functions.edit"]);
    const antes = await n("select count(*)::text n from erp.job_functions where organization_id=$1", [h.demo.orgId]);
    recusaComCampo(await envia("POST", "/api/resources/job_functions", { name: "SG nova", monthly_hours: 220, description: "x" }, hFunc), "base_salary", "Salário base");
    recusaComCampo(await envia("POST", "/api/resources/job_functions", { name: "SG nova", base_salary: "1", hour_value: "1", monthly_hours: 220, description: "x" }, hFunc), "base_salary", "Salário base");
    expect(await n("select count(*)::text n from erp.job_functions where organization_id=$1", [h.demo.orgId])).toBe(antes);
    recusaComCampo(await envia("PUT", `/api/resources/job_functions/${FUNCAO}`, { hour_value: "99" }, hFunc), "hour_value", "Valor da hora");
    expect(await um("select base_salary::text s, hour_value::text hv from erp.job_functions where id=$1", [FUNCAO])).toEqual({ s: SAL_FUNCAO, hv: HORA_FUNCAO });
    const ok = await envia("PUT", `/api/resources/job_functions/${FUNCAO}`, { description: "SG descrição" }, hFunc);
    expect(ok.statusCode, ok.body).toBe(200); semSalario(ok.body, "resposta da gravação");
  });
});

describe("SG-3 — employees.edit vê tudo e pergunta por tudo", () => {
  it("ficha, Funções, relatório de ativos (tela, CSV, XLSX), filtro, ordenação, distintos, exportação e relatório salvo", async () => {
    const f = j(await get(`/api/resources/funcionarios/${F1}`, hEdit));
    expect(f.rh_remuneracao).toMatchObject({ base_salary: SALARIO, hour_value: HORA, goal_salary: META, commission_percent: COMISSAO });
    const fn = (j(await get(`/api/resources/job_functions?pageSize=200`, hEdit)).items as Record<string, unknown>[]).find((x) => x["id"] === FUNCAO)!;
    expect(fn["base_salary"]).toBe(SAL_FUNCAO);
    const rel = j(await get("/api/reports/active_employees", hEdit)) as { columns: { key: string }[]; rows: Record<string, unknown>[]; totals: Record<string, string> };
    expect(rel.columns.map((c) => c.key)).toContain("base_salary");
    const um_ = rel.rows.find((x) => x["person"] === "SG Funcionário Um")!; const dois = rel.rows.find((x) => x["person"] === "SG Funcionário Dois")!;
    expect(um_["base_salary"]).toBe(SALARIO); expect(dois["base_salary"]).toBe(SAL_FUNCAO);
    expect(rel.totals["base_salary"]).toBe(rel.rows.reduce((a, x) => a + Number(x["base_salary"] ?? 0), 0).toFixed(2));
    const csv = await get("/api/reports/active_employees?format=csv", hEdit);
    expect(csv.body.split("\n")[0]).toContain("Salário base"); expect(csv.body).toContain(SALARIO);
    expect(await xlsxTexto(await get("/api/reports/active_employees?format=xlsx", hEdit))).toContain("Salário base");
    const filtrado = await get(`/api/resources/job_functions?base_salary=${SAL_FUNCAO}&sort=base_salary&dir=desc`, hEdit);
    expect(filtrado.statusCode, filtrado.body).toBe(200); expect((j(filtrado).items as { id: string }[]).map((x) => x.id)).toContain(FUNCAO);
    const distintos = await get(`/api/resources/job_functions/distinct?field=base_salary`, hEdit);
    expect(distintos.statusCode).toBe(200); expect((j(distintos) as { value: string }[]).map((x) => x.value)).toContain(SAL_FUNCAO);
    const exp = await get(`/api/exports/job_functions?format=csv&sort=base_salary`, hEdit);
    expect(exp.statusCode, exp.body).toBe(200); expect(exp.body).toContain("Salário base"); expect(exp.body).toContain(SAL_FUNCAO);
    const salvo = await envia("POST", "/api/saved-reports/run", { resource_key: "job_functions", definition: { columns: ["name", "base_salary"], totals: ["base_salary"], sort: { key: "base_salary", dir: "desc" } } }, hEdit);
    expect(salvo.statusCode, salvo.body).toBe(200); expect(salvo.body).toContain(SAL_FUNCAO);
  });
});

describe("SG-4 — a FOLHA continua com o salário para quem tem a permissão dela (exceção da decisão 255)", () => {
  it("apuração mensal (/hr/earnings) e relatório de cálculo mensal sem employees.*", async () => {
    // o membro da folha NÃO tem employees.*: a ficha é 403 para ele
    expect((await get(`/api/resources/funcionarios/${F1}`, hFolha)).statusCode).toBe(403);
    const calc = await envia("POST", "/api/hr/earnings/calculate", { empresa_id: EMPRESA, reference_month: "2032-03-01" }, hFolha);
    expect(calc.statusCode, calc.body).toBe(201);
    const apuracao = j(await get(`/api/hr/earnings/${j(calc).id}`, hFolha)) as { lines: { person_id: string; description: string; amount: string }[] };
    const linha = (p: string, d: string) => apuracao.lines.find((l) => l.person_id === p && l.description === d)?.amount;
    expect(linha(F1, "Salário base")).toBe(SALARIO);
    expect(linha(F2, "Salário base")).toBe(SAL_FUNCAO);
    expect(linha(F1, "SG Periculosidade")).toBe(EVENTO_VALOR);
    const rel = await get(`/api/reports/monthly_calculation?reference_month=2032-03-01`, hFolha);
    expect(rel.statusCode, rel.body).toBe(200);
    const rows = j(rel).rows as { person: string; description: string; amount: string }[];
    expect(rows.find((x) => x.person === "SG Funcionário Um" && x.description === "Salário base")?.amount).toBe(SALARIO);
    expect(j(rel).columns.map((c: { key: string }) => c.key)).toContain("amount");
  });
});

describe("SG-5 — editar aba de RH de perfil INATIVO não o devolve à folha", () => {
  it("documentos, remuneração e admissão gravam; is_active continua false; a apuração não o inclui", async () => {
    const id = await porCpf("11144477735", "SG Inativo");
    await admin.query("update erp.employee_profiles set is_active=false where person_id=$1", [id]);
    for (const corpo of [{ rh_documentos: { rg_numero: "123" } }, { rh_remuneracao: { base_salary: "1111.11" } }, { rh_admissao: { matricula: "SG-INAT" }, rh_desligamento: { motivo_desligamento: "acordo" } }]) {
      const r = await put(id, corpo, hEdit);
      expect(r.statusCode, r.body).toBe(200);
      expect(await um("select is_active from erp.employee_profiles where person_id=$1", [id])).toEqual({ is_active: false });
    }
    expect(await um("select rg_numero, base_salary::text s, matricula from erp.employee_profiles where person_id=$1", [id])).toEqual({ rg_numero: "123", s: "1111.11", matricula: "SG-INAT" });
    const calc = await envia("POST", "/api/hr/earnings/calculate", { empresa_id: EMPRESA, reference_month: "2032-04-01" }, hFolha);
    expect(calc.statusCode, calc.body).toBe(201);
    expect(await n("select count(*)::text n from erp.earning_lines where earning_id=$1 and person_id=$2", [j(calc).id, id])).toBe(0);
    // perfil novo (nunca gravado) continua nascendo ATIVO pelo default da coluna
    expect(await um("select is_active from erp.employee_profiles where person_id=$1", [F2])).toEqual({ is_active: true });
  });
});

describe("SG-6 — campo esvaziado vai null e é gravado null", () => {
  it("data de desligamento, salário e conta de pagamento: PUT null limpa; o que não veio fica", async () => {
    const id = await porCpf("52998224725", "SG Desligado");
    const conta = (await um<{ id: string }>("insert into erp.parceiro_contas(organization_id,person_id,conta) values ($1,$2,'77') returning id", [h.demo.orgId, id]))!.id;
    const cheio = await put(id, { rh_desligamento: { dismissal_date: "2032-06-30", motivo_desligamento: "acordo" }, rh_remuneracao: { base_salary: "1500" }, rh_pagamento: { conta_pagamento_id: conta } });
    expect(cheio.statusCode, cheio.body).toBe(200);
    expect(await um("select dismissal_date::text d, base_salary::text s, conta_pagamento_id::text c from erp.employee_profiles where person_id=$1", [id])).toEqual({ d: "2032-06-30", s: "1500.00", c: conta });
    const limpo = await put(id, { rh_desligamento: { dismissal_date: null }, rh_remuneracao: { base_salary: null }, rh_pagamento: { conta_pagamento_id: null } });
    expect(limpo.statusCode, limpo.body).toBe(200);
    expect(await um("select dismissal_date, base_salary, conta_pagamento_id, motivo_desligamento from erp.employee_profiles where person_id=$1", [id])).toEqual({ dismissal_date: null, base_salary: null, conta_pagamento_id: null, motivo_desligamento: "acordo" });
  });
});

describe("SG-7 — auditoria: quem, quando e QUAL campo de salário mudou, SEM o valor", () => {
  const naTrilha = (v: string) => n("select count(*)::text n from erp.audit_logs where coalesce(before::text,'') || coalesce(after::text,'') || coalesce(metadata::text,'') like $1", [`%${v}%`]);
  it("ficha de RH e Função: a trilha registra o campo em metadata.sigilo; o valor não está em lugar nenhum da trilha", async () => {
    const usuario = (await um<{ id: string }>("select id::text from erp.users where email='sg-edit@demo.local'"))!.id;
    const marca = (await um<{ m: string }>("select coalesce(max(id),0)::text m from erp.audit_logs"))!.m;
    const r = await put(F1, { rh_remuneracao: { base_salary: "6111.22", goal_salary: "9222.33" }, rh_documentos: { rg_numero: "RG-SG7" } }, hEdit);
    expect(r.statusCode, r.body).toBe(200);
    const eventos = (await admin.query<{ user_id: string; action: string; before: Record<string, unknown>; after: Record<string, unknown>; metadata: { sigilo?: string[] } | null; created_at: string }>(
      "select user_id::text, action, before, after, metadata, created_at from erp.audit_logs where id > $1::bigint and entity='employee_profiles' and entity_id=$2 order by id", [marca, F1])).rows;
    expect(eventos.length).toBeGreaterThanOrEqual(1);
    for (const e of eventos) {
      expect(e.user_id).toBe(usuario); expect(e.action).toBe("update"); expect(e.created_at).toBeTruthy();
      for (const c of ["base_salary", "hour_value", "goal_salary", "commission_percent"]) { expect(e.before).not.toHaveProperty(c); expect(e.after).not.toHaveProperty(c); }
    }
    const sigilosos = eventos.flatMap((e) => e.metadata?.sigilo ?? []).sort();
    expect(sigilosos).toEqual(["base_salary", "goal_salary"]);
    // o que NÃO é sigiloso continua com o valor na trilha (o comportamento de sempre da auditoria)
    expect(eventos.some((e) => e.after["rg_numero"] === "RG-SG7")).toBe(true);
    for (const v of ["6111.22", "9222.33", SALARIO, META]) expect(await naTrilha(v), v).toBe(0);
    // Função
    const f = await envia("PUT", `/api/resources/job_functions/${FUNCAO}`, { base_salary: "3888.88" }, hEdit);
    expect(f.statusCode, f.body).toBe(200);
    const ef = await um<{ metadata: { sigilo: string[] }; after: Record<string, unknown>; user_id: string }>("select metadata, after, user_id::text from erp.audit_logs where entity='job_functions' and entity_id=$1 and action='update' order by id desc limit 1", [FUNCAO]);
    expect(ef!.metadata).toEqual({ sigilo: ["base_salary"] }); expect(ef!.after).not.toHaveProperty("base_salary"); expect(ef!.after).not.toHaveProperty("hour_value"); expect(ef!.user_id).toBe(usuario);
    for (const v of ["3888.88", SAL_FUNCAO, HORA_FUNCAO]) expect(await naTrilha(v), v).toBe(0);
  });

  it("histórico da ficha (employees.view) e /admin/audit mostram o campo, nunca o valor", async () => {
    const hist = await get(`/api/resources/funcionarios/${F1}/historico?pageSize=100`, hView);
    expect(hist.statusCode, hist.body).toBe(200);
    const itens = j(hist).items as { acao: string; onde: string; campos: string[]; quem: string | null }[];
    const doSalario = itens.find((x) => x.acao === "update" && x.campos.includes("Salário base"));
    expect(doSalario, hist.body).toBeDefined();
    expect(doSalario!.onde).toBe("Remuneração"); expect(doSalario!.campos).toContain("Meta"); expect(doSalario!.quem).toBe("sg-edit@demo.local");
    semSalario(hist.body, "histórico"); expect(hist.body).not.toContain("6111"); expect(hist.body).not.toContain("9222");
    const trilha = await get(`/api/admin/audit?entity=employee_profiles&entity_id=${F1}&pageSize=200`);
    expect(trilha.statusCode, trilha.body).toBe(200); expect(j(trilha).items.length).toBeGreaterThan(0);
    for (const v of ["6111.22", "9222.33", SALARIO, META]) expect(trilha.body.includes(v), v).toBe(false);
    expect(trilha.body).toContain("base_salary");
  });
});

describe("SG-8 — Eventos fixos e Equipes obedecem às permissões do cadastro DELES, por operação", () => {
  const estado = async () => ({
    eventos: (await admin.query("select event_id::text, amount::text, is_active from erp.employee_events where person_id=$1 order by event_id", [F1])).rows,
    equipes: (await admin.query("select team_id::text, member_type, is_active from erp.team_members where person_id=$1 order by team_id", [F1])).rows
  });
  it("sem employee_events.view / teams.view: a grade não sai e o corpo que a traz é recusado (403); nada muda", async () => {
    const h0 = await membro("sg-ev0@demo.local", ["employees.view", "employees.edit"]);
    const antes = await estado();
    const f = j(await get(`/api/resources/funcionarios/${F1}`, h0));
    expect(f).not.toHaveProperty("eventos"); expect(f).not.toHaveProperty("equipes");
    const ev = await put(F1, { eventos: [] }, h0);
    expect(ev.statusCode, ev.body).toBe(403); expect(j(ev).error.message).toContain("employee_events.view");
    const eq = await put(F1, { equipes: [] }, h0);
    expect(eq.statusCode, eq.body).toBe(403); expect(j(eq).error.message).toContain("teams.view");
    expect(await estado()).toEqual(antes);
    // as outras abas continuam gravando
    expect((await put(F1, { rh_documentos: { rg_orgao: "SSP" } }, h0)).statusCode).toBe(200);
  });

  it("com a leitura: reenviar igual grava; incluir exige create, mudar exige edit, tirar exige delete (403 e nada muda)", async () => {
    const hv = await membro("sg-evv@demo.local", ["employees.view", "employees.edit", "employee_events.view", "teams.view"]);
    const f = j(await get(`/api/resources/funcionarios/${F1}`, hv)) as { eventos: { id: string; event_id: string; amount: string; is_active: boolean }[]; equipes: { team_id: string; member_type: string; is_active: boolean }[] };
    expect(f.eventos).toHaveLength(1); expect(f.eventos[0]!.amount).toBe(EVENTO_VALOR); expect(f.equipes).toHaveLength(1);
    const antes = await estado();
    // reenviar a grade como veio (a tela manda a lista completa): nenhuma operação, nenhuma permissão a mais
    const igual = await put(F1, { eventos: f.eventos.map((e) => ({ id: e.id, event_id: e.event_id, amount: "321.090", is_active: e.is_active })), equipes: f.equipes }, hv);
    expect(igual.statusCode, igual.body).toBe(200);
    const evento2 = (await um<{ id: string }>("insert into erp.hr_events(organization_id,name,periodicity,method,condition) values ($1,'SG Insalubridade','monthly','fixed','add') returning id", [h.demo.orgId]))!.id;
    const casos: [Record<string, unknown>, string][] = [
      [{ eventos: [...f.eventos, { event_id: evento2, amount: "10" }] }, "employee_events.create"],
      [{ eventos: [{ ...f.eventos[0]!, amount: "999.00" }] }, "employee_events.edit"],
      [{ eventos: [] }, "employee_events.delete"],
      [{ equipes: [...f.equipes, { team_id: EQUIPE2, member_type: "employee" }] }, "teams.edit"],
      [{ equipes: [{ ...f.equipes[0]!, member_type: "outsourced" }] }, "teams.edit"],
      [{ equipes: [] }, "teams.edit"]
    ];
    for (const [corpo, perm] of casos) {
      const r = await put(F1, corpo, hv);
      expect(r.statusCode, `${perm}: ${r.body}`).toBe(403); expect(j(r).error.message).toContain(perm);
      expect(await estado()).toEqual(antes);
    }
    // com employee_events.create: incluir grava; tirar a linha gravada continua exigindo delete
    const hc = await membro("sg-evc@demo.local", ["employees.view", "employees.edit", "employee_events.view", "employee_events.create"]);
    const tirar = await put(F1, { eventos: [{ event_id: evento2, amount: "10" }] }, hc);
    expect(tirar.statusCode, tirar.body).toBe(403); expect(j(tirar).error.message).toContain("employee_events.delete");
    const incluir = await put(F1, { eventos: [...f.eventos, { event_id: evento2, amount: "10" }] }, hc);
    expect(incluir.statusCode, incluir.body).toBe(200);
    expect((await estado()).eventos).toHaveLength(2);
  });
});
