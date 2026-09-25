import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACENTOS_DE, ACENTOS_PARA, getReferencia, rotuloDaReferencia, type ReferenciaDeBusca } from "@agro/domain";
import { ident, SqlBuilder } from "../lib/sql.js";
import { runService } from "../lib/service.js";
import { notFound } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";

/**
 * BUSCAS DE REFERÊNCIA OFICIAL (CADASTROS Fase 3): município, banco, NCM, CBO. Tabelas GLOBAIS, só
 * leitura, carregadas pela 0026. Tabela e colunas vêm da whitelist estática `REFERENCIAS_DE_BUSCA`
 * (packages/domain); da requisição só vêm a chave (conferida contra a lista), o texto (parâmetro) e a
 * página. Paginação e busca no servidor. Qualquer membro autenticado da organização pode buscar: é dado
 * público oficial, e quem grava o código no cadastro continua sendo a rota do cadastro, com a permissão dele.
 */
const consultaSchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  /** `todos=1`: inclui o que não é escolhível (ex.: NCM de outro nível), só para exibir valor antigo */
  todos: z.enum(["1"]).optional()
}).strict();

const normal = (col: string) => `translate(lower(${col}::text), $1, $2)`;

function colunas(ref: ReferenciaDeBusca) {
  const cod = `t.${ident(ref.colunaCodigo)}`;
  const nome = ref.chave === "ncm" ? `coalesce(t.${ident(ref.colunaNome)}, t."description")` : `t.${ident(ref.colunaNome)}`;
  const extra = ref.colunaExtra ? `t.${ident(ref.colunaExtra)}::text` : "null::text";
  return { cod, nome, extra, escolhivel: ref.escolhivel ? `(${ref.escolhivel.replace(/\b(nivel|vigencia_inicio|vigencia_fim)\b/g, "t.$1")})` : "true" };
}

type Linha = { codigo: string | number; nome: string; extra: string | null; escolhivel: boolean };
const item = (ref: ReferenciaDeBusca, l: Linha) => ({ codigo: ref.codigoInteiro ? Number(l.codigo) : String(l.codigo), nome: l.nome, extra: l.extra, rotulo: rotuloDaReferencia(ref.chave, l), escolhivel: l.escolhivel });

export async function buscarReferencia(ctx: ServiceCtx, ref: ReferenciaDeBusca, q: z.infer<typeof consultaSchema>) {
  const c = colunas(ref);
  const b = new SqlBuilder(); b.add(ACENTOS_DE); b.add(ACENTOS_PARA); // $1 e $2 de `normal`
  const where: string[] = [];
  if (!q.todos) where.push(c.escolhivel);
  let termo = (q.search ?? "").trim();
  // "Gurupi - TO": o rótulo inteiro digitado (ou colado) também acha — nome + UF
  const comUf = ref.chave === "municipios" ? /^(.+?)\s*-\s*([A-Za-z]{2})$/.exec(termo) : null;
  if (comUf) { termo = comUf[1]!.trim(); where.push(`${c.extra} = ${b.add(comUf[2]!.toUpperCase())}`); }
  if (termo) {
    const digitos = termo.replace(/[.\-\s/]/g, "");
    // "sao paulo" acha "São Paulo": a mesma normalização (minúsculas, sem acento) nos dois lados
    const partes = [`${normal(c.nome)} like ${normal(b.add(`%${termo.replace(/[\\%_]/g, (x) => `\\${x}`)}%`))}`];
    if (/^\d+$/.test(digitos)) partes.push(`${c.cod}::text like ${b.add(`${digitos}%`)}`);
    where.push(`(${partes.join(" or ")})`);
  }
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const offset = (q.page - 1) * q.pageSize;
  const ordem = ref.chave === "municipios" ? `${c.nome}, ${c.extra}` : `${c.cod}`;
  const r = await ctx.tx.query<Linha & { total: string }>(
    `select ${c.cod} as codigo, ${c.nome} as nome, ${c.extra} as extra, ${c.escolhivel} as escolhivel, count(*) over()::text as total
       from erp.${ident(ref.tabela)} t ${w} order by ${ordem} limit ${q.pageSize} offset ${offset}`, b.params);
  return { items: r.rows.map((l) => item(ref, l)), page: q.page, pageSize: q.pageSize, total: Number(r.rows[0]?.total ?? 0) };
}

export async function referenciaPorCodigo(ctx: ServiceCtx, ref: ReferenciaDeBusca, codigo: string) {
  if (!new RegExp(ref.padraoCodigo).test(codigo)) throw notFound(ref.label);
  const c = colunas(ref);
  const r = await ctx.tx.query<Linha>(`select ${c.cod} as codigo, ${c.nome} as nome, ${c.extra} as extra, ${c.escolhivel} as escolhivel from erp.${ident(ref.tabela)} t where ${c.cod} = $1`, [ref.codigoInteiro ? Number(codigo) : codigo]);
  if (!r.rows[0]) throw notFound(ref.label);
  return item(ref, r.rows[0]);
}

export default async function referenciaRoutes(app: FastifyInstance) {
  app.get("/referencias/:chave", async (req) => {
    const ref = getReferencia((req.params as { chave: string }).chave); if (!ref) throw notFound("Referência");
    const q = consultaSchema.parse(req.query);
    return runService(app, req, null, (ctx) => buscarReferencia(ctx, ref, q));
  });
  app.get("/referencias/:chave/:codigo", async (req) => {
    const { chave, codigo } = req.params as { chave: string; codigo: string };
    const ref = getReferencia(chave); if (!ref) throw notFound("Referência");
    return runService(app, req, null, (ctx) => referenciaPorCodigo(ctx, ref, codigo));
  });
}
