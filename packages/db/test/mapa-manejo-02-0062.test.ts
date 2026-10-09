import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0062 (MAPA-MANEJO-02, decisão 306 — o "hoje" da empresa, o identificador do lote e os ícones do mapa), PROVADA
 * CONTRA O BANCO como o runner aplica (arquivo a arquivo, cada um numa transação), sobre um ACERVO semeado ANTES dela.
 *
 * MM2-0 premissa (ledger até a 0061, nada da 0062, o corpo do gatilho é o da 0061) · MM2-6 recusa sem efeito (trava
 * ocupada; cada pré-condição quebrada com a SUA mensagem; contraprova de espaço; reaplicar) · MM2-4c aplica com
 * retrato antes/depois · MM2-1 o schema e o fuso (CHECK pelo superusuário e pelo erp_app; dia_no_fuso com instante
 * FIXO; hoje_na_empresa) · MM2-2 o identificador do lote · MM2-3 os ícones (CHECKs, MISTO, unique) · MM2-4a/4b o
 * gatilho de erp.batches abre e fecha no dia LOCAL · MM2-5 RLS e privilégios dos ícones.
 *
 * O relógio do PostgreSQL não se ajusta em teste: o dia local é provado (a) com instante fixo em erp.dia_no_fuso e
 * (b) com um fuso escolhido NA TRANSAÇÃO cujo dia difere do dia UTC naquele instante. As conexões rodam em UTC,
 * como produção (`-c timezone=UTC` na partida de cada conexão; a premissa confere).
 *
 * Duas conexões: `db` (superusuário: monta o cenário, aplica e lê o catálogo) e `app` (papel da aplicação, SEM bypass
 * de RLS, com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let E1: string; let E2: string; let EOutra: string;
let A1: string; let A2: string; let B1: string;
let LA: string; let LC: string; let LD: string; let LG: string;
let usuarioSoE1: string; let outraOrg: string; let donoOutraOrg: string;
let retratoInicial: Retrato;

const ALVO = "0062_icones_identificador_e_fuso.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
/** md5 NORMALIZADO do corpo de erp.batches_fechar_ocupacao() criado pela 0061 (o mesmo que a pré-condição confere). */
const MD5_0061 = "abd1b04a22400f0b3ef76c546a765ecb";

// As mensagens EXATAS das pré-condições (numeradas como no resumo do B1).
const TRAVA = "MAPA-MANEJO-02: outra transacao ja detem a trava desta migration (2026,96). Nada foi aplicado.";
const JA = "MAPA-MANEJO-02: a 0062 ja foi aplicada (erp.empresas.fuso_horario, identificador_* em erp.batches, erp.configuracoes_de_icone ou as funcoes novas ja existem).";
const SEM_0061 = "MAPA-MANEJO-02: a 0061 nao foi aplicada (erp.ocupacoes_de_area ou erp.batches_fechar_ocupacao() ausente); aplique a 0061 antes.";
const NAO_DEFINER = "MAPA-MANEJO-02: erp.batches_fechar_ocupacao() nao e SECURITY DEFINER com search_path fixo; a 0061 nao esta intacta.";
const CURRENT_DATES = (n: number) => `MAPA-MANEJO-02: o corpo de erp.batches_fechar_ocupacao() tem ${n} ocorrencia(s) de current_date (a 0061 tem 3); a 0061 nao esta intacta.`;
const DIVERGE = (md5: string) => `MAPA-MANEJO-02: o corpo de erp.batches_fechar_ocupacao() diverge do da 0061 (md5 normalizado ${md5}); recriar a funcao apagaria uma mudanca feita fora do repositorio.`;
const SEM_GATILHO = "MAPA-MANEJO-02: o gatilho trg_batches_fechar_ocupacao esta ausente de erp.batches, desligado ou fora de erp.batches_fechar_ocupacao(); a 0061 nao esta intacta.";
const SEM_ORG = "MAPA-MANEJO-02: erp.empresas ausente ou sem organization_id; cadeia fora de ordem.";
const SEM_UNIQUE = "MAPA-MANEJO-02: erp.empresas sem a unique composta empresas_org_id_key (organization_id, id); a FK composta de empresa nao tem alvo.";
const SEM_FUSO = "MAPA-MANEJO-02: America/Sao_Paulo ou America/Cuiaba ausente de pg_timezone_names; o fuso padrao e o de producao seriam recusados.";
const SEM_FUNCOES = "MAPA-MANEJO-02: funcoes de RLS/auditoria/updated_at ausentes; cadeia fora de ordem.";
const SEM_POLITICA = "MAPA-MANEJO-02: politica tenant_e_empresa de erp.areas ausente (molde da tabela nova).";
const SEM_PECUARIA = "MAPA-MANEJO-02: modulo de escopo pecuaria ausente.";
const SEM_ERP_APP = "MAPA-MANEJO-02: papel erp_app ausente (0007).";
const SEM_BYPASS = (papel: string) => `MAPA-MANEJO-02: o papel que aplica a migration (${papel}) precisa ser superusuario ou ter BYPASSRLS.`;

const FUNCOES = ["erp.batches_fechar_ocupacao()", "erp.dia_no_fuso(timestamp with time zone,text)", "erp.fuso_horario_valido(text)",
  "erp.hoje_na_empresa(uuid)", "erp.icone_categorias_misto_validas(text[])"];
const TABELAS_RETRATO = ["empresas", "batches", "ocupacoes_de_area", "areas", "audit_logs"] as const;
/** As colunas que a 0062 ACRESCENTA ficam fora do md5: antes elas não existem; depois a prova é que o resto não mudou. */
const SEM_COLUNAS_NOVAS: Partial<Record<(typeof TABELAS_RETRATO)[number], string>> = {
  empresas: " - 'fuso_horario'",
  batches: " - 'identificador_nome' - 'identificador_sigla' - 'identificador_cor'"
};

interface Erro { code?: string; constraint?: string; message: string }
interface Aviso { severity: string; message: string }
type Retrato = Record<string, { n: number; h: string }>;

async function id1(sql: string, p: unknown[] = []) { return (await db.query<{ id: string }>(sql, p)).rows[0]!.id; }
async function erroDe(p: Promise<unknown>): Promise<Erro> {
  try { await p; } catch (e) { const x = e as Erro; return { code: x.code, constraint: x.constraint, message: x.message }; }
  throw new Error("esperava recusa");
}
/** Recusa esperada DENTRO de uma transação aberta: o savepoint devolve a transação ao estado anterior à tentativa. */
async function erroNoPonto(c: Tx, sql: string, p: unknown[] = []): Promise<Erro> {
  await c.query("savepoint mm2_tentativa");
  try { await c.query(sql, p); } catch (e) {
    await c.query("rollback to savepoint mm2_tentativa");
    const x = e as Erro; return { code: x.code, constraint: x.constraint, message: x.message };
  }
  await c.query("release savepoint mm2_tentativa");
  throw new Error(`esperava recusa: ${sql}`);
}
/** Transação SEMPRE desfeita, com as GUCs do contexto (quando há): a prova não deixa rastro para os casos seguintes. */
async function desfeita<T>(pool: Db, ctx: TenantContext | null, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (ctx) await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', $3, true)",
      [ctx.orgId ?? "", ctx.userId ?? "", ctx.modulo ?? ""]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
/** Pool cujas conexões rodam em UTC (como produção): current_date é o dia UTC. O fuso vai como parâmetro de partida da conexão. */
function poolEmUtc(url: string, max: number): Db {
  return createPool(`${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c timezone=UTC")}`, { max });
}
/** md5 normalizado como a pré-condição: todo espaço em branco vira um espaço só, sem espaço nas pontas — calculado AQUI, não pelo banco. */
const md5Normalizado = (s: string) => createHash("md5").update(s.replace(/[ \t\n\r\v\f]+/g, " ").replace(/^ +| +$/g, ""), "utf8").digest("hex");
const contar = (s: string, termo: string) => s.split(termo).length - 1;

/** Aplica a 0062 na conexão dada e devolve TODOS os NOTICE/WARNING emitidos durante a aplicação. */
async function aplicarCapturando(c: Tx): Promise<Aviso[]> {
  const avisos: Aviso[] = [];
  const ouvir = (n: { severity?: string; message?: string }) => { avisos.push({ severity: n.severity ?? "", message: n.message ?? "" }); };
  c.on("notice", ouvir);
  try { await c.query(SQL_ALVO); } finally { c.off("notice", ouvir); }
  return avisos;
}
/** md5 de cada linha (empresas e lotes SEM as colunas novas), em ordem de id, e a contagem — por tabela. */
async function retrato(): Promise<Retrato> {
  const out: Retrato = {};
  for (const t of TABELAS_RETRATO) {
    const linha = `(to_jsonb(t)${SEM_COLUNAS_NOVAS[t] ?? ""})::text`;
    out[t] = (await db.query<{ n: number; h: string }>(
      `select count(*)::int n, coalesce(md5(string_agg(md5(${linha}), ',' order by t.id)), '') h from erp.${t} t`)).rows[0]!;
  }
  return out;
}
/** Tudo o que a 0062 cria: se existir, a migration deixou efeito. */
async function nadaDa0062(q: Queryable = db) {
  return (await q.query<{ tabela: string | null; funcoes: number; colunas: number; checks: number; corpo: number }>(
    `select to_regclass('erp.configuracoes_de_icone')::text tabela,
            (select count(*)::int from unnest(array['erp.fuso_horario_valido(text)','erp.dia_no_fuso(timestamptz,text)','erp.hoje_na_empresa(uuid)',
               'erp.icone_categorias_misto_validas(text[])']) f where to_regprocedure(f) is not null) funcoes,
            (select count(*)::int from pg_attribute where not attisdropped
               and ((attrelid = 'erp.empresas'::regclass and attname = 'fuso_horario')
                    or (attrelid = 'erp.batches'::regclass and attname in ('identificador_nome','identificador_sigla','identificador_cor')))) colunas,
            (select count(*)::int from pg_constraint where conname in ('chk_empresas_fuso_horario','chk_batches_identificador_cor','chk_batches_identificador_sigla')) checks,
            (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'erp' and position('hoje_na_empresa(' in p.prosrc) > 0) corpo`)).rows[0]!;
}
const NADA = { tabela: null, funcoes: 0, colunas: 0, checks: 0, corpo: 0 };
/** O que a 0062 cria e que NENHUMA sabotagem do MM2-6a cria: depois da recusa, tudo zero. */
async function efeitoDa0062(q: Queryable) {
  return (await q.query<{ checks: number; corpo: number; indices: number; gatilhos: number }>(
    `select (select count(*)::int from pg_constraint where conname in ('chk_empresas_fuso_horario','chk_batches_identificador_cor','chk_batches_identificador_sigla',
               'chk_icone_categoria_canonica','chk_icone_misto_so_no_misto','fk_configuracoes_de_icone_empresa')) checks,
            (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'erp' and position('hoje_na_empresa(' in p.prosrc) > 0) corpo,
            (select count(*)::int from pg_class where relname in ('uq_configuracoes_de_icone_categoria','ix_configuracoes_de_icone_tipo')) indices,
            (select count(*)::int from pg_trigger where tgname in ('trg_configuracoes_de_icone_updated','trg_configuracoes_de_icone_audit')) gatilhos`)).rows[0]!;
}
const SEM_EFEITO = { checks: 0, corpo: 0, indices: 0, gatilhos: 0 };

const ctxPec = (userId: string, orgId = demo.orgId): TenantContext => ({ orgId, userId, modulo: "pecuaria" });
const area = (empresa: string, code: string) => id1(
  `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
   values ($1,$2,$3,$4,10,10,'pastagem','ativa','propria') returning id`, [demo.orgId, empresa, code, `[TEST] ${code}`]);
interface OpLote { empresa?: string; area?: string | null; entry?: string | null; status?: string; exit?: string | null }
const lote = async (q: Queryable, code: string, o: OpLote = {}) => (await q.query<{ id: string }>(
  `insert into erp.batches (organization_id, empresa_id, code, batch_date, description, area_id, entry_date, status, exit_date)
   values ($1,$2,$3,'2025-11-01',$4,$5,$6,$7,$8) returning id`,
  [demo.orgId, o.empresa ?? E1, code, `[TEST] lote ${code}`, o.area ?? null, o.entry ?? null, o.status ?? "active", o.exit ?? null])).rows[0]!.id;
interface Ocupacao { area_id: string; data_inicio: string; data_fim: string | null; origem_da_data: string; motivo_saida: string | null }
async function ocupacoesDo(q: Queryable, loteId: string): Promise<Ocupacao[]> {
  return (await q.query<Ocupacao>(
    `select area_id, data_inicio, data_fim, origem_da_data, motivo_saida
       from erp.ocupacoes_de_area where batch_id=$1 order by data_inicio, created_at, id`, [loteId])).rows;
}
/** Muda o fuso da empresa e confere que UMA linha mudou (gravação sob RLS confere ROW COUNT). */
async function fusoDa(c: Tx, empresa: string, fuso: string) {
  expect((await c.query("update erp.empresas set fuso_horario=$2 where id=$1", [empresa, fuso])).rowCount, `fuso ${fuso} na empresa`).toBe(1);
}
/**
 * O fuso do caso: escolhido NA TRANSAÇÃO (o now() dela) para que o dia local DIFIRA do dia UTC. Hora UTC < 11 →
 * Etc/GMT+12 (UTC−12: ainda é ontem); senão Pacific/Kiritimati (UTC+14: já é amanhã). A premissa é conferida.
 */
async function fusoDoCaso(c: Tx): Promise<{ fuso: string; local: string; utc: string }> {
  const r = (await c.query<{ h: number; utc: string; hoje: string; tz: string }>(
    "select extract(hour from now() at time zone 'UTC')::int h, (now() at time zone 'UTC')::date::text utc, current_date::text hoje, current_setting('TimeZone') tz")).rows[0]!;
  expect({ tz: r.tz, hoje: r.hoje }, "premissa: a sessão roda em UTC (current_date é o dia UTC)").toEqual({ tz: "UTC", hoje: r.utc });
  const fuso = r.h < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
  const local = (await c.query<{ d: string }>("select (now() at time zone $1)::date::text d", [fuso])).rows[0]!.d;
  expect(local, `premissa: no fuso ${fuso} o dia local (${local}) difere do dia UTC (${r.utc})`).not.toBe(r.utc);
  return { fuso, local, utc: r.utc };
}
interface OpIcone { org?: string; empresa?: string; tipo?: string; categoria?: string; misto?: string[] | null; url?: string | null; cor?: string | null; ativo?: boolean }
const ICONE_SQL = `insert into erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade, categoria, categorias_misto, icone_url, cor_padrao, ativo)
                   values ($1,$2,$3,$4,$5::text[],$6,$7,$8) returning id`;
const iconeP = (o: OpIcone): unknown[] => [o.org ?? demo.orgId, o.empresa ?? E1, o.tipo ?? "lote", o.categoria ?? "BOI", o.misto ?? null,
  o.url === undefined ? null : o.url, o.cor === undefined ? "#112233" : o.cor, o.ativo ?? true];
const icone = async (q: Queryable, o: OpIcone = {}) => (await q.query<{ id: string }>(ICONE_SQL, iconeP(o))).rows[0]!.id;

beforeAll(async () => {
  db = poolEmUtc(TEST_URL, 6);
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = poolEmUtc(URL_APP, 3);
  [E1, E2] = demo.empresaIds as [string, string];

  // ---- ACERVO anterior à 0062 (pelo gatilho da 0061: ocupações abertas e uma fechada) ----
  A1 = await area(E1, "MM2-A1"); A2 = await area(E1, "MM2-A2"); B1 = await area(E2, "MM2-B1");
  LA = await lote(db, "MM2-LA", { area: A1, entry: "2026-01-10" });                    // aberta em A1 desde 10/01
  await lote(db, "MM2-LB", { area: A1 });                                              // aberta em A1, criação (dia UTC da 0061)
  LC = await lote(db, "MM2-LC", { area: A2, entry: "2026-02-01" });                    // aberta em A2 desde 01/02
  LD = await lote(db, "MM2-LD", { empresa: E2, area: B1, entry: "2026-03-01" });       // aberta em B1 (empresa 2) desde 01/03
  LG = await lote(db, "MM2-LG", { area: A1, entry: "2026-03-05" });                    // aberta em A1 desde 05/03
  const LE = await lote(db, "MM2-LE", { area: A2, entry: "2026-01-01" });              // fechada logo abaixo
  await db.query("update erp.batches set status='closed' where id=$1", [LE]);

  // Quem só vê a empresa 1 no módulo pecuaria; e uma OUTRA organização com dono e empresa próprios.
  usuarioSoE1 = await id1("insert into erp.users (email, name, password_hash) values ('mm2-so-e1@demo.local','MM2 Só E1','x') returning id");
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioSoE1]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, membro, E1]);
  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra MM2','outra-mm2') returning id");
  donoOutraOrg = await id1("insert into erp.users (email, name, password_hash) values ('mm2-dono-outra@demo.local','MM2 Dono outra','x') returning id");
  await db.query("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,true,true)", [outraOrg, donoOutraOrg]);
  EOutra = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 1, '[TEST] Empresa da outra MM2') returning id", [outraOrg]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("MM2-0 — a premissa: o banco até a 0061 e o acervo anterior à 0062", () => {
  it("MM2-0 PREMISSA: ledger com 61 (a 0061 por último), nada da 0062 existe, o corpo do gatilho é o da 0061 (md5 normalizado e 3 current_date), sessões em UTC, acervo contado", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0061_ocupacao_de_area_e_objetos_de_mapa.sql");
    expect(ANTERIORES).toHaveLength(61);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 61, ultima: "0061_ocupacao_de_area_e_objetos_de_mapa.sql" });
    expect(await nadaDa0062()).toEqual(NADA);
    const corpo = (await db.query<{ s: string }>("select prosrc s from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure")).rows[0]!.s;
    expect({ md5: md5Normalizado(corpo), currentDate: contar(corpo.toLowerCase(), "current_date") }).toEqual({ md5: MD5_0061, currentDate: 3 });
    expect((await db.query<{ tz: string }>("select current_setting('TimeZone') tz")).rows[0]!.tz).toBe("UTC");
    expect((await withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query<{ tz: string }>("select current_setting('TimeZone') tz"))).rows[0]!.tz).toBe("UTC");

    const n = (await db.query<{ empresas: number; lotes: number; areas: number; abertas: number; fechadas: number }>(
      `select (select count(*)::int from erp.empresas) empresas, (select count(*)::int from erp.batches where code like 'MM2-L%') lotes,
              (select count(*)::int from erp.areas where code like 'MM2-%') areas,
              (select count(*)::int from erp.ocupacoes_de_area where data_fim is null) abertas,
              (select count(*)::int from erp.ocupacoes_de_area where data_fim is not null) fechadas`)).rows[0]!;
    expect(n).toEqual({ empresas: 3, lotes: 6, areas: 3, abertas: 5, fechadas: 1 });
    retratoInicial = await retrato();
    // Verde que não prova nada é reprovação: cada tabela do retrato tem linha.
    for (const t of TABELAS_RETRATO) expect([t, retratoInicial[t]!.n > 0]).toEqual([t, true]);
  });
});

describe("MM2-6 — a 0062 recusa SEM efeito (antes de aplicar)", () => {
  it("MM2-6b TRAVA: com (2026,96) ocupada por outra sessão, a 0062 recusa com a mensagem da trava e nada é criado", async () => {
    const outra = await db.connect();
    const c = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 96)");
      // Sem begin: o runner manda o arquivo inteiro, e uma recusa desfaz tudo o que veio antes dela.
      expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
      await outra.query("rollback");
    } finally { outra.release(); c.release(); }
    expect(await nadaDa0062()).toEqual(NADA);
    expect(await retrato()).toEqual(retratoInicial);
  });

  it("MM2-6a REVERSAS: cada pré-condição quebrada (uma por transação desfeita) recusa a 0062 com a SUA mensagem exata, sem efeito — as 14 do B1 (itens 2 a 15)", async () => {
    /** Recria a função de gatilho com o corpo transformado, MANTENDO security definer e o search_path (só o corpo muda). */
    const recriarCorpo = (expr: string) =>
      `do $$ declare v text; begin
         select prosrc into v from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure;
         execute format('create or replace function erp.batches_fechar_ocupacao() returns trigger language plpgsql security definer set search_path = erp, pg_temp as %L', ${expr});
       end $$`;
    type Esperada = string | ((corpoDepoisDaSabotagem: string) => string);
    const PRE: [number, string, string, Esperada][] = [
      [2, "já aplicada (erp.configuracoes_de_icone existe)", "create table erp.configuracoes_de_icone (x int)", JA],
      [2, "já aplicada (hoje_na_empresa existe)", "create function erp.hoje_na_empresa(uuid) returns date language sql as 'select null::date'", JA],
      [2, "já aplicada (dia_no_fuso existe)", "create function erp.dia_no_fuso(timestamptz, text) returns date language sql as 'select null::date'", JA],
      [2, "já aplicada (fuso_horario_valido existe)", "create function erp.fuso_horario_valido(text) returns boolean language sql as 'select true'", JA],
      [2, "já aplicada (icone_categorias_misto_validas existe)", "create function erp.icone_categorias_misto_validas(text[]) returns boolean language sql as 'select true'", JA],
      [2, "já aplicada (empresas.fuso_horario existe)", "alter table erp.empresas add column fuso_horario text", JA],
      [2, "já aplicada (batches.identificador_nome existe)", "alter table erp.batches add column identificador_nome text", JA],
      [2, "já aplicada (batches.identificador_sigla existe)", "alter table erp.batches add column identificador_sigla text", JA],
      [2, "já aplicada (batches.identificador_cor existe)", "alter table erp.batches add column identificador_cor text", JA],
      [3, "0061 ausente (ocupacoes_de_area renomeada)", "alter table erp.ocupacoes_de_area rename to ocupacoes_de_area_sabotada", SEM_0061],
      [3, "0061 ausente (função de gatilho renomeada)", "alter function erp.batches_fechar_ocupacao() rename to batches_fechar_ocupacao_sabotada", SEM_0061],
      [4, "função de gatilho SECURITY INVOKER", "alter function erp.batches_fechar_ocupacao() security invoker", NAO_DEFINER],
      [4, "função de gatilho com outro search_path", "alter function erp.batches_fechar_ocupacao() set search_path = public", NAO_DEFINER],
      [5, "corpo com um current_date a menos (tem 2)", recriarCorpo("regexp_replace(v, 'current_date', 'now()::date')"), CURRENT_DATES(2)],
      [5, "corpo com um current_date a mais em comentário (tem 4)", recriarCorpo("v || E'\\n-- current_date'"), CURRENT_DATES(4)],
      [6, "corpo da 0061 com '-- x' (3 current_date, md5 diverge)", recriarCorpo("v || E'\\n-- x'"), (corpo) => DIVERGE(md5Normalizado(corpo))],
      [7, "gatilho desligado", "alter table erp.batches disable trigger trg_batches_fechar_ocupacao", SEM_GATILHO],
      [7, "gatilho ausente", "drop trigger trg_batches_fechar_ocupacao on erp.batches", SEM_GATILHO],
      [8, "empresas sem organization_id", "alter table erp.empresas rename column organization_id to organization_id_sabotada", SEM_ORG],
      [9, "empresas_org_id_key ausente", "alter table erp.empresas rename constraint empresas_org_id_key to empresas_org_id_key_sabotada", SEM_UNIQUE],
      [10, "America/Cuiaba ausente de pg_timezone_names (view temporária que sombreia)",
        "create temp view pg_timezone_names as select * from pg_catalog.pg_timezone_names where name <> 'America/Cuiaba'", SEM_FUSO],
      [10, "America/Sao_Paulo ausente de pg_timezone_names (view temporária que sombreia)",
        "create temp view pg_timezone_names as select * from pg_catalog.pg_timezone_names where name <> 'America/Sao_Paulo'", SEM_FUSO],
      [11, "função de RLS ausente (empresas_do_membro)", "alter function erp.empresas_do_membro(text) rename to empresas_do_membro_sabotada", SEM_FUNCOES],
      [12, "política tenant_e_empresa de areas ausente", "alter policy tenant_e_empresa on erp.areas rename to tenant_e_empresa_sabotada", SEM_POLITICA],
      [13, "módulo pecuaria ausente",
        "set local session_replication_role = replica; delete from erp.modulos_escopo_empresa where chave = 'pecuaria'; set local session_replication_role = origin", SEM_PECUARIA],
      [14, "papel erp_app ausente", "alter role erp_app rename to erp_app_sabotado", SEM_ERP_APP],
      // Papel real SEM superusuário e SEM BYPASSRLS (o papel da aplicação): a última pré-condição recusa.
      [15, "papel sem bypass (erp_app_test)", "set local role erp_app_test", SEM_BYPASS("erp_app_test")]
    ];
    const c = await db.connect();
    const obtido: [string, string, unknown][] = [];
    const esperado: [string, string, unknown][] = [];
    try {
      for (const [, nome, sabotagem, msg] of PRE) {
        await c.query("begin");
        try {
          await c.query(sabotagem);
          const corpo = (await c.query<{ s: string | null }>(
            "select (select prosrc from pg_proc where oid = to_regprocedure('erp.batches_fechar_ocupacao()')) s")).rows[0]!.s ?? "";
          await c.query("savepoint antes_da_0062");
          const e = await erroDe(c.query(SQL_ALVO));
          await c.query("rollback to savepoint antes_da_0062");
          obtido.push([nome, e.message, await efeitoDa0062(c)]);
          esperado.push([nome, typeof msg === "string" ? msg : msg(corpo), SEM_EFEITO]);
        } finally { await c.query("rollback"); }
      }
    } finally { c.release(); }
    expect(obtido).toEqual(esperado);
    expect(obtido).toHaveLength(27);
    // As 14 mensagens do resumo do B1 (itens 2 a 15) foram TODAS provocadas; a 1 (trava) é o MM2-6b.
    expect([...new Set(PRE.map(([item]) => item))]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // O md5 da mensagem 6 é o do corpo SABOTADO, não o da 0061.
    expect(esperado.find(([nome]) => nome.startsWith("corpo da 0061 com"))![1]).not.toContain(MD5_0061);
    // As sabotagens foram desfeitas: o banco está como antes (nem a 0062, nem a sabotagem).
    expect(await nadaDa0062()).toEqual(NADA);
    expect(await retrato()).toEqual(retratoInicial);
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_roles where rolname = 'erp_app'")).rows[0]!.n).toBe(1);
  });

  it("MM2-6c CONTRAPROVA: o corpo da 0061 só com espaço diferente (reindentado) NÃO é recusado — o md5 é normalizado; a 0062 aplica (desfeita)", async () => {
    await desfeita(db, null, async (c) => {
      await c.query(`do $$ declare v text; begin
        select prosrc into v from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure;
        execute format('create or replace function erp.batches_fechar_ocupacao() returns trigger language plpgsql security definer set search_path = erp, pg_temp as %L', replace(v, E'\\n', E'\\n \\t '));
      end $$`);
      const corpo = (await c.query<{ s: string }>("select prosrc s from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure")).rows[0]!.s;
      expect(corpo.length, "o corpo mudou de verdade (mais espaço)").toBeGreaterThan(400);
      expect(md5Normalizado(corpo)).toBe(MD5_0061);
      expect((await c.query<{ s: string }>("select md5(prosrc) s from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure")).rows[0]!.s,
        "o md5 CRU mudou: só a normalização o iguala").not.toBe(MD5_0061);
      expect(await aplicarCapturando(c)).toEqual([]);
      const depois = (await c.query<{ s: string }>("select prosrc s from pg_proc where oid = 'erp.batches_fechar_ocupacao()'::regprocedure")).rows[0]!.s;
      expect({ hoje: contar(depois, "erp.hoje_na_empresa("), currentDate: contar(depois.toLowerCase(), "current_date") }).toEqual({ hoje: 3, currentDate: 0 });
    });
    expect(await nadaDa0062()).toEqual(NADA);
  });
});

describe("MM2-4c — aplica como o runner; retrato antes/depois", () => {
  it("MM2-4c APLICA: sem NOTICE; ledger 62; nenhuma linha existente muda (empresas e lotes comparados SEM as colunas novas; ocupações, áreas e auditoria inteiras); colunas novas no default/nulas; tabela nova vazia", async () => {
    expect(await retrato(), "as tentativas recusadas e desfeitas não deixaram rastro").toEqual(retratoInicial);
    const c = await db.connect();
    let avisos: Aviso[] = [];
    try {
      await c.query("begin");
      avisos = await aplicarCapturando(c);
      await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
      await c.query("commit");
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(avisos).toEqual([]);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 62, ultima: ALVO });

    expect(await retrato(), "nenhuma linha de tabela existente mudou").toEqual(retratoInicial);
    const novas = (await db.query<{ empresas: number; sp: number; lotes: number; com_identificador: number; icones: number }>(
      `select (select count(*)::int from erp.empresas) empresas, (select count(*)::int from erp.empresas where fuso_horario = 'America/Sao_Paulo') sp,
              (select count(*)::int from erp.batches) lotes,
              (select count(*)::int from erp.batches where identificador_nome is not null or identificador_sigla is not null or identificador_cor is not null) com_identificador,
              (select count(*)::int from erp.configuracoes_de_icone) icones`)).rows[0]!;
    expect(novas).toEqual({ empresas: 3, sp: 3, lotes: novas.lotes, com_identificador: 0, icones: 0 });
    expect(novas.lotes, "há lote para a coluna nova ser nula").toBeGreaterThan(6);
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 96) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("MM2-6a JÁ APLICADA: reaplicar a 0062 sobre ela mesma é recusado com a mensagem de 'já aplicada', sem efeito", async () => {
    expect((await erroDe(db.query(SQL_ALVO))).message).toBe(JA);
    expect((await db.query<{ n: number; checks: number; icones: number }>(
      `select (select count(*)::int from public.erp_migrations) n,
              (select count(*)::int from pg_constraint where conname in ('chk_empresas_fuso_horario','chk_batches_identificador_cor','chk_batches_identificador_sigla')) checks,
              (select count(*)::int from erp.configuracoes_de_icone) icones`)).rows[0]).toEqual({ n: 62, checks: 3, icones: 0 });
  });
});

describe("MM2-1 — o schema e o fuso da empresa", () => {
  it("MM2-1a schema: fuso_horario, identificador_*, a tabela de ícones (colunas, restrições, índices, gatilhos, RLS), as 5 funções e o EXECUTE de cada uma", async () => {
    const colunas = async (t: string, nomes: string[] | null = null) => (await db.query<{ c: string }>(
      `select column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, '-') c
         from information_schema.columns where table_schema='erp' and table_name=$1 and ($2::text[] is null or column_name = any($2)) order by ordinal_position`,
      [t, nomes])).rows.map((r) => r.c);
    expect(await colunas("empresas", ["fuso_horario"])).toEqual(["fuso_horario:text:text:NO:'America/Sao_Paulo'::text"]);
    expect(await colunas("batches", ["identificador_nome", "identificador_sigla", "identificador_cor"]))
      .toEqual(["identificador_nome:text:text:YES:-", "identificador_sigla:text:text:YES:-", "identificador_cor:text:text:YES:-"]);
    const tz = "timestamp with time zone:timestamptz";
    expect(await colunas("configuracoes_de_icone")).toEqual([
      "id:uuid:uuid:NO:gen_random_uuid()", "organization_id:uuid:uuid:NO:-", "empresa_id:uuid:uuid:NO:-", "tipo_entidade:text:text:NO:-",
      "categoria:text:text:NO:-", "categorias_misto:ARRAY:_text:YES:-", "icone_url:text:text:YES:-", "cor_padrao:text:text:YES:-",
      "ativo:boolean:bool:NO:true", `created_at:${tz}:NO:now()`, `updated_at:${tz}:NO:now()`, `deleted_at:${tz}:YES:-`]);

    const restricoes = async (t: string, nomes: string[] | null = null) => Object.fromEntries((await db.query<{ n: string; d: string }>(
      "select conname n, pg_get_constraintdef(oid) d from pg_constraint where conrelid=$1::regclass and ($2::text[] is null or conname = any($2)) order by conname",
      [t, nomes])).rows.map((r) => [r.n, r.d]));
    expect(await restricoes("erp.empresas", ["chk_empresas_fuso_horario"])).toEqual({ chk_empresas_fuso_horario: "CHECK (erp.fuso_horario_valido(fuso_horario))" });
    expect(await restricoes("erp.batches", ["chk_batches_identificador_cor", "chk_batches_identificador_sigla"])).toEqual({
      chk_batches_identificador_cor: "CHECK (((identificador_cor IS NULL) OR (identificador_cor ~ '^#[0-9A-Fa-f]{6}$'::text)))",
      chk_batches_identificador_sigla: "CHECK (((identificador_sigla IS NULL) OR ((char_length(btrim(identificador_sigla)) >= 1) AND (char_length(btrim(identificador_sigla)) <= 4))))"
    });
    expect(await restricoes("erp.configuracoes_de_icone")).toEqual({
      chk_icone_categoria_canonica: "CHECK (((categoria = upper(btrim(categoria))) AND ((char_length(categoria) >= 1) AND (char_length(categoria) <= 60))))",
      chk_icone_cor_padrao: "CHECK (((cor_padrao IS NULL) OR (cor_padrao ~ '^#[0-9A-Fa-f]{6}$'::text)))",
      chk_icone_misto_so_no_misto: "CHECK (((categorias_misto IS NULL) OR ((categoria = 'MISTO'::text) AND erp.icone_categorias_misto_validas(categorias_misto))))",
      chk_icone_tem_imagem_ou_cor: "CHECK (((icone_url IS NOT NULL) OR (cor_padrao IS NOT NULL)))",
      chk_icone_tipo_entidade: "CHECK ((tipo_entidade = ANY (ARRAY['lote'::text, 'objeto_de_mapa'::text, 'area'::text])))",
      chk_icone_url_https: "CHECK (((icone_url IS NULL) OR (icone_url ~~ 'https://%'::text)))",
      configuracoes_de_icone_pkey: "PRIMARY KEY (id)",
      fk_configuracoes_de_icone_empresa: "FOREIGN KEY (organization_id, empresa_id) REFERENCES erp.empresas(organization_id, id)",
      fk_configuracoes_de_icone_organizacao: "FOREIGN KEY (organization_id) REFERENCES erp.organizations(id)"
    });
    expect((await db.query<{ i: string; d: string }>(
      "select indexname i, indexdef d from pg_indexes where schemaname='erp' and tablename='configuracoes_de_icone' order by 1")).rows).toEqual([
      { i: "configuracoes_de_icone_pkey", d: "CREATE UNIQUE INDEX configuracoes_de_icone_pkey ON erp.configuracoes_de_icone USING btree (id)" },
      { i: "ix_configuracoes_de_icone_tipo", d: "CREATE INDEX ix_configuracoes_de_icone_tipo ON erp.configuracoes_de_icone USING btree (organization_id, empresa_id, tipo_entidade) WHERE (ativo AND (deleted_at IS NULL))" },
      { i: "uq_configuracoes_de_icone_categoria", d: "CREATE UNIQUE INDEX uq_configuracoes_de_icone_categoria ON erp.configuracoes_de_icone USING btree (organization_id, empresa_id, tipo_entidade, categoria) WHERE ((deleted_at IS NULL) AND (categoria <> 'MISTO'::text))" }
    ]);
    expect((await db.query<{ t: string; d: string; ligado: string }>(
      "select tgname t, pg_get_triggerdef(oid) d, tgenabled::text ligado from pg_trigger where tgrelid='erp.configuracoes_de_icone'::regclass and not tgisinternal order by 1")).rows).toEqual([
      { t: "trg_configuracoes_de_icone_audit", d: "CREATE TRIGGER trg_configuracoes_de_icone_audit AFTER INSERT OR DELETE OR UPDATE ON erp.configuracoes_de_icone FOR EACH ROW EXECUTE FUNCTION erp.audit_row()", ligado: "O" },
      { t: "trg_configuracoes_de_icone_updated", d: "CREATE TRIGGER trg_configuracoes_de_icone_updated BEFORE UPDATE ON erp.configuracoes_de_icone FOR EACH ROW EXECUTE FUNCTION erp.set_updated_at()", ligado: "O" }
    ]);
    // O gatilho de erp.batches continua o da 0061 (mesmas colunas, ligado, na função recriada).
    expect((await db.query<{ d: string; ligado: string }>(
      "select pg_get_triggerdef(oid) d, tgenabled::text ligado from pg_trigger where tgname='trg_batches_fechar_ocupacao'")).rows).toEqual([
      { d: "CREATE TRIGGER trg_batches_fechar_ocupacao AFTER INSERT OR UPDATE OF area_id, status, exit_date, deleted_at ON erp.batches FOR EACH ROW EXECUTE FUNCTION erp.batches_fechar_ocupacao()", ligado: "O" }
    ]);
    expect((await db.query<{ rls: boolean; forcada: boolean }>(
      "select relrowsecurity rls, relforcerowsecurity forcada from pg_class where oid='erp.configuracoes_de_icone'::regclass")).rows).toEqual([{ rls: true, forcada: true }]);
    expect((await db.query<{ p: string; cmd: string; permissive: string; igual: boolean }>(
      `select p.policyname p, p.cmd, p.permissive, (p.qual = a.qual and p.with_check = a.with_check and p.roles = a.roles) igual
         from pg_policies p cross join (select qual, with_check, roles from pg_policies where schemaname='erp' and tablename='areas' and policyname='tenant_e_empresa') a
        where p.schemaname='erp' and p.tablename='configuracoes_de_icone'`)).rows)
      .toEqual([{ p: "tenant_e_empresa", cmd: "ALL", permissive: "PERMISSIVE", igual: true }]);

    // As 5 funções: linguagem, DEFINER/INVOKER, volatilidade, não estritas, search_path fixo, retorno.
    expect((await db.query<{ f: string; lang: string; definer: boolean; vol: string; estrita: boolean; cfg: string[]; ret: string }>(
      `select p.oid::regprocedure::text f, l.lanname lang, p.prosecdef definer, p.provolatile::text vol, p.proisstrict estrita, p.proconfig cfg, pg_get_function_result(p.oid) ret
         from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = any($1::regprocedure[]) order by p.oid::regprocedure::text collate "C"`, [FUNCOES])).rows).toEqual([
      { f: "erp.batches_fechar_ocupacao()", lang: "plpgsql", definer: true, vol: "v", estrita: false, cfg: ["search_path=erp, pg_temp"], ret: "trigger" },
      { f: "erp.dia_no_fuso(timestamp with time zone,text)", lang: "plpgsql", definer: false, vol: "s", estrita: false, cfg: ["search_path=erp, pg_temp"], ret: "date" },
      { f: "erp.fuso_horario_valido(text)", lang: "sql", definer: false, vol: "s", estrita: false, cfg: ["search_path=erp, pg_temp"], ret: "boolean" },
      { f: "erp.hoje_na_empresa(uuid)", lang: "plpgsql", definer: true, vol: "s", estrita: false, cfg: ["search_path=erp, pg_temp"], ret: "date" },
      { f: "erp.icone_categorias_misto_validas(text[])", lang: "plpgsql", definer: false, vol: "i", estrita: false, cfg: ["search_path=erp, pg_temp"], ret: "boolean" }
    ]);
    // EXECUTE: quem tem além do dono (PUBLIC incluído) e o efetivo de erp_app, erp_app_test e authenticated.
    expect((await db.query<{ f: string; outros: string[]; app: boolean; app_test: boolean; auth: boolean }>(
      `select f, (select coalesce(array_agg(g order by g), '{}') from (
                    select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end g
                      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = f::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) x) outros,
              has_function_privilege('erp_app', f, 'EXECUTE') app, has_function_privilege('erp_app_test', f, 'EXECUTE') app_test,
              has_function_privilege('authenticated', f, 'EXECUTE') auth
         from unnest($1::text[]) f order by f collate "C"`, [FUNCOES])).rows).toEqual([
      { f: "erp.batches_fechar_ocupacao()", outros: [], app: false, app_test: false, auth: false },
      { f: "erp.dia_no_fuso(timestamp with time zone,text)", outros: [], app: false, app_test: false, auth: false },
      { f: "erp.fuso_horario_valido(text)", outros: ["erp_app"], app: true, app_test: true, auth: false },
      { f: "erp.hoje_na_empresa(uuid)", outros: [], app: false, app_test: false, auth: false },
      { f: "erp.icone_categorias_misto_validas(text[])", outros: ["erp_app"], app: true, app_test: true, auth: false }
    ]);
    // Tentativa real pelo papel da API: as duas de CHECK executam; as de gatilho não (42501).
    const pelaApi = async (sql: string, p: unknown[] = []) => {
      try { return { ok: (await withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query<{ v: unknown }>(sql, p))).rows[0]!.v }; }
      catch (e) { return { code: (e as Erro).code }; }
    };
    expect([
      await pelaApi("select erp.fuso_horario_valido('America/Cuiaba') v"),
      await pelaApi("select erp.icone_categorias_misto_validas(array['BOI','VACA']) v"),
      await pelaApi("select erp.dia_no_fuso(now(), 'America/Cuiaba') v"),
      await pelaApi("select erp.hoje_na_empresa($1) v", [E1])
    ]).toEqual([{ ok: true }, { ok: true }, { code: "42501" }, { code: "42501" }]);
  });

  it("MM2-1b fuso_horario recusa o que não está em pg_timezone_names (23514, chk_empresas_fuso_horario) — pelo superusuário E pelo erp_app com as GUCs: Cuiabá aceito sem 42501; sem o grant, a CHECK daria 42501", async () => {
    const casos = async (c: Tx) => {
      const u = await c.query<{ f: string }>("update erp.empresas set fuso_horario='America/Cuiaba' where id=$1 returning fuso_horario f", [E1]);
      const novaCuiaba = await c.query<{ f: string }>("insert into erp.empresas (organization_id, code, name, fuso_horario) values ($1, 91, '[TEST] MM2 Cuiabá', 'America/Cuiaba') returning fuso_horario f", [demo.orgId]);
      const novaPadrao = await c.query<{ f: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 92, '[TEST] MM2 padrão') returning fuso_horario f", [demo.orgId]);
      const recusas: [string, Erro][] = [];
      for (const [nome, sql, p] of [
        ["update Marte/Olimpo", "update erp.empresas set fuso_horario='Marte/Olimpo' where id=$1", [E1]],
        ["update minúsculo (america/cuiaba)", "update erp.empresas set fuso_horario='america/cuiaba' where id=$1", [E1]],
        ["update vazio", "update erp.empresas set fuso_horario='' where id=$1", [E1]],
        ["insert Marte/Olimpo", "insert into erp.empresas (organization_id, code, name, fuso_horario) values ($1, 93, '[TEST] MM2 Marte', 'Marte/Olimpo')", [demo.orgId]]
      ] as [string, string, unknown[]][]) recusas.push([nome, await erroNoPonto(c, sql, p)]);
      const nulo = await erroNoPonto(c, "update erp.empresas set fuso_horario=null where id=$1", [E1]);
      return {
        aceitos: [u.rowCount, u.rows[0]!.f, novaCuiaba.rowCount, novaCuiaba.rows[0]!.f, novaPadrao.rowCount, novaPadrao.rows[0]!.f],
        recusas: recusas.map(([nome, e]) => [nome, e.code, e.constraint, e.message.includes('"chk_empresas_fuso_horario"')]),
        nulo: [nulo.code, nulo.message.includes('"fuso_horario"')]
      };
    };
    const esperado = {
      aceitos: [1, "America/Cuiaba", 1, "America/Cuiaba", 1, "America/Sao_Paulo"],
      recusas: ["update Marte/Olimpo", "update minúsculo (america/cuiaba)", "update vazio", "insert Marte/Olimpo"].map((n) => [n, "23514", "chk_empresas_fuso_horario", true]),
      nulo: ["23502", true]
    };
    expect(await desfeita(db, null, casos), "superusuário").toEqual(esperado);
    expect(await desfeita(app, ctxPec(demo.adminUserId), casos), "erp_app_test (papel da API) com as GUCs").toEqual(esperado);
    // Reversa da decisão do grant: sem EXECUTE do erp_app na função da CHECK, o mesmo UPDATE pelo papel da API dá 42501.
    const semGrant = await desfeita(db, null, async (c) => {
      await c.query("revoke execute on function erp.fuso_horario_valido(text) from erp_app");
      await c.query("set local role erp_app_test");
      await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', 'pecuaria', true)", [demo.orgId, demo.adminUserId]);
      return erroNoPonto(c, "update erp.empresas set fuso_horario='America/Cuiaba' where id=$1", [E1]);
    });
    expect({ code: semGrant.code, funcao: /permission denied for function fuso_horario_valido/.test(semGrant.message) }).toEqual({ code: "42501", funcao: true });
    expect((await db.query<{ f: string }>("select string_agg(distinct fuso_horario, ',') f from erp.empresas")).rows[0]!.f, "nada gravado").toBe("America/Sao_Paulo");
  });

  it("MM2-1c dia_no_fuso com instante FIXO: Cuiabá às 22h locais devolve o dia LOCAL (09/10), não o UTC (10/10); hoje_na_empresa(empresa em Cuiabá) = (now() at time zone 'America/Cuiaba')::date", async () => {
    const r = (await db.query<{ cuiaba: string; utc: string; hora_local: string; cuiaba_0330: string; sp_0330: string; sp_0200: string; nulo: string | null }>(
      `select erp.dia_no_fuso('2026-10-10T02:00:00Z', 'America/Cuiaba')::text cuiaba,
              ('2026-10-10T02:00:00Z'::timestamptz at time zone 'UTC')::date::text utc,
              to_char('2026-10-10T02:00:00Z'::timestamptz at time zone 'America/Cuiaba', 'HH24:MI') hora_local,
              erp.dia_no_fuso('2026-10-10T03:30:00Z', 'America/Cuiaba')::text cuiaba_0330,
              erp.dia_no_fuso('2026-10-10T03:30:00Z', 'America/Sao_Paulo')::text sp_0330,
              erp.dia_no_fuso('2026-10-10T02:00:00Z', 'America/Sao_Paulo')::text sp_0200,
              erp.dia_no_fuso(null, 'America/Cuiaba')::text nulo`)).rows[0]!;
    expect(r).toEqual({ cuiaba: "2026-10-09", utc: "2026-10-10", hora_local: "22:00", cuiaba_0330: "2026-10-09", sp_0330: "2026-10-10", sp_0200: "2026-10-09", nulo: null });
    const h = await desfeita(db, null, async (c) => {
      await fusoDa(c, E1, "America/Cuiaba");
      return (await c.query<{ cuiaba: string; esperado_cuiaba: string; sp: string; esperado_sp: string }>(
        `select erp.hoje_na_empresa($1)::text cuiaba, (now() at time zone 'America/Cuiaba')::date::text esperado_cuiaba,
                erp.hoje_na_empresa($2)::text sp, (now() at time zone 'America/Sao_Paulo')::date::text esperado_sp`, [E1, E2])).rows[0]!;
    });
    expect([h.cuiaba, h.sp], "hoje_na_empresa = o dia de now() no fuso da empresa (Cuiabá na 1; o default São Paulo na 2)").toEqual([h.esperado_cuiaba, h.esperado_sp]);
    expect(h.cuiaba).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("MM2-1d nunca lança: hoje_na_empresa de empresa inexistente e de nulo → o dia de São Paulo; dia_no_fuso com fuso nulo, vazio, só espaço e inválido → São Paulo", async () => {
    const r = (await db.query<{ inexistente: string; nulo: string; sp_hoje: string }>(
      `select erp.hoje_na_empresa(gen_random_uuid())::text inexistente, erp.hoje_na_empresa(null)::text nulo,
              (now() at time zone 'America/Sao_Paulo')::date::text sp_hoje`)).rows[0]!;
    expect(r).toEqual({ inexistente: r.sp_hoje, nulo: r.sp_hoje, sp_hoje: r.sp_hoje });
    // 02:00Z é 09/10 em São Paulo e 10/10 em UTC: a queda para São Paulo é distinguível do dia UTC.
    const fusos: [string, string | null][] = [["nulo", null], ["vazio", ""], ["só espaço", "   "], ["inválido", "Marte/Olimpo"], ["lixo", "%%%"]];
    const obtido: [string, string][] = [];
    for (const [nome, f] of fusos) {
      obtido.push([nome, (await db.query<{ d: string }>("select erp.dia_no_fuso('2026-10-10T02:00:00Z', $1)::text d", [f])).rows[0]!.d]);
    }
    expect(obtido).toEqual(fusos.map(([nome]) => [nome, "2026-10-09"]));
  });
});

describe("MM2-2 — o identificador do lote", () => {
  it("MM2-2a identificador_cor recusa hex inválido (chk_batches_identificador_cor); identificador_sigla recusa 5 caracteres, só espaço e vazio (chk_batches_identificador_sigla); os válidos passam", async () => {
    const r = await desfeita(db, null, async (c) => {
      const recusas: [string, string | undefined, string | undefined, boolean][] = [];
      const tentar = async (nome: string, coluna: "identificador_cor" | "identificador_sigla", valor: string) => {
        const e = await erroNoPonto(c, `update erp.batches set ${coluna}=$2 where id=$1`, [LA, valor]);
        recusas.push([nome, e.code, e.constraint, e.message.includes(`"${e.constraint ?? "?"}"`)]);
      };
      for (const v of ["#12345", "#1234567", "#GGGGGG", "123456", "red", "#12 456", ""]) await tentar(`cor ${JSON.stringify(v)}`, "identificador_cor", v);
      for (const v of ["ABCDE", " ABCDE ", "   ", ""]) await tentar(`sigla ${JSON.stringify(v)}`, "identificador_sigla", v);
      const aceitos: number[] = [];
      for (const [coluna, v] of [["identificador_cor", "#a1B2c3"], ["identificador_cor", "#000000"], ["identificador_sigla", "A"],
        ["identificador_sigla", "ABCD"], ["identificador_sigla", "  ABCD  "], ["identificador_nome", "Lote da sede"]] as const) {
        aceitos.push((await c.query(`update erp.batches set ${coluna}=$2 where id=$1`, [LA, v])).rowCount ?? -1);
      }
      return { recusas, aceitos };
    });
    expect(r.recusas).toEqual([
      ...["#12345", "#1234567", "#GGGGGG", "123456", "red", "#12 456", ""].map((v) => [`cor ${JSON.stringify(v)}`, "23514", "chk_batches_identificador_cor", true]),
      ...["ABCDE", " ABCDE ", "   ", ""].map((v) => [`sigla ${JSON.stringify(v)}`, "23514", "chk_batches_identificador_sigla", true])
    ]);
    expect(r.aceitos).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("MM2-2b identificador_cor NULO com sigla e nome preenchidos é ACEITO (a cor padrão é do domínio)", async () => {
    const r = await desfeita(db, null, async (c) => {
      const u = await c.query("update erp.batches set identificador_nome='Lote A', identificador_sigla='LA', identificador_cor=null where id=$1", [LA]);
      const novo = await c.query<{ n: string; s: string; c: string | null }>(
        `insert into erp.batches (organization_id, empresa_id, code, batch_date, description, identificador_nome, identificador_sigla)
         values ($1,$2,'MM2-ID1','2026-01-01','[TEST] com sigla sem cor','Lote B','LB') returning identificador_nome n, identificador_sigla s, identificador_cor c`, [demo.orgId, E1]);
      const lido = (await c.query<{ n: string; s: string; c: string | null }>(
        "select identificador_nome n, identificador_sigla s, identificador_cor c from erp.batches where id=$1", [LA])).rows;
      return { u: u.rowCount, lido, novo: [novo.rowCount, novo.rows[0]] };
    });
    expect(r).toEqual({ u: 1, lido: [{ n: "Lote A", s: "LA", c: null }], novo: [1, { n: "Lote B", s: "LB", c: null }] });
  });
});

describe("MM2-3 — a configuração de ícone por categoria", () => {
  it("MM2-3a cada CHECK da tabela, um por um, com o nome (23514) — e a FK composta da empresa (23503); os válidos passam", async () => {
    const r = await desfeita(db, null, async (c) => {
      const casos: [string, OpIcone][] = [
        ["tipo 'animal'", { tipo: "animal" }],
        ["tipo 'LOTE' (maiúsculo)", { tipo: "LOTE" }],
        ["categoria 'Boi'", { categoria: "Boi" }],
        ["categoria ' BOI'", { categoria: " BOI" }],
        ["categoria 'BOI '", { categoria: "BOI " }],
        ["categoria vazia", { categoria: "" }],
        ["categoria com 61", { categoria: "A".repeat(61) }],
        ["cor '#12345'", { cor: "#12345" }],
        ["cor 'red'", { cor: "red" }],
        ["sem imagem e sem cor", { url: null, cor: null }],
        ["url http://", { url: "http://cdn.exemplo/boi.png", cor: null }],
        ["url HTTPS:// (maiúsculo)", { url: "HTTPS://cdn.exemplo/boi.png", cor: null }],
        ["url sem esquema", { url: "cdn.exemplo/boi.png", cor: null }],
        ["empresa de OUTRA organização", { empresa: EOutra }]
      ];
      const obtido: [string, string | undefined, string | undefined, boolean][] = [];
      for (const [nome, o] of casos) {
        const e = await erroNoPonto(c, ICONE_SQL, iconeP(o));
        obtido.push([nome, e.code, e.constraint, e.message.includes(`"${e.constraint ?? "?"}"`)]);
      }
      const aceitos = [
        await icone(c, { categoria: "A".repeat(60) }),
        await icone(c, { categoria: "VACA", url: "https://cdn.exemplo/vaca.png", cor: null }),
        await icone(c, { categoria: "TOURO", url: "https://cdn.exemplo/touro.png", cor: "#ABCDEF" }),
        await icone(c, { tipo: "objeto_de_mapa", categoria: "COCHO" }),
        await icone(c, { tipo: "area", categoria: "PASTAGEM" })
      ];
      return { obtido, aceitos: aceitos.length, gravados: (await c.query<{ n: number }>("select count(*)::int n from erp.configuracoes_de_icone")).rows[0]!.n };
    });
    const chk = (n: string) => ["23514", n, true];
    expect(r.obtido).toEqual([
      ["tipo 'animal'", ...chk("chk_icone_tipo_entidade")],
      ["tipo 'LOTE' (maiúsculo)", ...chk("chk_icone_tipo_entidade")],
      ["categoria 'Boi'", ...chk("chk_icone_categoria_canonica")],
      ["categoria ' BOI'", ...chk("chk_icone_categoria_canonica")],
      ["categoria 'BOI '", ...chk("chk_icone_categoria_canonica")],
      ["categoria vazia", ...chk("chk_icone_categoria_canonica")],
      ["categoria com 61", ...chk("chk_icone_categoria_canonica")],
      ["cor '#12345'", ...chk("chk_icone_cor_padrao")],
      ["cor 'red'", ...chk("chk_icone_cor_padrao")],
      ["sem imagem e sem cor", ...chk("chk_icone_tem_imagem_ou_cor")],
      ["url http://", ...chk("chk_icone_url_https")],
      ["url HTTPS:// (maiúsculo)", ...chk("chk_icone_url_https")],
      ["url sem esquema", ...chk("chk_icone_url_https")],
      ["empresa de OUTRA organização", "23503", "fk_configuracoes_de_icone_empresa", true]
    ]);
    expect(r).toMatchObject({ aceitos: 5, gravados: 5 });
  });

  it("MM2-3b categorias_misto: fora do MISTO recusado; MISTO com 1 elemento, repetição, nulo, vazio, não canônico, 61 caracteres e 2 dimensões recusados (chk_icone_misto_so_no_misto); MISTO válido e MISTO sem lista aceitos", async () => {
    const r = await desfeita(db, null, async (c) => {
      const casos: [string, OpIcone][] = [
        ["lista fora do MISTO (BOI)", { categoria: "BOI", misto: ["BOI", "VACA"] }],
        ["MISTO com 1 elemento", { categoria: "MISTO", misto: ["BOI"] }],
        ["MISTO com lista vazia", { categoria: "MISTO", misto: [] }],
        ["MISTO com repetição", { categoria: "MISTO", misto: ["BOI", "BOI"] }],
        ["MISTO com nulo", { categoria: "MISTO", misto: ["BOI", null as unknown as string] }],
        ["MISTO com elemento vazio", { categoria: "MISTO", misto: ["BOI", ""] }],
        ["MISTO com 'Boi'", { categoria: "MISTO", misto: ["Boi", "VACA"] }],
        ["MISTO com ' BOI'", { categoria: "MISTO", misto: [" BOI", "VACA"] }],
        ["MISTO com 61 caracteres", { categoria: "MISTO", misto: ["BOI", "V".repeat(61)] }]
      ];
      const obtido: [string, string | undefined, string | undefined][] = [];
      for (const [nome, o] of casos) {
        const e = await erroNoPonto(c, ICONE_SQL, iconeP(o));
        obtido.push([nome, e.code, e.constraint]);
      }
      const duasDim = await erroNoPonto(c, `insert into erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade, categoria, categorias_misto, cor_padrao)
                                          values ($1,$2,'lote','MISTO',array[['BOI','VACA'],['NOVILHA','TOURO']],'#112233')`, [demo.orgId, E1]);
      obtido.push(["MISTO com 2 dimensões", duasDim.code, duasDim.constraint]);
      const valido = await c.query<{ m: string[] }>(`${ICONE_SQL.replace("returning id", "returning categorias_misto m")}`, iconeP({ categoria: "MISTO", misto: ["BOI", "VACA", "NOVILHA"] }));
      const semLista = await c.query(ICONE_SQL, iconeP({ categoria: "MISTO", misto: null }));
      return { obtido, valido: [valido.rowCount, valido.rows[0]!.m], semLista: semLista.rowCount };
    });
    expect(r.obtido).toEqual([
      "lista fora do MISTO (BOI)", "MISTO com 1 elemento", "MISTO com lista vazia", "MISTO com repetição", "MISTO com nulo", "MISTO com elemento vazio",
      "MISTO com 'Boi'", "MISTO com ' BOI'", "MISTO com 61 caracteres", "MISTO com 2 dimensões"
    ].map((n) => [n, "23514", "chk_icone_misto_so_no_misto"]));
    expect(r).toMatchObject({ valido: [1, ["BOI", "VACA", "NOVILHA"]], semLista: 1 });
  });

  it("MM2-3c unique: segunda viva da mesma (empresa, tipo, categoria) recusada (23505, uq_configuracoes_de_icone_categoria), inativa inclusive; duas MISTO aceitas; outra empresa/tipo aceitos; depois da exclusão lógica a categoria grava de novo", async () => {
    const r = await desfeita(db, null, async (c) => {
      const primeiro = await icone(c, { categoria: "BOI" });
      const dup = await erroNoPonto(c, ICONE_SQL, iconeP({ categoria: "BOI", url: "https://cdn.exemplo/boi2.png" }));
      await c.query("update erp.configuracoes_de_icone set ativo=false where id=$1", [primeiro]);
      const dupInativo = await erroNoPonto(c, ICONE_SQL, iconeP({ categoria: "BOI" }));
      const outraEmpresa = await icone(c, { empresa: E2, categoria: "BOI" });
      const outroTipo = await icone(c, { tipo: "area", categoria: "BOI" });
      const misto1 = await icone(c, { categoria: "MISTO", misto: ["BOI", "VACA"] });
      const misto2 = await icone(c, { categoria: "MISTO", misto: ["VACA", "BOI"] });
      const misto3 = await icone(c, { categoria: "MISTO", misto: ["BOI", "VACA"], cor: "#445566" });
      const excl = await c.query("update erp.configuracoes_de_icone set deleted_at=now() where id=$1", [primeiro]);
      const deNovo = await icone(c, { categoria: "BOI", cor: "#778899" });
      const vivas = (await c.query<{ categoria: string; n: number }>(
        `select categoria, count(*)::int n from erp.configuracoes_de_icone where organization_id=$1 and empresa_id=$2 and tipo_entidade='lote' and deleted_at is null
          group by categoria order by categoria`, [demo.orgId, E1])).rows;
      return {
        dup: [dup.code, dup.constraint], dupInativo: [dupInativo.code, dupInativo.constraint],
        aceitos: [outraEmpresa, outroTipo, misto1, misto2, misto3, deNovo].filter((x) => /^[0-9a-f-]{36}$/.test(x)).length,
        excl: excl.rowCount, vivas
      };
    });
    expect(r).toEqual({
      dup: ["23505", "uq_configuracoes_de_icone_categoria"], dupInativo: ["23505", "uq_configuracoes_de_icone_categoria"],
      aceitos: 6, excl: 1, vivas: [{ categoria: "BOI", n: 1 }, { categoria: "MISTO", n: 3 }]
    });
  });
});

describe("MM2-4 — o gatilho de erp.batches abre e fecha no dia LOCAL da empresa da área", () => {
  it("MM2-4a lote criado SEM entry_date abre no dia LOCAL (fuso escolhido na transação com dia local ≠ dia UTC; sessão em UTC) — superusuário e erp_app; a empresa que decide é a da ÁREA; com entry_date, a data informada (Cuiabá às 22h → dia local: MM2-1c, mesma função)", async () => {
    const r = await desfeita(db, null, async (c) => {
      const f = await fusoDoCaso(c);
      await fusoDa(c, E1, f.fuso);
      await fusoDa(c, E2, "Etc/UTC");
      const semEntrada = await lote(c, "MM2-N1", { area: A1 });
      const comEntrada = await lote(c, "MM2-N2", { area: A1, entry: "2026-05-05" });
      const loteE1AreaE2 = await lote(c, "MM2-N3", { empresa: E1, area: B1 });
      const loteE2AreaE1 = await lote(c, "MM2-N4", { empresa: E2, area: A1 });
      await fusoDa(c, E1, "Etc/UTC");
      const contraprova = await lote(c, "MM2-N5", { area: A1 });
      const hoje = (await c.query<{ d: string }>("select current_date::text d")).rows[0]!.d;
      const linha = (o: Ocupacao) => [o.area_id, o.data_inicio, o.data_fim, o.origem_da_data];
      return {
        f, hoje,
        semEntrada: (await ocupacoesDo(c, semEntrada)).map(linha), comEntrada: (await ocupacoesDo(c, comEntrada)).map(linha),
        loteE1AreaE2: (await ocupacoesDo(c, loteE1AreaE2)).map(linha), loteE2AreaE1: (await ocupacoesDo(c, loteE2AreaE1)).map(linha),
        contraprova: (await ocupacoesDo(c, contraprova)).map(linha)
      };
    });
    expect(r.hoje, "current_date é o dia UTC").toBe(r.f.utc);
    expect({ semEntrada: r.semEntrada, comEntrada: r.comEntrada, loteE1AreaE2: r.loteE1AreaE2, loteE2AreaE1: r.loteE2AreaE1, contraprova: r.contraprova }).toEqual({
      semEntrada: [[A1, r.f.local, null, "criacao_do_lote"]],
      comEntrada: [[A1, "2026-05-05", null, "entrada_do_lote"]],
      loteE1AreaE2: [[B1, r.f.utc, null, "criacao_do_lote"]],
      loteE2AreaE1: [[A1, r.f.local, null, "criacao_do_lote"]],
      contraprova: [[A1, r.f.utc, null, "criacao_do_lote"]]
    });
    expect(r.semEntrada[0]![1], "o dia local NÃO é o current_date da sessão").not.toBe(r.hoje);

    // Pelo caminho da API: o erp_app (sem bypass e sem EXECUTE em hoje_na_empresa) muda o fuso e cria o lote; o gatilho
    // SECURITY DEFINER chama hoje_na_empresa como o dono.
    const pelaApi = await desfeita(app, ctxPec(demo.adminUserId), async (c) => {
      const f = await fusoDoCaso(c);
      await fusoDa(c, E1, f.fuso);
      const novo = await lote(c, "MM2-N6", { area: A1 });
      return { f, ocupacoes: (await ocupacoesDo(c, novo)).map((o) => [o.area_id, o.data_inicio, o.data_fim, o.origem_da_data]) };
    });
    expect(pelaApi.ocupacoes).toEqual([[A1, pelaApi.f.local, null, "criacao_do_lote"]]);
    expect(pelaApi.f.local).not.toBe(pelaApi.f.utc);
  });

  it("MM2-4b lote encerrado (closed, exit_date, deleted_at — os três) fecha no dia LOCAL; reativado reabre no dia LOCAL; a troca de area_id fora da rota (caminho c, pelo erp_app) fecha e abre no dia LOCAL; cada lado no fuso da SUA empresa", async () => {
    const enc = await desfeita(db, null, async (c) => {
      const f = await fusoDoCaso(c);
      await fusoDa(c, E1, f.fuso);
      const n = [
        (await c.query("update erp.batches set status='closed' where id=$1", [LA])).rowCount,
        (await c.query("update erp.batches set exit_date='2026-09-30' where id=$1", [LC])).rowCount,
        (await c.query("update erp.batches set deleted_at=now() where id=$1", [LG])).rowCount
      ];
      const fechadas = {
        closed: await ocupacoesDo(c, LA), exitDate: await ocupacoesDo(c, LC), deletedAt: await ocupacoesDo(c, LG)
      };
      expect((await c.query("update erp.batches set status='active' where id=$1", [LA])).rowCount).toBe(1);
      return { f, n, fechadas, reativado: await ocupacoesDo(c, LA) };
    });
    expect(enc.n).toEqual([1, 1, 1]);
    const fechada = (area_id: string, data_inicio: string, origem: string, motivo: string): Ocupacao =>
      ({ area_id, data_inicio, data_fim: enc.f.local, origem_da_data: origem, motivo_saida: motivo });
    expect(enc.fechadas).toEqual({
      closed: [fechada(A1, "2026-01-10", "entrada_do_lote", "encerramento_do_lote")],
      exitDate: [fechada(A2, "2026-02-01", "entrada_do_lote", "encerramento_do_lote")],
      deletedAt: [fechada(A1, "2026-03-05", "entrada_do_lote", "correcao")]
    });
    expect(enc.reativado).toEqual([
      fechada(A1, "2026-01-10", "entrada_do_lote", "encerramento_do_lote"),
      { area_id: A1, data_inicio: enc.f.local, data_fim: null, origem_da_data: "movimento", motivo_saida: null }
    ]);
    expect(enc.f.local, "o dia local NÃO é o dia UTC (current_date)").not.toBe(enc.f.utc);

    // Caminho c: UPDATE de area_id fora da rota de transferência, pelo papel da API.
    const c1 = await desfeita(app, ctxPec(demo.adminUserId), async (c) => {
      const f = await fusoDoCaso(c);
      await fusoDa(c, E1, f.fuso);
      const u = (await c.query("update erp.batches set area_id=$2 where id=$1", [LA, A2])).rowCount;
      return { f, u, ocupacoes: await ocupacoesDo(c, LA) };
    });
    expect(c1.u).toBe(1);
    expect(c1.ocupacoes).toEqual([
      { area_id: A1, data_inicio: "2026-01-10", data_fim: c1.f.local, origem_da_data: "entrada_do_lote", motivo_saida: "transferencia" },
      { area_id: A2, data_inicio: c1.f.local, data_fim: null, origem_da_data: "movimento", motivo_saida: null }
    ]);
    // Cada lado no fuso da SUA empresa: LD sai de B1 (empresa 2, fuso local) para A1 (empresa 1, UTC).
    const c2 = await desfeita(db, null, async (c) => {
      const f = await fusoDoCaso(c);
      await fusoDa(c, E2, f.fuso);
      await fusoDa(c, E1, "Etc/UTC");
      expect((await c.query("update erp.batches set area_id=$2 where id=$1", [LD, A1])).rowCount).toBe(1);
      return { f, ocupacoes: await ocupacoesDo(c, LD) };
    });
    const [saida, entrada] = [c2.ocupacoes.find((o) => o.area_id === B1), c2.ocupacoes.find((o) => o.area_id === A1)];
    expect({ saida, entrada, n: c2.ocupacoes.length }).toEqual({
      saida: { area_id: B1, data_inicio: "2026-03-01", data_fim: c2.f.local, origem_da_data: "entrada_do_lote", motivo_saida: "transferencia" },
      entrada: { area_id: A1, data_inicio: c2.f.utc, data_fim: null, origem_da_data: "movimento", motivo_saida: null },
      n: 2
    });
    // Nada disso ficou: as transações foram desfeitas.
    expect(await retrato().then((x) => x.ocupacoes_de_area)).toEqual(retratoInicial.ocupacoes_de_area);
  });
});

describe("MM2-5 — RLS e privilégios dos ícones", () => {
  it("MM2-5a outra organização não vê; quem só vê a empresa 1 não vê a da 2 nem grava nela (WITH CHECK 42501; UPDATE 0 linha); o dono vê as duas; auditoria", async () => {
    const iE1 = await icone(db, { empresa: E1, categoria: "NOVILHA" });
    const iE2 = await icone(db, { empresa: E2, categoria: "NOVILHA", url: "https://cdn.exemplo/novilha.png", cor: null });
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.audit_logs where entity='configuracoes_de_icone' and action='create' and entity_id = any($1)",
      [[iE1, iE2]])).rows[0]!.n, "ícone auditado").toBe(2);
    const ver = (ctx: TenantContext) => withTx(app, ctx, (tx) => tx.query<{ empresa_id: string }>(
      "select empresa_id from erp.configuracoes_de_icone order by (empresa_id = $1) desc", [E1])).then((r) => r.rows.map((x) => x.empresa_id));
    expect(await ver(ctxPec(demo.adminUserId)), "o dono vê as duas").toEqual([E1, E2]);
    expect(await ver(ctxPec(donoOutraOrg, outraOrg)), "GUC de outra organização: nada").toEqual([]);
    expect(await ver(ctxPec(usuarioSoE1)), "só a empresa 1").toEqual([E1]);
    expect(await ver({ orgId: demo.orgId, userId: usuarioSoE1, modulo: "estoque" }), "fora do módulo pecuaria: nada").toEqual([]);
    expect((await withTx(app, ctxPec(usuarioSoE1), (tx) => tx.query("select 1 from erp.configuracoes_de_icone where id=$1", [iE2]))).rowCount,
      "pelo id, a linha da empresa 2 não existe para ele").toBe(0);

    const eIns = await erroDe(desfeita(app, ctxPec(usuarioSoE1), (c) => icone(c, { empresa: E2, categoria: "VACA" })));
    expect({ code: eIns.code, rls: /row-level security/.test(eIns.message) }).toEqual({ code: "42501", rls: true });
    expect(await desfeita(app, ctxPec(usuarioSoE1), (c) => icone(c, { empresa: E1, categoria: "VACA" })), "na empresa 1 grava").toMatch(/^[0-9a-f-]{36}$/);
    const upd = await desfeita(app, ctxPec(usuarioSoE1), async (c) => [
      (await c.query("update erp.configuracoes_de_icone set cor_padrao='#000000' where id=$1", [iE2])).rowCount,
      (await c.query("update erp.configuracoes_de_icone set cor_padrao='#000000' where id=$1", [iE1])).rowCount
    ]);
    expect(upd, "UPDATE na linha da empresa 2: ZERO linhas (o chamador confere o ROW COUNT); na 1: uma").toEqual([0, 1]);
    // Mover a linha da empresa 1 para a 2 também é recusado (WITH CHECK).
    const eMover = await erroDe(desfeita(app, ctxPec(usuarioSoE1), (c) => c.query("update erp.configuracoes_de_icone set empresa_id=$2 where id=$1", [iE1, E2])));
    expect({ code: eMover.code, rls: /row-level security/.test(eMover.message) }).toEqual({ code: "42501", rls: true });
  });

  it("MM2-5b DELETE e TRUNCATE revogados do erp_app em erp.configuracoes_de_icone (catálogo e tentativa real: 42501); SELECT/INSERT/UPDATE concedidos", async () => {
    const priv = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean; tr: boolean; app_test_d: boolean }>(
      `select has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'SELECT') s, has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'INSERT') i,
              has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'UPDATE') u, has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'DELETE') d,
              has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'TRUNCATE') tr, has_table_privilege('erp_app_test', 'erp.configuracoes_de_icone', 'DELETE') app_test_d`)).rows[0]!;
    expect(priv).toEqual({ s: true, i: true, u: true, d: false, tr: false, app_test_d: false });
    const alvo = (await db.query<{ id: string }>("select id from erp.configuracoes_de_icone where empresa_id=$1 limit 1", [E1])).rows[0]!.id;
    const tentativas: [string, string, unknown[]][] = [
      ["delete do ícone", "delete from erp.configuracoes_de_icone where id=$1", [alvo]],
      ["delete sem filtro", "delete from erp.configuracoes_de_icone", []],
      ["truncate", "truncate erp.configuracoes_de_icone", []]
    ];
    const obtido: [string, string | undefined][] = [];
    for (const [nome, sql, p] of tentativas) obtido.push([nome, (await erroDe(desfeita(app, ctxPec(demo.adminUserId), (c) => c.query(sql, p)))).code]);
    expect(obtido).toEqual(tentativas.map(([nome]) => [nome, "42501"]));
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.configuracoes_de_icone")).rows[0]!.n, "as duas linhas continuam").toBe(2);
  });
});
