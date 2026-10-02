import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CAPACIDADE_FINANCEIRO_PELA_TOP, SECAO_FINANCEIRO_PADRAO } from "@agro/domain";
import { runService, comPermissaoResolvida } from "../lib/service.js";
import { hasPermission } from "../lib/context.js";
import { denied } from "../lib/errors.js";
import { familiaDaDirecao, FAMILIA_DO_MOVIMENTO, padroesDasVersoesParaExecucao } from "../lib/financeiro-top.js";

/**
 * O FINANCEIRO PELA TOP — A LISTA DE TOPS DO LANÇAMENTO (OPERACOES-01 F9, decisão 286). Prefixo próprio
 * (`/api/financeiro/*`): a API anterior responde 404 de rota, e a web só pergunta com `financeiroPelaTop` declarado.
 *
 * `GET /financeiro/tops?direcao=pagar|receber|movimento` — as TOPs ATIVAS (vivas) da família do lançamento, na versão
 * CORRENTE, a padrão primeiro e depois pelo código, cada uma com a seção `financeiroPadrao` e os padrões (com os nomes)
 * — só de versão no formato 5; nos formatos 1 a 4, a seção neutra e os padrões nulos (o que o servidor executa). Os
 * padrões de todas as versões numa consulta só (sem N+1).
 *
 * PORTA DINÂMICA: a direção decide a capacidade (`payables.create`, `receivables.create` ou `bank_movements.create`),
 * a mesma da gravação do lançamento; sem ela → 403. A TOP é cadastro da organização (sem empresa): nada a recortar.
 * Query ESTRITA: chave desconhecida ou direção fora da lista → 422.
 */
const DIRECOES = { pagar: "payables.create", receber: "receivables.create", movimento: "bank_movements.create" } as const;
type DirecaoDaLista = keyof typeof DIRECOES;
const consulta = z.object({ direcao: z.enum(["pagar", "receber", "movimento"]) }).strict();

const familiaDaLista = (d: DirecaoDaLista): string => (d === "pagar" ? familiaDaDirecao("payable") : d === "receber" ? familiaDaDirecao("receivable") : FAMILIA_DO_MOVIMENTO);

interface LinhaDaTop { id: string; codigo: string; nome: string; versao: number; versao_id: string; padrao: boolean; configuracao: unknown; codigo_base: string }

export default async function financeiroTopsRoutes(app: FastifyInstance) {
  app.get("/financeiro/tops", async (req) => runService(app, req, null, async (ctx0) => {
    const q = consulta.parse(req.query);
    const permissao = DIRECOES[q.direcao];
    if (!hasPermission(ctx0, permissao)) throw denied(permissao);
    const ctx = await comPermissaoResolvida(ctx0, permissao);
    const r = await ctx.tx.query<LinhaDaTop>(
      `select t.id::text as id, t.codigo, v.nome, v.versao, v.id::text as versao_id, t.padrao, v.configuracao, t.codigo_base
         from erp.tipos_operacao t
         join erp.tipos_operacao_versoes v
           on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
        where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
        order by t.padrao desc, t.codigo, t.id`, [ctx.orgId, familiaDaLista(q.direcao)]);
    const execucao = await padroesDasVersoesParaExecucao(ctx, r.rows.map((l) => ({ id: l.versao_id, configuracao: l.configuracao, codigo_base: l.codigo_base })));
    return {
      capacidades: { financeiroPelaTop: CAPACIDADE_FINANCEIRO_PELA_TOP },
      itens: r.rows.map((l) => {
        const x = execucao.get(l.versao_id.toLowerCase());
        const secao = x?.secao ?? SECAO_FINANCEIRO_PADRAO.neutro();
        const p = x?.padroes ?? null;
        return {
          id: l.id, codigo: l.codigo, nome: l.nome, versao: l.versao, versaoId: l.versao_id, padrao: l.padrao,
          secao: { provisao: secao.provisao, documentoTroca: secao.documentoTroca, semClassificacao: secao.semClassificacao },
          padroes: { natureza: p?.natureza ?? null, centro: p?.centro ?? null, tipoTitulo: p?.tipoTitulo ?? null, formaPagamento: p?.formaPagamento ?? null, conta: p?.conta ?? null }
        };
      })
    };
  }));
}
