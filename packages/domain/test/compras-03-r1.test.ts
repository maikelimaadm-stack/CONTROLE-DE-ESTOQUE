import { describe, it, expect } from "vitest";
import { LAYOUT_DO_SISTEMA, validarEstruturaLayout, type EstruturaLayout, type ErroDoLayout } from "../src/index.js";

/*
 * COMPRAS-03_R1 (decisão 269, item 1.1 a): o que o lançar de compras sempre recusaria é recusado na gravação do layout,
 * com mensagem no caminho do campo. Só compras: vendas não passa pelas regras novas.
 */

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";
const UUID = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
const sis = (f: string = COMPRA): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(f));
const erros = (f: string, e: EstruturaLayout): ErroDoLayout[] => validarEstruturaLayout(f, e);
function cab(e: EstruturaLayout, campo: string): number {
  const i = e.cabecalho.findIndex((x) => x.campo === campo);
  if (i < 0) throw new Error(`campo ${campo} fora do cabeçalho`);
  return i;
}
function col(e: EstruturaLayout, campo: string): number {
  const i = e.itens.findIndex((x) => x.campo === campo);
  if (i < 0) throw new Error(`coluna ${campo} fora dos itens`);
  return i;
}
const sem = (e: EstruturaLayout, ...campos: string[]): EstruturaLayout => ({ ...e, cabecalho: e.cabecalho.filter((x) => !campos.includes(x.campo)) });

describe("C3R1-D1 premissa: os layouts do sistema de compras continuam válidos", () => {
  it("pedido e compra sem erro", () => {
    expect(erros(PEDIDO, sis(PEDIDO))).toEqual([]);
    expect(erros(COMPRA, sis(COMPRA))).toEqual([]);
  });
});

describe("C3R1-D2 lote e validade: só aparecer, rótulo e ordem", () => {
  for (const campo of ["lote", "validade"] as const) {
    const rotulo = campo === "lote" ? "Lote" : "Validade";
    it(`${campo} obrigatório → recusa no .obrigatorio`, () => {
      const e = sis(); const i = col(e, campo); e.itens[i]!.obrigatorio = true;
      expect(erros(COMPRA, e)).toEqual([{ caminho: `itens[${i}].obrigatorio`, mensagem: `"${rotulo}" é exigido pela regra do produto: o layout não o torna obrigatório.` }]);
    });
    it(`${campo} com padrão → recusa no .valorPadrao`, () => {
      const e = sis(); const i = col(e, campo); e.itens[i]!.valorPadrao = { tipo: "literal", valor: campo === "lote" ? "L1" : "2026-01-01" };
      expect(erros(COMPRA, e).filter((x) => x.caminho === `itens[${i}].valorPadrao`)).toEqual([{ caminho: `itens[${i}].valorPadrao`, mensagem: `"${rotulo}" é informado item a item: não aceita valor padrão.` }]);
    });
    it(`${campo} com rótulo próprio, fora de ordem ou fora do layout → aceito`, () => {
      const e = sis(); const i = col(e, campo); e.itens[i]!.rotulo = "Meu"; e.itens.unshift(e.itens.splice(i, 1)[0]!);
      expect(erros(COMPRA, e)).toEqual([]);
      const f = sis(); f.itens = f.itens.filter((x) => x.campo !== campo);
      expect(erros(COMPRA, f)).toEqual([]);
    });
  }
});

describe("C3R1-D3 série e número da nota", () => {
  it("série sem número → recusa no campo da série", () => {
    const e = sem(sis(), "numero_nota"); const i = cab(e, "serie_nota");
    expect(erros(COMPRA, e)).toEqual([{ caminho: `cabecalho[${i}].campo`, mensagem: `"Série" só entra no layout com "Número da nota".` }]);
  });
  it("número sem série, e nenhum dos dois → aceito", () => {
    expect(erros(COMPRA, sem(sis(), "serie_nota"))).toEqual([]);
    expect(erros(COMPRA, sem(sis(), "serie_nota", "numero_nota"))).toEqual([]);
  });
  it("série fixa com número não editável → recusa; com número editável → aceito", () => {
    const e = sis(); const s = cab(e, "serie_nota"); const n = cab(e, "numero_nota");
    e.cabecalho[s]!.valorPadrao = { tipo: "literal", valor: "1" }; e.cabecalho[s]!.editavel = false;
    expect(erros(COMPRA, e)).toEqual([]);
    e.cabecalho[n]!.editavel = false;
    expect(erros(COMPRA, e)).toEqual([{ caminho: `cabecalho[${s}].editavel`, mensagem: `"Série" com valor padrão fixo exige "Número da nota" editável.` }]);
  });
  it("série com padrão mas editável e número não editável → aceito (não é fixa)", () => {
    const e = sis(); const s = cab(e, "serie_nota");
    e.cabecalho[s]!.valorPadrao = { tipo: "literal", valor: "1" }; e.cabecalho[cab(e, "numero_nota")]!.editavel = false;
    expect(erros(COMPRA, e)).toEqual([]);
  });
});

describe("C3R1-D4 natureza de despesa e centro de resultado", () => {
  for (const f of [PEDIDO, COMPRA]) {
    it(`${f}: um sem o outro → recusa no campo presente`, () => {
      const a = sem(sis(f), "centro_custo_id");
      expect(erros(f, a)).toEqual([{ caminho: `cabecalho[${cab(a, "categoria_financeira_id")}].campo`, mensagem: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Centro de resultado".` }]);
      const b = sem(sis(f), "categoria_financeira_id");
      expect(erros(f, b)).toEqual([{ caminho: `cabecalho[${cab(b, "centro_custo_id")}].campo`, mensagem: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Natureza de despesa".` }]);
    });
    it(`${f}: os dois fora, ou os dois obrigatórios → aceito`, () => {
      expect(erros(f, sem(sis(f), "centro_custo_id", "categoria_financeira_id"))).toEqual([]);
      const e = sis(f); e.cabecalho[cab(e, "centro_custo_id")]!.obrigatorio = true; e.cabecalho[cab(e, "categoria_financeira_id")]!.obrigatorio = true;
      expect(erros(f, e)).toEqual([]);
    });
    it(`${f}: "obrigatório" diferente → recusa no .obrigatorio do centro`, () => {
      const e = sis(f); const c = cab(e, "centro_custo_id"); e.cabecalho[c]!.obrigatorio = true;
      expect(erros(f, e)).toEqual([{ caminho: `cabecalho[${c}].obrigatorio`, mensagem: `"Centro de resultado" e "Natureza de despesa" têm de ser ambos obrigatórios ou ambos opcionais.` }]);
    });
    it(`${f}: centro fixo exige natureza editável`, () => {
      const e = sis(f); const c = cab(e, "centro_custo_id");
      e.cabecalho[c]!.valorPadrao = { tipo: "registro", id: UUID }; e.cabecalho[c]!.editavel = false;
      expect(erros(f, e)).toEqual([]);
      e.cabecalho[cab(e, "categoria_financeira_id")]!.editavel = false;
      expect(erros(f, e)).toEqual([{ caminho: `cabecalho[${c}].editavel`, mensagem: `"Centro de resultado" com valor padrão fixo exige "Natureza de despesa" editável.` }]);
    });
  }
});

describe("C3R1-D5 vendas não passa pelas regras de compras", () => {
  it("layout de vendas sem nenhum campo opcional continua aceito", () => {
    for (const f of ["vendas.orcamento", "vendas.pedido", "vendas.venda"]) {
      const e = structuredClone(LAYOUT_DO_SISTEMA(f));
      expect(erros(f, e)).toEqual([]);
    }
  });
});
