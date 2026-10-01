"use client";
import { ApiError } from "@/lib/api";
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
  ultimaDecisao: { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: ReferenciaDaFila; decididoEm: string } | null;
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

/** O resultado da confirmação automática que a aprovação pode disparar (TOP no formato 4 com Confirmação Automática). */
export type ResultadoConfirmacaoAutomatica =
  | { confirmado: true }
  | { confirmado: false; motivo: "aguardando_aprovacao" }
  | { confirmado: false; motivo: "sem_permissao" }
  | { confirmado: false; motivo: "recusada"; erro: { code: string; message: string; details?: unknown } };

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
/**
 * A confirmação automática recusou depois da aprovação: o documento fica aprovado e aberto, e a mensagem é a do
 * servidor (o MESMO corpo que o /confirm daria). O ponto final dela sai antes de entrar no molde, que já termina
 * em ponto — "…saldo insuficiente.." seria o molde mal aplicado, não a mensagem.
 */
export const mensagemConfirmacaoAutomaticaNaoAconteceu = (mensagem: string): string =>
  `Aprovado. A confirmação automática não aconteceu: ${mensagem.trim().replace(/\.+$/, "")}.`;

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
  /** Venda: a decisão leva a `version` que a fila mostrou — documento alterado depois responde 409. */
  levaVersao: boolean;
  /** O documento da linha, pelas variantes dos portais. `undefined` = espécie desconhecida: sem ação. */
  documento: (l: LinhaDaFila) => DocumentoDaLinha | undefined;
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

export const CONFIGURACAO_DAS_AREAS: Readonly<Record<AreaDeAprovacao, ConfiguracaoDaArea>> = Object.freeze({
  vendas: {
    porta: "/api/aprovacoes/vendas",
    rotuloDoParceiro: "Cliente",
    temValor: true,
    levaVersao: true,
    documento: () => { const v = varianteDeVenda(KIND_DA_VENDA); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, _d, decisao) => `/api/aprovacoes/vendas/${id(l)}/${decisao}`,
    rotaDaConsulta: (l, d) => `/vendas/${d.segmento}/${id(l)}`
  },
  compras: {
    porta: "/api/aprovacoes/compras",
    rotuloDoParceiro: "Fornecedor",
    temValor: true,
    levaVersao: false,
    // A espécie é a que o SERVIDOR classificou na linha ("compra"), nunca suposta pela aba.
    documento: (l) => { const v = varianteDeCompra(l.especie); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, _d, decisao) => `/api/aprovacoes/compras/${id(l)}/${decisao}`,
    rotaDaConsulta: (l, d) => `/compras/${d.segmento}/${id(l)}`
  },
  estoque: {
    porta: "/api/aprovacoes/estoque",
    rotuloDoParceiro: "Espécie",
    temValor: false,
    levaVersao: false,
    // Cada espécie tem o seu recurso de permissão (`entradas_estoque`…) e o seu segmento (`entradas`…).
    documento: (l) => { const v = varianteDeEstoque(l.especie); return v ? { segmento: v.segmento, perm: v.perm } : undefined; },
    portaDaDecisao: (l, d, decisao) => `/api/aprovacoes/estoque/${encodeURIComponent(d.segmento)}/${id(l)}/${decisao}`,
    // A MESMA rota que a lista de Movimentações usa para abrir o documento (pela espécie da linha).
    rotaDaConsulta: (l) => rotaDoDocumentoEstoque(l)
  }
});

/**
 * O corpo da decisão — estrito, como as rotas o leem:
 *   · aprovar: `{ observacao? }` (ausente quando vazia), mais `version` na venda;
 *   · reprovar: `{ motivo }` (obrigatório), mais `version` na venda.
 */
export function corpoDaDecisao(area: AreaDeAprovacao, l: LinhaDaFila, decisao: Decisao, texto: string): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  if (CONFIGURACAO_DAS_AREAS[area].levaVersao) corpo["version"] = l.version;
  const t = texto.trim();
  if (decisao === "reprovar") corpo["motivo"] = t;
  else if (t) corpo["observacao"] = t;
  return corpo;
}

/** O limite da observação e do motivo (o mesmo das rotas e da coluna `observacao` da 0041). */
export const LIMITE_DO_TEXTO_DA_DECISAO = 500;

/**
 * A situação da fila no VOCABULÁRIO de situação do produto (`status` de @agro/domain): "pendente" é
 * `awaiting_approval` ("Aguardando aprovação") e "reprovado" é `rejected` ("Reprovado"). Assim o rótulo sai de
 * `enumLabel` e a cor da família central do StatusBadge — nenhum texto nem tonalidade nasce nesta tela. Valor fora
 * do contrato segue cru para `enumLabel`, que o mostra como "Desconhecido" (nunca o valor técnico).
 */
const SITUACAO_NO_VOCABULARIO: Readonly<Record<string, string>> = Object.freeze({ pendente: "awaiting_approval", reprovado: "rejected" });
export const valorDaSituacaoNaFila = (situacao: string): string => SITUACAO_NO_VOCABULARIO[situacao] ?? situacao;

/** A chave de cache da fila de uma área (a página entra depois — invalidar a área recarrega todas as páginas). */
export const chaveDaFila = (area: AreaDeAprovacao) => ["aprovacoes", area] as const;
