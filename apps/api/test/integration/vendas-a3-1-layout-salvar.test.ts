import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { LAYOUT_DO_SISTEMA, ERRO_LAYOUT_CAMPO_OBRIGATORIO, mensagemCampoObrigatorio, type EstruturaLayout } from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * LAYOUT DO DOCUMENTO — COBRANÇA AO SALVAR E LAYOUT EFETIVO (VENDAS-A3-1, LD-A5…LD-A8).
 *
 * Layouts e ligações são montados por SQL (superusuário de teste): esta suíte prova a ROTA DE VENDAS, não o
 * cadastro administrativo. Toda recusa vem com a PREMISSA ao lado (o mesmo cenário, completo, grava), e toda
 * "não cobrança" com a prova de que o documento REALMENTE está sem o campo que o layout exige.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let transportadora: string;
beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  transportadora = await comPool(async (c) => (await c.query<{ id: string }>(
    "select id from erp.people where organization_id=$1 order by is_transporter desc, code limit 1", [h.demo.orgId])).rows[0]!.id);
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

let seq = 0;
async function top(kind: Variante): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `31${String(++seq).padStart(2, "0")}`, codigoBase: FAMILIA[kind], nome: `TOP A3-1 ${seq}` } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/**
 * Layout do sistema da família com os campos pedidos marcados obrigatórios (e rótulo trocado, se pedido).
 * Natureza e centro de resultado DESMARCADOS: no layout do sistema eles são obrigatórios "da classificação" (a tela
 * os exige com a capacidade A1), e um layout configurado cobra o que marca — deixá-los marcados faria cada caso
 * provar a classificação em vez do campo sob teste. Desmarcar é escolha legítima do administrador.
 */
function estruturaExigindo(kind: Variante, exigir: { campo: string; rotulo?: string }[], itens: { campo: string; rotulo?: string }[] = []): EstruturaLayout {
  const e = LAYOUT_DO_SISTEMA(FAMILIA[kind]);
  for (const x of [...e.cabecalho, ...e.rodape.flatMap((a) => a.campos)]) {
    if (x.campo === "categoria_financeira_id" || x.campo === "centro_custo_id") x.obrigatorio = false;
    const p = exigir.find((q) => q.campo === x.campo);
    if (p) { x.obrigatorio = true; if (p.rotulo) x.rotulo = p.rotulo; }
  }
  for (const x of e.itens) {
    const p = itens.find((q) => q.campo === x.campo);
    if (p) { x.obrigatorio = true; if (p.rotulo) x.rotulo = p.rotulo; }
  }
  return e;
}
async function layout(kind: Variante, estrutura: EstruturaLayout, o: { padrao?: boolean; ligarA?: string } = {}): Promise<{ id: string; nome: string }> {
  const n = ++seq; const nome = `Layout A3-1 ${n}`;
  const id = await comPool(async (c) => (await c.query<{ id: string }>(
    "insert into erp.layouts_documento(organization_id,code,nome,familia,padrao,estrutura) values ($1,$2,$3,$4,$5,$6) returning id",
    [h.demo.orgId, `LA31-${n}`, nome, FAMILIA[kind], o.padrao ?? false, JSON.stringify(estrutura)])).rows[0]!.id);
  if (o.ligarA) await comPool((c) => c.query("insert into erp.layout_documento_tops(organization_id,layout_id,tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, id, o.ligarA]));
  return { id, nome };
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return comPool(async (c) => (await c.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,2,30,'intervalo',30,false) returning id",
    [h.demo.orgId, `A31-${n}`, `Condição A3-1 ${n}`])).rows[0]!.id);
}

const ITEM = (extra: Record<string, unknown> = {}) => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "50.00", ...extra });
const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM()], ...extra });
const criar = (kind: Variante, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(), payload: corpo(extra) });
async function documento(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await criar(kind, extra);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const editar = (kind: Variante, id: string, c: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(), payload: c });
const efetivo = (kind: Variante, q: string) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/layout-efetivo${q}`, headers: h.headers() });
const documentosDaOrg = () => comPool(async (c) => Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where organization_id=$1", [h.demo.orgId])).rows[0]!.n));
const gravado = (id: string) => comPool(async (c) => (await c.query<{ status: string; transporter_id: string | null; tipo_operacao_id: string | null; condicao_pagamento_id: string | null }>(
  "select status, transporter_id, tipo_operacao_id, condicao_pagamento_id from erp.sales_documents where id=$1", [id])).rows[0]!);
const recusa = (campos: { path: string; rotulo: string }[]): Erro => {
  const details = campos.map((c) => ({ path: c.path, message: mensagemCampoObrigatorio(c.rotulo) }));
  return { code: ERRO_LAYOUT_CAMPO_OBRIGATORIO, message: details[0]!.message, details };
};

describe("LD-A5 obrigatório do layout ligado à TOP", () => {
  it("LD-A5 transportadora exigida: POST sem → 422 com o rótulo do layout; com → 201; PUT sem → 422", async () => {
    const T = await top("sale");
    await layout("sale", estruturaExigindo("sale", [{ campo: "transporter_id", rotulo: "Transportadora do layout" }]), { ligarA: T });
    const antes = await documentosDaOrg();
    const r = await criar("sale", { tipo_operacao_id: T });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(recusa([{ path: "transporter_id", rotulo: "Transportadora do layout" }]));
    expect(await documentosDaOrg(), "nada gravado").toBe(antes);
    const id = await documento("sale", { tipo_operacao_id: T, transporter_id: transportadora });
    expect(await documentosDaOrg()).toBe(antes + 1);
    // PUT segue o contrato de hoje: transporter_id ausente = vazio → o layout cobra (tipo_operacao_id ausente = preservado).
    const p = await editar("sale", id, corpo());
    expect(p.statusCode, p.body).toBe(422);
    expect(j(p).error).toEqual(recusa([{ path: "transporter_id", rotulo: "Transportadora do layout" }]));
    expect((await gravado(id)).transporter_id, "PUT recusado não gravou").toBe(transportadora);
    const ok = await editar("sale", id, corpo({ transporter_id: transportadora, note: "ok" }));
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("LD-A5 condição exigida: PUT SEM a chave num documento com condição → 200 (preservada conta como preenchida); null → 422", async () => {
    const T = await top("order");
    await layout("order", estruturaExigindo("order", [{ campo: "condicao_pagamento_id" }]), { ligarA: T });
    const semCond = await criar("order", { tipo_operacao_id: T });
    expect(semCond.statusCode, semCond.body).toBe(422);
    expect(j(semCond).error).toEqual(recusa([{ path: "condicao_pagamento_id", rotulo: "Condição de pagamento" }]));
    const c = await condicao();
    const id = await documento("order", { tipo_operacao_id: T, condicao_pagamento_id: c });
    const p = await editar("order", id, corpo({ note: "sem a chave da condição" }));
    expect(p.statusCode, p.body).toBe(200);
    expect((await gravado(id)).condicao_pagamento_id).toBe(c);
    const n = await editar("order", id, corpo({ condicao_pagamento_id: null }));
    expect(n.statusCode, n.body).toBe(422);
    expect(j(n).error?.code).toBe(ERRO_LAYOUT_CAMPO_OBRIGATORIO);
    expect((await gravado(id)).condicao_pagamento_id).toBe(c);
  });

  it("LD-A5 a cobrança vem DEPOIS das recusas atuais: TOP indisponível continua sendo a recusa da TOP", async () => {
    const T = await top("sale");
    await layout("sale", estruturaExigindo("sale", [{ campo: "transporter_id" }]), { ligarA: T });
    const r = await criar("sale", { tipo_operacao_id: T, condicao_pagamento_id: "00000000-0000-4000-8000-0000000000a3" });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.code, "a condição inválida é recusada antes do layout").toBe("CONDICAO_PAGAMENTO_INVALIDA");
  });
});

describe("LD-A6 coluna obrigatória do item", () => {
  it("LD-A6 armazém exigido: item sem armazém → 422 em items[i].warehouse_id; com → 201", async () => {
    const T = await top("budget");
    await layout("budget", estruturaExigindo("budget", [], [{ campo: "warehouse_id" }]), { ligarA: T });
    const r = await criar("budget", { tipo_operacao_id: T, items: [ITEM(), ITEM({ warehouse_id: null })] });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(recusa([{ path: "items[1].warehouse_id", rotulo: "Armazém" }]));
    await documento("budget", { tipo_operacao_id: T, items: [ITEM(), ITEM()] });
  });
});

describe("LD-A7 conversão e confirmação não são cobradas", () => {
  it("LD-A7 conversão para TOP cujo layout exige transportadora: o gerado nasce sem ela", async () => {
    const Tp = await top("order");
    await layout("order", estruturaExigindo("order", [{ campo: "transporter_id" }]), { ligarA: Tp });
    // premissa: a digitação direta com essa TOP é cobrada
    expect((await criar("order", { tipo_operacao_id: Tp })).statusCode).toBe(422);
    const orc = await documento("budget");
    const r = await h.app.inject({ method: "POST", url: `/api/sales/budgets/${orc}/convert`, headers: h.headers(), payload: { tipo_operacao_id: Tp } });
    expect(r.statusCode, r.body).toBe(201);
    const g = await gravado(j(r).id as string);
    expect(g).toMatchObject({ tipo_operacao_id: Tp, transporter_id: null });
  });

  it("LD-A7 confirmação de venda sem o campo que o layout passou a exigir → confirma", async () => {
    const T = await top("sale");
    const L = await layout("sale", estruturaExigindo("sale", []), { ligarA: T });
    const id = await documento("sale", { tipo_operacao_id: T });
    await comPool((c) => c.query("update erp.layouts_documento set estrutura=$2 where id=$1", [L.id, JSON.stringify(estruturaExigindo("sale", [{ campo: "transporter_id" }]))]));
    // premissa: salvar agora é cobrado
    expect((await editar("sale", id, corpo())).statusCode).toBe(422);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(await gravado(id)).toMatchObject({ status: "confirmed", transporter_id: null });
  });
});

describe("LD-A8 sem layout configurado nada novo é cobrado", () => {
  it("LD-A8 documento sem TOP e TOP sem layout (família sem padrão) → layout do sistema, grava como hoje", async () => {
    // O documento mínimo de hoje: sem transportadora, sem classificação, sem condição, sem armazém no item.
    const minimo = { items: [ITEM({ warehouse_id: null, unit_price: "0" })] };
    const semTop = await documento("sale", minimo);
    expect((await editar("sale", semTop, corpo(minimo))).statusCode).toBe(200);
    const T = await top("sale");
    const efet = j(await efetivo("sale", `?tipo_operacao_id=${T}`));
    expect(efet.origem, "premissa: esta TOP cai no sistema").toBe("sistema");
    const comTop = await documento("sale", { tipo_operacao_id: T, ...minimo });
    expect((await editar("sale", comTop, corpo(minimo))).statusCode).toBe(200);
  });
});

describe("layout-efetivo", () => {
  it("origem ligado / padrao_da_familia / sistema; TOP fora da variante → a mesma 404", async () => {
    const Tl = await top("order");
    const Ll = await layout("order", estruturaExigindo("order", [{ campo: "driver_name" }]), { ligarA: Tl });
    const Tsem = await top("order");
    const semPadrao = j(await efetivo("order", `?tipo_operacao_id=${Tsem}`));
    expect(semPadrao).toEqual({ estrutura: LAYOUT_DO_SISTEMA("vendas.pedido"), origem: "sistema", nome: null, id: null });
    const Lp = await layout("order", estruturaExigindo("order", [{ campo: "note" }]), { padrao: true });
    const ligado = await efetivo("order", `?tipo_operacao_id=${Tl}`);
    expect(ligado.statusCode, ligado.body).toBe(200);
    expect(j(ligado)).toMatchObject({ origem: "ligado", id: Ll.id, nome: Ll.nome });
    expect(j(ligado).estrutura).toEqual(estruturaExigindo("order", [{ campo: "driver_name" }]));
    expect(j(await efetivo("order", `?tipo_operacao_id=${Tsem}`))).toMatchObject({ origem: "padrao_da_familia", id: Lp.id, nome: Lp.nome });
    // ligado inativo → cai no padrão da família
    await comPool((c) => c.query("update erp.layouts_documento set is_active=false where id=$1", [Ll.id]));
    expect(j(await efetivo("order", `?tipo_operacao_id=${Tl}`))).toMatchObject({ origem: "padrao_da_familia", id: Lp.id });
    // sem TOP → sistema (mesmo com padrão na família)
    expect(j(await efetivo("order", ""))).toMatchObject({ origem: "sistema", id: null, nome: null });
    // TOP de outra variante, inexistente e id malformado → a MESMA 404
    const corpos = new Set<string>();
    for (const q of [`?tipo_operacao_id=${Tl}`, "?tipo_operacao_id=00000000-0000-4000-8000-0000000000a3", "?tipo_operacao_id=abc"]) {
      const r = await efetivo("sale", q);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(404);
      corpos.add(r.body);
    }
    expect(corpos.size, "sem oráculo").toBe(1);
  });
});
