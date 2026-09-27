import { describe, it, expect } from "vitest";
import {
  FAMILIAS_COM_LAYOUT,
  LAYOUT_DO_SISTEMA,
  validarEstruturaLayout,
  camposObrigatoriosFaltando,
  motivoZonaProibida,
  camposAdicionaisDoCabecalho,
  mensagemSoNoRodape,
  MENSAGEM_GRUPO_SO_NO_CABECALHO,
  type EstruturaLayout
} from "../src/layout-documento.js";

/* VENDAS-A3-1c (decisão 261): zonas do documento no configurador visual. */

function at<T>(a: readonly T[], i: number): T { const v = a[i]; if (v === undefined) throw new Error(`índice ${i} ausente`); return v; }

const F = "vendas.pedido";
const sis = (f: string = F): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(f));
const erros = (e: EstruturaLayout) => validarEstruturaLayout(F, e);
const caminhos = (e: EstruturaLayout) => erros(e).map((x) => x.caminho);
/** Tira `campo` de onde estiver (cabeçalho ou abas; aba que esvazia sai) e devolve a estrutura. */
function tirar(e: EstruturaLayout, campo: string): EstruturaLayout {
  e.cabecalho = e.cabecalho.filter((x) => x.campo !== campo);
  for (const a of e.rodape) a.campos = a.campos.filter((x) => x.campo !== campo);
  e.rodape = e.rodape.filter((a) => a.campos.length > 0);
  return e;
}
function indiceAba(e: EstruturaLayout, nome: string): number {
  const i = e.rodape.findIndex((a) => a.aba === nome);
  if (i < 0) throw new Error(`aba ${nome} ausente`);
  return i;
}

describe("LC-D1 validarEstruturaLayout aceita campo do documento em qualquer zona do documento", () => {
  it("campo do cabeçalho numa aba do rodapé → válido", () => {
    const l = tirar(sis(), "due_date");
    at(l.rodape, indiceAba(l, "Fiscal")).campos.push({ campo: "due_date", obrigatorio: false, editavel: true });
    expect(erros(l)).toEqual([]);
  });

  it("obrigatório do sistema do cabeçalho numa aba → válido (continua obrigatório)", () => {
    const l = tirar(sis(), "client_id");
    at(l.rodape, 0).campos.unshift({ campo: "client_id", obrigatorio: true, editavel: true });
    expect(erros(l)).toEqual([]);
  });

  it("campo do rodapé no cabeçalho (sem e com grupo) → válido", () => {
    const l = tirar(sis(), "driver_name");
    l.cabecalho.push({ campo: "driver_name", obrigatorio: false, editavel: true });
    expect(erros(l)).toEqual([]);
    const l2 = tirar(sis(), "note");
    l2.cabecalho.push({ campo: "note", obrigatorio: false, editavel: true, grupo: "adicionais" });
    expect(erros(l2)).toEqual([]);
  });

  it("Parcelamento (installment_plan) no cabeçalho → erro em cabecalho[i].campo com mensagemSoNoRodape", () => {
    const l = tirar(sis(), "installment_plan");
    l.cabecalho.push({ campo: "installment_plan", obrigatorio: false, editavel: true });
    const i = l.cabecalho.length - 1;
    expect(erros(l)).toEqual([{ caminho: `cabecalho[${i}].campo`, mensagem: mensagemSoNoRodape("Parcelamento") }]);
  });

  it("coluna dos itens fora dos itens → erro; campo do documento nos itens → erro", () => {
    const l = sis();
    l.cabecalho.push({ campo: "quantity", obrigatorio: false, editavel: true });
    expect(erros(l)).toEqual([{ caminho: `cabecalho[${l.cabecalho.length - 1}].campo`, mensagem: 'Campo "quantity" não existe nesta parte do documento.' }]);
    const l2 = sis();
    at(l2.rodape, 0).campos.push({ campo: "product_id", obrigatorio: false, editavel: true });
    expect(caminhos(l2)).toEqual([`rodape[0].campos[${at(l2.rodape, 0).campos.length - 1}].campo`]);
    const l3 = tirar(sis(), "due_date");
    l3.itens.push({ campo: "due_date", obrigatorio: false });
    expect(erros(l3)).toEqual([{ caminho: `itens[${l3.itens.length - 1}].campo`, mensagem: 'Coluna "due_date" não existe nos itens.' }]);
  });

  it("grupo em campo de aba → erro em rodape[a].campos[i].grupo", () => {
    const l = sis();
    const a = indiceAba(l, "Observações");
    at(at(l.rodape, a).campos, 0).grupo = "principal";
    expect(erros(l)).toEqual([{ caminho: `rodape[${a}].campos[0].grupo`, mensagem: MENSAGEM_GRUPO_SO_NO_CABECALHO }]);
  });

  it("campo repetido entre zonas → erro (cabeçalho × aba, aba × aba)", () => {
    const l = sis();
    at(l.rodape, 0).campos.push({ campo: "due_date", obrigatorio: false, editavel: true });
    expect(erros(l)).toEqual([{ caminho: `rodape[0].campos[${at(l.rodape, 0).campos.length - 1}].campo`, mensagem: 'Campo "Vencimento" repetido no layout.' }]);
    // o cabeçalho é lido primeiro: a repetição é acusada na aba
    const l2 = sis();
    l2.cabecalho.push({ campo: "note", obrigatorio: false, editavel: true });
    expect(caminhos(l2)).toEqual([`rodape[${indiceAba(l2, "Observações")}].campos[0].campo`]);
    const l3 = sis();
    at(l3.rodape, 0).campos.push({ campo: "driver_name", obrigatorio: false, editavel: true });
    expect(erros(l3)).toEqual([{ caminho: `rodape[${indiceAba(l3, "Frete e transporte")}].campos[1].campo`, mensagem: 'Campo "Motorista" repetido no layout.' }]);
  });

  it("camposObrigatoriosFaltando cobra campo do rodapé movido para o cabeçalho (e vice-versa)", () => {
    const doc = { client_id: "c", empresa_id: "e", document_date: "2026-01-01", items: [] };
    const l = tirar(sis(), "driver_name");
    l.cabecalho.push({ campo: "driver_name", obrigatorio: true, editavel: true });
    expect(erros(l)).toEqual([]);
    expect(camposObrigatoriosFaltando(F, l, doc)).toEqual([{ caminho: "driver_name", rotulo: "Motorista" }]);
    expect(camposObrigatoriosFaltando(F, l, { ...doc, driver_name: "João" })).toEqual([]);
    const l2 = tirar(sis(), "due_date");
    at(l2.rodape, 0).campos.push({ campo: "due_date", obrigatorio: true, editavel: true });
    expect(camposObrigatoriosFaltando(F, l2, doc)).toEqual([{ caminho: "due_date", rotulo: "Vencimento" }]);
  });
});

describe("LC-D2 layout do sistema com grupo; motivoZonaProibida; camposAdicionaisDoCabecalho", () => {
  it.each(FAMILIAS_COM_LAYOUT)("%s: o de antes + proprietary_id em adicionais", (f) => {
    const l = LAYOUT_DO_SISTEMA(f);
    expect(validarEstruturaLayout(f, l)).toEqual([]);
    // tirando o grupo, é o layout de antes (ordem, rótulos, obrigatórios — conferidos em LD-D1)
    expect(l.cabecalho.filter((c) => c.grupo !== undefined).map((c) => [c.campo, c.grupo])).toEqual([["proprietary_id", "adicionais"]]);
    expect(l.rodape.flatMap((a) => a.campos).some((c) => c.grupo !== undefined)).toBe(false);
    expect(camposAdicionaisDoCabecalho(l)).toEqual(["proprietary_id"]);
  });

  it("motivoZonaProibida", () => {
    expect(motivoZonaProibida(F, "client_id", { tipo: "principal" })).toBeNull();
    expect(motivoZonaProibida(F, "client_id", { tipo: "adicionais" })).toBeNull();
    expect(motivoZonaProibida(F, "client_id", { tipo: "aba", indice: 2 })).toBeNull();
    expect(motivoZonaProibida(F, "note", { tipo: "principal" })).toBeNull();
    expect(motivoZonaProibida(F, "installment_plan", { tipo: "principal" })).toBe(mensagemSoNoRodape("Parcelamento"));
    expect(motivoZonaProibida(F, "installment_plan", { tipo: "adicionais" })).toBe(mensagemSoNoRodape("Parcelamento"));
    expect(motivoZonaProibida(F, "installment_plan", { tipo: "aba", indice: 0 })).toBeNull();
    expect(motivoZonaProibida(F, "quantity", { tipo: "itens" })).toBeNull();
    expect(motivoZonaProibida(F, "quantity", { tipo: "principal" })).not.toBeNull();
    expect(motivoZonaProibida(F, "quantity", { tipo: "aba", indice: 0 })).not.toBeNull();
    expect(motivoZonaProibida(F, "client_id", { tipo: "itens" })).not.toBeNull();
    // "discount" existe no rodapé E nos itens: cada zona acha o seu
    expect(motivoZonaProibida(F, "discount", { tipo: "itens" })).toBeNull();
    expect(motivoZonaProibida(F, "discount", { tipo: "principal" })).toBeNull();
    // fail-closed: fora do catálogo / família sem layout
    expect(motivoZonaProibida(F, "inventado", { tipo: "principal" })).not.toBeNull();
    expect(motivoZonaProibida(F, "inventado", { tipo: "itens" })).not.toBeNull();
    expect(motivoZonaProibida("familia.inexistente", "client_id", { tipo: "principal" })).not.toBeNull();
  });

  it("camposAdicionaisDoCabecalho segue o grupo declarado", () => {
    const l = sis();
    at(l.cabecalho, 0).grupo = "adicionais"; // client_id
    at(l.cabecalho, 8).grupo = "principal"; // proprietary_id
    expect(camposAdicionaisDoCabecalho(l)).toEqual(["client_id"]);
    const l2 = sis();
    for (const c of l2.cabecalho) c.grupo = "principal";
    expect(camposAdicionaisDoCabecalho(l2)).toEqual([]);
  });
});

describe("LC-D3 compatibilidade: estrutura gravada antes da A3-1c (sem grupo)", () => {
  it("continua válida e Dados adicionais = [proprietary_id]", () => {
    const l = sis();
    for (const c of l.cabecalho) delete c.grupo;
    expect(erros(l)).toEqual([]);
    expect(camposAdicionaisDoCabecalho(l)).toEqual(["proprietary_id"]);
    expect(camposAdicionaisDoCabecalho(tirar(l, "proprietary_id"))).toEqual([]);
  });
});
