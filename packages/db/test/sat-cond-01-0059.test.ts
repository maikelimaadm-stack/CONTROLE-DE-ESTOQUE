import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * 0059 — SAT-COND-01: mapa categórico dedicado (sem FK para uma análise de índice).
 * Trava (2026,93). Não altera 0058. Forward-only.
 */
let db: Db;
let demo: DemoOrg;
const ALVO = "0059_satelite_mapa_condicao_pasto.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const TRAVA = "SAT-COND-01: outra transacao ja detem a trava desta migration (2026,93). Nada foi aplicado.";
const JA = "SAT-COND-01: a 0059 ja foi aplicada";
const IMUTAVEL = "O mapa de condição do pasto registrado";

beforeAll(async () => {
  db = await createPool(TEST_URL);
  await resetSchema(db);
  for (const m of ANTERIORES) await db.query(m.sql);
  await seedReference(db);
  demo = await seedDemo(db);
}, 180_000);

afterAll(async () => { await db?.end(); });

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pngDeTeste = (n = 64) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(n)]);

describe("SAT-COND-01 — migration 0059 mapa de condição", () => {
  it("trava (2026,93) ocupada recusa sem aplicar", async () => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(2026, 93)");
      const outro = await createPool(TEST_URL);
      try {
        await expect(outro.query(SQL_ALVO)).rejects.toThrow(TRAVA);
      } finally { await outro.end(); }
    } finally { await db.query("rollback"); }
  });

  it("cria tabelas dedicadas, RLS, imutabilidade; reaplicar falha; 0058 intacta", async () => {
    const indice = (await db.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conname='chk_satelite_rasters_indice'"
    )).rows[0]!.d;
    expect(indice).toMatch(/evi2/);
    expect(indice).not.toMatch(/condicao_pasto/);

    await db.query(SQL_ALVO);

    expect((await db.query("select to_regclass('erp.satelite_mapas_condicao') is not null as ok")).rows[0]!.ok).toBe(true);
    expect((await db.query("select to_regclass('erp.satelite_mapas_condicao_arquivos') is not null as ok")).rows[0]!.ok).toBe(true);

    const depois = (await db.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conname='chk_satelite_rasters_indice'"
    )).rows[0]!.d;
    expect(depois).toBe(indice);

    const rls = await db.query<{ n: string }>(
      `select c.relname as n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
        where ns.nspname='erp' and c.relname in ('satelite_mapas_condicao','satelite_mapas_condicao_arquivos')
          and c.relrowsecurity and c.relforcerowsecurity`
    );
    expect(rls.rowCount).toBe(2);

    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });

  it("não aponta para analise_id; identidade e imutabilidade", async () => {
    const cols = (await db.query<{ attname: string }>(
      `select a.attname from pg_attribute a
        where a.attrelid='erp.satelite_mapas_condicao'::regclass and a.attnum>0 and not a.attisdropped`
    )).rows.map((r) => r.attname);
    expect(cols).not.toContain("analise_id");
    expect(cols).toContain("versao_classificador");
    expect(cols).toContain("resumo");

    const empresa = (await db.query<{ id: string }>(
      "select id from erp.empresas where organization_id=$1 limit 1", [demo.orgId]
    )).rows[0]!;
    const poligono = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
    const area = (await db.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'COND01','[TEST] condicao',10,10,'pastagem','ativa','propria',$3::jsonb) returning id`,
      [demo.orgId, empresa.id, JSON.stringify(poligono)]
    )).rows[0]!;
    const hash = (await db.query<{ h: string }>(
      "select encode(sha256(convert_to(geometria::text,'UTF8')),'hex') h from erp.areas where id=$1", [area.id]
    )).rows[0]!.h;
    const chave = sha(Buffer.from(randomUUID()));
    const png = pngDeTeste();
    const shaArq = sha(png);
    const path = `${demo.orgId}/${area.id}/condicao_pasto/2026-10-05/${chave}.png`;

    await db.query(
      `insert into erp.satelite_mapas_condicao_arquivos
         (organization_id, empresa_id, storage_path, conteudo, sha256_arquivo, tamanho_bytes)
       values ($1,$2,$3,$4,$5,$6)`,
      [demo.orgId, empresa.id, path, png, shaArq, png.length]
    );
    const mapa = await db.query<{ id: string }>(
      `insert into erp.satelite_mapas_condicao (
          organization_id, empresa_id, area_id, geometria_sha256, mapa, tipo, versao_classificador, versao_evalscript,
          data_imagem, observacao_inicio, observacao_fim, storage_path, sha256_arquivo, largura, altura,
          bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat, resolucao_m, chave_cache, area_total_ha, resumo, criado_por)
       values ($1,$2,$3,$4,'condicao_pasto','classificacao','condicao-pasto-v1','condicao-pasto-v1',
          '2026-10-05','2026-10-05T13:00:00Z','2026-10-05T13:10:00Z',$5,$6,32,32,
          0,0,1,1,$7::jsonb,20,$8,10,'{"versao_classificador":"condicao-pasto-v1"}'::jsonb,$9)
       returning id`,
      [demo.orgId, empresa.id, area.id, hash, path, shaArq, JSON.stringify([[-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]), chave, demo.adminUserId]
    );
    expect(mapa.rowCount).toBe(1);

    await expect(db.query("update erp.satelite_mapas_condicao set area_total_ha=1 where id=$1", [mapa.rows[0]!.id]))
      .rejects.toThrow(IMUTAVEL);
    await expect(db.query("delete from erp.satelite_mapas_condicao where id=$1", [mapa.rows[0]!.id]))
      .rejects.toThrow(IMUTAVEL);
  });
});
