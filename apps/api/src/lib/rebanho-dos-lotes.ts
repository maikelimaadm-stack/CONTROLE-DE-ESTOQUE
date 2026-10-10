import type { DecimalString } from "@agro/shared";
import { uaDoRebanho, type CategoriaPresente } from "@agro/domain";
import { consultaEscopada, type ServiceCtx } from "./context.js";

/** Cabeças e UA de um lote AGORA (MAPA-MANEJO-01, decisão 305). */
export interface RebanhoDoLote { cabecas: number; ua: DecimalString }

/**
 * O rebanho do lote com as CATEGORIAS presentes nele (MAPA-MANEJO-02, decisão 306): cada categoria de animal com
 * cabeça no lote, o nome COMO CADASTRADO em `erp.animal_categories` e as cabeças dela (animais + contagem), em
 * ordem de código do nome. Lote sem cabeça → lista vazia. A normalização (btrim + maiúsculas) é do domínio
 * (`configuracao-de-icone.ts`), não daqui: o SQL entrega o nome cru.
 */
export interface RebanhoDoLoteComCategorias extends RebanhoDoLote { categorias: CategoriaPresente[] }

/** Opção de `rebanhoDosLotes`: acrescenta as categorias presentes, na MESMA consulta. */
export interface OpcoesDoRebanho { comCategorias: true }

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
 *
 * `{ comCategorias: true }` (MAPA-MANEJO-02): a MESMA consulta ganha um CTE com as categorias presentes por lote —
 * os mesmos animais (ativos, sem exclusão) e o rebanho por contagem com `quantity > 0`, cada tabela com o PRÓPRIO
 * escopo, juntando `erp.animal_categories` —, e cada lote volta com `categorias`. Nenhuma consulta a mais. SEM a
 * opção, o texto da consulta e o resultado são os de antes, byte a byte (a transferência de lote chama assim).
 */
export function rebanhoDosLotes(ctx: ServiceCtx, loteIds: readonly string[]): Promise<Map<string, RebanhoDoLote>>;
export function rebanhoDosLotes(ctx: ServiceCtx, loteIds: readonly string[], opcoes: OpcoesDoRebanho): Promise<Map<string, RebanhoDoLoteComCategorias>>;
export async function rebanhoDosLotes(
  ctx: ServiceCtx, loteIds: readonly string[], opcoes?: OpcoesDoRebanho
): Promise<Map<string, RebanhoDoLote | RebanhoDoLoteComCategorias>> {
  const resultado = new Map<string, RebanhoDoLote | RebanhoDoLoteComCategorias>();
  if (!loteIds.length) return resultado;
  const comCategorias = opcoes?.comCategorias === true;
  // Os três trechos só existem com a opção; sem ela são vazios e o texto fica idêntico ao de antes.
  const cteCategorias = comCategorias
    ? `,
     categorias_por_lote as (
       select x.batch_id, c.name as nome, sum(x.n)::int as cabecas
         from (
           select a.batch_id, a.category_id, count(*) as n
             from erp.animals a
            where a.organization_id = $1 and a.batch_id = any($2::uuid[])
              and a.status = 'active' and a.deleted_at is null
              and {{escopo:a.empresa_id}}
            group by a.batch_id, a.category_id
           union all
           select h.batch_id, h.category_id, sum(h.quantity) as n
             from erp.herd_lots h
            where h.organization_id = $1 and h.batch_id = any($2::uuid[]) and h.quantity > 0
              and {{escopo:h.empresa_id}}
            group by h.batch_id, h.category_id
         ) x
         join erp.animal_categories c on c.id = x.category_id
        group by x.batch_id, c.name
     ),
     categorias as (
       select cl.batch_id, json_agg(json_build_object('nome', cl.nome, 'cabecas', cl.cabecas) order by cl.nome collate "C") as categorias
         from categorias_por_lote cl
        group by cl.batch_id
     )`
    : "";
  const colunaCategorias = comCategorias ? `,
            coalesce(ct.categorias, '[]'::json) as categorias` : "";
  const joinCategorias = comCategorias ? `
       left join categorias ct on ct.batch_id = l.batch_id` : "";
  const r = await consultaEscopada<{ batch_id: string; cabecas: number; peso_kg: string; ua_fator: string; categorias?: CategoriaPresente[] }>(
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
     )${cteCategorias}
     select l.batch_id,
            (coalesce(an.n, 0) + coalesce(pc.n, 0))::int as cabecas,
            (coalesce(an.peso_kg, 0) + coalesce(pc.peso_kg, 0))::text as peso_kg,
            (coalesce(an.ua_fator, 0) + coalesce(pc.ua_fator, 0))::text as ua_fator${colunaCategorias}
       from lotes l
       left join animais an on an.batch_id = l.batch_id
       left join por_contagem pc on pc.batch_id = l.batch_id${joinCategorias}`,
    [ctx.orgId, [...new Set(loteIds)]],
  );
  for (const x of r.rows) {
    const rebanho: RebanhoDoLote = { cabecas: x.cabecas, ua: uaDoRebanho(x.peso_kg, x.ua_fator) };
    resultado.set(x.batch_id, comCategorias ? { ...rebanho, categorias: x.categorias ?? [] } : rebanho);
  }
  return resultado;
}
