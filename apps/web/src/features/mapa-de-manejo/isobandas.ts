/**
 * ISOBANDS / FAIXAS VETORIAIS DE RASTER CONTÍNUO — SAT-BUNDLE-01B [F2].
 *
 * Decodifica UINT8 → valor → bin visual fixo → polygoniza (mesmo motor da condição).
 * Não desenha quadrados individuais. Não cria detalhe espacial inexistente.
 */
import {
  ENCODING_RASTER_POR_INDICE, decodificarByteRaster, type IdIndiceSatelite
} from "@agro/domain";
import {
  componentes4ConexosGrade, polygonizarComponente, simplificarAnelVisual,
  type CantosLngLat
} from "./polygonizar-grade";
import { faixasDoTema, type FaixaVisualTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export interface FeatureFaixa {
  type: "Feature";
  properties: {
    codigo: number;
    faixa: string;
    rotulo: string;
    cor: string;
    componente: number;
  };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}

function codigoDaFaixa(valor: number, faixas: readonly FaixaVisualTema[]): number {
  for (const f of faixas) {
    if (valor >= f.min && valor < f.max) return f.codigo;
    if (f.max === Infinity && valor >= f.min) return f.codigo;
  }
  return faixas[faixas.length - 1]!.codigo;
}

/** Grade categórica de bins (0 = nodata/fora). */
export function gradeBinsDoRaster(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  indice: IdIndiceSatelite;
  tema: TemaMapaPasto;
}): Uint8Array {
  const enc = ENCODING_RASTER_POR_INDICE[p.indice];
  const faixas = faixasDoTema(p.tema);
  if (!enc || !faixas) throw new RangeError(`isobandas: tema/índice inválido ${p.tema}/${p.indice}`);
  const out = new Uint8Array(p.pixels.length);
  for (let i = 0; i < p.pixels.length; i++) {
    const v = decodificarByteRaster(p.pixels[i]!, enc.scaleMin, enc.scaleMax);
    out[i] = v === null ? 0 : codigoDaFaixa(v, faixas);
  }
  return out;
}

export function isobandasDoRaster(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
  indice: IdIndiceSatelite;
  tema: TemaMapaPasto;
}): FeatureFaixa[] {
  const faixas = faixasDoTema(p.tema);
  if (!faixas) return [];
  const bins = gradeBinsDoRaster({ pixels: p.pixels, indice: p.indice, tema: p.tema });
  const comps = componentes4ConexosGrade({
    pixels: bins, largura: p.largura, altura: p.altura,
    ehValido: (v) => v > 0
  });
  const porCodigo = new Map(faixas.map((f) => [f.codigo, f]));
  return comps.map((comp, i) => {
    const faixa = porCodigo.get(comp.codigo);
    const bruto = polygonizarComponente({
      pixels: comp.pixels, largura: p.largura, altura: p.altura, cantos: p.cantos
    });
    let geometry = bruto;
    if (geometry.type === "Polygon") {
      const rings = (geometry.coordinates as number[][][]).map((r) => simplificarAnelVisual(r));
      if (rings.every((r) => r.length >= 4)) geometry = { type: "Polygon", coordinates: rings };
    }
    return {
      type: "Feature" as const,
      properties: {
        codigo: comp.codigo,
        faixa: faixa?.id ?? String(comp.codigo),
        rotulo: faixa?.rotulo ?? String(comp.codigo),
        cor: faixa?.cor ?? "#94a3b8",
        componente: i
      },
      geometry
    };
  });
}

export function featureCollectionIsobandas(feats: readonly FeatureFaixa[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: feats.map((f) => ({
      type: "Feature" as const,
      properties: f.properties,
      geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    }))
  };
}
