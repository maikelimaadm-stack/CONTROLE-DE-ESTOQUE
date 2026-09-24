import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * CE-5 — A 0025 SOBRE UM BANCO PARADO NA 0024 (CADASTROS-ESTRUTURA).
 *
 * O acervo tem grupos, categorias, classes e produtos no modelo antigo (três cadastros planos, categoria e
 * classe NOT NULL). A promessa da 0025 é ser aditiva/relaxante: nenhuma linha muda de valor, as colunas novas
 * do grupo nascem com o padrão (sem código, sem pai, analítico, vivo), e a migration só se aplica sozinha —
 * uma aplicação concorrente morre na trava (2026,59) com a recusa NOMEADA. Nome repetido sem diferenciar
 * maiúsculas PARA a migration nomeando os grupos, sem renomear nada.
 *
 * Mesmo mecanismo do teste da 0024: o runner recarregado sobre um diretório só com as migrations anteriores.
 */
const ALVO = "0025_grupo_de_produtos_arvore.sql";
let db: Db; let demo: DemoOrg;

async function subirAte0024(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-ate24-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((n) => n < ALVO);
    expect(anteriores.at(-1), "a última antes da 0025 é a 0024").toBe("0024_venda_classificacao_financeira.sql");
    for (const n of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(dir, n));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate24 = await import("../src/migrate.js");
    expect(ate24.listMigrations().map((m) => m.name)).not.toContain(ALVO);
    await ate24.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR; else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Aplica como o runner: uma transação, o arquivo inteiro, a linha no ledger. `antes` roda na MESMA transação. */
async function aplicar0025(antes?: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>): Promise<{ ok: true } | { ok: false; erro: string }> {
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

const TABELAS = ["product_groups", "product_categories", "product_kinds", "products"] as const;
/** Foto do acervo: tabela → id → linha inteira. É o que NÃO pode mudar. */
const foto = async () => {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const t of TABELAS) {
    const r = await db.query<{ id: string; linha: Record<string, unknown> }>(`select id, to_jsonb(x) as linha from erp.${t} x order by id`);
    out[t] = Object.fromEntries(r.rows.map((x) => [x.id, x.linha]));
  }
  return out;
};
const colunasDaArvore = async () => Number((await db.query<{ n: string }>(
  "select count(*)::text n from information_schema.columns where table_schema='erp' and table_name='product_groups' and column_name in ('code','parent_id','kind','deleted_at')")).rows[0]!.n);
const noLedger = async () => Number((await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n);

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await subirAte0024();
  await seedReference(db, () => {});
  // O seed, parado antes da 0025, grava o modelo ANTIGO: grupos planos, cada um com categoria e classe.
  demo = await seedDemo(db, {}, () => {});
  // acervo extra, como produção teria: um grupo "teste" sem código, sem categoria e sem produto
  await db.query("insert into erp.product_groups(organization_id,name) values ($1,'teste')", [demo.orgId]);
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("CE-5 — upgrade da 0024 para a 0025", () => {
  it("premissa: o acervo tem grupos, categorias, classes e produtos com categoria/classe preenchidas", async () => {
    const f = await foto();
    for (const t of TABELAS) expect(Object.keys(f[t]!).length, t).toBeGreaterThan(3);
    const semCat = await db.query("select 1 from erp.products where category_id is null or kind_id is null");
    expect(semCat.rowCount).toBe(0);
  });

  it("trava (2026,59) em poder de outra sessão → recusa NOMEADA, nada aplicado", async () => {
    const antes = await foto();
    const outra = await db.connect();
    try {
      await outra.query("begin");
      await outra.query("select pg_advisory_xact_lock(2026, 59)");
      const r = await aplicar0025();
      expect(r.ok).toBe(false);
      expect((r as { erro: string }).erro).toMatch(/CADASTROS-ESTRUTURA: outra transacao ja detem a trava desta migration \(2026,59\)/);
    } finally {
      await outra.query("rollback").catch(() => {});
      outra.release();
    }
    expect(await colunasDaArvore(), "nenhuma coluna nasceu").toBe(0);
    expect(await noLedger()).toBe(0);
    expect(await foto()).toEqual(antes);
  });

  it("nome repetido sem diferenciar maiúsculas na mesma organização → PARA nomeando os grupos, nada renomeado", async () => {
    const antes = await foto();
    const r = await aplicar0025(async (q) => { await q("insert into erp.product_groups(organization_id,name) values ($1,'TESTE')", [demo.orgId]); });
    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toMatch(/CADASTROS-ESTRUTURA: grupos de produtos com o mesmo nome.*('TESTE', 'teste'|'teste', 'TESTE')/);
    expect(await colunasDaArvore()).toBe(0);
    expect(await noLedger()).toBe(0);
    expect(await foto()).toEqual(antes);
  });

  it("aplicada sobre o acervo: nenhuma linha muda, colunas novas no padrão, pós-condições verdes", async () => {
    const antes = await foto();
    const r = await aplicar0025();
    expect(r, JSON.stringify(r)).toEqual({ ok: true });
    expect(await noLedger()).toBe(1);
    const depois = await foto();
    for (const t of TABELAS) {
      expect(Object.keys(depois[t]!).sort(), t).toEqual(Object.keys(antes[t]!).sort());
      for (const [id, linha] of Object.entries(depois[t]!)) {
        if (t === "product_groups") {
          const { code, parent_id, kind, deleted_at, ...resto } = linha;
          expect({ code, parent_id, kind, deleted_at }, id).toEqual({ code: null, parent_id: null, kind: "analytic", deleted_at: null });
          expect(resto, `o grupo ${id} não pode ter mudado`).toEqual(antes[t]![id]);
        } else expect(linha, `${t} ${id} não pode ter mudado`).toEqual(antes[t]![id]);
      }
    }
    const cons = await db.query<{ conname: string; contype: string; n: number }>(
      "select conname, contype, array_length(conkey,1) as n from pg_constraint where conname in ('uq_product_groups_tenant','fk_product_groups_parent','product_groups_kind_check','product_groups_organization_id_name_key') order by conname");
    expect(cons.rows).toEqual([
      { conname: "fk_product_groups_parent", contype: "f", n: 2 },
      { conname: "product_groups_kind_check", contype: "c", n: 1 },
      { conname: "uq_product_groups_tenant", contype: "u", n: 2 },
    ]);
    const idx = await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='erp' and tablename='product_groups' and indexname in ('uq_product_groups_code_vivo','uq_product_groups_nome_irmaos') order by 1");
    expect(idx.rows.map((x) => x.indexname)).toEqual(["uq_product_groups_code_vivo", "uq_product_groups_nome_irmaos"]);
    const nulas = await db.query<{ column_name: string; is_nullable: string }>("select column_name, is_nullable from information_schema.columns where table_schema='erp' and table_name='products' and column_name in ('category_id','kind_id') order by 1");
    expect(nulas.rows).toEqual([{ column_name: "category_id", is_nullable: "YES" }, { column_name: "kind_id", is_nullable: "YES" }]);
  });

  it("depois da 0025: FK composta recusa pai de outra organização; mesmo nome sob pais diferentes passa; raízes homônimas colidem", async () => {
    const outra = (await db.query<{ id: string }>("insert into erp.organizations(name,slug) values ('Outra 0025','outra-0025') returning id")).rows[0]!.id;
    const alheio = (await db.query<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'1','Alheio','synthetic') returning id", [outra])).rows[0]!.id;
    await expect(db.query("insert into erp.product_groups(organization_id,code,name,parent_id) values ($1,'1.01','Filho de alheio',$2)", [demo.orgId, alheio])).rejects.toMatchObject({ code: "23503", constraint: "fk_product_groups_parent" });
    const a = (await db.query<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'8','Pai A 0025','synthetic') returning id", [demo.orgId])).rows[0]!.id;
    const b = (await db.query<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'9','Pai B 0025','synthetic') returning id", [demo.orgId])).rows[0]!.id;
    await db.query("insert into erp.product_groups(organization_id,code,name,parent_id) values ($1,'8.01','Rações',$2),($1,'9.01','Rações',$3)", [demo.orgId, a, b]);
    await expect(db.query("insert into erp.product_groups(organization_id,code,name) values ($1,'7','pai a 0025')", [demo.orgId])).rejects.toMatchObject({ code: "23505", constraint: "uq_product_groups_nome_irmaos" });
    await expect(db.query("insert into erp.product_groups(organization_id,code,name) values ($1,'8','Outro com código 8')", [demo.orgId])).rejects.toMatchObject({ code: "23505", constraint: "uq_product_groups_code_vivo" });
  });
});
