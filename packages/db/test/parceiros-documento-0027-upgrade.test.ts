import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * DOC-2 — A 0027 SOBRE UM ACERVO COM DOCUMENTO SÓ DE PONTUAÇÃO (R1-6, decisão 253).
 *
 * A pré-condição da 0027 conta duplicado só entre documentos que ficam NÃO VAZIOS depois de normalizar. O índice
 * `ux_people_documento_normalizado` precisa do MESMO filtro: sem ele, dois parceiros vivos da mesma organização
 * com documento só de pontuação ("..." e "-/-", distintos byte a byte e por isso aceitos pelo `ux_people_document`
 * da 0002) passam pela pré-condição e derrubam a criação do índice — a migration inteira volta.
 *
 * Mesmo mecanismo do CE-5 (0025): o runner recarregado sobre um diretório só com as migrations anteriores, o
 * acervo plantado, e a 0027 aplicada como o runner a aplica (uma transação, o arquivo inteiro, a linha no ledger).
 */
const ALVO = "0027_parceiros_ficha_em_abas.sql";
let db: Db; let org: string;

async function subirAte0026(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc2-ate26-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((n) => n < ALVO);
    expect(anteriores.at(-1), "a última antes da 0027 é a 0026").toBe("0026_referencias_oficiais.sql");
    for (const n of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(dir, n));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate26 = await import("../src/migrate.js");
    expect(ate26.listMigrations().map((m) => m.name)).not.toContain(ALVO);
    await ate26.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR; else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function aplicar0027(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8"));
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, erro: (e as Error).message };
  } finally { c.release(); }
}

const noLedger = async () => Number((await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n);
const pontuacao = async () => (await db.query<{ code: string; document: string }>(
  "select code, document from erp.people where organization_id=$1 and code like 'DOC2-P%' and deleted_at is null order by code", [org])).rows;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await subirAte0026();
  org = (await db.query<{ id: string }>("insert into erp.organizations(name,slug) values ('Org DOC-2','org-doc2') returning id")).rows[0]!.id;
  // acervo: dois vivos com documento SÓ DE PONTUAÇÃO (vazio depois de normalizar) + um com documento de verdade
  await db.query(
    `insert into erp.people (organization_id, code, name, document, is_client) values
       ($1, 'DOC2-P1', 'Pontuação 1', '...', true),
       ($1, 'DOC2-P2', 'Pontuação 2', '-/-', true),
       ($1, 'DOC2-C1', 'Com CNPJ', '11.222.333/0001-81', true)`, [org]);
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("DOC-2 — 0027 sobre acervo com 2 documentos só de pontuação", () => {
  it("premissa: parado na 0026, sem o índice novo, com os dois vivos de documento só de pontuação na mesma organização", async () => {
    expect((await db.query("select to_regclass('erp.ux_people_documento_normalizado') is null as ausente")).rows[0]).toEqual({ ausente: true });
    expect(await pontuacao()).toEqual([{ code: "DOC2-P1", document: "..." }, { code: "DOC2-P2", document: "-/-" }]);
    const vazio = await db.query<{ n: string }>(
      "select count(*)::text n from erp.people where organization_id=$1 and deleted_at is null and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = ''", [org]);
    expect(vazio.rows[0]!.n, "os dois normalizam para vazio: é o que a pré-condição ignora").toBe("2");
    expect(await noLedger()).toBe(0);
  });

  it("aplica; o índice nasce com o MESMO filtro da pré-condição; os dois parceiros continuam como estavam", async () => {
    const r = await aplicar0027();
    expect(r, JSON.stringify(r)).toEqual({ ok: true });
    expect(await noLedger()).toBe(1);
    const def = (await db.query<{ d: string }>("select pg_get_indexdef('erp.ux_people_documento_normalizado'::regclass) d")).rows[0]!.d;
    expect(def).toMatch(/^CREATE UNIQUE INDEX ux_people_documento_normalizado ON erp\.people/);
    expect(def, "filtro: normalizado diferente de vazio").toMatch(/WHERE \(\(document IS NOT NULL\) AND \(deleted_at IS NULL\) AND \(upper\(regexp_replace\(document, '\[\^0-9A-Za-z\]'::text, ''::text, 'g'::text\)\) <> ''::text\)\)/);
    expect(await pontuacao(), "nenhum UPDATE: o acervo não muda").toEqual([{ code: "DOC2-P1", document: "..." }, { code: "DOC2-P2", document: "-/-" }]);
  });

  it("o índice ignora os dois (e um terceiro só de pontuação entra); documento de verdade repetido continua recusado", async () => {
    await db.query("insert into erp.people (organization_id, code, name, document, is_client) values ($1, 'DOC2-P3', 'Pontuação 3', '/', true)", [org]);
    expect((await pontuacao()).map((x) => x.code)).toEqual(["DOC2-P1", "DOC2-P2", "DOC2-P3"]);
    await expect(db.query("insert into erp.people (organization_id, code, name, document, is_client) values ($1, 'DOC2-C2', 'CNPJ repetido', '11222333000181', true)", [org]))
      .rejects.toMatchObject({ code: "23505", constraint: "ux_people_documento_normalizado" });
  });
});
