"use client";
import * as React from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Row } from "@/features/docs/shared";
import { chaveDaFila, chaveDaSituacaoDoDocumento } from "@/features/aprovacoes/areas-de-aprovacao";
import { declaraFinalizacaoEOrcamento, usePortasDasTopsDeCompras, varianteDeCompra } from "./variantes";

/**
 * OPERACOES-01 F6b (decisão 283) — O MÓDULO COMUM DAS TELAS DO PEDIDO FINALIZADO E DO ORÇAMENTO DE COMPRA.
 *
 * A F6a pôs no banco e na API o pedido finalizado (com a aprovação ao finalizar), o "aprovado para orçamento", o
 * orçamento de compra (espécie `orcamento`), o vencedor e a divergência com o pedido — tudo atrás da capacidade
 * `capacidades.finalizacaoEOrcamento` de `GET /api/compras/{pedidos,compras,orcamentos}/operation-types`. Este
 * arquivo é o UM dono do que a consulta do pedido e a do orçamento perguntam em comum: a capacidade, a regra da chave
 * de idempotência, a rota do novo orçamento, o leque de TOPs de orçamento do pedido e a leitura ESTRITA dos campos
 * que a leitura do pedido traz (os orçamentos, quem aprovou para orçamento, quem finalizou).
 *
 * ┌─ SKEW: WEB NOVA, API ANTERIOR (sentido 1) ────────────────────────────────────────────────────────────┐
 * │ Sem a declaração EXATA (`finalizacaoEOrcamento === 1`, propriedade própria, `contractVersion` 1), a    │
 * │ capacidade é "nao" e a Central de Compras é a de hoje: nenhum botão novo, nenhuma pergunta às rotas    │
 * │ novas. "carregando" também não mostra nada novo (sem piscar). Os leitores devolvem `null` para o que   │
 * │ o servidor não declarou ou declarou fora da forma — nunca um valor inventado em nome dele.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Sem JSX e sem importar nada de `./central/*` (quem usa este módulo é a Central; o contrário seria ciclo).
 * Tudo aqui é APRESENTAÇÃO: quem decide é o servidor (a porta da rota, a guarda da 0044, a conferência do vencedor).
 */

/** A capacidade da F6 (finalizar, aprovado para orçamento, orçamento, vencedor, divergência): "carregando" | "sim" | "nao". */
export type EstadoDaCapacidade = "carregando" | "sim" | "nao";

/** A ÚNICA versão de contrato de `/proximos-passos` que este módulo sabe ler (a de `/operation-types` mora em `./variantes`). */
const CONTRATO = 1;

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehTextoOuNulo = (v: unknown): v is string | null => v === null || typeof v === "string";
const ehNumeroFinito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Propriedade PRÓPRIA (nunca herdada do protótipo): um corpo que não a declara não a tem. */
const propria = (o: Record<string, unknown>, chave: string): unknown => (Object.hasOwn(o, chave) ? o[chave] : undefined);

/** O corpo de `/operation-types` declara `capacidades.finalizacaoEOrcamento === CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA` (propriedade própria; contractVersion 1)? Dono: `./variantes` (as portas). */
export { declaraFinalizacaoEOrcamento };

/**
 * Pergunta (com o MESMO cache de `useTopsDaEspecie`: queryKey ["compras-operation-types", segmento], queryFn
 * `api<unknown>(`/api/compras/${segmento}/operation-types`)`, retry false — `usePortasDasTopsDeCompras`) às portas das
 * espécies de `variantesDeCompra()` que o usuário pode LANÇAR (`can(`${v.perm}.create`)`): alguma declara → "sim";
 * alguma ainda pendente → "carregando"; senão (nenhuma declara, erro, ou o usuário não lança espécie nenhuma) → "nao"
 * (fail-closed: a Central de hoje). A porta do ORÇAMENTO só é perguntada quando outra já declarou, ou quando o usuário
 * não lança outra espécie: contra a API anterior (sem a rota do orçamento) nenhuma pergunta dá 404.
 * Enquanto as permissões carregam (`useAuth().loading`), "carregando". `habilitado` falso (a tela que não usa a
 * capacidade — a consulta da COMPRA): nenhuma pergunta, e "nao".
 */
export function useFinalizacaoEOrcamento(habilitado = true): EstadoDaCapacidade {
  const { loading } = useAuth();
  const portas = usePortasDasTopsDeCompras(habilitado);
  if (!habilitado) return "nao";
  // As permissões ainda carregando: não se sabe o que ele lança (nada novo aparece, nada some depois).
  if (loading) return "carregando";
  // Só as portas perguntadas contam: a desabilitada fica "pendente" para sempre no React Query.
  const perguntadas = portas.filter((p) => p.perguntada).map((p) => p.resultado);
  if (perguntadas.some((r) => r.isSuccess && declaraFinalizacaoEOrcamento(r.data))) return "sim";
  if (perguntadas.some((r) => r.isPending)) return "carregando";
  return "nao";
}

/**
 * A regra ÚNICA da chave de idempotência: troca só quando o servidor RESPONDEU com recusa (ApiError 4xx), exceto
 * CONCURRENCY_CONFLICT ("operação em andamento para esta chave": a primeira ainda pode gravar). A recusa desfaz a
 * transação inteira, a chave inclusive — a próxima tentativa é OUTRA operação. Rede, 5xx e resposta não-JSON:
 * MANTÉM — não se sabe se o servidor gravou, e o reenvio com a MESMA chave recebe a resposta gravada (nunca um
 * segundo documento).
 */
export function trocaAChaveDeIdempotencia(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== "CONCURRENCY_CONFLICT";
}

/**
 * O aviso do reenvio com a MESMA chave e OUTROS dados: uma tentativa anterior ficou sem resposta (pode ter sido
 * gravada) e o corpo mudou desde então — o servidor recusa a chave com corpo diferente (409) em vez de gravar duas
 * vezes. Nada foi gravado AGORA; o que a tentativa anterior gravou, a pessoa confere antes de tentar de novo.
 */
export const MSG_REENVIO_COM_OUTROS_DADOS =
  "A tentativa anterior ficou sem resposta do servidor e pode ter sido gravada. Os dados mudaram desde então, e nada foi gravado agora: confira o documento antes de tentar de novo.";

/** A chave de idempotência de UMA ação, com a regra da troca (`trocaAChaveDeIdempotencia`) e o aviso do erro. */
export interface ChaveDeIdempotencia {
  /** A chave do próximo envio — anotando o corpo que vai com ela. */
  doEnvio: (corpo: unknown) => string;
  /** Depois do erro do envio: troca a chave só na recusa e devolve o texto do aviso. */
  depoisDoErro: (e: unknown) => string;
}

/**
 * A CHAVE DE UMA AÇÃO (Salvar, Cancelar, Encerrar saldo…): a MESMA até o servidor RECUSAR. O corpo de cada tentativa
 * que ficou SEM resposta (rede, 5xx) é lembrado; quando o servidor recusa com conflito (409 `CONFLICT`) um envio cujo
 * corpo difere de uma dessas, o aviso é `MSG_REENVIO_COM_OUTROS_DADOS` — e não o texto técnico da chave reutilizada.
 * Reconhecido pelo que a TELA sabe (a tentativa sem resposta e o corpo mudado), nunca pelo texto do servidor. Fora de
 * React (a aba dos orçamentos guarda uma por par pedido × orçamento); nos componentes, `useChaveDeIdempotencia`.
 */
export function novaChaveDeIdempotencia(): ChaveDeIdempotencia {
  let chave = newIdem();
  let enviado = "null";
  const semResposta = new Set<string>();
  return {
    doEnvio: (corpo) => { enviado = JSON.stringify(corpo ?? null); return chave; },
    depoisDoErro: (e) => {
      const outroCorpo = [...semResposta].some((corpo) => corpo !== enviado);
      if (trocaAChaveDeIdempotencia(e)) {
        chave = newIdem();
        semResposta.clear();
        if (outroCorpo && e instanceof ApiError && e.status === 409 && e.code === "CONFLICT") return MSG_REENVIO_COM_OUTROS_DADOS;
      } else if (!(e instanceof ApiError && e.code === "CONCURRENCY_CONFLICT")) {
        // Sem resposta do servidor (rede, 5xx, corpo que não é JSON): esta tentativa pode ter sido gravada.
        semResposta.add(enviado);
      }
      return e instanceof Error ? e.message : String(e);
    }
  };
}

/** A chave de uma ação do componente: a MESMA instância enquanto ele vive (`novaChaveDeIdempotencia`). */
export function useChaveDeIdempotencia(): ChaveDeIdempotencia {
  const [chave] = React.useState(novaChaveDeIdempotencia);
  return chave;
}

/** A chave do `useDoc` (`features/docs/shared.tsx`) e a do módulo da lista única (`DocList`, endpoint `/api/compras/documentos`). */
const CHAVE_DA_LEITURA = "docone";
const CHAVE_DA_LISTA = "b1";
const MODULO_DA_LISTA_DE_COMPRAS = "compras.documentos";
/** As perguntas de compras que mudam com a ação sobre o documento (as portas, o layout e as regras não mudam). */
const PERGUNTAS_DO_DOCUMENTO_DE_COMPRA: ReadonlySet<string> = new Set(["compras-previa-finalizacao", "compras-previa-confirmacao", "compras-proximos-passos"]);

/** A chave é de uma leitura que uma ação sobre documento de compra muda? (Ver `invalidarLeiturasDeCompras`.) */
export function ehLeituraDeDocumentoDeCompra(chave: readonly unknown[]): boolean {
  const [k0, k1] = chave;
  if (k0 === CHAVE_DA_LEITURA) return typeof k1 === "string" && k1.startsWith("/api/compras/");
  if (k0 === CHAVE_DA_LISTA) return k1 === MODULO_DA_LISTA_DE_COMPRAS;
  const fila = chaveDaFila("compras");
  const situacao = chaveDaSituacaoDoDocumento("compras", "");
  if ((k0 === fila[0] && k1 === fila[1]) || (k0 === situacao[0] && k1 === situacao[1])) return true;
  return typeof k0 === "string" && PERGUNTAS_DO_DOCUMENTO_DE_COMPRA.has(k0);
}

/**
 * Depois de uma AÇÃO sobre pedido ou orçamento de compra (finalizar, aprovar para orçamento, escolher o vencedor,
 * cancelar, salvar o orçamento): pergunta de novo SÓ o que é de documento de compra — as leituras
 * (`/api/compras/…`), a lista única, as prévias, os próximos passos (e o leque) e a aprovação de compras (a situação
 * de cada documento e a fila). As portas de `operation-types`, o layout, as regras e o resto do sistema não mudam com a
 * ação e não são perguntados de novo.
 */
export function invalidarLeiturasDeCompras(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ predicate: (q) => ehLeituraDeDocumentoDeCompra(q.queryKey) });
}

/** `/compras/<segmento do orçamento>/new?tipo_operacao_id=…&pedido=…` (segmento do catálogo, `varianteDeCompra("orcamento")`); null sem a espécie. */
export function rotaDoNovoOrcamento(pedidoId: string, tipoOperacaoId: string): string | null {
  const v = varianteDeCompra("orcamento");
  if (!v) return null;
  return `/compras/${v.segmento}/new?${new URLSearchParams({ tipo_operacao_id: tipoOperacaoId, pedido: pedidoId }).toString()}`;
}

/** Uma TOP de orçamento de compra do leque do pedido (`orcamentos` de `/proximos-passos`). */
export interface TopDoLequeDeOrcamento { tipoOperacaoId: string; codigo: string; nome: string; ordem: number }

export type EstadoDoLequeDeOrcamentos =
  /** Ainda perguntando — nenhum "Novo orçamento" é oferecido enquanto não se sabe. */
  | { situacao: "carregando" }
  /** A rota ausente (404/405), ou o servidor não declarou o leque (sem `orcamentos_compra.create`, ou API anterior). */
  | { situacao: "indisponivel" }
  /** Outro erro do servidor: a mensagem dele, sem inventar um leque. */
  | { situacao: "erro"; mensagem: string }
  /** O leque chegou, na ordem do servidor (`ordem`). Vazio = a TOP do pedido não oferece orçamento. */
  | { situacao: "pronto"; tops: TopDoLequeDeOrcamento[] };

/** Um item do leque só é aceito INTEIRO e da espécie orçamento: item pela metade viraria botão sem destino. */
const ehTopDoLeque = (v: unknown): v is Record<string, unknown> & { tipoOperacaoId: string; codigo: string; nome: string; ordem: number } =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && ehTexto(v.codigo) && ehTexto(v.nome) && ehNumeroFinito(v.ordem) && v.especie === "orcamento";

/** `orcamentos` do corpo de `/proximos-passos` (A2), conferido item a item (contractVersion 1); ausente ou fora da forma → null. Ordena por `ordem`. */
export function lerLequeDeOrcamentos(resposta: unknown): TopDoLequeDeOrcamento[] | null {
  if (!ehObjeto(resposta) || propria(resposta, "contractVersion") !== CONTRATO) return null;
  const orcamentos = propria(resposta, "orcamentos");
  if (!Array.isArray(orcamentos) || !orcamentos.every(ehTopDoLeque)) return null;
  return orcamentos
    .map((t) => ({ tipoOperacaoId: t.tipoOperacaoId, codigo: t.codigo, nome: t.nome, ordem: t.ordem }))
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * O leque de orçamento do pedido — a MESMA pergunta de `useProximosPassosDoPedido` (queryKey
 * ["compras-proximos-passos", <segmento do pedido>, pedidoId], `staleTime: 0`, `retry: false`, mesmo queryFn).
 * 404/405 → "indisponivel"; outro erro → "erro"; `orcamentos` ausente/fora da forma → "indisponivel".
 */
export function useLequeDeOrcamentosDoPedido(pedidoId: string, habilitado: boolean): EstadoDoLequeDeOrcamentos {
  const segmento = varianteDeCompra("pedido")?.segmento ?? "";
  const ativo = habilitado && Boolean(segmento && pedidoId);
  // `unknown` DE PROPÓSITO: o corpo só vira leque depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-proximos-passos", segmento, pedidoId],
    queryFn: () => api<unknown>(`/api/compras/${segmento}/${pedidoId}/proximos-passos`),
    enabled: ativo,
    retry: false,
    staleTime: 0
  });
  if (habilitado && !segmento) return { situacao: "indisponivel" };
  if (!ativo || q.isPending) return { situacao: "carregando" };
  if (q.error) return q.error.status === 404 || q.error.status === 405 ? { situacao: "indisponivel" } : { situacao: "erro", mensagem: q.error.message };
  const tops = lerLequeDeOrcamentos(q.data);
  return tops === null ? { situacao: "indisponivel" } : { situacao: "pronto", tops };
}

/** O preço de um item do pedido num orçamento (A3): decimais em texto, como a API os manda. */
export interface PrecoDoItemNoOrcamento { itemPedidoId: string; valorUnitario: string; valorTotal: string }

export interface OrcamentoDoPedido {
  id: string; codigo: string; situacao: string; fornecedorId: string; fornecedorNome: string;
  condicaoPagamentoId: string | null; condicao: { codigo: string; nome: string } | null;
  prazoEntregaDias: number | null; validadeOrcamento: string | null; valorTotal: string;
  /** null quando o servidor não declarou os preços por item (A3 ausente): a comparação mostra só os totais. */
  itens: PrecoDoItemNoOrcamento[] | null;
}

/** Os preços por item de um orçamento (A3): ausente → `null` (o servidor não declarou); fora da forma → `undefined`. */
function precosDoOrcamento(o: Record<string, unknown>): PrecoDoItemNoOrcamento[] | null | undefined {
  if (!Object.hasOwn(o, "itens")) return null;
  const itens = o.itens;
  if (!Array.isArray(itens)) return undefined;
  const out: PrecoDoItemNoOrcamento[] = [];
  for (const i of itens) {
    if (!ehObjeto(i) || !ehTexto(i.item_pedido_orcado_id) || !ehTexto(i.valor_unitario) || !ehTexto(i.valor_total)) return undefined;
    out.push({ itemPedidoId: i.item_pedido_orcado_id, valorUnitario: i.valor_unitario, valorTotal: i.valor_total });
  }
  return out;
}

/** Um orçamento da leitura do pedido, conferido campo a campo; fora da forma → `null`. */
function orcamentoDoPedido(o: unknown): OrcamentoDoPedido | null {
  if (!ehObjeto(o)) return null;
  const { id, codigo, situacao, fornecedor_id, fornecedor_nome, condicao_pagamento_id, prazo_entrega_dias, validade_orcamento, valor_total } = o;
  if (!ehTexto(id) || !ehTexto(codigo) || !ehTexto(situacao) || !ehTexto(fornecedor_id) || !ehTexto(fornecedor_nome)) return null;
  if (!ehTextoOuNulo(condicao_pagamento_id) || !ehTextoOuNulo(validade_orcamento) || !ehTexto(valor_total)) return null;
  if (prazo_entrega_dias !== null && !ehNumeroFinito(prazo_entrega_dias)) return null;
  // As chaves da condição (A3) são opcionais: ausentes ou nulas = sem condição; presentes, texto.
  const condicaoCodigo = o.condicao_pagamento_codigo ?? null;
  const condicaoNome = o.condicao_pagamento_nome ?? null;
  if (!ehTextoOuNulo(condicaoCodigo) || !ehTextoOuNulo(condicaoNome)) return null;
  const itens = precosDoOrcamento(o);
  if (itens === undefined) return null;
  return {
    id, codigo, situacao, fornecedorId: fornecedor_id, fornecedorNome: fornecedor_nome, condicaoPagamentoId: condicao_pagamento_id,
    condicao: condicaoCodigo !== null && condicaoNome !== null ? { codigo: condicaoCodigo, nome: condicaoNome } : null,
    prazoEntregaDias: prazo_entrega_dias, validadeOrcamento: validade_orcamento, valorTotal: valor_total, itens
  };
}

/** `orcamentos` da leitura do pedido, conferido campo a campo; chave ausente (sem `orcamentos_compra.view`) ou fora da forma → null. As chaves de A3 são opcionais. */
export function orcamentosDoPedido(d: Row | undefined): OrcamentoDoPedido[] | null {
  if (!d || !Object.hasOwn(d, "orcamentos")) return null;
  const v = d["orcamentos"];
  if (!Array.isArray(v)) return null;
  const out: OrcamentoDoPedido[] = [];
  for (const o of v) {
    const lido = orcamentoDoPedido(o);
    if (!lido) return null;
    out.push(lido);
  }
  return out;
}

/** Quem e quando de um par (data, nome) da leitura: sem a data (ou fora da forma) → null; o nome ausente vira "". */
function quemEQuando(d: Row | undefined, colunaEm: string, colunaNome: string): { em: string; porNome: string } | null {
  const em = d?.[colunaEm];
  if (!ehTexto(em) || em === "") return null;
  const nome = d?.[colunaNome];
  return { em, porNome: ehTexto(nome) ? nome : "" };
}

/** Quem e quando: `{ em, porNome }` de `aprovado_orcamento_em`/`aprovado_orcamento_por_nome` e de `finalizado_em`/`finalizado_por_nome`; null sem a data. */
export function aprovadoParaOrcamento(d: Row | undefined): { em: string; porNome: string } | null {
  return quemEQuando(d, "aprovado_orcamento_em", "aprovado_orcamento_por_nome");
}
export function finalizacaoDoPedido(d: Row | undefined): { em: string; porNome: string } | null {
  return quemEQuando(d, "finalizado_em", "finalizado_por_nome");
}

/** As situações do pedido que recebem, encerram o saldo e se cancelam (com a F6a). */
export const SITUACOES_DO_PEDIDO_EM_ANDAMENTO: readonly string[] = Object.freeze(["aberto", "finalizado"]);
