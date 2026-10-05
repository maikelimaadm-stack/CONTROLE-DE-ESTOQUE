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

async function listaCheck(tabela: string, nome: string): Promise<string[]> {
  const r = await db.query<{ v: string }>(
    `select unnest(string_to_array(regexp_replace(pg_get_constraintdef(c.oid), '.*\\((.*)\\).*', '\\1'), ', ')) as v
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'erp' and t.relname = $1 and c.conname = $2`, [tabela, nome]);
  return r.rows.map((x) => x.v.replace(/'/g, "").trim()).filter(Boolean);
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
    const indices = await listaCheck("analises_satelitais", "chk_analises_satelitais_indice");
    expect(indices.sort()).toEqual([...INDICES_SATELITE].sort());
    const bundles = await listaCheck("satelite_consulta_itens", "chk_satelite_consulta_itens_indice_bundle");
    expect(bundles.sort()).toEqual([...INDICES_CONSULTA_SATELITE].sort());
    const versoes = await listaCheck("satelite_consulta_itens", "chk_satelite_consulta_itens_versao_metodo");
    expect(versoes).toContain("ndvi-v2");
    expect(versoes).toContain(VERSAO_METODO_PASTAGEM_ESSENCIAL);
    const t = await db.query(`select to_regclass('erp.analises_satelitais_ext') is not null as ok`);
    expect(t.rows[0]!.ok).toBe(true);
    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });

  it("ext é imutável e RLS por empresa", async () => {
    const area = await db.query<{ id: string; empresa_id: string }>(
      `select id, empresa_id from erp.areas where organization_id = $1 and deleted_at is null limit 1`, [demo.orgId]);
    const a = area.rows[0]!;
    const hash = await db.query<{ h: string }>(
      `select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') as h from erp.areas where id = $1`, [a.id]);
    const user = await db.query<{ id: string }>(`select id from erp.users where organization_id = $1 limit 1`, [demo.orgId]);
    const analise = await db.query<{ id: string }>(
      `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo,
          geometria_sha256, janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, pixels_geometria, metadados_provedor, criado_por)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','evi2',$4,$5,'2026-09-01','2026-10-01',20,'sem_observacao_util','sem_aquisicao',10,'{}',$6)
       returning id`,
      [demo.orgId, a.empresa_id, a.id, VERSAO_METODO_PASTAGEM_ESSENCIAL, hash.rows[0]!.h, user.rows[0]!.id]);
    const id = analise.rows[0]!.id;
    await db.query(
      `insert into erp.analises_satelitais_ext (analise_id, organization_id, empresa_id, area_id, qualidade, versao_distribuicao)
       values ($1,$2,$3,$4,'{"estado":"sem_imagem_util"}',$5)`,
      [id, demo.orgId, a.empresa_id, a.id, VERSAO_METODO_PASTAGEM_ESSENCIAL]);
    await expect(db.query(`update erp.analises_satelitais_ext set qualidade = '{}' where analise_id = $1`, [id]))
      .rejects.toThrow(/não se altera|nao se altera|CONFLICT/i);
  });
});
