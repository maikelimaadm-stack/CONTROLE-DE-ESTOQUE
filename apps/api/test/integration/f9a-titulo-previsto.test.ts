import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, unico, contar, criarTopNo5, pedidoDeVenda, previstoDireto, type Hdr
} from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — O TÍTULO PREVISTO (`status = 'previsto'`, 0045): a provisão de um documento pela TOP.
 * É promessa de caixa, não lançamento:
 *   · TP-1 fora das baixas: baixa individual e cruzada → 409; o lote o pula (`situacao`); PUT, duplicar e cancelar → 409;
 *          alterar o vencimento o pula;
 *   · TP-2 fora das listas e dos totais padrão (a lista antiga e a Central); só aparece pedido (`status=previsto`,
 *          `situacao=previsto`, o cartão "Previstos", agora disponível);
 *   · TP-3 no fluxo, numa série SEPARADA (`previstos=1`); `previstos=0` devolve a resposta da F8, chave por chave;
 *   · TP-4 fora do DRE de competência, dos adiantamentos e dos painéis;
 *   · TP-5 as capacidades novas (`financeiroPelaTop`, `lcdpr`), aditivas;
 *   · TP-6 o detalhe: a origem pelo NOME e a TOP de origem com a versão.
 *
 * O previsto é FIXTURE (`previstoDireto`, superusuário, com a origem num pedido de venda real): a provisão de verdade é
 * provada no P5. Toda conclusão vem com a premissa ao lado (o título comum da mesma situação aparece, recebe baixa…).
 */
beforeAll(iniciarF9a, 240_000);
afterAll(encerrarF9a);

const MSG_SEM_BAIXA = "Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado.";
const MSG_SEM_EDICAO = "Título previsto muda pelo documento de origem.";
const MSG_SEM_DUPLICAR = "Título previsto não se duplica.";

const api = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers: Hdr = f9.h.headers()) =>
  f9.h.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** Um título comum (avulso) pela API. */
async function titulo(dir: "payable" | "receivable", numero: string, valor: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await api("POST", `/api/financial/${dir}s`, {
    empresa_id: f9.I.empresa, number: numero, person_id: dir === "payable" ? f9.I.provider : f9.I.client, amount: valor, emission_date: DATA, due_date: DATA, note: `F9a ${numero}`,
    apportionment: [{ financial_category_id: dir === "payable" ? f9.I.category : f9.I.incomeCategory, cost_center_id: f9.I.costCenter, percentage: "100" }], ...extra
  });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const situacaoNoBanco = (id: string) => linha<{ status: string; paid_amount: string; note: string; due_date: string }>(
  "select status, paid_amount::text as paid_amount, note, due_date::text as due_date from erp.financial_titles where id=$1", [id]);
const baixasDo = async (id: string) => (await linhas<{ id: string }>("select id::text as id from erp.title_settlements where title_id=$1", [id])).length;

// ---------------------------------------------------------------------------------------------------------------
describe("TP-1 — o previsto fica fora das baixas e não se edita", () => {
  let previsto = ""; let aberto = "";
  beforeAll(async () => {
    const pedido = await pedidoDeVenda();
    previsto = await previstoDireto({ origemId: pedido.id, numero: `TP1-PRV-${unico()}`, valor: "300.00" });
    aberto = await titulo("receivable", `TP1-ABT-${unico()}`, "50.00");
  });

  it("baixa individual → 409 com a mensagem do previsto; o título comum recebe (premissa)", async () => {
    const ok = await api("POST", `/api/financial/receivables/${aberto}/settle`, { settlement_date: DATA, bank_account_id: f9.I.bankAccount, amount: "10.00" });
    expect(ok.statusCode, `premissa: o título comum recebe baixa — ${ok.body}`).toBe(201);
    const r = await api("POST", `/api/financial/receivables/${previsto}/settle`, { settlement_date: DATA, bank_account_id: f9.I.bankAccount, amount: "10.00" });
    expect(r.statusCode).toBe(409);
    expect(erro(r)).toMatchObject({ code: "CONFLICT", message: MSG_SEM_BAIXA });
    expect(await situacaoNoBanco(previsto)).toMatchObject({ status: "previsto", paid_amount: "0.00" });
    expect(await baixasDo(previsto)).toBe(0);
  });

  it("baixa CRUZADA contra um previsto → 409 (o contrário também é conferido); nada gravado", async () => {
    const pagar = await titulo("payable", `TP1-PAG-${unico()}`, "40.00");
    const antes = await contar("title_settlements");
    const r = await api("POST", `/api/financial/payables/${pagar}/settle`, { settlement_date: DATA, settlement_kind: "cross_settlement", cross_title_id: previsto, amount: "10.00" });
    expect(r.statusCode).toBe(409);
    expect(erro(r)).toMatchObject({ code: "CONFLICT", message: MSG_SEM_BAIXA });
    expect(await contar("title_settlements")).toBe(antes);
  });

  it("baixa em LOTE: o previsto é pulado com `situacao`; o comum do mesmo lote é baixado", async () => {
    const outro = await titulo("receivable", `TP1-LOT-${unico()}`, "20.00");
    const r = await api("POST", "/api/financial/receivables/settle-batch", { ids: [previsto, outro], settlement_date: DATA, bank_account_id: f9.I.bankAccount });
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as { settled: number; pulados: { id: string; motivo: string }[] };
    expect(b.settled).toBe(1);
    expect(b.pulados).toEqual([{ id: previsto, motivo: "situacao" }]);
    expect((await situacaoNoBanco(outro)).status, "premissa: o comum foi baixado").toBe("paid");
    expect(await situacaoNoBanco(previsto)).toMatchObject({ status: "previsto", paid_amount: "0.00" });
  });

  it("PUT, duplicar e cancelar → 409; o título comum se edita (premissa)", async () => {
    const ed = await api("PUT", `/api/financial/receivables/${aberto}`, { note: "Comum editado" });
    expect(ed.statusCode, `premissa: o comum se edita — ${ed.body}`).toBe(200);
    const put = await api("PUT", `/api/financial/receivables/${previsto}`, { note: "Tentativa" });
    expect(put.statusCode).toBe(409);
    expect(erro(put)).toMatchObject({ code: "CONFLICT", message: MSG_SEM_EDICAO });
    const antes = await contar("financial_titles");
    const dup = await api("POST", `/api/financial/receivables/${previsto}/duplicate`, {});
    expect(dup.statusCode).toBe(409);
    expect(erro(dup)).toMatchObject({ code: "CONFLICT", message: MSG_SEM_DUPLICAR });
    expect(await contar("financial_titles"), "nada duplicado").toBe(antes);
    const can = await api("POST", `/api/financial/receivables/${previsto}/cancel`, { reason: "Tentativa" });
    expect(can.statusCode).toBe(409);
    expect(erro(can)).toMatchObject({ code: "CONFLICT", message: "Título gerado por Venda: valor, parceiro e rateio só mudam pela origem. Altere pela origem." });
    expect(await situacaoNoBanco(previsto)).toMatchObject({ status: "previsto", note: expect.stringMatching(/^Previsto /) });
  });

  it("alterar o vencimento em lote: o previsto é pulado (`situacao`); o comum é alterado", async () => {
    const comum = await titulo("receivable", `TP1-VNC-${unico()}`, "15.00");
    const r = await api("POST", "/api/financeiro/titulos/alterar-vencimento", { ids: [previsto, comum], vencimento: "2026-12-20", motivo: "Renegociado" });
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r) as { itens: unknown[] }).itens).toEqual([{ id: previsto, resultado: "pulado", motivo: "situacao" }, { id: comum, resultado: "alterado" }]);
    expect((await situacaoNoBanco(comum)).due_date).toBe("2026-12-20");
    expect((await situacaoNoBanco(previsto)).due_date).toBe(DATA);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("TP-2 — fora das listas e dos totais padrão; só aparece pedido", () => {
  const prefixo = `TP2${unico()}`;
  let previsto = ""; let aberto = "";
  beforeAll(async () => {
    const pedido = await pedidoDeVenda();
    previsto = await previstoDireto({ origemId: pedido.id, numero: `${prefixo}-PRV`, valor: "300.00" });
    aberto = await titulo("receivable", `${prefixo}-ABT`, "50.00");
  });

  it("lista antiga (`/financial/receivables`): sem o previsto nem nos totais; `status=previsto` traz só ele", async () => {
    const r = await api("GET", `/api/financial/receivables?number=${prefixo}`);
    expect(r.statusCode, r.body).toBe(200);
    const l = j(r) as { items: { id: string }[]; total: number; totals: { amount: string; balance: string } };
    expect(l.items.map((x) => x.id)).toEqual([aberto]);
    expect([l.total, l.totals.amount, l.totals.balance]).toEqual([1, "50.00", "50.00"]);
    const p = await api("GET", `/api/financial/receivables?number=${prefixo}&status=previsto`);
    expect(p.statusCode, p.body).toBe(200);
    const lp = j(p) as { items: { id: string; status: string; status_label: string }[]; totals: { amount: string } };
    expect(lp.items.map((x) => [x.id, x.status, x.status_label])).toEqual([[previsto, "previsto", "Prevista"]]);
    expect(lp.totals.amount).toBe("300.00");
    // As situações antigas também não o veem: "Vencidas" traz o comum (mesmo vencimento), nunca o previsto.
    const vencidos = await api("GET", `/api/financial/receivables?number=${prefixo}&status=overdue`);
    expect((j(vencidos) as { items: { id: string }[] }).items.map((x) => x.id)).toEqual([aberto]);
  });

  it("Central: a lista padrão e os totais sem o previsto; `situacao=previsto` e o cartão `previstos` (disponível) o mostram", async () => {
    const r = await api("GET", `/api/financeiro/titulos?direcao=receivable&busca=${prefixo}`);
    expect(r.statusCode, r.body).toBe(200);
    type Lista = { items: { id: string; situacao: string; tipo_operacao_id: string | null }[]; totais: { receivable: { valor: string } }; cartoes: Record<string, unknown> };
    const l = j(r) as Lista;
    expect(l.items.map((x) => x.id)).toEqual([aberto]);
    expect(l.totais.receivable.valor).toBe("50.00");
    expect(l.cartoes.previstos).toEqual({ quantidade: 1, valor: "300.00", disponivel: true });
    const s = j(await api("GET", `/api/financeiro/titulos?direcao=receivable&busca=${prefixo}&situacao=previsto`)) as Lista;
    expect(s.items.map((x) => [x.id, x.situacao])).toEqual([[previsto, "previsto"]]);
    const c = j(await api("GET", `/api/financeiro/titulos?direcao=receivable&busca=${prefixo}&cartao=previstos`)) as Lista;
    expect(c.items.map((x) => x.id), "o cartão filtra a lista para os previstos").toEqual([previsto]);
    // Os outros cartões não contam o previsto (premissa: o comum, sim).
    const contados = ["vencidos", "vence_hoje", "a_vencer"].reduce((n, k) => n + (l.cartoes[k] as { quantidade: number }).quantidade, 0);
    expect(contados, "só o comum de 50 (o previsto de 300 fica fora)").toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("TP-3 — o fluxo mostra a provisão SEPARADA, só com `previstos=1`", () => {
  let FA = "";
  type Periodo = Record<string, unknown> & { inicio: string; previsto: Record<string, string>; saldo_projetado: string | null; provisao?: Record<string, string>; saldo_projetado_com_previstos?: string | null };
  type Fluxo = Record<string, unknown> & { periodos: Periodo[]; previstos_incluidos: boolean; provisao_em_atraso?: Record<string, string>; grupos?: { chave: string | null; periodos: Periodo[] }[] };
  const fluxo = async (qs: string) => {
    const r = await api("GET", `/api/financeiro/fluxo?de=2035-03-01&ate=2035-03-31&contas=${FA}${qs}`);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as Fluxo;
  };
  beforeAll(async () => {
    FA = (await linha<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,$2,'[F9a] Fluxo','checking',1000) returning id::text as id", [f9.h.demo.orgId, `F9A${unico()}`.slice(0, 12)])).id;
    await titulo("receivable", `TP3-ABT-${unico()}`, "100.00", { emission_date: "2035-03-01", due_date: "2035-03-05", conta_prevista_id: FA });
    const pedido = await pedidoDeVenda();
    await previstoDireto({ origemId: pedido.id, valor: "300.00", emissao: "2035-03-01", vencimento: "2035-03-10", conta: FA });
    await previstoDireto({ origemId: pedido.id, valor: "50.00", emissao: "2035-02-01", vencimento: "2035-02-10", conta: FA });
    await previstoDireto({ origemId: pedido.id, direcao: "payable", valor: "40.00", emissao: "2035-03-01", vencimento: "2035-03-20", conta: FA });
  });

  it("previstos=0: a resposta da F8 chave por chave — o previsto não entra no `previsto`", async () => {
    const f = await fluxo("&agrupamento=mes&previstos=0");
    expect(Object.keys(f).sort()).toEqual(["agrupamento", "ate", "de", "direcoes_previstas", "modo", "periodos", "previsto_em_atraso", "previstos_incluidos", "saldo_inicial"]);
    expect(f.previstos_incluidos).toBe(false);
    expect(f.periodos).toEqual([{ inicio: "2035-03-01", fim: "2035-03-31", realizado: { entradas: "0.00", saidas: "0.00", transferencias_liquidas: "0.00", saldos_iniciais: "0.00" }, previsto: { entradas: "100.00", saidas: "0.00" }, saldo_realizado: "1000.00", saldo_projetado: "1100.00" }]);
    expect(f.previsto_em_atraso).toEqual({ entradas: "0.00", saidas: "0.00" });
    const semParametro = await fluxo("&agrupamento=mes");
    expect(semParametro, "sem o parâmetro = previstos=0").toEqual(f);
  });

  it("previstos=1: provisão por período (valor líquido, pelo vencimento), o projetado com previstos e a provisão em atraso", async () => {
    const sem = await fluxo("&agrupamento=mes&previstos=0");
    const com = await fluxo("&agrupamento=mes&previstos=1");
    expect(com.previstos_incluidos).toBe(true);
    expect(com.periodos[0]).toMatchObject({ previsto: { entradas: "100.00", saidas: "0.00" }, saldo_projetado: "1100.00", provisao: { entradas: "300.00", saidas: "40.00" }, saldo_projetado_com_previstos: "1360.00" });
    expect(com.provisao_em_atraso).toEqual({ entradas: "50.00", saidas: "0.00" });
    // Tirando as chaves novas, é o mesmo período da F8.
    expect(com.periodos.map(({ provisao: _p, saldo_projetado_com_previstos: _s, ...resto }) => resto)).toEqual(sem.periodos);
    const dia = await fluxo("&agrupamento=dia&previstos=1");
    const doDia = (d: string) => dia.periodos.find((p) => p.inicio === d)!;
    expect(doDia("2035-03-09")).toMatchObject({ saldo_projetado: "1100.00", saldo_projetado_com_previstos: "1100.00" });
    expect(doDia("2035-03-10")).toMatchObject({ provisao: { entradas: "300.00", saidas: "0.00" }, saldo_projetado_com_previstos: "1400.00" });
    expect(doDia("2035-03-20")).toMatchObject({ provisao: { entradas: "0.00", saidas: "40.00" }, saldo_projetado_com_previstos: "1360.00" });
    const porConta = await fluxo("&agrupamento=mes&agrupar_por=conta&previstos=1");
    expect(porConta.grupos!.find((g) => g.chave === FA)!.periodos[0]!.provisao).toEqual({ entradas: "300.00", saidas: "40.00" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("TP-4 — fora do DRE de competência, dos adiantamentos e dos painéis", () => {
  let natureza = ""; let centro = ""; let pessoa = "";
  beforeAll(async () => {
    const n = unico();
    natureza = (await linha<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,classification) values ($1,$2,$3,'income','analytic','unclassified') returning id::text as id", [f9.h.demo.orgId, `TP4${n}`, `Receita TP4 ${n}`])).id;
    centro = (await linha<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind) values ($1,$2,$3,'analytic') returning id::text as id", [f9.h.demo.orgId, `TP4${n}`, `Centro TP4 ${n}`])).id;
    pessoa = (await linha<{ id: string }>("insert into erp.people(organization_id,code,name,is_client) values ($1,$2,$3,true) returning id::text as id", [f9.h.demo.orgId, `TP4${n}`, `Cliente TP4 ${n}`])).id;
    await titulo("receivable", `TP4-ABT-${n}`, "100.00", { emission_date: "2036-04-05", due_date: "2036-04-25", apportionment: [{ financial_category_id: natureza, cost_center_id: centro, percentage: "100" }] });
    const pedido = await pedidoDeVenda();
    await previstoDireto({ origemId: pedido.id, valor: "300.00", emissao: "2036-04-06", vencimento: "2036-04-26", natureza, centro });
  });

  it("DRE por competência: a natureza soma só o título comum (o previsto de 300 com o mesmo rateio fica fora)", async () => {
    const prev = await linha<{ n: string }>("select count(*)::text as n from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where a.financial_category_id=$1 and t.status='previsto'", [natureza]);
    expect(prev.n, "premissa: o previsto tem rateio na natureza").toBe("1");
    const r = await api("GET", "/api/financeiro/resultado?de=2036-04-01&ate=2036-04-30&regime=competencia");
    expect(r.statusCode, r.body).toBe(200);
    const nat = (j(r) as { grupos: { naturezas: { id: string; total: string }[] }[] }).grupos.flatMap((g) => g.naturezas).find((x) => x.id === natureza);
    expect(nat?.total).toBe("100.00");
  });

  it("adiantamentos: o previsto marcado como adiantamento não entra no crédito do parceiro (o comum, sim)", async () => {
    await f9.admin.query(
      "insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, payment_type, amount, emission_date, due_date, note) values ($1,$2,$3,'receivable',$3,$4,'advance',80,$5,$5,'Adiantamento TP4')",
      [f9.h.demo.orgId, f9.I.empresa, `ADT${unico()}`, pessoa, DATA]);
    const pedido = await pedidoDeVenda();
    await previstoDireto({ origemId: pedido.id, pessoa, formaPagamento: "advance", valor: "300.00" });
    const r = await api("GET", `/api/financeiro/adiantamentos?direcao=receivable&pessoa_id=${pessoa}&so_com_saldo=0`);
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r) as { itens: { quantidade: number; adiantado: string }[] }).itens.map((x) => [x.quantidade, x.adiantado])).toEqual([[1, "0.00"]]);
  });

  it("painéis: resultado por centro e previsão do mês sem o previsto", async () => {
    const fin = await api("GET", "/api/dashboards/financial?start_date=2036-04-01&end_date=2036-04-30");
    expect(fin.statusCode, fin.body).toBe(200);
    const linhaDoCentro = (j(fin) as { by_cost_center: { cost_center: string; income: string }[] }).by_cost_center.find((x) => x.cost_center.startsWith("Centro TP4"));
    expect(linhaDoCentro?.income).toBe("100.00");
    const casa = await api("GET", "/api/dashboards/home?start_date=2036-04-01&end_date=2036-04-30");
    expect(casa.statusCode, casa.body).toBe(200);
    const mes = (j(casa) as { forecast_vs_actual: { month: string; income_forecast: string }[] }).forecast_vs_actual.find((x) => x.month === "2036-04");
    expect(mes?.income_forecast).toBe("100.00");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("TP-5 — as capacidades novas, aditivas", () => {
  it("`/financeiro/capacidades` = { centralFinanceira: 1, financeiroPelaTop: 1 }; `/auth/context` declara `lcdpr: 1` junto das de hoje", async () => {
    const r = await api("GET", "/api/financeiro/capacidades");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
    const ctx = await api("GET", "/api/auth/context");
    expect(ctx.statusCode, ctx.body).toBe(200);
    expect((j(ctx) as { capacidades: unknown }).capacidades).toEqual({ loteNaEntrada: 1, codigoAutomatico: 1, moverComFilhos: 1, consultaCnpjJanela: 1, lcdpr: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("TP-6 — o detalhe: a origem pelo nome e a TOP de origem", () => {
  it("previsto de um pedido com TOP: origem 'Pedido de venda <código>', a TOP com a versão, situação 'Prevista'", async () => {
    const top = await criarTopNo5("vendas.pedido");
    const pedido = await pedidoDeVenda({ tipoOperacaoId: top.id });
    const previsto = await previstoDireto({ origemId: pedido.id, top });
    const r = await api("GET", `/api/financial/receivables/${previsto}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ status: "previsto", status_label: "Prevista", origem_nome: `Pedido de venda ${pedido.code}`, tipo_operacao: { id: top.id, codigo: top.codigo, nome: top.nome, versao: 1 } });
  });

  it("avulso: origem 'Avulso' e sem TOP; o título do 'gera obrigação': 'Movimento bancário' (o rótulo, nunca o valor cru)", async () => {
    const avulso = await titulo("payable", `TP6-AV-${unico()}`, "12.00");
    expect(j(await api("GET", `/api/financial/payables/${avulso}`))).toMatchObject({ origem_nome: "Avulso", tipo_operacao: null });
    const mov = await api("POST", "/api/financial/bank-movements", {
      empresa_id: f9.I.empresa, bank_account_id: f9.I.bankAccount, movement_date: DATA, type: "out", category_type: "out", amount: "33.00", document: `TP6-${unico()}`,
      generates_obligation: true, person_id: f9.I.provider, apportionment: [{ financial_category_id: f9.I.category, cost_center_id: f9.I.costCenter, percentage: "100" }]
    });
    expect(mov.statusCode, mov.body).toBe(201);
    const t = await linha<{ id: string }>("select id::text as id from erp.financial_titles where source_type='bank_movements' and source_id=$1", [j(mov).id]);
    expect(j(await api("GET", `/api/financial/payables/${t.id}`))).toMatchObject({ origem_nome: "Movimento bancário", tipo_operacao: null });
  });
});
