/**
 * OPERACOES-01 F6a (decisão 283) — FINALIZAR O PEDIDO DE COMPRA, E A PRÉVIA DA FINALIZAÇÃO.
 *
 * "Finalizar" é a CONFIRMAÇÃO do pedido: aberto → finalizado, com quem e quando (`finalizado_em`, `finalizado_por`),
 * na MESMA mudança — o gatilho de conferência da 0044 recusa o carimbo fora dela. Finalizar não mexe em estoque nem
 * em financeiro, não exige orçamento vencedor e não muda os orçamentos abertos (sem cascata).
 * OPERACOES-01 F9b (decisão 286): com a provisão ligada na TOP do pedido (formato 5), finalizar faz nascer os títulos
 * PREVISTOS a pagar (lib/financeiro-provisao.ts).
 *
 * ┌─ A APROVAÇÃO DO PEDIDO ──────────────────────────────────────────────────────────────────────────────────┐
 * │ A aprovação da TOP (formato 4 ou 5, "Sempre" ou "A partir de um valor" com o total ATUAL) vale para o      │
 * │ pedido ao FINALIZAR. Pendente → 409 APROVACAO_PENDENTE com a mensagem DO PEDIDO e os details de hoje       │
 * │ (`politica`, `valorMinimo`, `valorDocumento`); reprovada → 409 APROVACAO_REPROVADA como a lib a monta.      │
 * │ A COBERTURA: o pedido muda de valor (o orçamento vencedor leva preços a ele), então uma aprovação só vale   │
 * │ enquanto cobre — valor aprovado ≥ o total atual e a MESMA versão da TOP. É a conta da guarda               │
 * │ `trg_documentos_compra_finalizacao` (0044): a API EXPLICA, o banco BARRA (CONFLICT, se um dia divergirem). │
 * │ `lib/aprovacao-documento.ts` não muda (é compartilhada com a venda e o estoque): a cobertura é uma consulta │
 * │ a mais, aqui, só quando a lib diz "aprovado".                                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * UMA função de planejamento (`planejarFinalizacao`) serve à prévia e ao finalizar — o molde de
 * `planejarConfirmacao` da compra: a prévia ANOTA as recusas, o finalizar LANÇA a primeira.
 *
 * ORDEM DO FINALIZAR: corpo vazio estrito (422) → id fora da forma (a MESMA 404) → visibilidade (`lerDocumentoCompra`,
 * a 404 do GET: inexistente, de outro tenant, fora do escopo, compra ou orçamento na porta do pedido) → a
 * idempotência (com o AUTOR no hash) → a TRAVA do pedido (`for update`) → o plano → o UPDATE com ROW COUNT → a
 * auditoria "finalize". Travas: o pedido primeiro (como o criar orçamento e o receber).
 *
 * As rotas são registradas por `registrarFinalizacaoCompras(app)`, chamada no fim do registro de `compras.ts`. Nada
 * aqui é avaliado no carregamento do módulo além de constantes: `compras.ts` e este arquivo se importam.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, DomainError } from "@agro/shared";
import {
  FORMA_UUID_PADRAO, MENSAGEM_APROVACAO_PENDENTE_PEDIDO, MSG_FINALIZAR_SO_PEDIDO_ABERTO, exigeAprovacao, regrasGeraisDaVersaoTop,
  type RegrasGeraisDaVersao,
} from "@agro/domain";
import { runService, idempotent, audit } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { lerVersaoCongeladaTop } from "../lib/confirmacao-automatica.js";
import { recusaDaAprovacao, type SituacaoAprovacao } from "../lib/aprovacao-documento.js";
import { lerDocumentoCompra } from "./compras.js";
import { MSG_CONFIGURACAO_DO_PEDIDO_ILEGIVEL } from "./compras-recebimento.js";
// OPERACOES-01 F9b (decisão 286): a provisão do pedido de compra finalizado.
import { sincronizarProvisaoDoPedidoDeCompra } from "../lib/financeiro-provisao.js";
import { MOTIVOS_DA_PROVISAO_COMPRA } from "@agro/domain";

/** Versão do contrato da prévia da finalização. A web confere forma E versão antes de usar o corpo. */
export const CONTRATO_PREVIA_FINALIZACAO_PEDIDO_COMPRA = 1;

/** O corpo do finalizar: vazio. `.strict()`: chave desconhecida é 422 — nunca descartada. */
const corpoVazio = z.object({}).strict();

/** O pedido como a finalização o lê (colunas de `lerDocumentoCompra`, espécie pedido). */
interface PedidoParaFinalizar { id: string; situacao: string; valor_total: string; tipo_operacao_versao_id: string }
const comoPedido = (d: Record<string, unknown>): PedidoParaFinalizar => ({
  id: String(d.id), situacao: String(d.situacao), valor_total: String(d.valor_total ?? "0"),
  tipo_operacao_versao_id: String(d.tipo_operacao_versao_id),
});

/** A versão congelada que o pedido cita (configuração + família). */
type VersaoTop = Awaited<ReturnType<typeof lerVersaoCongeladaTop>>;

/** O resultado do passo da aprovação: a situação (nula quando a configuração é ilegível) e a recusa, se houver. */
interface AprovacaoDoPedido { situacao: SituacaoAprovacao | null; recusa: DomainError | null }

/** A política que exige, como as regras gerais a dizem (o `null` já foi excluído por quem chama). */
type PoliticaQueExige = NonNullable<RegrasGeraisDaVersao["aprovacao"]>;

/** A recusa PENDENTE do pedido: o código e os details de hoje, com a mensagem que diz "finalizado". */
const recusaPendenteDoPedido = (details: unknown): DomainError => new DomainError("APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE_PEDIDO, details);

/** Os details da recusa pendente, montados como a lib os monta (para a aprovação que deixou de cobrir). */
const detalhesDaPendente = (politica: PoliticaQueExige, valorDocumento: string) => ({
  politica: politica.politica,
  valorMinimo: politica.politica === "por_valor" ? politica.valorMinimo : null,
  valorDocumento,
});

/**
 * A APROVAÇÃO DO PEDIDO, na versão congelada e com o total ATUAL:
 *   · configuração ilegível → TIPO_OPERACAO_EXECUCAO_INDISPONIVEL (fail-closed), situação nula;
 *   · não exige (formatos 1 a 3, "Sem aprovação", ou abaixo do valor mínimo) → "nao_exigida";
 *   · exige: a decisão vigente pela lib — nenhuma → pendente (mensagem do pedido); reprovada → como veio;
 *     aprovada → a COBERTURA, numa consulta (a última decisão: valor e versão). Aprovada que não cobre → pendente.
 */
async function aprovacaoDoPedido(ctx: ServiceCtx, pedido: PedidoParaFinalizar, versaoTop: VersaoTop): Promise<AprovacaoDoPedido> {
  const regras = regrasGeraisDaVersaoTop(versaoTop);
  if (!regras.ok) {
    return { situacao: null, recusa: new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", MSG_CONFIGURACAO_DO_PEDIDO_ILEGIVEL, { motivo: regras.motivo }) };
  }
  const politica = regras.regras.aprovacao;
  if (politica === null || !exigeAprovacao(regras.regras, pedido.valor_total)) return { situacao: "nao_exigida", recusa: null };

  let recusa: DomainError | null;
  try {
    recusa = await recusaDaAprovacao(ctx,
      { modulo: "compras", documentoId: pedido.id, versaoDocumento: null, valorDocumento: pedido.valor_total, versaoTop });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return { situacao: null, recusa: e };
  }
  if (recusa?.code === "APROVACAO_PENDENTE") return { situacao: "pendente", recusa: recusaPendenteDoPedido(recusa.details) };
  if (recusa) return { situacao: "reprovado", recusa };

  // Aprovada: COBRE o pedido de agora? A última decisão (a vigente da lib), com o valor e a versão que ela aprovou.
  const ultima = (await ctx.tx.query<{ decisao: string; valor_documento: string; tipo_operacao_versao_id: string }>(
    `select a.decisao, a.valor_documento::text as valor_documento, a.tipo_operacao_versao_id
       from erp.aprovacoes_compra a
      where a.organization_id = $1 and a.documento_id = $2
      order by a.id desc
      limit 1`, [ctx.orgId, pedido.id])).rows[0];
  const cobre = ultima !== undefined && ultima.decisao === "aprovado"
    && D(ultima.valor_documento).gte(D(pedido.valor_total)) && ultima.tipo_operacao_versao_id === pedido.tipo_operacao_versao_id;
  if (cobre) return { situacao: "aprovado", recusa: null };
  return { situacao: "pendente", recusa: recusaPendenteDoPedido(detalhesDaPendente(politica, pedido.valor_total)) };
}

/** Como o planejamento trata cada recusa — a única diferença entre finalizar e prever. */
interface ModoDoPlanejamento { recusar(e: DomainError): void }
const MODO_FINALIZACAO: ModoDoPlanejamento = { recusar: (e) => { throw e; } };

interface PlanoDaFinalizacao { aprovacao: { situacao: SituacaoAprovacao } | null }

/**
 * O PLANEJAMENTO DA FINALIZAÇÃO — UMA função, para o finalizar E para a prévia. Ordem: situação (só o aberto) →
 * versão congelada → aprovação (com a cobertura). `aprovacao` nula quando o pedido não está aberto ou a
 * configuração é ilegível.
 */
async function planejarFinalizacao(ctx: ServiceCtx, pedido: PedidoParaFinalizar, modo: ModoDoPlanejamento): Promise<PlanoDaFinalizacao> {
  if (pedido.situacao !== "aberto") { modo.recusar(err("CONFLICT", MSG_FINALIZAR_SO_PEDIDO_ABERTO)); return { aprovacao: null }; }
  let versaoTop: VersaoTop;
  try {
    versaoTop = await lerVersaoCongeladaTop(ctx, pedido.tipo_operacao_versao_id);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    modo.recusar(e); return { aprovacao: null };
  }
  const aprovacao = await aprovacaoDoPedido(ctx, pedido, versaoTop);
  if (aprovacao.recusa) modo.recusar(aprovacao.recusa);
  return { aprovacao: aprovacao.situacao ? { situacao: aprovacao.situacao } : null };
}

/** O pg entrega timestamptz como Date; a API responde ISO (o mesmo texto do replay gravado em JSON). */
const emIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * FINALIZAR — dentro da transação da rota, sob a chave de idempotência. A 1ª trava é o pedido; o plano lança a
 * primeira recusa; o UPDATE confere a transição no `where` e o ROW COUNT (zero linha sob RLS nunca é sucesso).
 */
async function finalizarPedido(ctx: ServiceCtx, id: string) {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, id, "pedido", { lock: true }));
  const plano = await planejarFinalizacao(ctx, pedido, MODO_FINALIZACAO);
  const u = await ctx.tx.query<{ finalizado_em: Date | string; finalizado_por: string }>(
    `update erp.documentos_compra set situacao = 'finalizado', finalizado_em = now(), finalizado_por = $3
      where id = $1 and organization_id = $2 and especie = 'pedido' and situacao = 'aberto'
      returning finalizado_em, finalizado_por`, [pedido.id, ctx.orgId, ctx.user.id]);
  const linha = u.rows[0];
  if (u.rowCount !== 1 || !linha) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", pedido.id, "finalize", { aprovacao: plano.aprovacao?.situacao ?? null },
    { before: { situacao: "aberto" }, after: { situacao: "finalizado" } });
  // OPERACOES-01 F9b: o pedido finalizado provisiona (a TOP no 5 com a provisão ligada; senão nada). A recusa (troca,
  // classificação, conta padrão) desfaz o finalizar inteiro (422) — o salvar do pedido já recusou as duas primeiras.
  await sincronizarProvisaoDoPedidoDeCompra(ctx, pedido.id, MOTIVOS_DA_PROVISAO_COMPRA.pedidoFinalizado);
  return { id: pedido.id, situacao: "finalizado", finalizado_em: emIso(linha.finalizado_em), finalizado_por: linha.finalizado_por };
}

/** PRÉVIA: o mesmo planejamento, sem trava, sem gravar nada. */
async function previaDaFinalizacao(ctx: ServiceCtx, id: string) {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, id, "pedido"));
  const recusas: DomainError[] = [];
  const plano = await planejarFinalizacao(ctx, pedido, { recusar: (e) => { recusas.push(e); } });
  return {
    contractVersion: CONTRATO_PREVIA_FINALIZACAO_PEDIDO_COMPRA,
    podeFinalizar: recusas.length === 0,
    recusas: recusas.map((e) => e.toJSON()),
    aprovacao: plano.aprovacao,
  };
}

/** Registra a prévia da finalização e o finalizar do pedido. Chamada no fim do registro de `compras.ts`. */
export function registrarFinalizacaoCompras(app: FastifyInstance) {
  /** A PRÉVIA — leitura (`pedidos_compra.view`): a mesma 404 do GET para tudo que o usuário não vê. */
  app.get("/compras/pedidos/:id/previa-finalizacao", async (req) => runService(app, req, "pedidos_compra.view",
    (ctx) => previaDaFinalizacao(ctx, (req.params as { id: string }).id)));

  /** FINALIZAR — muta o pedido (`pedidos_compra.edit`). Corpo vazio; Idempotency-Key com o autor no hash. */
  app.post("/compras/pedidos/:id/finalizar", async (req) => runService(app, req, "pedidos_compra.edit", async (ctx) => {
    corpoVazio.parse(req.body ?? {});
    const bruto = (req.params as { id: string }).id;
    // id malformado é inexistente: a MESMA 404. O id CANÔNICO, em minúsculas, ANTES do hash: a mesma URL com outra
    // caixa é o mesmo pedido (e o mesmo `entity_id` na trilha).
    if (!FORMA_UUID_PADRAO.test(bruto)) throw notFound("Documento");
    const id = bruto.toLowerCase();
    // Visibilidade ANTES da chave: o replay não atravessa o escopo.
    await lerDocumentoCompra(ctx, id, "pedido");
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "finalizar_pedido_compra", pedidoId: id, actorId: ctx.user.id },
      () => finalizarPedido(ctx, id))).result;
  }));
}
