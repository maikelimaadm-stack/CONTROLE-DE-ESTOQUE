/**
 * SAT-07 — colorização do raster NDVI (bytes → ImageData / canvas).
 *
 * Entrada: PNG de valores da SAT-06 (1 banda UINT8). Em fontes RGBA (getImageData / decode
 * que expandiu o cinza), lê-se SÓ o canal R — G/B/A da origem são ignorados.
 * Saída: RGBA via LUT de `montarLutNdvi` (byte 0 permanece transparente).
 */
import { montarLutNdvi } from "./paleta-ndvi-pixel";

/** ImageData compatível com o DOM; em Node (vitest) montamos um objeto com a mesma forma. */
function criarImageData(dados: Uint8ClampedArray, largura: number, altura: number): ImageData {
  if (typeof ImageData !== "undefined") {
    // Cópia num ArrayBuffer “puro” — o tipagem do DOM recusa SharedArrayBuffer via ArrayBufferLike.
    const copia = new Uint8ClampedArray(dados);
    return new ImageData(copia, largura, altura);
  }
  return { data: dados, width: largura, height: altura, colorSpace: "srgb" } as ImageData;
}

function criarCanvas(largura: number, altura: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(largura, altura);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    return canvas;
  }
  throw new Error("Canvas indisponível neste ambiente (precisa OffscreenCanvas ou document)");
}

/**
 * Aplica a LUT ao raster em cinza (1 byte/pixel) ou RGBA (4 bytes/pixel — usa só R).
 * `largura` × `altura` deve bater com o buffer.
 */
export function colorirRasterNdvi(
  bytesCinza: Uint8ClampedArray | Uint8Array,
  largura: number,
  altura: number,
  lut: Uint8ClampedArray
): ImageData {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura <= 0 || altura <= 0) {
    throw new RangeError("dimensões do raster inválidas");
  }
  if (lut.length < 256 * 4) {
    throw new RangeError("LUT NDVI incompleta (esperado 256×4 RGBA)");
  }

  const pixels = largura * altura;
  const rgbaOrigem = bytesCinza.length === pixels * 4;
  const cinzaOrigem = bytesCinza.length === pixels;
  if (!rgbaOrigem && !cinzaOrigem) {
    throw new RangeError("buffer do raster não corresponde a cinza (1 bpp) nem RGBA (4 bpp)");
  }

  const saida = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const byte = rgbaOrigem ? bytesCinza[p * 4]! : bytesCinza[p]!;
    const base = byte * 4;
    const o = p * 4;
    saida[o] = lut[base]!;
    saida[o + 1] = lut[base + 1]!;
    saida[o + 2] = lut[base + 2]!;
    saida[o + 3] = lut[base + 3]!;
  }
  return criarImageData(saida, largura, altura);
}

/**
 * Extrai o canal R (cinza) de um ImageBitmap via canvas + getImageData.
 * Opções de `createImageBitmap` (ex.: cor/premultiplicação) são responsabilidade de quem chama.
 */
export async function bitmapParaBytesCinza(
  bitmap: ImageBitmap
): Promise<{ bytes: Uint8ClampedArray; largura: number; altura: number }> {
  const largura = bitmap.width;
  const altura = bitmap.height;
  const canvas = criarCanvas(largura, altura);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("contexto 2d indisponível para ler o bitmap NDVI");

  // OffscreenCanvasRenderingContext2D e CanvasRenderingContext2D compartilham drawImage/getImageData.
  (ctx as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
  const { data } = (ctx as CanvasRenderingContext2D).getImageData(0, 0, largura, altura);

  const bytes = new Uint8ClampedArray(largura * altura);
  for (let i = 0, p = 0; p < bytes.length; p++, i += 4) {
    bytes[p] = data[i]!; // só R
  }
  return { bytes, largura, altura };
}

/**
 * Colorize o bitmap na escala dada e desenha num canvas do mesmo tamanho.
 * Reusa `lut` se fornecida; senão monta com `montarLutNdvi(escalaMin, escalaMax)`.
 */
export async function colorirBitmapParaCanvas(
  bitmap: ImageBitmap,
  escalaMin: number,
  escalaMax: number,
  lut?: Uint8ClampedArray
): Promise<{ canvas: OffscreenCanvas | HTMLCanvasElement; lut: Uint8ClampedArray }> {
  const tabela = lut ?? montarLutNdvi(escalaMin, escalaMax);
  const { bytes, largura, altura } = await bitmapParaBytesCinza(bitmap);
  const colorido = colorirRasterNdvi(bytes, largura, altura, tabela);

  const canvas = criarCanvas(largura, altura);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("contexto 2d indisponível para pintar o NDVI");
  (ctx as CanvasRenderingContext2D).putImageData(colorido, 0, 0);
  return { canvas, lut: tabela };
}
