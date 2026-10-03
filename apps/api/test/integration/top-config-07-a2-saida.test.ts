import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-07 (decisão 266) — A SAÍDA DA VENDA E AS LEITURAS DE SALDO COM A RESERVA (parte A2).
 *
 * O que está sob teste:
 *   · a PRÉ-CONFERÊNCIA da confirmação da venda (`conferirReservaNaSaida`, no planejamento): a venda que não cabe
 *     no disponível (físico do armazém − reservado pelos OUTROS) é recusada com 409 INSUFFICIENT_STOCK e a
 *     mensagem amigável por produto, ANTES de qualquer efeito — e a prévia da confirmação mostra a MESMA recusa;
 *   · a venda gerada do pedido consome a PRÓPRIA reserva (a parte B dela não conta contra ela);
 *   · GET /stock/balances e GET /stock/balances/:w/:p com `reservado`/`disponivel` do PAR (armazém, produto);
 *   · RE-11: a página inteira de /stock/balances faz UMA chamada à porta `erp.reserva_estoque` — contada;
 *   · TOP-CONFIG-07_R1: item de produto SEM controle de estoque (serviço, frete) fica FORA da conta da saída — com ou
 *     sem armazém, a porta da reserva e o físico nem o recebem; com armazém, quem o recusa continua o `postStock`.
 *
 * O PEDIDO COM RESERVA NÃO DEPENDE DA API NOVA DA TOP: a TOP de pedido nasce pela API e a versão NOVA com
 * `reserva_estoque = true` (e a aresta para a TOP de venda) é gravada por SQL de superusuário, como a aresta da
 * 06. O pedido é criado pela rota de vendas; a reserva conta pela versão CONGELADA nele.
 *
 * DUAS INSTÂNCIAS: `h.app` (gate desligado: venda avulsa legada) e `ligada` (TOP_EFFECTS_RUNTIME_V1_ENABLED=1:
 * a venda gerada do pedido leva a TOP de venda do formato 3). Toda prova decisiva (saldo, movimentos, status) é
 * lida no BANCO por conexão própria.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let topVenda: string; let topPedidoInteiro: string; let topPedidoEmPartes: string;
let base: Record<string, unknown>; let nomeArmazem: string;
const TAG = `RSV-A2-${Math.random().toString(36).slice(2, 8)}`;

type Resposta = { statusCode: number; body: string };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => JSON.parse(r.body) as Record<string, unknown> & { id?: string; error?: Erro };
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (url: string, payload: Record<string, unknown> = {}, app: FastifyInstance = h.app) => app.inject({ method: "POST", url, headers: hdr(), payload });
const get = (url: string, app: FastifyInstance = h.app) => app.inject({ method: "GET", url, headers: h.headers() });
const criado = (r: Resposta) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  const org = h.demo.orgId;
  const grupo = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [org])).rows[0]!.id;
  const un = (await admin.query<{ id: string }>("select id from erp.measurement_units where (organization_id is null or organization_id=$1) and upper(symbol)='UN' order by organization_id nulls last limit 1", [org])).rows[0]!.id;
  base = { group_id: grupo, measurement_id: un, financial_category_id: I.category };
  nomeArmazem = (await admin.query<{ description: string }>("select description from erp.warehouses where id=$1", [I.warehouse])).rows[0]!.description;
  topVenda = await criarTop(ligada, "vendas.venda", "Venda A2", { configuracao: configuracaoNeutraTopV3() });
  topPedidoInteiro = await criarTop(h.app, "vendas.pedido", "Pedido com reserva A2");
  await versaoComReserva(topPedidoInteiro, topVenda, false);
  topPedidoEmPartes = await criarTop(h.app, "vendas.pedido", "Pedido com reserva em partes A2");
  await versaoComReserva(topPedidoEmPartes, topVenda, true);
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); await admin.end(); });

let seq = 0;
async function criarTop(app: FastifyInstance, codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `372${String(++seq).padStart(2, "0")}`, codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/**
 * HELPER ISOLADO (troca quando a API administrativa gravar `reservaEstoque`): versão N+1 da TOP de pedido, com
 * `reserva_estoque = true`, destinos declarados e UMA aresta para `destino` (`em_partes` dado). A versão é
 * imutável (0020) — por isso é nova, como a API faz.
 */
async function versaoComReserva(origemTop: string, destino: string, emPartes: boolean): Promise<void> {
  const v = (await admin.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version, destinos_configurados, reserva_estoque)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.configuracao, v.configuracao_schema_version, true, true
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 returning id`, [origemTop])).rows[0]!.id;
  expect((await admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [origemTop])).rowCount).toBe(1);
  await admin.query("insert into erp.tipos_operacao_versao_destinos (organization_id, origem_versao_id, origem_tipo_operacao_id, destino_tipo_operacao_id, ordem, em_partes) values ($1,$2,$3,$4,0,$5)",
    [h.demo.orgId, v, origemTop, destino, emPartes]);
}

/** Produto novo (descrição com a TAG da suíte) — o saldo dele é só o que esta suíte semeia. */
async function produto(rotulo: string, extra: Record<string, unknown> = {}): Promise<{ id: string; nome: string }> {
  const nome = `${TAG} ${rotulo}`;
  return { id: criado(await post("/api/resources/products", { ...base, description: nome, ...extra })), nome };
}
/**
 * SERVIÇO (TOP-CONFIG-07_R1): produto novo com `control_stock: false`, pela API de cadastro. PREMISSAS no banco: não
 * controla estoque e não tem saldo — o disponível dele é 0.
 */
async function servico(rotulo: string): Promise<{ id: string; nome: string }> {
  const s = await produto(rotulo, { control_stock: false });
  const lido = (await admin.query<{ c: boolean }>("select control_stock c from erp.products where id=$1", [s.id])).rows[0]!.c;
  expect(lido, "premissa: o serviço não controla estoque").toBe(false);
  expect(await fisico(s.id), "premissa: o serviço não tem saldo").toBe("0");
  return s;
}
async function estoque(productId: string, quantity: string, providerLot?: string) {
  const r = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: productId, quantity, unit_value: "5", ...(providerLot ? { provider_lot: providerLot } : {}) });
  expect(r.statusCode, r.body).toBe(201);
}
async function pedido(topId: string, productId: string, quantity: string): Promise<string> {
  return criado(await post("/api/sales/orders", { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, tipo_operacao_id: topId,
    items: [{ product_id: productId, warehouse_id: I.warehouse, quantity, unit_price: "5.00" }] }));
}
async function vendaAvulsa(productId: string, quantity: string): Promise<string> {
  return criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client,
    items: [{ product_id: productId, warehouse_id: I.warehouse, quantity, unit_price: "20.00" }] }));
}
const confirmar = (id: string, app: FastifyInstance = h.app) => post(`/api/sales/sales/${id}/confirm`, {}, app);
const previa = async (id: string, app: FastifyInstance = h.app) => {
  const r = await get(`/api/sales/sales/${id}/previa-confirmacao`, app);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as Record<string, unknown> & { podeConfirmar: boolean; recusas: Erro[] };
};

/** Físico do produto no armazém A (todos os lotes), lido do banco. */
const fisico = async (productId: string) => (await admin.query<{ q: string }>(
  "select coalesce(sum(quantity),0)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [I.warehouse, productId])).rows[0]!.q;
const saidas = async (sourceId: string) => (await admin.query<{ movement_type: string; quantity: string }>(
  "select movement_type, quantity::text from erp.stock_movements where source_type='sales_documents' and source_id=$1 order by created_at", [sourceId])).rows;
const statusDe = async (id: string) => (await admin.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;

type LinhaSaldo = { warehouse_id: string; product_id: string; provider_lot: string; quantity: string; reservado: string; disponivel: string };
const saldoListado = async (productId: string) => {
  const r = await get(`/api/stock/balances?product_id=${productId}&pageSize=50`);
  expect(r.statusCode, r.body).toBe(200);
  return (j(r).items as LinhaSaldo[]).sort((a, b) => a.provider_lot.localeCompare(b.provider_lot));
};
const saldoDoPar = async (productId: string) => {
  const r = await get(`/api/stock/balances/${I.warehouse}/${productId}`);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { quantity: string; averageCost: string; reservado: string; disponivel: string; lots: unknown[] };
};

describe("RE-2 — a pré-conferência da confirmação da venda", () => {
  it("estoque 10, pedido reservando 8: venda avulsa de 3 → 409 amigável (a prévia mostra a mesma recusa), nada sai; de 2 → confirma e sai", async () => {
    const p = await produto("RE-2");
    await estoque(p.id, "10");
    const ped = await pedido(topPedidoInteiro, p.id, "8");
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "10.0000", reservado: "8.0000", disponivel: "2.0000" });

    const v3 = await vendaAvulsa(p.id, "3");
    const pv = await previa(v3);
    const r = await confirmar(v3);
    expect(r.statusCode, r.body).toBe(409);
    const mensagem = `${p.nome} no local de estoque ${nomeArmazem}: disponível 2, solicitado 3 (8 reservado para pedidos).`;
    expect(j(r).error).toEqual({
      code: "INSUFFICIENT_STOCK", message: mensagem,
      details: [{ produto_id: p.id, armazem_id: I.warehouse, fisico: "10.0000", reservado: "8.0000", disponivel: "2.0000", solicitado: "3.0000", message: mensagem }],
    });
    // A PRÉVIA é o mesmo planejamento: a mesma recusa, com o mesmo código, texto e detalhes.
    expect(pv.podeConfirmar).toBe(false);
    expect(pv.recusas).toEqual([j(r).error]);
    // Nada saiu: o físico é o mesmo, a venda segue aberta, sem movimento.
    expect([await fisico(p.id), await statusDe(v3), await saidas(v3)]).toEqual(["10.0000", "open", []]);

    // PREMISSA: exatamente o disponível passa — e sai.
    const v2 = await vendaAvulsa(p.id, "2");
    expect((await previa(v2)).podeConfirmar).toBe(true);
    const ok = await confirmar(v2);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await saidas(v2)).toEqual([{ movement_type: "sale", quantity: "2.0000" }]);
    expect(await fisico(p.id)).toBe("8.0000");
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "8.0000", reservado: "8.0000", disponivel: "0.0000" });
    // O pedido continua reservando: a venda de 3 continua recusada, agora com disponível 0.
    const deNovo = await confirmar(v3);
    expect(deNovo.statusCode, deNovo.body).toBe(409);
    expect(j(deNovo).error!.message).toBe(`${p.nome} no local de estoque ${nomeArmazem}: disponível 0, solicitado 3 (8 reservado para pedidos).`);
    expect(await statusDe(ped)).toBe("open");
  });

  it("dois itens do MESMO par somam: 1 + 2,5 com disponível 2 → recusa dizendo solicitado 3,5; nada sai", async () => {
    const p = await produto("RE-2 soma");
    await estoque(p.id, "10");
    await pedido(topPedidoInteiro, p.id, "8");
    const v = criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client,
      items: [{ product_id: p.id, warehouse_id: I.warehouse, quantity: "1", unit_price: "20.00" }, { product_id: p.id, warehouse_id: I.warehouse, quantity: "2.5", unit_price: "20.00" }] }));
    const r = await confirmar(v);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.message).toBe(`${p.nome} no local de estoque ${nomeArmazem}: disponível 2, solicitado 3,5 (8 reservado para pedidos).`);
    expect([await fisico(p.id), await saidas(v)]).toEqual(["10.0000", []]);
  });

  it("SEM reserva no par, a falta de físico continua a recusa de antes (gatilho de saldo), sem o texto da reserva", async () => {
    const p = await produto("sem reserva");
    await estoque(p.id, "1");
    const v = await vendaAvulsa(p.id, "3");
    expect((await previa(v)).podeConfirmar, "a prévia não inventa recusa de reserva onde não há reserva").toBe(true);
    const r = await confirmar(v);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(j(r).error!.message).not.toMatch(/reservado para pedidos/);
    expect(j(r).error!.message).toMatch(/saldo .* < solicitado/);
    expect(await fisico(p.id)).toBe("1.0000");
  });
});

describe("a venda gerada do pedido consome a PRÓPRIA reserva", () => {
  it("conversão inteira: pedido 8 (estoque 10) → venda de 8 (reserva passa de A para B, total igual) → confirma e sai 8", async () => {
    const p = await produto("conversao inteira");
    await estoque(p.id, "10");
    const ped = await pedido(topPedidoInteiro, p.id, "8");
    const conv = await post(`/api/sales/orders/${ped}/convert`, { tipo_operacao_id: topVenda });
    const venda = criado(conv);
    expect(await statusDe(ped)).toBe("converted");
    expect(await saldoDoPar(p.id), "a reserva mudou de lugar (pedido → venda aberta) sem mudar de tamanho").toMatchObject({ reservado: "8.0000", disponivel: "2.0000" });
    // Sem excluir a parte B da própria venda, o disponível dela seria 2 < 8 — confirmar prova a exclusão.
    const pv = await previa(venda, ligada);
    expect(pv.recusas).toEqual([]);
    const r = await confirmar(venda, ligada);
    expect(r.statusCode, r.body).toBe(200);
    expect(await saidas(venda)).toEqual([{ movement_type: "sale", quantity: "8.0000" }]);
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "2.0000", reservado: "0.0000", disponivel: "2.0000" });
  });

  it("em partes: pedido 8 → parte de 6 (A=2, B=6) → a parte confirma; o saldo A (2) continua reservado e barra a venda avulsa de 3", async () => {
    const p = await produto("em partes");
    await estoque(p.id, "10");
    const ped = await pedido(topPedidoEmPartes, p.id, "8");
    const item = ((j(await get(`/api/sales/orders/${ped}`)).items) as { id: string }[])[0]!;
    const parte = criado(await post(`/api/sales/orders/${ped}/convert`, { tipo_operacao_id: topVenda, itens: [{ item_id: item.id, quantidade: "6" }] }));
    expect(await statusDe(ped)).toBe("open");
    expect(await saldoDoPar(p.id)).toMatchObject({ reservado: "8.0000", disponivel: "2.0000" });
    const r = await confirmar(parte, ligada);
    expect(r.statusCode, r.body).toBe(200);
    expect(await saidas(parte)).toEqual([{ movement_type: "sale", quantity: "6.0000" }]);
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "4.0000", reservado: "2.0000", disponivel: "2.0000" });
    const v3 = await vendaAvulsa(p.id, "3");
    const x = await confirmar(v3);
    expect(x.statusCode, x.body).toBe(409);
    expect(j(x).error!.message).toBe(`${p.nome} no local de estoque ${nomeArmazem}: disponível 2, solicitado 3 (2 reservado para pedidos).`);
    expect(await fisico(p.id)).toBe("4.0000");
  });
});

describe("leituras de saldo com reservado e disponível", () => {
  it("GET /stock/balances: reservado/disponível do PAR; num produto com dois lotes, o MESMO valor nas duas linhas; totais sem mudança", async () => {
    const semLote = await produto("saldo sem lote");
    await estoque(semLote.id, "10");
    await pedido(topPedidoInteiro, semLote.id, "8");
    expect((await saldoListado(semLote.id)).map((x) => [x.quantity, x.reservado, x.disponivel])).toEqual([["10.0000", "8.0000", "2.0000"]]);

    const comLote = await produto("saldo com lote", { controle_lote: "lote" });
    await estoque(comLote.id, "6", "L-1");
    await estoque(comLote.id, "4", "L-2");
    await pedido(topPedidoInteiro, comLote.id, "5");
    const linhas = await saldoListado(comLote.id);
    // Cada linha é UM lote (físico do lote), e o reservado/disponível é do armazém inteiro (6 + 4 − 5).
    expect(linhas.map((x) => [x.provider_lot, x.quantity, x.reservado, x.disponivel])).toEqual([
      ["L-1", "6.0000", "5.0000", "5.0000"],
      ["L-2", "4.0000", "5.0000", "5.0000"],
    ]);
    const r = j(await get(`/api/stock/balances?product_id=${comLote.id}`));
    expect(r.totals, "os totais continuam o físico somado").toEqual({ quantity: "10.0000", value: "50.00" });

    // O detalhe do par: quantity continua o físico; reservado e disponível do par.
    expect(await saldoDoPar(comLote.id)).toMatchObject({ quantity: "10.0000", reservado: "5.0000", disponivel: "5.0000" });
    expect((await saldoDoPar(comLote.id)).lots).toHaveLength(2);
  });

  it("par sem reserva: reservado 0 e disponível = físico nas duas leituras", async () => {
    const p = await produto("sem pedido");
    await estoque(p.id, "7");
    expect((await saldoListado(p.id)).map((x) => [x.reservado, x.disponivel])).toEqual([["0.0000", "7.0000"]]);
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "7.0000", reservado: "0.0000", disponivel: "7.0000" });
  });

  it("RE-11: a página de /stock/balances consulta a reserva UMA vez (e o físico do par uma vez), qualquer que seja o número de linhas — contada", async () => {
    const r0 = j(await get(`/api/stock/balances?search=${encodeURIComponent(TAG)}&pageSize=100`));
    const linhas = r0.items as LinhaSaldo[];
    const pares = new Set(linhas.map((x) => `${x.warehouse_id}:${x.product_id}`));
    expect(linhas.length, "a página tem várias linhas (senão a contagem não prova nada)").toBeGreaterThanOrEqual(5);
    expect(pares.size, "e vários pares distintos").toBeGreaterThanOrEqual(4);
    expect(pares.size, "com um produto de dois lotes: mais linhas que pares").toBeLessThan(linhas.length);
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const r = await get(`/api/stock/balances?search=${encodeURIComponent(TAG)}&pageSize=100`);
      expect(r.statusCode, r.body).toBe(200);
      expect((j(r).items as unknown[]).length).toBe(linhas.length);
      const sql = espiao.mock.calls.map((c) => c[0]).filter((c): c is string => typeof c === "string");
      expect(sql.filter((c) => /erp\.reserva_estoque\(/.test(c)).length).toBe(1);
      expect(sql.filter((c) => /from unnest\(\$2::uuid\[\], \$3::uuid\[\]\)/.test(c)).length).toBe(1);
    } finally { espiao.mockRestore(); }
  });
});

describe("revisão adversarial — números de armazém alheio e o armazém da parte", () => {
  it("venda da empresa A com item no armazém da empresa B: prévia e confirmação não revelam físico nem reservado de B", async () => {
    const p = await produto("armazém alheio");
    const r0 = await post("/api/stock/opening-balances", { empresa_id: I.empresa2, warehouse_id: I.warehouseEmpresa2, product_id: p.id, quantity: "10", unit_value: "5" });
    expect(r0.statusCode, r0.body).toBe(201);
    criado(await post("/api/sales/orders", { empresa_id: I.empresa2, document_date: "2026-09-10", client_id: I.client, tipo_operacao_id: topPedidoInteiro,
      items: [{ product_id: p.id, warehouse_id: I.warehouseEmpresa2, quantity: "8", unit_price: "5.00" }] }));
    // PREMISSA: a empresa B reserva 8 de 10 no par — sem o recorte, 3 não caberia e a recusa diria os números de B.
    const reservadoEmB = (await admin.query<{ r: string }>("select reservado::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null)",
      [h.demo.orgId, I.warehouseEmpresa2, p.id])).rows[0]!.r;
    expect(reservadoEmB).toBe("8.0000");
    const venda = criado(await post("/api/sales/sales", { empresa_id: I.empresa, document_date: "2026-09-20", client_id: I.client,
      items: [{ product_id: p.id, warehouse_id: I.warehouseEmpresa2, quantity: "3", unit_price: "20.00" }] }));
    const pv = await previa(venda);
    expect(JSON.stringify(pv.recusas), "a prévia não pode dizer nada do estoque de B").not.toMatch(/reservado|dispon[ií]vel|INSUFFICIENT_STOCK/);
    const c = await confirmar(venda);
    expect(c.statusCode, c.body).toBe(422);
    expect(j(c).error!.code, "quem recusa é o armazém de outra empresa, como sempre foi").toBe("WAREHOUSE_FARM_MISMATCH");
    expect(JSON.stringify(j(c).error)).not.toMatch(/reservado|dispon[ií]vel/);
    expect(await saidas(venda)).toEqual([]);
  });

  it("a parte de pedido com reserva não troca de armazém (422 no item); a observação muda; o armazém gravado fica", async () => {
    const p = await produto("parte armazém");
    await estoque(p.id, "10");
    // O armazém de destino TEM estoque: sem a guarda, a troca caberia e passaria (é o furo que a guarda fecha).
    const r2 = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse2, product_id: p.id, quantity: "10", unit_value: "5" });
    expect(r2.statusCode, r2.body).toBe(201);
    const ped = await pedido(topPedidoEmPartes, p.id, "8");
    const item = ((j(await get(`/api/sales/orders/${ped}`)).items) as { id: string }[])[0]!;
    const parte = criado(await post(`/api/sales/orders/${ped}/convert`, { tipo_operacao_id: topVenda, itens: [{ item_id: item.id, quantidade: "4" }] }));
    const v = j(await get(`/api/sales/sales/${parte}`)) as { items: Record<string, unknown>[] };
    const base = v.items.map((i) => ({ product_id: i.product_id as string, warehouse_id: i.warehouse_id as string | null, quantity: String(i.quantity),
      unit_price: i.unit_price as string, discount: i.discount as string, discount_percent: i.discount_percent as string, note: i.note as string | null }));
    const put = (items: typeof base) => h.app.inject({ method: "PUT", url: `/api/sales/sales/${parte}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-12", client_id: I.client, items } });
    const msg = "O local de estoque deste item vem do pedido de origem, que reserva estoque no local de estoque de cada item: não pode ser trocado. Para mudar, cancele esta venda e gere de novo.";
    const r = await put(base.map((i) => ({ ...i, warehouse_id: I.warehouse2! })));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: msg, details: [{ path: "items[0].warehouse_id", message: msg }] });
    const armazem = async () => (await admin.query<{ w: string }>("select warehouse_id::text w from erp.sales_document_items where document_id=$1", [parte])).rows.map((x) => x.w);
    expect(await armazem()).toEqual([I.warehouse]);
    const ok = await put(base.map((i) => ({ ...i, note: "obs" })));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await armazem()).toEqual([I.warehouse]);
    // A conta continua fechando: A (4) + B (4) no armazém do pedido.
    expect(await saldoDoPar(p.id)).toMatchObject({ reservado: "8.0000", disponivel: "2.0000" });
  });
});

describe("TOP-CONFIG-07_R1 — produto sem controle de estoque fica FORA da conta da saída", () => {
  /** A prévia, com as chamadas à porta da reserva e ao físico do lote capturadas: [armazéns, produtos] de cada uma. */
  async function previaEspiada(id: string, app: FastifyInstance) {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const pv = await previa(id, app);
      const chamadas = espiao.mock.calls.map((c) => ({ sql: typeof c[0] === "string" ? c[0] : "", params: Array.isArray(c[1]) ? c[1] as unknown[] : [] }));
      return {
        pv,
        reserva: chamadas.filter((c) => /from erp\.reserva_estoque\(/.test(c.sql)).map((c) => c.params.slice(0, 2)),
        fisico: chamadas.filter((c) => /from unnest\(\$2::uuid\[\], \$3::uuid\[\]\)/.test(c.sql)).map((c) => c.params.slice(1, 3)),
      };
    } finally { espiao.mockRestore(); }
  }
  const itensDe = async (id: string) => (await admin.query<{ p: string; w: string | null; q: string }>(
    "select product_id::text p, warehouse_id::text w, quantity::text q from erp.sales_document_items where document_id=$1 order by position", [id])).rows.map((x) => [x.p, x.w, x.q]);

  it("venda gerada de pedido com reserva, com serviço SEM armazém: prévia e confirmação contam só o controlado — cabe EXATO e confirma", async () => {
    const p = await produto("R1 controlado");
    await estoque(p.id, "10");
    const s = await servico("R1 frete");
    // O pedido com reserva leva o controlado e o serviço SEM armazém (o que o R1 destrava ao salvar).
    const ped = criado(await post("/api/sales/orders", { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, tipo_operacao_id: topPedidoInteiro,
      items: [{ product_id: p.id, warehouse_id: I.warehouse, quantity: "8", unit_price: "5.00" }, { product_id: s.id, quantity: "1", unit_price: "30.00" }] }));
    // Outro pedido reserva o resto: para a venda, o disponível do Sal é EXATAMENTE os 8 dela (10 − 2 dos outros).
    await pedido(topPedidoInteiro, p.id, "2");
    const venda = criado(await post(`/api/sales/orders/${ped}/convert`, { tipo_operacao_id: topVenda }));
    // PREMISSAS: a venda leva os dois itens (o serviço sem armazém), e a reserva do par é 10 de 10.
    expect(await itensDe(venda)).toEqual([[p.id, I.warehouse, "8.0000"], [s.id, null, "1.0000"]]);
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "10.0000", reservado: "10.0000", disponivel: "0.0000" });

    const { pv, reserva, fisico: fis } = await previaEspiada(venda, ligada);
    expect(pv.recusas).toEqual([]);
    expect(pv.podeConfirmar).toBe(true);
    // a conta da saída foi feita (uma chamada de cada), e só com o controlado
    expect(reserva).toEqual([[[I.warehouse], [p.id]]]);
    expect(fis).toEqual([[[I.warehouse], [p.id]]]);

    const r = await confirmar(venda, ligada);
    expect(r.statusCode, r.body).toBe(200);
    expect(await saidas(venda)).toEqual([{ movement_type: "sale", quantity: "8.0000" }]);
    expect(await saldoDoPar(p.id)).toMatchObject({ quantity: "2.0000", reservado: "2.0000", disponivel: "0.0000" });
    expect(await fisico(s.id), "o serviço não movimenta").toBe("0");
  });

  it("serviço COM armazém: fora da conta (a porta da reserva nem o recebe); a confirmação continua recusada pelo postStock (PRODUCT_NOT_STOCK_CONTROLLED), sem efeito", async () => {
    const p = await produto("R1 controlado 2");
    await estoque(p.id, "10");
    const s = await servico("R1 frete 2");
    const ped = criado(await post("/api/sales/orders", { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, tipo_operacao_id: topPedidoInteiro,
      items: [{ product_id: p.id, warehouse_id: I.warehouse, quantity: "3", unit_price: "5.00" }, { product_id: s.id, warehouse_id: I.warehouse, quantity: "1", unit_price: "30.00" }] }));
    const venda = criado(await post(`/api/sales/orders/${ped}/convert`, { tipo_operacao_id: topVenda }));
    expect(await itensDe(venda)).toEqual([[p.id, I.warehouse, "3.0000"], [s.id, I.warehouse, "1.0000"]]);

    const { pv, reserva, fisico: fis } = await previaEspiada(venda, ligada);
    expect(reserva, "o par do serviço não vai à porta da reserva").toEqual([[[I.warehouse], [p.id]]]);
    expect(fis, "nem ao físico").toEqual([[[I.warehouse], [p.id]]]);
    expect(JSON.stringify(pv.recusas), "nenhuma recusa de reserva inventada para o serviço").not.toMatch(/reservado para pedidos|INSUFFICIENT_STOCK/);

    // A recusa de ANTES continua: produto sem controle com armazém não baixa estoque — e nada sai do controlado.
    const c = await confirmar(venda, ligada);
    expect(c.statusCode, c.body).toBe(422);
    expect(j(c).error!.code).toBe("PRODUCT_NOT_STOCK_CONTROLLED");
    expect([await statusDe(venda), await saidas(venda), await fisico(p.id)]).toEqual(["open", [], "10.0000"]);
  });
});
