import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { addDays, money, sum } from "@agro/shared";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — A BAIXA (OPERACOES-01 F8, decisão 285).
 *
 * Semântica B: `amount` é o valor BAIXADO do título e inclui o desconto; o caixa é amount − desconto + juros + multa
 * + acréscimo. Componentes com natureza padrão configurada viram lançamentos separados; a tarifa é sempre um
 * movimento de saída próprio; o excedente vira crédito do parceiro (título-adiantamento pago pelo mesmo movimento);
 * o crédito é usado numa compensação sem banco; o lote é estornado inteiro, e o estorno em lote não parte um
 * movimento único ao meio. Cada caso afirma a PREMISSA (o estado antes) e a CONCLUSÃO (o estado gravado, lido no
 * banco — não na resposta da rota).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db; let hoje: string;
let outroCentro: string; let natJuros: string; let natMulta: string; let natTarifa: string; let natDesconto: string;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const linha = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0]!;
const linhas = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows;
let seq = 0;

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  hoje = (await linha<{ d: string }>("select current_date::text as d")).d;
  const org = h.demo.orgId;
  outroCentro = (await linha<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null and id<>$2 order by code limit 1", [org, I.costCenter])).id;
  const despesas = await linhas<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' and is_active and deleted_at is null and id<>$2 order by code limit 3", [org, I.category]);
  [natJuros, natMulta, natTarifa] = despesas.map((x) => x.id) as [string, string, string];
  natDesconto = (await linha<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and is_active and deleted_at is null and id<>$2 order by code limit 1", [org, I.incomeCategory])).id;
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

/** A configuração (Configurações › Financeiro) é a premissa do caso — gravada direto, como fixture. */
async function naturezas(cfg: Partial<Record<"juros_pagos_id" | "multa_paga_id" | "tarifa_bancaria_id" | "desconto_obtido_id", string | null>>) {
  await admin.query(
    "insert into erp.financeiro_naturezas_padrao(organization_id, juros_pagos_id, multa_paga_id, tarifa_bancaria_id, desconto_obtido_id) values ($1,$2,$3,$4,$5)"
    + " on conflict (organization_id) do update set juros_pagos_id=excluded.juros_pagos_id, multa_paga_id=excluded.multa_paga_id, tarifa_bancaria_id=excluded.tarifa_bancaria_id, desconto_obtido_id=excluded.desconto_obtido_id",
    [h.demo.orgId, cfg.juros_pagos_id ?? null, cfg.multa_paga_id ?? null, cfg.tarifa_bancaria_id ?? null, cfg.desconto_obtido_id ?? null]);
}

async function pagar(valor: string, extra: Record<string, unknown> = {}, rateio?: unknown[]): Promise<{ id: string; numero: string }> {
  const numero = `F8B-${++seq}`;
  const r = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(), payload: {
    empresa_id: I.empresa, number: numero, person_id: I.provider, amount: valor, emission_date: hoje, due_date: addDays(hoje, 20), note: `Baixa F8 ${numero}`,
    apportionment: rateio ?? [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }], ...extra
  } });
  expect(r.statusCode, r.body).toBe(201);
  return { id: j(r).id as string, numero };
}
const baixar = (id: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "POST", url: `/api/financial/payables/${id}/settle`, headers: h.headers(), payload: { settlement_date: hoje, bank_account_id: I.bankAccount, ...payload } });
const titulo = (id: string) => linha<{ status: string; balance: string; paid_amount: string }>("select status, balance::text as balance, paid_amount::text as paid_amount from erp.financial_titles where id=$1", [id]);
const movimentosDoTitulo = (id: string) => linhas<{ id: string; amount: string; type: string; status: string; componente_baixa: string | null; title_settlement_id: string | null; cancel_reason: string | null }>(
  "select id::text as id, amount::text as amount, type, status, componente_baixa, title_settlement_id::text as title_settlement_id, cancel_reason from erp.bank_movements where source_type='title_settlements' and source_id=$1 order by code", [id]);
const rateioDo = (movimento: string) => linhas<{ financial_category_id: string; cost_center_id: string; amount: string }>(
  "select financial_category_id::text as financial_category_id, cost_center_id::text as cost_center_id, amount::text as amount from erp.bank_movement_apportionments where movement_id=$1 order by amount desc, cost_center_id", [movimento]);

describe("baixa parcial: as duas escolhas do valor menor", () => {
  it("deixar o saldo em aberto: valor 60 de um título de 100 → baixa parcial, saldo 40, banco −60", async () => {
    await naturezas({});
    const t = await pagar("100.00");
    expect(await titulo(t.id), "premissa: título aberto, saldo cheio").toMatchObject({ status: "open", balance: "100.00" });
    const r = await baixar(t.id, { amount: "60" });
    expect(r.statusCode, r.body).toBe(201);
    expect(await titulo(t.id)).toEqual({ status: "partially_paid", balance: "40.00", paid_amount: "60.00" });
    const movs = await movimentosDoTitulo(t.id);
    expect(movs.map((m) => [m.amount, m.type, m.status])).toEqual([["60.00", "out", "confirmed"]]);
  });

  it("dar como desconto: valor 100 com desconto 40 → quitado, banco −60 e a natureza do desconto gravada na baixa", async () => {
    await naturezas({ desconto_obtido_id: natDesconto });
    const t = await pagar("100.00");
    expect(await titulo(t.id), "premissa").toMatchObject({ status: "open", balance: "100.00" });
    const r = await baixar(t.id, { amount: "100", discount: "40" });
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).net_amount).toBe("60.00");
    expect(await titulo(t.id)).toEqual({ status: "paid", balance: "0.00", paid_amount: "100.00" });
    expect((await movimentosDoTitulo(t.id)).map((m) => m.amount)).toEqual(["60.00"]);
    const baixa = await linha<{ amount: string; discount: string; net_amount: string; natureza_desconto_id: string | null }>("select amount::text as amount, discount::text as discount, net_amount::text as net_amount, natureza_desconto_id::text as natureza_desconto_id from erp.title_settlements where title_id=$1", [t.id]);
    expect(baixa).toEqual({ amount: "100.00", discount: "40.00", net_amount: "60.00", natureza_desconto_id: natDesconto });
  });
});

describe("componentes da baixa em lançamentos separados", () => {
  it("juros, multa e tarifa com natureza configurada: 3 movimentos + o principal, cada um com a sua natureza e o centro do título; a soma é o caixa", async () => {
    await naturezas({ juros_pagos_id: natJuros, multa_paga_id: natMulta, tarifa_bancaria_id: natTarifa });
    const t = await pagar("200.00", {}, [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "60" }, { financial_category_id: I.category, cost_center_id: outroCentro, percentage: "40" }]);
    expect(await movimentosDoTitulo(t.id), "premissa: nenhum movimento antes da baixa").toEqual([]);
    const r = await baixar(t.id, { amount: "200", interest: "10", penalty: "5", tarifa: "2.50" });
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as { settlement_id: string; net_amount: string; componentes: { componente: string; valor: string; bank_movement_id: string }[]; tarifa_movimento_id: string };
    expect(b.net_amount, "o líquido da baixa soma juros e multa; a tarifa fica fora").toBe("215.00");
    expect(b.componentes.map((c) => [c.componente, c.valor])).toEqual([["juros", "10.00"], ["multa", "5.00"]]);
    const movs = await movimentosDoTitulo(t.id);
    expect(movs.map((m) => [m.componente_baixa, m.amount, m.type])).toEqual([[null, "200.00", "out"], ["juros", "10.00", "out"], ["multa", "5.00", "out"], ["tarifa", "2.50", "out"]]);
    expect(movs.filter((m) => m.componente_baixa).every((m) => m.title_settlement_id === b.settlement_id), "o vínculo com a baixa está em cada componente").toBe(true);
    expect(movs.find((m) => m.componente_baixa === "tarifa")!.id).toBe(b.tarifa_movimento_id);
    expect(money(sum(movs.map((m) => m.amount))), "Σ dos movimentos = principal + juros + multa + tarifa").toBe("217.50");
    expect(await rateioDo(movs[1]!.id), "juros: natureza de juros × os centros do título (60/40)").toEqual([
      { financial_category_id: natJuros, cost_center_id: I.costCenter, amount: "6.00" }, { financial_category_id: natJuros, cost_center_id: outroCentro, amount: "4.00" }]);
    expect((await rateioDo(movs[2]!.id)).map((x) => [x.financial_category_id, x.amount])).toEqual([[natMulta, "3.00"], [natMulta, "2.00"]]);
    expect((await rateioDo(movs[3]!.id)).map((x) => [x.financial_category_id, x.amount])).toEqual([[natTarifa, "1.50"], [natTarifa, "1.00"]]);
    expect((await rateioDo(movs[0]!.id)).every((x) => x.financial_category_id === I.category), "o principal continua com o rateio do título").toBe(true);
    expect(await titulo(t.id)).toMatchObject({ status: "paid", balance: "0.00" });
  });

  it("sem natureza configurada, os juros ficam DENTRO do movimento principal, como antes", async () => {
    await naturezas({});
    const t = await pagar("100.00");
    const r = await baixar(t.id, { amount: "100", interest: "10" });
    expect(r.statusCode, r.body).toBe(201);
    expect((j(r) as { componentes: unknown[] }).componentes, "premissa: nada separado").toEqual([]);
    expect((await movimentosDoTitulo(t.id)).map((m) => [m.componente_baixa, m.amount])).toEqual([[null, "110.00"]]);
  });

  it("tarifa sem natureza configurada → 422, e nada é gravado", async () => {
    await naturezas({});
    const t = await pagar("100.00");
    const r = await baixar(t.id, { amount: "100", tarifa: "3" });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Configure a natureza padrão da tarifa bancária em Configurações › Financeiro");
    expect(await titulo(t.id)).toMatchObject({ status: "open", balance: "100.00" });
    expect(await movimentosDoTitulo(t.id)).toEqual([]);
  });
});

describe("excedente → crédito do parceiro, uso do crédito e estorno", () => {
  let original: { id: string; numero: string }; let baixaOriginal: string; let credito: string; let outro: string; let compensacao: string; let movimento: string;

  it("valor maior que o saldo com excedente: quita pelo saldo e o excedente vira um adiantamento pago pelo MESMO movimento", async () => {
    await naturezas({});
    original = await pagar("100.00");
    const r = await baixar(original.id, { amount: "130", excedente: "credito" });
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as { settlement_id: string; bank_movement_id: string; credito: { titulo_id: string; valor: string } };
    baixaOriginal = b.settlement_id; movimento = b.bank_movement_id; credito = b.credito.titulo_id;
    expect(b.credito.valor).toBe("30.00");
    expect(await titulo(original.id)).toMatchObject({ status: "paid", balance: "0.00", paid_amount: "100.00" });
    const adt = await linha<{ direction: string; payment_type: string; person_id: string; empresa_id: string; amount: string; status: string; source_type: string; source_id: string }>(
      "select direction, payment_type, person_id::text as person_id, empresa_id::text as empresa_id, amount::text as amount, status, source_type, source_id::text as source_id from erp.financial_titles where id=$1", [credito]);
    expect(adt).toEqual({ direction: "payable", payment_type: "advance", person_id: I.provider, empresa_id: I.empresa, amount: "30.00", status: "paid", source_type: "title_settlements", source_id: baixaOriginal });
    const mov = await linhas<{ amount: string }>("select amount::text as amount from erp.bank_movements where id=$1", [movimento]);
    expect(mov, "UM movimento de 130: o título e o crédito").toEqual([{ amount: "130.00" }]);
    expect((await linhas<{ title_id: string }>("select title_id::text as title_id from erp.title_settlements where bank_movement_id=$1 and status='confirmed' order by amount desc", [movimento])).map((x) => x.title_id)).toEqual([original.id, credito]);
    const det = j(await h.app.inject({ method: "GET", url: `/api/financial/payables/${credito}`, headers: h.headers() }));
    expect([det.eh_adiantamento, det.credito_disponivel, det.status_label]).toEqual([true, "30.00", "Adiantamento/Baixado"]);
  });

  it("o crédito é usado na baixa de outro título do mesmo parceiro, sem movimento novo; o crédito cai", async () => {
    outro = (await pagar("50.00")).id;
    const movAntes = Number((await linha<{ n: string }>("select count(*)::text as n from erp.bank_movements where organization_id=$1", [h.demo.orgId])).n);
    const r = await baixar(outro, { settlement_kind: "advance_compensation", adiantamento_id: credito, amount: "20", bank_account_id: null });
    expect(r.statusCode, r.body).toBe(201);
    compensacao = j(r).settlement_id as string;
    expect(j(r).bank_movement_id).toBeNull();
    expect(await titulo(outro)).toMatchObject({ status: "partially_paid", balance: "30.00" });
    expect(Number((await linha<{ n: string }>("select count(*)::text as n from erp.bank_movements where organization_id=$1", [h.demo.orgId])).n), "compensação não movimenta banco").toBe(movAntes);
    const det = j(await h.app.inject({ method: "GET", url: `/api/financial/payables/${credito}`, headers: h.headers() }));
    expect(det.credito_disponivel).toBe("10.00");
  });

  it("crédito insuficiente → 409, e a baixa não entra", async () => {
    const r = await baixar(outro, { settlement_kind: "advance_compensation", adiantamento_id: credito, amount: "15", bank_account_id: null });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE", message: "Crédito do adiantamento insuficiente" });
    expect(await titulo(outro), "premissa intacta").toMatchObject({ balance: "30.00" });
  });

  it("estornar a baixa que gerou crédito JÁ USADO → 409; desfeita a compensação, o estorno cancela a baixa, o crédito e o movimento", async () => {
    const recusa = await h.app.inject({ method: "POST", url: `/api/financial/payables/${original.id}/settlements/${baixaOriginal}/cancel`, headers: h.headers(), payload: { reason: "excedente indevido" } });
    expect(recusa.statusCode, recusa.body).toBe(409);
    expect(j(recusa).error!.message).toBe("O crédito gerado por esta baixa já foi usado: estorne a compensação antes");
    expect(await titulo(original.id), "nada mudou").toMatchObject({ status: "paid" });
    const desfaz = await h.app.inject({ method: "POST", url: `/api/financial/payables/${outro}/settlements/${compensacao}/cancel`, headers: h.headers(), payload: { reason: "compensação errada" } });
    expect(desfaz.statusCode, desfaz.body).toBe(200);
    const ok = await h.app.inject({ method: "POST", url: `/api/financial/payables/${original.id}/settlements/${baixaOriginal}/cancel`, headers: h.headers(), payload: { reason: "excedente indevido" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await titulo(original.id)).toMatchObject({ status: "open", balance: "100.00" });
    expect(await linha("select status, cancel_reason from erp.financial_titles where id=$1", [credito])).toEqual({ status: "cancelled", cancel_reason: "excedente indevido" });
    expect((await linhas<{ status: string }>("select status from erp.title_settlements where title_id=$1", [credito])).map((x) => x.status)).toEqual(["cancelled"]);
    expect(await linha("select status, cancel_reason from erp.bank_movements where id=$1", [movimento])).toEqual({ status: "cancelled", cancel_reason: "excedente indevido" });
  });
});

describe("encontro de contas (baixa cruzada) com desconto — o contrário abate valor − desconto", () => {
  async function receber(valor: string): Promise<string> {
    const r = await h.app.inject({ method: "POST", url: "/api/financial/receivables", headers: h.headers(), payload: {
      empresa_id: I.empresa, number: `F8C-${++seq}`, person_id: I.provider, amount: valor, emission_date: hoje, due_date: addDays(hoje, 20), note: "Cruzada F8",
      apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }]
    } });
    expect(r.statusCode, r.body).toBe(201);
    return j(r).id as string;
  }
  const baixasDo = (id: string) => linhas<{ id: string; amount: string; discount: string; net_amount: string; status: string }>(
    "select id::text as id, amount::text as amount, discount::text as discount, net_amount::text as net_amount, status from erp.title_settlements where title_id=$1 order by created_at, id", [id]);
  const cruzar = (pagar: string, receberId: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: `/api/financial/payables/${pagar}/settle`, headers: h.headers(), payload: { settlement_date: hoje, settlement_kind: "cross_settlement", cross_title_id: receberId, ...payload } });

  it("a pagar 100 × a receber 100, valor 100 com desconto 10: o a pagar quita (100), o a receber abate 90 e fica com 10; o estorno desfaz os dois", async () => {
    const p = (await pagar("100.00")).id; const r = await receber("100.00");
    expect([await titulo(p), await titulo(r)], "premissa: os dois abertos, saldo cheio").toEqual([
      { status: "open", balance: "100.00", paid_amount: "0.00" }, { status: "open", balance: "100.00", paid_amount: "0.00" }]);
    const res = await cruzar(p, r, { amount: "100", discount: "10" });
    expect(res.statusCode, res.body).toBe(201);
    expect(j(res).net_amount).toBe("90.00");
    expect(await titulo(p)).toEqual({ status: "paid", balance: "0.00", paid_amount: "100.00" });
    expect(await titulo(r), "o desconto é do a pagar: o a receber NÃO quita os 100").toEqual({ status: "partially_paid", balance: "10.00", paid_amount: "90.00" });
    const [principal] = await baixasDo(p); const [espelho] = await baixasDo(r);
    expect([principal!.amount, principal!.discount, principal!.net_amount]).toEqual(["100.00", "10.00", "90.00"]);
    expect([espelho!.amount, espelho!.discount, espelho!.net_amount], "o espelho = o compensado").toEqual(["90.00", "0.00", "90.00"]);
    const est = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${principal!.id}/cancel`, headers: h.headers(), payload: { reason: "cruzada errada" } });
    expect(est.statusCode, est.body).toBe(200);
    expect((await baixasDo(p)).map((x) => x.status).concat((await baixasDo(r)).map((x) => x.status)), "o par foi achado e cai inteiro").toEqual(["cancelled", "cancelled"]);
    expect([(await titulo(p)).balance, (await titulo(r)).balance]).toEqual(["100.00", "100.00"]);
  });

  it("o estorno pelo lado do ESPELHO também acha o par (o valor compensado é o mesmo dos dois lados)", async () => {
    const p = (await pagar("80.00")).id; const r = await receber("80.00");
    const res = await cruzar(p, r, { amount: "80", discount: "5" });
    expect(res.statusCode, res.body).toBe(201);
    const [espelho] = await baixasDo(r);
    expect(espelho!.amount, "premissa: o espelho abateu 75").toBe("75.00");
    const est = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${r}/settlements/${espelho!.id}/cancel`, headers: h.headers(), payload: { reason: "pelo espelho" } });
    expect(est.statusCode, est.body).toBe(200);
    expect([(await baixasDo(p))[0]!.status, (await baixasDo(r))[0]!.status]).toEqual(["cancelled", "cancelled"]);
  });

  it("par gravado ANTES da semântica B (espelho com o mesmo amount do principal) continua estornável", async () => {
    const p = (await pagar("100.00")).id; const r = await receber("100.00");
    const par = await linhas<{ id: string; title_id: string }>(
      "insert into erp.title_settlements(organization_id,title_id,cross_title_id,settlement_date,settlement_kind,amount,discount,net_amount,created_by) values"
      + " ($1,$2,$3,$4,'cross_settlement',90,10,80,$5), ($1,$3,$2,$4,'cross_settlement',90,0,90,$5) returning id::text as id, title_id::text as title_id",
      [h.demo.orgId, p, r, hoje, (await linha<{ id: string }>("select id::text as id from erp.users where email='admin@demo.local'")).id]);
    const principal = par.find((x) => x.title_id === p)!.id;
    expect((await titulo(r)).balance, "premissa: o par antigo abateu 90 do a receber").toBe("10.00");
    const est = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${principal}/cancel`, headers: h.headers(), payload: { reason: "par antigo" } });
    expect(est.statusCode, est.body).toBe(200);
    expect([(await baixasDo(p))[0]!.status, (await baixasDo(r))[0]!.status]).toEqual(["cancelled", "cancelled"]);
  });

  it("desconto do valor inteiro → 422 e nada gravado; o contrário com saldo menor que o compensado → 409", async () => {
    const p = (await pagar("100.00")).id; const r = await receber("50.00");
    const tudo = await cruzar(p, r, { amount: "100", discount: "100" });
    expect(tudo.statusCode, tudo.body).toBe(422);
    expect(j(tudo).error!.message).toBe("Na baixa cruzada o desconto não pode ser o valor inteiro: não sobra nada para compensar com o título contrário");
    const maior = await cruzar(p, r, { amount: "100", discount: "40" });
    expect(maior.statusCode, maior.body).toBe(409);
    expect(j(maior).error).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE", message: "Saldo do título contrário insuficiente" });
    expect([await baixasDo(p), await baixasDo(r)], "nada gravado").toEqual([[], []]);
    const cabe = await cruzar(p, r, { amount: "100", discount: "50" });
    expect(cabe.statusCode, cabe.body).toBe(201);
    expect([(await titulo(p)).status, await titulo(r)]).toEqual(["paid", { status: "paid", balance: "0.00", paid_amount: "50.00" }]);
  });
});

describe("título sem rateio (acervo): componentes e tarifa", () => {
  async function semRateio(valor: string): Promise<string> {
    const t = await pagar(valor);
    await admin.query("delete from erp.title_apportionments where title_id=$1", [t.id]);
    return t.id;
  }
  it("juros com natureza configurada ficam DENTRO do principal; tarifa e excedente → 422 com o motivo (não 'Rateio base vazio'), nada gravado", async () => {
    await naturezas({ juros_pagos_id: natJuros, tarifa_bancaria_id: natTarifa });
    const t = await semRateio("100.00");
    expect((await linhas("select 1 from erp.title_apportionments where title_id=$1", [t])).length, "premissa: título sem rateio").toBe(0);
    const msg = "O título não tem rateio (natureza e centro de resultado): a tarifa e o excedente da baixa usam o rateio do título — baixe sem eles";
    const tarifa = await baixar(t, { amount: "100", tarifa: "2" });
    expect(tarifa.statusCode, tarifa.body).toBe(422);
    expect(j(tarifa).error!.message).toBe(msg);
    const excedente = await baixar(t, { amount: "120", excedente: "credito" });
    expect(excedente.statusCode, excedente.body).toBe(422);
    expect(j(excedente).error!.message).toBe(msg);
    expect(await movimentosDoTitulo(t), "nada gravado").toEqual([]);
    const juros = await baixar(t, { amount: "100", interest: "10" });
    expect(juros.statusCode, juros.body).toBe(201);
    expect((j(juros) as { componentes: unknown[] }).componentes).toEqual([]);
    expect((await movimentosDoTitulo(t)).map((m) => [m.componente_baixa, m.amount])).toEqual([[null, "110.00"]]);
  });
  it("lote com tarifa e nenhum título com rateio → 422 com o motivo, antes de gravar", async () => {
    await naturezas({ tarifa_bancaria_id: natTarifa });
    const a = await semRateio("30.00"); const b = await semRateio("20.00");
    const r = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: [a, b], settlement_date: hoje, bank_account_id: I.bankAccount, tarifa: "1" } });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Nenhum título do lote tem rateio (natureza e centro de resultado): a tarifa do lote usa o rateio dos títulos — baixe o lote sem tarifa");
    expect([(await titulo(a)).status, (await titulo(b)).status]).toEqual(["open", "open"]);
  });
});

describe("lote de baixa: movimento único, tarifa do lote e estorno", () => {
  async function loteUnico(valores: string[], tarifa?: string) {
    const ts = [];
    for (const v of valores) ts.push(await pagar(v));
    const r = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: ts.map((t) => t.id), settlement_date: hoje, bank_account_id: I.cashAccount, movement_mode: "single", ...(tarifa ? { tarifa } : {}) } });
    expect(r.statusCode, r.body).toBe(201);
    return { titulos: ts.map((t) => t.id), lote: j(r).lote_id as string, corpo: j(r) as { settled: number; total: string; tarifa_movimento_id: string | null; items: { bank_movement_id: string }[] } };
  }

  it("ESTORNO DO LOTE: 2 títulos + tarifa — as 2 baixas, o movimento único e a tarifa cancelados; títulos de volta a abertos; trilha com o motivo", async () => {
    await naturezas({ tarifa_bancaria_id: natTarifa });
    const { titulos, lote, corpo } = await loteUnico(["100.00", "50.00"], "3");
    expect([corpo.settled, corpo.total]).toEqual([2, "150.00"]);
    const unico = corpo.items[0]!.bank_movement_id;
    expect(corpo.items.every((i) => i.bank_movement_id === unico), "premissa: um movimento só").toBe(true);
    const baixas = await linhas<{ id: string; lote_id: string; status: string }>("select id::text as id, lote_id::text as lote_id, status from erp.title_settlements where title_id = any($1::uuid[])", [titulos]);
    expect(baixas.map((b) => [b.lote_id, b.status])).toEqual([[lote, "confirmed"], [lote, "confirmed"]]);
    expect(await linha("select amount::text as amount, lote_baixa_id::text as lote_baixa_id, componente_baixa from erp.bank_movements where id=$1", [unico])).toEqual({ amount: "150.00", lote_baixa_id: lote, componente_baixa: null });
    expect(await linha("select amount::text as amount, type, componente_baixa, lote_baixa_id::text as lote from erp.bank_movements where id=$1", [corpo.tarifa_movimento_id])).toEqual({ amount: "3.00", type: "out", componente_baixa: "tarifa", lote });
    const visto = j(await h.app.inject({ method: "GET", url: `/api/financeiro/lotes-baixa/${lote}`, headers: h.headers() }));
    expect([visto.situacao, visto.total, (visto.baixas as unknown[]).length, (visto.movimentos as unknown[]).length]).toEqual(["confirmado", "150.00", 2, 2]);

    const r = await h.app.inject({ method: "POST", url: `/api/financeiro/lotes-baixa/${lote}/estorno`, headers: h.headers(), payload: { motivo: "lote lançado na conta errada" } });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ lote_id: lote, baixas_estornadas: 2, movimentos_estornados: 2 });
    expect((await linhas<{ status: string; cancel_reason: string }>("select status, cancel_reason from erp.title_settlements where lote_id=$1", [lote])).every((b) => b.status === "cancelled" && b.cancel_reason === "lote lançado na conta errada")).toBe(true);
    expect(await linhas("select status, cancel_reason from erp.bank_movements where id = any($1::uuid[]) order by code", [[unico, corpo.tarifa_movimento_id]])).toEqual([
      { status: "cancelled", cancel_reason: "lote lançado na conta errada" }, { status: "cancelled", cancel_reason: "lote lançado na conta errada" }]);
    for (const t of titulos) expect((await titulo(t)).status).toBe("open");
    const trilha = await linhas<{ metadata: { reason: string } }>("select metadata from erp.audit_logs where entity='title_settlements' and action='cancel' and entity_id::text = any($1::text[])", [baixas.map((b) => b.id)]);
    expect(trilha.map((x) => x.metadata.reason)).toEqual(["lote lançado na conta errada", "lote lançado na conta errada"]);
    const de_novo = await h.app.inject({ method: "POST", url: `/api/financeiro/lotes-baixa/${lote}/estorno`, headers: h.headers(), payload: { motivo: "outra vez" } });
    expect(de_novo.statusCode).toBe(409);
    expect(j(de_novo).error).toMatchObject({ code: "ALREADY_CANCELLED", message: "Lote já estornado" });
  });

  it("estornar-baixas: 1 dos 2 títulos do lote único é PULADO (movimento compartilhado); com os 2, estornados e o movimento cai uma vez", async () => {
    await naturezas({});
    const { titulos, corpo } = await loteUnico(["70.00", "30.00"]);
    const unico = corpo.items[0]!.bank_movement_id;
    const so1 = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/estornar-baixas", headers: h.headers(), payload: { ids: [titulos[0]], motivo: "só um" } });
    expect(so1.statusCode, so1.body).toBe(200);
    expect(j(so1)).toEqual({ estornados: 0, itens: [{ id: titulos[0], resultado: "pulado", motivo: "movimento_compartilhado", baixas: 0 }] });
    expect((await titulo(titulos[0]!)).status, "nada mudou").toBe("paid");
    expect((await linha<{ status: string }>("select status from erp.bank_movements where id=$1", [unico])).status).toBe("confirmed");

    const os2 = await h.app.inject({ method: "POST", url: "/api/financeiro/titulos/estornar-baixas", headers: h.headers(), payload: { ids: titulos, motivo: "os dois" } });
    expect(os2.statusCode, os2.body).toBe(200);
    expect(j(os2)).toEqual({ estornados: 2, itens: titulos.map((id) => ({ id, resultado: "estornado", baixas: 1 })) });
    for (const t of titulos) expect((await titulo(t)).status).toBe("open");
    expect(await linha("select status, cancel_reason from erp.bank_movements where id=$1", [unico])).toEqual({ status: "cancelled", cancel_reason: "os dois" });
  });
});
