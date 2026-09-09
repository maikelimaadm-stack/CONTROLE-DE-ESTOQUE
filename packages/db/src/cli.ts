import { createPool } from "./pool.js";
import { migrate, resetSchema } from "./migrate.js";
import { seedReference, seedDemo } from "./seed.js";

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL não definida"); process.exit(1); }
const db = createPool(url, { max: 2 });
try {
  if (cmd === "migrate") { const done = await migrate(db); console.log(done.length ? `${done.length} migration(s) aplicada(s)` : "nada a aplicar"); }
  else if (cmd === "seed") { await migrate(db); await seedReference(db); const d = await seedDemo(db); console.log(JSON.stringify({ orgId: d.orgId, adminEmail: d.adminEmail }, null, 2)); }
  else if (cmd === "reset") { if (process.env.ALLOW_DB_RESET !== "1") throw new Error("reset requer ALLOW_DB_RESET=1"); await resetSchema(db); await migrate(db); console.log("schema recriado"); }
  else { console.error("uso: cli <migrate|seed|reset>"); process.exit(1); }
} finally { await db.end(); }
