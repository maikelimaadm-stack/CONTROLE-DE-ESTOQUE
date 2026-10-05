/**
 * ANÁLISE SATELITAL DA ÁREA (SAT-01, decisão 293) — UM dono das listas fechadas e dos critérios.
 *
 * A unidade de análise é a ÁREA canônica (`erp.areas`, decisão 292): não existe segundo cadastro de polígonos
 * para o satélite, e a geometria analisada é sempre a gravada no banco, lida pelo servidor. O primeiro provedor é
 * o Copernicus Data Space Ecosystem (Sentinel Hub), a primeira coleção é a Sentinel-2 L2A e a primeira métrica é
 * o NDVI.
 *
 * NDVI NÃO É BIOMASSA. Ele mede o vigor espectral da vegetação dentro do polígono; não é kg de capim, não é
 * matéria seca, não é oferta de forragem nem lotação. Nesta fatia nenhuma dessas grandezas é calculada, e nada
 * aqui pode ser lido como se fosse. A conversão só existe depois de calibração com medição de campo (SAT-04).
 *
 * O banco (CHECKs da 0052), a API e os testes consomem ESTE arquivo; ninguém redigita as listas.
 */

/** Provedor analítico. Só um nesta fatia; a coluna existe para o próximo não exigir outra tabela. */
export const PROVEDORES_SATELITE: readonly string[] = ["copernicus_cdse"];
export const PROVEDOR_COPERNICUS = "copernicus_cdse";

/** Coleção de imagens. Sentinel-2 L2A: reflectância de superfície (correção atmosférica) e a camada SCL. */
export const COLECOES_SATELITE: readonly string[] = ["sentinel-2-l2a"];
export const COLECAO_SENTINEL2_L2A = "sentinel-2-l2a";

/**
 * Índice espectral persistível. SAT-01 nasceu só com NDVI; SAT-08 (decisão 299) amplia o CHECK da 0056.
 * Catálogo completo (fórmulas, bandas, limitações): `indices-satelitais.ts`.
 */
export const INDICES_SATELITE: readonly string[] = ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"];
export const INDICE_NDVI = "ndvi";

/**
 * Versão do MÉTODO: o evalscript, a máscara de pixel e o critério de observação útil juntos. Mudar qualquer um
 * deles muda o número, então muda a versão — análises de versões diferentes não se reaproveitam entre si.
 */
export const VERSAO_METODO_NDVI = "sat01-ndvi-v1";

/** Situação da análise registrada. */
export const SITUACOES_ANALISE_SATELITAL: readonly [string, string][] = [
  ["concluida", "Concluída"],
  ["sem_observacao_util", "Sem observação útil"]
] as const;
export const VALORES_SITUACAO_ANALISE_SATELITAL: readonly string[] = SITUACOES_ANALISE_SATELITAL.map(([v]) => v);

/** Por que a janela não teve observação útil. Nula na análise concluída. */
export const MOTIVOS_QUALIDADE_ANALISE_SATELITAL: readonly [string, string][] = [
  ["sem_aquisicao", "Nenhuma imagem do satélite sobre a área na janela"],
  ["cobertura_insuficiente", "Nuvem, sombra ou pixel inválido cobrindo a área em todas as imagens da janela"]
] as const;
export const VALORES_MOTIVO_QUALIDADE_ANALISE_SATELITAL: readonly string[] = MOTIVOS_QUALIDADE_ANALISE_SATELITAL.map(([v]) => v);

/** Janela de busca da observação: os últimos N dias, em dias UTC inteiros (hoje incluído). */
export const JANELA_PADRAO_DIAS = 30;

/** Resolução nominal da estatística, em metros (a das bandas B04/B08 do Sentinel-2). */
export const RESOLUCAO_PADRAO_M = 10;

/**
 * CRITÉRIO DE OBSERVAÇÃO ÚTIL — valores INICIAIS, ajustáveis aqui e só aqui (a versão do método muda junto).
 *
 * - `coberturaMinima`: fração dos pixels DENTRO DO POLÍGONO que passou na máscara (dado presente, sem nuvem,
 *   sombra de nuvem, cirro, neve, água nem pixel defeituoso). 0,6 = pelo menos 60% da área vista com clareza.
 *   Abaixo disso a média descreve só um pedaço da área e não é publicada como NDVI da área.
 * - `pixelsValidosMinimos`: piso absoluto de pixels válidos de 10 m (10 pixels ≈ 0,1 ha). Área menor do que isso
 *   não é analisável nesta resolução, mesmo sem nuvem.
 *
 * Não são limiares agronômicos: não classificam pasto bom ou ruim. Só dizem se a imagem enxergou a área.
 */
export const CRITERIO_OBSERVACAO_UTIL = { coberturaMinima: 0.6, pixelsValidosMinimos: 10 } as const;

/**
 * CLASSES DA SCL (Scene Classification Layer do Sentinel-2 L2A) EXCLUÍDAS do cálculo — a máscara do método.
 * Pixel excluído não vale zero: ele SAI da estatística (dataMask = 0) e não entra na média.
 *
 * Ficam DENTRO, de propósito: 2 (área escura / sombra topográfica), 4 (vegetação), 5 (solo exposto) e
 * 7 (não classificado) — retirar solo exposto ou área escura esconderia justamente o pasto degradado.
 */
export const CLASSES_SCL_EXCLUIDAS: readonly [number, string][] = [
  [0, "Sem dado"],
  [1, "Pixel saturado ou defeituoso"],
  [3, "Sombra de nuvem"],
  [6, "Água"],
  [8, "Nuvem (probabilidade média)"],
  [9, "Nuvem (probabilidade alta)"],
  [10, "Cirro"],
  [11, "Neve ou gelo"]
] as const;
export const VALORES_CLASSE_SCL_EXCLUIDA: readonly number[] = CLASSES_SCL_EXCLUIDAS.map(([v]) => v);

/** Histórico: tamanho padrão e máximo de uma página (paginação no servidor). */
export const HISTORICO_ANALISE_SATELITAL_PADRAO = 30;
export const HISTORICO_ANALISE_SATELITAL_MAXIMO = 100;

/** Resumo do Mapa geral (decisão 294): tamanho padrão e máximo de uma página (paginação no servidor). */
export const RESUMO_ANALISE_SATELITAL_PADRAO = 500;
export const RESUMO_ANALISE_SATELITAL_MAXIMO = 500;

/**
 * ESCALA FIXA DO NDVI NO MAPA GERAL (decisão 294) — o mesmo número tem a mesma classe em qualquer data, área ou
 * empresa. Nunca é recalculada pelo mínimo/máximo do que está na tela: com escala relativa, o pasto seco da seca
 * apareceria "verde". São classes de LEITURA do vigor espectral, não diagnóstico: não dizem que o pasto está bom ou
 * degradado e não viram biomassa, oferta nem lotação (decisão 293, item 7). Limite inferior INCLUSIVO; a primeira
 * classe começa em −1 (o menor NDVI possível). Mudar um limite muda a leitura de todo o histórico: é decisão nova.
 */
/** A chave de cada classe — união fechada: quem dá cor às classes (a web) tem de cobrir todas, ou não compila. */
export type ChaveClasseNdvi = "sem_vegetacao" | "baixo" | "medio" | "alto";
export interface ClasseNdvi { chave: ChaveClasseNdvi; rotulo: string; minimo: number }
export const CLASSES_NDVI_MAPA: readonly ClasseNdvi[] = [
  { chave: "sem_vegetacao", rotulo: "Pouca ou nenhuma vegetação (abaixo de 0,20)", minimo: -1 },
  { chave: "baixo", rotulo: "Vigor baixo (0,20 a 0,40)", minimo: 0.2 },
  { chave: "medio", rotulo: "Vigor médio (0,40 a 0,60)", minimo: 0.4 },
  { chave: "alto", rotulo: "Vigor alto (0,60 ou mais)", minimo: 0.6 }
] as const;

/**
 * A classe de um NDVI médio (o `numeric` da API vem como string). Fora de [−1, 1], vazio ou não numérico → `null`
 * (sem classe: a tela mostra "sem análise", nunca uma cor inventada).
 */
export function classeNdvi(valor: string | number | null | undefined): ClasseNdvi | null {
  if (valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "")) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n < -1 || n > 1) return null;
  let atual: ClasseNdvi | null = null;
  for (const c of CLASSES_NDVI_MAPA) if (n >= c.minimo) atual = c;
  return atual;
}
