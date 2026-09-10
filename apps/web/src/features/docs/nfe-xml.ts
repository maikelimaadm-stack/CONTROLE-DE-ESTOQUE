/** Leitura básica de XML de NFe (infNFe) para pré-preencher o documento fiscal de entrada. */
export function parseNfeXml(xml: string) {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const g = (sel: string, root: Element | Document = doc) => root.querySelector(sel)?.textContent?.trim() ?? "";
    const inf = doc.querySelector("infNFe"); if (!inf) return null;
    const dh = g("ide > dhEmi") || g("ide > dEmi");
    const items = [...doc.querySelectorAll("det")].map((d) => ({ description: g("prod > xProd", d), quantity: g("prod > qCom", d) || "1", unitValue: g("prod > vUnCom", d) || "0", discount: g("prod > vDesc", d) || "0", ncm: g("prod > NCM", d) }));
    return { accessKey: (inf.getAttribute("Id") ?? "").replace(/^NFe/, ""), number: g("ide > nNF"), series: g("ide > serie") || "1", emissionDate: dh.slice(0, 10), state: g("emit > enderEmit > UF"), issuerDocument: g("emit > CNPJ") || g("emit > CPF"), issuerName: g("emit > xNome"), total: g("total > ICMSTot > vNF"), items };
  } catch { return null; }
}
