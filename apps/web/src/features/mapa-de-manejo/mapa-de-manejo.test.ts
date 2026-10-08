import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname);
const src = (f: string) => readFileSync(resolve(dir, f), "utf8");

describe("Mapa de Manejo — áreas com polígonos", () => {
  it("componente: mapa full-bleed, só polígonos das áreas", () => {
    const s = src("mapa-de-manejo.tsx");
    expect(s).toContain("Mapa de Manejo");
    expect(s).toContain("mapa-de-manejo");
    expect(s).toContain("mapa-manejo-canvas");
    expect(s).toContain("desenharAreas");
    expect(s).not.toContain("mapa-item-area");
    expect(s).not.toContain("grid-cols-[280px_1fr]");
    expect(s).not.toContain("BarraCamadas");
    expect(s).not.toContain("NovaConsultaModal");
    expect(s).not.toContain("useObservacaoSatelitalCompleta");
    expect(s).not.toContain("sincronizarRastersNoMapa");
    expect(s).not.toContain("rotulosDasAreas");
    expect(s).not.toContain("CamadaDesenho");
  });

  it("página própria em /mapa-de-manejo", () => {
    const page = readFileSync(resolve(dir, "../../app/(app)/mapa-de-manejo/page.tsx"), "utf8");
    expect(page).toContain("MapaDeManejo");
    expect(page).not.toContain("MapaGeral");
  });

  it("menu: módulo Mapa de Manejo separado do Mapa geral", () => {
    const nav = readFileSync(resolve(dir, "../../../nav.registry.mjs"), "utf8");
    expect(nav).toContain('m("mapa-manejo", "Mapa de Manejo", "/mapa-de-manejo"');
    expect(nav).toContain('m("mapa", "Mapa geral", "/mapa-geral"');
  });
});
