import type { Tx } from "@agro/db";
import { AUTORIZACAO_PROPRIETARIO, autorizacaoPorModulo } from "@erp/plataforma";
import type { Membership } from "./context.js";

/**
 * VÍNCULO DO MEMBRO COM A ORGANIZAÇÃO — a leitura que monta `Membership` e as permissões de um usuário.
 *
 * Um dono só para duas portas: o plugin de autenticação (`plugins/auth.ts`, a cada requisição, com cache de 30 s lá) e
 * o executor da fila satelital (`lib/satelite/contexto-worker.ts`, SAT-03), que age em nome de QUEM CRIOU a consulta.
 * As duas leem o mesmo vínculo, os mesmos modos de escopo e as mesmas permissões — sem segunda fonte de verdade.
 *
 * Roda na transação de quem chama (GUC de organização e usuário já postas: a RLS dessas tabelas vale aqui). Vínculo
 * inativo, organização excluída ou usuário fora dela: `null` — quem chama decide a recusa (o plugin responde 403; o
 * executor fica sem contexto e não toca o item).
 */
export type LinhaMembro = { organization_id: string; org_name: string; role_id: string | null; is_owner: boolean; member_id: string };
export type EscopoMembro = { modulo: string; modo: string };
export interface DadosDoMembro { row: LinhaMembro; escopos: EscopoMembro[]; perms: string[] }

export async function lerDadosDoMembro(tx: Tx, orgId: string, userId: string): Promise<DadosDoMembro | null> {
  const m = await tx.query<LinhaMembro>(
    "select m.id as member_id, m.organization_id, o.name as org_name, m.role_id, m.is_owner from erp.organization_members m join erp.organizations o on o.id=m.organization_id where m.user_id=$1 and m.organization_id=$2 and m.is_active and o.deleted_at is null",
    [userId, orgId]);
  const row = m.rows[0];
  if (!row) return null;
  // Só os MODOS por módulo — nunca a lista de empresas (podem ser centenas; o conjunto é resolvido no SQL).
  // `erp.member_farms` não é mais consultada aqui: a autoridade é o escopo por módulo (PRE-BASE2-02).
  const escopos = row.is_owner ? [] : (await tx.query<EscopoMembro>(
    "select modulo, modo from erp.membro_escopos_empresa where organization_id=$1 and membro_id=$2", [orgId, row.member_id])).rows;
  const perms = row.is_owner ? [] : (await tx.query<{ permission_key: string }>("select permission_key from erp.role_permissions where role_id=$1", [row.role_id])).rows.map((r) => r.permission_key);
  return { row, escopos, perms };
}

/** O `Membership` do vínculo lido: proprietário enxerga todos os módulos; os demais, o modo de cada módulo. */
export function vinculoDoMembro({ row, escopos }: DadosDoMembro): Membership {
  return {
    orgId: row.organization_id, orgName: row.org_name, roleId: row.role_id, isOwner: row.is_owner,
    memberId: row.member_id,
    escopos: row.is_owner ? AUTORIZACAO_PROPRIETARIO : autorizacaoPorModulo(escopos.map((e) => [e.modulo, e.modo === "todas" ? "todas" : "selecionadas"] as const))
  };
}
