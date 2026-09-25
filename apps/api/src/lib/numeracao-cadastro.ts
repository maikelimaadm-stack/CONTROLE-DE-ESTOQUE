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
import { notFound, validation } from "./errors.js";
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

/**
 * ZERAR (decisão 257 D-3). A ORDEM das travas é a mesma de quem inclui: numeração → contador → tabela. Assim o
 * Novo que já pegou número (e segura a linha do contador até o commit) termina primeiro e a recontagem o vê;
 * e o Novo que chega depois espera o Zerar e recebe o 1. A trava da TABELA (`share row exclusive`: não convive
 * com inclusão e nem com outro Zerar) fecha as portas que numeram sem passar por aqui.
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
  await ctx.tx.query(`lock table erp.${ident(def.table)} in share row exclusive mode`);
  // RECONTAGEM DENTRO DA TRAVA: a contagem da tela é de antes; só esta decide
  const { registros } = await contar(ctx, def);
  if (registros > 0) throw validation(motivoComRegistros(registros, def));
  const lib = await ctx.tx.query(`update erp.${ident(def.table)} set code = 'EXC-' || id::text where organization_id=$1 and deleted_at is not null and code is not null and code not like 'EXC-%'`, [ctx.orgId]);
  if (def.codeEntity && contadorAnterior !== null) {
    const z = await ctx.tx.query("update erp.code_sequences set last_value = 0 where organization_id=$1 and entity=$2", [ctx.orgId, def.codeEntity]);
    if (z.rowCount !== 1) throw validation("Não foi possível zerar o contador deste cadastro.");
  }
  await audit(ctx.tx, ctx, "numeracao", def.key, "zerar", { excluidos_liberados: lib.rowCount ?? 0, contador_anterior: contadorAnterior });
  return { proximoCodigo: await proximoCodigo(ctx, def) };
}

/**
 * MÁSCARA TRAVADA COM REGISTROS (decisão 257 D-4). `novas` = objeto `mascaras_codigo` que VAI ser gravado
 * (a gravação substitui o objeto inteiro: cadastro ausente volta à máscara padrão, e isso também é mudança).
 */
export async function conferirMudancaDeMascara(ctx: ServiceCtx, parametrosAtuais: unknown, novas: Record<string, unknown> | undefined): Promise<void> {
  if (novas === undefined) return;
  for (const c of CADASTROS_CODIGO_HIERARQUICO) {
    const antes = mascaraDoCadastro(parametrosAtuais, c);
    const depois = mascaraDoCadastro({ [PARAMETRO_MASCARAS_CODIGO]: novas }, c);
    if (antes === depois) continue;
    const def = getResource(c)!;
    await travarNumeracao(ctx, def);
    const { registros } = await contar(ctx, def);
    if (registros > 0) {
      const message = `Há ${registros} ${registros === 1 ? "registro" : "registros"}: a máscara só muda com o cadastro vazio.`;
      throw validation(message, [{ path: [PARAMETRO_MASCARAS_CODIGO, c], message }]);
    }
  }
}
