/**
 * OPERACOES-01 F10 (decisão 287) — O QUE AS ROTAS DOS MÓDULOS COM PRODUTO CONFEREM IGUAL NO CORPO DO LANÇAMENTO.
 *
 * Abastecimento, manutenção e OS (`fleet-hr.ts`), manejo e batelada (`livestock.ts`) e a produção de ração (`stock.ts`)
 * citam o equipamento (o bem abastecido, a máquina da manutenção, o vagão da batelada) e mandam decimais que vão para a
 * conta do domínio (`centrais-dos-modulos`) e para o contador do bem. A recusa é UMA, com o mesmo texto, em todas as
 * rotas — esta peça é a dona dela (antes, cada rota tinha a sua cópia da mensagem e da consulta).
 */
import { D } from "@agro/shared";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

/** A recusa do equipamento (ou máquina, ou vagão) que o lançamento cita e não pode citar. */
export const MENSAGEM_EQUIPAMENTO_INVALIDO = "Equipamento inválido: escolha um equipamento da organização.";

/**
 * O EQUIPAMENTO QUE O LANÇAMENTO CITA: da organização, não excluído e visível pela RLS do módulo da porta (a empresa do
 * bem no escopo de quem lança). UMA consulta para todos os citados (a manutenção cita uma máquina por bloco; nunca
 * N+1). A FK de coluna única aceitava o UUID de outra organização, e agora o equipamento vai ao razão (FK composta).
 * Quem chama faz isto ANTES do número do registro: a recusa não queima código. Recusa: 422 `VALIDATION_ERROR` com um
 * detalhe por caminho recusado, na ordem em que foram citados; a mensagem é uma só — a MESMA para inexistente, de
 * outra organização, excluído e fora do escopo do módulo.
 */
export async function exigirEquipamentos(ctx: ServiceCtx, citados: readonly { caminho: string; id: string }[]): Promise<void> {
  if (!citados.length) return;
  const r = await ctx.tx.query<{ id: string }>(
    "select id from erp.equipments where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null",
    [[...new Set(citados.map((x) => x.id))], ctx.orgId]);
  const visiveis = new Set(r.rows.map((x) => x.id));
  const fora = citados.filter((x) => !visiveis.has(x.id));
  if (fora.length) throw validation(MENSAGEM_EQUIPAMENTO_INVALIDO, fora.map((x) => ({ path: x.caminho, message: MENSAGEM_EQUIPAMENTO_INVALIDO })));
}

/**
 * A FORMA CANÔNICA DO DECIMAL para as contas do domínio, que só leem dígitos: ".5" → "0.5", "1e3" → "1000", "+5" → "5"
 * — o mesmo número que o banco gravaria. O que não é número finito (texto que não é número, vazio, NaN e ±Infinity) é
 * recusado NO CAMPO com 422 "Valor inválido": a entrada não canônica nunca é traduzida em silêncio, e nunca chega ao
 * banco (onde "Infinity" estoura o numeric com 500 e NaN entra como valor).
 */
export function formaCanonica(valor: string, caminho: string): string {
  let x: ReturnType<typeof D>;
  try { x = D(valor); } catch { throw validation("Valor inválido", [{ path: caminho, message: "Valor inválido" }]); }
  if (!x.isFinite()) throw validation("Valor inválido", [{ path: caminho, message: "Valor inválido" }]);
  return x.toFixed();
}
