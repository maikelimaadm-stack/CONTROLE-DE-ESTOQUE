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
 * o chamador pode ver, o saldo físico no local de estoque pedido. Contrato em docs/PERSONALIZACAO.md, § API,
 * "Pesquisa de produtos" (o dono das consultas de cadastro).
 *
 *  · Permissão e campos visíveis: os MESMOS do seletor `/api/resources/products/options` — qualquer membro da
 *    organização, módulo resolvido pela permissão `products.view`; campo que o usuário não vê sai nulo.
 *  · Estoque só com `stocks.view` E `armazem_id` E local da organização, vivo, de empresa viva e no escopo do
 *    módulo de estoque (`armazemVisivelSql`, a regra ÚNICA). Qualquer "não" responde IGUAL (estoque nulo em todos,
 *    `estoqueDoArmazem=false`): a resposta não revela se o local existe, é de outra organização ou está fora do escopo.
 *  · Saldo FÍSICO (soma de todos os lotes), sem descontar reserva — a reserva é pergunta da venda, não do seletor.
 *  · UMA consulta de produtos e, com estoque, UMA de saldos (`unnest($ids)`): nunca N+1. Sem `com_saldo`, o local
 *    é conferido DENTRO da consulta de saldos (sem local visível ela não devolve linha), sem consulta própria.
 *
 * OPERACOES-01 F3b (decisão 280) — a pesquisa das Centrais: página, "só com saldo" e a capacidade.
 *  · Parâmetros novos, ADITIVOS (o web só os manda com a capacidade): `pagina` (só dígitos canônicos, 1 a
 *    `LIMITE_DE_PAGINAS`), `com_saldo` e `controla_estoque` (`true|false`, grafia exata). `com_saldo=true` sem
 *    `armazem_id` → 422 (de FORMA: vem antes de qualquer permissão e não revela nada). A resposta ganha, ao fim e
 *    sempre presentes, `pagina`, `temMais` e `filtradoPorSaldo` (`RespostaDaPesquisa`).
 *  · `com_saldo=true` (as SAÍDAS): só o produto que controla estoque com saldo > 0 no local, e o que NÃO controla
 *    (não tem saldo, e a saída dele não mexe no estoque). O filtro está no SQL ANTES do LIMIT — a página nunca sai
 *    curta —, e `temMais` vem de pedir `limite + 1` linhas. Sem total: contar custaria uma consulta a mais.
 *  · O filtro SÓ vale para quem vê o saldo DAQUELE local (a mesma regra do estoque, conferida antes por Q0). Para
 *    qualquer outro — sem `stocks.view`, local fora do escopo, de outra organização, excluído ou inexistente —
 *    `com_saldo` é IGNORADO e a resposta é idêntica à do pedido sem ele: filtrar para quem não vê o saldo faria o
 *    produto sumir ou aparecer conforme o estoque, um oráculo do saldo.
 *  · `controla_estoque=true`: só produto que controla estoque (a Central de Estoque, que só aceita esses).
 *  · Custo: sem `com_saldo`, as consultas de antes (1 ou 2); com `com_saldo=true`, `stocks.view` e `armazem_id`, mais
 *    UMA do local (Q0), visível ou não — no máximo três FIXAS (o local, os produtos, os saldos), independentes do
 *    número de produtos e as mesmas três para o local visível e para o invisível.
 *  · A capacidade: `GET /api/produtos/pesquisa/capacidades` → `{ capacidades: { pesquisaDeProdutos: 1 } }`, para
 *    qualquer membro autenticado. Na API anterior a rota não existe (404 de rota) e a tela fica na pesquisa de antes.
 */

/** A página máxima: 1000 páginas de até 50 produtos. Além disso, quem procura refina a busca. */
export const LIMITE_DE_PAGINAS = 1000;
/** Página só em dígitos canônicos: "0", "01", "1.5", "1e1" e " 2" são recusados — contrato novo nasce estrito. */
const PAGINA = /^[1-9]\d{0,3}$/;
/** Booleano de query na grafia exata: "1", "sim" ou o parâmetro repetido (chega como lista) → 422. */
const booleanoDaQuery = z.enum(["true", "false"]);

export const pesquisaProdutosSchema = z.object({
  busca: z.string().trim().max(100).optional(),
  armazem_id: z.string().uuid().optional(),
  // o `z.coerce` de antes fica: mudar o contrato que já existe não é desta fase
  limite: z.coerce.number().int().min(1).max(50).default(20),
  pagina: z.string().regex(PAGINA).transform(Number).pipe(z.number().int().min(1).max(LIMITE_DE_PAGINAS)).optional(),
  com_saldo: booleanoDaQuery.optional(),
  controla_estoque: booleanoDaQuery.optional()
}).strict().superRefine((q, c) => {
  // sem local não há saldo a filtrar: é erro de forma do pedido, não uma pergunta ao banco
  if (q.com_saldo === "true" && !q.armazem_id) c.addIssue({ code: "custom", path: ["com_saldo"], message: "com_saldo exige armazem_id" });
});

type Consulta = z.infer<typeof pesquisaProdutosSchema>;
type ItemPesquisa = { id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null; estoque: string | null };
/** A resposta, NESTA ordem: as duas chaves de antes e, ao fim, as três aditivas da F3b (sempre presentes). */
export type RespostaDaPesquisa = { itens: ItemPesquisa[]; estoqueDoArmazem: boolean; pagina: number; temMais: boolean; filtradoPorSaldo: boolean };

/** `%` e `_` digitados são texto, não curinga (ilike usa `\` como escape padrão). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * "O local é VISÍVEL para o saldo" — a regra ÚNICA, usada por Q0 (o filtro) e pela consulta de saldos: local da
 * organização, não excluído, de empresa viva da organização e no escopo de empresa do módulo de ESTOQUE
 * (`stocks.view`). Devolve um `select` de no máximo uma linha (`w.id`, a chave primária), com os parâmetros
 * acrescentados ao construtor `b`. Duas cópias deste predicado seriam uma segunda régua.
 */
function armazemVisivelSql(ctx: ServiceCtx, b: SqlBuilder, armazemId: string): string {
  const org = b.add(ctx.orgId);
  const escopo = empresaScopeBuilder(ctx, "w.empresa_id", b, { modulo: moduloDaPermissao("stocks.view") });
  return `select w.id from erp.warehouses w
       join erp.empresas e on e.id = w.empresa_id and e.organization_id = ${org} and e.deleted_at is null
      where w.id = ${b.add(armazemId)} and w.organization_id = ${org} and w.deleted_at is null${escopo.map((c) => ` and ${c}`).join("")}`;
}

export async function pesquisarProdutos(ctx: ServiceCtx, q: Consulta): Promise<RespostaDaPesquisa> {
  const def = getResource("products")!;
  const unidadeDef = getResource("measurement_units")!;
  const visivel = (nome: string) => { const f = def.fields.find((x) => x.name === nome); return !f || podeVerCampo(ctx, f); };
  const pagina = q.pagina ?? 1;
  // o local cujo saldo o chamador PODE pedir: só com `stocks.view` (a visibilidade do local é conferida no banco)
  const armazemDoSaldo = q.armazem_id && hasPermission(ctx, "stocks.view") ? q.armazem_id : null;

  // Q0 — "só com saldo" só para quem VÊ o saldo daquele local. Sem `com_saldo` nenhuma consulta nova sai (o caminho
  // de antes fica intacto); para quem não vê, o parâmetro é ignorado e nada abaixo depende de saldo que ele não vê.
  let filtradoPorSaldo = false;
  if (q.com_saldo === "true" && armazemDoSaldo) {
    const v = new SqlBuilder();
    filtradoPorSaldo = (await ctx.tx.query(armazemVisivelSql(ctx, v, armazemDoSaldo), v.params)).rows.length > 0;
  }

  const b = new SqlBuilder();
  const where = [`p.organization_id = ${b.add(ctx.orgId)}`, "p.deleted_at is null", "p.is_active"];
  const busca = q.busca ?? "";
  // cada palavra precisa bater em ALGUM dos três campos; as palavras combinam com E
  for (const palavra of busca.split(/\s+/).filter(Boolean)) {
    const e = escapeLike(palavra);
    const contem = b.add(`%${e}%`);
    where.push(`(p.code::text ilike ${b.add(`${e}%`)} or p.description ilike ${contem} or p.reference ilike ${contem})`);
  }
  if (q.controla_estoque === "true") where.push("p.control_stock");
  // o filtro de saldo mora no WHERE, ANTES do LIMIT: a página sai cheia. Saldo > 0 = a SOMA dos lotes no local; o
  // produto que não controla estoque passa (não tem saldo a conferir)
  if (filtradoPorSaldo && armazemDoSaldo) {
    where.push(`(not p.control_stock or p.id in (select sb.product_id from erp.stock_balances sb
       where sb.organization_id = ${b.add(ctx.orgId)} and sb.warehouse_id = ${b.add(armazemDoSaldo)}
       group by sb.product_id having sum(sb.quantity) > 0))`);
  }
  // código IGUAL ao texto digitado primeiro; depois a descrição (id desempata para a ordem — e a página — ser estável)
  const ordem = busca ? `case when lower(p.code::text) = lower(${b.add(busca)}) then 0 else 1 end, p.description, p.id` : "p.description, p.id";
  // uma linha a mais que o limite diz se há página seguinte, sem contar o total
  const corte = `limit ${b.add(q.limite + 1)} offset ${b.add((pagina - 1) * q.limite)}`;
  // o rótulo da unidade é o mesmo `measurement_id_label` da ficha: o labelField do cadastro de unidades
  const produtos = await ctx.tx.query<{ id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null }>(
    `select p.id::text as id, p.code::text as codigo, p.description as descricao, nullif(p.reference, '') as referencia, mu.${ident(unidadeDef.labelField)}::text as unidade
       from erp.products p left join erp.measurement_units mu on mu.id = p.measurement_id
      where ${where.join(" and ")} order by ${ordem} ${corte}`, b.params);
  const temMais = produtos.rows.length > q.limite;
  const linhas = produtos.rows.slice(0, q.limite);

  let saldos: Map<string, string> | null = null;
  // sem produto na página não há o que somar: a resposta do "não" é a mesma, sem consulta de saldos
  if (armazemDoSaldo && linhas.length) {
    const s = new SqlBuilder();
    const visivelSql = armazemVisivelSql(ctx, s, armazemDoSaldo);
    const r = await ctx.tx.query<{ id: string; estoque: string }>(
      `with visivel as (${visivelSql})
       select p.id::text as id, round(coalesce(sum(sb.quantity), 0), 4)::text as estoque
         from visivel
         cross join unnest(${s.add(linhas.map((x) => x.id))}::uuid[]) as p(id)
         left join erp.stock_balances sb on sb.organization_id = ${s.add(ctx.orgId)} and sb.warehouse_id = visivel.id and sb.product_id = p.id
        group by p.id`, s.params);
    if (r.rows.length) saldos = new Map(r.rows.map((x) => [x.id, x.estoque]));
  }
  const ver = { codigo: visivel("code"), descricao: visivel("description"), referencia: visivel("reference"), unidade: visivel("measurement_id") };
  const itens = linhas.map((x) => ({
    id: x.id,
    codigo: ver.codigo ? x.codigo : null,
    descricao: ver.descricao ? x.descricao : null,
    referencia: ver.referencia ? x.referencia : null,
    unidade: ver.unidade ? x.unidade : null,
    estoque: saldos ? saldos.get(x.id) ?? null : null
  }));
  // com o filtro aplicado o local É visível, mesmo com a página vazia: a tela precisa saber (para manter o controle
  // "só com saldo" e dizer que nenhum produto tem saldo); sem `com_saldo`, idêntico a antes
  return { itens, estoqueDoArmazem: saldos !== null || filtradoPorSaldo, pagina, temMais, filtradoPorSaldo };
}

/**
 * A CAPACIDADE da pesquisa (OPERACOES-01 F3b, decisão 280). A versão 1 significa: esta API aceita `pagina`,
 * `com_saldo` e `controla_estoque` em `GET /api/produtos/pesquisa` e responde `pagina`, `temMais` e
 * `filtradoPorSaldo`. O web só manda os parâmetros novos quando lê EXATAMENTE este valor; sem ele (a API anterior
 * responde 404 de rota), usa a pesquisa de antes. Nunca mude o valor sem mudar o significado: versão nova = valor novo.
 */
export const CAPACIDADE_PESQUISA_DE_PRODUTOS = 1;

export default async function produtosPesquisaRoutes(app: FastifyInstance) {
  app.get("/produtos/pesquisa", async (req) => {
    const q = pesquisaProdutosSchema.parse(req.query);
    // mesma porta do seletor de produto (`/resources/products/options`): sem permissão própria, módulo de products
    return runService(app, req, null, async (ctx) => pesquisarProdutos(await comPermissaoResolvida(ctx, "products.view"), q));
  });
  // a declaração da capacidade: qualquer membro autenticado (a pesquisa também não tem permissão própria), sem
  // consulta a dado nenhum; sem sessão, o 401 de sempre
  app.get("/produtos/pesquisa/capacidades", async (req) =>
    runService(app, req, null, async () => ({ capacidades: { pesquisaDeProdutos: CAPACIDADE_PESQUISA_DE_PRODUTOS } })));
}
