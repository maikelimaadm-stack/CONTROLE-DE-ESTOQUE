import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname);
const src = (f: string) => readFileSync(resolve(dir, f), "utf8");

describe("Mapa de Manejo — áreas com polígonos e animais", () => {
  it("componente: mapa com rótulos de animais por área", () => {
    const s = src("mapa-de-manejo.tsx");
    expect(s).toContain("Mapa de Manejo");
    expect(s).toContain("useCabecasPorArea");
    expect(s).toContain("rotulosDasAreas");
    expect(s).toContain("CamadaDesenho");
    expect(s).not.toContain("BarraCamadas");
    expect(s).not.toContain("mapa-geral");
  });

  it("hook consulta cabeças por área na API do mapa de manejo", () => {
    const s = src("use-cabecas-por-area.ts");
    expect(s).toContain("/api/mapa/areas/cabecas-por-area");
  });

  it("rótulo do mapa exibe quantidade de animais", () => {
    const s = src("camada-desenho.tsx");
    expect(s).toContain("animais");
    expect(s).toContain("cabecas");
  });

  it("Mapa geral não usa contagem de animais (só Mapa de Manejo)", () => {
    const geral = src("mapa-geral.tsx");
    expect(geral).not.toContain("useCabecasPorArea");
    expect(geral).not.toContain("cabecas-por-area");
  });
});
