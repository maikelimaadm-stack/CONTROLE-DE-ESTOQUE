/**
 * OS PADRÕES FINANCEIROS DE UMA VERSÃO DE TOP (OPERACOES-01 F9, decisão 286) — o acesso à tabela
 * `erp.tipos_operacao_versao_financeiro` (migration 0045).
 *
 * A seção `financeiroPadrao` do formato 5 guarda só REGRAS no JSON da versão (provisão, o documento troca, sem
 * classificação). Os ALVOS concretos — natureza, centro de resultado, tipo de título, forma de pagamento e conta —
 * são UUIDs de cadastro, e moram nesta tabela, uma linha por versão (regra 4 do ponto de extensão do formato 5, o
 * molde de `erp.tipos_operacao_versao_condicoes`). A linha é imutável como a versão: editar a TOP grava uma versão
 * nova com a sua própria linha (quem copia os padrões vigentes para a versão nova é a rota da TOP).
 *
 * Este módulo NÃO conhece família nem perfil (é do domínio, `perfilDosPadroesFinanceiros`): quem chama diz quais
 * naturezas a operação aceita (`naturezasAceitas`). Aqui ficam só as quatro portas do banco:
 *
 *   · `conferirPadroesFinanceiros` — UMA consulta por cadastro informado, `for share` (o cadastro não pode ser
 *     excluído nem inativado entre a conferência e a gravação). SUPERFÍCIE ÚNICA DE RECUSA: inexistente, de outra
 *     organização, excluído, inativo, sintético e natureza de tipo não aceito recebem a MESMA mensagem do campo —
 *     distinguir faria do editor da TOP um oráculo de ids da vizinha. Tipo de título e forma de pagamento aceitam a
 *     organização da sessão OU nula (as linhas do SISTEMA, 0004 e 0005): é a conferência que a FK de coluna única
 *     da 0045 não faz. Devolve as recusas no formato da configuração da TOP; não lança.
 *   · `gravarPadroesFinanceiros` — uma linha (padrões vazios = nada), com ROW COUNT conferido.
 *   · `padroesFinanceirosDasVersoes` — em LOTE (UMA consulta com os joins), com os nomes mesmo de cadastro hoje
 *     inativo ou excluído: é o histórico da versão, não uma oferta para lançamento novo.
 *   · `padroesFinanceirosDaVersao` — a mesma leitura para uma versão só.
 *
 * Ids sempre em minúsculas antes de qualquer uso (o banco devolve minúsculas; a comparação é por texto).
 */
import type { ServiceCtx } from "./context.js";

/** Os cinco padrões de uma versão (o corpo da TOP e a linha da tabela). `null` = sem padrão naquele campo. */
export interface PadroesFinanceirosIds {
  naturezaId: string | null;
  centroCustoId: string | null;
  tipoTituloId: string | null;
  formaPagamentoId: string | null;
  contaBancariaId: string | null;
}

/** Os padrões com o cadastro de cada um (para a tela da TOP e para quem executa). Objeto `null` = campo vazio. */
export interface PadroesFinanceirosResolvidos extends PadroesFinanceirosIds {
  natureza: { id: string; codigo: string; nome: string } | null;
  centro: { id: string; codigo: string; nome: string } | null;
  tipoTitulo: { id: string; nome: string } | null;
  formaPagamento: { id: string; nome: string } | null;
  conta: { id: string; codigo: string; descricao: string } | null;
}

/** Uma recusa no formato da configuração da TOP (`TIPO_OPERACAO_CONFIGURACAO_INVALIDA`, `{ recusas }`). */
export interface RecusaDosPadroesFinanceiros {
  caminho: string;
  motivo: "valor_invalido";
  mensagem: string;
}

/** Os campos, na ORDEM em que são conferidos e devolvidos. */
const CAMPOS: readonly (keyof PadroesFinanceirosIds)[] = ["naturezaId", "centroCustoId", "tipoTituloId", "formaPagamentoId", "contaBancariaId"];

/** UMA mensagem por campo — a mesma para todo motivo de recusa (inexistente, alheio, excluído, inativo, sintético, tipo). */
export const MENSAGENS_PADROES_FINANCEIROS: Readonly<Record<keyof PadroesFinanceirosIds, string>> = {
  naturezaId: "Natureza padrão inválida para esta operação: escolha uma natureza analítica, ativa e do tipo da operação.",
  centroCustoId: "Centro de resultado padrão inválido: escolha um centro analítico e ativo.",
  tipoTituloId: "Tipo de título padrão inválido.",
  formaPagamentoId: "Forma de pagamento padrão inválida: escolha uma forma ativa.",
  contaBancariaId: "Conta padrão inválida: escolha uma conta ativa da organização."
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O valor do campo, em minúsculas; vazio (`null`, ausente ou texto vazio) = `null`. */
const valorDe = (p: PadroesFinanceirosIds, campo: keyof PadroesFinanceirosIds): string | null => {
  const v = p[campo];
  return typeof v === "string" && v !== "" ? v.toLowerCase() : null;
};

/** Nenhum dos cinco padrões informado (a versão não ganha linha na tabela). */
export const padroesVazios = (p: PadroesFinanceirosIds): boolean => CAMPOS.every((campo) => valorDe(p, campo) === null);

/**
 * A consulta de conferência de cada campo: `$1` = id, `$2` = organização da sessão, `$3` = naturezas aceitas (só a
 * natureza). Estática (nenhum identificador vem do pedido) e com `for share`.
 */
const CONFERENCIA: Readonly<Record<keyof PadroesFinanceirosIds, string>> = {
  naturezaId: `select 1 from erp.financial_categories
                where id = $1 and organization_id = $2 and deleted_at is null and is_active and kind = 'analytic' and nature = any($3::text[])
                for share`,
  centroCustoId: `select 1 from erp.cost_centers
                   where id = $1 and organization_id = $2 and deleted_at is null and is_active and kind = 'analytic'
                   for share`,
  // Tipo de título não tem ativo nem exclusão (0004): da organização ou do sistema.
  tipoTituloId: `select 1 from erp.title_types
                  where id = $1 and (organization_id = $2 or organization_id is null)
                  for share`,
  formaPagamentoId: `select 1 from erp.payment_methods
                      where id = $1 and (organization_id = $2 or organization_id is null) and is_active
                      for share`,
  contaBancariaId: `select 1 from erp.bank_accounts
                     where id = $1 and organization_id = $2 and deleted_at is null and is_active
                     for share`
};

/**
 * Confere os padrões informados. Campo vazio não é conferido. Id malformado recebe a MESMA recusa do campo, sem ir ao
 * banco (o cast para uuid falharia com erro genérico). Devolve as recusas na ordem dos campos (vazio = tudo válido).
 */
export async function conferirPadroesFinanceiros(ctx: ServiceCtx, p: PadroesFinanceirosIds, naturezasAceitas: readonly string[]): Promise<RecusaDosPadroesFinanceiros[]> {
  const recusas: RecusaDosPadroesFinanceiros[] = [];
  for (const campo of CAMPOS) {
    const id = valorDe(p, campo);
    if (id === null) continue;
    const valido = UUID.test(id)
      && ((await ctx.tx.query(CONFERENCIA[campo], campo === "naturezaId" ? [id, ctx.orgId, [...naturezasAceitas]] : [id, ctx.orgId])).rowCount ?? 0) > 0;
    if (!valido) recusas.push({ caminho: `padroesFinanceiros.${campo}`, motivo: "valor_invalido", mensagem: MENSAGENS_PADROES_FINANCEIROS[campo] });
  }
  return recusas;
}

/**
 * Grava os padrões de UMA versão (a recém-criada). Vazio = nada (a versão fica sem linha). ROW COUNT SOB RLS: a
 * linha que não entra, sem conferência, viraria "salvo" sem os padrões.
 */
export async function gravarPadroesFinanceiros(ctx: ServiceCtx, versaoId: string, tipoOperacaoId: string, p: PadroesFinanceirosIds): Promise<void> {
  if (padroesVazios(p)) return;
  const r = await ctx.tx.query(
    `insert into erp.tipos_operacao_versao_financeiro
       (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ctx.orgId, versaoId.toLowerCase(), tipoOperacaoId.toLowerCase(), valorDe(p, "naturezaId"), valorDe(p, "centroCustoId"),
      valorDe(p, "tipoTituloId"), valorDe(p, "formaPagamentoId"), valorDe(p, "contaBancariaId"), ctx.user.id]);
  if (r.rowCount !== 1) throw new Error("gravação dos padrões financeiros incompleta");
}

interface LinhaDosPadroes {
  origem_versao_id: string;
  natureza_id: string | null; centro_custo_id: string | null; tipo_titulo_id: string | null; forma_pagamento_id: string | null; conta_bancaria_id: string | null;
  natureza_codigo: string | null; natureza_nome: string | null;
  centro_codigo: string | null; centro_nome: string | null;
  tipo_titulo_nome: string | null;
  forma_nome: string | null;
  conta_codigo: string | null; conta_descricao: string | null;
}

/**
 * Os padrões de VÁRIAS versões, em UMA consulta. Versão sem linha (sem padrão) fica AUSENTE do mapa. Os nomes vêm
 * mesmo de cadastro hoje inativo ou excluído (é o histórico da versão). Ids malformados são ignorados (não existem).
 */
export async function padroesFinanceirosDasVersoes(ctx: ServiceCtx, versaoIds: readonly string[]): Promise<Map<string, PadroesFinanceirosResolvidos>> {
  const mapa = new Map<string, PadroesFinanceirosResolvidos>();
  const ids = [...new Set(versaoIds.filter((x) => UUID.test(x)).map((x) => x.toLowerCase()))];
  if (ids.length === 0) return mapa;
  const r = await ctx.tx.query<LinhaDosPadroes>(
    `select x.origem_versao_id, x.natureza_id, x.centro_custo_id, x.tipo_titulo_id, x.forma_pagamento_id, x.conta_bancaria_id,
            n.code as natureza_codigo, n.name as natureza_nome,
            c.code as centro_codigo, c.name as centro_nome,
            t.name as tipo_titulo_nome,
            f.name as forma_nome,
            b.code as conta_codigo, b.description as conta_descricao
       from erp.tipos_operacao_versao_financeiro x
       left join erp.financial_categories n on n.id = x.natureza_id and n.organization_id = x.organization_id
       left join erp.cost_centers c on c.id = x.centro_custo_id and c.organization_id = x.organization_id
       left join erp.title_types t on t.id = x.tipo_titulo_id and (t.organization_id = x.organization_id or t.organization_id is null)
       left join erp.payment_methods f on f.id = x.forma_pagamento_id and (f.organization_id = x.organization_id or f.organization_id is null)
       left join erp.bank_accounts b on b.id = x.conta_bancaria_id and b.organization_id = x.organization_id
      where x.organization_id = $1 and x.origem_versao_id = any($2::uuid[])`,
    [ctx.orgId, ids]);
  for (const l of r.rows) {
    mapa.set(l.origem_versao_id, {
      naturezaId: l.natureza_id,
      centroCustoId: l.centro_custo_id,
      tipoTituloId: l.tipo_titulo_id,
      formaPagamentoId: l.forma_pagamento_id,
      contaBancariaId: l.conta_bancaria_id,
      natureza: l.natureza_id && l.natureza_codigo !== null && l.natureza_nome !== null ? { id: l.natureza_id, codigo: l.natureza_codigo, nome: l.natureza_nome } : null,
      centro: l.centro_custo_id && l.centro_codigo !== null && l.centro_nome !== null ? { id: l.centro_custo_id, codigo: l.centro_codigo, nome: l.centro_nome } : null,
      tipoTitulo: l.tipo_titulo_id && l.tipo_titulo_nome !== null ? { id: l.tipo_titulo_id, nome: l.tipo_titulo_nome } : null,
      formaPagamento: l.forma_pagamento_id && l.forma_nome !== null ? { id: l.forma_pagamento_id, nome: l.forma_nome } : null,
      conta: l.conta_bancaria_id && l.conta_codigo !== null && l.conta_descricao !== null ? { id: l.conta_bancaria_id, codigo: l.conta_codigo, descricao: l.conta_descricao } : null
    });
  }
  return mapa;
}

/** A recusa de quem LANÇA quando a conta padrão da versão deixou de ser utilizável (inativada ou excluída depois). */
export const MENSAGEM_CONTA_PADRAO_INUTILIZAVEL = "A conta padrão da operação está inativa ou foi excluída: ajuste os padrões da TOP.";

/**
 * A conta padrão de uma versão continua UTILIZÁVEL (da organização, viva e ativa)? A versão é imutável; o cadastro, não:
 * a conta conferida ao gravar a TOP pode ter sido inativada ou excluída depois. Quem LANÇA o título com ela (a venda, o
 * previsto do pedido, a solicitação) confere de novo antes — a natureza e o centro já passam pela conferência do rateio
 * (`exigirRateioAnalitico`), e o tipo de título não tem ativo nem exclusão. `trava` = `for share` (a conta não muda
 * entre a conferência e a gravação). Id malformado = não utilizável, sem ir ao banco.
 */
export async function contaPadraoUtilizavel(ctx: ServiceCtx, contaId: string, o: { trava: boolean }): Promise<boolean> {
  const id = contaId.toLowerCase();
  if (!UUID.test(id)) return false;
  const sql = `select 1 from erp.bank_accounts where id = $1 and organization_id = $2 and deleted_at is null and is_active${o.trava ? " for share" : ""}`;
  return ((await ctx.tx.query(sql, [id, ctx.orgId])).rowCount ?? 0) > 0;
}

/** Os padrões de UMA versão (`null` = versão nula, ou versão sem padrão). */
export async function padroesFinanceirosDaVersao(ctx: ServiceCtx, versaoId: string | null): Promise<PadroesFinanceirosResolvidos | null> {
  if (versaoId === null) return null;
  return (await padroesFinanceirosDasVersoes(ctx, [versaoId])).get(versaoId.toLowerCase()) ?? null;
}
