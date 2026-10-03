/**
 * OPERACOES-01 F7 (decisão 284) — o leitor de XML e a leitura da NF-e no servidor.
 * XMLs SINTÉTICOS (f7-nfe-sintetica.ts): CNPJs e chaves inventados, DV calculado no próprio teste.
 * Cada teste afirma a PREMISSA (o que o XML de entrada tem) junto da CONCLUSÃO (o que a leitura devolve).
 */
import { describe, expect, it } from "vitest";
import {
  CSTAT_AUTORIZADA,
  LIMITE_XML_CARACTERES,
  LIMITE_XML_NOS,
  LIMITE_XML_PROFUNDIDADE,
  MENSAGEM_DA_RECUSA_NFE,
  chaveDeAcessoValida,
  digitoDaChaveDeAcesso,
  filho,
  filhosChamados,
  formatarChaveDeAcesso,
  lerNotaFiscalEletronica,
  lerXml,
  textoEm,
  validarCnpj,
  type LeituraDaNfe,
  type MotivoDaRecusaNfe,
  type NotaFiscalLida
} from "../src/index.js";
import {
  CNPJ_DESTINATARIO_SINTETICO,
  CNPJ_EMITENTE_SINTETICO,
  ITEM_SIMPLES,
  chaveSintetica,
  cpfComDv,
  nfeSintetica,
  xmlComDuplicatas,
  xmlComRastro,
  xmlSimples
} from "./f7-nfe-sintetica.js";

function nota(l: LeituraDaNfe): NotaFiscalLida {
  if (!l.ok) throw new Error(`leitura recusada: ${JSON.stringify(l.recusas)}`);
  return l.nota;
}
function motivos(l: LeituraDaNfe): MotivoDaRecusaNfe[] {
  if (l.ok) throw new Error("a leitura deveria ter sido recusada");
  return l.recusas.map((r) => r.motivo);
}

describe("F7 — leitor de XML (sem DOM, sem dependência)", () => {
  it("lê nome LOCAL, atributos (aspas simples e duplas), entidades predefinidas e numéricas, CDATA; ignora comentário e PI; tira o BOM", () => {
    const texto = "﻿<?xml version='1.0'?>\n<!-- c --><?estilo x?><n:raiz xmlns:n=\"urn:x\" a='1' b=\"&lt;&amp;&#65;&#x42;\">"
      + "<n:filho>  um &quot;dois&quot; &apos;3&apos; </n:filho><filho><![CDATA[<cru & sem entidade>]]></filho><vazio/></n:raiz>";
    expect(texto.charCodeAt(0)).toBe(0xFEFF); // premissa: começa com BOM e usa prefixo de namespace
    const r = lerXml(texto);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.raiz.nome).toBe("raiz");
    expect(r.raiz.atributos).toEqual({ "xmlns:n": "urn:x", a: "1", b: "<&AB" });
    expect(filhosChamados(r.raiz, "filho").map((f) => f.texto)).toEqual(["  um \"dois\" '3' ", "<cru & sem entidade>"]);
    expect(textoEm(r.raiz, "filho")).toBe("um \"dois\" '3'");
    expect(textoEm(r.raiz, "vazio")).toBe("");
    expect(textoEm(r.raiz, "nao_existe")).toBeNull();
    expect(textoEm(r.raiz, "filho", "neto")).toBeNull();
    expect(filho(r.raiz, "vazio")?.filhos).toEqual([]);
  });

  it("recusa DOCTYPE e ENTITY em qualquer lugar (xml_inseguro), antes de interpretar qualquer coisa", () => {
    expect(lerXml("<!DOCTYPE a><a/>")).toEqual({ ok: false, motivo: "xml_inseguro" });
    expect(lerXml("<a><b>texto</b><!ENTITY x \"y\"></a>")).toEqual({ ok: false, motivo: "xml_inseguro" });
    expect(lerXml("<a><![CDATA[ <!doctype dentro do cdata ]]></a>")).toEqual({ ok: false, motivo: "xml_inseguro" });
  });

  it("recusa XML malformado (xml_invalido): entidade desconhecida, tag aberta, fechamento trocado, duas raízes, texto fora, atributo repetido, declaração fora do início", () => {
    const casos = [
      "<a>&nbsp;</a>", "<a>& solto</a>", "<a>&#0;</a>", "<a><b></a>", "<a></b>", "<a/><b/>", "texto<a/>", "<a/>texto",
      "<a x='1' x='2'/>", "<a x='<'/>", "<a x=1/>", "<a/><?xml version='1.0'?>", "<a><!-- sem fim</a>", "", "<a", "<a x='1'y='2'/>"
    ];
    for (const c of casos) expect(lerXml(c), c).toEqual({ ok: false, motivo: "xml_invalido" });
    // premissa do contraste: o mesmo formato, bem escrito, passa
    expect(lerXml("<a x='1' y='2'><b/>texto</a>").ok).toBe(true);
  });

  it("limites: caracteres e elementos → xml_grande; profundidade → xml_invalido", () => {
    const grande = `<a>${"x".repeat(LIMITE_XML_CARACTERES)}</a>`;
    expect(grande.length).toBeGreaterThan(LIMITE_XML_CARACTERES);
    expect(lerXml(grande)).toEqual({ ok: false, motivo: "xml_grande" });

    const muitos = `<a>${"<b/>".repeat(LIMITE_XML_NOS)}</a>`; // raiz + LIMITE filhos = LIMITE + 1 elementos
    expect(muitos.length).toBeLessThan(LIMITE_XML_CARACTERES);
    expect(lerXml(muitos)).toEqual({ ok: false, motivo: "xml_grande" });
    expect(lerXml(`<a>${"<b/>".repeat(LIMITE_XML_NOS - 1)}</a>`).ok).toBe(true);

    const fundo = (n: number) => "<a>".repeat(n) + "</a>".repeat(n);
    expect(lerXml(fundo(LIMITE_XML_PROFUNDIDADE)).ok).toBe(true);
    expect(lerXml(fundo(LIMITE_XML_PROFUNDIDADE + 1))).toEqual({ ok: false, motivo: "xml_invalido" });
  });
});

describe("F7 — chave de acesso (módulo 11, pesos 2..9 da direita)", () => {
  it("DV calculado à mão em exemplos pequenos", () => {
    const zeros = (n: number) => "0".repeat(n);
    // ...0001: 1×2 = 2; 2 mod 11 = 2 → 11 − 2 = 9
    expect(digitoDaChaveDeAcesso(`${zeros(42)}1`)).toBe(9);
    // ...0010: 1×3 = 3 → 11 − 3 = 8
    expect(digitoDaChaveDeAcesso(`${zeros(41)}10`)).toBe(8);
    // ...31: 3×3 + 1×2 = 11; resto 0 → 0
    expect(digitoDaChaveDeAcesso(`${zeros(41)}31`)).toBe(0);
    // ...40: 4×3 = 12; resto 1 → 0
    expect(digitoDaChaveDeAcesso(`${zeros(41)}40`)).toBe(0);
    // 1 na 9ª posição da direita: o peso volta a 2 (2,3,4,5,6,7,8,9,2) → 2 → 9
    expect(digitoDaChaveDeAcesso(`${zeros(34)}100000000`)).toBe(9);
    // 1 na 8ª posição da direita: peso 9 → 9 mod 11 = 9 → 11 − 9 = 2
    expect(digitoDaChaveDeAcesso(`${zeros(35)}10000000`)).toBe(2);
    // 43 dígitos "1": Σ pesos = 5 ciclos de 2..9 (5 × 44 = 220) + 2 + 3 + 4 = 229; 229 mod 11 = 9 → 11 − 9 = 2
    // (o exemplo feito à mão que os E2E da F7 usavam — a conta pura mora aqui, não num spec do navegador)
    expect(digitoDaChaveDeAcesso("1".repeat(43))).toBe(2);
    expect(() => digitoDaChaveDeAcesso("123")).toThrow(RangeError);
  });

  it("chaveDeAcessoValida: 44 dígitos e DV; a chave sintética passa e qualquer DV trocado falha", () => {
    const chave = chaveSintetica({ cnpj: CNPJ_EMITENTE_SINTETICO, nNF: "77" });
    expect(chave).toMatch(/^\d{44}$/);
    expect(chave.slice(20, 22)).toBe("55");
    expect(chaveDeAcessoValida(chave)).toBe(true);
    for (let d = 0; d <= 9; d++) if (String(d) !== chave[43]) expect(chaveDeAcessoValida(chave.slice(0, 43) + d)).toBe(false);
    expect(chaveDeAcessoValida(chave.slice(0, 43))).toBe(false);
    expect(chaveDeAcessoValida(`${chave.slice(0, 43)}X`)).toBe(false);
    expect(formatarChaveDeAcesso(chave).split(" ")).toHaveLength(11);
    expect(formatarChaveDeAcesso(chave).replace(/ /g, "")).toBe(chave);
  });
});

describe("F7 — os 3 XMLs sintéticos lidos campo a campo", () => {
  it("premissa: emitente e destinatário sintéticos têm CNPJ válido (DV calculado no teste)", () => {
    expect(validarCnpj(CNPJ_EMITENTE_SINTETICO)).toBe(true);
    expect(validarCnpj(CNPJ_DESTINATARIO_SINTETICO)).toBe(true);
    expect(CSTAT_AUTORIZADA).toEqual(["100", "150"]);
  });

  it("XML 1 (simples): cabeçalho, protocolo, emitente, destinatário, item e totais", () => {
    const x = xmlSimples();
    expect(x.xml).toContain("<!-- sintética -->"); // premissa: comentário, entidade (&amp;) e CDATA no XML
    expect(x.xml).toContain("&amp; Cia");
    const n = nota(lerNotaFiscalEletronica(x.xml));
    expect(n.chave).toBe(x.chave);
    expect({ versao: n.versao, modelo: n.modelo, serie: n.serie, numero: n.numero, dataEmissao: n.dataEmissao, naturezaOperacao: n.naturezaOperacao,
      finalidade: n.finalidade, tipoOperacao: n.tipoOperacao, ufEmitente: n.ufEmitente }).toEqual({
      versao: "4.00", modelo: "55", serie: "1", numero: "1001", dataEmissao: "2026-09-15", naturezaOperacao: "Venda de produção do estabelecimento",
      finalidade: "1", tipoOperacao: "1", ufEmitente: "GO" });
    expect(n.protocolo).toEqual({ cStat: "100", numero: "152260000000001", recebidoEm: "2026-09-15T10:31:00-03:00" });
    expect(n.emitente).toEqual({
      documento: CNPJ_EMITENTE_SINTETICO, tipo: "cnpj", nome: "Insumos Sintéticos & Cia Ltda", fantasia: "Sintética", ie: "1234567890", uf: "GO",
      endereco: { logradouro: "Rua Inventada", numero: "100", bairro: "Centro", codigoMunicipio: "5208707", municipio: "Goiânia", cep: "74000000", telefone: "6230000000" }
    });
    expect(n.destinatario).toEqual({ documento: CNPJ_DESTINATARIO_SINTETICO, tipo: "cnpj", nome: "Empresa Sintética Destino", ie: "ISENTO" });
    expect(ITEM_SIMPLES.unidade).toBe("sc"); // premissa: uCom em minúsculas no XML
    expect(n.itens).toEqual([{
      nItem: 1, codigo: "INS-001", ean: null, descricao: "Insumo sintético A", ncm: "31052000", cfop: "5102", unidade: "SC",
      quantidade: "10.0000", valorUnitario: "150.0000000000", valorProdutos: "1500.00", desconto: "0.00", frete: "0.00", seguro: "0.00",
      outras: "0.00", ipi: "0.00", icmsSt: "0.00", icms: "180.00", xPed: null, nItemPed: null, rastro: []
    }]);
    expect(n.totais).toEqual({ produtos: "1500.00", desconto: "0.00", frete: "0.00", seguro: "0.00", outras: "0.00", ipi: "0.00", icmsSt: "0.00",
      icms: "180.00", ii: "0.00", icmsDesonerado: "0.00", ipiDevolvido: "0.00", nota: "1500.00" });
    expect(n.fatura).toBeNull();
    expect(n.duplicatas).toEqual([]);
    expect(n.xPedCabecalho).toBeNull();
    expect(n.informacoesComplementares).toBe("Nota sintética de teste <sem valor fiscal>");
  });

  it("XML 2 (fatura e duplicatas): fatura, parcelas, xPed do cabeçalho e do item, desconto e frete, EAN pelo cEANTrib", () => {
    const x = xmlComDuplicatas();
    expect(x.vNF).toBe("1540.00"); // premissa: 1000 + 500 − 10 (desconto) + 50 (frete)
    const n = nota(lerNotaFiscalEletronica(x.xml));
    expect(n.numero).toBe("1002");
    expect(n.chave).toBe(x.chave);
    expect(n.itens.map((i) => ({ nItem: i.nItem, codigo: i.codigo, ean: i.ean, unidade: i.unidade, quantidade: i.quantidade, valorProdutos: i.valorProdutos,
      desconto: i.desconto, frete: i.frete, xPed: i.xPed, nItemPed: i.nItemPed }))).toEqual([
      { nItem: 1, codigo: "INS-001", ean: "7890000000017", unidade: "SC", quantidade: "10.0000", valorProdutos: "1000.00", desconto: "0.00", frete: "50.00", xPed: "PC-000123", nItemPed: 1 },
      { nItem: 2, codigo: "INS-002", ean: "7890000000024", unidade: "UN", quantidade: "5.0000", valorProdutos: "500.00", desconto: "10.00", frete: "0.00", xPed: null, nItemPed: null }
    ]);
    expect(n.totais).toMatchObject({ produtos: "1500.00", desconto: "10.00", frete: "50.00", nota: "1540.00" });
    expect(n.fatura).toEqual({ numero: "1002", valorOriginal: "1540.00", desconto: "0.00", liquido: "1540.00" });
    expect(n.duplicatas).toEqual([
      { numero: "001", vencimento: "2026-10-15", valor: "770.00" },
      { numero: "002", vencimento: "2026-11-15", valor: "770.00" }
    ]);
    expect(n.xPedCabecalho).toBe("PC-000123");
  });

  it("XML 3 (rastro de 2 lotes, IPI e ICMS-ST): lotes, validade, IPI do item, ST = vICMSST + vFCPST, seguro", () => {
    const x = xmlComRastro();
    expect(x.xml).toContain("<vICMSST>50.00</vICMSST><vFCPST>5.00</vFCPST>"); // premissa: ST em duas parcelas no XML
    expect(x.xml).toContain("<uCom> fr </uCom>");
    const n = nota(lerNotaFiscalEletronica(x.xml));
    const [item] = n.itens;
    expect(n.itens).toHaveLength(1);
    expect(item).toMatchObject({ codigo: "VAC-010", unidade: "FR", quantidade: "100.0000", valorUnitario: "20.0000000000", valorProdutos: "2000.00",
      desconto: "20.00", seguro: "10.00", ipi: "100.00", icmsSt: "55.00", ean: null });
    expect(item!.rastro).toEqual([
      { lote: "LT-A1", quantidade: "60.000", fabricacao: "2026-08-01", validade: "2027-08-01" },
      { lote: "LT-B2", quantidade: "40.000", fabricacao: "2026-08-10", validade: "2027-08-10" }
    ]);
    expect(n.totais).toEqual({ produtos: "2000.00", desconto: "20.00", frete: "0.00", seguro: "10.00", outras: "0.00", ipi: "100.00", icmsSt: "55.00",
      icms: "0.00", ii: "0.00", icmsDesonerado: "0.00", ipiDevolvido: "0.00", nota: "2145.00" });
  });

  it("cStat 150 (autorizada fora do prazo) também entra; destinatário com CPF lê o tipo cpf", () => {
    const cpf = cpfComDv("731846025"); // base inventada, DV calculado no construtor
    const n = nota(lerNotaFiscalEletronica(nfeSintetica({ cStat: "150", destinatario: { cpf, nome: "Produtor Sintético" } }).xml));
    expect(n.protocolo.cStat).toBe("150");
    expect(n.destinatario).toEqual({ documento: cpf, tipo: "cpf", nome: "Produtor Sintético", ie: null });
  });

  it("duplicata sem vencimento não vira parcela: a nota fica sem duplicatas (a pessoa usa a condição)", () => {
    const x = nfeSintetica({ duplicatas: [{ numero: "001", vencimento: "2026-10-15", valor: "750.00" }, { numero: "002", valor: "750.00" }] });
    expect(x.xml).toContain("<dup><nDup>002</nDup><vDup>750.00</vDup></dup>"); // premissa
    expect(nota(lerNotaFiscalEletronica(x.xml)).duplicatas).toEqual([]);
  });
});

describe("F7 — cada recusa com o seu motivo (mensagem PT-BR e caminho)", () => {
  const unico = (l: LeituraDaNfe, motivo: MotivoDaRecusaNfe, caminho?: string) => {
    expect(motivos(l)).toEqual([motivo]);
    if (!l.ok) {
      expect(l.recusas[0]!.mensagem).toBe(MENSAGEM_DA_RECUSA_NFE[motivo]);
      if (caminho !== undefined) expect(l.recusas[0]!.caminho).toBe(caminho);
    }
  };

  it("premissa do contraste: o XML padrão do construtor é aceito", () => {
    expect(lerNotaFiscalEletronica(nfeSintetica().xml).ok).toBe(true);
  });

  it("cStat 101 → nao_autorizada", () => {
    const x = nfeSintetica({ cStat: "101" });
    expect(x.xml).toContain("<cStat>101</cStat>");
    unico(lerNotaFiscalEletronica(x.xml), "nao_autorizada", "protNFe/infProt/cStat");
  });

  it("tpAmb 2 → ambiente_homologacao, com a mensagem do contrato", () => {
    const x = nfeSintetica({ tpAmb: "2" });
    expect(x.xml).toContain("<tpAmb>2</tpAmb>");
    unico(lerNotaFiscalEletronica(x.xml), "ambiente_homologacao", "NFe/infNFe/ide/tpAmb");
    expect(MENSAGEM_DA_RECUSA_NFE.ambiente_homologacao).toBe("A nota é de homologação (tpAmb 2): só nota de produção (tpAmb 1) é importada.");
  });

  it("mod 65 → modelo_nao_aceito; modelo 65 DENTRO da chave → chave_invalida", () => {
    unico(lerNotaFiscalEletronica(nfeSintetica({ mod: "65" }).xml), "modelo_nao_aceito", "NFe/infNFe/ide/mod");
    const x = nfeSintetica({ modNaChave: "65" });
    expect(chaveDeAcessoValida(x.chave)).toBe(true); // premissa: DV certo, só o modelo da chave é outro
    unico(lerNotaFiscalEletronica(x.xml), "chave_invalida", "NFe/infNFe/@Id");
  });

  it("DV errado → chave_invalida", () => {
    const x = nfeSintetica({ dvErrado: true });
    expect(chaveDeAcessoValida(x.chave)).toBe(false);
    unico(lerNotaFiscalEletronica(x.xml), "chave_invalida", "NFe/infNFe/@Id");
  });

  it("Id fora do formato \"NFe\" + chave → chave_invalida", () => {
    const certa = nfeSintetica().chave;
    unico(lerNotaFiscalEletronica(nfeSintetica({ id: certa }).xml), "chave_invalida", "NFe/infNFe/@Id");
  });

  it("Id com outra chave válida (≠ a do protocolo) → chave_divergente", () => {
    const outra = chaveSintetica({ cnpj: CNPJ_EMITENTE_SINTETICO, nNF: "9999" });
    expect(chaveDeAcessoValida(outra)).toBe(true);
    unico(lerNotaFiscalEletronica(nfeSintetica({ id: `NFe${outra}` }).xml), "chave_divergente", "protNFe/infProt/chNFe");
  });

  it("chNFe do protocolo diferente → chave_divergente", () => {
    const outra = chaveSintetica({ cnpj: CNPJ_EMITENTE_SINTETICO, nNF: "9999" });
    unico(lerNotaFiscalEletronica(nfeSintetica({ chaveDoProtocolo: outra }).xml), "chave_divergente", "protNFe/infProt/chNFe");
  });

  it("finNFe 4 (devolução) → devolucao_fora", () => {
    unico(lerNotaFiscalEletronica(nfeSintetica({ finNFe: "4" }).xml), "devolucao_fora", "NFe/infNFe/ide/finNFe");
  });

  it("DOCTYPE → xml_inseguro", () => {
    const x = nfeSintetica({ doctype: true });
    expect(x.xml).toContain("<!DOCTYPE");
    unico(lerNotaFiscalEletronica(x.xml), "xml_inseguro", "");
  });

  it("entidade desconhecida → xml_invalido", () => {
    const xml = nfeSintetica().xml.replace("Empresa Sintética Destino", "Empresa&nbsp;Sintética");
    expect(xml).toContain("&nbsp;");
    unico(lerNotaFiscalEletronica(xml), "xml_invalido", "");
  });

  it("raiz NFe, sem o envelope e sem o protocolo → sem_protocolo; outra raiz → nao_e_nfe_processada", () => {
    const x = nfeSintetica({ raiz: "NFe" });
    expect(x.xml).not.toContain("protNFe");
    unico(lerNotaFiscalEletronica(x.xml), "sem_protocolo", "protNFe/infProt");
    unico(lerNotaFiscalEletronica("<?xml version=\"1.0\"?><resNFe><chNFe>1</chNFe></resNFe>"), "nao_e_nfe_processada", "resNFe");
  });

  it("emitente com CNPJ de DV errado → emitente_invalido; destinatário estrangeiro → destinatario_invalido", () => {
    const errado = `${CNPJ_EMITENTE_SINTETICO.slice(0, 13)}${(Number(CNPJ_EMITENTE_SINTETICO[13]) + 1) % 10}`;
    expect(validarCnpj(errado)).toBe(false);
    // a chave continua com o CNPJ certo: só o grupo do emitente muda
    const x = nfeSintetica().xml.replace(`<CNPJ>${CNPJ_EMITENTE_SINTETICO}</CNPJ>`, `<CNPJ>${errado}</CNPJ>`);
    unico(lerNotaFiscalEletronica(x), "emitente_invalido", "NFe/infNFe/emit");
    unico(lerNotaFiscalEletronica(nfeSintetica({ destinatario: { idEstrangeiro: "AB123", nome: "Estrangeiro" } }).xml), "destinatario_invalido", "NFe/infNFe/dest");
  });

  it("sem det → sem_itens", () => {
    const xml = nfeSintetica().xml.replace(/<det nItem="1">.*<\/det>/, "");
    expect(xml).not.toContain("<det");
    unico(lerNotaFiscalEletronica(xml), "sem_itens", "NFe/infNFe/det");
  });

  it("decimal fora do formato → valor_invalido no caminho do campo (vírgula na quantidade; 3 casas em valor)", () => {
    unico(lerNotaFiscalEletronica(nfeSintetica({ itens: [{ ...ITEM_SIMPLES, quantidade: "10,5" }] }).xml), "valor_invalido", "NFe/infNFe/det[1]/prod/qCom");
    const xml = nfeSintetica().xml.replace("<vNF>1500.00</vNF>", "<vNF>1500.005</vNF>");
    expect(xml).toContain("<vNF>1500.005</vNF>");
    unico(lerNotaFiscalEletronica(xml), "valor_invalido", "NFe/infNFe/total/ICMSTot/vNF");
  });

  it("data inexistente → data_invalida (vencimento 30/02; emissão fora do formato)", () => {
    const l = lerNotaFiscalEletronica(nfeSintetica({ duplicatas: [{ numero: "001", vencimento: "2026-02-30", valor: "1500.00" }] }).xml);
    unico(l, "data_invalida", "NFe/infNFe/cobr/dup[1]/dVenc");
    unico(lerNotaFiscalEletronica(nfeSintetica({ dhEmi: "15/09/2026" }).xml), "data_invalida", "NFe/infNFe/ide/dhEmi");
  });

  it("várias falhas juntas: todas as recusas que couberem voltam de uma vez", () => {
    const l = lerNotaFiscalEletronica(nfeSintetica({ cStat: "101", tpAmb: "2", finNFe: "4" }).xml);
    expect(motivos(l).sort()).toEqual(["ambiente_homologacao", "devolucao_fora", "nao_autorizada"]);
  });
});
