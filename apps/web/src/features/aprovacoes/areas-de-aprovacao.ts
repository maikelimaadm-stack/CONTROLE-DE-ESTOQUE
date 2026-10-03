"use client";
import { ApiError } from "@/lib/api";
import { dateTimeBR } from "@/lib/utils";
import type { ResultadoConfirmacaoAutomatica } from "@/features/central/contrato";
import { mensagemDoServidorNoMolde } from "@/features/central/salvar";
import { varianteDeVenda } from "@/features/sales/variantes";
import { varianteDeCompra } from "@/features/compras/variantes";
import { rotaDoDocumentoEstoque, varianteDeEstoque } from "@/features/estoque/movimentacoes-variantes";

/**
 * AS TRÊS FILAS DE APROVAÇÃO — O CONTRATO DAS ROTAS E O QUE CADA ÁREA SABE (TOP-CONFIG-08, decisão 277).
 *
 * A tela de Aprovações não tem regra própria: quem decide o que entra na fila, quem pode decidir e o que a decisão
 * dispara é o servidor (`/api/aprovacoes/*`). Este arquivo só diz, por área, ONDE perguntar e COMO endereçar o
 * documento — e nada disso é escrito à mão aqui:
 *   · o segmento da rota e da porta e a família de capacidade de cada documento saem das VARIANTES que os portais
 *     já usam (`features/sales/variantes`, `features/compras/variantes`, `features/estoque/movimentacoes-variantes`,
 *     que por sua vez perguntam ao registry de TOPs e ao catálogo do ID Global). Espécie que a variante não conhece
 *     fica SEM ação (fail-closed): a tela não inventa rota nem porta;
 *   · a capacidade de decidir é `<família>.approve` — a mesma que o servidor exige na rota. `can()` só esconde o
 *     botão; quem nega é a rota.
 *
 * As áreas são as abas do módulo no `nav.registry.mjs` (aprovacoes.vendas | .compras | .estoque), a fonte única do
 * rótulo e da permissão de cada aba.
 */
export type AreaDeAprovacao = "vendas" | "compras" | "estoque";

/** Um nome com o seu id, como a fila devolve (empresa, parceiro, operação, quem lançou e quem decidiu). */
export type ReferenciaDaFila = { id: string; nome: string };

/**
 * A ÚLTIMA decisão do documento, de qualquer versão — a mesma forma na linha da fila e na situação da consulta.
 * `observacao` é o motivo na reprovação (obrigatório) e a observação na aprovação (opcional).
 */
export type UltimaDecisao = { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: ReferenciaDaFila; decididoEm: string };

/**
 * A linha da fila (GET /api/aprovacoes/<área>), chave por chave como as rotas a devolvem. `type` e não `interface`
 * de propósito: a grade recebe linhas como `Record<string, unknown>`, e só o alias de objeto é atribuível a ele.
 * `especie`: "venda" | "compra" | "entrada" | "saida" | "transferencia" | "ajuste". `valor` é nulo no estoque (o
 * valor do documento de estoque só existe na confirmação). `version` só na venda — é ela que a decisão devolve.
 */
export type LinhaDaFila = {
  id: string; codigo: string; especie: string; data: string;
  empresa: ReferenciaDaFila; parceiro: ReferenciaDaFila | null; operacao: ReferenciaDaFila;
  valor: string | null; lancadoPor: ReferenciaDaFila | null;
  situacao: "pendente" | "reprovado";
  ultimaDecisao: UltimaDecisao | null;
  version?: string;
  /** O ID Global do documento, quando a resposta o declara (`idGlobal` da página) — como nas listas de hoje. */
  id_global?: number | null;
};

/**
 * A página da fila: o formato das listas de hoje (paginação do servidor, `?page=&pageSize=`). `idGlobal` é a
 * DECLARAÇÃO do servidor de que a listagem tem ID Global (o mesmo `paginaComIdGlobal` das listas de documentos);
 * sem ela a coluna simplesmente não aparece — a tela não guarda um catálogo próprio de entidades com número.
 */
export type PaginaDaFila = { items: LinhaDaFila[]; total: number; page: number; pageSize: number; idGlobal?: { tipoEntidade: string; rotulo: string } };

/**
 * O resultado da confirmação automática (TOP no formato 4 com Confirmação Automática) — o mesmo corpo na decisão de
 * aprovar e no POST que grava o documento (as Centrais o leem ao salvar). O dono é o motor da Central
 * (`features/central/contrato`); ele é reexportado aqui para quem já o importava deste arquivo.
 */
export type { ResultadoConfirmacaoAutomatica } from "@/features/central/contrato";

/** 200 de aprovar/reprovar. `confirmacaoAutomatica` só vem quando a versão da TOP do documento confirma sozinha. */
export type RespostaDaDecisao = {
  aprovacao: { decisao: "aprovado" | "reprovado"; decididoEm: string };
  confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica;
};

/** A ação da linha — é também o último segmento da porta (`…/aprovar`, `…/reprovar`). */
export type Decisao = "aprovar" | "reprovar";

// ── Textos da tela (exatos: os E2E procuram por eles) ─────────────────────────────────────────────────────────
export const MSG_FILA_VAZIA = "Nenhum documento aguardando aprovação.";
export const MSG_APROVACOES_INDISPONIVEIS = "As aprovações ainda não estão disponíveis neste servidor.";
export const MSG_DOCUMENTO_MUDOU_NA_FILA = "O documento mudou depois que a lista foi carregada. A lista foi atualizada; confira antes de aprovar.";
export const MSG_APROVADO = "Aprovado.";
export const MSG_APROVADO_E_CONFIRMADO = "Aprovado e confirmado.";
/** A decisão da CONSULTA voltou 409: a venda mudou depois que a tela foi aberta (outra versão). */
export const MSG_DOCUMENTO_MUDOU_NA_CONSULTA = "O documento mudou depois que foi aberto. Ele foi carregado de novo; confira antes de aprovar.";
/**
 * A mensagem do servidor dentro de um molde que já termina em ponto. O dono da pontuação é o motor da Central
 * (`features/central/salvar`, que o aviso do Salvar também usa); ele é reexportado aqui para quem já o importava.
 */
export { mensagemDoServidorNoMolde };
/**
 * A confirmação automática recusou depois da aprovação: o documento fica aprovado e aberto, e a mensagem é a do
 * servidor (o MESMO corpo que o /confirm daria), no molde acima.
 */
export const mensagemConfirmacaoAutomaticaNaoAconteceu = (mensagem: string): string =>
  mensagemDoServidorNoMolde("Aprovado. A confirmação automática não aconteceu: ", mensagem);

/** O tom do aviso que fica acima da lista depois de uma decisão. */
export type TomDaMensagem = "sucesso" | "aviso" | "erro";
export type MensagemDaFila = { texto: string; tom: TomDaMensagem };

/**
 * A mensagem depois de APROVAR, lida da resposta:
 *   · sem `confirmacaoAutomatica` (a TOP não confirma sozinha) → "Aprovado.";
 *   · `{ confirmado: true }` → "Aprovado e confirmado.";
 *   · `recusada` → "Aprovado. A confirmação automática não aconteceu: <mensagem do servidor>.";
 *   · `sem_permissao` e `aguardando_aprovacao` → "Aprovado." — a aprovação aconteceu; o documento segue aberto
 *     e a consulta dele diz o resto. Nenhum texto novo é inventado para esses dois casos.
 * Resultado fora do contrato também é "Aprovado.": o 200 já prova que a decisão foi gravada.
 */
export function mensagemDaAprovacao(resposta: RespostaDaDecisao | null | undefined): MensagemDaFila {
  const r = resposta?.confirmacaoAutomatica;
  if (r?.confirmado === true) return { texto: MSG_APROVADO_E_CONFIRMADO, tom: "sucesso" };
  if (r && r.confirmado === false && r.motivo === "recusada" && typeof r.erro?.message === "string" && r.erro.message.trim()) {
    return { texto: mensagemConfirmacaoAutomaticaNaoAconteceu(r.erro.message), tom: "aviso" };
  }
  return { texto: MSG_APROVADO, tom: "sucesso" };
}

/**
 * A rota da fila não existe neste servidor (a API anterior a esta fatia): o 404 do manipulador de rota inexistente.
 * Na fila (GET) qualquer 404 é isso — a rota nova nunca responde 404 à lista. Numa DECISÃO o 404 também é o do
 * documento invisível, então lá só conta o 404 de rota ("Rota não encontrada", `plugins/errors.ts` da API).
 */
export const filaAusente = (e: unknown): boolean => e instanceof ApiError && e.status === 404;
export const portaDaDecisaoAusente = (e: unknown): boolean => filaAusente(e) && (e as ApiError).message === "Rota não encontrada";

/** O documento da linha como os portais o endereçam: segmento da rota/porta e família de capacidade. */
export type DocumentoDaLinha = { segmento: string; perm: string };

interface ConfiguracaoDaArea {
  /** A porta da fila (GET, paginada pelo servidor). */
  porta: string;
  /** Título da coluna do parceiro. No estoque não há parceiro: a coluna mostra a espécie do documento. */
  rotuloDoParceiro: string;
  /** Venda e compra têm valor; o documento de estoque não tem (só na confirmação). */
  temValor: boolean;
  /** Venda: a decisão leva a `version` que a tela mostrou — documento alterado depois responde 409. */
  levaVersao: boolean;
  /**
   * O documento de uma espécie (a da linha, ou a da consulta), pelas variantes dos portais. `undefined` = espécie
   * desconhecida: sem ação.
   */
  documento: (especie: string) => DocumentoDaLinha | undefined;
  /** A porta da decisão. */
  portaDaDecisao: (l: LinhaDaFila, d: DocumentoDaLinha, decisao: Decisao) => string;
  /** A consulta do documento — as rotas de detalhe de hoje (DETAIL_ROUTES). */
  rotaDaConsulta: (l: LinhaDaFila, d: DocumentoDaLinha) => string;
}

/**
 * A fila de Vendas só tem a VENDA (`kind` "sale"): é a única família de vendas que se confirma — orçamento e pedido
 * não passam por aprovação (a matriz da TOP). O valor do discriminador é o mesmo que a matriz pergunta ao registry.
 */
const KIND_DA_VENDA = "sale";
const id = (l: LinhaDaFila) => encodeURIComponent(l.id);

/** As portas das filas — a raiz de toda rota de aprovação de cada área. */
const PORTA_DA_FILA_DE_VENDAS = "/api/aprovacoes/vendas";
const PORTA_DA_FILA_DE_COMPRAS = "/api/aprovacoes/compras";
const PORTA_DA_FILA_DO_ESTOQUE = "/api/aprovacoes/estoque";

/**
 * As áreas que mostram a aprovação NA CONSULTA do documento: a venda e a compra (OPERACOES-01 F2, decisão 279) e,
 * desde a F12 (decisão 282), o documento de estoque — as sete espécies, na consulta da Central de Estoque.
 */
export type AreaDaConsulta = "vendas" | "compras" | "estoque";
const PORTA_DA_FILA_DA_CONSULTA: Readonly<Record<AreaDaConsulta, string>> =
  Object.freeze({ vendas: PORTA_DA_FILA_DE_VENDAS, compras: PORTA_DA_FILA_DE_COMPRAS, estoque: PORTA_DA_FILA_DO_ESTOQUE });

/**
 * As portas de UM documento — um dono só, para a fila e para a consulta:
 *   · `GET <fila>/<id>` — a situação da aprovação do documento (só leitura; a API anterior não a tem e responde o 404
 *     de rota);
 *   · `POST <fila>/<id>/aprovar|reprovar` — a decisão (as rotas da fila, sem mudança).
 * No ESTOQUE cada espécie tem a sua rota (`<fila>/<segmento>/<id>`, o segmento da variante dos portais, como nas
 * decisões de hoje): sem a espécie, ou com uma que a variante não conhece, NÃO HÁ porta (`undefined`, fail-closed — a
 * tela não inventa rota). Na venda e na compra a espécie não muda a porta.
 */
const raizDoDocumento = (fila: string, documentoId: string): string => `${fila}/${encodeURIComponent(documentoId)}`;
const filaDaEspecieDoEstoque = (segmento: string): string => `${PORTA_DA_FILA_DO_ESTOQUE}/${encodeURIComponent(segmento)}`;
export function portaDaSituacaoDoDocumento(area: AreaDaConsulta, documentoId: string, especie?: string): string | undefined {
  if (area !== "estoque") return raizDoDocumento(PORTA_DA_FILA_DA_CONSULTA[area], documentoId);
  const v = especie ? varianteDeEstoque(especie) : undefined;
  return v ? raizDoDocumento(filaDaEspecieDoEstoque(v.segmento), documentoId) : undefined;
}
export function portaDaDecisaoDoDocumento(area: AreaDaConsulta, documentoId: string, decisao: Decisao, especie?: string): string | undefined {
  const porta = portaDaSituacaoDoDocumento(area, documentoId, especie);
  return porta === undefined ? undefined : `${porta}/${decisao}`;
}

export const CONFIGURACAO_DAS_AREAS: Readonly<Record<AreaDeAprovacao, ConfiguracaoDaArea>> = Object.freeze({
  vendas: {
    porta: PORTA_DA_FILA_DE_VENDAS,
    rotuloDoParceiro: "Cliente",
    temValor: true,
    levaVersao: true,
    documento: () => { const v = varianteDeVenda(KIND_DA_VENDA); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, _d, decisao) => `${raizDoDocumento(PORTA_DA_FILA_DE_VENDAS, l.id)}/${decisao}`,
    rotaDaConsulta: (l, d) => `/vendas/${d.segmento}/${id(l)}`
  },
  compras: {
    porta: PORTA_DA_FILA_DE_COMPRAS,
    rotuloDoParceiro: "Fornecedor",
    temValor: true,
    levaVersao: false,
    // A espécie é a que o SERVIDOR classificou na linha ("compra"), nunca suposta pela aba.
    documento: (especie) => { const v = varianteDeCompra(especie); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, _d, decisao) => `${raizDoDocumento(PORTA_DA_FILA_DE_COMPRAS, l.id)}/${decisao}`,
    rotaDaConsulta: (l, d) => `/compras/${d.segmento}/${id(l)}`
  },
  estoque: {
    porta: PORTA_DA_FILA_DO_ESTOQUE,
    rotuloDoParceiro: "Espécie",
    temValor: false,
    levaVersao: false,
    // Cada espécie tem o seu recurso de permissão (`entradas_estoque`…) e o seu segmento (`entradas`…).
    documento: (especie) => { const v = varianteDeEstoque(especie); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, d, decisao) => `${raizDoDocumento(filaDaEspecieDoEstoque(d.segmento), l.id)}/${decisao}`,
    // A MESMA rota que a lista de Movimentações usa para abrir o documento (pela espécie da linha).
    rotaDaConsulta: (l) => rotaDoDocumentoEstoque(l)
  }
});

/**
 * A espécie do documento que a CONSULTA mostra, no mesmo vocabulário que as rotas devolvem na linha da fila (a
 * `especie` da linha): a consulta da venda e a da compra só montam a aprovação para esse documento. O estoque não tem
 * espécie da área — a consulta dele sempre informa a sua; vazia é desconhecida, e a variante não a conhece (sem ação).
 */
const ESPECIE_DA_CONSULTA: Readonly<Record<AreaDaConsulta, string>> = Object.freeze({ vendas: "venda", compras: "compra", estoque: "" });

/**
 * O documento da consulta (segmento e família de capacidade), pelas MESMAS variantes da fila. `especie` ausente = a
 * espécie da consulta da área (a venda, a compra); presente = outra espécie que a mesma área aprova (OPERACOES-01 F6b,
 * decisão 283: o pedido de compra, que se aprova ao finalizar).
 */
export const documentoDaConsulta = (area: AreaDaConsulta, especie?: string): DocumentoDaLinha | undefined =>
  CONFIGURACAO_DAS_AREAS[area].documento(especie ?? ESPECIE_DA_CONSULTA[area]);

/**
 * A capacidade da PORTA da rota de decisão de cada área (`POST /api/aprovacoes/<área>/<id>/aprovar|reprovar`), que a
 * rota exige ANTES da capacidade da espécie. Na espécie da consulta as duas coincidem (`sales.approve`,
 * `compras.approve`); noutra espécie (o pedido de compra) a decisão exige as duas — AND, como a rota. No estoque
 * (`null`) a porta É a da espécie: cada espécie tem a sua rota, com `<recurso da espécie>.approve` e nada mais.
 */
export const PERMISSAO_DA_PORTA_DA_DECISAO: Readonly<Record<AreaDaConsulta, string | null>> =
  Object.freeze({ vendas: "sales.approve", compras: "compras.approve", estoque: null });

/**
 * O corpo da decisão — estrito, como as rotas o leem:
 *   · aprovar: `{ observacao? }` (ausente quando vazia), mais `version` na venda;
 *   · reprovar: `{ motivo }` (obrigatório), mais `version` na venda.
 * `versao`: a `version` da venda que a tela mostrou (a linha da fila, ou o documento da consulta).
 */
export function corpoDaDecisao(area: AreaDeAprovacao, versao: string | undefined, decisao: Decisao, texto: string): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (CONFIGURACAO_DAS_AREAS[area].levaVersao) corpo["version"] = versao;
  const t = texto.trim();
  if (decisao === "reprovar") corpo["motivo"] = t;
  else if (t) corpo["observacao"] = t;
  return corpo;
}

/**
 * A CHAVE DA DECISÃO (o `Idempotency-Key` do Aprovar/Reprovar) — a mesma regra na fila e na consulta, venda e compra.
 *
 * O servidor guarda a resposta da decisão pela chave (`idempotent`, em `apps/api/src/lib/service.ts`): o reenvio com a
 * MESMA chave e o mesmo corpo devolve a decisão já gravada e nunca decide duas vezes. Por isso a chave só muda quando a
 * tentativa anterior TERMINOU de verdade:
 *   · SUCESSO → renova (a próxima decisão é outra operação);
 *   · RECUSA DEFINITIVA (resposta 4xx: corpo recusado, documento que mudou, sem permissão, rota ausente…) → renova; a
 *     tentativa seguinte é um pedido novo, julgado de novo;
 *   · ERRO DE REDE, 5xx ou SEM RESPOSTA → MANTÉM: o cliente não sabe se o servidor gravou, e a nova tentativa é a MESMA
 *     operação — se a primeira gravou, o servidor devolve o que gravou (ou, com o texto mudado, recusa o corpo diferente
 *     com 409, e só então a chave renova); se não gravou, decide agora, uma vez.
 * A chave guardada vale para o MESMO documento e a MESMA decisão: abrir Reprovar depois de um Aprovar sem resposta (ou
 * outro documento) é outra operação, com chave nova — nunca a resposta gravada de uma decisão servindo a outra.
 */
export interface ChaveDaDecisao { readonly documentoId: string; readonly decisao: Decisao; readonly chave: string }

/** A resposta foi uma recusa definitiva do servidor (4xx)? Rede, 5xx e erro sem resposta NÃO são. */
export const recusaDefinitiva = (e: unknown): boolean => e instanceof ApiError && e.status >= 400 && e.status < 500;

/** A chave ao ABRIR a decisão: a guardada, se é do mesmo documento e da mesma decisão; senão, uma nova. */
export function chaveAoAbrirDecisao(guardada: ChaveDaDecisao | null, documentoId: string, decisao: Decisao, nova: () => string): ChaveDaDecisao {
  return guardada && guardada.documentoId === documentoId && guardada.decisao === decisao ? guardada : { documentoId, decisao, chave: nova() };
}

/** A chave DEPOIS da resposta: `null` (sucesso) ou erro 4xx → uma nova para a próxima tentativa; rede/5xx → a mesma. */
export function chaveDepoisDaDecisao(atual: ChaveDaDecisao, erro: unknown | null, nova: () => string): ChaveDaDecisao {
  return erro === null || recusaDefinitiva(erro) ? { ...atual, chave: nova() } : atual;
}

/** O limite da observação e do motivo (o mesmo das rotas e da coluna `observacao` da 0041). */
export const LIMITE_DO_TEXTO_DA_DECISAO = 500;

/**
 * A situação da fila no VOCABULÁRIO de situação do produto (`status` de @agro/domain): "pendente" é
 * `awaiting_approval` ("Aguardando aprovação"), "reprovado" é `rejected` ("Reprovado") e "aprovado" é `approved`
 * ("Aprovado" — só a consulta o mostra; a fila nunca recebe documento aprovado). Assim o rótulo sai de `enumLabel` e
 * a cor da família central do StatusBadge — nenhum texto nem tonalidade nasce nesta tela. Valor fora do contrato
 * segue cru para `enumLabel`, que o mostra como "Desconhecido" (nunca o valor técnico).
 */
const SITUACAO_NO_VOCABULARIO: Readonly<Record<string, string>> = Object.freeze({ pendente: "awaiting_approval", reprovado: "rejected", aprovado: "approved" });
export const valorDaSituacaoNaFila = (situacao: string): string => SITUACAO_NO_VOCABULARIO[situacao] ?? situacao;

/** A chave de cache da fila de uma área (a página entra depois — invalidar a área recarrega todas as páginas). */
export const chaveDaFila = (area: AreaDeAprovacao) => ["aprovacoes", area] as const;

/* ═══════════════ A APROVAÇÃO NA CONSULTA DO DOCUMENTO (OPERACOES-01 F2, decisão 279) ═══════════════ */

/**
 * A situação da aprovação de UM documento, como `GET /api/aprovacoes/<área>/<id>` a devolve:
 *   · `nao_aberto` — o documento não está aberto (confirmado, cancelado…): não há o que aprovar;
 *   · `nao_exigida` — a versão da TOP do documento não exige aprovação para ele;
 *   · `pendente` — exige e não há aprovação vigente para o conteúdo de agora;
 *   · `aprovado` / `reprovado` — a decisão vigente.
 */
const SITUACOES_NA_CONSULTA = ["nao_aberto", "nao_exigida", "pendente", "aprovado", "reprovado"] as const;
export type SituacaoNaConsulta = (typeof SITUACOES_NA_CONSULTA)[number];
export type SituacaoDoDocumento = { situacao: SituacaoNaConsulta; ultimaDecisao: UltimaDecisao | null };

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehSituacaoNaConsulta = (v: unknown): v is SituacaoNaConsulta =>
  typeof v === "string" && (SITUACOES_NA_CONSULTA as readonly string[]).includes(v);

/** A última decisão como veio do fio: `null` (sem decisão), a decisão, ou `undefined` quando está fora da forma. */
function lerUltimaDecisao(bruto: unknown): UltimaDecisao | null | undefined {
  if (bruto === null) return null;
  if (!objeto(bruto)) return undefined;
  const { decisao, observacao, decididoPor, decididoEm } = bruto;
  if (decisao !== "aprovado" && decisao !== "reprovado") return undefined;
  if (observacao !== null && typeof observacao !== "string") return undefined;
  if (!objeto(decididoPor) || typeof decididoPor["id"] !== "string" || typeof decididoPor["nome"] !== "string") return undefined;
  if (typeof decididoEm !== "string") return undefined;
  return { decisao, observacao, decididoPor: { id: decididoPor["id"], nome: decididoPor["nome"] }, decididoEm };
}

/**
 * A resposta da situação, lida com RIGOR: `situacao` do conjunto acima e `ultimaDecisao` nula ou na forma exata.
 * Qualquer desvio → `null`, e a consulta não desenha nada (a tela nunca afirma uma situação que não entendeu).
 */
export function lerSituacaoDoDocumento(bruto: unknown): SituacaoDoDocumento | null {
  if (!objeto(bruto) || !ehSituacaoNaConsulta(bruto["situacao"])) return null;
  const ultimaDecisao = lerUltimaDecisao(bruto["ultimaDecisao"]);
  if (ultimaDecisao === undefined) return null;
  return { situacao: bruto["situacao"], ultimaDecisao };
}

/** A chave de cache da situação de UM documento (invalidar tudo depois de uma decisão também a recarrega). */
export const chaveDaSituacaoDoDocumento = (area: AreaDaConsulta, documentoId: string) => ["aprovacao-do-documento", area, documentoId] as const;

/**
 * A última decisão em uma frase: "Última decisão: Aprovado por <nome> em <data e hora>." — com " Observação: <texto>"
 * quando a aprovação teve observação — ou "Última decisão: Reprovado por <nome> em <data e hora>. Motivo: <motivo>".
 */
export function textoDaUltimaDecisao(u: UltimaDecisao): string {
  const reprovado = u.decisao === "reprovado";
  const frase = `Última decisão: ${reprovado ? "Reprovado" : "Aprovado"} por ${u.decididoPor.nome} em ${dateTimeBR(u.decididoEm)}.`;
  if (reprovado) return `${frase} Motivo: ${u.observacao ?? ""}`;
  return u.observacao ? `${frase} Observação: ${u.observacao}` : frase;
}
