import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · FRENTE D (testes da seção 8): ZN-1..ZN-5 — Zerar numeração (D-3).
 *
 * RV-Z1 (reversa): tirar a RECONTAGEM dentro da transação em lib/numeracao-cadastro.ts (`zerarNumeracao`) →
 * ZN-5 reprova: numa rodada em que o Novo grava primeiro, o Zerar volta 200 com um registro vivo e a numeração
 * "volta para 1" por cima dele.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const zerar = (cadastro: string, headers = hdr()) => h.app.inject({ method: "POST", url: `/api/admin/numeracao/${cadastro}/zerar`, headers, payload: {} });
const linha = (cadastro: string) => h.app.inject({ method: "GET", url: `/api/admin/numeracao/${cadastro}`, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers: hdr(), payload });
const mensagens = (r: Resp) => [j(r).error?.message, ...((j(r).error?.details ?? []) as { message: string }[]).map((d) => d.message)].join(" | ");
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows;
const esvaziar = (tabela: string) => admin.query(`update erp.${tabela} set deleted_at = now() where organization_id=$1 and deleted_at is null`, [h.demo.orgId]);

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 4 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("ZN-1 Naturezas vazias com \"1\"/\"1.01\" excluídos", () => {
  it("zerar → excluídos viram EXC-<id> (linha e histórico ficam); criar → \"1\"; filho → \"1.01\"; audit", async () => {
    await esvaziar("financial_categories");
    const [um] = await q<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1'", [h.demo.orgId]);
    const [umUm] = await q<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1.01'", [h.demo.orgId]);
    expect(um && umUm, "premissa: \"1\" e \"1.01\" excluídos seguram o número").toBeTruthy();
    // sem zerar, a sugestão pula o número segurado (o fato da produção)
    const antes = await post("financial_categories", { name: "ZN1 antes", nature: "income", kind: "synthetic" });
    expect(antes.statusCode, antes.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(antes).id])).toEqual([{ code: "3" }]);
    await admin.query("update erp.financial_categories set deleted_at=now() where id=$1", [j(antes).id]);
    const l = j(await linha("financial_categories"));
    expect(l).toMatchObject({ registros: 0, podeZerar: true });
    expect(l.excluidos).toBeGreaterThanOrEqual(3);
    const totalAntes = (await q("select id from erp.financial_categories where organization_id=$1", [h.demo.orgId])).length;
    const r = await zerar("financial_categories");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ proximoCodigo: "1" });
    expect(await q("select code from erp.financial_categories where id=$1", [um!.id])).toEqual([{ code: `EXC-${um!.id}` }]);
    expect(await q("select code from erp.financial_categories where id=$1", [umUm!.id])).toEqual([{ code: `EXC-${umUm!.id}` }]);
    expect((await q("select id from erp.financial_categories where organization_id=$1", [h.demo.orgId])).length, "nenhuma linha apagada").toBe(totalAntes);
    expect(await q("select count(*)::int n from erp.financial_categories where organization_id=$1 and deleted_at is not null and code not like 'EXC-%'", [h.demo.orgId])).toEqual([{ n: 0 }]);
    const [log] = await q<{ metadata: { excluidos_liberados: number; contador_anterior: unknown } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='financial_categories' and action='zerar' order by id desc limit 1", [h.demo.orgId]);
    expect(log?.metadata.excluidos_liberados).toBe(l.excluidos);
    expect(log?.metadata).toHaveProperty("contador_anterior");
    const raiz = await post("financial_categories", { name: "ZN1 raiz", nature: "income", kind: "synthetic" });
    expect(raiz.statusCode, raiz.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(raiz).id])).toEqual([{ code: "1" }]);
    const filho = await post("financial_categories", { name: "ZN1 filho", nature: "income", kind: "analytic", parent_id: j(raiz).id });
    expect(filho.statusCode, filho.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(filho).id])).toEqual([{ code: "1.01" }]);
  });
});

describe("ZN-2 Parceiros sem vivos e contador 15", () => {
  it("zerar → próximo 1; o Novo recebe o código 1", async () => {
    await esvaziar("people");
    await admin.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,'person',15) on conflict (organization_id, entity) do update set last_value=15", [h.demo.orgId]);
    const r = await zerar("people");
    expect(r.statusCode, r.body).toBe(200);
    expect(Number(j(r).proximoCodigo)).toBe(1);
    expect(await q("select last_value::int v from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId])).toEqual([{ v: 0 }]);
    const [log] = await q<{ metadata: { contador_anterior: number } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='people' order by id desc limit 1", [h.demo.orgId]);
    expect(log?.metadata.contador_anterior).toBe(15);
    const p = await post("people", { name: "ZN2 primeiro", person_type: "legal", is_client: true });
    expect(p.statusCode, p.body).toBe(201);
    const [g] = await q<{ code: string }>("select code from erp.people where id=$1", [j(p).id]);
    expect(Number(g!.code)).toBe(1);
  });
});

describe("ZN-3 com 1 vivo (mesmo inativo) → 422", () => {
  it("Parceiros com 1 inativo: 422 com o motivo; nada muda (contador, códigos, audit)", async () => {
    const [p] = await q<{ id: string }>("select id from erp.people where organization_id=$1 and deleted_at is null", [h.demo.orgId]);
    await admin.query("update erp.people set is_active=false where id=$1", [p!.id]);
    const cont = await q("select last_value from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId]);
    const logs = await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId]);
    const l = j(await linha("people"));
    expect(l).toMatchObject({ registros: 1, podeZerar: false });
    expect(l.motivo).toMatch(/Há 1 registro/);
    const r = await zerar("people");
    expect(r.statusCode, r.body).toBe(422);
    expect(mensagens(r)).toMatch(/Há 1 registro/);
    expect(await q("select last_value from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId])).toEqual(cont);
    expect(await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId])).toEqual(logs);
    expect(await q("select count(*)::int n from erp.people where organization_id=$1 and code like 'EXC-%' and deleted_at is null", [h.demo.orgId])).toEqual([{ n: 0 }]);
    // árvore com vivos também
    expect((await zerar("chart_accounts")).statusCode).toBe(422);
  });
  it("documento NUNCA: cadastro fora da lista (títulos, vendas, lançamentos) → 404", async () => {
    for (const c of ["payables", "sales_documents", "invoices", "input_entries", "stock_movements", "apuracoes"]) expect((await zerar(c)).statusCode, c).toBe(404);
  });
});

describe("ZN-4 sem tenant_parameters.edit → 403", () => {
  it("operador: 403 no zerar e na leitura; nada muda", async () => {
    const logs = await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId]);
    expect((await zerar("financial_categories", { ...h.opHeaders(), "content-type": "application/json" })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "GET", url: "/api/admin/numeracao", headers: h.opHeaders() })).statusCode).toBe(403);
    expect(await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId])).toEqual(logs);
  });
});

describe("ZN-5 zerar ao mesmo tempo que um Novo", () => {
  const rodadas = async (key: string, corpo: (i: number) => Record<string, unknown>, primeiro: (c: string) => boolean, tabela: string) => {
    const resultados: string[] = [];
    for (let i = 0; i < 12; i++) {
      await esvaziar(tabela);
      const [z, n] = await Promise.all([zerar(key), post(key, corpo(i))]);
      expect(n.statusCode, `rodada ${i}: o Novo sempre grava (${n.body})`).toBe(201);
      expect([200, 422], `rodada ${i}: ${z.body}`).toContain(z.statusCode);
      const [g] = await q<{ code: string }>(`select code from erp.${tabela} where id=$1`, [j(n).id]);
      if (z.statusCode === 200) {
        // zerou: não havia vivo — o Novo esperou e recebeu o PRIMEIRO código
        expect(primeiro(g!.code), `rodada ${i}: zerou com o Novo ${g!.code} vivo — o Zerar não esperou/recontou`).toBe(true);
        resultados.push("zerou-antes");
      } else {
        expect(mensagens(z)).toMatch(/Há 1 registro/);
        resultados.push("novo-antes");
      }
      // nunca código repetido entre vivos e excluídos não liberados
      const rep = await q(`select code, count(*)::int n from erp.${tabela} where organization_id=$1 and code not like 'EXC-%' group by code having count(*) > 1`, [h.demo.orgId]);
      expect(rep, `rodada ${i}: código repetido`).toEqual([]);
    }
    console.log(`[ZN-5] ${key}: ${resultados.join(",")}`);
    return resultados;
  };
  it("Naturezas (árvore): um espera o outro; se zerou, o Novo é \"1\"; nunca código repetido", async () => {
    await rodadas("financial_categories", (i) => ({ name: `ZN5 nat ${i}`, nature: "income", kind: "synthetic" }), (c) => c === "1", "financial_categories");
  });
  it("Contas bancárias (sequencial): idem; se zerou, o Novo é o número 1", async () => {
    await rodadas("bank_accounts", (i) => ({ description: `ZN5 conta ${i}`, type: "checking" }), (c) => Number(c) === 1, "bank_accounts");
  });
  it("ordem forçada: o Novo grava ANTES → o Zerar seguinte recusa (a recontagem vê o vivo)", async () => {
    await esvaziar("financial_categories");
    const n = await post("financial_categories", { name: "ZN5 antes", nature: "income", kind: "synthetic" });
    expect(n.statusCode).toBe(201);
    const z = await zerar("financial_categories");
    expect(z.statusCode, z.body).toBe(422);
  });
});

// revisão adversarial: a trava da TABELA vale para todas as organizações, e o pedido na fila já faz as gravações
// novas esperarem. Com registro vivo o Zerar recusa ANTES de pedir a trava; vazio, espera no máximo 2 s e desiste.
describe("ZN-6 a trava da tabela não congela as outras organizações", () => {
  it("cadastro em uso por outra transação (ex.: importação longa de outra organização): com vivos → 422 sem esperar; vazio → 409 em ~2 s, nada muda; livre → 200", async () => {
    const outra = await admin.connect();
    const exc = async () => (await q<{ n: number }>("select count(*)::int n from erp.cost_centers where organization_id=$1 and code like 'EXC-%'", [h.demo.orgId]))[0]!.n;
    const zerados = async () => (await q<{ n: number }>("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='cost_centers' and action='zerar'", [h.demo.orgId]))[0]!.n;
    try {
      await outra.query("begin");
      await outra.query("lock table erp.cost_centers in row exclusive mode"); // o que uma gravação em curso segura
      const t0 = Date.now();
      const comVivos = await zerar("cost_centers");
      expect(comVivos.statusCode, comVivos.body).toBe(422);
      expect(Date.now() - t0, "recusa sem entrar na fila da trava").toBeLessThan(1500);
      await esvaziar("cost_centers");
      const [excAntes, zeradosAntes] = [await exc(), await zerados()];
      const t1 = Date.now();
      const emUso = await zerar("cost_centers");
      const espera = Date.now() - t1;
      expect(emUso.statusCode, emUso.body).toBe(409);
      expect(mensagens(emUso)).toMatch(/em uso agora/);
      expect(espera, "esperou a trava").toBeGreaterThanOrEqual(1800);
      expect(espera, "e desistiu, em vez de ficar na fila").toBeLessThan(6000);
      expect([await exc(), await zerados()], "nada mudou").toEqual([excAntes, zeradosAntes]);
    } finally { await outra.query("rollback"); outra.release(); }
    const livre = await zerar("cost_centers");
    expect(livre.statusCode, livre.body).toBe(200);
  }, 30_000);
});
