/**
 * FICHA EM ABAS — a parte do servidor do mecanismo genérico do registry (CADASTROS Fase 4, decisão 253).
 *
 * A declaração mora em `@agro/domain` (`ResourceDef.abas`, `detalhes`, `perfis` — ver `AbaDef` em
 * packages/domain/src/resources/types.ts). Aqui:
 *  · `shapeDaFicha`     — chaves extras do corpo (`<detalhe>: linha[]`, `<perfil>: {…}`), ESTRITAS;
 *  · `validarCorpo`     — parse com o erro apontando ABA, DETALHE e LINHA (1-based) em `details[]`;
 *  · `gravarFicha`      — grava detalhes e perfis na MESMA transação do principal (quem chama é o
 *                         `createOne`/`updateOne`, dentro do `runService`): qualquer erro desfaz tudo;
 *  · `lerFicha`         — grades e perfis do registro, uma consulta por tabela (nunca por linha).
 *
 * Nomes de tabela e coluna saem SEMPRE da definição estática do registry, nunca do corpo.
 */
import { z, ZodError } from "zod";
import { getResource, type DetalheDef, type FieldDef, type PerfilDef, type ResourceDef } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { ident } from "./sql.js";
import { fromPgError, validation } from "./errors.js";
import { exigirEmpresaDeLancamento, type ServiceCtx } from "./context.js";
import { translateIssue } from "../plugins/errors.js";

type Linha = Record<string, unknown>;
type SchemaDeCampo = (f: FieldDef) => z.ZodTypeAny;

export const temFicha = (def: ResourceDef) => Boolean(def.detalhes?.length || def.perfis?.length);

/** Aba em que a grade/perfil (ou o campo, pela seção) aparece — para o erro apontar a aba certa. */
export function abaDe(def: ResourceDef, alvo: { detalhe?: string; perfil?: string; campo?: string }): string | null {
  const abas = def.abas ?? [];
  if (alvo.detalhe) return abas.find((a) => a.detalhes?.includes(alvo.detalhe!))?.key ?? null;
  if (alvo.perfil) return abas.find((a) => a.perfis?.includes(alvo.perfil!))?.key ?? null;
  if (alvo.campo) {
    const f = def.fields.find((x) => x.name === alvo.campo);
    return (f?.section ? abas.find((a) => a.secoes?.includes(f.section!))?.key : undefined) ?? abas[0]?.key ?? null;
  }
  return null;
}

function linhaSchema(d: DetalheDef, schemaDoCampo: SchemaDeCampo) {
  const shape: Record<string, z.ZodTypeAny> = {};
  if (!d.chaveNatural) shape["id"] = z.string().uuid().optional();
  for (const f of d.fields) {
    if (f.readOnly) continue;
    const t = schemaDoCampo(f);
    if (f.type === "boolean") { shape[f.name] = t.optional().default(Boolean(f.default ?? false)); continue; }
    shape[f.name] = f.required ? t : t.nullable().optional();
  }
  return z.object(shape).strict();
}

function perfilSchema(p: PerfilDef, schemaDoCampo: SchemaDeCampo) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of p.fields) if (!f.readOnly) shape[f.name] = schemaDoCampo(f).nullable().optional();
  return z.object(shape).strict();
}

/** Chaves que a ficha acrescenta ao corpo do principal. Sem ficha = nenhuma (o contrato de hoje). */
export function shapeDaFicha(def: ResourceDef, schemaDoCampo: SchemaDeCampo): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const d of def.detalhes ?? []) shape[d.key] = z.array(linhaSchema(d, schemaDoCampo)).max(d.maxLinhas ?? 200).optional();
  for (const p of def.perfis ?? []) shape[p.key] = perfilSchema(p, schemaDoCampo).optional();
  return shape;
}

/** Detalhe do erro no formato da API, com a aba e a linha (1-based) quando o caminho está numa grade. */
export function detalheDoErro(def: ResourceDef, path: (string | number)[], message: string) {
  const [raiz, idx] = path;
  const d = def.detalhes?.find((x) => x.key === raiz);
  const p = def.perfis?.find((x) => x.key === raiz);
  const aba = d ? abaDe(def, { detalhe: d.key }) : p ? abaDe(def, { perfil: p.key }) : abaDe(def, { campo: String(raiz ?? "") });
  return { path: path.join("."), message, aba, ...(d ? { detalhe: d.key, linha: typeof idx === "number" ? idx + 1 : null } : {}), ...(p ? { perfil: p.key } : {}) };
}

/**
 * Parse do corpo. Cadastro SEM ficha: exatamente o `parse` de sempre (o erro sai pelo tratador global).
 * Com ficha: o 422 ganha `aba`/`detalhe`/`linha` em cada item de `details` — é o que a tela usa para contar
 * erros por aba e marcar a linha da grade.
 */
export function validarCorpo(def: ResourceDef, schema: z.ZodTypeAny, body: unknown): Linha {
  if (!def.abas?.length) return schema.parse(body) as Linha;
  try { return schema.parse(body) as Linha; } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    const details = e.issues.map((i) => detalheDoErro(def, i.path as (string | number)[], translateIssue(i)));
    const primeiro = details[0]!;
    throw validation(details.length === 1 ? `${primeiro.path}: ${primeiro.message}` : "Dados inválidos", details);
  }
}

const colunasCache = new Map<string, Set<string>>();
async function colunas(ctx: ServiceCtx, tabela: string): Promise<Set<string>> {
  const hit = colunasCache.get(tabela); if (hit) return hit;
  const r = await ctx.tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='erp' and table_name=$1", [tabela]);
  const set = new Set(r.rows.map((x) => x.column_name)); if (set.size) colunasCache.set(tabela, set);
  return set;
}
export function limparCacheDaFicha() { colunasCache.clear(); }

function valorDaColuna(f: FieldDef, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (f.type === "json") return JSON.stringify(v);
  return v;
}

/** Referência (uuid) de detalhe/perfil: a linha apontada existe e é DESTA organização — uma consulta por campo. */
async function conferirReferencias(ctx: ServiceCtx, def: ResourceDef, fields: FieldDef[], linhas: Linha[], onde: (i: number, f: FieldDef) => (string | number)[]) {
  for (const f of fields) {
    if (f.type !== "ref" || !f.ref) continue;
    const alvo = getResource(f.ref.resource); if (!alvo) continue;
    const valores = [...new Set(linhas.map((l) => l[f.name]).filter((x): x is string => typeof x === "string" && x !== ""))];
    if (!valores.length) continue;
    const cols = await colunas(ctx, alvo.table);
    const org = cols.has("organization_id") ? (alvo.sharedDefaults || alvo.reference ? " and (organization_id is null or organization_id = $2)" : " and organization_id = $2") : "";
    const vivo = alvo.softDelete ? " and deleted_at is null" : "";
    const r = await ctx.tx.query<{ id: string }>(`select id::text as id from erp.${ident(alvo.table)} where id = any($1::uuid[])${org}${vivo}`, org ? [valores, ctx.orgId] : [valores]);
    const ok = new Set(r.rows.map((x) => x.id));
    const i = linhas.findIndex((l) => typeof l[f.name] === "string" && l[f.name] !== "" && !ok.has(l[f.name] as string));
    if (i >= 0) throw validation(`${f.label}: selecione um valor válido`, [detalheDoErro(def, onde(i, f), "Selecione um valor válido")]);
  }
}

/** Erro de banco numa linha da grade: vira o erro da API apontando a aba e a linha. */
function erroNaLinha(def: ResourceDef, d: DetalheDef, i: number, e: unknown): never {
  const de = e instanceof DomainError ? e : fromPgError(e);
  if (!de) throw e;
  const det = detalheDoErro(def, [d.key, i], de.message);
  throw new DomainError(de.code, `${d.label}, linha ${i + 1}: ${de.message}`, [det]);
}

async function gravarDetalhe(ctx: ServiceCtx, def: ResourceDef, d: DetalheDef, paiId: string, linhas: Linha[]) {
  const cols = await colunas(ctx, d.table);
  const org = Boolean(d.organizacao) && cols.has("organization_id");
  const soft = Boolean(d.softDelete) && cols.has("deleted_at");
  const chave = d.chaveNatural ?? "id";
  const campos = d.fields.filter((f) => !f.readOnly && cols.has(f.name));
  await conferirReferencias(ctx, def, d.fields, linhas, (i, f) => [d.key, i, f.name]);
  if (d.campoEmpresa) for (const [i, l] of linhas.entries()) { try { await exigirEmpresaDeLancamento(ctx, (l[d.campoEmpresa] as string | null) ?? null); } catch (e) { erroNaLinha(def, d, i, e); } }

  // o que existe hoje (vivo) desta ficha — a lista enviada é a lista COMPLETA
  const filtro = (a: number, b: number) => `${ident(d.chavePai)} = $${a}${org ? ` and organization_id = $${b}` : ""}${soft ? " and deleted_at is null" : ""}`;
  const filtroPai = filtro(1, 2);
  const pp: unknown[] = org ? [paiId, ctx.orgId] : [paiId];
  const atuais = new Set((await ctx.tx.query<{ k: string }>(`select ${ident(chave)}::text as k from erp.${ident(d.table)} where ${filtroPai}`, pp)).rows.map((r) => r.k));
  const enviados = new Set<string>();
  for (const [i, l] of linhas.entries()) {
    const k = l[chave] === undefined || l[chave] === null ? null : String(l[chave]);
    if (k !== null) {
      if (enviados.has(k)) erroNaLinha(def, d, i, validation("linha repetida na grade"));
      enviados.add(k);
      // `id` que não é desta ficha nunca é aceito (nem de outro parceiro, nem de outra organização)
      if (!d.chaveNatural && !atuais.has(k)) erroNaLinha(def, d, i, validation("linha não pertence a este registro"));
    }
  }
  // removidas primeiro: a chave natural pode ser reaproveitada por uma linha nova
  for (const k of atuais) {
    if (enviados.has(k)) continue;
    const r = soft
      ? await ctx.tx.query(`update erp.${ident(d.table)} set deleted_at = now() where ${ident(chave)}::text = $${pp.length + 1} and ${filtroPai}`, [...pp, k])
      : await ctx.tx.query(`delete from erp.${ident(d.table)} where ${ident(chave)}::text = $${pp.length + 1} and ${filtroPai}`, [...pp, k]).catch((e: unknown) => { throw fromPgError(e) ?? e; });
    if (r.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", `${d.label}: a linha mudou durante a gravação; recarregue a ficha`);
  }
  for (const [i, l] of linhas.entries()) {
    const k = l[chave] === undefined || l[chave] === null ? null : String(l[chave]);
    try {
      if (k !== null && atuais.has(k)) {
        const vals: unknown[] = []; const sets: string[] = [];
        for (const f of campos) { if (f.name === chave || !(f.name in l)) continue; vals.push(valorDaColuna(f, l[f.name])); sets.push(`${ident(f.name)} = $${vals.length}`); }
        if (!sets.length) continue;
        const base = vals.length;
        const r = await ctx.tx.query(`update erp.${ident(d.table)} set ${sets.join(", ")} where ${ident(chave)}::text = $${base + 1} and ${filtro(base + 2, base + 3)}`, [...vals, k, ...pp]);
        if (r.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", "a linha mudou durante a gravação; recarregue a ficha");
      } else {
        const cs: string[] = [d.chavePai]; const vs: unknown[] = [paiId];
        if (org) { cs.push("organization_id"); vs.push(ctx.orgId); }
        for (const f of campos) { if (!(f.name in l)) continue; const v = valorDaColuna(f, l[f.name]); if (v === undefined) continue; cs.push(f.name); vs.push(v); }
        const r = await ctx.tx.query(`insert into erp.${ident(d.table)} (${cs.map(ident).join(",")}) values (${vs.map((_, j) => `$${j + 1}`).join(",")})`, vs);
        if (r.rowCount !== 1) throw new DomainError("CONFLICT", "linha não gravada");
      }
    } catch (e) { erroNaLinha(def, d, i, e); }
  }
}

async function gravarPerfil(ctx: ServiceCtx, def: ResourceDef, p: PerfilDef, paiId: string, data: Linha, atual: Linha | null) {
  const cols = await colunas(ctx, p.table);
  const corpo = data[p.key] as Linha | undefined;
  const flag = p.ativoPor;
  const ativo = flag ? (flag in data ? Boolean(data[flag]) : Boolean(atual?.[flag])) : true;
  const flagMudou = Boolean(flag && flag in data && (atual === null ? ativo : Boolean(atual[flag]) !== ativo));
  if (corpo === undefined && !flagMudou) return;
  if (corpo) await conferirReferencias(ctx, def, p.fields, [corpo], (_i, f) => [p.key, f.name]);
  const temAtivo = cols.has("is_active");
  if (corpo === undefined && !ativo) {
    // DESMARCAR não apaga: inativa (0 linha = perfil nunca existiu, nada a inativar)
    if (temAtivo) await ctx.tx.query(`update erp.${ident(p.table)} set is_active = false where ${ident(p.chavePai)} = $1`, [paiId]);
    return;
  }
  const cs: string[] = [p.chavePai]; const vs: unknown[] = [paiId];
  if (temAtivo) { cs.push("is_active"); vs.push(ativo); }
  for (const f of p.fields) { if (f.readOnly || !corpo || !(f.name in corpo) || !cols.has(f.name)) continue; const v = valorDaColuna(f, corpo[f.name]); if (v === undefined) continue; cs.push(f.name); vs.push(v); }
  const sets = cs.slice(1).map((c) => `${ident(c)} = excluded.${ident(c)}`);
  const r = await ctx.tx.query(`insert into erp.${ident(p.table)} (${cs.map(ident).join(",")}) values (${vs.map((_, j) => `$${j + 1}`).join(",")}) on conflict (${ident(p.chavePai)}) do ${sets.length ? `update set ${sets.join(", ")}` : "nothing"}`, vs)
    .catch((e: unknown) => { const de = fromPgError(e); if (!de) throw e; throw new DomainError(de.code, `${p.label}: ${de.message}`, [detalheDoErro(def, [p.key], de.message)]); });
  if (sets.length && r.rowCount !== 1) throw new DomainError("CONFLICT", `${p.label}: perfil não gravado`);
}

/**
 * Grava detalhes e perfis de UM registro. Chamado pelo `createOne`/`updateOne` DEPOIS do principal e DENTRO da
 * mesma transação. `atual` = registro antes da alteração (null na criação).
 * Detalhe AUSENTE no corpo não é tocado; PRESENTE é a lista completa.
 */
export async function gravarFicha(ctx: ServiceCtx, def: ResourceDef, id: string, data: Linha, atual: Linha | null) {
  for (const d of def.detalhes ?? []) { const linhas = data[d.key]; if (Array.isArray(linhas)) await gravarDetalhe(ctx, def, d, id, linhas as Linha[]); }
  for (const p of def.perfis ?? []) await gravarPerfil(ctx, def, p, id, data, atual);
}

/** Grades e perfis do registro nas mesmas chaves do corpo. Uma consulta por tabela. */
export async function lerFicha(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<Linha> {
  const out: Linha = {};
  for (const d of def.detalhes ?? []) {
    const cols = await colunas(ctx, d.table);
    if (!cols.size) { out[d.key] = []; continue; }
    const org = Boolean(d.organizacao) && cols.has("organization_id");
    const soft = Boolean(d.softDelete) && cols.has("deleted_at");
    const sel = [...(d.chaveNatural ? [] : ["id"]), ...d.fields.map((f) => f.name).filter((c) => cols.has(c))];
    const ordem = cols.has("created_at") ? "created_at, " : "";
    const r = await ctx.tx.query(`select ${[...new Set(sel)].map(ident).join(",")} from erp.${ident(d.table)} where ${ident(d.chavePai)} = $1${org ? " and organization_id = $2" : ""}${soft ? " and deleted_at is null" : ""} order by ${ordem}${ident(d.chaveNatural ?? "id")}`, org ? [id, ctx.orgId] : [id]);
    out[d.key] = r.rows;
  }
  for (const p of def.perfis ?? []) {
    const cols = await colunas(ctx, p.table);
    if (!cols.size) { out[p.key] = null; continue; }
    const sel = [...(cols.has("is_active") ? ["is_active"] : []), ...p.fields.map((f) => f.name).filter((c) => cols.has(c))];
    const r = await ctx.tx.query(`select ${sel.length ? sel.map(ident).join(",") : "1 as existe"} from erp.${ident(p.table)} where ${ident(p.chavePai)} = $1`, [id]);
    out[p.key] = r.rows[0] ?? null;
  }
  return out;
}
