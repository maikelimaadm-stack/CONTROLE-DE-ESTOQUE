import type { FastifyInstance } from "fastify";
export default async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try { await app.db.query("select 1"); return { status: "ok", db: "ok", uptime: process.uptime(), version: process.env.npm_package_version ?? "0.1.0" }; }
    catch (e) { return reply.status(503).send({ status: "degraded", db: "error", message: (e as Error).message }); }
  });
  app.get("/health/live", async () => ({ status: "ok" }));
}
