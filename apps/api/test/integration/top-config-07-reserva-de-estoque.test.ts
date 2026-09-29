import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-07 (decisão 266) — RESERVA DE ESTOQUE PELO PEDIDO, pela porta da API. RE-1..RE-11.
 *
 * O cenário de cada caso é um PRODUTO NOVO com 10 unidades no armazém A (`armazemA`), aberto por
 * `POST /api/stock/opening-balances`: nenhum caso lê saldo ou reserva de outro, e a ordem de execução não importa.
 *
 * DUAS TESTEMUNHAS, e elas não se substituem:
 *   · o BANCO, por conexão própria de superusuário: físico = soma dos lotes do par; reservado = a conta da 0035
 *     (`erp.reserva_estoque_nucleo`), inclusive com `excluir` para separar a parte do pedido (A) da parte das
 *     vendas abertas (B). É o que prova o EFEITO, sem passar pela rota sob teste;
 *   · a API (`GET /api/stock/balances/:w/:p`, `GET /api/stock/balances`, o documento), que é o contrato da tela.
 *
 * CONFIRMAÇÃO DA VENDA: a TOP de venda é do formato 3 (legado/legado), criada e confirmada pela instância
 * `ligada` (TOP_EFFECTS_RUNTIME_V1_ENABLED=1), como na TOP-CONFIG-06: a mesma TOP serve para a venda avulsa e
 * para a venda gerada do pedido, e a baixa é a do legado (`postStock`, movimento `sale`).
 *
 * AS TOPS DE PEDIDO COM RESERVA NASCEM PELA API (`reservaEstoque: true`), com a aresta para a venda declarada
 * no mesmo corpo (`destinos`, com ou sem `emPartes`). Nenhuma versão é montada por SQL.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let topVenda: string; let topPedidoSemReserva: string; let topPedidoEmPartes: string; let topPedidoInteiro: string;
let modeloProduto: Record<string, string | null>;
/** Armazém A (ALM da 1ª empresa), armazém B (SILO da mesma empresa) e o ALM da outra empresa. */
let armazemA: string; let armazemB: string; let armazemOutraEmpresa: string;
let nomeArmazemA: string;
const DIA = "2026-09-10";

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  armazemA = I.warehouse!; armazemB = I.warehouse2!; armazemOutraEmpresa = I.warehouseEmpresa2!;
  admin = createPool(TEST_URL, { max: 3 });
  modeloProduto = (await admin.query<Record<string, string | null>>(
    "select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where organization_id=$1 and financial_category_id is not null and control_stock order by code limit 1",
    [h.demo.orgId])).rows[0]!;
  nomeArmazemA = (await admin.query<{ description: string }>("select description from erp.warehouses where id=$1", [armazemA])).rows[0]!.description;
  topVenda = await criarTop(ligada, "vendas.venda", "Venda RE", { configuracao: configuracaoNeutraTopV3() });
  topPedidoSemReserva = await criarTop(h.app, "vendas.pedido", "Pedido sem reserva", { destinos: [{ tipoOperacaoId: topVenda, ordem: 0, emPartes: true }] });
  topPedidoEmPartes = await criarTop(h.app, "vendas.pedido", "Pedido com reserva em partes", { reservaEstoque: true, destinos: [{ tipoOperacaoId: topVenda, ordem: 0, emPartes: true }] });
  topPedidoInteiro = await criarTop(h.app, "vendas.pedido", "Pedido com reserva inteiro", { reservaEstoque: true, destinos: [{ tipoOperacaoId: topVenda, ordem: 0 }] });
  // PREMISSA: a versão CORRENTE das TOPs de pedido diz no banco o que o corpo declarou.
  expect(await reservaDaVersaoAtual(topPedidoSemReserva)).toBe(false);
  expect(await reservaDaVersaoAtual(topPedidoEmPartes)).toBe(true);
  expect(await reservaDaVersaoAtual(topPedidoInteiro)).toBe(true);
}, 240_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); await admin.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Detalhe = { path: string; message: string };
type Erro = { code: string; message: string; details?: Detalhe[] };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

let seqTop = 0;
async function criarTop(app: FastifyInstance, codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `374${String(++seqTop).padStart(2, "0")}`, codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
/** A coluna da VERSÃO CORRENTE, lida no banco — testemunha fora da rota. */
const reservaDaVersaoAtual = async (top: string) => (await admin.query<{ reserva_estoque: boolean }>(
  `select v.reserva_estoque from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
    where t.id = $1`, [top])).rows[0]!.reserva_estoque;

// ---------- produtos e saldo ----------
type Produto = { id: string; nome: string };
let seqProduto = 0;
async function produto(rotulo: string, extra: Record<string, unknown> = {}): Promise<Produto> {
  const r = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: h.headers(),
    payload: { description: `${rotulo} ${++seqProduto} ${Math.random().toString(36).slice(2, 7)}`, ...modeloProduto, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  const id = j(r).id as string;
  // O nome que a mensagem cita é o GRAVADO (o cadastro pode normalizar o texto).
  const nome = (await admin.query<{ description: string }>("select description from erp.products where id=$1", [id])).rows[0]!.description;
  return { id, nome };
}
async function saldoInicial(productId: string, quantity: string, warehouseId = armazemA, extra: Record<string, unknown> = {}) {
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: warehouseId, product_id: productId, quantity, unit_value: "10", ...extra } });
  expect(r.statusCode, r.body).toBe(201);
}
/** Produto novo com 10 unidades no armazém A — e a PREMISSA lida no banco: físico 10, nada reservado. */
async function produtoCom10(rotulo: string): Promise<Produto> {
  const p = await produto(rotulo);
  await saldoInicial(p.id, "10");
  expect(await fisico(p.id), "premissa: o estoque inicial é 10").toBe("10.0000");
  expect(await reservado(p.id), "premissa: nada reservado").toBe("0.0000");
  return p;
}
/** Físico do par (todos os lotes), no banco. */
const fisico = async (productId: string, warehouseId = armazemA) => (await admin.query<{ q: string }>(
  "select coalesce(sum(quantity),0)::numeric(18,4)::text q from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3",
  [h.demo.orgId, warehouseId, productId])).rows[0]!.q;
/** Reservado do par pela conta da 0035, no banco; `excluir` tira um documento da conta (o pedido: sobra B; a venda: sobra A). */
const reservado = async (productId: string, excluir: string | null = null, warehouseId = armazemA) => (await admin.query<{ r: string }>(
  "select coalesce(sum(n.reservado),0)::numeric(18,4)::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], $4::uuid) n",
  [h.demo.orgId, warehouseId, productId, excluir])).rows[0]!.r;
type SaldoDaApi = { quantity: string; reservado?: string; disponivel?: string };
async function saldoApi(productId: string, warehouseId = armazemA): Promise<SaldoDaApi> {
  const r = await h.app.inject({ method: "GET", url: `/api/stock/balances/${warehouseId}/${productId}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as SaldoDaApi;
}
const movimentosDe = async (productId: string) => Number((await admin.query<{ n: string }>(
  "select count(*)::text n from erp.stock_movements where organization_id=$1 and product_id=$2", [h.demo.orgId, productId])).rows[0]!.n);
const pedidosDoProduto = async (productId: string) => Number((await admin.query<{ n: string }>(
  "select count(distinct d.id)::text n from erp.sales_documents d join erp.sales_document_items i on i.document_id=d.id where d.kind='order' and i.product_id=$1", [productId])).rows[0]!.n);

// ---------- documentos de venda ----------
type ItemPedido = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string };
const ITEM = (productId: string, quantity: string, warehouseId: string | null = armazemA): ItemPedido => ({ product_id: productId, warehouse_id: warehouseId, quantity, unit_price: "5.00" });
const postPedido = (top: string, items: ItemPedido[]) => h.app.inject({ method: "POST", url: "/api/sales/orders", headers: h.headers(),
  payload: { empresa_id: I.empresa, document_date: DIA, client_id: I.client, tipo_operacao_id: top, items } });
async function pedido(top: string, productId: string, quantity: string): Promise<string> {
  const r = await postPedido(top, [ITEM(productId, quantity)]);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const putPedido = (id: string, items: ItemPedido[]) => h.app.inject({ method: "PUT", url: `/api/sales/orders/${id}`, headers: h.headers(),
  payload: { empresa_id: I.empresa, document_date: DIA, client_id: I.client, items } });
/** Venda AVULSA (sem origem), aberta, com a TOP de venda do formato 3. */
async function venda(productId: string, quantity: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: DIA, client_id: I.client, tipo_operacao_id: topVenda, items: [ITEM(productId, quantity)] } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const confirmar = (id: string) => ligada.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers() });
type ItemDaParte = { item_id: string; quantidade: string };
const converter = (id: string, itens?: ItemDaParte[]) => h.app.inject({ method: "POST", url: `/api/sales/orders/${id}/convert`, headers: h.headers(),
  payload: { tipo_operacao_id: topVenda, ...(itens ? { itens } : {}) } });
async function parte(id: string, itens?: ItemDaParte[]): Promise<string> {
  const r = await converter(id, itens);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const cancelar = (rota: "orders" | "sales", id: string) => h.app.inject({ method: "POST", url: `/api/sales/${rota}/${id}/cancel`, headers: h.headers(), payload: {} });
type DocLido = Record<string, unknown> & { status: string; reserva_estoque?: boolean; items: (Record<string, unknown> & { id: string; quantity: string; reservado?: string })[] };
async function ler(rota: "orders" | "sales", id: string): Promise<DocLido> {
  const r = await h.app.inject({ method: "GET", url: `/api/sales/${rota}/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as DocLido;
}
const statusDe = async (id: string) => (await admin.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;
/** A mensagem amigável da confirmação (contrato A2). */
const msgConfirmacao = (p: Produto, d: string, q: string, r: string) => `${p.nome} no armazém ${nomeArmazemA}: disponível ${d}, solicitado ${q} (${r} reservado para pedidos).`;
/** A linha da recusa do pedido (contrato A1). */
const msgPedido = (p: Produto, d: string, m: string) => `${p.nome} no armazém ${nomeArmazemA}: disponível ${d}, pedido ${m}.`;

describe("RE-1 — TOP sem reserva", () => {
  it("RE-1 pedido de 8 não reserva; outra venda de 10 sai inteira", async () => {
    const p = await produtoCom10("RE-1");
    const id = await pedido(topPedidoSemReserva, p.id, "8");
    expect(await statusDe(id)).toBe("open");
    expect(await reservado(p.id), "a TOP sem reserva não separa nada").toBe("0.0000");
    const v = await venda(p.id, "10");
    const c = await confirmar(v);
    expect(c.statusCode, c.body).toBe(200);
    expect([await statusDe(v), await fisico(p.id)]).toEqual(["confirmed", "0.0000"]);
    // A API diz o mesmo (contrato A2/A1): nada reservado, e o documento declara que não reserva.
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "0.0000", reservado: "0.0000", disponivel: "0.0000" });
    expect((await ler("orders", id)).reserva_estoque).toBe(false);
  });
});

describe("RE-2 — o pedido reserva, a venda avulsa só usa o disponível", () => {
  it("RE-2 pedido de 8 → disponível 2; venda de 3 → 409 com a mensagem, sem efeito; venda de 2 → sai", async () => {
    const p = await produtoCom10("RE-2");
    const id = await pedido(topPedidoEmPartes, p.id, "8");
    expect(await reservado(p.id)).toBe("8.0000");
    expect(await fisico(p.id), "reservar não movimenta").toBe("10.0000");
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "10.0000", reservado: "8.0000", disponivel: "2.0000" });
    const doc = await ler("orders", id);
    expect(doc.reserva_estoque).toBe(true);
    expect(doc.items.map((i) => i.reservado)).toEqual(["8.0000"]);

    const movAntes = await movimentosDe(p.id);
    const v3 = await venda(p.id, "3");
    const r = await confirmar(v3);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error).toMatchObject({ code: "INSUFFICIENT_STOCK", message: msgConfirmacao(p, "2", "3", "8") });
    expect([await statusDe(v3), await fisico(p.id), await movimentosDe(p.id)], "recusa sem efeito").toEqual(["open", "10.0000", movAntes]);

    const v2 = await venda(p.id, "2");
    const ok = await confirmar(v2);
    expect(ok.statusCode, ok.body).toBe(200);
    expect([await fisico(p.id), await reservado(p.id)]).toEqual(["8.0000", "8.0000"]);
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "8.0000", reservado: "8.0000", disponivel: "0.0000" });
  });
});

describe("RE-3 — o pedido não reserva além do disponível", () => {
  it("RE-3 segundo pedido de 3 → 422 com a linha do produto; o próprio pedido não conta contra si no PUT", async () => {
    const p = await produtoCom10("RE-3");
    const id = await pedido(topPedidoEmPartes, p.id, "8");
    expect(await reservado(p.id)).toBe("8.0000");

    const r = await postPedido(topPedidoEmPartes, [ITEM(p.id, "3")]);
    expect(r.statusCode, r.body).toBe(422);
    const linha = msgPedido(p, "2", "3");
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: linha, details: [{ path: "items", message: linha }] });
    expect([await pedidosDoProduto(p.id), await reservado(p.id)], "sem reserva parcial: nada gravado").toEqual([1, "8.0000"]);

    // Dois itens do MESMO par somam: 1 + 2 = 3 > 2 → recusa, com a soma na linha.
    const soma = await postPedido(topPedidoEmPartes, [ITEM(p.id, "1"), ITEM(p.id, "2")]);
    expect(soma.statusCode, soma.body).toBe(422);
    expect(j(soma).error?.message).toBe(linha);

    // PUT do mesmo pedido: a reserva DELE não conta contra ele (disponível para ele = 10).
    const acima = await putPedido(id, [ITEM(p.id, "11")]);
    expect(acima.statusCode, acima.body).toBe(422);
    expect(j(acima).error?.message).toBe(msgPedido(p, "10", "11"));
    expect((await ler("orders", id)).items.map((i) => i.quantity)).toEqual(["8.0000"]);
    const exato = await putPedido(id, [ITEM(p.id, "10")]);
    expect(exato.statusCode, exato.body).toBe(200);
    expect(await reservado(p.id)).toBe("10.0000");

    // Com o disponível zerado, até meia unidade é recusada — e o número sai em PT-BR (vírgula, sem zeros à direita).
    const zero = await postPedido(topPedidoEmPartes, [ITEM(p.id, "0.5")]);
    expect(zero.statusCode, zero.body).toBe(422);
    expect(j(zero).error?.message).toBe(msgPedido(p, "0", "0,5"));
  });
});

describe("RE-4 — armazém obrigatório e da empresa do documento", () => {
  it("RE-4 item sem armazém → 422 no campo; armazém de outra empresa → 422; sem reserva o mesmo corpo passa", async () => {
    const p = await produtoCom10("RE-4");
    const regras = async (top: string) => j(await h.app.inject({ method: "GET", url: `/api/sales/orders/regras-da-operacao?tipo_operacao_id=${top}`, headers: h.headers() }));
    expect((await regras(topPedidoEmPartes)).reservaEstoque, "a Central sabe que o armazém é obrigatório").toBe(true);
    expect((await regras(topPedidoSemReserva)).reservaEstoque).toBe(false);

    const sem = await postPedido(topPedidoEmPartes, [ITEM(p.id, "1", null)]);
    expect(sem.statusCode, sem.body).toBe(422);
    expect(j(sem).error?.code).toBe("VALIDATION_ERROR");
    expect(j(sem).error?.details).toEqual(expect.arrayContaining([{ path: "items[0].warehouse_id", message: "Informe o armazém: esta operação reserva estoque." }]));
    // O índice é o do item que falta: o primeiro tem armazém, o segundo não.
    const segundo = await postPedido(topPedidoEmPartes, [ITEM(p.id, "1"), ITEM(p.id, "1", null)]);
    expect(segundo.statusCode, segundo.body).toBe(422);
    expect(j(segundo).error?.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[1].warehouse_id" })]));

    // PREMISSA: o armazém é mesmo de outra empresa.
    const empresaDoArmazem = (await admin.query<{ empresa_id: string }>("select empresa_id from erp.warehouses where id=$1", [armazemOutraEmpresa])).rows[0]!.empresa_id;
    expect(empresaDoArmazem).not.toBe(I.empresa);
    const outra = await postPedido(topPedidoEmPartes, [ITEM(p.id, "1", armazemOutraEmpresa)]);
    expect(outra.statusCode, outra.body).toBe(422);
    expect(j(outra).error?.details).toEqual(expect.arrayContaining([{ path: "items[0].warehouse_id", message: "O armazém não é da empresa do documento." }]));
    expect(await pedidosDoProduto(p.id), "nenhuma recusa gravou pedido").toBe(0);

    // A exigência vem da reserva: a TOP sem reserva aceita o item sem armazém.
    const semReserva = await postPedido(topPedidoSemReserva, [ITEM(p.id, "1", null)]);
    expect(semReserva.statusCode, semReserva.body).toBe(201);
    // E o mesmo corpo com o armazém da empresa passa na TOP com reserva.
    expect((await postPedido(topPedidoEmPartes, [ITEM(p.id, "1")])).statusCode).toBe(201);
    expect(await reservado(p.id)).toBe("1.0000");
  });
});

describe("RE-5 — conversão em partes: a reserva passa do pedido para a parte", () => {
  it("RE-5 parte de 5 mantém 8 reservado; confirmar a parte → físico 5, reservado 3; cancelar outra parte aberta devolve ao pedido", async () => {
    const p = await produtoCom10("RE-5");
    const id = await pedido(topPedidoEmPartes, p.id, "8");
    const [item] = (await ler("orders", id)).items;
    expect(await reservado(p.id)).toBe("8.0000");

    const p1 = await parte(id, [{ item_id: item!.id, quantidade: "5" }]);
    expect(await reservado(p.id), "converter não muda o total").toBe("8.0000");
    expect(await reservado(p.id, id), "sem o pedido: a parte aberta (B) segura 5").toBe("5.0000");
    expect(await reservado(p.id, p1), "sem a parte: o pedido (A) segura o saldo 3").toBe("3.0000");
    expect(await fisico(p.id)).toBe("10.0000");
    expect((await ler("orders", id)).items[0]!.reservado).toBe("3.0000");

    const c = await confirmar(p1);
    expect(c.statusCode, c.body).toBe(200);
    expect([await fisico(p.id), await reservado(p.id)]).toEqual(["5.0000", "3.0000"]);
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "5.0000", reservado: "3.0000", disponivel: "2.0000" });

    const p2 = await parte(id, [{ item_id: item!.id, quantidade: "2" }]);
    expect([await reservado(p.id), await reservado(p.id, id)]).toEqual(["3.0000", "2.0000"]);
    expect((await cancelar("sales", p2)).statusCode).toBe(200);
    expect(await reservado(p.id), "o total não muda").toBe("3.0000");
    expect(await reservado(p.id, id), "a parte cancelada não segura nada: a reserva voltou ao pedido").toBe("0.0000");
    expect(await statusDe(id)).toBe("open");
    expect((await ler("orders", id)).items[0]!.reservado).toBe("3.0000");
  });
});

describe("RE-6 — conversão inteira: a venda aberta segura a reserva", () => {
  it("RE-6 pedido convertido: reservado 8 na venda aberta (venda avulsa recusada); confirmar → reservado 0", async () => {
    const p = await produtoCom10("RE-6");
    const id = await pedido(topPedidoInteiro, p.id, "8");
    const v = await parte(id);
    expect(await statusDe(id)).toBe("converted");
    expect((await ler("sales", v)).items.map((i) => [i.quantity, i.origem_item_id])).toEqual([["8.0000", null]]);
    expect(await reservado(p.id)).toBe("8.0000");
    expect(await reservado(p.id, v), "sem a venda: o pedido convertido não segura nada").toBe("0.0000");

    // A reserva está valendo: outra venda de 3 não cabe.
    const avulsa = await venda(p.id, "3");
    const r = await confirmar(avulsa);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error?.code).toBe("INSUFFICIENT_STOCK");

    const c = await confirmar(v);
    expect(c.statusCode, c.body).toBe(200);
    expect([await fisico(p.id), await reservado(p.id)]).toEqual(["2.0000", "0.0000"]);
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "2.0000", reservado: "0.0000", disponivel: "2.0000" });
  });
});

describe("RE-7 — cancelar o pedido ou encerrar o saldo tira a reserva do pedido", () => {
  it("RE-7 cancelar pedido aberto → 0; encerrar o saldo → só a parte aberta; pedido convertido cancelado → a venda aberta continua", async () => {
    // (a) cancelar o pedido aberto
    const a = await produtoCom10("RE-7a");
    const pa = await pedido(topPedidoEmPartes, a.id, "8");
    expect(await reservado(a.id)).toBe("8.0000");
    expect((await cancelar("orders", pa)).statusCode).toBe(200);
    expect(await reservado(a.id)).toBe("0.0000");
    expect((await ler("orders", pa)).items[0]!.reservado).toBe("0.0000");

    // (b) encerrar o saldo com uma parte aberta
    const b = await produtoCom10("RE-7b");
    const pb = await pedido(topPedidoEmPartes, b.id, "8");
    const [item] = (await ler("orders", pb)).items;
    const parteB = await parte(pb, [{ item_id: item!.id, quantidade: "3" }]);
    expect(await reservado(b.id)).toBe("8.0000");
    const enc = await h.app.inject({ method: "POST", url: `/api/sales/orders/${pb}/encerrar-saldo`, headers: h.headers(), payload: { motivo: "RE-7 cliente desistiu do resto" } });
    expect(enc.statusCode, enc.body).toBe(200);
    expect(await reservado(b.id), "o saldo encerrado sai; a parte aberta continua").toBe("3.0000");
    expect(await reservado(b.id, parteB), "sem a parte: nada").toBe("0.0000");
    expect((await ler("orders", pb)).items[0]!.reservado).toBe("0.0000");

    // (c) pedido convertido inteiro e depois cancelado: a venda aberta gerada dele continua reservando
    const c = await produtoCom10("RE-7c");
    const pc = await pedido(topPedidoInteiro, c.id, "8");
    const vc = await parte(pc);
    expect(await reservado(c.id)).toBe("8.0000");
    const canc = await cancelar("orders", pc);
    expect(canc.statusCode, canc.body).toBe(200);
    expect([await statusDe(pc), await statusDe(vc)]).toEqual(["cancelled", "open"]);
    expect(await reservado(c.id), "a venda aberta continua reservando").toBe("8.0000");
  });
});

describe("RE-8 — as outras saídas respeitam a reserva; o acerto de inventário não", () => {
  it("RE-8 requisição, baixa e transferência acima do disponível → 409; dentro passam; acerto abaixo do reservado passa e o disponível fica negativo", async () => {
    const p = await produtoCom10("RE-8");
    await pedido(topPedidoEmPartes, p.id, "7");
    expect(await reservado(p.id)).toBe("7.0000");
    const post = (url: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url, headers: h.headers(), payload });
    const requisicao = (quantity: string) => post("/api/stock/requisitions", { empresa_id: I.empresa, requisition_date: DIA, items: [{ warehouse_id: armazemA, product_id: p.id, quantity }] });
    const baixa = (quantity: string) => post("/api/stock/writeoffs", { empresa_id: I.empresa, writeoff_date: DIA, reason: "loss", justification: "RE-8 baixa", warehouse_id: armazemA, items: [{ product_id: p.id, quantity }] });
    const transferencia = (quantity: string) => post("/api/stock/transfers", { kind: "warehouse", transfer_date: DIA, empresa_origem_id: I.empresa, origin_warehouse_id: armazemA, destination_warehouse_id: armazemB, items: [{ product_id: p.id, quantity }] });

    const movAntes = await movimentosDe(p.id);
    for (const [nome, rota] of [["requisição", requisicao], ["baixa", baixa], ["transferência", transferencia]] as const) {
      const r = await rota("4");
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(409);
      expect(j(r).error, nome).toMatchObject({ code: "INSUFFICIENT_STOCK", message: "disponível 3 < solicitado 4 (7 reservado para pedidos)" });
    }
    expect([await fisico(p.id), await movimentosDe(p.id)], "recusas sem efeito").toEqual(["10.0000", movAntes]);

    // PREMISSA: as três rotas funcionam dentro do disponível.
    for (const [nome, rota] of [["requisição", requisicao], ["baixa", baixa], ["transferência", transferencia]] as const) {
      const r = await rota("1");
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(201);
    }
    expect([await fisico(p.id), await fisico(p.id, armazemB), await reservado(p.id)]).toEqual(["7.0000", "1.0000", "7.0000"]);
    const nada = await requisicao("1");
    expect(nada.statusCode, nada.body).toBe(409);
    expect(j(nada).error?.message).toContain("reservado para pedidos");

    // O acerto de inventário (correction_out) passa sempre: o disponível pode ficar negativo.
    const acerto = await post("/api/stock/corrections", { empresa_id: I.empresa, correction_date: DIA, warehouse_id: armazemA, product_id: p.id, new_quantity: "4", justification: "RE-8 contagem" });
    expect(acerto.statusCode, acerto.body).toBe(201);
    expect([await fisico(p.id), await reservado(p.id)]).toEqual(["4.0000", "7.0000"]);
    expect(await saldoApi(p.id)).toMatchObject({ quantity: "4.0000", reservado: "7.0000", disponivel: "-3.0000" });
  });
});

describe("RE-9 — concorrência: pedido × venda sobre o mesmo estoque", () => {
  it("RE-9 pedido de 8 e venda de 8 ao mesmo tempo sobre 10 → exatamente um passa (5 rodadas)", async () => {
    const vencedores: string[] = [];
    for (let rodada = 1; rodada <= 5; rodada++) {
      const p = await produtoCom10(`RE-9 r${rodada}`);
      const v = await venda(p.id, "8");
      const [rp, rv] = await Promise.all([postPedido(topPedidoEmPartes, [ITEM(p.id, "8")]), confirmar(v)]);
      const pedidoPassou = rp.statusCode === 201; const vendaPassou = rv.statusCode === 200;
      expect(pedidoPassou !== vendaPassou, `rodada ${rodada}: exatamente um passa (pedido ${rp.statusCode} ${rp.body} · venda ${rv.statusCode} ${rv.body})`).toBe(true);
      if (pedidoPassou) {
        expect(rv.statusCode, rv.body).toBe(409);
        expect(j(rv).error?.code).toBe("INSUFFICIENT_STOCK");
        expect([await fisico(p.id), await reservado(p.id), await statusDe(v)], `rodada ${rodada}`).toEqual(["10.0000", "8.0000", "open"]);
        vencedores.push("pedido");
      } else {
        expect(rp.statusCode, rp.body).toBe(422);
        expect(j(rp).error?.message).toBe(msgPedido(p, "2", "8"));
        expect([await fisico(p.id), await reservado(p.id), await pedidosDoProduto(p.id), await statusDe(v)], `rodada ${rodada}`).toEqual(["2.0000", "0.0000", 0, "confirmed"]);
        vencedores.push("venda");
      }
    }
    expect(vencedores).toHaveLength(5);
  }, 120_000);
});

describe("RE-10 — a TOP grava 'Reservar estoque' por versão", () => {
  const detalhe = async (id: string) => j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() }));
  const editar = (id: string, corpo: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: corpo });
  const versoesNoBanco = async (id: string) => (await admin.query<{ versao: number; reserva_estoque: boolean }>(
    "select versao, reserva_estoque from erp.tipos_operacao_versoes where tipo_operacao_id=$1 order by versao", [id])).rows.map((v) => [v.versao, v.reserva_estoque]);
  const topsComCodigo = async (codigo: string) => Number((await admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1 and codigo=$2", [h.demo.orgId, codigo])).rows[0]!.n);

  it("RE-10 capability aditiva: reservaEstoque = 1 e contractVersion continua 1", async () => {
    const c = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() }));
    expect(c.contractVersion).toBe(1);
    expect(c.reservaEstoque).toBe(1);
  });

  it("RE-10 POST true; PUT sem o campo preserva; PUT false declara (versão nova); repetir é no-op; histórico por versão", async () => {
    const id = await criarTop(h.app, "vendas.pedido", "Pedido RE-10", { reservaEstoque: true });
    expect((await detalhe(id)).reservaEstoque).toBe(true);
    expect(await versoesNoBanco(id)).toEqual([[1, true]]);

    const r1 = await editar(id, { nome: "Pedido RE-10 renomeado", revisao: (await detalhe(id)).revisao });
    expect(r1.statusCode, r1.body).toBe(200);
    expect((await detalhe(id)).reservaEstoque, "ausente preserva").toBe(true);
    expect(await versoesNoBanco(id)).toEqual([[1, true], [2, true]]);

    const r2 = await editar(id, { reservaEstoque: false, revisao: (await detalhe(id)).revisao });
    expect(r2.statusCode, r2.body).toBe(200);
    expect((await detalhe(id)).reservaEstoque).toBe(false);
    expect(await versoesNoBanco(id), "mudar só a caixa cria versão").toEqual([[1, true], [2, true], [3, false]]);
    const aud = (await admin.query<{ metadata: unknown }>("select metadata from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 and action='update' order by created_at desc, id desc limit 1", [id])).rows[0]!;
    expect(JSON.stringify(aud.metadata), "a trilha registra a mudança da caixa").toContain("reservaEstoque");

    const r3 = await editar(id, { reservaEstoque: false, revisao: (await detalhe(id)).revisao });
    expect(r3.statusCode, r3.body).toBe(200);
    expect(await versoesNoBanco(id), "o mesmo valor não cria versão").toHaveLength(3);

    const hist = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() })).items as { versao: number; reservaEstoque: boolean }[];
    expect(hist.map((v) => [v.versao, v.reservaEstoque]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[1, true], [2, true], [3, false]]);

    // POST sem o campo nasce false.
    const semCampo = await criarTop(h.app, "vendas.pedido", "Pedido RE-10 sem campo");
    expect((await detalhe(semCampo)).reservaEstoque).toBe(false);
    expect(await versoesNoBanco(semCampo)).toEqual([[1, false]]);
  });

  it("RE-10 true fora da família pedido → 422 no campo, nada gravado; valor não booleano → 422", async () => {
    for (const codigoBase of ["vendas.venda", "vendas.orcamento"]) {
      const codigo = `374${String(++seqTop).padStart(2, "0")}`;
      const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo, codigoBase, nome: `RE-10 ${codigoBase}`, reservaEstoque: true } });
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error?.code).toBe("VALIDATION_ERROR");
      expect(j(r).error?.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "reservaEstoque" })]));
      expect(await topsComCodigo(codigo), codigoBase).toBe(0);
    }
    const venda10 = await criarTop(h.app, "vendas.venda", "Venda RE-10");
    const put = await editar(venda10, { reservaEstoque: true, revisao: (await detalhe(venda10)).revisao });
    expect(put.statusCode, put.body).toBe(422);
    expect(j(put).error?.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "reservaEstoque" })]));
    expect(await versoesNoBanco(venda10)).toEqual([[1, false]]);

    const codigo = `374${String(++seqTop).padStart(2, "0")}`;
    const torto = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo, codigoBase: "vendas.pedido", nome: "RE-10 torto", reservaEstoque: "sim" } });
    expect(torto.statusCode, torto.body).toBe(422);
    expect(await topsComCodigo(codigo)).toBe(0);
  });
});

describe("RE-11 — Estoque › Saldo lê a reserva em lote", () => {
  it("RE-11 a página com vários pares faz UMA consulta de reserva; o valor é do par, repetido nas linhas de lote", async () => {
    const prefixo = `RE11-${Math.random().toString(36).slice(2, 7)}`;
    const p1 = await produto(prefixo); await saldoInicial(p1.id, "10");
    const p2 = await produto(prefixo); await saldoInicial(p2.id, "10"); await saldoInicial(p2.id, "5", armazemB);
    const p3 = await produto(prefixo, { controle_lote: "lote" });
    await saldoInicial(p3.id, "4", armazemA, { provider_lot: "L1" }); await saldoInicial(p3.id, "6", armazemA, { provider_lot: "L2" });
    await pedido(topPedidoEmPartes, p1.id, "4");
    await pedido(topPedidoEmPartes, p3.id, "3");
    expect([await reservado(p1.id), await reservado(p2.id), await reservado(p3.id), await fisico(p3.id)]).toEqual(["4.0000", "0.0000", "3.0000", "10.0000"]);

    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let corpo: { items: (Record<string, unknown> & { product_id: string; warehouse_id: string; provider_lot: string | null; quantity: string; reservado?: string; disponivel?: string })[] };
    let consultasDeReserva = 0;
    try {
      const r = await h.app.inject({ method: "GET", url: `/api/stock/balances?search=${encodeURIComponent(prefixo)}&pageSize=50`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      corpo = j(r) as unknown as typeof corpo;
      consultasDeReserva = espiao.mock.calls.filter((c) => {
        const sql = typeof c[0] === "string" ? c[0] : (c[0] as { text?: unknown } | undefined)?.text;
        return typeof sql === "string" && /erp\.reserva_estoque\(/.test(sql);
      }).length;
    } finally { espiao.mockRestore(); }
    expect(corpo.items, "a página tem 5 linhas de 4 pares (senão a contagem não prova nada)").toHaveLength(5);
    expect(consultasDeReserva, "uma consulta de reserva para a página inteira").toBe(1);

    // Sem lote o saldo é gravado com provider_lot = '' (chave da 0003), não null: '' e null são "sem lote".
    const linha = (p: string, w: string, lote: string | null = null) => corpo.items.find((i) => i.product_id === p && i.warehouse_id === w && (i.provider_lot || null) === lote);
    expect(linha(p1.id, armazemA)).toMatchObject({ reservado: "4.0000", disponivel: "6.0000" });
    expect(linha(p2.id, armazemA)).toMatchObject({ reservado: "0.0000", disponivel: "10.0000" });
    expect(linha(p2.id, armazemB)).toMatchObject({ reservado: "0.0000", disponivel: "5.0000" });
    // Produto com lote: o disponível é do PAR (4 + 6 − 3), o mesmo nas duas linhas — nunca do lote.
    expect(linha(p3.id, armazemA, "L1")).toMatchObject({ quantity: "4.0000", reservado: "3.0000", disponivel: "7.0000" });
    expect(linha(p3.id, armazemA, "L2")).toMatchObject({ quantity: "6.0000", reservado: "3.0000", disponivel: "7.0000" });
  });
});
