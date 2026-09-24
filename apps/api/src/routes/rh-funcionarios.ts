import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource } from "@agro/domain";
import { runService } from "../lib/service.js";
import { funcionarioPorCpf } from "../lib/funcionario.js";
import { createOne } from "./resources.js";

/**
 * RH › NOVO FUNCIONÁRIO PELO CPF (CADASTROS Fase 5). Capacidade: `employees.create`. O parceiro novo nasce pela
 * MESMA porta do cadastro de parceiros (`createOne` de `people`: CPF validado, único, código e ID Global) e a
 * ficha de RH na mesma transação. Corpo estrito: chave desconhecida → 422.
 */
const corpo = z.object({ document: z.string().min(1).max(30), name: z.string().max(200).nullable().optional() }).strict();

export default async function rhFuncionariosRoutes(app: FastifyInstance) {
  app.post("/hr/funcionarios/por-cpf", async (req, reply) => {
    const r = await runService(app, req, "employees.create", (ctx) => funcionarioPorCpf(ctx, corpo.parse(req.body), (dados) => createOne(ctx, getResource("people")!, dados) as Promise<{ id: string }>));
    return reply.status(r.criado ? 201 : 200).send(r);
  });
}
