import type { Polygon } from "geojson";
import { areaHa, type LngLat } from "./editor-desenho";

/**
 * Importação de áreas do Mapa de Manejo a partir de arquivo (KML, GeoJSON / JSON).
 * Cor sempre branca do sistema; nomes vêm do arquivo ou da sequência 1, 2, 3…
 */

/** Branco da paleta — padrão de toda área importada (o usuário muda depois). */
export const COR_IMPORTACAO = "#f8f9fa";

export type FormatoImportacao = "kml" | "geojson" | "json";

export interface AreaImportada {
  nome: string;
  geometria: Polygon;
  tamanho_ha: number;
  cor: typeof COR_IMPORTACAO;
}

export interface ResultadoImportacao {
  formato: FormatoImportacao;
  areas: AreaImportada[];
  avisos: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function detectarFormato(nomeArquivo: string, texto: string): FormatoImportacao {
  const n = nomeArquivo.trim().toLowerCase();
  if (n.endsWith(".kml")) return "kml";
  if (n.endsWith(".geojson")) return "geojson";
  if (n.endsWith(".json")) {
    const t = texto.trimStart();
    if (t.startsWith("<") || /<kml[\s>]/i.test(t)) return "kml";
    return "json";
  }
  const t = texto.trimStart();
  if (t.startsWith("<") || /<kml[\s>]/i.test(t)) return "kml";
  return "geojson";
}

function fecharAnel(anel: LngLat[]): LngLat[] {
  if (anel.length < 3) return anel;
  const a = anel[0]!, b = anel[anel.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return anel;
  return [...anel, a];
}

function anelValido(anel: LngLat[]): boolean {
  const fechado = fecharAnel(anel);
  return fechado.length >= 4;
}

function poligonoDeAnel(anel: LngLat[]): Polygon | null {
  const fechado = fecharAnel(anel);
  if (!anelValido(fechado)) return null;
  return { type: "Polygon", coordinates: [fechado] };
}

function nomeHumano(candidatos: Array<string | null | undefined>, sequencia: number): string {
  for (const c of candidatos) {
    const t = (c ?? "").trim();
    if (!t) continue;
    if (UUID_RE.test(t)) continue;
    return t.toLocaleUpperCase("pt-BR");
  }
  return String(sequencia);
}

function parseCoordsKml(texto: string): LngLat[] {
  return texto
    .trim()
    .split(/\s+/)
    .map((par) => par.split(",").map(Number))
    .filter((p): p is [number, number, ...number[]] => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0]!, p[1]!] as LngLat);
}

function textoTag(el: Element, tag: string): string {
  const n = el.getElementsByTagName(tag)[0];
  return (n?.textContent ?? "").trim();
}

function simpleData(el: Element, nome: string): string {
  const nodes = el.getElementsByTagName("SimpleData");
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if ((n.getAttribute("name") ?? "") === nome) return (n.textContent ?? "").trim();
  }
  return "";
}

function parseKml(texto: string): { areas: AreaImportada[]; avisos: string[] } {
  const avisos: string[] = [];
  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Arquivo KML inválido ou corrompido.");
  }
  const marks = Array.from(doc.getElementsByTagName("Placemark"));
  const areas: AreaImportada[] = [];
  let seq = 0;
  for (const pm of marks) {
    const rings = pm.getElementsByTagName("LinearRing");
    if (rings.length === 0) {
      avisos.push(`Placemark sem polígono ignorado (${textoTag(pm, "name") || "sem nome"}).`);
      continue;
    }
    const coordsEl = rings[0]!.getElementsByTagName("coordinates")[0];
    const anel = parseCoordsKml(coordsEl?.textContent ?? "");
    const geom = poligonoDeAnel(anel);
    if (!geom) {
      avisos.push(`Polígono inválido ignorado (${textoTag(pm, "name") || "sem nome"}).`);
      continue;
    }
    seq += 1;
    const title = simpleData(pm, "title");
    const nomeXml = textoTag(pm, "name");
    const nome = nomeHumano([title, nomeXml], seq);
    const haExt = Number(simpleData(pm, "area_hectares").replace(",", "."));
    const haCalc = Math.round(areaHa(anel.length && anel[0]![0] === anel[anel.length - 1]![0] && anel[0]![1] === anel[anel.length - 1]![1] ? anel.slice(0, -1) : anel) * 10000) / 10000;
    const tamanho_ha = Number.isFinite(haExt) && haExt > 0 ? Math.round(haExt * 10000) / 10000 : haCalc;
    areas.push({ nome, geometria: geom, tamanho_ha, cor: COR_IMPORTACAO });
  }
  return { areas, avisos };
}

function anelDeCoords(coords: unknown): LngLat[] | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const out: LngLat[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const lng = Number(c[0]), lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    out.push([lng, lat]);
  }
  return out;
}

function areaDeFeature(f: GeoJSON.Feature, seq: number): AreaImportada | null {
  const g = f.geometry;
  if (!g) return null;
  let anel: LngLat[] | null = null;
  if (g.type === "Polygon") anel = anelDeCoords(g.coordinates[0]);
  else if (g.type === "MultiPolygon") anel = anelDeCoords(g.coordinates[0]?.[0]);
  if (!anel) return null;
  const geom = poligonoDeAnel(anel);
  if (!geom) return null;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const nome = nomeHumano([
    typeof props.title === "string" ? props.title : null,
    typeof props.nome === "string" ? props.nome : null,
    typeof props.name === "string" ? props.name : null,
    typeof f.id === "string" ? f.id : null
  ], seq);
  const aberto = anel[0] && anel[anel.length - 1] && anel[0][0] === anel[anel.length - 1]![0] && anel[0][1] === anel[anel.length - 1]![1]
    ? anel.slice(0, -1) : anel;
  const tamanho_ha = Math.round(areaHa(aberto) * 10000) / 10000;
  return { nome, geometria: geom, tamanho_ha, cor: COR_IMPORTACAO };
}

function parseGeoJson(texto: string): { areas: AreaImportada[]; avisos: string[] } {
  const avisos: string[] = [];
  let data: unknown;
  try { data = JSON.parse(texto); }
  catch { throw new Error("Arquivo JSON/GeoJSON inválido."); }
  const features: GeoJSON.Feature[] = [];
  if (data && typeof data === "object") {
    const o = data as GeoJSON.GeoJsonObject & { features?: GeoJSON.Feature[]; type?: string; geometry?: GeoJSON.Geometry };
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) features.push(...o.features);
    else if (o.type === "Feature") features.push(o as GeoJSON.Feature);
    else if (o.type === "Polygon" || o.type === "MultiPolygon") {
      features.push({ type: "Feature", properties: {}, geometry: o as GeoJSON.Polygon | GeoJSON.MultiPolygon });
    } else if (Array.isArray((o as { areas?: unknown }).areas)) {
      throw new Error("Formato JSON não reconhecido. Envie KML ou GeoJSON (FeatureCollection).");
    } else {
      throw new Error("Formato JSON não reconhecido. Envie KML ou GeoJSON (FeatureCollection).");
    }
  } else {
    throw new Error("Formato JSON não reconhecido.");
  }
  const areas: AreaImportada[] = [];
  let seq = 0;
  for (const f of features) {
    seq += 1;
    const a = areaDeFeature(f, seq);
    if (!a) {
      avisos.push(`Feature ${seq} ignorada (sem polígono válido).`);
      seq -= 1;
      continue;
    }
    areas.push(a);
  }
  return { areas, avisos };
}

/** Lê o texto do arquivo e devolve as áreas prontas para POST em `mapa_areas`. */
export function parseImportacaoMapa(nomeArquivo: string, texto: string): ResultadoImportacao {
  const formato = detectarFormato(nomeArquivo, texto);
  const { areas, avisos } = formato === "kml" ? parseKml(texto) : parseGeoJson(texto);
  if (areas.length === 0) throw new Error("Nenhuma área com polígono válido encontrada no arquivo.");
  // Nomes duplicados no mesmo arquivo: sufixo (2), (3)…
  const vistos = new Map<string, number>();
  for (const a of areas) {
    const base = a.nome;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    if (n > 1) a.nome = `${base} (${n})`;
  }
  return { formato, areas, avisos };
}

export function rotuloFormato(f: FormatoImportacao): string {
  if (f === "kml") return "KML";
  if (f === "geojson") return "GeoJSON";
  return "JSON";
}
