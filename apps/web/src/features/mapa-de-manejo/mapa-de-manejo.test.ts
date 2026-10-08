import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rotuloPasto } from "./rotulo-pasto";

const dir = resolve(__dirname);
const src = (f: string) => readFileSync(resolve(dir, f), "utf8");

describe("Mapa de Manejo — pastos sem listagem", () => {
  it("rótulo prefere código (numeração) e cai no nome", () => {
    expect(rotuloPasto({ name: "Pasto Norte", code: "12" })).toBe("12");
    expect(rotuloPasto({ name: "Pasto Sul", code: "  " })).toBe("Pasto Sul");
    expect(rotuloPasto({ name: "Pasto Leste" })).toBe("Pasto Leste");
  });

  it("componente: mapa full-bleed, sem listagem lateral nem satélite", () => {
    const s = src("mapa-de-manejo.tsx");
    expect(s).toContain("Mapa de Manejo");
    expect(s).toContain("mapa-de-manejo");
    expect(s).toContain("mapa-manejo-canvas");
    expect(s).toContain("rotulosDasAreas");
    expect(s).toContain("rotuloPasto");
    expect(s).not.toContain("mapa-item-area");
    expect(s).not.toContain("grid-cols-[280px_1fr]");
    expect(s).not.toContain("BarraCamadas");
    expect(s).not.toContain("NovaConsultaModal");
    expect(s).not.toContain("useObservacaoSatelitalCompleta");
    expect(s).not.toContain("sincronizarRastersNoMapa");
  });

  it("página própria em /mapa-de-manejo", () => {
    const page = readFileSync(resolve(dir, "../../app/(app)/mapa-de-manejo/page.tsx"), "utf8");
    expect(page).toContain("MapaDeManejo");
    expect(page).not.toContain("MapaGeral");
  });
});
