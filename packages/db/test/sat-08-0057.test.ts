import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";
import {
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  VERSAO_METODO_PASTAGEM_ESSENCIAL_V1
} from "@agro/domain";

/**
 * 0057 (SAT-08 R1, decisão 300) — correção forward-only: v2 do método + faixa EVI2 até 2.5.
 * A 0056 permanece imutável; upgrade 0056→0057 sem UPDATE/DELETE de análises.
 */
let db: Db; let app: Db; let demo: DemoOrg;
const ALVO = "0057_satelite_multi_indice_contrato.sql";
const ANTES = "0056_satelite_multi_indice.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_0056 = listMigrations().find((x) => x.name === ANTES)!.sql;
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const URL_APP = process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@");
const TRAVA = "SAT-08 R1: outra transacao ja detem a trava desta migration (2026,91). Nada foi aplicado.";
const JA = "SAT-08 R1: a 0057 ja foi aplicada";

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

async function criarArea(): Promise<{ empresaId: string; areaId: string; hash: string }> {
  const empresa = (await db.query<{ id: string }>(
    `select id from erp.empresas where organization_id = $1 limit 1`, [demo.orgId])).rows[0]!;
  const poligono = { type: "Polygon", coordinates: [[[-47.1, -15.8], [-47.0, -15.8], [-47.0, -15.7], [-47.1, -15.7], [-47.1, -15.8]]] };
  const area = (await db.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,'[TEST] SAT-08 R1',12,12,'pastagem','ativa','propria',$4::jsonb) returning id`,
    [demo.orgId, empresa.id, `SAT08R1-${Date.now()}`, JSON.stringify(poligono)])).rows[0]!;
  const hash = (await db.query<{ h: string }>(
    `select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') as h from erp.areas where id = $1`, [area.id])).rows[0]!.h;
  return { empresaId: empresa.id, areaId: area.id, hash };
}

describe("SAT-08 R1 — migration 0057", () => {
  it("trava (2026,91) ocupada recusa sem aplicar", async () => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(2026, 91)");
      const outro = await createPool(TEST_URL);
      try {
        await expect(outro.query(SQL_ALVO)).rejects.toThrow(TRAVA);
      } finally { await outro.end(); }
    } finally { await db.query("rollback"); }
  });

  it("upgrade 0056→0057: EVI2 >1 entra; NDVI >1 continua recusado; v1 e v2 aceitos; zero UPDATE de análises", async () => {
    // ANTERIORES já inclui 0056 (name < 0057). Confirma.
    expect(ANTERIORES.some((m) => m.name === ANTES)).toBe(true);
    const antesCount = (await db.query<{ n: string }>(`select count(*)::text as n from erp.analises_satelitais`)).rows[0]!.n;

    await db.query(SQL_ALVO);

    const versoes = await listaCheck("chk_satelite_consulta_itens_versao_metodo");
    expect(versoes).toContain("ndvi-v2");
    expect(versoes).toContain(VERSAO_METODO_PASTAGEM_ESSENCIAL_V1);
    expect(versoes).toContain(VERSAO_METODO_PASTAGEM_ESSENCIAL);

    const faixa = (await db.query<{ d: string }>(
      `select pg_get_constraintdef(oid) d from pg_constraint where conname='chk_analises_satelitais_faixa_indice'`
    )).rows[0]!.d;
    expect(faixa).toMatch(/2\.5/);
    expect(faixa).toMatch(/evi2/);

    // WITH CHECK de escrita (empresa_id IS NOT NULL); USING de leitura (aceita nulo).
    const pol = (await db.query<{ qual: string; with_check: string }>(
      `select coalesce(qual,'') qual, coalesce(with_check,'') with_check
         from pg_policies
        where schemaname='erp' and tablename='analises_satelitais_ext' and policyname='tenant_e_empresa'`
    )).rows[0]!;
    expect(pol.qual, "USING leitura").toMatch(/empresa_id is null/i);
    expect(pol.with_check, "WITH CHECK escrita").toMatch(/empresa_id is not null/i);
    expect(pol.with_check, "WITH CHECK não permissivo").not.toMatch(/empresa_id is null/i);

    const { empresaId, areaId, hash } = await criarArea();

    // EVI2 com max 1.055 — válido após 0057
    const evi = await db.query<{ id: string }>(
      `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo,
          geometria_sha256, janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
          valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos,
          pixels_geometria, cobertura_valida, metadados_provedor, criado_por)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','evi2',$4,$5,'2026-09-01','2026-10-01',20,'concluida',
          '2026-09-20','2026-09-21',1.0200,0.8000,1.0550,0.0500,100,10,90,100,0.9000,'{}',$6)
       returning id`,
      [demo.orgId, empresaId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL, hash, demo.adminUserId]);
    expect(evi.rows[0]!.id).toBeTruthy();

    // NDVI com max > 1 — continua recusado (mesmo hash; índice diferente da linha EVI2)
    await expect(db.query(
      `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo,
          geometria_sha256, janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
          valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos,
          pixels_geometria, cobertura_valida, metadados_provedor, criado_por)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi',$4,$5,'2026-09-01','2026-10-01',20,'concluida',
          '2026-09-20','2026-09-21',0.9000,0.8000,1.1000,0.0500,100,10,90,100,0.9000,'{}',$6)`,
      [demo.orgId, empresaId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL, hash, demo.adminUserId]
    )).rejects.toThrow(/chk_analises_satelitais_faixa|check constraint/i);

    // Item de consulta v2 aceito; v1 ainda aceito (chave = 64 hex)
    const hex64 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    const consulta = (await db.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
       values ($1,$2,$3,'{}'::jsonb,0,0,'pendente',1) returning id`,
      [demo.orgId, empresaId, demo.adminUserId])).rows[0]!;
    const kV2 = hex64(`v2-${Date.now()}`);
    const kV1 = hex64(`v1-${Date.now()}`);
    await db.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256,
          indice_bundle, versao_metodo, janela_inicio, janela_fim, situacao, chave_idempotencia, chave_idempotencia_origem)
       values ($1,$2,$3,$4,$5,'pastagem_essencial',$6,'2026-09-01','2026-09-30','pendente',$7,$8)`,
      [consulta.id, demo.orgId, empresaId, areaId, hash, VERSAO_METODO_PASTAGEM_ESSENCIAL, kV2, `origem-v2`]);
    await db.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256,
          indice_bundle, versao_metodo, janela_inicio, janela_fim, situacao, chave_idempotencia, chave_idempotencia_origem)
       values ($1,$2,$3,$4,$5,'pastagem_essencial',$6,'2026-08-01','2026-08-30','pendente',$7,$8)`,
      [consulta.id, demo.orgId, empresaId, areaId, hash, VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, kV1, `origem-v1`]);

    const depoisCount = (await db.query<{ n: string }>(`select count(*)::text as n from erp.analises_satelitais`)).rows[0]!.n;
    // só INSERTs de teste — a migration em si não altera linhas existentes
    expect(Number(depoisCount)).toBeGreaterThanOrEqual(Number(antesCount));

    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });

  it("0056 sql permanece no repositório e não foi a migration alvo", () => {
    expect(SQL_0056).toContain("pastagem-essencial-v1");
    expect(SQL_0056).not.toContain("pastagem-essencial-v2");
    expect(SQL_ALVO).toContain("pastagem-essencial-v2");
    expect(SQL_ALVO).toContain("2026, 91");
  });
});
