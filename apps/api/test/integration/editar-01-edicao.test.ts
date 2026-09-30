import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { configuracaoNeutraTopV3, type ConfiguracaoTipoOperacaoV3 } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * EDITAR-01 (decisão 272) — `GET /api/sales/<seg>/:id/edicao`: ED-9.
 *
 * A pergunta "este documento pode ser editado, e sob quais regras?" — respondida pela VERSÃO CONGELADA no documento,
 * com a MESMA recusa que a PATCH daria (o lápis da tela não pode oferecer o que a PATCH recusa, nem esconder o que
 * ela aceita). Permissão `<perm>.edit`, SEM `<perm>.create`; invisível → a MESMA 404 do GET; sem edit → 403.
 *
 * Fixtures: TOPs pela API (partes e reserva com `destinos`/`reservaEstoque`), versão NOVA do formato 3 por SQL de
 * superusuário (como em top-config-05-vendas), papéis e membros pela API administrativa (como em
 * sales-variante-autorizacao), outra organização pelo `seedDemo` (como em anexos-pesquisa-01-anexos).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
const PERM = { budget: "budgets", order: "orders", sale: "sales" } as const;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;
type Variante = keyof typeof ROTA;
const VARIANTES: readonly Variante[] = ["budget", "order", "sale"];
let tops: Record<Variante, string>;
let topPedidoEmPartes: string; let topPedidoComReserva: string;
let outraOrg: Record<string, string>;

beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 3 });
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  tops = { budget: await criarTop("budget", "ED9 orçamento"), order: await criarTop("order", "ED9 pedido"), sale: await criarTop("sale", "ED9 venda") };
  topPedidoEmPartes = await criarTop("order", "ED9 pedido em partes", { destinos: [{ tipoOperacaoId: tops.sale, ordem: 0, emPartes: true }] });
  topPedidoComReserva = await criarTop("order", "ED9 pedido com reserva", { reservaEstoque: true, destinos: [{ tipoOperacaoId: tops.sale, ordem: 0, emPartes: true }] });
  const o2 = await seedDemo(admin, { orgName: "Org ED-9", slug: `org-ed9-${Date.now().toString(36)}`, adminEmail: "ed9-outra-org@demo.local" }, () => {});
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ed9-outra-org@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  outraOrg = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o2.orgId };
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
type Hdr = Record<string, string>;
type Linha = Record<string, unknown>;
type Regras = { formato: number; exigencias: string[]; condicoesPermitidas: string[] | null; clienteEmAtraso: { politica: string; toleranciaDias: number }; reservaEstoque: boolean };
type Edicao = {
  podeEditar: boolean; motivo: string | null; version: string;
  limites: { somenteArmazemEObservacao: boolean; armazemTravado: boolean };
  regras: Regras; condicoesPermitidas: unknown; layout: unknown; situacaoCliente: unknown;
};

let seq = 0;
async function criarTop(kind: Variante, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `ED9${String(++seq).padStart(3, "0")}`, codigoBase: FAMILIA[kind], nome: `${nome} ${seq}`, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function novaVersao(topId: string, config: ConfiguracaoTipoOperacaoV3, condicoes: string[] = []): Promise<void> {
  const v = (await admin.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.descricao, v.criado_por, $2::jsonb, 3, v.destinos_configurados
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1 returning id`, [topId, JSON.stringify(config)])).rows[0]!.id;
  expect((await admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [topId])).rowCount).toBe(1);
  for (const c of condicoes) {
    await admin.query("insert into erp.tipos_operacao_versao_condicoes(organization_id,origem_versao_id,origem_tipo_operacao_id,condicao_pagamento_id) values ($1,$2,$3,$4)", [h.demo.orgId, v, topId, c]);
  }
}
function cfg(ajuste: (c: ConfiguracaoTipoOperacaoV3) => void): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  ajuste(c);
  return c;
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return (await admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,1,30,'intervalo',30,null,false,null,true) returning id",
    [h.demo.orgId, `ED9-${n}`, `Condição ED9 ${n}`])).rows[0]!.id;
}
async function membro(rotulo: string, permissoes: string[], empresas: string[] = []): Promise<Hdr> {
  const sufixo = `${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `${rotulo} ${sufixo}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `ed9-${sufixo}@teste.local`;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: rotulo, email, password: "Editar@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Editar@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

type Item = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string };
const ITEM = (o: Partial<Item> = {}): Item => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "10.00", ...o });
async function criar(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, tipo_operacao_id: tops[kind], items: [ITEM()], ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const edicaoResposta = (kind: Variante, id: string, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}/edicao`, headers });
const getResposta = (kind: Variante, id: string, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}`, headers });
async function edicao(kind: Variante, id: string, headers: Hdr = h.headers()): Promise<Edicao> {
  const r = await edicaoResposta(kind, id, headers);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as Edicao;
}
async function ler(kind: Variante, id: string): Promise<Linha & { version: string; code: string; items: (Linha & { id: string })[] }> {
  const r = await getResposta(kind, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as Linha & { version: string; code: string; items: (Linha & { id: string })[] };
}
const acao = async (url: string, payload: Record<string, unknown> = {}) => {
  const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
  expect(r.statusCode, `${url}: ${r.body}`).toBeLessThan(300);
  return j(r);
};
/** A PATCH com a versão ATUAL: a recusa dela tem de ser a mesma que o `/edicao` anunciou. */
const patchAtual = async (kind: Variante, id: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "PATCH", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(), payload: { version: (await ler(kind, id)).version, ...payload } });

const MSG_NAO_EDITAVEL = "Documento não editável neste status";
const MSG_SEM_TOP = "Este documento não tem tipo de operação (registro anterior às operações) e não pode ser editado.";
const MSG_PARTES_ATIVAS = "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo.";
const MSG_PARTES_CANCELADAS = "Este documento já teve partes geradas; os itens não podem mais ser trocados.";
const SEM_LIMITES = { somenteArmazemEObservacao: false, armazemTravado: false };
const REGRAS_NEUTRAS = { formato: 2, exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 } };

describe("ED-9 — podeEditar e motivo", () => {
  it("ED-9 aberto → podeEditar true, sem motivo, sem limites, a versão do GET — nas três variantes; a PATCH aceita", async () => {
    let provados = 0;
    for (const kind of VARIANTES) {
      const id = await criar(kind);
      const e = await edicao(kind, id);
      const g = await ler(kind, id);
      expect(e, kind).toMatchObject({ podeEditar: true, motivo: null, limites: SEM_LIMITES, version: g.version });
      expect(e.regras, kind).toEqual({ ...REGRAS_NEUTRAS, reservaEstoque: false });
      for (const campo of ["condicoesPermitidas", "layout", "situacaoCliente"]) expect(e, `${kind}: ${campo}`).toHaveProperty(campo);
      const p = await patchAtual(kind, id, { note: "o /edicao disse que pode" });
      expect(p.statusCode, `${kind}: ${p.body}`).toBe(200);
      expect((await edicao(kind, id)).version, "a versão do /edicao acompanha").toBe(String(Number(g.version) + 1));
      provados++;
    }
    expect(provados).toBe(3);
  });

  it("ED-9 confirmado, cancelado e convertido → podeEditar false com o motivo da situação; a PATCH recusa com o MESMO texto", async () => {
    const confirmada = await criar("sale");
    await acao(`/api/sales/sales/${confirmada}/confirm`);
    const casos: [Variante, string][] = [["sale", confirmada]];
    for (const kind of VARIANTES) {
      const id = await criar(kind);
      await acao(`/api/sales/${ROTA[kind]}/${id}/cancel`);
      casos.push([kind, id]);
    }
    const convertido = await criar("order");
    await acao(`/api/sales/orders/${convertido}/convert`, { tipo_operacao_id: tops.sale });
    casos.push(["order", convertido]);
    for (const [kind, id] of casos) {
      const e = await edicao(kind, id);
      expect(e, `${kind} ${id}`).toMatchObject({ podeEditar: false, motivo: MSG_NAO_EDITAVEL, version: (await ler(kind, id)).version });
      const p = await patchAtual(kind, id, { note: "x" });
      expect([p.statusCode, j(p).error?.code, j(p).error?.message], `${kind}: ${p.body}`).toEqual([409, "INVALID_STATUS_TRANSITION", e.motivo]);
    }
    expect(casos).toHaveLength(5);
  });

  it("ED-9 sem TOP (documento legado) → podeEditar false com o motivo próprio; a PATCH recusa com o mesmo texto", async () => {
    for (const kind of VARIANTES) {
      const id = await criar(kind, { tipo_operacao_id: undefined });
      expect((await admin.query<{ t: string | null }>("select tipo_operacao_id t from erp.sales_documents where id=$1", [id])).rows[0]!.t, "premissa: legado").toBeNull();
      const e = await edicao(kind, id);
      expect(e, kind).toMatchObject({ podeEditar: false, motivo: MSG_SEM_TOP });
      const p = await patchAtual(kind, id, { note: "x" });
      expect([p.statusCode, j(p).error?.message], `${kind}: ${p.body}`).toEqual([409, MSG_SEM_TOP]);
    }
  });

  it("ED-9 origem com partes (ativa, depois só cancelada) → podeEditar false com as mensagens de hoje; a parte gerada → podeEditar true, só armazém e observação", async () => {
    const id = await criar("order", { tipo_operacao_id: topPedidoEmPartes, items: [ITEM({ quantity: "10" })] });
    const [item] = (await ler("order", id)).items;
    const parte = (await acao(`/api/sales/orders/${id}/convert`, { tipo_operacao_id: tops.sale, itens: [{ item_id: item!.id, quantidade: "4" }] })).id as string;
    const ativa = await edicao("order", id);
    expect(ativa).toMatchObject({ podeEditar: false, motivo: MSG_PARTES_ATIVAS });
    const p1 = await patchAtual("order", id, { note: "x" });
    expect([p1.statusCode, j(p1).error?.message]).toEqual([409, MSG_PARTES_ATIVAS]);
    // A parte: editável, com o limite da 06 (só armazém e observação do item); a origem não reserva → armazém livre.
    expect(await edicao("sale", parte)).toMatchObject({ podeEditar: true, motivo: null, limites: { somenteArmazemEObservacao: true, armazemTravado: false } });
    await acao(`/api/sales/sales/${parte}/cancel`);
    expect(await edicao("order", id)).toMatchObject({ podeEditar: false, motivo: MSG_PARTES_CANCELADAS });
    const p2 = await patchAtual("order", id, { note: "x" });
    expect([p2.statusCode, j(p2).error?.message]).toEqual([409, MSG_PARTES_CANCELADAS]);
    // A parte cancelada: situação.
    expect(await edicao("sale", parte)).toMatchObject({ podeEditar: false, motivo: MSG_NAO_EDITAVEL });
  });

  it("ED-9 parte de pedido com reserva → armazém travado; o pedido com reserva declara reservaEstoque na regra congelada", async () => {
    const pedido = await criar("order", { tipo_operacao_id: topPedidoComReserva, items: [ITEM({ quantity: "6" })] });
    const e = await edicao("order", pedido);
    expect(e).toMatchObject({ podeEditar: true, motivo: null, limites: SEM_LIMITES });
    expect(e.regras.reservaEstoque).toBe(true);
    const [item] = (await ler("order", pedido)).items;
    const parte = (await acao(`/api/sales/orders/${pedido}/convert`, { tipo_operacao_id: tops.sale, itens: [{ item_id: item!.id, quantidade: "2" }] })).id as string;
    const ep = await edicao("sale", parte);
    expect(ep).toMatchObject({ podeEditar: true, motivo: null, limites: { somenteArmazemEObservacao: true, armazemTravado: true } });
    expect(ep.regras.reservaEstoque, "venda nunca reserva").toBe(false);
    // O limite anunciado é o que a PATCH cobra: trocar o armazém da parte é recusado.
    const [pi] = (await ler("sale", parte)).items;
    const p = await patchAtual("sale", parte, { items: [{ id: pi!.id, warehouse_id: I.warehouse2! }] });
    expect(p.statusCode, p.body).toBe(422);
  });
});

describe("ED-9 — as regras da versão CONGELADA", () => {
  it("ED-9 a TOP ganhou versão NOVA depois do documento: o /edicao mostra a antiga (exigências, condições, atraso); /regras-da-operacao mostra a nova", async () => {
    const [c1, c2] = [await condicao(), await condicao()];
    // Cliente PRÓPRIO: nenhum título herdado do seed decide a situação.
    const cliente = (await admin.query<{ id: string }>(
      "insert into erp.people(organization_id,code,document,person_type,name,legal_name,city_id,is_client) values ($1,'ED91','99272000000091','legal','[TEST] Cliente ED9','[TEST] Cliente ED9',5208707,true) returning id",
      [h.demo.orgId])).rows[0]!.id;
    const top = await criarTop("order", "ED9 congelada");
    await novaVersao(top, cfg((c) => { c.geral.exigeObservacao = true; c.financeiro.clienteEmAtraso = "avisa"; c.financeiro.toleranciaAtrasoDias = 5; }), [c1]);
    const id = await criar("order", { tipo_operacao_id: top, client_id: cliente, note: "exigida", condicao_pagamento_id: c1 });
    await novaVersao(top, cfg((c) => { c.geral.exigeTransportadora = true; }), [c2]);

    const e = await edicao("order", id);
    expect(e.podeEditar).toBe(true);
    expect(e.regras).toEqual({ formato: 3, exigencias: ["note"], condicoesPermitidas: [c1], clienteEmAtraso: { politica: "avisa", toleranciaDias: 5 }, reservaEstoque: false });
    expect(JSON.stringify(e.condicoesPermitidas), "as condições da versão congelada").toContain(c1);
    expect(JSON.stringify(e.condicoesPermitidas)).not.toContain(c2);
    expect(e.situacaoCliente, "o cliente gravado pela política congelada").toMatchObject({ politica: "avisa", emAtraso: false, titulos: 0 });

    const atual = await h.app.inject({ method: "GET", url: `/api/sales/orders/regras-da-operacao?tipo_operacao_id=${top}`, headers: h.headers() });
    expect(atual.statusCode, atual.body).toBe(200);
    expect(j(atual)).toEqual({ formato: 3, exigencias: ["transporter_id"], condicoesPermitidas: [c2], clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 }, reservaEstoque: false });
  });
});

describe("ED-9 — a porta", () => {
  it("ED-9 só com <perm>.edit (sem create, sem view) → 200 nas três variantes; sem edit → 403", async () => {
    const docs: Record<Variante, string> = { budget: await criar("budget"), order: await criar("order"), sale: await criar("sale") };
    const soEdit = await membro("ED9 só edit", VARIANTES.map((k) => `${PERM[k]}.edit`));
    let provados = 0;
    for (const kind of VARIANTES) {
      const e = await edicao(kind, docs[kind], soEdit);
      expect(e, kind).toMatchObject({ podeEditar: true, motivo: null, version: (await ler(kind, docs[kind])).version });
      // PREMISSA: ele NÃO tem create (as rotas de lançamento o recusam).
      const regras = await h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/regras-da-operacao?tipo_operacao_id=${tops[kind]}`, headers: soEdit });
      expect(regras.statusCode, `${kind}: ${regras.body}`).toBe(403);
      provados++;
    }
    expect(provados).toBe(3);
    const soVe = await membro("ED9 só view", VARIANTES.map((k) => `${PERM[k]}.view`));
    for (const kind of VARIANTES) {
      expect((await getResposta(kind, docs[kind], soVe)).statusCode, `premissa: ${kind} visível`).toBe(200);
      const r = await edicaoResposta(kind, docs[kind], soVe);
      expect(r.statusCode, `${kind}: ${r.body}`).toBe(403);
    }
  });

  it("ED-9 a MESMA 404 do GET: inexistente, excluído, outra variante, empresa fora do escopo e outra organização", async () => {
    const pedido = await criar("order");
    const excluido = await criar("order");
    expect((await admin.query("update erp.sales_documents set deleted_at=now() where id=$1", [excluido])).rowCount).toBe(1);
    const daEmpresa2 = await criar("order", { empresa_id: I.empresa2, items: [ITEM({ warehouse_id: I.warehouseEmpresa2! })] });
    const soEmpresa1 = await membro("ED9 empresa 1", ["orders.view", "orders.edit"], [I.empresa]);
    const casos: [string, Variante, string, Hdr][] = [
      ["inexistente", "order", "00000000-0000-4000-8000-000000000272", h.headers()],
      ["excluído", "order", excluido, h.headers()],
      ["outra variante", "budget", pedido, h.headers()],
      ["empresa fora do escopo", "order", daEmpresa2, soEmpresa1],
      ["outra organização", "order", pedido, outraOrg],
    ];
    const corpos = new Set<string>();
    for (const [nome, kind, id, headers] of casos) {
      const e = await edicaoResposta(kind, id, headers);
      const g = await getResposta(kind, id, headers);
      expect([e.statusCode, g.statusCode], `${nome}: ${e.body}`).toEqual([404, 404]);
      expect(e.body, `${nome}: a MESMA 404 do GET`).toBe(g.body);
      corpos.add(e.body);
    }
    expect(corpos.size, `um corpo só: ${[...corpos].join(" | ")}`).toBe(1);
    // PREMISSAS: os 404 são recorte, não rota quebrada.
    expect((await edicao("order", pedido)).podeEditar).toBe(true);
    expect((await edicao("order", pedido, soEmpresa1)).podeEditar, "o usuário da empresa 1 enxerga o pedido dela").toBe(true);
    expect((await edicao("order", daEmpresa2)).podeEditar, "o dono enxerga o da empresa 2").toBe(true);
  });
});
