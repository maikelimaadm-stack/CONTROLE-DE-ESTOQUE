import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import {
  PROVEDORES_SATELITE, COLECOES_SATELITE, INDICES_SATELITE, VALORES_SITUACAO_ANALISE_SATELITAL,
  VALORES_MOTIVO_QUALIDADE_ANALISE_SATELITAL
} from "@agro/domain";
import { TEST_URL } from "./setup.js";

/**
 * A 0052 (SAT-01, decisão 293 — histórico de análises satelitais por área), PROVADA CONTRA O BANCO, como o runner
 * aplica (arquivo a arquivo, cada um numa transação).
 *
 * DB-0 premissa (o ledger até a 0051, nada da 0052) · DB-1 a trava (2026,86) ocupada recusa sem aplicar nada ·
 * DB-2 aplica; reaplicar é recusado ("já aplicada") · DB-3 as listas dos CHECKs são as do domínio (um dono só) ·
 * DB-4 o que ela promete: coerência concluída × sem observação útil, FK composta da área (outra empresa e outra
 * organização recusadas), conferência da área no gatilho (inexistente/excluída → NOT_FOUND, sem polígono →
 * VALIDATION_ERROR, polígono que mudou → CONCURRENCY_CONFLICT), histórico imutável (UPDATE recusado até para o dono;
 * UPDATE/DELETE/TRUNCATE revogados do erp_app), unicidade por área/método/polígono/janela, RLS por empresa no módulo
 * da área (quem só vê B não vê nem grava em A) e auditoria.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de RLS,
 * com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let areaA: string; let areaB: string; let areaSemPoligono: string; let areaExcluida: string;
let outraOrg: string; let empresaOutraOrg: string; let areaOutraOrg: string;
let usuarioSoB: string;

const ALVO = "0052_analises_satelitais.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const TRAVA = "SAT-01: outra transacao ja detem a trava desta migration (2026,86). Nada foi aplicado.";
const JA = "SAT-01: a 0052 ja foi aplicada ou ha schema divergente (analises_satelitais/analises_satelitais_conferir/areas_org_empresa_key ja existe).";

const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
const OUTRO_POLIGONO = { type: "Polygon", coordinates: [[[-56.2, -15.6], [-56.2, -15.59], [-56.19, -15.59], [-56.19, -15.6], [-56.2, -15.6]]] };

const JANELA = { inicio: "2026-09-03T00:00:00Z", fim: "2026-10-03T00:00:00Z" };
const OBS = { inicio: "2026-09-30T00:00:00Z", fim: "2026-10-01T00:00:00Z" };

async function id1(sql: string, p: unknown[] = []) { return (await db.query<{ id: string }>(sql, p)).rows[0]!.id; }
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { const x = e as { code?: string; constraint?: string; message: string }; return { code: x.code, constraint: x.constraint, message: x.message }; }
  throw new Error("esperava recusa");
}
const hashDe = async (areaId: string) =>
  (await db.query<{ h: string }>("select encode(sha256(convert_to(geometria::text,'UTF8')),'hex') h from erp.areas where id=$1", [areaId])).rows[0]!.h;
const ctxPec = (userId: string, orgId = demo.orgId): TenantContext => ({ orgId, userId, modulo: "pecuaria" });

interface Linha { org?: string; empresa: string; area: string; hash: string; situacao?: string; janelaInicio?: string; obsInicio?: string | null; medio?: string | null; minimo?: string | null; maximo?: string | null; motivo?: string | null }
/** Monta o INSERT de uma análise; o padrão é uma análise concluída coerente. */
function inserir(q: Queryable, l: Linha) {
  const concluida = (l.situacao ?? "concluida") === "concluida";
  const obsInicio = l.obsInicio === undefined ? OBS.inicio : l.obsInicio;
  return q.query<{ id: string }>(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
       janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim,
       valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida,
       metadados_provedor, criado_por)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi','sat01-ndvi-v1',$4,$5,$6,10,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'{"intervalos_recebidos":3}',$20) returning id`,
    [l.org ?? demo.orgId, l.empresa, l.area, l.hash, l.janelaInicio ?? JANELA.inicio, JANELA.fim, l.situacao ?? "concluida",
      concluida ? null : (l.motivo === undefined ? "cobertura_insuficiente" : l.motivo),
      concluida ? obsInicio : null, concluida ? OBS.fim : null,
      concluida ? (l.medio === undefined ? "0.7200" : l.medio) : null,
      concluida ? (l.minimo === undefined ? "0.3100" : l.minimo) : null,
      concluida ? (l.maximo === undefined ? "0.8800" : l.maximo) : null,
      concluida ? "0.0900" : null,
      concluida ? 4934 : null, concluida ? 406 : null, concluida ? 4528 : null, concluida ? 4900 : null, concluida ? "0.9241" : null,
      demo.adminUserId]);
}

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
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-0 a DB-2 — a 0052 sobre o banco até a 0051: premissa, trava e reaplicação", () => {
  it("DB-0 PREMISSA: o ledger tem todas as anteriores (a 0051 por último) e nada da 0052 existe", async () => {
    expect(ANTERIORES.at(-1)!.name).toBe("0051_areas_mapa_unificado.sql");
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length, ultima: "0051_areas_mapa_unificado.sql" });
    expect((await db.query<{ t: string | null }>("select to_regclass('erp.analises_satelitais')::text t")).rows[0]!.t).toBeNull();
    expect((await db.query("select 1 from pg_constraint where conname='areas_org_empresa_key'")).rowCount).toBe(0);
  });

  it("DB-1 TRAVA: com (2026,86) ocupada por outra sessão, a 0052 recusa sem aplicar nada", async () => {
    const outra = await db.connect();
    try {
      await outra.query("begin; select pg_advisory_xact_lock(2026, 86)");
      const c = await db.connect();
      try {
        await c.query("begin");
        expect((await erroDe(c.query(SQL_ALVO))).message).toBe(TRAVA);
        await c.query("rollback");
      } finally { c.release(); }
      await outra.query("rollback");
    } finally { outra.release(); }
    expect((await db.query<{ t: string | null }>("select to_regclass('erp.analises_satelitais')::text t")).rows[0]!.t).toBeNull();
  });

  it("DB-2 APLICA como o runner; reaplicar é recusado com a mensagem de 'já aplicada'", async () => {
    await db.query(SQL_ALVO);
    await db.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: ANTERIORES.length + 1, ultima: ALVO });
    expect((await erroDe(db.query(SQL_ALVO))).message).toBe(JA);

    // Cenário (depois da migration, como no fluxo real: o seed roda depois do schema).
    await seedReference(db, () => {});
    demo = await seedDemo(db, {}, () => {});
    const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
    A = empresas[0]!.id; B = empresas[1]!.id;
    const area = (empresa: string, code: string, geometria: unknown, org = demo.orgId) =>
      id1(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
           values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] SAT ${code}`, geometria === null ? null : JSON.stringify(geometria)]);
    areaA = await area(A, "SAT-A", POLIGONO);
    areaB = await area(B, "SAT-B", POLIGONO);
    areaSemPoligono = await area(A, "SAT-SEM", null);
    areaExcluida = await area(A, "SAT-EXC", POLIGONO);
    await db.query("update erp.areas set deleted_at = now() where id=$1", [areaExcluida]);
    outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT','outra-sat') returning id");
    empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 96, '[TEST] Empresa outra org SAT') returning id", [outraOrg]);
    areaOutraOrg = await area(empresaOutraOrg, "SAT-X", POLIGONO, outraOrg);

    usuarioSoB = await id1("insert into erp.users (email, name, password_hash) values ('sat-so-b@demo.local','SAT Só B','x') returning id");
    const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioSoB]);
    await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'pecuaria','selecionadas')", [demo.orgId, membro]);
    await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [demo.orgId, membro, B]);
  });
});

describe("DB-3 — as listas fechadas do banco são as do domínio", () => {
  const lista = async (nome: string) => {
    const def = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname=$1", [nome])).rows[0]!.d;
    return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
  };
  it("provedor, coleção, índice, situação e motivo espelham @agro/domain", async () => {
    expect(await lista("chk_analises_satelitais_provedor")).toEqual([...PROVEDORES_SATELITE]);
    expect(await lista("chk_analises_satelitais_colecao")).toEqual([...COLECOES_SATELITE]);
    expect(await lista("chk_analises_satelitais_indice")).toEqual([...INDICES_SATELITE]);
    expect(await lista("chk_analises_satelitais_situacao")).toEqual([...VALORES_SITUACAO_ANALISE_SATELITAL]);
    expect(await lista("chk_analises_satelitais_motivo")).toEqual([...VALORES_MOTIVO_QUALIDADE_ANALISE_SATELITAL]);
  });
});

describe("DB-4 — o que a 0052 promete", () => {
  it("(a) grava a análise concluída coerente e a sem observação útil SEM número; a auditoria registra a criação", async () => {
    const h = await hashDe(areaA);
    const id = (await inserir(db, { empresa: A, area: areaA, hash: h })).rows[0]!.id as string;
    const sem = (await inserir(db, { empresa: A, area: areaA, hash: h, situacao: "sem_observacao_util", janelaInicio: "2026-09-02T00:00:00Z" })).rows[0]!.id as string;
    const linhas = (await db.query<{ id: string; situacao: string; valor_medio: string | null }>("select id, situacao, valor_medio from erp.analises_satelitais where id = any($1) order by situacao", [[id, sem]])).rows;
    expect(linhas).toEqual([{ id, situacao: "concluida", valor_medio: "0.7200" }, { id: sem, situacao: "sem_observacao_util", valor_medio: null }]);
    expect((await db.query("select 1 from erp.audit_logs where entity='analises_satelitais' and entity_id=$1 and action='create'", [id])).rowCount).toBe(1);
  });

  it("(b) CHECKs: concluída sem número, sem observação útil com número, NDVI fora de [-1,1], mínimo > média e observação fora da janela → 23514", async () => {
    const h = await hashDe(areaA);
    const casos: [string, Linha][] = [
      ["concluída sem média", { empresa: A, area: areaA, hash: h, janelaInicio: "2026-08-01T00:00:00Z", medio: null }],
      ["NDVI acima de 1", { empresa: A, area: areaA, hash: h, janelaInicio: "2026-08-02T00:00:00Z", maximo: "1.2000" }],
      ["mínimo maior que a média", { empresa: A, area: areaA, hash: h, janelaInicio: "2026-08-03T00:00:00Z", minimo: "0.8000" }],
      ["observação fora da janela", { empresa: A, area: areaA, hash: h, janelaInicio: "2026-08-04T00:00:00Z", obsInicio: "2026-08-01T00:00:00Z" }],
      ["sem observação útil sem motivo", { empresa: A, area: areaA, hash: h, janelaInicio: "2026-08-05T00:00:00Z", situacao: "sem_observacao_util", motivo: null }]
    ];
    for (const [nome, l] of casos) expect([nome, (await erroDe(inserir(db, l))).code]).toEqual([nome, "23514"]);
  });

  it("(c) área de OUTRA empresa ou de OUTRA organização: o gatilho recusa como inexistente; sem o gatilho, a FK composta recusa (23503)", async () => {
    const empresaErrada: Linha = { empresa: A, area: areaB, hash: await hashDe(areaB), janelaInicio: "2026-07-01T00:00:00Z" };
    const orgErrada: Linha = { empresa: A, area: areaOutraOrg, hash: await hashDe(areaOutraOrg), janelaInicio: "2026-07-02T00:00:00Z" };
    // Primeira barreira: a conferência não acha a área naquela (organização, empresa) — a mesma recusa de inexistente.
    expect((await erroDe(inserir(db, empresaErrada))).message).toBe("NOT_FOUND: Área não encontrada");
    expect((await erroDe(inserir(db, orgErrada))).message).toBe("NOT_FOUND: Área não encontrada");
    // Segunda barreira, declarativa: com o gatilho desligado numa transação DESFEITA, a FK composta recusa sozinha.
    const c = await db.connect();
    try {
      for (const l of [empresaErrada, orgErrada]) {
        await c.query("begin");
        await c.query("alter table erp.analises_satelitais disable trigger trg_analises_satelitais_conferir");
        expect((await erroDe(inserir(c, l))).constraint).toBe("fk_analises_satelitais_area");
        await c.query("rollback");
      }
    } finally { c.release(); }
    expect((await db.query<{ e: string }>("select tgenabled::text e from pg_trigger where tgname='trg_analises_satelitais_conferir'")).rows[0]!.e).toBe("O");
  });

  it("(d) gatilho: área excluída → NOT_FOUND; sem polígono → VALIDATION_ERROR; polígono que mudou → CONCURRENCY_CONFLICT", async () => {
    expect((await erroDe(inserir(db, { empresa: A, area: areaExcluida, hash: "0".repeat(64), janelaInicio: "2026-06-01T00:00:00Z" }))).message).toBe("NOT_FOUND: Área não encontrada");
    expect((await erroDe(inserir(db, { empresa: A, area: areaSemPoligono, hash: "0".repeat(64), janelaInicio: "2026-06-02T00:00:00Z" }))).message)
      .toMatch(/^VALIDATION_ERROR: A área não tem polígono desenhado/);
    const antigo = await hashDe(areaA);
    await db.query("update erp.areas set geometria=$2 where id=$1", [areaA, JSON.stringify(OUTRO_POLIGONO)]);
    try {
      expect(await hashDe(areaA)).not.toBe(antigo);
      expect((await erroDe(inserir(db, { empresa: A, area: areaA, hash: antigo, janelaInicio: "2026-06-03T00:00:00Z" }))).message)
        .toMatch(/^CONCURRENCY_CONFLICT: O polígono da área mudou/);
    } finally {
      await db.query("update erp.areas set geometria=$2 where id=$1", [areaA, JSON.stringify(POLIGONO)]);
    }
    expect(await hashDe(areaA)).toBe(antigo);
  });

  it("(e) histórico imutável: UPDATE recusado até para o dono do schema; erp_app sem UPDATE/DELETE/TRUNCATE", async () => {
    const id = (await db.query<{ id: string }>("select id from erp.analises_satelitais where area_id=$1 and situacao='concluida' limit 1", [areaA])).rows[0]!.id;
    expect((await erroDe(db.query("update erp.analises_satelitais set valor_medio = 0.5 where id=$1", [id]))).message)
      .toBe("CONFLICT: A análise satelital registrada não se altera: uma análise nova é registrada ao lado da anterior.");
    const priv = (await db.query<{ u: boolean; d: boolean; t: boolean; s: boolean; i: boolean }>(
      `select has_table_privilege('erp_app','erp.analises_satelitais','UPDATE') u, has_table_privilege('erp_app','erp.analises_satelitais','DELETE') d,
              has_table_privilege('erp_app','erp.analises_satelitais','TRUNCATE') t, has_table_privilege('erp_app','erp.analises_satelitais','SELECT') s,
              has_table_privilege('erp_app','erp.analises_satelitais','INSERT') i`)).rows[0];
    expect(priv).toEqual({ u: false, d: false, t: false, s: true, i: true });
    expect((await erroDe(withTx(app, ctxPec(demo.adminUserId), (tx) => tx.query("delete from erp.analises_satelitais where id=$1", [id])))).code).toBe("42501");
  });

  it("(f) uma execução por área, método, polígono e janela: a repetição esbarra na unicidade (23505)", async () => {
    const h = await hashDe(areaB);
    await inserir(db, { empresa: B, area: areaB, hash: h, janelaInicio: "2026-05-01T00:00:00Z" });
    expect((await erroDe(inserir(db, { empresa: B, area: areaB, hash: h, janelaInicio: "2026-05-01T00:00:00Z" }))).constraint).toBe("uq_analises_satelitais_janela");
  });

  it("(g) RLS pelo escopo da área (pecuária): quem só vê B lê e grava em B, não lê nem grava em A; outro módulo não vê nada", async () => {
    const deA = (await db.query<{ id: string }>("select id from erp.analises_satelitais where area_id=$1 limit 1", [areaA])).rows[0]!.id;
    const deB = (await db.query<{ id: string }>("select id from erp.analises_satelitais where area_id=$1 limit 1", [areaB])).rows[0]!.id;
    const lidos = (await withTx(app, ctxPec(usuarioSoB), (tx) => tx.query<{ id: string }>("select id from erp.analises_satelitais where id = any($1::uuid[])", [[deA, deB]]))).rows.map((r) => r.id);
    expect(lidos).toEqual([deB]);
    // Grava em B (a área de B está no escopo dele).
    const hB = await hashDe(areaB);
    const gravou = await withTx(app, ctxPec(usuarioSoB), (tx) => inserir(tx, { empresa: B, area: areaB, hash: hB, janelaInicio: "2026-04-01T00:00:00Z" }));
    expect(gravou.rowCount).toBe(1);
    // Em A a própria área não é visível para ele: o gatilho responde a mesma recusa de área inexistente.
    const hA = await hashDe(areaA);
    expect((await erroDe(withTx(app, ctxPec(usuarioSoB), (tx) => inserir(tx, { empresa: A, area: areaA, hash: hA, janelaInicio: "2026-04-02T00:00:00Z" })))).message)
      .toBe("NOT_FOUND: Área não encontrada");
    // Fora do módulo da área (financeiro), nem a linha de B aparece: módulo sem escopo = nenhuma empresa.
    expect((await withTx(app, { orgId: demo.orgId, userId: usuarioSoB, modulo: "financeiro" }, (tx) => tx.query("select id from erp.analises_satelitais where id = any($1::uuid[])", [[deA, deB]]))).rowCount).toBe(0);
    // Outra organização: o tenant não enxerga nada da demo.
    expect((await withTx(app, ctxPec(demo.adminUserId, outraOrg), (tx) => tx.query("select id from erp.analises_satelitais where id = any($1::uuid[])", [[deA, deB]]))).rowCount).toBe(0);
  });
});
