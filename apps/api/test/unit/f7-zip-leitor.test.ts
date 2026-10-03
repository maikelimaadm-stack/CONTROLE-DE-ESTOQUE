import { describe, it, expect } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import { xmlDoZip, pareceZip, LIMITE_XML_DO_ZIP_BYTES, MENSAGEM_DA_RECUSA_DO_ZIP } from "../../src/lib/zip-leitor.js";

/**
 * OPERACOES-01 F7 (decisão 284) — O LEITOR ESTREITO DE ZIP (`lib/zip-leitor.ts`): um único XML, sem dependência nova.
 *
 * Os ZIPs são MONTADOS AQUI, byte a byte (cabeçalho local, dados, diretório central e registro de fim), com
 * `deflateRawSync` e `crc32` do próprio Node — nada de arquivo de fora. Cada caso afirma a PREMISSA do ZIP montado
 * (o método, a flag, o tamanho declarado) junto da conclusão do leitor.
 */

interface Entrada { nome: string; conteudo: Buffer | string; metodo?: 0 | 8; flags?: number; descomprimidoDeclarado?: number }

function zip(entradas: Entrada[]): Buffer {
  const locais: Buffer[] = []; const centrais: Buffer[] = []; let deslocamento = 0;
  for (const e of entradas) {
    const dados = typeof e.conteudo === "string" ? Buffer.from(e.conteudo, "utf8") : e.conteudo;
    const metodo = e.metodo ?? 8;
    const gravado = metodo === 8 ? deflateRawSync(dados) : dados;
    const nome = Buffer.from(e.nome, "utf8");
    const crc = crc32(dados) >>> 0;
    const flags = (e.flags ?? 0) | 0x0800;
    const descomprimido = e.descomprimidoDeclarado ?? dados.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(gravado.length, 18); local.writeUInt32LE(descomprimido, 22); local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(metodo, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(gravado.length, 20); central.writeUInt32LE(descomprimido, 24);
    central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nome, gravado); centrais.push(central, nome);
    deslocamento += 30 + nome.length + gravado.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

const XML = '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe/></nfeProc>';
/** Os campos do diretório central da 1ª entrada, lidos do ZIP montado (a premissa de cada caso). */
const central = (b: Buffer) => { const p = b.readUInt32LE(b.length - 22 + 16); return { flags: b.readUInt16LE(p + 8), metodo: b.readUInt16LE(p + 10), descomprimido: b.readUInt32LE(p + 24) }; };

describe("leitor de ZIP da importação de NF-e", () => {
  it("guardado (método 0) e comprimido (método 8): devolve o XML exato e o nome sem a pasta", () => {
    for (const metodo of [0, 8] as const) {
      const b = zip([{ nome: `notas/NFe-${metodo}.xml`, conteudo: XML, metodo }]);
      expect(pareceZip(b), "premissa: o arquivo começa como ZIP").toBe(true);
      expect(central(b).metodo, "premissa: o método gravado é o do caso").toBe(metodo);
      const r = xmlDoZip(b);
      expect(r).toEqual({ ok: true, nome: `NFe-${metodo}.xml`, conteudo: Buffer.from(XML, "utf8") });
    }
  });

  it("o PDF e a pasta __MACOSX ao lado são ignorados; o único XML é lido", () => {
    const b = zip([{ nome: "danfe.pdf", conteudo: "%PDF-1.4 sintético" }, { nome: "__MACOSX/._nota.xml", conteudo: "lixo" }, { nome: "nota.XML", conteudo: XML }]);
    const r = xmlDoZip(b);
    expect(r.ok && r.nome).toBe("nota.XML");
  });

  it("dois XMLs = recusa (nunca 'o primeiro'); nenhum XML = recusa; as duas com a mensagem do ZIP de um único XML", () => {
    const dois = zip([{ nome: "a.xml", conteudo: XML }, { nome: "b.xml", conteudo: XML }]);
    expect(xmlDoZip(dois)).toEqual({ ok: false, motivo: "varios_xml" });
    const nenhum = zip([{ nome: "danfe.pdf", conteudo: "%PDF" }]);
    expect(xmlDoZip(nenhum)).toEqual({ ok: false, motivo: "sem_xml" });
    expect(MENSAGEM_DA_RECUSA_DO_ZIP.varios_xml).toBe("O ZIP precisa ter um único XML de NF-e.");
    expect(MENSAGEM_DA_RECUSA_DO_ZIP.sem_xml).toBe("O ZIP precisa ter um único XML de NF-e.");
  });

  it("entrada criptografada (bit 0 da flag) = recusa, sem tentar abrir", () => {
    const b = zip([{ nome: "nota.xml", conteudo: XML, flags: 0x0001 }]);
    expect(central(b).flags & 1, "premissa: a flag de criptografia está ligada").toBe(1);
    expect(xmlDoZip(b)).toEqual({ ok: false, motivo: "zip_criptografado" });
  });

  it("bomba de compressão: o tamanho declarado acima do limite recusa; declarado pequeno e inflado grande para no teto", () => {
    const grande = Buffer.alloc(LIMITE_XML_DO_ZIP_BYTES + 1024, 0x20);
    const declarado = zip([{ nome: "nota.xml", conteudo: grande }]);
    expect(central(declarado).descomprimido, "premissa: o diretório declara mais que o limite").toBeGreaterThan(LIMITE_XML_DO_ZIP_BYTES);
    expect(xmlDoZip(declarado)).toEqual({ ok: false, motivo: "zip_grande" });
    // O diretório MENTE o tamanho (diz 10 bytes): o inflate para em limite + 1 e recusa — nunca descompacta tudo.
    const mentiroso = zip([{ nome: "nota.xml", conteudo: grande, descomprimidoDeclarado: 10 }]);
    expect(central(mentiroso).descomprimido, "premissa: o diretório declara 10 bytes").toBe(10);
    expect(mentiroso.length, "premissa: comprimido, o arquivo é pequeno").toBeLessThan(10_000);
    expect(xmlDoZip(mentiroso)).toEqual({ ok: false, motivo: "zip_grande" });
  });

  it("CRC errado e estrutura truncada = ZIP inválido", () => {
    const b = zip([{ nome: "nota.xml", conteudo: XML, metodo: 0 }]);
    const adulterado = Buffer.from(b);
    adulterado[30 + "nota.xml".length] = adulterado[30 + "nota.xml".length]! ^ 0xff; // 1º byte dos dados
    expect(xmlDoZip(b).ok, "premissa: o ZIP íntegro é lido").toBe(true);
    expect(xmlDoZip(adulterado)).toEqual({ ok: false, motivo: "zip_invalido" });
    expect(xmlDoZip(b.subarray(0, b.length - 5))).toEqual({ ok: false, motivo: "zip_invalido" });
  });

  it("ZIP64 (contagem no teto do registro de fim) = recusa", () => {
    const b = Buffer.from(zip([{ nome: "nota.xml", conteudo: XML }]));
    b.writeUInt16LE(0xffff, b.length - 22 + 8); b.writeUInt16LE(0xffff, b.length - 22 + 10);
    expect(xmlDoZip(b)).toEqual({ ok: false, motivo: "zip64" });
  });

  it("XML puro não parece ZIP", () => {
    expect(pareceZip(Buffer.from(XML, "utf8"))).toBe(false);
  });
});
