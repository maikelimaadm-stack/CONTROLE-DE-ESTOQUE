/**
 * Pre-deploy (Railway): aplica migrations pendentes e, opcionalmente, o seed.
 * - MIGRATE_DATABASE_URL (papel com DDL/bypass RLS) ou DATABASE_URL.
 * - SEED_ON_DEPLOY=1 → dados de referência + organização inicial (ADMIN_EMAIL/ADMIN_PASSWORD/ORG_NAME).
 */
import { createPool, migrate, seedReference, seedDemo } from "@agro/db";
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) { console.error("DATABASE_URL não definida"); process.exit(1); }
const db = createPool(url, { max: 2 });
async function main() {
  const r = await migrate(db); console.log("migrations aplicadas:", JSON.stringify(r));
  if (process.env.SEED_ON_DEPLOY === "1") {
    await seedReference(db);
    const org = await seedDemo(db, { orgName: process.env.ORG_NAME, adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD, slug: process.env.ORG_SLUG });
    console.log("seed concluído: organização", org.orgId, "admin", org.adminEmail);
  }
}
main().then(async () => { await db.end(); }).catch(async (e) => { console.error(e); await db.end(); process.exit(1); });
