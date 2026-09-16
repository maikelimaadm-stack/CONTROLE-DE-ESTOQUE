import type { Tx } from "@agro/db";
import { DomainError } from "@agro/shared";
import { escopoDoModulo, escopoTotalEmAlgumModulo, type AutorizacaoPorModulo } from "@erp/plataforma";

export interface AuthUser { id: string; email: string; name: string }

/**
 * Vínculo do usuário com a organização.
 *
 * `escopos` é a autorização de EMPRESA POR MÓDULO — apenas os MODOS, nunca a lista de empresas: uma
 * organização pode ter centenas, e carregá-las a cada requisição não escala. Quando o modo é `selecionadas`,
 * o conjunto é resolvido no SQL (`erp.membro_empresas`), tanto nas listagens quanto nas checagens pontuais.
 *
 * `empresaIds` não existe aqui: o conjunto de empresas vive no banco. `erp.member_farms` deixou de ser
 * autoridade em PRE-BASE2-02 e foi APOSENTADA fisicamente em PRE-BASE2-03 (arquivo morto
 * `erp.legado_escopo_empresa_v0`).
 */
export interface Membership {
  orgId: string;
  orgName: string;
  roleId: string | null;
  isOwner: boolean;
  /** id em `erp.organization_members` — chave do escopo empresarial no banco. */
  memberId: string;
  escopos: AutorizacaoPorModulo;
}

export interface RequestContext {
  user: AuthUser;
  orgId: string;
  /**
   * Empresa selecionada no contexto de trabalho (`X-Empresa-Id`).
   * SELEÇÃO, nunca autorização: ela só pode DIMINUIR o escopo da requisição, jamais ampliá-lo.
   * O cabeçalho anterior NÃO é traduzido — ele é RECUSADO na borda, com 422
   * (`lib/empresa-header.ts` + `lib/contrato-legado.ts`). Traduzir calado seria ampliar escopo.
   */
  empresaId: string | null;
  membership: Membership;
  permissions: Set<string>;
  ip?: string;
  /**
   * Módulo de escopo empresarial ATIVO da requisição, derivado da permissão exigida pela rota
   * (`runService`). `null` = recurso da organização inteira: não há empresa a cruzar.
   * Nunca vem da URL nem do cliente.
   */
  moduloEmpresa?: string | null;
}
export interface ServiceCtx extends RequestContext { tx: Tx }

export function hasPermission(ctx: RequestContext, key: string): boolean {
  return ctx.membership.isOwner || ctx.permissions.has(key);
}

/** Módulo empresarial em vigor na chamada; `undefined` (não definido pelo runService) é tratado como nulo. */
export const moduloAtivo = (ctx: RequestContext): string | null => ctx.moduloEmpresa ?? null;

/**
 * ESCOPO DE EMPRESA EM SQL — padrão oficial de LEITURA de qualquer recurso com coluna de empresa.
 *
 * Três resultados possíveis, sempre do MÓDULO ATIVO da requisição:
 *   • `todas`        → nenhum recorte de autorização (só a empresa selecionada, se houver);
 *   • `selecionadas` → `exists (… erp.membro_empresas …)`: o conjunto fica NO BANCO, sem lista em memória
 *                      e sem `WHERE IN` gigante montado pelo Node (lista vazia ⇒ nenhuma linha, natural);
 *   • `nenhuma`      → `false`: módulo sem configuração é fail-closed, não "tudo".
 *
 * `col` é um alias de tabela (→ `alias.empresa_id`) ou uma expressão terminada em `empresa_id`.
 * `nullable`: registro sem empresa (null) é da organização inteira e continua visível.
 * `ignoreSelected`: o chamador já filtrou explicitamente por empresa — só a autorização é acrescentada.
 * Registro fora do escopo simplesmente não é visível (404 em GET por id, ausente em listas).
 */
/**
 * Coluna de empresa do chamador: um ALIAS de tabela vira `alias.empresa_id`; qualquer expressão já qualificada
 * (`f.id`, `y.empresa_id`, `me.empresa_id`) é usada como está — o escopo compara com a empresa, não com um nome.
 */
const colunaDeEmpresa = (col: string): string => (col.includes(".") || col.endsWith("empresa_id") ? col : `${col}.empresa_id`);

export function empresaScope(ctx: RequestContext, col: string, params: unknown[], opts: { nullable?: boolean; ignoreSelected?: boolean; modulo?: string | null } = {}): string[] {
  const c = colunaDeEmpresa(col);
  const out: string[] = [];
  const wrap = (expr: string) => (opts.nullable ? `(${c} is null or ${expr})` : expr);
  if (ctx.empresaId && !opts.ignoreSelected) { params.push(ctx.empresaId); out.push(wrap(`${c}=$${params.length}`)); }

  const modulo = opts.modulo !== undefined ? opts.modulo : moduloAtivo(ctx);
  const escopo = ctx.membership.isOwner ? { tipo: "todas" as const } : escopoDoModulo(ctx.membership.escopos, modulo);
  if (escopo.tipo === "todas") return out;
  if (escopo.tipo === "nenhuma") { out.push(opts.nullable ? `${c} is null` : "false"); return out; }

  params.push(ctx.orgId); const pOrg = params.length;
  params.push(ctx.membership.memberId); const pMembro = params.length;
  params.push(modulo); const pModulo = params.length;
  out.push(wrap(`exists (select 1 from erp.membro_empresas me where me.organization_id=$${pOrg} and me.membro_id=$${pMembro} and me.modulo=$${pModulo} and me.empresa_id=${c})`));
  return out;
}

/** Mesmo escopo como texto " and …" para concatenar em SQL pronto (params são acrescentados). */
export function empresaScopeSql(ctx: RequestContext, col: string, params: unknown[], opts: { nullable?: boolean; ignoreSelected?: boolean; modulo?: string | null } = {}): string {
  return empresaScope(ctx, col, params, opts).map((c) => " and " + c).join("");
}

/** Cláusula e parâmetros para "GET por id" dentro do escopo: `… where x.id=$1 and x.organization_id=$2 <sql>`. */
export function scopedById(ctx: RequestContext, col: string, id: string, opts: { nullable?: boolean; modulo?: string | null } = {}): { sql: string; params: unknown[] } {
  const params: unknown[] = [id, ctx.orgId];
  return { sql: empresaScopeSql(ctx, col, params, opts), params };
}

/**
 * Cláusula para consultas que hoje usam o padrão de ARRAY (`($n::uuid[] is null or col = any($n))`) em
 * agregados e painéis. Devolve SQL + params já no formato do escopo canônico, sem materializar a lista de
 * empresas: `pedidas` (query string) é o recorte do usuário, e a autorização entra por cima, no banco.
 */
export function empresaScopeAgregado(ctx: RequestContext, col: string, params: unknown[], pedidas?: string[] | string | null, opts: { nullable?: boolean; modulo?: string | null } = {}): string {
  const c = colunaDeEmpresa(col);
  const req = pedidas == null ? [] : Array.isArray(pedidas) ? pedidas : pedidas.split(",");
  const alvo = req.filter(Boolean);
  const out: string[] = [];
  if (alvo.length) { params.push(alvo); out.push(`${c} = any($${params.length}::uuid[])`); }
  else if (ctx.empresaId) { params.push(ctx.empresaId); out.push(`${c}=$${params.length}`); }
  const autorizacao = empresaScope(ctx, c, params, { ...opts, ignoreSelected: true });
  const todas = [...out, ...autorizacao].map((x) => (opts.nullable ? `(${c} is null or ${x})` : x));
  return todas.length ? " and " + todas.join(" and ") : "";
}

/** Construtor de parâmetros usado pelas rotas de relatório/cadastro: `add(valor)` devolve o placeholder. */
export interface ParamBuilder { add: (v: unknown) => string }

/** Mesmo escopo de `empresaScope`, para rotas que montam SQL com um construtor de parâmetros. */
export function empresaScopeBuilder(ctx: RequestContext, col: string, b: ParamBuilder, opts: { nullable?: boolean; ignoreSelected?: boolean; modulo?: string | null } = {}): string[] {
  const params: unknown[] = [];
  const clausulas = empresaScope(ctx, col, params, { ignoreSelected: true, ...opts });
  // reescreve $1..$n do array local para os placeholders do construtor, na ordem em que foram criados
  const mapeados = params.map((v) => b.add(v));
  return clausulas.map((c) => c.replace(/\$(\d+)/g, (_m, n) => mapeados[Number(n) - 1] ?? _m));
}

/**
 * Escopo para registros com DUAS colunas de empresa (transferência: origem e destino). O registro é visível
 * quando QUALQUER uma das pontas está no escopo — é o mesmo critério da listagem legada, agora por módulo.
 */
export function empresaScopePar(ctx: RequestContext, cols: [string, string], params: unknown[], opts: { modulo?: string | null } = {}): string[] {
  const partes: string[] = [];
  for (const c of cols) partes.push(...empresaScope(ctx, c, params, { ignoreSelected: true, ...opts }));
  if (!partes.length) return [];
  return [`(${partes.join(" or ")})`];
}

/**
 * O usuário pode operar NESTA empresa, DENTRO DO MÓDULO ATIVO?
 *
 * Assíncrona porque, no modo `selecionadas`, a autoridade é o banco (`erp.tem_acesso_empresa`) — a mesma
 * função que a PRE-BASE2-03 usará no RLS empresarial. Empresa nula = registro da organização inteira.
 */
export async function empresaPermitida(ctx: ServiceCtx, empresaId: string | null | undefined, modulo?: string | null): Promise<boolean> {
  if (!empresaId) return true;
  if (ctx.membership.isOwner) {
    const r = await ctx.tx.query<{ ok: boolean }>("select exists (select 1 from erp.empresas f where f.id=$1 and f.organization_id=$2 and f.deleted_at is null) ok", [empresaId, ctx.orgId]);
    return Boolean(r.rows[0]?.ok);
  }
  const alvo = modulo !== undefined ? modulo : moduloAtivo(ctx);
  if (!alvo) return false; // recurso de organização não decide empresa; quem chama não deveria perguntar
  const escopo = escopoDoModulo(ctx.membership.escopos, alvo);
  if (escopo.tipo === "nenhuma") return false;
  const r = await ctx.tx.query<{ ok: boolean }>(
    "select erp.tem_acesso_empresa($1,$2,$3,$4) as ok", [ctx.orgId, ctx.user.id, alvo, empresaId]);
  return Boolean(r.rows[0]?.ok);
}

/** Registro carregado para escrita: fora do escopo → NOT_FOUND (mesma convenção das leituras). */
export async function exigirEmpresaVisivel(ctx: ServiceCtx, empresaId: string | null | undefined, oQue = "Registro", modulo?: string | null): Promise<void> {
  if (!(await empresaPermitida(ctx, empresaId, modulo))) throw new DomainError("NOT_FOUND", `${oQue} não encontrado`);
}

/**
 * Criar um registro SEM empresa (coluna anulável em que nulo = "da organização") alcança TODAS as empresas.
 * Quem enxerga apenas algumas não pode produzir um registro que vale para as outras — é ampliação de
 * autorização pela porta da escrita. Proprietário e módulo em `todas` podem; `selecionadas` precisa dizer
 * a empresa; `nenhuma` não escreve nada.
 */
export function exigirEscopoTotalDoModulo(ctx: ServiceCtx, oQue = "Registro"): void {
  if (ctx.membership.isOwner) return;
  const alvo = moduloAtivo(ctx);
  const escopo = alvo ? escopoDoModulo(ctx.membership.escopos, alvo) : { tipo: "nenhuma" as const };
  if (escopo.tipo === "todas") return;
  throw new DomainError("VALIDATION_ERROR", `${oQue} sem empresa vale para a organização inteira: informe a empresa`);
}

/**
 * Criar a própria EMPRESA é ato de ORGANIZAÇÃO, e não existe módulo ativo para consultar.
 *
 * A pergunta aqui é a MESMA que a RLS de `erp.empresas` faz (`erp.escopo_empresa_total(null)`): o membro
 * tem escopo total em ALGUM módulo? Precisa ser a mesma por um motivo prático, não estético — a empresa
 * recém-criada não está no escopo de ninguém, então quem não passa nessa pergunta insere a linha e não
 * consegue lê-la de volta: o `getOne` do create responde 404 e a transação inteira volta atrás. O usuário
 * vê "não encontrado" depois de preencher um cadastro que, do ponto de vista dele, foi aceito.
 *
 * Recusar ANTES do INSERT troca esse 404 silencioso por uma recusa explícita, sem conceder escopo nenhum:
 * ninguém passa a enxergar empresa que não enxergava.
 */
export function exigirEscopoTotalDaOrganizacao(ctx: ServiceCtx, oQue = "Registro"): void {
  if (escopoTotalEmAlgumModulo(ctx.membership.escopos)) return;
  throw new DomainError("VALIDATION_ERROR", `${oQue} alcança a organização inteira: é preciso ter acesso a todas as empresas em algum módulo`);
}

/**
 * Empresa informada no CORPO de um lançamento: é PEDIDO, nunca autorização. Fora do escopo do módulo →
 * VALIDATION_ERROR (o cliente escolheu explicitamente uma empresa que não pode usar; não há o que revelar
 * sobre existência, porque o id veio dele).
 */
export async function exigirEmpresaDeLancamento(ctx: ServiceCtx, empresaId: string | null | undefined, modulo?: string | null): Promise<void> {
  if (!(await empresaPermitida(ctx, empresaId, modulo))) throw new DomainError("VALIDATION_ERROR", "Sem acesso à empresa informada");
}

/**
 * Empresa de DESTINO de um lançamento: existe, é DESTA organização e está ativa.
 *
 * Há operações em que o destino é legitimamente uma empresa que o autor NÃO enxerga — a transferência de
 * lote entre empresas é assim: quem envia não precisa ver quem recebe (quem recebe é que aceita, e aí sim
 * `empresaPermitida` decide). O que não pode é o destino ser um identificador qualquer vindo do corpo da
 * requisição: sem esta checagem, um id de outra organização atravessaria — a chave estrangeira de
 * `erp.animal_movements.empresa_destino_id` é de coluna única e não carrega a organização.
 */
export async function exigirEmpresaDaOrganizacao(ctx: ServiceCtx, empresaId: string, oQue = "Empresa"): Promise<void> {
  // EXISTÊNCIA no tenant, não VISIBILIDADE no escopo. `erp.empresas` é lida pelo escopo (e tem de ser, senão
  // o seletor vira um catálogo do que a pessoa não pode usar), mas a pergunta aqui é outra: a emissão de uma
  // transferência valida o DESTINO, que o remetente legitimamente não enxerga — quem aceita é o destinatário.
  // Perguntando pela política de leitura, "não vejo" virava "não existe" e a rota recusava com 422 uma
  // transferência válida. `erp.empresa_da_organizacao_atual` responde só isso, dentro do tenant do servidor.
  const r = await ctx.tx.query<{ ok: boolean }>("select erp.empresa_da_organizacao_atual($1) as ok", [empresaId]);
  if (!r.rows[0]?.ok) throw new DomainError("VALIDATION_ERROR", `${oQue} inválida`);
}

// --------------------------------------------------------------------------------------------------
// CONSULTA COM ESCOPO POR MARCADOR
// --------------------------------------------------------------------------------------------------
/**
 * Substitui marcadores de escopo dentro de um SQL pronto, acrescentando os parâmetros ao final da lista:
 *
 *   `{{escopo:e.empresa_id}}`       → escopo do módulo ativo (com a empresa selecionada, quando houver);
 *   `{{escopo_nulo:d.empresa_id}}`  → idem, mas registro sem empresa é da organização e continua visível;
 *   `{{escopo_par:a.empresa_origem_id,a.empresa_destino_id}}` → visível se QUALQUER ponta estiver no escopo.
 *
 * O módulo é o da PERMISSÃO da rota (runService). Painéis que combinam áreas fixam o módulo de cada bloco na
 * própria coluna: `{{escopo:t.empresa_id|financeiro}}`.
 *
 * É o substituto do antigo padrão de ARRAY (`($n::uuid[] is null or col = any($n))`), que obrigava a
 * aplicação a carregar todas as empresas autorizadas para a memória — inviável com centenas de empresas
 * (docs/MULTI-COMPANY-CONTRACT.md §7). Aqui o conjunto permanece no banco, como semi-join.
 */
export function sqlComEscopo(ctx: RequestContext, sql: string, params: unknown[], opts: { pedidas?: string[] | string | null; modulo?: string | null } = {}): string {
  return sql.replace(/\{\{escopo(_nulo|_par)?:([^}]+)\}\}/g, (_m, sufixo: string | undefined, alvo: string) => {
    // `coluna|modulo` fixa o módulo do BLOCO (painel que combina áreas); sem isso vale o módulo da rota.
    const [colunas, moduloDoToken] = alvo.split("|");
    const cols = colunas!.split(",").map((c) => c.trim()).filter(Boolean);
    const modulo = moduloDoToken ? moduloDoToken.trim() : opts.modulo;
    let partes: string[];
    if (sufixo === "_par") {
      if (cols.length !== 2) throw new Error(`{{escopo_par:…}} exige duas colunas: ${colunas}`);
      partes = empresaScopePar(ctx, [cols[0]!, cols[1]!], params, modulo !== undefined ? { modulo } : {});
    } else {
      const clausula = empresaScopeAgregado(ctx, cols[0]!, params, opts.pedidas ?? null, { nullable: sufixo === "_nulo", ...(modulo !== undefined ? { modulo } : {}) });
      partes = clausula ? [clausula.replace(/^ and /, "")] : [];
    }
    return partes.length ? `(${partes.join(" and ")})` : "true";
  });
}

/** `ctx.tx.query` com os marcadores de escopo já resolvidos (os parâmetros do escopo entram no fim da lista). */
export function consultaEscopada<T extends Record<string, unknown> = Record<string, unknown>>(
  ctx: ServiceCtx, sql: string, params: unknown[] = [], opts: { pedidas?: string[] | string | null; modulo?: string | null } = {},
) {
  const texto = sqlComEscopo(ctx, sql, params, opts);
  return ctx.tx.query<T>(texto, params);
}
