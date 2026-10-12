/**
 * OPERACOES-01 F7 (decisão 284) — O XML DE NF-e SINTÉTICO DOS E2E DA IMPORTAÇÃO (e do skew da F7).
 *
 * Tudo aqui é INVENTADO: o CNPJ do emitente sai de uma base sorteada e a chave de acesso é montada com o número e o
 * código sorteados; os dígitos verificadores são calculados NESTE arquivo (as contas reescritas aqui, sem a função do
 * domínio que o servidor usa — senão o teste conferiria a conta com ela mesma). Nenhum dado de nota real. O leiaute
 * segue o público da NF-e 4.00 só no que o leitor do servidor usa (o mesmo desenho de
 * `packages/domain/test/f7-nfe-sintetica.ts`, que o pacote do domínio não exporta).
 *
 * O destinatário é o CNPJ das empresas do seed (`00000000000191`): as duas empresas da demonstração têm o mesmo
 * documento, e a escolha da empresa da compra é da pessoa (o servidor nunca escolhe "a primeira").
 */

/** O documento das empresas do seed (`packages/db/src/seed.ts`). */
export const CNPJ_DAS_EMPRESAS_DO_SEED = "00000000000191";

/** DV de CNPJ (módulo 11; pesos 2..9 da direita para a esquerda, reiniciando; resto < 2 → 0). */
export function dvDoCnpj(base: string): number {
  let soma = 0; let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
export const cnpjComDv = (base12: string) => { const d1 = dvDoCnpj(base12); return `${base12}${d1}${dvDoCnpj(`${base12}${d1}`)}`; };

/** DV da chave de acesso: módulo 11 sobre os 43 dígitos, pesos 2..9 da direita; resto 0 ou 1 → 0. */
export function dvDaChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const sorteio = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Um CNPJ de emitente inventado (base sorteada começando por 97), com os DVs certos. */
export const cnpjDeEmitenteSintetico = () => cnpjComDv(`97${sorteio(6)}0001`);

export interface OpcoesDaNotaSintetica {
  emitenteCnpj: string;
  emitenteNome: string;
  /** Ambiente: "1" produção (o padrão), "2" homologação (o servidor recusa). */
  tpAmb?: "1" | "2";
}

export interface NotaSintetica {
  xml: string; chave: string; numero: string; serie: string; emitenteCnpj: string;
  /** O item único: 10 CX × 100,00 = 1.000,00, com frete 30,00 e IPI 50,00 → vNF 1.080,00. */
  item: { codigo: string; descricao: string; unidade: string; quantidade: string; valorProdutos: string };
  vNF: string;
  duplicatas: { numero: string; vencimento: string; valor: string }[];
}

/**
 * A nota de compra sintética: UM item (10 CX × 100,00 = 1.000,00), frete 30,00 e IPI 50,00 no item → vNF 1.080,00;
 * fatura com líquido 1.080,00 e duas duplicatas de 540,00. Número, código numérico e emitente sorteados (cada chamada
 * é outra nota, com outra chave).
 */
export function notaSintetica(o: OpcoesDaNotaSintetica): NotaSintetica {
  const numero = String(Number(`1${sorteio(7)}`));
  const serie = "1";
  const cNF = sorteio(8);
  const c43 = `52` + `2609` + o.emitenteCnpj + `55` + serie.padStart(3, "0") + numero.padStart(9, "0") + `1` + cNF;
  if (!/^\d{43}$/.test(c43)) throw new Error("a chave sem o DV precisa de 43 dígitos");
  const chave = `${c43}${dvDaChave(c43)}`;
  const tpAmb = o.tpAmb ?? "1";
  const item = { codigo: "F7E2E-CX12", descricao: "Insumo sintético em caixa de 12", unidade: "CX", quantidade: "10.0000", valorProdutos: "1000.00" };
  const duplicatas = [{ numero: "001", vencimento: "2026-11-16", valor: "540.00" }, { numero: "002", vencimento: "2026-12-16", valor: "540.00" }];
  const det = `<det nItem="1"><prod><cProd>${item.codigo}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(item.descricao)}</xProd><NCM>31052000</NCM>`
    + `<CFOP>5102</CFOP><uCom>${item.unidade}</uCom><qCom>${item.quantidade}</qCom><vUnCom>100.0000000000</vUnCom><vProd>${item.valorProdutos}</vProd>`
    + `<cEANTrib>SEM GTIN</cEANTrib><uTrib>${item.unidade}</uTrib><qTrib>${item.quantidade}</qTrib><vUnTrib>100.0000000000</vUnTrib><vFrete>30.00</vFrete><indTot>1</indTot></prod>`
    + `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>0.00</vICMS></ICMS00></ICMS>`
    + `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vIPI>50.00</vIPI></IPITrib></IPI></imposto></det>`;
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">`
    + `<ide><cUF>52</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>${serie}</serie><nNF>${numero}</nNF>`
    + `<dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe></ide>`
    + `<emit><CNPJ>${o.emitenteCnpj}</CNPJ><xNome>${esc(o.emitenteNome)}</xNome><xFant>Sintética</xFant><enderEmit><xLgr>Rua Inventada</xLgr><nro>100</nro>`
    + `<xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Goiânia</xMun><UF>GO</UF><CEP>74000000</CEP><fone>6230000000</fone></enderEmit><IE>1234567890</IE></emit>`
    + `<dest><CNPJ>${CNPJ_DAS_EMPRESAS_DO_SEED}</CNPJ><xNome>Destinatário do seed</xNome></dest>`
    + det
    + `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vST>0.00</vST><vFCPST>0.00</vFCPST><vProd>1000.00</vProd>`
    + `<vFrete>30.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>50.00</vIPI><vIPIDevol>0.00</vIPIDevol><vOutro>0.00</vOutro><vNF>1080.00</vNF></ICMSTot></total>`
    + `<cobr><fat><nFat>${numero}</nFat><vOrig>1080.00</vOrig><vDesc>0.00</vDesc><vLiq>1080.00</vLiq></fat>`
    + duplicatas.map((d) => `<dup><nDup>${d.numero}</nDup><dVenc>${d.vencimento}</dVenc><vDup>${d.valor}</vDup></dup>`).join("") + `</cobr>`
    + `<infAdic><infCpl>Nota sintética de teste, sem valor fiscal.</infCpl></infAdic></infNFe>`;
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-09-20T10:01:00-03:00</dhRecbto>`
    + `<nProt>152260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>${prot}</nfeProc>\n`;
  return { xml, chave, numero, serie, emitenteCnpj: o.emitenteCnpj, item, vNF: "1080.00", duplicatas };
}

/** O arquivo para o `setInputFiles` do Playwright. */
export const arquivoDaNota = (n: NotaSintetica, nome = `nfe-${n.numero}.xml`) => ({ name: nome, mimeType: "text/xml", buffer: Buffer.from(n.xml, "utf8") });

/** O mesmo arquivo em base64 (o corpo de `POST /api/compras/importacoes` pela API, nos cenários montados por ela). */
export const base64DaNota = (n: NotaSintetica) => Buffer.from(n.xml, "utf8").toString("base64");

/* ═══════════════════════════ XML-01 (decisão 312) — a nota de VÁRIOS itens ═══════════════════════════ */

/** DV do EAN-13 (GTIN-13): pesos 1 e 3 alternados a partir da esquerda sobre os 12 dígitos; DV = (10 − soma mod 10) mod 10. */
function dvDoEan13(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new Error("o EAN-13 sem o DV precisa de 12 dígitos");
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

/** Um EAN-13 inventado (prefixo 789 e 9 dígitos sorteados), com o DV calculado aqui. */
export const eanSintetico = () => { const base = `789${sorteio(9)}`; return `${base}${dvDoEan13(base)}`; };

/** Um item da nota de vários itens, como o caso o declara (texto decimal; `ean` nulo = "SEM GTIN"). */
export interface ItemDaNotaDeVariosItens {
  codigo: string; descricao: string; unidade: string; ncm: string; ean: string | null;
  /** qCom, até 4 casas. */ quantidade: string;
  /** vUnCom, até 10 casas. */ valorUnitario: string;
  /** vProd, 2 casas: tem de ser EXATAMENTE quantidade × valorUnitario (conferido aqui, em inteiros). */ valorProdutos: string;
}

export interface NotaSinteticaDeVariosItens {
  xml: string; chave: string; numero: string; serie: string; emitenteCnpj: string;
  itens: (ItemDaNotaDeVariosItens & { nItem: number })[];
  /** A soma dos vProd (sem frete, seguro, desconto, IPI ou ST). */
  vNF: string;
  /** Duas duplicatas que somam o vNF (a segunda leva o centavo ímpar). */
  duplicatas: { numero: string; vencimento: string; valor: string }[];
}

/** Texto decimal → inteiro escalado por 10^casas, sem ponto flutuante (mais casas que `casas` é erro, nunca arredonda). */
function inteiroEscalado(v: string, casas: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new Error(`decimal inválido: ${v}`);
  const fracao = m[2] ?? "";
  if (fracao.length > casas) throw new Error(`${v} tem mais de ${casas} casas`);
  return BigInt(`${m[1]}${fracao.padEnd(casas, "0")}`);
}
/** Centavos → texto com 2 casas. */
const deCentavos = (c: bigint) => { const s = c.toString().padStart(3, "0"); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
/** O texto decimal com exatamente `casas` casas (só completa com zeros). */
const comCasas = (v: string, casas: number) => { const [i, f = ""] = v.split("."); if (f.length > casas) throw new Error(`${v} tem mais de ${casas} casas`); return `${i}.${f.padEnd(casas, "0")}`; };

/**
 * A nota de compra sintética de VÁRIOS itens (XML-01): os itens que o caso declarar, sem frete, seguro, desconto, IPI
 * ou ST — o vNF é a soma dos vProd, e cada vProd é conferido contra quantidade × unitário em inteiros. A fatura tem o
 * líquido = vNF e duas duplicatas que somam o vNF. Emitente, número e código numérico como na nota de um item (cada
 * chamada é outra nota, com outra chave). EAN, quando há, vai no cEAN e no cEANTrib.
 */
export function notaSinteticaDeVariosItens(o: OpcoesDaNotaSintetica & { itens: ItemDaNotaDeVariosItens[] }): NotaSinteticaDeVariosItens {
  if (o.itens.length === 0 || o.itens.length > 990) throw new Error("a nota precisa de 1 a 990 itens");
  const numero = String(Number(`1${sorteio(7)}`));
  const serie = "1";
  const cNF = sorteio(8);
  const c43 = `52` + `2609` + o.emitenteCnpj + `55` + serie.padStart(3, "0") + numero.padStart(9, "0") + `1` + cNF;
  if (!/^\d{43}$/.test(c43)) throw new Error("a chave sem o DV precisa de 43 dígitos");
  const chave = `${c43}${dvDaChave(c43)}`;
  const tpAmb = o.tpAmb ?? "1";
  let soma = 0n;
  const itens = o.itens.map((i, k) => {
    const produto = inteiroEscalado(i.quantidade, 4) * inteiroEscalado(i.valorUnitario, 10);
    if (produto !== inteiroEscalado(i.valorProdutos, 2) * 10n ** 12n) throw new Error(`item ${k + 1}: vProd ${i.valorProdutos} não é ${i.quantidade} × ${i.valorUnitario}`);
    soma += inteiroEscalado(i.valorProdutos, 2);
    return { ...i, nItem: k + 1 };
  });
  const vNF = deCentavos(soma);
  const metade = soma / 2n;
  const duplicatas = [{ numero: "001", vencimento: "2026-11-16", valor: deCentavos(metade) }, { numero: "002", vencimento: "2026-12-16", valor: deCentavos(soma - metade) }];
  const dets = itens.map((i) => {
    const ean = i.ean ?? "SEM GTIN";
    const q = comCasas(i.quantidade, 4); const vUn = comCasas(i.valorUnitario, 10);
    return `<det nItem="${i.nItem}"><prod><cProd>${esc(i.codigo)}</cProd><cEAN>${ean}</cEAN><xProd>${esc(i.descricao)}</xProd><NCM>${i.ncm}</NCM>`
      + `<CFOP>5102</CFOP><uCom>${esc(i.unidade)}</uCom><qCom>${q}</qCom><vUnCom>${vUn}</vUnCom><vProd>${i.valorProdutos}</vProd>`
      + `<cEANTrib>${ean}</cEANTrib><uTrib>${esc(i.unidade)}</uTrib><qTrib>${q}</qTrib><vUnTrib>${vUn}</vUnTrib><indTot>1</indTot></prod>`
      + `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>0.00</vICMS></ICMS00></ICMS></imposto></det>`;
  }).join("");
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">`
    + `<ide><cUF>52</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>${serie}</serie><nNF>${numero}</nNF>`
    + `<dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe></ide>`
    + `<emit><CNPJ>${o.emitenteCnpj}</CNPJ><xNome>${esc(o.emitenteNome)}</xNome><xFant>Sintética</xFant><enderEmit><xLgr>Rua Inventada</xLgr><nro>100</nro>`
    + `<xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Goiânia</xMun><UF>GO</UF><CEP>74000000</CEP><fone>6230000000</fone></enderEmit><IE>1234567890</IE></emit>`
    + `<dest><CNPJ>${CNPJ_DAS_EMPRESAS_DO_SEED}</CNPJ><xNome>Destinatário do seed</xNome></dest>`
    + dets
    + `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vST>0.00</vST><vFCPST>0.00</vFCPST><vProd>${vNF}</vProd>`
    + `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vOutro>0.00</vOutro><vNF>${vNF}</vNF></ICMSTot></total>`
    + `<cobr><fat><nFat>${numero}</nFat><vOrig>${vNF}</vOrig><vDesc>0.00</vDesc><vLiq>${vNF}</vLiq></fat>`
    + duplicatas.map((d) => `<dup><nDup>${d.numero}</nDup><dVenc>${d.vencimento}</dVenc><vDup>${d.valor}</vDup></dup>`).join("") + `</cobr>`
    + `<infAdic><infCpl>Nota sintética de teste, sem valor fiscal.</infCpl></infAdic></infNFe>`;
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-09-20T10:01:00-03:00</dhRecbto>`
    + `<nProt>152260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>${prot}</nfeProc>\n`;
  return { xml, chave, numero, serie, emitenteCnpj: o.emitenteCnpj, itens, vNF, duplicatas };
}
