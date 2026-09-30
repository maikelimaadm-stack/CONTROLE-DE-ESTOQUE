import type { FastifyInstance } from "fastify";
import type { SalesKind } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";

/** Dependências que moram em `sales.ts` e chegam por parâmetro: sem import circular entre as rotas. */
export interface DependenciasDaEdicao {
  getDoc: (ctx: ServiceCtx, id: string, expectedKind: SalesKind, opts?: { lock?: boolean }) => Promise<Record<string, unknown>>;
}

/** EDITAR-01 (decisão 272) — `GET <base>/:id/edicao`. ESQUELETO do coordenador: o dono (A2) implementa. */
export function registrarEdicaoDeVenda(app: FastifyInstance, kind: SalesKind, base: string, perm: string, deps: DependenciasDaEdicao): void {
  void app; void kind; void base; void perm; void deps;
}
