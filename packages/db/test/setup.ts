import { createPool, type Db } from "../src/pool.js";
import { migrate, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/agro_erp_test";

export async function freshDb(): Promise<{ db: Db; demo: DemoOrg }> {
  const db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await migrate(db, () => {});
  await seedReference(db, () => {});
  const demo = await seedDemo(db, {}, () => {});
  return { db, demo };
}
