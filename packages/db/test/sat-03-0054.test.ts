import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type TenantContext, type Tx } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0054 (SAT-03, decisão 296 — executor da fila satelital: ledger com PU desconhecido, tentativas por rodada, porta de
 * RESERVA e porta de CONTAGEM do limite global), PROVADA CONTRA O BANCO, como o runner aplica (arquivo a arquivo, cada um
 * numa transação), sobre um banco na 0053 COM ACERVO (consulta, itens em quatro situações e consumo).
 *
 * DB-0 premissa · DB-1 a trava (2026,88) ocupada recusa sem aplicar nada · DB-2 SOBE: nenhuma linha de nenhuma tabela
 * muda, a fila e o ledger não são regravados, todo item existente lê tentativas_rodada = 0; reaplicar para no preflight ·
 * DB-3 o ledger com o PU desconhecido (par nulo só com origem; par sempre junto; crédito derivado; imutável continua) ·
 * DB-4 tentativas_rodada ≤ tentativas · DB-5 a RESERVA (contrato do retorno, marcação, o que não é elegível, ordem e
 * limite, os três tetos, a recuperação do vencido, o ACESSO DO CRIADOR igual à RLS, as GUCs devolvidas, parâmetros fora
 * da faixa) · DB-6 CONCORRÊNCIA (trava da reserva ocupada, duas conexões, chamadas simultâneas, SKIP LOCKED) · DB-7 a
 * CONTAGEM · DB-8 quem executa (só o dono e o erp_app) · DB-9 DESCE pelo SQL reverso (fail-closed com PU desconhecido no
 * ledger) e SOBE de novo com o mesmo catálogo.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS, com
 * as GUCs da transação — o caminho do executor e da API). A porta é SECURITY DEFINER: o que ela faz não depende de quem
 * chama, só das GUCs e da transação. Por isso os cenários de teto, ordem e recuperação rodam numa transação do
 * superusuário DESFEITA no fim — o ledger é imutável, e só assim a fronteira do "último minuto" fica exata (o now() da
 * transação é um só) e nada fica para o teste seguinte; o caminho do erp_app (RLS, GUC vazia, acesso do criador, GUCs
 * devolvidas, concorrência) roda com dados gravados e limpos no fim.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string; let areaA: string; let areaB: string;
let outraOrg: string; let empresaX: string; let areaX: string;
let terceiraOrg: string; let empresaY: string; let areaY: string;
let quartaOrg: string; let empresaZ: string; let areaZ: string;
let usuarioTodas: string; let usuarioSoA: string; let usuarioSoB: string; let usuarioInativo: string; let usuarioSemPecuaria: string;
let donoOutraOrg: string; let donoTerceira: string; let donoQuarta: string;

const ALVO = "0054_satelite_executor.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "SAT-03: outra transacao ja detem a trava desta migration (2026,88). Nada foi aplicado.";
const JA = "SAT-03: a 0054 ja foi aplicada ou ha schema divergente (satelite_reservar_itens/satelite_contar_chamadas/ix_satelite_consumo_recente/chk_satelite_consumo_pu_creditos_par/chk_satelite_consumo_pu_ou_origem/tentativas_rodada ja existe, ou pu_gasto/creditos do consumo ja anulavel).";
const IMUTAVEL_CONSUMO = "CONFLICT: O consumo satelital registrado não se altera nem se apaga: um consumo novo é registrado ao lado do anterior.";
const RESERVAR = "erp.satelite_reservar_itens(integer,integer,integer,integer,integer)";
const CONTAR = "erp.satelite_contar_chamadas()";
const COLUNAS_RESERVA = ["organization_id", "empresa_id", "consulta_id", "item_id", "criado_por"];
const COLUNAS_CONTAGEM = ["conta_minuto", "conta_executando", "org_minuto", "org_executando"];
const SEM_TETO = 1_000_000;
const VAZIO: TenantContext = { orgId: null, userId: null };
const LIMPAR_FILA = "update erp.satelite_consulta_itens set situacao = 'cancelado' where situacao in ('pendente', 'executando')";

/**
 * O CAMINHO INVERSO DA 0054. O repositório é forward-only (não há arquivo de descida em supabase/migrations): este SQL
 * existe para PROVAR que a 0054 é reversível e que a volta é exatamente esta — e é o que se aplicaria, por decisão
 * humana, para desfazê-la (a contagem de tentativas por rodada se perde; o histórico de tentativas fica). Sem CASCADE de
 * propósito: dependência que ninguém previu faz a volta falhar alto.
 */
const SQL_REVERSO = `
  -- 1) As duas portas (nada no banco depende delas).
  drop function erp.satelite_reservar_itens(integer, integer, integer, integer, integer);
  drop function erp.satelite_contar_chamadas();
  -- 2) O índice do último minuto.
  drop index erp.ix_satelite_consumo_recente;
  -- 3) A coluna da rodada (o CHECK e o comentário dela vão junto). tentativas, o histórico, fica.
  alter table erp.satelite_consulta_itens drop column tentativas_rodada;
  -- 4) Os dois CHECKs do ledger e o NOT NULL de volta. FAIL-CLOSED: com uma linha de PU desconhecido no ledger (o que só
  --    a 0054 permite), o NOT NULL não volta (23502) e a volta inteira para — o ledger é imutável, e a decisão é humana.
  alter table erp.satelite_consumo drop constraint chk_satelite_consumo_pu_ou_origem;
  alter table erp.satelite_consumo drop constraint chk_satelite_consumo_pu_creditos_par;
  alter table erp.satelite_consumo alter column creditos set not null;
  alter table erp.satelite_consumo alter column pu_gasto set not null;
  -- 5) Os comentários da 0053, como ela os escreveu.
  comment on table erp.satelite_consumo is 'LEDGER IMUTÁVEL do consumo do provedor satelital (SAT-02, decisão 295): uma linha por cobrança informada. Não se altera nem se apaga.';
  comment on column erp.satelite_consumo.pu_gasto is 'Processing units cobradas.';
  comment on column erp.satelite_consumo.creditos is 'Créditos = round(pu_gasto × 100, 2) (1 crédito = 0,01 PU).';
  comment on column erp.satelite_consumo.origem_cabecalho is 'Valor bruto do cabeçalho x-processingunits-spent, quando veio dele.';
  comment on column erp.satelite_consulta_itens.tentativas is 'Tentativas feitas pelo executor.';
  -- 6) O ledger de migrations: a 0054 deixa de constar, e o runner a aplicaria de novo.
  delete from public.erp_migrations where name = '${ALVO}';
`;

const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };

async function id1(sql: string, p: unknown[] = []) { return (await db.query<{ id: string }>(sql, p)).rows[0]!.id; }
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { const x = e as { code?: string; constraint?: string; message: string }; return { code: x.code, constraint: x.constraint, message: x.message }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ctxPec = (userId: string, orgId: string): TenantContext => ({ orgId, userId, modulo: "pecuaria" });

/** Roda fn numa transação DESFEITA no fim, com as GUCs dadas (o ledger é imutável: o que o teste grava nele não fica). */
async function desfeita<T>(pool: Db, fn: (c: Tx) => Promise<T>, ctx?: TenantContext): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (ctx) await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', $3, true)",
      [ctx.orgId ?? "", ctx.userId ?? "", ctx.modulo ?? ""]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
/** Cenário da reserva: transação do superusuário desfeita no fim, com a fila VIVA cancelada antes (só o que o teste semeia). */
const cenario = <T>(fn: (c: Tx) => Promise<T>) => desfeita(db, async (c) => { await c.query(LIMPAR_FILA); return fn(c); });
/** A recusa esperada dentro de uma transação: o savepoint devolve a transação ao estado de antes. */
async function recusaNo(c: Tx, p: () => Promise<unknown>) {
  await c.query("savepoint s");
  try { return await erroDe(p()); } finally { await c.query("rollback to savepoint s"); }
}
const limparFilaComitada = () => db.query(LIMPAR_FILA);

// ---------- montagem de linhas (tempos RELATIVOS ao now() da transação que grava) ----------
interface Consulta { org?: string; empresa: string; criadoPor?: string }
async function consulta(q: Queryable, c: Consulta) {
  return (await q.query<{ id: string }>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, total_itens)
     values ($1,$2,$3,'{"alvo":{"tipo":"todas"}}','12.50','2.50',1) returning id`,
    [c.org ?? demo.orgId, c.empresa, c.criadoPor ?? demo.adminUserId])).rows[0]!.id;
}

interface Item {
  org?: string; empresa: string; consulta: string; area: string; situacao?: string; tentativas?: number;
  /** tentativas_rodada; omitida = a coluna fica fora do INSERT (o acervo da 0053, antes de ela existir) */
  rodada?: number;
  /** segundos ANTES do now() (a ordem da fila) */
  criadoHa?: number;
  /** segundos a partir do now() (negativo = passado); nulo = sem prazo */
  proxima?: number | null;
}
async function item(q: Queryable, i: Item) {
  const chave = sha(randomUUID());
  const colunas = ["consulta_id", "organization_id", "empresa_id", "area_id", "geometria_sha256", "situacao", "tentativas", "chave_idempotencia",
    "chave_idempotencia_origem", "created_at", "proxima_tentativa_em"];
  const valores: unknown[] = [i.consulta, i.org ?? demo.orgId, i.empresa, i.area, sha(`geometria-${i.area}`), i.situacao ?? "pendente", i.tentativas ?? 0,
    chave, `origem-legivel|${chave}`, i.criadoHa ?? 0, i.proxima ?? null];
  const marcas = ["$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9", "now() - make_interval(secs => $10::float8)", "now() + make_interval(secs => $11::float8)"];
  if (i.rodada !== undefined) { colunas.push("tentativas_rodada"); valores.push(i.rodada); marcas.push("$12"); }
  return (await q.query<{ id: string }>(
    `insert into erp.satelite_consulta_itens (indice_bundle, versao_metodo, janela_inicio, janela_fim, ${colunas.join(", ")})
     values ('ndvi', 'ndvi-v2', '2026-09-05', '2026-10-04', ${marcas.join(", ")}) returning id`, valores)).rows[0]!.id;
}

interface Consumo { org?: string; empresa: string; consulta?: string | null; pu?: string | null; creditos?: string | null; origem?: string | null; criadoHa?: number }
function inserirConsumo(q: Queryable, c: Consumo) {
  const pu = c.pu === undefined ? "0.5000" : c.pu;
  const creditos = c.creditos === undefined ? (pu === null ? null : "50.00") : c.creditos;
  return q.query<{ id: string }>(
    `insert into erp.satelite_consumo (organization_id, empresa_id, consulta_id, operacao, pu_gasto, creditos, origem_cabecalho, created_at)
     values ($1,$2,$3,'statistical',$4,$5,$6, now() - make_interval(secs => $7::float8)) returning id`,
    [c.org ?? demo.orgId, c.empresa, c.consulta ?? null, pu, creditos, c.origem === undefined ? pu : c.origem, c.criadoHa ?? 0]);
}

interface Reserva { organization_id: string; empresa_id: string; consulta_id: string; item_id: string; criado_por: string }
interface Tetos { limite?: number; simultaneas?: number; minutoConta?: number; minutoOrg?: number; prazo?: number }
function reservar(q: Queryable, t: Tetos = {}) {
  return q.query<Reserva>("select * from erp.satelite_reservar_itens($1, $2, $3, $4, $5)",
    [t.limite ?? 50, t.simultaneas ?? SEM_TETO, t.minutoConta ?? SEM_TETO, t.minutoOrg ?? SEM_TETO, t.prazo ?? 600]);
}
const ids = (r: { rows: Reserva[] }) => r.rows.map((x) => x.item_id);
interface Contagem { conta_minuto: number; conta_executando: number; org_minuto: number; org_executando: number }
const contar = async (q: Queryable) => (await q.query<Contagem>("select * from erp.satelite_contar_chamadas()")).rows[0]!;

interface Estado { situacao: string; tentativas: number; rodada: number; prazo: number | null }
/** Situação, as duas tentativas e o prazo (segundos a partir do now() de QUEM LÊ) de cada item, por id. */
async function estado(q: Queryable, lista: string[]): Promise<Record<string, Estado>> {
  const r = await q.query<{ id: string } & Estado>(
    `select id, situacao, tentativas, tentativas_rodada rodada, extract(epoch from (proxima_tentativa_em - now()))::float8 prazo
       from erp.satelite_consulta_itens where id = any($1::uuid[])`, [lista]);
  return Object.fromEntries(r.rows.map(({ id, ...e }) => [id, e]));
}
const GUCS = "select current_setting('app.org_id', true) org, current_setting('app.user_id', true) usuario, current_setting('app.modulo_empresa', true) modulo";
interface Gucs { org: string | null; usuario: string | null; modulo: string | null }

// ---------- retrato do catálogo (schema erp inteiro) e dos dados — o mesmo da 0053 ----------
type Secao = Record<string, string>;
type Retrato = Record<string, Secao>;
const GRANTEE = "case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end";
/** Cada consulta devolve (k, v): a chave do objeto e o que dele se compara. Tudo lido do catálogo, sem entrada. */
const CATALOGO: Record<string, string> = {
  relacoes: `
    select c.relname k, 'tipo=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' forcada=' || c.relforcerowsecurity
             || ' opcoes=' || coalesce(array_to_string(c.reloptions, ','), '') || ' dono=' || pg_get_userbyid(c.relowner) v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'i')`,
  colunas: `
    select c.relname || '.' || a.attname k,
           format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') v
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,
  restricoes: `
    select coalesce(c.relname, t.typname) || '.' || k.conname k,
           k.contype::text || ' ' || pg_get_constraintdef(k.oid) || ' validada=' || k.convalidated v
      from pg_constraint k join pg_namespace n on n.oid = k.connamespace
      left join pg_class c on c.oid = k.conrelid left join pg_type t on t.oid = k.contypid
     where n.nspname = 'erp'`,
  indices: `
    select ci.relname k, pg_get_indexdef(i.indexrelid) || ' valido=' || i.indisvalid v
      from pg_index i join pg_class ci on ci.oid = i.indexrelid join pg_namespace n on n.oid = ci.relnamespace
     where n.nspname = 'erp'`,
  funcoes: `
    select p.oid::regprocedure::text k,
           'retorno=' || coalesce(pg_get_function_result(p.oid), '-') || ' secdef=' || p.prosecdef || ' volatil=' || p.provolatile::text
             || ' config=' || coalesce(array_to_string(p.proconfig, ','), '') || ' dono=' || pg_get_userbyid(p.proowner) || ' md5=' || md5(p.prosrc) v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'erp'`,
  gatilhos: `
    select c.relname || '.' || t.tgname k, pg_get_triggerdef(t.oid) || ' habilitado=' || t.tgenabled::text v
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and not t.tgisinternal`,
  politicas: `
    select tablename || '.' || policyname k,
           permissive || ' ' || cmd || ' para ' || array_to_string(roles, ',') || ' using ' || coalesce(qual, '-') || ' check ' || coalesce(with_check, '-') v
      from pg_policies where schemaname = 'erp'`,
  privilegios_relacoes: `
    select c.relname || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type k, 'concede=' || a.is_grantable v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
  privilegios_funcoes: `
    select p.oid::regprocedure::text || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type k, 'concede=' || a.is_grantable v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'`,
  comentarios: `
    select o.type || ' | ' || o.identity k, md5(d.description) v
      from pg_description d cross join lateral pg_identify_object(d.classoid, d.objoid, d.objsubid) o
     where o.schema = 'erp' or (o.schema is null and (o.identity = 'erp' or o.identity like '% on erp.%'))`,
  ledger: "select name k, '' v from public.erp_migrations"
};

async function retratoCatalogo(): Promise<Retrato> {
  const r: Retrato = {};
  for (const [nome, sql] of Object.entries(CATALOGO)) {
    const s: Secao = {};
    for (const { k, v } of (await db.query<{ k: string; v: string }>(sql)).rows) {
      if (k in s) throw new Error(`retrato, seção ${nome}: chave repetida ${k}`);
      s[k] = v;
    }
    r[nome] = s;
  }
  return r;
}

/** As colunas de cada tabela do erp, na ordem física: é a projeção com que os dados de ANTES são comparados. */
async function colunasPorTabela(): Promise<Record<string, string[]>> {
  const linhas = (await db.query<{ tabela: string; colunas: string[] }>(`
    select c.relname tabela, array_agg(a.attname::text order by a.attnum) colunas
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'erp' and c.relkind in ('r', 'p')
     group by c.relname`)).rows;
  return Object.fromEntries(linhas.map((l) => [l.tabela, l.colunas]));
}

/** Linhas e md5 das linhas (ordenadas) de cada tabela, projetadas nas colunas dadas — os nomes vêm do catálogo. */
async function retratoDados(colunas: Record<string, string[]>): Promise<Secao> {
  const s: Secao = {};
  for (const [tabela, cols] of Object.entries(colunas)) {
    const ident = (x: string) => `"${x.replace(/"/g, '""')}"`;
    const r = (await db.query<{ n: string; h: string }>(
      `select count(*)::text n, md5(coalesce(string_agg(x, chr(10) order by x), '')) h
         from (select (row(${cols.map(ident).join(", ")}))::text x from erp.${ident(tabela)}) s`)).rows[0]!;
    s[tabela] = `linhas=${r.n} md5=${r.h}`;
  }
  return s;
}

async function aplicarComoORunner(): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(SQL_ALVO);
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally { c.release(); }
}
const filenode = async (t: string) => (await db.query<{ f: string }>("select pg_relation_filenode($1::regclass)::text f", [t])).rows[0]!.f;

// Estado de ANTES da 0054, guardado para a subida (DB-2) e para a descida (DB-9).
let catalogo0053: Retrato; let catalogo0054: Retrato;
let colunas0053: Record<string, string[]>; let dados0053: Secao;
let acervoItens: string[];

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 8 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(URL_APP, { max: 8 });

  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  const area = (empresa: string, code: string, org = demo.orgId) =>
    id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
         values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] SAT3 ${code}`, JSON.stringify(POLIGONO)]);
  areaA = await area(A, "SAT3-A");
  areaB = await area(B, "SAT3-B");
  const organizacao = async (slug: string, codigoEmpresa: number) => {
    const org = await id1("insert into erp.organizations (name, slug) values ($1, $2) returning id", [`[TEST] ${slug}`, slug]);
    const empresa = await id1("insert into erp.empresas (organization_id, code, name) values ($1, $2, $3) returning id", [org, codigoEmpresa, `[TEST] Empresa ${slug}`]);
    return { org, empresa, area: await area(empresa, `SAT3-${slug}`, org) };
  };
  ({ org: outraOrg, empresa: empresaX, area: areaX } = await organizacao("outra-sat3", 97));
  ({ org: terceiraOrg, empresa: empresaY, area: areaY } = await organizacao("terceira-sat3", 96));
  ({ org: quartaOrg, empresa: empresaZ, area: areaZ } = await organizacao("quarta-sat3", 95));

  // Criadores: escopo 'todas' na pecuária; só A; só B; DONO INATIVO (teria acesso a tudo se ativo); escopo só no
  // financeiro; e os donos das outras organizações.
  const membro = async (email: string, org = demo.orgId, dono = false, ativo = true) => {
    const user = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [email, `[TEST] ${email}`]);
    const m = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,$3,$4) returning id", [org, user, dono, ativo]);
    return { user, m };
  };
  const escopo = (m: string, modulo: string, modo: string) =>
    db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,$3,$4)", [demo.orgId, m, modulo, modo]);
  const empresaDoMembro = (m: string, empresa: string) =>
    db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, m, empresa]);
  const todas = await membro("sat3-todas@demo.local"); await escopo(todas.m, "pecuaria", "todas"); usuarioTodas = todas.user;
  const soA = await membro("sat3-so-a@demo.local"); await escopo(soA.m, "pecuaria", "selecionadas"); await empresaDoMembro(soA.m, A); usuarioSoA = soA.user;
  const soB = await membro("sat3-so-b@demo.local"); await escopo(soB.m, "pecuaria", "selecionadas"); await empresaDoMembro(soB.m, B); usuarioSoB = soB.user;
  usuarioInativo = (await membro("sat3-dono-inativo@demo.local", demo.orgId, true, false)).user;
  const semPec = await membro("sat3-sem-pecuaria@demo.local"); await escopo(semPec.m, "financeiro", "todas"); usuarioSemPecuaria = semPec.user;
  donoOutraOrg = (await membro("sat3-dono-outra@demo.local", outraOrg, true)).user;
  donoTerceira = (await membro("sat3-dono-terceira@demo.local", terceiraOrg, true)).user;
  donoQuarta = (await membro("sat3-dono-quarta@demo.local", quartaOrg, true)).user;

  // O ACERVO da 0053, antes da 0054: uma consulta com itens em quatro situações (tentativas 0..3) e duas linhas de
  // consumo com PU (uma do item, uma avulsa).
  const c = await consulta(db, { empresa: A });
  acervoItens = [
    await item(db, { empresa: A, consulta: c, area: areaA }),
    await item(db, { empresa: A, consulta: c, area: areaA, situacao: "executando", tentativas: 2 }),
    await item(db, { empresa: A, consulta: c, area: areaA, situacao: "concluido", tentativas: 1 }),
    await item(db, { empresa: A, consulta: c, area: areaA, situacao: "falho", tentativas: 3 })
  ];
  await inserirConsumo(db, { empresa: A, consulta: c, pu: "1.2345", creditos: "123.45" });
  await inserirConsumo(db, { empresa: B, pu: "0.0000", creditos: "0.00", criadoHa: 3600 });
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-0 a DB-2 — a 0054 sobre o banco na 0053 com acervo: premissa, trava, subida e reaplicação", () => {
  it("DB-0 PREMISSA: o ledger termina na 0053, há acervo na fila e no ledger, e nada da 0054 existe", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0053_satelite_consultas.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: "0053_satelite_consultas.sql" });
    expect((await db.query<{ s: string; t: number }>("select situacao s, tentativas t from erp.satelite_consulta_itens order by tentativas")).rows)
      .toEqual([{ s: "pendente", t: 0 }, { s: "concluido", t: 1 }, { s: "executando", t: 2 }, { s: "falho", t: 3 }]);
    expect((await db.query("select 1 from erp.satelite_consumo where pu_gasto is not null and creditos is not null")).rowCount).toBe(2);
    const objetos = (await db.query<{ r: string | null; c: string | null; i: string | null; col: number; chk: number }>(
      `select to_regprocedure($1)::text r, to_regprocedure($2)::text c, to_regclass('erp.ix_satelite_consumo_recente')::text i,
              (select count(*)::int from information_schema.columns where table_schema='erp' and table_name='satelite_consulta_itens' and column_name='tentativas_rodada') col,
              (select count(*)::int from pg_constraint where conname in ('chk_satelite_consumo_pu_creditos_par','chk_satelite_consumo_pu_ou_origem','chk_satelite_consulta_itens_tentativas_rodada')) chk`,
      [RESERVAR, CONTAR])).rows[0];
    expect(objetos).toEqual({ r: null, c: null, i: null, col: 0, chk: 0 });
  });

  it("DB-1 TRAVA: com (2026,88) ocupada por outra sessão, a 0054 recusa sem aplicar nada", async () => {
    const outra = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 88)");
      const c = await db.connect();
      try {
        await c.query("begin");
        expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
      } finally { await c.query("rollback").catch(() => {}); c.release(); }
    } finally { await outra.query("rollback").catch(() => {}); outra.release(); }
    expect((await db.query<{ r: string | null }>("select to_regprocedure($1)::text r", [RESERVAR])).rows[0]!.r).toBeNull();
  });

  it("DB-2 (a) SOBE como o runner: NENHUMA linha de nenhuma tabela muda, a fila e o ledger não são regravados, o acervo lê tentativas_rodada = 0", async () => {
    catalogo0053 = await retratoCatalogo();
    colunas0053 = await colunasPorTabela();
    dados0053 = await retratoDados(colunas0053);
    const nodeItens = await filenode("erp.satelite_consulta_itens");
    const nodeConsumo = await filenode("erp.satelite_consumo");
    // Premissa do retrato: não vazio, e com o acervo que a comparação precisa enxergar.
    expect(Object.keys(dados0053).length).toBeGreaterThan(150);
    expect(dados0053.satelite_consulta_itens).toMatch(/^linhas=4 /);
    expect(dados0053.satelite_consumo).toMatch(/^linhas=2 /);

    await aplicarComoORunner();
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    catalogo0054 = await retratoCatalogo();

    expect(await retratoDados(colunas0053)).toEqual(dados0053);
    expect((await colunasPorTabela()).satelite_consulta_itens).toEqual([...colunas0053.satelite_consulta_itens!, "tentativas_rodada"]);
    expect((await db.query<{ id: string; r: number }>("select id, tentativas_rodada r from erp.satelite_consulta_itens order by id")).rows)
      .toEqual([...acervoItens].sort().map((id) => ({ id, r: 0 })));
    // DROP NOT NULL, CHECK novo e ADD COLUMN com default constante: só catálogo e leitura — o arquivo físico é o mesmo.
    expect(await filenode("erp.satelite_consulta_itens"), "a fila não foi regravada").toBe(nodeItens);
    expect(await filenode("erp.satelite_consumo"), "o ledger não foi regravado").toBe(nodeConsumo);
  });

  it("DB-2 (b) catálogo: PU e crédito anuláveis nos mesmos tipos, tentativas_rodada integer not null default 0, o índice do último minuto", async () => {
    const colunas = (await db.query<{ k: string; v: string }>(
      `select table_name || '.' || column_name k, data_type || ' ' || coalesce(numeric_precision::text || ',' || numeric_scale::text, '') || ' ' || is_nullable || ' ' || coalesce(column_default, '-') v
         from information_schema.columns where table_schema = 'erp'
          and (table_name, column_name) in (('satelite_consumo','pu_gasto'), ('satelite_consumo','creditos'), ('satelite_consulta_itens','tentativas_rodada'))
        order by 1`)).rows;
    expect(colunas).toEqual([
      { k: "satelite_consulta_itens.tentativas_rodada", v: "integer 32,0 NO 0" },
      { k: "satelite_consumo.creditos", v: "numeric 16,2 YES -" },
      { k: "satelite_consumo.pu_gasto", v: "numeric 14,4 YES -" }
    ]);
    expect((await db.query<{ d: string }>("select pg_get_indexdef('erp.ix_satelite_consumo_recente'::regclass) d")).rows[0]!.d)
      .toBe("CREATE INDEX ix_satelite_consumo_recente ON erp.satelite_consumo USING btree (created_at) INCLUDE (organization_id)");
  });

  it("DB-2 (c) reaplicar a 0054 já aplicada para no preflight, com a mensagem de 'já aplicada', sem mudar o catálogo", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      expect((await erroDe(c.query(SQL_ALVO))).message).toBe(JA);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0054);
  });
});

describe("DB-3 — o ledger com o PU DESCONHECIDO (decisão B): par nulo só com o motivo, par sempre junto, crédito derivado, imutável", () => {
  it("par nulo SEM origem (nula ou em branco) → 23514 chk_satelite_consumo_pu_ou_origem; um nulo e o outro preenchido → 23514 chk_satelite_consumo_pu_creditos_par", async () => {
    await desfeita(db, async (c) => {
      const casos: [string, Consumo, string][] = [
        ["par nulo, origem nula", { empresa: A, pu: null, creditos: null, origem: null }, "chk_satelite_consumo_pu_ou_origem"],
        ["par nulo, origem vazia", { empresa: A, pu: null, creditos: null, origem: "" }, "chk_satelite_consumo_pu_ou_origem"],
        ["par nulo, origem em branco", { empresa: A, pu: null, creditos: null, origem: "   " }, "chk_satelite_consumo_pu_ou_origem"],
        ["PU nulo, crédito preenchido", { empresa: A, pu: null, creditos: "1.00", origem: "cabecalho_ausente" }, "chk_satelite_consumo_pu_creditos_par"],
        ["PU preenchido, crédito nulo", { empresa: A, pu: "0.0100", creditos: null }, "chk_satelite_consumo_pu_creditos_par"],
        ["PU preenchido, crédito nulo, sem origem", { empresa: A, pu: "0.0100", creditos: null, origem: null }, "chk_satelite_consumo_pu_creditos_par"]
      ];
      for (const [nome, consumo, restricao] of casos) {
        const e = await recusaNo(c, () => inserirConsumo(c, consumo));
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", restricao]);
      }
    });
  });

  it("par nulo COM o motivo é aceito (superusuário e erp_app sob RLS); o crédito continua derivado do PU; a linha nula é imutável como as outras", async () => {
    await desfeita(db, async (c) => {
      for (const origem of ["cabecalho_ausente", "cabecalho_invalido"]) {
        expect((await inserirConsumo(c, { empresa: A, pu: null, creditos: null, origem })).rowCount, origem).toBe(1);
      }
      // O derivado grava; crédito divergente → 23514 no CHECK que já existia (com PU preenchido ele continua valendo).
      expect((await inserirConsumo(c, { empresa: A, pu: "1.2345", creditos: "123.45" })).rowCount).toBe(1);
      for (const [pu, creditos] of [["1.2345", "123.46"], ["1.2345", "1.23"], ["0.0100", "0.00"]] as const) {
        const e = await recusaNo(c, () => inserirConsumo(c, { empresa: A, pu, creditos }));
        expect([pu, creditos, e.code, e.constraint]).toEqual([pu, creditos, "23514", "chk_satelite_consumo_creditos"]);
      }
      expect((await recusaNo(c, () => inserirConsumo(c, { empresa: A, pu: "-0.0100", creditos: "-1.00" }))).constraint).toBe("chk_satelite_consumo_pu");
      // Imutável: UPDATE (inclusive "completar" o PU), DELETE e TRUNCATE recusados até para o dono do schema.
      const nula = (await inserirConsumo(c, { empresa: A, pu: null, creditos: null, origem: "cabecalho_ausente" })).rows[0]!.id;
      expect((await recusaNo(c, () => c.query("update erp.satelite_consumo set pu_gasto = 1, creditos = 100 where id=$1", [nula]))).message).toBe(IMUTAVEL_CONSUMO);
      expect((await recusaNo(c, () => c.query("delete from erp.satelite_consumo where id=$1", [nula]))).message).toBe(IMUTAVEL_CONSUMO);
      expect((await recusaNo(c, () => c.query("truncate erp.satelite_consumo"))).message).toBe(IMUTAVEL_CONSUMO);
      expect((await c.query("select pu_gasto, creditos, origem_cabecalho from erp.satelite_consumo where id=$1", [nula])).rows[0])
        .toEqual({ pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_ausente" });
    });
    // O caminho da API: o erp_app, com a GUC do dono e o módulo da área, grava a linha nula (a RLS com check aceita).
    const comoApp = await desfeita(app, (c) => inserirConsumo(c, { empresa: A, pu: null, creditos: null, origem: "cabecalho_invalido" }), ctxPec(demo.adminUserId, demo.orgId));
    expect(comoApp.rowCount).toBe(1);
    expect((await db.query("select 1 from erp.satelite_consumo where pu_gasto is null")).rowCount, "nada ficou: tudo foi desfeito").toBe(0);
  });
});

describe("DB-4 — tentativas_rodada: 0 <= tentativas_rodada <= tentativas", () => {
  it("default 0; igual a tentativas grava; maior que tentativas ou negativa → 23514 chk_satelite_consulta_itens_tentativas_rodada (no INSERT e no UPDATE)", async () => {
    await desfeita(db, async (c) => {
      const cA = await consulta(c, { empresa: A });
      const semRodada = await item(c, { empresa: A, consulta: cA, area: areaA, situacao: "falho", tentativas: 2 });
      expect((await estado(c, [semRodada]))[semRodada]!.rodada, "default 0").toBe(0);
      expect(await item(c, { empresa: A, consulta: cA, area: areaA, situacao: "falho", tentativas: 3, rodada: 3 })).toMatch(/^[0-9a-f-]{36}$/);
      for (const [tentativas, rodada] of [[2, 3], [0, 1], [5, -1]] as const) {
        const e = await recusaNo(c, () => item(c, { empresa: A, consulta: cA, area: areaA, situacao: "falho", tentativas, rodada }));
        expect([tentativas, rodada, e.code, e.constraint]).toEqual([tentativas, rodada, "23514", "chk_satelite_consulta_itens_tentativas_rodada"]);
      }
      // O "reprocessar falhas" zera a rodada e mantém o histórico; a rodada nunca passa do histórico.
      expect((await c.query("update erp.satelite_consulta_itens set tentativas_rodada = 0, situacao = 'pendente' where id=$1", [semRodada])).rowCount).toBe(1);
      const e = await recusaNo(c, () => c.query("update erp.satelite_consulta_itens set tentativas_rodada = 3 where id=$1", [semRodada]));
      expect([e.code, e.constraint]).toEqual(["23514", "chk_satelite_consulta_itens_tentativas_rodada"]);
    });
  });
});

describe("DB-5 — a RESERVA erp.satelite_reservar_itens", () => {
  it("R-1 como o executor (erp_app, GUC vazia): devolve SÓ as 5 colunas, na ordem; cada linha bate com o item e o criador da consulta; marca executando 1/1 com o prazo — a RLS sozinha não mostraria item nenhum", async () => {
    await limparFilaComitada();
    const cA = await consulta(db, { empresa: A, criadoPor: usuarioSoA });
    const cX = await consulta(db, { org: outraOrg, empresa: empresaX, criadoPor: donoOutraOrg });
    const iA1 = await item(db, { empresa: A, consulta: cA, area: areaA, criadoHa: 30 });
    const iX = await item(db, { org: outraOrg, empresa: empresaX, consulta: cX, area: areaX, criadoHa: 20 });
    const iA2 = await item(db, { empresa: A, consulta: cA, area: areaA, criadoHa: 10 });
    try {
      const { visiveis, r } = await withTx(app, VAZIO, async (tx) => ({
        visiveis: (await tx.query<{ n: number }>("select count(*)::int n from erp.satelite_consulta_itens")).rows[0]!.n,
        r: await reservar(tx, { prazo: 600 })
      }));
      expect(visiveis, "premissa: com a GUC vazia, a RLS não mostra item nenhum ao erp_app").toBe(0);
      expect(r.fields.map((f) => f.name)).toEqual(COLUNAS_RESERVA);
      expect(r.rows).toEqual([
        { organization_id: demo.orgId, empresa_id: A, consulta_id: cA, item_id: iA1, criado_por: usuarioSoA },
        { organization_id: outraOrg, empresa_id: empresaX, consulta_id: cX, item_id: iX, criado_por: donoOutraOrg },
        { organization_id: demo.orgId, empresa_id: A, consulta_id: cA, item_id: iA2, criado_por: usuarioSoA }
      ]);
      // A linha devolvida é a do banco (organização, empresa e consulta do item; criador da consulta).
      const doBanco = (await db.query<Reserva>(
        `select i.organization_id, i.empresa_id, i.consulta_id, i.id item_id, c.criado_por
           from erp.satelite_consulta_itens i join erp.satelite_consultas c on c.id = i.consulta_id
          where i.id = any($1::uuid[]) order by i.created_at`, [[iA1, iX, iA2]])).rows;
      expect(r.rows).toEqual(doBanco);
      // Gravado: executando, as duas tentativas em 1, prazo = o now() da reserva (updated_at) + 600 s.
      expect((await db.query<{ s: string; t: number; r: number; prazo: boolean }>(
        `select situacao s, tentativas t, tentativas_rodada r, proxima_tentativa_em = updated_at + interval '600 seconds' prazo
           from erp.satelite_consulta_itens where id = any($1::uuid[]) order by created_at`, [[iA1, iX, iA2]])).rows)
        .toEqual([1, 2, 3].map(() => ({ s: "executando", t: 1, r: 1, prazo: true })));
    } finally { await limparFilaComitada(); }
  });

  it("R-2 marca 'executando', soma 1 às DUAS tentativas a partir do que já havia, e o prazo é now() + p_prazo_segundos", async () => {
    await cenario(async (c) => {
      const cA = await consulta(c, { empresa: A });
      const i = await item(c, { empresa: A, consulta: cA, area: areaA, tentativas: 4, rodada: 1, proxima: -10 });
      expect(ids(await reservar(c, { prazo: 90 }))).toEqual([i]);
      expect((await estado(c, [i]))[i]).toEqual({ situacao: "executando", tentativas: 5, rodada: 2, prazo: 90 });
    });
  });

  it("R-3 ignora o que não é 'pendente' vencido: concluído, falho, reaproveitado, cancelado, executando no prazo e pendente com a próxima tentativa no futuro", async () => {
    await cenario(async (c) => {
      const cA = await consulta(c, { empresa: A });
      const base = { empresa: A, consulta: cA, area: areaA };
      const fora: string[] = [];
      for (const situacao of ["concluido", "falho", "reaproveitado", "cancelado"]) fora.push(await item(c, { ...base, situacao, tentativas: 1, rodada: 1, criadoHa: 500 }));
      fora.push(await item(c, { ...base, situacao: "executando", tentativas: 1, rodada: 1, proxima: 3600, criadoHa: 500 }));
      fora.push(await item(c, { ...base, proxima: 3600, criadoHa: 500 }));
      fora.push(await item(c, { ...base, proxima: 1, criadoHa: 500 }));
      const antes = await estado(c, fora);
      const semPrazo = await item(c, { ...base, proxima: null, criadoHa: 400 });
      const passado = await item(c, { ...base, proxima: -1, criadoHa: 300 });
      const agora = await item(c, { ...base, proxima: 0, criadoHa: 200 });
      expect(ids(await reservar(c))).toEqual([semPrazo, passado, agora]);
      expect(await estado(c, fora)).toEqual(antes);
    });
  });

  it("R-4 respeita p_limite e a ordem (created_at, id) — o empate no created_at sai pelo id", async () => {
    await cenario(async (c) => {
      const cA = await consulta(c, { empresa: A });
      const criados: [number, string][] = [];
      for (const ha of [50, 40, 40, 30, 20]) criados.push([ha, await item(c, { empresa: A, consulta: cA, area: areaA, criadoHa: ha })]);
      const ordem = criados.sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1)).map(([, id]) => id);
      expect(ids(await reservar(c, { limite: 2 }))).toEqual(ordem.slice(0, 2));
      expect(ids(await reservar(c, { limite: 2 }))).toEqual(ordem.slice(2, 4));
      expect(ids(await reservar(c, { limite: 50 }))).toEqual(ordem.slice(4));
      expect(ids(await reservar(c))).toEqual([]);
    });
  });

  it("R-5 teto de SIMULTÂNEAS: os 'executando' da fila INTEIRA (todas as organizações) contam", async () => {
    await cenario(async (c) => {
      const cA = await consulta(c, { empresa: A });
      const cX = await consulta(c, { org: outraOrg, empresa: empresaX, criadoPor: donoOutraOrg });
      await item(c, { empresa: A, consulta: cA, area: areaA, situacao: "executando", tentativas: 1, rodada: 1, proxima: 3600 });
      await item(c, { org: outraOrg, empresa: empresaX, consulta: cX, area: areaX, situacao: "executando", tentativas: 1, rodada: 1, proxima: 3600 });
      const p: string[] = [];
      for (let k = 0; k < 4; k++) p.push(await item(c, { empresa: A, consulta: cA, area: areaA, criadoHa: 100 - k }));
      expect(ids(await reservar(c, { simultaneas: 2 })), "duas executando, teto 2").toEqual([]);
      expect(ids(await reservar(c, { simultaneas: 3 }))).toEqual([p[0]]);
      expect(ids(await reservar(c, { simultaneas: 5 }))).toEqual([p[1], p[2]]);
      expect((await estado(c, [p[3]!]))[p[3]!]!.situacao).toBe("pendente");
    });
  });

  it("R-6 teto de chamadas por minuto NA CONTA = ledger do último minuto (created_at > now() − 60 s: o de 60 s exatos e os mais velhos não contam) + executando", async () => {
    await cenario(async (c) => {
      const base = (await c.query<{ n: number }>("select count(*)::int n from erp.satelite_consumo where created_at > now() - interval '60 seconds'")).rows[0]!.n;
      for (const ha of [0, 30, 59.5]) await inserirConsumo(c, { empresa: A, criadoHa: ha });
      for (const ha of [60, 61, 600]) await inserirConsumo(c, { empresa: B, criadoHa: ha });
      const cA = await consulta(c, { empresa: A });
      await item(c, { empresa: A, consulta: cA, area: areaA, situacao: "executando", tentativas: 1, rodada: 1, proxima: 3600 });
      const p: string[] = [];
      for (let k = 0; k < 5; k++) p.push(await item(c, { empresa: A, consulta: cA, area: areaA, criadoHa: 100 - k }));
      expect(await contar(c)).toMatchObject({ conta_minuto: base + 3, conta_executando: 1 });
      // Ledger base + 3, uma executando: teto = tudo isso + 2 → duas vagas; a terceira chamada com o mesmo teto não acha vaga.
      const teto = base + 3 + 1 + 2;
      expect(ids(await reservar(c, { minutoConta: teto }))).toEqual(p.slice(0, 2));
      expect(ids(await reservar(c, { minutoConta: teto }))).toEqual([]);
      expect(ids(await reservar(c, { minutoConta: teto + 1 }))).toEqual([p[2]]);
    });
  });

  it("R-7 teto por ORGANIZAÇÃO: a organização do item no teto sai da chamada (os itens dela ficam), e as outras seguem", async () => {
    await cenario(async (c) => {
      const recente = async (org: string) =>
        (await c.query<{ n: number }>("select count(*)::int n from erp.satelite_consumo where organization_id=$1 and created_at > now() - interval '60 seconds'", [org])).rows[0]!.n;
      expect([await recente(terceiraOrg), await recente(outraOrg)], "premissa: nenhuma das duas tem consumo recente fora deste cenário").toEqual([0, 0]);
      for (const ha of [5, 10]) await inserirConsumo(c, { org: terceiraOrg, empresa: empresaY, criadoHa: ha });
      for (const ha of [61, 120, 3600]) await inserirConsumo(c, { org: terceiraOrg, empresa: empresaY, criadoHa: ha });
      const cY = await consulta(c, { org: terceiraOrg, empresa: empresaY, criadoPor: donoTerceira });
      const cX = await consulta(c, { org: outraOrg, empresa: empresaX, criadoPor: donoOutraOrg });
      await item(c, { org: terceiraOrg, empresa: empresaY, consulta: cY, area: areaY, situacao: "executando", tentativas: 1, rodada: 1, proxima: 3600 });
      const y: string[] = []; const x: string[] = [];
      for (let k = 0; k < 3; k++) y.push(await item(c, { org: terceiraOrg, empresa: empresaY, consulta: cY, area: areaY, criadoHa: 300 - k }));
      for (let k = 0; k < 2; k++) x.push(await item(c, { org: outraOrg, empresa: empresaX, consulta: cX, area: areaX, criadoHa: 200 - k }));
      // Teto 4: a terceira está em 2 (ledger recente) + 1 (executando) = 3 → UM item dela (vai a 4) e ela sai; a outra segue.
      expect(ids(await reservar(c, { minutoOrg: 4 }))).toEqual([y[0], x[0], x[1]]);
      const e = await estado(c, [y[1]!, y[2]!]);
      expect([e[y[1]!]!.situacao, e[y[2]!]!.situacao]).toEqual(["pendente", "pendente"]);
    });
  });

  it("R-8 RECUPERA o 'executando' vencido (e o sem prazo): volta a 'pendente', pronto já, SEM mudar as tentativas; o executando no prazo fica", async () => {
    await cenario(async (c) => {
      for (const ha of [5, 10]) await inserirConsumo(c, { org: terceiraOrg, empresa: empresaY, criadoHa: ha });
      const cY = await consulta(c, { org: terceiraOrg, empresa: empresaY, criadoPor: donoTerceira });
      const base = { org: terceiraOrg, empresa: empresaY, consulta: cY, area: areaY, situacao: "executando" };
      const vencido = await item(c, { ...base, tentativas: 2, rodada: 2, proxima: -1, criadoHa: 300 });
      const semPrazo = await item(c, { ...base, tentativas: 1, rodada: 1, proxima: null, criadoHa: 290 });
      const noPrazo = await item(c, { ...base, tentativas: 1, rodada: 1, proxima: 3600, criadoHa: 280 });
      // Teto 3 na organização: recuperados os dois, ela fica em 2 (ledger) + 1 (o do prazo) = 3 → nada se reserva, e a
      // recuperação aparece sozinha.
      expect(ids(await reservar(c, { minutoOrg: 3 }))).toEqual([]);
      expect(await estado(c, [vencido, semPrazo, noPrazo])).toEqual({
        [vencido]: { situacao: "pendente", tentativas: 2, rodada: 2, prazo: null },
        [semPrazo]: { situacao: "pendente", tentativas: 1, rodada: 1, prazo: null },
        [noPrazo]: { situacao: "executando", tentativas: 1, rodada: 1, prazo: 3600 }
      });
      // Sem o teto, os recuperados voltam a ser reservados, na ordem: tentativas + 1 (a interrompida contou).
      expect(ids(await reservar(c, { prazo: 120 }))).toEqual([vencido, semPrazo]);
      const e = await estado(c, [vencido, semPrazo]);
      expect(e).toEqual({
        [vencido]: { situacao: "executando", tentativas: 3, rodada: 3, prazo: 120 },
        [semPrazo]: { situacao: "executando", tentativas: 2, rodada: 2, prazo: 120 }
      });
    });
  });

  it("R-9 ACESSO DO CRIADOR = o predicado da RLS: criador sem acesso (escopo só em B, dono INATIVO, escopo só no financeiro, fora da organização) não tem item reservado — fica pendente, não conta vaga, e o laço segue", async () => {
    await limparFilaComitada();
    // Os sem acesso PRIMEIRO na ordem da fila; os com acesso depois.
    const criadores: [string, string, string, boolean][] = [
      ["só B, item em A", usuarioSoB, A, false],
      ["dono inativo", usuarioInativo, A, false],
      ["escopo só no financeiro", usuarioSemPecuaria, A, false],
      ["fora da organização", donoOutraOrg, A, false],
      ["dono ativo", demo.adminUserId, A, true],
      ["escopo todas na pecuária", usuarioTodas, A, true],
      ["só A, item em A", usuarioSoA, A, true],
      ["só B, item em B", usuarioSoB, B, true]
    ];
    const itens: { nome: string; criador: string; item: string; acesso: boolean }[] = [];
    for (const [k, [nome, criador, empresa, acesso]] of criadores.entries()) {
      const cq = await consulta(db, { empresa, criadoPor: criador });
      itens.push({ nome, criador, acesso, item: await item(db, { empresa, consulta: cq, area: empresa === A ? areaA : areaB, criadoHa: 900 - k * 10 }) });
    }
    try {
      // A VERDADE da RLS: o erp_app, com a GUC do criador e o módulo da área, enxerga o item?
      const rls: Record<string, boolean> = {};
      for (const i of itens) {
        rls[i.nome] = (await withTx(app, ctxPec(i.criador, demo.orgId), (tx) => tx.query("select 1 from erp.satelite_consulta_itens where id=$1", [i.item]))).rowCount === 1;
      }
      expect(rls, "premissa: a RLS dá acesso exatamente aos quatro últimos").toEqual(Object.fromEntries(itens.map((i) => [i.nome, i.acesso])));
      // Teto de 4 simultâneas: se os sem acesso contassem vaga, sobrariam menos de 4 para os com acesso.
      const r = await withTx(app, VAZIO, (tx) => reservar(tx, { simultaneas: 4 }));
      expect(ids(r)).toEqual(itens.filter((i) => i.acesso).map((i) => i.item));
      expect(Object.fromEntries(itens.map((i) => [i.nome, ids(r).includes(i.item)])), "a decisão da reserva É a da RLS").toEqual(rls);
      const e = await estado(db, itens.filter((i) => !i.acesso).map((i) => i.item));
      expect(Object.values(e).map((x) => [x.situacao, x.tentativas, x.rodada, x.prazo])).toEqual(itens.filter((i) => !i.acesso).map(() => ["pendente", 0, 0, null]));
      // Ganhou o acesso (escopo da pecuária em A para o membro do financeiro): o item dele passa a ser reservado.
      await db.query(
        `insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo)
         select organization_id, id, 'pecuaria', 'todas' from erp.organization_members where organization_id=$1 and user_id=$2`, [demo.orgId, usuarioSemPecuaria]);
      try {
        expect(ids(await withTx(app, VAZIO, (tx) => reservar(tx)))).toEqual([itens[2]!.item]);
      } finally {
        await db.query(
          `delete from erp.membro_escopos_empresa where modulo = 'pecuaria'
              and membro_id = (select id from erp.organization_members where organization_id=$1 and user_id=$2)`, [demo.orgId, usuarioSemPecuaria]);
      }
    } finally { await limparFilaComitada(); }
  });

  it("R-10 devolve as GUCs como estavam: a troca para o criador não vaza para o resto da transação (com GUC de outro tenant, vazia, e numa sessão que nunca a definiu)", async () => {
    await limparFilaComitada();
    const comAcesso = await consulta(db, { empresa: A, criadoPor: usuarioSoA });
    const semAcesso = await consulta(db, { empresa: A, criadoPor: usuarioSoB });
    const iSem = await item(db, { empresa: A, consulta: semAcesso, area: areaA, criadoHa: 20 });
    const iCom = await item(db, { empresa: A, consulta: comAcesso, area: areaA, criadoHa: 10 });
    try {
      // GUC de OUTRO tenant e de outro módulo: a reserva avalia os dois criadores (um nega, um passa) e devolve tudo.
      const outro = { orgId: outraOrg, userId: donoOutraOrg, modulo: "financeiro" };
      const r1 = await desfeita(app, async (c) => {
        const antes = (await c.query<Gucs>(GUCS)).rows[0]!;
        const r = await reservar(c);
        const depois = (await c.query<Gucs>(GUCS)).rows[0]!;
        // A RLS do resto da transação continua sendo a do tenant de entrada: nada da demo aparece.
        const daDemo = (await c.query("select 1 from erp.satelite_consulta_itens where organization_id=$1", [demo.orgId])).rowCount;
        return { antes, r, depois, daDemo };
      }, outro);
      expect(r1.antes).toEqual({ org: outraOrg, usuario: donoOutraOrg, modulo: "financeiro" });
      expect(ids(r1.r)).toEqual([iCom]);
      expect(r1.depois).toEqual(r1.antes);
      expect(r1.daDemo).toBe(0);
      // GUC vazia (o executor): volta vazia.
      const r2 = await desfeita(app, async (c) => ({ r: await reservar(c), gucs: (await c.query<Gucs>(GUCS)).rows[0]! }), VAZIO);
      expect(ids(r2.r)).toEqual([iCom]);
      expect(r2.gucs).toEqual({ org: "", usuario: "", modulo: "" });
      // Sessão NOVA, que nunca definiu as GUCs (nulas): voltam como texto vazio — que current_org_id/current_user_id/
      // modulo_empresa_atual leem como nulo, exatamente como antes (o comportamento declarado no cabeçalho da 0054).
      const fresca = createPool(URL_APP, { max: 1 });
      try {
        const r3 = await desfeita(fresca, async (c) => {
          const antes = (await c.query<Gucs & { o: string | null; u: string | null; m: string | null }>(
            `${GUCS}, erp.current_org_id()::text o, erp.current_user_id()::text u, erp.modulo_empresa_atual() m`)).rows[0]!;
          const r = await reservar(c);
          const depois = (await c.query<Gucs & { o: string | null; u: string | null; m: string | null }>(
            `${GUCS}, erp.current_org_id()::text o, erp.current_user_id()::text u, erp.modulo_empresa_atual() m`)).rows[0]!;
          return { antes, r, depois };
        });
        expect(r3.antes).toEqual({ org: null, usuario: null, modulo: null, o: null, u: null, m: null });
        expect(ids(r3.r)).toEqual([iCom]);
        expect(r3.depois).toEqual({ org: "", usuario: "", modulo: "", o: null, u: null, m: null });
      } finally { await fresca.end(); }
      expect((await estado(db, [iSem, iCom]))[iCom]!.situacao, "tudo desfeito").toBe("pendente");
    } finally { await limparFilaComitada(); }
  });

  it("R-11 parâmetro fora da faixa → 22023 com o nome dele (nunca 'nada a reservar'); fora de READ COMMITTED → 25000; os limites da faixa valem", async () => {
    const casos: [Tetos, string][] = [
      [{ limite: 0 }, "p_limite"], [{ limite: 51 }, "p_limite"],
      [{ simultaneas: 0 }, "p_max_simultaneas"], [{ minutoConta: 0 }, "p_max_minuto_conta"], [{ minutoOrg: -1 }, "p_max_minuto_org"],
      [{ prazo: 59 }, "p_prazo_segundos"], [{ prazo: 86_401 }, "p_prazo_segundos"]
    ];
    for (const [t, nome] of casos) {
      const e = await erroDe(withTx(app, VAZIO, (tx) => reservar(tx, t)));
      expect([JSON.stringify(t), e.code, e.message.startsWith(`SAT-03: ${nome} `)]).toEqual([JSON.stringify(t), "22023", true]);
    }
    for (const posicao of [0, 1, 2, 3, 4]) {
      const args: (number | null)[] = [1, 1, 1, 1, 60];
      args[posicao] = null;
      const e = await erroDe(withTx(app, VAZIO, (tx) => tx.query("select * from erp.satelite_reservar_itens($1, $2, $3, $4, $5)", args)));
      expect([posicao, e.code, /\(recebido: nulo\)\.$/.test(e.message)]).toEqual([posicao, "22023", true]);
    }
    for (const nivel of ["repeatable read", "serializable"]) {
      const c = await app.connect();
      try {
        await c.query(`begin isolation level ${nivel}`);
        const e = await erroDe(reservar(c));
        expect([nivel, e.code, e.message]).toEqual([nivel, "25000", `SAT-03: erp.satelite_reservar_itens exige READ COMMITTED (a transacao esta em ${nivel}).`]);
      } finally { await c.query("rollback").catch(() => {}); c.release(); }
    }
    await cenario(async (c) => {
      expect((await reservar(c, { limite: 1, simultaneas: 1, minutoConta: 1, minutoOrg: 1, prazo: 60 })).rowCount).toBe(0);
      expect((await reservar(c, { limite: 50, prazo: 86_400 })).rowCount).toBe(0);
    });
  });
});

describe("DB-6 — CONCORRÊNCIA: uma reserva por vez, nunca o mesmo item duas vezes, e o item travado por outro não trava a fila", () => {
  async function semear(n: number) {
    await limparFilaComitada();
    const cq = await consulta(db, { empresa: A });
    const lista: string[] = [];
    for (let k = 0; k < n; k++) lista.push(await item(db, { empresa: A, consulta: cq, area: areaA, criadoHa: 1000 - k }));
    return lista;
  }

  it("C-1 com a trava da reserva (2026, 88001) ocupada por outra sessão: devolve VAZIO na hora, sem tocar em nada; solta, reserva", async () => {
    const lista = await semear(3);
    const dono = await db.connect();
    try {
      await dono.query("select pg_advisory_lock(2026, 88001)");
      const inicio = Date.now();
      expect(ids(await withTx(app, VAZIO, (tx) => reservar(tx)))).toEqual([]);
      expect(Date.now() - inicio, "não esperou a trava").toBeLessThan(5_000);
      expect(Object.values(await estado(db, lista)).map((e) => e.situacao)).toEqual(["pendente", "pendente", "pendente"]);
    } finally { await dono.query("select pg_advisory_unlock(2026, 88001)").catch(() => {}); dono.release(); }
    try {
      expect(ids(await withTx(app, VAZIO, (tx) => reservar(tx)))).toEqual(lista);
    } finally { await limparFilaComitada(); }
  });

  it("C-2 duas conexões AO MESMO TEMPO: com a primeira reservando (transação aberta), a segunda devolve vazio; depois do commit, a segunda leva o RESTO — nunca o mesmo item", async () => {
    const lista = await semear(5);
    const c1 = await app.connect(); const c2 = await app.connect();
    try {
      await c1.query("begin");
      const r1 = ids(await reservar(c1, { limite: 2 }));
      expect(r1).toEqual(lista.slice(0, 2));
      expect(ids(await reservar(c2)), "trava ocupada pela primeira").toEqual([]);
      await c1.query("commit");
      const r2 = ids(await reservar(c2));
      expect(r2).toEqual(lista.slice(2));
      expect(r1.filter((x) => r2.includes(x))).toEqual([]);
      expect(Object.values(await estado(db, lista)).map((e) => [e.situacao, e.tentativas])).toEqual(lista.map(() => ["executando", 1]));
    } finally {
      await c1.query("rollback").catch(() => {}); c1.release(); c2.release();
      await limparFilaComitada();
    }
  });

  it("C-3 seis chamadas SIMULTÂNEAS (cada uma na sua transação): nenhum item sai duas vezes, e cada reservado tem UMA tentativa", async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const lista = await semear(12);
      try {
        const resultados = await Promise.all(Array.from({ length: 6 }, () => withTx(app, VAZIO, (tx) => reservar(tx, { limite: 3 }))));
        const todos = resultados.flatMap(ids);
        expect(todos.length, `rodada ${rodada}: alguém reservou`).toBeGreaterThan(0);
        expect(new Set(todos).size, `rodada ${rodada}: nenhum repetido`).toBe(todos.length);
        const e = await estado(db, lista);
        expect(lista.filter((i) => e[i]!.situacao === "executando").sort()).toEqual([...todos].sort());
        expect(todos.every((i) => e[i]!.tentativas === 1 && e[i]!.rodada === 1)).toBe(true);
      } finally { await limparFilaComitada(); }
    }
  });

  it("C-4 SKIP LOCKED: o item que outra transação travou não é esperado nem tocado — a reserva leva o seguinte; o vencido travado não é recuperado", async () => {
    const lista = await semear(3);
    const cq = await consulta(db, { empresa: A });
    const vencidoTravado = await item(db, { empresa: A, consulta: cq, area: areaA, situacao: "executando", tentativas: 1, rodada: 1, proxima: -60, criadoHa: 2000 });
    const outra = await db.connect();
    try {
      await outra.query("begin");
      await outra.query("select id from erp.satelite_consulta_itens where id = any($1::uuid[]) for update", [[lista[0], vencidoTravado]]);
      const inicio = Date.now();
      const r = await withTx(app, VAZIO, async (tx) => {
        await tx.query("set local statement_timeout = '5s'");
        return reservar(tx, { limite: 1 });
      });
      expect(ids(r), "o primeiro está travado por outra transação: vai o segundo").toEqual([lista[1]]);
      expect(Date.now() - inicio, "não esperou a trava de linha").toBeLessThan(5_000);
      const e = await estado(db, [lista[0]!, vencidoTravado]);
      expect(e[lista[0]!]).toMatchObject({ situacao: "pendente", tentativas: 0 });
      expect(e[vencidoTravado]).toMatchObject({ situacao: "executando", tentativas: 1 });
    } finally {
      await outra.query("rollback").catch(() => {}); outra.release();
      await limparFilaComitada();
    }
  });
});

describe("DB-7 — a CONTAGEM erp.satelite_contar_chamadas", () => {
  it("números certos (ledger do último minuto e executando, global e da organização da GUC); sem GUC, os da organização são 0", async () => {
    await cenario(async (c) => {
      const direto = async (org: string | null) => (await c.query<{ m: number; e: number }>(
        `select (select count(*)::int from erp.satelite_consumo where ($1::uuid is null or organization_id = $1) and created_at > now() - interval '60 seconds') m,
                (select count(*)::int from erp.satelite_consulta_itens where ($1::uuid is null or organization_id = $1) and situacao = 'executando') e`, [org])).rows[0]!;
      for (const ha of [1, 20]) await inserirConsumo(c, { org: terceiraOrg, empresa: empresaY, criadoHa: ha });
      await inserirConsumo(c, { org: terceiraOrg, empresa: empresaY, criadoHa: 60 });
      await inserirConsumo(c, { org: outraOrg, empresa: empresaX, criadoHa: 1 });
      const cY = await consulta(c, { org: terceiraOrg, empresa: empresaY, criadoPor: donoTerceira });
      const cX = await consulta(c, { org: outraOrg, empresa: empresaX, criadoPor: donoOutraOrg });
      await item(c, { org: terceiraOrg, empresa: empresaY, consulta: cY, area: areaY, situacao: "executando", tentativas: 1, rodada: 1, proxima: 600 });
      for (let k = 0; k < 2; k++) await item(c, { org: outraOrg, empresa: empresaX, consulta: cX, area: areaX, situacao: "executando", tentativas: 1, rodada: 1, proxima: 600 });
      await item(c, { org: outraOrg, empresa: empresaX, consulta: cX, area: areaX });
      const global = await direto(null);
      const semGuc = await c.query<Contagem>("select * from erp.satelite_contar_chamadas()");
      expect(semGuc.fields.map((f) => f.name)).toEqual(COLUNAS_CONTAGEM);
      expect(semGuc.rows).toEqual([{ conta_minuto: global.m, conta_executando: 3, org_minuto: 0, org_executando: 0 }]);
      await c.query("select set_config('app.org_id', $1, true)", [terceiraOrg]);
      expect(await direto(terceiraOrg)).toEqual({ m: 2, e: 1 });
      expect(await contar(c)).toEqual({ conta_minuto: global.m, conta_executando: 3, org_minuto: 2, org_executando: 1 });
      await c.query("select set_config('app.org_id', $1, true)", [outraOrg]);
      expect(await contar(c)).toEqual({ conta_minuto: global.m, conta_executando: 3, org_minuto: 1, org_executando: 2 });
    });
  });

  it("como a rota (erp_app sob RLS, GUC da organização): a organização vem da GUC — a de outra organização não entra; sem GUC, 0", async () => {
    await limparFilaComitada();
    for (let k = 0; k < 3; k++) await inserirConsumo(db, { org: quartaOrg, empresa: empresaZ });
    const cZ = await consulta(db, { org: quartaOrg, empresa: empresaZ, criadoPor: donoQuarta });
    await item(db, { org: quartaOrg, empresa: empresaZ, consulta: cZ, area: areaZ, situacao: "executando", tentativas: 1, rodada: 1, proxima: 600 });
    try {
      const naQuarta = await withTx(app, ctxPec(donoQuarta, quartaOrg), (tx) => contar(tx));
      expect(naQuarta).toMatchObject({ org_minuto: 3, org_executando: 1 });
      expect(naQuarta.conta_minuto).toBeGreaterThanOrEqual(3);
      expect(naQuarta.conta_executando).toBe(1);
      const naOutra = await withTx(app, ctxPec(donoOutraOrg, outraOrg), (tx) => contar(tx));
      expect(naOutra).toMatchObject({ org_minuto: 0, org_executando: 0, conta_executando: 1 });
      expect(await withTx(app, VAZIO, (tx) => contar(tx))).toMatchObject({ org_minuto: 0, org_executando: 0, conta_executando: 1 });
    } finally { await limparFilaComitada(); }
  });
});

describe("DB-8 — quem executa as portas: só o dono e o erp_app", () => {
  it("PUBLIC, authenticated e anon sem EXECUTE; erp_app com; nenhum outro papel na ACL; quem não tem recebe 42501", async () => {
    const priv = (await db.query<{ f: string; papel: string; pode: boolean }>(
      `select f, papel, has_function_privilege(papel, f, 'execute') pode
         from unnest($1::text[]) f cross join unnest(array['public', 'erp_app', 'authenticated', 'anon']) papel order by f, papel`, [[RESERVAR, CONTAR]])).rows;
    expect(priv.map((p) => `${p.f} ${p.papel}=${p.pode}`)).toEqual([CONTAR, RESERVAR].sort().flatMap((f) =>
      ["anon", "authenticated", "erp_app", "public"].map((papel) => `${f} ${papel}=${papel === "erp_app"}`)));
    const acl = (await db.query<{ g: string }>(
      `select p.proname || ' -> ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end g
         from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid in ($1::regprocedure, $2::regprocedure) and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner order by 1`, [RESERVAR, CONTAR])).rows.map((r) => r.g);
    expect(acl).toEqual(["satelite_contar_chamadas -> erp_app", "satelite_reservar_itens -> erp_app"]);
    for (const papel of ["authenticated", "anon"]) {
      for (const chamada of ["select * from erp.satelite_reservar_itens(1, 1, 1, 1, 60)", "select * from erp.satelite_contar_chamadas()"]) {
        const e = await desfeita(db, async (c) => { await c.query(`set local role ${papel}`); return erroDe(c.query(chamada)); });
        expect([papel, chamada, e.code]).toEqual([papel, chamada, "42501"]);
      }
    }
  });

  it("SECURITY DEFINER, search_path fixo, volatilidade, dono que atravessa RLS, assinatura e retorno do contrato; sem SQL dinâmico na reserva", async () => {
    const f = (await db.query<{ f: string; secdef: boolean; volatil: string; config: string[]; atravessa: boolean; args: string; ret: string; dinamico: boolean }>(
      `select p.proname f, p.prosecdef secdef, p.provolatile::text volatil, p.proconfig config, (r.rolsuper or r.rolbypassrls) atravessa,
              pg_get_function_arguments(p.oid) args, pg_get_function_result(p.oid) ret, p.prosrc ~* '\\mexecute\\M' dinamico
         from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid in ($1::regprocedure, $2::regprocedure) order by 1`, [RESERVAR, CONTAR])).rows;
    expect(f).toEqual([
      { f: "satelite_contar_chamadas", secdef: true, volatil: "s", config: ["search_path=erp, pg_temp"], atravessa: true, args: "",
        ret: "TABLE(conta_minuto integer, conta_executando integer, org_minuto integer, org_executando integer)", dinamico: false },
      { f: "satelite_reservar_itens", secdef: true, volatil: "v", config: ["search_path=erp, pg_temp"], atravessa: true,
        args: "p_limite integer, p_max_simultaneas integer, p_max_minuto_conta integer, p_max_minuto_org integer, p_prazo_segundos integer",
        ret: "TABLE(organization_id uuid, empresa_id uuid, consulta_id uuid, item_id uuid, criado_por uuid)", dinamico: false }
    ]);
  });
});

describe("DB-9 — a 0054 DESCE pelo SQL reverso e SOBE de novo", () => {
  it("FAIL-CLOSED: com uma linha de PU desconhecido no ledger (só a 0054 permite), a volta para inteira (23502) e nada muda", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      await inserirConsumo(c, { empresa: A, pu: null, creditos: null, origem: "cabecalho_ausente" });
      const e = await erroDe(c.query(SQL_REVERSO));
      expect([e.code, /column "creditos" of relation "satelite_consumo" contains null values/.test(e.message)]).toEqual(["23502", true]);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0054);
  });

  it("o SQL reverso volta o catálogo EXATAMENTE ao da 0053 (com linhas na fila e no ledger); os dados das colunas de antes não mudam", async () => {
    // Premissa: o retrato distingue os dois estados, e há dados nas tabelas tocadas.
    expect(catalogo0054).not.toEqual(catalogo0053);
    expect(Object.keys(catalogo0054.colunas!).filter((k) => !(k in catalogo0053.colunas!))).toEqual(["satelite_consulta_itens.tentativas_rodada"]);
    expect(Object.keys(catalogo0053.colunas!).length).toBeGreaterThan(1000);
    expect((await db.query("select 1 from erp.satelite_consulta_itens")).rowCount).toBeGreaterThan(10);
    expect((await db.query("select 1 from erp.satelite_consumo")).rowCount).toBeGreaterThan(2);
    const colunas = await colunasPorTabela();
    const projecao = { satelite_consulta_itens: colunas0053.satelite_consulta_itens!, satelite_consumo: colunas.satelite_consumo! };
    const antes = await retratoDados(projecao);

    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(SQL_REVERSO);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally { c.release(); }

    expect(await retratoCatalogo()).toEqual(catalogo0053);
    expect((await db.query<{ name: string }>("select name from public.erp_migrations order by name")).rows.map((r) => r.name)).toEqual(ANTERIORES.map((m) => m.name));
    expect(await retratoDados(projecao)).toEqual(antes);
  });

  it("a 0054 é REAPLICADA em seguida — com um POST da SAT-02 no meio (fila já lida, ledger por ler), SEM impasse — e o catálogo fica igual ao da primeira aplicação", async () => {
    // O POST da SAT-02 lê a fila (chaves vivas) e DEPOIS o ledger (saldo do mês) na mesma transação. A migration trava na
    // mesma ordem: enquanto ela espera a fila, o ledger continua livre para o POST terminar. Na ordem inversa, ela já
    // seguraria o ledger, o POST pararia nele e o detector de impasse abortaria um dos dois.
    const post = await db.connect();
    try {
      await post.query("begin");
      await post.query("set local statement_timeout = '1500ms'");
      const pidPost = (await post.query<{ p: number }>("select pg_backend_pid() p")).rows[0]!.p;
      await post.query("select count(*) from erp.satelite_consulta_itens");
      const migracao = aplicarComoORunner().then(() => "aplicada", (e: Error) => e.message);
      let esperando = false;
      for (let k = 0; k < 30 && !esperando; k++) {
        await new Promise((r) => setTimeout(r, 50));
        esperando = (await db.query(
          "select 1 from pg_locks where relation = 'erp.satelite_consulta_itens'::regclass and not granted and pid <> $1", [pidPost])).rowCount! > 0;
      }
      expect(esperando, "premissa: a migration está esperando a fila que o POST leu").toBe(true);
      await post.query("select coalesce(sum(creditos), 0) from erp.satelite_consumo");
      await post.query("commit");
      expect(await migracao).toBe("aplicada");
    } finally { await post.query("rollback").catch(() => {}); post.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0054);
    expect((await db.query("select 1 from erp.satelite_consulta_itens where tentativas_rodada <> 0")).rowCount, "a rodada renasce em 0").toBe(0);
  });
});
