/**
 * PNG CINZA DE 8 BITS — leitor ESTRITO e escritor mínimo, só com `node:zlib` (SAT-06, decisão 297).
 *
 * O raster de valores do NDVI (1 banda, UINT8) chega do provedor como PNG em tons de cinza. Antes de guardar ou servir,
 * a API LÊ a imagem por inteiro: se ela não é exatamente o que foi pedido (assinatura, cabeçalho, CRC, dados), não é
 * a imagem — e quem chamou trata como resposta fora do contrato. Nada é "consertado".
 *
 * `lerPngCinza8` aceita SÓ: assinatura PNG; IHDR primeiro, com cor 0 (cinza), profundidade 8, compressão 0, filtro 0
 * e SEM entrelaçamento; CRC de todo bloco conferido; blocos IDAT consecutivos; IEND vazio e último (nada depois);
 * blocos auxiliares (primeira letra minúscula) ignorados; bloco crítico desconhecido ou PLTE recusados. Os dados são
 * descomprimidos com teto de saída (sem "bomba" de descompressão) e o tamanho tem de ser EXATAMENTE altura × (1 +
 * largura); os filtros 0–4 de cada linha são desfeitos. Com `esperado`, as dimensões do IHDR têm de ser as pedidas
 * (conferidas antes da descompressão). Fora disso, LANÇA `ErroPng`.
 *
 * `escreverPngCinza8` grava com filtro 0 em todas as linhas — para o emulador de teste e os testes.
 */
import { deflateSync, inflateSync } from "node:zlib";

export const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Lado máximo aceito na leitura (o raster pede no máximo 2500; o teto protege a memória de um PNG hostil). */
export const LADO_MAXIMO_PNG_PX = 16_384;

export class ErroPng extends Error {
  constructor(readonly motivo: string) {
    super(`PNG fora do contrato: ${motivo}`);
    this.name = "ErroPng";
  }
}

export interface PngCinza8 { largura: number; altura: number; pixels: Uint8Array }

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Começa com a assinatura PNG? (conferência barata; quem decide se a imagem serve é `lerPngCinza8`) */
export function temAssinaturaPng(buf: Uint8Array): boolean {
  if (buf.length < ASSINATURA_PNG.length) return false;
  for (let i = 0; i < ASSINATURA_PNG.length; i++) if (buf[i] !== ASSINATURA_PNG[i]) return false;
  return true;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * `esperado` (as dimensões PEDIDAS ao provedor): IHDR diferente LANÇA logo ao ler o cabeçalho, ANTES de descomprimir —
 * um PNG hostil que declara 16384 × 16384 não chega a inflar centenas de MB. Sem `esperado`, o teto é
 * `LADO_MAXIMO_PNG_PX` por lado.
 */
export function lerPngCinza8(png: Buffer, esperado?: { largura: number; altura: number }): PngCinza8 {
  const entrada: unknown = png;
  if (!(entrada instanceof Uint8Array)) throw new ErroPng("não é binário");
  const b = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada.buffer, entrada.byteOffset, entrada.byteLength);
  if (!temAssinaturaPng(b)) throw new ErroPng("assinatura");
  let pos = ASSINATURA_PNG.length;
  let cabecalho: { largura: number; altura: number } | null = null;
  const idat: Buffer[] = [];
  let idatEncerrado = false;
  let fim = false;
  while (pos < b.length) {
    if (fim) throw new ErroPng("dados depois do IEND");
    if (pos + 12 > b.length) throw new ErroPng("bloco truncado");
    const tamanho = b.readUInt32BE(pos);
    if (tamanho > 0x7fffffff || pos + 12 + tamanho > b.length) throw new ErroPng("bloco truncado");
    const tipo = b.toString("latin1", pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(tipo)) throw new ErroPng("tipo de bloco inválido");
    const dados = b.subarray(pos + 8, pos + 8 + tamanho);
    if (crc32(b.subarray(pos + 4, pos + 8 + tamanho)) !== b.readUInt32BE(pos + 8 + tamanho)) throw new ErroPng(`CRC do bloco ${tipo}`);
    pos += 12 + tamanho;

    if (!cabecalho) {
      if (tipo !== "IHDR" || tamanho !== 13) throw new ErroPng("IHDR ausente no início");
      const largura = dados.readUInt32BE(0), altura = dados.readUInt32BE(4);
      const [profundidade, cor, compressao, filtro, entrelacamento] = [dados[8], dados[9], dados[10], dados[11], dados[12]];
      if (largura < 1 || altura < 1 || largura > LADO_MAXIMO_PNG_PX || altura > LADO_MAXIMO_PNG_PX) throw new ErroPng("dimensões");
      if (cor !== 0) throw new ErroPng("tipo de cor diferente de cinza (0)");
      if (profundidade !== 8) throw new ErroPng("profundidade diferente de 8 bits");
      if (compressao !== 0 || filtro !== 0) throw new ErroPng("método de compressão/filtro");
      if (entrelacamento !== 0) throw new ErroPng("entrelaçado");
      if (esperado && (largura !== esperado.largura || altura !== esperado.altura)) throw new ErroPng("dimensões diferentes das pedidas");
      cabecalho = { largura, altura };
      continue;
    }
    if (tipo === "IHDR") throw new ErroPng("IHDR repetido");
    if (tipo === "IDAT") {
      if (idatEncerrado) throw new ErroPng("IDAT não consecutivo");
      idat.push(dados);
      continue;
    }
    if (idat.length) idatEncerrado = true;
    if (tipo === "IEND") {
      if (tamanho !== 0) throw new ErroPng("IEND com dados");
      fim = true;
      continue;
    }
    if (tipo === "PLTE") throw new ErroPng("paleta em imagem cinza");
    // Bit de "crítico" = primeira letra maiúscula. Crítico desconhecido muda a leitura: recusa.
    if (tipo.charCodeAt(0) < 0x61) throw new ErroPng(`bloco crítico desconhecido ${tipo}`);
  }
  if (!cabecalho) throw new ErroPng("IHDR ausente");
  if (!fim) throw new ErroPng("IEND ausente");
  if (!idat.length) throw new ErroPng("IDAT ausente");

  const { largura, altura } = cabecalho;
  const linha = largura + 1;
  const bytesEsperados = altura * linha;
  let bruto: Buffer;
  try {
    bruto = inflateSync(Buffer.concat(idat), { maxOutputLength: bytesEsperados + 1 });
  } catch {
    throw new ErroPng("IDAT ilegível");
  }
  if (bruto.length !== bytesEsperados) throw new ErroPng("tamanho dos dados");

  const pixels = new Uint8Array(largura * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * linha]!;
    const origem = y * linha + 1;
    const destino = y * largura;
    const anterior = destino - largura; // só lido quando y > 0
    for (let x = 0; x < largura; x++) {
      const cru = bruto[origem + x]!;
      const a = x > 0 ? pixels[destino + x - 1]! : 0;
      const c = y > 0 && x > 0 ? pixels[anterior + x - 1]! : 0;
      const bAcima = y > 0 ? pixels[anterior + x]! : 0;
      let v: number;
      switch (filtro) {
        case 0: v = cru; break;
        case 1: v = cru + a; break;
        case 2: v = cru + bAcima; break;
        case 3: v = cru + ((a + bAcima) >> 1); break;
        case 4: v = cru + paeth(a, bAcima, c); break;
        default: throw new ErroPng(`filtro de linha ${filtro}`);
      }
      pixels[destino + x] = v & 0xff;
    }
  }
  return { largura, altura, pixels };
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(dados.length, 0);
  cabeca.write(tipo, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabeca.subarray(4), dados])), 0);
  return Buffer.concat([cabeca, dados, crc]);
}

export function escreverPngCinza8(largura: number, altura: number, pixels: ArrayLike<number>): Buffer {
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1 || largura > LADO_MAXIMO_PNG_PX || altura > LADO_MAXIMO_PNG_PX) {
    throw new RangeError("dimensões do PNG fora do contrato");
  }
  if (pixels.length !== largura * altura) throw new RangeError("quantidade de pixels diferente de largura × altura");
  const bruto = Buffer.alloc(altura * (largura + 1));
  for (let y = 0; y < altura; y++) {
    // byte 0 da linha = filtro 0 (nenhum), já zerado
    for (let x = 0; x < largura; x++) {
      const v = pixels[y * largura + x]!;
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError("pixel fora de 0..255");
      bruto[y * (largura + 1) + 1 + x] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 0; // cinza
  return Buffer.concat([ASSINATURA_PNG, bloco("IHDR", ihdr), bloco("IDAT", deflateSync(bruto)), bloco("IEND", Buffer.alloc(0))]);
}
