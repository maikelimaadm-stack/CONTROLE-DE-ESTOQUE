/**
 * PALETAS DOS ÍNDICES DE SATÉLITE — SSOT da COR no Mapa geral (decisão 301).
 *
 * O raster da API traz VALORES (byte 0 = sem dado; 1..255 = valor linear na escala de CODIFICAÇÃO do índice). Aqui
 * mora só a COR. Três regras que não se negociam:
 *   1. a escala é FIXA — vem do `encoding` do domínio (ou do metadado do raster), nunca do mínimo/máximo da imagem;
 *   2. as paradas de cor são fixas por índice: o mesmo valor tem a mesma cor em qualquer área e data;
 *   3. byte 0 é transparente: sem dado nunca é pintado como valor.
 *
 * Famílias e rótulos saem do catálogo do domínio (`CATALOGO_INDICES`); a web só decide a APARÊNCIA.
 * NDVI reaproveita as paradas já validadas da SAT-07 (`PARADAS_NDVI_PIXEL`) — nada é duplicado.
 */
import {
  CATALOGO_INDICES,
  ENCODING_RASTER_POR_INDICE,
  INDICES_BUNDLE_ESSENCIAL,
  RASTER_DEGRAUS,
  RASTER_NODATA_BYTE,
  type FamiliaIndice,
  type IdIndiceSatelite
} from "@agro/domain";
import { PARADAS_NDVI_PIXEL } from "./paleta-ndvi-pixel";

export type IdIndice = IdIndiceSatelite;
export type FamiliaCamada = "vigor" | "umidade" | "cobertura_solo";

/** Parada de cor: valor do índice → RGB 0..255. */
export interface ParadaCor {
  readonly valor: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface PaletaIndice {
  readonly indice: IdIndice;
  readonly familia: FamiliaCamada;
  readonly paradas: readonly ParadaCor[];
  /** Rótulos das pontas da legenda (baixo → alto). */
  readonly pontas: readonly [string, string];
}

export interface FamiliaDeCamada {
  readonly id: FamiliaCamada;
  readonly rotulo: string;
  readonly pergunta: string;
  readonly indices: readonly IdIndice[];
}

const FAMILIA_DO_CATALOGO: Readonly<Partial<Record<FamiliaIndice, FamiliaCamada>>> = {
  vegetacao: "vigor",
  umidade: "umidade",
  cobertura_solo: "cobertura_solo"
};

const ROTULO_FAMILIA: Readonly<Record<FamiliaCamada, string>> = {
  vigor: "Vigor",
  umidade: "Umidade",
  cobertura_solo: "Cobertura/Solo"
};

const ORDEM_FAMILIAS: readonly FamiliaCamada[] = ["vigor", "umidade", "cobertura_solo"];

export function familiaDoIndice(indice: IdIndice): FamiliaCamada {
  const f = FAMILIA_DO_CATALOGO[CATALOGO_INDICES[indice].familia];
  if (!f) throw new Error(`paletas: família sem camada para o índice ${indice}`);
  return f;
}

/** Famílias de camada, na ordem da tela, com os índices na ordem do bundle essencial. */
export const FAMILIAS_CAMADA: readonly FamiliaDeCamada[] = ORDEM_FAMILIAS.map((id) => {
  const indices = INDICES_BUNDLE_ESSENCIAL.filter((i) => familiaDoIndice(i) === id);
  return { id, rotulo: ROTULO_FAMILIA[id], pergunta: CATALOGO_INDICES[indices[0]!].pergunta, indices };
});

export function familiaPorId(id: FamiliaCamada): FamiliaDeCamada {
  return FAMILIAS_CAMADA.find((f) => f.id === id)!;
}

const cor = (valor: number, hex: string): ParadaCor => ({
  valor,
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});

/** Vigor: do vermelho (pouca resposta) ao verde escuro (muita resposta), com as paradas de cada índice. */
const RAMPA_VIGOR = ["#d73027", "#fc8d59", "#d9ef8b", "#91cf60", "#1a9850"] as const;
const rampaVigor = (valores: readonly [number, number, number, number, number]): ParadaCor[] =>
  valores.map((v, i) => cor(v, RAMPA_VIGOR[i]!));

const PARADAS_POR_INDICE: Readonly<Record<IdIndice, readonly ParadaCor[]>> = {
  ndvi: PARADAS_NDVI_PIXEL.map((p) => ({ valor: p.ndvi, r: p.r, g: p.g, b: p.b })),
  evi2: rampaVigor([0.05, 0.15, 0.3, 0.45, 0.6]),
  ndre: rampaVigor([0.05, 0.12, 0.22, 0.32, 0.45]),
  // Umidade relativa da vegetação: marrom (seco) → bege → verde-azulado (úmido).
  ndmi: [
    cor(-0.4, "#8c510a"),
    cor(-0.2, "#dfc27d"),
    cor(0.0, "#f6e8c3"),
    cor(0.15, "#80cdc1"),
    cor(0.4, "#01665e")
  ],
  // Cobertura vegetal (reduz a influência do solo): marrom-claro (solo) → verde.
  msavi2: [
    cor(0.05, "#8c6d3f"),
    cor(0.15, "#d8b365"),
    cor(0.3, "#f2e394"),
    cor(0.45, "#91cf60"),
    cor(0.65, "#1a9850")
  ],
  // BSI sobe com solo exposto: verde (coberto) → amarelo → marrom (solo exposto).
  bsi: [
    cor(-0.3, "#1a9850"),
    cor(-0.1, "#91cf60"),
    cor(0.05, "#fee08b"),
    cor(0.15, "#d8a05a"),
    cor(0.3, "#8c510a")
  ]
};

const PONTAS_POR_INDICE: Readonly<Record<IdIndice, readonly [string, string]>> = {
  ndvi: ["Baixa resposta", "Alta resposta"],
  evi2: ["Baixa resposta", "Alta resposta"],
  ndre: ["Baixa resposta", "Alta resposta"],
  ndmi: ["Menos umidade", "Mais umidade"],
  msavi2: ["Menos cobertura", "Mais cobertura"],
  bsi: ["Menos solo exposto", "Mais solo exposto"]
};

export const PALETAS_INDICES: Readonly<Record<IdIndice, PaletaIndice>> = Object.fromEntries(
  INDICES_BUNDLE_ESSENCIAL.map((indice) => [indice, {
    indice,
    familia: familiaDoIndice(indice),
    paradas: PARADAS_POR_INDICE[indice],
    pontas: PONTAS_POR_INDICE[indice]
  } satisfies PaletaIndice])
) as Record<IdIndice, PaletaIndice>;

export function nomeDoIndice(indice: IdIndice): string {
  return CATALOGO_INDICES[indice].nome;
}

export interface EscalaCodificacao { readonly min: number; readonly max: number }

/**
 * Escala de CODIFICAÇÃO do raster (a que decodifica o byte). Prefere o metadado do próprio raster (`escala_min`/`max`);
 * sem ele, o `encoding` versionado do domínio. Nunca o intervalo observado na imagem.
 */
export function escalaDeCodificacao(indice: IdIndice, dto?: { escala_min?: number | null; escala_max?: number | null }): EscalaCodificacao {
  const min = dto?.escala_min;
  const max = dto?.escala_max;
  if (typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max) && min < max) {
    return { min, max };
  }
  const enc = ENCODING_RASTER_POR_INDICE[indice];
  return { min: enc.scaleMin, max: enc.scaleMax };
}

function misturar(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Cor da paleta FIXA para um valor já decodificado. Fora das pontas: clamp. Valor não finito: primeira parada. */
export function corDoValor(indice: IdIndice, valor: number): [number, number, number] {
  const paradas = PALETAS_INDICES[indice].paradas;
  const primeira = paradas[0]!;
  const ultima = paradas[paradas.length - 1]!;
  if (!Number.isFinite(valor) || valor <= primeira.valor) return [primeira.r, primeira.g, primeira.b];
  if (valor >= ultima.valor) return [ultima.r, ultima.g, ultima.b];
  for (let i = 0; i < paradas.length - 1; i++) {
    const a = paradas[i]!;
    const b = paradas[i + 1]!;
    if (valor <= b.valor) {
      const t = (valor - a.valor) / (b.valor - a.valor);
      return [misturar(a.r, b.r, t), misturar(a.g, b.g, t), misturar(a.b, b.b, t)];
    }
  }
  return [ultima.r, ultima.g, ultima.b];
}

/**
 * LUT RGBA (256×4) do índice. Byte 0 → (0,0,0,0): sem dado é transparente. Bytes 1..255 → cor da paleta fixa
 * para o valor decodificado na escala de codificação.
 */
export function montarLutIndice(indice: IdIndice, escala: EscalaCodificacao = escalaDeCodificacao(indice)): Uint8ClampedArray {
  if (!Number.isFinite(escala.min) || !Number.isFinite(escala.max) || escala.min >= escala.max) {
    throw new RangeError("escala do raster inválida");
  }
  const lut = new Uint8ClampedArray(256 * 4);
  for (let byte = 0; byte <= 255; byte++) {
    if (byte === RASTER_NODATA_BYTE) continue;
    const valor = ((byte - 1) / RASTER_DEGRAUS) * (escala.max - escala.min) + escala.min;
    const [r, g, b] = corDoValor(indice, valor);
    const i = byte * 4;
    lut[i] = r;
    lut[i + 1] = g;
    lut[i + 2] = b;
    lut[i + 3] = 255;
  }
  return lut;
}

/** `linear-gradient` CSS da legenda: as paradas distribuídas pela escala VISUAL do índice (paradas reais, não rampa genérica). */
export function gradienteCssDoIndice(indice: IdIndice): string {
  const paradas = PALETAS_INDICES[indice].paradas;
  const min = paradas[0]!.valor;
  const max = paradas[paradas.length - 1]!.valor;
  const partes = paradas.map((p) => `rgb(${p.r} ${p.g} ${p.b}) ${(((p.valor - min) / (max - min)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${partes.join(", ")})`;
}
