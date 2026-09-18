import { expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";

/**
 * FERRAMENTAS COMPARTILHADAS DAS PROVAS DA 0018 — PRE-BASE2-05C-2.
 *
 * As cinco suítes do cutover (`fresh`, `upgrade`, `fail-closed`, `concorrencia`, `transacao`) precisam das
 * mesmas duas coisas: montar um banco parado EXATAMENTE na 0017 — o estado ANTERIOR ao cutover, de onde
 * produção partiu ao recebê-lo — e
 * aplicar a 0018 sozinha, do jeito que o runner aplica, para poder observar a recusa. Duplicar isso em
 * cinco arquivos
 * faria as provas divergirem em silêncio na primeira correção que alguém esquecesse de replicar.
 */

export const ALVO = "0018_empresa_code_sequence.sql";

/** A entidade canônica do contador de Empresa DEPOIS do cutover. O par de runtime é `SEQUENCIA_EMPRESA`. */
export const CANONICA = "empresa";
/** A chave legada que a 0018 aposenta. */
export const LEGADA = "farm";

/**
 * Sobe o banco só até a migration ANTERIOR à 0018 — isto é, deixa o banco no estado PRÉ-CUTOVER, pós-05C-1.
 * Produção não está aqui: ela já recebeu a 0018 e, depois dela, a 0019.
 *
 * `MIGRATIONS_DIR` é lido na carga do módulo `migrate.js`; recarregar o módulo apontado para um diretório
 * temporário é o que dá um runner que para na 0017 sem mexer no módulo que aplica a 0018 depois. Mesmo
 * mecanismo de `purga-0017-upgrade.test.ts` e `runner-forward-only.test.ts`.
 */
export async function subirAte0017(db: Db): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-0018-ate17-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((nome) => nome < ALVO);
    expect(anteriores.length, "17 migrations antes do cutover do contador").toBe(17);
    expect(anteriores.at(-1), "a última antes da 0018 é a purga física").toBe("0017_purge_farm_legacy.sql");
    for (const nome of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate17 = await import("../src/migrate.js");
    expect(ate17.listMigrations().map((m) => m.name), "o runner parado na 0017 — o estado ANTERIOR ao cutover — não pode conhecer a 0018").not.toContain(ALVO);
    return await ate17.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** O SQL da 0018, lido do arquivo versionado — nunca uma cópia colada no teste. */
export function sqlDoCutover(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8");
}

/**
 * Aplica a 0018 do jeito que o runner aplica: UMA transação, o arquivo inteiro, e o registro no ledger
 * só se tudo passar. Devolve o erro em vez de lançá-lo, porque metade destas provas é sobre a RECUSA.
 */
export async function aplicarCutover(db: Db): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sqlDoCutover());
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, erro: (e as Error).message };
  } finally {
    c.release();
  }
}

/** Foto do contador inteiro: organização|entidade -> último valor. É o que precisa atravessar intacto. */
export async function fotoDoContador(db: Db): Promise<Record<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    "select organization_id::text || '|' || entity as k, last_value::text as v from erp.code_sequences order by 1");
  return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
}

/** Quantas linhas o contador tem para uma entidade — o número que precisa ser zero depois do cutover. */
export async function linhasDaEntidade(db: Db, entidade: string): Promise<number> {
  return Number((await db.query<{ n: string }>(
    "select count(*)::text n from erp.code_sequences where entity = $1", [entidade])).rows[0]!.n);
}

/** Cria uma organização descartável e devolve o id. */
export async function orgDescartavel(db: Db, nome: string): Promise<string> {
  return (await db.query<{ id: string }>(
    "insert into erp.organizations (name) values ($1) returning id", [nome])).rows[0]!.id;
}

/** Cria uma Empresa com código explícito — o acervo que o contador tem de continuar respeitando. */
export async function empresaComCodigo(db: Db, orgId: string, code: number, nome: string): Promise<string> {
  return (await db.query<{ id: string }>(
    "insert into erp.empresas (organization_id, code, name) values ($1,$2,$3) returning id",
    [orgId, code, nome])).rows[0]!.id;
}

/** Grava um contador com valor exato. */
export async function contador(db: Db, orgId: string, entidade: string, valor: number): Promise<void> {
  await db.query(
    `insert into erp.code_sequences (organization_id, entity, last_value) values ($1,$2,$3)
     on conflict (organization_id, entity) do update set last_value = excluded.last_value`,
    [orgId, entidade, valor]);
}

/** `erp.next_code` — a porta real de alocação, a mesma que a API usa. */
export async function proximoCodigo(db: Db, orgId: string, entidade: string): Promise<number> {
  return Number((await db.query<{ n: string }>(
    "select erp.next_code($1,$2)::text n", [orgId, entidade])).rows[0]!.n);
}
