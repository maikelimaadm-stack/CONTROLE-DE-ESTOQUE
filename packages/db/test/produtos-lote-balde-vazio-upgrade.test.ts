import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * LT-8 (R1-1 h, PR #62) — A 0029 SOBRE UM ACERVO COM SALDO SEM LOTE DE PRODUTO COM LOTE.
 *
 * Depois da 0029 todo movimento de produto com controle de lote exige o lote (gatilho `trg_stock_movements_exige_lote`)
 * e a escolha automática da saída só olha lotes preenchidos: um saldo no balde SEM lote (`provider_lot = ''`) de um
 * produto com `has_lot` ficaria PRESO — nenhuma saída o alcança. A pré-condição nomeada PARA a migration dizendo QUAIS
 * produtos, e nada é aplicado. O caso limpo (saldo só em lotes preenchidos, balde '' zerado, produto sem lote com saldo
 * sem lote) aplica.
 *
 * Mesmo mecanismo do CE-5 (grupo-produtos-arvore-upgrade): o runner recarregado sobre um diretório só com as
 * migrations anteriores; o acervo é plantado no schema da 0028, como a produção estaria.
 */
const ALVO = "0029_produtos_ficha_em_abas.sql";
let db: Db; let demo: DemoOrg;
let vacina: { id: string; code: string }; let ivermectina: { id: string; code: string }; let sal: string;
let armazem: { id: string; empresa_id: string };

async function subirAte0028(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lt8-ate28-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((n) => n < ALVO);
    expect(anteriores.at(-1), "a última antes da 0029 é a 0028").toBe("0028_rh_funcionarios.sql");
    for (const n of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(dir, n));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate28 = await import("../src/migrate.js");
    expect(ate28.listMigrations().map((m) => m.name)).not.toContain(ALVO);
    await ate28.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR; else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Q = (sql: string, p?: unknown[]) => Promise<unknown>;
/** Aplica como o runner: uma transação, o arquivo inteiro, a linha no ledger. `antes` roda na MESMA transação. */
async function aplicar0029(antes?: (q: Q) => Promise<void>): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes((sql, p) => c.query(sql, p as unknown[]));
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8"));
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, erro: (e as Error).message };
  } finally { c.release(); }
}

/** Um movimento gravado direto no ledger do schema 0028 (antes da 0029 não há gatilho de lote). */
const movimento = (q: Q, product_id: string, direction: 1 | -1, quantity: string, provider_lot: string | null) =>
  q(`insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, unit_cost, provider_lot, source_type, source_id, movement_date)
     values ($1,$2,$3,$4,$5,$6,$7,3,$8,'teste_lt8',gen_random_uuid(),'2026-09-20')`,
    [demo.orgId, armazem.empresa_id, armazem.id, product_id, direction === 1 ? "entry" : "writeoff", direction, quantity, provider_lot]);
const sobreODb: Q = (sql, p) => db.query(sql, p as unknown[]);

const colunaDoControle = async () => Number((await db.query<{ n: string }>(
  "select count(*)::text n from information_schema.columns where table_schema='erp' and table_name='products' and column_name='controle_lote'")).rows[0]!.n);
const noLedger = async () => Number((await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n);
/** Foto do que a recusa não pode mudar: produtos, saldos e ledger de estoque. */
const foto = async () => ({
  produtos: (await db.query("select to_jsonb(p) as l from erp.products p order by id")).rows,
  saldos: (await db.query("select to_jsonb(b) as l from erp.stock_balances b order by product_id, warehouse_id, provider_lot")).rows,
  movimentos: (await db.query("select count(*)::text n from erp.stock_movements")).rows[0]
});

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await subirAte0028();
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  const um = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql, [demo.orgId])).rows[0]!;
  vacina = await um<{ id: string; code: string }>("select id::text, code from erp.products where organization_id=$1 and description like 'Vacina%'");
  ivermectina = await um<{ id: string; code: string }>("select id::text, code from erp.products where organization_id=$1 and description like 'Ivermectina%'");
  sal = (await um<{ id: string }>("select id::text from erp.products where organization_id=$1 and description like 'Sal Mineral%' and not has_lot")).id;
  armazem = await um<{ id: string; empresa_id: string }>("select id::text, empresa_id::text from erp.warehouses where organization_id=$1 and initials='ALM' order by id limit 1");
  // ACERVO LIMPO, como a produção pode estar: a vacina (has_lot) tem saldo num lote preenchido e um balde '' que
  // entrou e saiu (zero); o sal (sem lote) tem saldo sem lote — nada disso fica preso.
  await movimento(sobreODb, vacina.id, 1, "10", "L-1");
  await movimento(sobreODb, vacina.id, 1, "4", null);
  await movimento(sobreODb, vacina.id, -1, "4", null);
  await movimento(sobreODb, sal, 1, "25", null);
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("LT-8 — 0029 com saldo no balde sem lote de produto com lote", () => {
  it("premissa: o acervo tem produto com lote, saldo em lote preenchido e balde '' zerado; o sem lote tem saldo ''", async () => {
    const s = await db.query<{ product_id: string; provider_lot: string; quantity: string }>(
      "select product_id::text, provider_lot, quantity::text from erp.stock_balances where product_id = any($1::uuid[]) order by product_id, provider_lot", [[vacina.id, sal]]);
    const porProduto = (id: string) => Object.fromEntries(s.rows.filter((x) => x.product_id === id).map((x) => [x.provider_lot, x.quantity]));
    expect(porProduto(vacina.id)).toEqual({ "": "0.0000", "L-1": "10.0000" });
    expect(porProduto(sal)).toEqual({ "": "25.0000" });
    expect((await db.query<{ has_lot: boolean }>("select has_lot from erp.products where id=$1", [vacina.id])).rows[0]!.has_lot).toBe(true);
    expect(await colunaDoControle()).toBe(0);
    expect(await noLedger()).toBe(0);
  });

  it("saldo ≠ 0 sem lote em DOIS produtos com lote (balde '' e lote só de espaços) → PARA nomeando os dois; nada aplicado", async () => {
    const antes = await foto();
    const r = await aplicar0029(async (q) => {
      await movimento(q, vacina.id, 1, "5", null);
      // lote só de espaços (a API anterior não aparava): depois da 0029 ele é "sem lote" para a API e para o gatilho
      // de lote (btrim), e fica tão preso quanto o balde ''
      await movimento(q, ivermectina.id, 1, "2", "  ");
    });
    expect(r.ok).toBe(false);
    const erro = (r as { erro: string }).erro;
    expect(erro).toMatch(/^CADASTROS-F6: produto com lote e saldo SEM lote \(balde vazio\): /);
    expect(erro).toContain(`${vacina.code} - Vacina Aftosa 50 doses (${vacina.id})`);
    expect(erro).toContain(`${ivermectina.code} - Ivermectina 1% 500mL (${ivermectina.id})`);
    expect(erro).toMatch(/Zere esse saldo antes de aplicar a 0029; nada foi aplicado\.$/);
    expect(erro, "o produto sem lote com saldo '' não é nomeado").not.toContain(sal);
    expect(await colunaDoControle(), "nenhuma coluna nasceu").toBe(0);
    expect(await noLedger()).toBe(0);
    expect(await foto()).toEqual(antes);
  });

  it("balde '' com saldo NEGATIVO também prende (quantity <> 0, não > 0)", async () => {
    // o gatilho de saldo não deixa ficar negativo; o cenário é gravado direto no saldo, como um acervo reparado à mão
    const r = await aplicar0029(async (q) => {
      await q("insert into erp.stock_balances (organization_id, warehouse_id, product_id, provider_lot, quantity) values ($1,$2,$3,'',-1) on conflict (organization_id, warehouse_id, product_id, provider_lot) do update set quantity = -1",
        [demo.orgId, armazem.id, vacina.id]);
    });
    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toContain(`(${vacina.id})`);
    expect(await colunaDoControle()).toBe(0);
    expect(await noLedger()).toBe(0);
  });

  it("caso limpo: aplica; o controle da vacina é 'lote' e o saldo de antes está intacto", async () => {
    const antes = await foto();
    const r = await aplicar0029();
    expect(r, JSON.stringify(r)).toEqual({ ok: true });
    expect(await noLedger()).toBe(1);
    expect((await db.query("select controle_lote, has_lot from erp.products where id=$1", [vacina.id])).rows[0]).toEqual({ controle_lote: "lote", has_lot: true });
    expect((await db.query("select controle_lote from erp.products where id=$1", [sal])).rows[0]).toEqual({ controle_lote: "nenhum" });
    const depois = await foto();
    expect(depois.saldos).toEqual(antes.saldos);
    expect(depois.movimentos).toEqual(antes.movimentos);
    // a coluna nova do lote de produção (R1-1 c) nasceu anulável
    expect((await db.query("select data_type, is_nullable from information_schema.columns where table_schema='erp' and table_name='feed_batches' and column_name='validade'")).rows)
      .toEqual([{ data_type: "date", is_nullable: "YES" }]);
  });
});
