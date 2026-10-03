"use client";
import { MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER } from "@agro/domain";
import { useDoc, type Row } from "@/features/docs/shared";
import { SITUACOES_DO_PEDIDO_EM_ANDAMENTO } from "./pedido-e-orcamento";
import { TEXTO_SEM_PROXIMA_OPERACAO, useProximosPassosDoPedido, type ProximoPassoDoPedido } from "./proximos-passos-pedido";
import { temRecebimentoDeclarado, temSaldo } from "./recebimento-linhas";
import { varianteDeCompra } from "./variantes";

/**
 * A CENTRAL DE COMPRAS EM MODO RECEBER PEDIDO (COMPRAS-02, decisão 268) — o que a tela precisa saber ANTES de montar
 * o formulário: o pedido, o passo escolhido no leque e as linhas com saldo.
 *
 * Receber é LANÇAR UMA COMPRA COM ORIGEM. A Central é a mesma do lançamento comum; o que muda é de onde vêm os
 * dados e o que fica travado:
 *   · fornecedor, empresa e produto vêm do PEDIDO e ficam travados (a API nem aceita esses campos no corpo);
 *   · valor unitário e descontos vêm do pedido e podem mudar — valem os da NOTA; o saldo é só de quantidade;
 *   · natureza, centro, condição, forma de pagamento, transportadora e observação vêm do pedido e podem mudar;
 *   · quantidade: sem "Em partes", o saldo inteiro, travado; com "Em partes", editável até o saldo, e a linha sai.
 *
 * Nada aqui DECIDE: o `/convert` trava o pedido, relê o leque da versão congelada, cobra `compras.create`, confere
 * cada quantidade contra o saldo de AGORA e aplica todas as regras de lançar compra. A tela só não oferece o que
 * ela já sabe que seria recusado. As contas das linhas (saldo, desconto na proporção) moram em
 * `recebimento-linhas.ts`, sem React.
 *
 * OPERACOES-01 F6b (decisão 283): o pedido FINALIZADO também é recebido; e o ABERTO cuja TOP exige o pedido
 * finalizado (`exigeFinalizar` dos próximos passos) é recusado com a mesma mensagem do servidor. A API anterior não
 * manda nem uma coisa nem outra: o receber dela é o de hoje.
 */

/** O pedido de compra como a Central o lê (o GET da porta do pedido). */
export type PedidoParaReceber = Row & { itens: Row[] };

export type EstadoDoRecebimento =
  /** A Central não está recebendo pedido nenhum (lançamento comum). */
  | { situacao: "inativo" }
  | { situacao: "carregando" }
  /** O pedido não pode ser recebido por esta TOP, agora — a mensagem diz por quê. Nada é enviado. */
  | { situacao: "recusado"; mensagem: string }
  | { situacao: "pronto"; pedido: PedidoParaReceber; passo: ProximoPassoDoPedido };

/** A mensagem de indisponibilidade na web nova com a API anterior (sem a rota dos próximos passos). */
export const TEXTO_RECEBER_INDISPONIVEL = "O recebimento de pedido de compra está indisponível nesta versão do servidor.";

/**
 * O pedido e o passo, conferidos. `pedidoId` vazio = modo inativo, e nenhuma pergunta é feita. `especieDaCentral` é
 * a espécie da rota em que a Central abriu: o passo tem de gerar ESTA espécie, senão a tela estaria lançando na porta
 * errada o que o leque não ofereceu.
 */
export function useRecebimentoDoPedido(pedidoId: string, tipoOperacaoId: string, especieDaCentral: string): EstadoDoRecebimento {
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const ativo = Boolean(pedidoId && segmentoDoPedido);
  // A MESMA chave da consulta do pedido (`useDoc`): salvar invalida as duas telas de uma vez.
  const q = useDoc<PedidoParaReceber>(`/api/compras/${segmentoDoPedido}/${pedidoId}`, ativo);
  const passos = useProximosPassosDoPedido(segmentoDoPedido, pedidoId, ativo);

  if (!pedidoId) return { situacao: "inativo" };
  // Sem a espécie "pedido" no catálogo não há porta a perguntar: fail-closed, com a mesma recusa do servidor.
  if (!segmentoDoPedido) return { situacao: "recusado", mensagem: TEXTO_SEM_PROXIMA_OPERACAO };
  if (q.isLoading) return { situacao: "carregando" };
  if (q.error) return { situacao: "recusado", mensagem: (q.error as Error).message };
  const pedido = q.data;
  if (!pedido) return { situacao: "carregando" };
  const situacaoDoPedido = String(pedido["situacao"] ?? "");
  if (!SITUACOES_DO_PEDIDO_EM_ANDAMENTO.includes(situacaoDoPedido)) return { situacao: "recusado", mensagem: "Este pedido não está aberto." };
  if (passos.situacao === "carregando") return { situacao: "carregando" };
  if (passos.situacao === "indisponivel") return { situacao: "recusado", mensagem: TEXTO_RECEBER_INDISPONIVEL };
  if (passos.situacao === "erro") return { situacao: "recusado", mensagem: passos.mensagem };
  // A TOP exige o pedido finalizado: o aberto não é recebido (o `/convert` recusaria com esta mesma mensagem).
  if (situacaoDoPedido === "aberto" && passos.exigeFinalizar) return { situacao: "recusado", mensagem: MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER };
  // TOP fora do leque, leque vazio e política não configurada: a MESMA frase (a tela não vira oráculo do grafo).
  const passo = passos.itens.find((x) => x.tipoOperacaoId === tipoOperacaoId && x.especie === especieDaCentral);
  if (!passo) return { situacao: "recusado", mensagem: TEXTO_SEM_PROXIMA_OPERACAO };
  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
  // Sem `saldo` declarado a tela não sabe quanto falta: não chuta a quantidade inteira num pedido já recebido em parte.
  if (!temRecebimentoDeclarado(itens)) return { situacao: "recusado", mensagem: TEXTO_RECEBER_INDISPONIVEL };
  if (!itens.some((it) => temSaldo(it))) return { situacao: "recusado", mensagem: "Este pedido não tem saldo a receber." };
  return { situacao: "pronto", pedido: { ...pedido, itens }, passo };
}
