import type { DecimalString } from "@agro/shared";
import { uaDoRebanho } from "@agro/domain";
import { consultaEscopada, type ServiceCtx } from "./context.js";

/** Cabeças e UA de um lote AGORA (MAPA-MANEJO-01, decisão 305). */
export interface RebanhoDoLote { cabecas: number; ua: DecimalString }

/**
 * Cabeças e UA de VÁRIOS lotes em UMA consulta (nunca uma por lote).
 *
 * Cabeças = animais ativos e vivos do lote + soma de `erp.herd_lots.quantity` do lote.
 * UA: o PESO medido manda — UA é definida por 450 kg (`animalUnits`, packages/domain/src/livestock.ts); sem peso,
 * vale o `ua_factor` da categoria (estimativa). A soma é linear, então o SQL agrega o peso total dos pesados e a
 * soma dos fatores dos não pesados, e o domínio fecha (`uaDoRebanho`). Cada tabela responde pelo PRÓPRIO escopo
 * de empresa, no módulo da rota.
 *
 * Lote sem animal nem rebanho por contagem volta com 0 cabeças e UA "0.00" (está no mapa como presente).
 */
export async function rebanhoDosLotes(ctx: ServiceCtx, loteIds: readonly string[]): Promise<Map<string, RebanhoDoLote>> {
  const resultado = new Map<string, RebanhoDoLote>();
  if (!loteIds.length) return resultado;
  const r = await consultaEscopada<{ batch_id: string; cabecas: number; peso_kg: string; ua_fator: string }>(
    ctx,
    `with lotes as (select unnest($2::uuid[]) as batch_id),
     animais as (
       select a.batch_id,
              count(*)::int as n,
              coalesce(sum(a.current_weight) filter (where a.current_weight > 0), 0) as peso_kg,
              coalesce(sum(c.ua_factor) filter (where a.current_weight is null or a.current_weight <= 0), 0) as ua_fator
         from erp.animals a
         join erp.animal_categories c on c.id = a.category_id
        where a.organization_id = $1 and a.batch_id = any($2::uuid[])
          and a.status = 'active' and a.deleted_at is null
          and {{escopo:a.empresa_id}}
        group by a.batch_id
     ),
     por_contagem as (
       select h.batch_id,
              coalesce(sum(h.quantity), 0)::int as n,
              coalesce(sum(h.quantity * h.average_weight) filter (where h.average_weight > 0), 0) as peso_kg,
              coalesce(sum(h.quantity * c.ua_factor) filter (where h.average_weight is null or h.average_weight <= 0), 0) as ua_fator
         from erp.herd_lots h
         join erp.animal_categories c on c.id = h.category_id
        where h.organization_id = $1 and h.batch_id = any($2::uuid[])
          and {{escopo:h.empresa_id}}
        group by h.batch_id
     )
     select l.batch_id,
            (coalesce(an.n, 0) + coalesce(pc.n, 0))::int as cabecas,
            (coalesce(an.peso_kg, 0) + coalesce(pc.peso_kg, 0))::text as peso_kg,
            (coalesce(an.ua_fator, 0) + coalesce(pc.ua_fator, 0))::text as ua_fator
       from lotes l
       left join animais an on an.batch_id = l.batch_id
       left join por_contagem pc on pc.batch_id = l.batch_id`,
    [ctx.orgId, [...new Set(loteIds)]],
  );
  for (const x of r.rows) resultado.set(x.batch_id, { cabecas: x.cabecas, ua: uaDoRebanho(x.peso_kg, x.ua_fator) });
  return resultado;
}
