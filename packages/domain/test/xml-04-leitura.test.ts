/**
 * XML-04 (decisão 318) — o leitor da NF-e passa a ler o grupo de pagamento (`pag/detPag`) e a DIZER quantas duplicatas
 * descartou por falta de vencimento. A regra do descarte não muda; `formaDaNota` é FAIL-CLOSED (só exatamente um
 * `<detPag>` com `tPag` é uma forma — nunca "o primeiro").
 * XMLs SINTÉTICOS (f7-nfe-sintetica.ts): CNPJs e chaves inventados. O gerador não monta `<pag>`; o grupo entra aqui, no
 * lugar do leiaute (depois de `<cobr>`, antes de `<infAdic>`), e cada teste afirma a PREMISSA junto da CONCLUSÃO.
 */
import { describe, expect, it } from "vitest";
import {
  CODIGOS_TPAG_DA_NFE,
  formaDaNota,
  lerNotaFiscalEletronica,
  rotuloDoTPag,
  type LeituraDaNfe,
  type MotivoDaRecusaNfe,
  type NotaFiscalLida
} from "../src/index.js";
import { nfeSintetica, xmlComDuplicatas, xmlSimples } from "./f7-nfe-sintetica.js";

function nota(l: LeituraDaNfe): NotaFiscalLida {
  if (!l.ok) throw new Error(`leitura recusada: ${JSON.stringify(l.recusas)}`);
  return l.nota;
}
function motivos(l: LeituraDaNfe): MotivoDaRecusaNfe[] {
  if (l.ok) throw new Error("a leitura deveria ter sido recusada");
  return l.recusas.map((r) => r.motivo);
}

/** Um `<detPag>` com os filhos dados (ausente = a tag não vai). */
const detPag = (d: { tPag?: string; vPag?: string; indPag?: string }) =>
  `<detPag>${d.indPag === undefined ? "" : `<indPag>${d.indPag}</indPag>`}${d.tPag === undefined ? "" : `<tPag>${d.tPag}</tPag>`}`
  + `${d.vPag === undefined ? "" : `<vPag>${d.vPag}</vPag>`}</detPag>`;

/** O XML da nota simples (vNF 1500.00) com o grupo de pagamento dado, no lugar do leiaute: depois de cobr, antes de infAdic. */
function comPag(grupo: string, xml = xmlSimples().xml): string {
  expect(xml.split("<infAdic>").length - 1, "premissa: um só <infAdic> para ancorar o <pag>").toBe(1);
  expect(xml.includes("<pag>"), "premissa: o gerador não traz <pag>").toBe(false);
  const saida = xml.replace("<infAdic>", `${grupo}<infAdic>`);
  expect(saida.split("<pag>").length - 1, "premissa: o <pag> entrou").toBe(grupo.split("<pag>").length - 1);
  return saida;
}
const lida = (grupo: string, xml?: string) => nota(lerNotaFiscalEletronica(comPag(grupo, xml)));

describe("XML-04 — os pagamentos da nota (pag/detPag)", () => {
  it("um detPag: tPag e vPag lidos (vPag em 2 casas, como todo dinheiro da leitura)", () => {
    const n = lida(`<pag>${detPag({ indPag: "1", tPag: "15", vPag: "1500.00" })}</pag>`);
    expect(n.pagamentos).toEqual([{ tPag: "15", vPag: "1500.00" }]);
    expect(lida(`<pag>${detPag({ tPag: "01", vPag: "1500.5" })}</pag>`).pagamentos).toEqual([{ tPag: "01", vPag: "1500.50" }]);
  });

  it("dois detPag: os dois, NA ORDEM do XML (invertidos no XML, invertidos na leitura)", () => {
    const a = lida(`<pag>${detPag({ tPag: "17", vPag: "1000.00" })}${detPag({ tPag: "01", vPag: "500.00" })}</pag>`);
    expect(a.pagamentos).toEqual([{ tPag: "17", vPag: "1000.00" }, { tPag: "01", vPag: "500.00" }]);
    const b = lida(`<pag>${detPag({ tPag: "01", vPag: "500.00" })}${detPag({ tPag: "17", vPag: "1000.00" })}</pag>`);
    expect(b.pagamentos).toEqual([{ tPag: "01", vPag: "500.00" }, { tPag: "17", vPag: "1000.00" }]);
  });

  it("detPag sem tPag (ou com tPag vazio): o pagamento entra, com tPag null; a leitura não é recusada", () => {
    expect(lida(`<pag>${detPag({ vPag: "1500.00" })}</pag>`).pagamentos).toEqual([{ tPag: null, vPag: "1500.00" }]);
    expect(lida(`<pag>${detPag({ tPag: "   ", vPag: "1500.00" })}</pag>`).pagamentos).toEqual([{ tPag: null, vPag: "1500.00" }]);
    expect(lida(`<pag><detPag/></pag>`).pagamentos).toEqual([{ tPag: null, vPag: null }]);
  });

  it("sem pag (ou pag sem detPag): pagamentos é a lista VAZIA, sempre presente", () => {
    const sem = nota(lerNotaFiscalEletronica(xmlSimples().xml));
    expect(Object.hasOwn(sem, "pagamentos"), "premissa: a propriedade existe mesmo sem <pag>").toBe(true);
    expect(sem.pagamentos).toEqual([]);
    expect(lida("<pag></pag>").pagamentos).toEqual([]);
    expect(lida("<pag><vTroco>0.00</vTroco></pag>").pagamentos).toEqual([]);
  });

  it("vPag inválido NÃO recusa: vira null; o tPag do mesmo detPag continua lido; tPag e vPag aparados", () => {
    for (const v of ["12,50", "abc", "1.234", "-10.00", "1e3", ""]) {
      const l = lerNotaFiscalEletronica(comPag(`<pag>${detPag({ tPag: "15", vPag: v })}</pag>`));
      expect(l.ok, `vPag "${v}" não pode recusar a leitura: ${l.ok ? "" : JSON.stringify(l.recusas)}`).toBe(true);
      expect(nota(l).pagamentos, `vPag "${v}"`).toEqual([{ tPag: "15", vPag: null }]);
    }
    expect(lida(`<pag>${detPag({ tPag: "15" })}</pag>`).pagamentos).toEqual([{ tPag: "15", vPag: null }]);
    expect(lida(`<pag>${detPag({ tPag: " 15 ", vPag: " 1500.00 " })}</pag>`).pagamentos).toEqual([{ tPag: "15", vPag: "1500.00" }]);
  });

  it("o leitor não julga o código: tPag fora do leiaute é lido como veio (quem liga o código é a organização)", () => {
    expect(rotuloDoTPag("77"), "premissa: 77 não é do leiaute").toBeNull();
    expect(lida(`<pag>${detPag({ tPag: "77", vPag: "1500.00" })}</pag>`).pagamentos).toEqual([{ tPag: "77", vPag: "1500.00" }]);
  });

  it("dois <pag> (fora do leiaute 4.00): os detPag de TODOS, na ordem — nunca só os do primeiro", () => {
    const n = lida(`<pag>${detPag({ tPag: "15", vPag: "1000.00" })}</pag><pag>${detPag({ tPag: "01", vPag: "500.00" })}</pag>`);
    expect(n.pagamentos).toEqual([{ tPag: "15", vPag: "1000.00" }, { tPag: "01", vPag: "500.00" }]);
    expect(formaDaNota(n)).toEqual({ situacao: "varias", quantidade: 2 });
  });
});

describe("XML-04 — formaDaNota (fail-closed: exatamente UM detPag com tPag)", () => {
  it("uma: o único detPag com tPag", () => {
    expect(formaDaNota(lida(`<pag>${detPag({ tPag: "15", vPag: "1500.00" })}</pag>`))).toEqual({ situacao: "uma", tPag: "15" });
  });

  it("varias: dois detPag com códigos diferentes — nunca o primeiro", () => {
    const n = lida(`<pag>${detPag({ tPag: "17", vPag: "1000.00" })}${detPag({ tPag: "01", vPag: "500.00" })}</pag>`);
    expect(n.pagamentos?.[0]?.tPag, "premissa: o primeiro tem código").toBe("17");
    expect(formaDaNota(n)).toEqual({ situacao: "varias", quantidade: 2 });
  });

  it("varias: o MESMO tPag repetido também é varias (dois pagamentos, não uma forma)", () => {
    const n = lida(`<pag>${detPag({ tPag: "15", vPag: "750.00" })}${detPag({ tPag: "15", vPag: "750.00" })}</pag>`);
    expect(new Set(n.pagamentos?.map((p) => p.tPag)), "premissa: um código só, repetido").toEqual(new Set(["15"]));
    expect(formaDaNota(n)).toEqual({ situacao: "varias", quantidade: 2 });
    const tres = lida(`<pag>${detPag({ tPag: "15" })}${detPag({ tPag: "15" })}${detPag({ tPag: "15" })}</pag>`);
    expect(formaDaNota(tres)).toEqual({ situacao: "varias", quantidade: 3 });
  });

  it("varias: um sem tPag e outro com tPag não vira a forma do que tem código", () => {
    const n = lida(`<pag>${detPag({ vPag: "500.00" })}${detPag({ tPag: "15", vPag: "1000.00" })}</pag>`);
    expect(formaDaNota(n)).toEqual({ situacao: "varias", quantidade: 2 });
  });

  it("sem_tpag: sem pag, o único detPag sem tPag, e a nota da API anterior (sem a propriedade)", () => {
    expect(formaDaNota(nota(lerNotaFiscalEletronica(xmlSimples().xml)))).toEqual({ situacao: "sem_tpag" });
    expect(formaDaNota(lida(`<pag>${detPag({ vPag: "1500.00" })}</pag>`))).toEqual({ situacao: "sem_tpag" });
    expect(formaDaNota({})).toEqual({ situacao: "sem_tpag" });
  });

  it("a tabela de tPag: códigos de dois dígitos, sem repetição; o rótulo é o do leiaute", () => {
    const codigos = CODIGOS_TPAG_DA_NFE.map(([c]) => c);
    expect(codigos.length).toBeGreaterThan(0);
    expect(codigos.every((c) => /^[0-9]{2}$/.test(c))).toBe(true);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(rotuloDoTPag("15")).toBe("Boleto bancário");
    expect(rotuloDoTPag("1")).toBeNull();
  });
});

describe("XML-04 — duplicatasDescartadas (a regra do descarte é a de sempre)", () => {
  it("0 quando todas as duplicatas têm vencimento", () => {
    const n = nota(lerNotaFiscalEletronica(xmlComDuplicatas().xml));
    expect(n.duplicatas.length, "premissa: as duas duplicatas viraram parcelas").toBe(2);
    expect(n.duplicatasDescartadas).toBe(0);
  });

  it("N (todas as <dup> lidas) quando UMA não tem vencimento: duplicatas fica vazia, como sempre", () => {
    const duas = nota(lerNotaFiscalEletronica(nfeSintetica({ duplicatas: [{ numero: "001", vencimento: "2026-10-15", valor: "750.00" }, { numero: "002", valor: "750.00" }] }).xml));
    expect(duas.duplicatas).toEqual([]);
    expect(duas.duplicatasDescartadas).toBe(2);
    const tres = nota(lerNotaFiscalEletronica(nfeSintetica({ duplicatas: [
      { numero: "001", vencimento: "2026-10-15", valor: "500.00" }, { numero: "002", valor: "500.00" }, { numero: "003", vencimento: "2026-12-15", valor: "500.00" }
    ] }).xml));
    expect(tres.duplicatas).toEqual([]);
    expect(tres.duplicatasDescartadas, "N é o número de <dup> lidos, não o de <dup> sem data").toBe(3);
    const vazio = nota(lerNotaFiscalEletronica(nfeSintetica({ duplicatas: [{ numero: "001", vencimento: "", valor: "1500.00" }] }).xml));
    expect(vazio.duplicatasDescartadas, "dVenc vazio é ausente").toBe(1);
  });

  it("0 sem <dup>: sem cobrança, e com fatura sem duplicata", () => {
    const sem = nota(lerNotaFiscalEletronica(xmlSimples().xml));
    expect(Object.hasOwn(sem, "duplicatasDescartadas"), "premissa: a propriedade existe mesmo sem <cobr>").toBe(true);
    expect(sem.duplicatasDescartadas).toBe(0);
    const soFatura = nota(lerNotaFiscalEletronica(nfeSintetica({ fatura: { numero: "1", original: "1500.00", desconto: "0.00", liquido: "1500.00" } }).xml));
    expect(soFatura.fatura, "premissa: a fatura foi lida").not.toBeNull();
    expect(soFatura.duplicatasDescartadas).toBe(0);
  });

  it("dVenc PRESENTE e inválido continua RECUSA (data_invalida), nunca descarte", () => {
    const l = lerNotaFiscalEletronica(nfeSintetica({ duplicatas: [{ numero: "001", vencimento: "2026-02-30", valor: "1500.00" }] }).xml);
    expect(motivos(l)).toEqual(["data_invalida"]);
  });
});
