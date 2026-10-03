/**
 * A CLASSIFICAÇÃO DO LANÇAMENTO QUE O DOCUMENTO NÃO DEU (OPERACOES-01 F9, decisão 286) — o "padrão legado" e a TOP
 * PADRÃO de uma família.
 *
 * O PADRÃO LEGADO é a regra de antes da TOP financeira: sem natureza e centro no documento, o título usa a 1ª natureza
 * analítica ativa (de receita na venda, de despesa na solicitação) e o 1º centro de resultado analítico ativo, pela
 * ordem do código. A regra nova (documento → padrão da TOP → "exigir" recusa → legado; `planoDaClassificacao` no
 * domínio) NÃO o apaga: sem a TOP declarar nada, ele continua valendo, com as MESMAS consultas — é contrato testado,
 * inclusive no skew (sentido 2: a web anterior confirma venda sem classificação pelo "padrão legado").
 *
 * As consultas são as de antes, TEXTO IDÊNTICO ao que cada origem rodava (a da venda em `routes/sales.ts`, a da
 * solicitação em `routes/supply.ts`): estáticas, só o valor da organização vem de fora. O que mudou é só quem as
 * chama — e que agora elas rodam apenas para o campo que a TOP não deu.
 */
import { planoDaClassificacao } from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { padroesDaTopParaExecucao } from "./financeiro-top.js";

/** O tipo da natureza do lançamento: receita (a venda) ou despesa (a solicitação). */
export type NaturezaDoLancamento = "income" | "expense";

/** As consultas "1ª por código" de hoje, por tipo de natureza — o texto exato de cada origem. */
const CONSULTAS_LEGADAS: Readonly<Record<NaturezaDoLancamento, { natureza: string; centro: string }>> = Object.freeze({
  // routes/sales.ts (confirmação da venda sem classificação)
  income: {
    natureza: "select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and is_active and deleted_at is null order by code limit 1",
    centro: "select cc.id from erp.cost_centers cc where cc.organization_id=$1 and cc.kind='analytic' and cc.is_active and cc.deleted_at is null order by code limit 1"
  },
  // routes/supply.ts (solicitação de serviço, adiantamento, reembolso, diária ou contrato finalizada)
  expense: {
    natureza: "select id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' and is_active and deleted_at is null order by code limit 1",
    centro: "select id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1"
  }
});

/** O par do padrão legado. `null` num campo = não pedido, ou a organização não tem nenhum (quem chama decide). */
export interface ClassificacaoLegada { naturezaId: string | null; centroCustoId: string | null }

/**
 * O PADRÃO LEGADO: a 1ª natureza do tipo e o 1º centro, pela ordem do código, com as consultas de hoje. `campos` diz
 * quais buscar (padrão: os dois, na ordem de hoje — natureza e depois centro); o campo não pedido volta `null` sem
 * consulta. Não lança: a recusa (ou o "pula sem título" da solicitação) é de quem chama, com o texto de hoje.
 */
export async function classificacaoLegada(ctx: ServiceCtx, natureza: NaturezaDoLancamento, campos: { natureza: boolean; centro: boolean } = { natureza: true, centro: true }): Promise<ClassificacaoLegada> {
  const q = CONSULTAS_LEGADAS[natureza];
  const cat = campos.natureza ? (await ctx.tx.query<{ id: string }>(q.natureza, [ctx.orgId])).rows[0] : undefined;
  const cc = campos.centro ? (await ctx.tx.query<{ id: string }>(q.centro, [ctx.orgId])).rows[0] : undefined;
  return { naturezaId: cat?.id ?? null, centroCustoId: cc?.id ?? null };
}

/** A TOP padrão de uma família e a versão corrente dela (a que um lançamento SEM TOP no registro usa). */
export interface TopPadraoDaFamilia { tipoOperacaoId: string; tipoOperacaoVersaoId: string }

/**
 * A TOP PADRÃO ATIVA da família na organização (`erp.tipos_operacao.padrao`, única por família entre as ativas e vivas —
 * `ux_tipos_operacao_padrao`, 0020) e a versão CORRENTE dela — ou `null` quando a organização não marcou nenhuma.
 *
 * É a TOP de quem não grava TOP no próprio registro (a solicitação de compra): a versão vale no instante do
 * lançamento. `for share of t` no pai, como `resolverTopParaLancamento` (a versão é imutável): uma inativação ou troca
 * de padrão concorrente espera este lançamento terminar.
 */
export async function topPadraoDaFamilia(ctx: ServiceCtx, familia: string): Promise<TopPadraoDaFamilia | null> {
  const r = await ctx.tx.query<{ id: string; versao_id: string }>(
    `select t.id::text as id, v.id::text as versao_id
       from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v
         on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.organization_id = $1 and t.codigo_base = $2 and t.padrao and t.ativo and t.excluido_em is null
        for share of t`,
    [ctx.orgId, familia]);
  const l = r.rows[0];
  return l ? { tipoOperacaoId: l.id, tipoOperacaoVersaoId: l.versao_id } : null;
}

/**
 * O que a TOP PADRÃO de uma família manda no lançamento de quem não grava TOP no registro (a solicitação de compra):
 *   · `sem_top`  — a organização não marcou TOP padrão, ou a versão dela não está no formato 5, ou não tem padrão
 *                  financeiro e deixa o padrão legado: quem chama faz EXATAMENTE o de antes (e não grava TOP no título);
 *   · `exigir`   — a TOP manda exigir natureza e centro e não os tem: quem chama recusa ANTES de gravar;
 *   · `top`      — a TOP tem padrões: natureza e centro dela (o campo nulo sai do padrão legado, por quem chama), o tipo
 *                  de título e a conta, e a TOP e a versão vão para o título.
 */
export type FinanceiroDaTopPadrao =
  | { tipo: "sem_top" }
  | { tipo: "exigir" }
  | { tipo: "top"; top: TopPadraoDaFamilia; naturezaId: string | null; centroCustoId: string | null; tipoTituloId: string | null; contaBancariaId: string | null };

/** A regra da TOP padrão da `familia` (perguntada ao registry por quem chama; ausente = `sem_top`). */
export async function financeiroDaTopPadrao(ctx: ServiceCtx, familia: string | undefined): Promise<FinanceiroDaTopPadrao> {
  if (!familia) return { tipo: "sem_top" };
  const top = await topPadraoDaFamilia(ctx, familia);
  if (!top) return { tipo: "sem_top" };
  const fin = await padroesDaTopParaExecucao(ctx, top.tipoOperacaoVersaoId);
  const plano = planoDaClassificacao({ documento: { naturezaId: null, centroCustoId: null }, padrao: fin.padroes, semClassificacao: fin.secao.semClassificacao });
  if (plano.tipo === "exigir") return { tipo: "exigir" };
  if (plano.tipo === "legado" && fin.padroes === null) return { tipo: "sem_top" };
  return { tipo: "top", top, naturezaId: plano.naturezaId, centroCustoId: plano.centroCustoId, tipoTituloId: fin.padroes?.tipoTituloId ?? null, contaBancariaId: fin.padroes?.contaBancariaId ?? null };
}

/** A recusa da solicitação quando a TOP padrão dela manda "exigir" e não tem natureza e centro (nada gravado). */
export const MENSAGEM_SOLICITACAO_EXIGE_CLASSIFICACAO =
  "A operação padrão da solicitação exige natureza e centro de resultado: configure os padrões da TOP.";

/** A recusa de hoje quando a venda (ou o previsto do pedido) não tem classificação e a organização não tem o par legado. */
export const MENSAGEM_SEM_CLASSIFICACAO_LEGADA = "Cadastre uma natureza de receita analítica e um centro de resultado analítico";
