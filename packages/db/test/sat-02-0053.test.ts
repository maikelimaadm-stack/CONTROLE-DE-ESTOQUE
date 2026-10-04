import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import {
  SITUACOES_CONSULTA_SATELITE, SITUACOES_ITEM_CONSULTA_SATELITE, SITUACOES_ITEM_VIVAS, OPERACOES_CONSUMO_SATELITE,
  INDICES_CONSULTA_SATELITE, VERSAO_METODO_NDVI_V2
} from "@agro/domain";
import { TEST_URL } from "./setup.js";

/**
 * A 0053 (SAT-02, decisão 295 — consulta satelital em lote: fila, ledger de consumo e orçamento), PROVADA CONTRA O
 * BANCO, como o runner aplica (arquivo a arquivo, cada um numa transação), sobre um banco na 0052 COM ACERVO.
 *
 * DB-0 premissa (ledger até a 0052, análises da 0052 gravadas pela via que o gatilho de conferência aceita, nada da
 * 0053) · DB-1 a trava (2026,87) ocupada recusa sem aplicar nada · DB-2 SOBE: nenhuma linha de NENHUMA tabela muda
 * (retrato das colunas que existiam), as colunas novas nascem nulas, a tabela não é regravada, a imutabilidade da 0052
 * continua, análise nova com as colunas novas grava; reaplicar para no preflight ("já aplicada") · DB-3 as listas dos
 * CHECKs e o predicado da chave são os do domínio (um dono só) · DB-4 RLS por empresa no módulo da área (outra
 * organização, sem escopo, escopo só em B; com check) · DB-5 ledger de consumo imutável e crédito derivado do PU ·
 * DB-6 um item VIVO por organização e chave · DB-7 FKs compostas (empresa e VÍNCULOS: consulta, área) e CHECKs · DB-8 DESCE: o SQL reverso (SQL_REVERSO, abaixo) volta o
 * catálogo EXATAMENTE ao da 0052 e a 0053 reaplica em seguida, com o mesmo catálogo da primeira vez.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let areaA: string; let areaB: string;
let outraOrg: string; let empresaX: string; let areaX: string;
let usuarioSoB: string; let usuarioSemPecuaria: string; let usuarioListaVazia: string; let donoOutraOrg: string;

const ALVO = "0053_satelite_consultas.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const TRAVA = "SAT-02: outra transacao ja detem a trava desta migration (2026,87). Nada foi aplicado.";
const JA = "SAT-02: a 0053 ja foi aplicada ou ha schema divergente (satelite_consultas/satelite_consulta_itens/satelite_consumo/satelite_orcamentos/satelite_consumo_imutavel/analises_satelitais_org_empresa_area_key ou coluna nova de analises_satelitais ja existe).";
const IMUTAVEL_ANALISE = "CONFLICT: A análise satelital registrada não se altera nem se apaga: uma análise nova é registrada ao lado da anterior.";
const IMUTAVEL_CONSUMO = "CONFLICT: O consumo satelital registrado não se altera nem se apaga: um consumo novo é registrado ao lado do anterior.";
const COLUNAS_NOVAS = ["consulta_item_id", "resolucao_nativa_m", "evalscript_sha256", "data_alvo"];
const UQ_JANELA_0052 = ["organization_id", "area_id", "provedor", "colecao", "indice", "versao_metodo", "geometria_sha256", "janela_inicio", "janela_fim"];
const TABELAS_NOVAS = ["satelite_consultas", "satelite_consulta_itens", "satelite_consumo", "satelite_orcamentos"] as const;
type TabelaNova = (typeof TABELAS_NOVAS)[number];

/**
 * O CAMINHO INVERSO DA 0053. O repositório é forward-only (não há arquivo de descida em supabase/migrations): este SQL
 * existe para PROVAR que a 0053 é reversível e que a volta é exatamente esta — e é o que se aplicaria, por decisão
 * humana, para desfazê-la (apaga a fila, o consumo e os orçamentos; as análises ficam, sem as três colunas novas).
 * Sem CASCADE de propósito: dependência que ninguém previu faz a volta falhar alto, em vez de levar junto o que não é
 * da 0053.
 */
const SQL_REVERSO = `
  -- 1) A única amarra de uma tabela EXISTENTE às novas: a FK da análise para o item da fila.
  alter table erp.analises_satelitais drop constraint fk_analises_satelitais_consulta_item;
  -- 2) As tabelas novas, das dependentes para as independentes. Os gatilhos, índices, políticas, comentários e FKs
  --    delas (inclusive a do item para a análise) vão junto. DROP não aciona o gatilho de TRUNCATE do consumo.
  drop table erp.satelite_consumo;
  drop table erp.satelite_consulta_itens;
  drop table erp.satelite_consultas;
  drop table erp.satelite_orcamentos;
  -- 3) A função de imutabilidade do ledger (os gatilhos que a usavam já saíram com a tabela).
  drop function erp.satelite_consumo_imutavel();
  -- 4) A chave única nova da análise (a FK do item que a usava saiu com a tabela de itens).
  alter table erp.analises_satelitais drop constraint analises_satelitais_org_empresa_area_key;
  -- 5) A unicidade da janela volta à da 0052 (mesmo nome, 9 colunas, nulos distintos). FAIL-CLOSED: se já houver duas
  --    análises na mesma janela com datas alvo diferentes (o que só a 0053 permite), o índice não se constrói e a volta
  --    inteira para (23505) — a decisão de o que fazer com esse acervo é humana; análise não se apaga.
  alter table erp.analises_satelitais drop constraint uq_analises_satelitais_janela;
  alter table erp.analises_satelitais add constraint uq_analises_satelitais_janela
    unique (organization_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256, janela_inicio, janela_fim);
  alter table erp.analises_satelitais drop constraint chk_analises_satelitais_data_alvo;
  -- 6) As quatro colunas novas; os CHECKs e comentários delas vão junto. DDL não aciona o gatilho de imutabilidade
  --    (que é de linha), e as colunas restantes de cada análise não mudam.
  alter table erp.analises_satelitais drop column data_alvo;
  alter table erp.analises_satelitais drop column evalscript_sha256;
  alter table erp.analises_satelitais drop column resolucao_nativa_m;
  alter table erp.analises_satelitais drop column consulta_item_id;
  -- 7) O ledger de migrations: a 0053 deixa de constar, e o runner a aplicaria de novo.
  delete from public.erp_migrations where name = '${ALVO}';
`;

const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
const DIA = 86_400_000;

async function id1(sql: string, p: unknown[] = []) { return (await db.query<{ id: string }>(sql, p)).rows[0]!.id; }
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { const x = e as { code?: string; constraint?: string; message: string }; return { code: x.code, constraint: x.constraint, message: x.message }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const chaveNova = () => sha(randomUUID());
const hashDe = async (areaId: string) =>
  (await db.query<{ h: string }>("select encode(sha256(convert_to(geometria::text,'UTF8')),'hex') h from erp.areas where id=$1", [areaId])).rows[0]!.h;
const ctxPec = (userId: string, orgId = demo.orgId): TenantContext => ({ orgId, userId, modulo: "pecuaria" });

// ---------- montagem de linhas ----------
interface Analise { org?: string; empresa: string; area: string; janelaInicio: string; semObservacao?: boolean; novas?: { item: string | null; resolucao: number | null; evalscript: string | null; dataAlvo?: string | null } }
/** Uma análise da 0052 pela via que o gatilho de conferência aceita (área viva, com polígono, hash de agora). */
async function inserirAnalise(q: Queryable, a: Analise) {
  const concluida = !a.semObservacao;
  const ini = new Date(a.janelaInicio);
  const colunas = ["organization_id", "empresa_id", "area_id", "provedor", "colecao", "indice", "versao_metodo", "geometria_sha256",
    "janela_inicio", "janela_fim", "resolucao_m", "situacao", "motivo_qualidade", "observacao_inicio", "observacao_fim",
    "valor_medio", "valor_minimo", "valor_maximo", "desvio_padrao", "pixels_amostra", "pixels_sem_dado", "pixels_validos",
    "pixels_geometria", "cobertura_valida", "metadados_provedor", "criado_por"];
  const valores: unknown[] = [a.org ?? demo.orgId, a.empresa, a.area, "copernicus_cdse", "sentinel-2-l2a", "ndvi", "ndvi-v2", await hashDe(a.area),
    ini, new Date(ini.getTime() + 30 * DIA), 10, concluida ? "concluida" : "sem_observacao_util", concluida ? null : "cobertura_insuficiente",
    concluida ? new Date(ini.getTime() + 10 * DIA) : null, concluida ? new Date(ini.getTime() + 11 * DIA) : null,
    concluida ? "0.7200" : null, concluida ? "0.3100" : null, concluida ? "0.8800" : null, concluida ? "0.0900" : null,
    concluida ? 4934 : null, concluida ? 406 : null, concluida ? 4528 : null, concluida ? 4900 : null, concluida ? "0.9241" : null,
    '{"intervalos_recebidos":3}', demo.adminUserId];
  if (a.novas) { colunas.push(...COLUNAS_NOVAS); valores.push(a.novas.item, a.novas.resolucao, a.novas.evalscript, a.novas.dataAlvo ?? null); }
  return q.query<{ id: string }>(
    `insert into erp.analises_satelitais (${colunas.join(", ")}) values (${valores.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, valores);
}

interface Consulta { org?: string; empresa: string; situacao?: string; estimativa?: string; minima?: string; totais?: [number, number, number, number]; concluidaEm?: Date | null; parametros?: string }
function inserirConsulta(q: Queryable, c: Consulta) {
  const [itens, concluidos, falhos, reaproveitados] = c.totais ?? [1, 0, 0, 0];
  return q.query<{ id: string }>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima,
       situacao, total_itens, total_concluidos, total_falhos, total_reaproveitados, concluida_em)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [c.org ?? demo.orgId, c.empresa, demo.adminUserId, c.parametros ?? '{"alvo":{"tipo":"todas"}}', c.estimativa ?? "12.50", c.minima ?? "2.50",
      c.situacao ?? "pendente", itens, concluidos, falhos, reaproveitados, c.concluidaEm ?? null]);
}

interface Item { org?: string; empresa: string; consulta: string; area: string; chave?: string; situacao?: string; analise?: string | null; dataAlvo?: string | null; janela?: [string, string]; hash?: string; versao?: string; tentativas?: number; pu?: string | null }
function inserirItem(q: Queryable, i: Item) {
  const chave = i.chave ?? chaveNova();
  const [ini, fim] = i.janela ?? ["2026-09-05", "2026-10-04"];
  return q.query<{ id: string }>(
    `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
       data_alvo, janela_inicio, janela_fim, situacao, tentativas, analise_id, pu_gasto, chave_idempotencia, chave_idempotencia_origem)
     values ($1,$2,$3,$4,$5,'ndvi',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [i.consulta, i.org ?? demo.orgId, i.empresa, i.area, i.hash ?? sha(`geometria-${i.area}`), i.versao ?? "ndvi-v2", i.dataAlvo ?? null, ini, fim,
      i.situacao ?? "pendente", i.tentativas ?? 0, i.analise ?? null, i.pu ?? null, chave, `origem-legivel|${chave}`]);
}

interface Consumo { org?: string; empresa: string; item?: string | null; consulta?: string | null; operacao?: string; pu?: string; creditos?: string }
function inserirConsumo(q: Queryable, c: Consumo) {
  return q.query<{ id: string }>(
    `insert into erp.satelite_consumo (organization_id, empresa_id, consulta_item_id, consulta_id, operacao, pu_gasto, creditos, origem_cabecalho)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [c.org ?? demo.orgId, c.empresa, c.item ?? null, c.consulta ?? null, c.operacao ?? "statistical", c.pu ?? "1.2345", c.creditos ?? "123.45", c.pu ?? "1.2345"]);
}

interface Orcamento { org?: string; empresa: string; mes?: string; limite?: string }
function inserirOrcamento(q: Queryable, o: Orcamento) {
  return q.query<{ id: string }>(
    "insert into erp.satelite_orcamentos (organization_id, empresa_id, mes_referencia, limite_creditos) values ($1,$2,$3,$4) returning id",
    [o.org ?? demo.orgId, o.empresa, o.mes ?? "2026-10-01", o.limite ?? "1000.00"]);
}

// ---------- retrato do catálogo (schema erp inteiro) e dos dados ----------
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
           'retorno=' || coalesce(pg_get_function_result(p.oid), '-') || ' secdef=' || p.prosecdef
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

const analisesOrdenadas = async () =>
  (await db.query<{ j: Record<string, unknown> }>("select to_jsonb(a) j from erp.analises_satelitais a order by id")).rows.map((r) => r.j);

// Estado de ANTES da 0053, guardado para a subida (DB-2) e para a descida (DB-8).
let catalogo0052: Retrato; let catalogo0053: Retrato;
let colunas0052: Record<string, string[]>; let dados0052: Secao;
let analises0052: Record<string, unknown>[]; let filenode0052: string;
let analiseA: string; let analiseB: string;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  // O ACERVO da 0052, antes da 0053: organização demo (empresas A e B), outra organização, áreas com polígono e
  // análises gravadas pela via que o gatilho de conferência aceita.
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  const area = (empresa: string, code: string, org = demo.orgId) =>
    id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
         values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] SAT2 ${code}`, JSON.stringify(POLIGONO)]);
  areaA = await area(A, "SAT2-A");
  areaB = await area(B, "SAT2-B");
  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT2','outra-sat2') returning id");
  empresaX = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 97, '[TEST] Empresa outra org SAT2') returning id", [outraOrg]);
  areaX = await area(empresaX, "SAT2-X", outraOrg);
  analiseA = (await inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-08-01T00:00:00Z" })).rows[0]!.id;
  await inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-08-02T00:00:00Z", semObservacao: true });
  analiseB = (await inserirAnalise(db, { empresa: B, area: areaB, janelaInicio: "2026-08-01T00:00:00Z" })).rows[0]!.id;
  await inserirAnalise(db, { org: outraOrg, empresa: empresaX, area: areaX, janelaInicio: "2026-08-01T00:00:00Z" });

  // Membros: só B no módulo da área; escopo só em OUTRO módulo; módulo da área com lista vazia; dono da outra org.
  const membro = async (email: string, org = demo.orgId, dono = false) => {
    const user = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [email, `[TEST] ${email}`]);
    const m = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,$3,true) returning id", [org, user, dono]);
    return { user, m };
  };
  const soB = await membro("sat2-so-b@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, soB.m]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, soB.m, B]);
  usuarioSoB = soB.user;
  const semPec = await membro("sat2-sem-pecuaria@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'financeiro','todas')", [demo.orgId, semPec.m]);
  usuarioSemPecuaria = semPec.user;
  const vazia = await membro("sat2-lista-vazia@demo.local");
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, vazia.m]);
  usuarioListaVazia = vazia.user;
  donoOutraOrg = (await membro("sat2-dono-outra@demo.local", outraOrg, true)).user;
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-0 a DB-2 — a 0053 sobre o banco na 0052 com acervo: premissa, trava, subida e reaplicação", () => {
  it("DB-0 PREMISSA: o ledger termina na 0052, há análises da 0052 nas duas organizações, e nada da 0053 existe", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0052_analises_satelitais.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: "0052_analises_satelitais.sql" });
    const acervo = (await db.query<{ org: string; empresa: string; situacao: string }>(
      "select organization_id::text org, empresa_id::text empresa, situacao from erp.analises_satelitais order by organization_id, empresa_id, situacao")).rows;
    expect(acervo).toHaveLength(4);
    expect(new Set(acervo.map((l) => l.org))).toEqual(new Set([demo.orgId, outraOrg]));
    expect(new Set(acervo.map((l) => l.empresa))).toEqual(new Set([A, B, empresaX]));
    expect(new Set(acervo.map((l) => l.situacao))).toEqual(new Set(["concluida", "sem_observacao_util"]));
    for (const t of TABELAS_NOVAS) expect((await db.query<{ t: string | null }>("select to_regclass($1)::text t", [`erp.${t}`])).rows[0]!.t).toBeNull();
    expect((await db.query("select 1 from pg_constraint where conname='analises_satelitais_org_empresa_area_key'")).rowCount).toBe(0);
  });

  it("DB-1 TRAVA: com (2026,87) ocupada por outra sessão, a 0053 recusa sem aplicar nada", async () => {
    const outra = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 87)");
      const c = await db.connect();
      try {
        await c.query("begin");
        expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
      } finally { await c.query("rollback").catch(() => {}); c.release(); }
    } finally { await outra.query("rollback").catch(() => {}); outra.release(); }
    expect((await db.query<{ t: string | null }>("select to_regclass('erp.satelite_consultas')::text t")).rows[0]!.t).toBeNull();
  });

  it("DB-2 (a) SOBE como o runner: NENHUMA linha de nenhuma tabela muda, as colunas novas nascem nulas e a análise não é regravada", async () => {
    catalogo0052 = await retratoCatalogo();
    colunas0052 = await colunasPorTabela();
    dados0052 = await retratoDados(colunas0052);
    analises0052 = await analisesOrdenadas();
    filenode0052 = (await db.query<{ f: string }>("select pg_relation_filenode('erp.analises_satelitais')::text f")).rows[0]!.f;
    // Premissa do retrato: não vazio, e com o acervo que a comparação precisa enxergar.
    expect(Object.keys(dados0052).length).toBeGreaterThan(150);
    expect(dados0052.analises_satelitais).toMatch(/^linhas=4 /);
    expect(analises0052).toHaveLength(4);

    await aplicarComoORunner();
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    catalogo0053 = await retratoCatalogo();

    // Os dados de TODAS as tabelas que existiam, projetados nas colunas de antes: idênticos (nenhuma escrita, nem
    // auditoria). As tabelas novas existem e estão vazias.
    expect(await retratoDados(colunas0052)).toEqual(dados0052);
    const depois = await colunasPorTabela();
    for (const t of TABELAS_NOVAS) expect(await retratoDados({ [t]: depois[t]! })).toEqual({ [t]: `linhas=0 md5=${createHash("md5").update("").digest("hex")}` });
    expect(depois.analises_satelitais).toEqual([...colunas0052.analises_satelitais!, ...COLUNAS_NOVAS]);

    // Linha a linha, com TODAS as colunas antigas: iguais; as três novas, nulas em todas.
    const agora = await analisesOrdenadas();
    expect(agora.map((j) => Object.fromEntries(Object.entries(j).filter(([k]) => !COLUNAS_NOVAS.includes(k))))).toEqual(analises0052);
    expect(agora.map((j) => COLUNAS_NOVAS.map((k) => j[k]))).toEqual(analises0052.map(() => [null, null, null, null]));
    // ADD COLUMN anulável sem default é só catálogo: o arquivo físico da tabela é o mesmo.
    expect((await db.query<{ f: string }>("select pg_relation_filenode('erp.analises_satelitais')::text f")).rows[0]!.f, "a tabela não foi regravada").toBe(filenode0052);
  });

  it("DB-2 a imutabilidade da 0052 CONTINUA: UPDATE (inclusive só de coluna nova), DELETE e TRUNCATE recusados; nada muda", async () => {
    const id = analiseA;
    expect((await erroDe(db.query("update erp.analises_satelitais set resolucao_nativa_m = 10 where id=$1", [id]))).message).toBe(IMUTAVEL_ANALISE);
    expect((await erroDe(db.query("update erp.analises_satelitais set valor_medio = 0.5 where id=$1", [id]))).message).toBe(IMUTAVEL_ANALISE);
    expect((await erroDe(db.query("delete from erp.analises_satelitais where id=$1", [id]))).message).toBe(IMUTAVEL_ANALISE);
    // Depois da 0053 a análise é ALVO de FK (o item da fila aponta para ela): o TRUNCATE simples para antes, na FK
    // (0A000); com CASCADE ele chega ao gatilho de comando da 0052, que recusa a instrução inteira.
    const truncar = await erroDe(db.query("truncate erp.analises_satelitais"));
    expect([truncar.code, truncar.message]).toEqual(["0A000", "cannot truncate a table referenced in a foreign key constraint"]);
    expect((await erroDe(db.query("truncate erp.analises_satelitais cascade"))).message).toBe(IMUTAVEL_ANALISE);
    expect(await analisesOrdenadas().then((l) => l.map((j) => Object.fromEntries(Object.entries(j).filter(([k]) => !COLUNAS_NOVAS.includes(k))))))
      .toEqual(analises0052);
  });

  it("DB-2 análise NOVA com as colunas novas grava (o item da fila, a resolução nativa, o sha256 do evalscript); os CHECKs delas valem", async () => {
    const consulta = (await inserirConsulta(db, { empresa: A })).rows[0]!.id;
    const item = (await inserirItem(db, { empresa: A, consulta, area: areaA, hash: await hashDe(areaA) })).rows[0]!.id;
    const evalscript = sha("evalscript ndvi-v2");
    const nova = (await inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-09-01T00:00:00Z", novas: { item, resolucao: 10, evalscript } })).rows[0]!.id;
    expect((await db.query("select consulta_item_id, resolucao_nativa_m, evalscript_sha256 from erp.analises_satelitais where id=$1", [nova])).rows[0])
      .toEqual({ consulta_item_id: item, resolucao_nativa_m: 10, evalscript_sha256: evalscript });
    expect((await erroDe(inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-09-02T00:00:00Z", novas: { item, resolucao: 0, evalscript } }))).constraint)
      .toBe("chk_analises_satelitais_resolucao_nativa");
    expect((await erroDe(inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-09-03T00:00:00Z", novas: { item, resolucao: 10, evalscript: "XYZ" } }))).constraint)
      .toBe("chk_analises_satelitais_evalscript_sha256");
    // O item aponta para a análise que produziu (FK composta nova, item → análise).
    expect((await db.query("update erp.satelite_consulta_itens set analise_id=$2, situacao='concluido' where id=$1", [item, nova])).rowCount).toBe(1);
  });

  it("DB-2 (c) reaplicar a 0053 já aplicada para no preflight, com a mensagem de 'já aplicada', sem mudar o catálogo", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      expect((await erroDe(c.query(SQL_ALVO))).message).toBe(JA);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0053);
  });
});

describe("DB-3 — as listas fechadas do banco são as do domínio", () => {
  const lista = async (nome: string) => {
    const def = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname=$1", [nome])).rows[0]!.d;
    return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
  };
  it("situação da consulta e do item, índice, versão do método, operação do consumo e as situações VIVAS da chave espelham @agro/domain", async () => {
    expect(await lista("chk_satelite_consultas_situacao")).toEqual(SITUACOES_CONSULTA_SATELITE.map(([v]) => v));
    expect(await lista("chk_satelite_consulta_itens_situacao")).toEqual(SITUACOES_ITEM_CONSULTA_SATELITE.map(([v]) => v));
    expect(await lista("chk_satelite_consulta_itens_indice_bundle")).toEqual([...INDICES_CONSULTA_SATELITE]);
    expect(await lista("chk_satelite_consulta_itens_versao_metodo")).toEqual([VERSAO_METODO_NDVI_V2]);
    expect(await lista("chk_satelite_consumo_operacao")).toEqual([...OPERACOES_CONSUMO_SATELITE]);
    const indice = (await db.query<{ unico: boolean; predicado: string; def: string }>(
      `select i.indisunique unico, pg_get_expr(i.indpred, i.indrelid) predicado, pg_get_indexdef(i.indexrelid) def
         from pg_index i where i.indexrelid = 'erp.uq_satelite_consulta_itens_chave'::regclass`)).rows[0]!;
    expect(indice.unico).toBe(true);
    expect(indice.def).toMatch(/ON erp\.satelite_consulta_itens USING btree \(organization_id, chave_idempotencia\) WHERE/);
    expect([...indice.predicado.matchAll(/'([^']+)'::text/g)].map((m) => m[1])).toEqual([...SITUACOES_ITEM_VIVAS]);
  });
});

describe("DB-4 (d) — RLS por empresa no módulo da área (pecuária), nas quatro tabelas novas", () => {
  /** Uma linha de cada tabela em A, em B e na outra organização (X), gravadas pelo superusuário. */
  const ids: Record<TabelaNova, { A: string; B: string; X: string }> = {} as Record<TabelaNova, { A: string; B: string; X: string }>;
  const todos = (t: TabelaNova) => [ids[t].A, ids[t].B, ids[t].X];
  const ler = (ctx: TenantContext, t: TabelaNova) =>
    withTx(app, ctx, async (tx) => (await tx.query<{ id: string }>(`select id from erp.${t} where id = any($1::uuid[])`, [todos(t)])).rows.map((r) => r.id).sort());

  beforeAll(async () => {
    const linha = async (org: string, empresa: string, area: string, mes: string) => {
      const consulta = (await inserirConsulta(db, { org, empresa })).rows[0]!.id;
      const item = (await inserirItem(db, { org, empresa, consulta, area })).rows[0]!.id;
      const consumo = (await inserirConsumo(db, { org, empresa, item, consulta })).rows[0]!.id;
      const orcamento = (await inserirOrcamento(db, { org, empresa, mes })).rows[0]!.id;
      return { satelite_consultas: consulta, satelite_consulta_itens: item, satelite_consumo: consumo, satelite_orcamentos: orcamento };
    };
    const a = await linha(demo.orgId, A, areaA, "2026-01-01");
    const b = await linha(demo.orgId, B, areaB, "2026-01-01");
    const x = await linha(outraOrg, empresaX, areaX, "2026-01-01");
    for (const t of TABELAS_NOVAS) ids[t] = { A: a[t], B: b[t], X: x[t] };
  });

  it("PREMISSA: as linhas existem (superusuário vê as três de cada tabela); o DONO da demo vê A e B, nunca a outra organização", async () => {
    for (const t of TABELAS_NOVAS) {
      expect((await db.query(`select 1 from erp.${t} where id = any($1::uuid[])`, [todos(t)])).rowCount, t).toBe(3);
      expect(await ler(ctxPec(demo.adminUserId), t), t).toEqual([ids[t].A, ids[t].B].sort());
    }
  });

  it("membro de OUTRA organização não vê nenhuma linha da demo (vê só as da organização dele)", async () => {
    for (const t of TABELAS_NOVAS) expect(await ler(ctxPec(donoOutraOrg, outraOrg), t), t).toEqual([ids[t].X]);
  });

  it("membro SEM escopo no módulo da área não vê nada — nem com escopo 'todas' em outro módulo, nem com lista vazia (nunca 'todas')", async () => {
    for (const t of TABELAS_NOVAS) {
      expect(await ler(ctxPec(usuarioSemPecuaria), t), `${t}: escopo só no financeiro`).toEqual([]);
      expect(await ler(ctxPec(usuarioListaVazia), t), `${t}: pecuária com lista vazia`).toEqual([]);
    }
  });

  it("membro com escopo só na empresa B vê só B", async () => {
    for (const t of TABELAS_NOVAS) expect(await ler(ctxPec(usuarioSoB), t), t).toEqual([ids[t].B]);
  });

  it("WITH CHECK: o erp_app grava em B; não grava em A nem em outra organização (42501); não muda linha de B para A; não alcança linha de A (0 linhas)", async () => {
    const soB = ctxPec(usuarioSoB);
    const naB = await withTx(app, soB, (tx) => inserirConsulta(tx, { empresa: B }));
    expect(naB.rowCount).toBe(1);
    expect((await erroDe(withTx(app, soB, (tx) => inserirConsulta(tx, { empresa: A })))).code).toBe("42501");
    expect((await erroDe(withTx(app, soB, (tx) => inserirConsulta(tx, { org: outraOrg, empresa: empresaX })))).code).toBe("42501");
    expect((await erroDe(withTx(app, ctxPec(donoOutraOrg, outraOrg), (tx) => inserirConsulta(tx, { empresa: A })))).code).toBe("42501");
    expect((await erroDe(withTx(app, soB, (tx) => inserirItem(tx, { empresa: A, consulta: ids.satelite_consultas.A, area: areaA })))).code).toBe("42501");
    expect((await erroDe(withTx(app, soB, (tx) => inserirConsumo(tx, { empresa: A, consulta: ids.satelite_consultas.A })))).code).toBe("42501");
    // Item e consumo em B passam (o positivo da mesma porta).
    const itemB = await withTx(app, soB, (tx) => inserirItem(tx, { empresa: B, consulta: ids.satelite_consultas.B, area: areaB }));
    expect(itemB.rowCount).toBe(1);
    expect((await withTx(app, soB, (tx) => inserirConsumo(tx, { empresa: B, item: itemB.rows[0]!.id, consulta: ids.satelite_consultas.B }))).rowCount).toBe(1);
    // Mover a consulta de B para A: a linha NOVA não passa no with check.
    const r = await erroDe(withTx(app, soB, (tx) => tx.query("update erp.satelite_consultas set empresa_id=$2 where id=$1", [naB.rows[0]!.id, A])));
    expect(r.code).toBe("42501");
    // A linha de A não é alcançada: zero linhas, sem erro — quem grava tem de conferir o ROW COUNT.
    expect((await withTx(app, soB, (tx) => tx.query("update erp.satelite_consultas set situacao='cancelada', concluida_em=now() where id=$1", [ids.satelite_consultas.A]))).rowCount).toBe(0);
    expect((await db.query<{ s: string }>("select situacao s from erp.satelite_consultas where id=$1", [ids.satelite_consultas.A])).rows[0]!.s).toBe("pendente");
    // Orçamento: o erp_app só lê (nenhuma rota escreve orçamento nesta fatia).
    expect((await erroDe(withTx(app, ctxPec(demo.adminUserId), (tx) => inserirOrcamento(tx, { empresa: B, mes: "2026-02-01" })))).code).toBe("42501");
  });

  it("auditoria: a criação da consulta e do orçamento fica em erp.audit_logs (o item da fila não é auditado por linha)", async () => {
    const audit = async (entidade: string, id: string) =>
      (await db.query("select 1 from erp.audit_logs where entity=$1 and entity_id=$2 and action='create'", [entidade, id])).rowCount;
    expect(await audit("satelite_consultas", ids.satelite_consultas.A)).toBe(1);
    expect(await audit("satelite_orcamentos", ids.satelite_orcamentos.A)).toBe(1);
    expect(await audit("satelite_consumo", ids.satelite_consumo.A)).toBe(1);
    expect(await audit("satelite_consulta_itens", ids.satelite_consulta_itens.A)).toBe(0);
  });

  it("auditoria da consulta: UPDATE só de contador NÃO audita; a mudança de SITUAÇÃO audita (antes e depois)", async () => {
    const consulta = (await inserirConsulta(db, { empresa: A, totais: [3, 0, 0, 0] })).rows[0]!.id;
    const alteracoes = async () => (await db.query<{ antes: string; depois: string; concluidos: number }>(
      `select before->>'situacao' antes, after->>'situacao' depois, (after->>'total_concluidos')::int concluidos
         from erp.audit_logs where entity='satelite_consultas' and entity_id=$1 and action='update' order by created_at, id`, [consulta])).rows;
    // O executor avança os contadores item a item: nenhuma linha de auditoria por avanço.
    expect((await db.query("update erp.satelite_consultas set total_concluidos = 1 where id=$1", [consulta])).rowCount).toBe(1);
    expect((await db.query("update erp.satelite_consultas set total_concluidos = 2, total_falhos = 0 where id=$1", [consulta])).rowCount).toBe(1);
    expect(await alteracoes()).toEqual([]);
    // Mudou a situação: uma linha, com o antes e o depois.
    expect((await db.query("update erp.satelite_consultas set situacao = 'executando' where id=$1", [consulta])).rowCount).toBe(1);
    expect(await alteracoes()).toEqual([{ antes: "pendente", depois: "executando", concluidos: 2 }]);
    // Contador de novo: continua uma linha só; terminar a consulta (situação nova): a segunda.
    await db.query("update erp.satelite_consultas set total_concluidos = 3 where id=$1", [consulta]);
    await db.query("update erp.satelite_consultas set situacao = 'concluida', concluida_em = now() where id=$1", [consulta]);
    expect(await alteracoes()).toEqual([
      { antes: "pendente", depois: "executando", concluidos: 2 },
      { antes: "executando", depois: "concluida", concluidos: 3 }
    ]);
    expect((await db.query("select 1 from erp.audit_logs where entity='satelite_consultas' and entity_id=$1 and action='create'", [consulta])).rowCount).toBe(1);
  });
});

describe("DB-5 (e) — o ledger erp.satelite_consumo é imutável, e o crédito é derivado do PU", () => {
  let consumo: string; let consulta: string;
  beforeAll(async () => {
    consulta = (await inserirConsulta(db, { empresa: A })).rows[0]!.id;
    consumo = (await inserirConsumo(db, { empresa: A, consulta, pu: "0.5000", creditos: "50.00" })).rows[0]!.id;
  });

  it("UPDATE, DELETE e TRUNCATE recusados até para o dono do schema; nada muda", async () => {
    const antes = (await db.query("select count(*)::int n from erp.satelite_consumo")).rows[0];
    expect((await erroDe(db.query("update erp.satelite_consumo set pu_gasto = 0, creditos = 0 where id=$1", [consumo]))).message).toBe(IMUTAVEL_CONSUMO);
    expect((await erroDe(db.query("delete from erp.satelite_consumo where id=$1", [consumo]))).message).toBe(IMUTAVEL_CONSUMO);
    expect((await erroDe(db.query("truncate erp.satelite_consumo"))).message).toBe(IMUTAVEL_CONSUMO);
    expect((await db.query("select count(*)::int n from erp.satelite_consumo")).rows[0]).toEqual(antes);
    expect((await db.query("select pu_gasto, creditos from erp.satelite_consumo where id=$1", [consumo])).rows[0]).toEqual({ pu_gasto: "0.5000", creditos: "50.00" });
  });

  it("erp_app: SELECT e INSERT; sem UPDATE, DELETE e TRUNCATE (42501 na tentativa)", async () => {
    const priv = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean; t: boolean }>(
      `select has_table_privilege('erp_app','erp.satelite_consumo','SELECT') s, has_table_privilege('erp_app','erp.satelite_consumo','INSERT') i,
              has_table_privilege('erp_app','erp.satelite_consumo','UPDATE') u, has_table_privilege('erp_app','erp.satelite_consumo','DELETE') d,
              has_table_privilege('erp_app','erp.satelite_consumo','TRUNCATE') t`)).rows[0];
    expect(priv).toEqual({ s: true, i: true, u: false, d: false, t: false });
    const dono = ctxPec(demo.adminUserId);
    expect((await erroDe(withTx(app, dono, (tx) => tx.query("update erp.satelite_consumo set creditos = 0 where id=$1", [consumo])))).code).toBe("42501");
    expect((await erroDe(withTx(app, dono, (tx) => tx.query("delete from erp.satelite_consumo where id=$1", [consumo])))).code).toBe("42501");
    expect((await erroDe(withTx(app, dono, (tx) => tx.query("truncate erp.satelite_consumo")))).code).toBe("42501");
  });

  it("CHECK creditos = round(pu_gasto * 100, 2): o derivado grava; qualquer divergência, PU negativo e operação fora da lista → 23514", async () => {
    expect((await inserirConsumo(db, { empresa: A, consulta, pu: "1.2345", creditos: "123.45" })).rowCount).toBe(1);
    expect((await inserirConsumo(db, { empresa: A, consulta, pu: "0.0000", creditos: "0.00", operacao: "catalog" })).rowCount).toBe(1);
    const casos: [string, Consumo, string][] = [
      ["crédito um centavo acima", { empresa: A, consulta, pu: "1.2345", creditos: "123.46" }, "chk_satelite_consumo_creditos"],
      ["crédito sem a conversão", { empresa: A, consulta, pu: "1.2345", creditos: "1.23" }, "chk_satelite_consumo_creditos"],
      ["PU negativo", { empresa: A, consulta, pu: "-0.0100", creditos: "-1.00" }, "chk_satelite_consumo_pu"],
      ["operação fora da lista", { empresa: A, consulta, operacao: "batch" }, "chk_satelite_consumo_operacao"]
    ];
    for (const [nome, c, restricao] of casos) {
      const e = await erroDe(inserirConsumo(db, c));
      expect([nome, e.code, e.constraint]).toEqual([nome, "23514", restricao]);
    }
  });
});

describe("DB-6 (f) — UM item VIVO por organização e chave de idempotência", () => {
  let consulta: string;
  beforeAll(async () => { consulta = (await inserirConsulta(db, { empresa: A })).rows[0]!.id; });
  const item = (chave: string, situacao: string) => inserirItem(db, { empresa: A, consulta, area: areaA, chave, situacao });

  it("dois VIVOS (pendente/executando/concluido) com a mesma chave → unique_violation (23505) no índice parcial", async () => {
    const K = chaveNova();
    expect((await item(K, "pendente")).rowCount).toBe(1);
    for (const s of ["pendente", "executando", "concluido"]) {
      const e = await erroDe(item(K, s));
      expect([s, e.code, e.constraint]).toEqual([s, "23505", "uq_satelite_consulta_itens_chave"]);
    }
  });

  it("'reaproveitado', 'falho' e 'cancelado' com a mesma chave convivem com o vivo", async () => {
    const K = chaveNova();
    await item(K, "concluido");
    for (const s of ["reaproveitado", "falho", "cancelado", "reaproveitado"]) expect((await item(K, s)).rowCount, s).toBe(1);
    expect((await db.query<{ s: string; n: number }>(
      "select situacao s, count(*)::int n from erp.satelite_consulta_itens where organization_id=$2 and chave_idempotencia=$1 group by situacao order by situacao", [K, demo.orgId])).rows)
      .toEqual([{ s: "cancelado", n: 1 }, { s: "concluido", n: 1 }, { s: "falho", n: 1 }, { s: "reaproveitado", n: 2 }]);
  });

  it("um vivo NOVO é aceito depois que o anterior vira 'falho'; reviver o falho com outro vivo de pé → 23505", async () => {
    const K = chaveNova();
    const primeiro = (await item(K, "executando")).rows[0]!.id;
    expect((await db.query("update erp.satelite_consulta_itens set situacao='falho', tentativas=3, erro='sem resposta' where id=$1", [primeiro])).rowCount).toBe(1);
    expect((await item(K, "pendente")).rowCount).toBe(1);
    const e = await erroDe(db.query("update erp.satelite_consulta_itens set situacao='pendente' where id=$1", [primeiro]));
    expect([e.code, e.constraint]).toEqual(["23505", "uq_satelite_consulta_itens_chave"]);
  });

  it("a unicidade é POR ORGANIZAÇÃO: a mesma chave viva em OUTRA organização é aceita; na mesma organização, mesmo em outra empresa, 23505", async () => {
    const K = chaveNova();
    expect((await item(K, "pendente")).rowCount).toBe(1);
    const consultaX = (await inserirConsulta(db, { org: outraOrg, empresa: empresaX })).rows[0]!.id;
    expect((await inserirItem(db, { org: outraOrg, empresa: empresaX, consulta: consultaX, area: areaX, chave: K, situacao: "pendente" })).rowCount).toBe(1);
    const consultaB = (await inserirConsulta(db, { empresa: B })).rows[0]!.id;
    const e = await erroDe(inserirItem(db, { empresa: B, consulta: consultaB, area: areaB, chave: K, situacao: "executando" }));
    expect([e.code, e.constraint]).toEqual(["23505", "uq_satelite_consulta_itens_chave"]);
    expect((await db.query<{ org: string }>(
      "select organization_id::text org from erp.satelite_consulta_itens where chave_idempotencia=$1 and situacao in ('pendente','executando','concluido') order by 1", [K])).rows.map((x) => x.org).sort())
      .toEqual([demo.orgId, outraOrg].sort());
  });

  it("o INSERT da API (on conflict (organization_id, chave) where <vivas> do nothing), como erp_app: chave viva → 0 linhas; chave livre → 1 linha", async () => {
    const viva = chaveNova();
    await item(viva, "pendente");
    const inserirComoAApi = (chave: string) => withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
         janela_inicio, janela_fim, chave_idempotencia, chave_idempotencia_origem)
       values ($1,$2,$3,$4,$5,'ndvi','ndvi-v2','2026-09-05','2026-10-04',$6,'origem')
       on conflict (organization_id, chave_idempotencia) where situacao in ('pendente', 'executando', 'concluido') do nothing`,
      [consulta, demo.orgId, A, areaA, sha("geom"), chave]));
    expect((await inserirComoAApi(viva)).rowCount).toBe(0);
    expect((await inserirComoAApi(chaveNova())).rowCount).toBe(1);
  });
});

describe("DB-7 (g) — FKs compostas (empresa e vínculos) e CHECKs", () => {
  let consultaA: string; let consultaA2: string; let consultaB: string; let consultaX: string; let itemA: string; let itemB: string;
  let areaA2: string; let analiseA2: string;
  beforeAll(async () => {
    consultaA = (await inserirConsulta(db, { empresa: A })).rows[0]!.id;
    consultaA2 = (await inserirConsulta(db, { empresa: A })).rows[0]!.id;
    consultaB = (await inserirConsulta(db, { empresa: B })).rows[0]!.id;
    consultaX = (await inserirConsulta(db, { org: outraOrg, empresa: empresaX })).rows[0]!.id;
    itemA = (await inserirItem(db, { empresa: A, consulta: consultaA, area: areaA })).rows[0]!.id;
    itemB = (await inserirItem(db, { empresa: B, consulta: consultaB, area: areaB })).rows[0]!.id;
    // Outra área da MESMA empresa A, com análise própria: o vínculo errado aqui não é de empresa, é de ÁREA.
    areaA2 = await id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
         values ($1,$2,'SAT2-A2','[TEST] SAT2 SAT2-A2',12,12,'pastagem','ativa','propria',$3) returning id`, [demo.orgId, A, JSON.stringify(POLIGONO)]);
    analiseA2 = (await inserirAnalise(db, { empresa: A, area: areaA2, janelaInicio: "2026-08-01T00:00:00Z" })).rows[0]!.id;
  });
  const fk = async (p: Promise<unknown>) => { const e = await erroDe(p); return [e.code, e.constraint]; };

  it("item, consumo, consulta e orçamento apontando para OUTRA empresa ou OUTRA organização → 23503 na FK composta", async () => {
    expect(await fk(inserirItem(db, { empresa: B, consulta: consultaA, area: areaB }))).toEqual(["23503", "fk_satelite_consulta_itens_consulta"]);
    expect(await fk(inserirItem(db, { empresa: A, consulta: consultaX, area: areaA }))).toEqual(["23503", "fk_satelite_consulta_itens_consulta"]);
    expect(await fk(inserirItem(db, { empresa: B, consulta: consultaB, area: areaA }))).toEqual(["23503", "fk_satelite_consulta_itens_area"]);
    expect(await fk(inserirItem(db, { empresa: A, consulta: consultaA, area: areaX }))).toEqual(["23503", "fk_satelite_consulta_itens_area"]);
    expect(await fk(inserirItem(db, { empresa: A, consulta: consultaA, area: areaA, analise: analiseB }))).toEqual(["23503", "fk_satelite_consulta_itens_analise"]);
    expect(await fk(inserirConsumo(db, { empresa: B, consulta: consultaB, item: itemA }))).toEqual(["23503", "fk_satelite_consumo_item"]);
    expect(await fk(inserirConsumo(db, { empresa: A, consulta: consultaX }))).toEqual(["23503", "fk_satelite_consumo_consulta"]);
    expect(await fk(inserirConsumo(db, { empresa: A, consulta: consultaB }))).toEqual(["23503", "fk_satelite_consumo_consulta"]);
    expect(await fk(inserirConsulta(db, { empresa: empresaX }))).toEqual(["23503", "fk_satelite_consultas_empresa"]);
    expect(await fk(inserirOrcamento(db, { empresa: empresaX, mes: "2026-03-01" }))).toEqual(["23503", "fk_satelite_orcamentos_empresa"]);
    // A análise nova não aponta para item de outra empresa (FK análise → item).
    expect(await fk(inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-07-01T00:00:00Z", novas: { item: itemB, resolucao: 10, evalscript: null } })))
      .toEqual(["23503", "fk_analises_satelitais_consulta_item"]);
    // O positivo das mesmas portas: tudo na mesma (organização, empresa) grava.
    expect((await inserirItem(db, { empresa: A, consulta: consultaA, area: areaA, analise: analiseA })).rowCount).toBe(1);
    expect((await inserirConsumo(db, { empresa: A, item: itemA, consulta: consultaA })).rowCount).toBe(1);
  });

  it("VÍNCULOS na mesma empresa: consumo com item de OUTRA consulta, consumo com item e sem consulta, análise × item de OUTRA área → recusados; os certos gravam", async () => {
    // Consumo: o item tem de ser DA consulta do consumo (FK por organização, empresa, consulta, item).
    expect(await fk(inserirConsumo(db, { empresa: A, consulta: consultaA2, item: itemA }))).toEqual(["23503", "fk_satelite_consumo_item"]);
    // Consumo com item e sem consulta: com MATCH SIMPLE a FK do item se desligaria — o CHECK recusa antes.
    expect(await fk(inserirConsumo(db, { empresa: A, item: itemA }))).toEqual(["23514", "chk_satelite_consumo_item_com_consulta"]);
    expect((await inserirConsumo(db, { empresa: A, consulta: consultaA, item: itemA })).rowCount, "item da própria consulta").toBe(1);
    expect((await inserirConsumo(db, { empresa: A, consulta: consultaA2 })).rowCount, "consumo só da consulta").toBe(1);
    // Item → análise: a análise tem de ser da ÁREA do item (FK por organização, empresa, área, análise).
    expect(await fk(inserirItem(db, { empresa: A, consulta: consultaA, area: areaA, analise: analiseA2 }))).toEqual(["23503", "fk_satelite_consulta_itens_analise"]);
    expect((await inserirItem(db, { empresa: A, consulta: consultaA, area: areaA2, analise: analiseA2 })).rowCount, "análise da própria área").toBe(1);
    const e = await erroDe(db.query("update erp.satelite_consulta_itens set analise_id=$2 where id=$1", [itemA, analiseA2]));
    expect([e.code, e.constraint], "nem por UPDATE").toEqual(["23503", "fk_satelite_consulta_itens_analise"]);
    // Análise → item: o item tem de ser da ÁREA da análise (FK por organização, empresa, área, item).
    expect(await fk(inserirAnalise(db, { empresa: A, area: areaA2, janelaInicio: "2026-06-01T00:00:00Z", novas: { item: itemA, resolucao: 10, evalscript: null } })))
      .toEqual(["23503", "fk_analises_satelitais_consulta_item"]);
    expect((await inserirAnalise(db, { empresa: A, area: areaA, janelaInicio: "2026-06-01T00:00:00Z", novas: { item: itemA, resolucao: 10, evalscript: null } })).rowCount,
      "item da própria área").toBe(1);
  });

  it("consequência declarada da FK composta item → área: área COM item na fila não muda de empresa (23503); SEM item, muda", async () => {
    const nova = (codigo: string) => id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
         values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [demo.orgId, A, codigo, `[TEST] SAT2 ${codigo}`, JSON.stringify(POLIGONO)]);
    const comItem = await nova("SAT2-FILA");
    await inserirItem(db, { empresa: A, consulta: consultaA, area: comItem });
    expect(await fk(db.query("update erp.areas set empresa_id=$2 where id=$1", [comItem, B]))).toEqual(["23503", "fk_satelite_consulta_itens_area"]);
    expect((await db.query<{ e: string }>("select empresa_id::text e from erp.areas where id=$1", [comItem])).rows[0]!.e).toBe(A);
    const livre = await nova("SAT2-LIVRE");
    expect((await db.query("update erp.areas set empresa_id=$2 where id=$1", [livre, B])).rowCount).toBe(1);
  });

  it("orçamento: mes_referencia que não é dia 1, duplicata (organização, empresa, mês) e limite negativo recusados; SEM linha = sem limite (nenhum padrão)", async () => {
    expect(await fk(inserirOrcamento(db, { empresa: A, mes: "2026-10-02" }))).toEqual(["23514", "chk_satelite_orcamentos_mes"]);
    expect(await fk(inserirOrcamento(db, { empresa: A, mes: "2026-04-30" }))).toEqual(["23514", "chk_satelite_orcamentos_mes"]);
    expect((await inserirOrcamento(db, { empresa: A, mes: "2026-04-01" })).rowCount).toBe(1);
    expect(await fk(inserirOrcamento(db, { empresa: A, mes: "2026-04-01", limite: "5.00" }))).toEqual(["23505", "uq_satelite_orcamentos_mes"]);
    expect((await inserirOrcamento(db, { empresa: B, mes: "2026-04-01" })).rowCount, "o mesmo mês em OUTRA empresa").toBe(1);
    expect(await fk(inserirOrcamento(db, { empresa: A, mes: "2026-05-01", limite: "-1.00" }))).toEqual(["23514", "chk_satelite_orcamentos_limite"]);
    expect((await db.query<{ d: string | null }>(
      "select column_default d from information_schema.columns where table_schema='erp' and table_name='satelite_orcamentos' and column_name='limite_creditos'")).rows[0]!.d).toBeNull();
  });

  it("CHECKs da consulta e do item → 23514 com o nome da restrição", async () => {
    const consulta: [string, Consulta, string][] = [
      ["mínimo acima do máximo", { empresa: A, estimativa: "1.00", minima: "2.00" }, "chk_satelite_consultas_estimativa"],
      ["mínimo negativo", { empresa: A, estimativa: "1.00", minima: "-1.00" }, "chk_satelite_consultas_estimativa"],
      ["contadores somam mais que o total", { empresa: A, totais: [2, 1, 1, 1] }, "chk_satelite_consultas_contadores"],
      ["contador negativo", { empresa: A, totais: [2, -1, 0, 0] }, "chk_satelite_consultas_contadores"],
      ["concluída_em numa pendente", { empresa: A, concluidaEm: new Date() }, "chk_satelite_consultas_concluida_em"],
      ["parâmetros que não são objeto", { empresa: A, parametros: "[1,2]" }, "chk_satelite_consultas_parametros"],
      ["situação fora da lista", { empresa: A, situacao: "concluido" }, "chk_satelite_consultas_situacao"]
    ];
    for (const [nome, c, restricao] of consulta) expect([nome, ...(await fk(inserirConsulta(db, c)))]).toEqual([nome, "23514", restricao]);
    expect((await inserirConsulta(db, { empresa: A, situacao: "concluida_com_falhas", totais: [3, 1, 1, 1], concluidaEm: new Date() })).rowCount).toBe(1);

    const base = { empresa: A, consulta: consultaA, area: areaA };
    const item: [string, Item, string][] = [
      ["data alvo fora da janela", { ...base, dataAlvo: "2026-10-05", janela: ["2026-09-05", "2026-10-04"] }, "chk_satelite_consulta_itens_janela"],
      ["janela invertida", { ...base, janela: ["2026-10-04", "2026-09-05"] }, "chk_satelite_consulta_itens_janela"],
      ["chave que não é sha256 hex", { ...base, chave: "ABC" }, "chk_satelite_consulta_itens_chave"],
      ["geometria que não é sha256 hex", { ...base, hash: "g".repeat(64) }, "chk_satelite_consulta_itens_geometria_sha256"],
      ["versão do método fora da lista", { ...base, versao: "sat01-ndvi-v1" }, "chk_satelite_consulta_itens_versao_metodo"],
      ["situação fora da lista", { ...base, situacao: "concluida" }, "chk_satelite_consulta_itens_situacao"],
      ["tentativas negativas", { ...base, tentativas: -1 }, "chk_satelite_consulta_itens_tentativas"],
      ["PU negativo", { ...base, pu: "-0.0001" }, "chk_satelite_consulta_itens_pu_gasto"]
    ];
    for (const [nome, i, restricao] of item) expect([nome, ...(await fk(inserirItem(db, i)))]).toEqual([nome, "23514", restricao]);
    expect((await inserirItem(db, { ...base, dataAlvo: "2026-09-20", janela: ["2026-09-10", "2026-09-30"] })).rowCount, "data alvo dentro da janela").toBe(1);
  });
});

describe("DB-7b — a unicidade da janela da análise com data_alvo (NULLS NOT DISTINCT, o MESMO nome da 0052)", () => {
  it("catálogo: uq_analises_satelitais_janela = as 9 colunas da 0052 + data_alvo, NULLS NOT DISTINCT", async () => {
    const r = (await db.query<{ colunas: string[]; nnd: boolean }>(
      `select (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) colunas, i.indnullsnotdistinct nnd
         from pg_constraint c join pg_index i on i.indexrelid = c.conindid
        where c.conname = 'uq_analises_satelitais_janela' and c.conrelid = 'erp.analises_satelitais'::regclass`)).rows;
    expect(r).toEqual([{ colunas: [...UQ_JANELA_0052, "data_alvo"], nnd: true }]);
  });

  it("v1 (data_alvo nula) repetida na mesma janela continua recusada (inclusive pelo on conflict da SAT-01); v2 com datas alvo diferentes convivem; a mesma data alvo → 23505; data alvo fora da janela → 23514", async () => {
    // Tudo numa transação DESFEITA: análise é imutável, e linhas que a 0052 recusaria impediriam a volta do DB-8.
    const c = await db.connect();
    const recusa = async (sql: Promise<unknown>) => {
      await c.query("savepoint s");
      const e = await erroDe(sql);
      await c.query("rollback to savepoint s");
      return [e.code, e.constraint];
    };
    const v = (dataAlvo: string | null) => inserirAnalise(c, { empresa: B, area: areaB, janelaInicio: "2026-05-01T00:00:00Z", novas: { item: null, resolucao: null, evalscript: null, dataAlvo } });
    try {
      await c.query("begin");
      // A janela: 2026-05-01 00:00Z até 2026-05-31 00:00Z (exclusiva) — os dias 01..30.
      expect((await inserirAnalise(c, { empresa: B, area: areaB, janelaInicio: "2026-05-01T00:00:00Z" })).rowCount, "a v1, sem data alvo").toBe(1);
      expect(await recusa(inserirAnalise(c, { empresa: B, area: areaB, janelaInicio: "2026-05-01T00:00:00Z" })), "v1 repetida").toEqual(["23505", "uq_analises_satelitais_janela"]);
      expect(await recusa(v(null)), "data alvo nula explícita = a mesma chave da v1 (NULLS NOT DISTINCT)").toEqual(["23505", "uq_analises_satelitais_janela"]);
      // O caminho da SAT-01: on conflict on constraint uq_analises_satelitais_janela do nothing → 0 linhas.
      const h = await hashDe(areaB);
      const viaSat01 = await c.query(
        `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
           janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, criado_por)
         values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi','ndvi-v2',$4,'2026-05-01T00:00:00Z','2026-05-31T00:00:00Z',10,'sem_observacao_util','sem_aquisicao',$5)
         on conflict on constraint uq_analises_satelitais_janela do nothing`, [demo.orgId, B, areaB, h, demo.adminUserId]);
      expect(viaSat01.rowCount, "on conflict da SAT-01 continua reaproveitando").toBe(0);
      // v2: datas alvo diferentes na MESMA janela convivem com a v1 e entre si.
      expect((await v("2026-05-10")).rowCount).toBe(1);
      expect((await v("2026-05-01")).rowCount, "o primeiro dia da janela").toBe(1);
      expect((await v("2026-05-30")).rowCount, "o último dia da janela").toBe(1);
      expect(await recusa(v("2026-05-10")), "a mesma data alvo").toEqual(["23505", "uq_analises_satelitais_janela"]);
      expect(await recusa(v("2026-05-31")), "o fim é exclusivo").toEqual(["23514", "chk_analises_satelitais_data_alvo"]);
      expect(await recusa(v("2026-04-30")), "antes da janela").toEqual(["23514", "chk_analises_satelitais_data_alvo"]);
      expect((await c.query("select count(*)::int n from erp.analises_satelitais where area_id=$1 and janela_inicio='2026-05-01T00:00:00Z'", [areaB])).rows[0])
        .toEqual({ n: 4 });
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect((await db.query("select 1 from erp.analises_satelitais where area_id=$1 and janela_inicio='2026-05-01T00:00:00Z'", [areaB])).rowCount, "nada ficou").toBe(0);
  });
});

describe("DB-8 (b) — a 0053 DESCE pelo SQL reverso e SOBE de novo", () => {
  it("FAIL-CLOSED: com duas análises na mesma janela e datas alvo diferentes (só a 0053 permite), a volta para inteira (23505) e nada muda", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      await inserirAnalise(c, { empresa: B, area: areaB, janelaInicio: "2026-04-01T00:00:00Z" });
      await inserirAnalise(c, { empresa: B, area: areaB, janelaInicio: "2026-04-01T00:00:00Z", novas: { item: null, resolucao: null, evalscript: null, dataAlvo: "2026-04-05" } });
      const e = await erroDe(c.query(SQL_REVERSO));
      expect([e.code, e.constraint]).toEqual(["23505", "uq_analises_satelitais_janela"]);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await retratoCatalogo()).toEqual(catalogo0053);
  });

  it("o SQL reverso volta o catálogo EXATAMENTE ao da 0052 (com linhas nas tabelas novas e análise apontando para item); as análises antigas não mudam", async () => {
    // Premissa: o retrato distingue os dois estados (senão a igualdade abaixo não provaria nada).
    expect(catalogo0053).not.toEqual(catalogo0052);
    expect(Object.keys(catalogo0053.colunas!).filter((k) => !(k in catalogo0052.colunas!)).sort())
      .toEqual(expect.arrayContaining(["analises_satelitais.consulta_item_id", "satelite_consumo.creditos", "satelite_consulta_itens.chave_idempotencia"]));
    expect(Object.keys(catalogo0052.colunas!).length).toBeGreaterThan(1000);
    expect((await db.query("select 1 from erp.analises_satelitais where consulta_item_id is not null")).rowCount).toBeGreaterThan(0);
    for (const t of TABELAS_NOVAS) expect((await db.query(`select 1 from erp.${t}`)).rowCount, t).toBeGreaterThan(0);

    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(SQL_REVERSO);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally { c.release(); }

    expect(await retratoCatalogo()).toEqual(catalogo0052);
    expect((await db.query<{ name: string }>("select name from public.erp_migrations order by name")).rows.map((r) => r.name)).toEqual(ANTERIORES.map((m) => m.name));
    const ids0052 = analises0052.map((j) => j.id as string);
    const antigas = (await db.query<{ j: Record<string, unknown> }>("select to_jsonb(a) j from erp.analises_satelitais a where id = any($1::uuid[]) order by id", [ids0052])).rows.map((r) => r.j);
    expect(antigas).toEqual(analises0052);
  });

  it("a 0053 é REAPLICADA em seguida, sem erro, e o catálogo fica igual ao da primeira aplicação", async () => {
    await aplicarComoORunner();
    expect(await retratoCatalogo()).toEqual(catalogo0053);
    for (const t of TABELAS_NOVAS) expect((await db.query(`select 1 from erp.${t}`)).rowCount, `${t} renasce vazia`).toBe(0);
  });
});
