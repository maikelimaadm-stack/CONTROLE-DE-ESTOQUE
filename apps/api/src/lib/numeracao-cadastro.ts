/**
 * NUMERAÇÃO DOS CADASTROS (CADASTROS AJUSTES 01, decisão 257 D-2/D-3/D-4).
 *
 * - CÓDIGO SEQUENCIAL (`codigoAutomatico: "sequencial"` — Contas bancárias, Áreas, Pátios, Setores, Currais):
 *   gerado no servidor pelo contador da organização (`erp.code_sequences`, via `erp.next_code`), pulando o
 *   número que um código ANTIGO (digitado antes, vivo ou excluído) já ocupa. Nunca digitado: corpo com código
 *   é recusado (422), nunca ignorado.
 * - ZERAR NUMERAÇÃO: só cadastro sem registro vivo (ativo ou inativo). Numa transação, com o cadastro travado
 *   contra inclusão e a contagem REFEITA depois da trava: o excluído que segura código vira `EXC-<id>` (a linha
 *   e o histórico ficam), o contador sequencial volta a 0 (próximo = 1) e a árvore volta ao primeiro código da
 *   máscara. NUNCA para documentos: a lista de cadastros é fechada (`CADASTROS_COM_NUMERACAO`).
 * - MÁSCARA TRAVADA: a máscara de uma árvore só muda com o cadastro vazio.
 */
import type { ResourceDef } from "@agro/domain";
import { CADASTROS_CODIGO_HIERARQUICO, CADASTROS_COM_NUMERACAO, ehCadastroCodigoHierarquico, getResource, larguraDoCodigoSequencial, mascaraDoCadastro, PARAMETRO_MASCARAS_CODIGO } from "@agro/domain";
import { escopoDoModulo } from "@erp/plataforma";
import { ident } from "./sql.js";
import { err, notFound, validation } from "./errors.js";
import { audit, nextCode, publicarModuloEmpresa } from "./service.js";
import type { ServiceCtx } from "./context.js";
import { sugerirCodigo, travarNumeracao, MENSAGEM_CODIGO_GERADO } from "./arvore-cadastro.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);
/** Limite de números pulados numa geração: acima disso o acervo antigo ocupa uma faixa inteira — recusa legível. */
const PULOS_MAXIMOS = 1000;

/**
 * Código de um Novo sequencial (decisão 257 D-2). Corpo com código → 422 (web anterior digitava; a recusa diz
 * o porquê). Sob a trava da numeração: a mesma do Zerar, que então espera o Novo terminar (ou o contrário).
 */
export async function gerarCodigoSequencial(ctx: ServiceCtx, def: ResourceDef, data: Linha): Promise<string | null> {
  if (def.codigoAutomatico !== "sequencial" || !def.codeEntity) return null;
  if (data["code"] !== undefined && data["code"] !== null && data["code"] !== "") throw campo("code", MENSAGEM_CODIGO_GERADO);
  delete data["code"];
  await travarNumeracao(ctx, def);
  const largura = larguraDoCodigoSequencial(def.key);
  for (let i = 0; i < PULOS_MAXIMOS; i++) {
    const codigo = await nextCode(ctx.tx, ctx.orgId, def.codeEntity, largura);
    // número já usado como código antigo (vivo ou excluído — a unicidade do banco inclui os excluídos) é pulado
    const usado = await ctx.tx.query(`select 1 from erp.${ident(def.table)} where organization_id=$1 and code=$2 limit 1`, [ctx.orgId, codigo]);
    if (!usado.rowCount) return codigo;
  }
  throw campo("code", "Não foi possível gerar o código: a faixa de números seguinte já está ocupada por códigos antigos.");
}

/** Edição de cadastro sequencial: o código não muda (igual ao gravado passa — é a web anterior reenviando). */
export function conferirCodigoSequencialNaEdicao(def: ResourceDef, data: Linha, atual: Linha): void {
  if (def.codigoAutomatico !== "sequencial" || !("code" in data)) return;
  if ((data["code"] ?? null) !== (atual["code"] ?? null)) throw campo("code", MENSAGEM_CODIGO_GERADO);
  delete data["code"];
}

export interface LinhaNumeracao {
  cadastro: string; rotulo: string; tipo: "hierarquico" | "sequencial";
  registros: number; excluidos: number; proximoCodigo: string | null;
  podeZerar: boolean; motivo: string | null;
}

function defDaNumeracao(cadastro: string): ResourceDef {
  const def = (CADASTROS_COM_NUMERACAO as readonly string[]).includes(cadastro) ? getResource(cadastro) : undefined;
  if (!def) throw notFound("Cadastro");
  return def;
}

/**
 * Cadastro com empresa (Áreas, Pátios): a contagem e a liberação passam pela RLS de empresa. Quem não enxerga
 * TODAS as empresas do módulo contaria só as suas e zeraria um cadastro que não está vazio — então só o
 * proprietário ou o módulo em "todas". Publica o módulo do cadastro na transação (JS e RLS no mesmo módulo).
 */
async function contextoDoCadastro(ctx: ServiceCtx, def: ResourceDef): Promise<{ ctx: ServiceCtx; bloqueio: string | null }> {
  if (!def.empresaScoped && !def.empresaScopedNulo) return { ctx, bloqueio: null };
  const c = await publicarModuloEmpresa(ctx, `${def.permission}.view`);
  if (c.membership.isOwner) return { ctx: c, bloqueio: null };
  const escopo = c.moduloEmpresa ? escopoDoModulo(c.membership.escopos, c.moduloEmpresa) : { tipo: "nenhuma" as const };
  return { ctx: c, bloqueio: escopo.tipo === "todas" ? null : `É preciso ter acesso a todas as empresas em ${def.labelPlural} para zerar a numeração.` };
}

async function contar(ctx: ServiceCtx, def: ResourceDef): Promise<{ registros: number; excluidos: number }> {
  const r = await ctx.tx.query<{ vivos: string; excluidos: string }>(
    `select count(*) filter (where deleted_at is null)::text as vivos,
            count(*) filter (where deleted_at is not null and code is not null and code not like 'EXC-%')::text as excluidos
       from erp.${ident(def.table)} where organization_id=$1`, [ctx.orgId]);
  return { registros: Number(r.rows[0]?.vivos ?? 0), excluidos: Number(r.rows[0]?.excluidos ?? 0) };
}

const motivoComRegistros = (n: number, def: ResourceDef) => `Há ${n} ${n === 1 ? "registro" : "registros"} em ${def.labelPlural} (ativos ou inativos): a numeração só volta para 1 com o cadastro vazio.`;

/** Próximo código SEM consumir o contador (prévia "será gerado ao salvar"); o Novo pode pular, se outro chegar antes. */
export async function proximoCodigo(ctx: ServiceCtx, def: ResourceDef): Promise<string | null> {
  if (ehCadastroCodigoHierarquico(def.key)) {
    try { return (await sugerirCodigo(ctx, def, null)).codigo; } catch { return null; }
  }
  if (!def.codeEntity) return null;
  const r = await ctx.tx.query<{ last_value: string }>("select last_value::text from erp.code_sequences where organization_id=$1 and entity=$2", [ctx.orgId, def.codeEntity]);
  let n = Number(r.rows[0]?.last_value ?? 0) + 1;
  const largura = larguraDoCodigoSequencial(def.key);
  for (let i = 0; i < PULOS_MAXIMOS; i++, n++) {
    const codigo = String(n).padStart(largura, "0");
    if (def.codigoAutomatico !== "sequencial") return codigo;
    const usado = await ctx.tx.query(`select 1 from erp.${ident(def.table)} where organization_id=$1 and code=$2 limit 1`, [ctx.orgId, codigo]);
    if (!usado.rowCount) return codigo;
  }
  return null;
}

export async function linhaDaNumeracao(ctx0: ServiceCtx, cadastro: string): Promise<LinhaNumeracao> {
  const def = defDaNumeracao(cadastro);
  const { ctx, bloqueio } = await contextoDoCadastro(ctx0, def);
  const { registros, excluidos } = await contar(ctx, def);
  const motivo = bloqueio ?? (registros > 0 ? motivoComRegistros(registros, def) : null);
  return { cadastro: def.key, rotulo: def.labelPlural, tipo: ehCadastroCodigoHierarquico(def.key) ? "hierarquico" : "sequencial", registros, excluidos, proximoCodigo: await proximoCodigo(ctx, def), podeZerar: motivo === null, motivo };
}

export async function numeracaoDosCadastros(ctx: ServiceCtx): Promise<{ cadastros: LinhaNumeracao[] }> {
  const cadastros: LinhaNumeracao[] = [];
  for (const c of CADASTROS_COM_NUMERACAO) cadastros.push(await linhaDaNumeracao(ctx, c));
  return { cadastros };
}

/** Janela do limite do Zerar (A-2): um Zerar por cadastro, por organização, a cada minuto. */
const JANELA_DO_ZERAR = "1 minute";

/**
 * ZERAR (decisão 257 D-3; AJUSTES 01 R1, A-2). A ORDEM das travas é a mesma de quem inclui: numeração → contador →
 * tabela. Assim o Novo que já pegou número (e segura a linha do contador até o commit) termina primeiro e a contagem
 * o vê; e o Novo que chega depois espera o Zerar e recebe o 1.
 *
 *  1. trava da NUMERAÇÃO (advisory, tabela + organização): serializa com toda inclusão pela API, com o Mover e com
 *     outro Zerar do mesmo cadastro;
 *  2. contador `for update` e contagem → com registro vivo, 422 antes de qualquer escrita;
 *  3. LIMITE: um Zerar por cadastro por organização por minuto → 429. Conferido na AUDITORIA, dentro da transação e
 *     sob a trava: vale entre instâncias da API (o limitador em memória das consultas é por processo), serializa com
 *     o Zerar concorrente (o segundo espera a trava e vê a auditoria do primeiro) e só conta o Zerar que GRAVOU (o
 *     desfeito — 422 na recontagem, 409 na trava da tabela — não deixa auditoria);
 *  4. fila de Zerar da MESMA tabela entre organizações (advisory só da tabela — sem ela, duas liberações seguidas de
 *     dois pedidos de trava da tabela se esperam uma à outra) e a LIBERAÇÃO dos excluídos (`EXC-<id>`) com os pares `{ id, codigo_antigo }` (UPDATE … FROM alvo RETURNING: a
 *     maioria das tabelas não tem gatilho de auditoria, e o código antigo se perderia) e contador a 0 — tudo ANTES da
 *     trava da tabela: esse UPDATE é o passo longo (dezenas de milhares de excluídos) e só toca linhas desta
 *     organização; quem inclui pela API já está parado na trava da numeração;
 *  5. auditoria (com os pares) e o próximo código;
 *  6. SÓ ENTÃO a trava da TABELA (`share row exclusive`: não convive com gravação de NENHUMA organização; espera no
 *     máximo 2 s e desiste com 409) e, sob ela, SÓ a RECONTAGEM — ela fecha as portas que incluem sem passar pela trava
 *     da numeração (importação com código, SQL de fora). Achou vivo → 422, e a transação desfaz tudo: liberação,
 *     contador e auditoria. A trava da tabela dura só a recontagem e o commit.
 */
export async function zerarNumeracao(ctx0: ServiceCtx, cadastro: string): Promise<{ proximoCodigo: string | null }> {
  const def = defDaNumeracao(cadastro);
  const { ctx, bloqueio } = await contextoDoCadastro(ctx0, def);
  if (bloqueio) throw validation(bloqueio);
  await travarNumeracao(ctx, def);
  let contadorAnterior: number | null = null;
  if (def.codeEntity) {
    const s = await ctx.tx.query<{ last_value: string }>("select last_value::text from erp.code_sequences where organization_id=$1 and entity=$2 for update", [ctx.orgId, def.codeEntity]);
    contadorAnterior = s.rows[0] ? Number(s.rows[0].last_value) : null;
  }
  // recusa CEDO, já sob a trava da numeração (quem inclui pela API passa por ela, então o Novo que pegou número antes
  // já commitou e aparece aqui) e ANTES de qualquer escrita e da trava da TABELA
  const previa = await contar(ctx, def);
  if (previa.registros > 0) throw validation(motivoComRegistros(previa.registros, def));
  // LIMITE depois do motivo: com registro vivo a resposta é sempre o 422 que diz o porquê; o 429 só aparece quando o
  // Zerar ia de fato gravar (e pedir a trava da tabela) pela segunda vez no mesmo minuto
  const recente = await ctx.tx.query("select 1 from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id=$2 and action='zerar' and created_at > now() - $3::interval limit 1", [ctx.orgId, def.key, JANELA_DO_ZERAR]);
  if (recente.rowCount) throw err("RATE_LIMITED", `A numeração de ${def.labelPlural} foi zerada há menos de 1 minuto; aguarde para zerar de novo.`);
  // UM ZERAR POR TABELA DE CADA VEZ, entre organizações: a liberação (UPDATE) já segura ROW EXCLUSIVE na tabela e
  // depois pede SHARE ROW EXCLUSIVE — dois Zerar do mesmo cadastro em organizações diferentes, cada um com a sua
  // liberação feita, esperariam um pelo outro (impasse de promoção de trava: o banco derruba um com 409). Com esta
  // fila (só de Zerar, antes da primeira escrita) o segundo espera o primeiro terminar e os dois terminam 200.
  await ctx.tx.query("select pg_advisory_xact_lock(hashtext('zerar-tabela:' || $1))", [def.table]);
  const t = `erp.${ident(def.table)}`;
  const lib = await ctx.tx.query<{ id: string; codigo_antigo: string }>(
    `update ${t} x set code = 'EXC-' || x.id::text
       from (select id, code from ${t} where organization_id=$1 and deleted_at is not null and code is not null and code not like 'EXC-%') alvo
      where x.id = alvo.id and x.organization_id = $1
      returning x.id::text as id, alvo.code as codigo_antigo`, [ctx.orgId]);
  const liberados = lib.rows.map((l) => ({ id: l.id, codigo_antigo: l.codigo_antigo })).sort((a, b) => a.codigo_antigo.localeCompare(b.codigo_antigo) || a.id.localeCompare(b.id));
  if (def.codeEntity && contadorAnterior !== null) {
    const z = await ctx.tx.query("update erp.code_sequences set last_value = 0 where organization_id=$1 and entity=$2", [ctx.orgId, def.codeEntity]);
    if (z.rowCount !== 1) throw validation("Não foi possível zerar o contador deste cadastro.");
  }
  await audit(ctx.tx, ctx, "numeracao", def.key, "zerar", { excluidos_liberados: liberados.length, contador_anterior: contadorAnterior, liberados });
  const proximo = await proximoCodigo(ctx, def);
  // a trava da TABELA não convive com nenhuma gravação na tabela, de NENHUMA organização, e o pedido na fila já faz
  // as gravações novas esperarem: espera no máximo 2 s (uma importação longa de outra organização não congela todo
  // mundo atrás deste Zerar) e desiste com 409, sem efeito.
  const anterior = (await ctx.tx.query<{ v: string }>("select current_setting('lock_timeout') as v")).rows[0]!.v;
  await ctx.tx.query("select set_config('lock_timeout', '2s', true)");
  try { await ctx.tx.query(`lock table ${t} in share row exclusive mode`); }
  catch (e) {
    if ((e as { code?: string }).code === "55P03") throw err("CONCURRENCY_CONFLICT", `O cadastro ${def.labelPlural} está em uso agora; tente zerar de novo em instantes.`);
    throw e;
  }
  await ctx.tx.query("select set_config('lock_timeout', $1, true)", [anterior]);
  // RECONTAGEM DENTRO DA TRAVA: a única consulta sob ela. Achou vivo (entrou por uma porta que não passa pela trava
  // da numeração) → 422 e a transação desfaz tudo o que veio antes
  const { registros } = await contar(ctx, def);
  if (registros > 0) throw validation(motivoComRegistros(registros, def));
  return { proximoCodigo: proximo };
}

/**
 * MÁSCARA TRAVADA COM REGISTROS (decisão 257 D-4). `novas` = objeto `mascaras_codigo` que VAI ser gravado
 * (a gravação substitui o objeto inteiro: cadastro ausente volta à máscara padrão, e isso também é mudança).
 *
 * As máscaras ATUAIS são lidas SOB a trava da geração (AJUSTES 01 R1, A-8): primeiro a trava da numeração de TODAS
 * as árvores com código (ordem fixa, a mesma lista — sem impasse entre duas gravações de parâmetros), depois a linha
 * da organização `for no key update`: conflita consigo mesma e com o UPDATE de `parameters` (duas gravações de
 * parâmetros se enfileiram), mas NÃO com o `for key share` que a checagem de chave estrangeira toma em toda inclusão
 * que referencia `organizations(id)` — um `for update` aqui pararia toda inclusão da organização, em qualquer
 * tabela, até o commit desta gravação. Lidas antes da trava, uma gravação que
 * reenviava a máscara antiga (a tela manda o objeto inteiro) via "sem mudança", não conferia nada e DESFAZIA a
 * máscara nova depois de um Novo já ter gerado código com ela.
 */
export async function conferirMudancaDeMascara(ctx: ServiceCtx, novas: Record<string, unknown> | undefined): Promise<void> {
  if (novas === undefined) return;
  const defs = CADASTROS_CODIGO_HIERARQUICO.map((c) => getResource(c)!);
  for (const def of defs) await travarNumeracao(ctx, def);
  const parametrosAtuais = (await ctx.tx.query<{ parameters: unknown }>("select parameters from erp.organizations where id=$1 for no key update", [ctx.orgId])).rows[0]?.parameters ?? {};
  for (const def of defs) {
    const c = def.key as (typeof CADASTROS_CODIGO_HIERARQUICO)[number];
    const antes = mascaraDoCadastro(parametrosAtuais, c);
    const depois = mascaraDoCadastro({ [PARAMETRO_MASCARAS_CODIGO]: novas }, c);
    if (antes === depois) continue;
    const { registros } = await contar(ctx, def);
    if (registros > 0) {
      const message = `Há ${registros} ${registros === 1 ? "registro" : "registros"}: a máscara só muda com o cadastro vazio.`;
      throw validation(message, [{ path: [PARAMETRO_MASCARAS_CODIGO, c], message }]);
    }
  }
}
