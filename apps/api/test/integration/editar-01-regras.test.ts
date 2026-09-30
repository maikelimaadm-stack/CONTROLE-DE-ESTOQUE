import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import {
  configuracaoNeutraTopV3, ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA,
  MENSAGEM_CONDICAO_NAO_PERMITIDA, ERRO_CLIENTE_EM_ATRASO, type ConfiguracaoTipoOperacaoV3,
} from "@agro/domain";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * EDITAR-01 (decisão 272) — A PATCH SOB AS REGRAS DE HOJE: ED-3, ED-4, ED-5.
 *
 *   · ED-3 a versão: errada → 409 sem gravar; duas PATCH simultâneas com a mesma versão → uma 200 e uma 409;
 *          confirmar, cancelar e converter aumentam a versão (a PATCH com a de antes → 409 CONCURRENCY_CONFLICT);
 *   · ED-4 as recusas do PUT valem na PATCH com a mensagem de hoje: situação, sem TOP, origem com partes, parte
 *          gerada (só armazém e observação do item), reserva (armazém da parte; disponível do pedido) e as
 *          exigências da versão CONGELADA;
 *   · ED-5 condição: só conferida quando a PATCH a TROCA, e pela versão CONGELADA; cliente em atraso: só quando a
 *          PATCH troca o cliente.
 *
 * TOP com versão NOVA do formato 3: gravada por SQL de superusuário (como em top-config-05-vendas). Partes e reserva:
 * TOPs pela API com `destinos`/`reservaEstoque` (como em top-config-07-reserva-de-estoque).
 * TESTEMUNHA: o banco, lido sem RLS. "Sem gravar" = a linha do documento, os itens e os eventos idênticos.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;
type Variante = keyof typeof ROTA;
let tops: Record<Variante, string>;
let topPedidoEmPartes: string; let topPedidoComReserva: string;
let clientePadrao: string;
let nomeArmazem: string; let baseProduto: Record<string, unknown>;

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  // Estoque para as confirmações de venda desta suíte (cada venda consome 1).
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  tops = { budget: await criarTop("budget", "ED orçamento"), order: await criarTop("order", "ED pedido"), sale: await criarTop("sale", "ED venda") };
  topPedidoEmPartes = await criarTop("order", "ED pedido em partes", { destinos: [{ tipoOperacaoId: tops.sale, ordem: 0, emPartes: true }] });
  topPedidoComReserva = await criarTop("order", "ED pedido com reserva", { reservaEstoque: true, destinos: [{ tipoOperacaoId: tops.sale, ordem: 0, emPartes: true }] });
  clientePadrao = await cliente();
  nomeArmazem = (await admin.query<{ description: string }>("select description from erp.warehouses where id=$1", [I.warehouse])).rows[0]!.description;
  const grupo = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!.id;
  const un = (await admin.query<{ id: string }>("select id from erp.measurement_units where (organization_id is null or organization_id=$1) and upper(symbol)='UN' order by organization_id nulls last limit 1", [h.demo.orgId])).rows[0]!.id;
  baseProduto = { group_id: grupo, measurement_id: un, financial_category_id: I.category };
}, 180_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Detalhe = { path: string; message: string };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
type Linha = Record<string, unknown>;

let seq = 0;
async function criarTop(kind: Variante, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `ED3${String(++seq).padStart(3, "0")}`, codigoBase: FAMILIA[kind], nome: `${nome} ${seq}`, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
/** Versão N+1 da TOP, do formato 3, gravada por SQL e feita a atual (com as condições permitidas dadas). */
async function novaVersao(topId: string, config: ConfiguracaoTipoOperacaoV3, condicoes: string[] = []): Promise<string> {
  const v = (await admin.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.descricao, v.criado_por, $2::jsonb, 3, v.destinos_configurados
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 returning id`, [topId, JSON.stringify(config)])).rows[0]!.id;
  expect((await admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [topId])).rowCount).toBe(1);
  for (const c of condicoes) {
    await admin.query("insert into erp.tipos_operacao_versao_condicoes(organization_id,origem_versao_id,origem_tipo_operacao_id,condicao_pagamento_id) values ($1,$2,$3,$4)", [h.demo.orgId, v, topId, c]);
  }
  return v;
}
function cfg(ajuste: (c: ConfiguracaoTipoOperacaoV3) => void): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  ajuste(c);
  return c;
}
/** Cliente PRÓPRIO da suíte: nenhum título herdado do seed (nem das vendas confirmadas aqui) decide o atraso. */
let seqCliente = 0;
async function cliente(): Promise<string> {
  const n = ++seqCliente;
  return (await admin.query<{ id: string }>(
    "insert into erp.people(organization_id,code,document,person_type,name,legal_name,city_id,is_client) values ($1,$2,$3,'legal',$4,$4,5208707,true) returning id",
    [h.demo.orgId, `ED3${n}`, `992720000000${String(n).padStart(2, "0")}`, `[TEST] Cliente ED ${n}`])).rows[0]!.id;
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,1,30,'intervalo',30,null,false,null,true) returning id",
    [h.demo.orgId, `ED3-${n}`, `Condição ED3 ${n}`])).rows[0]!.id;
}

type Item = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string; note?: string | null };
const ITEM = (o: Partial<Item> = {}): Item => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "10.00", ...o });
async function criar(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: clientePadrao, tipo_operacao_id: tops[kind], items: [ITEM()], ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
type Hdr = Record<string, string>;
const patch = (kind: Variante, id: string, payload: Record<string, unknown>, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "PATCH", url: `/api/sales/${ROTA[kind]}/${id}`, headers, payload });
async function membro(rotulo: string, permissoes: string[]): Promise<Hdr> {
  const sufixo = `${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `${rotulo} ${sufixo}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `ed3-${sufixo}@teste.local`;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: rotulo, email, password: "Editar@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Editar@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
async function ler(kind: Variante, id: string): Promise<Linha & { version: string; code: string; items: (Linha & { id: string })[] }> {
  const r = await h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as Linha & { version: string; code: string; items: (Linha & { id: string })[] };
}
const acao = async (url: string, payload: Record<string, unknown> = {}) => {
  const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
  expect(r.statusCode, `${url}: ${r.body}`).toBeLessThan(300);
  return j(r);
};
const confirmar = (id: string) => acao(`/api/sales/sales/${id}/confirm`);
const cancelar = (kind: Variante, id: string) => acao(`/api/sales/${ROTA[kind]}/${id}/cancel`);
const converter = (kind: "budget" | "order", id: string, payload: Record<string, unknown> = {}) => acao(`/api/sales/${ROTA[kind]}/${id}/convert`, payload);

// ---------- testemunhas no banco (superusuário, sem RLS) ----------
const linha = async (id: string) => (await admin.query<Linha>("select * from erp.sales_documents where id=$1", [id])).rows[0]!;
const itens = async (id: string) => (await admin.query<Linha & { id: string }>("select * from erp.sales_document_items where document_id=$1 order by position, id", [id])).rows;
type Evento = { id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; metadata: Record<string, unknown> | null };
const eventos = async (id: string) => (await admin.query<Evento>(
  "select a.id::text as id, a.action, a.before, a.after, a.metadata from erp.audit_logs a where a.entity='sales_documents' and a.entity_id=$1 order by a.id", [id])).rows;
const foto = async (id: string) => ({ doc: await linha(id), itens: await itens(id), eventos: await eventos(id) });
const versaoGravada = async (id: string) => (await linha(id)).version as string;
/** Eventos `update` da EDIÇÃO — não a foto inteira que o gatilho `erp.audit_row` (0005) grava a cada update da linha. */
const updates = async (id: string) => (await eventos(id)).filter((e) => e.action === "update" && !(e.after !== null && "organization_id" in e.after)).length;
const detalhes = (r: Resposta) => (j(r).error?.details ?? []) as Detalhe[];

const MSG_VERSAO = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";
const MSG_NAO_EDITAVEL = "Documento não editável neste status";
const MSG_SEM_TOP = "Este documento não tem tipo de operação (registro anterior às operações) e não pode ser editado.";
const MSG_PARTES_ATIVAS = "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo.";
const MSG_PARTES_CANCELADAS = "Este documento já teve partes geradas; os itens não podem mais ser trocados.";
const MSG_PARTE_RESERVA_ARMAZEM = "O armazém deste item vem do pedido de origem, que reserva estoque no armazém de cada item: não pode ser trocado. Para mudar, cancele esta venda e gere de novo.";

/** Recusa esperada: status e erro exatos, e a foto do banco intacta. */
async function recusada(kind: Variante, id: string, payload: Record<string, unknown>, status: number, erro: Partial<Erro>, rotulo: string, headers: Hdr = h.headers()) {
  const antes = await foto(id);
  const r = await patch(kind, id, payload, headers);
  expect(r.statusCode, `${rotulo}: ${r.body}`).toBe(status);
  expect(j(r).error, rotulo).toMatchObject(erro);
  expect(await foto(id), `${rotulo}: nada gravado`).toEqual(antes);
  return r;
}

describe("ED-3 — a versão", () => {
  it("ED-3 versão errada (acima, abaixo) → 409 CONCURRENCY_CONFLICT com a mensagem, sem gravar (linha, itens e eventos idênticos)", async () => {
    const id = await criar("order", { note: "original" });
    // Uma PATCH válida antes: a versão passa de 0 e "abaixo" também é testável.
    const ok = await patch("order", id, { version: await versaoGravada(id), note: "primeira" });
    expect(ok.statusCode, ok.body).toBe(200);
    const v = Number(await versaoGravada(id));
    expect(v).toBeGreaterThan(0);
    for (const errada of [String(v + 1), v + 7, String(v - 1), 0]) {
      await recusada("order", id, { version: errada, note: "não grava" }, 409, { code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO }, `versão ${errada}`);
    }
    expect((await linha(id)).note).toBe("primeira");
  });

  it("ED-3 duas PATCH com a mesma versão AO MESMO TEMPO → exatamente uma 200 e uma 409; a versão sobe 1 e um evento só (3 rodadas)", async () => {
    for (let rodada = 1; rodada <= 3; rodada++) {
      const id = await criar("order", { note: "original" });
      const v = await versaoGravada(id);
      const eventosAntes = await updates(id);
      const [ra, rb] = await Promise.all([patch("order", id, { version: v, note: `A${rodada}` }), patch("order", id, { version: v, note: `B${rodada}` })]);
      expect([ra.statusCode, rb.statusCode].sort(), `rodada ${rodada}: ${ra.body} · ${rb.body}`).toEqual([200, 409]);
      const [vencedora, perdedora, nota] = ra.statusCode === 200 ? [ra, rb, `A${rodada}`] : [rb, ra, `B${rodada}`];
      expect(j(perdedora).error, `rodada ${rodada}`).toMatchObject({ code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO });
      expect(j(vencedora).version).toBe(String(Number(v) + 1));
      const d = await linha(id);
      expect([d.version, d.note], `rodada ${rodada}`).toEqual([String(Number(v) + 1), nota]);
      expect(await updates(id) - eventosAntes, `rodada ${rodada}: um evento só`).toBe(1);
    }
  });

  it("ED-3 confirmar a venda aumenta a versão; a PATCH com a versão de antes → 409 CONCURRENCY_CONFLICT (a versão vem ANTES da situação)", async () => {
    const id = await criar("sale");
    const v = await versaoGravada(id);
    await confirmar(id);
    const depois = await ler("sale", id);
    expect(depois.status).toBe("confirmed");
    expect(Number(depois.version)).toBeGreaterThan(Number(v));
    await recusada("sale", id, { version: v, note: "tarde demais" }, 409, { code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO }, "venda confirmada, versão de antes");
  });

  it("ED-3 cancelar (orçamento, pedido e venda) aumenta a versão; a PATCH com a versão de antes → 409 CONCURRENCY_CONFLICT", async () => {
    for (const kind of ["budget", "order", "sale"] as const) {
      const id = await criar(kind);
      const v = await versaoGravada(id);
      await cancelar(kind, id);
      const depois = await ler(kind, id);
      expect(depois.status, kind).toBe("cancelled");
      expect(Number(depois.version), kind).toBeGreaterThan(Number(v));
      await recusada(kind, id, { version: v, note: "tarde demais" }, 409, { code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO }, `${kind} cancelado`);
    }
  });

  it("ED-3 converter (orçamento → pedido, pedido → venda) aumenta a versão da origem; a PATCH com a versão de antes → 409 CONCURRENCY_CONFLICT", async () => {
    for (const [kind, destino] of [["budget", tops.order], ["order", tops.sale]] as const) {
      const id = await criar(kind);
      const v = await versaoGravada(id);
      await converter(kind, id, { tipo_operacao_id: destino });
      const depois = await ler(kind, id);
      expect(depois.status, kind).toBe("converted");
      expect(Number(depois.version), kind).toBeGreaterThan(Number(v));
      await recusada(kind, id, { version: v, note: "tarde demais" }, 409, { code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO }, `${kind} convertido`);
    }
  });
});

describe("ED-4 — as regras do PUT valem na PATCH, com a mensagem de hoje", () => {
  it("ED-4 situação: venda confirmada, documentos cancelados e orçamento convertido → 409 'Documento não editável neste status' com a versão ATUAL; documento sem TOP → 409 com a mensagem própria; nada gravado", async () => {
    const confirmada = await criar("sale");
    await confirmar(confirmada);
    const casos: [Variante, string, string][] = [["sale", confirmada, "venda confirmada"]];
    for (const kind of ["budget", "order", "sale"] as const) {
      const id = await criar(kind);
      await cancelar(kind, id);
      casos.push([kind, id, `${kind} cancelado`]);
    }
    const convertido = await criar("budget");
    await converter("budget", convertido, { tipo_operacao_id: tops.order });
    casos.push(["budget", convertido, "orçamento convertido"]);
    for (const [kind, id, rotulo] of casos) {
      await recusada(kind, id, { version: await versaoGravada(id), note: "não edita" }, 409, { code: "INVALID_STATUS_TRANSITION", message: MSG_NAO_EDITAVEL }, rotulo);
    }
    expect(casos).toHaveLength(5);
    // Documento LEGADO (sem TOP), aberto: a PATCH recusa com a mensagem própria (o PUT continua aceitando).
    const legado = await criar("order", { tipo_operacao_id: undefined });
    expect((await linha(legado)).tipo_operacao_id, "premissa: nasceu sem TOP").toBeNull();
    await recusada("order", legado, { version: await versaoGravada(legado), note: "não edita" }, 409, { code: "INVALID_STATUS_TRANSITION", message: MSG_SEM_TOP }, "sem TOP");
    const put = await h.app.inject({ method: "PUT", url: `/api/sales/orders/${legado}`, headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: clientePadrao, items: [ITEM()], note: "pelo PUT" } });
    expect(put.statusCode, put.body).toBe(200);
  });

  it("ED-4 origem com partes: ativa → 409 com a mensagem de hoje; só canceladas → 409 com a outra; nada gravado (nem só a observação)", async () => {
    const id = await criar("order", { tipo_operacao_id: topPedidoEmPartes, items: [ITEM({ quantity: "10" })] });
    const [item] = (await ler("order", id)).items;
    const parte = (await converter("order", id, { tipo_operacao_id: tops.sale, itens: [{ item_id: item!.id, quantidade: "4" }] })).id as string;
    expect((await linha(id)).status, "premissa: a origem segue aberta").toBe("open");
    await recusada("order", id, { version: await versaoGravada(id), note: "só a observação" }, 409, { code: "INVALID_STATUS_TRANSITION", message: MSG_PARTES_ATIVAS }, "parte ativa");
    await recusada("order", id, { version: await versaoGravada(id), items: [{ id: item!.id, quantity: "20" }] }, 409, { code: "INVALID_STATUS_TRANSITION", message: MSG_PARTES_ATIVAS }, "parte ativa, itens");
    await cancelar("sale", parte);
    await recusada("order", id, { version: await versaoGravada(id), note: "só a observação" }, 409, { code: "INVALID_STATUS_TRANSITION", message: MSG_PARTES_CANCELADAS }, "só parte cancelada");
    expect((await itens(id)).map((x) => x.quantity)).toEqual(["10.0000"]);
  });

  it("ED-4 parte gerada: observação e armazém do item mudam (ligação preservada); quantidade, preço, produto, item novo ou item omitido → 422 com a mensagem de hoje", async () => {
    const id = await criar("order", { tipo_operacao_id: topPedidoEmPartes, items: [ITEM({ quantity: "10", unit_price: "5.00" }), ITEM({ product_id: I.product!, quantity: "5", unit_price: "8.00" })] });
    const origem = await ler("order", id);
    const [o1, o2] = origem.items;
    const parte = (await converter("order", id, { tipo_operacao_id: tops.sale, itens: [{ item_id: o1!.id, quantidade: "3" }, { item_id: o2!.id, quantidade: "2" }] })).id as string;
    const [p1, p2] = await itens(parte);
    expect([p1!.origem_item_id, p2!.origem_item_id], "premissa: a parte está ligada à origem").toEqual([o1!.id, o2!.id]);
    const mensagem = `Os itens desta venda vieram do pedido ${origem.code}. Para mudar, cancele esta venda e gere de novo.`;
    const recusas: [string, unknown[]][] = [
      ["quantidade", [{ id: p1!.id, quantity: "2" }, { id: p2!.id }]],
      ["preço", [{ id: p1!.id }, { id: p2!.id, unit_price: "9.00" }]],
      ["produto", [{ id: p1!.id, product_id: I.productLot! }, { id: p2!.id }]],
      ["item novo", [{ id: p1!.id }, { id: p2!.id }, { product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "5.00" }]],
      ["item omitido", [{ id: p1!.id }]],
    ];
    for (const [rotulo, items] of recusas) {
      const r = await recusada("sale", parte, { version: await versaoGravada(parte), items }, 422, { code: "VALIDATION_ERROR", message: mensagem }, rotulo);
      expect(detalhes(r), rotulo).toEqual(expect.arrayContaining([expect.objectContaining({ message: mensagem })]));
    }
    // Observação e armazém do item: passam, e a ligação com a origem fica.
    const ok = await patch("sale", parte, { version: await versaoGravada(parte), items: [{ id: p1!.id, note: "obs da parte" }, { id: p2!.id, warehouse_id: I.warehouse2! }] });
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = await itens(parte);
    expect(depois.map((x) => [x.id, x.origem_item_id, x.quantity, x.warehouse_id, x.note])).toEqual([
      [p1!.id, o1!.id, "3.0000", I.warehouse, "obs da parte"],
      [p2!.id, o2!.id, "2.0000", I.warehouse2, p2!.note ?? null]]);
    // E o cabeçalho da parte também continua editável.
    const cab = await patch("sale", parte, { version: await versaoGravada(parte), note: "cabeçalho da parte" });
    expect(cab.statusCode, cab.body).toBe(200);
  });

  it("ED-4 reserva: a parte de pedido com reserva não troca o armazém (422 no item); o pedido com reserva não cresce além do disponível (a recusa de hoje)", async () => {
    const nome = `ED-4 reserva ${Math.random().toString(36).slice(2, 7)}`;
    const p = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: h.headers(), payload: { ...baseProduto, description: nome } });
    expect(p.statusCode, p.body).toBe(201);
    const produto = j(p).id as string;
    const nomeGravado = (await admin.query<{ description: string }>("select description from erp.products where id=$1", [produto])).rows[0]!.description;
    for (const w of [I.warehouse!, I.warehouse2!]) {
      const s = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
        payload: { empresa_id: I.empresa, warehouse_id: w, product_id: produto, quantity: "10", unit_value: "5" } });
      expect(s.statusCode, s.body).toBe(201);
    }
    const reservado = async () => (await admin.query<{ r: string }>(
      "select coalesce(sum(n.reservado),0)::numeric(18,4)::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null) n",
      [h.demo.orgId, I.warehouse, produto])).rows[0]!.r;

    // (a) pedido com reserva: 8 de 10. Para ele mesmo o disponível é 10 (a reserva dele não conta contra ele).
    const pedido = await criar("order", { tipo_operacao_id: topPedidoComReserva, items: [ITEM({ product_id: produto, quantity: "8", unit_price: "5.00" })] });
    expect(await reservado(), "premissa: o pedido reserva 8").toBe("8.0000");
    const [item] = (await ler("order", pedido)).items;
    const linhaDaRecusa = `${nomeGravado} no armazém ${nomeArmazem}: disponível 10, pedido 11.`;
    const r = await recusada("order", pedido, { version: await versaoGravada(pedido), items: [{ id: item!.id, quantity: "11" }] }, 422, { code: "VALIDATION_ERROR", message: linhaDaRecusa }, "acima do disponível");
    expect(detalhes(r)).toEqual([{ path: "items", message: linhaDaRecusa }]);
    const exato = await patch("order", pedido, { version: await versaoGravada(pedido), items: [{ id: item!.id, quantity: "10" }] });
    expect(exato.statusCode, exato.body).toBe(200);
    expect(await reservado()).toBe("10.0000");

    // PREMISSA: a reserva que a PATCH gravou está valendo — com os 10 reservados, nem meia unidade cabe em outro pedido.
    const outro = await h.app.inject({ method: "POST", url: "/api/sales/orders", headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: clientePadrao, tipo_operacao_id: topPedidoComReserva, items: [ITEM({ product_id: produto, quantity: "0.5", unit_price: "5.00" })] } });
    expect(outro.statusCode, outro.body).toBe(422);
    expect(j(outro).error!.message).toBe(`${nomeGravado} no armazém ${nomeArmazem}: disponível 0, pedido 0,5.`);

    // (b) a parte gerada do pedido com reserva: o armazém não troca; a observação do item, sim.
    const menor = await patch("order", pedido, { version: await versaoGravada(pedido), items: [{ id: item!.id, quantity: "8" }] });
    expect(menor.statusCode, menor.body).toBe(200);
    const parte = (await converter("order", pedido, { tipo_operacao_id: tops.sale, itens: [{ item_id: item!.id, quantidade: "4" }] })).id as string;
    const [pi] = await itens(parte);
    expect(pi!.warehouse_id, "premissa: a parte nasceu no armazém do pedido").toBe(I.warehouse);
    const troca = await recusada("sale", parte, { version: await versaoGravada(parte), items: [{ id: pi!.id, warehouse_id: I.warehouse2! }] }, 422,
      { code: "VALIDATION_ERROR", message: MSG_PARTE_RESERVA_ARMAZEM }, "armazém da parte com reserva");
    expect(detalhes(troca)).toEqual([{ path: "items[0].warehouse_id", message: MSG_PARTE_RESERVA_ARMAZEM }]);
    const obs = await patch("sale", parte, { version: await versaoGravada(parte), items: [{ id: pi!.id, note: "obs" }] });
    expect(obs.statusCode, obs.body).toBe(200);
    expect((await itens(parte)).map((x) => [x.id, x.warehouse_id, x.note])).toEqual([[pi!.id, I.warehouse, "obs"]]);
    expect(await reservado(), "a conta continua fechando: pedido (4) + parte (4)").toBe("8.0000");
  });

  it("ED-4 exigências da TOP pela versão CONGELADA: a versão do documento exige observação → limpar recusa; a versão nova exige e a do documento não → passa", async () => {
    const t1 = await criarTop("order", "ED-4 exige observação");
    await novaVersao(t1, cfg((c) => { c.geral.exigeObservacao = true; }));
    const id = await criar("order", { tipo_operacao_id: t1, note: "nasceu com observação" });
    await novaVersao(t1, configuracaoNeutraTopV3()); // a atual deixa de exigir
    await recusada("order", id, { version: await versaoGravada(id), note: null }, 422,
      { code: ERRO_EXIGENCIA_NAO_ATENDIDA, message: MENSAGEM_EXIGENCIA_NAO_ATENDIDA, details: { exigencias: [{ caminho: "note", mensagem: "Observação é obrigatório nesta operação." }] } }, "limpar a observação exigida");
    const t2 = await criarTop("order", "ED-4 passa a exigir");
    await novaVersao(t2, configuracaoNeutraTopV3());
    const id2 = await criar("order", { tipo_operacao_id: t2 });
    await novaVersao(t2, cfg((c) => { c.geral.exigeObservacao = true; }));
    const r = await patch("order", id2, { version: await versaoGravada(id2), document_date: "2026-09-11" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await linha(id2)).toMatchObject({ note: null });
  });
});

describe("ED-5 — condição de pagamento e cliente em atraso", () => {
  it("ED-5 condição: a gravada deixou de ser permitida → PATCH da observação passa; PATCH que TROCA a condição é conferida pela versão CONGELADA", async () => {
    const [c1, c2, c3, c4] = [await condicao(), await condicao(), await condicao(), await condicao()];
    const top = await criarTop("order", "ED-5 condição");
    await novaVersao(top, configuracaoNeutraTopV3(), [c1, c3]);
    const id = await criar("order", { tipo_operacao_id: top, condicao_pagamento_id: c1 });
    // A TOP ganha versão NOVA que deixou de permitir c1 e c3 (só c2).
    await novaVersao(top, configuracaoNeutraTopV3(), [c2]);
    const obs1 = await patch("order", id, { version: await versaoGravada(id), note: "a atual não permite a gravada" });
    expect(obs1.statusCode, obs1.body).toBe(200);
    // Acervo: a condição gravada nem na versão CONGELADA está (c4) — a PATCH que não a troca não a reconfere.
    expect((await admin.query("update erp.sales_documents set condicao_pagamento_id=$2 where id=$1", [id, c4])).rowCount).toBe(1);
    const obs2 = await patch("order", id, { version: await versaoGravada(id), note: "nem a congelada permite a gravada" });
    expect(obs2.statusCode, obs2.body).toBe(200);
    expect((await linha(id)).condicao_pagamento_id).toBe(c4);
    // Trocar para c2 (permitida só pela versão NOVA) → a recusa de hoje: vale a versão CONGELADA.
    await recusada("order", id, { version: await versaoGravada(id), condicao_pagamento_id: c2 }, 422,
      { code: ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, message: MENSAGEM_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } }, "troca para condição não permitida");
    // Trocar para c3 (permitida pela congelada) → passa.
    const ok = await patch("order", id, { version: await versaoGravada(id), condicao_pagamento_id: c3 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await linha(id)).condicao_pagamento_id).toBe(c3);
  });

  it("ED-5 cliente em atraso: PATCH de outro campo passa com o devedor gravado; PATCH que troca PARA o devedor → a recusa de hoje (mensagem exata); reenviar o mesmo cliente não confere", async () => {
    // Clientes NOVOS deste caso: as vendas confirmadas nos outros casos geram títulos do cliente padrão.
    const limpo = await cliente(); const devedor = await cliente();
    const top = await criarTop("order", "ED-5 atraso bloqueia");
    await novaVersao(top, cfg((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; }));
    // Nascem ANTES do título vencido.
    const docDoDevedor = await criar("order", { tipo_operacao_id: top, client_id: devedor });
    const docDoLimpo = await criar("order", { tipo_operacao_id: top, client_id: limpo });
    const venc = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await admin.query(
      "insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,person_id,amount,emission_date,due_date) values ($1,$2,$3,'receivable',$4,$5,'1234.50',$6,$6)",
      [h.demo.orgId, I.empresa2, `ED5-ATR-${Date.now()}`, "ED5-ATRASO", devedor, venc]);
    const [a, m, d] = venc.split("-");
    const mensagem = `O cliente tem 1 título(s) vencido(s), total R$ 1.234,50, o mais antigo de ${d}/${m}/${a}. Esta operação não aceita cliente em atraso.`;
    // PREMISSA: a criação para o devedor agora é recusada.
    const nova = await h.app.inject({ method: "POST", url: "/api/sales/orders", headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: devedor, tipo_operacao_id: top, items: [ITEM()] } });
    expect(nova.statusCode, nova.body).toBe(422);
    expect(j(nova).error!.code).toBe(ERRO_CLIENTE_EM_ATRASO);

    const obs = await patch("order", docDoDevedor, { version: await versaoGravada(docDoDevedor), note: "outro campo" });
    expect(obs.statusCode, obs.body).toBe(200);
    const mesmo = await patch("order", docDoDevedor, { version: await versaoGravada(docDoDevedor), client_id: devedor, note: "mesmo cliente" });
    expect(mesmo.statusCode, mesmo.body).toBe(200);
    await recusada("order", docDoLimpo, { version: await versaoGravada(docDoLimpo), client_id: devedor }, 422,
      { code: ERRO_CLIENTE_EM_ATRASO, message: mensagem, details: { campo: "client_id", titulos: 1, total: "1234.50", vencimentoMaisAntigo: venc } }, "troca para o devedor");
    expect((await linha(docDoLimpo)).client_id).toBe(limpo);
  });

  it("ED-5 cliente em atraso com quem só tem orders.edit (sem create): outro campo passa; trocar PARA o devedor → a mesma recusa, sem gravar", async () => {
    const limpo = await cliente(); const devedor = await cliente();
    const top = await criarTop("order", "ED-5 atraso só edit");
    await novaVersao(top, cfg((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; }));
    const doc = await criar("order", { tipo_operacao_id: top, client_id: limpo });
    const venc = new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10);
    await admin.query(
      "insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,person_id,amount,emission_date,due_date) values ($1,$2,$3,'receivable',$4,$5,'99.90',$6,$6)",
      [h.demo.orgId, I.empresa, `ED5E-ATR-${Date.now()}`, "ED5E-ATRASO", devedor, venc]);
    const [a, m, d] = venc.split("-");
    const mensagem = `O cliente tem 1 título(s) vencido(s), total R$ 99,90, o mais antigo de ${d}/${m}/${a}. Esta operação não aceita cliente em atraso.`;
    const soEdit = await membro("ED-5 só edita pedidos", ["orders.edit"]);
    // PREMISSA: ele não tem create (a porta de lançamento o recusa).
    const semCreate = await h.app.inject({ method: "GET", url: `/api/sales/orders/regras-da-operacao?tipo_operacao_id=${top}`, headers: soEdit });
    expect(semCreate.statusCode, semCreate.body).toBe(403);
    const obs = await patch("order", doc, { version: await versaoGravada(doc), note: "só edit" }, soEdit);
    expect(obs.statusCode, obs.body).toBe(200);
    await recusada("order", doc, { version: await versaoGravada(doc), client_id: devedor }, 422,
      { code: ERRO_CLIENTE_EM_ATRASO, message: mensagem, details: { campo: "client_id", titulos: 1, total: "99.90", vencimentoMaisAntigo: venc } }, "só edit: troca para o devedor", soEdit);
    expect((await linha(doc)).client_id).toBe(limpo);
  });
});
