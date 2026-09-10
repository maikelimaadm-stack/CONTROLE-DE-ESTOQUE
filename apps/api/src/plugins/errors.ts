import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "@agro/shared";
import { fromPgError } from "../lib/errors.js";

export default fp(async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError) {
      if (error.code !== "NOT_FOUND" && error.code !== "VALIDATION_ERROR") req.log.warn({ code: error.code, details: error.details }, error.message);
      return reply.status(error.httpStatus).send({ error: error.toJSON() });
    }
    if (error instanceof ZodError) {
      return reply.status(422).send({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos", details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
    }
    const pg = fromPgError(error);
    if (pg) return reply.status(pg.httpStatus).send({ error: pg.toJSON() });
    const fe = error as { statusCode?: number; message?: string; validation?: unknown };
    if (fe.statusCode === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Muitas requisições" } });
    if (fe.statusCode && fe.statusCode < 500) return reply.status(fe.statusCode).send({ error: { code: "VALIDATION_ERROR", message: fe.message, details: fe.validation } });
    req.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } }));
});
