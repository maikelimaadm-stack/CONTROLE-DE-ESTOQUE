/**
 * API pública do MODELO BASE 2 (docs/MODELO-BASE2-CONTRACT.md).
 *
 * Superfície pequena de propósito: quatro componentes de composição e os tipos deles. Tela de
 * lançamento importa daqui (`@/features/base2`) — nunca dos arquivos internos, para que a fronteira
 * continue sendo um lugar só quando a moldura evoluir.
 */
export { Base2Shell, type Base2ShellProps } from "./shell";
export { Base2Section, type Base2SectionProps } from "./section";
export { Base2Fields, type Base2FieldsProps } from "./fields";
export { Base2Items, type Base2ItemsProps } from "./items";
export type { Base2Field, Base2ItemColumn, Base2Align, Base2Span, Base2Historico } from "./types";
