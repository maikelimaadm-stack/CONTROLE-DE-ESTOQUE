/**
 * Pre-deploy (Railway): aplica migrations pendentes e, opcionalmente, UMA semeadura.
 * - MIGRATE_DATABASE_URL (papel com DDL/bypass RLS) ou DATABASE_URL.
 * - SEED_ON_DEPLOY=1 → dados de referência + organização DEMO (ADMIN_EMAIL/ADMIN_PASSWORD/ORG_NAME/ORG_SLUG),
 *   blindada: recusa escrever em organização que não seja demo.
 * - ORGANIZACAO_LIMPA_ON_DEPLOY=1 → organização limpa para uso real (GO-LIVE-01; `docs/DEPLOYMENT.md` § Go-live).
 * As duas juntas: recusado.
 */
import { createPool, migrate, seedPermissions, semearNoDeploy, resolverSeedDoDeploy } from "@agro/db";
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) { console.error("DATABASE_URL não definida"); process.exit(1); }
const db = createPool(url, { max: 2 });
async function main() {
  // As flags são conferidas ANTES das migrations: combinação proibida não pode nem começar o deploy.
  resolverSeedDoDeploy(process.env);
  const r = await migrate(db); console.log("migrations aplicadas:", JSON.stringify(r));
  // catálogo de permissões acompanha o código: novas chaves entram a cada deploy (idempotente)
  await seedPermissions(db);
  await semearNoDeploy(db, process.env);
}
// Só a mensagem: o objeto de erro do driver pode carregar parâmetros da consulta.
main().then(async () => { await db.end(); }).catch(async (e) => { console.error(e instanceof Error ? e.message : "falha no pre-deploy"); await db.end(); process.exit(1); });
