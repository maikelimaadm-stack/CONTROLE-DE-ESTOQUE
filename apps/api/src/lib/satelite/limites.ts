/**
 * LIMITES DA EXECUÇÃO SATELITAL (SAT-03, decisão 296) — o ÚNICO lugar com os números do limite de chamadas ao
 * Copernicus e do ritmo do executor da fila. Nenhum outro arquivo escreve um destes números.
 *
 * O limite é GLOBAL (todas as réplicas da API juntas), contado pelo BANCO:
 *   - chamadas no último minuto = linhas do ledger `erp.satelite_consumo` do último minuto + itens 'executando';
 *   - chamadas simultâneas      = itens 'executando' da fila.
 * A reserva de itens (`erp.satelite_reservar_itens`, migration 0054) confere os três tetos sob advisory lock, e a rota
 * avulsa da SAT-01 confere os tetos por minuto e o de simultâneas antes de chamar o provedor
 * (`erp.satelite_contar_chamadas`).
 *
 * ATENÇÃO — CONFIRMAR NO PAINEL DA CONTA COPERNICUS (dataspace.copernicus.eu → Sentinel Hub → cota da conta):
 * os valores PADRÃO abaixo são conservadores e NÃO foram lidos da conta real. A conta gratuita do CDSE aceita poucas
 * conexões concorrentes e tem teto de requisições por minuto e de processing units por mês. Os três primeiros podem
 * ser trocados por variável de ambiente (config.ts), sem novo deploy de código.
 */
import type { Config } from "../../config.js";

export const LIMITES_SATELITE_PADRAO = {
  /** Chamadas SIMULTÂNEAS ao provedor na conta inteira (todas as réplicas). CONFIRMAR NO PAINEL. */
  simultaneas: 2,
  /** Chamadas por minuto na conta inteira. CONFIRMAR NO PAINEL. */
  porMinutoConta: 30,
  /** Chamadas por minuto por organização (um cliente não come a cota dos outros). Era 10 por instância na SAT-01. */
  porMinutoOrganizacao: 10
} as const;

/**
 * Vagas de chamada simultânea que o executor da fila DEIXA LIVRES para o pedido avulso da SAT-01 (o clique em
 * "Analisar agora"): o executor usa no máximo `simultaneas − RESERVA_INTERATIVA`. Com o padrão (2 − 1), o lote nunca
 * tranca o botão.
 */
export const RESERVA_INTERATIVA = 1;

/**
 * PISO POR INSTÂNCIA do pedido avulso da SAT-01, em TENTATIVAS (chamadas abertas ao provedor) por organização por minuto,
 * somado (E) ao limite global. O ledger só conta chamada respondida (2xx): recusa, 429, 5xx, tempo e rede não entram nele,
 * e sem este piso um usuário poderia martelar um provedor fora do ar sem taxa nenhuma. É o mesmo número da SAT-01.
 */
export const TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA = 10;

/**
 * Pausa do executor DESTA instância quando o provedor responde como indisponível para a conta (429, 5xx, tempo, rede):
 * a rodada seguinte não reserva nada até passar a espera (a maior entre esta e o Retry-After). Sem a pausa, um provedor
 * que recusa na hora queimaria a fila inteira em segundos, uma tentativa por item — falha não entra no ledger nem conta.
 */
export const PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S = 60;

/** Itens que o executor reserva por rodada (o teto real é a capacidade livre no momento). */
export const LOTE_EXECUTOR = 5;

/** Intervalo padrão entre rodadas do executor, em segundos (SATELITE_WORKER_INTERVALO_S troca). */
export const INTERVALO_EXECUTOR_PADRAO_S = 5;

/**
 * Prazo de um item 'executando'. Passou dele sem resultado (réplica que caiu no meio da chamada), a reserva seguinte
 * devolve o item para 'pendente'. Precisa ser MAIOR que a chamada mais longa possível: token 10 s + estatística 30 s ×
 * 2 tentativas internas do cliente ≈ 70 s. 10 minutos dão folga larga.
 */
export const PRAZO_EXECUCAO_S = 600;

/** Tentativas de um item por RODADA (429, 5xx, tempo, rede). Esgotou → 'falho'. "Reprocessar falhas" abre outra rodada. */
export const TENTATIVAS_POR_RODADA = 3;

/** Espera antes da tentativa seguinte: BASE × FATOR^(tentativa − 1), com variação aleatória de ±JITTER (30 s, 2 min…). */
export const ESPERA_BASE_S = 30;
export const ESPERA_FATOR = 4;
export const ESPERA_JITTER = 0.2;

export interface LimitesSatelite {
  simultaneas: number;
  porMinutoConta: number;
  porMinutoOrganizacao: number;
}

/** Os limites em vigor: a variável de ambiente, quando definida (validada em config.ts), senão o padrão daqui. */
export function limitesDaConfig(config: Pick<Config, "SATELITE_LIMITE_SIMULTANEAS" | "SATELITE_LIMITE_MINUTO_CONTA" | "SATELITE_LIMITE_MINUTO_ORG">): LimitesSatelite {
  return {
    simultaneas: config.SATELITE_LIMITE_SIMULTANEAS ?? LIMITES_SATELITE_PADRAO.simultaneas,
    porMinutoConta: config.SATELITE_LIMITE_MINUTO_CONTA ?? LIMITES_SATELITE_PADRAO.porMinutoConta,
    porMinutoOrganizacao: config.SATELITE_LIMITE_MINUTO_ORG ?? LIMITES_SATELITE_PADRAO.porMinutoOrganizacao
  };
}

/** Vagas simultâneas do executor da fila (nunca menos de 1: com `simultaneas` = 1 o executor ainda anda). */
export const simultaneasDoExecutor = (l: LimitesSatelite): number => Math.max(1, l.simultaneas - RESERVA_INTERATIVA);
