/**
 * Contagens do pedido de análise: áreas físicas ≠ itens/análises (área × recorte).
 * `total_itens` / `novos` / `reaproveitados` são análises; não rotular como "áreas".
 */

export type EntradaResumoPedido = {
  /** Áreas únicas do alvo (seleção cliente), quando comprovável. */
  areasUnicas: number | null;
  /** Recortes temporais do período validado (`slotsDoPeriodo`), não dias do intervalo. */
  periodos: number | null;
  /** Análises/itens do contrato (`total_itens` ou novos+reaproveitados). */
  analises: number | null;
  areasIgnoradas?: number;
  /** Hectares físicos do alvo — nunca multiplicar por períodos. */
  hectares?: number | null;
  formatarHa?: (ha: number) => string;
};

/**
 * Ex.: 10 áreas × 3 períodos → "10 áreas · 3 períodos · 30 análises".
 * Sem evidência de áreas/períodos, só "30 análises".
 */
export function textoLinhaResumoPedido(p: EntradaResumoPedido): string | null {
  const partes: string[] = [];
  if (p.areasUnicas != null && p.areasUnicas >= 0) {
    partes.push(`${p.areasUnicas} ${p.areasUnicas === 1 ? "área" : "áreas"}`);
  }
  if (p.periodos != null && p.periodos > 1) {
    partes.push(`${p.periodos} períodos`);
  }
  if (p.analises != null && p.analises >= 0) {
    // Período único (slots=1 ou omitido): se análises === áreas, não repetir a mesma contagem.
    // Com vários períodos, análises é sempre outra unidade.
    const periodoUnico = p.periodos == null || p.periodos === 1;
    const soAreasComprovadas = periodoUnico
      && p.areasUnicas != null
      && p.analises === p.areasUnicas
      && partes.length > 0;
    if (!soAreasComprovadas) {
      partes.push(`${p.analises} ${p.analises === 1 ? "análise" : "análises"}`);
    }
  }
  if (partes.length === 0) return null;

  let s = partes.join(" · ");
  if (p.hectares != null && Number.isFinite(p.hectares) && p.areasUnicas != null) {
    const ha = p.formatarHa ? p.formatarHa(p.hectares) : String(p.hectares);
    s += ` · ${ha} ha`;
  }
  if (p.areasIgnoradas != null && p.areasIgnoradas > 0) {
    s += ` · ${p.areasIgnoradas} ignorada(s)`;
  }
  return s;
}

/** Progresso: sempre "análises", nunca "áreas". */
export function textoProgressoAnalises(feitos: number, total: number, falhos = 0): string {
  let s = `${feitos} de ${total} análises processadas`;
  if (falhos > 0) s += ` · ${falhos} com falha`;
  return s;
}

/** Barra compacta fora do modal. */
export function rotuloCompactoAnalises(feitos: number, total: number): string {
  return `Analisando · ${feitos}/${total}`;
}
