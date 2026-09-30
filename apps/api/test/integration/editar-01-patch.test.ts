import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * EDITAR-01 (decisão 272) — A PATCH DO DOCUMENTO SALVO: ED-1, ED-2, ED-6, ED-7, ED-8, ED-10.
 *
 * `PATCH /api/sales/<seg>/:id` com corpo ESTRITO `{ version, ...só os campos que mudam }`. O que esta suíte prova:
 *   · ED-1  só o cabeçalho muda: itens NÃO são regravados (mesmos ids, linhas inteiras idênticas), e observação
 *           dos itens, dedutível, plano e condição ficam como estavam;
 *   · ED-2  itens com id: campo ausente = o gravado; item novo entra; item omitido sai; id de outro documento → 422;
 *   · ED-6  empresa, operação, chave desconhecida, versão ausente ou torta → 422 no campo, nada gravado; a porta;
 *   · ED-7  Idempotency-Key: a mesma resposta, gravada uma vez; outro corpo → 409;
 *   · ED-8  o histórico: antes → depois SÓ dos campos alterados (cabeçalho e item);
 *   · ED-10 o GET devolve `version` e ela sobe 1 por PATCH (e por PUT).
 *
 * TESTEMUNHA: o BANCO, lido por conexão própria de superusuário (sem RLS) — a linha do documento, as linhas dos
 * itens e os eventos de auditoria. "Nada gravado" = as três fotos idênticas antes e depois, nunca só o status HTTP.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;
type Variante = keyof typeof ROTA;
const VARIANTES: readonly Variante[] = ["budget", "order", "sale"];
let tops: Record<Variante, string>;

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  tops = { budget: await criarTop("budget", "ED orçamento"), order: await criarTop("order", "ED pedido"), sale: await criarTop("sale", "ED venda") };
}, 180_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Detalhe = { path: string; message: string };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
type Hdr = Record<string, string>;
type Linha = Record<string, unknown>;

let seq = 0;
async function criarTop(kind: Variante, nome: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `ED1${String(++seq).padStart(3, "0")}`, codigoBase: FAMILIA[kind], nome: `${nome} ${seq}` } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,2,30,'intervalo',30,null,false,null,true) returning id",
    [h.demo.orgId, `ED1-${n}`, `Condição ED1 ${n}`])).rows[0]!.id;
}
async function membro(rotulo: string, permissoes: string[]): Promise<Hdr> {
  const sufixo = `${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `${rotulo} ${sufixo}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `ed1-${sufixo}@teste.local`;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: rotulo, email, password: "Editar@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Editar@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

type Item = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string; discount?: string; note?: string | null };
const ITEM = (o: Partial<Item> = {}): Item => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "10.00", ...o });
const corpo = (kind: Variante, extra: Record<string, unknown> = {}) => ({ empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client,
  tipo_operacao_id: tops[kind], items: [ITEM()], ...extra });
async function criar(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(), payload: corpo(kind, extra) });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const patch = (kind: Variante, id: string, payload: Record<string, unknown>, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "PATCH", url: `/api/sales/${ROTA[kind]}/${id}`, headers, payload });
const lerResposta = (kind: Variante, id: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}`, headers });
async function ler(kind: Variante, id: string): Promise<Linha> {
  const r = await lerResposta(kind, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r);
}

// ---------- testemunhas no banco (superusuário, sem RLS) ----------
const linha = async (id: string) => (await admin.query<Linha>("select * from erp.sales_documents where id=$1", [id])).rows[0]!;
const itens = async (id: string) => (await admin.query<Linha & { id: string }>("select * from erp.sales_document_items where document_id=$1 order by position, id", [id])).rows;
type Evento = { id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; metadata: Record<string, unknown> | null };
const eventos = async (id: string) => (await admin.query<Evento>(
  "select id::text, action, before, after, metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 order by id", [id])).rows;
/**
 * O gatilho `erp.audit_row` (0005) grava, a CADA update da linha, um evento `update` com a linha INTEIRA antes/depois.
 * O evento da EDIÇÃO é o outro `update`: o que traz SÓ os campos alterados — nunca a foto inteira do gatilho.
 */
const fotoDoGatilho = (e: Pick<Evento, "after">) => e.after !== null && "organization_id" in e.after;
const daEdicao = (evs: readonly Evento[]) => evs.filter((e) => e.action === "update" && !fotoDoGatilho(e));
/** A foto inteira do documento: linha, itens e eventos. "Nada gravado" = a mesma foto antes e depois. */
const foto = async (id: string) => ({ doc: await linha(id), itens: await itens(id), eventos: await eventos(id) });
const versaoGravada = async (id: string) => (await linha(id)).version as string;
const mais = (v: unknown, n: number) => String(Number(v) + n);
const detalhes = (r: Resposta) => (j(r).error?.details ?? []) as Detalhe[];

const MSG_VERSAO = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";
/** Colunas do item que a PATCH pode tocar — para comparar "o gravado" sem depender de coluna técnica. */
const CAMPOS_DO_ITEM = ["id", "product_id", "warehouse_id", "quantity", "unit_price", "discount", "discount_percent", "total", "note", "origem_item_id"] as const;
const doItem = (x: Linha) => Object.fromEntries(CAMPOS_DO_ITEM.map((k) => [k, x[k]]));

describe("ED-1 — PATCH só do cabeçalho", () => {
  it("ED-1 PATCH da observação: itens não regravados (mesmos ids, linhas inteiras idênticas), observação dos itens, dedutível, plano e condição idênticos — nas três variantes", async () => {
    const cond = await condicao();
    // Plano AJUSTADO (do corpo, com condição): uma PATCH que rederivasse o plano pela condição o trocaria.
    const plano = { installments: 2, first_due_date: "2026-11-01", mode: "interval", interval_days: 15, has_down_payment: false };
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind, { note: "antes", condicao_pagamento_id: cond, installment_plan: plano, is_deductible: true,
        items: [ITEM({ quantity: "2", unit_price: "10.00", note: "obs do item 1" }), ITEM({ product_id: I.product!, quantity: "3", unit_price: "8.00", note: "obs do item 2" })] });
      const antes = await foto(id);
      // PREMISSAS: o documento tem o que a PATCH não pode tocar — condição, plano ajustado, dedutível, dois itens com observação.
      expect(antes.doc, kind).toMatchObject({ note: "antes", condicao_pagamento_id: cond, parcelas_ajustadas: true });
      expect(antes.doc.installment_plan, kind).toEqual({ ...plano, is_deductible: true });
      expect(antes.itens.map((x) => x.note), kind).toEqual(["obs do item 1", "obs do item 2"]);

      const r = await patch(kind, id, { version: antes.doc.version, note: "depois" });
      expect(r.statusCode, `${kind}: ${r.body}`).toBe(200);
      const depois = await foto(id);
      // O cabeçalho: só a observação (e a versão, +1) mudou.
      expect(depois.doc.note).toBe("depois");
      expect(depois.doc.version, kind).toBe(mais(antes.doc.version, 1));
      const semOQueMuda = ({ note: _n, version: _v, updated_at: _u, ...resto }: Linha) => resto;
      expect(semOQueMuda(depois.doc), kind).toEqual(semOQueMuda(antes.doc));
      // Os itens: as MESMAS linhas, inteiras (ids, observação, posição, ligação) — não foram apagadas e reinseridas.
      expect(depois.itens, `${kind}: itens regravados`).toEqual(antes.itens);
      // A resposta é o documento como o GET devolve, já com a versão nova.
      const g = await ler(kind, id);
      expect(j(r), kind).toEqual(g);
      expect(g.version).toBe(depois.doc.version);
      provados++;
    }
    expect(provados).toBe(3);
  });

  it("ED-1 PATCH que não muda nada (campo igual ao gravado, itens iguais ao gravado) → 200 com o GET, sem escrita: versão, linha, itens e eventos idênticos", async () => {
    const id = await criar("order", { note: "igual", items: [ITEM({ quantity: "2", note: "obs 1" }), ITEM({ product_id: I.product!, quantity: "3", unit_price: "8.00" })] });
    const antes = await foto(id);
    const [a, b] = antes.itens;
    const casos: [string, Record<string, unknown>][] = [
      ["só a versão", { version: antes.doc.version }],
      ["observação igual à gravada", { version: antes.doc.version, note: "igual" }],
      ["itens iguais aos gravados (só os ids)", { version: antes.doc.version, items: [{ id: a!.id }, { id: b!.id }] }],
      ["itens iguais aos gravados (com os valores)", { version: antes.doc.version, items: [{ id: a!.id, quantity: "2", note: "obs 1" }, { id: b!.id, quantity: "3.0000", unit_price: "8" }] }],
      ["cliente igual, versão em inteiro", { version: Number(antes.doc.version), client_id: antes.doc.client_id }],
    ];
    for (const [nome, payload] of casos) {
      const r = await patch("order", id, payload);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(200);
      expect(j(r), nome).toEqual(await ler("order", id));
      expect(j(r).version, `${nome}: a versão não sobe`).toBe(antes.doc.version);
      expect(await foto(id), `${nome}: nada gravado`).toEqual(antes);
    }
  });
});

describe("ED-2 — itens com id", () => {
  it("ED-2 campo ausente fica o gravado (observação); item novo entra; item omitido sai; totais recalculados", async () => {
    const id = await criar("order", { items: [
      ITEM({ quantity: "2", unit_price: "10.00", note: "nota A" }),
      ITEM({ product_id: I.product!, quantity: "3", unit_price: "8.00", note: "nota B" }),
      ITEM({ quantity: "1", unit_price: "5.00", note: "nota C" })] });
    const antes = await itens(id);
    expect(antes).toHaveLength(3);
    const [a, b, c] = antes as [Linha & { id: string }, Linha & { id: string }, Linha & { id: string }];
    const r = await patch("order", id, { version: await versaoGravada(id), items: [
      { id: a.id, quantity: "5" },
      { id: b.id },
      { product_id: I.product2!, warehouse_id: I.warehouse2!, quantity: "4", unit_price: "7.00", note: "novo" }] });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await itens(id);
    expect(depois).toHaveLength(3);
    expect(depois.slice(0, 2).map((x) => x.id), "os itens com id continuam as MESMAS linhas").toEqual([a.id, b.id]);
    expect(depois.map((x) => x.id), "o item omitido saiu").not.toContain(c.id);
    const novo = depois[2]!;
    expect(antes.map((x) => x.id), "o item sem id é linha nova").not.toContain(novo.id);
    // A: só a quantidade veio — a observação e o resto são os gravados.
    expect(doItem(depois[0]!)).toEqual({ ...doItem(a), quantity: "5.0000", total: "50.00" });
    // B: só o id veio — tudo é o gravado.
    expect(doItem(depois[1]!)).toEqual(doItem(b));
    expect(doItem(novo)).toEqual({ id: novo.id, product_id: I.product2, warehouse_id: I.warehouse2, quantity: "4.0000", unit_price: "7.000000",
      discount: "0.00", discount_percent: "0.0000", total: "28.00", note: "novo", origem_item_id: null });
    // Os totais do documento são os dos itens como ficaram: 5×10 + 3×8 + 4×7.
    const d = await linha(id);
    expect([d.subtotal, d.total]).toEqual(["102.00", "102.00"]);
    const g = await ler("order", id);
    expect((g.items as Linha[]).map((x) => [x.id, x.quantity, x.note])).toEqual([[a.id, "5.0000", "nota A"], [b.id, "3.0000", "nota B"], [novo.id, "4.0000", "novo"]]);
  });

  it("ED-2 id de item de OUTRO documento (ou inexistente, ou repetido) → 422 no item (items[i].id); item novo sem preço → 422; nada gravado nos dois documentos", async () => {
    const id = await criar("order", { items: [ITEM({ quantity: "2" }), ITEM({ product_id: I.product!, quantity: "3" })] });
    const outro = await criar("order");
    const orcamento = await criar("budget");
    const [alheio] = await itens(outro);
    const [deOutraVariante] = await itens(orcamento);
    const antes = await foto(id); const antesOutro = await foto(outro);
    const [a] = antes.itens;
    const v = antes.doc.version;
    const casos: [string, unknown[], string][] = [
      ["item de outro pedido", [{ id: a!.id }, { id: alheio!.id, quantity: "9" }], "items[1].id"],
      ["item de um orçamento", [{ id: deOutraVariante!.id }], "items[0].id"],
      ["item inexistente", [{ id: a!.id }, { id: "00000000-0000-4000-8000-000000000272" }], "items[1].id"],
      ["item repetido", [{ id: a!.id }, { id: a!.id, quantity: "4" }], "items[1].id"],
    ];
    for (const [nome, items, caminho] of casos) {
      const r = await patch("order", id, { version: v, items });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r), nome).toEqual(expect.arrayContaining([expect.objectContaining({ path: caminho })]));
    }
    // Item NOVO (sem id) exige produto, quantidade e preço.
    const semPreco = await patch("order", id, { version: v, items: [{ id: a!.id }, { product_id: I.product2!, quantity: "1" }] });
    expect(semPreco.statusCode, semPreco.body).toBe(422);
    expect(j(semPreco).error!.code).toBe("VALIDATION_ERROR");
    expect(detalhes(semPreco)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[1].unit_price" })]));
    expect(await foto(id), "nada gravado no documento").toEqual(antes);
    expect(await foto(outro), "nada gravado no dono do item alheio").toEqual(antesOutro);
    // PREMISSA: a mesma PATCH com os itens do próprio documento passa.
    const ok = await patch("order", id, { version: v, items: [{ id: a!.id, quantity: "7" }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await itens(id)).map((x) => [x.id, x.quantity])).toEqual([[a!.id, "7.0000"]]);
  });
});

describe("ED-6 — corpo estrito", () => {
  it("ED-6 empresa_id ou tipo_operacao_id no corpo → 422 no campo (mesmo com o valor gravado); chave desconhecida → 422 na chave; version ausente ou torta → 422; null em campo obrigatório → 422; nada gravado", async () => {
    const id = await criar("order", { note: "fica" });
    const outraTop = await criarTop("order", "ED-6 outra");
    const antes = await foto(id);
    const v = antes.doc.version;
    const casos: [string, Record<string, unknown>, string][] = [
      ["empresa_id de outra empresa", { version: v, empresa_id: I.empresa2 }, "empresa_id"],
      ["empresa_id igual à gravada", { version: v, empresa_id: I.empresa, note: "x" }, "empresa_id"],
      ["tipo_operacao_id de outra TOP", { version: v, tipo_operacao_id: outraTop }, "tipo_operacao_id"],
      ["tipo_operacao_id igual ao gravado", { version: v, tipo_operacao_id: tops.order, note: "x" }, "tipo_operacao_id"],
      ["tipo_operacao_id null", { version: v, tipo_operacao_id: null }, "tipo_operacao_id"],
      ["chave desconhecida", { version: v, nota: "x" }, "nota"],
      ["sem version", { note: "x" }, "version"],
      ["version null", { version: null, note: "x" }, "version"],
      ["version com letra", { version: "1a", note: "x" }, "version"],
      ["version negativa", { version: -1, note: "x" }, "version"],
      ["version fracionária", { version: 1.5, note: "x" }, "version"],
      // `null` só limpa campo que aceita vazio; campo obrigatório com null → 422 no campo.
      ["client_id null", { version: v, client_id: null }, "client_id"],
      ["document_date null", { version: v, document_date: null }, "document_date"],
    ];
    for (const [nome, payload, caminho] of casos) {
      const r = await patch("order", id, payload);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r), nome).toEqual(expect.arrayContaining([expect.objectContaining({ path: caminho })]));
      if (caminho === "tipo_operacao_id") {
        const mensagens = [j(r).error!.message, ...detalhes(r).map((d) => d.message)];
        expect(mensagens.some((m) => m.startsWith("Trocar a operação não é edição")), `${nome}: ${r.body}`).toBe(true);
      }
    }
    // Chave desconhecida DENTRO do item também é recusada, nunca descartada.
    const [item] = antes.itens;
    const noItem = await patch("order", id, { version: v, items: [{ id: item!.id, quantidade: "3" }] });
    expect(noItem.statusCode, noItem.body).toBe(422);
    expect(j(noItem).error!.code).toBe("VALIDATION_ERROR");
    expect(detalhes(noItem)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[0].quantidade" })]));
    expect(await foto(id), "nenhuma recusa gravou").toEqual(antes);
    // PREMISSA: o mesmo documento, com o corpo canônico, aceita a PATCH.
    const ok = await patch("order", id, { version: v, note: "mudou" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("ED-6 porta: PATCH pela rota de outra variante → a mesma 404 do GET; sem <perm>.edit → 403; nada gravado", async () => {
    const id = await criar("order", { note: "fica" });
    const antes = await foto(id);
    const v = antes.doc.version;
    const r = await patch("budget", id, { version: v, note: "x" });
    const g = await lerResposta("budget", id);
    expect([r.statusCode, g.statusCode], r.body).toEqual([404, 404]);
    expect(r.body, "a MESMA 404 do GET").toBe(g.body);
    // Inexistente e id MALFORMADO: a mesma 404 (o corpo do GET de um inexistente) — nunca 500 nem 422.
    const inexistente = "00000000-0000-4000-8000-000000000272";
    const gi = await lerResposta("order", inexistente);
    expect(gi.statusCode, gi.body).toBe(404);
    for (const alvo of [inexistente, "nao-e-um-uuid"]) {
      const x = await patch("order", alvo, { version: v, note: "x" });
      expect([x.statusCode, x.body], alvo).toEqual([404, gi.body]);
    }
    expect(g.body, "a 404 de outra variante é a do inexistente").toBe(gi.body);
    const soVe = await membro("ED-6 só vê pedidos", ["orders.view"]);
    expect((await lerResposta("order", id, soVe)).statusCode, "premissa: ele lê o pedido").toBe(200);
    const r2 = await patch("order", id, { version: v, note: "x" }, soVe);
    expect(r2.statusCode, r2.body).toBe(403);
    expect(await foto(id)).toEqual(antes);
    const edita = await membro("ED-6 edita pedidos", ["orders.view", "orders.edit"]);
    const ok = await patch("order", id, { version: v, note: "com orders.edit" }, edita);
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe("ED-7 — Idempotency-Key", () => {
  it("ED-7 mesma chave e mesmo corpo → a MESMA resposta, gravada UMA vez (versão +1, um evento); mesma chave com outro corpo → 409 CONFLICT", async () => {
    const id = await criar("sale", { note: "antes" });
    const antes = await foto(id);
    const v0 = antes.doc.version;
    const chave = `ed7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const comChave = h.headers({ "idempotency-key": chave });
    const corpoDaPatch = { version: v0, note: "idempotente" };
    const r1 = await patch("sale", id, corpoDaPatch, comChave);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(j(r1).version).toBe(mais(v0, 1));
    const r2 = await patch("sale", id, corpoDaPatch, h.headers({ "idempotency-key": chave }));
    expect([r2.statusCode, r2.body], "a mesma resposta, byte a byte").toEqual([200, r1.body]);
    const depois = await foto(id);
    expect(depois.doc.version, "gravou uma vez só").toBe(mais(v0, 1));
    expect(depois.doc.note).toBe("idempotente");
    expect(daEdicao(depois.eventos).length - daEdicao(antes.eventos).length, "um evento da edição só").toBe(1);
    expect(depois.eventos.filter(fotoDoGatilho).length - antes.eventos.filter(fotoDoGatilho).length, "um update da linha só").toBe(1);
    // A mesma chave com OUTRO corpo: conflito, sem efeito.
    const r3 = await patch("sale", id, { version: v0, note: "outro corpo" }, h.headers({ "idempotency-key": chave }));
    expect(r3.statusCode, r3.body).toBe(409);
    expect(j(r3).error!.code).toBe("CONFLICT");
    expect(await foto(id)).toEqual(depois);
    // PREMISSA contra replay de mentira: SEM a chave, o mesmo corpo (versão de antes) é recusado pela versão.
    const r4 = await patch("sale", id, corpoDaPatch);
    expect(r4.statusCode, r4.body).toBe(409);
    expect(j(r4).error).toMatchObject({ code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO });
    expect(await foto(id)).toEqual(depois);
  });
});

describe("ED-8 — histórico", () => {
  it("ED-8 o histórico mostra antes → depois SÓ dos campos alterados (cabeçalho e item: alterado, incluído, removido)", async () => {
    const id = await criar("order", { note: "velha", items: [
      ITEM({ quantity: "2", unit_price: "10.00", note: "nota A" }),
      ITEM({ product_id: I.product!, quantity: "3", unit_price: "8.00" }),
      ITEM({ quantity: "1", unit_price: "5.00", note: "sai" })] });
    const [a, b, c] = await itens(id);
    const antesDaPatch = await eventos(id);
    const r = await patch("order", id, { version: await versaoGravada(id), note: "nova", items: [
      { id: a!.id, quantity: "5" }, { id: b!.id }, { product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "4", unit_price: "7.00", note: "entra" }] });
    expect(r.statusCode, r.body).toBe(200);
    const [, , d] = await itens(id);
    // O banco: um evento da edição (e a foto do gatilho da única atualização da linha).
    const novos = (await eventos(id)).slice(antesDaPatch.length);
    expect(novos.map((e) => [e.action, fotoDoGatilho(e)])).toEqual([["update", true], ["update", false]]);
    const noBanco = daEdicao(novos)[0]!;
    // A leitura da tela (GET /api/admin/audit, com audit_logs.view) devolve o MESMO evento.
    const hist = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=sales_documents&entity_id=${id}`, headers: h.headers() });
    expect(hist.statusCode, hist.body).toBe(200);
    const doHistorico = daEdicao(j(hist).items as Evento[]);
    expect(doHistorico).toHaveLength(1);
    const ev = doHistorico[0]!;
    expect([ev.before, ev.after, ev.metadata]).toEqual([noBanco.before, noBanco.after, noBanco.metadata]);
    const antes = ev.before!; const depois = ev.after!;
    // Cabeçalho: a observação (pedida) e os totais (derivados), antes → depois; nada mais.
    expect(antes).toEqual({ note: "velha", subtotal: "49.00", total: "49.00", items: expect.anything() });
    expect(depois).toEqual({ note: "nova", subtotal: "102.00", total: "102.00", items: expect.anything() });
    // Itens: o alterado só com o que mudou; o incluído e o removido inteiros; o intocado (B) não aparece.
    expect(antes.items).toEqual({ alterados: [{ id: a!.id, quantity: "2.0000", total: "20.00" }],
      removidos: [expect.objectContaining({ id: c!.id, product_id: I.product2, quantity: "1.0000", note: "sai" })] });
    expect(depois.items).toEqual({ alterados: [{ id: a!.id, quantity: "5.0000", total: "50.00" }],
      incluidos: [expect.objectContaining({ id: d!.id, product_id: I.product2, quantity: "4.0000", note: "entra" })] });
    expect(JSON.stringify(ev), "o item intocado não entra no histórico").not.toContain(b!.id as string);
    expect(ev.metadata).toMatchObject({ via: "patch" });
  });
});

describe("ED-10 — a versão", () => {
  it("ED-10 o GET devolve version (string de dígitos, a do banco) e ela sobe 1 por PATCH — com a versão em string ou em inteiro", async () => {
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind);
      const v0 = (await ler(kind, id)).version;
      expect(typeof v0, kind).toBe("string");
      expect(v0 as string, kind).toMatch(/^\d+$/);
      expect(v0, "a do banco").toBe(await versaoGravada(id));
      const r1 = await patch(kind, id, { version: v0, note: "primeira" });
      expect(r1.statusCode, r1.body).toBe(200);
      expect(j(r1).version).toBe(mais(v0, 1));
      expect((await ler(kind, id)).version).toBe(mais(v0, 1));
      const r2 = await patch(kind, id, { version: Number(v0) + 1, note: "segunda" });
      expect(r2.statusCode, r2.body).toBe(200);
      expect(j(r2).version).toBe(mais(v0, 2));
      expect(await versaoGravada(id)).toBe(mais(v0, 2));
      provados++;
    }
    expect(provados).toBe(3);
  });

  it("ED-10 o PUT de antes também soma 1 na versão", async () => {
    for (const kind of VARIANTES) {
      const id = await criar(kind);
      const v0 = (await ler(kind, id)).version as string;
      const r = await h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(), payload: corpo(kind, { note: "pelo PUT" }) });
      expect(r.statusCode, r.body).toBe(200);
      const g = await ler(kind, id);
      expect([g.version, g.note], kind).toEqual([mais(v0, 1), "pelo PUT"]);
      expect(await versaoGravada(id)).toBe(mais(v0, 1));
    }
  });
});
