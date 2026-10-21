import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0064 (XML-04, decisão 318), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · `erp.formas_pagamento_da_nfe`, a ligação por organização do código tPag da NF-e a uma forma de pagamento
 *     (erp.payment_methods), com as colunas FIXAS (id, organization_id, codigo_tpag, forma_pagamento_id, created_at,
 *     updated_at, deleted_at), sem is_active e sem empresa_id, NASCENDO VAZIA (nenhuma ligação semeada);
 *   · uma forma por código por organização entre as VIVAS (índice único parcial); a excluída libera o código; a mesma
 *     forma recebe vários códigos; o mesmo código vive em organizações diferentes;
 *   · a forma é da organização da ligação ou do sistema (organization_id nulo): a de outra organização e a inexistente
 *     recebem a MESMA recusa `VALIDATION_ERROR:` (P0001, que a API traduz em 422), pelo papel da aplicação e pelo dono;
 *     excluir nunca é bloqueado;
 *   · RLS habilitada e forçada com a política única de erp.condicoes_pagamento; o erp_app lê, cria e altera, e não apaga.
 *
 * Banco NOVO esconde a prova: sem formas de pagamento do sistema e de duas organizações, "a do sistema passa e a de
 * outra organização não" seria verdade sobre conjunto vazio. Este arquivo sobe o banco até a 0063, semeia o acervo
 * (as dez formas do sistema da semente, uma forma de cada organização, a organização B) e só então aplica a 0064 como o
 * runner aplica (uma transação), provando antes as recusas dela: a trava (2026,98), o lock_timeout de 2s, a REVERSA de
 * cada pré-condição e a reaplicação; e depois cada pós-condição quebrada com a sua mensagem.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre). Papéis de ensaio têm o prefixo x04r_ e nascem só
 * dentro de transações desfeitas.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let orgB: string;
let formaSistema: string; let formaSistema2: string; let formaA: string; let formaB: string;

const ALVO = "0064_formas_pagamento_da_nfe.sql";
const M = "XML-04: ";
const RECUSA_FORMA = "VALIDATION_ERROR: A forma de pagamento precisa existir e ser desta organização ou do sistema.";
const JA_APLICADA = `${M}erp.formas_pagamento_da_nfe ja existe; a 0064 ja foi aplicada ou ha schema divergente.`;

const ctxA = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId });
const ctxB = (): TenantContext => ({ orgId: orgB, userId: null });
const naApp = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTx(app, ctx, fn);

const sqlDaAlvo = () => {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  return m!.sql;
};
async function aplicar(): Promise<void> {
  const sql = sqlDaAlvo();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda `sql` (a 0064, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a 0064 recusar, e ela aplicou");
}
const recusaDa0064 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDaAlvo(), antes);
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}

const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const temTabela = async () => (await db.query<{ t: string | null }>("select to_regclass('erp.formas_pagamento_da_nfe')::text t")).rows[0]!.t !== null;
const temFuncao = async () => (await db.query<{ f: string | null }>("select to_regprocedure('erp.formas_pagamento_da_nfe_forma_guarda()')::text f")).rows[0]!.f !== null;
/** O acervo que a 0064 não pode tocar: as formas de pagamento, as organizações e a contagem da auditoria. */
const retrato = async () => ({
  formas: (await db.query<{ l: unknown }>("select to_jsonb(p) l from erp.payment_methods p order by id")).rows.map((r) => r.l),
  organizacoes: (await db.query<{ l: unknown }>("select to_jsonb(o) l from erp.organizations o order by id")).rows.map((r) => r.l),
  auditoria: (await db.query<{ n: number }>("select count(*)::int n from erp.audit_logs")).rows[0]!.n
});
let antes: Awaited<ReturnType<typeof retrato>>;

/**
 * O RETRATO DO BANCO INTEIRO — a prova de que a 0064 não toca NADA além do que cria.
 *
 * O `retrato` acima lê três coisas; uma `alter table erp.products add column …` injetada na migration passava por
 * ele (achado do cético, 12/12 verde). Este lê o catálogo de TODO schema do usuário (hoje erp e public: o ledger e as
 * extensões moram em public) e os dados de toda tabela: relações (tipo, dono, RLS habilitada/forçada, opções, a
 * definição da visão, do índice e da sequência), colunas (tipo, not null, default, identidade, colação, ACL de
 * coluna), restrições, gatilhos (inclusive os INTERNOS das chaves estrangeiras, atribuídos à tabela DONA da
 * restrição), políticas, privilégios por papel (o ACL explodido: concedente, papel, privilégio, repasse), funções
 * (assinatura, retorno, linguagem, definer, config, volatilidade, dono, ACL e o md5 do corpo), tipos, comentários,
 * regras, schemas, default privileges, extensões, gatilhos de evento, os papéis do RLS (atributos, de quem são
 * membros, config) e, por tabela, a contagem mais o md5 das linhas. O ledger (public.erp_migrations) fica fora dos
 * dados: a linha da 0064 é conferida pelo nome em X5.
 *
 * Cada item carrega o seu ALVO: a tabela (de uma coluna, um índice, um gatilho, uma política, um privilégio), a
 * assinatura (de uma função), o nome (do resto). Depois da 0064, a única diferença aceita é ACRÉSCIMO cujo alvo é a
 * tabela nova ou a função nova — qualquer outra (+, - ou ~) sai, linha a linha, na mensagem.
 *
 * Os nomes de tabela do retrato de dados vêm do CATÁLOGO, citados pelo próprio banco (format %I), nunca de entrada.
 */
type ItemDoRetrato = { tipo: string; alvo: string; chave: string; valor: string };
type Diferenca = { sinal: "+" | "-" | "~"; tipo: string; alvo: string; texto: string };
const DO_USUARIO = (col: string) => `${col} <> 'information_schema' and ${col} !~ '^pg_'`;
const ASSINATURA = "n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'";
/** Toda relação do usuário, com o alvo: a própria relação, ou a tabela de um índice. */
const REL = `with rel as (
  select c.oid, c.relkind, n.nspname, c.relname, n.nspname || '.' || c.relname as nome,
         coalesce((select tn.nspname || '.' || tc.relname from pg_index i join pg_class tc on tc.oid = i.indrelid
                     join pg_namespace tn on tn.oid = tc.relnamespace where i.indexrelid = c.oid),
                  n.nspname || '.' || c.relname) as alvo
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where ${DO_USUARIO("n.nspname")})`;
const PAPEIS_DO_RLS = "('erp_app', 'erp_app_compat', 'authenticated', 'anon')";
const PARTES_DO_RETRATO: [string, string][] = [
  ["relacao", `${REL}
    select r.alvo, r.nome as chave,
           concat_ws(' | ', 'tipo=' || c.relkind::text, 'dono=' || c.relowner::regrole::text,
                     'rls=' || c.relrowsecurity || '/forcada=' || c.relforcerowsecurity, 'persistencia=' || c.relpersistence::text,
                     'replica=' || c.relreplident::text, 'opcoes=' || c.reloptions::text,
                     case when c.relkind in ('v', 'm') then 'visao=' || md5(pg_get_viewdef(c.oid)) end,
                     case when i.indexrelid is not null then pg_get_indexdef(c.oid) || ' valido=' || i.indisvalid end,
                     case when s.seqrelid is not null then 'sequencia=' || concat_ws(',', format_type(s.seqtypid, null), s.seqstart,
                       s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle) end) as valor
      from rel r join pg_class c on c.oid = r.oid
      left join pg_index i on i.indexrelid = c.oid left join pg_sequence s on s.seqrelid = c.oid`],
  ["coluna", `${REL}
    select r.alvo, r.nome || '.' || a.attname as chave,
           concat_ws(' | ', format_type(a.atttypid, a.atttypmod), case when a.attnotnull then 'not null' end,
                     'default=' || pg_get_expr(d.adbin, d.adrelid), 'identidade=' || nullif(a.attidentity::text, ''),
                     'gerada=' || nullif(a.attgenerated::text, ''),
                     'colacao=' || case when a.attcollation <> 0 then a.attcollation::regcollation::text end,
                     'acl=' || a.attacl::text, 'posicao=' || a.attnum) as valor
      from rel r join pg_attribute a on a.attrelid = r.oid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where r.relkind in ('r', 'p', 'v', 'm', 'f', 'c') and a.attnum > 0 and not a.attisdropped`],
  ["restricao", `
    select coalesce(rn.nspname || '.' || rc.relname, format_type(k.contypid, null)) as alvo,
           coalesce(rn.nspname || '.' || rc.relname, format_type(k.contypid, null)) || '.' || k.conname as chave,
           concat_ws(' | ', k.contype::text, pg_get_constraintdef(k.oid), 'validada=' || k.convalidated,
                     'adiavel=' || k.condeferrable || '/' || k.condeferred, 'sem heranca=' || k.connoinherit) as valor
      from pg_constraint k join pg_namespace n on n.oid = k.connamespace
      left join pg_class rc on rc.oid = k.conrelid left join pg_namespace rn on rn.oid = rc.relnamespace
     where ${DO_USUARIO("n.nspname")}`],
  // Os gatilhos INTERNOS (os RI_ConstraintTrigger que toda chave estrangeira cria também na tabela REFERIDA) têm como
  // alvo a tabela DONA da restrição: as duas FKs da tabela nova põem gatilhos em erp.organizations e erp.payment_methods,
  // e isso é efeito da tabela nova — já uma FK de OUTRA tabela apontando para a nova tem alvo na outra, e reprova.
  ["gatilho", `
    select coalesce(kn.nspname || '.' || kc.relname, n.nspname || '.' || c.relname) as alvo,
           n.nspname || '.' || c.relname || '.' || t.tgname as chave,
           concat_ws(' | ', pg_get_triggerdef(t.oid), 'ligado=' || t.tgenabled::text, 'interno=' || t.tgisinternal,
                     'restricao=' || k.conname) as valor
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_constraint k on k.oid = t.tgconstraint
      left join pg_class kc on kc.oid = k.conrelid left join pg_namespace kn on kn.oid = kc.relnamespace
     where ${DO_USUARIO("n.nspname")}`],
  ["politica", `
    select p.schemaname || '.' || p.tablename as alvo, p.schemaname || '.' || p.tablename || '.' || p.policyname as chave,
           concat_ws(' | ', p.permissive, p.cmd, p.roles::text, 'using=' || p.qual, 'check=' || p.with_check) as valor
      from pg_policies p where ${DO_USUARIO("p.schemaname")}`],
  ["privilegio", `${REL}
    select r.alvo,
           r.nome || ' -> ' || case when a.grantee = 0 then 'public' else a.grantee::regrole::text end || ' ' || a.privilege_type
             || ' por ' || a.grantor::regrole::text as chave,
           'repassa=' || a.is_grantable as valor
      from rel r join pg_class c on c.oid = r.oid
      cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
     where r.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`],
  ["funcao", `
    select ${ASSINATURA} as alvo, ${ASSINATURA} as chave,
           concat_ws(' | ', 'tipo=' || p.prokind::text, 'retorno=' || pg_get_function_result(p.oid), 'linguagem=' || l.lanname,
                     'definer=' || p.prosecdef, 'config=' || p.proconfig::text, 'volatilidade=' || p.provolatile::text,
                     'estrita=' || p.proisstrict, 'leakproof=' || p.proleakproof, 'paralela=' || p.proparallel::text,
                     'dono=' || p.proowner::regrole::text, 'corpo=' || md5(coalesce(p.prosrc, '') || '/' || coalesce(p.probin, '')),
                     'acl=' || coalesce(p.proacl::text, 'padrao')) as valor
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where ${DO_USUARIO("n.nspname")}`],
  ["tipo", `
    select n.nspname || '.' || t.typname as alvo, n.nspname || '.' || t.typname as chave,
           concat_ws(' | ', 'tipo=' || t.typtype::text, 'dono=' || t.typowner::regrole::text,
                     'base=' || case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
                     'not null=' || t.typnotnull, 'default=' || t.typdefault,
                     'rotulos=' || (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
                     'acl=' || t.typacl::text) as valor
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where ${DO_USUARIO("n.nspname")} and t.typcategory <> 'A'
       and (t.typtype in ('b', 'e', 'd', 'r', 'm')
            or (t.typtype = 'c' and exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c')))`],
  ["comentario", `${REL}
    select r.alvo, 'relacao ' || r.nome || coalesce('.' || a.attname, '') as chave, md5(d.description) as valor
      from pg_description d join rel r on d.classoid = 'pg_class'::regclass and d.objoid = r.oid
      left join pg_attribute a on a.attrelid = r.oid and a.attnum = d.objsubid and d.objsubid > 0
    union all
    select ${ASSINATURA}, 'funcao ' || ${ASSINATURA}, md5(d.description)
      from pg_description d join pg_proc p on d.classoid = 'pg_proc'::regclass and d.objoid = p.oid
      join pg_namespace n on n.oid = p.pronamespace where ${DO_USUARIO("n.nspname")}
    union all
    select coalesce(rn.nspname || '.' || rc.relname, format_type(k.contypid, null)),
           'restricao ' || coalesce(rn.nspname || '.' || rc.relname, format_type(k.contypid, null)) || '.' || k.conname, md5(d.description)
      from pg_description d join pg_constraint k on d.classoid = 'pg_constraint'::regclass and d.objoid = k.oid
      join pg_namespace n on n.oid = k.connamespace
      left join pg_class rc on rc.oid = k.conrelid left join pg_namespace rn on rn.oid = rc.relnamespace
     where ${DO_USUARIO("n.nspname")}
    union all
    select n.nspname || '.' || c.relname, 'gatilho ' || n.nspname || '.' || c.relname || '.' || t.tgname, md5(d.description)
      from pg_description d join pg_trigger t on d.classoid = 'pg_trigger'::regclass and d.objoid = t.oid
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where ${DO_USUARIO("n.nspname")}
    union all
    select n.nspname || '.' || c.relname, 'politica ' || n.nspname || '.' || c.relname || '.' || p.polname, md5(d.description)
      from pg_description d join pg_policy p on d.classoid = 'pg_policy'::regclass and d.objoid = p.oid
      join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where ${DO_USUARIO("n.nspname")}
    union all
    select n.nspname || '.' || t.typname, 'tipo ' || n.nspname || '.' || t.typname, md5(d.description)
      from pg_description d join pg_type t on d.classoid = 'pg_type'::regclass and d.objoid = t.oid
      join pg_namespace n on n.oid = t.typnamespace where ${DO_USUARIO("n.nspname")}
    union all
    select n.nspname, 'schema ' || n.nspname, md5(d.description)
      from pg_description d join pg_namespace n on d.classoid = 'pg_namespace'::regclass and d.objoid = n.oid
     where ${DO_USUARIO("n.nspname")}`],
  ["regra", `
    select r.schemaname || '.' || r.tablename as alvo, r.schemaname || '.' || r.tablename || '.' || r.rulename as chave,
           md5(r.definition) as valor
      from pg_rules r where ${DO_USUARIO("r.schemaname")}`],
  ["schema", `
    select n.nspname as alvo, n.nspname as chave,
           'dono=' || n.nspowner::regrole::text || ' | acl=' || coalesce(n.nspacl::text, 'padrao') as valor
      from pg_namespace n where ${DO_USUARIO("n.nspname")}`],
  ["acl_padrao", `
    select 'default privileges' as alvo,
           d.defaclrole::regrole::text || ' em ' || case when d.defaclnamespace = 0 then '*' else d.defaclnamespace::regnamespace::text end
             || ' de ' || d.defaclobjtype::text as chave,
           d.defaclacl::text as valor
      from pg_default_acl d`],
  ["extensao", "select 'extensoes' as alvo, e.extname as chave, e.extversion || ' em ' || e.extnamespace::regnamespace::text as valor from pg_extension e"],
  ["gatilho_de_evento", `
    select 'gatilhos de evento' as alvo, e.evtname as chave,
           concat_ws(' | ', e.evtevent, e.evtfoid::regprocedure::text, e.evtenabled::text, e.evttags::text) as valor
      from pg_event_trigger e`],
  // Papéis são do CLUSTER (outros bancos de teste rodam ao lado): só os papéis do RLS, e só o que eles HERDAM.
  ["papel", `
    select 'papeis' as alvo, r.rolname as chave,
           concat_ws(' | ', 'super=' || r.rolsuper, 'herda=' || r.rolinherit, 'cria papel=' || r.rolcreaterole,
                     'cria banco=' || r.rolcreatedb, 'login=' || r.rolcanlogin, 'replicacao=' || r.rolreplication,
                     'bypassrls=' || r.rolbypassrls,
                     'membro de=' || (select string_agg(m.roleid::regrole::text, ',' order by m.roleid::regrole::text)
                                        from pg_auth_members m where m.member = r.oid),
                     'config=' || (select string_agg(s.setconfig::text, ';' order by s.setdatabase) from pg_db_role_setting s
                                    where s.setrole = r.oid and s.setdatabase in (0, (select oid from pg_database where datname = current_database())))) as valor
      from pg_roles r where r.rolname in ${PAPEIS_DO_RLS}
    union all
    select 'banco', 'config do banco atual',
           coalesce((select s.setconfig::text from pg_db_role_setting s
                      where s.setrole = 0 and s.setdatabase = (select oid from pg_database where datname = current_database())), '-')`],
  ["dados", `${REL}
    select r.alvo, r.nome as chave,
           (xpath('/row/h/text()', query_to_xml(format(
             'select count(*) || '':'' || coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), ''-'') as h from %I.%I t',
             r.nspname, r.relname), false, true, '')))[1]::text as valor
      from rel r where r.relkind in ('r', 'p') and r.nome <> 'public.erp_migrations'`]
];
async function retratoDoBanco(): Promise<Map<string, ItemDoRetrato>> {
  const partes = await Promise.all(PARTES_DO_RETRATO.map(async ([tipo, sql]) =>
    (await db.query<{ alvo: string; chave: string; valor: string | null }>(sql)).rows.map((r) => ({ tipo, alvo: r.alvo, chave: r.chave, valor: r.valor ?? "" }))));
  const mapa = new Map<string, ItemDoRetrato>();
  for (const item of partes.flat()) {
    const k = `${item.tipo} ${item.chave}`;
    if (mapa.has(k)) throw new Error(`retrato do banco com chave repetida: ${k}`);
    mapa.set(k, item);
  }
  return mapa;
}
function diferencas(de: Map<string, ItemDoRetrato>, para: Map<string, ItemDoRetrato>): Diferenca[] {
  const out: Diferenca[] = [];
  for (const [k, a] of de) {
    const d = para.get(k);
    if (!d) out.push({ sinal: "-", tipo: a.tipo, alvo: a.alvo, texto: `- ${k} (era: ${a.valor})` });
    else if (d.valor !== a.valor || d.alvo !== a.alvo) out.push({ sinal: "~", tipo: a.tipo, alvo: a.alvo, texto: `~ ${k}: ${a.valor} => ${d.valor}` });
  }
  for (const [k, d] of para) if (!de.has(k)) out.push({ sinal: "+", tipo: d.tipo, alvo: d.alvo, texto: `+ ${k} = ${d.valor}` });
  return out.sort((x, y) => (x.texto < y.texto ? -1 : x.texto > y.texto ? 1 : 0));
}
const contarPorTipo = (itens: { tipo: string }[]) =>
  itens.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.tipo]: (acc[i.tipo] ?? 0) + 1 }), {});
/** O que a 0064 cria. Acréscimo com alvo fora daqui — e qualquer remoção ou mudança — é tocar o que não é dela. */
const NOVOS = new Set(["erp.formas_pagamento_da_nfe", "erp.formas_pagamento_da_nfe_forma_guarda()"]);
let bancoAntes: Map<string, ItemDoRetrato>;
let bancoDepois: Map<string, ItemDoRetrato>;

/** Ligação gravada pelo papel da aplicação (a resposta traz o ROW COUNT e o id). */
const ligar = (ctx: TenantContext, org: string, codigo: string, forma: string, extra = "") =>
  naApp(ctx, (tx) => tx.query<{ id: string }>(
    `insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id${extra ? ", deleted_at" : ""})
     values ($1, $2, $3${extra ? `, ${extra}` : ""}) returning id`, [org, codigo, forma]));
const linhaDe = async (id: string) => (await db.query<{ organization_id: string; codigo_tpag: string; forma_pagamento_id: string; vivo: boolean }>(
  "select organization_id, codigo_tpag, forma_pagamento_id, deleted_at is null vivo from erp.formas_pagamento_da_nfe where id=$1", [id])).rows[0];

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
  // O ACERVO: as formas do sistema vêm da semente de referência (organization_id nulo, como as dez da produção); cada
  // organização ganha uma forma própria; a organização B é a "outra".
  orgB = (await db.query<{ id: string }>(
    "insert into erp.organizations (name, slug) values ('[TEST] Organização B X04', 'x04-org-b') returning id")).rows[0]!.id;
  const sistema = (await db.query<{ id: string }>("select id from erp.payment_methods where organization_id is null order by name limit 2")).rows;
  formaSistema = sistema[0]!.id; formaSistema2 = sistema[1]!.id;
  formaA = (await db.query<{ id: string }>("insert into erp.payment_methods (organization_id, name) values ($1, '[TEST] X04 Forma A') returning id", [demo.orgId])).rows[0]!.id;
  formaB = (await db.query<{ id: string }>("insert into erp.payment_methods (organization_id, name) values ($1, '[TEST] X04 Forma B') returning id", [orgB])).rows[0]!.id;
  antes = await retrato();
  bancoAntes = await retratoDoBanco();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("0064 — sobre o acervo de formas de pagamento, como o runner aplica", () => {
  it("X1 PREMISSA: sob a 0063 há formas do sistema e de duas organizações, e nada da 0064 existe", async () => {
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 63, ultima: "0063_versao_do_documento_de_compra.sql" });
    expect(await noLedger()).toBe(false);
    expect(await temTabela()).toBe(false);
    expect(await temFuncao()).toBe(false);
    const formas = (await db.query<{ dono: string; n: number }>(
      `select case when organization_id is null then 'sistema' when organization_id = $1 then 'A' when organization_id = $2 then 'B' else 'outra' end dono,
              count(*)::int n from erp.payment_methods group by 1 order by 1`, [demo.orgId, orgB])).rows;
    expect(formas, "sem forma do sistema e das duas organizações, a guarda seria provada sobre conjunto vazio").toEqual([
      { dono: "A", n: 1 }, { dono: "B", n: 1 }, { dono: "sistema", n: 10 }]);
    // A premissa do gatilho: organization_id NULÁVEL em erp.payment_methods (por isso a FK composta é impossível).
    expect((await db.query("select is_nullable from information_schema.columns where table_schema='erp' and table_name='payment_methods' and column_name='organization_id'")).rows)
      .toEqual([{ is_nullable: "YES" }]);
    // O erp_app vê as do sistema e as da PRÓPRIA organização (ref_payment_methods da 0007), e nunca a da outra.
    const vistas = await naApp(ctxA(), async (tx) => (await tx.query<{ id: string }>("select id from erp.payment_methods")).rows.map((r) => r.id));
    expect(vistas).toHaveLength(11);
    expect(vistas).toContain(formaSistema);
    expect(vistas).toContain(formaA);
    expect(vistas).not.toContain(formaB);
    expect(antes.formas).toHaveLength(12);
    // O retrato do banco inteiro VÊ o banco (senão "nada mudou" seria verdade sobre um retrato vazio): cada parte tem
    // itens, e as tabelas que a 0064 não pode tocar estão nele, com catálogo e dados.
    const tamanhos = contarPorTipo([...bancoAntes.values()]);
    console.info(`[X04-RETRATO] antes da 0064: ${bancoAntes.size} itens ${JSON.stringify(tamanhos)}`);
    for (const [tipo, minimo] of Object.entries({
      relacao: 600, coluna: 2000, restricao: 1200, gatilho: 2500, politica: 200, privilegio: 1800, funcao: 150, tipo: 1,
      comentario: 500, schema: 2, acl_padrao: 1, extensao: 3, papel: 4, dados: 200
    })) expect([tipo, (tamanhos[tipo] ?? 0) >= minimo], `o retrato tem ao menos ${minimo} itens de ${tipo}`).toEqual([tipo, true]);
    for (const chave of ["relacao erp.products", "coluna erp.products.description", "relacao erp.payment_methods", "dados erp.payment_methods",
      "dados erp.products", "dados erp.organizations", "funcao erp.set_updated_at()", "funcao erp.audit_row()", "schema erp", "schema public"]) {
      expect([chave, bancoAntes.has(chave)]).toEqual([chave, true]);
    }
    expect(bancoAntes.get("dados erp.payment_methods")?.valor, "os dados entram pelo conteúdo: 12 formas").toMatch(/^12:[0-9a-f]{32}$/);
    expect([...bancoAntes.keys()].filter((k) => k.includes("formas_pagamento_da_nfe")), "nada da 0064 no retrato de antes").toEqual([]);
  });

  it("X2 trava (2026,98) em uso por outra sessão: a 0064 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 98)");
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,98). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, 98)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await temTabela()).toBe(false);
    // Contraprova do número: a trava da 0063 (2026,97) em uso NÃO segura a 0064 (desfeita no fim).
    const outra97 = await db.connect();
    try {
      await outra97.query("select pg_advisory_lock(2026, 97)");
      await expect(recusaDa0064()).rejects.toThrow("esperava a 0064 recusar, e ela aplicou");
    } finally { await outra97.query("select pg_advisory_unlock(2026, 97)"); outra97.release(); }
    expect(await temTabela()).toBe(false);
  });

  it("X3 lock_timeout 2s: uma escrita aberta em erp.payment_methods, ou em erp.organizations, faz a 0064 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive: a FK nova precisa de ShareRowExclusive na tabela referida.
      await escritor.query("update erp.payment_methods set name = name where id = $1", [formaSistema]);
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      // Teto perto dos 2 s (com folga para máquina lenta): a espera que vale de FATO é a de 2 s, não só o texto do
      // `set local` (o X8) — um `set_config('lock_timeout', '5s', true)` depois dele passaria pelo X8 (achado do cético).
      expect(ms, "e desistiu perto dos 2 s, não de uma espera maior").toBeLessThan(4_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    // A OUTRA tabela referida: a FK da organização pede a mesma ShareRowExclusive em erp.organizations, então uma
    // escrita aberta lá também faz a 0064 desistir pelo lock_timeout (o cético só tinha a sonda dele para esta).
    const escritorOrg = await db.connect();
    try {
      await escritorOrg.query("begin");
      await escritorOrg.query("update erp.organizations set name = name where id = $1", [orgB]);
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "erp.organizations: desistiu pelo lock_timeout").toBeGreaterThanOrEqual(1900);
      expect(ms, "erp.organizations: e desistiu perto dos 2 s, não de uma espera maior").toBeLessThan(4_000);
    } finally { await escritorOrg.query("rollback"); escritorOrg.release(); }
    expect(await noLedger()).toBe(false);
    expect(await temTabela()).toBe(false);
    expect(await temFuncao()).toBe(false);
  });

  it("X4 reversas: cada pré-condição quebrada recusa a 0064 com a SUA mensagem, sem efeito", async () => {
    const funcao = (c: Tx) => c.query("create function erp.formas_pagamento_da_nfe_forma_guarda() returns trigger language plpgsql as 'begin return new; end'");
    // "Já aplicada" é a PRIMEIRA: com a tabela E outras pré-condições quebradas juntas (a função, a 0063, o erp_app), o
    // motivo é o de "já aplicada".
    expect(await recusaDa0064((c) => c.query("create table erp.formas_pagamento_da_nfe (id int)"))).toBe(JA_APLICADA);
    expect(await recusaDa0064(async (c) => {
      await c.query("create table erp.formas_pagamento_da_nfe (id int)");
      await funcao(c);
      await c.query("alter table erp.documentos_compra rename column version to version_x04r");
      await c.query("alter role erp_app rename to x04r_app_ausente");
    })).toBe(JA_APLICADA);
    expect(await recusaDa0064(funcao)).toBe(`${M}a funcao erp.formas_pagamento_da_nfe_forma_guarda() ja existe; schema divergente.`);
    expect(await recusaDa0064((c) => c.query("create table erp.ux_formas_pagamento_da_nfe_codigo_vivo (x int)")))
      .toBe(`${M}ja existe uma relacao erp.ux_formas_pagamento_da_nfe_codigo_vivo; schema divergente.`);
    expect(await recusaDa0064((c) => c.query("alter table erp.documentos_compra rename column version to version_x04r")))
      .toBe(`${M}a 0063 nao esta aplicada (erp.documentos_compra.version ausente); a cadeia de migrations esta fora de ordem.`);
    expect(await recusaDa0064((c) => c.query("alter table erp.organizations rename to organizations_x04r")))
      .toBe(`${M}erp.organizations ausente; a cadeia de migrations esta fora de ordem.`);
    const FORMAS = `${M}erp.payment_methods ausente ou sem id/organization_id uuid; o gatilho da forma nao teria o que conferir.`;
    expect(await recusaDa0064((c) => c.query("alter table erp.payment_methods rename to payment_methods_x04r"))).toBe(FORMAS);
    expect(await recusaDa0064((c) => c.query("alter table erp.payment_methods rename column organization_id to organizacao_x04r"))).toBe(FORMAS);
    const FUNCOES = `${M}erp.set_updated_at(), erp.audit_row() ou erp.tenant_visible(uuid) ausente; a cadeia de migrations esta fora de ordem.`;
    expect(await recusaDa0064((c) => c.query("alter function erp.set_updated_at() rename to set_updated_at_x04r"))).toBe(FUNCOES);
    expect(await recusaDa0064((c) => c.query("alter function erp.audit_row() rename to audit_row_x04r"))).toBe(FUNCOES);
    expect(await recusaDa0064((c) => c.query("alter policy tenant_isolation on erp.condicoes_pagamento rename to tenant_isolation_x04r")))
      .toBe(`${M}a politica tenant_isolation de erp.condicoes_pagamento (0031), referencia da tabela nova, esta ausente.`);
    expect(await recusaDa0064((c) => c.query("alter role erp_app rename to x04r_app_ausente")))
      .toBe(`${M}o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente.`);
    // Quem aplica não cria no schema erp (o papel da aplicação, por exemplo).
    expect(await recusaDa0064((c) => c.query("set local role erp_app")))
      .toBe(`${M}o papel que aplica a migration nao cria objetos no schema erp; o CREATE TABLE seria recusado.`);
    // Quem aplica cria no schema, mas não tem REFERENCES nas tabelas referidas.
    expect(await recusaDa0064(async (c) => {
      await c.query("create role x04r_aplicador nologin");
      await c.query("grant usage, create on schema erp to x04r_aplicador");
      await c.query("set local role x04r_aplicador");
    })).toBe(`${M}o papel que aplica a migration nao tem REFERENCES em erp.organizations ou erp.payment_methods; as chaves estrangeiras seriam recusadas.`);
    // Nada ficou: o ledger, a tabela, a função, os papéis de ensaio e o acervo são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await temTabela()).toBe(false);
    expect(await temFuncao()).toBe(false);
    expect((await db.query("select 1 from pg_roles where rolname like 'x04r\\_%'")).rowCount).toBe(0);
    expect((await db.query("select 1 from pg_roles where rolname = 'erp_app'")).rowCount, "o rename do erp_app foi desfeito").toBe(1);
    expect(await retrato()).toEqual(antes);
    expect(diferencas(bancoAntes, await retratoDoBanco()).map((d) => d.texto), "as recusas não deixaram nada no catálogo nem nos dados").toEqual([]);
  });

  it("X5 aplica: ledger com 64 (a 0064 por último), tabela VAZIA, acervo idêntico, objetos no catálogo, e nada fora dela mudou no banco inteiro", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 64, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "65 migrations no repositório (0001..0065; a 0065 EDITAR-02B vem depois da XML-04 0064)").toBe(65);
    expect(noDisco[63]).toBe(ALVO);
    // SEM SEMENTE: nenhuma ligação nasce (o superusuário lê sem RLS: zero é zero de verdade), e nada foi auditado.
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.formas_pagamento_da_nfe")).rows[0]!.n).toBe(0);
    expect(await retrato(), "formas, organizações e auditoria intactas").toEqual(antes);

    // NADA FORA DA 0064 MUDOU: o retrato do banco inteiro, antes × depois. A única diferença aceita é ACRÉSCIMO com
    // alvo na tabela nova ou na função nova; o resto (outra tabela alterada, função existente reescrita, privilégio
    // novo em outra tabela, linha mexida, objeto removido) sai aqui, linha a linha.
    bancoDepois = await retratoDoBanco();
    const dif = diferencas(bancoAntes, bancoDepois);
    const daFatia = dif.filter((d) => d.sinal === "+" && NOVOS.has(d.alvo));
    const alheias = dif.filter((d) => !daFatia.includes(d));
    console.info(`[X04-RETRATO] depois da 0064: ${bancoDepois.size} itens; diferenças ${dif.length} (da 0064 ${daFatia.length}, alheias ${alheias.length})`);
    expect(alheias.map((d) => d.texto), "a 0064 só cria a tabela nova, a função nova e o que é delas: nada mais muda no banco").toEqual([]);
    // E o retrato VIU a 0064 (um retrato cego também daria "nada alheio"): cada categoria do que ela cria aparece.
    // Os privilégios do DONO variam com a versão do PostgreSQL (o 17 acrescenta MAINTAIN): contados à parte.
    expect(contarPorTipo(daFatia.filter((d) => d.tipo !== "privilegio")),
      "a tabela (e os 2 índices), 7 colunas, 4 restrições, 3 gatilhos + 8 internos das 2 FKs, 1 política, a função, 9 comentários, os dados").toEqual({
      relacao: 3, coluna: 7, restricao: 4, gatilho: 11, politica: 1, funcao: 1, comentario: 9, dados: 1
    });
    const dono = /\| dono=([^ |]+)/.exec(bancoDepois.get("relacao erp.formas_pagamento_da_nfe")?.valor ?? "")?.[1];
    expect(dono, "o dono da tabela nova está no retrato").toBeTruthy();
    const privilegios = daFatia.filter((d) => d.tipo === "privilegio");
    expect(privilegios.filter((d) => d.texto.includes(" -> erp_app ")).map((d) => d.texto.replace(/ por .*$/, "")))
      .toEqual(["INSERT", "SELECT", "UPDATE"].map((p) => `+ privilegio erp.formas_pagamento_da_nfe -> erp_app ${p}`));
    expect(privilegios.filter((d) => !d.texto.includes(" -> erp_app ") && !d.texto.includes(` -> ${dono} `)).map((d) => d.texto),
      "nenhum outro papel além do dono e do erp_app").toEqual([]);
    expect(bancoDepois.get("dados erp.formas_pagamento_da_nfe")?.valor, "a tabela nova nasce vazia").toBe("0:-");
    // Os internos nas tabelas REFERIDAS são das FKs da tabela nova (alvo dela), e só eles.
    expect(daFatia.filter((d) => d.tipo === "gatilho" && !d.texto.startsWith("+ gatilho erp.formas_pagamento_da_nfe.")).map((d) => d.texto.split(".")[1]))
      .toEqual(["organizations", "organizations", "payment_methods", "payment_methods"]);

    const colunas = (await db.query(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema='erp' and table_name='formas_pagamento_da_nfe' order by ordinal_position`)).rows;
    expect(colunas).toEqual([
      { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
      { column_name: "organization_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "codigo_tpag", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "forma_pagamento_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      { column_name: "deleted_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }
    ]);
    const restricoes = (await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.formas_pagamento_da_nfe'::regclass order by conname`)).rows;
    expect(restricoes).toEqual([
      { conname: "chk_formas_pagamento_da_nfe_codigo_tpag", def: "CHECK ((codigo_tpag ~ '^[0-9]{2}$'::text))" },
      { conname: "fk_formas_pagamento_da_nfe_forma", def: "FOREIGN KEY (forma_pagamento_id) REFERENCES erp.payment_methods(id)" },
      { conname: "fk_formas_pagamento_da_nfe_organizacao", def: "FOREIGN KEY (organization_id) REFERENCES erp.organizations(id)" },
      { conname: "formas_pagamento_da_nfe_pkey", def: "PRIMARY KEY (id)" }
    ]);
    const indices = (await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='erp' and tablename='formas_pagamento_da_nfe' order by indexname")).rows.map((r) => r.indexdef);
    expect(indices, "único só o parcial do código vivo (e a chave primária); nada único na forma").toEqual([
      "CREATE UNIQUE INDEX formas_pagamento_da_nfe_pkey ON erp.formas_pagamento_da_nfe USING btree (id)",
      "CREATE UNIQUE INDEX ux_formas_pagamento_da_nfe_codigo_vivo ON erp.formas_pagamento_da_nfe USING btree (organization_id, codigo_tpag) WHERE (deleted_at IS NULL)"
    ]);
    const gatilhos = (await db.query<{ def: string; ligado: string }>(
      `select pg_get_triggerdef(t.oid) def, t.tgenabled ligado from pg_trigger t
        where t.tgrelid='erp.formas_pagamento_da_nfe'::regclass and not t.tgisinternal order by t.tgname`)).rows;
    expect(gatilhos).toEqual([
      { def: "CREATE TRIGGER trg_formas_pagamento_da_nfe_audit AFTER INSERT OR DELETE OR UPDATE ON erp.formas_pagamento_da_nfe FOR EACH ROW EXECUTE FUNCTION erp.audit_row()", ligado: "O" },
      { def: "CREATE TRIGGER trg_formas_pagamento_da_nfe_forma BEFORE INSERT OR UPDATE ON erp.formas_pagamento_da_nfe FOR EACH ROW EXECUTE FUNCTION erp.formas_pagamento_da_nfe_forma_guarda()", ligado: "O" },
      { def: "CREATE TRIGGER trg_formas_pagamento_da_nfe_updated BEFORE UPDATE ON erp.formas_pagamento_da_nfe FOR EACH ROW EXECUTE FUNCTION erp.set_updated_at()", ligado: "O" }
    ]);
    const funcao = (await db.query(
      `select p.prosecdef definer, p.proconfig cfg, l.lanname lang, has_function_privilege('erp_app', p.oid, 'execute') app,
              has_function_privilege('public', p.oid, 'execute') publico, p.proowner::regrole::text dono
         from pg_proc p join pg_language l on l.oid = p.prolang where p.oid='erp.formas_pagamento_da_nfe_forma_guarda()'::regprocedure`)).rows;
    expect(funcao).toEqual([{ definer: false, cfg: ["search_path=erp, pg_temp"], lang: "plpgsql", app: false, publico: false, dono: "postgres" }]);
    const rls = (await db.query("select relrowsecurity habilitada, relforcerowsecurity forcada from pg_class where oid='erp.formas_pagamento_da_nfe'::regclass")).rows;
    expect(rls).toEqual([{ habilitada: true, forcada: true }]);
    const politicas = (await db.query(
      `select p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check from pg_policies p
        where p.schemaname='erp' and p.tablename in ('formas_pagamento_da_nfe', 'condicoes_pagamento') order by p.tablename, p.policyname`)).rows;
    expect(politicas).toHaveLength(2);
    expect(politicas[1], "a política da tabela nova é a MESMA de erp.condicoes_pagamento").toEqual(politicas[0]);
    expect(politicas[1]).toMatchObject({ policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: "{authenticated,erp_app}" });
    const grants = (await db.query<{ p: string }>(
      `select privilege_type p from information_schema.role_table_grants where table_schema='erp' and table_name='formas_pagamento_da_nfe' and grantee='erp_app' order by 1`)).rows.map((r) => r.p);
    expect(grants, "a exclusão é lógica: sem DELETE (nem TRUNCATE)").toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect((await db.query("select obj_description('erp.formas_pagamento_da_nfe'::regclass, 'pg_class') is not null t")).rows).toEqual([{ t: true }]);
  });

  it("X6 reaplicar é recusado pela pré-condição de 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0064()).toBe(JA_APLICADA);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.formas_pagamento_da_nfe")).rows[0]!.n).toBe(0);
    expect(diferencas(bancoDepois, await retratoDoBanco()).map((d) => d.texto), "a reaplicação recusada não deixou nada").toEqual([]);
  });

  it("X7 pós-condições: só de catálogo, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDaAlvo();
    const inicio = sql.indexOf("-- ---------- 6) pós-condições");
    expect(inicio, "o trecho 6) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const T = "erp.formas_pagamento_da_nfe";
    const COLUNAS = /^XML-04: colunas de erp\.formas_pagamento_da_nfe fora da forma: /;
    const PK = `${M}chave primaria de erp.formas_pagamento_da_nfe ausente ou fora de id.`;
    const CHECK = `${M}CHECK chk_formas_pagamento_da_nfe_codigo_tpag (dois digitos) ausente ou fora da forma.`;
    const FKS = `${M}chaves estrangeiras de erp.formas_pagamento_da_nfe fora da forma (forma -> payment_methods.id, organizacao -> organizations.id, so as duas).`;
    const INDICE = /^XML-04: indice unico parcial ux_formas_pagamento_da_nfe_codigo_vivo \(organization_id, codigo_tpag\) where deleted_at is null ausente, fora da forma, ou ha outro indice unico: /;
    const FUNCAO = `${M}erp.formas_pagamento_da_nfe_forma_guarda() nao e plpgsql, retornando trigger, SECURITY INVOKER, com search_path "erp, pg_temp".`;
    const EXECUTE = `${M}EXECUTE de erp.formas_pagamento_da_nfe_forma_guarda() concedido alem do dono.`;
    const GATILHOS = /^XML-04: gatilhos de erp\.formas_pagamento_da_nfe fora da forma \(guarda da forma, updated_at e auditoria\): /;
    const RLS = `${M}RLS de erp.formas_pagamento_da_nfe nao esta habilitada e forcada.`;
    const POLITICA = `${M}erp.formas_pagamento_da_nfe sem a politica unica tenant_isolation igual a de erp.condicoes_pagamento.`;
    const PRIV = `${M}privilegios do erp_app em erp.formas_pagamento_da_nfe fora de select/insert/update.`;
    const guarda = (def: string) => `drop trigger trg_formas_pagamento_da_nfe_forma on ${T}; create trigger trg_formas_pagamento_da_nfe_forma ${def}`;
    const casos: [string, string, string | RegExp][] = [
      ["is_active a mais", `alter table ${T} add column is_active boolean not null default true`, COLUNAS],
      ["empresa_id a mais", `alter table ${T} add column empresa_id uuid`, COLUNAS],
      ["deleted_at not null", `alter table ${T} alter column deleted_at set not null`, COLUNAS],
      ["created_at sem default", `alter table ${T} alter column created_at drop default`, COLUNAS],
      ["codigo_tpag varchar", `alter table ${T} alter column codigo_tpag type varchar(2)`, COLUNAS],
      ["sem chave primária", `alter table ${T} drop constraint formas_pagamento_da_nfe_pkey`, PK],
      ["CHECK frouxo", `alter table ${T} drop constraint chk_formas_pagamento_da_nfe_codigo_tpag, add constraint chk_formas_pagamento_da_nfe_codigo_tpag check (codigo_tpag ~ '^[0-9]+$')`, CHECK],
      ["sem CHECK", `alter table ${T} drop constraint chk_formas_pagamento_da_nfe_codigo_tpag`, CHECK],
      ["FK da forma para outra tabela", `alter table ${T} drop constraint fk_formas_pagamento_da_nfe_forma, add constraint fk_formas_pagamento_da_nfe_forma foreign key (forma_pagamento_id) references erp.organizations(id)`, FKS],
      ["sem FK da organização", `alter table ${T} drop constraint fk_formas_pagamento_da_nfe_organizacao`, FKS],
      ["FK a mais", `alter table ${T} add constraint fk_x04r foreign key (organization_id) references erp.organizations(id)`, FKS],
      ["único na forma", `create unique index ux_x04r on ${T} (organization_id, forma_pagamento_id) where deleted_at is null`, INDICE],
      ["único sem o parcial", `drop index erp.ux_formas_pagamento_da_nfe_codigo_vivo; create unique index ux_formas_pagamento_da_nfe_codigo_vivo on ${T} (organization_id, codigo_tpag)`, INDICE],
      ["único com as colunas trocadas", `drop index erp.ux_formas_pagamento_da_nfe_codigo_vivo; create unique index ux_formas_pagamento_da_nfe_codigo_vivo on ${T} (codigo_tpag, organization_id) where deleted_at is null`, INDICE],
      ["índice não único", `drop index erp.ux_formas_pagamento_da_nfe_codigo_vivo; create index ux_formas_pagamento_da_nfe_codigo_vivo on ${T} (organization_id, codigo_tpag) where deleted_at is null`, INDICE],
      ["SECURITY DEFINER", "alter function erp.formas_pagamento_da_nfe_forma_guarda() security definer", FUNCAO],
      ["sem search_path", "alter function erp.formas_pagamento_da_nfe_forma_guarda() reset search_path", FUNCAO],
      ["EXECUTE do erp_app", "grant execute on function erp.formas_pagamento_da_nfe_forma_guarda() to erp_app", EXECUTE],
      ["EXECUTE de PUBLIC", "grant execute on function erp.formas_pagamento_da_nfe_forma_guarda() to public", EXECUTE],
      ["guarda desligada", `alter table ${T} disable trigger trg_formas_pagamento_da_nfe_forma`, GATILHOS],
      ["guarda só em réplica", `alter table ${T} enable replica trigger trg_formas_pagamento_da_nfe_forma`, GATILHOS],
      ["guarda só no INSERT", guarda(`before insert on ${T} for each row execute function erp.formas_pagamento_da_nfe_forma_guarda()`), GATILHOS],
      ["guarda com lista de colunas", guarda(`before insert or update of forma_pagamento_id on ${T} for each row execute function erp.formas_pagamento_da_nfe_forma_guarda()`), GATILHOS],
      ["guarda com WHEN", guarda(`before insert or update on ${T} for each row when (new.deleted_at is null) execute function erp.formas_pagamento_da_nfe_forma_guarda()`), GATILHOS],
      ["guarda AFTER", guarda(`after insert or update on ${T} for each row execute function erp.formas_pagamento_da_nfe_forma_guarda()`), GATILHOS],
      ["sem auditoria", `drop trigger trg_formas_pagamento_da_nfe_audit on ${T}`, GATILHOS],
      ["gatilho a mais", `create trigger trg_formas_pagamento_da_nfe_zz after update on ${T} for each row execute function erp.audit_row()`, GATILHOS],
      ["RLS não forçada", `alter table ${T} no force row level security`, RLS],
      ["RLS desligada", `alter table ${T} disable row level security`, RLS],
      ["política a mais", `create policy x04r on ${T} for select to erp_app using (true)`, POLITICA],
      ["política frouxa", `drop policy tenant_isolation on ${T}; create policy tenant_isolation on ${T} for all to erp_app, authenticated using (true) with check (erp.tenant_visible(organization_id))`, POLITICA],
      ["política só do erp_app", `drop policy tenant_isolation on ${T}; create policy tenant_isolation on ${T} for all to erp_app using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id))`, POLITICA],
      ["DELETE do erp_app", `grant delete on ${T} to erp_app`, PRIV],
      ["TRUNCATE do erp_app", `grant truncate on ${T} to erp_app`, PRIV],
      ["TRIGGER do erp_app", `grant trigger on ${T} to erp_app`, PRIV],
      ["REFERENCES do erp_app", `grant references on ${T} to erp_app`, PRIV],
      ["erp_app sem UPDATE", `revoke update on ${T} from erp_app`, PRIV],
      ["erp_app sem INSERT", `revoke insert on ${T} from erp_app`, PRIV]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Contraprova do índice: um índice NÃO único a mais (de leitura) não é "outro índice único".
    const c2 = await db.connect();
    try {
      await c2.query("begin");
      await c2.query(`create index ix_x04r on ${T} (forma_pagamento_id)`);
      await expect(c2.query(pos)).resolves.toBeTruthy();
    } finally { await c2.query("rollback"); c2.release(); }
    // Nada ficou.
    expect((await db.query<{ x: boolean }>("select has_function_privilege('erp_app', 'erp.formas_pagamento_da_nfe_forma_guarda()', 'execute') x")).rows[0]!.x).toBe(false);
    expect((await db.query("select 1 from pg_indexes where schemaname='erp' and tablename='formas_pagamento_da_nfe'")).rowCount).toBe(2);
    expect(diferencas(bancoDepois, await retratoDoBanco()).map((d) => d.texto), "as sabotagens desfeitas não deixaram nada").toEqual([]);
  });

  it("X8 a migration não tem DROP, TRUNCATE, DELETE, UPDATE, ALTER COLUMN ... TYPE, CREATE OR REPLACE nem INSERT de dado, e só cria, altera, comenta e concede o que é dela", () => {
    // O texto sem os comentários de linha (o cabeçalho FALA dessas palavras; o SQL não as executa).
    const codigo = sqlDaAlvo().split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    expect(codigo.length, "a varredura corre sobre o SQL de verdade").toBeGreaterThan(5000);
    expect(codigo.match(/^create\s+(table|function|trigger|policy|unique\s+index)\b/gm), "premissa: o SQL tem os sete comandos de criação").toHaveLength(7);
    const proibidos: [string, RegExp, string][] = [
      ["DROP", /\bdrop\s+(table|index|function|trigger|policy|view|schema|type|role|column|constraint|sequence|extension|owned)\b/i, "alter table erp.x drop column y"],
      ["TRUNCATE", /\btruncate\s+(table\s+)?(only\s+)?[\w"]+\.[\w"]+/i, "truncate erp.formas_pagamento_da_nfe"],
      ["DELETE", /\bdelete\s+from\b/i, "delete from erp.formas_pagamento_da_nfe"],
      ["UPDATE", /\bupdate\s+(only\s+)?[\w."]+\s+set\b/i, "update erp.payment_methods set name = name"],
      ["ALTER COLUMN TYPE", /\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b/i, "alter table erp.x alter column y type int"],
      ["CREATE OR REPLACE", /\bcreate\s+or\s+replace\b/i, "create or replace function erp.f()"],
      ["INSERT", /\binsert\s+into\b/i, "insert into erp.formas_pagamento_da_nfe values (1)"],
      // O valor de sequência fica FORA do retrato do banco (nextval não é transacional: uma escrita desfeita o avança),
      // então mexer nele é vigiado aqui, no texto; o dinâmico cai na lista fechada abaixo.
      ["SETVAL", /\bsetval\s*\(/i, "select setval('erp.audit_logs_id_seq', 1)"]
    ];
    for (const [nome, padrao, amostra] of proibidos) {
      expect([nome, padrao.test(amostra)], "reversa: o padrão pega a amostra").toEqual([nome, true]);
      expect([nome, codigo.match(padrao)?.[0] ?? null]).toEqual([nome, null]);
    }
    // Contraprova do TRUNCATE e do UPDATE: o REVOKE e o gatilho de UPDATE estão no SQL e não são comando de dado.
    expect(codigo).toMatch(/revoke delete, truncate on erp\.formas_pagamento_da_nfe from erp_app/);
    expect(codigo).toMatch(/before insert or update on erp\.formas_pagamento_da_nfe/);

    // O QUE ELA CRIA, ALTERA, COMENTA, CONCEDE, AJUSTA E EXECUTA EM TEXTO: listas FECHADAS, só a tabela nova, a função
    // nova e o que é delas. "alter table" de outra tabela, "create or replace" de função existente, grant em outra
    // tabela, comentário alheio, "set" de outra coisa e SQL dinâmico novo reprovam aqui (e o retrato do banco, em X5,
    // pega o efeito, inclusive do que se esconde em texto). A varredura corre SEM os textos entre aspas — as mensagens
    // das pré-condições falam "CREATE TABLE" —, e o SQL dinâmico, que mora justamente em texto, tem a lista dele.
    const semTextos = codigo.replace(/'(?:[^']|'')*'/g, "''");
    const norm = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "").trim().toLowerCase();
    const varre = {
      cria: /\bcreate\s+(?:or\s+replace\s+)?(?:(?:unique\s+)?index|trigger|policy)\s+\w+\b[^;]*?\bon\s+(?:only\s+)?[\w."]+|\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?\w+\s+(?:if\s+not\s+exists\s+)?[\w."]+(?:\(\))?/gi,
      altera: /\balter\s+\w+\s+(?:if\s+exists\s+)?(?:only\s+)?[\w."]+/gi,
      concede: /\b(?:grant|revoke)\b[^;]*/gi,
      comenta: /\bcomment\s+on\s+\w+\s+[\w."]+(?:\(\))?/gi,
      ajusta: /\bset\s+(?:local\s+|session\s+)?[\w.]+/gi,
      dinamico: /\bexecute\s+(?!function\b|on\b)[^;]*/gi
    };
    const lista = (re: RegExp, texto: string) => [...texto.matchAll(re)].map((m) => norm(m[0]));
    const listas = (texto: string, dinamico: string) => ({
      cria: lista(varre.cria, texto), altera: lista(varre.altera, texto), concede: lista(varre.concede, texto),
      comenta: lista(varre.comenta, texto), ajusta: lista(varre.ajusta, texto), dinamico: lista(varre.dinamico, dinamico)
    });
    // Reversa de cada padrão: a sabotagem de amostra aparece na lista dela.
    const amostras: [keyof typeof varre, string, string][] = [
      ["altera", "alter table erp.products add column x04 text;", "alter table erp.products"],
      ["altera", "alter function erp.set_updated_at() security definer;", "alter function erp.set_updated_at"],
      ["cria", "create or replace function erp.set_updated_at() returns trigger", "create or replace function erp.set_updated_at()"],
      ["cria", "create trigger trg_x after update on erp.products for each row execute function erp.audit_row();", "create trigger trg_x after update on erp.products"],
      ["cria", "create view erp.v_x as select 1;", "create view erp.v_x"],
      ["concede", "grant select on erp.products to anon;", "grant select on erp.products to anon"],
      ["concede", "grant erp_app to anon;", "grant erp_app to anon"],
      ["comenta", "comment on table erp.products is 'x';", "comment on table erp.products"],
      ["ajusta", "set local session_replication_role = replica;", "set local session_replication_role"],
      ["dinamico", "execute 'alter ' || 'table erp.products add column x04 text';", "execute 'alter ' || 'table erp.products add column x04 text'"]
    ];
    for (const [qual, sabotagem, esperado] of amostras) {
      expect([qual, sabotagem, lista(varre[qual], sabotagem)], "reversa: o padrão pega a amostra").toEqual([qual, sabotagem, [esperado]]);
    }
    // O SQL dinâmico é lido COM os textos (o format é o que executa), sem as mensagens de erro e os comentários de
    // catálogo — onde "EXECUTE de …" é frase, não comando.
    const semMensagens = codigo.replace(/\b(raise\s+exception|is)\s+'(?:[^']|'')*'/gi, "$1 ''");
    const T = "erp.formas_pagamento_da_nfe";
    expect(listas(semTextos, semMensagens)).toEqual({
      cria: [
        `create table ${T}`,
        `create unique index ux_formas_pagamento_da_nfe_codigo_vivo on ${T}`,
        "create function erp.formas_pagamento_da_nfe_forma_guarda()",
        `create trigger trg_formas_pagamento_da_nfe_forma before insert or update on ${T}`,
        `create trigger trg_formas_pagamento_da_nfe_updated before update on ${T}`,
        `create trigger trg_formas_pagamento_da_nfe_audit after insert or update or delete on ${T}`,
        `create policy tenant_isolation on ${T}`
      ],
      altera: [`alter table ${T}`, `alter table ${T}`],
      concede: [`grant select, insert, update on ${T} to erp_app`, `revoke delete, truncate on ${T} from erp_app`],
      comenta: [`comment on table ${T}`, ...["id", "organization_id", "codigo_tpag", "forma_pagamento_id", "created_at", "updated_at", "deleted_at"]
        .map((c) => `comment on column ${T}.${c}`), "comment on function erp.formas_pagamento_da_nfe_forma_guarda()"],
      ajusta: ["set local lock_timeout", "set search_path"],
      dinamico: [
        "execute format('revoke execute on function %s from public', r.fn)",
        "execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text)"
      ]
    });
    // O VALOR da espera, não só o nome: o X3 mede o TEMPO e aceita uma desistência entre ~1,9 s e 4 s (achado do cético).
    expect(codigo.match(/set local lock_timeout\s*=\s*'[^']*'/gi), "lock_timeout de 2 s, uma vez só").toEqual(["set local lock_timeout = '2s'"]);
    // E nenhuma OUTRA porta para a espera: o nome só aparece nesse `set local` (os textos contam — um
    // `set_config('lock_timeout', '3s', true)` depois dele passaria pelo X3, que aceita até 4 s; achado do cético, rodada 5).
    expect(codigo.match(/lock_timeout/gi), "o lock_timeout só no set local, sem set_config nem outro set").toEqual(["lock_timeout"]);
    // E o laço do SQL dinâmico só percorre a GUARDA nova (r.fn vem do catálogo, preso à assinatura dela).
    expect(codigo).toMatch(/where p\.oid = 'erp\.formas_pagamento_da_nfe_forma_guarda\(\)'::regprocedure\s+and a\.privilege_type = 'EXECUTE' and a\.grantee <> p\.proowner\s+loop/);
  });
});

describe("a ligação pelo papel da aplicação (RLS, GUC da transação) e pelo dono", () => {
  it("XA1 uma forma por código por organização entre as VIVAS; a excluída libera o código; a mesma forma recebe vários códigos", async () => {
    const pix17 = (await ligar(ctxA(), demo.orgId, "17", formaSistema)).rows[0]!.id;
    // Duas vivas iguais: o índice único parcial recusa (23505, que a API traduz em 409).
    const dup = await erroDe(ligar(ctxA(), demo.orgId, "17", formaSistema2));
    expect([dup.code, dup.message]).toEqual(["23505", expect.stringContaining("ux_formas_pagamento_da_nfe_codigo_vivo")]);
    // A mesma forma com outro código (17 Pix dinâmico e 20 Pix estático → a mesma forma).
    const pix20 = (await ligar(ctxA(), demo.orgId, "20", formaSistema)).rows[0]!.id;
    // O mesmo código em OUTRA organização: o índice é por organização.
    const b17 = (await ligar(ctxB(), orgB, "17", formaSistema)).rows[0]!.id;
    // Excluir (lógica, como o cadastro genérico) libera o código: a nova viva entra, e a excluída fica.
    const excl = await naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set deleted_at = now() where id = $1 and organization_id = $2", [pix17, demo.orgId]));
    expect(excl.rowCount).toBe(1);
    const novo17 = (await ligar(ctxA(), demo.orgId, "17", formaSistema2)).rows[0]!.id;
    // Reviver a excluída com a viva no lugar: recusado pelo mesmo índice.
    const reviver = await erroDe(naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set deleted_at = null where id = $1", [pix17])));
    expect(reviver.code).toBe("23505");
    // O CHECK de dois dígitos (23514, que a API traduz em 422).
    for (const ruim of ["7", "017", "1a", "  ", "PX"]) {
      const e = await erroDe(ligar(ctxA(), demo.orgId, ruim, formaSistema));
      expect([ruim, e.code, e.message]).toEqual([ruim, "23514", expect.stringContaining("chk_formas_pagamento_da_nfe_codigo_tpag")]);
    }
    const linhas = (await db.query<{ org: string; codigo: string; forma: string; vivo: boolean }>(
      `select case when organization_id = $1 then 'A' else 'B' end org, codigo_tpag codigo,
              case when forma_pagamento_id = $2 then 'sistema' else 'sistema2' end forma, deleted_at is null vivo
         from erp.formas_pagamento_da_nfe order by 1, 2, 4, 3`, [demo.orgId, formaSistema])).rows;
    expect(linhas).toEqual([
      { org: "A", codigo: "17", forma: "sistema", vivo: false },
      { org: "A", codigo: "17", forma: "sistema2", vivo: true },
      { org: "A", codigo: "20", forma: "sistema", vivo: true },
      { org: "B", codigo: "17", forma: "sistema", vivo: true }
    ]);
    expect([pix20, b17, novo17].every(Boolean)).toBe(true);
    // A auditoria grava a criação (pela erp.audit_row) com a organização da linha.
    const auditoria = (await db.query<{ organization_id: string; action: string }>(
      "select organization_id, action from erp.audit_logs where entity='formas_pagamento_da_nfe' and entity_id=$1 order by created_at, action", [pix17])).rows;
    expect(auditoria).toEqual([{ organization_id: demo.orgId, action: "create" }, { organization_id: demo.orgId, action: "update" }]);
  });

  it("XA2 a forma é da organização ou do sistema: a de OUTRA organização e a inexistente recebem a MESMA recusa, pelo erp_app e pelo dono", async () => {
    // Aceitas: a do sistema e a da própria organização (o erp_app as vê pela política de erp.payment_methods).
    const propria = (await ligar(ctxA(), demo.orgId, "01", formaA)).rows[0]!.id;
    const doSistema = (await ligar(ctxA(), demo.orgId, "15", formaSistema)).rows[0]!.id;
    expect((await linhaDe(propria))?.forma_pagamento_id).toBe(formaA);
    expect((await linhaDe(doSistema))?.forma_pagamento_id).toBe(formaSistema);
    // Recusadas, com a MESMA mensagem e o MESMO código: a forma da organização B e um uuid que não existe.
    const inexistente = "00000000-0000-4000-8000-000000000064";
    expect((await db.query("select 1 from erp.payment_methods where id = $1", [inexistente])).rowCount, "premissa: não existe").toBe(0);
    const daOutra = await erroDe(ligar(ctxA(), demo.orgId, "03", formaB));
    const naoExiste = await erroDe(ligar(ctxA(), demo.orgId, "03", inexistente));
    expect([daOutra.code, daOutra.message]).toEqual(["P0001", RECUSA_FORMA]);
    expect([naoExiste.code, naoExiste.message], "negar não revela existência").toEqual([daOutra.code, daOutra.message]);
    // A mensagem tem o prefixo que o fromPgError da API transforma em VALIDATION_ERROR (422), nunca 500.
    expect(/^([A-Z_]+):\s*(.*)$/.exec(daOutra.message)?.[1]).toBe("VALIDATION_ERROR");
    // Trocar a forma de uma ligação viva para a da outra organização: recusado; a linha fica como estava.
    const troca = await erroDe(naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set forma_pagamento_id = $2 where id = $1", [propria, formaB])));
    expect([troca.code, troca.message]).toEqual(["P0001", RECUSA_FORMA]);
    expect((await linhaDe(propria))?.forma_pagamento_id).toBe(formaA);
    // A ligação JÁ EXCLUÍDA também confere no INSERT: senão a FK diria se a forma da outra organização existe.
    const morta = await erroDe(ligar(ctxA(), demo.orgId, "04", formaB, "now()"));
    expect([morta.code, morta.message]).toEqual(["P0001", RECUSA_FORMA]);
    // O DONO (sem RLS: vê a forma da outra) recebe a mesma recusa — quem recusa é a comparação, e não a política.
    const c = await db.connect();
    try {
      await c.query("begin");
      const dono = await erroDe(c.query("insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id) values ($1, '05', $2)", [demo.orgId, formaB]));
      expect([dono.code, dono.message]).toEqual(["P0001", RECUSA_FORMA]);
    } finally { await c.query("rollback"); c.release(); }
    // Nada foi gravado pelas recusas.
    expect((await db.query("select 1 from erp.formas_pagamento_da_nfe where codigo_tpag in ('03', '04', '05')")).rowCount).toBe(0);
  });

  it("XA3 excluir nunca é bloqueado: a ligação cuja forma deixou de valer sai; continuar viva ou reviver, não", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      const viva = (await c.query<{ id: string }>("insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id) values ($1, '10', $2) returning id", [demo.orgId, formaA])).rows[0]!.id;
      const outra = (await c.query<{ id: string }>("insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id) values ($1, '11', $2) returning id", [demo.orgId, formaA])).rows[0]!.id;
      // A forma passa a ser de outra organização (ensaio, desfeito no fim): as ligações da A ficaram fora da regra.
      await c.query("update erp.payment_methods set organization_id = $2 where id = $1", [formaA, orgB]);
      // Continuar viva mudando outra coluna: recusado.
      await c.query("savepoint s1");
      const mexer = await erroDe(c.query("update erp.formas_pagamento_da_nfe set codigo_tpag = '12' where id = $1", [viva]));
      expect([mexer.code, mexer.message]).toEqual(["P0001", RECUSA_FORMA]);
      await c.query("rollback to savepoint s1");
      // Excluir: passa (a guarda não confere a linha que fica excluída sem trocar a forma nem a organização).
      expect((await c.query("update erp.formas_pagamento_da_nfe set deleted_at = now() where id = $1", [viva])).rowCount).toBe(1);
      expect((await c.query("update erp.formas_pagamento_da_nfe set deleted_at = now() where id = $1", [outra])).rowCount).toBe(1);
      // Reviver: recusado.
      await c.query("savepoint s2");
      const reviver = await erroDe(c.query("update erp.formas_pagamento_da_nfe set deleted_at = null where id = $1", [viva]));
      expect([reviver.code, reviver.message]).toEqual(["P0001", RECUSA_FORMA]);
      await c.query("rollback to savepoint s2");
      // Trocar a forma da excluída para a da outra organização: recusado (só a exclusão SEM troca passa sem conferir).
      const trocarMorta = await erroDe(c.query("update erp.formas_pagamento_da_nfe set forma_pagamento_id = $2 where id = $1", [outra, formaB]));
      expect([trocarMorta.code, trocarMorta.message]).toEqual(["P0001", RECUSA_FORMA]);
    } finally { await c.query("rollback"); c.release(); }
    expect((await db.query<{ o: string }>("select organization_id::text o from erp.payment_methods where id = $1", [formaA])).rows[0]!.o, "o ensaio foi desfeito").toBe(demo.orgId);
    expect((await db.query("select 1 from erp.formas_pagamento_da_nfe where codigo_tpag in ('10', '11', '12')")).rowCount).toBe(0);
  });

  it("XA4 RLS com o papel da aplicação: a organização A não vê, não altera, não exclui nem grava ligação da B (ROW COUNT conferido); ninguém apaga", async () => {
    const daB = (await db.query<{ id: string }>("select id from erp.formas_pagamento_da_nfe where organization_id = $1 and deleted_at is null", [orgB])).rows;
    expect(daB, "premissa: a B tem ligação viva (XA1)").toHaveLength(1);
    const idB = daB[0]!.id;
    const totalA = (await db.query<{ n: number }>("select count(*)::int n from erp.formas_pagamento_da_nfe where organization_id = $1", [demo.orgId])).rows[0]!.n;
    expect(totalA, "premissa: a A tem ligações").toBeGreaterThanOrEqual(4);
    // Leitura: a A vê só as suas (todas), a B só a sua.
    const vistasA = await naApp(ctxA(), async (tx) => (await tx.query<{ organization_id: string }>("select organization_id from erp.formas_pagamento_da_nfe")).rows);
    expect(vistasA).toHaveLength(totalA);
    expect(vistasA.every((r) => r.organization_id === demo.orgId)).toBe(true);
    const vistasB = await naApp(ctxB(), async (tx) => (await tx.query<{ id: string }>("select id from erp.formas_pagamento_da_nfe")).rows.map((r) => r.id));
    expect(vistasB).toEqual([idB]);
    expect((await naApp(ctxA(), (tx) => tx.query("select 1 from erp.formas_pagamento_da_nfe where id = $1", [idB]))).rowCount).toBe(0);
    // Escrita na linha da B pela A: ZERO linhas (a RLS esconde) — sem conferir o ROW COUNT, isto viraria sucesso sem efeito.
    expect((await naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set codigo_tpag = '99' where id = $1", [idB]))).rowCount).toBe(0);
    expect((await naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set deleted_at = now() where id = $1", [idB]))).rowCount).toBe(0);
    // Gravar ligação COM a organização B no contexto da A (forma do sistema, que a guarda aceita): a RLS recusa.
    const gravarNaB = await erroDe(ligar(ctxA(), orgB, "05", formaSistema));
    expect([gravarNaB.code, gravarNaB.message]).toEqual(["42501", expect.stringContaining("row-level security")]);
    // Mudar a própria ligação (com forma do sistema, que a guarda aceita em qualquer organização) para a B: a RLS recusa.
    const minha = (await db.query<{ id: string }>(
      "select id from erp.formas_pagamento_da_nfe where organization_id = $1 and forma_pagamento_id = $2 and deleted_at is null order by codigo_tpag limit 1",
      [demo.orgId, formaSistema])).rows[0]!.id;
    const mudarOrg = await erroDe(naApp(ctxA(), (tx) => tx.query("update erp.formas_pagamento_da_nfe set organization_id = $2 where id = $1", [minha, orgB])));
    expect(mudarOrg.code).toBe("42501");
    // DELETE físico: nem da própria (a exclusão é lógica).
    const apagar = await erroDe(naApp(ctxA(), (tx) => tx.query("delete from erp.formas_pagamento_da_nfe where id = $1", [minha])));
    expect([apagar.code, apagar.message]).toEqual(["42501", expect.stringContaining("permission denied")]);
    // Sem contexto de organização: nada visível.
    expect((await naApp({ orgId: null, userId: null }, (tx) => tx.query("select 1 from erp.formas_pagamento_da_nfe"))).rowCount).toBe(0);
    // A linha da B está intacta, e a da A também.
    expect(await linhaDe(idB)).toEqual({ organization_id: orgB, codigo_tpag: "17", forma_pagamento_id: formaSistema, vivo: true });
    expect((await linhaDe(minha))?.organization_id).toBe(demo.orgId);
  });

  it("XA5 efeito no cadastro que já existia: a forma da organização que JÁ TEVE ligação (mesmo excluída) não se apaga mais — a FK recusa; a sem ligação se apaga", async () => {
    // Achado do cético, fixado em número: erp.payment_methods não tem exclusão lógica (o cadastro genérico faz DELETE
    // físico), e a ligação excluída fica como histórico (o erp_app não apaga). Então a FK fk_formas_pagamento_da_nfe_forma
    // segura a forma: 23503, que a API devolve como 409. Tudo pelo papel da aplicação, numa transação DESFEITA.
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [demo.orgId, demo.adminUserId]);
      const novaForma = async (nome: string) =>
        (await c.query<{ id: string }>("insert into erp.payment_methods (organization_id, name) values ($1, $2) returning id", [demo.orgId, nome])).rows[0]!.id;
      const comLigacao = await novaForma("[TEST] X04 Forma que já foi ligada");
      const semLigacao = await novaForma("[TEST] X04 Forma nunca ligada");
      const lig = (await c.query<{ id: string }>(
        "insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id) values ($1, '99', $2) returning id", [demo.orgId, comLigacao])).rows[0]!.id;
      expect((await c.query("update erp.formas_pagamento_da_nfe set deleted_at = now() where id = $1 and organization_id = $2", [lig, demo.orgId])).rowCount).toBe(1);
      await c.query("savepoint s1");
      const apagar = await erroDe(c.query("delete from erp.payment_methods where id = $1 and organization_id = $2", [comLigacao, demo.orgId]));
      expect([apagar.code, apagar.message]).toEqual(["23503", expect.stringContaining("fk_formas_pagamento_da_nfe_forma")]);
      await c.query("rollback to savepoint s1");
      expect((await c.query("delete from erp.payment_methods where id = $1 and organization_id = $2", [semLigacao, demo.orgId])).rowCount,
        "a forma sem ligação continua se apagando: 1 linha").toBe(1);
    } finally { await c.query("rollback"); c.release(); }
    expect((await db.query("select 1 from erp.payment_methods where name like '[TEST] X04 Forma %ligada'")).rowCount, "o ensaio foi desfeito").toBe(0);
  });
});
