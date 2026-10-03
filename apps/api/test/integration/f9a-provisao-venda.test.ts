import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import { configuracaoNeutraTopV4, familiaOperacionalDeDocumentoVenda, type SecaoFinanceiroPadrao } from "@agro/domain";
import {
  f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, contar, cfg5, postarTop, versaoCorrente, padroesNaVersao, titulosDaOrigem, criarTopNo5,
  type PadroesDaTop, type TopCriada, type Resposta
} from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — A PROVISÃO DO PEDIDO DE VENDA PELA TOP (`lib/financeiro-provisao.ts`).
 *
 * O pedido cuja versão congelada da TOP está no formato 5 com `financeiroPadrao.provisao` ligada promete o caixa ao ser
 * salvo: títulos a receber PREVISTOS (situação `previsto`, 0045). A sincronização é idempotente e roda a cada evento que
 * muda o que o pedido ainda promete:
 *   · PV-1 salvar o pedido de 1000 em 2 parcelas → 2 previstos de 500 nos vencimentos do plano, com a origem no pedido, a
 *          TOP e a versão, o tipo de título e a conta da TOP (premissa: o MESMO pedido numa TOP no formato 4 → nenhum);
 *   · PV-2 converter em partes 400 e confirmar a venda → os títulos de verdade de 400 (origem a venda) e previstos de 600;
 *          os de 1000 saem CANCELADOS com "Faturado na venda …" e quem cancelou — nenhuma linha apagada;
 *   · PV-3 cancelar a venda → o previsto volta a 1000 ("Venda … cancelada");
 *   · PV-4 encerrar o saldo com uma parte aberta de 400 → previsto de 400; confirmar a parte → nenhum previsto vivo;
 *   · PV-5 cancelar o pedido sem partes → todos cancelados com "Pedido cancelado: <motivo>";
 *   · PV-6 PUT e PATCH que mudam o total → recriados; PATCH que não muda o que o pedido promete → os MESMOS ids;
 *   · PV-7 trocar a TOP do pedido por uma que não provisiona → cancelados ("A operação do pedido não provisiona mais");
 *   · PV-8 provisão + "exigir" + pedido e TOP sem natureza e centro → 422 no salvar, nada gravado (premissa: com a
 *          classificação no pedido, salva e provisiona com ela);
 *   · PV-9 o previsto não recebe baixa (409); premissa: o título de verdade da venda recebe.
 *
 * TESTEMUNHA: o superusuário (`f9.admin`) lê os títulos, os rateios e a trilha no banco. "Nada apagado" é a contagem
 * de linhas antes e depois (só cresce). FIXTURE declarada: os padrões da TOP são inseridos na tabela da versão
 * (`padroesNaVersao`) — a gravação pela API da TOP é provada no P3. Os itens vão sem local de estoque (a venda não
 * baixa estoque): o assunto aqui é o financeiro.
 */
beforeAll(async () => {
  await iniciarF9a();
  tipoTitulo = (await linha<{ id: string }>("select id::text as id from erp.title_types where organization_id=$1 or organization_id is null order by name, id limit 1", [f9.h.demo.orgId])).id;
  usuario = (await linha<{ id: string }>("select id::text as id from erp.users where email=$1", [f9.h.demo.adminEmail])).id;
  natureza = await cadastro("financial_categories", "9.F9PV.001", "Receita prevista PV", "income");
  centro = await cadastro("cost_centers", "9.F9PV.001", "Centro previsto PV");
  topVenda = await criarTopNo5(VENDA);
  topProv = await topDoPedido({ secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centro, tipoTituloId: tipoTitulo, contaBancariaId: f9.I.bankAccount } });
}, 240_000);
afterAll(encerrarF9a);

const PEDIDO = familiaOperacionalDeDocumentoVenda("order")!;
const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const PLANO = { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30 };
const VENCIMENTOS = ["2026-10-10", "2026-11-09"];

let tipoTitulo = ""; let usuario = ""; let natureza = ""; let centro = "";
let topVenda: TopCriada; let topProv: TopCriada;

/** Cadastro de natureza (receita, analítica) ou centro (analítico), montado pelo superusuário, fora do topo da ordem. */
async function cadastro(tabela: "financial_categories" | "cost_centers", code: string, nome: string, nature?: string): Promise<string> {
  const r = tabela === "financial_categories"
    ? await f9.admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,$4,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome, nature])
    : await f9.admin.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome]);
  return r.rows[0]!.id;
}

/** Uma TOP de PEDIDO (pela API) no formato 5 com a seção dada — ou no 4 —, com o destino "Em partes" para a venda. */
async function topDoPedido(o: { secao?: Partial<SecaoFinanceiroPadrao>; padroes?: PadroesDaTop; formato4?: boolean } = {}): Promise<TopCriada> {
  const r = await postarTop(PEDIDO, { configuracao: o.formato4 ? configuracaoNeutraTopV4() : cfg5(o.secao), destinos: [{ tipoOperacaoId: topVenda.id, ordem: 0, emPartes: true }] });
  expect(r.statusCode, `premissa: a TOP de pedido nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const v = await versaoCorrente(id);
  const formato = await linha<{ f: number }>("select configuracao_schema_version as f from erp.tipos_operacao_versoes where id=$1", [v.id]);
  expect(formato.f, "premissa: o formato gravado é o pedido").toBe(o.formato4 ? 4 : 5);
  if (o.padroes) await padroesNaVersao(id, v.id, o.padroes);
  return { id, versaoId: v.id, codigo: v.codigo, nome: v.nome };
}

const api = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown): Promise<Resposta> =>
  f9.ligada.inject({ method, url, headers: f9.h.headers(), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** O corpo do pedido; `top` nulo = sem `tipo_operacao_id` (o PUT que preserva a TOP gravada). */
const corpoDoPedido = (top: TopCriada | null, extra: Record<string, unknown> = {}) => ({
  empresa_id: f9.I.empresa, document_date: DATA, client_id: f9.I.client, ...(top ? { tipo_operacao_id: top.id } : {}), installment_plan: PLANO,
  items: [{ product_id: f9.I.product2, quantity: "10", unit_price: "100.00" }], ...extra
});
interface Pedido { id: string; code: string; itemId: string }
/** Um pedido de venda de 1000 (10 × 100) em 2 parcelas, pela API, na TOP dada. */
async function pedido(top: TopCriada, extra: Record<string, unknown> = {}): Promise<Pedido> {
  const r = await api("POST", "/api/sales/orders", corpoDoPedido(top, extra));
  expect(r.statusCode, `premissa: o pedido nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  return { id, code: await codigo(id), itemId: (await linha<{ id: string }>("select id::text as id from erp.sales_document_items where document_id=$1 order by position limit 1", [id])).id };
}
const codigo = async (id: string) => (await linha<{ code: string }>("select code from erp.sales_documents where id=$1", [id])).code;

/** Converte `quantidade` do item do pedido numa venda (parte), pela aresta "Em partes". */
async function parte(p: Pedido, quantidade: string): Promise<{ id: string; code: string }> {
  const r = await api("POST", `/api/sales/orders/${p.id}/convert`, { tipo_operacao_id: topVenda.id, itens: [{ item_id: p.itemId, quantidade }] });
  expect(r.statusCode, `premissa: a parte nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  return { id, code: await codigo(id) };
}
async function confirmar(vendaId: string): Promise<void> {
  const r = await api("POST", `/api/sales/sales/${vendaId}/confirm`);
  expect(r.statusCode, `premissa: a venda confirma — ${r.body}`).toBe(200);
}

/** Os títulos da origem, divididos: os previstos VIVOS e os demais. */
async function daOrigem(id: string) {
  const todos = await titulosDaOrigem("sales_documents", id);
  return { todos, vivos: todos.filter((t) => t.status === "previsto"), cancelados: todos.filter((t) => t.status === "cancelled") };
}
const parcelas = (ts: readonly { amount: string; due_date: string }[]) => ts.map((t) => [t.amount, t.due_date]);
const rateioDe = (tituloId: string) => linhas<{ natureza: string; centro: string; amount: string }>(
  "select financial_category_id::text as natureza, cost_center_id::text as centro, amount::text as amount from erp.title_apportionments where title_id=$1", [tituloId]);
const trilha = (id: string) => linhas<{ metadata: { motivo: string; alvo: string; cancelados: string[]; criados: string[] } }>(
  "select metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='provisao' order by created_at, id", [id]);

// ---------------------------------------------------------------------------------------------------------------
describe("PV-1 — salvar o pedido provisiona", () => {
  it("2 previstos de 500 nos vencimentos do plano, com origem, TOP, versão, tipo de título, conta e o rateio da TOP; no formato 4, nenhum", async () => {
    const top4 = await topDoPedido({ formato4: true });
    const p4 = await pedido(top4);
    expect((await daOrigem(p4.id)).todos, "premissa: o MESMO pedido numa TOP no formato 4 não provisiona").toEqual([]);
    expect(await trilha(p4.id), "premissa: e não deixa trilha de provisão").toEqual([]);

    const p = await pedido(topProv);
    const { todos, vivos } = await daOrigem(p.id);
    expect(todos.length).toBe(2);
    expect(parcelas(vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    for (const t of vivos) {
      expect(t).toMatchObject({ tipo_operacao_id: topProv.id, tipo_operacao_versao_id: topProv.versaoId, title_type_id: tipoTitulo, conta_prevista_id: f9.I.bankAccount, cancel_reason: null });
      expect(await rateioDe(t.id)).toEqual([{ natureza, centro, amount: "500.00" }]);
    }
    const cab = await linhas<{ number: string; direction: string; person_id: string; empresa_id: string; paid_amount: string; emission_date: string }>(
      "select number, direction, person_id::text as person_id, empresa_id::text as empresa_id, paid_amount::text as paid_amount, emission_date::text as emission_date from erp.financial_titles where source_id=$1 order by number", [p.id]);
    expect(cab).toEqual([1, 2].map((n) => ({ number: `PED-${p.code}-${n}`, direction: "receivable", person_id: f9.I.client, empresa_id: f9.I.empresa, paid_amount: "0.00", emission_date: new Date().toISOString().slice(0, 10) })));
    const t = await trilha(p.id);
    expect(t.length, "uma trilha de provisão: a do salvar").toBe(1);
    expect(t[0]!.metadata).toMatchObject({ motivo: "Pedido alterado", alvo: "1000.00", cancelados: [] });
    expect([...t[0]!.metadata.criados].sort()).toEqual(vivos.map((x) => x.id).sort());
  });
});

describe("PV-2 e PV-3 — a venda dá lugar ao previsto, e cancelada o devolve", () => {
  it("PV-2 converter 400 não muda; confirmar → títulos de verdade de 400 e previstos de 600; os de 1000 cancelados com trilha, nenhum apagado", async () => {
    const p = await pedido(topProv);
    const antes = await daOrigem(p.id);
    expect(parcelas(antes.vivos), "premissa: o pedido prevê 1000").toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    const v = await parte(p, "4");
    expect((await daOrigem(p.id)).vivos.map((t) => t.id), "a parte ABERTA não fatura: os mesmos previstos").toEqual(antes.vivos.map((t) => t.id));
    const linhasAntes = await contar("financial_titles");

    await confirmar(v.id);
    const depois = await daOrigem(p.id);
    const reais = await titulosDaOrigem("sales_documents", v.id);
    expect(reais.length, "premissa: a venda gerou os títulos de verdade").toBeGreaterThan(0);
    expect(reais.every((t) => t.status === "open")).toBe(true);
    expect(reais.reduce((s, t) => s.plus(t.amount), D(0)).toFixed(2)).toBe("400.00");
    expect(parcelas(depois.vivos)).toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);
    expect(depois.cancelados.map((t) => t.id).sort()).toEqual(antes.vivos.map((t) => t.id).sort());
    for (const t of depois.cancelados) expect(t).toMatchObject({ cancel_reason: `Faturado na venda ${v.code}`, cancelled_by: usuario });
    const quando = await linhas<{ cancelado: boolean }>("select cancelled_at is not null as cancelado from erp.financial_titles where id = any($1::uuid[])", [depois.cancelados.map((t) => t.id)]);
    expect(quando.every((x) => x.cancelado)).toBe(true);
    // NADA APAGADO: só cresce — os 2 previstos novos e os títulos da venda.
    expect(depois.todos.length).toBe(4);
    expect(await contar("financial_titles")).toBe(linhasAntes + 2 + reais.length);
  });

  it("PV-3 cancelar a venda → o previsto volta a 1000, e os de 600 saem com \"Venda … cancelada\"", async () => {
    const p = await pedido(topProv);
    const v = await parte(p, "4");
    await confirmar(v.id);
    const de600 = (await daOrigem(p.id)).vivos;
    expect(parcelas(de600), "premissa: previstos de 600 depois da venda").toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);
    const linhasAntes = await contar("financial_titles");

    const r = await api("POST", `/api/sales/sales/${v.id}/cancel`, { reason: "Cliente devolveu" });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await daOrigem(p.id);
    expect(parcelas(depois.vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    const saidos = depois.cancelados.filter((t) => de600.some((x) => x.id === t.id));
    expect(saidos.length).toBe(2);
    for (const t of saidos) expect(t).toMatchObject({ cancel_reason: `Venda ${v.code} cancelada`, cancelled_by: usuario });
    expect((await titulosDaOrigem("sales_documents", v.id)).every((t) => t.status === "cancelled"), "premissa: os títulos da venda saíram com ela").toBe(true);
    expect(await contar("financial_titles"), "nada apagado: só os 2 previstos novos").toBe(linhasAntes + 2);
  });
});

describe("PV-4 e PV-5 — encerrar o saldo e cancelar o pedido", () => {
  it("PV-4 encerrar com uma parte aberta de 400 → previsto de 400; confirmar a parte → nenhum previsto vivo", async () => {
    const p = await pedido(topProv);
    const v = await parte(p, "4");
    const r = await api("POST", `/api/sales/orders/${p.id}/encerrar-saldo`, { motivo: "Cliente desistiu do resto" });
    expect(r.statusCode, r.body).toBe(200);
    const encerrado = await daOrigem(p.id);
    expect(parcelas(encerrado.vivos)).toEqual([["200.00", VENCIMENTOS[0]], ["200.00", VENCIMENTOS[1]]]);
    expect(encerrado.cancelados.map((t) => t.cancel_reason)).toEqual(["Saldo do pedido encerrado: Cliente desistiu do resto", "Saldo do pedido encerrado: Cliente desistiu do resto"]);

    await confirmar(v.id);
    const fim = await daOrigem(p.id);
    expect(fim.vivos).toEqual([]);
    expect(fim.todos.length, "nada apagado: 2 + 2, todos cancelados").toBe(4);
    expect(fim.cancelados.filter((t) => encerrado.vivos.some((x) => x.id === t.id)).map((t) => t.cancel_reason)).toEqual([`Faturado na venda ${v.code}`, `Faturado na venda ${v.code}`]);
    expect((await trilha(p.id)).map((x) => x.metadata.alvo)).toEqual(["1000.00", "400.00", "0.00"]);
  });

  it("PV-5 cancelar o pedido sem partes → todos os previstos cancelados com \"Pedido cancelado: <motivo>\"", async () => {
    const p = await pedido(topProv);
    expect((await daOrigem(p.id)).vivos.length, "premissa: há previstos").toBe(2);
    const r = await api("POST", `/api/sales/orders/${p.id}/cancel`, { reason: "Pedido em duplicidade" });
    expect(r.statusCode, r.body).toBe(200);
    const { todos, vivos } = await daOrigem(p.id);
    expect(vivos).toEqual([]);
    expect(todos.map((t) => [t.status, t.cancel_reason, t.cancelled_by])).toEqual([
      ["cancelled", "Pedido cancelado: Pedido em duplicidade", usuario], ["cancelled", "Pedido cancelado: Pedido em duplicidade", usuario]]);
  });
});

describe("PV-6 e PV-7 — editar o pedido", () => {
  it("PV-6 PUT com 1200 → recriados; PATCH só da observação → os MESMOS ids; PATCH com 1300 → recriados", async () => {
    const p = await pedido(topProv);
    const original = (await daOrigem(p.id)).vivos;
    const put = await api("PUT", `/api/sales/orders/${p.id}`, corpoDoPedido(null, { items: [{ product_id: f9.I.product2, quantity: "12", unit_price: "100.00" }] }));
    expect(put.statusCode, put.body).toBe(200);
    const de1200 = await daOrigem(p.id);
    expect(parcelas(de1200.vivos)).toEqual([["600.00", VENCIMENTOS[0]], ["600.00", VENCIMENTOS[1]]]);
    expect(de1200.cancelados.map((t) => t.id).sort()).toEqual(original.map((t) => t.id).sort());
    expect(de1200.cancelados.every((t) => t.cancel_reason === "Pedido alterado")).toBe(true);

    const versao = async () => (await linha<{ version: string }>("select version::text as version from erp.sales_documents where id=$1", [p.id])).version;
    const nota = await api("PATCH", `/api/sales/orders/${p.id}`, { version: await versao(), note: "Só a observação" });
    expect(nota.statusCode, nota.body).toBe(200);
    expect((await linha<{ note: string }>("select note from erp.sales_documents where id=$1", [p.id])).note, "premissa: a PATCH gravou").toBe("Só a observação");
    const semMudar = await daOrigem(p.id);
    expect(semMudar.vivos.map((t) => t.id)).toEqual(de1200.vivos.map((t) => t.id));
    expect(semMudar.todos.length, "no-op: nenhuma linha nova").toBe(de1200.todos.length);

    const item = (await linha<{ id: string }>("select id::text as id from erp.sales_document_items where document_id=$1 order by position limit 1", [p.id])).id;
    const mais = await api("PATCH", `/api/sales/orders/${p.id}`, { version: await versao(), items: [{ id: item, quantity: "13" }] });
    expect(mais.statusCode, mais.body).toBe(200);
    const de1300 = await daOrigem(p.id);
    expect(parcelas(de1300.vivos)).toEqual([["650.00", VENCIMENTOS[0]], ["650.00", VENCIMENTOS[1]]]);
    expect(de1300.todos.length, "nada apagado: 2 + 2 + 2").toBe(6);
  });

  it("PV-7 trocar a TOP por uma que não provisiona → previstos cancelados com \"A operação do pedido não provisiona mais\"", async () => {
    const semProvisao = await topDoPedido({ secao: { provisao: false } });
    const p = await pedido(topProv);
    expect((await daOrigem(p.id)).vivos.length, "premissa: há previstos").toBe(2);
    const r = await api("PUT", `/api/sales/orders/${p.id}`, corpoDoPedido(semProvisao));
    expect(r.statusCode, r.body).toBe(200);
    expect((await linha<{ t: string }>("select tipo_operacao_id::text as t from erp.sales_documents where id=$1", [p.id])).t, "premissa: a TOP foi trocada").toBe(semProvisao.id);
    const { todos, vivos } = await daOrigem(p.id);
    expect(vivos).toEqual([]);
    expect(todos.map((t) => t.cancel_reason)).toEqual(["A operação do pedido não provisiona mais", "A operação do pedido não provisiona mais"]);
  });
});

describe("PV-8 — \"exigir\" sem natureza e centro recusa o salvar do pedido", () => {
  it("422 com a exigência e nada gravado; com a classificação no pedido, salva e provisiona com ela", async () => {
    const topExigir = await topDoPedido({ secao: { provisao: true, semClassificacao: "exigir" } });
    const docs = async () => Number((await linha<{ n: string }>("select count(*)::text as n from erp.sales_documents where organization_id=$1", [f9.h.demo.orgId])).n);
    const [docsAntes, titulosAntes] = [await docs(), await contar("financial_titles")];
    const r = await api("POST", "/api/sales/orders", corpoDoPedido(topExigir));
    expect(r.statusCode, r.body).toBe(422);
    const mensagem = "A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.";
    expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: mensagem, details: { exigencias: [{ caminho: "financeiroPadrao.semClassificacao", mensagem }] } });
    expect([await docs(), await contar("financial_titles")], "nada gravado: nem o pedido, nem título").toEqual([docsAntes, titulosAntes]);

    const p = await pedido(topExigir, { categoria_financeira_id: natureza, centro_custo_id: centro });
    const { vivos } = await daOrigem(p.id);
    expect(vivos.length, "premissa: com a classificação, provisiona").toBe(2);
    for (const t of vivos) expect(await rateioDe(t.id)).toEqual([{ natureza, centro, amount: "500.00" }]);
    expect(vivos.every((t) => t.title_type_id === null && t.conta_prevista_id === null), "a TOP sem padrões não dá tipo nem conta").toBe(true);
  });
});

describe("PV-10 — o pedido convertido inteiro só espera a venda", () => {
  it("a venda sai com desconto (900): confirmar não deixa os 100 de diferença previstos num pedido que não fatura mais", async () => {
    const p = await pedido(topProv);
    const r = await api("POST", `/api/sales/orders/${p.id}/convert`, { tipo_operacao_id: topVenda.id });
    expect(r.statusCode, r.body).toBe(201);
    const vendaId = j(r).id as string;
    expect((await linha<{ status: string }>("select status from erp.sales_documents where id=$1", [p.id])).status, "premissa: o pedido foi convertido inteiro").toBe("converted");
    const versao = (await linha<{ version: string }>("select version::text as version from erp.sales_documents where id=$1", [vendaId])).version;
    const desconto = await api("PATCH", `/api/sales/sales/${vendaId}`, { version: versao, discount: "100.00" });
    expect(desconto.statusCode, desconto.body).toBe(200);
    expect((await linha<{ total: string }>("select total::text as total from erp.sales_documents where id=$1", [vendaId])).total, "premissa: a venda vale 900").toBe("900.00");
    expect(parcelas((await daOrigem(p.id)).vivos), "premissa: até a venda faturar, o pedido prevê os 1000").toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);

    await confirmar(vendaId);
    const { todos, vivos } = await daOrigem(p.id);
    expect(vivos, "nenhuma diferença fica prevista").toEqual([]);
    expect(todos.map((t) => t.cancel_reason)).toEqual([`Faturado na venda ${await codigo(vendaId)}`, `Faturado na venda ${await codigo(vendaId)}`]);
    expect((await titulosDaOrigem("sales_documents", vendaId)).reduce((s, t) => s.plus(t.amount), D(0)).toFixed(2), "o título de verdade é o da venda").toBe("900.00");
  });
});

describe("PV-9 — o previsto não recebe baixa", () => {
  it("baixa no previsto → 409 sem baixa gravada; o título de verdade da venda recebe (premissa)", async () => {
    const p = await pedido(topProv);
    const v = await parte(p, "4");
    await confirmar(v.id);
    const real = (await titulosDaOrigem("sales_documents", v.id))[0]!;
    const ok = await f9.h.app.inject({ method: "POST", url: `/api/financial/receivables/${real.id}/settle`, headers: f9.h.headers(), payload: { settlement_date: DATA, bank_account_id: f9.I.bankAccount, amount: "10.00" } });
    expect(ok.statusCode, `premissa: o título de verdade recebe baixa — ${ok.body}`).toBe(201);

    const previsto = (await daOrigem(p.id)).vivos[0]!;
    const baixas = async () => Number((await linha<{ n: string }>("select count(*)::text as n from erp.title_settlements where title_id=$1", [previsto.id])).n);
    const r = await f9.h.app.inject({ method: "POST", url: `/api/financial/receivables/${previsto.id}/settle`, headers: f9.h.headers(), payload: { settlement_date: DATA, bank_account_id: f9.I.bankAccount, amount: "10.00" } });
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toMatchObject({ code: "CONFLICT", message: "Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado." });
    expect(await baixas()).toBe(0);
    expect((await linha<{ status: string; paid_amount: string }>("select status, paid_amount::text as paid_amount from erp.financial_titles where id=$1", [previsto.id]))).toEqual({ status: "previsto", paid_amount: "0.00" });
  });
});
