import type { FastifyInstance } from "fastify";
import { runService } from "../lib/service.js";
import { consultaEscopada } from "../lib/context.js";

/**
 * Mapa de Manejo — leituras agregadas por área (sem satélite). O mapa geral usa outras rotas em `/mapa/…`.
 *
 * GET /api/mapa/areas/cabecas-por-area — cabeças por `erp.areas.id`: animais identificados ativos nos lotes
 * da área + quantidade dos rebanhos por contagem (`erp.herd_lots`) vinculados ao lote da área.
 */
export default async function mapaManejoRoutes(app: FastifyInstance) {
  app.get("/mapa/areas/cabecas-por-area", async (req) =>
    runService(app, req, "batch_area.view", async (ctx) => {
      const r = await consultaEscopada<{ area_id: string; cabecas: number }>(
        ctx,
        `with lote_da_area as (
           select b.id as batch_id, b.area_id
             from erp.batches b
            where b.organization_id = $1
              and b.deleted_at is null
              and b.area_id is not null
              and {{escopo:b.empresa_id}}
         ),
         identificados as (
           select la.area_id, count(a.id)::int as n
             from lote_da_area la
             join erp.animals a on a.batch_id = la.batch_id
              and a.organization_id = $1
              and a.deleted_at is null
              and a.status = 'active'
              and {{escopo:a.empresa_id}}
            group by la.area_id
         ),
         por_contagem as (
           select la.area_id, coalesce(sum(h.quantity), 0)::int as n
             from lote_da_area la
             join erp.herd_lots h on h.batch_id = la.batch_id
              and h.organization_id = $1
              and h.quantity > 0
              and {{escopo:h.empresa_id}}
            group by la.area_id
         )
         select coalesce(i.area_id, p.area_id) as area_id,
                coalesce(i.n, 0) + coalesce(p.n, 0) as cabecas
           from identificados i
           full outer join por_contagem p on p.area_id = i.area_id
          where coalesce(i.n, 0) + coalesce(p.n, 0) > 0
          order by area_id`,
        [ctx.orgId]
      );
      return { items: r.rows };
    })
  );
}
