import { z } from "zod";
import { CHAVES_MODULO_EMPRESA, moduloEmpresaValido } from "@agro/domain";
import { DomainError } from "@agro/shared";
import type { ServiceCtx } from "./context.js";

/**
 * ACESSO POR EMPRESA — borda de administração (docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * O contrato canônico é uma linha POR MÓDULO: o modo (`todas` | `selecionadas`) e, no modo `selecionadas`, as
 * empresas escolhidas. Módulo ausente = SEM empresa nenhuma (fail-closed) — nunca "todas".
 *
 * `erp.member_farms` não é mais autoridade de runtime; o formato legado `farm_ids` continua sendo aceito na
 * API e é TRADUZIDO aqui para o modelo canônico, com a mesma semântica que o sistema tinha antes:
 * lista vazia = todas as empresas, lista preenchida = exatamente aquelas — valendo para todos os módulos.
 */
export const escopoEmpresaSchema = z.object({
  modulo: z.string().min(1),
  modo: z.enum(["todas", "selecionadas"]),
  empresas: z.array(z.string().uuid()).default([])
});
export type EscopoEmpresaEntrada = z.infer<typeof escopoEmpresaSchema>;

/** Tradução do formato legado: vazio = todas; preenchido = aquelas empresas — em TODOS os módulos. */
export function deFarmIdsLegado(farmIds: readonly string[]): EscopoEmpresaEntrada[] {
  const modo = farmIds.length ? "selecionadas" as const : "todas" as const;
  return CHAVES_MODULO_EMPRESA.map((modulo) => ({ modulo, modo, empresas: modo === "selecionadas" ? [...farmIds] : [] }));
}

/**
 * Representação legada de uma configuração canônica — ou `null` quando ela NÃO cabe no formato antigo
 * (modos diferentes por módulo, ou conjuntos diferentes). A API prefere devolver `null` a devolver uma lista
 * que mentiria sobre o acesso real.
 */
export function paraFarmIdsLegado(escopos: readonly EscopoEmpresaEntrada[]): string[] | null {
  if (escopos.length !== CHAVES_MODULO_EMPRESA.length) return null;
  const modos = new Set(escopos.map((e) => e.modo));
  if (modos.size !== 1) return null;
  if (escopos[0]!.modo === "todas") return [];
  const chaves = escopos.map((e) => [...e.empresas].sort().join(","));
  return new Set(chaves).size === 1 ? [...escopos[0]!.empresas].sort() : null;
}

/** Valida a entrada canônica: módulo existente, sem repetição e sem "selecionadas" com empresa de outra organização. */
export function validarEscopos(escopos: readonly EscopoEmpresaEntrada[]): void {
  const vistos = new Set<string>();
  for (const e of escopos) {
    if (!moduloEmpresaValido(e.modulo)) throw new DomainError("VALIDATION_ERROR", `Módulo inválido: ${e.modulo}`);
    if (vistos.has(e.modulo)) throw new DomainError("VALIDATION_ERROR", `Módulo repetido: ${e.modulo}`);
    vistos.add(e.modulo);
    if (e.modo === "todas" && e.empresas.length) throw new DomainError("VALIDATION_ERROR", `Modo "todas" não leva lista de empresas (${e.modulo})`);
  }
}

/** Configuração atual do membro, em forma canônica (apenas os módulos configurados). */
export async function lerEscopos(ctx: ServiceCtx, membroId: string): Promise<EscopoEmpresaEntrada[]> {
  const r = await ctx.tx.query<{ modulo: string; modo: "todas" | "selecionadas"; empresas: string[] | null }>(
    `select e.modulo, e.modo,
            (select array_agg(me.empresa_id) from erp.membro_empresas me
              where me.organization_id=e.organization_id and me.membro_id=e.membro_id and me.modulo=e.modulo) as empresas
       from erp.membro_escopos_empresa e
      where e.organization_id=$1 and e.membro_id=$2
      order by e.modulo`, [ctx.orgId, membroId]);
  return r.rows.map((x) => ({ modulo: x.modulo, modo: x.modo, empresas: x.empresas ?? [] }));
}

/**
 * Substitui a configuração do membro. Só toca nos módulos informados quando `substituirTudo` é falso; o
 * padrão é substituição total (é o que a tela de administração envia). A integridade — empresa da mesma
 * organização, módulo canônico, empresa só no modo `selecionadas` — é garantida pelo BANCO, não por esta
 * função: qualquer violação aqui vira erro de constraint, nunca uma permissão a mais.
 */
export async function gravarEscopos(ctx: ServiceCtx, membroId: string, escopos: readonly EscopoEmpresaEntrada[], opts: { substituirTudo?: boolean } = {}): Promise<void> {
  validarEscopos(escopos);
  const modulos = escopos.map((e) => e.modulo);
  if (opts.substituirTudo === false) {
    await ctx.tx.query("delete from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2 and modulo = any($3::text[])", [ctx.orgId, membroId, modulos]);
  } else {
    await ctx.tx.query("delete from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2", [ctx.orgId, membroId]);
  }
  for (const e of escopos) {
    await ctx.tx.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [ctx.orgId, membroId, e.modulo, e.modo]);
    if (e.modo !== "selecionadas" || !e.empresas.length) continue;
    await ctx.tx.query(
      "insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) select $1,$2,$3,'selecionadas',x from unnest($4::uuid[]) x",
      [ctx.orgId, membroId, e.modulo, [...new Set(e.empresas)]]);
  }
}
