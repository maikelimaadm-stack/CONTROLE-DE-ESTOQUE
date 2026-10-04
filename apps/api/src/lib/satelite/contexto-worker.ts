/**
 * CONTEXTO DO EXECUTOR DA FILA SATELITAL (SAT-03, decisão 296) — o executor age em nome de QUEM CRIOU a consulta.
 *
 * Não existe "usuário do sistema" com escopo próprio: o item é lido e gravado com o MESMO vínculo, os MESMOS modos de
 * escopo e as MESMAS permissões que o criador teria numa requisição — lidos por `lib/contexto-membro.ts`, a leitura que
 * o plugin de autenticação também usa. A transação de quem chama já tem a GUC do criador (organização, usuário e o
 * módulo da permissão): a RLS recorta pelo criador, e o `ServiceCtx` montado aqui faz o predicado de empresa
 * (`empresaScopeSql`) recortar pelo mesmo módulo.
 *
 * O módulo é o da permissão de PEDIR a análise (`analises_satelitais.create` → pecuária, o da área), derivado por
 * `moduloDaPermissao` — nunca escrito à mão.
 *
 * Vínculo inativo, organização excluída ou usuário fora dela: SEM contexto (`null`). Quem chama não toca o item: sob a
 * RLS do criador ele nem é visível. A reserva da 0054 já não reserva item de criador sem acesso; o que sobra é a
 * corrida (o acesso caiu depois da reserva): o item fica 'executando' até o prazo, volta para 'pendente' e não é
 * reservado de novo enquanto o criador não tiver acesso.
 */
import type { Tx } from "@agro/db";
import { moduloDaPermissao } from "@agro/domain";
import type { ServiceCtx } from "../context.js";
import { lerDadosDoMembro, vinculoDoMembro } from "../contexto-membro.js";

/** A permissão que o executor confere no criador, e de onde sai o módulo da transação. */
export const PERMISSAO_EXECUTAR_ITEM = "analises_satelitais.create";
export const MODULO_EXECUTOR = moduloDaPermissao(PERMISSAO_EXECUTAR_ITEM);

export async function contextoDoCriador(tx: Tx, orgId: string, criadoPor: string): Promise<ServiceCtx | null> {
  const u = await tx.query<{ id: string; email: string; name: string }>("select id, email, name from erp.users where id = $1", [criadoPor]);
  const user = u.rows[0];
  if (!user) return null;
  const dados = await lerDadosDoMembro(tx, orgId, criadoPor);
  if (!dados) return null;
  return {
    user, orgId, empresaId: null, membership: vinculoDoMembro(dados), permissions: new Set(dados.perms),
    moduloEmpresa: MODULO_EXECUTOR, tx
  };
}
