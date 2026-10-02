import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { D, money } from "@agro/shared";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — BANCOS E CAIXA (OPERACOES-01 F8, decisão 285).
 *
 * Prova, sempre com a PREMISSA junto da CONCLUSÃO:
 *   1. o DEFEITO "transferência sem validar a conta destino": pela rota ANTIGA, destino de outra organização,
 *      inexistente, inativo ou igual à origem é recusado (422) e NADA é gravado;
 *   2. as 5 transferências novas (transferência, depósito, saque, aplicação, resgate): o par nas duas contas com o
 *      rótulo nas DUAS pontas, nenhum rateio (não é receita nem despesa) e os saldos das contas; a regra de tipo de
 *      conta e a empresa obrigatória;
 *   3. saldo REAL × CONCILIADO por conta, com a conciliação feita pela rota de conciliação;
 *   4. o saldo inicial (negativo aceito, data gravada, trilha) e a MESMA 404 para outra organização/malformado;
 *   5. o extrato com saldos ACUMULADOS por página (a página 2 começa do acumulado certo) e o filtro de situação,
 *      que recorta as linhas e não o saldo;
 *   6. as portas: sem a capacidade de ORGANIZAÇÃO (`bank_accounts.view`) ou sem a financeira
 *      (`bank_movements.view`) → 403.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let OUTRA_ORG = ""; let CONTA_ALHEIA = "";
let seq = 0;
type Json = Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } };
const j = (r: { json: () => unknown }) => r.json() as Json;

const conta = async (code: string, type: "checking" | "cash" | "investment" | "savings", o: { saldo?: string; ativa?: boolean; numero?: string | null; org?: string } = {}) =>
  (await admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type,opening_balance,is_active,account_number) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [o.org ?? h.demo.orgId, code, `[F8] Conta ${code}`, type, o.saldo ?? "0", o.ativa ?? true, o.numero ?? null])).rows[0]!.id;

const movimento = async (contaId: string, data: string, tipo: "in" | "out", valor: string, o: { categoria?: string; conciliado?: boolean; status?: string; empresa?: string | null } = {}) =>
  (await admin.query<{ id: string }>(
    `insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status,reconciled_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [h.demo.orgId, `F8B${String(++seq).padStart(4, "0")}`, contaId, o.empresa === undefined ? I.empresa : o.empresa, data, tipo, o.categoria ?? tipo, valor, o.status ?? "confirmed", o.conciliado ? new Date("2031-12-31T12:00:00Z") : null])).rows[0]!.id;

const movimentosDa = async (contaId: string) => Number((await admin.query<{ n: string }>("select count(*) n from erp.bank_movements where bank_account_id=$1", [contaId])).rows[0]!.n);

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
const send = (method: "POST" | "PUT", url: string, payload: unknown, extra: Record<string, string> = {}) => h.app.inject({ method, url, payload: payload as Record<string, unknown>, headers: h.headers(extra) });
const contasDaApi = async () => {
  const r = await get("/api/financeiro/contas?pageSize=200&ativas=0");
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as Json & { itens: Record<string, string | boolean | null>[]; total: number; totais: { saldo_real: string; saldo_conciliado: string } };
};
const linhaDa = async (id: string) => (await contasDaApi()).itens.find((c) => c["id"] === id)!;

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 });
  OUTRA_ORG = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra F8 Bancos','outra-f8-bancos') returning id")).rows[0]!.id;
  CONTA_ALHEIA = await conta("ALHEIA", "checking", { org: OUTRA_ORG, saldo: "9999" });
}, 180_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("o defeito: a transferência pela rota ANTIGA valida a conta DESTINO", () => {
  let ORIGEM = ""; let INATIVA = ""; let VALIDA = "";
  beforeAll(async () => {
    ORIGEM = await conta("ANT-ORIG", "checking", { saldo: "1000" });
    INATIVA = await conta("ANT-INAT", "checking", { ativa: false });
    VALIDA = await conta("ANT-DEST", "checking");
  });
  const transferirPelaRotaAntiga = (destino: string) => send("POST", "/api/financial/bank-movements", {
    empresa_id: I.empresa, bank_account_id: ORIGEM, movement_date: "2031-02-10", type: "out", category_type: "internal_transfer", destination_account_id: destino, amount: "10.00"
  });

  it("destino de outra organização, inexistente ou inativo: 422 'Conta destino inválida' e nada gravado", async () => {
    // Premissas: a conta alheia EXISTE (em outra organização), a inexistente não existe, a inativa existe e está inativa.
    expect((await admin.query("select 1 from erp.bank_accounts where id=$1 and organization_id=$2", [CONTA_ALHEIA, OUTRA_ORG])).rowCount).toBe(1);
    const inexistente = "7d1f3c2a-9b4e-4c5d-8e6f-0a1b2c3d4e5f";
    expect((await admin.query("select 1 from erp.bank_accounts where id=$1", [inexistente])).rowCount).toBe(0);
    expect((await admin.query<{ is_active: boolean }>("select is_active from erp.bank_accounts where id=$1", [INATIVA])).rows[0]!.is_active).toBe(false);
    for (const destino of [CONTA_ALHEIA, inexistente, INATIVA]) {
      const antes = await movimentosDa(ORIGEM);
      const r = await transferirPelaRotaAntiga(destino);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.message).toBe("Conta destino inválida");
      expect(await movimentosDa(ORIGEM), "a recusa não deixa movimento na origem").toBe(antes);
      expect(await movimentosDa(destino)).toBe(0);
    }
  });

  it("destino igual à origem: 422 'Conta de origem e destino iguais'", async () => {
    const antes = await movimentosDa(ORIGEM);
    const r = await transferirPelaRotaAntiga(ORIGEM);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Conta de origem e destino iguais");
    expect(await movimentosDa(ORIGEM)).toBe(antes);
  });

  it("controle: com destino válido a mesma rota grava o par (a recusa acima é pelo destino, não pela rota)", async () => {
    const r = await transferirPelaRotaAntiga(VALIDA);
    expect(r.statusCode, r.body).toBe(201);
    const par = await admin.query<{ bank_account_id: string; type: string; tipo_transferencia: string | null }>(
      "select bank_account_id, type, tipo_transferencia from erp.bank_movements where id=(select transfer_pair_id from erp.bank_movements where id=$1)", [j(r)["id"]]);
    expect(par.rows[0]).toEqual({ bank_account_id: VALIDA, type: "in", tipo_transferencia: null });
  });
});

describe("transferências entre contas: os 5 tipos", () => {
  let C1 = ""; let C2 = ""; let CX = ""; let AP = "";
  beforeAll(async () => {
    C1 = await conta("TR-C1", "checking", { saldo: "1000" });
    C2 = await conta("TR-C2", "checking");
    CX = await conta("TR-CX", "cash", { saldo: "500" });
    AP = await conta("TR-AP", "investment");
  });
  const transferir = (tipo: string, origem: string, destino: string, valor: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    send("POST", "/api/financeiro/transferencias", { tipo, conta_origem_id: origem, conta_destino_id: destino, data: "2031-03-15", valor, empresa_id: I.empresa, ...extra }, headers);

  it("cada tipo grava o par com o rótulo nas DUAS pontas, sem rateio, e os saldos fecham", async () => {
    // Premissa: os tipos das contas são os que cada regra pede.
    const tipos = await admin.query<{ id: string; type: string }>("select id, type from erp.bank_accounts where id = any($1::uuid[])", [[C1, C2, CX, AP]]);
    expect(Object.fromEntries(tipos.rows.map((t) => [t.id, t.type]))).toEqual({ [C1]: "checking", [C2]: "checking", [CX]: "cash", [AP]: "investment" });

    const casos: [string, string, string, string][] = [
      ["transferencia", C1, C2, "100.00"], ["deposito", CX, C1, "50.00"], ["saque", C1, CX, "20.00"], ["aplicacao", C1, AP, "200.00"], ["resgate", AP, C1, "80.00"]
    ];
    for (const [tipo, origem, destino, valor] of casos) {
      const r = await transferir(tipo, origem, destino, valor);
      expect(r.statusCode, `${tipo}: ${r.body}`).toBe(201);
      const { id, par_id } = j(r) as { id: string; par_id: string };
      const pontas = await admin.query<{ id: string; bank_account_id: string; type: string; category_type: string; tipo_transferencia: string; amount: string; transfer_pair_id: string; empresa_id: string; destination_account_id: string }>(
        "select id, bank_account_id, type, category_type, tipo_transferencia, amount::text, transfer_pair_id, empresa_id, destination_account_id from erp.bank_movements where id = any($1::uuid[]) order by type desc", [[id, par_id]]);
      expect(pontas.rows.map((p) => ({ ...p }))).toEqual([
        { id, bank_account_id: origem, type: "out", category_type: "internal_transfer", tipo_transferencia: tipo, amount: valor, transfer_pair_id: par_id, empresa_id: I.empresa, destination_account_id: destino },
        { id: par_id, bank_account_id: destino, type: "in", category_type: "internal_transfer", tipo_transferencia: tipo, amount: valor, transfer_pair_id: id, empresa_id: I.empresa, destination_account_id: origem }
      ]);
      const rateio = await admin.query("select 1 from erp.bank_movement_apportionments where movement_id = any($1::uuid[])", [[id, par_id]]);
      expect(rateio.rowCount, "transferência não é receita nem despesa: nenhum rateio").toBe(0);
      const numeros = await admin.query("select 1 from erp.registros_globais where tipo_entidade='bank_movements' and id_entidade = any($1::uuid[])", [[id, par_id]]);
      expect(numeros.rowCount, "as duas pontas recebem ID Global").toBe(2);
    }
    // C1 = 1000 −100 +50 −20 −200 +80; C2 = 100; CX = 500 −50 +20; AP = 200 −80
    const contas = await contasDaApi();
    const saldo = (id: string) => contas.itens.find((c) => c["id"] === id)!["saldo_real"];
    expect([saldo(C1), saldo(C2), saldo(CX), saldo(AP)]).toEqual(["810.00", "100.00", "470.00", "120.00"]);
  });

  it("a regra de cada tipo pelo tipo das contas: recusa com o texto e nada gravado", async () => {
    const recusas: [string, string, string, string][] = [
      ["deposito", C1, C2, "Depósito é do caixa para uma conta que não é caixa"],
      ["saque", C1, C2, "Saque é de uma conta que não é caixa para o caixa"],
      ["aplicacao", C2, C1, "Aplicação é de uma conta comum para uma conta de aplicação"],
      ["resgate", C1, C2, "Resgate é de uma conta de aplicação para uma conta comum"]
    ];
    for (const [tipo, origem, destino, mensagem] of recusas) {
      const antes = await movimentosDa(origem);
      const r = await transferir(tipo, origem, destino, "1.00");
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.message).toBe(mensagem);
      expect(await movimentosDa(origem)).toBe(antes);
    }
  });

  it("empresa é obrigatória (ausente ou nula: 422) e o destino continua validado (outra organização, igual)", async () => {
    const semEmpresa = await send("POST", "/api/financeiro/transferencias", { tipo: "transferencia", conta_origem_id: C1, conta_destino_id: C2, data: "2031-03-15", valor: "1.00" });
    expect(semEmpresa.statusCode, semEmpresa.body).toBe(422);
    const empresaNula = await transferir("transferencia", C1, C2, "1.00", { empresa_id: null });
    expect(empresaNula.statusCode, empresaNula.body).toBe(422);
    const alheia = await transferir("transferencia", C1, CONTA_ALHEIA, "1.00");
    expect(alheia.statusCode, alheia.body).toBe(422);
    expect(j(alheia).error!.message).toBe("Conta destino inválida");
    const iguais = await transferir("transferencia", C1, C1, "1.00");
    expect(j(iguais).error!.message).toBe("Conta de origem e destino iguais");
    const valorNumero = await transferir("transferencia", C1, C2, "1.00", { valor: 1 });
    expect(valorNumero.statusCode, "dinheiro é texto decimal na API").toBe(422);
    const chaveEstranha = await transferir("transferencia", C1, C2, "1.00", { rateio: [] });
    expect(chaveEstranha.statusCode, "corpo estrito").toBe(422);
  });

  it("Idempotency-Key: o reenvio devolve a mesma resposta e não grava outro par", async () => {
    const antes = await movimentosDa(C2);
    const a = await transferir("transferencia", C1, C2, "5.00", {}, { "idempotency-key": "f8-transf-1" });
    const b = await transferir("transferencia", C1, C2, "5.00", {}, { "idempotency-key": "f8-transf-1" });
    expect(a.statusCode, a.body).toBe(201);
    expect(j(b)).toEqual(j(a));
    expect(await movimentosDa(C2)).toBe(antes + 1);
  });
});

describe("saldo real × saldo conciliado", () => {
  let REC = ""; let M1 = "";
  beforeAll(async () => {
    REC = await conta("REC", "checking", { saldo: "1000", numero: "55555-0" });
    M1 = await movimento(REC, "2031-08-01", "in", "100.00");
    await movimento(REC, "2031-08-02", "out", "30.00");
  });

  it("concilia 1 de 2 movimentos pela rota de conciliação: real 1070, conciliado 1100", async () => {
    const antes = await linhaDa(REC);
    expect(antes).toMatchObject({ saldo_inicial: "1000.00", saldo_real: "1070.00", saldo_conciliado: "1000.00", conciliado_ate: null });
    // Extrato com a entrada dois dias depois: não é "Encontrado" (data diferente), fica pendente para a confirmação.
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>001<BRANCHID>1<ACCTID>55555-0</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20310803<TRNAMT>100,00<FITID>REC-1<MEMO>Entrada</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const imp = await send("POST", "/api/financeiro/conciliacao/importacoes", { conta_id: REC, descricao: "Extrato agosto", conteudo: ofx });
    expect(imp.statusCode, imp.body).toBe(201);
    expect(j(imp)["conciliadas_automaticamente"]).toBe(0);
    const tid = (await admin.query<{ id: string }>("select id from erp.ofx_transactions where import_id=$1", [j(imp)["id"]])).rows[0]!.id;
    const c = await send("POST", `/api/financeiro/conciliacao/transacoes/${tid}/confirmar`, { movimento_ids: [M1] });
    expect(c.statusCode, c.body).toBe(200);
    const depois = await linhaDa(REC);
    expect(depois).toMatchObject({ saldo_real: "1070.00", saldo_conciliado: "1100.00", conciliado_ate: "2031-08-01" });
  });

  it("os totais do rodapé são a soma das contas listadas", async () => {
    const r = await contasDaApi();
    expect(r.total).toBe(r.itens.length);
    const soma = (k: string) => money(r.itens.reduce((s, c) => s.plus(D(String(c[k]))), D(0)));
    expect(r.itens.length, "premissa: há várias contas na página").toBeGreaterThan(3);
    expect(r.totais.saldo_real).toBe(soma("saldo_real"));
    expect(r.totais.saldo_conciliado).toBe(soma("saldo_conciliado"));
  });

  it("só ativas por padrão; ativas=0 traz as inativas", async () => {
    const inativa = await conta("INAT-LISTA", "checking", { ativa: false });
    const padrao = await get("/api/financeiro/contas?pageSize=200");
    expect((j(padrao)["itens"] as { id: string }[]).some((c) => c.id === inativa)).toBe(false);
    expect((await contasDaApi()).itens.some((c) => c["id"] === inativa)).toBe(true);
  });
});

describe("saldo inicial da conta", () => {
  let SI = "";
  beforeAll(async () => { SI = await conta("SI", "checking"); });

  it("valor NEGATIVO aceito, data gravada, trilha com antes e depois; a resposta é a linha da conta", async () => {
    const r = await send("PUT", `/api/financeiro/contas/${SI}/saldo-inicial`, { valor: "-250.75", data: "2031-01-01" });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ id: SI, saldo_inicial: "-250.75", data_saldo_inicial: "2031-01-01", saldo_real: "-250.75", saldo_conciliado: "-250.75" });
    const gravado = await admin.query<{ opening_balance: string; data: string }>("select opening_balance::text, to_char(data_saldo_inicial,'YYYY-MM-DD') as data from erp.bank_accounts where id=$1", [SI]);
    expect(gravado.rows[0]).toEqual({ opening_balance: "-250.75", data: "2031-01-01" });
    const trilha = await admin.query<{ before: { saldo_inicial: string }; after: { saldo_inicial: string } }>("select before, after from erp.audit_logs where entity='bank_accounts' and entity_id=$1 and action='update'", [SI]);
    expect(trilha.rows.map((t) => [t.before.saldo_inicial, t.after.saldo_inicial])).toEqual([["0.00", "-250.75"]]);
  });

  it("conta de OUTRA organização, inexistente ou id malformado: a mesma 404, e nada muda", async () => {
    for (const id of [CONTA_ALHEIA, "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b", "nao-e-uuid"]) {
      const r = await send("PUT", `/api/financeiro/contas/${id}/saldo-inicial`, { valor: "1.00", data: "2031-01-01" });
      expect(r.statusCode, r.body).toBe(404);
      expect(j(r).error!.message).toBe("Conta bancária não encontrada");
    }
    const alheia = await admin.query<{ v: string }>("select opening_balance::text v from erp.bank_accounts where id=$1", [CONTA_ALHEIA]);
    expect(alheia.rows[0]!.v).toBe("9999.00");
  });

  it("corpo estrito e dinheiro em texto: chave desconhecida ou valor numérico → 422", async () => {
    expect((await send("PUT", `/api/financeiro/contas/${SI}/saldo-inicial`, { valor: "1.00", data: "2031-01-01", conta: "x" })).statusCode).toBe(422);
    expect((await send("PUT", `/api/financeiro/contas/${SI}/saldo-inicial`, { valor: 1, data: "2031-01-01" })).statusCode).toBe(422);
    expect((await send("PUT", `/api/financeiro/contas/${SI}/saldo-inicial`, { valor: "1.001", data: "2031-01-01" })).statusCode).toBe(422);
  });
});

describe("extrato com saldos acumulados", () => {
  let EXT = ""; const M: string[] = [];
  beforeAll(async () => {
    EXT = await conta("EXT", "checking", { saldo: "100" });
    M.push(await movimento(EXT, "2031-07-01", "in", "10.00", { conciliado: true }));
    M.push(await movimento(EXT, "2031-07-02", "out", "3.00"));
    M.push(await movimento(EXT, "2031-07-03", "in", "20.00", { conciliado: true }));
    M.push(await movimento(EXT, "2031-07-04", "out", "5.00"));
    M.push(await movimento(EXT, "2031-07-05", "in", "7.00"));
    // Um movimento CANCELADO não entra no extrato nem no saldo.
    await movimento(EXT, "2031-07-06", "in", "1000.00", { status: "cancelled" });
    // E um de OUTRA empresa (a conta é da organização: entra).
    M.push(await movimento(EXT, "2031-07-07", "out", "2.00", { empresa: I.empresa2 }));
  });
  const extrato = async (qs: string) => {
    const r = await get(`/api/financeiro/extrato?conta_id=${EXT}${qs}`);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as Json & { itens: Record<string, unknown>[]; total: number; saldo_anterior: { real: string; conciliado: string }; saldo_final: { real: string; conciliado: string } };
  };

  it("a página 2 começa do acumulado certo; o saldo final fecha", async () => {
    // Premissa: o cancelado existe e está cancelado.
    expect((await admin.query("select 1 from erp.bank_movements where bank_account_id=$1 and status='cancelled'", [EXT])).rowCount).toBe(1);
    const p2 = await extrato("&pageSize=2&page=2");
    expect(p2.total).toBe(6);
    expect(p2.saldo_anterior).toEqual({ real: "100.00", conciliado: "100.00" });
    expect(p2.itens.map((x) => [x["id"], x["valor"], x["saldo_real"], x["saldo_conciliado"]])).toEqual([
      [M[2], "20.00", "127.00", "130.00"],
      [M[3], "-5.00", "122.00", "130.00"]
    ]);
    expect(p2.saldo_final).toEqual({ real: "127.00", conciliado: "130.00" });
  });

  it("o filtro de situação recorta as LINHAS, não o saldo", async () => {
    const conc = await extrato("&situacao=conciliados");
    expect(conc.itens.map((x) => [x["id"], x["saldo_real"], x["conciliado"]])).toEqual([[M[0], "110.00", true], [M[2], "127.00", true]]);
    expect(conc.total).toBe(2);
    const pend = await extrato("&situacao=pendentes");
    expect(pend.itens.map((x) => x["id"])).toEqual([M[1], M[3], M[4], M[5]]);
    expect(pend.saldo_final, "o saldo final é o mesmo, com ou sem filtro").toEqual(conc.saldo_final);
  });

  it("com início pedido, o saldo anterior soma o que veio antes", async () => {
    const r = await extrato("&de=2031-07-03&ate=2031-07-04");
    expect(r.saldo_anterior).toEqual({ real: "107.00", conciliado: "110.00" });
    expect(r.itens.map((x) => x["saldo_real"])).toEqual(["127.00", "122.00"]);
    expect(r.saldo_final).toEqual({ real: "122.00", conciliado: "130.00" });
  });

  it("conta de outra organização ou malformada: a mesma 404; query estrita", async () => {
    for (const id of [CONTA_ALHEIA, "xyz"]) {
      const r = await get(`/api/financeiro/extrato?conta_id=${id}`);
      expect(r.statusCode, r.body).toBe(404);
    }
    expect((await get(`/api/financeiro/extrato?conta_id=${EXT}&bank_account_id=${EXT}`)).statusCode).toBe(422);
  });
});

describe("as portas: capacidade de organização E financeira", () => {
  it("sem bank_accounts.view (só a financeira) ou sem bank_movements.view (só a de organização): 403", async () => {
    const soFinanceira = await usuarioCom("f8-so-movimentos@demo.local", ["bank_movements.view"]);
    const soOrganizacao = await usuarioCom("f8-so-contas@demo.local", ["bank_accounts.view"]);
    const ambas = await usuarioCom("f8-contas-e-movimentos@demo.local", ["bank_accounts.view", "bank_movements.view"]);
    const qualquer = (await admin.query<{ id: string }>("select id from erp.bank_accounts where organization_id=$1 limit 1", [h.demo.orgId])).rows[0]!.id;
    for (const url of ["/api/financeiro/contas", `/api/financeiro/extrato?conta_id=${qualquer}`]) {
      expect((await get(url, soFinanceira)).statusCode, url).toBe(403);
      expect((await get(url, soOrganizacao)).statusCode, url).toBe(403);
      expect((await get(url, ambas)).statusCode, `controle: com as duas, ${url} abre`).toBe(200);
    }
  });
});
