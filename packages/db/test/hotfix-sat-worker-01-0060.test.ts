import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * 0060 — HOTFIX-SAT-WORKER-01: reserva só aceita área viva no módulo SSOT; diagnóstico seguro.
 * Forward-only. Trava (2026,94). Não edita 0054.
 */
let db: Db;
let app: Db;
let demo: DemoOrg;
let empresaA: string;
let areaA: string;

const ALVO = "0060_satelite_reserva_area_viva.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "HOTFIX-SAT-WORKER-01: outra transacao ja detem a trava desta migration (2026,94). Nada foi aplicado.";
const JA = "HOTFIX-SAT-WORKER-01: a 0060 ja foi aplicada";
const VAZIO: TenantContext = { orgId: null, userId: null, modulo: null };
const SEM_TETO = 1_000_000;
const POLIGONO = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  db = await createPool(TEST_URL);
  await resetSchema(db);
  for (const m of ANTERIORES) await db.query(m.sql);
  await seedReference(db);
  demo = await seedDemo(db);
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = await createPool(URL_APP);
  empresaA = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  areaA = (await db.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,'HF60A','[TEST] hotfix 0060',10,10,'pastagem','ativa','propria',$3::jsonb) returning id`,
    [demo.orgId, empresaA, JSON.stringify(POLIGONO)])).rows[0]!.id;
}, 180_000);

afterAll(async () => { await app?.end(); await db?.end(); });

async function consultaEItem(opts: { area?: string; situacao?: string } = {}) {
  const c = (await db.query<{ id: string }>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, total_itens, situacao)
     values ($1,$2,$3,'{"alvo":{"tipo":"todas"}}','1.00','1.00',1,'pendente') returning id`,
    [demo.orgId, empresaA, demo.adminUserId])).rows[0]!.id;
  const chave = sha(randomUUID());
  const i = (await db.query<{ id: string }>(
    `insert into erp.satelite_consulta_itens
       (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, situacao, tentativas, chave_idempotencia, chave_idempotencia_origem,
        indice_bundle, versao_metodo, janela_inicio, janela_fim)
     values ($1,$2,$3,$4,$5,$6,0,$7,$8,'ndvi','ndvi-v2','2026-09-05','2026-10-04') returning id`,
    [c, demo.orgId, empresaA, opts.area ?? areaA, sha(`g-${opts.area ?? areaA}`), opts.situacao ?? "pendente", chave, `origem|${chave}`])).rows[0]!.id;
  return { consultaId: c, itemId: i };
}

describe("HOTFIX-SAT-WORKER-01 — migration 0060 reserva área viva", () => {
  it("trava (2026,94) ocupada recusa sem aplicar", async () => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(2026, 94)");
      const outro = await createPool(TEST_URL);
      try {
        await expect(outro.query(SQL_ALVO)).rejects.toThrow(TRAVA);
      } finally { await outro.end(); }
    } finally { await db.query("rollback"); }
  });

  it("cria SSOT + diagnóstico; reserva rejeita área deletada sem devolver item; reaplicar falha", async () => {
    await db.query(SQL_ALVO);

    expect((await db.query<{ m: string }>("select erp.modulo_satelite_executor() m")).rows[0]!.m).toBe("pecuaria");

    const def = (await db.query<{ d: string }>(
      `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='erp' and p.proname='satelite_reservar_itens'
          and pg_get_function_identity_arguments(p.oid) like '%integer%integer%integer%integer%integer%'`
    )).rows[0]!.d;
    expect(def).toContain("modulo_satelite_executor");
    expect(def).toContain("deleted_at is null");

    const { itemId: vivo } = await consultaEItem();
    const reservados = await withTx(app, VAZIO, (tx) =>
      tx.query<{ item_id: string }>("select item_id from erp.satelite_reservar_itens($1,$2,$3,$4,$5)", [10, SEM_TETO, SEM_TETO, SEM_TETO, 600]));
    expect(reservados.rows.map((r) => r.item_id)).toContain(vivo);

    const areaMort = (await db.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria, deleted_at)
       values ($1,$2,'HF60D','[TEST] deletada',10,10,'pastagem','ativa','propria',$3::jsonb, now()) returning id`,
      [demo.orgId, empresaA, JSON.stringify(POLIGONO)])).rows[0]!.id;
    const { itemId: morto } = await consultaEItem({ area: areaMort });
    const r2 = await withTx(app, VAZIO, (tx) =>
      tx.query<{ item_id: string }>("select item_id from erp.satelite_reservar_itens($1,$2,$3,$4,$5)", [10, SEM_TETO, SEM_TETO, SEM_TETO, 600]));
    expect(r2.rows.map((x) => x.item_id)).not.toContain(morto);
    const estado = (await db.query<{ situacao: string; erro: string | null }>(
      "select situacao, erro from erp.satelite_consulta_itens where id=$1", [morto])).rows[0]!;
    expect(estado).toEqual({ situacao: "falho", erro: "area_nao_encontrada" });

    const diag = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "pecuaria" }, (tx) =>
      tx.query<{ area_existe_no_tenant: boolean; area_deletada: boolean; area_visivel_no_escopo: boolean }>(
        "select * from erp.satelite_diagnosticar_area($1,$2,$3,null)", [demo.orgId, areaMort, demo.adminUserId]));
    expect(diag.rows[0]).toMatchObject({ area_existe_no_tenant: true, area_deletada: true, area_visivel_no_escopo: false });

    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });
});
