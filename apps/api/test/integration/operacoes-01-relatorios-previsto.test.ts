import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import { familiaOperacionalDeDocumentoVenda } from "@agro/domain";
import {
  f9, iniciarF9a, encerrarF9a, j, DATA, linha, linhas, cfg5, postarTop, versaoCorrente, padroesNaVersao, titulosDaOrigem, criarTopNo5,
  unico, type TopCriada, type Resposta
} from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286, risco (j)) — OS RELATÓRIOS FINANCEIROS NÃO SOMAM O TÍTULO PREVISTO.
 *
 * A F9a trocou os filtros dos relatórios que somam títulos (`apps/api/src/routes/reports.ts`) para
 * `t.status not in ('cancelled','previsto')`: o previsto é a PROVISÃO de um pedido (caixa prometido, não devido) e não
 * entra em fluxo, consolidado nem custo. Este arquivo é o teste próprio dessas trocas, pelo CAMINHO REAL:
 *   · o PREVISTO nasce da provisão do pedido de venda (TOP de pedido no formato 5 com `financeiroPadrao.provisao`, e os
 *     padrões da versão — natureza e centro — inseridos pelo superusuário, a mesma fixture declarada de `f9a-ajuda`);
 *   · o título ABERTO comum nasce pela API do contas a receber;
 *   · os dois na MESMA natureza e no MESMO centro (cadastros próprios deste arquivo) e no MESMO vencimento (um mês que só
 *     eles ocupam, 07/2031): o recorte de cada relatório só enxerga os dois.
 * PREMISSA (testemunha, sem RLS): no recorte, os dois títulos vivos — o previsto de 300 e o aberto de 100 — somam 400.
 * CONCLUSÃO: cada relatório soma 100 (o aberto) e nunca 400 — fluxo de recebimento, consolidado pagar/receber, centro de
 * resultado (títulos) e custo de produção por centro.
 */
beforeAll(async () => {
  await iniciarF9a();
  natureza = await cadastro("financial_categories", `9.RPV.${unico()}`.slice(0, 20), `Receita RPV ${unico()}`, "income");
  centro = await cadastro("cost_centers", `9.RPV.${unico()}`.slice(0, 20), `Centro RPV ${unico()}`);
  nomeNatureza = (await linha<{ name: string }>("select name from erp.financial_categories where id=$1", [natureza])).name;
  centroLido = await linha<{ code: string; name: string }>("select code, name from erp.cost_centers where id=$1", [centro]);
  topVenda = await criarTopNo5(VENDA);
  topProv = await topDoPedido();
}, 240_000);
afterAll(encerrarF9a);

const PEDIDO = familiaOperacionalDeDocumentoVenda("order")!;
const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const VENCIMENTO = "2031-07-15";
const JANELA = { start_date: "2031-07-01", end_date: "2031-07-31" };

let natureza = ""; let centro = ""; let nomeNatureza = "";
let centroLido: { code: string; name: string };
let topVenda: TopCriada; let topProv: TopCriada;

/** Natureza (receita, analítica) ou centro (analítico) PRÓPRIOS deste arquivo, pelo superusuário (o molde de f9a-provisao-venda). */
async function cadastro(tabela: "financial_categories" | "cost_centers", code: string, nome: string, nature?: string): Promise<string> {
  const r = tabela === "financial_categories"
    ? await f9.admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,$4,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome, nature])
    : await f9.admin.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome]);
  return r.rows[0]!.id;
}

/** A TOP de PEDIDO no formato 5 com a provisão LIGADA e a natureza e o centro deste arquivo nos padrões da versão. */
async function topDoPedido(): Promise<TopCriada> {
  const r = await postarTop(PEDIDO, { configuracao: cfg5({ provisao: true }), destinos: [{ tipoOperacaoId: topVenda.id, ordem: 0, emPartes: true }] });
  expect(r.statusCode, `premissa: a TOP de pedido nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const v = await versaoCorrente(id);
  await padroesNaVersao(id, v.id, { naturezaId: natureza, centroCustoId: centro });
  return { id, versaoId: v.id, codigo: v.codigo, nome: v.nome };
}

const api = (method: "GET" | "POST", url: string, payload?: unknown): Promise<Resposta> =>
  f9.ligada.inject({ method, url, headers: f9.h.headers(), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

type Relatorio = { rows: Record<string, unknown>[]; totals: Record<string, string> };
async function relatorio(chave: string, filtros: Record<string, string>): Promise<Relatorio> {
  const r = await api("GET", `/api/reports/${chave}?${new URLSearchParams(filtros).toString()}`);
  expect(r.statusCode, `${chave}: ${r.body}`).toBe(200);
  return r.json() as Relatorio;
}
const dinheiro = (v: unknown) => D(String(v ?? "0")).toFixed(2);

let previsto = ""; let aberto = "";
/** A emissão do previsto é a da PROVISÃO (o dia em que o pedido foi salvo), não a data do pedido: o aberto nasce nela. */
let emissao = "";

describe("RP — os relatórios financeiros somam o título aberto e NÃO somam o previsto", () => {
  beforeAll(async () => {
    // O PREVISTO, pelo caminho real: o pedido de venda de 300 (3 × 100) numa parcela, na TOP que provisiona.
    const p = await api("POST", "/api/sales/orders", {
      empresa_id: f9.I.empresa, document_date: DATA, client_id: f9.I.client, tipo_operacao_id: topProv.id,
      installment_plan: { installments: 1, first_due_date: VENCIMENTO, mode: "interval", interval_days: 30 },
      items: [{ product_id: f9.I.product2, quantity: "3", unit_price: "100.00" }]
    });
    expect(p.statusCode, `premissa: o pedido nasce — ${p.body}`).toBe(201);
    const daOrigem = await titulosDaOrigem("sales_documents", j(p).id as string);
    expect(daOrigem.map((t) => [t.status, t.amount, t.due_date]), "premissa: a provisão gravou UM previsto de 300 no vencimento do plano").toEqual([["previsto", "300.00", VENCIMENTO]]);
    previsto = daOrigem[0]!.id;
    emissao = (await linha<{ e: string }>("select emission_date::text as e from erp.financial_titles where id=$1", [previsto])).e;
    // O ABERTO comum, pela API do contas a receber: 100, mesma natureza, mesmo centro, mesmo vencimento.
    const r = await api("POST", "/api/financial/receivables", {
      empresa_id: f9.I.empresa, number: `RPV-${unico()}`, person_id: f9.I.client, amount: "100.00", emission_date: emissao, due_date: VENCIMENTO, note: "Aberto RPV",
      apportionment: [{ financial_category_id: natureza, cost_center_id: centro, percentage: "100" }]
    });
    expect(r.statusCode, r.body).toBe(201);
    aberto = j(r).id as string;
  }, 120_000);

  it("PREMISSA: no recorte (natureza, centro, vencimento 07/2031, a MESMA emissão) só os dois títulos — o previsto de 300 e o aberto de 100, 400 juntos", async () => {
    const rateios = await linhas<{ id: string; status: string; emission_date: string; due_date: string; amount: string; financial_category_id: string; cost_center_id: string }>(
      `select t.id::text as id, t.status, t.emission_date::text as emission_date, t.due_date::text as due_date, a.amount::text as amount,
              a.financial_category_id::text as financial_category_id, a.cost_center_id::text as cost_center_id
         from erp.financial_titles t join erp.title_apportionments a on a.title_id = t.id
        where t.organization_id = $1 and t.deleted_at is null and t.status <> 'cancelled' and (a.financial_category_id = $2 or a.cost_center_id = $3)
        order by a.amount`, [f9.h.demo.orgId, natureza, centro]);
    expect(rateios.map((x) => [x.id, x.status, x.emission_date, x.due_date, x.amount, x.financial_category_id, x.cost_center_id]), "os dois, cada um com o rateio inteiro na natureza e no centro")
      .toEqual([[aberto, "open", emissao, VENCIMENTO, "100.00", natureza, centro], [previsto, "previsto", emissao, VENCIMENTO, "300.00", natureza, centro]]);
    const noMes = await linha<{ n: string; soma: string }>(
      "select count(*)::text as n, coalesce(sum(amount),0)::text as soma from erp.financial_titles where organization_id=$1 and deleted_at is null and status <> 'cancelled' and due_date between $2 and $3",
      [f9.h.demo.orgId, JANELA.start_date, JANELA.end_date]);
    expect([noMes.n, dinheiro(noMes.soma)], "o mês de vencimento só tem os dois (sem a exclusão do previsto, 400)").toEqual(["2", "400.00"]);
  });

  it("Fluxo Mensal de Recebimento (`receipt_cashflow`): a natureza do recorte prevê 100, não 400", async () => {
    const r = await relatorio("receipt_cashflow", JANELA);
    const daNatureza = r.rows.filter((x) => x["category"] === nomeNatureza);
    expect(daNatureza.map((x) => [x["month"], dinheiro(x["forecast"])])).toEqual([["2031-07", "100.00"]]);
  });

  it("Consolidado Pagar/Receber (`payable_receivable`): o mês tem 100 a receber em aberto, não 400", async () => {
    const r = await relatorio("payable_receivable", JANELA);
    expect(r.rows.map((x) => [x["month"], dinheiro(x["receivable_open"]), dinheiro(x["payable_open"])])).toEqual([["2031-07", "100.00", "0.00"]]);
    expect(dinheiro(r.totals["receivable_open"]), "e o total também").toBe("100.00");
  });

  it("Centro de Resultado — títulos (`cost_center`): o centro do recorte tem 100 de receita, não 400", async () => {
    // Este relatório recorta pela EMISSÃO: o dia da provisão, que os dois títulos têm (premissa acima).
    const r = await relatorio("cost_center", { cost_center_id: centro, start_date: emissao, end_date: emissao });
    expect(r.rows.map((x) => [x["cost_center"], x["category"], x["direction"], dinheiro(x["amount"])])).toEqual([[centroLido.name, nomeNatureza, "receivable", "100.00"]]);
  });

  it("Custo de Produção por centro (`income_statement`): a receita do centro no mês é 100, não 400", async () => {
    const r = await relatorio("income_statement", JANELA);
    const doCentro = r.rows.filter((x) => x["cost_center"] === `${centroLido.code} - ${centroLido.name}`);
    expect(doCentro.map((x) => [dinheiro(x["income"]), dinheiro(x["expense"])])).toEqual([["100.00", "0.00"]]);
  });
});
