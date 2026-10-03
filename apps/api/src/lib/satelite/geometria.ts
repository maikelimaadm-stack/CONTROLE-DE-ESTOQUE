/**
 * GEOMETRIA DA ÁREA PARA A ANÁLISE POR SATÉLITE — SAT-01, decisão 293.
 *
 * A geometria vem SEMPRE do banco (`erp.areas.geometria`, GeoJSON Polygon em CRS84/WGS84, longitude antes da
 * latitude), lida pelo servidor depois da autorização. Nada aqui recebe polígono do cliente.
 *
 * Duas coisas, ambas puras:
 *  1. `lerPoligono`: confere de novo a forma (o gatilho da 0051 já confere; aqui é defesa antes de mandar a um
 *     terceiro) e devolve SÓ `type` e `coordinates` — chave extra gravada no JSON nunca sai da API.
 *  2. `planejarGrade`: a resolução de 10 m convertida em GRAUS na latitude central do polígono (a requisição vai em
 *     CRS84, sem reprojeção improvisada), quantos pixels dessa grade o polígono ocupa e o tamanho da caixa em pixels.
 *     A contagem é feita NA PRÓPRIA GRADE da requisição (área do polígono em graus² ÷ área do pixel em graus²): é o
 *     número de pixels que o provedor rasteriza dentro do polígono, sem misturar esfera com elipsoide. Dela saem a
 *     cobertura válida (pixels válidos ÷ pixels do polígono) e a recusa antecipada de área pequena ou grande demais.
 */

export interface PoligonoGeoJson {
  type: "Polygon";
  coordinates: [number, number][][];
}

/** Lado máximo, em pixels, de uma requisição da Statistical API (limite do provedor para a grade de saída). */
export const LADO_MAXIMO_PX = 2_500;

const rad = (graus: number) => (graus * Math.PI) / 180;

/** Polígono canônico ou `null` (forma fora do contrato). Não corrige nada: polígono estranho não é analisado. */
export function lerPoligono(valor: unknown): PoligonoGeoJson | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  if (o["type"] !== "Polygon" || !Array.isArray(o["coordinates"]) || o["coordinates"].length < 1) return null;
  const aneis: [number, number][][] = [];
  for (const anel of o["coordinates"] as unknown[]) {
    if (!Array.isArray(anel) || anel.length < 4) return null;
    const posicoes: [number, number][] = [];
    for (const pos of anel as unknown[]) {
      if (!Array.isArray(pos) || pos.length !== 2) return null;
      const [lon, lat] = pos as unknown[];
      if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
      posicoes.push([lon, lat]);
    }
    const [primeira, ultima] = [posicoes[0]!, posicoes[posicoes.length - 1]!];
    if (primeira[0] !== ultima[0] || primeira[1] !== ultima[1]) return null;
    aneis.push(posicoes);
  }
  return { type: "Polygon", coordinates: aneis };
}

/** Área de um anel na grade CRS84 (graus², fórmula do laço), sem sinal: o sentido de giro não importa. */
function areaDoAnelEmGraus(anel: [number, number][]): number {
  // Coordenadas relativas ao primeiro vértice: sem isso, produtos de ~10³ graus² somariam áreas de ~10⁻⁴.
  const [x0, y0] = anel[0]!;
  let dobro = 0;
  for (let i = 0; i < anel.length - 1; i++) {
    dobro += (anel[i]![0] - x0) * (anel[i + 1]![1] - y0) - (anel[i + 1]![0] - x0) * (anel[i]![1] - y0);
  }
  return Math.abs(dobro) / 2;
}

/** Área do polígono (anel externo menos os furos) em graus² da grade CRS84. */
export function areaEmGraus(p: PoligonoGeoJson): number {
  const [externo, ...furos] = p.coordinates;
  return Math.max(0, areaDoAnelEmGraus(externo!) - furos.reduce((soma, furo) => soma + areaDoAnelEmGraus(furo), 0));
}

/**
 * Metros por grau na latitude dada (série do elipsoide WGS84). Serve para converter a resolução nominal em graus;
 * o erro dentro de um piquete (poucos km) é desprezível frente ao pixel de 10 m.
 */
export function metrosPorGrau(latGraus: number): { lat: number; lon: number } {
  const f = rad(latGraus);
  return {
    lat: 111_132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f) - 0.0023 * Math.cos(6 * f),
    lon: 111_412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f)
  };
}

export interface GradeDaAnalise {
  /** resolução em graus (CRS84): `resx` em longitude, `resy` em latitude */
  resx: number;
  resy: number;
  /** pixels da grade que o polígono ocupa: área em graus² ÷ (resx × resy), arredondado */
  pixelsGeometria: number;
  larguraPx: number;
  alturaPx: number;
}

export function planejarGrade(p: PoligonoGeoJson, metros: number): GradeDaAnalise {
  let oeste = Infinity, leste = -Infinity, sul = Infinity, norte = -Infinity;
  for (const [lon, lat] of p.coordinates[0]!) {
    oeste = Math.min(oeste, lon); leste = Math.max(leste, lon);
    sul = Math.min(sul, lat); norte = Math.max(norte, lat);
  }
  const m = metrosPorGrau((sul + norte) / 2);
  const resx = metros / m.lon;
  const resy = metros / m.lat;
  return {
    resx, resy,
    pixelsGeometria: Math.round(areaEmGraus(p) / (resx * resy)),
    // A folga de um milionésimo de pixel só absorve ruído numérico (100,00000001 px continua sendo 100 px).
    larguraPx: Math.ceil((leste - oeste) / resx - 1e-6),
    alturaPx: Math.ceil((norte - sul) / resy - 1e-6)
  };
}
