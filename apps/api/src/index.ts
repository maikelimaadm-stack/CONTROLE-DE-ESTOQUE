import { buildApp } from "./server.js";

/** Entrada da API (local, Docker e Vercel Fastify — `src/index.ts`). */
const app = await buildApp();
const { PORT, HOST } = app.config;
await app.listen({ port: PORT, host: HOST });
app.log.info(`API ouvindo em http://${HOST}:${PORT}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} recebido: encerrando com graça`);
    await app.close();
    process.exit(0);
  });
}
