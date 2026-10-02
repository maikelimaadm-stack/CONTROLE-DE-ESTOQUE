import type { Tx } from "@agro/db";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

/**
 * O IMÓVEL RURAL DO LCDPR NOS LANÇAMENTOS DE CAIXA (OPERACOES-01 F9, decisão 286; tabela `erp.imoveis_rurais`, 0045).
 *
 * A baixa bancária e o movimento bancário de ENTRADA ou SAÍDA de uma empresa levam o imóvel rural do livro caixa:
 *   · nada informado (`undefined`) → o imóvel PADRÃO da empresa (a marca `padrao`, um por empresa entre os vivos);
 *     empresa sem padrão → nenhum, exatamente como antes da F9;
 *   · `null` explícito → nenhum imóvel;
 *   · um id → conferido: da MESMA empresa do lançamento, ativo e vivo.
 * A transferência entre contas e o saldo inicial ficam FORA do LCDPR: nunca levam imóvel (o CHECK da 0045 é a rede).
 *
 * SUPERFÍCIE ÚNICA DE RECUSA: inexistente, de outra organização, de outra empresa, inativo, excluído e id malformado
 * recebem a MESMA 422 (`MENSAGEM_IMOVEL_INVALIDO`) — distinguir faria do lançamento um oráculo de imóveis alheios.
 *
 * A leitura passa pela RLS de `erp.imoveis_rurais` (por empresa, módulo da rota) e pelo filtro de organização. As
 * respostas valem por TRANSAÇÃO e por módulo publicado: a baixa em lote pergunta o padrão de cada empresa uma vez só, e
 * a conferência de um mesmo imóvel (o principal, os componentes e a tarifa da mesma baixa) não volta ao banco.
 */
export const MENSAGEM_IMOVEL_INVALIDO = "Imóvel rural inválido para a empresa do lançamento.";
export const MENSAGEM_IMOVEL_NA_TRANSFERENCIA = "Transferência entre contas não leva imóvel rural (fica fora do LCDPR).";
export const MENSAGEM_IMOVEL_NA_COMPENSACAO = "A compensação não movimenta caixa: não leva imóvel rural.";
export const MENSAGEM_IMOVEL_NO_SALDO_INICIAL = "Saldo inicial não leva imóvel rural (fica fora do LCDPR).";

/** As categorias de movimento que ENTRAM no livro caixa (o imóvel padrão só se aplica a elas). */
const CATEGORIAS_DO_LIVRO: readonly string[] = ["in", "out"];
/** As que ficam FORA do LCDPR: o imóvel informado nelas é recusado, com o motivo. */
const CATEGORIAS_FORA_DO_LIVRO: Readonly<Record<string, string>> = { internal_transfer: MENSAGEM_IMOVEL_NA_TRANSFERENCIA, opening_balance: MENSAGEM_IMOVEL_NO_SALDO_INICIAL };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cache vive com a transação (a chave é o objeto `Tx`): morre no commit, como o resto do contexto. */
const padroes = new WeakMap<Tx, Map<string, string | null>>();
const conferidos = new WeakMap<Tx, Set<string>>();
/** A resposta depende do módulo publicado (a RLS da tabela lê `app.modulo_empresa`): ele entra na chave. */
const chave = (ctx: ServiceCtx, ...partes: string[]) => [ctx.moduloEmpresa ?? "", ...partes.map((p) => p.toLowerCase())].join("|");

/** O imóvel padrão da empresa (ativo, vivo, marcado `padrao`), ou `null` quando a empresa não tem. */
export async function imovelRuralPadraoDaEmpresa(ctx: ServiceCtx, empresaId: string): Promise<string | null> {
  const k = chave(ctx, empresaId);
  let cache = padroes.get(ctx.tx);
  if (!cache) { cache = new Map(); padroes.set(ctx.tx, cache); }
  if (cache.has(k)) return cache.get(k) ?? null;
  const r = await ctx.tx.query<{ id: string }>(
    "select id::text as id from erp.imoveis_rurais where organization_id=$1 and empresa_id=$2 and padrao and is_active and deleted_at is null",
    [ctx.orgId, empresaId]);
  const id = r.rows[0]?.id ?? null;
  cache.set(k, id);
  return id;
}

/**
 * Confere o imóvel informado contra a EMPRESA do lançamento (mesma empresa, ativo, vivo) e devolve o id em minúsculas.
 * Qualquer motivo de recusa → a MESMA 422 no campo `imovel_rural_id`. `for share`: o imóvel não é inativado nem
 * excluído entre a conferência e a gravação.
 */
export async function conferirImovelRural(ctx: ServiceCtx, imovelId: string, empresaId: string | null): Promise<string> {
  const id = imovelId.toLowerCase();
  const recusa = () => validation(MENSAGEM_IMOVEL_INVALIDO, [{ path: ["imovel_rural_id"], message: MENSAGEM_IMOVEL_INVALIDO }]);
  if (!UUID.test(id) || !empresaId) throw recusa();
  const k = chave(ctx, empresaId, id);
  let cache = conferidos.get(ctx.tx);
  if (!cache) { cache = new Set(); conferidos.set(ctx.tx, cache); }
  if (cache.has(k)) return id;
  const r = await ctx.tx.query(
    "select 1 from erp.imoveis_rurais where id=$1 and organization_id=$2 and empresa_id=$3 and is_active and deleted_at is null for share",
    [id, ctx.orgId, empresaId]);
  if (r.rowCount !== 1) throw recusa();
  cache.add(k);
  return id;
}

/**
 * O imóvel de um MOVIMENTO bancário, pela regra do topo: `pedido` é o que veio (ausente, nulo ou id), `categoria` é a
 * `category_type` do movimento e `empresaId` a empresa dele. Fora do livro (transferência, saldo inicial) o imóvel
 * informado é recusado; o padrão só vale para entrada e saída com empresa.
 */
export async function resolverImovelDoMovimento(ctx: ServiceCtx, p: { pedido: string | null | undefined; empresaId: string | null; categoria: string }): Promise<string | null> {
  if (p.pedido === null) return null;
  if (p.pedido === undefined) return p.empresaId && CATEGORIAS_DO_LIVRO.includes(p.categoria) ? imovelRuralPadraoDaEmpresa(ctx, p.empresaId) : null;
  const fora = Object.prototype.hasOwnProperty.call(CATEGORIAS_FORA_DO_LIVRO, p.categoria) ? CATEGORIAS_FORA_DO_LIVRO[p.categoria] : undefined;
  if (fora) throw validation(fora, [{ path: ["imovel_rural_id"], message: fora }]);
  return conferirImovelRural(ctx, p.pedido, p.empresaId);
}

/** O imóvel de uma BAIXA bancária do título: ausente → o padrão da empresa do título; nulo → nenhum; id → conferido. */
export async function resolverImovelDaBaixa(ctx: ServiceCtx, pedido: string | null | undefined, empresaId: string): Promise<string | null> {
  if (pedido === null) return null;
  if (pedido === undefined) return imovelRuralPadraoDaEmpresa(ctx, empresaId);
  return conferirImovelRural(ctx, pedido, empresaId);
}

/** As opções de imóvel de UMA empresa (ativos e vivos): o padrão primeiro, depois pelo nome. */
export async function imoveisRuraisDaEmpresa(ctx: ServiceCtx, empresaId: string): Promise<{ id: string; nome: string; cib: string | null; padrao: boolean }[]> {
  const r = await ctx.tx.query<{ id: string; nome: string; cib: string | null; padrao: boolean }>(
    "select id::text as id, nome, cib, padrao from erp.imoveis_rurais where organization_id=$1 and empresa_id=$2 and is_active and deleted_at is null order by padrao desc, nome, id",
    [ctx.orgId, empresaId]);
  return r.rows;
}
