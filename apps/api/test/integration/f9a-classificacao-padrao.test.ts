import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV4, familiaOperacionalDeDocumentoVenda, resolverTipoOperacao } from "@agro/domain";
import { f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, contar, criarTopNo4, criarTopNo5, postarTop, titulosDaOrigem, type TopCriada, type Resposta } from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — O FIM DO "1º POR CÓDIGO" SEM QUEBRAR O QUE FUNCIONA: a classificação do título pela
 * TOP no formato 5, na venda e na solicitação de compra.
 *
 * A ordem: documento → padrão da TOP → "exigir" recusa → o padrão legado de hoje (a 1ª natureza e o 1º centro por
 * código, as MESMAS consultas). Sem a TOP declarar nada, o comportamento é o de antes — contrato do skew (sentido 2).
 *   · CP-1 venda sem classificação + TOP no 5 com natureza e centro → o rateio da TOP; a trilha diz "padrão da TOP"; a
 *          prévia diz `origem: "documento"` + `padraoDaTop: true` (a web conhece dois valores);
 *   · CP-2 "exigir" sem padrão → 422 na confirmação (código e exigências) e na prévia (`podeConfirmar` false); nada
 *          gerado (premissa: a mesma venda com a classificação no documento confirma);
 *   · CP-3 TOP no 4 e TOP no 5 neutra → "padrão legado" com o par da 1ª por código, lido pela consulta de hoje;
 *   · CP-4 `documentoTroca` desligado: natureza diferente → 422; igual → confirma; forma diferente → 422;
 *   · CP-5 o tipo de título e a conta da TOP nos títulos da venda; a TOP e a versão da venda no título (também no 4);
 *   · CP-6 solicitação finalizada: sem TOP padrão → o legado de hoje; TOP padrão com natureza e centro → o título com
 *          eles e a TOP; "exigir" → 422 sem transição (premissa: com outra TOP padrão, a mesma solicitação finaliza);
 *          a conta padrão inativada depois de gravada a TOP → 422 sem transição (reativada, finaliza);
 *   · CP-7 a conta padrão inativada depois de gravada a TOP: a venda (prévia e confirmação) e o pedido que provisiona
 *          recusam, nada gravado; reativada, os dois passam e levam a conta (premissa).
 *
 * TESTEMUNHA: o superusuário lê títulos, rateios, situação e trilha no banco. FIXTURE declarada: os padrões da TOP são
 * inseridos na tabela da versão (`criarTopNo5(…, { padroes })`; a gravação pela API é do P3). As naturezas e os centros
 * do caso têm códigos `9.*` (depois de todo o seed): a 1ª por código continua sendo a do seed, conferida como premissa.
 */
beforeAll(async () => {
  await iniciarF9a();
  N1 = await cadastro("financial_categories", "9.F9CP.R01", "Receita padrão da TOP", "income");
  N2 = await cadastro("financial_categories", "9.F9CP.R02", "Receita do documento", "income");
  ND = await cadastro("financial_categories", "9.F9CP.D01", "Despesa padrão da solicitação", "expense");
  C1 = await cadastro("cost_centers", "9.F9CP.001", "Centro padrão da TOP");
  const tipos = await linhas<{ id: string }>("select id::text as id from erp.title_types where organization_id=$1 or organization_id is null order by name, id limit 1", [f9.h.demo.orgId]);
  T1 = tipos[0]!.id;
  const formas = await linhas<{ id: string }>("select id::text as id from erp.payment_methods where organization_id=$1 or organization_id is null order by name, id limit 2", [f9.h.demo.orgId]);
  expect(formas.length, "premissa: há duas formas de pagamento").toBe(2);
  [F1, F2] = [formas[0]!.id, formas[1]!.id];
  legadoReceita = await legado("income");
  legadoDespesa = await legado("expense");
  expect([N1, N2, C1], "premissa: o par do caso NÃO é o da 1ª por código").not.toContain(legadoReceita.natureza);
  expect(C1, "premissa: o centro do caso NÃO é o 1º por código").not.toBe(legadoReceita.centro);
}, 240_000);
afterAll(encerrarF9a);

const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const PEDIDO = familiaOperacionalDeDocumentoVenda("order")!;
const MSG_CONTA_INUTILIZAVEL = "A conta padrão da operação está inativa ou foi excluída: ajuste os padrões da TOP.";
/** Uma conta bancária NOVA e ativa da organização (fixture do superusuário), para ser inativada pelo caso. */
async function contaNova(): Promise<string> {
  return (await linha<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type) values ($1,$2,$3,'checking') returning id::text as id",
    [f9.h.demo.orgId, `F9CP${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase(), "Conta padrão da TOP (CP)"])).id;
}
const ativarConta = async (id: string, ativa: boolean) => {
  const r = await f9.admin.query("update erp.bank_accounts set is_active=$2 where id=$1", [id, ativa]);
  expect(r.rowCount, "premissa: a conta mudou").toBe(1);
};
const SOLICITACAO = resolverTipoOperacao("erp.purchase_requests")!.codigo;
let N1 = ""; let N2 = ""; let ND = ""; let C1 = ""; let T1 = ""; let F1 = ""; let F2 = "";
let legadoReceita: { natureza: string; centro: string }; let legadoDespesa: { natureza: string; centro: string };

async function cadastro(tabela: "financial_categories" | "cost_centers", code: string, nome: string, nature?: string): Promise<string> {
  const r = tabela === "financial_categories"
    ? await f9.admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,$4,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome, nature])
    : await f9.admin.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome]);
  return r.rows[0]!.id;
}
/** O par do padrão legado, pelas consultas de hoje (escritas aqui à mão: é o contrato que não pode mudar). */
async function legado(nature: "income" | "expense"): Promise<{ natureza: string; centro: string }> {
  const n = await linha<{ id: string }>("select id::text as id from erp.financial_categories where organization_id=$1 and nature=$2 and kind='analytic' and is_active and deleted_at is null order by code limit 1", [f9.h.demo.orgId, nature]);
  const c = await linha<{ id: string }>("select id::text as id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1", [f9.h.demo.orgId]);
  return { natureza: n.id, centro: c.id };
}

const api = (method: "GET" | "POST", url: string, payload?: unknown): Promise<Resposta> =>
  f9.ligada.inject({ method, url, headers: f9.h.headers(), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** Uma venda de 250 (1 × 250), aberta, na TOP dada, pela API. */
async function venda(top: TopCriada, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await api("POST", "/api/sales/sales", { empresa_id: f9.I.empresa, document_date: DATA, client_id: f9.I.client, tipo_operacao_id: top.id,
    items: [{ product_id: f9.I.product2, quantity: "1", unit_price: "250.00" }], ...extra });
  expect(r.statusCode, `premissa: a venda nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  expect((await situacao(id)).status, "premissa: a venda está aberta").toBe("open");
  return id;
}
const confirmar = (id: string) => api("POST", `/api/sales/sales/${id}/confirm`);
const previa = async (id: string) => {
  const r = await api("GET", `/api/sales/sales/${id}/previa-confirmacao`);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { podeConfirmar: boolean; recusas: { code: string; message: string; details?: unknown }[]; financeiro: { efeito: string | null; classificacao: Record<string, unknown> | null } };
};
const situacao = (id: string) => linha<{ status: string }>("select status from erp.sales_documents where id=$1", [id]);
const rateios = (origemTipo: string, origemId: string) => linhas<{ natureza: string; centro: string }>(
  `select distinct a.financial_category_id::text as natureza, a.cost_center_id::text as centro
     from erp.title_apportionments a join erp.financial_titles t on t.id = a.title_id where t.source_type=$1 and t.source_id=$2`, [origemTipo, origemId]);
const trilhaDaConfirmacao = async (id: string) => (await linhas<{ metadata: { classificacaoFinanceira?: { categoriaFinanceiraId: string; centroCustoId: string; origem: string } } }>(
  "select metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='confirm' order by created_at, id", [id])).map((x) => x.metadata);
const ref = (id: string) => ({ id, codigo: expect.any(String) as unknown as string, nome: expect.any(String) as unknown as string });

// ---------------------------------------------------------------------------------------------------------------
describe("CP-1 — o padrão da TOP classifica a venda sem classificação", () => {
  it("rateio da TOP; trilha \"padrão da TOP\"; prévia \"documento\" + padraoDaTop", async () => {
    const top = await criarTopNo5(VENDA, { padroes: { naturezaId: N1, centroCustoId: C1 } });
    const id = await venda(top);
    const p = await previa(id);
    expect(p.podeConfirmar, JSON.stringify(p.recusas)).toBe(true);
    expect(p.financeiro.classificacao).toEqual({ origem: "documento", padraoDaTop: true, categoria: ref(N1), centro: ref(C1) });

    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(await rateios("sales_documents", id)).toEqual([{ natureza: N1, centro: C1 }]);
    expect((await trilhaDaConfirmacao(id)).map((m) => m.classificacaoFinanceira)).toEqual([{ categoriaFinanceiraId: N1, centroCustoId: C1, origem: "padrão da TOP" }]);
  });
});

describe("CP-2 — \"exigir\" sem padrão recusa", () => {
  it("422 na confirmação e na prévia, nada gerado; com a classificação no documento, confirma (premissa)", async () => {
    const top = await criarTopNo5(VENDA, { secao: { semClassificacao: "exigir" } });
    const id = await venda(top);
    const mensagem = "A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.";
    const esperado = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: mensagem, details: { exigencias: [{ caminho: "financeiroPadrao.semClassificacao", mensagem }] } };
    const p = await previa(id);
    expect(p.podeConfirmar).toBe(false);
    expect(p.recusas).toEqual([esperado]);
    expect(p.financeiro).toMatchObject({ efeito: "receber", classificacao: null });

    const titulosAntes = await contar("financial_titles");
    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(esperado);
    expect(await situacao(id)).toEqual({ status: "open" });
    expect(await titulosDaOrigem("sales_documents", id)).toEqual([]);
    expect(await contar("financial_titles")).toBe(titulosAntes);
    expect(await trilhaDaConfirmacao(id)).toEqual([]);

    const comClassificacao = await venda(top, { categoria_financeira_id: N2, centro_custo_id: C1 });
    const ok = await confirmar(comClassificacao);
    expect(ok.statusCode, `premissa: com natureza e centro no documento a mesma TOP confirma — ${ok.body}`).toBe(200);
    expect(await rateios("sales_documents", comClassificacao)).toEqual([{ natureza: N2, centro: C1 }]);
  });
});

describe("CP-3 — sem a TOP declarar, o padrão legado de hoje", () => {
  it("TOP no 4 e TOP no 5 neutra: o par da 1ª por código; trilha e prévia \"padrão legado\"", async () => {
    for (const [rotulo, top] of [["formato 4", await criarTopNo4(VENDA)], ["formato 5 neutro", await criarTopNo5(VENDA)]] as const) {
      const id = await venda(top);
      const p = await previa(id);
      expect(p.financeiro.classificacao, rotulo).toEqual({ origem: "padrão legado", categoria: ref(legadoReceita.natureza), centro: ref(legadoReceita.centro) });
      const r = await confirmar(id);
      expect(r.statusCode, `${rotulo}: ${r.body}`).toBe(200);
      expect(await rateios("sales_documents", id), rotulo).toEqual([{ natureza: legadoReceita.natureza, centro: legadoReceita.centro }]);
      expect((await trilhaDaConfirmacao(id)).map((m) => m.classificacaoFinanceira), rotulo)
        .toEqual([{ categoriaFinanceiraId: legadoReceita.natureza, centroCustoId: legadoReceita.centro, origem: "padrão legado" }]);
    }
  });
});

describe("CP-4 — o documento não troca os padrões", () => {
  it("natureza diferente → 422; igual → confirma; forma diferente → 422", async () => {
    const top = await criarTopNo5(VENDA, { secao: { documentoTroca: false }, padroes: { naturezaId: N1, centroCustoId: C1, formaPagamentoId: F1 } });
    const recusa = (campo: string) => {
      const mensagem = `Esta operação não deixa trocar ${campo}: use o padrão da TOP.`;
      return { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: mensagem, details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem }] } };
    };

    const outra = await venda(top, { categoria_financeira_id: N2, centro_custo_id: C1, payment_method_id: F1 });
    expect((await previa(outra)).recusas).toEqual([recusa("a natureza")]);
    const r1 = await confirmar(outra);
    expect(r1.statusCode, r1.body).toBe(422);
    expect(erro(r1)).toEqual(recusa("a natureza"));
    expect([await situacao(outra), await titulosDaOrigem("sales_documents", outra)]).toEqual([{ status: "open" }, []]);

    const igual = await venda(top, { categoria_financeira_id: N1, centro_custo_id: C1, payment_method_id: F1 });
    const r2 = await confirmar(igual);
    expect(r2.statusCode, `o mesmo par e a mesma forma da TOP confirmam — ${r2.body}`).toBe(200);
    expect(await rateios("sales_documents", igual)).toEqual([{ natureza: N1, centro: C1 }]);

    const forma = await venda(top, { payment_method_id: F2 });
    const r3 = await confirmar(forma);
    expect(r3.statusCode, r3.body).toBe(422);
    expect(erro(r3)).toEqual(recusa("a forma de pagamento"));
    expect([await situacao(forma), await titulosDaOrigem("sales_documents", forma)]).toEqual([{ status: "open" }, []]);
  });
});

describe("CP-5 — o tipo de título, a conta e a TOP no título da venda", () => {
  it("TOP no 5 com tipo e conta → nos títulos; TOP no 4 → a TOP e a versão no título, sem tipo nem conta", async () => {
    const top5 = await criarTopNo5(VENDA, { padroes: { naturezaId: N1, centroCustoId: C1, tipoTituloId: T1, contaBancariaId: f9.I.bankAccount } });
    const v5 = await venda(top5);
    expect((await confirmar(v5)).statusCode).toBe(200);
    const t5 = await titulosDaOrigem("sales_documents", v5);
    expect(t5.length, "premissa: a venda gerou título").toBeGreaterThan(0);
    for (const t of t5) expect(t).toMatchObject({ status: "open", title_type_id: T1, conta_prevista_id: f9.I.bankAccount, tipo_operacao_id: top5.id, tipo_operacao_versao_id: top5.versaoId });

    const top4 = await criarTopNo4(VENDA);
    const v4 = await venda(top4);
    expect((await confirmar(v4)).statusCode).toBe(200);
    const t4 = await titulosDaOrigem("sales_documents", v4);
    expect(t4.length, "premissa: a venda gerou título").toBeGreaterThan(0);
    for (const t of t4) expect(t).toMatchObject({ status: "open", title_type_id: null, conta_prevista_id: null, tipo_operacao_id: top4.id, tipo_operacao_versao_id: top4.versaoId });
  });
});

describe("CP-6 — a solicitação de compra pela TOP padrão da família", () => {
  /** Uma solicitação de SERVIÇO de 120, levada até "Compra recebida" (a etapa antes de finalizar). */
  async function solicitacaoRecebida(): Promise<string> {
    const r = await f9.h.app.inject({ method: "POST", url: "/api/supply/requests", headers: f9.h.headers(), payload: {
      empresa_id: f9.I.empresa, request_date: DATA, request_type: "service", description: "Serviço F9a", justification: "Teste da TOP padrão",
      items: [{ description: "Mão de obra", quantity: "1", amount: "120.00" }] } });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    for (const acao of ["send_to_approval", "approve", "mark_purchased", "mark_received"]) {
      const a = await acaoDa(id, acao);
      expect(a.statusCode, `premissa: ${acao} — ${a.body}`).toBe(200);
    }
    expect((await estado(id)).status, "premissa: a solicitação foi recebida").toBe("purchase_received");
    return id;
  }
  const acaoDa = (id: string, acao: string) => f9.h.app.inject({ method: "POST", url: `/api/supply/requests/${id}/actions/${acao}`, headers: f9.h.headers(), payload: { justification: "ok" } });
  const estado = (id: string) => linha<{ status: string }>("select status from erp.purchase_requests where id=$1", [id]);

  it("sem TOP padrão → o legado de hoje; TOP padrão com natureza e centro → o título com eles e a TOP; \"exigir\" → 422 sem transição", async () => {
    // (a) SEM TOP PADRÃO: o código de hoje — a 1ª natureza de despesa e o 1º centro por código, sem TOP no título.
    const semTop = await solicitacaoRecebida();
    expect((await acaoDa(semTop, "finish")).statusCode).toBe(200);
    expect(await rateios("purchase_requests", semTop)).toEqual([{ natureza: legadoDespesa.natureza, centro: legadoDespesa.centro }]);
    expect((await titulosDaOrigem("purchase_requests", semTop)).map((t) => [t.status, t.amount, t.tipo_operacao_id, t.title_type_id, t.conta_prevista_id]))
      .toEqual([["open", "120.00", null, null, null]]);

    // (b) TOP PADRÃO no 5 com natureza, centro, tipo de título e conta.
    const comPadroes = await criarTopNo5(SOLICITACAO, { padrao: true, padroes: { naturezaId: ND, centroCustoId: C1, tipoTituloId: T1, contaBancariaId: f9.I.bankAccount } });
    const pelaTop = await solicitacaoRecebida();
    expect((await acaoDa(pelaTop, "finish")).statusCode).toBe(200);
    expect(await rateios("purchase_requests", pelaTop)).toEqual([{ natureza: ND, centro: C1 }]);
    expect((await titulosDaOrigem("purchase_requests", pelaTop)).map((t) => [t.status, t.amount, t.tipo_operacao_id, t.tipo_operacao_versao_id, t.title_type_id, t.conta_prevista_id]))
      .toEqual([["open", "120.00", comPadroes.id, comPadroes.versaoId, T1, f9.I.bankAccount]]);

    // (c) TOP PADRÃO no 5 com "exigir" e sem padrões (assume o posto de padrão): 422, sem título e sem transição.
    await criarTopNo5(SOLICITACAO, { padrao: true, secao: { semClassificacao: "exigir" } });
    const exigida = await solicitacaoRecebida();
    const titulosAntes = await contar("financial_titles");
    const r = await acaoDa(exigida, "finish");
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toMatchObject({ code: "VALIDATION_ERROR", message: "A operação padrão da solicitação exige natureza e centro de resultado: configure os padrões da TOP." });
    expect(await estado(exigida)).toEqual({ status: "purchase_received" });
    expect(await titulosDaOrigem("purchase_requests", exigida)).toEqual([]);
    expect(await contar("financial_titles")).toBe(titulosAntes);
    // PREMISSA: a recusa é da TOP — com uma TOP padrão no 4 (sem a seção), a MESMA solicitação finaliza pelo legado.
    await criarTopNo4Padrao();
    expect((await acaoDa(exigida, "finish")).statusCode).toBe(200);
    expect(await estado(exigida)).toEqual({ status: "finished" });
    expect(await rateios("purchase_requests", exigida)).toEqual([{ natureza: legadoDespesa.natureza, centro: legadoDespesa.centro }]);
  });

  it("a conta padrão da TOP inativada depois de gravada → 422 sem título e sem transição; reativada, finaliza com ela", async () => {
    const conta = await contaNova();
    await criarTopNo5(SOLICITACAO, { padrao: true, padroes: { naturezaId: ND, centroCustoId: C1, contaBancariaId: conta } });
    const id = await solicitacaoRecebida();
    await ativarConta(conta, false);
    const titulosAntes = await contar("financial_titles");
    const r = await acaoDa(id, "finish");
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_CONTA_INUTILIZAVEL });
    expect(await estado(id)).toEqual({ status: "purchase_received" });
    expect(await titulosDaOrigem("purchase_requests", id)).toEqual([]);
    expect(await contar("financial_titles")).toBe(titulosAntes);
    // PREMISSA: a recusa é da conta — reativada, a MESMA solicitação finaliza e o título leva a conta.
    await ativarConta(conta, true);
    expect((await acaoDa(id, "finish")).statusCode).toBe(200);
    expect((await titulosDaOrigem("purchase_requests", id)).map((t) => [t.status, t.conta_prevista_id])).toEqual([["open", conta]]);
  });

  /** Uma TOP padrão da solicitação no formato 4 (sem a seção do 5) — assume o posto de padrão da anterior. */
  async function criarTopNo4Padrao(): Promise<void> {
    const r = await postarTop(SOLICITACAO, { configuracao: configuracaoNeutraTopV4(), padrao: true });
    expect(r.statusCode, `premissa: a TOP no 4 nasce padrão — ${r.body}`).toBe(201);
    const padroes = await linhas<{ id: string }>("select id::text as id from erp.tipos_operacao where organization_id=$1 and codigo_base=$2 and padrao and ativo and excluido_em is null", [f9.h.demo.orgId, SOLICITACAO]);
    expect(padroes.map((x) => x.id), "premissa: ela é a ÚNICA padrão da família").toEqual([j(r).id as string]);
  }
});

describe("CP-7 — a conta padrão inativada depois de gravada a TOP", () => {
  const esperado = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG_CONTA_INUTILIZAVEL, details: { exigencias: [{ caminho: "padroesFinanceiros.contaBancariaId", mensagem: MSG_CONTA_INUTILIZAVEL }] } };

  it("venda: 422 na prévia e na confirmação, nada gerado; reativada, confirma e o título leva a conta", async () => {
    const conta = await contaNova();
    const top = await criarTopNo5(VENDA, { padroes: { naturezaId: N1, centroCustoId: C1, contaBancariaId: conta } });
    const id = await venda(top);
    expect((await previa(id)).podeConfirmar, "premissa: com a conta ativa a venda confirmaria").toBe(true);
    await ativarConta(conta, false);
    const p = await previa(id);
    expect([p.podeConfirmar, p.recusas]).toEqual([false, [esperado]]);
    const titulosAntes = await contar("financial_titles");
    const r = await confirmar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(esperado);
    expect([await situacao(id), await titulosDaOrigem("sales_documents", id), await contar("financial_titles")]).toEqual([{ status: "open" }, [], titulosAntes]);
    await ativarConta(conta, true);
    const ok = await confirmar(id);
    expect(ok.statusCode, ok.body).toBe(200);
    const titulos = await titulosDaOrigem("sales_documents", id);
    expect(titulos.length, "premissa: a venda gerou título").toBeGreaterThan(0);
    for (const t of titulos) expect([t.status, t.conta_prevista_id]).toEqual(["open", conta]);
  });

  it("pedido que provisiona: salvar → 422, nem pedido nem previsto; reativada, salva e o previsto leva a conta", async () => {
    const conta = await contaNova();
    const top = await criarTopNo5(PEDIDO, { secao: { provisao: true }, padroes: { naturezaId: N1, centroCustoId: C1, contaBancariaId: conta } });
    await ativarConta(conta, false);
    const corpo = { empresa_id: f9.I.empresa, document_date: DATA, client_id: f9.I.client, tipo_operacao_id: top.id,
      items: [{ product_id: f9.I.product2, warehouse_id: f9.I.warehouse, quantity: "1", unit_price: "300.00" }] };
    const pedidos = async () => (await linha<{ n: string }>("select count(*)::text as n from erp.sales_documents where organization_id=$1 and kind='order'", [f9.h.demo.orgId])).n;
    const antes = [await pedidos(), await contar("financial_titles")];
    const r = await api("POST", "/api/sales/orders", corpo);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(esperado);
    expect([await pedidos(), await contar("financial_titles")]).toEqual(antes);
    await ativarConta(conta, true);
    const ok = await api("POST", "/api/sales/orders", corpo);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await titulosDaOrigem("sales_documents", j(ok).id as string)).map((t) => [t.status, t.amount, t.conta_prevista_id])).toEqual([["previsto", "300.00", conta]]);
  });
});
