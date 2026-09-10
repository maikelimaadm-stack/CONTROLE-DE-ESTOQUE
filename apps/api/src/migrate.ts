/** Aplica as migrations pendentes (usado como pre-deploy no Railway: `node dist/migrate.js`). */
import { createPool, migrate } from "@agro/db";
const url = process.env.DATABASE_URL; if (!url) { console.error("DATABASE_URL não definida"); process.exit(1); }
const db = createPool(url, { max: 2 });
migrate(db).then(async (r) => { console.log("migrations aplicadas:", JSON.stringify(r)); await db.end(); }).catch(async (e) => { console.error(e); await db.end(); process.exit(1); });
