/**
 * Threshold de detalhe temático — SAT-BUNDLE-01B [F2] R2.
 *
 * Zoom distante: fill resumido (cor da média do tema), sem microzonas.
 * Zoom próximo (>= threshold): isobands/zonas do viewport.
 * Área selecionada pode pedir detalhe mesmo abaixo do threshold.
 */
export const ZOOM_MINIMO_DETALHE_TEMAS = 13;

export function deveCarregarDetalheTematico(p: {
  zoom: number;
  selecionadaId: string | null;
  threshold?: number;
}): boolean {
  const t = p.threshold ?? ZOOM_MINIMO_DETALHE_TEMAS;
  return p.zoom >= t || Boolean(p.selecionadaId);
}

/** Ids a carregar no detalhe: viewport completo no zoom próximo; só selecionada no distante. */
export function idsDetalheTematico(p: {
  zoom: number;
  selecionadaId: string | null;
  idsViewport: readonly string[];
  threshold?: number;
}): string[] {
  const t = p.threshold ?? ZOOM_MINIMO_DETALHE_TEMAS;
  if (p.zoom >= t) return [...p.idsViewport];
  return p.selecionadaId ? [p.selecionadaId] : [];
}
