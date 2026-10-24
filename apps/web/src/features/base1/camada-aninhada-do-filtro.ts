/**
 * Camadas portaladas do filtro (condição Radix Select, cmd-panel, calendário).
 * Clique / foco nelas NÃO deve fechar o shell do filtro — só Cancelar / Aplicar (ícones) / fora de verdade.
 * Enter nelas escolhe a opção (não aplica o filtro); Enter no campo de valor do shell aplica (decisão 358).
 */
export const SELETOR_CAMADA_ANINHADA_DO_FILTRO =
  "[data-filtro-camada], [data-radix-select-content], .fsell, .foperadores, .cmd-panel, .mg-dp-panel";

/** `true` quando o alvo (ou ancestral) é uma camada aninhada do filtro. */
export function ehCamadaAninhadaDoFiltro(alvo: EventTarget | null): boolean {
  return Boolean(
    alvo &&
      typeof (alvo as Element).closest === "function" &&
      (alvo as Element).closest(SELETOR_CAMADA_ANINHADA_DO_FILTRO)
  );
}
