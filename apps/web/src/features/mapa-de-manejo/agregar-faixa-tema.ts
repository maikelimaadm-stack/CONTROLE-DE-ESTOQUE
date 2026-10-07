/**
 * Resumo agregado por faixa temática — SAT-BUNDLE-01B [F2] R1.
 * Usa médias do bulk F1 + hectares do cadastro. Zero POST.
 */
import { faixaDaMedia, mediaDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export interface AreaParaAgregado {
  id: string;
  nome: string;
  areaHa: number;
  medias: Partial<Record<string, string | null>> | null | undefined;
}

export interface LinhaAgregadoFaixa {
  id: string;
  nome: string;
  ha: number;
}

export interface AgregadoFaixaTema {
  faixaId: string;
  rotulo: string;
  ha: number;
  pct: number;
  pastos: number;
  principais: LinhaAgregadoFaixa[];
}

export function agregarFaixaTema(p: {
  tema: TemaMapaPasto;
  faixaId: string;
  areas: readonly AreaParaAgregado[];
}): AgregadoFaixaTema | null {
  if (p.tema === "condicao") return null;
  const linhas: LinhaAgregadoFaixa[] = [];
  let totalHaAnalisado = 0;
  for (const a of p.areas) {
    const media = mediaDoTema(p.tema, a.medias);
    if (media === null) continue;
    totalHaAnalisado += a.areaHa;
    const faixa = faixaDaMedia(p.tema, media);
    if (!faixa || faixa.id !== p.faixaId) continue;
    linhas.push({ id: a.id, nome: a.nome, ha: a.areaHa });
  }
  linhas.sort((a, b) => b.ha - a.ha);
  const ha = linhas.reduce((s, x) => s + x.ha, 0);
  const pct = totalHaAnalisado > 0 ? (ha / totalHaAnalisado) * 100 : 0;
  const rotulo = linhas.length
    ? (faixaDaMedia(p.tema, mediaDoTema(p.tema, p.areas.find((a) => a.id === linhas[0]!.id)?.medias))?.rotulo ?? p.faixaId)
    : p.faixaId;
  return {
    faixaId: p.faixaId,
    rotulo,
    ha,
    pct,
    pastos: linhas.length,
    principais: linhas.slice(0, 8)
  };
}
