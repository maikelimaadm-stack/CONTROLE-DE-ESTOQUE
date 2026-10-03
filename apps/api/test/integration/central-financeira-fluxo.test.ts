import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — FLUXO E RESULTADO, ADIANTAMENTOS E NATUREZAS PADRÃO (OPERACOES-01 F8, decisão 285).
 *
 * Os cenários são semeados direto no banco (pelo superusuário, como as outras suítes de agregado), em anos sem
 * outro lançamento — e a primeira asserção de cada bloco PROVA isso, para o total medido ser o do cenário.
 *   • Fluxo (março/2032): realizado × previsto por dia, semana e mês; a transferência entre as contas fora das
 *     entradas/saídas e dentro de `transferencias_liquidas`; saldo acumulado; o recorte por empresa (sem saldo) e o
 *     agrupamento; `previstos=1` aceito (a série da provisão é da F9 — aqui, sem nenhum previsto, ela vem zerada); as portas.
 *   • DRE (jan–fev/2033): o título de competência em janeiro baixado em fevereiro aparece na competência de janeiro
 *     e no caixa de fevereiro; juros na natureza do componente; desconto obtido na natureza gravada na baixa; o grupo
 *     herdado do pai marcado (`grupo_dre`); investimentos separados; adiantamento fora da competência.
 *   • Adiantamentos por parceiro × empresa (o tipo de título `is_advance` LIDO) e os títulos com crédito.
 *   • Naturezas padrão: válida grava; sintética, inativa, de outra organização ou de tipo errado → 422 no campo.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let seq = 0;
type Json = Record<string, unknown> & { error?: { code: string; message: string; details?: { path: string[]; message: string }[] } };
const j = (r: { json: () => unknown }) => r.json() as Json;
const cod = (p: string) => `${p}${String(++seq).padStart(4, "0")}`;

const conta = async (code: string, saldo: string) =>
  (await admin.query<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,$2,$3,'checking',$4) returning id",
    [h.demo.orgId, code, `[F8] ${code}`, saldo])).rows[0]!.id;
const movimento = async (contaId: string, data: string, tipo: "in" | "out", valor: string, o: { categoria?: string; empresa?: string; status?: string; origem?: string; origemId?: string | null; geraObrigacao?: boolean; componente?: string; baixa?: string; par?: string; destino?: string; tipoTransferencia?: string } = {}) =>
  (await admin.query<{ id: string }>(
    `insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status,source_type,source_id,generates_obligation,componente_baixa,title_settlement_id,destination_account_id,tipo_transferencia)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [h.demo.orgId, cod("F8X"), contaId, o.empresa ?? I.empresa, data, tipo, o.categoria ?? tipo, valor, o.status ?? "confirmed", o.origem ?? "manual", o.origemId ?? null, o.geraObrigacao ?? false,
      o.componente ?? null, o.baixa ?? null, o.destino ?? null, o.tipoTransferencia ?? null])).rows[0]!.id;
const rateioDoMovimento = (mov: string, natureza: string, valor: string) =>
  admin.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,cost_center_id,percentage,amount) values ($1,$2,$3,100,$4)", [mov, natureza, I.costCenter, valor]);
const titulo = async (direcao: "payable" | "receivable", valor: string, o: { emissao?: string; vencimento?: string; competencia?: string | null; conta?: string | null; empresa?: string; status?: string; pessoa?: string | null; forma?: string; tipo?: string | null; natureza?: string } = {}) => {
  const id = (await admin.query<{ id: string }>(
    `insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,person_id,payment_type,title_type_id,amount,emission_date,due_date,data_competencia,conta_prevista_id,status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [h.demo.orgId, o.empresa ?? I.empresa, cod("F8T"), direcao, cod("DOC-"), o.pessoa ?? null, o.forma ?? "single", o.tipo ?? null, valor, o.emissao ?? "2032-03-01", o.vencimento ?? "2032-03-01",
      o.competencia ?? null, o.conta ?? null, o.status ?? "open"])).rows[0]!.id;
  if (o.natureza) await admin.query("insert into erp.title_apportionments(title_id,financial_category_id,cost_center_id,percentage,amount) values ($1,$2,$3,100,$4)", [id, o.natureza, I.costCenter, valor]);
  return id;
};
const baixa = async (tituloId: string, data: string, valor: string, o: { desconto?: string; juros?: string; liquido?: string; movimento?: string | null; naturezaDesconto?: string | null; adiantamento?: string | null } = {}) =>
  (await admin.query<{ id: string }>(
    `insert into erp.title_settlements(organization_id,title_id,settlement_date,settlement_kind,bank_movement_id,amount,discount,interest,net_amount,natureza_desconto_id,adiantamento_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [h.demo.orgId, tituloId, data, o.adiantamento ? "advance_compensation" : "bank_movement", o.movimento ?? null, valor, o.desconto ?? "0", o.juros ?? "0", o.liquido ?? valor, o.naturezaDesconto ?? null, o.adiantamento ?? null])).rows[0]!.id;
const natureza = async (code: string, name: string, nature: "income" | "expense" | "both", o: { kind?: string; parent?: string | null; grupo?: string | null; classificacao?: string; ativa?: boolean; org?: string } = {}) =>
  (await admin.query<{ id: string }>(
    "insert into erp.financial_categories(organization_id,parent_id,code,name,nature,kind,classification,grupo_dre,is_active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [o.org ?? h.demo.orgId, o.parent ?? null, code, name, nature, o.kind ?? "analytic", o.classificacao ?? "unclassified", o.grupo ?? null, o.ativa ?? true])).rows[0]!.id;

async function usuarioCom(email: string, permissoes: string[]): Promise<Record<string, string>> {
  const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
  const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`])).rows[0]!.id;
  for (const p of permissoes) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
  const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) select $1,$2,mm.chave,'todas' from erp.modulos_escopo_empresa mm", [h.demo.orgId, m]);
  const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  expect(r.statusCode, r.body).toBe(200);
  return { authorization: `Bearer ${(r.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
const get = (url: string, headers = h.headers()) => h.app.inject({ method: "GET", url, headers });
const put = (url: string, payload: unknown, headers = h.headers()) => h.app.inject({ method: "PUT", url, payload: payload as Record<string, unknown>, headers });

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 });
}, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

// ---------------------------------------------------------------------------------------------------------------
describe("fluxo de caixa: previsto × realizado", () => {
  let FA = ""; let FB = "";
  type Periodo = { inicio: string; fim: string; realizado: Record<string, string>; previsto: Record<string, string>; saldo_realizado: string | null; saldo_projetado: string | null };
  type Fluxo = Json & { saldo_inicial: string | null; periodos: Periodo[]; previsto_em_atraso: Record<string, string>; direcoes_previstas: string[]; modo: string; grupos?: { chave: string | null; rotulo: string; saldo_inicial: string | null; periodos: Periodo[] }[] };
  const fluxo = async (qs: string, headers = h.headers()) => {
    const r = await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&contas=${FA},${FB}${qs}`, headers);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as Fluxo;
  };
  const doDia = (f: Fluxo, dia: string) => f.periodos.find((p) => p.inicio === dia)!;

  beforeAll(async () => {
    FA = await conta("FLX-A", "1000"); FB = await conta("FLX-B", "0");
    await movimento(FA, "2032-02-20", "in", "100.00");
    await movimento(FA, "2032-03-02", "in", "500.00");
    await movimento(FA, "2032-03-03", "out", "200.00");
    const ida = await movimento(FA, "2032-03-03", "out", "300.00", { categoria: "internal_transfer", destino: FB, tipoTransferencia: "transferencia" });
    const volta = await movimento(FB, "2032-03-03", "in", "300.00", { categoria: "internal_transfer", destino: FA, tipoTransferencia: "transferencia", origem: "bank_movement", origemId: ida });
    await admin.query("update erp.bank_movements set transfer_pair_id=$2 where id=$1", [ida, volta]);
    await movimento(FB, "2032-03-10", "in", "50.00", { empresa: I.empresa2 });
    await movimento(FA, "2032-03-04", "in", "999.00", { status: "cancelled" });
    await titulo("receivable", "400.00", { vencimento: "2032-03-05", conta: FA });
    await titulo("payable", "150.00", { vencimento: "2032-03-12", conta: FB });
    await titulo("receivable", "70.00", { vencimento: "2032-02-15", conta: FA });
    await titulo("payable", "999.00", { vencimento: "2032-03-05", conta: FA, status: "cancelled" });
    await titulo("receivable", "80.00", { vencimento: "2032-03-20", conta: FA, empresa: I.empresa2 });
    const parcial = await titulo("payable", "100.00", { vencimento: "2032-03-25", conta: FB });
    await baixa(parcial, "2032-02-28", "40.00");
  });

  it("por DIA: entradas e saídas realizadas e previstas, a transferência só no líquido, saldo e projeção acumulados", async () => {
    // Premissas: a baixa parcial deixou o título com saldo 60; o cancelado existe.
    expect((await admin.query<{ s: string }>("select status||':'||balance::text as s from erp.financial_titles where organization_id=$1 and amount=100 and conta_prevista_id=$2", [h.demo.orgId, FB])).rows[0]!.s).toBe("partially_paid:60.00");
    const f = await fluxo("&agrupamento=dia");
    expect(f.modo).toBe("organizacao");
    expect(f.periodos).toHaveLength(31);
    expect(f.saldo_inicial, "1000 + 100 antes do período").toBe("1100.00");
    expect(doDia(f, "2032-03-02")).toMatchObject({ realizado: { entradas: "500.00", saidas: "0.00", transferencias_liquidas: "0.00" }, saldo_realizado: "1600.00" });
    expect(doDia(f, "2032-03-03"), "a transferência entre as duas contas filtradas se anula e não é saída")
      .toMatchObject({ realizado: { entradas: "0.00", saidas: "200.00", transferencias_liquidas: "0.00" }, saldo_realizado: "1400.00" });
    expect(doDia(f, "2032-03-04").realizado.entradas, "cancelado não entra").toBe("0.00");
    expect(doDia(f, "2032-03-05")).toMatchObject({ previsto: { entradas: "400.00", saidas: "0.00" }, saldo_projetado: "1800.00" });
    expect(doDia(f, "2032-03-10")).toMatchObject({ realizado: { entradas: "50.00" }, saldo_realizado: "1450.00", saldo_projetado: "1850.00" });
    expect(doDia(f, "2032-03-12").previsto.saidas).toBe("150.00");
    expect(doDia(f, "2032-03-25").previsto.saidas, "o previsto é o SALDO do título").toBe("60.00");
    expect(doDia(f, "2032-03-31")).toMatchObject({ saldo_realizado: "1450.00", saldo_projetado: "1720.00" });
    expect(f.previsto_em_atraso).toEqual({ entradas: "70.00", saidas: "0.00" });
    expect(f.direcoes_previstas).toEqual(["receivable", "payable"]);
  });

  it("por SEMANA (segunda-feira) e por MÊS, os mesmos números", async () => {
    const s = await fluxo("&agrupamento=semana");
    expect(s.periodos.map((p) => [p.inicio, p.fim])).toEqual([["2032-03-01", "2032-03-07"], ["2032-03-08", "2032-03-14"], ["2032-03-15", "2032-03-21"], ["2032-03-22", "2032-03-28"], ["2032-03-29", "2032-04-04"]]);
    expect(s.periodos.map((p) => [p.realizado.entradas, p.realizado.saidas, p.previsto.entradas, p.previsto.saidas])).toEqual([
      ["500.00", "200.00", "400.00", "0.00"], ["50.00", "0.00", "0.00", "150.00"], ["0.00", "0.00", "80.00", "0.00"], ["0.00", "0.00", "0.00", "60.00"], ["0.00", "0.00", "0.00", "0.00"]
    ]);
    const m = await fluxo("&agrupamento=mes");
    expect(m.periodos).toEqual([{ inicio: "2032-03-01", fim: "2032-03-31", realizado: { entradas: "550.00", saidas: "200.00", transferencias_liquidas: "0.00", saldos_iniciais: "0.00" }, previsto: { entradas: "480.00", saidas: "210.00" }, saldo_realizado: "1450.00", saldo_projetado: "1720.00" }]);
  });

  it("uma conta só: a transferência aparece no líquido (saiu dela) e continua fora das saídas", async () => {
    const r = await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&agrupamento=mes&contas=${FA}`);
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r) as Fluxo).periodos[0]).toMatchObject({ realizado: { entradas: "500.00", saidas: "200.00", transferencias_liquidas: "-300.00" }, previsto: { entradas: "480.00", saidas: "0.00" }, saldo_realizado: "1100.00", saldo_projetado: "1580.00" });
  });

  it("por EMPRESA: sem saldo (saldo de conta é da organização) e só a empresa pedida", async () => {
    const f = await fluxo(`&agrupamento=mes&empresa_id=${I.empresa}`);
    expect(f.modo).toBe("empresa");
    expect(f.saldo_inicial).toBeNull();
    expect(f.periodos[0]).toEqual({ inicio: "2032-03-01", fim: "2032-03-31", realizado: { entradas: "500.00", saidas: "200.00", transferencias_liquidas: "0.00", saldos_iniciais: "0.00" }, previsto: { entradas: "400.00", saidas: "210.00" }, saldo_realizado: null, saldo_projetado: null });
    const g = await fluxo("&agrupamento=mes&agrupar_por=empresa");
    const porEmpresa = Object.fromEntries((g.grupos ?? []).map((x) => [x.chave, [x.periodos[0]!.realizado.entradas, x.periodos[0]!.previsto.entradas, x.saldo_inicial]]));
    expect(porEmpresa).toEqual({ [I.empresa]: ["500.00", "400.00", null], [I.empresa2]: ["50.00", "80.00", null] });
    expect(g.periodos[0]!.realizado.entradas, "o total soma as empresas").toBe("550.00");
  });

  it("agrupar por CONTA: cada conta com o seu saldo", async () => {
    const f = await fluxo("&agrupamento=mes&agrupar_por=conta");
    const porConta = Object.fromEntries((f.grupos ?? []).map((x) => [x.chave, [x.saldo_inicial, x.periodos[0]!.realizado.transferencias_liquidas, x.periodos[0]!.saldo_realizado]]));
    expect(porConta).toEqual({ [FA]: ["1100.00", "-300.00", "1100.00"], [FB]: ["0.00", "300.00", "350.00"] });
  });

  it("previstos=1 → 200 com a série da provisão (F9; zerada: nenhum previsto aqui); período pela metade e query desconhecida → 422", async () => {
    const r = await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&agrupamento=mes&contas=${FA},${FB}&previstos=1`);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ previstos_incluidos: true, provisao_em_atraso: { entradas: "0.00", saidas: "0.00" } });
    expect((j(r) as Fluxo).periodos[0]).toMatchObject({ previsto: { entradas: "480.00", saidas: "210.00" }, saldo_projetado: "1720.00", provisao: { entradas: "0.00", saidas: "0.00" }, saldo_projetado_com_previstos: "1720.00" });
    expect((await get("/api/financeiro/fluxo?de=2032-03-01")).statusCode).toBe(422);
    expect((await get("/api/financeiro/fluxo?periodo=mensal")).statusCode).toBe(422);
    expect((await get("/api/financeiro/fluxo?contas=nao-e-uuid")).statusCode).toBe(422);
  });

  it("portas: o fluxo da ORGANIZAÇÃO exige bank_accounts.view; o por empresa, não; sem ver títulos, sem previsto", async () => {
    const semConta = await usuarioCom("f8-fluxo-empresa@demo.local", ["cash_flow.view", "bank_movements.view", "payables.view", "receivables.view"]);
    expect((await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&contas=${FA},${FB}`, semConta)).statusCode).toBe(403);
    const porEmpresa = await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&agrupamento=mes&contas=${FA},${FB}&empresa_id=${I.empresa}`, semConta);
    expect(porEmpresa.statusCode, porEmpresa.body).toBe(200);
    expect((j(porEmpresa) as Fluxo).periodos[0]!.realizado.entradas).toBe("500.00");
    const semMovimentos = await usuarioCom("f8-fluxo-sem-mov@demo.local", ["cash_flow.view", "bank_accounts.view"]);
    expect((await get(`/api/financeiro/fluxo?de=2032-03-01&ate=2032-03-31&contas=${FA}`, semMovimentos)).statusCode).toBe(403);
    const semTitulos = await usuarioCom("f8-fluxo-sem-titulos@demo.local", ["cash_flow.view", "bank_movements.view", "bank_accounts.view"]);
    const f = await fluxo("&agrupamento=mes", semTitulos);
    expect(f.direcoes_previstas).toEqual([]);
    expect(f.periodos[0]!.previsto, "premissa: há títulos previstos (480/210) — quem não vê títulos não os recebe").toEqual({ entradas: "0.00", saidas: "0.00" });
    expect(f.periodos[0]!.realizado.entradas).toBe("550.00");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("resultado (DRE gerencial): competência × caixa", () => {
  const N: Record<string, string> = {};
  type Dre = Json & { grupos: { grupo: string; total: string; naturezas: { id: string; total: string }[] }[]; receitaLiquida: string; resultadoOperacional: string; investimentos: string; resultadoFinal: string; regime: string };
  const dre = async (qs: string) => {
    const r = await get(`/api/financeiro/resultado?${qs}`);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as Dre;
  };
  const grupos = (d: Dre) => Object.fromEntries(d.grupos.map((g) => [g.grupo, Object.fromEntries(g.naturezas.map((n) => [n.id, n.total]))]));

  beforeAll(async () => {
    N["P_CUSTO"] = await natureza("F8D.1", "Custos de produção", "expense", { kind: "synthetic", grupo: "custos" });
    N["CUSTO"] = await natureza("F8D.1.1", "Ração", "expense", { parent: N["P_CUSTO"] });
    N["REC"] = await natureza("F8D.2", "Venda de gado", "income");
    N["JUROS"] = await natureza("F8D.3", "Juros pagos", "expense");
    N["DESC"] = await natureza("F8D.4", "Descontos obtidos", "income");
    N["INV"] = await natureza("F8D.5", "Máquinas", "expense", { classificacao: "capex" });
    N["OBR"] = await natureza("F8D.6", "Frete", "expense");
    const C = await conta("DRE", "0");
    const p1 = await titulo("payable", "1000.00", { emissao: "2033-01-10", competencia: "2033-01-15", vencimento: "2033-02-05", natureza: N["CUSTO"] });
    await titulo("receivable", "2000.00", { emissao: "2033-01-20", vencimento: "2033-03-01", natureza: N["REC"] });
    await titulo("payable", "500.00", { emissao: "2033-01-05", vencimento: "2033-01-05", forma: "advance", natureza: N["CUSTO"] });
    await titulo("payable", "123.00", { emissao: "2033-01-07", vencimento: "2033-01-07", status: "cancelled", natureza: N["CUSTO"] });
    // A baixa do título em fevereiro, na semântica B: valor 1000 (com o desconto de 50), juros 10 em lançamento separado.
    const principal = await movimento(C, "2033-02-05", "out", "950.00", { origem: "title_settlements", origemId: p1 });
    await rateioDoMovimento(principal, N["CUSTO"]!, "950.00");
    const b = await baixa(p1, "2033-02-05", "1000.00", { desconto: "50.00", juros: "10.00", liquido: "960.00", movimento: principal, naturezaDesconto: N["DESC"] });
    const juros = await movimento(C, "2033-02-05", "out", "10.00", { origem: "title_settlements", origemId: p1, componente: "juros", baixa: b });
    await rateioDoMovimento(juros, N["JUROS"]!, "10.00");
    const maquina = await movimento(C, "2033-02-10", "out", "300.00");
    await rateioDoMovimento(maquina, N["INV"]!, "300.00");
    const comObrigacao = await movimento(C, "2033-02-11", "out", "77.00", { geraObrigacao: true });
    await rateioDoMovimento(comObrigacao, N["OBR"]!, "77.00");
    await movimento(C, "2033-02-12", "out", "500.00", { categoria: "internal_transfer" });
  });

  it("premissa: em 2033 só há os lançamentos deste cenário", async () => {
    const titulos = await admin.query<{ n: string }>("select count(*) n from erp.financial_titles where organization_id=$1 and coalesce(data_competencia, emission_date) between '2033-01-01' and '2033-12-31' and number not like 'DOC-%'", [h.demo.orgId]);
    const movimentos = await admin.query<{ n: string }>("select count(*) n from erp.bank_movements where organization_id=$1 and movement_date between '2033-01-01' and '2033-12-31' and code not like 'F8X%'", [h.demo.orgId]);
    expect([titulos.rows[0]!.n, movimentos.rows[0]!.n]).toEqual(["0", "0"]);
    expect((await admin.query<{ status: string }>("select status from erp.financial_titles where amount=1000 and emission_date='2033-01-10'")).rows[0]!.status, "a baixa B quitou o título").toBe("paid");
  });

  it("COMPETÊNCIA de janeiro: o custo no grupo herdado do pai, a receita; o adiantamento e o cancelado fora", async () => {
    const d = await dre("de=2033-01-01&ate=2033-01-31&regime=competencia");
    expect(grupos(d)).toEqual({ receitas: { [N["REC"]!]: "2000.00" }, custos: { [N["CUSTO"]!]: "-1000.00" } });
    expect([d.receitaLiquida, d.resultadoOperacional, d.investimentos, d.resultadoFinal]).toEqual(["2000.00", "1000.00", "0.00", "1000.00"]);
    expect(d.regime).toBe("competencia");
  });

  it("CAIXA de janeiro: nada (o título só foi pago em fevereiro)", async () => {
    const d = await dre("de=2033-01-01&ate=2033-01-31&regime=caixa");
    expect(d.grupos).toEqual([]);
    expect(d.resultadoFinal).toBe("0.00");
  });

  it("CAIXA de fevereiro: o pago (líquido do desconto), os juros, o investimento e o movimento que gerou obrigação; a transferência fora", async () => {
    const d = await dre("de=2033-02-01&ate=2033-02-28&regime=caixa");
    expect(grupos(d)).toEqual({ custos: { [N["CUSTO"]!]: "-950.00" }, despesas: { [N["JUROS"]!]: "-10.00", [N["OBR"]!]: "-77.00" }, investimentos: { [N["INV"]!]: "-300.00" } });
    expect([d.resultadoOperacional, d.investimentos, d.resultadoFinal]).toEqual(["-1037.00", "-300.00", "-1337.00"]);
  });

  it("COMPETÊNCIA de fevereiro: o desconto obtido (natureza da baixa), os juros (componente) e o avulso; o principal da baixa e o que gerou obrigação fora", async () => {
    const d = await dre("de=2033-02-01&ate=2033-02-28&regime=competencia");
    expect(grupos(d)).toEqual({ receitas: { [N["DESC"]!]: "50.00" }, despesas: { [N["JUROS"]!]: "-10.00" }, investimentos: { [N["INV"]!]: "-300.00" } });
    expect(d.resultadoFinal).toBe("-260.00");
  });

  it("por empresa: outra empresa não vê o cenário; query estrita", async () => {
    const d = await dre(`de=2033-01-01&ate=2033-02-28&regime=competencia&empresa_id=${I.empresa2}`);
    expect(d.grupos).toEqual([]);
    expect((await get("/api/financeiro/resultado?de=2033-01-01&ate=2033-01-31&regime=gerencial")).statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("resultado no CAIXA: adiantamento é financeiro; o liquidado sem caixa entra na data da baixa", () => {
  const N: Record<string, string> = {};
  type Dre = Json & { grupos: { grupo: string; naturezas: { id: string; total: string }[] }[]; resultadoFinal: string };
  const dre = async (qs: string) => { const r = await get(`/api/financeiro/resultado?${qs}`); expect(r.statusCode, r.body).toBe(200); return j(r) as Dre; };
  const porNatureza = (d: Dre) => Object.fromEntries(d.grupos.flatMap((g) => g.naturezas.map((n) => [n.id, n.total])));

  beforeAll(async () => {
    N["ENERGIA"] = await natureza("F8E.1", "Energia elétrica", "expense");
    N["FRETE"] = await natureza("F8E.2", "Frete de saída", "expense");
    N["VENDA"] = await natureza("F8E.3", "Venda de grãos", "income");
    const C = await conta("ADT", "0");
    // A conta de energia de 100 paga com 150 (excedente de 50 vira crédito): UM movimento de 150 no rateio do título,
    // como a `settle` grava — o título baixado por 100 e o crédito (adiantamento) por 50, pelo MESMO movimento.
    const energia = await titulo("payable", "100.00", { emissao: "2035-02-01", vencimento: "2035-02-10", natureza: N["ENERGIA"] });
    const mov = await movimento(C, "2035-02-10", "out", "150.00", { origem: "title_settlements", origemId: energia });
    await rateioDoMovimento(mov, N["ENERGIA"]!, "150.00");
    await baixa(energia, "2035-02-10", "100.00", { movimento: mov });
    const credito = await titulo("payable", "50.00", { emissao: "2035-02-10", vencimento: "2035-02-10", forma: "advance", natureza: N["ENERGIA"] });
    await baixa(credito, "2035-02-10", "50.00", { movimento: mov });
    // Em março, o crédito quita 40 de um frete (sem movimento) e um encontro de contas de 30 (frete × venda).
    const frete = await titulo("payable", "40.00", { emissao: "2035-03-01", vencimento: "2035-03-05", natureza: N["FRETE"] });
    await baixa(frete, "2035-03-05", "40.00", { adiantamento: credito });
    const p3 = await titulo("payable", "30.00", { emissao: "2035-03-01", vencimento: "2035-03-06", natureza: N["FRETE"] });
    const r3 = await titulo("receivable", "30.00", { emissao: "2035-03-01", vencimento: "2035-03-06", natureza: N["VENDA"] });
    await admin.query(
      "insert into erp.title_settlements(organization_id,title_id,cross_title_id,settlement_date,settlement_kind,amount,net_amount) values ($1,$2,$3,'2035-03-06','cross_settlement',30,30), ($1,$3,$2,'2035-03-06','cross_settlement',30,30)",
      [h.demo.orgId, p3, r3]);
  });

  it("premissa: em 2035 só há os lançamentos deste cenário; o crédito foi baixado e depois usado em 40", async () => {
    const titulos = await admin.query<{ n: string }>("select count(*) n from erp.financial_titles where organization_id=$1 and coalesce(data_competencia, emission_date) between '2035-01-01' and '2035-12-31' and number not like 'DOC-%'", [h.demo.orgId]);
    const movimentos = await admin.query<{ n: string }>("select count(*) n from erp.bank_movements where organization_id=$1 and movement_date between '2035-01-01' and '2035-12-31' and code not like 'F8X%'", [h.demo.orgId]);
    expect([titulos.rows[0]!.n, movimentos.rows[0]!.n]).toEqual(["0", "0"]);
    const usado = await admin.query<{ n: string }>("select coalesce(sum(amount),0)::text n from erp.title_settlements where organization_id=$1 and adiantamento_id is not null and settlement_date between '2035-01-01' and '2035-12-31' and status='confirmed'", [h.demo.orgId]);
    expect(usado.rows[0]!.n).toBe("40.00");
  });

  it("CAIXA de fevereiro: a energia sai por 100 — os 50 do crédito são adiantamento, não despesa (antes: −150 de energia)", async () => {
    const d = await dre("de=2035-02-01&ate=2035-02-28&regime=caixa");
    expect(porNatureza(d)).toEqual({ [N["ENERGIA"]!]: "-100.00" });
    expect(d.resultadoFinal).toBe("-100.00");
  });

  it("CAIXA de março: o frete quitado com o crédito (40) e o encontro de contas (frete −30, venda +30), sem movimento, na data da baixa", async () => {
    const d = await dre("de=2035-03-01&ate=2035-03-31&regime=caixa");
    expect(porNatureza(d)).toEqual({ [N["FRETE"]!]: "-70.00", [N["VENDA"]!]: "30.00" });
    expect(d.resultadoFinal).toBe("-40.00");
  });

  it("COMPETÊNCIA (fev+mar): a energia 100, o frete 70 e a venda 30 — o mesmo resultado do caixa no período inteiro; o crédito fora", async () => {
    const d = await dre("de=2035-02-01&ate=2035-03-31&regime=competencia");
    expect(porNatureza(d)).toEqual({ [N["ENERGIA"]!]: "-100.00", [N["FRETE"]!]: "-70.00", [N["VENDA"]!]: "30.00" });
    const caixa = await dre("de=2035-02-01&ate=2035-03-31&regime=caixa");
    expect(caixa.resultadoFinal).toBe(d.resultadoFinal);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("adiantamentos: crédito por parceiro × empresa", () => {
  let PF = ""; let ADT1 = ""; let ADT2 = "";
  beforeAll(async () => {
    PF = (await admin.query<{ id: string }>("insert into erp.people(organization_id,code,name,is_provider,is_client) values ($1,'F8PF1','[F8] Fornecedor do crédito',true,true) returning id", [h.demo.orgId])).rows[0]!.id;
    const tipoAdiantamento = (await admin.query<{ id: string }>("select id from erp.title_types where is_advance and organization_id is null order by name limit 1")).rows[0]!.id;
    ADT1 = await titulo("payable", "500.00", { pessoa: PF, forma: "advance", emissao: "2034-01-02", vencimento: "2034-01-02" });
    await baixa(ADT1, "2034-01-02", "500.00");
    // O adiantamento pelo TIPO de título (is_advance), com forma de pagamento comum — o defeito era não ler isto.
    ADT2 = await titulo("payable", "200.00", { pessoa: PF, forma: "single", tipo: tipoAdiantamento, emissao: "2034-01-03", vencimento: "2034-01-03" });
    await baixa(ADT2, "2034-01-03", "200.00");
    const usa = await titulo("payable", "300.00", { pessoa: PF, emissao: "2034-01-10", vencimento: "2034-01-10" });
    await baixa(usa, "2034-01-10", "120.00", { adiantamento: ADT1 });
    await titulo("payable", "999.00", { pessoa: PF, forma: "advance", status: "cancelled" });
    const doCliente = await titulo("receivable", "50.00", { pessoa: PF, forma: "advance", emissao: "2034-01-04", vencimento: "2034-01-04" });
    await baixa(doCliente, "2034-01-04", "50.00");
    // Na OUTRA empresa: um adiantamento todo usado (saldo zero).
    const zerado = await titulo("payable", "30.00", { pessoa: PF, forma: "advance", empresa: I.empresa2, emissao: "2034-01-05", vencimento: "2034-01-05" });
    await baixa(zerado, "2034-01-05", "30.00");
    const usaTudo = await titulo("payable", "30.00", { pessoa: PF, empresa: I.empresa2, emissao: "2034-01-06", vencimento: "2034-01-06" });
    await baixa(usaTudo, "2034-01-06", "30.00", { adiantamento: zerado });
  });

  it("agrupado por direção × parceiro × empresa: adiantado, usado e saldo (o tipo is_advance entra)", async () => {
    expect((await admin.query<{ payment_type: string }>("select payment_type from erp.financial_titles where id=$1", [ADT2])).rows[0]!.payment_type, "premissa: a forma é comum").toBe("single");
    const r = await get(`/api/financeiro/adiantamentos?pessoa_id=${PF}`);
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r)["itens"] as Record<string, unknown>[]).map((x) => [x["direcao"], x["empresa_id"], x["adiantado"], x["usado"], x["saldo"], x["quantidade"]])).toEqual([
      ["payable", I.empresa, "700.00", "120.00", "580.00", 2],
      ["receivable", I.empresa, "50.00", "0.00", "50.00", 1]
    ]);
    const todos = await get(`/api/financeiro/adiantamentos?pessoa_id=${PF}&so_com_saldo=0`);
    expect((j(todos)["itens"] as Record<string, unknown>[]).find((x) => x["empresa_id"] === I.empresa2), "com so_com_saldo=0 o zerado aparece").toMatchObject({ adiantado: "30.00", usado: "30.00", saldo: "0.00" });
  });

  it("os títulos com crédito, para o diálogo de baixa", async () => {
    const r = await get(`/api/financeiro/adiantamentos/titulos?direcao=payable&pessoa_id=${PF}&empresa_id=${I.empresa}`);
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r)["itens"] as Record<string, unknown>[]).map((x) => [x["id"], x["pago"], x["usado"], x["credito_disponivel"]])).toEqual([[ADT1, "500.00", "120.00", "380.00"], [ADT2, "200.00", "0.00", "200.00"]]);
  });

  it("porta dinâmica por direção: só a direção que o usuário vê; nenhuma → 403", async () => {
    const soPagar = await usuarioCom("f8-adt-pagar@demo.local", ["payables.view"]);
    const r = await get(`/api/financeiro/adiantamentos?pessoa_id=${PF}`, soPagar);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)["direcoes"]).toEqual(["payable"]);
    expect((j(r)["itens"] as Record<string, unknown>[]).map((x) => x["direcao"])).toEqual(["payable"]);
    expect((await get(`/api/financeiro/adiantamentos?direcao=receivable`, soPagar)).statusCode).toBe(403);
    expect((await get(`/api/financeiro/adiantamentos/titulos?direcao=receivable`, soPagar)).statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("naturezas padrão da baixa", () => {
  const N: Record<string, string> = {};
  const URL_NP = "/api/financeiro/configuracoes/naturezas-padrao";
  const linha = async () => (await admin.query<Record<string, string | null>>("select juros_pagos_id, juros_recebidos_id, multa_paga_id, desconto_obtido_id, tarifa_bancaria_id from erp.financeiro_naturezas_padrao where organization_id=$1", [h.demo.orgId])).rows[0] ?? null;
  beforeAll(async () => {
    N["JUROS"] = await natureza("F8N.1", "Juros pagos", "expense");
    N["DESC"] = await natureza("F8N.2", "Descontos obtidos", "income");
    N["TARIFA"] = await natureza("F8N.3", "Tarifas bancárias", "expense");
    N["AMBAS"] = await natureza("F8N.4", "Encargos", "both");
    N["SINTETICA"] = await natureza("F8N.5", "Despesas financeiras", "expense", { kind: "synthetic" });
    N["INATIVA"] = await natureza("F8N.6", "Juros antigos", "expense", { ativa: false });
    N["RECEITA"] = await natureza("F8N.7", "Receitas financeiras", "income");
    const outra = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra F8 NP','outra-f8-np') returning id")).rows[0]!.id;
    N["ALHEIA"] = await natureza("F8N.8", "Juros de outra organização", "expense", { org: outra });
  });

  it("grava as válidas (a de tipo 'both' serve a qualquer uma) e devolve código e nome", async () => {
    expect(await linha(), "premissa: a organização ainda não configurou").toBeNull();
    const r = await put(URL_NP, { juros_pagos_id: N["JUROS"], desconto_obtido_id: N["DESC"], tarifa_bancaria_id: N["TARIFA"], juros_recebidos_id: N["AMBAS"] });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ juros_pagos: { id: N["JUROS"], codigo: "F8N.1", nome: "Juros pagos" }, desconto_obtido: { id: N["DESC"] }, tarifa_bancaria: { id: N["TARIFA"] }, juros_recebidos: { id: N["AMBAS"] }, multa_paga: null });
    expect(await linha()).toEqual({ juros_pagos_id: N["JUROS"], juros_recebidos_id: N["AMBAS"], multa_paga_id: null, desconto_obtido_id: N["DESC"], tarifa_bancaria_id: N["TARIFA"] });
    const g = await get(URL_NP);
    expect(j(g)).toEqual(j(r));
    // A trilha da rota (com os campos) além da do gatilho da tabela.
    expect((await admin.query("select 1 from erp.audit_logs where entity='financeiro_naturezas_padrao' and action='update' and metadata->'campos' is not null")).rowCount).toBe(1);
  });

  it("o PUT é parcial: chave ausente fica, nula limpa", async () => {
    expect((await put(URL_NP, { multa_paga_id: N["TARIFA"] })).statusCode).toBe(200);
    expect(await linha()).toMatchObject({ juros_pagos_id: N["JUROS"], multa_paga_id: N["TARIFA"] });
    expect((await put(URL_NP, { multa_paga_id: null })).statusCode).toBe(200);
    expect(await linha()).toMatchObject({ juros_pagos_id: N["JUROS"], multa_paga_id: null });
  });

  it("sintética, inativa, de outra organização ou de tipo errado → 422 no campo, e nada muda", async () => {
    const antes = await linha();
    const casos: [Record<string, string>, string, string][] = [
      [{ juros_pagos_id: N["SINTETICA"]! }, "juros_pagos_id", "Natureza inválida para Juros pagos"],
      [{ juros_pagos_id: N["INATIVA"]! }, "juros_pagos_id", "Natureza inválida para Juros pagos"],
      [{ juros_pagos_id: N["ALHEIA"]! }, "juros_pagos_id", "Natureza inválida para Juros pagos"],
      [{ juros_pagos_id: N["RECEITA"]! }, "juros_pagos_id", "Natureza inválida para Juros pagos"],
      [{ desconto_obtido_id: N["TARIFA"]! }, "desconto_obtido_id", "Natureza inválida para Desconto obtido"]
    ];
    for (const [corpo, campo, mensagem] of casos) {
      const r = await put(URL_NP, corpo);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.message).toBe(mensagem);
      expect(j(r).error!.details).toEqual([{ path: [campo], message: mensagem }]);
    }
    expect(await linha()).toEqual(antes);
    expect((await put(URL_NP, { juros_pagos: N["JUROS"] })).statusCode, "corpo estrito").toBe(422);
  });

  it("sem financial_categories.edit → 403 (ler continua com .view)", async () => {
    const leitor = await usuarioCom("f8-np-leitor@demo.local", ["financial_categories.view"]);
    expect((await get(URL_NP, leitor)).statusCode).toBe(200);
    expect((await put(URL_NP, { juros_pagos_id: N["JUROS"] }, leitor)).statusCode).toBe(403);
  });
});
