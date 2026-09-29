import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV3 } from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-06 (decisão 265) — FATURAR EM PARTES, pela porta da API de vendas.
 *
 * A aresta "Em partes" é montada por SQL (superusuário de teste) numa versão NOVA da TOP de pedido: esta suíte
 * prova a ROTA DE VENDAS, não o editor (a gravação de `emPartes` pela API administrativa é FP-11, outra suíte).
 * Toda prova decisiva é lida no BANCO por conexão própria (status, quantidades ligadas, valores), não na resposta.
 *
 * DUAS INSTÂNCIAS: `h.app` (gate desligado) e `ligada` (TOP_EFFECTS_RUNTIME_V1_ENABLED=1), como em
 * `sales-top-execucao`: a TOP de venda é do formato 3 (legado/legado), criada e confirmada pela `ligada`.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let topVenda: string; let topPedidoEmPartes: string; let topPedidoSemPartes: string;
beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "5000", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  topVenda = await criarTop(ligada, "vendas.venda", "Venda em partes", { configuracao: configuracaoNeutraTopV3() });
  topPedidoEmPartes = await criarTop(h.app, "vendas.pedido", "Pedido em partes");
  await arestaNaVersaoNova(topPedidoEmPartes, topVenda, true);
  topPedidoSemPartes = await criarTop(h.app, "vendas.pedido", "Pedido inteiro");
  await arestaNaVersaoNova(topPedidoSemPartes, topVenda, false);
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); await admin.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

let seq = 0;
async function criarTop(app: FastifyInstance, codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `36${String(++seq).padStart(2, "0")}`, codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/**
 * HELPER ISOLADO (troca quando a API administrativa gravar `emPartes`): versão N+1 da TOP de origem, com a
 * política DECLARADA e UMA aresta para `destino`, com `em_partes` dado. A aresta é imutável (0022), por isso a
 * versão é nova — o mesmo que a API faz.
 */
async function arestaNaVersaoNova(origemTop: string, destino: string, emPartes: boolean): Promise<void> {
  const v = (await admin.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version, destinos_configurados)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.configuracao, v.configuracao_schema_version, true
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 returning id`, [origemTop])).rows[0]!.id;
  expect((await admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [origemTop])).rowCount).toBe(1);
  await admin.query("insert into erp.tipos_operacao_versao_destinos (organization_id, origem_versao_id, origem_tipo_operacao_id, destino_tipo_operacao_id, ordem, em_partes) values ($1,$2,$3,$4,0,$5)",
    [h.demo.orgId, v, origemTop, destino, emPartes]);
}

type ItemPedido = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string; discount?: string; note?: string };
const ITEM = (quantity = "10", unit_price = "5.00", extra: Partial<ItemPedido> = {}): ItemPedido => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity, unit_price, ...extra });
async function pedido(topId: string | null, items: ItemPedido[] = [ITEM()], extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/sales/orders", headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items, ...(topId ? { tipo_operacao_id: topId } : {}), ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
type ItemDaParte = { item_id: string; quantidade: string | number };
const converter = (id: string, itens?: ItemDaParte[], chave?: string, alvo: string | null = topVenda) =>
  h.app.inject({ method: "POST", url: `/api/sales/orders/${id}/convert`, headers: h.headers(chave ? { "idempotency-key": chave } : {}),
    payload: { ...(alvo ? { tipo_operacao_id: alvo } : {}), ...(itens ? { itens } : {}) } });
async function parte(id: string, itens?: ItemDaParte[]): Promise<string> {
  const r = await converter(id, itens);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
type DocLido = Record<string, unknown> & { status: string; code: string; items: (Record<string, unknown> & { id: string; quantity: string; faturado?: string; saldo?: string; origem_item_id: string | null })[] };
const ler = async (rota: "budgets" | "orders" | "sales", id: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/sales/${rota}/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as DocLido;
};
const itensDe = async (id: string) => (await ler("orders", id)).items;
const statusDe = async (id: string) => (await admin.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;
/** Soma ligada ao item de origem em documentos NÃO cancelados — a conta do saldo, lida no banco. */
const ligado = async (itemId: string) => (await admin.query<{ n: string }>(
  "select coalesce(sum(i.quantity),0)::text n from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id where i.origem_item_id=$1 and d.status<>'cancelled'", [itemId])).rows[0]!.n;
const derivados = async (id: string) => Number((await admin.query<{ n: string }>("select count(*)::text n from erp.sales_documents where origin_document_id=$1", [id])).rows[0]!.n);
const cancelar = (rota: "orders" | "sales", id: string, app: FastifyInstance = h.app) =>
  app.inject({ method: "POST", url: `/api/sales/${rota}/${id}/cancel`, headers: h.headers(), payload: {} });
const encerrar = (id: string, payload: unknown, chave?: string) =>
  h.app.inject({ method: "POST", url: `/api/sales/orders/${id}/encerrar-saldo`, headers: h.headers(chave ? { "idempotency-key": chave } : {}), payload: payload as Record<string, unknown> });

describe("FP-1 — aresta SEM 'Em partes' e ponte legada", () => {
  it("FP-1 próximos passos declaram emPartes; com itens → 422 sem efeito; sem itens → converte como hoje", async () => {
    const pp = j(await h.app.inject({ method: "GET", url: `/api/sales/orders/${await pedido(topPedidoSemPartes)}/proximos-passos`, headers: h.headers() }));
    expect((pp.items as { emPartes: boolean }[]).map((x) => x.emPartes)).toEqual([false]);
    const ppEm = j(await h.app.inject({ method: "GET", url: `/api/sales/orders/${await pedido(topPedidoEmPartes)}/proximos-passos`, headers: h.headers() }));
    expect((ppEm.items as { emPartes: boolean; tipoOperacaoId: string }[])).toMatchObject([{ tipoOperacaoId: topVenda, emPartes: true }]);

    const id = await pedido(topPedidoSemPartes);
    const [item] = await itensDe(id);
    const r = await converter(id, [{ item_id: item!.id, quantidade: "4" }]);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: "Esta operação não permite converter em partes." });
    expect([await statusDe(id), await derivados(id)]).toEqual(["open", 0]);
    // PREMISSA: o mesmo pedido, sem itens, converte inteiro — e o derivado NÃO é parte (sem ligação).
    const venda = await parte(id);
    expect(await statusDe(id)).toBe("converted");
    const v = await ler("sales", venda);
    expect(v.items.map((i) => [i.quantity, i.origem_item_id])).toEqual([["10.0000", null]]);
    expect((await ler("orders", id)).items[0]).not.toHaveProperty("faturado");
  });

  it("FP-1 ponte legada (pedido sem TOP): itens → 422; sem itens converte", async () => {
    const id = await pedido(null);
    const [item] = await itensDe(id);
    const r = await converter(id, [{ item_id: item!.id, quantidade: "1" }], undefined, null);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Esta operação não permite converter em partes.");
    expect((await converter(id, undefined, undefined, null)).statusCode).toBe(201);
  });

  it("FP-1 corpo estrito: chave desconhecida → 422", async () => {
    const id = await pedido(topPedidoEmPartes);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/orders/${id}/convert`, headers: h.headers(), payload: { tipo_operacao_id: topVenda, iten: [] } });
    expect(r.statusCode, r.body).toBe(422);
    expect(await derivados(id)).toBe(0);
  });
});

describe("FP-2 — o saldo anda parte a parte", () => {
  it("FP-2 pedido de 10 → parte 4 (pedido segue open, saldo 6) → parte do saldo inteiro 6 (converted, saldo 0)", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const p1 = await parte(id, [{ item_id: item!.id, quantidade: 4 }]);
    expect(await statusDe(id)).toBe("open");
    expect(await ligado(item!.id)).toBe("4.0000");
    const lido = (await ler("orders", id)).items[0]!;
    expect([lido.faturado, lido.saldo]).toEqual(["4.0000", "6.0000"]);
    const v1 = await ler("sales", p1);
    expect(v1.items.map((i) => [i.quantity, i.origem_item_id])).toEqual([["4.0000", item!.id]]);
    expect(Number(v1.total)).toBe(20);

    await parte(id); // sem itens = o saldo inteiro
    expect(await statusDe(id)).toBe("converted");
    const fim = (await ler("orders", id)).items[0]!;
    expect([fim.faturado, fim.saldo]).toEqual(["10.0000", "0.0000"]);
    const aud = (await admin.query<{ metadata: { emPartes?: boolean; zeraOSaldo?: boolean; itens?: unknown[] } }>(
      "select metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='convert' order by created_at, id", [id])).rows;
    expect(aud.map((a) => [a.metadata.emPartes, a.metadata.zeraOSaldo])).toEqual([[true, false], [true, true]]);
    expect(aud[0]!.metadata.itens).toEqual([{ origemItemId: item!.id, quantidade: "4.0000" }]);
  });
});

describe("FP-3 — acima do saldo", () => {
  it("FP-3 quantidade acima do saldo, item de outro documento, repetido e quantidade inválida → 422 sem efeito", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const [alheio] = await itensDe(await pedido(topPedidoEmPartes));
    const casos: [ItemDaParte[], string][] = [
      [[{ item_id: item!.id, quantidade: "10.0001" }], "A quantidade é maior que o saldo do item."],
      [[{ item_id: alheio!.id, quantidade: "1" }], "O item informado não é deste documento."],
      [[{ item_id: item!.id, quantidade: "1" }, { item_id: item!.id, quantidade: "1" }], "O mesmo item foi informado mais de uma vez."],
      [[{ item_id: item!.id, quantidade: "0" }], "A quantidade deve ser maior que zero, com no máximo 4 casas decimais."],
      [[{ item_id: item!.id, quantidade: "1.00001" }], "A quantidade deve ser maior que zero, com no máximo 4 casas decimais."],
      [[], "Escolha pelo menos um item com saldo para converter."],
    ];
    for (const [itens, mensagem] of casos) {
      const r = await converter(id, itens);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem });
    }
    expect([await statusDe(id), await derivados(id)]).toEqual(["open", 0]);
    // PREMISSA: exatamente o saldo passa.
    await parte(id, [{ item_id: item!.id, quantidade: "10" }]);
    expect(await statusDe(id)).toBe("converted");
  });

  it("FP-3 inserção DIRETA acima do saldo, como o papel da aplicação → o gatilho recusa", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const venda = await parte(id, [{ item_id: item!.id, quantidade: "7" }]);
    const cli = await h.db.connect();
    try {
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)", [h.demo.orgId, h.demo.adminUserId]);
      // PREMISSA: dentro do saldo (3) o papel da aplicação insere.
      await cli.query("savepoint s");
      await cli.query("insert into erp.sales_document_items(document_id,product_id,quantity,unit_price,total,position,origem_item_id) values ($1,$2,3,5,15,9,$3)", [venda, I.product2, item!.id]);
      await cli.query("rollback to savepoint s");
      await expect(cli.query("insert into erp.sales_document_items(document_id,product_id,quantity,unit_price,total,position,origem_item_id) values ($1,$2,4,5,20,9,$3)", [venda, I.product2, item!.id]))
        .rejects.toThrow(/passa do saldo/);
      await cli.query("rollback");
    } finally { cli.release(); }
    expect(await ligado(item!.id)).toBe("7.0000");
  });
});

describe("FP-4 — concorrência", () => {
  it("FP-4 duas conversões simultâneas de 6 sobre saldo 10 → uma passa, a outra 422; a soma nunca é 12", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const rs = await Promise.all([converter(id, [{ item_id: item!.id, quantidade: "6" }]), converter(id, [{ item_id: item!.id, quantidade: "6" }])]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect(j(rs.find((r) => r.statusCode === 422)!).error!.message).toBe("A quantidade é maior que o saldo do item.");
    expect(await ligado(item!.id)).toBe("6.0000");
    expect(await derivados(id)).toBe(1);
  });
});

describe("FP-5 / FP-12 — cancelar parte, confirmar parte", () => {
  it("FP-5 cancelar parte ABERTA devolve o saldo; pedido segue open", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const p = await parte(id, [{ item_id: item!.id, quantidade: "4" }]);
    expect((await cancelar("sales", p)).statusCode).toBe(200);
    expect(Number(await ligado(item!.id))).toBe(0);
    expect(await statusDe(id)).toBe("open");
    const lido = (await ler("orders", id)).items[0]!;
    expect([lido.faturado, lido.saldo]).toEqual(["0.0000", "10.0000"]);
  });

  it("FP-5 + FP-12 parte CONFIRMADA (TOP de venda formato 3) que zerou o saldo: cancelar estorna e o pedido volta a open", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const p1 = await parte(id, [{ item_id: item!.id, quantidade: "4" }]);
    const p2 = await parte(id);
    expect(await statusDe(id)).toBe("converted");
    for (const p of [p1, p2]) {
      const r = await ligada.inject({ method: "POST", url: `/api/sales/sales/${p}/confirm`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(await statusDe(p2)).toBe("confirmed");
    const mov = async (p: string) => (await admin.query<{ movement_type: string; quantity: string }>("select movement_type, quantity::text from erp.stock_movements where source_type='sales_documents' and source_id=$1 order by created_at", [p])).rows;
    expect((await mov(p2)).map((m) => [m.movement_type, Number(m.quantity)])).toEqual([["sale", 6]]);
    const titulosAtivos = async (p: string) => Number((await admin.query<{ n: string }>("select count(*)::text n from erp.financial_titles where source_type='sales_documents' and source_id=$1 and status<>'cancelled'", [p])).rows[0]!.n);
    expect(await titulosAtivos(p2)).toBe(1);

    const r = await cancelar("sales", p2);
    expect(r.statusCode, r.body).toBe(200);
    expect((await mov(p2)).map((m) => m.movement_type)).toEqual(["sale", "reversal"]);
    expect(await titulosAtivos(p2)).toBe(0);
    expect(await statusDe(id)).toBe("open");
    expect(await ligado(item!.id)).toBe("4.0000");
    const aud = (await admin.query<{ metadata: { parte: string }; after: { status: string } }>("select metadata, after from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='parte_cancelada'", [id])).rows;
    expect(aud).toEqual([{ metadata: { parte: p2 }, after: { status: "open" } }]);
    // O saldo devolvido converte de novo.
    await parte(id);
    expect(await statusDe(id)).toBe("converted");
  });
});

describe("FP-6 — encerrar saldo", () => {
  it("FP-6 encerra com motivo; não converte mais; cancelar parte depois mantém encerrado", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    // Sem parte: recusa clara.
    const sem = await encerrar(id, { motivo: "Cliente desistiu" });
    expect(sem.statusCode, sem.body).toBe(422);
    expect(j(sem).error!.message).toBe("Este documento não tem partes geradas.");
    for (const corpo of [{}, { motivo: "   " }, { motivo: "x".repeat(501) }, { motivo: "ok", outro: 1 }]) {
      expect((await encerrar(id, corpo)).statusCode, JSON.stringify(corpo)).toBe(422);
    }
    const p = await parte(id, [{ item_id: item!.id, quantidade: "4" }]);
    const r = await encerrar(id, { motivo: "  Cliente desistiu  " }, "encerrar-fp6");
    expect(r.statusCode, r.body).toBe(200);
    // Replay da mesma chave → mesma resposta, sem segundo efeito.
    const replay = await encerrar(id, { motivo: "Cliente desistiu" }, "encerrar-fp6");
    expect([replay.statusCode, replay.body]).toEqual([200, r.body]);
    const d = await ler("orders", id);
    expect(d).toMatchObject({ status: "converted", saldo_encerrado_motivo: "Cliente desistiu", saldo_encerrado_por: h.demo.adminUserId });
    expect(d.saldo_encerrado_em).toBeTruthy();
    expect(typeof d.saldo_encerrado_por_nome).toBe("string");
    expect(d.items[0]).toMatchObject({ faturado: "4.0000", saldo: "6.0000" });
    expect(Number((await admin.query<{ n: string }>("select count(*)::text n from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='encerrar_saldo'", [id])).rows[0]!.n)).toBe(1);
    // Não converte mais; não encerra de novo.
    expect((await converter(id, [{ item_id: item!.id, quantidade: "1" }])).statusCode).not.toBe(201);
    expect((await converter(id)).statusCode).not.toBe(201);
    expect(j(await encerrar(id, { motivo: "de novo" })).error!.code).toBe("INVALID_STATUS_TRANSITION");
    // Cancelar a parte depois: o saldo volta na conta, mas o documento continua encerrado.
    expect((await cancelar("sales", p)).statusCode).toBe(200);
    expect(await statusDe(id)).toBe("converted");
    expect((await admin.query("select 1 from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='parte_cancelada'", [id])).rowCount).toBe(0);
  });
});

describe("FP-7 — a origem com partes", () => {
  it("FP-7 PUT e cancelamento da origem com parte ativa → recusados; só com parte cancelada o PUT continua recusado e o cancelamento passa", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const p = await parte(id, [{ item_id: item!.id, quantidade: "4" }]);
    const put = () => h.app.inject({ method: "PUT", url: `/api/sales/orders/${id}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM("20")] } });
    const r1 = await put();
    expect(r1.statusCode, r1.body).toBe(409);
    expect(j(r1).error).toMatchObject({ code: "INVALID_STATUS_TRANSITION", message: "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo." });
    const c1 = await cancelar("orders", id);
    expect(c1.statusCode, c1.body).toBe(409);
    expect(j(c1).error).toMatchObject({ code: "INVALID_STATUS_TRANSITION", message: "Cancele antes as partes geradas deste documento, ou encerre o saldo." });
    expect(await statusDe(id)).toBe("open");
    expect((await cancelar("sales", p)).statusCode).toBe(200);
    const r2 = await put();
    expect(r2.statusCode, r2.body).toBe(409);
    expect(j(r2).error!.message).toBe("Este documento já teve partes geradas; os itens não podem mais ser trocados.");
    expect((await itensDe(id))[0]!.quantity).toBe("10.0000");
    expect((await cancelar("orders", id)).statusCode).toBe(200);
  });
});

describe("FP-8 — PUT da parte", () => {
  it("FP-8 armazém e observação mudam; quantidade, produto ou preço → 422; ligação preservada", async () => {
    const id = await pedido(topPedidoEmPartes, [ITEM("10", "5.00"), ITEM("5", "8.00", { product_id: I.product! })]);
    const itens = await itensDe(id);
    const p = await parte(id, [{ item_id: itens[0]!.id, quantidade: "3" }, { item_id: itens[1]!.id, quantidade: "2" }]);
    const codigoPedido = (await ler("orders", id)).code;
    const v = await ler("sales", p);
    const base = v.items.map((i) => ({ product_id: i.product_id as string, warehouse_id: i.warehouse_id as string | null, quantity: i.quantity, unit_price: i.unit_price as string, discount: i.discount as string, discount_percent: i.discount_percent as string, note: i.note as string | null }));
    const put = (items: typeof base) => h.app.inject({ method: "PUT", url: `/api/sales/sales/${p}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-12", client_id: I.client, items } });
    const ok = await put(base.map((i, k) => ({ ...i, warehouse_id: I.warehouse2!, note: `obs ${k}`, quantity: `${Number(i.quantity)}` })));
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = await ler("sales", p);
    expect(depois.items.map((i) => [i.warehouse_id, i.note, i.origem_item_id])).toEqual([[I.warehouse2, "obs 0", itens[0]!.id], [I.warehouse2, "obs 1", itens[1]!.id]]);
    const mensagem = `Os itens desta venda vieram do pedido ${codigoPedido}. Para mudar, cancele esta venda e gere de novo.`;
    const recusas = [
      base.map((i, k) => (k === 0 ? { ...i, quantity: "2" } : i)),
      base.map((i, k) => (k === 0 ? { ...i, product_id: I.productLot! } : i)),
      base.map((i, k) => (k === 1 ? { ...i, unit_price: "9.00" } : i)),
      base.map((i, k) => (k === 1 ? { ...i, discount: "1.00" } : i)),
      [...base].reverse(),
      base.slice(0, 1),
    ];
    for (const items of recusas) {
      const r = await put(items);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem });
    }
    expect((await ler("sales", p)).items.map((i) => i.origem_item_id)).toEqual([itens[0]!.id, itens[1]!.id]);
  });
});

describe("FP-9 — valores proporcionais", () => {
  it("FP-9 frete, ICMS do frete, outros, desconto do cabeçalho, desconto do item e entrada: proporcionais, o resto na última parte", async () => {
    const id = await pedido(topPedidoEmPartes, [ITEM("3", "100.00", { discount: "10.00" })], {
      freight: "100.00", freight_icms: "7.00", other_values: "1.00", discount: "10.00",
      installment_plan: { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: true, down_payment_value: "50.00", down_payment_date: "2026-09-15" } });
    const [item] = await itensDe(id);
    const partes = [] as string[];
    for (let k = 0; k < 3; k++) partes.push(await parte(id, [{ item_id: item!.id, quantidade: "1" }]));
    expect(await statusDe(id)).toBe("converted");
    const r = (await admin.query<{ id: string; freight: string; freight_icms: string; other_values: string; discount: string; item_discount: string; entrada: string; installments: string }>(
      `select d.id, d.freight::text, d.freight_icms::text, d.other_values::text, d.discount::text, i.discount::text as item_discount,
              d.installment_plan->>'down_payment_value' as entrada, d.installment_plan->>'installments' as installments
         from erp.sales_documents d join erp.sales_document_items i on i.document_id = d.id where d.id = any($1::uuid[])`, [partes])).rows;
    const porId = new Map(r.map((x) => [x.id, x]));
    const [a, b, c] = partes.map((p) => porId.get(p)!);
    // Parte 1 e 2: proporção arredondada (96,67 / 290). Parte 3: o resto.
    expect([a!.freight, a!.freight_icms, a!.other_values, a!.discount, a!.item_discount, a!.entrada]).toEqual(["33.33", "2.33", "0.33", "3.33", "3.33", "16.67"]);
    expect([b!.freight, b!.discount, b!.item_discount, b!.entrada]).toEqual([a!.freight, a!.discount, a!.item_discount, a!.entrada]);
    expect([c!.freight, c!.freight_icms, c!.other_values, c!.discount, c!.item_discount, c!.entrada]).toEqual(["33.34", "2.34", "0.34", "3.34", "3.34", "16.66"]);
    const soma = (k: "freight" | "freight_icms" | "other_values" | "discount" | "item_discount" | "entrada") => [a, b, c].reduce((s, x) => s + Math.round(Number(x![k]) * 100), 0) / 100;
    expect([soma("freight"), soma("freight_icms"), soma("other_values"), soma("discount"), soma("item_discount"), soma("entrada")]).toEqual([100, 7, 1, 10, 10, 50]);
    expect([a!.installments, c!.installments]).toEqual(["2", "2"]);
  });

  it("FP-9 com condição de pagamento: a parte recalcula pela condição (plano não copiado, não ajustado)", async () => {
    const cond = (await admin.query<{ id: string }>(
      "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,'FP9','Condição FP-9',2,30,'intervalo',30,false) returning id",
      [h.demo.orgId])).rows[0]!.id;
    const id = await pedido(topPedidoEmPartes, [ITEM("10", "10.00")], { condicao_pagamento_id: cond });
    const [item] = await itensDe(id);
    const p = await parte(id, [{ item_id: item!.id, quantidade: "4" }]);
    const x = (await admin.query<{ condicao_pagamento_id: string; parcelas_ajustadas: boolean; total: string; installments: string }>(
      "select condicao_pagamento_id, parcelas_ajustadas, total::text, installment_plan->>'installments' as installments from erp.sales_documents where id=$1", [p])).rows[0]!;
    expect(x).toEqual({ condicao_pagamento_id: cond, parcelas_ajustadas: false, total: "40.00", installments: "2" });
  });
});

describe("FP-10 — idempotência", () => {
  it("FP-10 mesma chave com os mesmos itens (outra forma) → mesma resposta; itens diferentes → conflito", async () => {
    const id = await pedido(topPedidoEmPartes);
    const [item] = await itensDe(id);
    const r1 = await converter(id, [{ item_id: item!.id, quantidade: "4" }], "fp10-chave");
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await converter(id, [{ item_id: item!.id, quantidade: 4.0 }], "fp10-chave");
    expect([r2.statusCode, j(r2).id]).toEqual([201, j(r1).id]);
    const r3 = await converter(id, [{ item_id: item!.id, quantidade: "5" }], "fp10-chave");
    expect(r3.statusCode, r3.body).toBe(409);
    expect(j(r3).error!.code).toBe("CONFLICT");
    expect(await derivados(id)).toBe(1);
    expect(await ligado(item!.id)).toBe("4.0000");
  });
});

describe("FP-13 — a espécie da origem nas mensagens (TOP-CONFIG-07, revisão da 06)", () => {
  const orcamento = async (topId: string, items: ItemPedido[] = [ITEM()]) => {
    const r = await h.app.inject({ method: "POST", url: "/api/sales/budgets", headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items, tipo_operacao_id: topId } });
    expect(r.statusCode, r.body).toBe(201);
    return j(r).id as string;
  };
  const parteDoOrcamento = async (id: string, itemId: string, destino: string) => {
    const r = await h.app.inject({ method: "POST", url: `/api/sales/budgets/${id}/convert`, headers: h.headers(),
      payload: { tipo_operacao_id: destino, itens: [{ item_id: itemId, quantidade: "4" }] } });
    expect(r.statusCode, r.body).toBe(201);
    return j(r) as { id: string; kind: string };
  };
  const quantidadesNoBanco = async (docId: string) => (await admin.query<{ quantity: string }>(
    "select quantity::text from erp.sales_document_items where document_id=$1 order by position", [docId])).rows.map((x) => x.quantity);

  it("FP-13 orçamento → PEDIDO em partes: o PUT da parte diz 'deste pedido … do orçamento'; o PUT da origem diz que os itens não trocam mais", async () => {
    const topOrcamento = await criarTop(h.app, "vendas.orcamento", "Orçamento em partes → pedido");
    await arestaNaVersaoNova(topOrcamento, topPedidoSemPartes, true);
    const id = await orcamento(topOrcamento);
    const origem = await ler("budgets", id);
    const p = await parteDoOrcamento(id, origem.items[0]!.id, topPedidoSemPartes);
    expect(p.kind).toBe("order");

    const r = await h.app.inject({ method: "PUT", url: `/api/sales/orders/${p.id}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-12", client_id: I.client, items: [ITEM("3")] } });
    expect(r.statusCode, r.body).toBe(422);
    const mensagem = `Os itens deste pedido vieram do orçamento ${origem.code}. Para mudar, cancele este pedido e gere de novo.`;
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem, details: [{ path: "items", message: mensagem }] });
    expect(await quantidadesNoBanco(p.id)).toEqual(["4.0000"]);

    const o = await h.app.inject({ method: "PUT", url: `/api/sales/budgets/${id}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM("20")] } });
    expect(o.statusCode, o.body).toBe(409);
    expect(j(o).error).toMatchObject({ code: "INVALID_STATUS_TRANSITION",
      message: "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo." });
    expect(await quantidadesNoBanco(id)).toEqual(["10.0000"]);
  });

  it("FP-13 orçamento → VENDA em partes: o PUT da parte diz 'desta venda … do orçamento'", async () => {
    const topOrcamento = await criarTop(h.app, "vendas.orcamento", "Orçamento em partes → venda");
    await arestaNaVersaoNova(topOrcamento, topVenda, true);
    const id = await orcamento(topOrcamento);
    const origem = await ler("budgets", id);
    const p = await parteDoOrcamento(id, origem.items[0]!.id, topVenda);
    expect(p.kind).toBe("sale");
    const r = await h.app.inject({ method: "PUT", url: `/api/sales/sales/${p.id}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-12", client_id: I.client, items: [ITEM("3")] } });
    expect(r.statusCode, r.body).toBe(422);
    const mensagem = `Os itens desta venda vieram do orçamento ${origem.code}. Para mudar, cancele esta venda e gere de novo.`;
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem, details: [{ path: "items", message: mensagem }] });
    expect(await quantidadesNoBanco(p.id)).toEqual(["4.0000"]);
  });
});
