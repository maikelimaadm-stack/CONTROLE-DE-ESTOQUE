import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — O EXTRATO DE UMA CONTA COMPARTILHADA, RECORTADO PELO ESCOPO DE EMPRESA (OPERACOES-01 F8,
 * decisão 285 — conserto da revisão final, decisão do Maike de 03/10).
 *
 * O defeito: `erp.extrato_conta_organizacao` (0042) e as rotas `/financeiro/extrato`, `/financeiro/contas` e o fluxo da
 * conta entregavam o texto, o documento, a empresa e o valor dos movimentos de TODAS as empresas de uma conta
 * compartilhada a quem tinha `bank_accounts.view` ∧ `bank_movements.view` — com escopo financeiro só na empresa A, a
 * pessoa lia os lançamentos da empresa B.
 *
 * Prova, sempre com a PREMISSA (as linhas de B e a sem empresa existem na conta, com texto, documento e valor) junto da
 * CONCLUSÃO, pela ROTA, com o usuário de verdade (login, papel sem bypass de RLS):
 *   EE-1 escopo [A] no financeiro (com "todas" no ESTOQUE — outro módulo não alarga nada): só as linhas de A; total,
 *        página, acumulado, saldo anterior e saldo final só de A; o saldo inicial do cadastro (sem empresa) não entra;
 *        nada de B nem do sem empresa no corpo (id, texto, documento, empresa, valor);
 *   EE-2 as contas e o fluxo da conta, para o mesmo usuário: saldo e "conciliado até" só de A, sem saldo inicial;
 *   EE-3 escopo TOTAL (modo "todas" no financeiro, sem ser proprietário) e o proprietário: tudo, inclusive o sem
 *        empresa, e o saldo total com o saldo inicial;
 *   EE-4 sem escopo no financeiro (só as capacidades): a conta abre vazia, saldo zero — não "a organização";
 *   EE-5 conta de outra organização, inexistente, excluída e id malformado: a MESMA 404, corpo idêntico, para o
 *        escopo [A] e para o proprietário.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let A = ""; let B = "";
let CMP = ""; let SO_B = ""; let EXCLUIDA = ""; let ALHEIA = "";
let a1 = ""; let a2 = ""; let b1 = ""; let b2 = ""; let n1 = "";
let escopoA: Record<string, string> = {}; let escopoTotal: Record<string, string> = {}; let semEscopo: Record<string, string> = {};
let seq = 0;
type Json = Record<string, unknown> & { error?: { code: string; message: string } };
const j = (r: { json: () => unknown }) => r.json() as Json;

const conta = async (code: string, saldo: string, o: { org?: string; excluida?: boolean } = {}) =>
  (await admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type,opening_balance,deleted_at) values ($1,$2,$3,'checking',$4,$5) returning id",
    [o.org ?? h.demo.orgId, code, `[EXT] Conta ${code}`, saldo, o.excluida ? new Date() : null])).rows[0]!.id;

/** Movimento com texto e documento próprios (superusuário: o cenário). */
const movimento = async (contaId: string, empresa: string | null, data: string, tipo: "in" | "out", valor: string, rotulo: string, o: { conciliado?: string; status?: string } = {}) =>
  (await admin.query<{ id: string }>(
    `insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status,reconciled_at,note,document)
     values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11) returning id`,
    [h.demo.orgId, `EXT${String(++seq).padStart(3, "0")}`, contaId, empresa, data, tipo, valor, o.status ?? "confirmed",
     o.conciliado ? new Date(`${o.conciliado}T12:00:00Z`) : null, `[EXT] Lançamento ${rotulo}`, `DOC-${rotulo}`])).rows[0]!.id;

/** Membro com as capacidades pedidas e o escopo de empresa POR MÓDULO pedido ("todas" ou as empresas nomeadas). */
async function usuarioCom(email: string, permissoes: string[], escopos: Record<string, "todas" | string[]>): Promise<Record<string, string>> {
  const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
  const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`])).rows[0]!.id;
  for (const p of permissoes) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
  const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
  for (const [modulo, e] of Object.entries(escopos)) {
    await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [h.demo.orgId, m, modulo, e === "todas" ? "todas" : "selecionadas"]);
    if (e !== "todas") for (const emp of e) await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,$3,'selecionadas',$4)", [h.demo.orgId, m, modulo, emp]);
  }
  const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  expect(r.statusCode, r.body).toBe(200);
  return { authorization: `Bearer ${(r.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

const get = (url: string, headers: Record<string, string>) => h.app.inject({ method: "GET", url, headers });
type Extrato = Json & {
  conta: { id: string; saldo_inicial: string }; escopo_saldo: string; total: number; itens: Record<string, unknown>[];
  saldo_anterior: { real: string; conciliado: string }; saldo_final: { real: string; conciliado: string };
};
const extrato = async (headers: Record<string, string>, qs = "") => {
  const r = await get(`/api/financeiro/extrato?conta_id=${CMP}${qs}`, headers);
  expect(r.statusCode, r.body).toBe(200);
  return { corpo: j(r) as Extrato, texto: r.body };
};
const linhaDaConta = async (headers: Record<string, string>) => {
  const r = await get("/api/financeiro/contas?pageSize=200&ativas=0", headers);
  expect(r.statusCode, r.body).toBe(200);
  const corpo = j(r) as Json & { itens: Record<string, unknown>[]; escopo_saldo: string };
  return { linha: corpo.itens.find((c) => c["id"] === CMP)!, escopo_saldo: corpo.escopo_saldo, texto: r.body };
};
type Fluxo = Json & { saldo_inicial: string | null; periodos: { realizado: { entradas: string; saidas: string }; saldo_realizado: string | null }[] };
const fluxo = async (headers: Record<string, string>) => {
  const r = await get(`/api/financeiro/fluxo?de=2034-05-01&ate=2034-05-31&agrupamento=mes&contas=${CMP}`, headers);
  expect(r.statusCode, r.body).toBe(200);
  return { corpo: j(r) as Fluxo, texto: r.body };
};

/** Nada de B nem do sem empresa: nem id, nem empresa, nem texto, nem documento, nem valor. */
const PROIBIDOS = () => [b1, b2, n1, B, "Lançamento B1", "Lançamento B2", "Lançamento N1", "DOC-B1", "DOC-B2", "DOC-N1", "500.00", "45.00", "9.00"];
const semNadaDeB = (onde: string, texto: string) => {
  for (const p of PROIBIDOS()) expect([onde, p, texto.includes(p)]).toEqual([onde, p, false]);
};

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 });
  A = I.empresa; B = I.empresa2;
  // A conta COMPARTILHADA (vínculo com A e B) e saldo inicial de cadastro 1000 (sem empresa).
  CMP = await conta("CMP", "1000");
  await admin.query("insert into erp.bank_account_empresas(bank_account_id,empresa_id) values ($1,$2),($1,$3)", [CMP, A, B]);
  a1 = await movimento(CMP, A, "2034-05-01", "in", "100.00", "A1", { conciliado: "2034-05-01" });
  b1 = await movimento(CMP, B, "2034-05-02", "in", "500.00", "B1", { conciliado: "2034-05-02" });
  a2 = await movimento(CMP, A, "2034-05-03", "out", "30.00", "A2");
  b2 = await movimento(CMP, B, "2034-05-04", "out", "45.00", "B2");
  n1 = await movimento(CMP, null, "2034-05-05", "in", "9.00", "N1");
  await movimento(CMP, A, "2034-05-06", "in", "1000.00", "AX", { status: "cancelled" });
  // Uma conta só de B, uma excluída e uma de outra organização.
  SO_B = await conta("SOB", "0");
  await movimento(SO_B, B, "2034-05-02", "in", "500.00", "B3");
  EXCLUIDA = await conta("EXCL", "0", { excluida: true });
  const outra = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra extrato escopo','outra-extrato-escopo') returning id")).rows[0]!.id;
  ALHEIA = await conta("ALH", "777", { org: outra });

  const caps = ["bank_accounts.view", "bank_movements.view", "cash_flow.view"];
  escopoA = await usuarioCom("ext-escopo-a@demo.local", caps, { financeiro: [A], estoque: "todas" });
  escopoTotal = await usuarioCom("ext-escopo-total@demo.local", caps, { financeiro: "todas" });
  semEscopo = await usuarioCom("ext-sem-escopo@demo.local", caps, {});
}, 180_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("EE — a conta compartilhada por A e B", () => {
  it("PREMISSA: as linhas de A, de B e a sem empresa existem na conta, com texto, documento e valor; o cancelado também", async () => {
    const r = await admin.query<{ id: string; empresa_id: string | null; note: string; document: string; amount: string; status: string }>(
      "select id, empresa_id, note, document, amount, status from erp.bank_movements where bank_account_id=$1 order by movement_date", [CMP]);
    expect(r.rows.map((x) => [x.id, x.empresa_id, x.note, x.document, x.amount, x.status])).toEqual([
      [a1, A, "[EXT] Lançamento A1", "DOC-A1", "100.00", "confirmed"],
      [b1, B, "[EXT] Lançamento B1", "DOC-B1", "500.00", "confirmed"],
      [a2, A, "[EXT] Lançamento A2", "DOC-A2", "30.00", "confirmed"],
      [b2, B, "[EXT] Lançamento B2", "DOC-B2", "45.00", "confirmed"],
      [n1, null, "[EXT] Lançamento N1", "DOC-N1", "9.00", "confirmed"],
      [expect.any(String), A, "[EXT] Lançamento AX", "DOC-AX", "1000.00", "cancelled"]
    ]);
    expect(A).not.toBe(B);
  });

  it("EE-1 escopo [A]: só as linhas de A; total, página, acumulado e saldos só de A, sem o saldo inicial; nada de B nem do sem empresa", async () => {
    const { corpo, texto } = await extrato(escopoA);
    expect(corpo.escopo_saldo).toBe("parcial");
    expect(corpo.total).toBe(2);
    expect(corpo.itens.map((x) => [x["id"], x["empresa_id"], x["descricao"], x["documento"], x["valor"], x["saldo_real"], x["saldo_conciliado"]])).toEqual([
      [a1, A, "[EXT] Lançamento A1", "DOC-A1", "100.00", "100.00", "100.00"],
      [a2, A, "[EXT] Lançamento A2", "DOC-A2", "-30.00", "70.00", "100.00"]
    ]);
    // O saldo inicial do cadastro (1000, sem empresa) não entra no saldo de quem vê parte da conta; o campo do cadastro
    // continua o do cadastro.
    expect(corpo.conta.saldo_inicial).toBe("1000.00");
    expect(corpo.saldo_anterior).toEqual({ real: "0.00", conciliado: "0.00" });
    expect(corpo.saldo_final).toEqual({ real: "70.00", conciliado: "100.00" });
    semNadaDeB("extrato", texto);

    // A PÁGINA vem depois do recorte: a página 2 de tamanho 1 é a2, com o acumulado de A (sem os 500 de B de 02/05).
    const p2 = await extrato(escopoA, "&pageSize=1&page=2");
    expect([p2.corpo.total, p2.corpo.itens.map((x) => [x["id"], x["saldo_real"]])]).toEqual([2, [[a2, "70.00"]]]);
    semNadaDeB("página 2", p2.texto);
    // O SALDO ANTERIOR também: com início em 03/05, só o 01/05 de A (e não 600 com o de B).
    const desde3 = await extrato(escopoA, "&de=2034-05-03&ate=2034-05-31");
    expect([desde3.corpo.saldo_anterior, desde3.corpo.total, desde3.corpo.saldo_final]).toEqual([{ real: "100.00", conciliado: "100.00" }, 1, { real: "70.00", conciliado: "100.00" }]);
    semNadaDeB("desde 03/05", desde3.texto);
    // A CONTAGEM do filtro de situação: conciliados = só a1 (b1 também está conciliado, e não conta).
    const conc = await extrato(escopoA, "&situacao=conciliados");
    expect([conc.corpo.total, conc.corpo.itens.map((x) => x["id"])]).toEqual([1, [a1]]);
    semNadaDeB("conciliados", conc.texto);
    // A conta só de B abre VAZIA para quem vê A — como uma conta sem movimento.
    const soB = await get(`/api/financeiro/extrato?conta_id=${SO_B}`, escopoA);
    expect(soB.statusCode, soB.body).toBe(200);
    expect([(j(soB) as Extrato).total, (j(soB) as Extrato).itens, (j(soB) as Extrato).saldo_final]).toEqual([0, [], { real: "0.00", conciliado: "0.00" }]);
    semNadaDeB("conta só de B", soB.body);
  });

  it("EE-2 escopo [A]: as contas e o fluxo da conta — saldo e 'conciliado até' só de A, sem o saldo inicial", async () => {
    const c = await linhaDaConta(escopoA);
    expect(c.escopo_saldo).toBe("parcial");
    // "conciliado até" seria 02/05 com o B1: é 01/05.
    expect(c.linha).toMatchObject({ saldo_inicial: "1000.00", saldo_real: "70.00", saldo_conciliado: "100.00", conciliado_ate: "2034-05-01" });
    const lista = await get("/api/financeiro/contas?pageSize=200&ativas=0", escopoA);
    const soB = (j(lista) as { itens: { id: string }[] }).itens.find((x) => x.id === SO_B);
    expect(soB).toMatchObject({ saldo_real: "0.00", saldo_conciliado: "0.00", conciliado_ate: null });
    // As DUAS linhas (a página inteira tem as outras contas da organização, com os movimentos de A delas).
    semNadaDeB("contas", JSON.stringify([c.linha, soB]));
    const f = await fluxo(escopoA);
    expect([f.corpo.saldo_inicial, f.corpo.periodos.map((p) => [p.realizado.entradas, p.realizado.saidas, p.saldo_realizado])]).toEqual(["0.00", [["100.00", "30.00", "70.00"]]]);
    semNadaDeB("fluxo", f.texto);
  });

  it("EE-3 escopo TOTAL (todas no financeiro) e o proprietário: tudo, inclusive o sem empresa, e o saldo total com o saldo inicial", async () => {
    for (const [quem, headers] of [["todas no financeiro", escopoTotal], ["proprietário", h.headers()]] as const) {
      const { corpo } = await extrato(headers);
      expect([quem, corpo.escopo_saldo, corpo.total, corpo.itens.map((x) => x["id"])]).toEqual([quem, "total", 5, [a1, b1, a2, b2, n1]]);
      // 1000 + 100 + 500 − 30 − 45 + 9 = 1534; conciliado = 1000 + 100 + 500.
      expect([quem, corpo.saldo_anterior, corpo.saldo_final]).toEqual([quem, { real: "1000.00", conciliado: "1000.00" }, { real: "1534.00", conciliado: "1600.00" }]);
      const c = await linhaDaConta(headers);
      expect([quem, c.escopo_saldo, c.linha["saldo_real"], c.linha["saldo_conciliado"], c.linha["conciliado_ate"]]).toEqual([quem, "total", "1534.00", "1600.00", "2034-05-02"]);
      const f = await fluxo(headers);
      expect([quem, f.corpo.saldo_inicial, f.corpo.periodos.map((p) => [p.realizado.entradas, p.realizado.saidas, p.saldo_realizado])]).toEqual([quem, "1000.00", [["609.00", "75.00", "1534.00"]]]);
    }
  });

  it("EE-4 sem escopo no financeiro (só as capacidades): a conta abre vazia, saldo zero — não 'a organização'", async () => {
    const { corpo, texto } = await extrato(semEscopo);
    expect([corpo.escopo_saldo, corpo.total, corpo.itens, corpo.saldo_anterior, corpo.saldo_final])
      .toEqual(["parcial", 0, [], { real: "0.00", conciliado: "0.00" }, { real: "0.00", conciliado: "0.00" }]);
    semNadaDeB("sem escopo", texto);
    for (const p of [a1, a2, A, "DOC-A1", "DOC-A2"]) expect([p, texto.includes(p)]).toEqual([p, false]);
    const c = await linhaDaConta(semEscopo);
    expect([c.escopo_saldo, c.linha["saldo_real"], c.linha["saldo_conciliado"]]).toEqual(["parcial", "0.00", "0.00"]);
  });

  it("EE-5 conta de outra organização, inexistente, excluída e id malformado: a MESMA 404, corpo idêntico — para o escopo [A] e para o proprietário", async () => {
    // Premissa: as três contas existem no banco (a de outra organização com saldo, a excluída marcada).
    expect((await admin.query("select 1 from erp.bank_accounts where id = any($1::uuid[])", [[ALHEIA, EXCLUIDA]])).rowCount).toBe(2);
    expect((await admin.query("select 1 from erp.bank_accounts where id=$1 and deleted_at is not null", [EXCLUIDA])).rowCount).toBe(1);
    const corpos = new Set<string>();
    for (const headers of [escopoA, h.headers()]) {
      for (const id of [ALHEIA, "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b", EXCLUIDA, "nao-e-uuid"]) {
        const r = await get(`/api/financeiro/extrato?conta_id=${id}`, headers);
        expect([id, r.statusCode]).toEqual([id, 404]);
        corpos.add(r.body);
      }
    }
    expect([...corpos]).toEqual([JSON.stringify({ error: { code: "NOT_FOUND", message: "Conta bancária não encontrada" } })]);
  });
});
