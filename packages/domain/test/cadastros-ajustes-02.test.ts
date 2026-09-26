import { describe, expect, it } from "vitest";
import { BLOCOS_DO_PARCEIRO, BLOCO_CONTA, BLOCO_CONTATO, BLOCO_ENDERECO, getResource, partesDaReferencia, partesDoLado, type ChaveReferencia } from "../src/index.js";

/** CADASTROS AJUSTES 02 — 2.1 (partes da referência) e 2.4 (paridade principal × adicional). */
describe("partesDaReferencia (2.1)", () => {
  const casos: [ChaveReferencia, { codigo: string | number; nome: string; extra: string | null; rotulo: string }, { nome: string; codigo: string; extra: string | null }][] = [
    ["municipios", { codigo: 5106752, nome: "Pontes e Lacerda", extra: "MT", rotulo: "5106752 · Pontes e Lacerda - MT" }, { nome: "Pontes e Lacerda", codigo: "5106752", extra: "MT" }],
    ["bancos", { codigo: "260", nome: "NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO", extra: null, rotulo: "260 · NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO" }, { nome: "NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO", codigo: "260", extra: null }],
    ["bancos", { codigo: "1", nome: "Banco do Brasil S.A.", extra: null, rotulo: "001 · Banco do Brasil S.A." }, { nome: "Banco do Brasil S.A.", codigo: "001", extra: null }],
    ["ncm", { codigo: "01022110", nome: "Reprodutores de raça pura", extra: null, rotulo: "0102.21.10 - Reprodutores de raça pura" }, { nome: "Reprodutores de raça pura", codigo: "0102.21.10", extra: null }],
    ["cbo", { codigo: "621005", nome: "Trabalhador agropecuário em geral", extra: null, rotulo: "621005 - Trabalhador agropecuário em geral" }, { nome: "Trabalhador agropecuário em geral", codigo: "621005", extra: null }]
  ];
  for (const [chave, item, esperado] of casos) it(`${chave} ${item.codigo}: nome sem o código, código e extra em partes próprias`, () => {
    const r = partesDaReferencia(chave, item);
    expect(r).toEqual(esperado);
    expect(r.nome).not.toContain(String(item.codigo));
    expect(r.nome).not.toContain(r.codigo);
  });
  it("nunca recorta o rótulo: item sem nome → nome null (a tela nunca põe o código no lugar)", () => {
    expect(partesDaReferencia("municipios", { codigo: 5106752, extra: "MT" } as { codigo: number; extra: string }).nome).toBeNull();
    expect(partesDaReferencia("bancos", { codigo: "260", nome: "  " }).nome).toBeNull();
  });
  it("extra só no município", () => { expect(partesDaReferencia("cbo", { codigo: "621005", nome: "x", extra: "MT" }).extra).toBeNull(); });
});

describe("paridade dos blocos do parceiro (2.4)", () => {
  const people = getResource("people")!;
  const campo = (n: string) => people.fields.find((f) => f.name === n);
  const det = (k: string) => people.detalhes!.find((d) => d.key === k)!;
  it("o CORPO é o mesmo dos dois lados; diferenças só as declaradas (topo/fim do adicional, Caixa postal só no principal)", () => {
    for (const b of BLOCOS_DO_PARCEIRO) {
      const principal = partesDoLado(b, "principal").map((x) => x.rotulo);
      const adicional = partesDoLado(b, "adicional").map((x) => x.rotulo);
      const soPrincipal = b.corpo.filter((x) => x.adicional === null).map((x) => x.rotulo);
      expect(adicional).toEqual([...b.topoAdicional.map((x) => x.rotulo), ...principal.filter((r) => !soPrincipal.includes(r)), ...b.fimAdicional.map((x) => x.rotulo)]);
    }
    expect(BLOCO_ENDERECO.corpo.filter((x) => x.adicional === null).map((x) => x.chave)).toEqual(["caixa_postal"]);
    expect(BLOCO_CONTA.corpo.every((x) => x.adicional !== null)).toBe(true);
    expect(BLOCO_CONTATO.corpo.every((x) => x.adicional !== null)).toBe(true);
  });
  it("todo campo declarado existe no registry, na seção/detalhe do bloco", () => {
    for (const b of BLOCOS_DO_PARCEIRO) {
      const d = det(b.detalhe);
      for (const x of partesDoLado(b, "principal")) expect(campo(x.principal!)?.section, `${b.detalhe}.${x.chave} principal`).toBe(b.secao);
      for (const x of partesDoLado(b, "adicional")) expect(d.fields.some((f) => f.name === x.adicional), `${b.detalhe}.${x.chave} adicional`).toBe(true);
    }
  });
  it("cada campo gravado do detalhe está no bloco, na MESMA ordem do bloco (a grade vira cartão sem campo perdido)", () => {
    for (const b of BLOCOS_DO_PARCEIRO) {
      const doBloco = [...new Set(partesDoLado(b, "adicional").filter((x) => !x.parteDe).map((x) => x.adicional!))];
      expect(det(b.detalhe).fields.map((f) => f.name)).toEqual(doBloco);
    }
  });
  it("a ordem do principal segue a do bloco (sem os campos que o bloco não desenha)", () => {
    for (const b of BLOCOS_DO_PARCEIRO) {
      const doBloco = [...new Set(partesDoLado(b, "principal").filter((x) => !x.parteDe).map((x) => x.principal!))];
      const naSecao = people.fields.filter((f) => f.section === b.secao && doBloco.includes(f.name)).map((f) => f.name);
      expect(naSecao).toEqual(doBloco);
    }
  });
});
