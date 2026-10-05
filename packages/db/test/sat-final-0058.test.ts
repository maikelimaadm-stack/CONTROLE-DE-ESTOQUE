import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * 0058 — SATÉLITE COMPLETO: raster multi-índice (CHECK indice + storage_path).
 * Forward-only; acervo NDVI intacto; trava (2026,92).
 */
let db: Db;
const ALVO = "0058_satelite_raster_multi_indice.sql";
const ANTERIORES = listMigrations().filter((x) => x.name < ALVO);
const SQL_ALVO = listMigrations().find((x) => x.name === ALVO)!.sql;
const TRAVA = "SAT-FINAL: outra transacao ja detem a trava desta migration (2026,92). Nada foi aplicado.";
const JA = "SAT-FINAL: a 0058 ja foi aplicada";

beforeAll(async () => {
  db = await createPool(TEST_URL);
  await resetSchema(db);
  for (const m of ANTERIORES) await db.query(m.sql);
  await seedReference(db);
  await seedDemo(db);
}, 180_000);

afterAll(async () => { await db?.end(); });

async function defCheck(nome: string): Promise<string> {
  return (await db.query<{ d: string }>(
    "select pg_get_constraintdef(oid) d from pg_constraint where conname=$1", [nome]
  )).rows[0]!.d;
}

describe("SAT-FINAL — migration 0058 raster multi-índice", () => {
  it("trava (2026,92) ocupada recusa sem aplicar", async () => {
    await db.query("begin");
    try {
      await db.query("select pg_advisory_xact_lock(2026, 92)");
      const outro = await createPool(TEST_URL);
      try {
        await expect(outro.query(SQL_ALVO)).rejects.toThrow(TRAVA);
      } finally { await outro.end(); }
    } finally { await db.query("rollback"); }
  });

  it("amplia CHECK de índice e storage_path; reaplicar falha; NDVI continua aceito", async () => {
    const antes = await defCheck("chk_satelite_rasters_indice");
    expect(antes).toMatch(/ndvi/);
    expect(antes).not.toMatch(/evi2/);

    await db.query(SQL_ALVO);

    const depois = await defCheck("chk_satelite_rasters_indice");
    for (const i of ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"]) {
      expect(depois, i).toMatch(new RegExp(i));
    }
    const path = await defCheck("chk_satelite_raster_arquivos_storage_path");
    expect(path).toMatch(/msavi2/);
    expect(path).toMatch(/bsi/);

    await expect(db.query(SQL_ALVO)).rejects.toThrow(JA);
  });
});
