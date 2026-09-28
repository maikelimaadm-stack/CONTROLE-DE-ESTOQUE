/**
 * TOP-CONFIG-05 — CLIENTE EM ATRASO (decisão 263).
 *
 * A API NUNCA lê `erp.financial_titles` para esta pergunta: quem lança venda não precisa enxergar o financeiro.
 * A resposta vem da porta estreita `erp.situacao_atraso_cliente` (0033), que devolve SÓ agregados, reconfere a
 * capacidade de lançar venda e tira organização e usuário da GUC do servidor — nunca de parâmetro.
 */
import type { SituacaoAtrasoCliente } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";

/** Agregados do atraso do cliente além da tolerância. Zero linhas (sem capacidade) = nada vencido visível. */
export async function situacaoAtrasoCliente(ctx: ServiceCtx, clienteId: string, toleranciaDias: number): Promise<SituacaoAtrasoCliente> {
  const r = await ctx.tx.query<{ titulos: number; total: string; vencimento_mais_antigo: string | null }>(
    `select titulos, total::text as total, vencimento_mais_antigo::text as vencimento_mais_antigo
       from erp.situacao_atraso_cliente($1::uuid, $2::int)`,
    [clienteId, toleranciaDias]);
  const l = r.rows[0];
  if (!l) return { titulos: 0, total: "0", vencimentoMaisAntigo: null };
  return { titulos: Number(l.titulos), total: l.total, vencimentoMaisAntigo: l.vencimento_mais_antigo };
}
