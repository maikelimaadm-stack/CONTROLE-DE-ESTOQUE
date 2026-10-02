"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import {
  ROTULOS_SECAO_CONFIGURACAO_TOP,
  SECOES_EXTENSAO_V5,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V3,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V4,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V5,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracaoTopParaEdicao,
  configuracaoTopParaEdicaoV3,
  configuracaoTopParaEdicaoV4,
  configuracaoTopParaEdicaoV5,
  execucaoDeclaradaTop,
  formato5Top,
  lerCatalogoTop,
  lerConfiguracaoTop,
  lerMatrizExecucaoTop,
  lerMatrizRegrasGeraisTop,
  regrasGeraisExecutamTop,
  type AtualizacaoEstoque,
  type AtualizacaoFinanceiro,
  type CalculoTributario,
  type CatalogoTop,
  type ConfiguracaoComRestricoesTop,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV1,
  type ConfiguracaoTipoOperacaoV2,
  type ConfiguracaoTipoOperacaoV3,
  type ConfiguracaoTipoOperacaoV4,
  type ConfiguracaoTipoOperacaoV5,
  type ItemMatrizRegrasGeraisTop,
  type ModoConfirmacao,
  type ModoFinanceiro,
  type MomentoAprovacao,
  type MomentoEfeito,
  type PoliticaAlteracao,
  type PoliticaAprovacao,
  type PoliticaClienteEmAtraso,
  type PoliticaDocumentoSemItens,
  type PoliticaSaldoNegativo,
  type SecaoConfiguracaoTopV5,
  type SuporteExecucaoFamiliaTop
} from "@agro/domain";
import type { CondicaoPermitidaEmEdicao } from "./top-condicoes-permitidas";

/**
 * O CONTRATO DE CONFIGURAÇÃO DE TOP VISTO DO LADO DO NAVEGADOR (TOP-CONFIG-03).
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE, SE O DOMÍNIO JÁ TEM O CONTRATO ──────────────────────────────────────┐
 * │ O domínio (`packages/domain/src/tipo-operacao-configuracao.ts`) é a verdade sobre a FORMA da        │
 * │ configuração, e este arquivo NÃO a repete: ele importa os tipos, o neutro e o leitor estrito de lá. │
 * │ O que mora aqui é a outra pergunta — "esta API, agora, sabe guardar configuração?" — que o domínio  │
 * │ não pode responder porque não conhece o fio.                                                        │
 * │                                                                                                      │
 * │ Durante um rolling deploy a web NOVA conversa com a API ANTIGA por alguns minutos. Mandar            │
 * │ `configuracao` às cegas nesse intervalo tem dois desfechos, e os dois são ruins: ou a API antiga     │
 * │ recusa com 422 (ruído), ou — pior — a aceita e descarta, e a tela diz "salvo" sobre uma regra que    │
 * │ nunca foi gravada. Então a tela PERGUNTA antes, e só oferece o editor avançado quando a resposta     │
 * │ confirma o contrato. Sem confirmação, o cadastro básico continua funcionando e a configuração fica   │
 * │ explicitamente BLOQUEADA — nunca silenciosamente ignorada.                                           │
 * │                                                                                                      │
 * │ A forma é a mesma de `features/sales/tipo-operacao-select.tsx`, que mediu o comportamento da API     │
 * │ anterior: estados `carregando` / `nao-confirmado` / `pronto` / `erro`, com componente de mensagem    │
 * │ único por estado. Fail-closed em tudo que não for `pronto`.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ UM 200 TAMBÉM É CONFERIDO ────────────────────────────────────────────────────────────────────────┐
 * │ `api<T>()` é uma ASSERÇÃO de tipo, não uma prova: em runtime o corpo é `unknown` e o TypeScript já  │
 * │ terminou o trabalho dele. Uma API MAIS NOVA (contrato 2, campos com outro significado) chegaria ao  │
 * │ estado "pronto" sem conferência e o PUT sairia contra um contrato que ninguém leu. Por isso todo    │
 * │ corpo passa por um leitor explícito aqui, e o que não se reconhece NEGA.                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** A ÚNICA versão de contrato de capacidades que esta tela sabe ler. O servidor a declara em `/capabilities`. */
export const CONTRATO_CAPACIDADES_TOP = 1 as const;

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehInteiroPositivo = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

// ---------------------------------------------------------------------------------------------------
// 1. CAPACIDADES
// ---------------------------------------------------------------------------------------------------

export interface CapacidadesDestinosTop {
  suportado: boolean;
  limite: number;
  /** TOP-CONFIG-06: o servidor aceita `emPartes` por aresta (`destinos.emPartes === 1`). Ausente = não aceita. */
  emPartes: boolean;
}

/**
 * O que o servidor declara sobre a EXECUÇÃO CONFIGURADA (TOP-CONFIG-04A).
 *
 * `suportado` diz se ELE grava o formato 2 (o bloco `execucao`); `runtimeHabilitado`, se ESTA instância
 * executa a configuração agora (o gate operacional); `matriz`, o que é executável por família. A tela
 * avalia a matriz que o SERVIDOR declarou — nunca uma cópia própria —, e a decisão final é sempre dele.
 */
export interface CapacidadesExecucaoTop {
  suportado: boolean;
  runtimeHabilitado: boolean;
  matriz: SuporteExecucaoFamiliaTop[];
}

/**
 * O que o servidor declara sobre as RESTRIÇÕES DA OPERAÇÃO (TOP-CONFIG-05): se ele grava o formato 3
 * (exigências novas, cliente em atraso, fiscal de configuração) e a lista de condições permitidas.
 * Ausente = servidor anterior: `{ suportado: false, versaoSchema: 0 }`, e o editor é exatamente o de hoje.
 */
export interface CapacidadesRestricoesTop {
  suportado: boolean;
  versaoSchema: number;
}

/**
 * O que o servidor declara sobre as REGRAS GERAIS E A APROVAÇÃO EXECUTADAS (TOP-CONFIG-08): o formato em que ele as
 * grava (`versaoSchema`, hoje 4) e a matriz por família — o que cada família aceita em Confirmação, Documento sem
 * itens, Alteração após confirmar e Aprovação, com o motivo do que ela não aceita. A tela avalia a matriz QUE O
 * SERVIDOR DECLAROU, lida pelo leitor estrito do domínio — nunca `MATRIZ_REGRAS_GERAIS_TOP` importada direto: a
 * matriz só cresce, e uma cópia da tela recusaria o que um servidor mais novo já aceita (ou o contrário).
 */
export interface CapacidadesRegrasGeraisTop {
  versaoSchema: number;
  matriz: readonly ItemMatrizRegrasGeraisTop[];
}

/**
 * O que o servidor declara sobre o FORMATO 5 (OPERACOES-01 F4, decisão 281): o formato que ele grava (`versaoSchema`,
 * hoje 5), as SEÇÕES DE EXTENSÃO que ele lê e grava (`secoes`, vazia na F4 — cada fase F5 a F10 acrescenta a sua) e o
 * CATÁLOGO POR TIPO (os tipos de movimento do passo 1, agrupados, e o perfil de cada família: as abas, as exigências
 * com o rótulo do tipo e as seções que ficam no padrão). A tela lê o catálogo QUE O SERVIDOR PUBLICOU, pelo leitor
 * estrito do domínio (`lerCatalogoTop`) — nunca `CATALOGO_TOP` importado direto: o catálogo cresce por fase, e uma
 * cópia da tela ofereceria um tipo que o servidor ainda não aceita (ou esconderia um que ele já aceita).
 */
export interface CapacidadesFormato5Top {
  versaoSchema: number;
  secoes: string[];
  catalogo: CatalogoTop;
}

export interface CapacidadesTop {
  contractVersion: typeof CONTRATO_CAPACIDADES_TOP;
  configuracao: { versaoSchema: number; secoes: string[] };
  destinos: CapacidadesDestinosTop;
  execucao: CapacidadesExecucaoTop;
  restricoes: CapacidadesRestricoesTop;
  /**
   * TOP-CONFIG-07: o servidor grava `reservaEstoque` na versão (`capabilities.reservaEstoque === 1`). ADITIVO:
   * ausente ou qualquer outro valor = servidor anterior — a caixa não aparece e a chave nunca vai no corpo.
   */
  reservaEstoque: boolean;
  /**
   * TOP-CONFIG-08: o bloco `regrasGerais` da raiz, lido. `null` = AUSENTE (servidor anterior) OU ILEGÍVEL — os dois
   * dão o mesmo editor, o de hoje, no formato 3, sem nenhuma chave nova no fio (ver `lerRegrasGeraisDasCapacidades`).
   */
  regrasGerais: CapacidadesRegrasGeraisTop | null;
  /**
   * OPERACOES-01 F4: o bloco `formato5` da raiz, lido. `null` = AUSENTE (servidor anterior) OU ILEGÍVEL — os dois dão
   * o mesmo editor, o do formato 4 de hoje, sem assistente e sem nenhuma chave do 5 no fio (ver
   * `lerFormato5DasCapacidades`).
   */
  formato5: CapacidadesFormato5Top | null;
  /**
   * OPERACOES-01 F9 (decisão 286): o servidor grava os PADRÕES FINANCEIROS da versão (`capabilities.padroesFinanceiros
   * === 1`, a tabela da versão). ADITIVO, na régua de `reservaEstoque`: ausente ou qualquer outro valor = servidor
   * anterior — os campos dos padrões não aparecem e a chave `padroesFinanceiros` nunca vai no corpo (`.strict()`).
   */
  padroesFinanceiros: boolean;
}

/** Servidor sem restrições: nada do formato 3 aparece e nada dele é enviado. */
const SEM_RESTRICOES: CapacidadesRestricoesTop = { suportado: false, versaoSchema: 0 };

/**
 * Lê o bloco `regrasGerais` das capacidades (TOP-CONFIG-08), ou `null`.
 *
 * ┌─ ESTE BLOCO NÃO SEGUE A RÉGUA DOS OUTROS, E ISSO É DELIBERADO ─────────────────────────────────────┐
 * │ `destinos`, `execucao` e `restricoes` presentes e malformados NEGAM o corpo inteiro: contrato       │
 * │ desconhecido, e nada dele merece confiança. Aqui, presente e malformado vira `null` — "como se não  │
 * │ existisse" —, e as outras capacidades continuam lidas. A diferença é o que a degradação custa:      │
 * │ sem o bloco, o editor é o de hoje e grava o formato 3, que o servidor continua aceitando e que      │
 * │ NUNCA executa as regras gerais (é o corte da decisão 277). O pior desfecho é não oferecer a regra   │
 * │ nova; negar o corpo inteiro bloquearia também a configuração que a tela sabe escrever.              │
 * │                                                                                                      │
 * │ Legível exige: objeto, `suportado === true`, `versaoSchema` inteiro positivo e a matriz aceita por  │
 * │ `lerMatrizRegrasGeraisTop` (estrito: chave a mais ou a menos, valor fora do enum, família repetida   │
 * │ — qualquer desvio é `null`, nunca um pedaço da matriz adivinhado). Um `versaoSchema` que esta tela   │
 * │ não escreve não é malformação: o bloco é lido e `podeConfigurarRegrasGerais` o recusa.              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function lerRegrasGeraisDasCapacidades(bruto: unknown): CapacidadesRegrasGeraisTop | null {
  if (!ehObjeto(bruto) || bruto.suportado !== true || !ehInteiroPositivo(bruto.versaoSchema)) return null;
  const matriz = lerMatrizRegrasGeraisTop(bruto.matriz);
  return matriz === null ? null : { versaoSchema: bruto.versaoSchema, matriz };
}

/**
 * Lê o bloco `formato5` das capacidades (OPERACOES-01 F4), ou `null` — NA RÉGUA DO `regrasGerais`, e pelo mesmo
 * motivo: presente e malformado vira "como se não existisse", sem negar o resto. Sem o bloco o editor é o do formato
 * 4, que o servidor continua aceitando (e mantém no 4); o pior desfecho é não oferecer o assistente nem as seções
 * novas. Negar o corpo inteiro bloquearia também a configuração que a tela sabe escrever.
 *
 * Legível exige: objeto, `suportado === true`, `versaoSchema` inteiro positivo, `secoes` lista de textos e o catálogo
 * aceito por `lerCatalogoTop` (estrito: qualquer desvio é `null`, nunca um pedaço do catálogo adivinhado). Um
 * `versaoSchema` ou um conjunto de seções que esta tela não escreve não é malformação: o bloco é lido e
 * `podeConfigurarFormato5` o recusa. `leituraDoDetalhe` não é lido: o leitor do domínio lê qualquer formato que
 * conhece, e o detalhe chega como foi gravado.
 */
function lerFormato5DasCapacidades(bruto: unknown): CapacidadesFormato5Top | null {
  if (!ehObjeto(bruto) || bruto.suportado !== true || !ehInteiroPositivo(bruto.versaoSchema)) return null;
  const { secoes } = bruto;
  if (!Array.isArray(secoes) || !secoes.every(ehTexto)) return null;
  const catalogo = lerCatalogoTop(bruto.catalogo);
  return catalogo === null ? null : { versaoSchema: bruto.versaoSchema, secoes: [...secoes], catalogo };
}

/** Servidor sem execução configurada: nada é executável e nada do bloco é enviado. */
const SEM_EXECUCAO: CapacidadesExecucaoTop = { suportado: false, runtimeHabilitado: false, matriz: [] };

/**
 * Lê o corpo de `/capabilities`, ou devolve `null` — que é o mesmo que "não confirmado".
 *
 * O BLOCO `destinos` É TRATADO COMO OPCIONAL, E ISSO É DELIBERADO. Uma API que declara o contrato 1 e
 * guarda configuração pode ainda não servir o grafo de próximas operações; recusar o corpo inteiro por
 * causa disso bloquearia também a configuração, que ela sabe guardar. Ausente vira `suportado: false`, o
 * mesmo que a tela usa para bloquear a aba de destinos — degradação por PARTE, nunca por adivinhação.
 * Presente e malformado, ao contrário, é contrato desconhecido e NEGA o corpo inteiro.
 */
export function lerCapacidadesTop(bruto: unknown): CapacidadesTop | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.contractVersion !== CONTRATO_CAPACIDADES_TOP) return null;

  const c = bruto.configuracao;
  if (!ehObjeto(c) || !ehInteiroPositivo(c.versaoSchema)) return null;
  if (!Array.isArray(c.secoes) || !c.secoes.every(ehTexto)) return null;

  let destinos: CapacidadesDestinosTop = { suportado: false, limite: 0, emPartes: false };
  if (bruto.destinos !== undefined) {
    const d = bruto.destinos;
    if (!ehObjeto(d) || typeof d.suportado !== "boolean") return null;
    if (d.suportado && !ehInteiroPositivo(d.limite)) return null;
    // `emPartes` é ADITIVO: só o valor 1 liga a caixa; qualquer outra coisa (inclusive ausência) a esconde.
    destinos = { suportado: d.suportado, limite: ehInteiroPositivo(d.limite) ? d.limite : 0, emPartes: d.suportado && d.emPartes === 1 };
  }

  /**
   * O BLOCO `execucao` SEGUE A MESMA RÉGUA DE `destinos`: ausente = servidor anterior à TOP-CONFIG-04A
   * (a execução fica fora do editor, e a gravação sai no formato 1); presente e malformado = contrato
   * desconhecido, e o corpo inteiro NEGA. Um formato de execução que esta tela não escreve (um 3 futuro)
   * não é malformação: degrada só a parte da execução.
   */
  let execucao = SEM_EXECUCAO;
  if (bruto.execucao !== undefined) {
    const x = bruto.execucao;
    if (!ehObjeto(x) || typeof x.suportado !== "boolean" || typeof x.runtimeHabilitado !== "boolean" || !ehInteiroPositivo(x.versaoSchema)) return null;
    const matriz = lerMatrizExecucaoTop(x.matriz);
    if (matriz === null) return null;
    if (x.suportado && x.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2) {
      execucao = { suportado: true, runtimeHabilitado: x.runtimeHabilitado, matriz };
    }
  }

  /**
   * O BLOCO `restricoes` (TOP-CONFIG-05) SEGUE A MESMA RÉGUA: ausente = servidor anterior (editor de hoje,
   * formato 2, nenhuma chave nova no fio); presente e malformado = contrato desconhecido, o corpo inteiro NEGA.
   * Um `versaoSchema` que esta tela não escreve não é malformação: `podeConfigurarRestricoes` o recusa.
   */
  let restricoes = SEM_RESTRICOES;
  if (bruto.restricoes !== undefined) {
    const r = bruto.restricoes;
    if (!ehObjeto(r) || typeof r.suportado !== "boolean") return null;
    if (typeof r.versaoSchema !== "number" || !Number.isInteger(r.versaoSchema) || r.versaoSchema < 0) return null;
    restricoes = { suportado: r.suportado, versaoSchema: r.versaoSchema };
  }

  return {
    contractVersion: CONTRATO_CAPACIDADES_TOP,
    configuracao: { versaoSchema: c.versaoSchema, secoes: c.secoes as string[] },
    destinos,
    execucao,
    restricoes,
    // Só o valor EXATO 1 liga (a régua de `destinos.emPartes`): ausente é o servidor anterior, e outro valor é
    // um contrato que esta tela não leu — nos dois casos a reserva fica fora do editor, sem negar o resto.
    reservaEstoque: bruto.reservaEstoque === 1,
    // TOP-CONFIG-08: ausente ou ilegível = `null`, sem negar o resto (régua própria, em `lerRegrasGeraisDasCapacidades`).
    regrasGerais: lerRegrasGeraisDasCapacidades(bruto.regrasGerais),
    // OPERACOES-01 F4: a mesma régua do `regrasGerais` (em `lerFormato5DasCapacidades`).
    formato5: lerFormato5DasCapacidades(bruto.formato5),
    // OPERACOES-01 F9: só o valor EXATO 1 liga (a régua de `reservaEstoque`), sem negar o resto.
    padroesFinanceiros: bruto.padroesFinanceiros === 1
  };
}

/** O que a tela precisa decidir antes de oferecer o editor avançado. */
export type EstadoCapacidadesTop =
  /** Ainda perguntando. */
  | { situacao: "carregando" }
  /**
   * A API não confirmou o contrato: rota ausente (404, API anterior a esta fatia), servidor com defeito
   * (5xx) ou 200 com corpo que não é este contrato. Os três chegam indistinguíveis o bastante, e nos três
   * a resposta certa é a mesma — bloquear a escrita de configuração. Em 200 inválido o `status` fica
   * AUSENTE de propósito: anotar 200 aqui enganaria quem lesse.
   */
  | { situacao: "nao-confirmado"; status?: number }
  /** A API guarda configuração num schema que esta versão da tela não escreve. Causa DIFERENTE, texto diferente. */
  | { situacao: "schema-divergente"; versaoSchema: number }
  /** Falha que o servidor EXPLICOU (403, rede): bloqueia e repete a causa que ele deu. */
  | { situacao: "erro"; mensagem: string }
  /** A API confirmou o contrato 1 e o schema que esta tela escreve. */
  | { situacao: "pronto"; capacidades: CapacidadesTop };

/**
 * Pergunta à API o que ela sabe fazer com configuração de TOP.
 *
 * `retry: false` é deliberado: 404 aqui é RESPOSTA (a API não tem a rota), não falha transitória.
 */
export function useCapacidadesTop(habilitado = true): EstadoCapacidadesTop {
  // `unknown` DE PROPÓSITO: o corpo só vira `CapacidadesTop` depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", "capabilities"],
    queryFn: () => api<unknown>("/api/admin/tipos-operacao/capabilities"),
    enabled: habilitado,
    retry: false
  });

  if (!habilitado || q.isPending) return { situacao: "carregando" };
  if (q.error) {
    if (q.error.status === 404 || q.error.status >= 500) return { situacao: "nao-confirmado", status: q.error.status };
    return { situacao: "erro", mensagem: q.error.message };
  }
  const lidas = lerCapacidadesTop(q.data);
  if (!lidas) return { situacao: "nao-confirmado" };
  // Contrato certo, DICIONÁRIO errado: escrever v1 numa API que guarda v2 gravaria bytes que ela leria com
  // outro significado. Bloquear é a única leitura honesta.
  if (lidas.configuracao.versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP) {
    return { situacao: "schema-divergente", versaoSchema: lidas.configuracao.versaoSchema };
  }
  return { situacao: "pronto", capacidades: lidas };
}

/** A configuração pode ser ENVIADA? Só com contrato confirmado. Fail-closed em todos os outros estados. */
export const podeConfigurar = (
  e: EstadoCapacidadesTop
): e is Extract<EstadoCapacidadesTop, { situacao: "pronto" }> => e.situacao === "pronto";

/** Os destinos podem ser ENVIADOS? Exige contrato confirmado E o bloco de destinos declarado pela API. */
export const podeConfigurarDestinos = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurar(e) && e.capacidades.destinos.suportado;

/**
 * As restrições (formato 3 + condições permitidas) podem ser EDITADAS e ENVIADAS? Exige contrato confirmado,
 * o bloco declarado E o formato que esta tela escreve (3). Qualquer outra resposta = editor de hoje.
 */
export const podeConfigurarRestricoes = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurar(e) && e.capacidades.restricoes.suportado
  && e.capacidades.restricoes.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V3;

/**
 * TOP-CONFIG-08 — o bloco `regrasGerais` que o editor do formato 4 usa, ou `null`. Uma pergunta só, para as duas
 * funções abaixo nunca discordarem: exige tudo o que as restrições exigem (o formato 4 tem as chaves do 3, e o
 * servidor que não grava o 3 não grava o 4) E o bloco legível no formato que esta tela escreve (4).
 */
const regrasGeraisDoEditor = (e: EstadoCapacidadesTop): CapacidadesRegrasGeraisTop | null => {
  if (!podeConfigurar(e) || !podeConfigurarRestricoes(e)) return null;
  const r = e.capacidades.regrasGerais;
  return r !== null && r.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V4 ? r : null;
};

/**
 * As regras gerais e a aprovação podem ser EDITADAS, e o rascunho vai no FORMATO 4 (`RascunhoTop.configuracaoV4`)?
 * Qualquer resposta que não seja o bloco legível no formato 4 = o editor da TOP-CONFIG-05, formato 3, textos de
 * hoje — que é exatamente o que uma API anterior a esta fatia recebe.
 */
export const podeConfigurarRegrasGerais = (e: EstadoCapacidadesTop): boolean => regrasGeraisDoEditor(e) !== null;

/**
 * A matriz por família que o servidor declarou — `null` fora de `podeConfigurarRegrasGerais` (fail-closed: sem o
 * formato 4 no editor não há regra geral a conferir, e uma matriz sem uso seria convite a uma segunda decisão).
 * É a que se passa a `regrasGeraisDaFamiliaTop`, `validarRegrasGeraisTop` e `normalizarRegrasGeraisDaFamiliaTop`.
 */
export const matrizRegrasGerais = (e: EstadoCapacidadesTop): readonly ItemMatrizRegrasGeraisTop[] | null =>
  regrasGeraisDoEditor(e)?.matriz ?? null;

/**
 * OPERACOES-01 F4 — o bloco `formato5` que o editor do formato 5 usa, ou `null`. Uma pergunta só, para as duas
 * funções abaixo nunca discordarem: exige tudo o que as regras gerais exigem (o 5 é o 4 + as seções de extensão, e o
 * servidor que não grava o 4 não grava o 5), o bloco legível no formato que esta tela escreve (5) E o MESMO CONJUNTO
 * de seções de extensão que ela escreve (`SECOES_EXTENSAO_V5`).
 *
 * ┌─ POR QUE O CONJUNTO DE SEÇÕES TEM DE SER IGUAL, E NÃO SÓ CONTER ───────────────────────────────────┐
 * │ Servidor com uma seção que esta tela não conhece (mais novo): gravar o 5 sem ela faria o servidor     │
 * │ lê-la AUSENTE — o neutro — e a regra que alguém ligou noutra tela voltaria ao padrão em silêncio.     │
 * │ Servidor sem uma seção que esta tela escreve (mais velho): ele recusaria a chave (422) ou, pior, a   │
 * │ trataria como outra coisa. Nos dois casos a resposta honesta é a do formato desconhecido: o editor   │
 * │ do 4 de hoje, e a TOP já gravada no 5 BLOQUEADA (`configuracaoIlegivelNoEditor`). Repetição na lista │
 * │ declarada também não é este conjunto — contrato que a tela não leu.                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
const formato5DoEditor = (e: EstadoCapacidadesTop): CapacidadesFormato5Top | null => {
  if (!podeConfigurar(e) || !podeConfigurarRegrasGerais(e)) return null;
  const f = e.capacidades.formato5;
  if (f === null || f.versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP_V5) return null;
  const conhecidas: readonly string[] = SECOES_EXTENSAO_V5;
  const mesmoConjunto = f.secoes.length === conhecidas.length && new Set(f.secoes).size === f.secoes.length
    && f.secoes.every((s) => conhecidas.includes(s));
  return mesmoConjunto ? f : null;
};

/**
 * O editor é o do FORMATO 5 — o assistente na criação, as abas pelo perfil do tipo, e o rascunho no 5
 * (`RascunhoTop.configuracaoV5`)? Qualquer resposta que não seja o bloco legível no 5, com o mesmo conjunto de seções,
 * = o editor do formato 4 de hoje, textos e gravação inclusive — que é exatamente o que uma API anterior recebe.
 */
export const podeConfigurarFormato5 = (e: EstadoCapacidadesTop): boolean => formato5DoEditor(e) !== null;

/**
 * O catálogo por tipo que o servidor publicou — `null` fora de `podeConfigurarFormato5` (fail-closed: sem o editor do
 * 5 não há passo 1 nem perfil, e um catálogo sem uso seria convite a uma segunda decisão). É o que se passa a
 * `tiposParaEscolhaTop` (o assistente) e a `perfilDaFamiliaTop` (as abas e as exigências do tipo).
 */
export const catalogoDoEditor = (e: EstadoCapacidadesTop): CatalogoTop | null => formato5DoEditor(e)?.catalogo ?? null;

/** Quantos destinos esta API aceita. Zero quando ela não os suporta — e zero bloqueia a inclusão. */
/** A caixa "Em partes" aparece e `emPartes` vai no corpo? Só quando a API declara `destinos.emPartes === 1`. */
export const podeConfigurarEmPartes = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurarDestinos(e) && e.situacao === "pronto" && e.capacidades.destinos.emPartes;

/**
 * TOP-CONFIG-07 — a caixa "Reservar estoque ao salvar o pedido" aparece e `reservaEstoque` vai no corpo? Só com o
 * contrato confirmado E a capacidade declarada. A FAMÍLIA (só pedido) é a outra metade, decidida por quem desenha.
 */
export const podeConfigurarReservaEstoque = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurar(e) && e.capacidades.reservaEstoque;

/**
 * OPERACOES-01 F9 (decisão 286) — os campos dos PADRÕES FINANCEIROS (natureza, centro, tipo de título, forma e conta, na
 * tabela da versão) aparecem e `padroesFinanceiros` vai no corpo? Só com o editor do FORMATO 5 (os padrões só valem
 * numa versão no 5, e o servidor recusa o resto) E a capacidade declarada. A FAMÍLIA (o perfil dos padrões) é a outra
 * metade, decidida por quem desenha. A seção do JSON (`financeiroPadrao`: provisão, troca, sem classificação) não
 * depende disto: ela anda com o conjunto de seções do `formato5`.
 */
export const podeConfigurarPadroesFinanceiros = (e: EstadoCapacidadesTop): boolean =>
  podeConfigurarFormato5(e) && podeConfigurar(e) && e.capacidades.padroesFinanceiros;

export const limiteDeDestinos = (e: EstadoCapacidadesTop): number =>
  podeConfigurar(e) ? e.capacidades.destinos.limite : 0;

/** O que o servidor declara sobre execução. Fora de `pronto`, nada é executável — fail-closed. */
export const capacidadesDeExecucao = (e: EstadoCapacidadesTop): CapacidadesExecucaoTop =>
  podeConfigurar(e) ? e.capacidades.execucao : SEM_EXECUCAO;

/**
 * Mensagem única por estado. Quem lê precisa saber se o problema é o servidor, o contrato ou a permissão —
 * e, acima de tudo, precisa saber que a configuração NÃO foi salva.
 */
export function MensagemCapacidadesTop({ estado }: { estado: EstadoCapacidadesTop }) {
  if (estado.situacao === "nao-confirmado") {
    return <p data-testid="top-config-nao-confirmada" className="text-[12px] text-amber-700">
      Este servidor não confirmou o recurso de configuração dos tipos de operação. As seções de operação
      ficam bloqueadas para não gravar uma configuração que seria descartada sem aviso. O cadastro de
      identificação continua disponível. Tente novamente em alguns instantes.
    </p>;
  }
  if (estado.situacao === "schema-divergente") {
    return <p data-testid="top-config-schema-divergente" className="text-[12px] text-amber-700">
      Este servidor guarda a configuração em um formato mais recente do que esta tela sabe escrever
      (formato {estado.versaoSchema}). As seções de operação ficam bloqueadas para não sobrescrever a
      regra existente. Atualize a página; se continuar, procure o responsável pela atualização do sistema.
    </p>;
  }
  if (estado.situacao === "erro") {
    return <p data-testid="top-config-erro" className="text-[12px] text-red-700">{estado.mensagem}</p>;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// 2. O DETALHE DA TOP
// ---------------------------------------------------------------------------------------------------

/**
 * A configuração como o servidor a entrega: ou legível, ou declaradamente não legível.
 *
 * `suportada: false` é ESTADO, não erro. Uma versão gravada num schema futuro continua existindo e
 * continua tendo de aparecer no histórico — com a verdade ("não sabemos ler isto") em vez de valores
 * inventados a partir do neutro, que seriam indistinguíveis de uma configuração real.
 */
export type ConfiguracaoDoServidor =
  | { suportada: true; versaoSchema: number; valor: ConfiguracaoTipoOperacao }
  | { suportada: false; versaoSchema: number };

export function lerConfiguracaoDoServidor(bruto: unknown): ConfiguracaoDoServidor | null {
  if (!ehObjeto(bruto)) return null;
  if (!ehInteiroPositivo(bruto.versaoSchema)) return null;
  if (bruto.suportada === false) return { suportada: false, versaoSchema: bruto.versaoSchema };
  if (bruto.suportada !== true) return null;
  // O `valor` passa pelo LEITOR DO DOMÍNIO, não por asserção: é o mesmo código que a API usa, então a tela
  // nunca aceita uma forma que o servidor recusaria — e nunca mostra campo que não existe no contrato.
  const r = lerConfiguracaoTop(bruto.valor);
  // O formato que o valor DIZ ter e o que o servidor declarou ao lado dele têm de ser o mesmo.
  if (!r.ok || r.valor.versaoSchema !== bruto.versaoSchema) return { suportada: false, versaoSchema: bruto.versaoSchema };
  return { suportada: true, versaoSchema: bruto.versaoSchema, valor: r.valor };
}

/** Uma aresta origem → destino como o servidor a entrega no detalhe. */
export interface DestinoConfigurado {
  tipoOperacaoId: string;
  ordem: number;
  codigo: string;
  nome: string;
  codigoBase: string;
  familiaRotulo: string;
  ativo: boolean;
  /** O destino serve HOJE? Avaliado pelo servidor no estado atual, nunca congelado. */
  disponivel: boolean;
  /** TOP-CONFIG-06: conversão em partes. Ausente numa API anterior (lida como `false`). */
  emPartes?: boolean;
}

const ehDestinoConfigurado = (v: unknown): v is DestinoConfigurado =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && typeof v.ordem === "number" && Number.isInteger(v.ordem)
  && ehTexto(v.codigo) && ehTexto(v.nome) && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo)
  && typeof v.ativo === "boolean" && typeof v.disponivel === "boolean"
  && (v.emPartes === undefined || typeof v.emPartes === "boolean");

/**
 * Lê a lista de destinos. `null` = a API não entregou a lista nesta forma (bloqueia a aba).
 *
 * Item inválido NÃO é filtrado: esconder do administrador uma aresta que o servidor declarou seria o mesmo
 * descarte silencioso que esta tela existe para impedir, só que do lado de cá. A lista inteira NEGA.
 */
export function lerDestinosConfigurados(bruto: unknown): DestinoConfigurado[] | null {
  if (!Array.isArray(bruto) || !bruto.every(ehDestinoConfigurado)) return null;
  return [...(bruto as DestinoConfigurado[])].sort((a, b) => a.ordem - b.ordem);
}

/** O detalhe da TOP, já conferido. `configuracao`/`destinos` podem faltar numa API anterior. */
export interface DetalheTop {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  familia: { codigo: string; rotulo: string; modulo: string | null };
  ativo: boolean;
  padrao: boolean;
  versao: number;
  revisao: number;
  configuracao: ConfiguracaoDoServidor | null;
  destinos: DestinoConfigurado[] | null;
  /**
   * A POLÍTICA DE PRÓXIMAS OPERAÇÕES JÁ FOI DECLARADA NESTA VERSÃO?
   *
   * TRÊS valores, porque são três situações e nenhuma responde pela outra:
   *   `true`   declarada. A lista de destinos É a política — inclusive quando está vazia.
   *   `false`  nunca declarada. Estado legado: a conversão segue a cadeia anterior.
   *   `null`   o servidor não informou (API anterior a esta correção). NÃO é `false`: afirmar "ninguém
   *            declarou" por causa de um campo ausente é exatamente o erro que esta coluna veio corrigir.
   *
   * `destinos.length` NÃO responde isto. Zero destinos é o mesmo número nos dois primeiros casos, e a
   * diferença entre eles decide se um documento converte ou não.
   */
  destinosConfigurados: boolean | null;
  /**
   * As condições de pagamento permitidas da versão atual (TOP-CONFIG-05). Vazia = sem restrição (todas).
   * `null` = o servidor não entregou a lista (API anterior) — NÃO é "vazia": a tela não a reescreve.
   */
  condicoesPermitidas: CondicaoPermitidaEmEdicao[] | null;
  /**
   * TOP-CONFIG-07 — a versão atual reserva estoque? `null` = o servidor não informou (API anterior, ou valor que
   * não é booleano). NÃO é `false`: a tela não oferece a caixa sobre um valor que não leu, e o corpo omite a
   * chave — que o servidor lê como "preserve o que está gravado".
   */
  reservaEstoque: boolean | null;
  /**
   * OPERACOES-01 F9 (decisão 286) — os PADRÕES FINANCEIROS da versão atual (a tabela da versão). TRÊS valores, a régua
   * de `destinosConfigurados`:
   *   objeto           os padrões lidos (campo `null` = sem padrão naquele campo);
   *   `null`           o servidor informou que a versão NÃO tem padrão — o editor começa vazio;
   *   `"nao_informado"` a chave veio AUSENTE (API anterior): NÃO é "vazio" — os campos ficam bloqueados e a chave não vai
   *                    no corpo (ausente = o servidor preserva o que está gravado).
   * Presente e malformado NEGA o corpo inteiro (régua das condições): mostrar vazio um padrão que o servidor declarou
   * seria o descarte silencioso do lado de cá.
   */
  padroesFinanceiros: PadroesFinanceirosEmEdicao | null | "nao_informado";
}

const ehCondicaoPermitida = (v: unknown): v is CondicaoPermitidaEmEdicao =>
  ehObjeto(v) && ehTexto(v.id) && ehTexto(v.codigo) && ehTexto(v.nome);

/**
 * Um PADRÃO FINANCEIRO em edição: o id do cadastro e o texto que a tela mostra dele (o que o servidor devolveu — o
 * seletor ainda mostra o caminho da árvore quando o cadastro tem um).
 */
export interface PadraoFinanceiroEmEdicao { id: string; rotulo: string }

/** Os cinco padrões financeiros da versão em edição. `null` num campo = sem padrão (o documento decide). */
export interface PadroesFinanceirosEmEdicao {
  natureza: PadraoFinanceiroEmEdicao | null;
  centro: PadraoFinanceiroEmEdicao | null;
  tipoTitulo: PadraoFinanceiroEmEdicao | null;
  formaPagamento: PadraoFinanceiroEmEdicao | null;
  conta: PadraoFinanceiroEmEdicao | null;
}
export type CampoDosPadroesEmEdicao = keyof PadroesFinanceirosEmEdicao;

/** Nenhum padrão: a versão sem linha, o cadastro novo. Objeto novo a cada chamada. */
export const padroesFinanceirosVaziosEmEdicao = (): PadroesFinanceirosEmEdicao =>
  ({ natureza: null, centro: null, tipoTitulo: null, formaPagamento: null, conta: null });

/**
 * A chave de cada campo no CORPO (`padroesFinanceiros.<chave>`, a mesma do caminho das recusas do servidor), na ordem
 * do servidor. Um dono para a correspondência campo da tela ↔ chave do fio.
 */
export const CHAVE_DO_PADRAO_NO_CORPO: Readonly<Record<CampoDosPadroesEmEdicao, string>> = {
  natureza: "naturezaId",
  centro: "centroCustoId",
  tipoTitulo: "tipoTituloId",
  formaPagamento: "formaPagamentoId",
  conta: "contaBancariaId"
};

/** "código — nome" (o formato das condições do histórico); sem código, só o nome. */
const comCodigo = (codigo: string, nome: string) => (codigo ? `${codigo} — ${nome}` : nome);

/**
 * Lê UM padrão do detalhe: `null`, ou o objeto do cadastro com as chaves de texto daquele campo (natureza e centro: id,
 * código e nome; tipo de título e forma: id e nome; conta: id, código e descrição). `undefined` = malformado.
 */
function lerUmPadrao(v: unknown, campo: CampoDosPadroesEmEdicao): PadraoFinanceiroEmEdicao | null | undefined {
  if (v === null) return null;
  if (!ehObjeto(v) || !ehTexto(v.id)) return undefined;
  switch (campo) {
    case "natureza":
    case "centro":
      return ehTexto(v.codigo) && ehTexto(v.nome) ? { id: v.id, rotulo: comCodigo(v.codigo, v.nome) } : undefined;
    case "tipoTitulo":
    case "formaPagamento":
      return ehTexto(v.nome) ? { id: v.id, rotulo: v.nome } : undefined;
    case "conta":
      return ehTexto(v.codigo) && ehTexto(v.descricao) ? { id: v.id, rotulo: comCodigo(v.codigo, v.descricao) } : undefined;
  }
}

/**
 * Lê os padrões financeiros que o servidor devolveu (detalhe e histórico). `null` = a versão não tem padrão; objeto =
 * os cinco campos, CADA UM presente (`null` ou o cadastro); `undefined` = malformado (quem chama decide: o detalhe nega
 * o corpo inteiro, o histórico degrada só a linha).
 */
export function lerPadroesFinanceirosDoServidor(bruto: unknown): PadroesFinanceirosEmEdicao | null | undefined {
  if (bruto === null) return null;
  if (!ehObjeto(bruto)) return undefined;
  const lidos = padroesFinanceirosVaziosEmEdicao();
  for (const campo of Object.keys(CHAVE_DO_PADRAO_NO_CORPO) as CampoDosPadroesEmEdicao[]) {
    // Campo AUSENTE é malformação (o contrato tem os cinco, `null` inclusive): ausente não é "sem padrão".
    if (!(campo in bruto)) return undefined;
    const um = lerUmPadrao(bruto[campo], campo);
    if (um === undefined) return undefined;
    lidos[campo] = um;
  }
  return lidos;
}

/**
 * Os padrões do rascunho NO FORMATO DO CORPO (`{ naturezaId, centroCustoId, tipoTituloId, formaPagamentoId,
 * contaBancariaId }`, `null` no campo vazio — as cinco chaves sempre: presença é declaração, e o servidor lê a chave
 * ausente como `null`).
 */
export function padroesFinanceirosParaEnvio(p: PadroesFinanceirosEmEdicao): Record<string, string | null> {
  return Object.fromEntries((Object.keys(CHAVE_DO_PADRAO_NO_CORPO) as CampoDosPadroesEmEdicao[])
    .map((campo) => [CHAVE_DO_PADRAO_NO_CORPO[campo], p[campo]?.id ?? null]));
}

export function lerDetalheTop(bruto: unknown): DetalheTop | null {
  if (!ehObjeto(bruto)) return null;
  const f = bruto.familia;
  if (!ehTexto(bruto.id) || !ehTexto(bruto.codigo) || !ehTexto(bruto.nome)) return null;
  if (!ehObjeto(f) || !ehTexto(f.codigo) || !ehTexto(f.rotulo)) return null;
  if (typeof bruto.ativo !== "boolean" || typeof bruto.padrao !== "boolean") return null;
  if (!ehInteiroPositivo(bruto.versao) || typeof bruto.revisao !== "number") return null;
  // AUSENTE é tolerado (API anterior) e vira `null`; PRESENTE com outro tipo é contrato desconhecido e
  // NEGA o corpo inteiro — a mesma régua do bloco `destinos` das capacidades.
  if (bruto.destinosConfigurados !== undefined && typeof bruto.destinosConfigurados !== "boolean") return null;
  // Mesma régua: ausente = `null` (API anterior); presente com item malformado NEGA o corpo inteiro —
  // esconder uma condição que o servidor declarou seria descarte silencioso do lado de cá.
  if (bruto.condicoesPermitidas !== undefined
    && (!Array.isArray(bruto.condicoesPermitidas) || !bruto.condicoesPermitidas.every(ehCondicaoPermitida))) return null;
  // OPERACOES-01 F9: a mesma régua — ausente = "nao_informado" (API anterior); presente e malformado NEGA o corpo inteiro.
  let padroesFinanceiros: DetalheTop["padroesFinanceiros"] = "nao_informado";
  if (bruto.padroesFinanceiros !== undefined) {
    const lidos = lerPadroesFinanceirosDoServidor(bruto.padroesFinanceiros);
    if (lidos === undefined) return null;
    padroesFinanceiros = lidos;
  }
  return {
    id: bruto.id,
    codigo: bruto.codigo,
    nome: bruto.nome,
    descricao: ehTexto(bruto.descricao) ? bruto.descricao : null,
    familia: { codigo: f.codigo, rotulo: f.rotulo, modulo: ehTexto(f.modulo) ? f.modulo : null },
    ativo: bruto.ativo,
    padrao: bruto.padrao,
    versao: bruto.versao,
    revisao: bruto.revisao,
    configuracao: bruto.configuracao === undefined ? null : lerConfiguracaoDoServidor(bruto.configuracao),
    destinos: bruto.destinos === undefined ? null : lerDestinosConfigurados(bruto.destinos),
    destinosConfigurados: bruto.destinosConfigurados === undefined ? null : bruto.destinosConfigurados,
    condicoesPermitidas: bruto.condicoesPermitidas === undefined
      ? null
      : (bruto.condicoesPermitidas as CondicaoPermitidaEmEdicao[]).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome })),
    // Degrada SOZINHO (a reserva é uma coluna da versão, não a configuração): forma estranha vira "não informado"
    // e só a caixa fica bloqueada — o resto do editor, que foi lido, continua editável.
    reservaEstoque: typeof bruto.reservaEstoque === "boolean" ? bruto.reservaEstoque : null,
    padroesFinanceiros
  };
}

/** Uma TOP oferecida como destino possível. A lista é MONTADA PELO SERVIDOR — nunca filtrada aqui. */
export interface DestinoPossivel {
  id: string;
  codigo: string;
  nome: string;
  codigoBase: string;
  familiaRotulo: string;
}

const ehDestinoPossivel = (v: unknown): v is DestinoPossivel =>
  ehObjeto(v) && ehTexto(v.id) && ehTexto(v.codigo) && ehTexto(v.nome)
  && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo);

/**
 * Os destinos que o produto admite para esta origem.
 *
 * A COMPATIBILIDADE É DECIDIDA NO SERVIDOR (tenant, exclusão, situação e família de destino). Montar esta
 * lista no cliente exigiria uma segunda cópia das regras do grafo, que envelheceria em silêncio na primeira
 * família nova — e, pior, uma tela que decide o que é compatível vira autoridade de coisa que não é dela.
 */
export function useDestinosPossiveis(codigoBase: string, habilitado: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", "destinos-possiveis", codigoBase],
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao/destinos-possiveis?codigoBase=${encodeURIComponent(codigoBase)}`),
    enabled: habilitado && codigoBase.length > 0,
    retry: false
  });
  const itens = React.useMemo(() => {
    const d = q.data;
    if (!ehObjeto(d) || !Array.isArray(d.items) || !d.items.every(ehDestinoPossivel)) return null;
    return d.items as DestinoPossivel[];
  }, [q.data]);
  return { itens, carregando: q.isPending && habilitado, erro: q.error ?? null };
}

// ---------------------------------------------------------------------------------------------------
// 3. RÓTULOS
// ---------------------------------------------------------------------------------------------------

/**
 * RÓTULOS DOS ENUMS DA CONFIGURAÇÃO — DÍVIDA DECLARADA, A SER MOVIDA PARA O DOMÍNIO.
 *
 * O dono de rótulo de enum é `packages/domain/src/labels.ts` (`ENUM_LABELS` / `enumLabel`), e nenhuma
 * destas chaves existe lá hoje. Criar um segundo registry de rótulos no web seria a segunda lista que o
 * contrato proíbe — ela não fica desatualizada com barulho, envelhece em silêncio. Então isto aqui é
 * EXPLICITAMENTE PROVISÓRIO: o destino é `ENUM_LABELS` (domínios `top_confirmacao`, `top_alteracao`,
 * `top_documento_sem_itens`, `top_estoque_atualizacao`, `top_financeiro_atualizacao`, `top_financeiro_modo`,
 * `top_momento_efeito`, `top_saldo_negativo`, `top_calculo_tributario`, `top_aprovacao_politica`,
 * `top_momento_aprovacao`), e esta constante sai daqui na mesma fatia que os criar.
 *
 * Os VALORES continuam vindo do domínio (as listas `MODOS_CONFIRMACAO` e companhia): o que está duplicado é
 * só a tradução, nunca o conjunto de opções.
 */
export const ROTULOS_TOP = {
  confirmacao: { manual: "Manual", automatica: "Automática" } satisfies Record<ModoConfirmacao, string>,
  alteracao: { bloqueada: "Bloqueada", permitida: "Permitida" } satisfies Record<PoliticaAlteracao, string>,
  documentoSemItens: { proibido: "Proibido", permitido: "Permitido" } satisfies Record<PoliticaDocumentoSemItens, string>,
  estoqueAtualizacao: {
    nenhuma: "Não movimenta estoque",
    entrada: "Entrada",
    saida: "Saída",
    transferencia: "Transferência"
  } satisfies Record<AtualizacaoEstoque, string>,
  financeiroAtualizacao: {
    nenhuma: "Não gera efeito financeiro",
    receber: "A receber",
    pagar: "A pagar"
  } satisfies Record<AtualizacaoFinanceiro, string>,
  financeiroModo: { incluir: "Título firme", provisionar: "Previsão" } satisfies Record<ModoFinanceiro, string>,
  momentoEfeito: { confirmacao: "Na confirmação do documento" } satisfies Record<MomentoEfeito, string>,
  saldoNegativo: { bloquear: "Bloquear", permitir: "Permitir" } satisfies Record<PoliticaSaldoNegativo, string>,
  calculoTributario: { nao_aplicar: "Não aplicar", preparado: "Preparado" } satisfies Record<CalculoTributario, string>,
  aprovacaoPolitica: {
    nenhuma: "Sem aprovação",
    sempre: "Sempre",
    por_valor: "A partir de um valor"
  } satisfies Record<PoliticaAprovacao, string>,
  momentoAprovacao: { antes_da_confirmacao: "Antes da confirmação" } satisfies Record<MomentoAprovacao, string>,
  // TOP-CONFIG-05 — mesma dívida, mesmo destino (`ENUM_LABELS`, domínio `top_cliente_em_atraso`).
  clienteEmAtraso: { nao_valida: "Não valida", avisa: "Avisa", bloqueia: "Bloqueia" } satisfies Record<PoliticaClienteEmAtraso, string>
} as const;

/**
 * Rótulo de seção para o resumo do histórico. OPERACOES-01 F4: a dívida desta linha está paga — o dono é o domínio
 * (`ROTULOS_SECAO_CONFIGURACAO_TOP`, com as seções de extensão do formato 5, cada uma com o rótulo da sua definição).
 * O nome exportado fica, para quem já o lê.
 */
export const ROTULOS_SECAO_TOP: Readonly<Record<SecaoConfiguracaoTopV5, string>> = ROTULOS_SECAO_CONFIGURACAO_TOP;

// ---------------------------------------------------------------------------------------------------
// 4. O RASCUNHO EM EDIÇÃO
// ---------------------------------------------------------------------------------------------------

/** Uma aresta enquanto está sendo editada: identidade + a ordem que o usuário arrumou. */
export interface DestinoEmEdicao {
  tipoOperacaoId: string;
  codigo: string;
  nome: string;
  familiaRotulo: string;
  /** O destino continua servindo? Só o servidor sabe; `undefined` num destino recém-escolhido. */
  disponivel?: boolean;
  /** TOP-CONFIG-06: o documento pode ser convertido várias vezes para este destino. */
  emPartes: boolean;
}

/** Tudo o que o editor mantém em memória. Comparar este objeto inteiro é o que detecta alteração pendente. */
export interface RascunhoTop {
  nome: string;
  descricao: string;
  ativo: boolean;
  padrao: boolean;
  codigo: string;
  codigoBase: string;
  /**
   * SEMPRE NO FORMATO 2 NO EDITOR. Uma versão gravada no formato 1 é LIDA como formato 2 com os dois
   * efeitos em `legado` — que é exatamente o que ela significa — e por isso abrir e salvar sem mexer não
   * cria versão (o servidor compara os dois formatos pelo significado). Ler não regrava nada.
   */
  configuracao: ConfiguracaoTipoOperacaoV2;
  /**
   * TOP-CONFIG-05 — o rascunho no FORMATO 3, presente SÓ quando o servidor declara restrições
   * (`podeConfigurarRestricoes`) e NÃO declara as regras gerais (com elas, quem existe é `configuracaoV4`).
   * Ausente = editor de hoje: `configuracao` (formato 2) é a única verdade e nenhuma chave nova existe na tela
   * nem no fio. Presente, ele é a verdade da configuração e `configuracao` não é usada para o envio.
   */
  configuracaoV3?: ConfiguracaoTipoOperacaoV3;
  /**
   * TOP-CONFIG-08 — o rascunho no FORMATO 4, presente SÓ quando o servidor declara as regras gerais
   * (`podeConfigurarRegrasGerais`). Presente, ele é a verdade da configuração: `configuracaoV3` fica AUSENTE (uma
   * verdade só — dois rascunhos com as mesmas chaves divergiriam na primeira edição) e `configuracao` (formato 2) é
   * só a vista derivada dele, para os campos de hoje (`aplicarNoFormato3` preserva o 4). Ausente = o editor de hoje,
   * com ou sem o formato 3: nenhuma regra geral executada na tela nem no fio.
   */
  configuracaoV4?: ConfiguracaoTipoOperacaoV4;
  /**
   * OPERACOES-01 F4 — o rascunho no FORMATO 5, presente SÓ com o editor do 5 (`podeConfigurarFormato5`). Presente, ele
   * é A verdade da configuração: `configuracaoV4` e `configuracaoV3` ficam AUSENTES (uma verdade só) e `configuracao`
   * (formato 2) é só a vista derivada dele, para os campos de hoje (`aplicarNoFormato3` preserva o 5 e as seções de
   * extensão). A versão vigente no 1 a 4 é LIDA como 5 com os padrões de hoje (`configuracaoInicialV5`); ler não
   * regrava — só uma gravação que mude algo cria a versão nova no 5.
   */
  configuracaoV5?: ConfiguracaoTipoOperacaoV5;
  /** As condições permitidas em edição (só com restrições). Vazia = todas as condições. */
  condicoesPermitidas?: CondicaoPermitidaEmEdicao[];
  /**
   * ESTA EDIÇÃO DECLARA A LISTA DE CONDIÇÕES? Decide se `condicoesPermitidas` VAI NO CORPO (o contrato do
   * servidor é a PRESENÇA DA CHAVE: ausente = preservar; presente, mesmo vazia = declarar).
   *
   * RÉGUA ESCOLHIDA: nasce SEMPRE `false` e vira `true` só quando o usuário MEXE na lista (incluir ou
   * remover). Lista intocada = chave ausente = o servidor preserva (e copia para a versão nova). Por que não
   * "reenviar sempre a lista lida": uma condição permitida que foi inativada DEPOIS voltaria no corpo e o
   * servidor recusaria (422, "inexistente ou inativa") uma gravação que só trocou o nome. No cadastro novo,
   * POST sem a chave = sem lista, o mesmo que `[]`. Se o detalhe NÃO trouxe a lista (API anterior), ela fica
   * bloqueada na tela: reescrever o que não foi lido apagaria condições que ninguém viu.
   */
  condicoesDeclaradas?: boolean;
  destinos: DestinoEmEdicao[];
  /**
   * ESTA EDIÇÃO DECLARA A POLÍTICA DE PRÓXIMAS OPERAÇÕES?
   *
   * É o que decide se `destinos` VAI NO CORPO da gravação. O contrato do servidor é a PRESENÇA DA CHAVE:
   * ausente = preservar o que já estava (arestas e estado); presente, mesmo como lista vazia = declarar.
   *
   * Nasce `true` quando a versão carregada já declarava — aí toda gravação re-declara o que já vale, e o
   * administrador não perde a política por editar o nome. Nasce `false` no cadastro novo e no registro
   * legado: enquanto o usuário não adicionar um destino nem declarar explicitamente que não há próxima
   * operação, o silêncio dele continua sendo silêncio, e não uma decisão que ninguém tomou.
   */
  destinosDeclarados: boolean;
  /**
   * TOP-CONFIG-07 — "Reservar estoque ao salvar o pedido" (coluna da versão, fora da configuração).
   *
   * AUSENTE quando a versão carregada não informou o valor (`DetalheTop.reservaEstoque === null`): a caixa fica
   * bloqueada e a chave não vai no corpo (ausente = o servidor preserva). No cadastro novo nasce `false`. Quem
   * decide se ela É ENVIADA é a gravação: capacidade declarada E família do pedido — nunca só este valor.
   */
  reservaEstoque?: boolean;
  /**
   * OPERACOES-01 F9 (decisão 286) — os PADRÕES FINANCEIROS em edição (a tabela da versão, fora da configuração).
   * AUSENTE quando o detalhe não os informou (`DetalheTop.padroesFinanceiros === "nao_informado"`): os campos ficam
   * bloqueados e a chave não vai no corpo. No cadastro novo e na versão sem padrão, os cinco vazios.
   */
  padroesFinanceiros?: PadroesFinanceirosEmEdicao;
  /**
   * ESTA EDIÇÃO DECLARA OS PADRÕES? A régua das condições (`condicoesDeclaradas`): nasce `false` e vira `true` só
   * quando o usuário MEXE num padrão. Intocados = chave ausente = o servidor preserva (e copia para a versão nova). Por
   * que não "reenviar sempre os lidos": um cadastro inativado DEPOIS voltaria no corpo e o servidor recusaria (422)
   * uma gravação que só trocou o nome. No cadastro novo, POST sem a chave = sem padrão, o mesmo que os cinco vazios.
   */
  padroesDeclarados?: boolean;
}

/**
 * OPERACOES-01 F9 — os padrões do rascunho a partir do detalhe: os lidos; os cinco vazios na versão sem padrão e no
 * cadastro novo (`detalhe` nulo); AUSENTES quando o servidor não os informou (API anterior — nada é reescrito).
 */
export function padroesFinanceirosIniciais(detalhe: DetalheTop | null): Pick<RascunhoTop, "padroesFinanceiros" | "padroesDeclarados"> {
  const lidos = detalhe ? detalhe.padroesFinanceiros : null;
  if (lidos === "nao_informado") return { padroesDeclarados: false };
  return { padroesFinanceiros: lidos ?? padroesFinanceirosVaziosEmEdicao(), padroesDeclarados: false };
}

/**
 * A configuração inicial do editor.
 *
 * NEUTRO quando o servidor não entregou configuração legível — e isso NÃO é "inventar valores": o neutro é
 * o que o próprio domínio define como "nada declarado", e o editor nesse caso está desabilitado ou criando
 * um registro novo. O que jamais acontece é mostrar o neutro dizendo que ele é a configuração salva de uma
 * versão que não sabemos ler; essa distinção é feita por quem chama, pelo estado `suportada: false`.
 */
export function configuracaoInicial(c: ConfiguracaoDoServidor | null): ConfiguracaoTipoOperacaoV2 {
  return c && c.suportada ? configuracaoTopParaEdicao(c.valor) : configuracaoNeutraTopV2();
}

/**
 * A configuração inicial do editor COM restrições e SEM as regras gerais: formato 3 (v1/v2 promovidos com as chaves
 * novas no neutro; o 3 como está).
 *
 * ┌─ UM FORMATO 4 AQUI É FORMATO DESCONHECIDO PARA ESTE EDITOR (TOP-CONFIG-08) ─────────────────────────┐
 * │ Este editor só existe quando o servidor NÃO declarou o bloco `regrasGerais` legível no formato 4.   │
 * │ Uma versão vigente no formato 4 diante dele quer dizer que o servidor é mais novo que a tela (ou    │
 * │ declarou um bloco que ela não lê), e vale a MESMA régua de hoje para formato desconhecido: o neutro │
 * │ aqui, e as seções de operação BLOQUEADAS por quem chama (`configuracaoIlegivelNoEditor`). Devolver  │
 * │ o 4 como 3 faria a gravação seguinte rebaixar a versão (o servidor recusa o retrocesso, mas a tela  │
 * │ teria oferecido a edição); devolver o 4 como 4 poria um formato 4 nas mãos de um editor cujos       │
 * │ textos dizem que as regras gerais NÃO executam — e no 4 elas executam. Ler não regrava nada: a      │
 * │ versão continua 4 no banco, e o 4 é editado por inteiro onde ele existe (`configuracaoInicialV4`).  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export function configuracaoInicialV3(c: ConfiguracaoDoServidor | null): ConfiguracaoTipoOperacaoV3 {
  if (!c || !c.suportada) return configuracaoNeutraTopV3();
  const v = configuracaoTopParaEdicaoV3(c.valor);
  return v.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V3 ? v : configuracaoNeutraTopV3();
}

/**
 * TOP-CONFIG-08 — a configuração inicial do editor COM as regras gerais: formato 4. O 1/2 passa pela vista do 3 de
 * hoje (chaves novas no neutro), o 3 vira 4 com as MESMAS chaves e os mesmos valores, o 4 sai como está — tudo pelo
 * domínio (`configuracaoTopParaEdicaoV4`). NÃO aplica a matriz da família: uma regra que a família não aceita (o
 * pedido de compra de produção, formato 3 com Automática) chega ao editor como foi gravada, e quem a volta ao padrão,
 * avisando antes, é a gravação (`normalizarRegrasGeraisDaFamiliaTop` + o diálogo "Estas regras passam a valer").
 * Neutro do formato 4 sem configuração legível — a mesma régua de `configuracaoInicial`.
 *
 * OPERACOES-01 F4: UM FORMATO 5 AQUI É FORMATO DESCONHECIDO PARA ESTE EDITOR — a mesma régua do 4 diante do editor do
 * 3 (quadro de `configuracaoInicialV3`). Este editor só existe sem o editor do 5 (`podeConfigurarFormato5` falso); a
 * vista do 4 de um 5 (`configuracaoTopParaEdicaoV4`) perderia as seções de extensão, e a gravação seguinte as levaria
 * ao padrão em silêncio (o servidor recusa o 4 sobre o 5, mas a tela teria oferecido a edição). Então: o neutro do 4
 * aqui, NUNCA o 5 rebaixado, e as seções de operação BLOQUEADAS por quem chama (`configuracaoIlegivelNoEditor`).
 */
export function configuracaoInicialV4(c: ConfiguracaoDoServidor | null): ConfiguracaoTipoOperacaoV4 {
  if (!c || !c.suportada || formato5Top(c.valor)) return configuracaoNeutraTopV4();
  return configuracaoTopParaEdicaoV4(c.valor);
}

/**
 * OPERACOES-01 F4 — a configuração inicial do editor do FORMATO 5. As TOPs gravadas nos formatos 1 a 4 são LIDAS como
 * 5 com os padrões de hoje, pelo domínio (`configuracaoTopParaEdicaoV5`: a vista do 4 de hoje e daí ao 5, com as
 * seções de extensão no neutro); o 5 sai como está, normalizado. NÃO aplica a matriz da família nem o perfil do tipo:
 * o que o tipo não aceita chega ao editor como foi gravado, e quem o volta ao padrão, avisando antes, é a gravação
 * (`normalizarRegrasGeraisDaFamiliaTop` + `normalizarPeloPerfilTop` + o diálogo "Estas regras passam a valer").
 * Neutro do formato 5 sem configuração legível — a mesma régua de `configuracaoInicial`. Ler não regrava nada.
 */
export function configuracaoInicialV5(c: ConfiguracaoDoServidor | null): ConfiguracaoTipoOperacaoV5 {
  return c && c.suportada ? configuracaoTopParaEdicaoV5(c.valor) : configuracaoNeutraTopV5();
}

/**
 * A VERSÃO VIGENTE PODE SER EDITADA POR ESTE EDITOR, COM ESTAS CAPACIDADES? `true` = não pode, e as seções de
 * operação ficam bloqueadas com a frase de formato desconhecido (`top-config-ilegivel`). Três causas, a mesma régua:
 *   · o servidor declarou que não sabe ler a versão (`suportada: false`) — o caso de hoje, intocado;
 *   · TOP-CONFIG-08: a versão está no formato 4 (ou 5) e o editor não é o do formato 4 (`podeConfigurarRegrasGerais`
 *     falso). Ver o quadro de `configuracaoInicialV3`;
 *   · OPERACOES-01 F4: a versão está no formato 5 e o editor não é o do formato 5 (`podeConfigurarFormato5` falso).
 *     Ver `configuracaoInicialV4`.
 * Sem configuração (`null`, API anterior à configuração) não há o que bloquear. Com uma API anterior a esta fatia
 * nenhuma versão chega legível no formato 5, então a resposta é exatamente a de hoje.
 */
export const configuracaoIlegivelNoEditor = (c: ConfiguracaoDoServidor | null, e: EstadoCapacidadesTop): boolean =>
  c !== null && (!c.suportada || (regrasGeraisExecutamTop(c.valor) && !podeConfigurarRegrasGerais(e))
    || (formato5Top(c.valor) && !podeConfigurarFormato5(e)));

/**
 * A configuração no formato que ESTE servidor grava — ou `null` quando não há como enviá-la sem mudar o
 * que ela significa.
 *
 * Servidor com execução configurada: vai o formato 2, como está. Servidor anterior (sem o bloco de
 * execução nas capacidades): ele só conhece o formato 1, e o formato 1 SIGNIFICA "os dois efeitos no
 * legado" — então o rascunho vai no formato 1 apenas se é isso que ele diz. Um rascunho com efeito
 * configurado não tem tradução honesta para esse servidor, e a gravação é bloqueada em vez de perder a
 * decisão em silêncio.
 */
export function configuracaoParaEnvio(c: ConfiguracaoTipoOperacaoV2, execucaoSuportada: boolean): ConfiguracaoTipoOperacao | null {
  if (execucaoSuportada) return c;
  const e = execucaoDeclaradaTop(c);
  if (e.estoque !== "legado" || e.financeiro !== "legado") return null;
  const { execucao: _execucao, versaoSchema: _versao, ...secoes } = c;
  const v1: ConfiguracaoTipoOperacaoV1 = { versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP, ...secoes };
  return v1;
}

/**
 * Aplica uma mudança escrita para o FORMATO 2 (as seções de hoje) sobre o rascunho no FORMATO 3, 4 ou 5, sem perder
 * as chaves novas. É o que deixa os campos de hoje funcionarem iguais nos três editores: eles continuam
 * mexendo na vista formato 2, e as chaves novas do formato 3 são reaplicadas por cima. A normalização do
 * domínio vem depois, em quem chama.
 *
 * O FORMATO QUE ENTRA É O FORMATO QUE SAI (TOP-CONFIG-08): 3 → 3, 4 → 4. O nome ficou ("no formato 3" = com as
 * chaves do 3, que o 4 também tem), mas o número não é mais fixado aqui: fixar o 3 rebaixaria o rascunho do formato
 * 4 a cada edição de campo, e a gravação sairia no 3 — que nunca executa as regras gerais. Por isso `versaoSchema` é
 * a ÚNICA chave que vem de `c` por inteiro; todas as seções vêm da vista editada, com as chaves do 3 reaplicadas.
 * OPERACOES-01 F4: 5 → 5, e as SEÇÕES DE EXTENSÃO do 5 também vêm de `c` como estão (`...c`): a vista do 2 não as tem,
 * e nenhuma mudança escrita para o 2 mexe nelas — quem as edita é a aba da seção (`SecaoDoFormato5`).
 */
export function aplicarNoFormato3<C extends ConfiguracaoComRestricoesTop>(
  c: C,
  f: (c: ConfiguracaoTipoOperacaoV2) => ConfiguracaoTipoOperacaoV2
): C {
  const { versaoSchema: _formato2, ...novo } = f(configuracaoTopParaEdicao(c));
  const { exigeTransportadora } = c.geral;
  const { clienteEmAtraso, toleranciaAtrasoDias } = c.financeiro;
  const { modeloDocumento, finalidade, naturezaOperacao, cfopDentroEstado, cfopForaEstado, cfopExterior } = c.fiscal;
  return {
    ...c,
    ...novo,
    geral: { ...novo.geral, exigeTransportadora },
    financeiro: { ...novo.financeiro, clienteEmAtraso, toleranciaAtrasoDias },
    fiscal: { ...novo.fiscal, modeloDocumento, finalidade, naturezaOperacao, cfopDentroEstado, cfopForaEstado, cfopExterior }
  };
}

/**
 * A configuração que a gravação ENVIA, decidida pelo rascunho (TOP-CONFIG-05; formato 4 na TOP-CONFIG-08; formato 5 na
 * OPERACOES-01 F4).
 *
 *   · Com o editor do 5 (`configuracaoV5` presente): o formato 5, como está — ele é a verdade, e um `configuracaoV4`
 *     ou `configuracaoV3` que sobrasse ao lado dele é ignorado.
 *   · Com as regras gerais (`configuracaoV4` presente): o formato 4, como está — ele é a verdade, e um
 *     `configuracaoV3` que sobrasse ao lado dele é ignorado.
 *   · Com restrições (`configuracaoV3` presente): o formato 3, como está.
 *   · Sem nenhum dos dois e a versão VIGENTE no formato 3 OU MAIOR: `null` — a mesma régua da execução. Mandar o
 *     formato 2 por cima apagaria as chaves novas (o servidor recusa o retrocesso de formato de todo jeito).
 *   · Sem nenhum dos dois, vigente no formato 1/2: o caminho de hoje, intocado (`configuracaoParaEnvio`).
 *
 * O formato 4 vai COMO ESTÁ também em relação à família: as regras que ela não aceita são voltadas ao padrão ANTES,
 * na gravação do editor (`normalizarRegrasGeraisDaFamiliaTop` com `matrizRegrasGerais`, depois do diálogo "Estas
 * regras passam a valer"). Esta função não as volta em silêncio — e o servidor recusa com 422 o que sobrar. O 5 vai
 * também como está em relação ao TIPO: o que ele não aceita volta ao padrão antes (`normalizarPeloPerfilTop`).
 */
export function configuracaoDoRascunhoParaEnvio(
  r: RascunhoTop,
  execucaoSuportada: boolean,
  /** A versão VIGENTE está no formato 3 ou maior (o 4 inclusive). O nome é o da TOP-CONFIG-05; o sentido cresceu. */
  vigenteNoFormato3: boolean
): ConfiguracaoTipoOperacao | null {
  const comRestricoes: ConfiguracaoComRestricoesTop | undefined = r.configuracaoV5 ?? r.configuracaoV4 ?? r.configuracaoV3;
  if (comRestricoes) {
    // Mesma régua de `configuracaoParaEnvio`: sem execução no servidor, efeito configurado não tem envio honesto.
    const e = execucaoDeclaradaTop(comRestricoes);
    if (!execucaoSuportada && (e.estoque !== "legado" || e.financeiro !== "legado")) return null;
    return comRestricoes;
  }
  if (vigenteNoFormato3) return null;
  return configuracaoParaEnvio(r.configuracao, execucaoSuportada);
}

/**
 * Serialização canônica para detectar alteração pendente.
 *
 * Chaves ORDENADAS: `JSON.stringify` preserva ordem de inserção, e sem isto um objeto remontado na mesma
 * forma pareceria "alterado" só por ter sido construído noutra ordem — e o aviso de descarte apareceria
 * para quem não mexeu em nada, treinando o usuário a ignorá-lo.
 */
export function assinaturaRascunho(r: RascunhoTop): string {
  const canonico = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };
  return canonico({
    nome: r.nome,
    descricao: r.descricao,
    ativo: r.ativo,
    padrao: r.padrao,
    codigo: r.codigo,
    codigoBase: r.codigoBase,
    configuracao: r.configuracao,
    // Só identidade e ORDEM viajam na assinatura: código e nome do destino são apresentação e podem mudar
    // no servidor sem que o rascunho do usuário tenha mudado.
    destinos: r.destinos.map((d) => d.emPartes ? `${d.tipoOperacaoId}:partes` : d.tipoOperacaoId),
    // DECLARAR É CONTEÚDO, e por isso entra aqui. Sair da tela depois de declarar "esta operação não gera
    // próxima operação" — sem nenhum destino na lista — é sair com alteração pendente: a lista continua
    // vazia, mas o significado dela mudou, e é justamente essa mudança que a gravação registra.
    destinosDeclarados: r.destinosDeclarados,
    // TOP-CONFIG-05: só com restrições (sem elas as chaves ficam AUSENTES e a assinatura é a de hoje).
    // Da lista de condições só a identidade e a ORDEM viajam; código e nome são apresentação.
    ...(r.configuracaoV3 ? { configuracaoV3: r.configuracaoV3 } : {}),
    // TOP-CONFIG-08: a mesma régua — só com as regras gerais; sem elas a chave fica AUSENTE e a assinatura é a de hoje.
    ...(r.configuracaoV4 ? { configuracaoV4: r.configuracaoV4 } : {}),
    // OPERACOES-01 F4: a mesma régua — só com o editor do 5; sem ele a chave fica AUSENTE e a assinatura é a de hoje.
    ...(r.configuracaoV5 ? { configuracaoV5: r.configuracaoV5 } : {}),
    ...(r.condicoesPermitidas ? { condicoesPermitidas: r.condicoesPermitidas.map((c) => c.id) } : {}),
    ...(r.condicoesDeclaradas !== undefined ? { condicoesDeclaradas: r.condicoesDeclaradas } : {}),
    // TOP-CONFIG-07: marcar ou desmarcar a reserva é conteúdo (cria versão). Ausente = não lida, fora da assinatura.
    ...(r.reservaEstoque !== undefined ? { reservaEstoque: r.reservaEstoque } : {}),
    // OPERACOES-01 F9: dos padrões só a IDENTIDADE viaja (o rótulo é apresentação); ausentes = não lidos, fora dela.
    ...(r.padroesFinanceiros ? { padroesFinanceiros: padroesFinanceirosParaEnvio(r.padroesFinanceiros) } : {}),
    ...(r.padroesDeclarados !== undefined ? { padroesDeclarados: r.padroesDeclarados } : {})
  });
}

/**
 * OS ERROS DE CAMPO DE UM 422 DO SERVIDOR, como mapa caminho → mensagem (TOP-CONFIG-05).
 *
 * `TIPO_OPERACAO_CONFIGURACAO_INVALIDA` e `TIPO_OPERACAO_CONDICOES_INVALIDAS` trazem `details.recusas`
 * `[{caminho, mensagem}]`. Qualquer outra forma devolve `{}` e o erro segue para o `ErrorState` geral —
 * item malformado é ignorado só neste mapa, nunca o erro inteiro.
 */
export const CODIGOS_ERRO_DE_CAMPO_TOP = ["TIPO_OPERACAO_CONFIGURACAO_INVALIDA", "TIPO_OPERACAO_CONDICOES_INVALIDAS"] as const;
/** TOP-CONFIG-07: o 422 `VALIDATION_ERROR` da reserva fora da família do pedido (`details [{path, message}]`). */
export const CAMINHO_ERRO_RESERVA_ESTOQUE = "reservaEstoque";
export function errosDeCampoDoServidor(e: unknown): Record<string, string> {
  if (e instanceof ApiError && e.code === "VALIDATION_ERROR" && Array.isArray(e.details)) {
    // Só o caminho da reserva vira erro de campo; qualquer outro VALIDATION_ERROR segue para o `ErrorState` geral.
    const r = e.details.find((x) => ehObjeto(x) && x.path === CAMINHO_ERRO_RESERVA_ESTOQUE && ehTexto(x.message));
    return ehObjeto(r) && ehTexto(r.message) ? { [CAMINHO_ERRO_RESERVA_ESTOQUE]: r.message } : {};
  }
  if (!(e instanceof ApiError) || !(CODIGOS_ERRO_DE_CAMPO_TOP as readonly string[]).includes(e.code)) return {};
  const d = e.details;
  if (!ehObjeto(d) || !Array.isArray(d.recusas)) return {};
  const mapa: Record<string, string> = {};
  for (const r of d.recusas) {
    if (ehObjeto(r) && ehTexto(r.caminho) && ehTexto(r.mensagem) && !(r.caminho in mapa)) mapa[r.caminho] = r.mensagem;
  }
  return mapa;
}

/**
 * O limite monetário aceitável.
 *
 * ESPELHA a regra do domínio (`FORMA_VALOR_MINIMO`), que é a autoridade e recusa com 422 de qualquer jeito.
 * Repetido aqui só para o usuário ver o problema antes de enviar; a tela nunca é a autoridade. Dinheiro é
 * STRING decimal ponta a ponta — ponto flutuante faria "10000.10" às vezes disparar e às vezes não.
 */
const FORMA_VALOR_MINIMO = /^\d{1,13}(\.\d{1,2})?$/;
export const valorMinimoAceitavel = (v: string): boolean => FORMA_VALOR_MINIMO.test(v) && Number(v) > 0;

/**
 * A mensagem de conflito otimista. O 409 do servidor NUNCA é sobrescrito com um novo envio automático.
 *
 * Classificado pelo CÓDIGO, não pelo status: esta mesma porta devolve outros 409 que não são concorrência
 * (`TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`, quando o gate da execução configurada está desligado no servidor
 * que atendeu), e dizer "alterado por outra pessoa" no lugar da mensagem do servidor esconderia o motivo real.
 */
export const ehConflitoDeConcorrencia = (e: unknown): boolean =>
  e instanceof ApiError && e.code === "CONCURRENCY_CONFLICT";
