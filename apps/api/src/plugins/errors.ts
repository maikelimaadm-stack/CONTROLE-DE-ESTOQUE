import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { ZodError, type ZodIssue } from "zod";
import { DomainError } from "@agro/shared";
import { fromPgError } from "../lib/errors.js";

/** Mensagens de validação em português (as do zod são em inglês: "Invalid input: expected string, received null"). */
function translateIssue(i: ZodIssue): string {
  const anyI = i as ZodIssue & { received?: unknown; expected?: unknown; maximum?: number; minimum?: number; validation?: string; format?: string; origin?: string };
  switch (i.code) {
    case "invalid_type": return anyI.received === "null" || anyI.received === "undefined" || anyI.received === null || anyI.received === undefined || /received (null|undefined)/.test(i.message) ? "Campo obrigatório" : "Valor inválido";
    case "too_big": return anyI.origin === "string" || anyI.expected === "string" || /character/.test(i.message) ? `Máximo de ${anyI.maximum} caracteres` : `Valor máximo: ${anyI.maximum}`;
    case "too_small": return anyI.origin === "string" || /character/.test(i.message) ? (anyI.minimum === 1 ? "Campo obrigatório" : `Mínimo de ${anyI.minimum} caracteres`) : `Valor mínimo: ${anyI.minimum}`;
    case "invalid_format": return anyI.format === "email" || anyI.validation === "email" ? "E-mail inválido" : anyI.format === "uuid" || anyI.validation === "uuid" ? "Selecione um valor válido" : "Formato inválido";
    case "invalid_value": return "Opção inválida";
    case "unrecognized_keys": return "Campo não reconhecido";
    default: return /^Invalid input/.test(i.message) ? "Valor inválido" : i.message;
  }
}

export default fp(async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError) {
      if (error.code !== "NOT_FOUND" && error.code !== "VALIDATION_ERROR") req.log.warn({ code: error.code, details: error.details }, error.message);
      return reply.status(error.httpStatus).send({ error: error.toJSON() });
    }
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => ({ path: i.path.join("."), message: translateIssue(i) }));
      const missing = details.filter((d) => d.message === "Campo obrigatório").map((d) => d.path);
      const message = missing.length ? `Campos obrigatórios pendentes: ${missing.join(", ")}` : details.length === 1 && details[0]!.path ? `${details[0]!.path}: ${details[0]!.message}` : "Dados inválidos";
      return reply.status(422).send({ error: { code: "VALIDATION_ERROR", message, details } });
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
