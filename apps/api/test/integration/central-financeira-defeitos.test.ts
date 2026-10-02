import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { addDays } from "@agro/shared";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * OS DEFEITOS DO FINANCEIRO DE HOJE (OPERACOES-01 F8, decisão 285) — UM caso por defeito, cada um com a PREMISSA (o
 * que torna o defeito observável) e a CONCLUSÃO (o estado gravado, lido no banco). Os de `sales.ts`, `supply.ts` e
 * `livestock.ts` ("a 1ª natureza/centro por código") ficaram para a F9 (decisão 286); a transferência para conta
 * destino inválida é provada em `central-financeira-bancos.test.ts`.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db; let hoje: string;
let orgB: string; let pessoaB: string; let contaB: string;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const linha = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0]!;
const linhas = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows;
const rateio = (cat?: string) => [{ financial_category_id: cat ?? I.category, cost_center_id: I.costCenter, percentage: "100" }];

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  hoje = (await linha<{ d: string }>("select current_date::text as d")).d;
  const b = await seedDemo(admin, { orgName: "[TEST] Org F8 defeitos", adminEmail: "adminf8def@demo.local", adminPassword: "Demo@12345", slug: "orgf8def" }, () => {});
  orgB = b.orgId;
  pessoaB = (await linha<{ id: string }>("select id::text as id from erp.people where organization_id=$1 and is_provider order by code limit 1", [orgB])).id;
  contaB = (await linha<{ id: string }>("select id::text as id from erp.bank_accounts where organization_id=$1 and code='BB'", [orgB])).id;
}, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

async function membro(nome: string, email: string, perms: string[], empresas: string[] = []): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Defeito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Defeito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
async function pagar(numero: string, valor: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: {
    empresa_id: I.empresa, number: numero, person_id: I.provider, amount: valor, emission_date: hoje, due_date: addDays(hoje, 15), note: `Defeito ${numero}`, apportionment: rateio(), ...extra
  } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const congelar = async (empresa: string, ano: number, mes: number) => (await linha<{ id: string }>("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,$2,$3,$4,true) returning id::text as id", [h.demo.orgId, empresa, ano, mes])).id;
const descongelar = (id: string) => admin.query("delete from erp.financial_freezes where id=$1", [id]);
const ofx = (transacoes: { fitid: string; data: string; valor: string }[], conta = "56789-0") =>
  `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>001<ACCTID>${conta}</BANKACCTFROM><BANKTRANLIST>\n`
  + transacoes.map((t) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${t.data.replace(/-/g, "")}<TRNAMT>${t.valor}<FITID>${t.fitid}<MEMO>F8</STMTTRN>`).join("\n")
  + "\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
const movimento = async (valor: string, data: string, conta = I.bankAccount, tipo: "in" | "out" = "in") => {
  const r = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: { empresa_id: I.empresa, bank_account_id: conta, movement_date: data, type: tipo, category_type: tipo, amount: valor, note: "Defeito F8", apportionment: rateio(tipo === "in" ? I.incomeCategory : I.category) } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
};

describe("baixa em lote", () => {
  it("`empresaPermitida` agora é aguardada: título de empresa fora do escopo é PULADO e não soma no total", async () => {
    const tA = await pagar("LOTE-A", "30.00");
    const tB = await pagar("LOTE-B", "70.00", { empresa_id: I.empresa2 });
    expect((await h.app.inject({ method: "GET", url: `/api/financial/payables/${tB}`, headers: h.headers() })).statusCode, "premissa: o título B existe e o administrador o vê").toBe(200);
    const soA = await membro("Pagador A", "def.pagador.a@demo.local", ["payables.view", "payables.settle"], [I.empresa]);
    const r = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: soA, payload: { ids: [tA, tB], settlement_date: hoje, bank_account_id: I.cashAccount, movement_mode: "single" } });
    expect(r.statusCode, r.body).toBe(201);
    expect([j(r).settled, j(r).total, j(r).pulados]).toEqual([1, "30.00", [{ id: tB, motivo: "nao_encontrado" }]]);
    expect(await linha("select status from erp.financial_titles where id=$1", [tB])).toEqual({ status: "open" });
    // O movimento ÚNICO nasce na empresa DOS títulos e com o rateio deles (antes: empresa selecionada, às vezes nula, e sem rateio).
    const mov = (j(r).items as { bank_movement_id: string }[])[0]!.bank_movement_id;
    expect(await linha("select empresa_id::text as empresa_id, amount::text as amount from erp.bank_movements where id=$1", [mov])).toEqual({ empresa_id: I.empresa, amount: "30.00" });
    expect(await linhas("select financial_category_id::text as cat, amount::text as amount from erp.bank_movement_apportionments where movement_id=$1", [mov])).toEqual([{ cat: I.category, amount: "30.00" }]);
  });
});

describe("cancelamento", () => {
  it("o cancelamento em LOTE diz o que pulou e por quê (congelado, com baixa, já cancelado, inexistente) e grava o motivo", async () => {
    const congelado = await pagar("CANC-CONG", "10.00", { emission_date: "2025-05-10", due_date: "2025-06-10" });
    const freeze = await congelar(I.empresa, 2025, 5);
    try {
      const pago = await pagar("CANC-PAGO", "10.00");
      expect((await h.app.inject({ method: "POST", url: `/api/financial/payables/${pago}/settle`, headers: h.headers(), payload: { settlement_date: hoje, bank_account_id: I.bankAccount, amount: "10" } })).statusCode).toBe(201);
      const jaCancelado = await pagar("CANC-JA", "10.00");
      expect((await h.app.inject({ method: "POST", url: `/api/financial/payables/${jaCancelado}/cancel`, headers: h.headers(), payload: { reason: "antes" } })).statusCode).toBe(200);
      const livre = await pagar("CANC-LIVRE", "10.00");
      const inexistente = "00000000-0000-4000-8000-0000000000c1";
      const r = await h.app.inject({ method: "POST", url: "/api/financial/payables/cancel-batch", headers: h.headers(), payload: { ids: [congelado, pago, jaCancelado, inexistente, livre], reason: "limpeza do mês" } });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toEqual({ cancelled: 1, skipped: 4, itens: [
        { id: congelado, resultado: "pulado", motivo: "periodo_congelado" }, { id: pago, resultado: "pulado", motivo: "com_baixa" },
        { id: jaCancelado, resultado: "pulado", motivo: "ja_cancelado" }, { id: inexistente, resultado: "pulado", motivo: "nao_encontrado" },
        { id: livre, resultado: "cancelado" }] });
      expect(await linha("select status from erp.financial_titles where id=$1", [congelado]), "o congelado continua aberto").toEqual({ status: "open" });
      expect(await linha("select status, cancel_reason from erp.financial_titles where id=$1", [livre])).toEqual({ status: "cancelled", cancel_reason: "limpeza do mês" });
    } finally { await descongelar(freeze); }
  });

  it("o motivo do cancelamento é GRAVADO — no título e nas DUAS pontas da transferência", async () => {
    const t = await pagar("MOT-T", "12.00");
    const c = await h.app.inject({ method: "POST", url: `/api/financial/payables/${t}/cancel`, headers: h.headers(), payload: { reason: "lançado em duplicidade" } });
    expect(c.statusCode, c.body).toBe(200);
    const tit = await linha<{ status: string; cancel_reason: string; cancelled_by: string | null; cancelled_at: string | null }>("select status, cancel_reason, cancelled_by::text as cancelled_by, cancelled_at::text as cancelled_at from erp.financial_titles where id=$1", [t]);
    expect([tit.status, tit.cancel_reason, tit.cancelled_by !== null, tit.cancelled_at !== null]).toEqual(["cancelled", "lançado em duplicidade", true, true]);
    const tr = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: { empresa_id: I.empresa, bank_account_id: I.bankAccount, movement_date: hoje, type: "out", category_type: "internal_transfer", destination_account_id: I.cashAccount, amount: "15" } });
    expect(tr.statusCode, tr.body).toBe(201);
    const par = (await linha<{ transfer_pair_id: string }>("select transfer_pair_id::text as transfer_pair_id from erp.bank_movements where id=$1", [j(tr).id])).transfer_pair_id;
    expect(par, "premissa: a transferência tem par").toBeTruthy();
    const cm = await h.app.inject({ method: "POST", url: `/api/financial/bank-movements/${j(tr).id}/cancel`, headers: h.headers(), payload: { reason: "transferência errada" } });
    expect(cm.statusCode, cm.body).toBe(200);
    expect(await linhas("select status, cancel_reason from erp.bank_movements where id = any($1::uuid[])", [[j(tr).id, par]])).toEqual([
      { status: "cancelled", cancel_reason: "transferência errada" }, { status: "cancelled", cancel_reason: "transferência errada" }]);
  });
});

describe("edição do título", () => {
  it("PUT que MOVE a emissão para um mês congelado → 409 (antes só a emissão atual era conferida)", async () => {
    const t = await pagar("PUT-CONG", "20.00");
    const freeze = await congelar(I.empresa, 2025, 6);
    try {
      const r = await h.app.inject({ method: "PUT", url: `/api/financial/payables/${t}`, headers: h.headers(), payload: { emission_date: "2025-06-15" } });
      expect(r.statusCode, r.body).toBe(409);
      expect(j(r).error!.code).toBe("PERIOD_FROZEN");
      expect(await linha("select emission_date from erp.financial_titles where id=$1", [t])).toEqual({ emission_date: hoje });
    } finally { await descongelar(freeze); }
  });

  it("`version` diferente → 409; mandar só a observação NÃO zera o desconto nem as marcas (os padrões do esquema não valem na edição)", async () => {
    const t = await pagar("PUT-VER", "100.00", { discount: "10", is_tax: true });
    const atual = await linha<{ version: number }>("select version from erp.financial_titles where id=$1", [t]);
    const velho = await h.app.inject({ method: "PUT", url: `/api/financial/payables/${t}`, headers: h.headers(), payload: { note: "outra", version: atual.version - 1 } });
    expect(velho.statusCode, velho.body).toBe(409);
    expect(j(velho).error!.code).toBe("CONCURRENCY_CONFLICT");
    const ok = await h.app.inject({ method: "PUT", url: `/api/financial/payables/${t}`, headers: h.headers(), payload: { note: "só a observação", version: atual.version } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await linha("select note, discount::text as discount, is_tax from erp.financial_titles where id=$1", [t])).toEqual({ note: "só a observação", discount: "10.00", is_tax: true });
  });

  it("referência de OUTRA organização é recusada (FK de coluna única não prova tenant); rateio em R$ que não fecha → 422", async () => {
    const antes = Number((await linha<{ n: string }>("select count(*)::text as n from erp.financial_titles where organization_id=$1", [h.demo.orgId])).n);
    const corpo = { empresa_id: I.empresa, number: "REF-B", amount: "50.00", emission_date: hoje, due_date: hoje, note: "ref", apportionment: rateio() };
    const pessoa = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { ...corpo, person_id: pessoaB } });
    expect(pessoa.statusCode, pessoa.body).toBe(422);
    expect(j(pessoa).error!.message).toBe("Parceiro inválido");
    const conta = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { ...corpo, person_id: I.provider, conta_prevista_id: contaB } });
    expect(conta.statusCode, conta.body).toBe(422);
    expect(j(conta).error!.message).toBe("Conta prevista inválida");
    const naoFecha = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: { ...corpo, person_id: I.provider, apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, amount: "49.99" }] } });
    expect(naoFecha.statusCode, naoFecha.body).toBe(422);
    expect(j(naoFecha).error).toMatchObject({ code: "APPORTIONMENT_MISMATCH", message: "O rateio soma R$ 49.99 e o título vale R$ 50.00: ajuste R$ 0.01 para fechar." });
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.financial_titles where organization_id=$1", [h.demo.orgId])).n), "nada gravado").toBe(antes);
  });

  it("título gerado por VENDA confirmada: valor só pela origem (409); vencimento muda (200); cancelar pelo financeiro → 409", async () => {
    expect((await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "20", unit_value: "10" } })).statusCode).toBe(201);
    const v = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(), payload: { empresa_id: I.empresa, document_date: hoje, client_id: I.client, items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "1", unit_price: "88.00" }] } });
    expect(v.statusCode, v.body).toBe(201);
    const conf = await h.app.inject({ method: "POST", url: `/api/sales/sales/${j(v).id}/confirm`, headers: h.headers() });
    expect(conf.statusCode, conf.body).toBe(200);
    const t = (j(conf).title_ids as string[])[0]!;
    const det = j(await h.app.inject({ method: "GET", url: `/api/financial/receivables/${t}`, headers: h.headers() }));
    expect([det.source_type, det.bloqueado_pela_origem, det.amount], "premissa: título da venda").toEqual(["sales_documents", true, "88.00"]);
    const valor = await h.app.inject({ method: "PUT", url: `/api/financial/receivables/${t}`, headers: h.headers(), payload: { amount: "90.00", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] } });
    expect(valor.statusCode, valor.body).toBe(409);
    expect(j(valor).error!.message).toBe("Título gerado por Venda: valor, parceiro e rateio só mudam pela origem. Altere pela origem.");
    // A web anterior manda o corpo INTEIRO com os mesmos valores (em outra forma) e o vencimento novo: passa.
    const ap = (det.apportionments as { financial_category_id: string; cost_center_id: string; percentage: string }[]).map((a) => ({ financial_category_id: a.financial_category_id, cost_center_id: a.cost_center_id, percentage: a.percentage }));
    const novo = addDays(hoje, 40);
    const venc = await h.app.inject({ method: "PUT", url: `/api/financial/receivables/${t}`, headers: h.headers(), payload: { empresa_id: det.empresa_id, number: det.number, person_id: det.person_id, payment_type: det.payment_type, amount: "88", discount: "0", emission_date: det.emission_date, due_date: novo, note: det.note, apportionment: ap, plan: null, auto_settle: null } });
    expect(venc.statusCode, venc.body).toBe(200);
    expect(await linha("select due_date, amount::text as amount from erp.financial_titles where id=$1", [t])).toEqual({ due_date: novo, amount: "88.00" });
    const cancelar = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${t}/cancel`, headers: h.headers(), payload: { reason: "não quero" } });
    expect(cancelar.statusCode, cancelar.body).toBe(409);
    expect(await linha("select status from erp.financial_titles where id=$1", [t])).toEqual({ status: "open" });
  });
});

describe("movimento bancário", () => {
  it("PUT de movimento CONFIRMADO mudando o valor → 409 e o banco intacto; a observação continua editável", async () => {
    const m = await movimento("321.00", hoje, I.bankAccount, "out");
    const r = await h.app.inject({ method: "PUT", url: `/api/financial/bank-movements/${m}`, headers: h.headers(), payload: { amount: "1.00", movement_date: addDays(hoje, -1) } });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.message).toBe("Movimento bancário confirmado não se altera: estorne e lance outro.");
    const comRateio = await h.app.inject({ method: "PUT", url: `/api/financial/bank-movements/${m}`, headers: h.headers(), payload: { apportionment: rateio() } });
    expect(comRateio.statusCode, "rateio também não muda").toBe(409);
    expect(await linha("select amount::text as amount, movement_date from erp.bank_movements where id=$1", [m])).toEqual({ amount: "321.00", movement_date: hoje });
    const nota = await h.app.inject({ method: "PUT", url: `/api/financial/bank-movements/${m}`, headers: h.headers(), payload: { note: "observação corrigida", amount: "321" } });
    expect(nota.statusCode, nota.body).toBe(200);
    expect(await linha("select note, amount::text as amount from erp.bank_movements where id=$1", [m])).toEqual({ note: "observação corrigida", amount: "321.00" });
  });

  it("'gera obrigação' sem empresa → 422 (antes caía na 1ª empresa por código); com a empresa B, o título nasce na B e é baixado pela `settle`", async () => {
    const primeira = (await linha<{ id: string }>("select id::text as id from erp.empresas where organization_id=$1 order by code limit 1", [h.demo.orgId])).id;
    expect(primeira, "premissa: a 1ª por código não é a B").not.toBe(I.empresa2);
    const corpo = { bank_account_id: I.bankAccount, movement_date: hoje, type: "out", category_type: "out", amount: "44.00", generates_obligation: true, person_id: I.provider, document: "OBRIG-1", apportionment: rateio() };
    const antes = Number((await linha<{ n: string }>("select count(*)::text as n from erp.bank_movements where organization_id=$1", [h.demo.orgId])).n);
    const sem = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: corpo });
    expect(sem.statusCode, sem.body).toBe(422);
    expect(j(sem).error!.message).toBe("Informe a empresa: o título gerado pelo movimento precisa de empresa");
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.bank_movements where organization_id=$1", [h.demo.orgId])).n)).toBe(antes);
    const comB = await h.app.inject({ method: "POST", url: "/api/financial/bank-movements", headers: h.headers(), payload: { ...corpo, empresa_id: I.empresa2 } });
    expect(comB.statusCode, comB.body).toBe(201);
    const t = await linha<{ id: string; empresa_id: string; status: string }>("select id::text as id, empresa_id::text as empresa_id, status from erp.financial_titles where source_type='bank_movements' and source_id=$1", [j(comB).id]);
    expect([t.empresa_id, t.status]).toEqual([I.empresa2, "paid"]);
    expect(await linha("select empresa_id::text as empresa_id from erp.bank_movements where id=$1", [j(comB).id])).toEqual({ empresa_id: I.empresa2 });
    const baixa = await linha<{ id: string; net_amount: string }>("select id::text as id, net_amount::text as net_amount from erp.title_settlements where title_id=$1 and bank_movement_id=$2", [t.id, j(comB).id]);
    expect(baixa.net_amount).toBe("44.00");
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.audit_logs where entity='title_settlements' and entity_id::text=$1 and action='create'", [baixa.id])).n), "a baixa automática deixa trilha (antes: INSERT cru)").toBe(1);
  });
});

describe("adiantamento pelo tipo de título", () => {
  it("`is_advance` do tipo é LIDO: 'Ad.Fornecedor' com forma 'single' é adiantamento pendente, não conta comum a vencer", async () => {
    const tipo = (await linha<{ id: string; is_advance: boolean }>("select id::text as id, is_advance from erp.title_types where name='Ad.Fornecedor' and organization_id is null"));
    expect(tipo.is_advance, "premissa").toBe(true);
    const t = await pagar("ADTIPO-1", "25.00", { title_type_id: tipo.id, payment_type: "single" });
    const pendentes = j(await h.app.inject({ method: "GET", url: "/api/financial/payables?status=advance_pending&number=ADTIPO-", headers: h.headers() })) as { items: { id: string; status_label: string; eh_adiantamento: boolean }[] };
    expect(pendentes.items.map((x) => [x.id, x.status_label, x.eh_adiantamento])).toEqual([[t, "Adiantamento/Pendente", true]]);
    const abertos = j(await h.app.inject({ method: "GET", url: "/api/financial/payables?status=open&number=ADTIPO-", headers: h.headers() })) as { items: unknown[] };
    expect(abertos.items).toEqual([]);
  });
});

describe("OFX (rotas de hoje)", () => {
  it("conta de OUTRA organização → 422 e nada gravado", async () => {
    const antes = Number((await linha<{ n: string }>("select count(*)::text as n from erp.ofx_imports where organization_id=$1", [h.demo.orgId])).n);
    const r = await h.app.inject({ method: "POST", url: "/api/financial/ofx-imports", headers: h.headers(), payload: { bank_account_id: contaB, description: "de outra organização", content: ofx([{ fitid: "X1", data: hoje, valor: "10.00" }]) } });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Conta bancária inválida");
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.ofx_imports where organization_id=$1", [h.demo.orgId])).n)).toBe(antes);
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.ofx_imports where bank_account_id=$1", [contaB])).n)).toBe(0);
  });

  it("TRNAMT '1.234,56' vira 1234.56 em decimal e casa EXATO com o movimento; o conciliado não se estorna", async () => {
    expect(Number("1.234,56".replace(",", ".")), "premissa: o parser antigo lia NaN").toBeNaN();
    const data = addDays(hoje, -3);
    const m = await movimento("1234.56", data);
    const r = await h.app.inject({ method: "POST", url: "/api/financial/ofx-imports", headers: h.headers(), payload: { bank_account_id: I.bankAccount, description: "decimal", content: ofx([{ fitid: "D1", data, valor: "1.234,56" }, { fitid: "D2", data, valor: "abc" }]) } });
    expect(r.statusCode, r.body).toBe(201);
    expect([j(r).transactions, j(r).matched, j(r).recusadas]).toEqual([1, 1, [{ fitid: "D2", motivo: "Valor inválido no extrato: abc" }]]);
    const tx = await linha<{ id: string; amount: string; status: string; bank_movement_id: string }>("select id::text as id, amount::text as amount, status, bank_movement_id::text as bank_movement_id from erp.ofx_transactions where import_id=$1", [j(r).id]);
    expect([tx.amount, tx.status, tx.bank_movement_id]).toEqual(["1234.56", "matched", m]);
    expect(await linha("select reconciled_at is not null as conciliado, ofx_transaction_id::text as tx from erp.bank_movements where id=$1", [m])).toEqual({ conciliado: true, tx: tx.id });
    const estorno = await h.app.inject({ method: "POST", url: `/api/financial/bank-movements/${m}/cancel`, headers: h.headers(), payload: { reason: "teste" } });
    expect(estorno.statusCode, estorno.body).toBe(409);
    expect(j(estorno).error!.message).toBe("Movimento conciliado: desfaça a conciliação antes");
  });

  it("dois candidatos exatos → a transação fica PENDENTE; o vínculo manual confere conta, valor e situação", async () => {
    const data = addDays(hoje, -4);
    const m1 = await movimento("555.55", data); const m2 = await movimento("555.55", data);
    const r = await h.app.inject({ method: "POST", url: "/api/financial/ofx-imports", headers: h.headers(), payload: { bank_account_id: I.bankAccount, description: "ambíguo", content: ofx([{ fitid: "A1", data, valor: "555.55" }]) } });
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).matched).toBe(0);
    expect(await linhas("select reconciled_at from erp.bank_movements where id = any($1::uuid[])", [[m1, m2]])).toEqual([{ reconciled_at: null }, { reconciled_at: null }]);
    const tid = (await linha<{ id: string }>("select id::text as id from erp.ofx_transactions where import_id=$1", [j(r).id])).id;
    const url = `/api/financial/ofx-imports/${j(r).id}/transactions/${tid}/match`;
    const outraConta = await movimento("555.55", data, I.cashAccount);
    expect((await h.app.inject({ method: "POST", url, headers: h.headers(), payload: { bank_movement_id: outraConta } })).statusCode, "movimento de outra conta").toBe(404);
    const outroValor = await movimento("555.50", data);
    const difere = await h.app.inject({ method: "POST", url, headers: h.headers(), payload: { bank_movement_id: outroValor } });
    expect([difere.statusCode, j(difere).error!.message]).toEqual([422, "O valor do movimento difere do valor do extrato"]);
    const ok = await h.app.inject({ method: "POST", url, headers: h.headers(), payload: { bank_movement_id: m1 } });
    expect(ok.statusCode, ok.body).toBe(200);
    const deNovo = await h.app.inject({ method: "POST", url, headers: h.headers(), payload: { bank_movement_id: m2 } });
    expect([deNovo.statusCode, j(deNovo).error!.message]).toEqual([409, "Transação já conciliada ou ignorada: desfaça antes"]);
    expect(await linha("select reconciled_at is not null as conciliado from erp.bank_movements where id=$1", [m2]), "o segundo movimento continua livre").toEqual({ conciliado: false });
    expect(await linha("select status from erp.ofx_imports where id=$1", [j(r).id])).toEqual({ status: "reconciled" });
  });
});

describe("contas tributárias e desconto", () => {
  it("`tax-accounts` recorta os tributos ANTES da página: pageSize=2 devolve 2 e o total de todos os tributos", async () => {
    for (const n of ["TRIB-1", "TRIB-2", "TRIB-3"]) await pagar(n, "9.00", { is_tax: true });
    await pagar("TRIB-NAO", "9.00");
    const r = await h.app.inject({ method: "GET", url: "/api/financial/tax-accounts?pageSize=2&number=TRIB-", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r) as { items: { is_tax: boolean }[]; total: number };
    expect([b.items.length, b.total, b.items.every((x) => x.is_tax)]).toEqual([2, 3, true]);
  });

  it("o desconto conta UMA vez: título 600, baixa de 600 com 50 de desconto → quitado, banco −550", async () => {
    const t = await pagar("DESC-1", "600.00");
    const r = await h.app.inject({ method: "POST", url: `/api/financial/payables/${t}/settle`, headers: h.headers(), payload: { settlement_date: hoje, bank_account_id: I.bankAccount, amount: "600", discount: "50" } });
    expect(r.statusCode, r.body).toBe(201);
    expect(await linha("select status, balance::text as balance, paid_amount::text as paid from erp.financial_titles where id=$1", [t])).toEqual({ status: "paid", balance: "0.00", paid: "600.00" });
    expect(await linha("select amount::text as amount from erp.bank_movements where id=$1", [j(r).bank_movement_id])).toEqual({ amount: "550.00" });
  });
});

describe("anexos do título", () => {
  it("a contagem e a lista de anexos leem a entidade gravada (`financial_titles`): antes liam 'financial_title' e davam sempre 0", async () => {
    const t = await pagar("ANEXO-1", "45.00");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
    const up = await h.app.inject({ method: "POST", url: "/api/attachments", headers: h.headers(), payload: { entity: "financial_titles", entity_id: t, file_name: "boleto.pdf", mime_type: "application/pdf", description: "Boleto", data_base64: pdf } });
    expect(up.statusCode, up.body).toBe(201);
    // Premissa: o anexo está gravado com a entidade = nome da tabela (a whitelist de lib/attachment-parent.ts).
    expect(await linhas("select entity, file_name from erp.attachments where entity_id=$1", [t])).toEqual([{ entity: "financial_titles", file_name: "boleto.pdf" }]);
    // Conclusão: a lista de hoje, o detalhe e a lista da Central contam o anexo.
    const lista = await h.app.inject({ method: "GET", url: "/api/financial/payables?number=ANEXO-1", headers: h.headers() });
    expect(lista.statusCode, lista.body).toBe(200);
    expect((j(lista).items as { id: string; attachment_count: number }[]).filter((x) => x.id === t).map((x) => x.attachment_count)).toEqual([1]);
    const det = await h.app.inject({ method: "GET", url: `/api/financial/payables/${t}`, headers: h.headers() });
    expect((j(det).attachments as { file_name: string }[]).map((x) => x.file_name)).toEqual(["boleto.pdf"]);
    const central = await h.app.inject({ method: "GET", url: `/api/financeiro/titulos?direcao=payable&ids=${t}`, headers: h.headers() });
    expect(central.statusCode, central.body).toBe(200);
    expect((j(central).items as { id: string; anexos: number }[]).map((x) => [x.id, x.anexos])).toEqual([[t, 1]]);
  });
});
