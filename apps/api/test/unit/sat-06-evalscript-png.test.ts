import { createContext, Script } from "node:vm";
import { deflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { CLASSES_SCL_EXCLUIDAS } from "@agro/domain";
import {
  decodificarValor, DEGRAUS_RASTER, ESCALA_NDVI_RASTER, EVALSCRIPT_RASTER_NDVI, VERSAO_EVALSCRIPT_RASTER
} from "../../src/lib/satelite/evalscript-raster.js";
import { ASSINATURA_PNG, ErroPng, escreverPngCinza8, lerPngCinza8, temAssinaturaPng } from "../../src/lib/satelite/png.js";
import { ESCALA_NDVI_RASTER as ESCALA_REEXPORTADA } from "../../src/lib/satelite/raster.js";

/**
 * SAT-06 (decisão 297) — o evalscript do raster de VALORES executado de verdade (`node:vm`, como o emulador e o
 * provedor o executam), a decodificação byte → NDVI e o PNG cinza de 8 bits (leitor estrito e escritor).
 */

type Amostra = { B04: number; B08: number; SCL: number; dataMask: number };
const contexto = createContext({});
new Script(EVALSCRIPT_RASTER_NDVI, { filename: "evalscript.js" }).runInContext(contexto);
const setup = contexto["setup"] as () => unknown;
const avaliar = contexto["evaluatePixel"] as (s: Amostra) => number[];
const byte = (s: Amostra) => { const r = avaliar(s); expect(r).toHaveLength(1); return r[0]!; };
/** B04/B08 que dão exatamente o NDVI pedido (B04 + B08 = 0,5). */
const comNdvi = (ndvi: number, extra: Partial<Amostra> = {}): Amostra => ({ B04: (0.5 * (1 - ndvi)) / 2, B08: (0.5 * (1 + ndvi)) / 2, SCL: 4, dataMask: 1, ...extra });
const MEIO_DEGRAU = (ESCALA_NDVI_RASTER.max - ESCALA_NDVI_RASTER.min) / DEGRAUS_RASTER / 2;

describe("SAT-06 evalscript do raster — executado em node:vm", () => {
  it("V3; entrada B04/B08/SCL/dataMask; saída 1 banda UINT8", () => {
    expect(EVALSCRIPT_RASTER_NDVI.startsWith("//VERSION=3")).toBe(true);
    expect(JSON.parse(JSON.stringify(setup()))).toEqual({ input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: { bands: 1, sampleType: "UINT8" } });
    expect(EVALSCRIPT_RASTER_NDVI).toContain(VERSAO_EVALSCRIPT_RASTER);
  });
  it("nuvem, sombra de nuvem, água e TODAS as classes excluídas do domínio → 0", () => {
    for (const [classe] of CLASSES_SCL_EXCLUIDAS) expect(byte(comNdvi(0.7, { SCL: classe })), `SCL ${classe}`).toBe(0);
    expect(CLASSES_SCL_EXCLUIDAS.map(([c]) => c)).toEqual(expect.arrayContaining([3, 6, 8, 9])); // sombra, água, nuvens
  });
  it("fora do polígono / sem dado (dataMask 0), reflectância negativa e soma ≤ 0 → 0", () => {
    expect(byte(comNdvi(0.7, { dataMask: 0 }))).toBe(0);
    expect(byte({ B04: -0.01, B08: 0.4, SCL: 4, dataMask: 1 })).toBe(0);
    expect(byte({ B04: 0.1, B08: -0.01, SCL: 4, dataMask: 1 })).toBe(0);
    expect(byte({ B04: 0, B08: 0, SCL: 4, dataMask: 1 })).toBe(0);
  });
  it("classes MANTIDAS (2, 4, 5, 7) têm valor (≥ 1), mesmo com NDVI baixo", () => {
    for (const classe of [2, 4, 5, 7]) expect(byte(comNdvi(0.05, { SCL: classe })), `SCL ${classe}`).toBeGreaterThanOrEqual(1);
  });
  it("bordas da escala: NDVI = mín → 1, NDVI = máx → 255; abaixo satura em 1 (não vira 0 = sem valor)", () => {
    expect(byte(comNdvi(ESCALA_NDVI_RASTER.min))).toBe(1);
    expect(byte({ B04: 0, B08: 0.5, SCL: 4, dataMask: 1 })).toBe(255); // NDVI = 1,0 = máx
    expect(byte(comNdvi(-0.9))).toBe(1);
    expect(byte(comNdvi(-0.2 + MEIO_DEGRAU * 0.9))).toBe(1);
    expect(byte(comNdvi(-0.2 + MEIO_DEGRAU * 1.1))).toBe(2);
  });
  it("NDVI conhecido → byte esperado: 1 + round((ndvi + 0,2) / 1,2 × 254)", () => {
    for (const [ndvi, esperado] of [[0.8, 213], [0, 43], [0.5, 149], [0.2, 86], [0.6, 170], [-0.1, 22]] as const) {
      expect(byte(comNdvi(ndvi)), `NDVI ${ndvi}`).toBe(esperado);
      expect(esperado).toBe(1 + Math.round(((ndvi - ESCALA_NDVI_RASTER.min) / (ESCALA_NDVI_RASTER.max - ESCALA_NDVI_RASTER.min)) * 254));
    }
  });
  it("codificar → decodificar volta ao NDVI dentro de MEIO degrau (≈ 0,0024) em toda a escala", () => {
    let pior = 0;
    for (let k = 0; k <= 2400; k++) {
      const ndvi = ESCALA_NDVI_RASTER.min + (k / 2400) * (ESCALA_NDVI_RASTER.max - ESCALA_NDVI_RASTER.min);
      const v = decodificarValor(byte(comNdvi(ndvi)), ESCALA_NDVI_RASTER.min, ESCALA_NDVI_RASTER.max)!;
      pior = Math.max(pior, Math.abs(v - ndvi));
    }
    expect(MEIO_DEGRAU).toBeCloseTo(0.0023622, 6);
    expect(pior).toBeLessThanOrEqual(MEIO_DEGRAU + 1e-9);
    expect(pior).toBeGreaterThan(MEIO_DEGRAU * 0.9); // a amostragem chegou perto do pior caso (não é verde vazio)
  });
  it("a lista SCL e a escala do script SÃO as do domínio / da constante (interpoladas, não redigitadas)", () => {
    const scl = /var SCL_EXCLUIDAS = \[([^\]]*)\]/.exec(EVALSCRIPT_RASTER_NDVI);
    expect(scl![1]!.split(",").map((s) => Number(s.trim()))).toEqual(CLASSES_SCL_EXCLUIDAS.map(([c]) => c));
    expect(Number(/var ESCALA_MIN = ([^;]+);/.exec(EVALSCRIPT_RASTER_NDVI)![1])).toBe(ESCALA_NDVI_RASTER.min);
    expect(Number(/var ESCALA_MAX = ([^;]+);/.exec(EVALSCRIPT_RASTER_NDVI)![1])).toBe(ESCALA_NDVI_RASTER.max);
    expect(ESCALA_REEXPORTADA).toBe(ESCALA_NDVI_RASTER);
  });
});

describe("SAT-06 decodificarValor", () => {
  it("0 → null (sem valor nunca vira número); 1 → mín; 255 → máx; 128 → meio da escala", () => {
    const { min, max } = ESCALA_NDVI_RASTER;
    expect(decodificarValor(0, min, max)).toBeNull();
    expect(decodificarValor(1, min, max)).toBe(min);
    expect(decodificarValor(255, min, max)).toBeCloseTo(max, 12);
    expect(decodificarValor(128, min, max)).toBeCloseTo((min + max) / 2, 12);
  });
  it("byte fora de 0..255, não inteiro, ou escala invertida LANÇA", () => {
    for (const b of [-1, 256, 1.5, Number.NaN]) expect(() => decodificarValor(b, -0.2, 1)).toThrow(RangeError);
    expect(() => decodificarValor(10, 1, -0.2)).toThrow(RangeError);
  });
});

// ---------------- PNG ----------------

const TABELA = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = TABELA[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Bloco PNG com CRC correto (para montar PNGs fora do contrato que só o conteúdo torna inválidos). */
function bloco(tipo: string, dados: Buffer): Buffer {
  const t = Buffer.from(tipo, "latin1");
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, c]);
}
function ihdr(largura: number, altura: number, o: { profundidade?: number; cor?: number; entrelacado?: number } = {}): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(largura, 0); d.writeUInt32BE(altura, 4);
  d[8] = o.profundidade ?? 8; d[9] = o.cor ?? 0; d[12] = o.entrelacado ?? 0;
  return bloco("IHDR", d);
}
/** Codifica as linhas com o FILTRO pedido por linha (0–4), como um codificador adaptativo faria. */
function idatComFiltros(largura: number, altura: number, pixels: Uint8Array, filtros: number[]): Buffer {
  const bruto = Buffer.alloc(altura * (largura + 1));
  const px = (x: number, y: number) => (x < 0 || y < 0 ? 0 : pixels[y * largura + x]!);
  for (let y = 0; y < altura; y++) {
    const f = filtros[y % filtros.length]!;
    bruto[y * (largura + 1)] = f;
    for (let x = 0; x < largura; x++) {
      const a = px(x - 1, y), b = px(x, y - 1), c = px(x - 1, y - 1), v = px(x, y);
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      bruto[y * (largura + 1) + 1 + x] = (v - pred) & 0xff;
    }
  }
  return bloco("IDAT", deflateSync(bruto));
}
const IEND = bloco("IEND", Buffer.alloc(0));
const aleatorio = (n: number, semente = 7) => { const p = new Uint8Array(n); let s = semente; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; p[i] = s & 0xff; } return p; };

describe("SAT-06 PNG cinza 8 bits — escrever → ler idêntico", () => {
  it("vários tamanhos (1×1, 3×7, 300×200, 2500×3): pixels, largura e altura voltam iguais", () => {
    for (const [l, a] of [[1, 1], [3, 7], [300, 200], [2500, 3]] as const) {
      const pixels = aleatorio(l * a, l + a);
      const png = escreverPngCinza8(l, a, pixels);
      expect(temAssinaturaPng(png)).toBe(true);
      const lido = lerPngCinza8(png);
      expect([lido.largura, lido.altura]).toEqual([l, a]);
      expect(Buffer.from(lido.pixels).equals(Buffer.from(pixels))).toBe(true);
    }
  });
  it("lê os filtros 0–4 por linha (o que um codificador adaptativo, como o do provedor, produz)", () => {
    const [l, a] = [37, 23];
    const pixels = aleatorio(l * a, 99);
    for (const filtros of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
      const png = Buffer.concat([ASSINATURA_PNG, ihdr(l, a), idatComFiltros(l, a, pixels, filtros), IEND]);
      expect(Buffer.from(lerPngCinza8(png).pixels).equals(Buffer.from(pixels)), `filtros ${filtros}`).toBe(true);
    }
  });
  it("IDAT dividido em vários blocos e bloco auxiliar (tEXt) são aceitos", () => {
    const pixels = aleatorio(40 * 10);
    const idat = idatComFiltros(40, 10, pixels, [0]);
    const z = idat.subarray(8, idat.length - 4);
    const png = Buffer.concat([ASSINATURA_PNG, ihdr(40, 10), bloco("tEXt", Buffer.from("Software\0teste", "latin1")), bloco("IDAT", z.subarray(0, 5)), bloco("IDAT", z.subarray(5)), IEND]);
    expect(Buffer.from(lerPngCinza8(png).pixels).equals(Buffer.from(pixels))).toBe(true);
  });
  it("escritor recusa dimensão inválida, quantidade errada de pixels e valor fora de 0..255", () => {
    expect(() => escreverPngCinza8(0, 1, [])).toThrow(RangeError);
    expect(() => escreverPngCinza8(2, 2, [1, 2, 3])).toThrow(RangeError);
    expect(() => escreverPngCinza8(1, 1, [256])).toThrow(RangeError);
  });
});

describe("SAT-06 PNG — o leitor RECUSA o que não é PNG cinza 8 bits sem entrelaçamento", () => {
  const pixels = aleatorio(8 * 8);
  const valido = () => Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), idatComFiltros(8, 8, pixels, [0]), IEND]);
  const recusa = (png: Buffer, motivo: RegExp) => {
    let erro: unknown;
    try { lerPngCinza8(png); } catch (e) { erro = e; }
    expect(erro, String(motivo)).toBeInstanceOf(ErroPng);
    expect((erro as ErroPng).motivo).toMatch(motivo);
  };
  it("premissa: o PNG montado à mão é aceito", () => {
    expect(lerPngCinza8(valido()).largura).toBe(8);
  });
  it("tipo de cor ≠ 0 (RGB, cinza+alfa, paleta)", () => {
    for (const cor of [2, 3, 4, 6]) recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8, { cor }), idatComFiltros(8, 8, pixels, [0]), IEND]), /cor/);
  });
  it("profundidade ≠ 8 (1, 2, 4, 16)", () => {
    for (const profundidade of [1, 2, 4, 16]) recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8, { profundidade }), idatComFiltros(8, 8, pixels, [0]), IEND]), /profundidade/);
  });
  it("entrelaçado (Adam7)", () => {
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8, { entrelacado: 1 }), idatComFiltros(8, 8, pixels, [0]), IEND]), /entrela/);
  });
  it("assinatura errada, vazio e JSON no lugar da imagem", () => {
    const v = valido(); v[1] = 0x51;
    recusa(v, /assinatura/);
    recusa(Buffer.alloc(0), /assinatura/);
    recusa(Buffer.from('{"error":{"status":400}}'), /assinatura/);
  });
  it("CRC errado, bloco truncado, sem IEND, dados depois do IEND, IHDR fora do lugar", () => {
    const crcErrado = valido(); crcErrado[crcErrado.length - 20] = crcErrado[crcErrado.length - 20]! ^ 0xff; // dentro do IDAT
    recusa(crcErrado, /CRC/);
    recusa(valido().subarray(0, valido().length - 6), /truncado/);
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), idatComFiltros(8, 8, pixels, [0])]), /IEND ausente/);
    recusa(Buffer.concat([valido(), Buffer.from([0])]), /depois do IEND/);
    recusa(Buffer.concat([ASSINATURA_PNG, idatComFiltros(8, 8, pixels, [0]), ihdr(8, 8), IEND]), /IHDR/);
  });
  it("PLTE, bloco crítico desconhecido, IDAT não consecutivo, filtro de linha 5, tamanho de dados diferente do IHDR", () => {
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("PLTE", Buffer.alloc(3)), idatComFiltros(8, 8, pixels, [0]), IEND]), /paleta/);
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("XYZW", Buffer.alloc(1)), idatComFiltros(8, 8, pixels, [0]), IEND]), /crítico/);
    const idat = idatComFiltros(8, 8, pixels, [0]);
    const z = idat.subarray(8, idat.length - 4);
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("IDAT", z.subarray(0, 4)), bloco("tEXt", Buffer.from("a\0b")), bloco("IDAT", z.subarray(4)), IEND]), /consecutivo/);
    const bruto = Buffer.alloc(8 * 9); bruto[0] = 5;
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("IDAT", deflateSync(bruto)), IEND]), /filtro/);
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 9), idatComFiltros(8, 8, pixels, [0]), IEND]), /tamanho/);
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("IDAT", Buffer.from("não é zlib")), IEND]), /ilegível/);
  });
  it("dimensões ESPERADAS (as pedidas): iguais → lê; IHDR diferente → recusa", () => {
    expect(lerPngCinza8(valido(), { largura: 8, altura: 8 }).pixels).toHaveLength(64);
    for (const esperado of [{ largura: 9, altura: 8 }, { largura: 8, altura: 7 }]) {
      let erro: unknown;
      try { lerPngCinza8(valido(), esperado); } catch (e) { erro = e; }
      expect((erro as ErroPng).motivo, JSON.stringify(esperado)).toBe("dimensões diferentes das pedidas");
    }
  });
  it("IHDR hostil (16384 × 16384) com as dimensões esperadas: recusa ANTES de descomprimir (sem esperado, chegaria ao inflate)", () => {
    const hostil = Buffer.concat([ASSINATURA_PNG, ihdr(16_384, 16_384), bloco("IDAT", Buffer.from("não é zlib")), IEND]);
    // sem `esperado` o leitor só descobre o problema NO inflate (e com IDAT válido inflaria até ~268 MB)
    let semEsperado: unknown;
    try { lerPngCinza8(hostil); } catch (e) { semEsperado = e; }
    expect((semEsperado as ErroPng).motivo).toBe("IDAT ilegível");
    // com `esperado` a recusa é no cabeçalho: o motivo prova que o inflate nem começou
    let comEsperado: unknown;
    try { lerPngCinza8(hostil, { largura: 2500, altura: 2500 }); } catch (e) { comEsperado = e; }
    expect(comEsperado).toBeInstanceOf(ErroPng);
    expect((comEsperado as ErroPng).motivo).toBe("dimensões diferentes das pedidas");
  });
  it("bomba de descompressão: dados que inflam muito além do IHDR são recusados sem alocar tudo", () => {
    const enorme = deflateSync(Buffer.alloc(50 * 1024 * 1024)); // 50 MiB de zeros, alguns KB comprimidos
    recusa(Buffer.concat([ASSINATURA_PNG, ihdr(8, 8), bloco("IDAT", enorme), IEND]), /ilegível|tamanho/);
  });
});
