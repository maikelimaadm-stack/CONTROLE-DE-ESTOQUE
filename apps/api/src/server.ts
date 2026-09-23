import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createPool, type Db } from "@agro/db";
import { loadConfig, type Config } from "./config.js";
import { recusarCorpoLegado, recusarQueryLegada } from "./lib/contrato-legado.js";
import authPlugin from "./plugins/auth.js";
import errorsPlugin from "./plugins/errors.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import resourceRoutes from "./routes/resources.js";
import importRoutes from "./routes/imports.js";
import preferenceRoutes from "./routes/preferences.js";
import savedReportRoutes from "./routes/saved-reports.js";
import adminRoutes from "./routes/admin.js";
import tiposOperacaoRoutes from "./routes/tipos-operacao.js";
import attachmentRoutes from "./routes/attachments.js";
import stockRoutes from "./routes/stock.js";
import supplyRoutes from "./routes/supply.js";
import financialRoutes from "./routes/financial.js";
import salesRoutes from "./routes/sales.js";
import fleetHrRoutes from "./routes/fleet-hr.js";
import livestockRoutes from "./routes/livestock.js";
import reportRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboards.js";
import plataformaRoutes from "./routes/plataforma.js";
import { politicaDeOrigem } from "./lib/cors-origem.js";

/**
 * `criarPool` existe para que a ORDEM de "falha cedo" seja provável por EFEITO, e não por leitura do
 * arquivo. A primeira versão do teste conferia a posição de um substring em `server.ts`; ela passava
 * quando a chamada real migrava para depois do pool (bastava sobrar um comentário citando o nome) e
 * reprovava quando alguém extraía as opções do Fastify para uma variável. Uma catraca que aceita o
 * culpado e acusa o inocente não guarda nada. Com a costura, o teste conta quantos pools nasceram
 * antes da recusa, e a resposta certa é ZERO.
 */
export async function buildApp(opts: { config?: Config; db?: Db; logger?: boolean; criarPool?: (dsn: string) => Db } = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  // PRIMEIRA COISA, antes de existir servidor e antes de existir pool: a política de origem é montada
  // a partir do valor BRUTO da configuração e VALIDA o sufixo de preview ali dentro. Sufixo genérico
  // ou malformado lança aqui, e o processo morre sem nunca ter atendido requisição. `loadConfig` já
  // recusa o mesmo valor; esta linha fecha o caminho de quem monta um `Config` à mão (os testes).
  const politicaDeCors = politicaDeOrigem(config.WEB_ORIGIN.split(","), config.WEB_ORIGIN_PREVIEW_SUFFIX);
  const app = Fastify({ logger: opts.logger === false ? false : { level: config.API_LOG_LEVEL }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  const db = opts.db ?? (opts.criarPool ?? createPool)(config.DATABASE_URL);
  app.decorate("db", db);
  app.decorate("config", config);
  await app.register(helmet, { contentSecurityPolicy: false });
  // Origem exata (produção) OU preview ancorado na conta do projeto. A decisão mora em `cors-origem.ts`,
  // com o porquê de não existir curinga de provedor aqui: `credentials` está ligado.
  await app.register(cors, { origin: politicaDeCors, credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "X-Org-Id", "X-Empresa-Id", "Idempotency-Key"] });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: "1 minute" });
  await app.register(errorsPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(resourceRoutes, { prefix: "/api" });
  await app.register(importRoutes, { prefix: "/api" });
  await app.register(preferenceRoutes, { prefix: "/api" });
  await app.register(savedReportRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(tiposOperacaoRoutes, { prefix: "/api" });
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(stockRoutes, { prefix: "/api" });
  await app.register(supplyRoutes, { prefix: "/api" });
  await app.register(financialRoutes, { prefix: "/api" });
  await app.register(salesRoutes, { prefix: "/api" });
  await app.register(fleetHrRoutes, { prefix: "/api" });
  await app.register(livestockRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(dashboardRoutes, { prefix: "/api" });
  await app.register(plataformaRoutes, { prefix: "/api" });
  // ------------------------------------------------------------------------------------------------
  // CONTRATO NEGATIVO DO NOME ANTIGO DE EMPRESA (PRE-BASE2-05B).
  // A borda de COMPATIBILIDADE acabou: não há mais tradução de entrada nem apelido de saída. O que sobra é
  // uma lápide que RECUSA o contrato anterior — porque schema `z.object` descarta chave desconhecida, e um
  // `farm_id` descartado em silêncio mudaria a empresa da operação sem ninguém ver. Ver `lib/contrato-legado.ts`.
  // ------------------------------------------------------------------------------------------------
  app.addHook("preValidation", async (req) => {
    recusarCorpoLegado(req.body);
    recusarQueryLegada(req.query);
  });
  app.addHook("onClose", async () => { if (!opts.db) await db.end(); });
  return app;
}
