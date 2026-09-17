import { expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";

/**
 * FERRAMENTAS COMPARTILHADAS DAS PROVAS DA 0019 — hotfix da numeração de transferências.
 *
 * As suítes do hotfix (`upgrade`, `concorrencia`) precisam das mesmas duas coisas: montar um banco
 * parado EXATAMENTE na 0018 — o estado que produção tem hoje — e aplicar a 0019 sozinha, do jeito que o
 * runner aplica, para poder observar tanto o sucesso quanto a recusa. Mesmo molde de
 * `cutover-0018-ajuda.ts`, pelo mesmo motivo: duplicar isso faria as provas divergirem em silêncio.
 */

export const ALVO = "0019_warehouse_transfer_code_sequence.sql";

/** A entidade canônica do contador de transferência. O par de runtime é `SEQUENCIA_WAREHOUSE_TRANSFER`. */
export const CANONICA = "warehouse_transfer";
/** A chave que o hotfix aposenta como LINHA e mantém viva como ALIAS. */
export const LEGADA = "farm_transfer";

/**
 * Sobe o banco só até a migration ANTERIOR à 0019 — o estado de produção pós-05C-2.
 *
 * `MIGRATIONS_DIR` é lido na carga do módulo `migrate.js`; recarregar o módulo apontado para um
 * diretório temporário é o que dá um runner que para na 0018 sem mexer no módulo que aplica a 0019
 * depois. Mesmo mecanismo de `cutover-0018-ajuda.ts` e `runner-forward-only.test.ts`.
 */
export async function subirAte0018(db: Db): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hotfix-0019-ate18-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((nome) => nome < ALVO);
    expect(anteriores.at(-1), "a última antes do hotfix é o cutover do contador de Empresa")
      .toBe("0018_empresa_code_sequence.sql");
    for (const nome of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate18 = await import("../src/migrate.js");
    expect(ate18.listMigrations().map((m) => m.name), "o runner do estado de produção não conhece o hotfix")
      .not.toContain(ALVO);
    return await ate18.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** O SQL da 0019, lido do arquivo versionado — nunca uma cópia colada no teste. */
export function sqlDoHotfix(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8");
}

/**
 * Aplica a 0019 do jeito que o runner aplica: UMA transação, o arquivo inteiro, e o registro no ledger
 * só se tudo passar. Devolve o erro em vez de lançá-lo, porque parte destas provas é sobre a RECUSA.
 */
export async function aplicarHotfix(db: Db, registrarNoLedger = true): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sqlDoHotfix());
    if (registrarNoLedger) await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, erro: (e as Error).message };
  } finally {
    c.release();
  }
}

/** Foto do contador inteiro: organização|entidade -> último valor. */
export async function fotoDoContador(db: Db): Promise<Record<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    "select organization_id::text || '|' || entity as k, last_value::text as v from erp.code_sequences order by 1");
  return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
}

/** Foto do ACERVO: organização|código -> kind. É o que NÃO pode mudar. */
export async function fotoDoAcervo(db: Db): Promise<Record<string, string>> {
  const r = await db.query<{ k: string; v: string }>(
    "select organization_id::text || '|' || code as k, kind as v from erp.warehouse_transfers order by 1");
  return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
}

/** Quantas linhas o contador tem para uma entidade. */
export async function linhasDaEntidade(db: Db, entidade: string): Promise<number> {
  return Number((await db.query<{ n: string }>(
    "select count(*)::text n from erp.code_sequences where entity = $1", [entidade])).rows[0]!.n);
}

/** Grava um contador com valor exato. */
export async function contador(db: Db, orgId: string, entidade: string, valor: number): Promise<void> {
  await db.query(
    `insert into erp.code_sequences (organization_id, entity, last_value) values ($1,$2,$3)
     on conflict (organization_id, entity) do update set last_value = excluded.last_value`,
    [orgId, entidade, valor]);
}

/** Lê o `last_value` de um contador; `null` quando a linha não existe (que NÃO é zero: é reinício em 1). */
export async function valorDoContador(db: Db, orgId: string, entidade: string): Promise<number | null> {
  const r = await db.query<{ v: string }>(
    "select last_value::text v from erp.code_sequences where organization_id=$1 and entity=$2", [orgId, entidade]);
  return r.rows[0] ? Number(r.rows[0].v) : null;
}

/** `erp.next_code` — a porta real de alocação, a mesma que a API usa. */
export async function proximoCodigo(db: Db, orgId: string, entidade: string): Promise<number> {
  return Number((await db.query<{ n: string }>(
    "select erp.next_code($1,$2)::text n", [orgId, entidade])).rows[0]!.n);
}

/**
 * Organização com a infraestrutura mínima para ter transferência: uma empresa e dois armazéns.
 * Devolve os ids que o `transferenciaComCodigo` precisa.
 */
export async function orgComArmazens(db: Db, nome: string): Promise<{ orgId: string; empresaId: string; a: string; b: string }> {
  const orgId = (await db.query<{ id: string }>(
    "insert into erp.organizations (name) values ($1) returning id", [nome])).rows[0]!.id;
  const empresaId = (await db.query<{ id: string }>(
    "insert into erp.empresas (organization_id, code, name) values ($1,1,$2) returning id", [orgId, `${nome} E1`])).rows[0]!.id;
  const arm = async (iniciais: string) => (await db.query<{ id: string }>(
    "insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id",
    [orgId, empresaId, iniciais, `${nome} ${iniciais}`])).rows[0]!.id;
  return { orgId, empresaId, a: await arm("A"), b: await arm("B") };
}

/**
 * Transferência com CÓDIGO EXPLÍCITO — o acervo que o contador tem de continuar respeitando.
 * O código entra como texto, exatamente como o runtime o grava, para que o teste possa montar tanto
 * códigos numéricos zero-padded quanto códigos não numéricos.
 */
export async function transferenciaComCodigo(
  db: Db,
  o: { orgId: string; empresaId: string; a: string; b: string },
  code: string,
  kind: "warehouse" | "farm" = "warehouse",
): Promise<string> {
  return (await db.query<{ id: string }>(
    `insert into erp.warehouse_transfers
       (organization_id, code, transfer_date, kind, empresa_origem_id, origin_warehouse_id, empresa_destino_id, destination_warehouse_id)
     values ($1,$2,'2026-01-01',$3,$4,$5,$4,$6) returning id`,
    [o.orgId, code, kind, o.empresaId, o.a, o.b])).rows[0]!.id;
}

/**
 * Movimentação de rebanho de transferência entre empresas, com CÓDIGO EXPLÍCITO.
 *
 * É o acervo da OUTRA tabela que dividia a chave legada, e o que prova que a 0019 não a abandonou.
 * `erp.animal_movements` exige empresa; o resto das colunas fica no mínimo que o schema aceita.
 */
export async function movimentoDeRebanhoComCodigo(
  db: Db,
  o: { orgId: string; empresaId: string },
  code: string,
): Promise<string> {
  return (await db.query<{ id: string }>(
    `insert into erp.animal_movements
       (organization_id, empresa_id, code, movement_type, movement_date, status)
     values ($1,$2,$3,'farm_transfer','2026-01-01','pending') returning id`,
    [o.orgId, o.empresaId, code])).rows[0]!.id;
}
