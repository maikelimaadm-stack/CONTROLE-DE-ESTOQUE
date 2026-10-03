import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0048 (OPERACOES-01 F12, dívidas de segurança, decisão 288), PROVADA CONTRA O BANCO — COMO O RUNNER APLICA.
 *
 * A dívida: erp.audit_row (0001) é SECURITY DEFINER sem search_path — roda com os direitos do dono e resolve os nomes
 * não qualificados do corpo no caminho de QUEM grava. A 0048 fixa o caminho (`erp, pg_temp`) sem reescrever o corpo.
 *
 * Antes de aplicar (DB-0 a DB-2): a PREMISSA — o corpo vigente é o da 0001 (nenhuma migration o redefine; o md5 do
 * catálogo é o do arquivo), ele só usa objetos do erp e do pg_catalog, a auditoria grava pelo papel da aplicação, e a
 * dívida é REAL: com um schema do atacante antes do pg_catalog no caminho da sessão, a to_jsonb dele roda COMO O DONO
 * e falsifica o conteúdo auditado. Depois: a trava (2026,82), o lock_timeout de 2s e cada pré-condição quebrada numa
 * transação desfeita, com a SUA mensagem ("já aplicada" antes de todas).
 * DB-3: aplica — o ledger, o caminho fixo, o definer, o corpo IDÊNTICO (md5), dono, privilégios e gatilhos intactos.
 * DB-4: a auditoria CONTINUA gravando (INSERT/UPDATE/DELETE pelo papel da aplicação, conteúdo conferido), e o mesmo
 * ataque da premissa não pega mais; a tabela homônima audit_logs fora do caminho (no schema do atacante e no public)
 * nunca recebe nada.
 * DB-5: as pós-condições (só de catálogo), cada uma quebrada numa transação desfeita, com a sua mensagem.
 * DB-6: reaplicar é recusado ("já aplicada"); a trava é liberada no commit.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;

const ALVO = "0048_search_path_da_auditoria.sql";
const M = "OPERACOES-01 F12: ";
/** As migrations ANTERIORES à 0048 no repositório (o banco deste teste sobe até elas, arquivo a arquivo). */
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const sqlDaAlvo = () => listMigrations().find((x) => x.name === ALVO)!.sql;
/** O md5 do corpo da 0001 — o único que a 0048 aceita, e o mesmo que ela confere depois. */
const MD5_DA_0001 = "d2f094910e177fca30a3d9fab6f6672e";
const SCHEMA_ATACANTE = "sec_atacante_f12";

const TRAVA = `${M}outra transacao ja detem a trava desta migration (2026,82). Nada foi aplicado.`;
const JA = `${M}erp.audit_row ja tem search_path fixo; a 0048 ja foi aplicada ou ha schema divergente.`;
const AUSENTE = `${M}funcao erp.audit_row() ausente ou fora da forma (gatilho em plpgsql, da 0001); a cadeia de migrations esta fora de ordem.`;
const SEM_DEFINER = `${M}erp.audit_row() nao e SECURITY DEFINER; schema divergente (a 0001 a cria definer).`;
const CONFIG = (c: string) => `${M}erp.audit_row() ja tem configuracao propria; schema divergente: ${c}`;
const DONO_SEM_BYPASS = `${M}o dono de erp.audit_row() nao atravessa RLS; schema divergente (a auditoria nao gravaria fora do escopo de quem grava).`;
const NAO_DONO = `${M}o papel que aplica a migration nao e dono de erp.audit_row() (nem membro do papel dono); o ALTER FUNCTION seria recusado.`;
const CORPO = (md5: string) => `${M}o corpo de erp.audit_row() nao e o da 0001 (md5 ${md5}); o caminho fixo so foi conferido para aquele corpo.`;
const POS_CAMINHO = (c: string) => `${M}configuracao de erp.audit_row() diferente de search_path "erp, pg_temp" depois da 0048: ${c}`;
const POS_DEFINER = `${M}erp.audit_row() deixou de ser SECURITY DEFINER depois da 0048.`;
const POS_CORPO = (md5: string) => `${M}o corpo de erp.audit_row() mudou na 0048 (md5 ${md5}); ela so fixa o caminho.`;

/** O corpo de erp.audit_row como a 0001 o escreve (o texto entre os $$ é o prosrc). */
const corpoDa0001 = () =>
  /create or replace function erp\.audit_row\(\) returns trigger language plpgsql security definer as \$\$([\s\S]*?)\$\$;/
    .exec(listMigrations().find((x) => x.name.startsWith("0001_"))!.sql)?.[1];
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** Um corpo DIFERENTE (para as reversas do corpo). */
const CORPO_OUTRO = "\nbegin\n  return null;\nend ";

interface Funcao { config: string[] | null; definer: boolean; md5: string; dono: string; acl: string | null; volatil: string; gatilhos: number }
const funcao = async (): Promise<Funcao> => (await db.query<Funcao>(
  `select p.proconfig config, p.prosecdef definer, md5(p.prosrc) md5, r.rolname dono, p.proacl::text acl, p.provolatile volatil,
          (select count(*)::int from pg_trigger t where t.tgfoid = p.oid) gatilhos
     from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'erp.audit_row()'::regprocedure`)).rows[0]!;
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;

async function aplicar(): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sqlDaAlvo());
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda `sql` numa transação DESFEITA no fim (depois de `antes`) e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0048 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDaAlvo(), antes);

const ctx = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: null });
interface LinhaAuditoria { organization_id: string; user_id: string | null; entity: string; entity_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
const auditoriaDe = async (id: string) => (await db.query<LinhaAuditoria>(
  "select organization_id, user_id, entity, entity_id, action, before, after from erp.audit_logs where entity_id = $1 order by id", [id])).rows;
const homonimas = async () => (await db.query<{ n: number }>(
  `select (select count(*) from ${SCHEMA_ATACANTE}.audit_logs)::int + (select count(*) from public.audit_logs)::int n`)).rows[0]!.n;
let colunasDoCentro: string[] = [];
let seq = 0;

/**
 * INSERT, UPDATE e DELETE de um centro de custo pelo PAPEL DA APLICAÇÃO (erp.cost_centers é auditada por audit_row e
 * o erp_app tem as três escritas), com o search_path pedido para a sessão — `null` = o de sempre. Devolve o id e as
 * linhas de auditoria dele, depois de afirmar a PREMISSA: nenhuma linha de auditoria com este id antes.
 */
async function escreverEAuditar(caminho: string | null): Promise<{ id: string; nomes: [string, string]; linhas: LinhaAuditoria[] }> {
  seq += 1;
  const id = randomUUID();
  const nomes: [string, string] = [`[TEST] Centro F12 ${seq}`, `[TEST] Centro F12 ${seq} renomeado`];
  expect(await auditoriaDe(id), "premissa: nenhuma linha de auditoria deste id antes da escrita").toEqual([]);
  await withTx(app, ctx(), async (tx) => {
    if (caminho) await tx.query(`set local search_path = ${caminho}`);
    expect((await tx.query("insert into erp.cost_centers (id, organization_id, code, name, kind) values ($1, $2, $3, $4, 'analytic')",
      [id, demo.orgId, `F12.${seq}`, nomes[0]])).rowCount).toBe(1);
    expect((await tx.query("update erp.cost_centers set name = $2 where id = $1", [id, nomes[1]])).rowCount).toBe(1);
    expect((await tx.query("delete from erp.cost_centers where id = $1", [id])).rowCount).toBe(1);
  });
  return { id, nomes, linhas: await auditoriaDe(id) };
}
/** As três linhas que a auditoria de VERDADE grava: create (after), update (before/after) e delete (before). */
function conferirAuditoriaVerdadeira(r: { id: string; nomes: [string, string]; linhas: LinhaAuditoria[] }): void {
  expect(r.linhas.map((l) => [l.action, l.entity, l.entity_id, l.organization_id, l.user_id])).toEqual([
    ["create", "cost_centers", r.id, demo.orgId, demo.adminUserId],
    ["update", "cost_centers", r.id, demo.orgId, demo.adminUserId],
    ["delete", "cost_centers", r.id, demo.orgId, demo.adminUserId]
  ]);
  const [criacao, alteracao, exclusao] = r.linhas as [LinhaAuditoria, LinhaAuditoria, LinhaAuditoria];
  expect([criacao.before, criacao.after?.name, criacao.after?.id]).toEqual([null, r.nomes[0], r.id]);
  expect([alteracao.before?.name, alteracao.after?.name]).toEqual([r.nomes[0], r.nomes[1]]);
  expect([exclusao.before?.name, exclusao.after]).toEqual([r.nomes[1], null]);
  // O conteúdo é a LINHA, e só ela: as chaves são as colunas da tabela (nada acrescentado por quem grava).
  for (const j of [criacao.after, alteracao.before, alteracao.after, exclusao.before]) expect(Object.keys(j!).sort()).toEqual(colunasDoCentro);
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await db.query(`drop schema if exists ${SCHEMA_ATACANTE} cascade; drop table if exists public.audit_logs`);
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
  colunasDoCentro = (await db.query<{ c: string }>(
    "select column_name c from information_schema.columns where table_schema = 'erp' and table_name = 'cost_centers' order by 1")).rows.map((r) => r.c).sort();

  // O ATACANTE: um schema do PAPEL DA APLICAÇÃO (sem privilégio nenhum além do dele) com uma to_jsonb homônima — que
  // devolve a linha verdadeira MAIS a assinatura de quem a executou — e uma tabela audit_logs homônima. O mesmo nome
  // de tabela também no public. Nada disso deve entrar na auditoria depois da 0048.
  await db.query(`create schema ${SCHEMA_ATACANTE} authorization erp_app`);
  await db.query(`create function ${SCHEMA_ATACANTE}.to_jsonb(anyelement) returns jsonb language sql
                    as $f$ select pg_catalog.to_jsonb($1) || pg_catalog.jsonb_build_object('sequestrado_por', current_user::text) $f$`);
  await db.query(`alter function ${SCHEMA_ATACANTE}.to_jsonb(anyelement) owner to erp_app`);
  await db.query(`create table ${SCHEMA_ATACANTE}.audit_logs (like erp.audit_logs including defaults including identity)`);
  await db.query(`alter table ${SCHEMA_ATACANTE}.audit_logs owner to erp_app`);
  await db.query("create table public.audit_logs (like erp.audit_logs including defaults including identity)");
  await db.query("grant all on public.audit_logs to erp_app");
}, 300_000);
afterAll(async () => {
  await db?.query(`drop schema if exists ${SCHEMA_ATACANTE} cascade; drop table if exists public.audit_logs`).catch(() => {});
  await app?.end(); await db?.end();
});

/** O caminho do ATACANTE: o schema dele antes do pg_catalog (o erp nem está no caminho). */
const CAMINHO_ATACANTE = `${SCHEMA_ATACANTE}, pg_catalog`;

describe("DB-0 a DB-2 — a 0048 sobre o banco até a anterior: premissa, trava, lock_timeout e pré-condições", () => {
  it("DB-0.1 PREMISSA: o ledger tem as anteriores e não a 0048; audit_row é a da 0001 (md5 do arquivo = do catálogo), definer, SEM search_path, dono que atravessa RLS", async () => {
    expect(await noLedger()).toBe(false);
    expect(ANTERIORES.map((x) => x.name), "o banco sobe até a 0047 (OPERACOES-01 F7), no mínimo").toContain("0047_entrada_de_nota_por_xml.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: ANTERIORES.at(-1)!.name });
    // Nenhuma migration posterior à 0001 redefine erp.audit_row: o corpo vigente é o da 0001.
    // (CREATE [OR REPLACE] e ALTER contam; "execute function erp.audit_row()" dos gatilhos, não.)
    const redefine = (sql: string) => /\b(create\s+(or\s+replace\s+)?|alter\s+)function\s+erp\.audit_row\s*\(/i.test(sql.replace(/--[^\n]*/g, ""));
    expect(ANTERIORES.filter((m) => redefine(m.sql)).map((m) => m.name)).toEqual(["0001_foundation.sql"]);
    const corpo = corpoDa0001();
    expect(corpo, "o corpo da 0001 foi encontrado").toBeTruthy();
    expect(md5(corpo!)).toBe(MD5_DA_0001);
    const f = await funcao();
    expect({ config: f.config, definer: f.definer, md5: f.md5 }).toEqual({ config: null, definer: true, md5: MD5_DA_0001 });
    expect(f.gatilhos, "a auditoria está ligada nas tabelas de negócio").toBeGreaterThanOrEqual(20);
    expect((await db.query<{ ok: boolean }>("select rolsuper or rolbypassrls ok from pg_roles where rolname = $1", [f.dono])).rows[0]!.ok).toBe(true);
  });

  it("DB-0.2 PREMISSA: o corpo só usa objetos do erp (qualificados) e do pg_catalog, e o erp não tem homônimo de nenhum nome não qualificado", async () => {
    const corpo = corpoDa0001()!;
    // Todo nome qualificado é do erp.
    expect([...new Set([...corpo.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)].map((m) => m[1]))]).toEqual(["erp"]);
    expect([...new Set([...corpo.matchAll(/\berp\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))].sort()).toEqual(["audit_logs", "current_org_id", "current_user_id"]);
    // Os não qualificados chamados como função: só to_jsonb (pg_catalog), coalesce e values (palavras da linguagem).
    expect([...new Set([...corpo.matchAll(/(?<![.\w])([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]))].sort()).toEqual(["coalesce", "to_jsonb", "values"]);
    expect([...new Set([...corpo.matchAll(/::([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))]).toEqual(["uuid"]);
    const r = (await db.query<{ objeto: string; ok: boolean }>(
      `select 'erp.audit_logs' objeto, to_regclass('erp.audit_logs') is not null ok
       union all select 'erp.current_org_id()', to_regprocedure('erp.current_org_id()') is not null
       union all select 'erp.current_user_id()', to_regprocedure('erp.current_user_id()') is not null
       union all select 'pg_catalog.to_jsonb(anyelement)', to_regprocedure('pg_catalog.to_jsonb(anyelement)') is not null
       union all select 'pg_catalog.->>(jsonb,text)', to_regoperator('pg_catalog.->>(jsonb,text)') is not null
       union all select 'pg_catalog.uuid', to_regtype('pg_catalog.uuid') is not null
       union all select 'sem to_jsonb no erp', not exists (select 1 from pg_proc where proname = 'to_jsonb' and pronamespace = 'erp'::regnamespace)
       union all select 'sem ->> no erp', not exists (select 1 from pg_operator where oprname = '->>' and oprnamespace = 'erp'::regnamespace)
       union all select 'sem tipo uuid no erp', to_regtype('erp.uuid') is null`)).rows;
    expect(r.filter((x) => !x.ok).map((x) => x.objeto)).toEqual([]);
    expect(r).toHaveLength(9);
  });

  it("DB-0.3 PREMISSA: a auditoria grava pelo papel da aplicação; e a dívida é REAL — o caminho do atacante faz o dono executar a to_jsonb dele", async () => {
    conferirAuditoriaVerdadeira(await escreverEAuditar(null));
    const atacado = await escreverEAuditar(CAMINHO_ATACANTE);
    expect(atacado.linhas.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    // O conteúdo auditado foi FALSIFICADO, e pelo DONO da função (o papel da aplicação nunca seria 'sequestrado_por' ele).
    const dono = (await funcao()).dono;
    expect([atacado.linhas[0]!.after?.sequestrado_por, atacado.linhas[1]!.before?.sequestrado_por, atacado.linhas[2]!.before?.sequestrado_por])
      .toEqual([dono, dono, dono]);
    expect(dono).not.toBe("erp_app_test");
    // A tabela homônima nunca recebe nada (o corpo qualifica erp.audit_logs) — nem antes da 0048.
    expect(await homonimas()).toBe(0);
  });

  it("DB-1.1 trava (2026,82) em uso por outra sessão: a 0048 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 82)");
      await expect(aplicar()).rejects.toThrow(TRAVA);
    } finally { await outra.query("select pg_advisory_unlock(2026, 82)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect((await funcao()).config).toBeNull();
  });

  it("DB-1.2 lock_timeout 2s: o texto o fixa, e outra transação alterando a função faz a 0048 desistir em ~2s, sem efeito", async () => {
    expect(sqlDaAlvo()).toContain("set local lock_timeout = '2s';");
    const outra = await db.connect();
    try {
      await outra.query("begin");
      // A linha de erp.audit_row no catálogo presa por outra transação (aberta, não confirmada): as pré-condições leem
      // a versão confirmada (sem configuração) e passam; o ALTER espera a linha — e desiste no lock_timeout.
      await outra.query("alter function erp.audit_row() set work_mem = '64kB'");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await outra.query("rollback"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect((await funcao()).config).toBeNull();
  });

  it("DB-2 reversas: cada pré-condição quebrada recusa a 0048 com a SUA mensagem, sem efeito", async () => {
    // "Já aplicada": qualquer search_path na função — o desta migration ou outro.
    for (const [nome, sabotagem] of [
      ["o caminho desta migration", "alter function erp.audit_row() set search_path = erp, pg_temp"],
      ["outro caminho", "alter function erp.audit_row() set search_path = public"]
    ] as [string, string][]) {
      expect([nome, await recusaDa0048((c) => c.query(sabotagem))]).toEqual([nome, JA]);
    }
    // "Já aplicada" vem ANTES de todas: com o definer, o dono, o corpo e o papel quebrados JUNTO, o motivo é o verdadeiro.
    expect(await recusaDa0048(async (c) => {
      await c.query(`create or replace function erp.audit_row() returns trigger language plpgsql security invoker set search_path = public as $f$${CORPO_OUTRO}$f$`);
      await c.query("alter function erp.audit_row() owner to erp_app");
      await c.query("set local role erp_app");
    })).toBe(JA);
    // A função ausente, ou com o nome mas fora da forma (não é de gatilho).
    expect(await recusaDa0048((c) => c.query("alter function erp.audit_row() rename to audit_row_f12"))).toBe(AUSENTE);
    expect(await recusaDa0048(async (c) => {
      await c.query("alter function erp.audit_row() rename to audit_row_f12");
      await c.query("create function erp.audit_row() returns void language plpgsql security definer as $f$ begin end $f$");
    })).toBe(AUSENTE);
    // Não é SECURITY DEFINER.
    expect(await recusaDa0048((c) => c.query("alter function erp.audit_row() security invoker"))).toBe(SEM_DEFINER);
    // Outra configuração já na função (a pós-condição exige o proconfig exato).
    expect(await recusaDa0048((c) => c.query("alter function erp.audit_row() set statement_timeout = '5s'"))).toBe(CONFIG("{statement_timeout=5s}"));
    // O dono não atravessa RLS.
    expect(await recusaDa0048((c) => c.query("alter function erp.audit_row() owner to erp_app"))).toBe(DONO_SEM_BYPASS);
    // Quem aplica não é o dono (o papel da aplicação).
    expect(await recusaDa0048((c) => c.query("set local role erp_app"))).toBe(NAO_DONO);
    // O corpo não é o da 0001 (outro corpo, mesma forma: definer, sem configuração).
    expect(await recusaDa0048((c) => c.query(`create or replace function erp.audit_row() returns trigger language plpgsql security definer as $f$${CORPO_OUTRO}$f$`)))
      .toBe(CORPO(md5(CORPO_OUTRO)));
    // Nada ficou.
    expect(await noLedger()).toBe(false);
    expect(await funcao()).toMatchObject({ config: null, definer: true, md5: MD5_DA_0001 });
  });
});

describe("DB-3 — a 0048 aplica", () => {
  it("DB-3.1 aplica: ledger com a 0048 por último; caminho fixo, definer, corpo IDÊNTICO, dono, privilégios e gatilhos intactos; nenhuma linha tocada; trava liberada", async () => {
    const antes = await funcao();
    const linhasAntes = (await db.query<{ n: string; max: string | null }>("select count(*) n, max(id) max from erp.audit_logs")).rows[0]!;
    // O texto: um único ALTER FUNCTION fora dos blocos de conferência, e nenhuma escrita de linha nem DDL além dele.
    const codigo = sqlDaAlvo().replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
    expect(codigo.match(/\balter\s+function\b/gi)).toHaveLength(1);
    expect(codigo.match(/\b(create|insert|update|delete|drop|grant|revoke|truncate|comment)\b/gi)).toBeNull();

    await aplicar();
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    const depois = await funcao();
    expect(depois).toEqual({ ...antes, config: ["search_path=erp, pg_temp"] });
    expect(depois.md5).toBe(MD5_DA_0001);
    expect((await db.query<{ n: string; max: string | null }>("select count(*) n, max(id) max from erp.audit_logs")).rows[0]).toEqual(linhasAntes);
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 82) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });
});

describe("DB-4 — o comportamento depois da 0048", () => {
  it("DB-4.1 a auditoria CONTINUA gravando pelo papel da aplicação: create/update/delete com organização, usuário, entidade e a linha verdadeira", async () => {
    expect((await funcao()).config, "premissa: a 0048 está aplicada").toEqual(["search_path=erp, pg_temp"]);
    conferirAuditoriaVerdadeira(await escreverEAuditar(null));
    // O search_path de sempre da sessão (o da API) e um caminho com o public na frente gravam o MESMO.
    conferirAuditoriaVerdadeira(await escreverEAuditar("public, erp"));
  });

  it("DB-4.2 o mesmo ataque da premissa não pega mais: a to_jsonb do atacante não roda, e a audit_logs homônima (dele e do public) não recebe nada", async () => {
    const atacado = await escreverEAuditar(CAMINHO_ATACANTE);
    conferirAuditoriaVerdadeira(atacado);
    expect(atacado.linhas.some((l) => JSON.stringify(l).includes("sequestrado_por"))).toBe(false);
    // Com o schema do atacante E o public antes do erp — e o pg_catalog por último —, o mesmo.
    conferirAuditoriaVerdadeira(await escreverEAuditar(`${SCHEMA_ATACANTE}, public, pg_catalog`));
    expect(await homonimas()).toBe(0);
    // Contraprova de que o atacante continua lá (a função dele é chamável e falsifica quem a chama sem caminho fixo).
    const r = (await withTx(app, ctx(), async (tx) => {
      await tx.query(`set local search_path = ${CAMINHO_ATACANTE}`);
      return (await tx.query<{ j: Record<string, unknown> }>("select to_jsonb(c) j from (select 1 as x) c")).rows[0]!.j;
    }));
    expect(r).toEqual({ x: 1, sequestrado_por: "erp_app_test" });
  });
});

describe("DB-5 e DB-6 — pós-condições e reaplicação", () => {
  /**
   * As PÓS-CONDIÇÕES só leem o CATÁLOGO. E cada uma morde: o bloco delas (o trecho "4)" do arquivo, como está) roda de
   * novo sobre o banco aplicado, com UM atributo quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("DB-5 pós-condições: só de catálogo, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDaAlvo();
    const inicio = sql.indexOf("-- ---------- 4) pós-condições");
    expect(inicio, "o trecho 4) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const casos: [string, string, string][] = [
      ["caminho com o public", "alter function erp.audit_row() set search_path = erp, public", POS_CAMINHO("{\"search_path=erp, public\"}")],
      ["caminho desfeito", "alter function erp.audit_row() reset search_path", POS_CAMINHO("<NULL>")],
      ["outra configuração junto", "alter function erp.audit_row() set statement_timeout = '5s'", POS_CAMINHO("{\"search_path=erp, pg_temp\",statement_timeout=5s}")],
      ["sem definer", "alter function erp.audit_row() security invoker", POS_DEFINER],
      ["corpo reescrito", `create or replace function erp.audit_row() returns trigger language plpgsql security definer set search_path = erp, pg_temp as $f$${CORPO_OUTRO}$f$`,
        POS_CORPO(md5(CORPO_OUTRO))]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou.
    expect(await funcao()).toMatchObject({ config: ["search_path=erp, pg_temp"], definer: true, md5: MD5_DA_0001 });
  });

  it("DB-6 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito; a trava fica livre", async () => {
    expect(await recusaDa0048()).toBe(JA);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 82) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });
});
