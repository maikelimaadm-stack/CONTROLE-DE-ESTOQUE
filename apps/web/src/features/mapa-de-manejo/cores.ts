/**
 * MAPA-01 / CADASTRO-AREAS-02 — paleta do cadastro de área.
 * SSOT dos pares valor/rótulo: `@agro/domain` (`CORES_DA_AREA`). Aqui só helpers de mapa.
 */
import { CORES_DA_AREA, COR_PADRAO_DA_AREA } from "@agro/domain";

export interface CorDaPaleta { cor: string; nome: string }

/** Azul escuro — padrão do cadastro. */
export const COR_PADRAO_AREA = COR_PADRAO_DA_AREA;
/** Contorno padrão das demarcações no mapa — sempre branco, fino. */
export const COR_LINHA_AREA = "#ffffff";
const CINZA_SEM_COR = "#a3b2b8";

/** Mesma paleta do select do cadastro (lista fechada). */
export const PALETA_AREAS: readonly CorDaPaleta[] = CORES_DA_AREA.map(([cor, nome]) => ({ cor, nome }));

function hexParaRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbParaHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Cor de preenchimento no mapa: a da ficha quase pura (só 5% de branco).
 * Assim a troca na paleta atualiza o pasto na hora, antes de salvar.
 */
export function corExibidaNoMapa(cor: string | null | undefined): string {
  const base = hexParaRgb(cor && cor.trim() !== "" ? cor : CINZA_SEM_COR) ?? hexParaRgb(CINZA_SEM_COR)!;
  return rgbParaHex(base[0] * 0.95 + 255 * 0.05, base[1] * 0.95 + 255 * 0.05, base[2] * 0.95 + 255 * 0.05);
}

/** Contorno no mapa: sempre branco (a linha de demarcação). */
export function corBordaNoMapa(_corExibida?: string): string {
  return COR_LINHA_AREA;
}

/** A primeira cor da paleta que nenhuma área usa; com todas em uso, o padrão. */
export function proximaCor(usadas: readonly (string | null | undefined)[]): string {
  const emUso = new Set(usadas.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  const livre = PALETA_AREAS.find((p) => !emUso.has(p.cor.toLowerCase()));
  return (livre ?? PALETA_AREAS.find((p) => p.cor === COR_PADRAO_AREA) ?? PALETA_AREAS[0]!).cor;
}
