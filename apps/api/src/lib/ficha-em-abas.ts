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
import { campoVisivel, chavesBarradas, getResource, type DetalheDef, type FieldDef, type PerfilDef, type ResourceDef } from "@agro/domain";
import { D, DomainError } from "@agro/shared";
import { ident } from "./sql.js";
import { denied, fromPgError, validation } from "./errors.js";
import { hasPermission, moduloAtivo, type RequestContext, type ServiceCtx } from "./context.js";
import { translateIssue } from "../plugins/errors.js";
import { cepOuCidadeMudou, divergenciaCepCidade } from "./cep-da-cidade.js";

/**
 * Grades com par CEP × CIDADE (AJUSTES 02): chave do detalhe → [campo do CEP, campo da cidade]. Declaração ESTÁTICA;
 * nenhum nome vem do corpo. A conferência é por linha NOVA ou cujo CEP/cidade MUDA, numa consulta para a grade inteira.
 */
const CEP_E_CIDADE_DO_DETALHE: Readonly<Record<string, readonly [string, string]>> = {
  enderecos: ["cep", "city_id"],
  filiais: ["zip_code", "city_id"]
};

type Linha = Record<string, unknown>;
type SchemaDeCampo = (f: FieldDef) => z.ZodTypeAny;

export const temFicha = (def: ResourceDef) => Boolean(def.detalhes?.length || def.perfis?.length);

/** SIGILO (Fase 5; R1-2): o campo só sai da API (e só é gravado) para quem tem a permissão declarada em `sigilo`. */
export const podeVerCampo = (ctx: RequestContext, f: Pick<FieldDef, "sigilo">) => campoVisivel(f, (p) => hasPermission(ctx, p));

/**
 * 403 do SIGILO com o NOME do campo (R1-2). `uso` diz onde o campo apareceu ("na ordenação", "no filtro"…): o
 * usuário vê que a recusa é do campo, não da tela inteira. A mensagem nunca traz valor.
 */
export function recusaDeSigilo(f: FieldDef, uso: string): DomainError {
  return new DomainError("PERMISSION_DENIED", `Sem permissão: ${f.sigilo} — campo sigiloso "${f.label}" (${f.name}) ${uso}`, [{ path: f.name, message: `Campo sigiloso: exige ${f.sigilo}` }]);
}

/**
 * SIGILO COMO PERGUNTA (R1-2): tirar o campo da resposta não basta — filtro, ordenação, valores distintos, busca,
 * filtro do seletor, exportação e relatório salvo que usem o campo deixariam descobrir o valor por tentativa
 * ("salário > 5000?"). Toda porta que recebe NOME de campo do cliente passa por aqui: campo com sigilo sem a
 * permissão → 403 com o nome do campo. Nome que não é campo da definição não é sigiloso (a porta já o trata).
 */
export function exigirCampoVisivel(ctx: RequestContext, def: ResourceDef, nome: string, uso: string) {
  const f = def.fields.find((x) => x.name === nome);
  if (f && !podeVerCampo(ctx, f)) throw recusaDeSigilo(f, uso);
}

/**
 * Cadastro cujo campo OBRIGATÓRIO é sigiloso (Funções: salário e valor hora): criar exige a permissão do sigilo —
 * sem ela o campo não pode ir no corpo (403) e sem ele o registro não nasce. A recusa é da CAPACIDADE (403 com o
 * nome do campo), não um 422 de "campo obrigatório" que a tela nem mostra a quem não tem o sigilo.
 */
export function conferirSigiloNaCriacao(ctx: RequestContext, def: ResourceDef) {
  for (const f of def.fields) if (f.required && !f.readOnly && !podeVerCampo(ctx, f)) throw recusaDeSigilo(f, "é obrigatório para criar");
}

/** Tira da linha do PRINCIPAL os campos sigilosos que o usuário não pode ver (lista e ficha). */
export function semSigilo<T extends Linha>(ctx: ServiceCtx, def: ResourceDef, row: T): T {
  for (const f of def.fields) if (!podeVerCampo(ctx, f)) delete row[f.name];
  return row;
}

/**
 * Permissões da ESCRITA além da do cadastro (Fase 5), conferidas ANTES de qualquer gravação:
 *  · campo sigiloso no corpo (principal, linha de detalhe ou perfil) sem a permissão do `sigilo` → 403;
 *  · campo de SEÇÃO, GRADE ou PERFIL de uma aba com `permissaoDeEdicao` sem essa permissão → 403 (ex.: aba Pessoal
 *    do RH; abas Cliente/Fornecedor/Proprietário do parceiro, R1-4). A chave PRESENTE basta, mesmo vazia: na
 *    edição a grade vazia é "apague todas", e a tela não manda a chave da aba que o usuário não grava.
 *    O booleano que liga o perfil (`is_client`…) é campo do principal e continua com a permissão do cadastro;
 *  · GRADE ou PERFIL de uma aba com `permissaoDeLeitura` sem essa permissão → 403, mesmo com a de edição: quem não
 *    lê a aba não grava a lista completa dela às cegas.
 */
export function conferirPermissoesDaFicha(ctx: ServiceCtx, def: ResourceDef, data: Linha) {
  for (const f of def.fields) if (f.name in data && !podeVerCampo(ctx, f)) throw recusaDeSigilo(f, "na gravação");
  for (const d of def.detalhes ?? []) { const ls = data[d.key]; if (Array.isArray(ls)) for (const f of d.fields) if (!podeVerCampo(ctx, f) && (ls as Linha[]).some((l) => f.name in l)) throw recusaDeSigilo(f, "na gravação"); }
  for (const p of def.perfis ?? []) { const c = data[p.key] as Linha | undefined; if (c) for (const f of p.fields) if (f.name in c && !podeVerCampo(ctx, f)) throw recusaDeSigilo(f, "na gravação"); }
  // grade de OUTRO cadastro (R1-2) sem a leitura dele: não grava às cegas (cada operação é conferida em `gravarDetalhe`)
  for (const d of def.detalhes ?? []) if (d.permissoes && d.key in data && !hasPermission(ctx, d.permissoes.ler)) throw denied(d.permissoes.ler);
  for (const a of def.abas ?? []) {
    const chaves = [...(a.detalhes ?? []), ...(a.perfis ?? [])];
    if (a.permissaoDeEdicao && !hasPermission(ctx, a.permissaoDeEdicao)) {
      const campos = def.fields.filter((f) => f.section && a.secoes?.includes(f.section) && !f.readOnly);
      if (campos.some((f) => f.name in data)) throw denied(a.permissaoDeEdicao);
      if (chaves.some((k) => k in data)) throw denied(a.permissaoDeEdicao);
    }
    // gravar às cegas também não (R1-4): a grade enviada é a lista COMPLETA, e quem não lê a aba apagaria o que não vê
    if (a.permissaoDeLeitura && !hasPermission(ctx, a.permissaoDeLeitura) && chaves.some((k) => k in data)) throw denied(a.permissaoDeLeitura);
  }
}

/** Grades e perfis de abas que o usuário não pode LER (R1-4) e grades de outro cadastro sem a leitura dele (R1-2): não saem na ficha nem no histórico. */
export const chavesOcultas = (ctx: ServiceCtx, def: ResourceDef) => chavesBarradas(def, "permissaoDeLeitura", (p) => hasPermission(ctx, p));

/**
 * ESCOPO DE EMPRESA da grade com `campoEmpresa` (R1-4), com o mecanismo que já existe — a função da RLS empresarial
 * `erp.empresa_no_escopo(empresa, módulo)`, no módulo da ROTA (`moduloAtivo`, derivado da permissão). No cadastro
 * da ORGANIZAÇÃO (parceiro: `people.*` e `proprietaries.*` não têm módulo) o módulo é indefinido e a resposta é a
 * UNIÃO das empresas que o membro enxerga em algum módulo — a mesma lista do seletor de empresas (RLS de
 * `erp.empresas`) —, nunca "todas" (security.md › Fail closed); proprietário e modo `todas` enxergam todas.
 * `parametro` é a posição do módulo (`moduloAtivo(ctx)`) na lista de parâmetros da consulta.
 */
const escopoDaEmpresa = (coluna: string, parametro: number) => `erp.empresa_no_escopo(${coluna}, $${parametro}::text)`;

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

const NUMERICOS = new Set<FieldDef["type"]>(["number", "integer", "money", "quantity", "percent"]);
/**
 * A linha reenviada MUDA este campo? (R1-2: só a linha que muda exige `editar`.) `gravado` é o valor da coluna como
 * texto (`::text`, lido na mesma transação); número compara pelo valor ("250" = "250.00"), data pelo dia. Na dúvida
 * (ex.: json com outra formatação) conta como mudança — a conferência exige a permissão, nunca a dispensa.
 */
function mesmoValor(f: FieldDef, gravado: string | null | undefined, enviado: unknown): boolean {
  const v = valorDaColuna(f, enviado);
  const g = gravado ?? null;
  if (v === null || v === undefined) return g === null;
  if (g === null) return false;
  if (NUMERICOS.has(f.type)) { try { return D(g).eq(D(String(v))); } catch { return false; } }
  if (f.type === "boolean") return g === String(Boolean(v));
  if (f.type === "date") return g.slice(0, 10) === String(v).slice(0, 10);
  return g === String(v);
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

/**
 * Grades de pessoa exibidas como CARTÕES (endereço/conta/contato): o prefixo do erro nomeia o cartão
 * ("Endereço 2: …"), com o mesmo N 1-based. Whitelist estática por chave de detalhe; as demais grades
 * seguem "<rótulo>, linha N". `details[].message` não muda.
 */
const CARTAO_DO_DETALHE: Readonly<Record<string, string>> = { enderecos: "Endereço", contas: "Conta", contatos: "Contato" };

function prefixoDaLinha(d: DetalheDef, i: number): string {
  const cartao = Object.hasOwn(CARTAO_DO_DETALHE, d.key) ? CARTAO_DO_DETALHE[d.key] : undefined;
  return cartao ? `${cartao} ${i + 1}` : `${d.label}, linha ${i + 1}`;
}

/** Erro de banco numa linha da grade: vira o erro da API apontando a aba e a linha. */
function erroNaLinha(def: ResourceDef, d: DetalheDef, i: number, e: unknown, campo?: string): never {
  const de = e instanceof DomainError ? e : fromPgError(e);
  if (!de) throw e;
  const det = detalheDoErro(def, campo ? [d.key, i, campo] : [d.key, i], de.message);
  throw new DomainError(de.code, `${prefixoDaLinha(d, i)}: ${de.message}`, [det]);
}

async function gravarDetalhe(ctx: ServiceCtx, def: ResourceDef, d: DetalheDef, paiId: string, linhas: Linha[]) {
  const cols = await colunas(ctx, d.table);
  const org = Boolean(d.organizacao) && cols.has("organization_id");
  const soft = Boolean(d.softDelete) && cols.has("deleted_at");
  const chave = d.chaveNatural ?? "id";
  const campos = d.fields.filter((f) => !f.readOnly && cols.has(f.name));
  await conferirReferencias(ctx, def, d.fields, linhas, (i, f) => [d.key, i, f.name]);
  if (d.campoEmpresa) {
    // a empresa de cada linha ENVIADA: viva, desta organização e no escopo (R1-4) — uma consulta para a grade inteira
    const r = await ctx.tx.query<{ i: number }>(
      `select (x.i - 1)::int as i from unnest($1::uuid[]) with ordinality as x(empresa_id, i)
        where x.empresa_id is not null
          and not exists (select 1 from erp.empresas f where f.id = x.empresa_id and f.organization_id = $2 and f.deleted_at is null and ${escopoDaEmpresa("f.id", 3)})
        order by x.i limit 1`,
      [linhas.map((l) => (l[d.campoEmpresa!] as string | null | undefined) || null), ctx.orgId, moduloAtivo(ctx)]);
    if (r.rows[0]) erroNaLinha(def, d, r.rows[0].i, validation("Sem acesso à empresa informada"));
  }

  // o que existe hoje (vivo) desta ficha — a lista enviada é a lista COMPLETA. Com `campoEmpresa`, "o que existe" é
  // só o que o usuário ENXERGA (R1-4): a linha de empresa fora do escopo não é lida, não é alterada e não é apagada
  // quando fica de fora da lista — o filtro vale também no UPDATE e no DELETE, e o ROW COUNT é conferido.
  const pp: unknown[] = [paiId, ...(org ? [ctx.orgId] : []), ...(d.campoEmpresa ? [moduloAtivo(ctx)] : [])];
  const filtro = (inicio: number) => {
    let n = inicio;
    const partes = [`${ident(d.chavePai)} = $${n++}`];
    if (org) partes.push(`organization_id = $${n++}`);
    if (soft) partes.push("deleted_at is null");
    if (d.campoEmpresa) partes.push(escopoDaEmpresa(ident(d.campoEmpresa), n++));
    return partes.join(" and ");
  };
  const filtroPai = filtro(1);
  // grade de OUTRO cadastro (R1-2): lê também os valores gravados (como texto) para saber que linha MUDA
  const ps = d.permissoes;
  const parCep = CEP_E_CIDADE_DO_DETALHE[d.key];
  const doPar = parCep ? campos.filter((f) => f.name !== chave && parCep.includes(f.name)) : [];
  const comparaveis = [...new Set([...(ps ? campos.filter((f) => f.name !== chave) : []), ...doPar])];
  const lidas = (await ctx.tx.query<Linha & { __k: string }>(`select ${[`${ident(chave)}::text as __k`, ...comparaveis.map((f) => `${ident(f.name)}::text as ${ident(f.name)}`)].join(", ")} from erp.${ident(d.table)} where ${filtroPai}`, pp)).rows;
  const atuais = new Set(lidas.map((r) => r.__k));
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
  if (parCep && doPar.length === 2) {
    // CEP × cidade só das linhas NOVAS ou que MUDAM o par; os valores gravados vêm da leitura acima (sem N+1)
    const [fCep, fCid] = parCep;
    const gravadas = new Map(lidas.map((r) => [r.__k, r]));
    const idx: number[] = []; const pares: { cep: unknown; cityId: unknown }[] = [];
    for (const [i, l] of linhas.entries()) {
      const k = l[chave] === undefined || l[chave] === null ? null : String(l[chave]);
      const g = k === null ? undefined : gravadas.get(k);
      const novo = { cep: fCep in l ? l[fCep] : g?.[fCep], cityId: fCid in l ? l[fCid] : g?.[fCid] };
      if (!cepOuCidadeMudou(novo, g ? { cep: g[fCep], cityId: g[fCid] } : null)) continue;
      idx.push(i); pares.push(novo);
    }
    const div = pares.length ? await divergenciaCepCidade(ctx, pares) : null;
    if (div) erroNaLinha(def, d, idx[div.indice]!, validation(div.mensagem), fCid);
  }
  if (ps) {
    // cada OPERAÇÃO com a permissão do cadastro dono da linha, ANTES de qualquer escrita nesta grade (o que já foi
    // gravado antes — principal, outra grade — é desfeito junto: é a mesma transação do runService)
    const gravados = new Map(lidas.map((r) => [r.__k, r]));
    const chaveDe = (l: Linha) => (l[chave] === undefined || l[chave] === null ? null : String(l[chave]));
    const sai = [...atuais].some((k) => !enviados.has(k));
    const entra = linhas.some((l) => { const k = chaveDe(l); return k === null || !atuais.has(k); });
    const muda = linhas.some((l) => { const k = chaveDe(l); const g = k === null ? undefined : gravados.get(k); return g !== undefined && comparaveis.some((f) => f.name in l && !mesmoValor(f, g[f.name] as string | null, l[f.name])); });
    if (sai && !hasPermission(ctx, ps.excluir)) throw denied(ps.excluir);
    if (entra && !hasPermission(ctx, ps.criar)) throw denied(ps.criar);
    if (muda && !hasPermission(ctx, ps.editar)) throw denied(ps.editar);
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
        const r = await ctx.tx.query(`update erp.${ident(d.table)} set ${sets.join(", ")} where ${ident(chave)}::text = $${base + 1} and ${filtro(base + 2)}`, [...vals, k, ...pp]);
        if (r.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", "a linha mudou durante a gravação; recarregue a ficha");
      } else {
        const cs: string[] = [d.chavePai]; const vs: unknown[] = [paiId];
        if (org) { cs.push("organization_id"); vs.push(ctx.orgId); }
        for (const f of campos) { if (!(f.name in l)) continue; const v = valorDaColuna(f, l[f.name]); if (v === undefined) continue; cs.push(f.name); vs.push(v); }
        // ORDEM DA GRADE: a leitura ordena por `created_at`, e o default `now()` é o instante da TRANSAÇÃO — todas
        // as linhas novas do mesmo envio empatavam e o desempate pelo UUID embaralhava a ordem digitada.
        // `clock_timestamp()` avança a cada linha, então a ordem gravada é a ordem enviada.
        const relogio = cols.has("created_at");
        const r = await ctx.tx.query(`insert into erp.${ident(d.table)} (${[...cs.map(ident), ...(relogio ? ["created_at"] : [])].join(",")}) values (${[...vs.map((_, j) => `$${j + 1}`), ...(relogio ? ["clock_timestamp()"] : [])].join(",")})`, vs);
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
  // `is_active` do perfil só acompanha o `ativoPor` (o tipo do parceiro). Perfil SEM `ativoPor` (ficha de RH) nunca
  // mexe nele (R1-2): editar uma aba de RH de um perfil INATIVO devolvia o funcionário à folha. Na criação vale o
  // default da coluna; na edição fica o gravado.
  if (temAtivo && flag) { cs.push("is_active"); vs.push(ativo); }
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

/** Grades e perfis do registro nas mesmas chaves do corpo. Uma consulta por tabela. Aba sem a permissão de leitura: a chave não sai (R1-4). */
export async function lerFicha(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<Linha> {
  const out: Linha = {};
  // aba que o usuário não pode LER (R1-4): a grade e o perfil dela não saem — nem a chave, nem os dados
  const ocultas = chavesOcultas(ctx, def);
  for (const d of def.detalhes ?? []) {
    if (ocultas.has(d.key)) continue;
    const cols = await colunas(ctx, d.table);
    if (!cols.size) { out[d.key] = []; continue; }
    const org = Boolean(d.organizacao) && cols.has("organization_id");
    const soft = Boolean(d.softDelete) && cols.has("deleted_at");
    const sel = [...(d.chaveNatural ? [] : ["id"]), ...d.fields.filter((f) => podeVerCampo(ctx, f)).map((f) => f.name).filter((c) => cols.has(c))];
    const ordem = cols.has("created_at") ? "created_at, " : "";
    const params: unknown[] = [id, ...(org ? [ctx.orgId] : []), ...(d.campoEmpresa ? [moduloAtivo(ctx)] : [])];
    // linha de empresa fora do escopo do usuário não aparece (R1-4)
    const escopo = d.campoEmpresa ? ` and ${escopoDaEmpresa(ident(d.campoEmpresa), params.length)}` : "";
    const r = await ctx.tx.query(`select ${[...new Set(sel)].map(ident).join(",")} from erp.${ident(d.table)} where ${ident(d.chavePai)} = $1${org ? " and organization_id = $2" : ""}${soft ? " and deleted_at is null" : ""}${escopo} order by ${ordem}${ident(d.chaveNatural ?? "id")}`, params);
    out[d.key] = r.rows;
  }
  for (const p of def.perfis ?? []) {
    if (ocultas.has(p.key)) continue;
    const cols = await colunas(ctx, p.table);
    if (!cols.size) { out[p.key] = null; continue; }
    const sel = [...(cols.has("is_active") ? ["is_active"] : []), ...p.fields.filter((f) => podeVerCampo(ctx, f)).map((f) => f.name).filter((c) => cols.has(c))];
    const r = await ctx.tx.query(`select ${sel.length ? sel.map(ident).join(",") : "1 as existe"} from erp.${ident(p.table)} where ${ident(p.chavePai)} = $1`, [id]);
    out[p.key] = r.rows[0] ?? null;
  }
  return out;
}
