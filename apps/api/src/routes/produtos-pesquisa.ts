import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource, moduloDaPermissao } from "@agro/domain";
import { runService, comPermissaoResolvida } from "../lib/service.js";
import { empresaScopeBuilder, hasPermission, type ServiceCtx } from "../lib/context.js";
import { podeVerCampo } from "../lib/ficha-em-abas.js";
import { ident, SqlBuilder } from "../lib/sql.js";

/**
 * PESQUISA DE PRODUTOS (ANEXOS-PESQUISA-01, item 2.2) — `GET /api/produtos/pesquisa`.
 *
 * Porta de LEITURA para o seletor de produto dos lançamentos: código, descrição, referência, unidade e, quando
 * o chamador pode ver, o saldo físico no armazém pedido. Contrato em docs/PERSONALIZACAO.md, § API, "Pesquisa de
 * produtos" (o dono das consultas de cadastro).
 *
 *  · Permissão e campos visíveis: os MESMOS do seletor `/api/resources/products/options` — qualquer membro da
 *    organização, módulo resolvido pela permissão `products.view`; campo que o usuário não vê sai nulo.
 *  · Estoque só com `stocks.view` E `armazem_id` E armazém da organização, vivo, de empresa viva e no escopo do
 *    módulo de estoque. Qualquer "não" responde IGUAL (estoque nulo em todos, `estoqueDoArmazem=false`): a resposta
 *    não revela se o armazém existe, é de outra organização ou está fora do escopo.
 *  · Saldo FÍSICO (soma de todos os lotes), sem descontar reserva — a reserva é pergunta da venda, não do seletor.
 *  · UMA consulta de produtos e, com estoque, UMA de saldos (`any($ids)`): nunca N+1. O armazém é conferido DENTRO
 *    da consulta de saldos (sem armazém visível ela não devolve linha), sem consulta própria.
 */
export const pesquisaProdutosSchema = z.object({
  busca: z.string().trim().max(100).optional(),
  armazem_id: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

type Consulta = z.infer<typeof pesquisaProdutosSchema>;
type ItemPesquisa = { id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null; estoque: string | null };

/** `%` e `_` digitados são texto, não curinga (ilike usa `\` como escape padrão). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function pesquisarProdutos(ctx: ServiceCtx, q: Consulta): Promise<{ itens: ItemPesquisa[]; estoqueDoArmazem: boolean }> {
  const def = getResource("products")!;
  const unidadeDef = getResource("measurement_units")!;
  const visivel = (nome: string) => { const f = def.fields.find((x) => x.name === nome); return !f || podeVerCampo(ctx, f); };
  const b = new SqlBuilder();
  const where = [`p.organization_id = ${b.add(ctx.orgId)}`, "p.deleted_at is null", "p.is_active"];
  const busca = q.busca ?? "";
  // cada palavra precisa bater em ALGUM dos três campos; as palavras combinam com E
  for (const palavra of busca.split(/\s+/).filter(Boolean)) {
    const e = escapeLike(palavra);
    const contem = b.add(`%${e}%`);
    where.push(`(p.code::text ilike ${b.add(`${e}%`)} or p.description ilike ${contem} or p.reference ilike ${contem})`);
  }
  // código IGUAL ao texto digitado primeiro; depois a descrição (id desempata para a ordem ser estável)
  const ordem = busca ? `case when lower(p.code::text) = lower(${b.add(busca)}) then 0 else 1 end, p.description, p.id` : "p.description, p.id";
  // o rótulo da unidade é o mesmo `measurement_id_label` da ficha: o labelField do cadastro de unidades
  const produtos = await ctx.tx.query<{ id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null }>(
    `select p.id::text as id, p.code::text as codigo, p.description as descricao, nullif(p.reference, '') as referencia, mu.${ident(unidadeDef.labelField)}::text as unidade
       from erp.products p left join erp.measurement_units mu on mu.id = p.measurement_id
      where ${where.join(" and ")} order by ${ordem} limit ${q.limite}`, b.params);

  let saldos: Map<string, string> | null = null;
  if (q.armazem_id && hasPermission(ctx, "stocks.view") && produtos.rows.length) {
    const s = new SqlBuilder();
    const org = s.add(ctx.orgId);
    const escopo = empresaScopeBuilder(ctx, "w.empresa_id", s, { modulo: moduloDaPermissao("stocks.view") });
    const r = await ctx.tx.query<{ id: string; estoque: string }>(
      `select p.id::text as id, round(coalesce(sum(sb.quantity), 0), 4)::text as estoque
         from erp.warehouses w
         join erp.empresas e on e.id = w.empresa_id and e.organization_id = ${org} and e.deleted_at is null
         cross join unnest(${s.add(produtos.rows.map((x) => x.id))}::uuid[]) as p(id)
         left join erp.stock_balances sb on sb.organization_id = ${org} and sb.warehouse_id = w.id and sb.product_id = p.id
        where w.id = ${s.add(q.armazem_id)} and w.organization_id = ${org} and w.deleted_at is null${escopo.map((c) => ` and ${c}`).join("")}
        group by p.id`, s.params);
    if (r.rows.length) saldos = new Map(r.rows.map((x) => [x.id, x.estoque]));
  }
  // sem produto na página não há o que somar: a resposta do "não" é a mesma, sem consulta de saldos
  const ver = { codigo: visivel("code"), descricao: visivel("description"), referencia: visivel("reference"), unidade: visivel("measurement_id") };
  const itens = produtos.rows.map((x) => ({
    id: x.id,
    codigo: ver.codigo ? x.codigo : null,
    descricao: ver.descricao ? x.descricao : null,
    referencia: ver.referencia ? x.referencia : null,
    unidade: ver.unidade ? x.unidade : null,
    estoque: saldos ? saldos.get(x.id) ?? null : null
  }));
  return { itens, estoqueDoArmazem: saldos !== null };
}

export default async function produtosPesquisaRoutes(app: FastifyInstance) {
  app.get("/produtos/pesquisa", async (req) => {
    const q = pesquisaProdutosSchema.parse(req.query);
    // mesma porta do seletor de produto (`/resources/products/options`): sem permissão própria, módulo de products
    return runService(app, req, null, async (ctx) => pesquisarProdutos(await comPermissaoResolvida(ctx, "products.view"), q));
  });
}
