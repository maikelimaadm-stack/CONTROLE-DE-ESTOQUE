/**
 * TOP-CONFIG-05 — CLIENTE EM ATRASO (decisão 263).
 *
 * A API NUNCA lê `erp.financial_titles` para esta pergunta: quem lança venda não precisa enxergar o financeiro.
 * A resposta vem da porta estreita `erp.situacao_atraso_cliente` (0033), que devolve SÓ agregados, reconfere a
 * capacidade de lançar venda e tira organização e usuário da GUC do servidor — nunca de parâmetro.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { familiaOperacionalDeDocumentoVenda, type SalesKind, type SituacaoAtrasoCliente, type SituacaoClienteResposta } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";
import { runService } from "../lib/service.js";
import { notFound } from "../lib/errors.js";
import { regrasDaTopAtual, type RegrasDaVersaoTop } from "./vendas-regras-operacao.js";

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

/**
 * A MONTAGEM da situação do cliente — UM dono para as DUAS portas que a servem:
 *   `GET <base>/situacao-cliente` → pela versão ATUAL da TOP escolhida, para o cliente escolhido (lançamento);
 *   `GET <base>/:id/edicao` (EDITAR-01, decisão 272) → pela versão CONGELADA do documento, para o cliente GRAVADO.
 * A pergunta (qual versão, qual cliente) é de cada porta; a FORMA é esta. Sem regras do formato 3, ou com a política
 * `nao_valida`, responde só `{ politica: "nao_valida" }` SEM consultar a porta do atraso.
 */
export async function respostaDaSituacaoCliente(ctx: ServiceCtx, regras: RegrasDaVersaoTop | null, clienteId: string): Promise<SituacaoClienteResposta> {
  const politica = regras?.config.financeiro.clienteEmAtraso;
  if (!regras || !politica || politica === "nao_valida") return { politica: "nao_valida" };
  const s = await situacaoAtrasoCliente(ctx, clienteId, regras.config.financeiro.toleranciaAtrasoDias);
  return { politica, emAtraso: s.titulos > 0, titulos: s.titulos, total: s.total, vencimentoMaisAntigo: s.vencimentoMaisAntigo };
}

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Query ESTRITA: chave desconhecida ou ausente → 422. A FORMA do id não é conferida aqui: malformado cai na 404. */
const situacaoClienteQuery = z.object({ client_id: z.string(), tipo_operacao_id: z.string() }).strict();

/**
 * `GET <base>/situacao-cliente?client_id=&tipo_operacao_id=` — MESMA permissão e porta de `/layout-efetivo`.
 * TOP que a variante não enxerga (malformada, inexistente, de outro tenant, de outra família, inativa, excluída) e
 * cliente que não é pessoa viva desta organização (malformado, inexistente, de outro tenant, excluído) caem cada um
 * na MESMA 404: distinguir seria oráculo de existência. A política é a da versão ATUAL da TOP; formato < 3 ou
 * `nao_valida` responde só `{ politica: "nao_valida" }` SEM consultar a porta do atraso.
 */
export function registrarSituacaoCliente(app: FastifyInstance, kind: SalesKind, base: string, perm: string): void {
  app.get(`${base}/situacao-cliente`, async (req) => runService(app, req, `${perm}.create`, async (ctx): Promise<SituacaoClienteResposta> => {
    const q = situacaoClienteQuery.parse(req.query ?? {});
    const familia = familiaOperacionalDeDocumentoVenda(kind);
    if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { kind });
    if (!FORMA_UUID.test(q.tipo_operacao_id)) throw notFound("Tipo de operação");
    const v = await ctx.tx.query("select 1 from erp.tipos_operacao where id=$1 and organization_id=$2 and codigo_base=$3 and ativo and excluido_em is null", [q.tipo_operacao_id, ctx.orgId, familia]);
    if (!v.rowCount) throw notFound("Tipo de operação");
    if (!FORMA_UUID.test(q.client_id)) throw notFound("Cliente");
    const c = await ctx.tx.query("select 1 from erp.people where id=$1 and organization_id=$2 and deleted_at is null", [q.client_id, ctx.orgId]);
    if (!c.rowCount) throw notFound("Cliente");
    const { regras } = await regrasDaTopAtual(ctx, q.tipo_operacao_id);
    return respostaDaSituacaoCliente(ctx, regras, q.client_id);
  }));
}
