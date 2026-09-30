"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Row } from "@/features/docs/shared";
import { temSaldo } from "./recebimento-linhas";
import { varianteDeCompra } from "./variantes";

/**
 * OS PRÓXIMOS PASSOS DO PEDIDO DE COMPRA — O QUE ELE PODE GERAR, SEGUNDO A TOP QUE ELE CITA (COMPRAS-02, decisão 268).
 *
 * Mesmo contrato do `/proximos-passos` de Vendas (`features/sales/proximos-passos.ts`, `contractVersion` 1,
 * `politicaConfigurada` e `items` com `emPartes`), lido pela porta PRÓPRIA do pedido
 * (`GET /api/compras/pedidos/:id/proximos-passos`). Copiado e adaptado, não parametrizado, por dois motivos medidos:
 *
 *   · o item de compras diz `especie` (a espécie do documento de compra), e não `variante` de venda;
 *   · em compras NÃO HÁ PONTE LEGADA. Em vendas, "política nunca declarada" e "servidor que não confirmou o
 *     contrato" caem na cadeia anterior (havia acervo convertendo por ela). Em compras não existe acervo: pedido
 *     cuja TOP não declarou próximas operações simplesmente não tem próximo passo — e a API recusa a conversão
 *     pedida por fora com a MESMA mensagem. Reusar o hook de vendas traria de carona uma cadeia que aqui não
 *     existe.
 *
 * ┌─ SKEW: WEB NOVA, API ANTERIOR ─────────────────────────────────────────────────────────────────────────┐
 * │ A API da COMPRAS-01 não tem a rota: o `GET` responde 404 (rota inexistente) ou 405. A consulta do pedido │
 * │ NÃO quebra por isso — ela foi servida pela porta de sempre — e o cartão diz, com todas as letras, que os │
 * │ próximos passos estão indisponíveis nesta versão do servidor. Um 200 de formato desconhecido é o modo   │
 * │ de falha mais perigoso, porque PARECE sucesso: por isso `contractVersion` é conferido antes de tudo, e o │
 * │ corpo que não é o contrato cai no mesmo "indisponível" — nunca num leque vazio, que afirmaria "não há   │
 * │ próximo passo" em nome de um servidor que não disse isso.                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O leque é APRESENTAÇÃO. Quem decide se a compra nasce é o `/convert`: ele trava o pedido, relê a política da
 * versão congelada, cobra `compras.create` e confere o saldo de cada item.
 */

/** A ÚNICA versão de contrato que esta tela sabe ler. */
export const CONTRATO_PROXIMOS_PASSOS_PEDIDO = 1 as const;

export interface ProximoPassoDoPedido {
  tipoOperacaoId: string; codigo: string; nome: string;
  codigoBase: string; familiaRotulo: string;
  /** A espécie do documento que o passo gera. Hoje só `compra` — e só ela é oferecida (fail-closed). */
  especie: string;
  ordem: number;
  /** A aresta aceita receber em partes (subconjunto de itens, quantidade até o saldo). */
  emPartes: boolean;
}

const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Um passo só é aceito INTEIRO: item pela metade viraria botão com rótulo vazio ou destino indefinido. */
const ehProximoPasso = (v: unknown): v is ProximoPassoDoPedido =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && ehTexto(v.codigo) && ehTexto(v.nome)
  && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo) && ehTexto(v.especie)
  && typeof v.ordem === "number" && Number.isFinite(v.ordem) && typeof v.emPartes === "boolean";

/**
 * `politicaConfigurada` é OBRIGATÓRIO aqui (diferente de vendas): a rota de compras nasceu com ele, e não há
 * servidor anterior que a sirva sem o campo. Ausente = corpo que não é o contrato.
 */
export const ehRespostaDeProximosPassosDoPedido = (v: unknown): v is { contractVersion: typeof CONTRATO_PROXIMOS_PASSOS_PEDIDO; politicaConfigurada: boolean; items: ProximoPassoDoPedido[] } =>
  ehObjeto(v) && v.contractVersion === CONTRATO_PROXIMOS_PASSOS_PEDIDO && typeof v.politicaConfigurada === "boolean"
  && Array.isArray(v.items) && v.items.every(ehProximoPasso);

export type EstadoProximosPassosDoPedido =
  /** Ainda perguntando — nenhum botão de receber é oferecido enquanto não se sabe. */
  | { situacao: "carregando" }
  /** A API anterior (rota ausente: 404/405) ou um corpo que não é o contrato 1. */
  | { situacao: "indisponivel" }
  /** Outro erro do servidor (403, 5xx…): a mensagem dele, sem inventar um leque. */
  | { situacao: "erro"; mensagem: string }
  /**
   * O leque chegou. SÓ os passos que a tela sabe endereçar (espécie com rota no catálogo): um passo de espécie
   * desconhecida não vira botão para lugar nenhum. Política não configurada = leque vazio — sem ponte.
   */
  | { situacao: "pronto"; itens: ProximoPassoDoPedido[] };

/**
 * Pergunta ao servidor o que este pedido pode gerar. `retry: false`: 404 e 405 aqui são RESPOSTA (a API não
 * tem a rota), não falha transitória — insistir só atrasaria a tela.
 */
export function useProximosPassosDoPedido(segmentoDoPedido: string, id: string, habilitado: boolean): EstadoProximosPassosDoPedido {
  // `unknown` DE PROPÓSITO: o corpo só vira contrato depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-proximos-passos", segmentoDoPedido, id],
    queryFn: () => api<unknown>(`/api/compras/${segmentoDoPedido}/${id}/proximos-passos`),
    enabled: habilitado && Boolean(segmentoDoPedido && id),
    retry: false,
    staleTime: 0
  });
  if (!habilitado || q.isPending) return { situacao: "carregando" };
  if (q.error) return q.error.status === 404 || q.error.status === 405 ? { situacao: "indisponivel" } : { situacao: "erro", mensagem: q.error.message };
  if (!ehRespostaDeProximosPassosDoPedido(q.data)) return { situacao: "indisponivel" };
  const itens = q.data.politicaConfigurada ? q.data.items.filter((x) => Boolean(varianteDeCompra(x.especie))) : [];
  return { situacao: "pronto", itens: [...itens].sort((a, b) => a.ordem - b.ordem) };
}

/**
 * A Central de Compras em modo RECEBER PEDIDO: `/compras/<segmento da espécie do passo>/new?tipo_operacao_id=…&pedido=…`.
 * O segmento vem do catálogo (via `varianteDeCompra`), nunca escrito aqui; espécie sem rota = nenhum destino.
 */
export function rotaDeReceber(passo: Pick<ProximoPassoDoPedido, "especie" | "tipoOperacaoId">, pedidoId: string): string | null {
  const v = varianteDeCompra(passo.especie);
  if (!v) return null;
  return `/compras/${v.segmento}/new?${new URLSearchParams({ tipo_operacao_id: passo.tipoOperacaoId, pedido: pedidoId }).toString()}`;
}

/** A mensagem da API quando a TOP do pedido não tem próxima operação — a tela diz a MESMA coisa. */
export const TEXTO_SEM_PROXIMA_OPERACAO = "A TOP deste pedido não tem próxima operação configurada.";

/** Há saldo a receber em algum item? (Apresentação: quem confere é o servidor.) */
export const pedidoTemSaldo = (itens: Row[]): boolean => itens.some(temSaldo);

/** Uma compra gerada pelo pedido, como o GET do pedido a devolve. */
export interface CompraGerada { id: string; codigo: string; situacao: string }
const ehCompraGerada = (v: unknown): v is CompraGerada => ehObjeto(v) && ehTexto(v.id) && ehTexto(v.codigo) && ehTexto(v.situacao);

/**
 * As compras geradas deste pedido — `null` quando o servidor não as declarou (API anterior) ou declarou numa
 * forma que a tela não reconhece: aí nenhuma lista aparece, e nada é inferido dela (nem o "Encerrar saldo").
 */
export function comprasGeradasDoPedido(d: Row | undefined): CompraGerada[] | null {
  const v = d?.["compras_geradas"];
  if (!Array.isArray(v) || !v.every(ehCompraGerada)) return null;
  return v;
}
