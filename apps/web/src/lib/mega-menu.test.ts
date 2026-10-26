import { describe, expect, it } from "vitest";
import { megaColumns, megaItemAtivo, megaMenuFor } from "./mega-menu";

const canAll = () => true;

describe("megaItemAtivo", () => {
  it("bate path + query do destino", () => {
    expect(megaItemAtivo("/compras?tab=documentos", "/compras", "tab=documentos")).toBe(true);
    expect(megaItemAtivo("/compras?tab=documentos", "/compras", "tab=processos")).toBe(false);
    expect(megaItemAtivo("/compras?tab=documentos", "/estoque", "tab=documentos")).toBe(false);
  });

  it("destino sem query só é atual sem tab/sub na URL", () => {
    expect(megaItemAtivo("/compras", "/compras", "")).toBe(true);
    expect(megaItemAtivo("/compras", "/compras", "tab=documentos")).toBe(false);
  });

  it("exige todos os params do destino (importar=xml)", () => {
    expect(megaItemAtivo("/compras?tab=documentos&importar=xml", "/compras", "tab=documentos&importar=xml")).toBe(true);
    expect(megaItemAtivo("/compras?tab=documentos&importar=xml", "/compras", "tab=documentos")).toBe(false);
  });
});

describe("megaMenuFor(compras)", () => {
  it("expõe hints (description) nos itens de Compras para o chrome do mega-menu", () => {
    const data = megaMenuFor("compras", canAll);
    expect(data).not.toBeNull();
    expect(data!.module.label).toBe("Compras");
    expect(data!.module.description).toMatch(/compra/i);
    const labels = data!.groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(expect.arrayContaining(["Documentos", "Visão Geral", "Processos", "Importar XML de nota de compra"]));
    const docs = data!.groups.flatMap((g) => g.items).find((i) => i.label === "Documentos");
    expect(docs?.hint).toMatch(/documento/i);
    const visao = data!.groups.flatMap((g) => g.items).find((i) => i.label === "Visão Geral");
    expect(visao?.hint).toMatch(/indicador/i);
    expect(megaColumns(data!.groups)).toBeGreaterThanOrEqual(1);
    expect(megaColumns(data!.groups)).toBeLessThanOrEqual(3);
  });
});
