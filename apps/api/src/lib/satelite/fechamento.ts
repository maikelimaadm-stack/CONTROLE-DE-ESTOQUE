/**
 * FECHAMENTO DA CONSULTA SATELITAL (SAT-03, decisão 296) — contadores e situação de `erp.satelite_consultas` DERIVADOS
 * dos itens. Ninguém soma +1 num contador: cada escrita que muda item (o executor, o "reprocessar falhas") trava a
 * consulta, grava o item e RECONTA. Assim duas réplicas fechando itens da mesma consulta nunca perdem uma soma.
 *
 *   `travarConsulta`     select … for update da consulta, no escopo (a RLS e o predicado de empresa). Fora → null.
 *   `recalcularConsulta` contadores a partir dos itens; sem pendente nem executando → 'concluida' (nenhum falho) ou
 *                        'concluida_com_falhas', com `concluida_em`; com pendente/executando → 'executando' se algum
 *                        item já começou (foi reservado alguma vez, ou terminou), senão 'pendente', `concluida_em` nulo.
 *                        'cancelada' não volta: o recálculo só acerta os contadores dela.
 *
 * ORDEM: `recalcularConsulta` SEMPRE depois de `travarConsulta`, na mesma transação. Em READ COMMITTED a contagem enxerga
 * o que estava confirmado quando o comando começou: travar ANTES faz a outra réplica terminar primeiro, e a contagem
 * enxerga o item que ela acabou de fechar. Quem trava a consulta antes de mexer no item também nunca cruza trava com
 * outra escrita (a ordem é sempre consulta → item).
 *
 * Sob a RLS de quem chama, e com o predicado de empresa (`empresaScopeSql`) em CADA ocorrência de tabela. ROW COUNT
 * conferido: a consulta travada e não alcançada pelo recálculo é defeito, nunca sucesso sem efeito.
 */
import { empresaScopeSql, scopedById, type ServiceCtx } from "../context.js";

export async function travarConsulta(ctx: ServiceCtx, consultaId: string): Promise<{ id: string; situacao: string } | null> {
  const sc = scopedById(ctx, "s", consultaId);
  const r = await ctx.tx.query<{ id: string; situacao: string }>(
    `select s.id, s.situacao from erp.satelite_consultas s where s.id = $1 and s.organization_id = $2${sc.sql} for update of s`, sc.params);
  return r.rows[0] ?? null;
}

export async function recalcularConsulta(ctx: ServiceCtx, consultaId: string): Promise<void> {
  const params: unknown[] = [consultaId, ctx.orgId];
  const escopoItens = empresaScopeSql(ctx, "i", params);
  const escopoConsulta = empresaScopeSql(ctx, "s", params);
  const r = await ctx.tx.query(
    `with contagem as (
       select count(*) filter (where i.situacao = 'concluido')::int as concluidos,
              count(*) filter (where i.situacao = 'falho')::int as falhos,
              count(*) filter (where i.situacao = 'reaproveitado')::int as reaproveitados,
              count(*) filter (where i.situacao in ('pendente', 'executando'))::int as abertos,
              count(*) filter (where i.tentativas > 0 or i.situacao in ('executando', 'concluido', 'falho'))::int as comecados
         from erp.satelite_consulta_itens i
        where i.consulta_id = $1 and i.organization_id = $2${escopoItens}
     )
     update erp.satelite_consultas s
        set total_concluidos = c.concluidos, total_falhos = c.falhos, total_reaproveitados = c.reaproveitados,
            situacao = case
              when s.situacao = 'cancelada' then s.situacao
              when c.abertos = 0 then case when c.falhos > 0 then 'concluida_com_falhas' else 'concluida' end
              when c.comecados > 0 then 'executando'
              else 'pendente' end,
            concluida_em = case
              when s.situacao = 'cancelada' then s.concluida_em
              when c.abertos = 0 then coalesce(s.concluida_em, now())
              else null end
       from contagem c
      where s.id = $1 and s.organization_id = $2${escopoConsulta}`, params);
  if (r.rowCount !== 1) throw new Error("consulta satelital: o recálculo não alcançou exatamente a consulta");
}
