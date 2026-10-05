import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";
import { INDICES_SATELITE, INDICES_CONSULTA_SATELITE, VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";

/**
 * 0056 (SAT-08, decisão 299) — multi-índice / condição da área: CHECKs ampliados + tabela ext imutável.
 */
let db: Db; let app: Db; let demo: DemoOrg;
const ALVO = "0056_satelite_multi_indice.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "SAT-08: outra transacao ja detem a trava desta migration (2026,90). Nada foi aplicado.";
const JA = "SAT-08: a 0056 ja foi aplicada ou ha schema divergente (analises_satelitais_ext ja existe).";

beforeAll(async () => {
  db = await createPool(TEST_URL);
  app = await createPool(URL_APP);
  await resetSchema(db);
  for (const m of ANTERIORES) await db.query(m.sql);
  await seedReference(db);
  demo = await seedDemo(db);
}, 120_000);

afterAll(async () => { await app?.end(); await db?.end(); });

async function listaCheck(nome: string): Promise<string[]> {
  const def = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname=$1", [nome])).rows[0]!.d;
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
}

describe("SAT-08 — migration 0056", () => {
  it("trava (2026,90) ocupada recusa sem aplicar", async () => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(2026, 90)");
      const outro = await createPool(TEST_URL);
      try {
        await expect(outro.query(SQL_ALVO)).rejects.toThrow(TRAVA);
      } finally { await outro.end(); }
    } finally { await db.query("rollback"); }
  });

  it("sobe: CHECKs do domínio + tabela ext; reaplicar falha", async () => {
    await db.query(SQL_ALVO);
    const indices = await listaCheck("chk_analises_satelitais_indice");
    expect(indices.sort()).toEqual([...INDICES_SATELITE].sort());
    const bundles = await listaCheck("chk_satelite_consulta_itens_indice_bundle");
    expect(bundles.sort()).toEqual([...INDICES_CONSULTA_SATELITE].sort());
    const versoes = await listaCheck("chk_satelite_consulta_itens_versao_metodo");
    expect(versoes).toContain("ndvi-v2");
    expect(versoes).toContain(VERSAO_METODO_PASTAGEM_ESSENCIAL);
    const t = await db.query(`select to_regclass('erp.analises_satelitais_ext') is not null as ok`);
    expect(t.rows[0]!.ok).toBe(true);
    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });

  it("ext é imutável", async () => {
    const empresa = (await db.query<{ id: string }>(
      `select id from erp.empresas where organization_id = $1 limit 1`, [demo.orgId])).rows[0]!;
    const poligono = { type: "Polygon", coordinates: [[[-47.1, -15.8], [-47.0, -15.8], [-47.0, -15.7], [-47.1, -15.7], [-47.1, -15.8]]] };
    const area = (await db.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'SAT08-A','[TEST] SAT-08',12,12,'pastagem','ativa','propria',$3::jsonb) returning id`,
      [demo.orgId, empresa.id, JSON.stringify(poligono)])).rows[0]!;
    const hash = (await db.query<{ h: string }>(
      `select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') as h from erp.areas where id = $1`, [area.id])).rows[0]!.h;
    const analise = await db.query<{ id: string }>(
      `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo,
          geometria_sha256, janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, pixels_geometria, metadados_provedor, criado_por)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','evi2',$4,$5,'2026-09-01','2026-10-01',20,'sem_observacao_util','sem_aquisicao',10,'{}',$6)
       returning id`,
      [demo.orgId, empresa.id, area.id, VERSAO_METODO_PASTAGEM_ESSENCIAL, hash, demo.adminUserId]);
    const id = analise.rows[0]!.id;
    await db.query(
      `insert into erp.analises_satelitais_ext (analise_id, organization_id, empresa_id, area_id, qualidade, versao_distribuicao)
       values ($1,$2,$3,$4,'{"estado":"sem_imagem_util"}',$5)`,
      [id, demo.orgId, empresa.id, area.id, VERSAO_METODO_PASTAGEM_ESSENCIAL]);
    await expect(db.query(`update erp.analises_satelitais_ext set qualidade = '{}' where analise_id = $1`, [id]))
      .rejects.toThrow(/não se altera|nao se altera|CONFLICT/i);
  });
});
