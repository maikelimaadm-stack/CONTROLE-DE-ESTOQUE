import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type TenantContext, type Tx } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0055 (SAT-06, decisão 297 — o raster de VALORES por pixel da análise satelital: o ARQUIVO no banco e o METADADO, os
 * dois imutáveis), PROVADA CONTRA O BANCO, como o runner aplica (arquivo a arquivo, cada um numa transação), sobre um
 * banco na 0054 COM ACERVO (análises da 0052 nas duas organizações).
 *
 * DB-0 premissa · DB-1 a trava (2026,89) ocupada recusa sem aplicar nada · DB-2 SOBE: nenhuma linha de nenhuma tabela
 * muda, NENHUM objeto existente do catálogo muda (o que aparece é só das tabelas novas), nenhuma tabela existente é
 * regravada; o catálogo das tabelas novas é o do contrato; reaplicar para no preflight ("já aplicada") · DB-3 DESCE pelo
 * SQL reverso com as tabelas vazias (o catálogo volta EXATAMENTE ao da 0054) e SOBE de novo igual; a volta da 0053 passa a
 * exigir a da 0055 antes · DB-4 imutabilidade das duas (UPDATE, DELETE e TRUNCATE recusados, até para o dono) e
 * privilégios (erp_app só SELECT e INSERT) · DB-5 RLS por EMPRESA e por ORGANIZAÇÃO nas duas, como erp_app (leitura e
 * with check; o binário volta íntegro) · DB-6 FKs compostas (metadado sem arquivo, arquivo de outra empresa, hash de OUTRO
 * conteúdo para o mesmo caminho, análise de
 * OUTRA área, de outra empresa, empresa de outra organização → 23503; não adiáveis) · DB-7 unicidade (chave de cache e
 * caminho, por organização) · DB-8 CHECKs (hash que não é do conteúdo, tamanho, forma do caminho, cantos, escala,
 * dimensões, índice, tipo…) · DB-9 auditoria (o metadado sim; o arquivo não, e o binário nunca vai para o log) · DB-10 a
 * volta FAIL-CLOSED: com raster ou arquivo guardado, ou por papel sujeito à RLS, ela para inteira e nada muda.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS, com
 * as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let areaA: string; let areaA2: string; let areaB: string;
let outraOrg: string; let empresaX: string; let areaX: string;
let analiseA: string; let analiseA2: string; let analiseB: string; let analiseX: string;
let usuarioSoB: string; let usuarioSemPecuaria: string; let usuarioListaVazia: string; let donoOutraOrg: string;

const ALVO = "0055_satelite_rasters.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "SAT-06: outra transacao ja detem a trava desta migration (2026,89). Nada foi aplicado.";
const JA = "SAT-06: a 0055 ja foi aplicada ou ha schema divergente (satelite_raster_arquivos/satelite_rasters/satelite_raster_imutavel ja existe).";
const IMUTAVEL = "CONFLICT: O raster satelital registrado (arquivo e metadado) não se altera nem se apaga: um raster novo é registrado ao lado do anterior.";
const POS_CAMINHO = "SAT-06: CHECK chk_satelite_rasters_caminho_coerente de erp.satelite_rasters ausente ou fora do contrato (o caminho tem de sair de organization_id, area_id, indice, data_imagem e chave_cache).";
const VOLTA_COM_DADO = "SAT-06 volta: ha raster ou arquivo guardado em erp.satelite_rasters/erp.satelite_raster_arquivos; imagem guardada nao se apaga (decisao 247) e o que fazer com ela e decisao humana. Nada foi desfeito.";
const VOLTA_SEM_BYPASS = "SAT-06 volta: quem desfaz a 0055 precisa atravessar a RLS (superusuario ou BYPASSRLS): com a RLS forcada, um papel sujeito a ela veria as tabelas vazias e apagaria imagens guardadas. Nada foi desfeito.";
const TABELAS_NOVAS = ["satelite_raster_arquivos", "satelite_rasters"] as const;
type TabelaNova = (typeof TABELAS_NOVAS)[number];
const MIB16 = 16 * 1024 * 1024;

/**
 * O CAMINHO INVERSO DA 0055. O repositório é forward-only (não há arquivo de descida em supabase/migrations): este SQL
 * existe para PROVAR que a 0055 é reversível e que a volta é exatamente esta — e é o que se aplicaria, por decisão
 * humana, para desfazê-la. Nenhuma tabela existente é tocada (a 0055 não alterou nenhuma). Sem CASCADE de propósito:
 * dependência que ninguém previu faz a volta falhar alto.
 */
const SQL_REVERSO = `
  -- 0) FAIL-CLOSED. Quem desfaz precisa enxergar TUDO: com a RLS forçada, um papel sujeito a ela (sem GUC) veria as duas
  --    tabelas vazias, passaria na conferência abaixo e apagaria imagens guardadas.
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
      raise exception 'SAT-06 volta: quem desfaz a 0055 precisa atravessar a RLS (superusuario ou BYPASSRLS): com a RLS forcada, um papel sujeito a ela veria as tabelas vazias e apagaria imagens guardadas. Nada foi desfeito.';
    end if;
  end $$;
  -- 1) As duas tabelas travadas ANTES de conferir: entre a conferência e o drop, nenhuma gravação nova entra.
  lock table erp.satelite_rasters, erp.satelite_raster_arquivos in access exclusive mode;
  -- 2) Imagem guardada não se apaga (decisão 247): com qualquer linha em qualquer das duas, a volta para inteira.
  do $$
  begin
    if exists (select 1 from erp.satelite_raster_arquivos) or exists (select 1 from erp.satelite_rasters) then
      raise exception 'SAT-06 volta: ha raster ou arquivo guardado em erp.satelite_rasters/erp.satelite_raster_arquivos; imagem guardada nao se apaga (decisao 247) e o que fazer com ela e decisao humana. Nada foi desfeito.';
    end if;
  end $$;
  -- 3) As tabelas, a dependente primeiro (os gatilhos, índices, políticas, comentários e FKs delas vão junto; DROP não
  --    aciona o gatilho de TRUNCATE), e a função de imutabilidade, que só elas usavam.
  drop table erp.satelite_rasters;
  drop table erp.satelite_raster_arquivos;
  drop function erp.satelite_raster_imutavel();
  -- 4) O ledger de migrations: a 0055 deixa de constar, e o runner a aplicaria de novo.
  delete from public.erp_migrations where name = '${ALVO}';
`;

const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
const CANTOS = [[-56.1004, -15.5896], [-56.0896, -15.5896], [-56.0896, -15.6004], [-56.1004, -15.6004]];
const DIA = 86_400_000;
const DATA = "2026-08-11";

async function id1(sql: string, p: unknown[] = []) { return (await db.query<{ id: string }>(sql, p)).rows[0]!.id; }
interface Erro { code?: string; constraint?: string; detail?: string; message: string }
async function erroDe(p: Promise<unknown>): Promise<Erro> {
  try { await p; } catch (e) { const x = e as Erro; return { code: x.code, constraint: x.constraint, detail: x.detail, message: x.message }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const chaveNova = () => sha(randomUUID());
const hashDe = async (areaId: string) =>
  (await db.query<{ h: string }>("select encode(sha256(convert_to(geometria::text,'UTF8')),'hex') h from erp.areas where id=$1", [areaId])).rows[0]!.h;
const ctxPec = (userId: string, orgId = demo.orgId): TenantContext => ({ orgId, userId, modulo: "pecuaria" });
/** Um "PNG" de teste: a assinatura e bytes aleatórios (o banco confere hash e tamanho, não o formato). */
const pngDeTeste = (n = 64) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(n)]);
const caminho = (org: string, area: string, data: string, chave: string) => `${org}/${area}/ndvi/${data}/${chave}.png`;

/** Roda fn numa transação DESFEITA no fim (as tabelas novas são imutáveis: o que o teste grava ali não fica). */
async function desfeita<T>(pool: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); return await fn(c); } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
/** A recusa esperada dentro de uma transação: o savepoint devolve a transação ao estado de antes. */
async function recusaNo(c: Tx, p: () => Promise<unknown>): Promise<Erro> {
  await c.query("savepoint s");
  try { return await erroDe(p()); } finally { await c.query("rollback to savepoint s"); }
}

// ---------- montagem de linhas ----------
type Linha = Record<string, unknown>;
/** Insere uma linha numa das tabelas novas. Os nomes de coluna vêm só deste arquivo (nunca de entrada). */
function inserir(q: Queryable, tabela: TabelaNova, linha: Linha) {
  const cols = Object.keys(linha);
  return q.query<{ id: string }>(
    `insert into erp.${tabela} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(linha));
}
/** O arquivo, coerente: caminho na forma do contrato, hash e tamanho do conteúdo. */
function linhaArquivo(empresa: string, area: string, o: { org?: string; data?: string; chave?: string; conteudo?: Buffer } = {}): Linha {
  const org = o.org ?? demo.orgId;
  const conteudo = o.conteudo ?? pngDeTeste();
  return { organization_id: org, empresa_id: empresa, storage_path: caminho(org, area, o.data ?? DATA, o.chave ?? chaveNova()), conteudo,
    sha256_arquivo: sha(conteudo), tamanho_bytes: conteudo.length };
}
/** O metadado do arquivo dado (mesma organização, empresa, caminho, hash, dia e chave de cache), da análise dada. */
function linhaRaster(arq: Linha, area: string, analise: string, extra: Linha = {}): Linha {
  const storagePath = arq.storage_path as string;
  const [, , , data, nome] = storagePath.split("/");
  return {
    organization_id: arq.organization_id, empresa_id: arq.empresa_id, area_id: area, analise_id: analise,
    geometria_sha256: sha(`geometria-${area}`), indice: "ndvi", tipo: "valores", versao_evalscript: "ndvi-valores-v1", data_imagem: data,
    storage_path: storagePath, sha256_arquivo: arq.sha256_arquivo, largura: 120, altura: 80,
    bbox_min_x: "-6245718.25", bbox_min_y: "-1759672.5", bbox_max_x: "-6244518.25", bbox_max_y: "-1758872.5",
    cantos_lnglat: JSON.stringify(CANTOS), escala_min: "-0.2", escala_max: "1.0", resolucao_m: 10,
    chave_cache: nome!.replace(/\.png$/, ""), pu_gasto: "0.0123", criado_por: demo.adminUserId, ...extra
  };
}
/** Arquivo + metadado, gravados em q. */
async function par(q: Queryable, empresa: string, area: string, analise: string, org?: string) {
  const arq = linhaArquivo(empresa, area, { org });
  const arquivo = (await inserir(q, "satelite_raster_arquivos", arq)).rows[0]!.id;
  const raster = (await inserir(q, "satelite_rasters", linhaRaster(arq, area, analise))).rows[0]!.id;
  return { arquivo, raster, arq };
}

/** Uma análise da 0052 pela via que o gatilho de conferência aceita (área viva, com polígono, hash de agora). */
async function inserirAnalise(org: string, empresa: string, area: string, janelaInicio: string) {
  const ini = new Date(janelaInicio);
  return id1(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
       janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim, valor_medio, valor_minimo, valor_maximo,
       desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, metadados_provedor, criado_por)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi','ndvi-v2',$4,$5,$6,10,'concluida',$7,$8,'0.7200','0.3100','0.8800','0.0900',
       4934,406,4528,4900,'0.9241','{"intervalos_recebidos":3}',$9) returning id`,
    [org, empresa, area, await hashDe(area), ini, new Date(ini.getTime() + 30 * DIA), new Date(ini.getTime() + 10 * DIA),
      new Date(ini.getTime() + 11 * DIA), demo.adminUserId]);
}

// ---------- retrato do catálogo (schema erp inteiro) e dos dados — o mesmo da 0053/0054 ----------
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
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') || ' storage=' || a.attstorage::text v
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'erp' and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,
  restricoes: `
    select coalesce(c.relname, t.typname) || '.' || k.conname k,
           k.contype::text || ' ' || pg_get_constraintdef(k.oid) || ' validada=' || k.convalidated || ' adiavel=' || k.condeferrable v
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
async function reverterComoHumano(): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(SQL_REVERSO);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally { c.release(); }
}
const filenode = async (t: string) => (await db.query<{ f: string }>("select pg_relation_filenode($1::regclass)::text f", [t])).rows[0]!.f;
const EXISTENTES_REFERENCIADAS = ["erp.organizations", "erp.empresas", "erp.users", "erp.analises_satelitais"];

// Estado de ANTES da 0055, guardado para a subida (DB-2) e para a descida (DB-3).
let catalogo0054: Retrato; let catalogo0055: Retrato;
let colunas0054: Record<string, string[]>; let dados0054: Secao;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(URL_APP, { max: 4 });

  // O ACERVO antes da 0055: organização demo (empresas A e B), outra organização, áreas com polígono — duas na MESMA
  // empresa A, para o vínculo errado de ÁREA — e uma análise por área, pela via que o gatilho de conferência aceita.
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  const area = (empresa: string, code: string, org = demo.orgId) =>
    id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
         values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] SAT6 ${code}`, JSON.stringify(POLIGONO)]);
  areaA = await area(A, "SAT6-A");
  areaA2 = await area(A, "SAT6-A2");
  areaB = await area(B, "SAT6-B");
  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT6','outra-sat6') returning id");
  empresaX = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 97, '[TEST] Empresa outra org SAT6') returning id", [outraOrg]);
  areaX = await area(empresaX, "SAT6-X", outraOrg);
  analiseA = await inserirAnalise(demo.orgId, A, areaA, "2026-08-01T00:00:00Z");
  analiseA2 = await inserirAnalise(demo.orgId, A, areaA2, "2026-08-01T00:00:00Z");
  analiseB = await inserirAnalise(demo.orgId, B, areaB, "2026-08-01T00:00:00Z");
  analiseX = await inserirAnalise(outraOrg, empresaX, areaX, "2026-08-01T00:00:00Z");

  // Membros: só B no módulo da área; escopo só em OUTRO módulo; módulo da área com lista vazia; dono da outra org.
  const membro = async (email: string, org = demo.orgId, dono = false) => {
    const user = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [email, `[TEST] ${email}`]);
    const m = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,$3,true) returning id", [org, user, dono]);
    return { user, m };
  };
  const soB = await membro("sat6-so-b@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, soB.m]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, soB.m, B]);
  usuarioSoB = soB.user;
  const semPec = await membro("sat6-sem-pecuaria@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'financeiro','todas')", [demo.orgId, semPec.m]);
  usuarioSemPecuaria = semPec.user;
  const vazia = await membro("sat6-lista-vazia@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, vazia.m]);
  usuarioListaVazia = vazia.user;
  donoOutraOrg = (await membro("sat6-dono-outra@demo.local", outraOrg, true)).user;
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-0 a DB-2 — a 0055 sobre o banco na 0054 com acervo: premissa, trava, subida e reaplicação", () => {
  it("DB-0 PREMISSA: o ledger termina na 0054, há análises nas duas organizações, e nada da 0055 existe", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0054_satelite_executor.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: "0054_satelite_executor.sql" });
    expect((await db.query<{ org: string }>("select distinct organization_id::text org from erp.analises_satelitais")).rows.map((r) => r.org).sort())
      .toEqual([demo.orgId, outraOrg].sort());
    for (const t of TABELAS_NOVAS) expect((await db.query<{ t: string | null }>("select to_regclass($1)::text t", [`erp.${t}`])).rows[0]!.t, t).toBeNull();
    expect((await db.query<{ f: string | null }>("select to_regprocedure('erp.satelite_raster_imutavel()')::text f")).rows[0]!.f).toBeNull();
  });

  it("DB-1 TRAVA: com (2026,89) ocupada por outra sessão, a 0055 recusa sem aplicar nada", async () => {
    const outra = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 89)");
      const c = await db.connect();
      try {
        await c.query("begin");
        expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
      } finally { await c.query("rollback").catch(() => {}); c.release(); }
    } finally { await outra.query("rollback").catch(() => {}); outra.release(); }
    expect((await db.query<{ t: string | null }>("select to_regclass('erp.satelite_rasters')::text t")).rows[0]!.t).toBeNull();
  });

  it("DB-2 (a) SOBE como o runner: NENHUMA linha muda, NENHUM objeto existente do catálogo muda (só aparecem os das tabelas novas), nada é regravado", async () => {
    catalogo0054 = await retratoCatalogo();
    colunas0054 = await colunasPorTabela();
    dados0054 = await retratoDados(colunas0054);
    const nodes = Object.fromEntries(await Promise.all(EXISTENTES_REFERENCIADAS.map(async (t) => [t, await filenode(t)] as const)));
    // Premissa do retrato: não vazio, e com o acervo que a comparação precisa enxergar.
    expect(Object.keys(dados0054).length).toBeGreaterThan(150);
    expect(dados0054.analises_satelitais).toMatch(/^linhas=4 /);
    expect(Object.keys(catalogo0054.colunas!).length).toBeGreaterThan(1000);

    await aplicarComoORunner();
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    catalogo0055 = await retratoCatalogo();

    // Todo objeto que existia continua EXATAMENTE igual (nada removido, nada alterado), e o que é novo é só da 0055.
    const novos: string[] = [];
    for (const [secao, antes] of Object.entries(catalogo0054)) {
      const depois = catalogo0055[secao]!;
      for (const [k, v] of Object.entries(antes)) expect([secao, k, depois[k]]).toEqual([secao, k, v]);
      for (const k of Object.keys(depois)) if (!(k in antes)) novos.push(`${secao}: ${k}`);
    }
    expect(novos.filter((k) => !/satelite_raster/.test(k)), "objeto novo fora das tabelas da 0055").toEqual([]);
    expect(novos.length, "premissa: a 0055 criou objetos que o retrato enxerga").toBeGreaterThan(60);
    for (const secao of ["relacoes", "colunas", "restricoes", "indices", "funcoes", "gatilhos", "politicas", "privilegios_relacoes", "comentarios", "ledger"]) {
      expect(novos.some((k) => k.startsWith(`${secao}: `)), `premissa: há objeto novo na seção ${secao}`).toBe(true);
    }

    // Os dados de TODAS as tabelas que existiam: idênticos (nenhuma escrita, nem auditoria). As novas nascem vazias.
    expect(await retratoDados(colunas0054)).toEqual(dados0054);
    for (const t of TABELAS_NOVAS) expect((await db.query(`select 1 from erp.${t}`)).rowCount, t).toBe(0);
    // FK numa tabela NOVA não regrava nem altera a referenciada: o arquivo físico de cada uma é o mesmo.
    for (const t of EXISTENTES_REFERENCIADAS) expect(await filenode(t), `${t} não foi regravada`).toBe(nodes[t]);
  });

  it("DB-2 (b) catálogo das tabelas novas: colunas, FKs compostas (não adiáveis), chaves únicas, CHECKs, índice, RLS forçada com a política da 0052, gatilhos", async () => {
    const colunas = async (t: TabelaNova) => (await db.query<{ c: string }>(
      `select a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end c
         from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [`erp.${t}`])).rows.map((r) => r.c);
    expect(await colunas("satelite_raster_arquivos")).toEqual([
      "id uuid not null", "organization_id uuid not null", "empresa_id uuid not null", "storage_path text not null", "conteudo bytea not null",
      "sha256_arquivo text not null", "tamanho_bytes integer not null", "created_at timestamp with time zone not null"]);
    expect(await colunas("satelite_rasters")).toEqual([
      "id uuid not null", "organization_id uuid not null", "empresa_id uuid not null", "area_id uuid not null", "analise_id uuid not null",
      "geometria_sha256 text not null", "indice text not null", "tipo text not null", "versao_evalscript text not null", "data_imagem date not null",
      "storage_path text not null", "sha256_arquivo text not null", "largura integer not null", "altura integer not null",
      "bbox_min_x numeric not null", "bbox_min_y numeric not null", "bbox_max_x numeric not null", "bbox_max_y numeric not null",
      "cantos_lnglat jsonb not null", "escala_min numeric not null", "escala_max numeric not null", "resolucao_m integer not null",
      "chave_cache text not null", "pu_gasto numeric(14,4)", "criado_por uuid not null", "created_at timestamp with time zone not null"]);

    // FKs: origem → alvo, coluna a coluna, sem cascata, validadas e NÃO adiáveis (o metadado antes do arquivo é recusado
    // na hora, mesmo que o arquivo viesse depois na mesma transação).
    const fks = (await db.query<{ f: string }>(
      `select c.conrelid::regclass::text || '(' || (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || ') -> ' || c.confrelid::regclass::text || '('
              || (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) || ') ' || c.confdeltype::text || c.confupdtype::text
              || ' validada=' || c.convalidated || ' adiavel=' || c.condeferrable f
         from pg_constraint c where c.contype = 'f' and c.conrelid in ('erp.satelite_raster_arquivos'::regclass, 'erp.satelite_rasters'::regclass)
        order by 1`)).rows.map((r) => r.f.replace(/\berp\./g, ""));
    expect(fks).toEqual([
      "satelite_raster_arquivos(organization_id) -> organizations(id) aa validada=true adiavel=false",
      "satelite_raster_arquivos(organization_id,empresa_id) -> empresas(organization_id,id) aa validada=true adiavel=false",
      "satelite_rasters(criado_por) -> users(id) aa validada=true adiavel=false",
      "satelite_rasters(organization_id) -> organizations(id) aa validada=true adiavel=false",
      "satelite_rasters(organization_id,empresa_id) -> empresas(organization_id,id) aa validada=true adiavel=false",
      "satelite_rasters(organization_id,empresa_id,area_id,analise_id) -> analises_satelitais(organization_id,empresa_id,area_id,id) aa validada=true adiavel=false",
      "satelite_rasters(organization_id,empresa_id,storage_path,sha256_arquivo) -> satelite_raster_arquivos(organization_id,empresa_id,storage_path,sha256_arquivo) aa validada=true adiavel=false"
    ]);

    const restricoes = (await db.query<{ t: string; n: string; tipo: string }>(
      `select c.conrelid::regclass::text t, c.conname n, c.contype::text tipo from pg_constraint c
        where c.conrelid in ('erp.satelite_raster_arquivos'::regclass, 'erp.satelite_rasters'::regclass) and c.contype in ('u', 'c') and c.convalidated
        order by 1, 3, 2`)).rows.map((r) => `${r.t.replace(/^erp\./, "")} ${r.tipo} ${r.n}`);
    expect(restricoes).toEqual([
      "satelite_raster_arquivos c chk_satelite_raster_arquivos_sha256",
      "satelite_raster_arquivos c chk_satelite_raster_arquivos_storage_path",
      "satelite_raster_arquivos c chk_satelite_raster_arquivos_tamanho",
      "satelite_raster_arquivos c chk_satelite_raster_arquivos_tamanho_bytes",
      "satelite_raster_arquivos u satelite_raster_arquivos_org_empresa_caminho_key",
      "satelite_raster_arquivos u satelite_raster_arquivos_org_empresa_caminho_sha_key",
      "satelite_raster_arquivos u uq_satelite_raster_arquivos_caminho",
      ...["altura", "bbox", "caminho_coerente", "cantos", "chave_cache", "escala", "geometria_sha256", "indice", "largura", "pu_gasto", "resolucao", "sha256_arquivo", "tipo"]
        .map((n) => `satelite_rasters c chk_satelite_rasters_${n}`),
      "satelite_rasters u uq_satelite_rasters_chave_cache"
    ]);
    const unicos = (await db.query<{ i: string }>(
      `select regexp_replace(pg_get_indexdef(i.indexrelid), ' ON (erp\\.)?', ' ON ') i from pg_index i
        where i.indrelid in ('erp.satelite_raster_arquivos'::regclass, 'erp.satelite_rasters'::regclass) and not i.indisprimary order by 1`)).rows.map((r) => r.i);
    expect(unicos).toEqual([
      "CREATE INDEX ix_satelite_rasters_area_recente ON satelite_rasters USING btree (organization_id, empresa_id, area_id, indice, data_imagem DESC, created_at DESC)",
      "CREATE UNIQUE INDEX satelite_raster_arquivos_org_empresa_caminho_key ON satelite_raster_arquivos USING btree (organization_id, empresa_id, storage_path)",
      "CREATE UNIQUE INDEX satelite_raster_arquivos_org_empresa_caminho_sha_key ON satelite_raster_arquivos USING btree (organization_id, empresa_id, storage_path, sha256_arquivo)",
      "CREATE UNIQUE INDEX uq_satelite_raster_arquivos_caminho ON satelite_raster_arquivos USING btree (organization_id, storage_path)",
      "CREATE UNIQUE INDEX uq_satelite_rasters_chave_cache ON satelite_rasters USING btree (organization_id, chave_cache)"
    ]);

    // RLS habilitada e forçada; UMA política, texto a texto a de erp.analises_satelitais (0052).
    for (const t of TABELAS_NOVAS) {
      expect((await db.query<{ ok: boolean }>("select relrowsecurity and relforcerowsecurity ok from pg_class where oid = $1::regclass", [`erp.${t}`])).rows[0]!.ok, t).toBe(true);
      const p = (await db.query<{ n: string; igual: boolean }>(
        `select p.policyname n, (p.cmd = 'ALL' and p.permissive = 'PERMISSIVE' and p.qual = r.qual and p.with_check = r.with_check and p.roles = r.roles) igual
           from pg_policies p join pg_policies r on r.schemaname = 'erp' and r.tablename = 'analises_satelitais' and r.policyname = 'tenant_e_empresa'
          where p.schemaname = 'erp' and p.tablename = $1`, [t])).rows;
      expect(p, t).toEqual([{ n: "tenant_e_empresa", igual: true }]);
    }

    // Gatilhos: imutabilidade por linha (UPDATE/DELETE) e por comando (TRUNCATE) nas duas; auditoria SÓ no metadado.
    const gatilhos = (await db.query<{ g: string }>(
      `select c.relname || ' ' || t.tgname || ' ' || t.tgtype || ' ' || p.proname || ' ' || t.tgenabled::text g
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and t.tgrelid in ('erp.satelite_raster_arquivos'::regclass, 'erp.satelite_rasters'::regclass) order by 1`)).rows.map((r) => r.g);
    expect(gatilhos).toEqual([
      "satelite_raster_arquivos trg_satelite_raster_arquivos_imutavel 27 satelite_raster_imutavel O",
      "satelite_raster_arquivos trg_satelite_raster_arquivos_imutavel_truncate 34 satelite_raster_imutavel O",
      "satelite_rasters trg_satelite_rasters_audit 5 audit_row O",
      "satelite_rasters trg_satelite_rasters_imutavel 27 satelite_raster_imutavel O",
      "satelite_rasters trg_satelite_rasters_imutavel_truncate 34 satelite_raster_imutavel O"
    ]);
    const f = (await db.query<{ secdef: boolean; config: string[]; pub: boolean; app: boolean }>(
      `select p.prosecdef secdef, p.proconfig config, has_function_privilege('public', p.oid, 'execute') pub, has_function_privilege('erp_app', p.oid, 'execute') app
         from pg_proc p where p.oid = 'erp.satelite_raster_imutavel()'::regprocedure`)).rows[0];
    expect(f).toEqual({ secdef: false, config: ["search_path=erp, pg_temp"], pub: false, app: false });
  });

  it("DB-2 (c) reaplicar a 0055 já aplicada para no preflight, com a mensagem de 'já aplicada', sem mudar o catálogo", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      expect((await erroDe(c.query(SQL_ALVO))).message).toBe(JA);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0055);
  });
});

describe("DB-3 — a 0055 DESCE pelo SQL reverso (tabelas vazias) e SOBE de novo; a ordem da volta com a 0053", () => {
  it("FAIL-CLOSED já com UM arquivo sem metadado (o caso da gravação que parou no meio): a volta para (P0001) e nada muda", async () => {
    await desfeita(db, async (c) => {
      expect((await inserir(c, "satelite_raster_arquivos", linhaArquivo(A, areaA))).rowCount).toBe(1);
      expect((await c.query("select 1 from erp.satelite_rasters")).rowCount, "premissa: nenhum metadado").toBe(0);
      const e = await erroDe(c.query(SQL_REVERSO));
      expect([e.code, e.message]).toEqual(["P0001", VOLTA_COM_DADO]);
    });
    expect(await retratoCatalogo()).toEqual(catalogo0055);
  });

  it("o SQL reverso volta o catálogo EXATAMENTE ao da 0054; os dados das tabelas existentes não mudam; a 0055 reaplica com o mesmo catálogo", async () => {
    expect(catalogo0055).not.toEqual(catalogo0054);
    await reverterComoHumano();
    // A 0055 volta no FINALLY: uma asserção que falhe aqui não deixa os testes seguintes sem as tabelas.
    try {
      expect(await retratoCatalogo()).toEqual(catalogo0054);
      expect((await db.query<{ name: string }>("select name from public.erp_migrations order by name")).rows.map((r) => r.name)).toEqual(ANTERIORES.map((m) => m.name));
      expect(await retratoDados(colunas0054)).toEqual(dados0054);

      // Com as tabelas fora (o preflight passa), a MESMA 0055 SEM o CHECK do caminho — e com ele enfraquecido, sem olhar
      // data_imagem — para na pós-condição nomeada, e nada fica aplicado.
      const semCheck = SQL_ALVO.replace(/,\n(?:  --[^\n]*\n)*  constraint chk_satelite_rasters_caminho_coerente check \([\s\S]*?\n  \)\n\);/, "\n);");
      const enfraquecido = SQL_ALVO.replace("to_char(data_imagem::timestamp, 'YYYY-MM-DD')", "split_part(storage_path, '/', 4)");
      expect(semCheck).not.toMatch(/constraint chk_satelite_rasters_caminho_coerente check/);
      expect(enfraquecido).not.toBe(SQL_ALVO);
      for (const [nome, sql] of [["sem o CHECK", semCheck], ["CHECK sem data_imagem", enfraquecido]] as const) {
        const c = await db.connect();
        try {
          await c.query("begin");
          expect([nome, (await erroDe(c.query(sql))).message]).toEqual([nome, POS_CAMINHO]);
        } finally { await c.query("rollback").catch(() => {}); c.release(); }
      }
      expect(await retratoCatalogo(), "nada da tentativa ficou").toEqual(catalogo0054);
    } finally {
      if ((await db.query("select 1 from public.erp_migrations where name = $1", [ALVO])).rowCount === 0) await aplicarComoORunner();
    }
    expect(await retratoCatalogo()).toEqual(catalogo0055);
  });

  it("a volta da 0053 passa a exigir a da 0055 antes: a chave da análise que a FK do raster usa não sai (2BP01)", async () => {
    await desfeita(db, async (c) => {
      // O que a volta da 0053 faz antes (a FK do item da fila sai com a tabela de itens), e depois a chave: o raster segura.
      await c.query("alter table erp.satelite_consulta_itens drop constraint fk_satelite_consulta_itens_analise");
      const e = await erroDe(c.query("alter table erp.analises_satelitais drop constraint analises_satelitais_org_empresa_area_key"));
      expect([e.code, /fk_satelite_rasters_analise on table erp\.satelite_rasters/.test(e.detail ?? "")]).toEqual(["2BP01", true]);
    });
  });
});

describe("DB-4 — imutabilidade das duas tabelas (até para o dono) e privilégios do erp_app", () => {
  let arquivo: string; let raster: string; let arq: Linha;
  beforeAll(async () => { ({ arquivo, raster, arq } = await par(db, A, areaA, analiseA)); });

  it("UPDATE e DELETE recusados nas duas pelo dono do schema; TRUNCATE do metadado recusado; o do arquivo para na FK (0A000) e, com CASCADE, no gatilho; nada muda", async () => {
    const antes = await retratoDados({ satelite_raster_arquivos: ["id", "storage_path", "conteudo", "sha256_arquivo", "tamanho_bytes", "created_at"],
      satelite_rasters: ["id", "storage_path", "largura", "chave_cache", "pu_gasto", "created_at"] });
    const outro = pngDeTeste();
    const casos: [string, string, unknown[]][] = [
      ["update do conteúdo (com hash e tamanho coerentes)", "update erp.satelite_raster_arquivos set conteudo=$2, sha256_arquivo=$3, tamanho_bytes=$4 where id=$1", [arquivo, outro, sha(outro), outro.length]],
      ["update que não muda nada no arquivo", "update erp.satelite_raster_arquivos set created_at = created_at where id=$1", [arquivo]],
      ["delete do arquivo", "delete from erp.satelite_raster_arquivos where id=$1", [arquivo]],
      ["update do metadado", "update erp.satelite_rasters set largura = 121 where id=$1", [raster]],
      ["update do pu", "update erp.satelite_rasters set pu_gasto = null where id=$1", [raster]],
      ["delete do metadado", "delete from erp.satelite_rasters where id=$1", [raster]],
      ["truncate do metadado", "truncate erp.satelite_rasters", []],
      ["truncate do arquivo com cascade", "truncate erp.satelite_raster_arquivos cascade", []]
    ];
    for (const [nome, sql, p] of casos) expect([nome, (await erroDe(db.query(sql, p))).message]).toEqual([nome, IMUTAVEL]);
    const truncar = await erroDe(db.query("truncate erp.satelite_raster_arquivos"));
    expect([truncar.code, truncar.message]).toEqual(["0A000", "cannot truncate a table referenced in a foreign key constraint"]);
    expect(await retratoDados({ satelite_raster_arquivos: ["id", "storage_path", "conteudo", "sha256_arquivo", "tamanho_bytes", "created_at"],
      satelite_rasters: ["id", "storage_path", "largura", "chave_cache", "pu_gasto", "created_at"] })).toEqual(antes);
    expect((await db.query<{ ok: boolean }>("select conteudo = $2 ok from erp.satelite_raster_arquivos where id=$1", [arquivo, arq.conteudo])).rows[0]!.ok).toBe(true);
  });

  it("erp_app: SELECT e INSERT nas duas; sem UPDATE, DELETE e TRUNCATE (42501 na tentativa); authenticated e anon sem nada", async () => {
    const priv = (await db.query<{ p: string }>(
      `select t || ' ' || papel || ' ' || string_agg(x, ',' order by x) p
         from unnest(array['erp.satelite_raster_arquivos', 'erp.satelite_rasters']) t
        cross join unnest(array['erp_app', 'authenticated', 'anon']) papel
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x
        where has_table_privilege(papel, t, x) group by t, papel order by 1`)).rows.map((r) => r.p);
    expect(priv).toEqual(["erp.satelite_raster_arquivos erp_app INSERT,SELECT", "erp.satelite_rasters erp_app INSERT,SELECT"]);
    const dono = ctxPec(demo.adminUserId);
    const casos: [string, unknown[]][] = [
      ["update erp.satelite_raster_arquivos set created_at = created_at where id=$1", [arquivo]], ["delete from erp.satelite_raster_arquivos where id=$1", [arquivo]],
      ["truncate erp.satelite_raster_arquivos", []], ["update erp.satelite_rasters set largura = 1 where id=$1", [raster]],
      ["delete from erp.satelite_rasters where id=$1", [raster]], ["truncate erp.satelite_rasters", []]
    ];
    for (const [sql, p] of casos) expect([sql, (await erroDe(withTx(app, dono, (tx) => tx.query(sql, p)))).code]).toEqual([sql, "42501"]);
  });

  it("arquivo SEM metadado é aceito (a gravação do arquivo vem antes; se a do metadado falhar, ele fica — e nunca é apagado)", async () => {
    const sozinho = (await withTx(app, ctxPec(demo.adminUserId), (tx) => inserir(tx, "satelite_raster_arquivos", linhaArquivo(A, areaA))));
    expect(sozinho.rowCount).toBe(1);
    expect((await db.query("select 1 from erp.satelite_rasters r join erp.satelite_raster_arquivos a on a.storage_path = r.storage_path where a.id=$1", [sozinho.rows[0]!.id])).rowCount).toBe(0);
  });
});

describe("DB-5 — RLS por empresa e por organização nas duas tabelas, como erp_app", () => {
  const ids: Record<TabelaNova, { A: string; B: string; X: string }> = {} as Record<TabelaNova, { A: string; B: string; X: string }>;
  const todos = (t: TabelaNova) => [ids[t].A, ids[t].B, ids[t].X];
  const ler = (ctx: TenantContext, t: TabelaNova) =>
    withTx(app, ctx, async (tx) => (await tx.query<{ id: string }>(`select id from erp.${t} where id = any($1::uuid[])`, [todos(t)])).rows.map((r) => r.id).sort());
  let arqB: Linha;

  beforeAll(async () => {
    const a = await par(db, A, areaA, analiseA);
    const b = await par(db, B, areaB, analiseB);
    const x = await par(db, empresaX, areaX, analiseX, outraOrg);
    arqB = b.arq;
    ids.satelite_raster_arquivos = { A: a.arquivo, B: b.arquivo, X: x.arquivo };
    ids.satelite_rasters = { A: a.raster, B: b.raster, X: x.raster };
  });

  it("PREMISSA: as linhas existem (superusuário vê as três de cada tabela); o DONO da demo vê A e B, nunca a outra organização", async () => {
    for (const t of TABELAS_NOVAS) {
      expect((await db.query(`select 1 from erp.${t} where id = any($1::uuid[])`, [todos(t)])).rowCount, t).toBe(3);
      expect(await ler(ctxPec(demo.adminUserId), t), t).toEqual([ids[t].A, ids[t].B].sort());
    }
  });

  it("POR ORGANIZAÇÃO: membro de OUTRA organização vê só a dele; sem GUC nenhuma, nada", async () => {
    for (const t of TABELAS_NOVAS) {
      expect(await ler(ctxPec(donoOutraOrg, outraOrg), t), t).toEqual([ids[t].X]);
      expect(await ler({ orgId: null, userId: null }, t), `${t}: sem GUC`).toEqual([]);
    }
  });

  it("POR EMPRESA: sem escopo no módulo da área não vê nada (escopo 'todas' em outro módulo, lista vazia); escopo só em B vê só B", async () => {
    for (const t of TABELAS_NOVAS) {
      expect(await ler(ctxPec(usuarioSemPecuaria), t), `${t}: escopo só no financeiro`).toEqual([]);
      expect(await ler(ctxPec(usuarioListaVazia), t), `${t}: pecuária com lista vazia`).toEqual([]);
      expect(await ler(ctxPec(usuarioSoB), t), t).toEqual([ids[t].B]);
      // O módulo é o da ÁREA: o mesmo usuário com outro módulo ativo não vê o raster de B.
      expect(await ler({ orgId: demo.orgId, userId: usuarioSoB, modulo: "financeiro" }, t), `${t}: outro módulo`).toEqual([]);
      // A GUC de organização sozinha não abre nada: quem NÃO é membro dela (o dono da outra organização com a GUC da demo)
      // não tem escopo de empresa nenhum ali (erp.tenant_visible confia na GUC; o recorte por empresa exige o vínculo).
      expect(await ler(ctxPec(donoOutraOrg, demo.orgId), t), `${t}: organização sem vínculo`).toEqual([]);
    }
  });

  it("o arquivo volta ÍNTEGRO pela RLS (o caminho da rota do arquivo: organização + caminho, sob a GUC do usuário); fora do escopo, nenhuma linha", async () => {
    const lerArquivo = (ctx: TenantContext) => withTx(app, ctx, async (tx) =>
      (await tx.query<{ conteudo: Buffer; sha256_arquivo: string }>("select conteudo, sha256_arquivo from erp.satelite_raster_arquivos where organization_id=$1 and storage_path=$2",
        [demo.orgId, arqB.storage_path])).rows);
    const [linha] = await lerArquivo(ctxPec(usuarioSoB));
    expect(Buffer.compare(linha!.conteudo, arqB.conteudo as Buffer)).toBe(0);
    expect(sha(linha!.conteudo)).toBe(linha!.sha256_arquivo);
    expect(await lerArquivo(ctxPec(usuarioSemPecuaria))).toEqual([]);
    expect(await lerArquivo(ctxPec(donoOutraOrg, outraOrg))).toEqual([]);
  });

  it("WITH CHECK: só B grava em B; ninguém grava em empresa fora do escopo nem em outra organização (42501); o positivo da mesma porta passa", async () => {
    const soB = ctxPec(usuarioSoB);
    // Arquivo: em A e na outra organização, recusado; em B, aceito.
    expect((await erroDe(withTx(app, soB, (tx) => inserir(tx, "satelite_raster_arquivos", linhaArquivo(A, areaA)))))).toMatchObject({ code: "42501" });
    expect((await erroDe(withTx(app, soB, (tx) => inserir(tx, "satelite_raster_arquivos", linhaArquivo(empresaX, areaX, { org: outraOrg })))))).toMatchObject({ code: "42501" });
    expect((await erroDe(withTx(app, ctxPec(donoOutraOrg, outraOrg), (tx) => inserir(tx, "satelite_raster_arquivos", linhaArquivo(A, areaA)))))).toMatchObject({ code: "42501" });
    const novoB = linhaArquivo(B, areaB);
    expect((await withTx(app, soB, (tx) => inserir(tx, "satelite_raster_arquivos", novoB))).rowCount).toBe(1);
    // Metadado: o de A (com arquivo de A já gravado pelo superusuário, e análise de A) recusado; o de B aceito.
    const arqA = linhaArquivo(A, areaA);
    await inserir(db, "satelite_raster_arquivos", arqA);
    expect((await erroDe(withTx(app, soB, (tx) => inserir(tx, "satelite_rasters", linhaRaster(arqA, areaA, analiseA, { criado_por: usuarioSoB })))))).toMatchObject({ code: "42501" });
    expect((await erroDe(withTx(app, ctxPec(donoOutraOrg, outraOrg), (tx) => inserir(tx, "satelite_rasters", linhaRaster(arqA, areaA, analiseA, { criado_por: donoOutraOrg })))))).toMatchObject({ code: "42501" });
    expect((await withTx(app, soB, (tx) => inserir(tx, "satelite_rasters", linhaRaster(novoB, areaB, analiseB, { criado_por: usuarioSoB })))).rowCount).toBe(1);
    // Sem GUC: nem arquivo nem metadado.
    expect((await erroDe(withTx(app, { orgId: null, userId: null }, (tx) => inserir(tx, "satelite_raster_arquivos", linhaArquivo(B, areaB)))))).toMatchObject({ code: "42501" });
  });
});

describe("DB-6 — FKs compostas: o banco proíbe metadado sem arquivo, de outra empresa ou de análise de OUTRA área", () => {
  it("metadado → arquivo: inexistente, de OUTRA empresa da mesma organização, com o hash de OUTRO conteúdo para o mesmo caminho, ou gravado ANTES do arquivo na mesma transação → 23503 fk_satelite_rasters_arquivo", async () => {
    await desfeita(db, async (c) => {
      const semArquivo = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(linhaArquivo(A, areaA), areaA, analiseA)));
      expect([semArquivo.code, semArquivo.constraint]).toEqual(["23503", "fk_satelite_rasters_arquivo"]);
      // O arquivo é de B; o metadado diz A (com a análise de A) e aponta para o caminho dele.
      const deB = linhaArquivo(B, areaA);
      await inserir(c, "satelite_raster_arquivos", deB);
      const e = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster({ ...deB, empresa_id: A }, areaA, analiseA)));
      expect([e.code, e.constraint]).toEqual(["23503", "fk_satelite_rasters_arquivo"]);
      // O arquivo do caminho existe (mesma organização e empresa), mas o metadado traz o hash de OUTRO conteúdo — o PNG de
      // uma geração concorrente da mesma chave que perdeu a corrida da gravação. O hash bem formado não basta: tem de ser
      // o do arquivo guardado.
      const guardado = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", guardado);
      const outroHash = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(guardado, areaA, analiseA, { sha256_arquivo: sha(pngDeTeste()) })));
      expect([outroHash.code, outroHash.constraint]).toEqual(["23503", "fk_satelite_rasters_arquivo"]);
      expect((await inserir(c, "satelite_rasters", linhaRaster(guardado, areaA, analiseA))).rowCount, "o hash do arquivo guardado").toBe(1);
      // A FK não é adiável: o metadado antes do arquivo é recusado na hora, ainda que o arquivo viesse logo depois.
      const depois = linhaArquivo(A, areaA);
      const antes = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(depois, areaA, analiseA)));
      expect([antes.code, antes.constraint]).toEqual(["23503", "fk_satelite_rasters_arquivo"]);
      // O positivo da mesma porta: arquivo primeiro, metadado depois.
      await inserir(c, "satelite_raster_arquivos", depois);
      expect((await inserir(c, "satelite_rasters", linhaRaster(depois, areaA, analiseA))).rowCount).toBe(1);
    });
  });

  it("metadado → análise: análise de OUTRA ÁREA da mesma empresa, de outra empresa, inexistente → 23503 fk_satelite_rasters_analise; a da própria área grava", async () => {
    await desfeita(db, async (c) => {
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      for (const [nome, analise] of [["análise da área A2 (mesma empresa A)", analiseA2], ["análise de B", analiseB], ["análise da outra organização", analiseX],
        ["análise inexistente", randomUUID()]] as const) {
        const e = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(arq, areaA, analise)));
        expect([nome, e.code, e.constraint]).toEqual([nome, "23503", "fk_satelite_rasters_analise"]);
      }
      expect((await inserir(c, "satelite_rasters", linhaRaster(arq, areaA, analiseA))).rowCount, "análise da própria área").toBe(1);
    });
  });

  it("empresa de OUTRA organização → 23503 na FK composta da empresa (arquivo) ou numa das compostas (metadado); criado_por inexistente → 23503", async () => {
    await desfeita(db, async (c) => {
      const e1 = await recusaNo(c, () => inserir(c, "satelite_raster_arquivos", linhaArquivo(empresaX, areaA)));
      expect([e1.code, e1.constraint]).toEqual(["23503", "fk_satelite_raster_arquivos_empresa"]);
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      const e2 = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(arq, areaA, analiseA, { empresa_id: empresaX })));
      expect(e2.code).toBe("23503");
      expect(["fk_satelite_rasters_empresa", "fk_satelite_rasters_analise", "fk_satelite_rasters_arquivo"]).toContain(e2.constraint);
      const e3 = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(arq, areaA, analiseA, { criado_por: randomUUID() })));
      expect([e3.code, e3.constraint]).toEqual(["23503", "satelite_rasters_criado_por_fkey"]);
    });
  });
});

describe("DB-7 — unicidade por organização: a chave de cache e o caminho do arquivo", () => {
  it("a MESMA chave de cache na mesma organização → 23505 uq_satelite_rasters_chave_cache (mesmo em outra empresa); em OUTRA organização é aceita", async () => {
    await desfeita(db, async (c) => {
      const K = chaveNova();
      const arqA = linhaArquivo(A, areaA, { chave: K });
      await inserir(c, "satelite_raster_arquivos", arqA);
      expect((await inserir(c, "satelite_rasters", linhaRaster(arqA, areaA, analiseA))).rowCount).toBe(1);
      // Outro arquivo (outro dia, mesma chave no nome) em B: o arquivo entra; o metadado com a mesma chave, não.
      const arqB = linhaArquivo(B, areaB, { chave: K, data: "2026-08-12" });
      await inserir(c, "satelite_raster_arquivos", arqB);
      const e = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(arqB, areaB, analiseB)));
      expect([e.code, e.constraint]).toEqual(["23505", "uq_satelite_rasters_chave_cache"]);
      const arqX = linhaArquivo(empresaX, areaX, { org: outraOrg, chave: K });
      await inserir(c, "satelite_raster_arquivos", arqX);
      expect((await inserir(c, "satelite_rasters", linhaRaster(arqX, areaX, analiseX))).rowCount, "outra organização").toBe(1);
    });
  });

  it("o INSERT do gerar (on conflict (organization_id, chave_cache) do nothing), como erp_app: chave já gravada → 0 linhas; chave livre → 1", async () => {
    const dono = ctxPec(demo.adminUserId);
    const arq = linhaArquivo(A, areaA);
    await withTx(app, dono, (tx) => inserir(tx, "satelite_raster_arquivos", arq));
    const gerar = (linha: Linha) => withTx(app, dono, (tx) => {
      const cols = Object.keys(linha);
      return tx.query(`insert into erp.satelite_rasters (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
                       on conflict (organization_id, chave_cache) do nothing`, Object.values(linha));
    });
    expect((await gerar(linhaRaster(arq, areaA, analiseA))).rowCount).toBe(1);
    expect((await gerar(linhaRaster(arq, areaA, analiseA))).rowCount, "a mesma chave: reaproveita").toBe(0);
  });

  it("o MESMO caminho de arquivo na mesma organização → 23505 (em outra empresa: uq_satelite_raster_arquivos_caminho)", async () => {
    await desfeita(db, async (c) => {
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      const outraEmpresa = await recusaNo(c, () => inserir(c, "satelite_raster_arquivos", { ...linhaArquivo(B, areaA), storage_path: arq.storage_path }));
      expect([outraEmpresa.code, outraEmpresa.constraint]).toEqual(["23505", "uq_satelite_raster_arquivos_caminho"]);
      const mesma = await recusaNo(c, () => inserir(c, "satelite_raster_arquivos", { ...linhaArquivo(A, areaA), storage_path: arq.storage_path }));
      expect(mesma.code).toBe("23505");
    });
  });
});

describe("DB-8 — CHECKs: o banco confere o arquivo (hash, tamanho, caminho) e a forma do metadado", () => {
  it("arquivo: hash que não é do conteúdo, tamanho declarado errado, conteúdo vazio e caminho fora da forma → 23514 com o nome da restrição", async () => {
    await desfeita(db, async (c) => {
      const base = () => linhaArquivo(A, areaA);
      const K = chaveNova();
      const comCaminho = (p: string): Linha => ({ ...base(), storage_path: p });
      const vazio = Buffer.alloc(0);
      const casos: [string, Linha, string][] = [
        ["hash de OUTRO conteúdo", { ...base(), sha256_arquivo: sha(pngDeTeste()) }, "chk_satelite_raster_arquivos_sha256"],
        ["hash do conteúdo em maiúsculas", (() => { const l = base(); return { ...l, sha256_arquivo: (l.sha256_arquivo as string).toUpperCase() }; })(), "chk_satelite_raster_arquivos_sha256"],
        ["hash que não é hex", { ...base(), sha256_arquivo: "x".repeat(64) }, "chk_satelite_raster_arquivos_sha256"],
        ["tamanho declarado um byte a mais", (() => { const l = base(); return { ...l, tamanho_bytes: (l.tamanho_bytes as number) + 1 }; })(), "chk_satelite_raster_arquivos_tamanho_bytes"],
        ["tamanho declarado zero", { ...base(), tamanho_bytes: 0 }, "chk_satelite_raster_arquivos_tamanho_bytes"],
        ["conteúdo vazio (hash e tamanho coerentes)", { ...base(), conteudo: vazio, sha256_arquivo: sha(vazio), tamanho_bytes: 0 }, "chk_satelite_raster_arquivos_tamanho"],
        ["caminho com a organização de OUTRA (forma válida)", comCaminho(caminho(outraOrg, areaA, DATA, K)), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho com UUID em maiúsculas", comCaminho(caminho(demo.orgId.toUpperCase(), areaA, DATA, K)), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho com outro índice", comCaminho(`${demo.orgId}/${areaA}/evi/${DATA}/${K}.png`), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho com mês 13", comCaminho(caminho(demo.orgId, areaA, "2026-13-01", K)), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho com data sem zero", comCaminho(caminho(demo.orgId, areaA, "2026-8-11", K)), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho sem .png", comCaminho(`${demo.orgId}/${areaA}/ndvi/${DATA}/${K}`), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho .PNG", comCaminho(`${demo.orgId}/${areaA}/ndvi/${DATA}/${K}.PNG`), "chk_satelite_raster_arquivos_storage_path"],
        ["caminho com .", comCaminho(`${demo.orgId}/${areaA}/ndvi/${DATA}/${K}xpng`), "chk_satelite_raster_arquivos_storage_path"],
        ["chave que não é sha256", comCaminho(caminho(demo.orgId, areaA, DATA, "abc")), "chk_satelite_raster_arquivos_storage_path"],
        ["área que não é UUID", comCaminho(`${demo.orgId}/area-1/ndvi/${DATA}/${K}.png`), "chk_satelite_raster_arquivos_storage_path"],
        ["barra no começo", comCaminho(`/${caminho(demo.orgId, areaA, DATA, K)}`), "chk_satelite_raster_arquivos_storage_path"],
        ["segmento a mais", comCaminho(`${demo.orgId}/${areaA}/ndvi/x/${DATA}/${K}.png`), "chk_satelite_raster_arquivos_storage_path"],
        ["subida de diretório", comCaminho(`${demo.orgId}/../ndvi/${DATA}/${K}.png`), "chk_satelite_raster_arquivos_storage_path"]
      ];
      for (const [nome, linha, restricao] of casos) {
        const e = await recusaNo(c, () => inserir(c, "satelite_raster_arquivos", linha));
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", restricao]);
      }
      expect((await inserir(c, "satelite_raster_arquivos", base())).rowCount, "o coerente grava").toBe(1);
    });
  });

  it("arquivo: exatamente 16 MiB grava; 16 MiB + 1 byte → 23514 chk_satelite_raster_arquivos_tamanho (hash e tamanho calculados pelo próprio banco)", async () => {
    await desfeita(db, async (c) => {
      const gravar = (n: number) => c.query(
        `insert into erp.satelite_raster_arquivos (organization_id, empresa_id, storage_path, conteudo, sha256_arquivo, tamanho_bytes)
         select $1, $2, $3, x, encode(sha256(x), 'hex'), octet_length(x) from (select decode(repeat('ab', $4), 'hex') x) s`,
        [demo.orgId, A, caminho(demo.orgId, areaA, DATA, chaveNova()), n]);
      expect((await gravar(MIB16)).rowCount, "16 MiB").toBe(1);
      const e = await recusaNo(c, () => gravar(MIB16 + 1));
      expect([e.code, e.constraint]).toEqual(["23514", "chk_satelite_raster_arquivos_tamanho"]);
    });
  });

  it("metadado: cantos fora da forma, escala invertida, dimensões 0/2501, índice e tipo fora da lista, retângulo degenerado, hashes e chave fora da forma → 23514", async () => {
    await desfeita(db, async (c) => {
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      const r = (extra: Linha) => linhaRaster(arq, areaA, analiseA, extra);
      const cantos = (v: unknown) => r({ cantos_lnglat: JSON.stringify(v) });
      const [c0, c1, c2, c3] = CANTOS;
      const casos: [string, Linha, string][] = [
        ["três cantos", cantos([c0, c1, c2]), "chk_satelite_rasters_cantos"],
        ["cinco cantos", cantos([c0, c1, c2, c3, c0]), "chk_satelite_rasters_cantos"],
        ["nenhum canto", cantos([]), "chk_satelite_rasters_cantos"],
        ["canto com três números", cantos([c0, c1, c2, [...c3!, 0]]), "chk_satelite_rasters_cantos"],
        ["canto com um número", cantos([c0, c1, c2, [c3![0]]]), "chk_satelite_rasters_cantos"],
        ["número como texto", cantos([c0, c1, c2, [String(c3![0]), c3![1]]]), "chk_satelite_rasters_cantos"],
        ["canto nulo", cantos([c0, c1, c2, [null, c3![1]]]), "chk_satelite_rasters_cantos"],
        ["canto como objeto", cantos([c0, c1, c2, { lng: c3![0], lat: c3![1] }]), "chk_satelite_rasters_cantos"],
        ["canto como número solto", cantos([c0, c1, c2, -56.1]), "chk_satelite_rasters_cantos"],
        ["canto aninhado demais", cantos([c0, c1, c2, [c3]]), "chk_satelite_rasters_cantos"],
        ["raiz objeto", cantos({ a: c0, b: c1, c: c2, d: c3 }), "chk_satelite_rasters_cantos"],
        ["raiz número", cantos(4), "chk_satelite_rasters_cantos"],
        ["JSON null", cantos(null), "chk_satelite_rasters_cantos"],
        ["escala invertida", r({ escala_min: "1.0", escala_max: "-0.2" }), "chk_satelite_rasters_escala"],
        ["escala de largura zero", r({ escala_min: "0.5", escala_max: "0.5" }), "chk_satelite_rasters_escala"],
        ["largura 0", r({ largura: 0 }), "chk_satelite_rasters_largura"],
        ["largura 2501", r({ largura: 2501 }), "chk_satelite_rasters_largura"],
        ["altura 0", r({ altura: 0 }), "chk_satelite_rasters_altura"],
        ["altura 2501", r({ altura: 2501 }), "chk_satelite_rasters_altura"],
        // Índice e chave fora da forma com o CAMINHO acompanhando: só o CHECK da coluna reprova (o do caminho, não).
        ["índice fora da lista", r({ indice: "evi", storage_path: (arq.storage_path as string).replace("/ndvi/", "/evi/") }), "chk_satelite_rasters_indice"],
        ["tipo fora da lista", r({ tipo: "rgb" }), "chk_satelite_rasters_tipo"],
        ["x mínimo = máximo", r({ bbox_min_x: "10", bbox_max_x: "10" }), "chk_satelite_rasters_bbox"],
        ["y mínimo > máximo", r({ bbox_min_y: "11", bbox_max_y: "10" }), "chk_satelite_rasters_bbox"],
        ["resolução 0", r({ resolucao_m: 0 }), "chk_satelite_rasters_resolucao"],
        ["chave de cache fora da forma", r({ chave_cache: "K".repeat(64), storage_path: (arq.storage_path as string).replace(/[0-9a-f]{64}\.png$/, `${"K".repeat(64)}.png`) }), "chk_satelite_rasters_chave_cache"],
        ["sha256 do arquivo fora da forma", r({ sha256_arquivo: "abc" }), "chk_satelite_rasters_sha256_arquivo"],
        ["geometria fora da forma", r({ geometria_sha256: "g".repeat(64) }), "chk_satelite_rasters_geometria_sha256"],
        ["PU negativo", r({ pu_gasto: "-0.0001" }), "chk_satelite_rasters_pu_gasto"]
      ];
      for (const [nome, linha, restricao] of casos) {
        const e = await recusaNo(c, () => inserir(c, "satelite_rasters", linha));
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", restricao]);
      }
      // Os limites e o PU nulo gravam (um de cada vez: a chave de cache é única).
      const aceitos: [string, Linha][] = [
        ["largura e altura 1", { largura: 1, altura: 1 }], ["largura e altura 2500", { largura: 2500, altura: 2500 }],
        ["PU nulo", { pu_gasto: null }], ["cantos inteiros", { cantos_lnglat: JSON.stringify([[-56, -15], [-55, -15], [-55, -16], [-56, -16]]) }]
      ];
      for (const [nome, extra] of aceitos) {
        const e = await c.query("savepoint s").then(() => inserir(c, "satelite_rasters", r(extra))).then((x) => x.rowCount, (x: Erro) => x.message);
        await c.query("rollback to savepoint s");
        expect([nome, e]).toEqual([nome, 1]);
      }
    });
  });

  it("metadado: o caminho é o das PRÓPRIAS colunas — organização, área, índice, dia ou chave divergentes, segmento a mais, barra sobrando ou outra extensão → 23514 chk_satelite_rasters_caminho_coerente; o coerente grava, também sob outro DateStyle e fusos extremos", async () => {
    await desfeita(db, async (c) => {
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      const base = linhaRaster(arq, areaA, analiseA);
      const p = arq.storage_path as string;
      const [org, area, indice, dia, nome] = p.split("/") as [string, string, string, string, string];
      const caminho_ = (...seg: string[]) => ({ storage_path: seg.join("/") });
      // Primeiro, os que apontam para o arquivo EXISTENTE (só a coluna diverge): sem o CHECK, a FK passaria e a linha entraria.
      const casos: [string, Linha][] = [
        ["área divergente na coluna (A2 com a análise de A2; o caminho diz A)", { area_id: areaA2, analise_id: analiseA2 }],
        ["dia divergente na coluna", { data_imagem: "2026-08-12" }],
        ["chave divergente na coluna", { chave_cache: chaveNova() }],
        ["organização de OUTRA no caminho", caminho_(outraOrg, area, indice, dia, nome)],
        ["área divergente no caminho (A2; a coluna diz A)", caminho_(org, areaA2, indice, dia, nome)],
        ["índice divergente no caminho", caminho_(org, area, "evi", dia, nome)],
        ["dia divergente no caminho", caminho_(org, area, indice, "2026-08-12", nome)],
        ["dia no formato DMY", caminho_(org, area, indice, "11-08-2026", nome)],
        ["dia com barras", caminho_(org, area, indice, "2026/08/11", nome)],
        ["chave divergente no caminho", caminho_(org, area, indice, dia, `${chaveNova()}.png`)],
        ["segmento a mais no meio", caminho_(org, area, indice, "x", dia, nome)],
        ["sexto segmento no fim", { storage_path: `${p}/x` }],
        ["barra sobrando no fim", { storage_path: `${p}/` }],
        ["barra no começo", { storage_path: `/${p}` }],
        ["extensão em maiúsculas", { storage_path: p.replace(/\.png$/, ".PNG") }],
        ["sem extensão", { storage_path: p.replace(/\.png$/, "") }]
      ];
      for (const [nomeCaso, extra] of casos) {
        const e = await recusaNo(c, () => inserir(c, "satelite_rasters", { ...base, ...extra }));
        expect([nomeCaso, e.code, e.constraint]).toEqual([nomeCaso, "23514", "chk_satelite_rasters_caminho_coerente"]);
      }
      expect((await inserir(c, "satelite_rasters", base)).rowCount, "o coerente grava").toBe(1);
      // O dia não depende da sessão: com DateStyle 'SQL, DMY' (data_imagem::text daria 11/08/2026) e fusos de +14 h e −12 h,
      // o coerente grava e o dia divergente continua recusado.
      for (const fuso of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
        await c.query(`set local datestyle = 'SQL, DMY'; set local timezone = '${fuso}'`);
        expect((await c.query<{ d: string }>("select $1::date::text d", [DATA])).rows[0]!.d, "premissa: o texto da data mudou com o DateStyle").toBe("11/08/2026");
        const outro = linhaArquivo(A, areaA);
        await inserir(c, "satelite_raster_arquivos", outro);
        const divergente = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(outro, areaA, analiseA, { data_imagem: "2026-08-10" })));
        expect([fuso, divergente.code, divergente.constraint]).toEqual([fuso, "23514", "chk_satelite_rasters_caminho_coerente"]);
        expect((await inserir(c, "satelite_rasters", linhaRaster(outro, areaA, analiseA))).rowCount, fuso).toBe(1);
      }
    });
  });

  it("NOT NULL: o metadado sem dimensão, sem cantos ou sem chave → 23502; o PU é o único anulável", async () => {
    await desfeita(db, async (c) => {
      const arq = linhaArquivo(A, areaA);
      await inserir(c, "satelite_raster_arquivos", arq);
      for (const coluna of ["largura", "cantos_lnglat", "chave_cache", "escala_min", "data_imagem", "criado_por"]) {
        const e = await recusaNo(c, () => inserir(c, "satelite_rasters", linhaRaster(arq, areaA, analiseA, { [coluna]: null })));
        expect([coluna, e.code]).toEqual([coluna, "23502"]);
      }
    });
  });
});

describe("DB-9 — auditoria: o metadado é auditado; o arquivo não, e o binário nunca vai para o log", () => {
  it("a criação do metadado fica em erp.audit_logs; a do arquivo, não; nenhuma linha do log carrega o conteúdo", async () => {
    const { arquivo, raster, arq } = await withTx(app, ctxPec(demo.adminUserId), (tx) => par(tx, A, areaA, analiseA));
    const audit = async (entidade: string, id: string) =>
      (await db.query("select 1 from erp.audit_logs where entity=$1 and entity_id=$2 and action='create'", [entidade, id])).rowCount;
    expect(await audit("satelite_rasters", raster)).toBe(1);
    expect(await audit("satelite_raster_arquivos", arquivo)).toBe(0);
    expect((await db.query("select 1 from erp.audit_logs where entity = 'satelite_raster_arquivos'")).rowCount).toBe(0);
    const hex = (arq.conteudo as Buffer).toString("hex");
    expect((await db.query("select 1 from erp.audit_logs where position($1 in coalesce(after::text, '') || coalesce(before::text, '')) > 0", [hex])).rowCount).toBe(0);
    // O log do metadado aponta para o arquivo pelo caminho e pelo hash.
    expect((await db.query<{ p: string; h: string }>("select after->>'storage_path' p, after->>'sha256_arquivo' h from erp.audit_logs where entity='satelite_rasters' and entity_id=$1", [raster])).rows[0])
      .toEqual({ p: arq.storage_path, h: arq.sha256_arquivo });
  });
});

describe("DB-10 — a volta FAIL-CLOSED: com imagem guardada, ou por papel sujeito à RLS, nada é desfeito", () => {
  it("com raster e arquivo guardados (os dos testes acima), o SQL reverso para inteiro (P0001) e o catálogo não muda", async () => {
    expect((await db.query("select 1 from erp.satelite_rasters")).rowCount, "premissa: há metadado").toBeGreaterThan(0);
    expect((await db.query("select 1 from erp.satelite_raster_arquivos")).rowCount, "premissa: há arquivo").toBeGreaterThan(0);
    const e = await erroDe(reverterComoHumano());
    expect([e.code, e.message]).toEqual(["P0001", VOLTA_COM_DADO]);
    expect(await retratoCatalogo()).toEqual(catalogo0055);
  });

  it("um papel SUJEITO à RLS (erp_app, sem GUC: veria as tabelas vazias) é recusado antes de qualquer coisa, e o catálogo não muda", async () => {
    const e = await desfeita(db, async (c) => {
      await c.query("set local role erp_app");
      expect((await c.query("select 1 from erp.satelite_rasters")).rowCount, "premissa: sob a RLS forçada, sem GUC, o papel vê zero linhas").toBe(0);
      return erroDe(c.query(SQL_REVERSO));
    });
    expect([e.code, e.message]).toEqual(["P0001", VOLTA_SEM_BYPASS]);
    expect(await retratoCatalogo()).toEqual(catalogo0055);
  });
});
