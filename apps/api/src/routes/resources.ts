import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource, getReferencia, nomeDoMunicipio, partesDaReferencia, RESOURCES, tipoEntidadeDaTabela, type ChaveReferencia, type FieldDef, type ResourceDef } from "@agro/domain";
import { isISODate, parseFilterKey, filterKindOf, isValidOperator, decodeRange, decodeList, relativeDateRange } from "@agro/shared";
import { ident, SqlBuilder } from "../lib/sql.js";
import { pageQuerySchema, extractFilters } from "../lib/pagination.js";
import { runService, nextCode, requirePermission, comPermissaoResolvida } from "../lib/service.js";
import { SEQUENCIA_EMPRESA } from "../lib/sequencia-empresa.js";
import { notFound, validation } from "../lib/errors.js";
import { atribuirIdGlobalSeAplicavel, paginaComIdGlobal } from "../lib/id-global.js";
import { conferirRegrasDaArvore, conferirExclusaoNaArvore, conferirReferenciasAnaliticas, sugerirCodigo, gerarCodigoNaCriacao, gerarCodigoNaEdicao, planejarMover, moverNaArvore, travarNumeracao } from "../lib/arvore-cadastro.js";
import { gerarCodigoSequencial, conferirCodigoSequencialNaEdicao, numeracaoDosCadastros, linhaDaNumeracao, zerarNumeracao, proximoCodigo } from "../lib/numeracao-cadastro.js";
import { conferirGrupoDeProdutos, conferirGrupoDoProduto } from "../lib/grupo-de-produtos.js";
import { conferirTipoDaNatureza } from "../lib/natureza-financeira.js";
import { conferirNcmDoProduto } from "../lib/ncm-do-produto.js";
import { conferirParceiro, atualizarSituacaoReceita } from "../lib/parceiro.js";
import { conferirProduto, fundirCamposJson, historicoDoRegistro } from "../lib/produto.js";
import { shapeDaFicha, validarCorpo, gravarFicha, lerFicha, temFicha, semSigilo, conferirPermissoesDaFicha, conferirSigiloNaCriacao, exigirCampoVisivel, podeVerCampo } from "../lib/ficha-em-abas.js";
import { conferirFuncionario, conferirCboDaFuncao } from "../lib/funcionario.js";
import { conferirCondicaoPagamento } from "../lib/condicao-pagamento.js";
import { empresaScopeBuilder, exigirEmpresaDeLancamento, exigirEscopoTotalDoModulo, exigirEscopoTotalDaOrganizacao, empresaScopeSql, hasPermission, type ServiceCtx } from "../lib/context.js";

/** Constrói o schema zod de um recurso a partir da definição declarativa. */
export function buildSchema(def: ResourceDef, partial = false) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of camposDeEscrita(def)) {
    if (f.readOnly) continue;
    const t = schemaDoCampo(f);
    // CÓDIGO AUTOMÁTICO (decisão 257 D): nunca obrigatório no corpo — o servidor gera. Continua ACEITO no schema
    // para a recusa ser legível (422 "O código é gerado pelo sistema."), e não um "campo desconhecido".
    if (def.codigoAutomatico && f.name === "code") { shape[f.name] = t.nullable().optional(); continue; }
    if (f.type === "boolean") { shape[f.name] = partial ? t.optional() : t.optional().default(Boolean(f.default ?? false)); continue; }
    shape[f.name] = f.required && !partial ? t : t.nullable().optional();
  }
  // FICHA EM ABAS: grades e perfis entram no MESMO objeto estrito (ausente = não mexe)
  Object.assign(shape, shapeDaFicha(def, schemaDoCampo));
  return z.object(shape).strict();
}

/** Schema zod de UM campo declarativo (principal, linha de detalhe ou perfil). */
export function schemaDoCampo(f: FieldDef): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  switch (f.type) {
    case "text": case "textarea": {
      // FORMATO declarado no registry (A-10, ex.: CAEPF com 14 dígitos): recusa no campo, com a mensagem do registry
      const padrao = f.padrao ? { re: new RegExp(f.padrao.regex), mensagem: f.padrao.mensagem } : null;
      t = padrao ? z.string().max(f.maxLength ?? 4000).refine((v) => v === "" || padrao.re.test(v), padrao.mensagem) : z.string().max(f.maxLength ?? 4000);
      break;
    }
    case "email": t = z.string().email().max(200); break;
    case "number": case "money": case "quantity": case "percent": t = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(String); break;
    case "integer": t = z.coerce.number().int(); if (f.min !== undefined) t = (t as z.ZodNumber).min(f.min); if (f.max !== undefined) t = (t as z.ZodNumber).max(f.max); break;
    case "date": t = z.string().refine(isISODate, "Data inválida (use AAAA-MM-DD)"); break;
    case "boolean": t = z.coerce.boolean(); break;
    case "select": t = z.enum(f.options!.map((o) => o.value) as [string, ...string[]]); break;
    case "ref": t = z.string().uuid(); break;
    // json com `camposJson` (Fase 6): chaves conhecidas tipadas; desconhecida passa (é preservada)
    case "json": t = f.camposJson ? z.object(Object.fromEntries(f.camposJson.map((c) => [c.name, schemaDoCampo(c).nullable().optional()]))).passthrough() : z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]); break;
    case "tags": t = z.array(z.string()); break;
    default: t = z.unknown();
  }
  if (f.name === "city_id") t = z.coerce.number().int();
  return t;
}

/**
 * Campos que a escrita aceita e grava: os do formulário MAIS a aceitação legada declarada no registry
 * (`camposLegadosDeEscrita`, nunca obrigatória). É por aqui que a web ANTERIOR continua gravando produto com
 * `category_id`/`kind_id` na janela de deploy da CADASTROS-ESTRUTURA sem o `.strict()` recusar o corpo.
 */
export function camposDeEscrita(def: ResourceDef): FieldDef[] {
  return [...def.fields, ...(def.camposLegadosDeEscrita ?? []).map((f) => ({ ...f, required: false }))];
}

/** Regras próprias de um cadastro, além das comuns da árvore. Chave estática; nenhuma vem do cliente. */
async function conferirRegrasDoCadastro(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Record<string, unknown>, atual: Record<string, unknown> | null) {
  if (def.key === "product_groups") await conferirGrupoDeProdutos(ctx, id, data, atual);
  else if (def.key === "products") { await conferirGrupoDoProduto(ctx, data, atual); await conferirNcmDoProduto(ctx, data, atual); await conferirProduto(ctx, id, data, atual); }
  else if (def.key === "financial_categories") await conferirTipoDaNatureza(ctx, id, data, atual);
  else if (def.key === "people") await conferirParceiro(ctx, def, id, data, atual);
  else if (def.key === "funcionarios") await conferirFuncionario(ctx, def, id, data, atual);
  else if (def.key === "job_functions") await conferirCboDaFuncao(ctx, data);
  else if (def.key === "condicoes_pagamento") conferirCondicaoPagamento(data, atual);
  // depois das regras próprias: a recusa específica (ex.: grupo do produto) fala primeiro
  await conferirReferenciasAnaliticas(ctx, def, data, atual);
}

function listColumns(def: ResourceDef): string[] {
  const cols = new Set<string>(["id", "organization_id", ...def.fields.map((f) => f.name)]);
  cols.add("created_at"); cols.add("updated_at");
  if (def.softDelete) cols.add("deleted_at");
  return [...cols];
}

/**
 * Colunas existentes por tabela, em cache por processo: o esquema só muda em deploy (migrations no pré-deploy),
 * então a consulta ao information_schema (cara e longe do banco) acontece uma vez por tabela.
 */
const columnCache = new Map<string, Set<string>>();
export function clearColumnCache() { columnCache.clear(); }
async function checkColumns(ctx: ServiceCtx, def: ResourceDef): Promise<Set<string>> {
  const hit = columnCache.get(def.table); if (hit) return hit;
  const r = await ctx.tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='erp' and table_name=$1", [def.table]);
  const set = new Set(r.rows.map((x) => x.column_name));
  if (set.size) columnCache.set(def.table, set);
  return set;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** UUID em qualquer caixa (a forma que o `z.string().uuid()` aceita e o Postgres converte). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Filtro avançado `campo__operador=valor` (ver @agro/shared/preferences). O nome da coluna vem SEMPRE da definição
 * declarativa (nunca do cliente) e os valores são parametrizados; operador desconhecido é ignorado.
 */
export function advancedClause(f: FieldDef, op: string, raw: string, b: SqlBuilder): string | null {
  const kind = filterKindOf(f.type);
  if (!isValidOperator(kind, op)) return null;
  const col = ident(f.name);
  if (op === "is_empty") return kind === "text" ? `(${col} is null or ${col}::text = '')` : `${col} is null`;
  if (op === "is_not_empty") return kind === "text" ? `(${col} is not null and ${col}::text <> '')` : `${col} is not null`;
  if (op === "in") {
    const list = decodeList(raw).slice(0, 500); if (!list.length) return null;
    if (kind === "number") { for (const x of list) if (!/^-?\d+(\.\d+)?$/.test(x.trim())) throw validation(`Valor numérico inválido no filtro ${f.label}`); return `${col} = any(${b.add(list.map((x) => x.trim()))}::numeric[])`; }
    if (f.type === "tags") return `${col} && ${b.add(list)}::text[]`;
    if (f.type === "ref") { for (const x of list) if (!/^[0-9a-f-]{36}$/i.test(x)) throw validation(`Referência inválida no filtro ${f.label}`); return `${col} = any(${b.add(list)}::uuid[])`; }
    return `${col}::text = any(${b.add(list)}::text[])`;
  }
  if (kind === "text") {
    const v = escapeLike(raw);
    switch (op) {
      case "contains": return `${col}::text ilike ${b.add(`%${v}%`)}`;
      case "not_contains": return `(${col} is null or ${col}::text not ilike ${b.add(`%${v}%`)})`;
      case "starts_with": return `${col}::text ilike ${b.add(`${v}%`)}`;
      case "ends_with": return `${col}::text ilike ${b.add(`%${v}`)}`;
      default: return `${col}::text = ${b.add(raw)}`;
    }
  }
  if (kind === "number") {
    const n = (s: string) => { if (!/^-?\d+(\.\d+)?$/.test(s.trim())) throw validation(`Valor numérico inválido no filtro ${f.label}`); return s.trim(); };
    if (op === "between") { const [a, c] = decodeRange(raw); return `${col} between ${b.add(n(a))} and ${b.add(n(c))}`; }
    const cmp: Record<string, string> = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    return `${col} ${cmp[op] ?? "="} ${b.add(n(raw))}`;
  }
  if (kind === "date") {
    const d = (s: string) => { if (!isISODate(s)) throw validation(`Data inválida no filtro ${f.label} (use AAAA-MM-DD)`); return s; };
    const rel = relativeDateRange(op, new Date().toISOString().slice(0, 10));
    if (rel) return `${col} between ${b.add(rel[0])} and ${b.add(rel[1])}`;
    if (op === "between") { const [a, c] = decodeRange(raw); return `${col} between ${b.add(d(a))} and ${b.add(d(c))}`; }
    if (op === "before") return `${col} < ${b.add(d(raw))}`;
    if (op === "after") return `${col} > ${b.add(d(raw))}`;
    return `${col} = ${b.add(d(raw))}`;
  }
  if (kind === "boolean") return `${col} = ${b.add(raw === "true")}`;
  if (f.type === "tags") return op === "ne" ? `not (${b.add(raw)} = any(${col}))` : `${b.add(raw)} = any(${col})`;
  return op === "ne" ? `(${col} is null or ${col} <> ${b.add(raw)})` : `${col} = ${b.add(raw)}`;
}

/**
 * Recorte de empresa do recurso genérico. `empresaScoped` = coluna NOT NULL; `empresaScopedNulo` = coluna
 * anulável em que nulo significa "da organização" e por isso continua visível (mesma semântica de
 * `farmClauseNulo` nos relatórios). Sem nenhum dos dois, o recurso não tem dimensão de empresa —
 * e o gate de apps/api/test/unit/report-scope.test.ts cobra isso contra o schema real.
 */
const escopoDoRecurso = (def: ResourceDef) => ({ ativo: Boolean(def.empresaScoped || def.empresaScopedNulo), nullable: Boolean(def.empresaScopedNulo) });

export async function listResource(ctx: ServiceCtx, def: ResourceDef, query: Record<string, unknown>) {
  const q = pageQuerySchema.parse(query);
  const filters = extractFilters(q as Record<string, unknown>);
  const existing = await checkColumns(ctx, def);
  const cols = listColumns(def).filter((c) => existing.has(c));
  const b = new SqlBuilder();
  const where: string[] = [];
  if (existing.has("organization_id")) where.push(def.reference || def.sharedDefaults ? `(organization_id is null or organization_id = ${b.add(ctx.orgId)})` : `organization_id = ${b.add(ctx.orgId)}`);
  if (def.softDelete) where.push("deleted_at is null");
  // recorte FIXO do cadastro (ex.: Funcionários = is_employee): coluna da definição estática, valor parametrizado
  for (const [k, v] of Object.entries(def.filtroFixo ?? {})) where.push(`${ident(k)} = ${b.add(v)}`);
  const escL = escopoDoRecurso(def);
  if (escL.ativo && ctx.empresaId && existing.has("empresa_id") && !filters["empresa_id"]) where.push(escL.nullable ? `(empresa_id is null or empresa_id = ${b.add(ctx.empresaId)})` : `empresa_id = ${b.add(ctx.empresaId)}`);
  if (escL.ativo && existing.has("empresa_id")) where.push(...empresaScopeBuilder(ctx, "empresa_id", b, { nullable: escL.nullable }));
  if (q.search) {
    // campo sigiloso não entra na busca textual de quem não o vê (R1-2): a busca é uma pergunta sobre o valor
    const sf = def.fields.filter((f) => f.search && podeVerCampo(ctx, f)).map((f) => f.name);
    if (sf.length) { const p = b.add(`%${q.search}%`); where.push("(" + sf.map((c) => `${ident(c)}::text ilike ${p}`).join(" or ") + ")"); }
  }
  for (const [k, v] of Object.entries(filters)) {
    const adv = parseFilterKey(k);
    // SIGILO COMO PERGUNTA (R1-2): filtro por campo sigiloso sem a permissão → 403 com o nome do campo, antes de
    // qualquer consulta — `campo__op`, `campo=valor` e `campo_from`/`campo_to`
    if (adv) { exigirCampoVisivel(ctx, def, adv.field, "no filtro"); const f = def.fields.find((x) => x.name === adv.field); if (f && existing.has(adv.field) && !Array.isArray(v)) { const clause = advancedClause(f, adv.op, v, b); if (clause) where.push(clause); } continue; }
    exigirCampoVisivel(ctx, def, k, "no filtro");
    const f = def.fields.find((x) => x.name === k);
    if (f && existing.has(k)) {
      if (Array.isArray(v)) where.push(`${ident(k)} = any(${b.add(v)})`);
      else if (f.type === "boolean") where.push(`${ident(k)} = ${b.add(v === "true")}`);
      else if (f.type === "date") where.push(`${ident(k)} = ${b.add(v)}`);
      else where.push(`${ident(k)} = ${b.add(v)}`);
    } else if (/^(.+)_(from|to)$/.test(k)) {
      const m = /^(.+)_(from|to)$/.exec(k)!; const col = m[1]!;
      exigirCampoVisivel(ctx, def, col, "no filtro");
      if (existing.has(col)) where.push(`${ident(col)} ${m[2] === "from" ? ">=" : "<="} ${b.add(v)}`);
    }
  }
  if (q.sort) exigirCampoVisivel(ctx, def, q.sort, "na ordenação");
  const sortCol = q.sort && existing.has(q.sort) ? q.sort : (def.defaultSort && existing.has(def.defaultSort) ? def.defaultSort : (existing.has("created_at") ? "created_at" : "id"));
  const dir = q.dir ?? (sortCol === "created_at" ? "desc" : "asc");
  const wsql = where.length ? "where " + where.join(" and ") : "";
  const offset = (q.page - 1) * q.pageSize;
  // linhas + total na mesma consulta (contagem em janela): uma ida ao banco em vez de duas
  // ÁRVORE: sem ordenação escolhida pelo usuário, o cadastro hierárquico sai na ordem da árvore (pai antes
  // dos filhos) com `nivel`, `ancestrais` e `tem_filhos` — é o que a tela usa para recuar e recolher. A
  // chave do caminho é o código (ou o rótulo, onde não há código). Ordenar por uma coluna volta à lista plana.
  const arvore = Boolean(def.tree) && !q.sort && existing.has("parent_id") && existing.has("organization_id");
  const t = ident(def.table);
  const chave = ident(existing.has("code") ? "code" : def.labelField);
  const vivo = (a: string) => (def.softDelete ? `and ${a}.deleted_at is null` : "");
  // Raiz SEM código (acervo anterior ao código hierárquico, ex.: Grupos de Produtos da 0025) vai para o FIM,
  // com a subárvore dela; nos cadastros sem coluna de código a ordem é a de sempre.
  const semCodigo = (a: string) => (existing.has("code") ? `(${a}.code is null)` : "false");
  const rows = arvore
    ? await ctx.tx.query(`with recursive arv as (
          select r.id, ${semCodigo("r")} as sem_codigo, array[coalesce(r.${chave}::text, '')] as caminho, array[]::uuid[] as ancestrais, 0 as nivel from erp.${t} r
           where r.organization_id = ${b.add(ctx.orgId)} and (r.parent_id is null or not exists (select 1 from erp.${t} p where p.id = r.parent_id ${vivo("p")}))
          union all
          select c.id, a.sem_codigo, a.caminho || coalesce(c.${chave}::text, ''), a.ancestrais || a.id, a.nivel + 1 from erp.${t} c join arv a on c.parent_id = a.id where a.nivel < 20)
        select ${cols.map(ident).join(",")}, arv.nivel, arv.ancestrais, exists (select 1 from erp.${t} f where f.parent_id = ${t}.id ${vivo("f")}) as tem_filhos, count(*) over()::text as __total
          from erp.${t} join arv using (id) ${wsql} order by arv.sem_codigo, arv.caminho, id limit ${q.pageSize} offset ${offset}`, b.params)
    : await ctx.tx.query(`select ${cols.map(ident).join(",")}, count(*) over()::text as __total from erp.${ident(def.table)} ${wsql} order by ${ident(sortCol)} ${dir} nulls last, id limit ${q.pageSize} offset ${offset}`, b.params);
  let total = Number((rows.rows[0] as { __total?: string } | undefined)?.__total ?? 0);
  if (!rows.rows.length && q.page > 1) { const c = await ctx.tx.query<{ n: string }>(`select count(*) as n from erp.${ident(def.table)} ${wsql}`, b.params); total = Number(c.rows[0]!.n); }
  const labelRows = await refLabels(ctx, def, rows.rows as Record<string, unknown>[]);
  const items = rows.rows.map((r, i) => { const o = { ...(r as Record<string, unknown>), ...labelRows[i] } as Record<string, unknown>; delete o["__total"]; return semSigilo(ctx, def, o); });
  const pagina = { items, page: q.page, pageSize: q.pageSize, total };
  /**
   * ID Global na listagem genérica: o tipo vem da TABELA do recurso, pelo índice do catálogo — o Resource
   * Registry grava em dezenas de tabelas e só três delas são elegíveis hoje. Sem catálogo (a grande maioria)
   * a página sai exatamente como antes, sem consulta extra e sem coluna.
   */
  const tipoEntidade = tipoEntidadeDaTabela(def.table);
  return tipoEntidade ? paginaComIdGlobal(ctx, tipoEntidade, pagina) : pagina;
}

/** Rótulos de todas as referências das linhas numa única consulta (union all por recurso referenciado) → { campo_label } por linha. */
async function refLabels(ctx: ServiceCtx, def: ResourceDef, rows: Record<string, unknown>[]): Promise<Record<string, string | null>[]> {
  const refs = def.fields.filter((f) => f.type === "ref" && f.ref && getResource(f.ref.resource));
  const labels: Record<string, Record<string, string>> = {};
  const parts: string[] = []; const lb = new SqlBuilder();
  for (const f of refs) {
    const rdef = getResource(f.ref!.resource)!;
    const ids = [...new Set(rows.map((r) => r[f.name]).filter(Boolean))] as string[];
    if (!ids.length) continue;
    parts.push(`select ${lb.add(f.name)}::text as f, id::text as id, ${ident(rdef.labelField)}::text as label from erp.${ident(rdef.table)} where id = any(${lb.add(ids)}::uuid[])`);
  }
  if (parts.length) { const lr = await ctx.tx.query<{ f: string; id: string; label: string }>(parts.join(" union all "), lb.params); for (const r of lr.rows) (labels[r.f] ??= {})[r.id] = r.label; }
  const nomes = await nomesDasBuscas(ctx, def, rows);
  return rows.map((r, i) => { const o: Record<string, string | null> = {}; for (const f of refs) { const v = r[f.name] as string | null; o[`${f.name}_label`] = v ? labels[f.name]?.[v] ?? null : null; } return { ...o, ...nomes[i] }; });
}

/**
 * NOME DAS BUSCAS OFICIAIS (AJUSTES 02): `<campo>_nome` para todo campo com `busca` (município, banco, NCM, CBO) —
 * município "Pontes e Lacerda - MT", os demais só o nome (partes do domínio, nunca recorte do rótulo). UMA consulta
 * por referência (não por linha nem por campo); tabela e colunas saem da whitelist `getReferencia`. Código ausente ou
 * inexistente → null. Campo sigiloso que o usuário não vê não ganha `_nome` (o nome revelaria o valor).
 */
async function nomesDasBuscas(ctx: ServiceCtx, def: ResourceDef, rows: Record<string, unknown>[]): Promise<Record<string, string | null>[]> {
  const campos = def.fields.filter((f) => f.busca && getReferencia(f.busca) && podeVerCampo(ctx, f));
  const nomes = new Map<string, Map<string, string | null>>();
  for (const chave of [...new Set(campos.map((f) => f.busca as ChaveReferencia))]) {
    const ref = getReferencia(chave)!;
    const padrao = new RegExp(ref.padraoCodigo);
    const codigos = [...new Set(campos.filter((f) => f.busca === chave).flatMap((f) => rows.map((r) => r[f.name])).filter((v) => v !== null && v !== undefined).map(String).filter((v) => padrao.test(v)))];
    if (!codigos.length) continue;
    const extra = ref.colunaExtra ? `${ident(ref.colunaExtra)}::text` : "null::text";
    const r = await ctx.tx.query<{ codigo: string; nome: string | null; extra: string | null }>(
      `select ${ident(ref.colunaCodigo)}::text as codigo, ${ident(ref.colunaNome)}::text as nome, ${extra} as extra from erp.${ident(ref.tabela)} where ${ident(ref.colunaCodigo)} = any($1::${ref.codigoInteiro ? "int" : "text"}[])`,
      [ref.codigoInteiro ? codigos.map(Number) : codigos]);
    const m = new Map<string, string | null>();
    for (const x of r.rows) { const p = partesDaReferencia(chave, { codigo: x.codigo, nome: x.nome, extra: x.extra }); m.set(x.codigo, chave === "municipios" ? nomeDoMunicipio(p) : p.nome); }
    nomes.set(chave, m);
  }
  return rows.map((r) => {
    const o: Record<string, string | null> = {};
    for (const f of campos) { const v = r[f.name]; o[`${f.name}_nome`] = v === null || v === undefined ? null : nomes.get(f.busca!)?.get(String(v)) ?? null; }
    return o;
  });
}

export async function getOne(ctx: ServiceCtx, def: ResourceDef, id: string) {
  const existing = await checkColumns(ctx, def);
  const cols = listColumns(def).filter((c) => existing.has(c));
  const orgCond = existing.has("organization_id") ? (def.reference || def.sharedDefaults ? "and (organization_id is null or organization_id=$2)" : "and organization_id=$2") : "";
  const gp: unknown[] = orgCond ? [id, ctx.orgId] : [id];
  // fazenda: registro fora do escopo do membro não é visível (mesma regra da listagem)
  const escG = escopoDoRecurso(def);
  const farmCond = escG.ativo && existing.has("empresa_id") ? empresaScopeSql(ctx, "empresa_id", gp, { ignoreSelected: true, nullable: escG.nullable }) : "";
  // recorte FIXO: linha fora dele é a MESMA 404 de inexistente
  const fixoCond = Object.entries(def.filtroFixo ?? {}).map(([k, v]) => ` and ${ident(k)} = $${gp.push(v)}`).join("");
  const r = await ctx.tx.query(`select ${cols.map(ident).join(",")} from erp.${ident(def.table)} where id=$1 ${orgCond} ${def.softDelete ? "and deleted_at is null" : ""}${farmCond}${fixoCond}`, gp);
  if (!r.rows[0]) throw notFound(def.label);
  const row = r.rows[0] as Record<string, unknown>;
  return { ...semSigilo(ctx, def, row), ...(await refLabels(ctx, def, [row]))[0], ...(temFicha(def) ? await lerFicha(ctx, def, id) : {}) };
}

function coerceValue(f: FieldDef, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (f.type === "json") return JSON.stringify(v);
  if (f.type === "tags") return v;
  return v;
}

/**
 * `adiarIdGlobal` é interno da importação em lote, que reserva o ID Global de todas as linhas no fim do lote
 * (mesma transação): reservar linha a linha prenderia o contador da organização a importação inteira.
 */
export async function createOne(ctx: ServiceCtx, def: ResourceDef, body: unknown, opcoes: { adiarIdGlobal?: boolean; importacao?: boolean } = {}) {
  // cadastro que nasce por OUTRA porta (ex.: funcionário pelo CPF) não nasce pela genérica
  if (def.criacao) throw validation(def.criacao.mensagem);
  conferirSigiloNaCriacao(ctx, def);
  const data = validarCorpo(def, buildSchema(def), body);
  conferirPermissoesDaFicha(ctx, def, data);
  const escC = escopoDoRecurso(def);
  if (escC.ativo) {
    const pedida = (data["empresa_id"] as string | null | undefined) ?? null;
    // Registro SEM empresa alcança TODAS elas: um congelamento financeiro sem empresa fecha o período da
    // organização inteira. Quem não enxerga todas as empresas do módulo precisa dizer qual é a empresa.
    if (escC.nullable && !pedida) exigirEscopoTotalDoModulo(ctx, def.label);
    await exigirEmpresaDeLancamento(ctx, pedida);
  }
  // A EMPRESA é o único cadastro cuja RLS de leitura depende do escopo do próprio membro: a linha nasce
  // fora do escopo de todo mundo. Ver `exigirEscopoTotalDaOrganizacao`.
  if (def.table === "empresas") exigirEscopoTotalDaOrganizacao(ctx, def.label);
  // CÓDIGO GERADO NO SERVIDOR (decisão 257 D-1/D-2), sob a trava da numeração, ANTES das regras da árvore:
  // elas conferem o código gerado como confeririam um digitado (máscara, prefixo do superior)
  await gerarCodigoNaCriacao(ctx, def, data, Boolean(opcoes.importacao));
  const sequencial = await gerarCodigoSequencial(ctx, def, data);
  await conferirRegrasDaArvore(ctx, def, null, data, null);
  await conferirRegrasDoCadastro(ctx, def, null, data, null);
  const existing = await checkColumns(ctx, def);
  const cols: string[] = []; const vals: unknown[] = [];
  if (existing.has("organization_id")) { cols.push("organization_id"); vals.push(ctx.orgId); }
  if (sequencial !== null) { cols.push("code"); vals.push(sequencial); }
  else if (def.codeEntity && existing.has("code") && !data["code"]) {
    // mesma trava do Zerar numeração (decisão 257 D-3): o Novo e o Zerar se esperam
    await travarNumeracao(ctx, def);
    cols.push("code"); vals.push(await nextCode(ctx.tx, ctx.orgId, def.codeEntity, def.key === "products" ? 5 : 4));
  }
  if (existing.has("created_by")) { cols.push("created_by"); vals.push(ctx.user.id); }
  if (escC.ativo && existing.has("empresa_id") && !data["empresa_id"] && ctx.empresaId) { cols.push("empresa_id"); vals.push(ctx.empresaId); }
  for (const f of camposDeEscrita(def)) {
    if (f.readOnly || !(f.name in data) || !existing.has(f.name)) continue;
    const v = coerceValue(f, data[f.name]); if (v === undefined) continue;
    cols.push(f.name); vals.push(v);
  }
  // O código da Empresa é `int not null` e não vem do cliente (campo `readOnly`). A condição olha a TABELA
  // canônica, não a chave do recurso: a renomeação trocou a chave de `farms` para `empresas` e a comparação
  // por chave virou letra morta em silêncio — o INSERT passou a sair sem `code` e a violar o NOT NULL.
  // A chave da SEQUÊNCIA é `SEQUENCIA_EMPRESA`, hoje CANÔNICA (`'empresa'`), e ela e o dado viraram JUNTOS:
  // a `0018_empresa_code_sequence.sql` moveu a linha de `erp.code_sequences` com um `update`, e é por isso
  // que a numeração continua de onde parou. Trocar uma sem a outra reiniciaria o cadastro de Empresa em 1 —
  // ver `lib/sequencia-empresa.ts` e `docs/PRE-BASE2-05C-2-CUTOVER.md`.
  if (def.table === "empresas" && !cols.includes("code")) { cols.push("code"); vals.push(Number(await nextCode(ctx.tx, ctx.orgId, SEQUENCIA_EMPRESA, 1))); }
  const r = await ctx.tx.query(`insert into erp.${ident(def.table)} (${cols.map(ident).join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals);
  const id = (r.rows[0] as { id: string }).id;
  // PORTA GENÉRICA, REGRA ÚNICA: este `insert` grava em dezenas de tabelas, e algumas delas (produto,
  // pessoa, equipamento, perfil de acesso) são elegíveis a ID Global. A elegibilidade NÃO é decidida aqui
  // com um `if` por tabela — quem decide é o catálogo (`ENTIDADES_ID_GLOBAL`). Tabela fora do catálogo
  // devolve null sem erro; tabela dentro dele recebe o número na MESMA transação do cadastro.
  if (!opcoes.adiarIdGlobal) await atribuirIdGlobalSeAplicavel(ctx, def.table, id);
  // FICHA EM ABAS: grades e perfis na MESMA transação — erro aqui desfaz também o principal
  if (temFicha(def)) await gravarFicha(ctx, def, id, data, null);
  if (def.key === "people") await atualizarSituacaoReceita(ctx, id);
  return getOne(ctx, def, id);
}

export async function updateOne(ctx: ServiceCtx, def: ResourceDef, id: string, body: unknown) {
  const atual = await getOne(ctx, def, id);
  const data = validarCorpo(def, buildSchema(def, true), body);
  conferirPermissoesDaFicha(ctx, def, data);
  fundirCamposJson(def, data, atual);
  conferirCodigoSequencialNaEdicao(def, data, atual);
  // registro do acervo SEM código numa árvore com código travado ganha o código gerado ao salvar (A-7)
  const codigoGerado = await gerarCodigoNaEdicao(ctx, def, data, atual);
  await conferirRegrasDaArvore(ctx, def, id, data, atual, { codigoGerado });
  await conferirRegrasDoCadastro(ctx, def, id, data, atual);
  const existing = await checkColumns(ctx, def);
  const sets: string[] = []; const vals: unknown[] = [];
  for (const f of camposDeEscrita(def)) {
    if (f.readOnly || !(f.name in data) || !existing.has(f.name)) continue;
    const v = coerceValue(f, data[f.name]); if (v === undefined) continue;
    vals.push(v); sets.push(`${ident(f.name)} = $${vals.length}`);
  }
  if (sets.length) {
    vals.push(id);
    const orgCond = existing.has("organization_id") && !def.reference ? `and organization_id = $${vals.push(ctx.orgId)}` : "";
    await ctx.tx.query(`update erp.${ident(def.table)} set ${sets.join(", ")} where id = $${vals.indexOf(id) + 1} ${orgCond}`, vals);
  }
  // FICHA EM ABAS: detalhe AUSENTE não é tocado; PRESENTE é a lista completa (mesma transação)
  if (temFicha(def)) await gravarFicha(ctx, def, id, data, atual);
  if (def.key === "people" && "document" in data) await atualizarSituacaoReceita(ctx, id);
  return getOne(ctx, def, id);
}

export async function deleteOne(ctx: ServiceCtx, def: ResourceDef, id: string) {
  await getOne(ctx, def, id);
  // o registro de um cadastro com porta própria de criação é a linha de OUTRO cadastro (funcionário = parceiro)
  if (def.criacao) throw validation(`${def.label}: exclua pelo cadastro de origem`);
  await conferirExclusaoNaArvore(ctx, def, id);
  const existing = await checkColumns(ctx, def);
  const orgCond = existing.has("organization_id") && !def.reference ? "and organization_id=$2" : "";
  const params = orgCond ? [id, ctx.orgId] : [id];
  if (def.softDelete) await ctx.tx.query(`update erp.${ident(def.table)} set deleted_at = now() where id=$1 ${orgCond}`, params);
  else await ctx.tx.query(`delete from erp.${ident(def.table)} where id=$1 ${orgCond}`, params);
  return { id, deleted: true };
}

/**
 * Leituras que o registry DECLARA para as linhas de uma tabela quando ela é grade de OUTRO cadastro
 * (`DetalheDef.permissoes.ler`, R1-2 — Eventos fixos na ficha de RH: `employee_events.view`). O seletor
 * (`/options`) é a porta SEM permissão própria dos cadastros REFERENCIADOS; sobre essas tabelas ele leria as mesmas
 * linhas que a ficha esconde de quem não tem a leitura (`?person_id=` lista os eventos fixos do funcionário e
 * `?amount=` confirma o valor por tentativa), então exige as MESMAS permissões, antes de consultar.
 */
function leiturasDeclaradasDaTabela(table: string): string[] {
  return [...new Set(RESOURCES.flatMap((r) => (r.detalhes ?? []).flatMap((d) => (d.table === table && d.permissoes ? [d.permissoes.ler] : []))))];
}

/** Opções para selects (busca por rótulo, limitada), respeitando tenant/fazenda. */
export async function options(ctx: ServiceCtx, def: ResourceDef, search: string | undefined, extra: Record<string, string>) {
  const existing = await checkColumns(ctx, def);
  const b = new SqlBuilder(); const where: string[] = [];
  // labelField que é referência (ex.: authorizers.user_id) mostra o rótulo da tabela referenciada
  const lf = def.fields.find((f) => f.name === def.labelField);
  const refDef = lf?.type === "ref" && lf.ref ? getResource(lf.ref.resource) : undefined;
  const labelExpr = refDef ? `r.${ident(refDef.labelField)}::text` : `t.${ident(def.labelField)}::text`;
  const join = refDef ? `left join erp.${ident(refDef.table)} r on r.id = t.${ident(def.labelField)}` : "";
  if (existing.has("organization_id")) where.push(def.reference || def.sharedDefaults ? `(t.organization_id is null or t.organization_id=${b.add(ctx.orgId)})` : `t.organization_id=${b.add(ctx.orgId)}`);
  // Usuários são globais (sem organization_id): restringe aos membros ativos da organização atual (isolamento multi-tenant)
  if (def.table === "users") where.push(`t.id in (select m.user_id from erp.organization_members m where m.organization_id=${b.add(ctx.orgId)} and m.is_active)`);
  if (def.softDelete) where.push("t.deleted_at is null");
  for (const [k, v] of Object.entries(def.filtroFixo ?? {})) where.push(`t.${ident(k)} = ${b.add(v)}`);
  if (existing.has("is_active") && !extra["include_inactive"]) where.push("t.is_active");
  // autocomplete de recurso por fazenda: só fazendas autorizadas (a fazenda selecionada é filtro do chamador via `extra.empresa_id`)
  const escO = escopoDoRecurso(def);
  if (escO.ativo && existing.has("empresa_id")) where.push(...empresaScopeBuilder(ctx, "t.empresa_id", b, { nullable: escO.nullable }));
  // árvore com código: a busca acha também pelo código ("1.01"), e a ordem é a da árvore (o código).
  const arvore = Boolean(def.tree) && existing.has("parent_id") && existing.has("code") && !refDef;
  if (search) where.push(arvore ? `(${labelExpr} ilike ${b.add(`%${search}%`)} or t.code ilike ${b.add(`${escapeLike(search)}%`)})` : `${labelExpr} ilike ${b.add(`%${search}%`)}`);
  // filtro do seletor (`?campo=valor`) por campo sigiloso também é pergunta sobre o valor (R1-2)
  for (const k of Object.keys(extra)) exigirCampoVisivel(ctx, def, k, "no filtro do seletor");
  for (const [k, v] of Object.entries(extra)) if (existing.has(k) && k !== "include_inactive") where.push(`t.${ident(k)} = ${b.add(v)}`);
  const codeSel = existing.has("code") ? ", t.code::text as code" : ", null as code";
  const kindSel = arvore && existing.has("kind") ? ", t.kind::text as kind" : "";
  const r = await ctx.tx.query(`select t.id, ${labelExpr} as label ${codeSel}${kindSel} from erp.${ident(def.table)} t ${join} ${where.length ? "where " + where.join(" and ") : ""} order by ${arvore ? "t.code, 2" : "2"} limit 200`, b.params);
  if (!arvore || !r.rows.length) return r.rows;
  const caminhos = await caminhosNaArvore(ctx, def, r.rows.map((x) => String((x as { id: string }).id)));
  return r.rows.map((x) => ({ ...x, caminho: caminhos.get(String((x as { id: string }).id)) ?? null }));
}

/**
 * CAMINHO de cada registro de uma árvore com código — "1 Insumos › 1.01 Fertilizantes" (CADASTROS Fase 7,
 * decisão 256). UMA consulta recursiva para o lote inteiro (sem N+1), presa à organização do contexto em
 * cada passo; profundidade limitada (a máscara tem no máximo 8 níveis) para um ciclo antigo não girar.
 */
export async function caminhosNaArvore(ctx: ServiceCtx, def: ResourceDef, ids: string[]): Promise<Map<string, string>> {
  const tbl = `erp.${ident(def.table)}`; const nome = ident(def.labelField);
  const r = await ctx.tx.query<{ origem: string; caminho: string }>(
    `with recursive c as (
       select t.id as origem, t.parent_id, concat_ws(' ', t.code, t.${nome}::text) as caminho, 0 as d from ${tbl} t where t.id = any($1::uuid[]) and t.organization_id=$2
       union all
       select c.origem, p.parent_id, concat_ws(' ', p.code, p.${nome}::text) || ' › ' || c.caminho, c.d + 1 from c join ${tbl} p on p.id=c.parent_id and p.organization_id=$2 where c.d < 16)
     select distinct on (origem) origem, caminho from c order by origem, d desc`, [ids, ctx.orgId]);
  return new Map(r.rows.map((x) => [x.origem, x.caminho]));
}

/**
 * Valores distintos de um campo filtrável (lista do chip de filtro do modelo base), com contagem e rótulo resolvido para
 * referências. Respeita tenant/fazenda como a listagem e nunca aceita nome de coluna do cliente (só campos da definição).
 */
export async function distinctValues(ctx: ServiceCtx, def: ResourceDef, campoPedido: string, search: string | undefined, limit: number) {
  const field = campoPedido;
  const f = def.fields.find((x) => x.name === field && (x.filter || x.list)); if (!f) throw validation("Campo não filtrável");
  // os valores distintos de um campo sigiloso SÃO os valores (R1-2)
  exigirCampoVisivel(ctx, def, f.name, "nos valores distintos");
  const existing = await checkColumns(ctx, def); if (!existing.has(f.name)) return [];
  const b = new SqlBuilder(); const where: string[] = [];
  if (existing.has("organization_id")) where.push(def.reference || def.sharedDefaults ? `(t.organization_id is null or t.organization_id = ${b.add(ctx.orgId)})` : `t.organization_id = ${b.add(ctx.orgId)}`);
  if (def.softDelete) where.push("t.deleted_at is null");
  for (const [k, v] of Object.entries(def.filtroFixo ?? {})) where.push(`t.${ident(k)} = ${b.add(v)}`);
  // mesmo recorte da listagem: fazenda ativa e fazendas do vínculo
  const escD = escopoDoRecurso(def);
  if (escD.ativo && ctx.empresaId && existing.has("empresa_id")) where.push(escD.nullable ? `(t.empresa_id is null or t.empresa_id = ${b.add(ctx.empresaId)})` : `t.empresa_id = ${b.add(ctx.empresaId)}`);
  if (escD.ativo && existing.has("empresa_id")) where.push(...empresaScopeBuilder(ctx, "t.empresa_id", b, { nullable: escD.nullable }));
  const col = `t.${ident(f.name)}`;
  const rdef = f.type === "ref" && f.ref ? getResource(f.ref.resource) : undefined;
  const labelExpr = rdef ? `r.${ident(rdef.labelField)}::text` : f.type === "tags" ? "x.tag" : `${col}::text`;
  const from = rdef ? `erp.${ident(def.table)} t left join erp.${ident(rdef.table)} r on r.id = ${col}` : f.type === "tags" ? `erp.${ident(def.table)} t, unnest(${col}) as x(tag)` : `erp.${ident(def.table)} t`;
  const valueExpr = f.type === "tags" ? "x.tag" : `${col}::text`;
  where.push(`${col} is not null`);
  if (search) where.push(`${labelExpr} ilike ${b.add(`%${escapeLike(search)}%`)}`);
  const r = await ctx.tx.query<{ value: string; label: string | null; n: string }>(`select ${valueExpr} as value, ${labelExpr} as label, count(*)::text as n from ${from} where ${where.join(" and ")} group by 1, 2 order by 2 nulls last, 1 limit ${Math.min(Math.max(limit, 1), 500)}`, b.params);
  return r.rows.map((x) => ({ value: x.value, label: f.type === "select" ? f.options?.find((o) => o.value === x.value)?.label ?? x.value : f.type === "boolean" ? (x.value === "true" ? "Sim" : "Não") : x.label ?? x.value, count: Number(x.n) }));
}

export default async function resourceRoutes(app: FastifyInstance) {
  app.get("/resources", async (req) => { const ctx = app.requireCtx(req); return RESOURCES.filter((r) => hasPermission(ctx, `${r.permission}.view`)).map(({ key, label, labelPlural, route, permission }) => ({ key, label, labelPlural, route, permission })); });
  app.get("/resources/:key/definition", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); app.requireCtx(req); return def; });
  app.get("/resources/:key", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.view`, (ctx) => listResource(ctx, def, req.query as Record<string, unknown>)); });
  app.get("/resources/:key/options", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const { search, ...extra } = req.query as Record<string, string>; // seletor de um cadastro referenciado: sem permissão própria, mas o ESCOPO é o do recurso apontado
    return runService(app, req, null, async (ctx) => {
      // linhas de grade de OUTRO cadastro com leitura declarada (R1-2): a mesma leitura, antes de qualquer consulta
      for (const p of leiturasDeclaradasDaTabela(def.table)) requirePermission(ctx, p);
      return options(await comPermissaoResolvida(ctx, `${def.permission}.view`), def, search, extra);
    }); });
  app.get("/resources/:key/proximo-codigo", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const q = z.object({ parent_id: z.string().uuid().optional() }).strict().parse(req.query); return runService(app, req, `${def.permission}.create`, async (ctx) => def.codigoAutomatico === "sequencial" && !q.parent_id ? { codigo: await proximoCodigo(ctx, def), mascara: null } : sugerirCodigo(ctx, def, q.parent_id ?? null)); });
  app.get("/resources/:key/distinct", async (req) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const q = z.object({ field: z.string().regex(/^[a-z_][a-z0-9_]*$/), search: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query); return runService(app, req, `${def.permission}.view`, (ctx) => distinctValues(ctx, def, q.field, q.search, q.limit)); });
  // HISTÓRICO (Fase 6): auditoria do registro e das suas grades — quem, quando, o quê. Mesma permissão e mesma 404 da ficha.
  app.get("/resources/:key/:id/historico", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); const q = pageQuerySchema.parse(req.query); return runService(app, req, `${def.permission}.view`, async (ctx) => { await getOne(ctx, def, id); return historicoDoRegistro(ctx, def, id, q.page, q.pageSize); }); });
  // MOVER COM RENUMERAÇÃO (decisão 257 D-5): prévia e execução usam o MESMO plano. `superior=raiz` = raiz.
  // Id que não é UUID (A-10) é a MESMA 404 de inexistente — depois da permissão, nunca o 500 do cast do banco.
  const registroDoMover = async (ctx: ServiceCtx, def: ResourceDef, id: string) => { if (!UUID.test(id)) throw notFound(def.label); await getOne(ctx, def, id); };
  app.get("/resources/:key/:id/mover/previa", async (req) => {
    const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso");
    const q = z.object({ superior: z.union([z.literal("raiz"), z.string().uuid()]) }).strict().parse(req.query);
    return runService(app, req, `${def.permission}.edit`, async (ctx) => { await registroDoMover(ctx, def, id); return planejarMover(ctx, def, id, q.superior === "raiz" ? null : q.superior); });
  });
  app.post("/resources/:key/:id/mover", async (req) => {
    const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso");
    const b = z.object({ superior: z.string().uuid().nullable() }).strict().parse(req.body);
    return runService(app, req, `${def.permission}.edit`, async (ctx) => { await registroDoMover(ctx, def, id); return moverNaArvore(ctx, def, id, b.superior); });
  });
  app.get("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.view`, (ctx) => getOne(ctx, def, id)); });
  // NUMERAÇÃO DOS CADASTROS (decisão 257 D-3): consulta e Zerar, só com `tenant_parameters.edit`
  app.get("/admin/numeracao", async (req) => runService(app, req, "tenant_parameters.edit", (ctx) => numeracaoDosCadastros(ctx)));
  app.get("/admin/numeracao/:cadastro", async (req) => { const { cadastro } = req.params as { cadastro: string }; return runService(app, req, "tenant_parameters.edit", (ctx) => linhaDaNumeracao(ctx, cadastro)); });
  app.post("/admin/numeracao/:cadastro/zerar", async (req) => { const { cadastro } = req.params as { cadastro: string }; return runService(app, req, "tenant_parameters.edit", (ctx) => zerarNumeracao(ctx, cadastro)); });
  app.post("/resources/:key", async (req, reply) => { const def = getResource((req.params as { key: string }).key); if (!def) throw notFound("Recurso"); const r = await runService(app, req, `${def.permission}.create`, (ctx) => createOne(ctx, def, req.body)); return reply.status(201).send(r); });
  app.put("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.edit`, (ctx) => updateOne(ctx, def, id, req.body)); });
  app.delete("/resources/:key/:id", async (req) => { const { key, id } = req.params as { key: string; id: string }; const def = getResource(key); if (!def) throw notFound("Recurso"); return runService(app, req, `${def.permission}.delete`, (ctx) => { requirePermission(ctx, `${def.permission}.delete`); return deleteOne(ctx, def, id); }); });
}
