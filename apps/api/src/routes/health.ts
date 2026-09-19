import type { FastifyInstance } from "fastify";
import { identidadeDeBuild } from "@erp/plataforma";

/**
 * `build` ao lado de `version`, e não no lugar dela: as duas respondem perguntas diferentes.
 * `version` é o `package.json` — constante entre commits, e por isso incapaz de dizer o que está no
 * ar. `build.sha` é o commit que o PROVEDOR injetou, que é o que um checkpoint pós-merge precisa
 * comparar com a ponta de `main`. A mesma função serve a API e o web (apps/web/src/app/api/build),
 * para que as duas superfícies respondam no mesmo formato — comparar respostas de formatos
 * diferentes é como não ter a prova.
 */
export default async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try { await app.db.query("select 1"); return { status: "ok", db: "ok", uptime: process.uptime(), version: process.env.npm_package_version ?? "0.1.0", build: identidadeDeBuild(process.env) }; }
    catch (e) { return reply.status(503).send({ status: "degraded", db: "error", message: (e as Error).message }); }
  });
  app.get("/health/live", async () => ({ status: "ok" }));
}
