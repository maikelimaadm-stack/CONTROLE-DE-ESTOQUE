import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, migrate } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * A ORDEM REAL DE PRODUÇÃO: 0001..0041 → 0049 → 0042..0048, PROVADA IGUAL À ORDEM POR NÚMERO (OPERACOES-01, PR #90).
 *
 * O fato (03/10): a 0049 (MAPA-01, #91) entrou em produção ANTES desta PR. O ledger de produção tem 42 nomes —
 * 0001..0041 e a 0049. As migrations desta PR (0042..0047, e a 0048 quando entrar) rodam DEPOIS dela, embora o número
 * seja menor. O runner (`packages/db/src/migrate.ts`) aplica por NOME, na ordem do nome, e PULA o que o ledger já tem:
 * no deploy da PR ele vê 0042..0048 pendentes e as aplica, uma transação por arquivo, por cima de um banco que já tem
 * a 0049. Nenhum banco de teste do repositório passa por esse caminho — todos sobem na ordem do número.
 *
 * Dois bancos efêmeros, irmãos do banco de teste (mesmo servidor, nomes derivados de TEST_DATABASE_URL), criados e
 * apagados aqui. Nada de produção.
 *   · BANCO A (ORDEM REAL): 0001..0041 e a 0049 como o runner aplica (o MESMO corpo do laço dele: uma conexão, begin,
 *     o arquivo inteiro, a linha no ledger `public.erp_migrations`, commit) — o ledger de 03/10; depois o `migrate()`
 *     DE VERDADE, que pula as 42 e aplica as pendentes do disco na ordem do nome (as 0042..0048 que existirem; a
 *     lista sai do `listMigrations`, nunca escrita à mão — a 0048 entra sozinha quando chegar).
 *   · BANCO B (ORDEM POR NÚMERO): o `migrate()` de verdade num banco novo (o que o runner faz no CI e num ambiente
 *     novo).
 * Os dois rodam com o papel de TEST_DATABASE_URL (o mesmo nos dois; no CI, o superusuário do serviço).
 * Se outra migration entrar em PRODUÇÃO antes desta PR, ela vai para LEDGER_PRODUCAO: o fato muda, o teste muda junto.
 *
 * O que se prova (premissa junto da conclusão):
 *   OR-0 o disco: 0001..0041 contíguas, a 0049, as da PR (0042..0047 no mínimo); cada uma da PR e a 0049 trazem a
 *        trava, as pré-condições e as pós-condições DENTRO do arquivo (é o que faz "aplicou" significar "conferiu");
 *   OR-1 A depois da fase 1 = o ledger de produção (42 nomes), com a 0049 viva e NENHUM objeto da PR;
 *   OR-2 A depois do runner: cada pendente aplicou sem erro — as pré-condições passaram e as pós-condições não
 *        abortaram —, na ordem do nome, e o ledger final tem exatamente os nomes do disco, na ordem real;
 *   OR-3 B: o runner aplica todas na ordem do nome; o ledger = o disco;
 *   OR-4 premissa do retrato: não vazio nos dois, e com objetos das duas origens (a 0049 e cada uma da PR);
 *   OR-5 o RETRATO DO CATÁLOGO de A é IGUAL ao de B (a diferença, se houver, sai por seção, chave e os dois valores).
 *
 * O retrato (por seção; cada linha tem CHAVE e VALOR, e a diferença diz a seção, a chave e os dois valores):
 *   relações do schema erp (tipo, RLS habilitada/forçada, opções, dono) · colunas (tipo, nulidade, default,
 *   identidade, gerada, collation) · restrições (pg_get_constraintdef) · índices (pg_get_indexdef, válido) ·
 *   funções (assinatura, retorno, linguagem, volatilidade, strict, SECURITY DEFINER, leakproof, paralelo,
 *   proconfig, dono, md5 do corpo) · gatilhos (pg_get_triggerdef, habilitado) · políticas (permissiva, comando,
 *   papéis, USING, WITH CHECK) · views (md5 da definição) · regras · tipos (enum, domínio, composto) · sequências ·
 *   privilégios de relação, de coluna, de função, do schema e os padrões (pg_default_acl), para TODOS os papéis ·
 *   comentários (md5) · extensões · esquemas · o CONTEÚDO de toda tabela do erp (linhas e md5 das linhas, sem as
 *   colunas uuid e de data/hora, que nascem aleatórias) · erp.modulos_escopo_empresa linha a linha · os NOMES do
 *   ledger public.erp_migrations (a hora não: ela é justamente o que difere).
 * Fora do retrato, de propósito: a POSIÇÃO física da coluna (attnum) — ela segue a ordem do ALTER TABLE e não é
 * contrato de nada; OIDs; e o que é do cluster (papéis), que é o mesmo servidor nos dois.
 */

interface Migration { name: string; sql: string }
type Secao = Record<string, string>;
type Retrato = Record<string, Secao>;
interface Diferenca { soNaOrdemReal: Secao; soNaOrdemPorNumero: Secao; diferentes: Record<string, { ordemReal: string; ordemPorNumero: string }> }

const MAPA = "0049_mapa_de_manejo.sql";
const TODAS: Migration[] = listMigrations();
const NOMES = TODAS.map((m) => m.name);
/** 0001..0041: o que produção tinha antes da 0049. */
const ANTES_DA_PR = TODAS.filter((m) => m.name < "0042");
/** As desta PR no disco (0042..0048 as que existirem). */
const DA_PR = TODAS.filter((m) => m.name >= "0042" && m.name < "0049");
/** O ledger de produção em 03/10: 0001..0041 + a 0049, nesta ordem. */
const LEDGER_PRODUCAO: Migration[] = [...ANTES_DA_PR, ...TODAS.filter((m) => m.name === MAPA)];
const NOMES_PRODUCAO = new Set(LEDGER_PRODUCAO.map((m) => m.name));
/** O que o runner ainda tem de aplicar no banco de produção: o disco menos o ledger, na ordem do nome. */
const PENDENTES_EM_PRODUCAO = NOMES.filter((n) => !NOMES_PRODUCAO.has(n));

// ---------- os dois bancos efêmeros ----------
const urlBase = new URL(TEST_URL);
const nomeBase = urlBase.pathname.replace(/^\//, "");
const NOME_A = `${nomeBase}_ordem_real`;
const NOME_B = `${nomeBase}_ordem_numero`;
const urlDe = (nome: string) => { const u = new URL(TEST_URL); u.pathname = `/${nome}`; return u.toString(); };

let admin: Db; let dbA: Db; let dbB: Db;

/** Fase 1 do banco A: o arquivo como o runner o aplica (o corpo do laço do `migrate()`, sem tirar nem pôr). */
async function aplicarComoORunner(db: Db, m: Migration): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
  } finally { c.release(); }
}

async function recriarBanco(nome: string): Promise<void> {
  // O nome vem de TEST_DATABASE_URL (configuração do teste), nunca de entrada de usuário; ainda assim, só [a-z0-9_].
  if (!/^[a-z0-9_]{1,63}$/.test(nome)) throw new Error(`nome de banco efêmero fora do padrão: ${nome}`);
  await admin.query(`drop database if exists ${nome} with (force)`);
  await admin.query(`create database ${nome}`);
}

// ---------- o retrato do catálogo ----------
const GRANTEE = "case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end";
/** Cada consulta devolve (k, v): a chave do objeto e o que dele se compara. Tudo lido do catálogo, sem entrada. */
const CONSULTAS: Record<string, string> = {
  relacoes: `
    select c.relname k,
           'tipo=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' forcada=' || c.relforcerowsecurity
             || ' opcoes=' || coalesce(array_to_string(c.reloptions, ','), '') || ' dono=' || pg_get_userbyid(c.relowner) v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')`,
  colunas: `
    select c.relname || '.' || a.attname k,
           format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' not null' else '' end
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
             || case when a.attidentity <> '' then ' identity=' || a.attidentity::text else '' end
             || case when a.attgenerated <> '' then ' gerada=' || a.attgenerated::text else '' end
             || case when co.collname is not null and co.collname <> 'default' then ' collate=' || co.collname else '' end v
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join pg_collation co on co.oid = a.attcollation
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c') and a.attnum > 0 and not a.attisdropped`,
  restricoes: `
    select coalesce(c.relname, t.typname) || '.' || k.conname k, k.contype::text || ' ' || pg_get_constraintdef(k.oid) v
      from pg_constraint k
      join pg_namespace n on n.oid = k.connamespace
      left join pg_class c on c.oid = k.conrelid
      left join pg_type t on t.oid = k.contypid
     where n.nspname = 'erp'`,
  indices: `
    select ci.relname k, pg_get_indexdef(i.indexrelid) || ' valido=' || i.indisvalid v
      from pg_index i join pg_class ci on ci.oid = i.indexrelid join pg_namespace n on n.oid = ci.relnamespace
     where n.nspname = 'erp'`,
  funcoes: `
    select p.oid::regprocedure::text k,
           'tipo=' || p.prokind::text || ' retorno=' || coalesce(pg_get_function_result(p.oid), '-') || ' lang=' || l.lanname
             || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' secdef=' || p.prosecdef
             || ' leakproof=' || p.proleakproof || ' paralelo=' || p.proparallel::text
             || ' config=' || coalesce(array_to_string(p.proconfig, ','), '') || ' dono=' || pg_get_userbyid(p.proowner)
             || ' md5=' || md5(p.prosrc) v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname = 'erp'`,
  gatilhos: `
    select c.relname || '.' || t.tgname k, pg_get_triggerdef(t.oid) || ' habilitado=' || t.tgenabled::text v
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and not t.tgisinternal`,
  politicas: `
    select tablename || '.' || policyname k,
           permissive || ' ' || cmd || ' para ' || array_to_string(roles, ',')
             || ' using ' || coalesce(qual, '-') || ' check ' || coalesce(with_check, '-') v
      from pg_policies where schemaname = 'erp'`,
  views: `
    select c.relname k, md5(pg_get_viewdef(c.oid)) v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind in ('v', 'm')`,
  regras: `select tablename || '.' || rulename k, definition v from pg_rules where schemaname = 'erp'`,
  tipos: `
    select t.typname k,
           t.typtype::text || ' ' || case t.typtype
             when 'e' then (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
             when 'd' then format_type(t.typbasetype, t.typtypmod) || ' notnull=' || t.typnotnull || coalesce(' default ' || t.typdefault, '')
             else '' end v
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'erp' and t.typtype in ('e', 'd', 'c', 'r', 'm')
       and (t.typtype <> 'c' or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')`,
  sequencias: `
    select sequencename k,
           data_type::text || ' inicio=' || start_value || ' passo=' || increment_by || ' min=' || min_value
             || ' max=' || max_value || ' ciclo=' || cycle || ' cache=' || cache_size v
      from pg_sequences where schemaname = 'erp'`,
  privilegios_relacoes: `
    select c.relname || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type || ' | por ' || pg_get_userbyid(a.grantor) k,
           'concede=' || a.is_grantable v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
  privilegios_colunas: `
    select c.relname || '.' || at.attname || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type || ' | por ' || pg_get_userbyid(a.grantor) k,
           'concede=' || a.is_grantable v
      from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(at.attacl) a
     where n.nspname = 'erp' and at.attacl is not null and at.attnum > 0 and not at.attisdropped`,
  privilegios_funcoes: `
    select p.oid::regprocedure::text || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type || ' | por ' || pg_get_userbyid(a.grantor) k,
           'concede=' || a.is_grantable v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'`,
  privilegios_schema: `
    select 'schema erp | ' || ${GRANTEE} || ' | ' || a.privilege_type || ' | por ' || pg_get_userbyid(a.grantor) k,
           'concede=' || a.is_grantable v
      from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
     where n.nspname = 'erp'
    union all
    select 'padrao ' || d.defaclobjtype::text || ' de ' || pg_get_userbyid(d.defaclrole) || ' | ' || ${GRANTEE} || ' | ' || a.privilege_type k,
           'concede=' || a.is_grantable v
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
     where d.defaclnamespace = 'erp'::regnamespace`,
  comentarios: `
    select o.type || ' | ' || o.identity k, md5(d.description) v
      from pg_description d cross join lateral pg_identify_object(d.classoid, d.objoid, d.objsubid) o
     where o.schema = 'erp' or (o.schema is null and (o.identity = 'erp' or o.identity like '% on erp.%'))`,
  extensoes: `select extname k, extversion || ' em ' || extnamespace::regnamespace::text v from pg_extension`,
  esquemas: `
    select nspname k, 'dono=' || pg_get_userbyid(nspowner) v
      from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'`,
  modulos_escopo_empresa: `select chave k, nome || ' | ordem ' || ordem v from erp.modulos_escopo_empresa`,
  ledger: `select name k, '' v from public.erp_migrations`
};

function secaoDe(nome: string, linhas: { k: string; v: string }[]): Secao {
  const s: Secao = {};
  for (const { k, v } of linhas) {
    if (k in s) throw new Error(`retrato: chave repetida na seção ${nome}: ${k}`);
    s[k] = v;
  }
  return s;
}

/** O conteúdo de TODA tabela do erp: linhas e md5 das linhas ordenadas (sem colunas uuid e de data/hora). */
async function dadosDasTabelas(db: Db): Promise<Secao> {
  const tabelas = (await db.query<{ tabela: string; ident: string; projecao: string }>(`
    select c.relname tabela, quote_ident(c.relname) ident,
           coalesce('row(' || string_agg(quote_ident(a.attname), ', ' order by a.attnum) || ')', '''''') projecao
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                              and a.atttypid not in ('uuid'::regtype, 'timestamptz'::regtype, 'timestamp'::regtype)
     where n.nspname = 'erp' and c.relkind in ('r', 'p')
     group by c.relname`)).rows;
  const s: Secao = {};
  for (const t of tabelas) {
    const r = (await db.query<{ n: string; h: string }>(
      `select count(*)::text n, md5(coalesce(string_agg(x, chr(10) order by x), '')) h from (select (${t.projecao})::text x from erp.${t.ident}) s`)).rows[0]!;
    s[t.tabela] = `linhas=${r.n} md5=${r.h}`;
  }
  return s;
}

async function retrato(db: Db): Promise<Retrato> {
  const r: Retrato = {};
  for (const [nome, sql] of Object.entries(CONSULTAS)) {
    try { r[nome] = secaoDe(nome, (await db.query<{ k: string; v: string }>(sql)).rows); }
    catch (e) { throw new Error(`retrato, seção ${nome}: ${(e as Error).message}`); }
  }
  r.dados = await dadosDasTabelas(db);
  return r;
}

/** Só as seções que diferem, e nelas só as chaves que diferem (com os dois valores). Igual = {}. */
function diferencas(a: Retrato, b: Retrato): Record<string, Diferenca> {
  const out: Record<string, Diferenca> = {};
  for (const nome of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const sa = a[nome] ?? {}; const sb = b[nome] ?? {};
    const d: Diferenca = { soNaOrdemReal: {}, soNaOrdemPorNumero: {}, diferentes: {} };
    for (const [k, v] of Object.entries(sa)) {
      if (!(k in sb)) d.soNaOrdemReal[k] = v;
      else if (sb[k] !== v) d.diferentes[k] = { ordemReal: v, ordemPorNumero: sb[k]! };
    }
    for (const [k, v] of Object.entries(sb)) if (!(k in sa)) d.soNaOrdemPorNumero[k] = v;
    if (Object.keys(d.soNaOrdemReal).length + Object.keys(d.soNaOrdemPorNumero).length + Object.keys(d.diferentes).length > 0) out[nome] = d;
  }
  return out;
}

// ---------- o que cada fase deixou (montado uma vez; cada caso só lê) ----------
interface EstadoFase1 { ledger: string[]; mapaAreas: string | null; moduloMapa: number; objetosDaPr: (string | null)[] }
let estadoFase1: EstadoFase1;
let aplicadasA: string[] = []; const logA: string[] = []; let falhaA: string | undefined;
let aplicadasB: string[] = []; const logB: string[] = []; let falhaB: string | undefined;
let ledgerA: string[] = []; let ledgerB: string[] = [];
let retratoA: Retrato; let retratoB: Retrato;

/** O ledger na ordem em que as linhas entraram (applied_at é o now() da transação de cada arquivo). */
const ledgerNaOrdem = async (db: Db) =>
  (await db.query<{ name: string }>("select name from public.erp_migrations order by applied_at, name")).rows.map((r) => r.name);

beforeAll(async () => {
  admin = createPool(TEST_URL, { max: 1 });
  await recriarBanco(NOME_A);
  await recriarBanco(NOME_B);
  dbA = createPool(urlDe(NOME_A), { max: 3 });
  dbB = createPool(urlDe(NOME_B), { max: 3 });

  // BANCO A, fase 1 — o ledger de produção de 03/10.
  await dbA.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of LEDGER_PRODUCAO) await aplicarComoORunner(dbA, m);
  estadoFase1 = {
    ledger: await ledgerNaOrdem(dbA),
    ...(await dbA.query<{ mapaAreas: string | null; moduloMapa: number }>(
      `select to_regclass('erp.mapa_areas')::text "mapaAreas", (select count(*)::int from erp.modulos_escopo_empresa where chave = 'mapa') "moduloMapa"`)).rows[0]!,
    objetosDaPr: Object.values((await dbA.query<Record<string, string | null>>(
      `select to_regclass('erp.financeiro_naturezas_padrao')::text a, to_regprocedure('erp.documentos_estoque_item_origem_guarda()')::text b,
              to_regprocedure('erp.documentos_compra_finalizacao_guarda()')::text c, to_regclass('erp.imoveis_rurais')::text d,
              to_regprocedure('erp.modulo_top_conferir()')::text e, to_regclass('erp.notas_fiscais_xml')::text f`)).rows[0]!)
  };

  // BANCO A, fase 2 — o deploy da PR: o runner de verdade sobre o banco de produção.
  try { aplicadasA = await migrate(dbA, (m) => logA.push(m)); } catch (e) { falhaA = (e as Error).message; }
  ledgerA = await ledgerNaOrdem(dbA);

  // BANCO B — o runner num banco novo: tudo na ordem do número.
  try { aplicadasB = await migrate(dbB, (m) => logB.push(m)); } catch (e) { falhaB = (e as Error).message; }
  ledgerB = await ledgerNaOrdem(dbB);

  retratoA = await retrato(dbA);
  retratoB = await retrato(dbB);
}, 600_000);

afterAll(async () => {
  await dbA?.end(); await dbB?.end();
  if (admin) {
    for (const nome of [NOME_A, NOME_B]) await admin.query(`drop database if exists ${nome} with (force)`);
    await admin.end();
  }
});

/** Um arquivo de migration traz a trava, as pré-condições e as pós-condições — cada seção com o seu raise. */
function guardasDoArquivo(sql: string) {
  const depoisDe = (re: RegExp) => { const m = re.exec(sql); return m !== null && sql.indexOf("raise exception", m.index) > m.index; };
  return {
    trava: /pg_try_advisory_xact_lock\(\s*2026\s*,\s*\d+\s*\)/.test(sql),
    preCondicoes: depoisDe(/^--\s*(?:-+\s*)?\d+[.)]\s*(?:pr[ée]-condi[çc][õo]es|preflight)/im),
    posCondicoes: depoisDe(/^--\s*(?:-+\s*)?\d+[.)]\s*p[óo]s-condi[çc][õo]es/im)
  };
}

describe("ORDEM REAL de produção (0001..0041 → 0049 → 0042..0048) igual à ORDEM POR NÚMERO", () => {
  it("OR-0 PREMISSA do disco: 0001..0041 contíguas, a 0049, as da PR (0042..0047 no mínimo); cada uma da PR e a 0049 com trava, pré e pós-condições", () => {
    expect(ANTES_DA_PR.map((m) => m.name.slice(0, 4))).toEqual(Array.from({ length: 41 }, (_, i) => String(i + 1).padStart(4, "0")));
    expect(NOMES, "a 0049 (MAPA-01, #91) está no disco").toContain(MAPA);
    expect(DA_PR.map((m) => m.name.slice(0, 4)), "as da PR no disco, na ordem do nome")
      .toEqual(expect.arrayContaining(["0042", "0043", "0044", "0045", "0046", "0047"]));
    expect(DA_PR.length).toBeGreaterThanOrEqual(6);
    expect(DA_PR.every((m) => m.name < MAPA), "toda migration da PR tem número MENOR que o da 0049").toBe(true);
    expect(LEDGER_PRODUCAO.length, "o ledger de produção de 03/10 tem 42 nomes").toBe(42);
    for (const m of [...DA_PR, ...TODAS.filter((x) => x.name === MAPA)]) {
      expect(guardasDoArquivo(m.sql), m.name).toEqual({ trava: true, preCondicoes: true, posCondicoes: true });
    }
  });

  it("OR-1 BANCO A, fase 1 = produção em 03/10: ledger 0001..0041 + 0049 (42), a 0049 viva, nenhum objeto da PR", () => {
    expect(estadoFase1.ledger).toEqual(LEDGER_PRODUCAO.map((m) => m.name));
    expect(estadoFase1.ledger.length).toBe(42);
    expect(estadoFase1.ledger.at(-1)).toBe(MAPA);
    expect(estadoFase1.mapaAreas).toBe("erp.mapa_areas");
    expect(estadoFase1.moduloMapa).toBe(1);
    expect(estadoFase1.objetosDaPr, "0042..0047 ainda não existem (premissa da fase 2)").toEqual([null, null, null, null, null, null]);
  });

  it("OR-2 BANCO A, fase 2: o runner pula as 42 e aplica as da PR na ordem do nome, cada uma sem erro (pré e pós-condições passaram); o ledger final = o disco, na ordem real", () => {
    expect(falhaA, "o runner aplicou as pendentes sobre o banco com a 0049").toBeUndefined();
    expect(PENDENTES_EM_PRODUCAO, "pendentes em produção = as da PR (e o que vier depois da 0049)")
      .toEqual([...DA_PR.map((m) => m.name), ...NOMES.filter((n) => n > MAPA)]);
    expect(aplicadasA).toEqual(PENDENTES_EM_PRODUCAO);
    expect(logA).toEqual(PENDENTES_EM_PRODUCAO.map((n) => `applied ${n}`));
    expect([...ledgerA].sort(), "o ledger final tem exatamente os nomes do disco").toEqual(NOMES);
    expect(ledgerA, "a ordem real: as 41, a 0049, e só então as da PR").toEqual([...LEDGER_PRODUCAO.map((m) => m.name), ...PENDENTES_EM_PRODUCAO]);
    expect(ledgerA.indexOf(MAPA)).toBeLessThan(ledgerA.indexOf(DA_PR[0]!.name));
  });

  it("OR-3 BANCO B: o runner num banco novo aplica todas na ordem do nome; o ledger = o disco", () => {
    expect(falhaB).toBeUndefined();
    expect(aplicadasB).toEqual(NOMES);
    expect(logB.length).toBe(NOMES.length);
    expect(ledgerB).toEqual(NOMES);
  });

  it("OR-4 PREMISSA do retrato: não vazio nos dois bancos, e com objetos das duas origens (a 0049 e cada uma da PR) nos dois", () => {
    const contagem = (r: Retrato) => Object.fromEntries(Object.entries(r).map(([k, s]) => [k, Object.keys(s).length]));
    const total = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);
    const nA = contagem(retratoA); const nB = contagem(retratoB);
    console.log(`[ordem-real] retrato por seção: A ${JSON.stringify(nA)} (${total(nA)} linhas); B ${total(nB)} linhas`);
    for (const secao of ["relacoes", "colunas", "restricoes", "indices", "funcoes", "gatilhos", "politicas", "views", "privilegios_relacoes",
      "privilegios_funcoes", "privilegios_schema", "comentarios", "extensoes", "dados", "modulos_escopo_empresa", "ledger"]) {
      expect(nA[secao], `seção ${secao} não vazia em A`).toBeGreaterThan(0);
      expect(nB[secao], `seção ${secao} não vazia em B`).toBeGreaterThan(0);
    }
    const tem = (r: Retrato, secao: string, chave: string) => Object.keys(r[secao] ?? {}).some((k) => k === chave || k.startsWith(chave));
    const origens: [string, string, string][] = [
      ["0049", "relacoes", "mapa_areas"], ["0049", "politicas", "mapa_areas.tenant_e_empresa"], ["0049", "gatilhos", "mapa_areas.trg_mapa_areas_conferir"],
      ["0049", "funcoes", "erp.mapa_area_geometria_valida("], ["0049", "privilegios_relacoes", "mapa_areas | erp_app | SELECT"],
      ["0042", "relacoes", "financeiro_naturezas_padrao"], ["0043", "funcoes", "erp.documentos_estoque_item_origem_guarda("],
      ["0044", "funcoes", "erp.documentos_compra_finalizacao_guarda("], ["0045", "relacoes", "imoveis_rurais"],
      ["0045", "colunas", "financial_titles.tipo_operacao_id"], ["0046", "politicas", "maintenance_items.api_child_insert"],
      ["0046", "funcoes", "erp.modulo_top_conferir("], ["0047", "relacoes", "notas_fiscais_xml"], ["0047", "politicas", "notas_fiscais_xml.tenant_e_empresa"]
    ];
    for (const [origem, secao, chave] of origens) {
      expect(tem(retratoA, secao, chave), `A tem ${secao} ${chave} (${origem})`).toBe(true);
      expect(tem(retratoB, secao, chave), `B tem ${secao} ${chave} (${origem})`).toBe(true);
    }
    expect(retratoA.modulos_escopo_empresa!.mapa).toBe("Mapa de Manejo | ordem 12");
    expect(retratoB.modulos_escopo_empresa!.mapa).toBe("Mapa de Manejo | ordem 12");
    expect(Object.keys(retratoA.ledger!).sort()).toEqual(NOMES);
    expect(Object.keys(retratoB.ledger!).sort()).toEqual(NOMES);
  });

  it("OR-5 o RETRATO DO CATÁLOGO da ORDEM REAL (A) é IGUAL ao da ORDEM POR NÚMERO (B): nenhuma seção difere", () => {
    expect(Object.keys(retratoA).length, "as seções do retrato").toBe(Object.keys(CONSULTAS).length + 1);
    expect(diferencas(retratoA, retratoB), "o retrato da ORDEM REAL tem de ser igual ao da ORDEM POR NÚMERO").toEqual({});
  });
});
