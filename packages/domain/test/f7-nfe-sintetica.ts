/**
 * OPERACOES-01 F7 (decisão 284) — CONSTRUTOR DE XML DE NF-e SINTÉTICO para os testes do domínio.
 *
 * Tudo aqui é INVENTADO: CNPJs e chaves de acesso são montados a partir de bases fictícias e recebem o dígito
 * verificador calculado AQUI (as contas são reescritas neste arquivo, sem usar o código testado). Nenhum dado de nota
 * real. O layout segue o leiaute público da NF-e 4.00 só no que o leitor usa.
 */
import { D, money } from "@agro/shared";

/** DV de CNPJ (pesos 5..2,9..2 e 6..2,9..2; resto < 2 → 0). Conta reescrita aqui de propósito. */
export function cnpjComDv(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error("base do CNPJ tem 12 dígitos");
  const dv = (s: string, pesos: number[]) => { const r = pesos.reduce((a, p, i) => a + Number(s[i]) * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

/** DV de CPF (pesos 10..2 e 11..2; resto < 2 → 0). Conta reescrita aqui de propósito. */
export function cpfComDv(base9: string): string {
  if (!/^\d{9}$/.test(base9)) throw new Error("base do CPF tem 9 dígitos");
  const dv = (s: string) => { const r = [...s].reduce((a, c, i) => a + Number(c) * (s.length + 1 - i), 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(base9 + d1)}`;
}

/** DV da chave (módulo 11, pesos 2..9 da direita para a esquerda). Conta reescrita aqui de propósito. */
export function dvDaChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export interface PartesDaChave { cUF?: string; aamm?: string; cnpj: string; mod?: string; serie?: string; nNF?: string; tpEmis?: string; cNF?: string }

/** Chave de 44 posições com o DV calculado: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) DV(1). */
export function chaveSintetica(p: PartesDaChave): string {
  const base = `${p.cUF ?? "52"}${p.aamm ?? "2609"}${p.cnpj}${p.mod ?? "55"}${(p.serie ?? "1").padStart(3, "0")}`
    + `${(p.nNF ?? "1").padStart(9, "0")}${p.tpEmis ?? "1"}${p.cNF ?? "12345678"}`;
  if (base.length !== 43) throw new Error("chave sem o DV precisa de 43 posições");
  return `${base}${dvDaChave(base)}`;
}

/** Emitente e destinatário inventados (bases fictícias, DV calculado). */
export const CNPJ_EMITENTE_SINTETICO = cnpjComDv("381745290001");
export const CNPJ_DESTINATARIO_SINTETICO = cnpjComDv("627193840001");

export interface RastroSintetico { lote: string; quantidade: string; fabricacao?: string; validade?: string }
export interface ItemSintetico {
  codigo: string; descricao: string; unidade: string; quantidade: string; valorUnitario: string; valorProdutos: string;
  ean?: string; eanTrib?: string; ncm?: string; cfop?: string; desconto?: string; frete?: string; seguro?: string; outras?: string;
  icms?: string; icmsSt?: string; fcpSt?: string; ipi?: string; xPed?: string; nItemPed?: string; rastro?: RastroSintetico[];
}

export interface OpcoesNfeSintetica {
  raiz?: "nfeProc" | "NFe";
  numero?: string; serie?: string; dhEmi?: string;
  emitenteCnpj?: string; emitenteNome?: string; emitenteUf?: string;
  destinatario?: { cnpj?: string; cpf?: string; idEstrangeiro?: string; nome?: string; ie?: string };
  itens?: ItemSintetico[];
  totais?: { ii?: string; icmsDesonerado?: string; ipiDevolvido?: string; vNF?: string };
  fatura?: { numero: string; original: string; desconto: string; liquido: string };
  duplicatas?: { numero?: string; vencimento?: string; valor: string }[];
  xPedCabecalho?: string;
  tpAmb?: string; cStat?: string; mod?: string; finNFe?: string;
  /** Prefixa um DOCTYPE com ENTITY (XXE): o leitor tem de recusar. */
  doctype?: boolean;
  /** Troca o DV da chave (no Id e no protocolo). */
  dvErrado?: boolean;
  /** Valor literal de infNFe/@Id (sobrepõe "NFe"+chave). */
  id?: string;
  /** Valor literal de protNFe/infProt/chNFe (sobrepõe a chave). */
  chaveDoProtocolo?: string;
  /** Modelo gravado DENTRO da chave (posições 21-22). */
  modNaChave?: string;
  cNF?: string;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (nome: string, valor: string | undefined) => (valor === undefined ? "" : `<${nome}>${esc(valor)}</${nome}>`);
const soma = (vs: (string | undefined)[]) => vs.reduce((a, v) => a.plus(D(v ?? 0)), D(0));

export const ITEM_SIMPLES: ItemSintetico = {
  codigo: "INS-001", descricao: "Insumo sintético A", unidade: "sc", quantidade: "10.0000", valorUnitario: "150.0000000000",
  valorProdutos: "1500.00", ean: "SEM GTIN", ncm: "31052000", cfop: "5102", icms: "180.00"
};

export function nfeSintetica(o: OpcoesNfeSintetica = {}): { xml: string; chave: string; vNF: string } {
  const emitente = o.emitenteCnpj ?? CNPJ_EMITENTE_SINTETICO;
  const numero = o.numero ?? "1001";
  const serie = o.serie ?? "1";
  let chave = chaveSintetica({ cnpj: emitente, mod: o.modNaChave ?? "55", serie, nNF: numero, cNF: o.cNF ?? "12345678" });
  if (o.dvErrado) chave = chave.slice(0, 43) + String((Number(chave[43]) + 1) % 10);
  const itens = o.itens ?? [ITEM_SIMPLES];

  const vProd = soma(itens.map((i) => i.valorProdutos));
  const vDesc = soma(itens.map((i) => i.desconto));
  const vFrete = soma(itens.map((i) => i.frete));
  const vSeg = soma(itens.map((i) => i.seguro));
  const vOutro = soma(itens.map((i) => i.outras));
  const vIPI = soma(itens.map((i) => i.ipi));
  const vST = soma(itens.map((i) => i.icmsSt));
  const vFCPST = soma(itens.map((i) => i.fcpSt));
  const vICMS = soma(itens.map((i) => i.icms));
  const calculado = vProd.minus(vDesc).plus(vFrete).plus(vSeg).plus(vOutro).plus(vIPI).plus(vST).plus(vFCPST)
    .plus(D(o.totais?.ii ?? 0)).plus(D(o.totais?.ipiDevolvido ?? 0)).minus(D(o.totais?.icmsDesonerado ?? 0));
  const vNF = o.totais?.vNF ?? money(calculado);

  const dets = itens.map((i, k) => {
    const rastro = (i.rastro ?? []).map((r) => `<rastro>${tag("nLote", r.lote)}${tag("qLote", r.quantidade)}${tag("dFab", r.fabricacao)}${tag("dVal", r.validade)}</rastro>`).join("");
    const icms = `<ICMS><ICMS10><orig>0</orig><CST>10</CST>${tag("vICMS", i.icms)}${tag("vICMSST", i.icmsSt)}${tag("vFCPST", i.fcpSt)}</ICMS10></ICMS>`;
    const ipi = i.ipi === undefined ? "" : `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST>${tag("vIPI", i.ipi)}</IPITrib></IPI>`;
    return `<det nItem="${k + 1}"><prod>${tag("cProd", i.codigo)}${tag("cEAN", i.ean)}${tag("xProd", i.descricao)}${tag("NCM", i.ncm)}`
      + `${tag("CFOP", i.cfop)}${tag("uCom", i.unidade)}${tag("qCom", i.quantidade)}${tag("vUnCom", i.valorUnitario)}${tag("vProd", i.valorProdutos)}`
      + `${tag("cEANTrib", i.eanTrib)}${tag("vFrete", i.frete)}${tag("vSeg", i.seguro)}${tag("vDesc", i.desconto)}${tag("vOutro", i.outras)}`
      + `${tag("xPed", i.xPed)}${tag("nItemPed", i.nItemPed)}${rastro}</prod><imposto>${icms}${ipi}</imposto></det>`;
  }).join("");

  const d = o.destinatario ?? { cnpj: CNPJ_DESTINATARIO_SINTETICO, nome: "Empresa Sintética Destino", ie: "ISENTO" };
  const dest = `<dest>${tag("CNPJ", d.cnpj)}${tag("CPF", d.cpf)}${tag("idEstrangeiro", d.idEstrangeiro)}${tag("xNome", d.nome)}${tag("IE", d.ie)}</dest>`;
  const cobr = o.fatura || o.duplicatas
    ? `<cobr>${o.fatura ? `<fat>${tag("nFat", o.fatura.numero)}${tag("vOrig", o.fatura.original)}${tag("vDesc", o.fatura.desconto)}${tag("vLiq", o.fatura.liquido)}</fat>` : ""}`
      + `${(o.duplicatas ?? []).map((p) => `<dup>${tag("nDup", p.numero)}${tag("dVenc", p.vencimento)}${tag("vDup", p.valor)}</dup>`).join("")}</cobr>`
    : "";
  const infNFe = `<infNFe Id="${o.id ?? `NFe${chave}`}" versao="4.00">`
    + `<ide><cUF>52</cUF><cNF>${o.cNF ?? "12345678"}</cNF><natOp>Venda de produção do estabelecimento</natOp><mod>${o.mod ?? "55"}</mod>`
    + `<serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${o.dhEmi ?? "2026-09-15T10:30:00-03:00"}</dhEmi><tpNF>1</tpNF>`
    + `<tpAmb>${o.tpAmb ?? "1"}</tpAmb><finNFe>${o.finNFe ?? "1"}</finNFe></ide>`
    + `<emit><CNPJ>${emitente}</CNPJ><xNome>${o.emitenteNome ?? "Insumos Sintéticos &amp; Cia Ltda"}</xNome><xFant>Sintética</xFant>`
    + `<enderEmit><xLgr>Rua Inventada</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Goiânia</xMun>`
    + `<UF>${o.emitenteUf ?? "GO"}</UF><CEP>74000000</CEP><fone>6230000000</fone></enderEmit><IE>1234567890</IE></emit>`
    + `${dest}${dets}`
    + `<total><ICMSTot><vBC>0.00</vBC><vICMS>${money(vICMS)}</vICMS><vICMSDeson>${money(o.totais?.icmsDesonerado ?? "0")}</vICMSDeson>`
    + `<vST>${money(vST)}</vST><vFCPST>${money(vFCPST)}</vFCPST><vProd>${money(vProd)}</vProd><vFrete>${money(vFrete)}</vFrete><vSeg>${money(vSeg)}</vSeg>`
    + `<vDesc>${money(vDesc)}</vDesc><vII>${money(o.totais?.ii ?? "0")}</vII><vIPI>${money(vIPI)}</vIPI><vIPIDevol>${money(o.totais?.ipiDevolvido ?? "0")}</vIPIDevol>`
    + `<vOutro>${money(vOutro)}</vOutro><vNF>${vNF}</vNF></ICMSTot></total>`
    + cobr
    + `<infAdic><infCpl><![CDATA[Nota sintética de teste <sem valor fiscal>]]></infCpl></infAdic>`
    + (o.xPedCabecalho ? `<compra><xPed>${esc(o.xPedCabecalho)}</xPed></compra>` : "")
    + `</infNFe>`;
  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${o.tpAmb ?? "1"}</tpAmb><chNFe>${o.chaveDoProtocolo ?? chave}</chNFe>`
    + `<dhRecbto>2026-09-15T10:31:00-03:00</dhRecbto><nProt>152260000000001</nProt><cStat>${o.cStat ?? "100"}</cStat>`
    + `<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const corpo = (o.raiz ?? "nfeProc") === "NFe" ? nfe : `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><!-- sintética -->${nfe}${prot}</nfeProc>`;
  const doctype = o.doctype ? `<!DOCTYPE nfeProc [<!ENTITY externo SYSTEM "file:///etc/hostname">]>` : "";
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>${doctype}\n${corpo}\n`, chave, vNF };
}

/** XML 1 — simples: um item, sem cobrança. vNF = 1500.00. */
export function xmlSimples(): { xml: string; chave: string; vNF: string } {
  return nfeSintetica();
}

/** XML 2 — com fatura e duas duplicatas; dois itens (um com desconto), frete no item, xPed no cabeçalho e no item. vNF = 1540.00. */
export function xmlComDuplicatas(): { xml: string; chave: string; vNF: string } {
  return nfeSintetica({
    numero: "1002",
    cNF: "23456789",
    xPedCabecalho: "PC-000123",
    itens: [
      { codigo: "INS-001", descricao: "Insumo sintético A", unidade: "SC", quantidade: "10.0000", valorUnitario: "100.0000000000", valorProdutos: "1000.00",
        ean: "7890000000017", ncm: "31052000", cfop: "5102", frete: "50.00", xPed: "PC-000123", nItemPed: "1" },
      { codigo: "INS-002", descricao: "Insumo sintético B", unidade: "UN", quantidade: "5.0000", valorUnitario: "100.0000000000", valorProdutos: "500.00",
        ean: "SEM GTIN", eanTrib: "7890000000024", ncm: "38089199", cfop: "5102", desconto: "10.00" }
    ],
    fatura: { numero: "1002", original: "1540.00", desconto: "0.00", liquido: "1540.00" },
    duplicatas: [
      { numero: "001", vencimento: "2026-10-15", valor: "770.00" },
      { numero: "002", vencimento: "2026-11-15", valor: "770.00" }
    ]
  });
}

/** XML 3 — um item com rastro de 2 lotes, desconto, seguro, IPI e ICMS-ST (vICMSST + vFCPST). vNF = 2145.00. */
export function xmlComRastro(): { xml: string; chave: string; vNF: string } {
  return nfeSintetica({
    numero: "1003",
    cNF: "34567890",
    itens: [
      { codigo: "VAC-010", descricao: "Produto veterinário sintético", unidade: " fr ", quantidade: "100.0000", valorUnitario: "20.0000000000",
        valorProdutos: "2000.00", ncm: "30023000", cfop: "5102", desconto: "20.00", seguro: "10.00", ipi: "100.00", icmsSt: "50.00", fcpSt: "5.00",
        rastro: [
          { lote: "LT-A1", quantidade: "60.000", fabricacao: "2026-08-01", validade: "2027-08-01" },
          { lote: "LT-B2", quantidade: "40.000", fabricacao: "2026-08-10", validade: "2027-08-10" }
        ] }
    ]
  });
}
