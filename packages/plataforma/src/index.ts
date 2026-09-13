/**
 * @erp/plataforma — NÚCLEO NEUTRO DE NICHO (docs/PRE-BASE2-FOUNDATION.md).
 *
 * Contratos de plataforma que o ERP inteiro consome e que NÃO dependem de nenhum segmento de negócio:
 * organização × empresa e escopo, ID Global, idioma e formatação. Regra de dependência: este pacote nunca
 * importa pacotes de domínio — o domínio depende da plataforma, jamais o contrário. É o que permite atender
 * outros segmentos sem reescrever a fundação.
 */
export * from "./empresa.js";
export * from "./escopo-modulo.js";
export * from "./id-global.js";
export * from "./idioma.js";
export * from "./formatacao.js";
export { ptBR } from "./idiomas/pt-BR.js";
