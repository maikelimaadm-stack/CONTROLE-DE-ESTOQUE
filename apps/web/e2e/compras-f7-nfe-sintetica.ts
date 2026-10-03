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
