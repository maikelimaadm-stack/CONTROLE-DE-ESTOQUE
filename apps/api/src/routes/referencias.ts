import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACENTOS_DE, ACENTOS_PARA, bancosPorApelido, getReferencia, semAcento, rotuloDaReferencia, type ReferenciaDeBusca } from "@agro/domain";
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
export const consultaSchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  /** `todos=1`: inclui o que não é escolhível (ex.: NCM de outro nível), só para exibir valor antigo */
  todos: z.enum(["1"]).optional()
}).strict();

function colunas(ref: ReferenciaDeBusca) {
  const cod = `t.${ident(ref.colunaCodigo)}`;
  const nome = ref.chave === "ncm" ? `coalesce(t.${ident(ref.colunaNome)}, t."description")` : `t.${ident(ref.colunaNome)}`;
  const extra = ref.colunaExtra ? `t.${ident(ref.colunaExtra)}::text` : "null::text";
  return { cod, nome, extra, escolhivel: ref.escolhivel ? `(${ref.escolhivel.replace(/\b(nivel|vigencia_inicio|vigencia_fim)\b/g, "t.$1")})` : "true" };
}

type Linha = { codigo: string | number; nome: string; extra: string | null; escolhivel: boolean };
const item = (ref: ReferenciaDeBusca, l: Linha) => ({ codigo: ref.codigoInteiro ? Number(l.codigo) : String(l.codigo), nome: l.nome, extra: l.extra, rotulo: rotuloDaReferencia(ref.chave, l), escolhivel: l.escolhivel });

/**
 * Monta a busca. REGRA (A-1): parâmetro só entra em `b.params` quando o trecho de SQL que o usa entra no
 * texto — nada é pré-adicionado. Antes, ACENTOS_DE/ACENTOS_PARA entravam sempre como $1/$2 e a busca SEM
 * texto (a tela abre o campo assim) quebrava com "bind message supplies 2 parameters" → 500.
 * Exportada para o teste conferir que todo $n usado existe e todo parâmetro é usado.
 */
export function montarBuscaReferencia(ref: ReferenciaDeBusca, q: z.infer<typeof consultaSchema>) {
  const c = colunas(ref);
  const b = new SqlBuilder();
  let acentos: [string, string] | null = null;
  // translate(lower(col), $de, $para): os dois parâmetros entram na primeira vez que alguém normaliza
  const normal = (col: string) => { acentos ??= [b.add(ACENTOS_DE), b.add(ACENTOS_PARA)]; return `translate(lower(${col}::text), ${acentos[0]}, ${acentos[1]})`; };
  const where: string[] = [];
  const prioridade: string[] = []; // acertos exatos primeiro (código, apelido)
  if (!q.todos) where.push(c.escolhivel);
  let termo = (q.search ?? "").trim();
  // "Gurupi - TO" e "5106752 · Pontes e Lacerda - MT": o rótulo inteiro digitado (ou colado) também acha
  if (ref.chave === "municipios") {
    const rot = /^(\d{7})\s*·/.exec(termo);
    if (rot) termo = rot[1]!;
    const comUf = rot ? null : /^(.+?)\s*-\s*([A-Za-z]{2})$/.exec(termo);
    if (comUf) { termo = comUf[1]!.trim(); where.push(`${c.extra} = ${b.add(comUf[2]!.toUpperCase())}`); }
  }
  if (ref.chave === "bancos") { const rot = /^(\d{1,3})\s*·/.exec(termo); if (rot) termo = rot[1]!; }
  if (termo) {
    const digitos = termo.replace(/[.\-\s/]/g, "");
    const padrao = `%${semAcento(termo).replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    const partes = [`${normal(c.nome)} like ${b.add(padrao)}`];
    if (/^\d+$/.test(digitos)) {
      partes.push(`${c.cod}::text like ${b.add(`${digitos}%`)}`);
      if (ref.chave === "municipios" && digitos.length === 7) prioridade.push(`${c.cod} = ${b.add(Number(digitos))}`);
      if (ref.chave === "bancos") {
        // "1" e "001" acham o 001: código com zeros à esquerda
        if (digitos.length <= 3) { const p = b.add(digitos.padStart(3, "0")); partes.push(`${c.cod} = ${p}`); prioridade.push(`${c.cod} = ${p}`); }
        // ISPB (8 dígitos; prefixo a partir de 4)
        if (digitos.length >= 4 && digitos.length <= 8) partes.push(`t."ispb" like ${b.add(`${digitos}%`)}`);
      }
    }
    if (ref.chave === "bancos") {
      const apelidos = bancosPorApelido(termo);
      if (apelidos.length) { const p = b.add(apelidos); partes.push(`${c.cod} = any(${p}::text[])`); prioridade.push(`${c.cod} = any(${p}::text[])`); }
    }
    where.push(`(${partes.join(" or ")})`);
  }
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const offset = (q.page - 1) * q.pageSize;
  const base = ref.chave === "municipios" ? `${c.nome}, ${c.extra}` : `${c.cod}`;
  const ordem = prioridade.length ? `case when ${prioridade.join(" or ")} then 0 else 1 end, ${base}` : base;
  const sql = `select ${c.cod} as codigo, ${c.nome} as nome, ${c.extra} as extra, ${c.escolhivel} as escolhivel, count(*) over()::text as total
       from erp.${ident(ref.tabela)} t ${w} order by ${ordem} limit ${q.pageSize} offset ${offset}`;
  return { sql, params: b.params };
}

export async function buscarReferencia(ctx: ServiceCtx, ref: ReferenciaDeBusca, q: z.infer<typeof consultaSchema>) {
  const { sql, params } = montarBuscaReferencia(ref, q);
  const r = await ctx.tx.query<Linha & { total: string }>(sql, params);
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
