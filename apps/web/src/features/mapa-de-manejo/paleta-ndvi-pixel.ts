/**
 * SAT-07 — paleta contínua do NDVI pixel a pixel (valores → cor).
 *
 * O raster da SAT-06 traz VALORES (byte 0 = sem dado; 1..255 = NDVI linear na escala do metadado).
 * Aqui só a COR: escala FIXA de aparência (as mesmas paradas em qualquer área/data), independente
 * do histograma da imagem. Trocar a paleta não pede outro raster ao provedor.
 *
 * Decodificação do byte (espelha a SAT-06):
 *   valor = (byte − 1) / 254 × (escalaMax − escalaMin) + escalaMin
 */

/** Parada da paleta contínua: NDVI → RGB 0..255. */
export interface ParadaNdviPixel {
  readonly ndvi: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Paradas fixas da escala de aparência (não confundir com a escala de CODIFICAÇÃO do raster,
 * tipicamente −0,2..1,0 no metadado). Fora dos extremos: clamp na cor da ponta.
 */
export const PARADAS_NDVI_PIXEL: readonly ParadaNdviPixel[] = [
  { ndvi: 0.1, r: 0xd7, g: 0x30, b: 0x27 }, // vermelho
  { ndvi: 0.2, r: 0xfc, g: 0x8d, b: 0x59 }, // laranja
  { ndvi: 0.4, r: 0xd9, g: 0xef, b: 0x8b }, // amarelo-esverdeado
  { ndvi: 0.6, r: 0x91, g: 0xcf, b: 0x60 }, // verde claro
  { ndvi: 0.75, r: 0x1a, g: 0x98, b: 0x50 } // verde escuro
] as const;

/** Degraus da codificação UINT8 (bytes 1..255). */
const DEGRAUS = 254;

function misturarCanal(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Cor RGB da paleta FIXA para um valor NDVI (já decodificado).
 * Interpola linearmente entre paradas; clampa abaixo de 0,10 e acima de 0,75.
 */
export function corNdviFixo(valor: number): [number, number, number] {
  if (!Number.isFinite(valor)) {
    const p0 = PARADAS_NDVI_PIXEL[0]!;
    return [p0.r, p0.g, p0.b];
  }
  const primeira = PARADAS_NDVI_PIXEL[0]!;
  const ultima = PARADAS_NDVI_PIXEL[PARADAS_NDVI_PIXEL.length - 1]!;
  if (valor <= primeira.ndvi) return [primeira.r, primeira.g, primeira.b];
  if (valor >= ultima.ndvi) return [ultima.r, ultima.g, ultima.b];

  for (let i = 0; i < PARADAS_NDVI_PIXEL.length - 1; i++) {
    const a = PARADAS_NDVI_PIXEL[i]!;
    const b = PARADAS_NDVI_PIXEL[i + 1]!;
    if (valor <= b.ndvi) {
      const t = (valor - a.ndvi) / (b.ndvi - a.ndvi);
      return [misturarCanal(a.r, b.r, t), misturarCanal(a.g, b.g, t), misturarCanal(a.b, b.b, t)];
    }
  }
  return [ultima.r, ultima.g, ultima.b];
}

/** Byte 0..255 → NDVI na escala do metadado, ou `null` se for o byte sem dado. */
export function decodificarByteNdvi(byte: number, escalaMin: number, escalaMax: number): number | null {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
    throw new RangeError("byte fora da codificação do raster NDVI");
  }
  if (!Number.isFinite(escalaMin) || !Number.isFinite(escalaMax) || escalaMin >= escalaMax) {
    throw new RangeError("escala do raster NDVI inválida");
  }
  if (byte === 0) return null;
  return ((byte - 1) / DEGRAUS) * (escalaMax - escalaMin) + escalaMin;
}

/**
 * Codificação inversa (só para testes / verificação): NDVI → byte 1..255 mais próximo,
 * na mesma regra da SAT-06 (`1 + round(clamp(t,0,1) × 254)`). Não usa byte 0.
 */
export function codificarNdviParaByte(valor: number, escalaMin: number, escalaMax: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(escalaMin) || !Number.isFinite(escalaMax) || escalaMin >= escalaMax) {
    throw new RangeError("valor ou escala inválidos para codificar NDVI");
  }
  let t = (valor - escalaMin) / (escalaMax - escalaMin);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return 1 + Math.round(t * DEGRAUS);
}

/**
 * LUT RGBA de 256 entradas (length 256×4).
 * - Índice 0: (0,0,0,0) — SEM DADO; nunca pintar como NDVI.
 * - Índices 1..255: cor da paleta fixa com alpha 255, a partir do NDVI decodificado com `escalaMin`/`escalaMax`.
 */
export function montarLutNdvi(escalaMin: number, escalaMax: number): Uint8ClampedArray {
  if (!Number.isFinite(escalaMin) || !Number.isFinite(escalaMax) || escalaMin >= escalaMax) {
    throw new RangeError("escala do raster NDVI inválida");
  }
  const lut = new Uint8ClampedArray(256 * 4);
  // Byte 0: totalmente transparente — obrigatório.
  lut[0] = 0;
  lut[1] = 0;
  lut[2] = 0;
  lut[3] = 0;

  for (let byte = 1; byte <= 255; byte++) {
    const ndvi = ((byte - 1) / DEGRAUS) * (escalaMax - escalaMin) + escalaMin;
    const [r, g, b] = corNdviFixo(ndvi);
    const i = byte * 4;
    lut[i] = r;
    lut[i + 1] = g;
    lut[i + 2] = b;
    lut[i + 3] = 255;
  }
  return lut;
}
