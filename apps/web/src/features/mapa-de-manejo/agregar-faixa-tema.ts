/**
 * Agregação de faixa na VISTA ATUAL — SAT-BUNDLE-01B [F2] R2.
 *
 * Usa distribuição PIXEL-LEVEL (`distribuirFaixasRasterNaArea`).
 * NÃO atribui area_ha inteira pela média do índice.
 */
import {
  agregarFaixaNaVista, type DistribuicaoFaixasArea
} from "./distribuicao-faixas-raster";
import { faixasDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export interface ItemDistribuicaoVista {
  areaId: string;
  nome: string;
  dist: DistribuicaoFaixasArea;
}

export interface AgregadoFaixaTema {
  faixaId: string;
  rotulo: string;
  ha: number;
  pct: number;
  pastos: number;
  principais: { id: string; nome: string; ha: number }[];
  haCarregada: number;
  escopo: "vista_atual";
}

export function agregarFaixaTemaVista(p: {
  tema: TemaMapaPasto;
  faixaId: string;
  itens: readonly ItemDistribuicaoVista[];
}): AgregadoFaixaTema | null {
  if (p.tema === "condicao") return null;
  const faixa = faixasDoTema(p.tema)?.find((f) => f.id === p.faixaId);
  const rotulo = faixa?.rotulo ?? (p.faixaId === "sem_leitura" ? "Sem leitura" : p.faixaId);
  const agg = agregarFaixaNaVista({ faixaId: p.faixaId, itens: p.itens });
  return {
    faixaId: p.faixaId,
    rotulo,
    ha: agg.ha,
    pct: agg.pctDaVista,
    pastos: agg.pastos,
    principais: agg.principais,
    haCarregada: agg.haCarregada,
    escopo: "vista_atual"
  };
}
