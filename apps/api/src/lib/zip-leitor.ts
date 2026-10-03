/**
 * OPERACOES-01 F7 (decisão 284) — O XML DE NF-e DENTRO DE UM ZIP, lido no SERVIDOR, sem dependência nova.
 *
 * Um leitor ESTREITO, feito para uma pergunta só: "este ZIP traz exatamente UM XML? me dê os bytes dele". Não é um
 * descompactador geral, e por isso recusa tudo o que não precisa entender:
 *
 *   · o mapa do arquivo é o DIRETÓRIO CENTRAL (achado pelo registro de fim, procurado de trás para frente, como manda o
 *     formato) — nunca a varredura dos cabeçalhos locais, que um ZIP montado de má-fé faz mentir;
 *   · ZIP64 (contagem, tamanho ou deslocamento no teto de 16/32 bits) → `zip64`; entrada CRIPTOGRAFADA (bit 0 da flag)
 *     → `zip_criptografado`; método que não é 0 (guardado) nem 8 (deflate) → `metodo_nao_suportado`;
 *   · entradas que contam: arquivos (nunca diretório) fora de `__MACOSX/`, com a extensão `.xml` (qualquer caixa); o PDF
 *     ao lado é ignorado. Nenhum `.xml` → `sem_xml`; mais de um → `varios_xml` (nunca "o primeiro");
 *   · o XML descompactado tem no máximo `limite` bytes (padrão 2 MiB, o do XML guardado): o tamanho DECLARADO acima
 *     disso já recusa, e o `inflateRawSync` roda com `maxOutputLength = limite + 1` — a bomba de compressão para no
 *     limite em vez de encher a memória (`zip_grande`);
 *   · o CRC-32 e o tamanho descompactado têm de bater com o diretório central; qualquer estrutura fora do lugar
 *     (assinatura, deslocamento além do arquivo, dados sobrepostos ao diretório) → `zip_invalido`.
 *
 * FUNÇÃO PURA sobre o Buffer: sem disco, sem rede, sem relógio. Quem chama decide a mensagem e o status (422).
 */
import { crc32, inflateRawSync } from "node:zlib";

/** O maior XML aceito dentro do ZIP (os mesmos 2 MiB do XML guardado, `notas_fiscais_xml.tamanho_bytes`). */
export const LIMITE_XML_DO_ZIP_BYTES = 2_097_152;
/** Entradas demais no diretório central são recusadas antes de percorrê-las (o ZIP de uma nota tem poucas). */
export const LIMITE_ENTRADAS_DO_ZIP = 1000;

export type MotivoDaRecusaDoZip =
  | "zip_invalido" | "zip64" | "zip_criptografado" | "metodo_nao_suportado" | "zip_grande" | "sem_xml" | "varios_xml";

export const MENSAGEM_DA_RECUSA_DO_ZIP: Readonly<Record<MotivoDaRecusaDoZip, string>> = {
  zip_invalido: "O arquivo ZIP está corrompido ou fora do formato.",
  zip64: "ZIP no formato estendido (ZIP64) não é aceito: compacte só o XML da nota.",
  zip_criptografado: "O ZIP está protegido por senha: envie o XML sem senha.",
  metodo_nao_suportado: "O ZIP usa um método de compressão que não é aceito: compacte o XML no formato padrão (deflate).",
  zip_grande: "O XML dentro do ZIP passa do tamanho aceito (2 MB).",
  sem_xml: "O ZIP precisa ter um único XML de NF-e.",
  varios_xml: "O ZIP precisa ter um único XML de NF-e.",
};

export type ResultadoDoZip = { ok: true; nome: string; conteudo: Buffer } | { ok: false; motivo: MotivoDaRecusaDoZip };

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
const TAMANHO_FIM = 22;
const TAMANHO_CENTRAL = 46;
const TAMANHO_LOCAL = 30;
const MAX_COMENTARIO = 0xffff;

/** O arquivo começa como um ZIP (cabeçalho local, ou o ZIP vazio que é só o registro de fim)? */
export function pareceZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
    && ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06));
}

interface EntradaCentral { nome: string; flags: number; metodo: number; crc: number; comprimido: number; descomprimido: number; deslocamento: number }

const recusa = (motivo: MotivoDaRecusaDoZip): ResultadoDoZip => ({ ok: false, motivo });

/** O registro de fim do diretório central: o ÚLTIMO com a assinatura, dentro da janela do comentário. */
function acharFim(buf: Buffer): number {
  const inicio = Math.max(0, buf.length - TAMANHO_FIM - MAX_COMENTARIO);
  for (let p = buf.length - TAMANHO_FIM; p >= inicio; p--) {
    if (buf.readUInt32LE(p) === ASSINATURA_FIM && p + TAMANHO_FIM + buf.readUInt16LE(p + 20) === buf.length) return p;
  }
  return -1;
}

const ehXml = (nome: string) => !nome.endsWith("/") && !nome.startsWith("__MACOSX/") && !nome.includes("/__MACOSX/") && /\.xml$/i.test(nome);

/**
 * O ÚNICO XML do ZIP, descompactado e conferido (CRC-32 e tamanho). `limite` = o maior XML aceito, em bytes.
 */
export function xmlDoZip(buf: Buffer, o: { limite?: number } = {}): ResultadoDoZip {
  const limite = o.limite ?? LIMITE_XML_DO_ZIP_BYTES;
  if (buf.length < TAMANHO_FIM) return recusa("zip_invalido");
  const fim = acharFim(buf);
  if (fim < 0) return recusa("zip_invalido");
  const disco = buf.readUInt16LE(fim + 4);
  const discoDoDiretorio = buf.readUInt16LE(fim + 6);
  const entradasNoDisco = buf.readUInt16LE(fim + 8);
  const totalDeEntradas = buf.readUInt16LE(fim + 10);
  const tamanhoDoDiretorio = buf.readUInt32LE(fim + 12);
  const inicioDoDiretorio = buf.readUInt32LE(fim + 16);
  if (totalDeEntradas === 0xffff || tamanhoDoDiretorio === 0xffffffff || inicioDoDiretorio === 0xffffffff) return recusa("zip64");
  // ZIP partido em volumes não é o arquivo de uma nota.
  if (disco !== 0 || discoDoDiretorio !== 0 || entradasNoDisco !== totalDeEntradas) return recusa("zip_invalido");
  if (totalDeEntradas > LIMITE_ENTRADAS_DO_ZIP) return recusa("zip_invalido");
  if (inicioDoDiretorio + tamanhoDoDiretorio > fim) return recusa("zip_invalido");

  const entradas: EntradaCentral[] = [];
  let p = inicioDoDiretorio;
  for (let k = 0; k < totalDeEntradas; k++) {
    if (p + TAMANHO_CENTRAL > fim || buf.readUInt32LE(p) !== ASSINATURA_CENTRAL) return recusa("zip_invalido");
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const descomprimido = buf.readUInt32LE(p + 24);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const deslocamento = buf.readUInt32LE(p + 42);
    const fimDaEntrada = p + TAMANHO_CENTRAL + tamNome + tamExtra + tamComentario;
    if (fimDaEntrada > fim) return recusa("zip_invalido");
    if (comprimido === 0xffffffff || descomprimido === 0xffffffff || deslocamento === 0xffffffff) return recusa("zip64");
    const bytesDoNome = buf.subarray(p + TAMANHO_CENTRAL, p + TAMANHO_CENTRAL + tamNome);
    // Bit 11: nome em UTF-8; sem ele, o nome é lido byte a byte (o que importa aqui é só a extensão).
    const nome = (flags & 0x0800) !== 0 ? bytesDoNome.toString("utf8") : bytesDoNome.toString("latin1");
    entradas.push({ nome: nome.replace(/\\/g, "/"), flags, metodo, crc, comprimido, descomprimido, deslocamento });
    p = fimDaEntrada;
  }

  const xmls = entradas.filter((e) => ehXml(e.nome));
  if (xmls.length === 0) return recusa("sem_xml");
  if (xmls.length > 1) return recusa("varios_xml");
  const e = xmls[0]!;
  if ((e.flags & 0x0001) !== 0) return recusa("zip_criptografado");
  if (e.metodo !== 0 && e.metodo !== 8) return recusa("metodo_nao_suportado");
  if (e.descomprimido > limite) return recusa("zip_grande");

  // Os dados: depois do cabeçalho LOCAL da entrada (que tem o próprio nome e extra), e antes do diretório central.
  if (e.deslocamento + TAMANHO_LOCAL > inicioDoDiretorio || buf.readUInt32LE(e.deslocamento) !== ASSINATURA_LOCAL) return recusa("zip_invalido");
  const inicioDosDados = e.deslocamento + TAMANHO_LOCAL + buf.readUInt16LE(e.deslocamento + 26) + buf.readUInt16LE(e.deslocamento + 28);
  const fimDosDados = inicioDosDados + e.comprimido;
  if (fimDosDados > inicioDoDiretorio) return recusa("zip_invalido");
  const dados = buf.subarray(inicioDosDados, fimDosDados);

  let conteudo: Buffer;
  if (e.metodo === 0) {
    if (e.comprimido !== e.descomprimido) return recusa("zip_invalido");
    conteudo = Buffer.from(dados);
  } else {
    try {
      conteudo = inflateRawSync(dados, { maxOutputLength: limite + 1 });
    } catch (falha) {
      // O teto da saída estourou: a bomba parou no limite, sem encher a memória.
      if ((falha as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return recusa("zip_grande");
      return recusa("zip_invalido");
    }
  }
  if (conteudo.length > limite) return recusa("zip_grande");
  if (conteudo.length !== e.descomprimido || (crc32(conteudo) >>> 0) !== e.crc) return recusa("zip_invalido");
  const nome = e.nome.split("/").pop() ?? e.nome;
  return { ok: true, nome, conteudo };
}
