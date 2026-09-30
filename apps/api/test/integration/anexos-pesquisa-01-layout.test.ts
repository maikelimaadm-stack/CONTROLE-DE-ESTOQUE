import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { LAYOUT_DO_SISTEMA, padroesRegistroDaEstrutura, removerPadroesRegistro, type EstruturaLayout } from "@agro/domain";
import { conferirPadroesRegistro, layoutEfetivo, type RegistroPadraoConferido } from "../../src/lib/layout-documento.js";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ANEXOS-PESQUISA-01 · item 0 · L-0 — o `/layout-efetivo` de vendas passou a responder por `respostaDoLayoutEfetivo`
 * (o mesmo dono das rotas de compras). A resposta tem de ser a MESMA BYTE A BYTE. A prova: o corpo HTTP de hoje é
 * comparado, como string, com o corpo que o CÓDIGO ANTIGO da rota produzia — a cópia fiel dele está em
 * `respostaAntiga` abaixo (o bloco inline de `sales.ts` antes do item 0), executada sobre o MESMO banco.
 *  L-0a  sistema: sem `tipo_operacao_id` (três variantes) e TOP sem layout ligado nem padrão da família
 *  L-0b  padrão da família
 *  L-0c  ligado sem padrão de cadastro
 *  L-0d  ligado com padrão de cadastro: um válido (armazém, com empresa), um válido sem empresa e um inválido
 */
let h: Harness; let admin: Db;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;
const FAMILIA = { budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" } as const;
type Ctx = Parameters<typeof layoutEfetivo>[0];
let seq = 0;
let fx: { warehouse: string; incomeCategory: string };

/** CÓPIA FIEL do corpo antigo do handler (sales.ts, antes do item 0): a referência do byte a byte. */
async function respostaAntiga(ctx: Ctx, familia: string, topId: string | null) {
  const l = await layoutEfetivo(ctx, familia, topId);
  if (!padroesRegistroDaEstrutura(familia, l.estrutura).length) return { estrutura: l.estrutura, origem: l.origem, nome: l.nome, id: l.id };
  const c = await conferirPadroesRegistro(ctx, familia, l.estrutura);
  const padroesDeCadastro: Record<string, RegistroPadraoConferido> = Object.fromEntries([...c.validos].map(([chave, v]) =>
    [chave, { id: v.id, rotulo: v.rotulo, ...(v.empresaId !== undefined ? { empresaId: v.empresaId } : {}) }]));
  const padroesInvalidos = [...new Set(c.invalidos.map((x) => x.chave))];
  return { estrutura: removerPadroesRegistro(l.estrutura), origem: l.origem, nome: l.nome, id: l.id, padroesDeCadastro, padroesInvalidos };
}
/** O contexto mínimo que o código antigo lê (`tx` e `orgId`), sobre o superusuário de teste da MESMA organização. */
const ctxDeTeste = (): Ctx => ({ tx: admin, orgId: h.demo.orgId } as unknown as Ctx);

const efetivo = (kind: Variante, topId?: string) => h.app.inject({ method: "GET",
  url: `/api/sales/${ROTA[kind]}/layout-efetivo${topId ? `?tipo_operacao_id=${topId}` : ""}`, headers: h.headers() });

async function top(kind: Variante): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `L0${String(++seq).padStart(2, "0")}`, codigoBase: FAMILIA[kind], nome: `TOP L-0 ${seq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return (JSON.parse(r.body) as { id: string }).id;
}
async function layout(kind: Variante, estrutura: EstruturaLayout, o: { padrao?: boolean; ligarA?: string } = {}): Promise<string> {
  const n = ++seq;
  const id = (await admin.query<{ id: string }>(
    "insert into erp.layouts_documento(organization_id,code,nome,familia,padrao,estrutura) values ($1,$2,$3,$4,$5,$6) returning id",
    [h.demo.orgId, `L0-${n}`, `Layout L-0 ${n}`, FAMILIA[kind], o.padrao ?? false, JSON.stringify(estrutura)])).rows[0]!.id;
  if (o.ligarA) await admin.query("insert into erp.layout_documento_tops(organization_id,layout_id,tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, id, o.ligarA]);
  return id;
}
/** Compara o corpo HTTP de hoje com o do código antigo, como STRING; devolve o corpo para as premissas do caso. */
async function mesmoCorpo(kind: Variante, topId?: string): Promise<Record<string, unknown>> {
  const r = await efetivo(kind, topId);
  expect(r.statusCode, r.body).toBe(200);
  const antigo = JSON.stringify(await respostaAntiga(ctxDeTeste(), FAMILIA[kind], topId ?? null));
  expect(r.body).toBe(antigo);
  return JSON.parse(r.body) as Record<string, unknown>;
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  const f = await ids(h);
  if (!f.warehouse || !f.incomeCategory) throw new Error("fixture ausente: armazém ou natureza de receita");
  fx = { warehouse: f.warehouse, incomeCategory: f.incomeCategory };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("L-0 /layout-efetivo de vendas: byte a byte igual ao código antigo", () => {
  it("L-0a sistema — sem TOP nas três variantes e TOP sem ligado nem padrão da família", async () => {
    for (const kind of ["budget", "order", "sale"] as const) {
      const b = await mesmoCorpo(kind);
      expect(b).toEqual({ estrutura: LAYOUT_DO_SISTEMA(FAMILIA[kind]), origem: "sistema", nome: null, id: null });
      expect(Object.keys(b)).toEqual(["estrutura", "origem", "nome", "id"]);
    }
    const b = await mesmoCorpo("order", await top("order"));
    expect(b.origem).toBe("sistema");
  });

  it("L-0b padrão da família", async () => {
    const id = await layout("budget", LAYOUT_DO_SISTEMA(FAMILIA.budget), { padrao: true });
    const b = await mesmoCorpo("budget", await top("budget"));
    expect(b).toMatchObject({ origem: "padrao_da_familia", id });
  });

  it("L-0c ligado sem padrão de cadastro — só as quatro chaves", async () => {
    const t = await top("sale");
    const id = await layout("sale", LAYOUT_DO_SISTEMA(FAMILIA.sale), { ligarA: t });
    const b = await mesmoCorpo("sale", t);
    expect(b).toMatchObject({ origem: "ligado", id });
    expect(Object.keys(b)).toEqual(["estrutura", "origem", "nome", "id"]);
  });

  it("L-0d ligado com padrão de cadastro — válidos (com e sem empresa) e inválido", async () => {
    const est = LAYOUT_DO_SISTEMA(FAMILIA.order);
    const cat = est.cabecalho.find((c) => c.campo === "categoria_financeira_id");
    const cond = [...est.cabecalho, ...est.rodape.flatMap((a) => a.campos)].find((c) => c.campo === "condicao_pagamento_id");
    const arm = est.itens.find((c) => c.campo === "warehouse_id");
    if (!cat || !cond || !arm) throw new Error("premissa: natureza, condição e armazém na estrutura do sistema");
    cat.valorPadrao = { tipo: "registro", id: fx.incomeCategory };
    cond.valorPadrao = { tipo: "registro", id: "00000000-0000-4000-8000-000000000000" };
    arm.valorPadrao = { tipo: "registro", id: fx.warehouse };
    const t = await top("order");
    await layout("order", est, { ligarA: t });
    const b = await mesmoCorpo("order", t);
    expect(b.origem).toBe("ligado");
    expect(Object.keys(b.padroesDeCadastro as object).sort()).toEqual(["categoria_financeira_id", "itens.warehouse_id"]);
    expect((b.padroesDeCadastro as Record<string, { empresaId?: string }>)["itens.warehouse_id"]!.empresaId, "armazém com empresa").toBeTruthy();
    expect(b.padroesInvalidos).toEqual(["condicao_pagamento_id"]);
    expect(JSON.stringify(b.estrutura)).not.toContain("\"registro\"");
  });
});
