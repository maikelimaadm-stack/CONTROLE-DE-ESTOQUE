import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, seedDemo, type Db } from "@agro/db";
import {
  MSG_DOCUMENTO_MUDOU, MSG_EDICAO_EMPRESA, MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO, MSG_EDICAO_ITEM_REPETIDO, MSG_EDICAO_TROCA_DE_OPERACAO,
} from "../../src/routes/vendas-edicao-patch.js";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * EDITAR-01 (decisão 272) — A PATCH DO DOCUMENTO SALVO: ED-1, ED-2, ED-6, ED-7, ED-8, ED-10.
 *
 * `PATCH /api/sales/<seg>/:id` com corpo ESTRITO `{ version, ...só os campos que mudam }`. O que esta suíte prova:
 *   · ED-1  só o cabeçalho muda: itens NÃO são regravados (mesmos ids, linhas inteiras idênticas, o MESMO xmin), e
 *           observação dos itens, dedutível, plano e condição ficam como estavam; o MESMO plano reenviado não é mudança;
 *   · ED-2  itens com id: campo ausente = o gravado; item novo entra; item omitido sai; id de outro documento → 422
 *           (com o texto exato); item novo incompleto → 422 na FORMA, antes de ler (mesmo num documento confirmado);
 *   · ED-6  empresa, operação, chave desconhecida, versão ausente ou torta, número fora da forma ou do limite da
 *           coluna, total que estoura, referência de outra organização → 422 no campo, nada gravado; a porta
 *           (`<perm>.edit` E `<perm>.view`: sem view → 403 antes de ler);
 *   · ED-7  Idempotency-Key: a mesma resposta, gravada uma vez; outro corpo → 409;
 *   · ED-8  o histórico: antes → depois SÓ dos campos alterados (cabeçalho e item);
 *   · ED-10 o GET devolve `version` e ela sobe 1 por PATCH (e por PUT); o `id` da resposta do PUT é o da URL.
 *
 * TESTEMUNHA: o BANCO, lido por conexão própria de superusuário (sem RLS) — a linha do documento, as linhas dos
 * itens e os eventos de auditoria. "Nada gravado" = as três fotos idênticas antes e depois, nunca só o status HTTP.
 * Outra organização pelo `seedDemo` (como em anexos-pesquisa-01-pesquisa).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;
type Variante = keyof typeof ROTA;
const VARIANTES: readonly Variante[] = ["budget", "order", "sale"];
let tops: Record<Variante, string>;
/** Referências (cliente, transportadora, proprietário, forma de pagamento) da OUTRA organização e desta. */
type Referencias = { client_id: string; transporter_id: string; proprietary_id: string; payment_method_id: string };
let daOutraOrg: Referencias; let destaOrg: Referencias;

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  tops = { budget: await criarTop("budget", "ED orçamento"), order: await criarTop("order", "ED pedido"), sale: await criarTop("sale", "ED venda") };
  // Estoque para a venda confirmada do ED-2 (confirmar consome 1).
  const s = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "50", unit_value: "10" } });
  expect(s.statusCode, s.body).toBe(201);
  const o2 = await seedDemo(admin, { orgName: "[TEST] Org ED-6", slug: `org-ed6-${Date.now().toString(36)}`, adminEmail: "ed6-outra-org@demo.local" }, () => {});
  daOutraOrg = await referencias(o2.orgId, "ED6O");
  destaOrg = await referencias(h.demo.orgId, "ED6D");
}, 240_000);
/** Uma pessoa (cliente, transportadora e proprietário) e uma forma de pagamento DA organização dada, por SQL de superusuário. */
async function referencias(org: string, prefixo: string): Promise<Referencias> {
  const n = `${Date.now().toString().slice(-6)}${++seq}`;
  const pessoa = (await admin.query<{ id: string }>(
    "insert into erp.people(organization_id,code,document,person_type,name,legal_name,city_id,is_client,is_transporter,is_proprietary) values ($1,$2,$3,'legal',$4,$4,5208707,true,true,true) returning id",
    [org, `${prefixo}${n}`, `9927${n.padStart(10, "0")}`, `[TEST] Pessoa ${prefixo} ${n}`])).rows[0]!.id;
  const forma = (await admin.query<{ id: string }>("insert into erp.payment_methods(organization_id,name,is_active) values ($1,$2,true) returning id", [org, `[TEST] Forma ${prefixo} ${n}`])).rows[0]!.id;
  return { client_id: pessoa, transporter_id: pessoa, proprietary_id: pessoa, payment_method_id: forma };
}
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
    payload: { name: rotulo, email, password: "Variante@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Variante@12345" } });
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
  "select a.id::text as id, a.action, a.before, a.after, a.metadata from erp.audit_logs a where a.entity='sales_documents' and a.entity_id=$1 order by a.id", [id])).rows;
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
/**
 * O `xmin` de cada linha: muda a CADA escrita da linha (update, ou delete + insert), mesmo que os valores fiquem
 * iguais. Linha com o MESMO xmin antes e depois = linha que nenhuma escrita tocou.
 */
const xmins = async (id: string) => ({
  doc: (await admin.query<{ x: string }>("select xmin::text x from erp.sales_documents where id=$1", [id])).rows[0]!.x,
  itens: (await admin.query<{ id: string; x: string }>("select id, xmin::text x from erp.sales_document_items where document_id=$1 order by position, id", [id])).rows,
});
/** As consultas SQL que a requisição dispara (como o PQ-6 da ANEXOS-PESQUISA-01 conta): o texto de cada uma. */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const sqls = espiao.mock.calls.map((c) => c[0] as unknown).map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
      .filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}

const MSG_VERSAO = MSG_DOCUMENTO_MUDOU;
/** Colunas do item que a PATCH pode tocar — para comparar "o gravado" sem depender de coluna técnica. */
const CAMPOS_DO_ITEM = ["id", "product_id", "warehouse_id", "quantity", "unit_price", "discount", "discount_percent", "total", "note", "origem_item_id"] as const;
const doItem = (x: Linha) => Object.fromEntries(CAMPOS_DO_ITEM.map((k) => [k, x[k]]));

describe("ED-1 — PATCH só do cabeçalho", () => {
  it("ED-1 PATCH da observação: itens não regravados (mesmos ids, linhas inteiras idênticas, o MESMO xmin), observação dos itens, dedutível, plano e condição idênticos — nas três variantes", async () => {
    const cond = await condicao();
    // Plano AJUSTADO (do corpo, com condição): uma PATCH que rederivasse o plano pela condição o trocaria.
    const plano = { installments: 2, first_due_date: "2026-11-01", mode: "interval", interval_days: 15, has_down_payment: false };
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind, { note: "antes", condicao_pagamento_id: cond, installment_plan: plano, is_deductible: true,
        items: [ITEM({ quantity: "2", unit_price: "10.00", note: "obs do item 1" }), ITEM({ product_id: I.product!, quantity: "3", unit_price: "8.00", note: "obs do item 2" })] });
      const antes = await foto(id);
      const xAntes = await xmins(id);
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
      // E nenhuma escrita as tocou: o xmin de cada item é o mesmo (um UPDATE "para o mesmo valor" o trocaria).
      const xDepois = await xmins(id);
      expect(xAntes.itens, `${kind}: premissa — dois itens`).toHaveLength(2);
      expect(xDepois.itens, `${kind}: nenhuma linha de item tocada`).toEqual(xAntes.itens);
      // PREMISSA contra o xmin que nunca muda: a linha do documento FOI gravada, e o xmin dela mudou.
      expect(xDepois.doc, `${kind}: o cabeçalho foi gravado`).not.toBe(xAntes.doc);
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
    const xAntes = await xmins(id);
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
      expect(await xmins(id), `${nome}: nenhuma linha tocada (documento e itens)`).toEqual(xAntes);
    }
  });

  it("ED-1 reenviar o MESMO plano num documento com condição (ajustado à mão, ou o derivado da condição) → 200 sem gravar: versão, parcelas_ajustadas, linha, itens e eventos idênticos", async () => {
    const cond = await condicao();
    const plano = { installments: 2, first_due_date: "2026-11-01", mode: "interval", interval_days: 15, has_down_payment: false };
    // (a) plano AJUSTADO: o mesmo plano, inteiro, e com as chaves em outra ordem.
    const ajustado = await criar("order", { condicao_pagamento_id: cond, installment_plan: plano });
    // (b) plano DERIVADO da condição (sem plano no corpo): o gravado, reenviado como veio do banco (sem a marca de dedutível).
    const derivado = await criar("order", { condicao_pagamento_id: cond });
    const docs: [string, string, Record<string, unknown>[]][] = [];
    const a = await foto(ajustado);
    expect([a.doc.condicao_pagamento_id, a.doc.parcelas_ajustadas], "premissa: ajustado").toEqual([cond, true]);
    docs.push(["ajustado", ajustado, [plano, { has_down_payment: false, interval_days: 15, mode: "interval", first_due_date: "2026-11-01", installments: 2 }]]);
    const d = await foto(derivado);
    expect([d.doc.condicao_pagamento_id, d.doc.parcelas_ajustadas], "premissa: derivado").toEqual([cond, false]);
    const { is_deductible: dedutivel, ...planoDerivado } = d.doc.installment_plan as Record<string, unknown>;
    expect([dedutivel, planoDerivado.installments], "premissa: o plano derivado é o da condição (2 parcelas)").toEqual([false, 2]);
    docs.push(["derivado", derivado, [planoDerivado]]);
    let provados = 0;
    for (const [rotulo, id, planos] of docs) {
      const antes = await foto(id);
      const xAntes = await xmins(id);
      for (const p of planos) {
        const r = await patch("order", id, { version: antes.doc.version, installment_plan: p });
        expect(r.statusCode, `${rotulo}: ${r.body}`).toBe(200);
        expect(j(r).version, `${rotulo}: a versão não sobe`).toBe(antes.doc.version);
        const depois = await foto(id);
        expect(depois.doc.parcelas_ajustadas, `${rotulo}: parcelas_ajustadas igual`).toBe(antes.doc.parcelas_ajustadas);
        expect(depois, `${rotulo}: nada gravado`).toEqual(antes);
        expect(await xmins(id), `${rotulo}: nenhuma linha tocada`).toEqual(xAntes);
        provados++;
      }
    }
    expect(provados).toBe(3);
    // PREMISSA contra o "nunca grava": um plano DIFERENTE grava (versão +1, ajustado).
    const outro = await patch("order", derivado, { version: await versaoGravada(derivado), installment_plan: { ...plano, installments: 3 } });
    expect(outro.statusCode, outro.body).toBe(200);
    expect(await linha(derivado)).toMatchObject({ version: mais(d.doc.version, 1), parcelas_ajustadas: true });
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

  it("ED-2 id de item de OUTRO documento (ou inexistente, ou repetido) → 422 no item (items[i].id) com o texto exato; item novo sem preço → 422; nada gravado nos dois documentos", async () => {
    const id = await criar("order", { items: [ITEM({ quantity: "2" }), ITEM({ product_id: I.product!, quantity: "3" })] });
    const outro = await criar("order");
    const orcamento = await criar("budget");
    const [alheio] = await itens(outro);
    const [deOutraVariante] = await itens(orcamento);
    const antes = await foto(id); const antesOutro = await foto(outro);
    const [a] = antes.itens;
    const v = antes.doc.version;
    // O TEXTO é contrato: "não é deste documento" para o alheio e o inexistente (indistinguíveis), "repetido" para o repetido.
    const casos: [string, unknown[], string, string][] = [
      ["item de outro pedido", [{ id: a!.id }, { id: alheio!.id, quantity: "9" }], "items[1].id", MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO],
      ["item de um orçamento", [{ id: deOutraVariante!.id }], "items[0].id", MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO],
      ["item inexistente", [{ id: a!.id }, { id: "00000000-0000-4000-8000-000000000272" }], "items[1].id", MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO],
      ["item repetido", [{ id: a!.id }, { id: a!.id, quantity: "4" }], "items[1].id", MSG_EDICAO_ITEM_REPETIDO],
      ["item repetido (em maiúsculas)", [{ id: a!.id }, { id: a!.id.toUpperCase() }], "items[1].id", MSG_EDICAO_ITEM_REPETIDO],
    ];
    for (const [nome, items, caminho, mensagem] of casos) {
      const r = await patch("order", id, { version: v, items });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error, nome).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem });
      expect(detalhes(r), nome).toEqual([{ path: caminho, message: mensagem }]);
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

  it("ED-2 item novo sem product_id, quantity ou unit_price num documento CONFIRMADO (ou cancelado) → 422 na FORMA, antes de ler (e não o 409 da situação); nada gravado", async () => {
    const venda = await criar("sale");
    const conf = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`, headers: h.headers(), payload: {} });
    expect(conf.statusCode, conf.body).toBeLessThan(300);
    const pedido = await criar("order");
    const canc = await h.app.inject({ method: "POST", url: `/api/sales/orders/${pedido}/cancel`, headers: h.headers(), payload: {} });
    expect(canc.statusCode, canc.body).toBeLessThan(300);
    let provados = 0;
    for (const [kind, id, situacao] of [["sale", venda, "confirmed"], ["order", pedido, "cancelled"]] as const) {
      const antes = await foto(id);
      expect(antes.doc.status, `premissa: ${kind} ${situacao}`).toBe(situacao);
      const [a] = antes.itens;
      const v = antes.doc.version;
      const casos: [string, Record<string, unknown>, string][] = [
        ["sem product_id", { quantity: "1", unit_price: "5.00" }, "items[1].product_id"],
        ["sem quantity", { product_id: I.product2!, unit_price: "5.00" }, "items[1].quantity"],
        ["sem unit_price", { product_id: I.product2!, quantity: "1" }, "items[1].unit_price"],
      ];
      for (const [nome, novo, caminho] of casos) {
        const r = await patch(kind, id, { version: v, items: [{ id: a!.id }, novo] });
        expect(r.statusCode, `${kind} ${nome}: ${r.body}`).toBe(422);
        expect(j(r).error!.code, `${kind} ${nome}`).toBe("VALIDATION_ERROR");
        expect(detalhes(r), `${kind} ${nome}`).toEqual(expect.arrayContaining([expect.objectContaining({ path: caminho })]));
        expect(await foto(id), `${kind} ${nome}: nada gravado`).toEqual(antes);
        provados++;
      }
      // PREMISSA: com o item completo, a MESMA PATCH chega à situação — 409, não 422.
      const completo = await patch(kind, id, { version: v, items: [{ id: a!.id }, { product_id: I.product2!, quantity: "1", unit_price: "5.00" }] });
      expect([completo.statusCode, j(completo).error?.code], `${kind}: ${completo.body}`).toEqual([409, "INVALID_STATUS_TRANSITION"]);
      expect(await foto(id)).toEqual(antes);
    }
    expect(provados).toBe(6);
  });
});

describe("ED-6 — corpo estrito", () => {
  it("ED-6 empresa_id ou tipo_operacao_id no corpo → 422 no campo com o texto exato (mesmo com o valor gravado); chave desconhecida → 422 na chave; version ausente ou torta → 422; null em campo obrigatório → 422; nada gravado", async () => {
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
      // Forma CANÔNICA: sem zero à esquerda, e no máximo o maior bigint (9223372036854775807).
      ["version com zero à esquerda", { version: "007", note: "x" }, "version"],
      ["version acima do maior bigint", { version: "9223372036854775808", note: "x" }, "version"],
      ["version com 20 dígitos", { version: "10000000000000000000", note: "x" }, "version"],
      // `null` só limpa campo que aceita vazio; campo obrigatório com null → 422 no campo.
      ["client_id null", { version: v, client_id: null }, "client_id"],
      ["document_date null", { version: v, document_date: null }, "document_date"],
      // O plano é ESTRITO na PATCH: chave torta não some (virando o padrão do zod), e o dedutível vai no corpo.
      ["plano com chave torta", { version: v, installment_plan: { instalments: 3, first_due_date: "2026-10-01" } }, "installment_plan.instalments"],
      ["dedutível dentro do plano", { version: v, installment_plan: { installments: 1, first_due_date: "2026-10-01", is_deductible: true } }, "installment_plan.is_deductible"],
      // Número sem forma de número → 422 no campo, ANTES de ler o registro (e não 500 do decimal.js).
      ["frete com vírgula", { version: v, freight: "1,50" }, "freight"],
      ["desconto sem número", { version: v, discount: "abc" }, "discount"],
    ];
    for (const [nome, payload, caminho] of casos) {
      const r = await patch("order", id, payload);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r), nome).toEqual(expect.arrayContaining([expect.objectContaining({ path: caminho })]));
      // O TEXTO é contrato: a empresa não muda; trocar a operação é cancelar e lançar de novo.
      if (caminho === "empresa_id") expect(detalhes(r), nome).toEqual(expect.arrayContaining([{ path: "empresa_id", message: MSG_EDICAO_EMPRESA }]));
      if (caminho === "tipo_operacao_id") expect(detalhes(r), nome).toEqual(expect.arrayContaining([{ path: "tipo_operacao_id", message: MSG_EDICAO_TROCA_DE_OPERACAO }]));
    }
    // Só a empresa (ou só a operação) no corpo: a mensagem do erro É a do campo.
    for (const [campo, valor, mensagem] of [["empresa_id", I.empresa2, MSG_EDICAO_EMPRESA], ["tipo_operacao_id", outraTop, MSG_EDICAO_TROCA_DE_OPERACAO]] as const) {
      const r = await patch("order", id, { version: v, [campo]: valor });
      expect(r.statusCode, `${campo}: ${r.body}`).toBe(422);
      expect(j(r).error, campo).toMatchObject({ code: "VALIDATION_ERROR", message: mensagem });
      expect(detalhes(r), campo).toEqual([{ path: campo, message: mensagem }]);
    }
    // Chave desconhecida DENTRO do item também é recusada, nunca descartada.
    const [item] = antes.itens;
    const noItem = await patch("order", id, { version: v, items: [{ id: item!.id, quantidade: "3" }] });
    expect(noItem.statusCode, noItem.body).toBe(422);
    expect(j(noItem).error!.code).toBe("VALIDATION_ERROR");
    expect(detalhes(noItem)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[0].quantidade" })]));
    const quantidadeTorta = await patch("order", id, { version: v, items: [{ id: item!.id, quantity: "abc" }] });
    expect(quantidadeTorta.statusCode, quantidadeTorta.body).toBe(422);
    expect(detalhes(quantidadeTorta)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[0].quantity" })]));
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

  it("ED-6 porta: <perm>.edit SEM <perm>.view → 403 ANTES de ler (nenhuma consulta ao documento; a mesma 403 para o existente e o inexistente); nada gravado — nas três variantes", async () => {
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind, { note: "fica" });
      const antes = await foto(id);
      const v = antes.doc.version;
      const soEdit = await membro(`ED-6 só edita ${kind}`, [`${ROTA[kind]}.edit`]);
      const { r, sqls } = await comConsultas(() => patch(kind, id, { version: v, note: "sem view" }, soEdit));
      expect(r.statusCode, `${kind}: ${r.body}`).toBe(403);
      expect(sqls.filter((q) => /erp\.sales_document/.test(q)), `${kind}: nenhuma leitura do documento`).toEqual([]);
      const inexistente = await patch(kind, "00000000-0000-4000-8000-000000000272", { version: v, note: "sem view" }, soEdit);
      expect([inexistente.statusCode, inexistente.body], `${kind}: a MESMA 403 (não revela existência)`).toEqual([403, r.body]);
      expect(await foto(id), `${kind}: nada gravado`).toEqual(antes);
      // PREMISSA: com .edit E .view, a mesma PATCH grava.
      const comView = await membro(`ED-6 edita e vê ${kind}`, [`${ROTA[kind]}.edit`, `${ROTA[kind]}.view`]);
      const ok = await patch(kind, id, { version: v, note: "com view" }, comView);
      expect(ok.statusCode, `${kind}: ${ok.body}`).toBe(200);
      provados++;
    }
    expect(provados).toBe(3);
  });

  it("ED-6 números: fora do limite da coluna (dinheiro 16+2, quantity 14+4, unit_price 12+6, discount_percent 3+4) ou com casa decimal a mais → 422 no campo, antes de ler; plano com '1,50' → 422; nada gravado", async () => {
    const id = await criar("order", { items: [ITEM({ quantity: "2" })] });
    const antes = await foto(id);
    const [a] = antes.itens;
    const v = antes.doc.version;
    const dezessete = "12345678901234567";
    const casos: [string, Record<string, unknown>, string][] = [
      ["frete com 17 dígitos inteiros", { freight: dezessete }, "freight"],
      ["frete com 3 casas", { freight: "1.001" }, "freight"],
      ["ICMS do frete com 17 dígitos inteiros", { freight_icms: `${dezessete}.00` }, "freight_icms"],
      ["ICMS do frete com 3 casas", { freight_icms: "0.125" }, "freight_icms"],
      ["outros valores com 17 dígitos inteiros", { other_values: dezessete }, "other_values"],
      ["outros valores com 3 casas", { other_values: "2.505" }, "other_values"],
      ["desconto com 17 dígitos inteiros", { discount: dezessete }, "discount"],
      ["desconto com 3 casas", { discount: "0.001" }, "discount"],
      ["desconto do item com 17 dígitos inteiros", { items: [{ id: a!.id, discount: dezessete }] }, "items[0].discount"],
      ["desconto do item com 3 casas", { items: [{ id: a!.id, discount: "1.001" }] }, "items[0].discount"],
      ["quantidade com 15 dígitos inteiros", { items: [{ id: a!.id, quantity: "123456789012345" }] }, "items[0].quantity"],
      ["quantidade com 5 casas", { items: [{ id: a!.id, quantity: "1.00001" }] }, "items[0].quantity"],
      ["preço com 13 dígitos inteiros", { items: [{ id: a!.id, unit_price: "1234567890123" }] }, "items[0].unit_price"],
      ["preço com 7 casas", { items: [{ id: a!.id, unit_price: "1.1234567" }] }, "items[0].unit_price"],
      ["desconto % com 4 dígitos inteiros", { items: [{ id: a!.id, discount_percent: "1000" }] }, "items[0].discount_percent"],
      ["desconto % com 5 casas", { items: [{ id: a!.id, discount_percent: "1.12345" }] }, "items[0].discount_percent"],
      ["item NOVO com quantidade fora do limite", { items: [{ id: a!.id }, { product_id: I.product2!, quantity: "123456789012345", unit_price: "1" }] }, "items[1].quantity"],
      ["plano com vírgula no valor da entrada", { installment_plan: { installments: 2, first_due_date: "2026-11-01", has_down_payment: true, down_payment_value: "1,50", down_payment_date: "2026-09-10" } }, "installment_plan.down_payment_value"],
    ];
    for (const [nome, corpoDaPatch, caminho] of casos) {
      const r = await patch("order", id, { version: v, ...corpoDaPatch });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r), nome).toEqual(expect.arrayContaining([expect.objectContaining({ path: caminho })]));
      expect(await foto(id), `${nome}: nada gravado`).toEqual(antes);
    }
    // ANTES DE LER: num documento que não existe, a forma recusa primeiro (422, não a 404).
    const semDocumento = await patch("order", "00000000-0000-4000-8000-000000000272", { version: v, freight: dezessete });
    expect([semDocumento.statusCode, detalhes(semDocumento).map((d) => d.path)], semDocumento.body).toEqual([422, ["freight"]]);
    // PREMISSA contra o limite apertado demais: exatamente no limite de cada coluna, a PATCH grava.
    const noLimite = await patch("order", id, { version: v, freight: "1234567890123456.78", items: [
      { id: a!.id, quantity: "12345678901234.1234", unit_price: "0.000001", discount_percent: "12.3456" },
      { product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "0.0001", unit_price: "123456789012.123456", discount: "0.01" }] });
    expect(noLimite.statusCode, noLimite.body).toBe(200);
    expect((await itens(id)).map((x) => [x.quantity, x.unit_price, x.discount_percent])).toEqual([
      ["12345678901234.1234", "0.000001", "12.3456"], ["0.0001", "123456789012.123456", "0.0000"]]);
    expect((await linha(id)).freight).toBe("1234567890123456.78");
  });

  it("ED-6 total calculado que estoura a coluna (no item ou no documento) → 422 (no item ou em 'total'), nada gravado", async () => {
    const id = await criar("order", { items: [ITEM({ quantity: "2" })] });
    const antes = await foto(id);
    const [a] = antes.itens;
    const v = antes.doc.version;
    // Item: 14 dígitos × 12 dígitos — cada número cabe na sua coluna, o total do item (18,2) não.
    const item = await patch("order", id, { version: v, items: [{ id: a!.id, quantity: "99999999999999", unit_price: "999999999999" }] });
    expect(item.statusCode, item.body).toBe(422);
    expect(detalhes(item).some((d) => d.path.startsWith("items[0]")), `no item: ${item.body}`).toBe(true);
    expect(await foto(id), "item: nada gravado").toEqual(antes);
    // Documento: frete e outros valores no limite, a soma não cabe no total (18,2).
    const total = await patch("order", id, { version: v, freight: "9999999999999999.99", other_values: "9999999999999999.99" });
    expect(total.statusCode, total.body).toBe(422);
    expect(detalhes(total).map((d) => d.path), `em "total": ${total.body}`).toContain("total");
    expect(await foto(id), "documento: nada gravado").toEqual(antes);
    // PREMISSA: um frete grande que cabe no total grava.
    const ok = await patch("order", id, { version: v, freight: "9999999999999900.00" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("ED-6 version '9223372036854775807' (o maior bigint) tem forma válida: passa a forma e cai na versão (409), nunca 422", async () => {
    const id = await criar("order", { note: "fica" });
    const antes = await foto(id);
    const r = await patch("order", id, { version: "9223372036854775807", note: "x" });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error).toMatchObject({ code: "CONCURRENCY_CONFLICT", message: MSG_VERSAO });
    expect(await foto(id)).toEqual(antes);
  });

  it("ED-6 referência trocada (client_id, transporter_id, proprietary_id, payment_method_id) de OUTRA organização → 422 no campo, nada gravado; a desta organização grava", async () => {
    const id = await criar("order", { note: "fica" });
    let provados = 0;
    for (const campo of ["client_id", "transporter_id", "proprietary_id", "payment_method_id"] as const) {
      const antes = await foto(id);
      const r = await patch("order", id, { version: antes.doc.version, [campo]: daOutraOrg[campo] });
      expect(r.statusCode, `${campo}: ${r.body}`).toBe(422);
      expect(detalhes(r), campo).toEqual(expect.arrayContaining([expect.objectContaining({ path: campo })]));
      const depois = await foto(id);
      expect(depois, `${campo}: nada gravado`).toEqual(antes);
      expect(JSON.stringify(depois), `${campo}: a referência alheia não está em lugar nenhum`).not.toContain(daOutraOrg[campo]);
      provados++;
    }
    expect(provados).toBe(4);
    // PREMISSA: as MESMAS quatro trocas, com referências desta organização, gravam.
    const ok = await patch("order", id, { version: await versaoGravada(id), ...destaOrg });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await linha(id)).toMatchObject(destaOrg);
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
    // A MESMA resposta (a gravada no helper oficial): o conteúdo inteiro igual. A ordem das chaves não é contrato — o
    // helper guarda a resposta em jsonb, que reordena as chaves do objeto.
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2), "a mesma resposta").toEqual(j(r1));
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

  it("ED-8 reordenar os itens grava a posição, sobe a versão e o histórico diz a posição antes → depois", async () => {
    const id = await criar("order", { items: [ITEM({ quantity: "1", unit_price: "10.00" }), ITEM({ product_id: I.product!, quantity: "2", unit_price: "5.00" })] });
    const [a, b] = await itens(id);
    const v0 = await versaoGravada(id);
    const antesDaPatch = await eventos(id);
    const r = await patch("order", id, { version: v0, items: [{ id: b!.id }, { id: a!.id }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(await versaoGravada(id)).toBe(mais(v0, 1));
    const depois = await itens(id);
    expect(depois.map((x) => [x.id, x.position])).toEqual([[b!.id, 0], [a!.id, 1]]);
    const [ev] = daEdicao((await eventos(id)).slice(antesDaPatch.length));
    expect(ev, "a gravação da posição tem evento").toBeDefined();
    expect(ev!.metadata).toMatchObject({ via: "patch", campos: ["items"] });
    expect(ev!.before).toEqual({ items: { alterados: [{ id: b!.id, position: 1 }, { id: a!.id, position: 0 }], removidos: [] } });
    expect(ev!.after).toEqual({ items: { alterados: [{ id: b!.id, position: 0 }, { id: a!.id, position: 1 }], incluidos: [] } });
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

  it("ED-10 PUT: o id da resposta é o da URL — também com a URL em maiúsculas — nas três variantes", async () => {
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind);
      for (const naUrl of [id, id.toUpperCase()]) {
        const r = await h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${naUrl}`, headers: h.headers(), payload: corpo(kind, { note: `PUT ${naUrl}` }) });
        expect(r.statusCode, `${kind} ${naUrl}: ${r.body}`).toBe(200);
        expect(j(r).id, `${kind}: o id da URL`).toBe(naUrl);
        expect((await linha(id)).note, `${kind}: gravou no documento da URL`).toBe(`PUT ${naUrl}`);
        provados++;
      }
      expect(id, "premissa: o id gravado é minúsculo, a URL em maiúsculas é outro texto").not.toBe(id.toUpperCase());
    }
    expect(provados).toBe(6);
  });
});
