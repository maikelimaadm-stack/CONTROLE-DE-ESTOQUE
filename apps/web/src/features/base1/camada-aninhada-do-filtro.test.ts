import { describe, expect, it } from "vitest";
import {
  deveFecharFiltroPorFora,
  ehCamadaAninhadaDoFiltro,
  haCamadaAninhadaDoFiltroAberta,
  ponteiroSobreElemento,
  SELETOR_CAMADA_ANINHADA_DO_FILTRO,
} from "./camada-aninhada-do-filtro";

/** Elemento mínimo com `closest` (vitest web roda em `environment: "node"`). */
function alvoComClosest(resposta: Element | null): EventTarget {
  return { closest: (sel: string) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? resposta : null) } as unknown as EventTarget;
}

function rect(el: { left: number; top: number; right: number; bottom: number }): Element {
  return { getBoundingClientRect: () => el } as unknown as Element;
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

describe("ponteiroSobreElemento / deveFecharFiltroPorFora (359)", () => {
  const shell = rect({ left: 100, top: 100, right: 300, bottom: 400 });

  it("ponteiroSobreElemento usa a caixa do elemento", () => {
    expect(ponteiroSobreElemento({ clientX: 150, clientY: 200 }, shell)).toBe(true);
    expect(ponteiroSobreElemento({ clientX: 50, clientY: 200 }, shell)).toBe(false);
    expect(ponteiroSobreElemento(null, shell)).toBe(false);
    expect(ponteiroSobreElemento({ clientX: 150, clientY: 200 }, null)).toBe(false);
  });

  it("não fecha quando o alvo é html/body mas o ponteiro está sobre o shell (Select pointer-events:none)", () => {
    // Alvo “fora” (como com body pointer-events:none), porém cursor sobre o gatilho/shell.
    expect(deveFecharFiltroPorFora({
      alvo: { closest: () => null } as unknown as EventTarget,
      ponto: { clientX: 180, clientY: 220 },
      shell,
    })).toBe(false);
  });

  it("fecha só com fora real (alvo e ponteiro fora do shell e sem camada)", () => {
    expect(deveFecharFiltroPorFora({
      alvo: { closest: () => null } as unknown as EventTarget,
      ponto: { clientX: 10, clientY: 10 },
      shell,
      doc: { querySelector: () => null } as unknown as ParentNode,
    })).toBe(true);
  });

  it("não fecha quando o alvo é a camada portalada da condição", () => {
    expect(deveFecharFiltroPorFora({
      alvo: alvoComClosest({} as Element),
      ponto: { clientX: 10, clientY: 10 },
      shell,
      doc: { querySelector: () => null } as unknown as ParentNode,
    })).toBe(false);
  });

  it("haCamadaAninhadaDoFiltroAberta consulta o seletor no documento", () => {
    const doc = {
      querySelector: (sel: string) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? ({} as Element) : null),
    } as unknown as ParentNode;
    expect(haCamadaAninhadaDoFiltroAberta(doc)).toBe(true);
    expect(haCamadaAninhadaDoFiltroAberta({ querySelector: () => null } as unknown as ParentNode)).toBe(false);
  });
});

describe("deveFecharFiltroPorFora — dois passos com camada aberta (360)", () => {
  const shell = rect({ left: 100, top: 100, right: 300, bottom: 400 });
  const alvoFora = { closest: () => null } as unknown as EventTarget;
  const pontoFora = { clientX: 10, clientY: 10 };
  const docComCamada = {
    querySelector: (sel: string) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? ({} as Element) : null),
  } as unknown as ParentNode;
  const docSemCamada = { querySelector: () => null } as unknown as ParentNode;

  it("1º fora com listagem/calendário/cmd abertos NÃO fecha o shell", () => {
    expect(deveFecharFiltroPorFora({
      alvo: alvoFora,
      ponto: pontoFora,
      shell,
      doc: docComCamada,
    })).toBe(false);
  });

  it("2º fora sem camada aberta fecha o shell", () => {
    expect(deveFecharFiltroPorFora({
      alvo: alvoFora,
      ponto: pontoFora,
      shell,
      doc: docSemCamada,
    })).toBe(true);
  });
});
