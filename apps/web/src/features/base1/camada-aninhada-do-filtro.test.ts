import { describe, expect, it } from "vitest";
import { ehCamadaAninhadaDoFiltro, SELETOR_CAMADA_ANINHADA_DO_FILTRO } from "./camada-aninhada-do-filtro";

/** Elemento mínimo com `closest` (vitest web roda em `environment: "node"`). */
function alvoComClosest(resposta: Element | null): EventTarget {
  return { closest: (sel: string) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? resposta : null) } as unknown as EventTarget;
}

describe("ehCamadaAninhadaDoFiltro", () => {
  it("ignora alvo nulo ou sem closest", () => {
    expect(ehCamadaAninhadaDoFiltro(null)).toBe(false);
    expect(ehCamadaAninhadaDoFiltro({} as EventTarget)).toBe(false);
  });

  it("reconhece clique na lista portalada da condição", () => {
    expect(ehCamadaAninhadaDoFiltro(alvoComClosest({} as Element))).toBe(true);
  });

  it("não trata clique fora das camadas aninhadas", () => {
    expect(ehCamadaAninhadaDoFiltro(alvoComClosest(null))).toBe(false);
  });

  it("o seletor cobre condição, cmd-panel e calendário", () => {
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain("data-filtro-camada");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain(".fsell");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain(".cmd-panel");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain(".mg-dp-panel");
  });
});
