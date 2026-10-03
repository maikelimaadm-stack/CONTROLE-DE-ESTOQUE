import {
  SECAO_FINANCEIRO_PADRAO, formato5Top, lerConfiguracaoTop, perfilDosPadroesFinanceiros, resolverTipoOperacao, secoesExtensaoDaVersaoTop,
  type SecaoFinanceiroPadrao
} from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { padroesFinanceirosDasVersoes, padroesFinanceirosDaVersao, type PadroesFinanceirosResolvidos } from "./financeiro-padroes-top.js";

/**
 * O FINANCEIRO PELA TOP NA EXECUÇÃO (OPERACOES-01 F9, decisão 286) — o que a versão CONGELADA de uma TOP manda no
 * lançamento financeiro: as regras da seção `financeiroPadrao` do formato 5 (provisão, o documento troca, sem
 * classificação) e os padrões da versão (natureza, centro, tipo de título, forma e conta — a tabela da 0045).
 *
 * SÓ O FORMATO 5 EXECUTA (decisão 240, item 4: a regra nova nasce desligada). Versão nos formatos 1 a 4, ilegível ou
 * de uma família que não usa a seção → a seção NEUTRA (nenhuma provisão, o documento troca, o padrão legado) e
 * nenhum padrão: o comportamento de hoje, intacto. Quem decide o que fazer com isso é o serviço dono do lançamento
 * (o título avulso e o movimento aqui; a venda, o pedido e a solicitação no P5).
 *
 * As famílias são PERGUNTADAS ao registry (`resolverTipoOperacao`) — nenhum código de família escrito aqui. Família
 * que o registry não declara é erro de programação, não um lançamento sem TOP: falha na carga do módulo.
 */
type Direcao = "payable" | "receivable";

const familiaDoRegistry = (tabela: string, valor?: string): string => {
  const codigo = resolverTipoOperacao(tabela, valor)?.codigo;
  if (!codigo) throw new Error(`O registry de TOP não declara a família de ${tabela}${valor ? ` (${valor})` : ""}`);
  return codigo;
};

const FAMILIA_DA_DIRECAO: Readonly<Record<Direcao, string>> = Object.freeze({
  payable: familiaDoRegistry("erp.financial_titles", "payable"),
  receivable: familiaDoRegistry("erp.financial_titles", "receivable")
});
/** A família do título avulso pela direção (conta a pagar / conta a receber). */
export const familiaDaDirecao = (d: Direcao): string => FAMILIA_DA_DIRECAO[d];
/** A família do movimento bancário (a tabela inteira). */
export const FAMILIA_DO_MOVIMENTO: string = familiaDoRegistry("erp.bank_movements");

/** O que a versão manda no financeiro. `padroes` nulo = nenhum padrão (versão fora do 5, sem linha, ou família sem perfil). */
export interface FinanceiroDaVersao {
  formato5: boolean;
  familia: string | null;
  secao: SecaoFinanceiroPadrao;
  padroes: PadroesFinanceirosResolvidos | null;
}

const neutro = (familia: string | null, formato5 = false): FinanceiroDaVersao => ({ formato5, familia, secao: SECAO_FINANCEIRO_PADRAO.neutro(), padroes: null });

interface LinhaDaVersao { id: string; configuracao: unknown; codigo_base: string }

/** A regra da linha lida: formato 5 de uma família com perfil → a seção dela; senão o neutro. */
function secaoDaLinha(l: LinhaDaVersao): { formato5: boolean; secao: SecaoFinanceiroPadrao | null } {
  const lida = lerConfiguracaoTop(l.configuracao);
  if (!lida.ok || !formato5Top(lida.valor)) return { formato5: false, secao: null };
  if (!perfilDosPadroesFinanceiros(l.codigo_base)) return { formato5: true, secao: null };
  return { formato5: true, secao: secoesExtensaoDaVersaoTop(lida.valor).financeiroPadrao };
}

/**
 * A versão `versaoId` (a congelada no documento, ou a corrente que a porta de lançamento acabou de resolver): UMA
 * leitura da versão e do pai, e a dos padrões só quando a versão executa. Versão nula ou inexistente → neutro.
 */
export async function padroesDaTopParaExecucao(ctx: ServiceCtx, versaoId: string | null): Promise<FinanceiroDaVersao> {
  if (!versaoId) return neutro(null);
  const r = await ctx.tx.query<LinhaDaVersao>(
    `select v.id::text as id, v.configuracao, t.codigo_base
       from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
      where v.id = $1 and v.organization_id = $2`, [versaoId, ctx.orgId]);
  const l = r.rows[0];
  if (!l) return neutro(null);
  const { formato5, secao } = secaoDaLinha(l);
  if (!secao) return neutro(l.codigo_base, formato5);
  return { formato5, familia: l.codigo_base, secao, padroes: await padroesFinanceirosDaVersao(ctx, l.id) };
}

/**
 * O mesmo para VÁRIAS versões já lidas (a lista de TOPs da Central): os padrões numa consulta só, e só das versões que
 * executam (formato 5 e família com perfil).
 */
export async function padroesDasVersoesParaExecucao(ctx: ServiceCtx, linhas: readonly LinhaDaVersao[]): Promise<Map<string, FinanceiroDaVersao>> {
  const lidas = linhas.map((l) => ({ l, ...secaoDaLinha(l) }));
  const executam = lidas.filter((x) => x.secao !== null).map((x) => x.l.id);
  const padroes = executam.length ? await padroesFinanceirosDasVersoes(ctx, executam) : new Map<string, PadroesFinanceirosResolvidos>();
  return new Map(lidas.map((x) => [x.l.id.toLowerCase(), x.secao
    ? { formato5: x.formato5, familia: x.l.codigo_base, secao: x.secao, padroes: padroes.get(x.l.id.toLowerCase()) ?? null }
    : neutro(x.l.codigo_base, x.formato5)]));
}
