import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import {
  TIPOS_DE_OBJETO_DE_MAPA, TIPOS_DE_LINHA, FORMAS_DE_OBJETO, UNIDADES_DE_CAPACIDADE, ORIGENS_DA_DATA, MOTIVOS_DE_SAIDA
} from "@agro/domain";
import { TEST_URL } from "./setup.js";

/**
 * A 0061 (MAPA-MANEJO-01, decisão 305 — fundação operacional do Mapa de Manejo), PROVADA CONTRA O BANCO como o runner
 * aplica (arquivo a arquivo, cada um numa transação), sobre um ACERVO semeado ANTES dela — para provar o backfill.
 *
 * MM-0 premissa (ledger até a 0060, nada da 0061, acervo contado) · MM-6 recusa sem efeito (trava ocupada; cada
 * pré-condição quebrada com a SUA mensagem; reaplicar) · MM-5c a 5.1 num banco sem a unique de código · MM-4 o backfill
 * (as três origens da data, os lotes que NÃO geram ocupação, nenhuma linha existente mudada fora da coluna nova, a
 * camada 2 pela ocupação NA DATA) · MM-1 o schema · MM-2 o validador de ponto/linha · MM-3 o gatilho de erp.batches ·
 * MM-5 RLS por empresa no módulo pecuaria e os privilégios revogados · MM-11c paridade com o domínio.
 *
 * Duas conexões: `db` (superusuário: monta o cenário, aplica e lê o catálogo) e `app` (papel da aplicação, SEM bypass
 * de RLS, com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let E1: string; let E2: string;
let A1: string; let A2: string; let A3: string; let A4: string; let B1: string;
let L1: string; let L2: string; let L3: string; let L4: string; let L5: string; let L6: string; let L7: string; let L9: string;
let mAntigo: string; let mRecente: string;
let H: Record<string, string>; let W: Record<string, string>;
let cocho: string;
let usuarioSoE1: string; let outraOrg: string; let donoOutraOrg: string;
let retratoInicial: Retrato;

const ALVO = "0061_ocupacao_de_area_e_objetos_de_mapa.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "MAPA-MANEJO-01: outra transacao ja detem a trava desta migration (2026,95). Nada foi aplicado.";
const JA = "MAPA-MANEJO-01: a 0061 ja foi aplicada (erp.ocupacoes_de_area, erp.objetos_de_mapa ou o validador ja existe).";
const GEOMETRIA = "VALIDATION_ERROR: Geometria do objeto inválida (esperado GeoJSON Point [lon,lat] para ponto, ou LineString com ao menos 2 posições [lon,lat] para linha).";
const BACKFILL = "MAPA-MANEJO-01: backfill — ocupacoes abertas=4 (movimento=1, entrada_do_lote=2, criacao_do_lote=1); animal_handlings com area=3, sem area=5; weighings com area=2, sem area=3.";
const UNIQUE_JA_EXISTE = "MAPA-MANEJO-01 (5.1): erp.areas ja tem unique (empresa_id, code); nada a criar.";
const UNIQUE_CRIADO = "MAPA-MANEJO-01 (5.1): unique (empresa_id, code) ausente em erp.areas e sem duplicatas; uq_areas_empresa_codigo criado.";
const PONTO = { type: "Point", coordinates: [-56.1, -15.6] };
const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
const FUNCOES = ["erp.objeto_de_mapa_geometria_valida(jsonb,text)", "erp.ocupacoes_de_area_conferir()", "erp.objetos_de_mapa_geometria_conferir()",
  "erp.objetos_de_mapa_cocho_conferir()", "erp.batches_fechar_ocupacao()", "erp.area_da_ocupacao_na_data()"];
const TABELAS_RETRATO = ["batches", "areas", "animal_movements", "herd_lots", "animals", "troughs", "audit_logs", "animal_handlings", "weighings"] as const;

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
  await c.query("savepoint mm_tentativa");
  try { await c.query(sql, p); } catch (e) {
    await c.query("rollback to savepoint mm_tentativa");
    const x = e as Erro; return { code: x.code, constraint: x.constraint, message: x.message };
  }
  await c.query("release savepoint mm_tentativa");
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
/** Aplica a 0061 na conexão dada e devolve os NOTICE/WARNING que ela emitiu (só os desta migration). */
async function aplicarCapturando(c: Tx): Promise<Aviso[]> {
  const avisos: Aviso[] = [];
  const ouvir = (n: { severity?: string; message?: string }) => { avisos.push({ severity: n.severity ?? "", message: n.message ?? "" }); };
  c.on("notice", ouvir);
  try { await c.query(SQL_ALVO); } finally { c.off("notice", ouvir); }
  return avisos.filter((a) => a.message.startsWith("MAPA-MANEJO-01"));
}
/** md5 de cada linha (manejo e pesagem SEM a coluna nova area_id), em ordem de id, e a contagem — por tabela. */
async function retrato(): Promise<Retrato> {
  const out: Retrato = {};
  for (const t of TABELAS_RETRATO) {
    const linha = t === "animal_handlings" || t === "weighings" ? "(to_jsonb(t) - 'area_id')::text" : "to_jsonb(t)::text";
    out[t] = (await db.query<{ n: number; h: string }>(
      `select count(*)::int n, coalesce(md5(string_agg(md5(${linha}), ',' order by t.id)), '') h from erp.${t} t`)).rows[0]!;
  }
  return out;
}
/** O que a 0061 cria e que NENHUMA sabotagem toca: se existir, a migration deixou efeito. */
async function nadaDa0061(q: Queryable = db) {
  return (await q.query<{ ocupacoes: string | null; objetos: string | null; funcao: string | null; gatilho: number; colunas: number; indice: string | null }>(
    `select to_regclass('erp.ocupacoes_de_area')::text ocupacoes, to_regclass('erp.objetos_de_mapa')::text objetos,
            to_regprocedure('erp.batches_fechar_ocupacao()')::text funcao,
            (select count(*)::int from pg_trigger where tgname in ('trg_batches_fechar_ocupacao','trg_animal_handlings_area_da_ocupacao','trg_weighings_area_da_ocupacao')) gatilho,
            (select count(*)::int from information_schema.columns where table_schema='erp' and table_name in ('animal_handlings','weighings') and column_name='area_id') colunas,
            to_regclass('erp.uq_ocupacao_aberta_por_lote')::text indice`)).rows[0]!;
}
const NADA = { ocupacoes: null, objetos: null, funcao: null, gatilho: 0, colunas: 0, indice: null };

const ctxPec = (userId: string, orgId = demo.orgId): TenantContext => ({ orgId, userId, modulo: "pecuaria" });
const area = (empresa: string, code: string) => id1(
  `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
   values ($1,$2,$3,$4,10,10,'pastagem','ativa','propria') returning id`, [demo.orgId, empresa, code, `[TEST] ${code}`]);
interface OpLote { empresa?: string; area?: string | null; entry?: string | null; status?: string; exit?: string | null; deletedAt?: string | null; createdAt?: string | null }
const lote = (code: string, o: OpLote = {}) => id1(
  `insert into erp.batches (organization_id, empresa_id, code, batch_date, description, area_id, entry_date, status, exit_date, deleted_at, created_at)
   values ($1,$2,$3,'2025-11-01',$4,$5,$6,$7,$8,$9::timestamptz, coalesce($10::timestamptz, now())) returning id`,
  [demo.orgId, o.empresa ?? E1, code, `[TEST] lote ${code}`, o.area ?? null, o.entry ?? null, o.status ?? "active", o.exit ?? null, o.deletedAt ?? null, o.createdAt ?? null]);
const movimento = (code: string, o: { lote: string; data: string; destino: string; tipo?: string; status?: string; deletedAt?: string | null }) => id1(
  `insert into erp.animal_movements (organization_id, empresa_id, code, movement_type, movement_date, batch_id, destination_area_id, status, deleted_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz) returning id`,
  [demo.orgId, E1, code, o.tipo ?? "module_area_transfer", o.data, o.lote, o.destino, o.status ?? "confirmed", o.deletedAt ?? null]);
/** Manejo e pesagem SEM a coluna area_id (que só existe depois da 0061): o acervo anterior. */
const manejoAntigo = (code: string, empresa: string, lote_: string | null, data: string, deletedAt: string | null = null) => id1(
  `insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id, deleted_at)
   values ($1,$2,$3,'sanitary',$4,$5,$6::timestamptz) returning id`, [demo.orgId, empresa, code, data, lote_, deletedAt]);
const pesagemAntiga = (code: string, empresa: string, lote_: string | null, data: string, deletedAt: string | null = null) => id1(
  `insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id, deleted_at)
   values ($1,$2,$3,$4,$5,$6::timestamptz) returning id`, [demo.orgId, empresa, code, data, lote_, deletedAt]);
/** Manejo/pesagem DEPOIS da 0061: o gatilho BEFORE INSERT decide a área (a não ser que ela venha explícita). */
async function manejo(code: string, empresa: string, lote_: string | null, data: string, areaExplicita: string | null = null) {
  return (await db.query<{ area_id: string | null }>(
    `insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id, area_id)
     values ($1,$2,$3,'sanitary',$4,$5,$6) returning area_id`, [demo.orgId, empresa, code, data, lote_, areaExplicita])).rows[0]!.area_id;
}
async function pesagem(code: string, empresa: string, lote_: string | null, data: string) {
  return (await db.query<{ area_id: string | null }>(
    `insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id) values ($1,$2,$3,$4,$5) returning area_id`,
    [demo.orgId, empresa, code, data, lote_])).rows[0]!.area_id;
}
interface Ocupacao { area_id: string; empresa_id: string; data_inicio: string; data_fim: string | null; origem_da_data: string; motivo_saida: string | null; movimento_entrada_id: string | null; cabecas_na_entrada: number | null; ua_na_entrada: string | null }
async function ocupacoesDo(loteId: string): Promise<Ocupacao[]> {
  return (await db.query<Ocupacao>(
    `select area_id, empresa_id, data_inicio, data_fim, origem_da_data, motivo_saida, movimento_entrada_id, cabecas_na_entrada, ua_na_entrada
       from erp.ocupacoes_de_area where batch_id=$1 order by data_inicio, created_at, id`, [loteId])).rows;
}
const hoje = async () => (await db.query<{ d: string }>("select current_date::text d")).rows[0]!.d;
const valida = async (g: unknown, forma: string | null) =>
  (await db.query<{ v: boolean }>("select erp.objeto_de_mapa_geometria_valida($1::jsonb, $2) v", [g === null ? null : JSON.stringify(g), forma])).rows[0]!.v;
const objeto = (q: Queryable, o: { empresa: string; area: string | null; tipo: string; forma?: string; geometria: unknown; name?: string; trough?: string | null }) =>
  q.query<{ id: string }>(
    `insert into erp.objetos_de_mapa (organization_id, empresa_id, area_id, tipo, forma, geometria, name, trough_id)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) returning id`,
    [demo.orgId, o.empresa, o.area, o.tipo, o.forma ?? "ponto", JSON.stringify(o.geometria), o.name ?? `[TEST] ${o.tipo}`, o.trough ?? null]);

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of ANTERIORES) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(URL_APP, { max: 3 });
  [E1, E2] = demo.empresaIds as [string, string];

  // ---- ACERVO anterior à 0061 (o que o backfill tem de ler) ----
  A1 = await area(E1, "MM-A1"); A2 = await area(E1, "MM-A2"); A3 = await area(E1, "MM-A3"); A4 = await area(E1, "MM-A4");
  B1 = await area(E2, "MM-B1");
  L1 = await lote("MM-L1", { area: A1, entry: "2026-01-10" });                                  // ativo, com movimento
  L2 = await lote("MM-L2", { area: A2, entry: "2026-02-20" });                                  // ativo, sem movimento, com entrada
  L3 = await lote("MM-L3", { area: A3, createdAt: "2025-12-01T12:00:00Z" });                    // ativo, sem movimento e sem entrada
  L4 = await lote("MM-L4", { entry: "2026-01-01" });                                            // sem área
  L5 = await lote("MM-L5", { area: A1, entry: "2026-01-01", status: "closed", exit: "2026-06-01" }); // fechado
  L6 = await lote("MM-L6", { area: A1, entry: "2026-01-01", deletedAt: "2026-06-01T00:00:00Z" });    // excluído
  L7 = await lote("MM-L7", { empresa: E2, area: B1, entry: "2026-01-05" });                     // ativo na empresa 2
  L9 = await lote("MM-L15", { area: A4, entry: "2026-01-01", exit: "2026-08-01" });              // status 'active' COM saída: não é ativo
  mAntigo = await movimento("MM-M1", { lote: L1, data: "2026-02-01", destino: A1 });
  mRecente = await movimento("MM-M2", { lote: L1, data: "2026-03-15", destino: A1 });
  await movimento("MM-M3", { lote: L1, data: "2026-04-01", destino: A1, status: "cancelled" });                 // cancelado: não conta
  await movimento("MM-M4", { lote: L1, data: "2026-04-05", destino: A1, deletedAt: "2026-04-06T00:00:00Z" });  // excluído: não conta
  await movimento("MM-M5", { lote: L1, data: "2026-04-10", destino: A2 });                                      // outra área: não conta
  await movimento("MM-M6", { lote: L2, data: "2026-05-01", destino: A2, tipo: "purchase" });                   // outro tipo: não conta
  H = {
    antesDoInicio: await manejoAntigo("MM-H1", E1, L1, "2026-03-01"),
    diaDoInicio: await manejoAntigo("MM-H2", E1, L1, "2026-03-15"),
    depois: await manejoAntigo("MM-H3", E1, L1, "2026-05-01"),
    excluido: await manejoAntigo("MM-H4", E1, L1, "2026-05-02", "2026-05-03T00:00:00Z"),
    semLote: await manejoAntigo("MM-H5", E1, null, "2026-05-01"),
    loteSemOcupacao: await manejoAntigo("MM-H6", E1, L4, "2026-05-01"),
    ocupacaoDeOutraEmpresa: await manejoAntigo("MM-H7", E1, L7, "2026-05-01"),
    mesmaEmpresaDaOcupacao: await manejoAntigo("MM-H8", E2, L7, "2026-05-01"),
    loteFechado: await manejoAntigo("MM-H9", E1, L5, "2026-05-01")
  };
  W = {
    antesDoInicio: await pesagemAntiga("MM-W1", E1, L1, "2026-03-01"),
    depois: await pesagemAntiga("MM-W2", E1, L1, "2026-04-01"),
    loteSemOcupacao: await pesagemAntiga("MM-W3", E1, L4, "2026-04-01"),
    ocupacaoDeOutraEmpresa: await pesagemAntiga("MM-W4", E1, L7, "2026-04-01"),
    mesmaEmpresaDaOcupacao: await pesagemAntiga("MM-W5", E2, L7, "2026-04-01"),
    excluida: await pesagemAntiga("MM-W6", E1, L1, "2026-04-02", "2026-04-03T00:00:00Z")
  };
  cocho = await id1("insert into erp.troughs (organization_id, code, type, description, area_id) values ($1,'MM-T1','covered','[TEST] cocho A1',$2) returning id", [demo.orgId, A1]);

  // Quem só vê a empresa 1 no módulo pecuaria; e uma OUTRA organização com dono próprio.
  usuarioSoE1 = await id1("insert into erp.users (email, name, password_hash) values ('mm-so-e1@demo.local','MM Só E1','x') returning id");
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioSoE1]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, membro, E1]);
  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra MM','outra-mm') returning id");
  donoOutraOrg = await id1("insert into erp.users (email, name, password_hash) values ('mm-dono-outra@demo.local','MM Dono outra','x') returning id");
  await db.query("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,true,true)", [outraOrg, donoOutraOrg]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("MM-0 — a premissa: o banco até a 0060 e o acervo anterior à 0061", () => {
  it("MM-0 PREMISSA: ledger com 60 (a 0060 por último), nada da 0061 existe, erp_app ainda apaga erp.areas, acervo contado", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0060_satelite_reserva_area_viva.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 60, ultima: "0060_satelite_reserva_area_viva.sql" });
    expect(await nadaDa0061()).toEqual(NADA);
    expect((await db.query<{ v: string | null }>("select to_regprocedure('erp.objeto_de_mapa_geometria_valida(jsonb,text)')::text v")).rows[0]!.v).toBeNull();
    // 5.3 tem efeito a provar: ANTES dela o erp_app apaga área (herança da 0007).
    expect((await db.query<{ d: boolean }>("select has_table_privilege('erp_app','erp.areas','DELETE') d")).rows[0]!.d).toBe(true);
    // 5.1: num banco migrado do zero a unique de código existe — é o caminho "só confere".
    expect((await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname='areas_empresa_id_code_key'")).rows[0]!.d)
      .toBe("UNIQUE (empresa_id, code)");
    const n = (await db.query<{ lotes: number; areas: number; mov: number; man: number; pes: number; man_vivos: number; pes_vivas: number }>(
      `select (select count(*)::int from erp.batches where code like 'MM-L%') lotes, (select count(*)::int from erp.areas where code like 'MM-%') areas,
              (select count(*)::int from erp.animal_movements where code like 'MM-M%') mov,
              (select count(*)::int from erp.animal_handlings) man, (select count(*)::int from erp.weighings) pes,
              (select count(*)::int from erp.animal_handlings where deleted_at is null) man_vivos, (select count(*)::int from erp.weighings where deleted_at is null) pes_vivas`)).rows[0]!;
    expect(n).toEqual({ lotes: 8, areas: 5, mov: 6, man: 9, pes: 6, man_vivos: 8, pes_vivas: 5 });
    retratoInicial = await retrato();
    // Verde que não prova nada é reprovação: cada tabela do retrato tem linha.
    for (const t of TABELAS_RETRATO) expect([t, retratoInicial[t]!.n > 0]).toEqual([t, true]);
  });
});

describe("MM-6 — a 0061 recusa SEM efeito (antes de aplicar)", () => {
  it("MM-6b TRAVA: com (2026,95) ocupada por outra sessão, a 0061 recusa com a mensagem da trava e nada é criado", async () => {
    const outra = await db.connect();
    const c = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 95)");
      expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
      await outra.query("rollback");
    } finally { outra.release(); c.release(); }
    expect(await nadaDa0061()).toEqual(NADA);
  });

  it("MM-6a REVERSAS: cada pré-condição quebrada (uma por vez) recusa a 0061 com a SUA mensagem, sem efeito", async () => {
    const PRE: [string, string, string][] = [
      ["já aplicada (ocupacoes_de_area existe)", "create table erp.ocupacoes_de_area (x int)", JA],
      ["já aplicada (objetos_de_mapa existe)", "create table erp.objetos_de_mapa (x int)", JA],
      ["já aplicada (validador existe)", "create function erp.objeto_de_mapa_geometria_valida(jsonb, text) returns boolean language sql as 'select true'", JA],
      ["area_id já existe em weighings", "alter table erp.weighings add column area_id uuid",
        "MAPA-MANEJO-01: a 0061 ja foi aplicada ou ha schema divergente (area_id ja existe em animal_handlings/weighings)."],
      ["tabela de pecuária ausente (troughs)", "alter table erp.troughs rename to troughs_sabotada",
        "MAPA-MANEJO-01: tabelas de pecuaria ausentes (areas/batches/animal_movements/animal_handlings/weighings/troughs); cadeia fora de ordem."],
      ["areas_org_empresa_key ausente", "alter table erp.areas rename constraint areas_org_empresa_key to areas_org_empresa_key_sabotada",
        "MAPA-MANEJO-01: areas_org_empresa_key (organization_id, empresa_id, id) ausente em erp.areas; aplique a 0052 antes."],
      ["uq_batches_tenant ausente", "alter table erp.batches rename constraint uq_batches_tenant to uq_batches_tenant_sabotada",
        "MAPA-MANEJO-01: erp.batches sem a unique composta (id, organization_id) uq_batches_tenant; a FK composta do lote nao tem alvo."],
      ["usable_area_ha anulável", "alter table erp.areas alter column usable_area_ha drop not null",
        "MAPA-MANEJO-01: erp.areas.usable_area_ha ausente ou anulavel; aplique a 0050 antes."],
      ["coluna exit_date de batches ausente", "alter table erp.batches rename column exit_date to exit_date_sabotada",
        "MAPA-MANEJO-01: erp.batches sem as colunas area_id/status/exit_date/entry_date/deleted_at/empresa_id."],
      ["module_area_transfer ausente do CHECK", "alter table erp.animal_movements drop constraint animal_movements_movement_type_check; alter table erp.animal_movements add constraint animal_movements_movement_type_check check (movement_type in ('purchase','sale')) not valid",
        "MAPA-MANEJO-01: animal_movements sem o tipo module_area_transfer; o backfill nao tem como achar a data do movimento."],
      ["função de RLS ausente (empresas_do_membro)", "alter function erp.empresas_do_membro(text) rename to empresas_do_membro_sabotada",
        "MAPA-MANEJO-01: funcoes de RLS/auditoria/updated_at ausentes; cadeia fora de ordem."],
      ["política tenant_e_empresa de areas ausente", "alter policy tenant_e_empresa on erp.areas rename to tenant_e_empresa_sabotada",
        "MAPA-MANEJO-01: politica tenant_e_empresa de erp.areas ausente (molde das tabelas novas)."],
      ["módulo pecuaria ausente", "set local session_replication_role = replica; delete from erp.modulos_escopo_empresa where chave = 'pecuaria'; set local session_replication_role = origin",
        "MAPA-MANEJO-01: modulo de escopo pecuaria ausente."],
      ["papel erp_app ausente", "alter role erp_app rename to erp_app_sabotado", "MAPA-MANEJO-01: papel erp_app ausente (0007)."],
      // Papel real SEM superusuário e SEM BYPASSRLS (o papel da aplicação): a última pré-condição recusa.
      ["papel sem bypass (erp_app_test)", "set local role erp_app_test",
        "MAPA-MANEJO-01: o papel que aplica a migration (erp_app_test) precisa ser superusuario ou ter BYPASSRLS."]
    ];
    const c = await db.connect();
    const obtido: [string, string, unknown][] = [];
    try {
      for (const [nome, sabotagem] of PRE) {
        await c.query("begin");
        try {
          await c.query(sabotagem);
          await c.query("savepoint antes_da_0061");
          const e = await erroDe(c.query(SQL_ALVO));
          await c.query("rollback to savepoint antes_da_0061");
          const efeito = await nadaDa0061(c);
          obtido.push([nome, e.message, { funcao: efeito.funcao, gatilho: efeito.gatilho, indice: efeito.indice }]);
        } finally { await c.query("rollback"); }
      }
    } finally { c.release(); }
    expect(obtido).toEqual(PRE.map(([nome, , msg]) => [nome, msg, { funcao: null, gatilho: 0, indice: null }]));
    expect(obtido).toHaveLength(15);
    // As sabotagens foram desfeitas: o banco está como antes (nem a 0061, nem a sabotagem).
    expect(await nadaDa0061()).toEqual(NADA);
    expect(await retrato()).toEqual(retratoInicial);
  });
});

describe("MM-5c — 5.1 num banco SEM a unique (empresa_id, code) de erp.areas (transações desfeitas)", () => {
  it("MM-5c sem duplicata: cria uq_areas_empresa_codigo; com duplicata: NÃO cria, avisa os códigos (WARNING) e a migration conclui", async () => {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("alter table erp.areas drop constraint areas_empresa_id_code_key");
      const avisos = await aplicarCapturando(c);
      expect(avisos).toEqual([{ severity: "NOTICE", message: BACKFILL }, { severity: "NOTICE", message: UNIQUE_CRIADO }]);
      expect((await c.query<{ d: string }>("select indexdef d from pg_indexes where schemaname='erp' and indexname='uq_areas_empresa_codigo'")).rows[0]!.d)
        .toBe("CREATE UNIQUE INDEX uq_areas_empresa_codigo ON erp.areas USING btree (empresa_id, code)");
      await c.query("rollback");

      await c.query("begin");
      await c.query("alter table erp.areas drop constraint areas_empresa_id_code_key");
      await c.query(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
                     values ($1,$2,'MM-A1','[TEST] duplicada',10,10,'pastagem','ativa','propria')`, [demo.orgId, E1]);
      const avisos2 = await aplicarCapturando(c);
      expect(avisos2).toEqual([
        { severity: "NOTICE", message: BACKFILL },
        { severity: "WARNING", message: `MAPA-MANEJO-01 (5.1): erp.areas SEM unique (empresa_id, code) e COM duplicatas; o indice NAO foi criado. Duplicados: empresa ${E1} codigo MM-A1 (2 linhas)` }
      ]);
      const depois = (await c.query<{ indice: string | null; ocupacoes: string | null; gatilho: number }>(
        `select to_regclass('erp.uq_areas_empresa_codigo')::text indice, to_regclass('erp.ocupacoes_de_area')::text ocupacoes,
                (select count(*)::int from pg_trigger where tgname='trg_batches_fechar_ocupacao') gatilho`)).rows[0]!;
      expect(depois, "o índice não nasce, e a migration chegou ao fim (tabelas e gatilho criados)").toEqual({ indice: null, ocupacoes: "erp.ocupacoes_de_area", gatilho: 1 });
      await c.query("rollback");
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(await nadaDa0061()).toEqual(NADA);
    expect((await db.query("select 1 from pg_constraint where conname='areas_empresa_id_code_key'")).rowCount).toBe(1);
  });
});

describe("MM-4 — aplica como o runner; o backfill", () => {
  it("MM-4c APLICA: retrato antes/depois — nenhuma linha existente muda (manejo/pesagem só na area_id: 3 de 9 manejos e 2 de 6 pesagens com área); NOTICE com as contagens", async () => {
    expect(await retrato(), "as tentativas recusadas e desfeitas não deixaram rastro").toEqual(retratoInicial);
    const c = await db.connect();
    let avisos: Aviso[] = [];
    try {
      await c.query("begin");
      avisos = await aplicarCapturando(c);
      await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
      await c.query("commit");
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
    expect(avisos).toEqual([{ severity: "NOTICE", message: BACKFILL }, { severity: "NOTICE", message: UNIQUE_JA_EXISTE }]);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 61, ultima: ALVO });

    expect(await retrato(), "nenhuma linha de tabela existente mudou (manejo e pesagem comparados sem a coluna nova)").toEqual(retratoInicial);
    // E a coluna nova é a ÚNICA diferença: com ela, o hash do manejo/pesagem muda (há área preenchida).
    const contagem = (await db.query<{ man_com: number; man_sem: number; pes_com: number; pes_sem: number }>(
      `select (select count(*)::int from erp.animal_handlings where area_id is not null) man_com, (select count(*)::int from erp.animal_handlings where area_id is null) man_sem,
              (select count(*)::int from erp.weighings where area_id is not null) pes_com, (select count(*)::int from erp.weighings where area_id is null) pes_sem`)).rows[0]!;
    expect(contagem).toEqual({ man_com: 3, man_sem: 6, pes_com: 2, pes_sem: 4 });
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.audit_logs where entity in ('ocupacoes_de_area','objetos_de_mapa')")).rows[0]!.n,
      "o backfill não gera auditoria").toBe(0);
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 95) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("MM-6a JÁ APLICADA: reaplicar a 0061 sobre ela mesma é recusado com a mensagem de 'já aplicada'", async () => {
    expect((await erroDe(db.query(SQL_ALVO))).message).toBe(JA);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.ocupacoes_de_area")).rows[0]!.n, "nada duplicado").toBe(4);
  });

  it("MM-4a BACKFILL: as três origens na ordem — movimento mais recente não cancelado/excluído para a área atual; entry_date; created_at::date; cabeças e UA nulas", async () => {
    const criacaoL3 = (await db.query<{ d: string }>("select created_at::date::text d from erp.batches where id=$1", [L3])).rows[0]!.d;
    expect(criacaoL3).toBe("2025-12-01");
    const base = { data_fim: null, motivo_saida: null, cabecas_na_entrada: null, ua_na_entrada: null };
    expect(await ocupacoesDo(L1)).toEqual([{ ...base, area_id: A1, empresa_id: E1, data_inicio: "2026-03-15", origem_da_data: "movimento", movimento_entrada_id: mRecente }]);
    expect(mRecente).not.toBe(mAntigo);
    expect(await ocupacoesDo(L2)).toEqual([{ ...base, area_id: A2, empresa_id: E1, data_inicio: "2026-02-20", origem_da_data: "entrada_do_lote", movimento_entrada_id: null }]);
    expect(await ocupacoesDo(L3)).toEqual([{ ...base, area_id: A3, empresa_id: E1, data_inicio: "2025-12-01", origem_da_data: "criacao_do_lote", movimento_entrada_id: null }]);
    expect(await ocupacoesDo(L7)).toEqual([{ ...base, area_id: B1, empresa_id: E2, data_inicio: "2026-01-05", origem_da_data: "entrada_do_lote", movimento_entrada_id: null }]);
    expect((await db.query<{ origem: string; n: number }>("select origem_da_data origem, count(*)::int n from erp.ocupacoes_de_area group by 1 order by 1")).rows)
      .toEqual([{ origem: "criacao_do_lote", n: 1 }, { origem: "entrada_do_lote", n: 2 }, { origem: "movimento", n: 1 }]);
  });

  it("MM-4b BACKFILL: lote sem área (L4), fechado (L5), excluído (L6) e 'active' com exit_date (L9) NÃO geram ocupação; só os 4 elegíveis geram", async () => {
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.ocupacoes_de_area where batch_id = any($1)", [[L4, L5, L6, L9]])).rows[0]!.n).toBe(0);
    expect((await db.query<{ lote: string }>(
      "select b.code lote from erp.ocupacoes_de_area o join erp.batches b on b.id=o.batch_id order by b.code")).rows.map((r) => r.lote))
      .toEqual(["MM-L1", "MM-L2", "MM-L3", "MM-L7"]);
    // Os lotes do seed (sem área) também não.
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.batches where code like 'L000%' and area_id is null")).rows[0]!.n).toBe(2);
  });
});

describe("MM-1 — o schema", () => {
  it("MM-1a tabelas, colunas novas (tipos), CHECKs nomeados, FKs compostas, índices, gatilhos, RLS habilitada+forçada e política igual à de erp.areas", async () => {
    const colunas = async (t: string) => (await db.query<{ c: string }>(
      `select column_name || ':' || data_type || case when data_type='numeric' then '(' || numeric_precision || ',' || numeric_scale || ')' else '' end || ':' || is_nullable c
         from information_schema.columns where table_schema='erp' and table_name=$1 order by ordinal_position`, [t])).rows.map((r) => r.c);
    const tz = "timestamp with time zone";
    expect(await colunas("ocupacoes_de_area")).toEqual([
      "id:uuid:NO", "organization_id:uuid:NO", "empresa_id:uuid:NO", "area_id:uuid:NO", "batch_id:uuid:NO", "data_inicio:date:NO", "data_fim:date:YES",
      "cabecas_na_entrada:integer:YES", "ua_na_entrada:numeric(10,2):YES", "origem_da_data:text:NO", "motivo_saida:text:YES",
      "movimento_entrada_id:uuid:YES", "movimento_saida_id:uuid:YES", "note:text:YES", `created_at:${tz}:NO`, `updated_at:${tz}:NO`, `deleted_at:${tz}:YES`]);
    expect(await colunas("objetos_de_mapa")).toEqual([
      "id:uuid:NO", "organization_id:uuid:NO", "empresa_id:uuid:NO", "area_id:uuid:YES", "tipo:text:NO", "forma:text:NO", "geometria:jsonb:NO",
      "code:text:YES", "name:text:NO", "descricao:text:YES", "capacidade:numeric(12,3):YES", "unidade_capacidade:text:YES", "trough_id:uuid:YES",
      "is_active:boolean:NO", `created_at:${tz}:NO`, `updated_at:${tz}:NO`, `deleted_at:${tz}:YES`]);
    expect((await db.query<{ c: string }>(
      `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable c from information_schema.columns
        where table_schema='erp' and column_name='area_id' and table_name in ('animal_handlings','weighings') order by 1`)).rows.map((r) => r.c))
      .toEqual(["animal_handlings.area_id:uuid:YES", "weighings.area_id:uuid:YES"]);

    const restricoes = async (t: string) => Object.fromEntries((await db.query<{ n: string; d: string }>(
      "select conname n, pg_get_constraintdef(oid) d from pg_constraint where conrelid=$1::regclass and contype in ('c','f') order by conname", [t])).rows.map((r) => [r.n, r.d]));
    const AREA = "FOREIGN KEY (organization_id, empresa_id, area_id) REFERENCES erp.areas(organization_id, empresa_id, id)";
    expect(await restricoes("erp.ocupacoes_de_area")).toEqual({
      chk_ocupacoes_cabecas: "CHECK (((cabecas_na_entrada IS NULL) OR (cabecas_na_entrada >= 0)))",
      chk_ocupacoes_motivo_saida: "CHECK (((motivo_saida IS NULL) OR (motivo_saida = ANY (ARRAY['transferencia'::text, 'encerramento_do_lote'::text, 'correcao'::text]))))",
      chk_ocupacoes_origem_da_data: "CHECK ((origem_da_data = ANY (ARRAY['movimento'::text, 'entrada_do_lote'::text, 'criacao_do_lote'::text, 'informada'::text])))",
      chk_ocupacoes_periodo: "CHECK (((data_fim IS NULL) OR (data_fim >= data_inicio)))",
      chk_ocupacoes_ua: "CHECK (((ua_na_entrada IS NULL) OR (ua_na_entrada >= (0)::numeric)))",
      fk_ocupacoes_area: AREA,
      fk_ocupacoes_empresa: "FOREIGN KEY (organization_id, empresa_id) REFERENCES erp.empresas(organization_id, id)",
      fk_ocupacoes_lote: "FOREIGN KEY (batch_id, organization_id) REFERENCES erp.batches(id, organization_id)",
      fk_ocupacoes_movimento_entrada: "FOREIGN KEY (movimento_entrada_id) REFERENCES erp.animal_movements(id)",
      fk_ocupacoes_movimento_saida: "FOREIGN KEY (movimento_saida_id) REFERENCES erp.animal_movements(id)",
      ocupacoes_de_area_organization_id_fkey: "FOREIGN KEY (organization_id) REFERENCES erp.organizations(id)"
    });
    expect(await restricoes("erp.objetos_de_mapa")).toEqual({
      chk_objetos_capacidade: "CHECK (((capacidade IS NULL) OR (capacidade >= (0)::numeric)))",
      chk_objetos_cocho_so_para_cocho: "CHECK (((trough_id IS NULL) OR (tipo = 'cocho'::text)))",
      chk_objetos_forma: "CHECK ((forma = ANY (ARRAY['ponto'::text, 'linha'::text])))",
      chk_objetos_forma_bate_com_tipo: "CHECK (((tipo = ANY ('{}'::text[])) = (forma = 'linha'::text)))",
      chk_objetos_nome: "CHECK ((btrim(name) <> ''::text))",
      chk_objetos_tipo: "CHECK ((tipo = ANY (ARRAY['cocho'::text, 'deposito_a_pasto'::text])))",
      chk_objetos_unidade: "CHECK (((unidade_capacidade IS NULL) OR (unidade_capacidade = ANY (ARRAY['m'::text, 't'::text, 'kg'::text, 'sc'::text]))))",
      fk_objetos_area: AREA,
      fk_objetos_empresa: "FOREIGN KEY (organization_id, empresa_id) REFERENCES erp.empresas(organization_id, id)",
      objetos_de_mapa_organization_id_fkey: "FOREIGN KEY (organization_id) REFERENCES erp.organizations(id)",
      objetos_de_mapa_trough_id_fkey: "FOREIGN KEY (trough_id) REFERENCES erp.troughs(id)"
    });
    expect((await db.query<{ n: string; d: string }>(
      "select conname n, pg_get_constraintdef(oid) d from pg_constraint where conname in ('fk_animal_handlings_area','fk_weighings_area') order by 1")).rows)
      .toEqual([{ n: "fk_animal_handlings_area", d: AREA }, { n: "fk_weighings_area", d: AREA }]);

    expect((await db.query<{ i: string; d: string }>(
      `select indexname i, indexdef d from pg_indexes where schemaname='erp' and indexname in ('uq_ocupacao_aberta_por_lote','ix_ocupacoes_area_inicio',
         'ix_ocupacoes_lote_inicio','uq_objetos_de_mapa_codigo','ix_objetos_de_mapa_area','ix_animal_handlings_area_data','ix_weighings_area_data') order by 1`)).rows)
      .toEqual([
        { i: "ix_animal_handlings_area_data", d: "CREATE INDEX ix_animal_handlings_area_data ON erp.animal_handlings USING btree (organization_id, empresa_id, area_id, handling_date DESC) WHERE (area_id IS NOT NULL)" },
        { i: "ix_objetos_de_mapa_area", d: "CREATE INDEX ix_objetos_de_mapa_area ON erp.objetos_de_mapa USING btree (organization_id, empresa_id, area_id)" },
        { i: "ix_ocupacoes_area_inicio", d: "CREATE INDEX ix_ocupacoes_area_inicio ON erp.ocupacoes_de_area USING btree (organization_id, empresa_id, area_id, data_inicio DESC)" },
        { i: "ix_ocupacoes_lote_inicio", d: "CREATE INDEX ix_ocupacoes_lote_inicio ON erp.ocupacoes_de_area USING btree (organization_id, empresa_id, batch_id, data_inicio DESC)" },
        { i: "ix_weighings_area_data", d: "CREATE INDEX ix_weighings_area_data ON erp.weighings USING btree (organization_id, empresa_id, area_id, weighing_date DESC) WHERE (area_id IS NOT NULL)" },
        { i: "uq_objetos_de_mapa_codigo", d: "CREATE UNIQUE INDEX uq_objetos_de_mapa_codigo ON erp.objetos_de_mapa USING btree (organization_id, empresa_id, tipo, code) WHERE ((code IS NOT NULL) AND (deleted_at IS NULL))" },
        { i: "uq_ocupacao_aberta_por_lote", d: "CREATE UNIQUE INDEX uq_ocupacao_aberta_por_lote ON erp.ocupacoes_de_area USING btree (organization_id, batch_id) WHERE ((data_fim IS NULL) AND (deleted_at IS NULL))" }
      ]);

    expect((await db.query<{ t: string; d: string }>(
      `select tgname t, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal and tgname in ('trg_batches_fechar_ocupacao','trg_animal_handlings_area_da_ocupacao',
         'trg_weighings_area_da_ocupacao','trg_objetos_de_mapa_geometria_conferir','trg_objetos_de_mapa_cocho_conferir','trg_ocupacoes_de_area_conferir') order by 1`)).rows)
      .toEqual([
        { t: "trg_animal_handlings_area_da_ocupacao", d: "CREATE TRIGGER trg_animal_handlings_area_da_ocupacao BEFORE INSERT ON erp.animal_handlings FOR EACH ROW EXECUTE FUNCTION erp.area_da_ocupacao_na_data('handling_date')" },
        { t: "trg_batches_fechar_ocupacao", d: "CREATE TRIGGER trg_batches_fechar_ocupacao AFTER INSERT OR UPDATE OF area_id, status, exit_date, deleted_at ON erp.batches FOR EACH ROW EXECUTE FUNCTION erp.batches_fechar_ocupacao()" },
        { t: "trg_objetos_de_mapa_cocho_conferir", d: "CREATE TRIGGER trg_objetos_de_mapa_cocho_conferir BEFORE INSERT OR UPDATE ON erp.objetos_de_mapa FOR EACH ROW EXECUTE FUNCTION erp.objetos_de_mapa_cocho_conferir()" },
        { t: "trg_objetos_de_mapa_geometria_conferir", d: "CREATE TRIGGER trg_objetos_de_mapa_geometria_conferir BEFORE INSERT OR UPDATE ON erp.objetos_de_mapa FOR EACH ROW EXECUTE FUNCTION erp.objetos_de_mapa_geometria_conferir()" },
        { t: "trg_ocupacoes_de_area_conferir", d: "CREATE TRIGGER trg_ocupacoes_de_area_conferir BEFORE INSERT OR UPDATE ON erp.ocupacoes_de_area FOR EACH ROW EXECUTE FUNCTION erp.ocupacoes_de_area_conferir()" },
        { t: "trg_weighings_area_da_ocupacao", d: "CREATE TRIGGER trg_weighings_area_da_ocupacao BEFORE INSERT ON erp.weighings FOR EACH ROW EXECUTE FUNCTION erp.area_da_ocupacao_na_data('weighing_date')" }
      ]);

    expect((await db.query<{ t: string; rls: boolean; forcada: boolean }>(
      `select c.relname t, c.relrowsecurity rls, c.relforcerowsecurity forcada from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname in ('ocupacoes_de_area','objetos_de_mapa') order by 1`)).rows)
      .toEqual([{ t: "objetos_de_mapa", rls: true, forcada: true }, { t: "ocupacoes_de_area", rls: true, forcada: true }]);
    const politicas = (await db.query<{ t: string; p: string; cmd: string; permissive: string; igual: boolean }>(
      `select p.tablename t, p.policyname p, p.cmd, p.permissive,
              (p.qual = a.qual and p.with_check = a.with_check and p.roles = a.roles) igual
         from pg_policies p cross join (select qual, with_check, roles from pg_policies where schemaname='erp' and tablename='areas' and policyname='tenant_e_empresa') a
        where p.schemaname='erp' and p.tablename in ('ocupacoes_de_area','objetos_de_mapa') order by 1, 2`)).rows;
    expect(politicas).toEqual([
      { t: "objetos_de_mapa", p: "tenant_e_empresa", cmd: "ALL", permissive: "PERMISSIVE", igual: true },
      { t: "ocupacoes_de_area", p: "tenant_e_empresa", cmd: "ALL", permissive: "PERMISSIVE", igual: true }
    ]);
    // As seis funções novas: SECURITY DEFINER com search_path fixo.
    expect((await db.query<{ f: string; def: boolean; cfg: string[] }>(
      "select p.oid::regprocedure::text f, p.prosecdef def, p.proconfig cfg from pg_proc p where p.oid = any($1::regprocedure[]) order by p.oid::regprocedure::text collate \"C\"", [FUNCOES])).rows)
      .toEqual([...FUNCOES].sort().map((f) => ({ f, def: true, cfg: ["search_path=erp, pg_temp"] })));
  });

  it("MM-1b uq_ocupacao_aberta_por_lote: segunda ocupação ABERTA no mesmo lote é recusada (23505, nome do índice); fechada no mesmo lote é aceita", async () => {
    await desfeita(db, null, async (c) => {
      const e = await erroNoPonto(c, `insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, origem_da_data)
                                      values ($1,$2,$3,$4,'2026-06-01','informada')`, [demo.orgId, E1, A3, L2]);
      expect({ code: e.code, constraint: e.constraint }).toEqual({ code: "23505", constraint: "uq_ocupacao_aberta_por_lote" });
      const fechada = await c.query(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data)
                                     values ($1,$2,$3,$4,'2025-01-01','2025-01-31','informada')`, [demo.orgId, E1, A3, L2]);
      expect(fechada.rowCount).toBe(1);
      expect((await c.query<{ n: number }>("select count(*)::int n from erp.ocupacoes_de_area where batch_id=$1 and data_fim is null", [L2])).rows[0]!.n).toBe(1);
    });
  });

  it("MM-1c vários lotes na MESMA área ao mesmo tempo são ACEITOS (2 abertas em A1, lotes distintos)", async () => {
    await desfeita(db, null, async (c) => {
      await c.query(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, area_id, entry_date)
                     values ($1,$2,'MM-L9','2026-01-01','[TEST] segundo lote em A1',$3,'2026-04-01')`, [demo.orgId, E1, A1]);
      const abertas = (await c.query<{ n: number; lotes: number }>(
        "select count(*)::int n, count(distinct batch_id)::int lotes from erp.ocupacoes_de_area where area_id=$1 and data_fim is null and deleted_at is null", [A1])).rows[0]!;
      expect(abertas).toEqual({ n: 2, lotes: 2 });
    });
  });

  it("MM-1d chk_ocupacoes_periodo: data_fim antes de data_inicio é recusada (23514, nome)", async () => {
    await desfeita(db, null, async (c) => {
      const e = await erroNoPonto(c, `insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data)
                                      values ($1,$2,$3,$4,'2026-05-10','2026-05-09','informada')`, [demo.orgId, E1, A1, L4]);
      expect({ code: e.code, constraint: e.constraint }).toEqual({ code: "23514", constraint: "chk_ocupacoes_periodo" });
      // O mesmo dia nos dois lados é válido (período inclusivo).
      expect((await c.query(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data)
                             values ($1,$2,$3,$4,'2026-05-10','2026-05-10','informada')`, [demo.orgId, E1, A1, L4])).rowCount).toBe(1);
    });
  });
});

describe("MM-2 — o validador de geometria do objeto (ponto/linha)", () => {
  it("MM-2a Point válido: true pela função (superusuário) e aceito no INSERT de objetos_de_mapa (empresa 1 e 2); erp_app não executa a função", async () => {
    expect(await valida(PONTO, "ponto")).toBe(true);
    expect(await valida({ type: "Point", coordinates: [180, 90] }, "ponto"), "borda superior").toBe(true);
    expect(await valida({ type: "Point", coordinates: [-180, -90] }, "ponto"), "borda inferior").toBe(true);
    const o1 = await objeto(db, { empresa: E1, area: A1, tipo: "cocho", geometria: PONTO });
    const o2 = await objeto(db, { empresa: E2, area: B1, tipo: "deposito_a_pasto", geometria: { type: "Point", coordinates: [-48.3, -10.2] } });
    expect([o1.rowCount, o2.rowCount]).toEqual([1, 1]);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.audit_logs where entity='objetos_de_mapa' and action='create' and entity_id = any($1)",
      [[o1.rows[0]!.id, o2.rows[0]!.id]])).rows[0]!.n, "objeto auditado").toBe(2);
    const e = await erroDe(withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query("select erp.objeto_de_mapa_geometria_valida($1::jsonb, 'ponto')", [JSON.stringify(PONTO)])));
    expect(e.code).toBe("42501");
  });

  it("MM-2b LineString com 2+ posições é aceito na forma 'linha'; com 1 (ou 0) posição é recusado", async () => {
    expect(await valida({ type: "LineString", coordinates: [[-56.1, -15.6], [-56.09, -15.59]] }, "linha")).toBe(true);
    expect(await valida({ type: "LineString", coordinates: [[-56.1, -15.6], [-56.09, -15.59], [-56.08, -15.58]] }, "linha")).toBe(true);
    expect(await valida({ type: "LineString", coordinates: [[-56.1, -15.6]] }, "linha")).toBe(false);
    expect(await valida({ type: "LineString", coordinates: [] }, "linha")).toBe(false);
  });

  it("MM-2c Polygon RECUSADO: false pela função; INSERT e UPDATE recusados com P0001 e a mensagem exata", async () => {
    expect(await valida(POLIGONO, "ponto")).toBe(false);
    expect(await valida(POLIGONO, "linha")).toBe(false);
    expect(await valida({ type: "MultiPolygon", coordinates: [POLIGONO.coordinates] }, "ponto")).toBe(false);
    const e = await erroDe(objeto(db, { empresa: E1, area: A1, tipo: "cocho", geometria: POLIGONO }));
    expect({ code: e.code, message: e.message }).toEqual({ code: "P0001", message: GEOMETRIA });
    const existente = (await db.query<{ id: string }>("select id from erp.objetos_de_mapa where empresa_id=$1 limit 1", [E1])).rows[0]!.id;
    const u = await erroDe(db.query("update erp.objetos_de_mapa set geometria=$2::jsonb where id=$1", [existente, JSON.stringify(POLIGONO)]));
    expect({ code: u.code, message: u.message }).toEqual({ code: "P0001", message: GEOMETRIA });
  });

  it("MM-2d coordenada fora de faixa, type desconhecido e array mal formado devolvem false — sem erro de cast", async () => {
    const casos: [string, unknown, string | null][] = [
      ["lon 181", { type: "Point", coordinates: [181, -15] }, "ponto"],
      ["lon -181", { type: "Point", coordinates: [-181, -15] }, "ponto"],
      ["lat -91", { type: "Point", coordinates: [-56, -91] }, "ponto"],
      ["lat 91", { type: "Point", coordinates: [-56, 91] }, "ponto"],
      ["type desconhecido", { type: "Ponto", coordinates: [-56, -15] }, "ponto"],
      ["sem type", { coordinates: [-56, -15] }, "ponto"],
      ["[[1,2]] para Point", { type: "Point", coordinates: [[1, 2]] }, "ponto"],
      ['["a",1]', { type: "Point", coordinates: ["a", 1] }, "ponto"],
      ['["1","2"] (texto)', { type: "Point", coordinates: ["1", "2"] }, "ponto"],
      ["[1]", { type: "Point", coordinates: [1] }, "ponto"],
      ["[1,2,3]", { type: "Point", coordinates: [1, 2, 3] }, "ponto"],
      ["objeto sem coordinates", { type: "Point" }, "ponto"],
      ["coordinates nulo", { type: "Point", coordinates: null }, "ponto"],
      ["coordinates texto", { type: "Point", coordinates: "-56,-15" }, "ponto"],
      ["coordinates objeto", { type: "Point", coordinates: { lon: -56, lat: -15 } }, "ponto"],
      ["geometria não objeto (array)", [-56, -15], "ponto"],
      ["geometria não objeto (texto)", "Point", "ponto"],
      ["Point na forma linha", PONTO, "linha"],
      ["LineString na forma ponto", { type: "LineString", coordinates: [[1, 2], [3, 4]] }, "ponto"],
      ["LineString com posição mal formada", { type: "LineString", coordinates: [[1, 2], ["x", 2]] }, "linha"],
      ["LineString com lat fora", { type: "LineString", coordinates: [[1, 2], [1, 95]] }, "linha"],
      ["LineString de números soltos", { type: "LineString", coordinates: [1, 2] }, "linha"],
      ["forma desconhecida", PONTO, "area"],
      ["forma nula", PONTO, null],
      ["geometria nula", null, "ponto"]
    ];
    const obtido: [string, boolean][] = [];
    for (const [nome, g, forma] of casos) obtido.push([nome, await valida(g, forma)]);
    expect(obtido).toEqual(casos.map(([nome]) => [nome, false]));
    expect(obtido).toHaveLength(25);
  });

  it("MM-2e (extra, 5.2) cocho ligado: o da área de OUTRA empresa é recusado; o da mesma empresa é aceito; trough_id só para cocho", async () => {
    await desfeita(db, null, async (c) => {
      const e = await erroNoPonto(c, `insert into erp.objetos_de_mapa (organization_id, empresa_id, tipo, forma, geometria, name, trough_id)
                                      values ($1,$2,'cocho','ponto',$3::jsonb,'[TEST] cocho errado',$4)`, [demo.orgId, E2, JSON.stringify(PONTO), cocho]);
      expect({ code: e.code, message: e.message }).toEqual({ code: "P0001", message: "VALIDATION_ERROR: Cocho indisponível para este objeto." });
      expect((await objeto(c, { empresa: E1, area: A1, tipo: "cocho", geometria: PONTO, trough: cocho })).rowCount).toBe(1);
      const d = await erroNoPonto(c, `insert into erp.objetos_de_mapa (organization_id, empresa_id, tipo, forma, geometria, name, trough_id)
                                      values ($1,$2,'deposito_a_pasto','ponto',$3::jsonb,'[TEST] deposito com cocho',$4)`, [demo.orgId, E1, JSON.stringify(PONTO), cocho]);
      expect({ code: d.code, constraint: d.constraint }).toEqual({ code: "23514", constraint: "chk_objetos_cocho_so_para_cocho" });
    });
  });
});

describe("MM-3 — o gatilho trg_batches_fechar_ocupacao", () => {
  it("MM-3a mudar area_id fecha a aberta (data_fim = hoje, 'transferencia') e abre a nova (data_inicio = hoje, 'movimento'); ambas auditadas", async () => {
    const d = await hoje();
    const antes = (await db.query<{ id: string }>("select id from erp.ocupacoes_de_area where batch_id=$1 and data_fim is null", [L2])).rows[0]!.id;
    // Pelo caminho da API: o erp_app (sem bypass) move o lote; o gatilho grava na tabela de RLS forçada como o dono.
    expect((await withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query("update erp.batches set area_id=$2 where id=$1", [L2, A4]))).rowCount).toBe(1);
    expect(await ocupacoesDo(L2)).toEqual([
      { area_id: A2, empresa_id: E1, data_inicio: "2026-02-20", data_fim: d, origem_da_data: "entrada_do_lote", motivo_saida: "transferencia", movimento_entrada_id: null, cabecas_na_entrada: null, ua_na_entrada: null },
      { area_id: A4, empresa_id: E1, data_inicio: d, data_fim: null, origem_da_data: "movimento", motivo_saida: null, movimento_entrada_id: null, cabecas_na_entrada: null, ua_na_entrada: null }
    ]);
    const nova = (await db.query<{ id: string }>("select id from erp.ocupacoes_de_area where batch_id=$1 and data_fim is null", [L2])).rows[0]!.id;
    expect((await db.query<{ id: string; action: string }>(
      "select entity_id id, action from erp.audit_logs where entity='ocupacoes_de_area' and entity_id = any($1) order by action", [[antes, nova]])).rows)
      .toEqual([{ id: nova, action: "create" }, { id: antes, action: "update" }]);
  });

  it("MM-3b status='closed' e exit_date fecham com 'encerramento_do_lote'; deleted_at fecha com 'correcao'; nenhuma nova aberta", async () => {
    const d = await hoje();
    const L8 = await lote("MM-L8", { area: A3, entry: "2026-03-01" });
    expect((await ocupacoesDo(L8)).map((o) => o.data_fim), "premissa: L8 nasce com uma aberta").toEqual([null]);
    await db.query("update erp.batches set status='closed' where id=$1", [L1]);
    await db.query("update erp.batches set exit_date='2026-09-30' where id=$1", [L3]);
    await db.query("update erp.batches set deleted_at=now() where id=$1", [L8]);
    const resumo = async (l: string) => (await ocupacoesDo(l)).map((o) => ({ data_fim: o.data_fim, motivo: o.motivo_saida }));
    expect(await resumo(L1)).toEqual([{ data_fim: d, motivo: "encerramento_do_lote" }]);
    expect(await resumo(L3)).toEqual([{ data_fim: d, motivo: "encerramento_do_lote" }]);
    expect(await resumo(L8)).toEqual([{ data_fim: d, motivo: "correcao" }]);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.ocupacoes_de_area where batch_id = any($1) and data_fim is null", [[L1, L3, L8]])).rows[0]!.n).toBe(0);
  });

  it("MM-3c mudar SÓ corral_id ou SÓ grazing_module_id (ou regravar a mesma área) NÃO abre nem fecha (linhas e auditoria iguais)", async () => {
    const curral = (await db.query<{ id: string }>("select id from erp.feedlot_corrals where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
    const modulo = (await db.query<{ id: string }>("select id from erp.grazing_modules where organization_id=$1 and empresa_id=$2 limit 1", [demo.orgId, E1])).rows[0]!.id;
    const foto = async () => (await db.query<{ n: number; h: string; total: number; audit: number }>(
      `select count(*)::int n, md5(string_agg(to_jsonb(o)::text, ',' order by o.id)) h,
              (select count(*)::int from erp.ocupacoes_de_area) total,
              (select count(*)::int from erp.audit_logs where entity='ocupacoes_de_area') audit
         from erp.ocupacoes_de_area o where o.batch_id=$1`, [L2])).rows[0]!;
    const antes = await foto();
    expect(antes.n, "premissa: L2 tem histórico (fechada + aberta)").toBe(2);
    expect((await db.query("update erp.batches set corral_id=$2 where id=$1", [L2, curral])).rowCount).toBe(1);
    expect(await foto()).toEqual(antes);
    expect((await db.query("update erp.batches set grazing_module_id=$2 where id=$1", [L2, modulo])).rowCount).toBe(1);
    expect(await foto()).toEqual(antes);
    // area_id está na lista do gatilho: regravar o MESMO valor dispara a função, e ela não mexe.
    expect((await db.query("update erp.batches set area_id=area_id, corral_id=null where id=$1", [L2])).rowCount).toBe(1);
    expect(await foto()).toEqual(antes);
  });

  it("MM-3d lote CRIADO com área e ativo abre (entry_date → 'entrada_do_lote'; sem → 'criacao_do_lote'); criado fechado não abre; REATIVADO abre 'movimento'", async () => {
    const d = await hoje();
    const comEntrada = await lote("MM-L11", { area: A1, entry: "2026-08-01" });
    const semEntrada = await lote("MM-L12", { area: A1 });
    const criadoFechado = await lote("MM-L13", { area: A1, status: "closed" });
    const linha = (o: Ocupacao) => ({ area_id: o.area_id, data_inicio: o.data_inicio, data_fim: o.data_fim, origem: o.origem_da_data });
    expect((await ocupacoesDo(comEntrada)).map(linha)).toEqual([{ area_id: A1, data_inicio: "2026-08-01", data_fim: null, origem: "entrada_do_lote" }]);
    expect((await ocupacoesDo(semEntrada)).map(linha)).toEqual([{ area_id: A1, data_inicio: d, data_fim: null, origem: "criacao_do_lote" }]);
    expect(await ocupacoesDo(criadoFechado)).toEqual([]);
    // L1 foi fechado em MM-3b: reativado, abre uma nova na área atual.
    await db.query("update erp.batches set status='active' where id=$1", [L1]);
    expect((await ocupacoesDo(L1)).map((o) => ({ ...linha(o), motivo: o.motivo_saida }))).toEqual([
      { area_id: A1, data_inicio: "2026-03-15", data_fim: d, origem: "movimento", motivo: "encerramento_do_lote" },
      { area_id: A1, data_inicio: d, data_fim: null, origem: "movimento", motivo: null }
    ]);
  });
});

describe("MM-3e — exit_date: uma definição só de lote ativo (status 'active', sem exclusão e sem saída)", () => {
  it("MM-3e saída preenchida fecha; com saída, trocar a área NÃO abre; limpar a saída reabre na área atual ('movimento'); criado com saída não abre", async () => {
    const d = await hoje();
    const linha = (o: Ocupacao) => ({ area_id: o.area_id, data_inicio: o.data_inicio, data_fim: o.data_fim, origem: o.origem_da_data, motivo: o.motivo_saida });
    // L9 ('active' com saída) não ganhou ocupação no backfill (MM-4b); com saída, mudar a área não abre nada.
    expect((await db.query("update erp.batches set area_id=$2 where id=$1", [L9, A3])).rowCount).toBe(1);
    expect(await ocupacoesDo(L9)).toEqual([]);
    // Limpar a saída é reativar: abre na área atual, com a data de hoje.
    expect((await db.query("update erp.batches set exit_date=null where id=$1", [L9])).rowCount).toBe(1);
    expect((await ocupacoesDo(L9)).map(linha)).toEqual([{ area_id: A3, data_inicio: d, data_fim: null, origem: "movimento", motivo: null }]);
    // Preencher a saída de novo fecha ('encerramento_do_lote') e não abre outra.
    expect((await db.query("update erp.batches set exit_date='2026-09-01' where id=$1", [L9])).rowCount).toBe(1);
    expect((await ocupacoesDo(L9)).map(linha)).toEqual([{ area_id: A3, data_inicio: d, data_fim: d, origem: "movimento", motivo: "encerramento_do_lote" }]);
    // Lote CRIADO ativo, com área e com saída: não abre.
    const criadoComSaida = await lote("MM-L14", { area: A1, entry: "2026-07-01", exit: "2026-08-01" });
    expect(await ocupacoesDo(criadoComSaida)).toEqual([]);
  });
});

describe("MM-4d/MM-4e — camada 2: a área do manejo e da pesagem é a da ocupação NA DATA", () => {
  it("MM-4d backfill e gatilho BEFORE INSERT: área da ocupação que contém a data (não a área atual do lote)", async () => {
    // Backfill (acervo anterior): só os que caem dentro da ocupação do MESMO lote e da MESMA empresa.
    const areaDe = async (t: "animal_handlings" | "weighings", id: string) =>
      (await db.query<{ a: string | null }>(`select area_id a from erp.${t} where id=$1`, [id])).rows[0]!.a;
    expect([await areaDe("animal_handlings", H.diaDoInicio!), await areaDe("animal_handlings", H.depois!), await areaDe("animal_handlings", H.mesmaEmpresaDaOcupacao!)])
      .toEqual([A1, A1, B1]);
    expect([await areaDe("weighings", W.depois!), await areaDe("weighings", W.mesmaEmpresaDaOcupacao!)]).toEqual([A1, B1]);

    // Gatilho: lote em A1 desde 01/01, movido para A2; o histórico é ajustado para datas conhecidas.
    const L10 = await lote("MM-L10", { area: A1, entry: "2026-01-01" });
    await db.query("update erp.batches set area_id=$2 where id=$1", [L10, A2]);
    await db.query("update erp.ocupacoes_de_area set data_fim='2026-06-30' where batch_id=$1 and area_id=$2", [L10, A1]);
    await db.query("update erp.ocupacoes_de_area set data_inicio='2026-07-01' where batch_id=$1 and area_id=$2", [L10, A2]);
    expect((await ocupacoesDo(L10)).map((o) => [o.area_id, o.data_inicio, o.data_fim])).toEqual([[A1, "2026-01-01", "2026-06-30"], [A2, "2026-07-01", null]]);
    expect((await db.query<{ a: string }>("select area_id a from erp.batches where id=$1", [L10])).rows[0]!.a, "a área ATUAL do lote é A2").toBe(A2);

    expect(await manejo("MM-H10", E1, L10, "2026-06-15"), "dentro da ocupação de A1: A1, não a atual").toBe(A1);
    expect(await pesagem("MM-W10", E1, L10, "2026-06-15"), "pesagem idem").toBe(A1);
    expect(await manejo("MM-H11", E1, L10, "2026-01-01"), "primeiro dia (inclusivo)").toBe(A1);
    expect(await manejo("MM-H12", E1, L10, "2026-06-30"), "último dia (inclusivo)").toBe(A1);
    expect(await manejo("MM-H13", E1, L10, "2026-07-15"), "depois da troca: A2").toBe(A2);
    expect(await pesagem("MM-W13", E1, L10, "2026-07-15")).toBe(A2);
    // Dia da troca com fim de uma = início da outra: vence a que começou por último.
    await db.query("update erp.ocupacoes_de_area set data_fim='2026-07-01' where batch_id=$1 and area_id=$2", [L10, A1]);
    expect(await manejo("MM-H14", E1, L10, "2026-07-01"), "no dia da troca, a que começou por último").toBe(A2);
    // Área informada no INSERT é respeitada (o gatilho só preenche a nula).
    expect(await manejo("MM-H15", E1, L10, "2026-06-15", A3)).toBe(A3);
    // Pelo caminho da API (erp_app, sem bypass e sem EXECUTE na função): o gatilho preenche do mesmo jeito.
    const pelaApi = await withTx(app, ctxPec(demo.adminUserId), async (tx) => [
      (await tx.query<{ a: string | null }>(`insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id)
                                             values ($1,$2,'MM-H16','sanitary','2026-06-15',$3) returning area_id a`, [demo.orgId, E1, L10])).rows[0]!.a,
      (await tx.query<{ a: string | null }>(`insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id)
                                             values ($1,$2,'MM-W16','2026-07-15',$3) returning area_id a`, [demo.orgId, E1, L10])).rows[0]!.a
    ]);
    expect(pelaApi).toEqual([A1, A2]);
  });

  it("MM-4e sem ocupação naquela data → NULL: antes do início, lote sem ocupação, lote fechado, sem lote, excluído e ocupação de OUTRA empresa (backfill e gatilho)", async () => {
    const areas = async (t: "animal_handlings" | "weighings", ids: string[]) =>
      (await db.query<{ a: string | null }>(`select area_id a from erp.${t} where id = any($1)`, [ids])).rows.map((r) => r.a);
    const nulosManejo = [H.antesDoInicio!, H.excluido!, H.semLote!, H.loteSemOcupacao!, H.ocupacaoDeOutraEmpresa!, H.loteFechado!];
    expect(await areas("animal_handlings", nulosManejo)).toEqual(nulosManejo.map(() => null));
    const nulosPesagem = [W.antesDoInicio!, W.loteSemOcupacao!, W.ocupacaoDeOutraEmpresa!, W.excluida!];
    expect(await areas("weighings", nulosPesagem)).toEqual(nulosPesagem.map(() => null));

    const L10 = (await db.query<{ id: string }>("select id from erp.batches where code='MM-L10'")).rows[0]!.id;
    expect(await manejo("MM-H20", E1, L10, "2025-12-31"), "antes do início da primeira ocupação").toBeNull();
    expect(await manejo("MM-H21", E1, L4, "2026-05-01"), "lote sem ocupação").toBeNull();
    expect(await manejo("MM-H22", E1, null, "2026-05-01"), "sem lote").toBeNull();
    // L7 ocupa B1 (empresa 2) desde 05/01: o manejo lançado na empresa 1 NÃO herda a área da outra empresa; o da empresa 2 herda.
    expect(await manejo("MM-H23", E1, L7, "2026-05-01"), "ocupação de outra empresa: não se chuta").toBeNull();
    expect(await manejo("MM-H24", E2, L7, "2026-05-01"), "contraprova: na mesma empresa da ocupação").toBe(B1);
    expect(await pesagem("MM-W23", E1, L7, "2026-05-01")).toBeNull();
    expect(await pesagem("MM-W24", E2, L7, "2026-05-01")).toBe(B1);
  });
});

describe("MM-5 — RLS por empresa no módulo pecuaria e privilégios", () => {
  it("MM-5a outra organização não vê nada; quem só vê a empresa 1 não vê a 2 nem grava nela (WITH CHECK); o dono vê tudo", async () => {
    const contar = (q: Tx, empresa: string | null = null) => q.query<{ oc: number; ob: number }>(
      `select (select count(*)::int from erp.ocupacoes_de_area where $1::uuid is null or empresa_id=$1) oc,
              (select count(*)::int from erp.objetos_de_mapa where $1::uuid is null or empresa_id=$1) ob`, [empresa]).then((r) => r.rows[0]!);
    const real = async (empresa: string | null) => (await db.query<{ oc: number; ob: number }>(
      `select (select count(*)::int from erp.ocupacoes_de_area where organization_id=$2 and ($1::uuid is null or empresa_id=$1)) oc,
              (select count(*)::int from erp.objetos_de_mapa where organization_id=$2 and ($1::uuid is null or empresa_id=$1)) ob`, [empresa, demo.orgId])).rows[0]!;
    const todas = await real(null); const soE1 = await real(E1); const soE2 = await real(E2);
    // Premissa: há linha nas duas empresas, nas duas tabelas.
    expect(soE1.oc > 0 && soE1.ob > 0 && soE2.oc > 0 && soE2.ob > 0).toBe(true);
    expect(todas).toEqual({ oc: soE1.oc + soE2.oc, ob: soE1.ob + soE2.ob });

    expect(await withTx(app, ctxPec(demo.adminUserId), (tx) => contar(tx)), "o dono vê tudo da organização").toEqual(todas);
    expect(await withTx(app, ctxPec(donoOutraOrg, outraOrg), (tx) => contar(tx)), "GUC de outra organização: nada").toEqual({ oc: 0, ob: 0 });
    expect(await withTx(app, ctxPec(usuarioSoE1), (tx) => contar(tx)), "só a empresa 1").toEqual(soE1);
    expect(await withTx(app, ctxPec(usuarioSoE1), (tx) => contar(tx, E2)), "nenhuma linha da empresa 2").toEqual({ oc: 0, ob: 0 });
    expect(await withTx(app, { orgId: demo.orgId, userId: usuarioSoE1, modulo: "estoque" }, (tx) => contar(tx)), "fora do módulo pecuaria: nada").toEqual({ oc: 0, ob: 0 });

    // Escrita: na empresa 2 a WITH CHECK recusa (42501); na empresa 1 grava — a recusa não é geral.
    const ocupacao = (empresa: string, areaId: string) => (c: Tx) => c.query(
      `insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data)
       values ($1,$2,$3,$4,'2025-01-01','2025-01-02','informada')`, [demo.orgId, empresa, areaId, L4]);
    const eOc = await erroDe(desfeita(app, ctxPec(usuarioSoE1), ocupacao(E2, B1)));
    expect({ code: eOc.code, rls: /row-level security/.test(eOc.message) }).toEqual({ code: "42501", rls: true });
    expect((await desfeita(app, ctxPec(usuarioSoE1), ocupacao(E1, A1))).rowCount).toBe(1);
    const eOb = await erroDe(desfeita(app, ctxPec(usuarioSoE1), (c) => objeto(c, { empresa: E2, area: B1, tipo: "cocho", geometria: PONTO })));
    expect({ code: eOb.code, rls: /row-level security/.test(eOb.message) }).toEqual({ code: "42501", rls: true });
    expect((await desfeita(app, ctxPec(usuarioSoE1), (c) => objeto(c, { empresa: E1, area: A1, tipo: "cocho", geometria: PONTO }))).rowCount).toBe(1);
    // UPDATE na linha da empresa 2: a RLS devolve ZERO linhas (o chamador tem de conferir o ROW COUNT).
    expect((await desfeita(app, ctxPec(usuarioSoE1), (c) => c.query("update erp.ocupacoes_de_area set note='x' where empresa_id=$1", [E2]))).rowCount).toBe(0);
  });

  it("MM-5b DELETE e TRUNCATE revogados do erp_app nas duas tabelas novas e em erp.areas (catálogo e tentativa real: 42501); funções novas sem EXECUTE", async () => {
    const priv = (await db.query<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean; tr: boolean }>(
      `select t, has_table_privilege('erp_app', t, 'SELECT') s, has_table_privilege('erp_app', t, 'INSERT') i, has_table_privilege('erp_app', t, 'UPDATE') u,
              has_table_privilege('erp_app', t, 'DELETE') d, has_table_privilege('erp_app', t, 'TRUNCATE') tr
         from unnest(array['erp.ocupacoes_de_area','erp.objetos_de_mapa','erp.areas']) t order by 1`)).rows;
    expect(priv).toEqual([
      { t: "erp.areas", s: true, i: true, u: true, d: false, tr: false },
      { t: "erp.objetos_de_mapa", s: true, i: true, u: true, d: false, tr: false },
      { t: "erp.ocupacoes_de_area", s: true, i: true, u: true, d: false, tr: false }
    ]);
    const ocup = (await db.query<{ id: string }>("select id from erp.ocupacoes_de_area where empresa_id=$1 limit 1", [E1])).rows[0]!.id;
    const obj = (await db.query<{ id: string }>("select id from erp.objetos_de_mapa where empresa_id=$1 limit 1", [E1])).rows[0]!.id;
    const tentativas: [string, string, unknown[]][] = [
      ["delete ocupacao", "delete from erp.ocupacoes_de_area where id=$1", [ocup]],
      ["truncate ocupacoes", "truncate erp.ocupacoes_de_area", []],
      ["delete objeto", "delete from erp.objetos_de_mapa where id=$1", [obj]],
      ["truncate objetos", "truncate erp.objetos_de_mapa", []],
      ["delete area", "delete from erp.areas where id=$1", [A4]],
      ["truncate areas", "truncate erp.areas", []]
    ];
    const obtido: [string, string | undefined][] = [];
    for (const [nome, sql, p] of tentativas) obtido.push([nome, (await erroDe(desfeita(app, ctxPec(demo.adminUserId), (c) => c.query(sql, p)))).code]);
    expect(obtido).toEqual(tentativas.map(([nome]) => [nome, "42501"]));
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.ocupacoes_de_area where id=$1", [ocup])).rows[0]!.n).toBe(1);
    expect((await db.query<{ f: string; x: boolean }>(
      "select f, has_function_privilege('erp_app', f, 'EXECUTE') x from unnest($1::text[]) f order by f collate \"C\"", [FUNCOES])).rows)
      .toEqual([...FUNCOES].sort().map((f) => ({ f, x: false })));
  });
});

describe("MM-11c — paridade com o domínio (@agro/domain é o dono das listas)", () => {
  const lista = async (nome: string) => {
    const def = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname=$1", [nome])).rows[0]!.d;
    return [...def.matchAll(/'([^'{}]+)'::text(?!\[\])/g)].map((m) => m[1]);
  };
  it("MM-11c TIPOS_DE_OBJETO_DE_MAPA = chk_objetos_tipo (lista exata); TIPOS_DE_LINHA = a lista de chk_objetos_forma_bate_com_tipo (vazia: todos de ponto)", async () => {
    expect(await lista("chk_objetos_tipo")).toEqual(TIPOS_DE_OBJETO_DE_MAPA.map((t) => t.tipo));
    expect(TIPOS_DE_OBJETO_DE_MAPA.map((t) => t.forma)).toEqual(TIPOS_DE_OBJETO_DE_MAPA.map(() => "ponto"));
    const bate = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname='chk_objetos_forma_bate_com_tipo'")).rows[0]!.d;
    const m = /^CHECK \(\(\(tipo = ANY \('\{([^}]*)\}'::text\[\]\)\) = \(forma = 'linha'::text\)\)\)$/.exec(bate);
    expect(m, `forma da CHECK: ${bate}`).not.toBeNull();
    const linhasNoBanco = m![1] === "" ? [] : m![1]!.split(",");
    expect(linhasNoBanco).toEqual([...TIPOS_DE_LINHA]);
    expect(TIPOS_DE_LINHA).toEqual([]);
    expect(await lista("chk_objetos_forma")).toEqual([...FORMAS_DE_OBJETO]);
    expect(await lista("chk_objetos_unidade")).toEqual([...UNIDADES_DE_CAPACIDADE]);
    for (const t of TIPOS_DE_OBJETO_DE_MAPA) expect(UNIDADES_DE_CAPACIDADE).toContain(t.unidadeCapacidade);
    expect(await lista("chk_ocupacoes_origem_da_data")).toEqual([...ORIGENS_DA_DATA]);
    expect(await lista("chk_ocupacoes_motivo_saida")).toEqual([...MOTIVOS_DE_SAIDA]);

    // Comportamento: cada tipo do catálogo grava na forma ponto e é recusado na forma linha.
    await desfeita(db, null, async (c) => {
      for (const t of TIPOS_DE_OBJETO_DE_MAPA) {
        expect((await objeto(c, { empresa: E1, area: A1, tipo: t.tipo, geometria: PONTO })).rowCount).toBe(1);
        const e = await erroNoPonto(c, `insert into erp.objetos_de_mapa (organization_id, empresa_id, tipo, forma, geometria, name)
                                        values ($1,$2,$3,'linha',$4::jsonb,'[TEST] linha')`,
          [demo.orgId, E1, t.tipo, JSON.stringify({ type: "LineString", coordinates: [[-56.1, -15.6], [-56.09, -15.59]] })]);
        expect([t.tipo, e.code, e.constraint]).toEqual([t.tipo, "23514", "chk_objetos_forma_bate_com_tipo"]);
      }
      const desconhecido = await erroNoPonto(c, `insert into erp.objetos_de_mapa (organization_id, empresa_id, tipo, forma, geometria, name)
                                                values ($1,$2,'cerca','ponto',$3::jsonb,'[TEST] cerca')`, [demo.orgId, E1, JSON.stringify(PONTO)]);
      expect([desconhecido.code, desconhecido.constraint]).toEqual(["23514", "chk_objetos_tipo"]);
    });
  });
});
