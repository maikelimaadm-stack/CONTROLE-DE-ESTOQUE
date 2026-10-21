import { describe, expect, it } from "vitest";
import { filtrarLinhas, paginaLocal } from "./local-page";
import { toParams } from "./params";
import type { Base1Column, Base1FilterDef, FilterValues, Row } from "./types";

/**
 * O painel de itens da compra filtra/ordena sobre as linhas que já recebeu numa requisição só. O que se prova aqui
 * é o que o usuário vê: "Contém" acha "Óleo Diesel" digitando "oleo", número compara por VALOR (2.400 > 900) e o
 * texto formatado (1.000,00) não manda na ordem.
 */
const colunas: Base1Column[] = [
  { key: "nome", label: "Descrição", kind: "text" },
  { key: "quantidade", label: "Quantidade", kind: "number", align: "right", text: (r) => String(r["quantidade"]) },
  { key: "lote", label: "Lote", kind: "text", text: (r) => String(r["lote"] ?? "") }
];
const filtros: Base1FilterDef[] = [
  { key: "nome", label: "Descrição", kind: "text", mode: "advanced" },
  { key: "quantidade", label: "Quantidade", kind: "number", mode: "advanced" }
];
const linhas: Row[] = [
  { id: "1", nome: "Óleo Diesel S10", quantidade: "2400.0000", lote: "L-01" },
  { id: "2", nome: "Semente de soja", quantidade: "900.0000", lote: "L-02" },
  { id: "3", nome: "Oleo lubrificante", quantidade: "10.0000", lote: "" }
];

const params = (values: FilterValues) => toParams(filtros, values);

describe("paginaLocal — filtros, busca, ordem e página sobre linhas já carregadas", () => {
  it("texto sem acento e sem caixa: 'oleo' contém Óleo e Oleo", () => {
    const out = filtrarLinhas(linhas, colunas, filtros, params({ nome: { op: "contains", value: "oleo" } }));
    expect(out.map((r) => r["id"])).toEqual(["1", "3"]);
  });

  it("número compara por valor, não por texto: maior que 900 traz só 2.400", () => {
    const out = filtrarLinhas(linhas, colunas, filtros, params({ quantidade: { op: "gt", value: "900" } }));
    expect(out.map((r) => r["id"])).toEqual(["1"]);
  });

  it("entre dois números (faixa do chip)", () => {
    const out = filtrarLinhas(linhas, colunas, filtros, params({ quantidade: { op: "between", value: "100", value2: "1000" } }));
    expect(out.map((r) => r["id"])).toEqual(["2"]);
  });

  it("está na lista (múltipla escolha)", () => {
    const out = filtrarLinhas(linhas, colunas, filtros, params({ nome: { op: "in", value: "", values: ["Semente de soja", "Óleo Diesel S10"] } }));
    expect(out.map((r) => r["id"])).toEqual(["1", "2"]);
  });

  it("está vazio / não está vazio", () => {
    expect(filtrarLinhas(linhas, colunas, filtros, params({ nome: { op: "is_empty", value: "" } }))).toHaveLength(0);
    expect(filtrarLinhas(linhas, colunas, filtros, params({ nome: { op: "is_not_empty", value: "" } }))).toHaveLength(3);
  });

  it("sem filtro ativo devolve todas as linhas", () => {
    expect(filtrarLinhas(linhas, colunas, filtros, {})).toHaveLength(3);
  });

  it("busca livre varre as colunas exibidas", () => {
    const { total } = paginaLocal({ rows: linhas, columns: colunas, filters: filtros, params: {}, search: "l-02", page: 1, pageSize: 20 });
    expect(total).toBe(1);
  });

  it("ordena número por valor, nunca pelo texto formatado", () => {
    const { items } = paginaLocal({ rows: linhas, columns: colunas, filters: filtros, params: {}, sort: "quantidade", dir: "asc", page: 1, pageSize: 20 });
    expect(items.map((r) => r["id"])).toEqual(["3", "2", "1"]);
  });

  it("pagina como o servidor: página 2 com tamanho 2", () => {
    const { items, total } = paginaLocal({ rows: linhas, columns: colunas, filters: filtros, params: {}, page: 2, pageSize: 2 });
    expect(total).toBe(3);
    expect(items.map((r) => r["id"])).toEqual(["3"]);
  });
});
