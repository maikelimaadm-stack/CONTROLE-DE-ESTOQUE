import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { areaNoPontoGeografico, pontoNoPoligono, type AreaComGeometria } from "./ponto-no-poligono";

/**
 * MAPA-MANEJO-04 — o ponto-em-polígono do arraste do lote (o único cálculo geométrico da tela): dentro, fora, borda,
 * polígono em L (o canto vazio é fora), furo, geometria inválida e área de cima quando duas se sobrepõem.
 */

/** Quadrado 0..10 × 0..10 (lon × lat), anel fechado. */
const QUADRADO: Polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

/**
 * L: o quadrado 0..10 sem o canto superior direito (5..10 × 5..10).
 *   (0,10)──(5,10)
 *     │       │
 *     │     (5,5)──(10,5)
 *     │              │
 *   (0,0)─────────(10,0)
 */
const EM_L: Polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]]] };

/** Quadrado 0..10 com um furo 4..6 × 4..6 no meio. */
const COM_FURO: Polygon = {
  type: "Polygon",
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
  ]
};

describe("MM4 — pontoNoPoligono", () => {
  it("dentro do quadrado", () => {
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, QUADRADO)).toBe(true);
    expect(pontoNoPoligono({ lon: 0.001, lat: 9.999 }, QUADRADO)).toBe(true);
  });

  it("fora do quadrado (em cada lado)", () => {
    expect(pontoNoPoligono({ lon: -0.001, lat: 5 }, QUADRADO)).toBe(false);
    expect(pontoNoPoligono({ lon: 10.001, lat: 5 }, QUADRADO)).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: -0.001 }, QUADRADO)).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: 10.001 }, QUADRADO)).toBe(false);
  });

  it("borda e vértice contam como dentro", () => {
    expect(pontoNoPoligono({ lon: 0, lat: 5 }, QUADRADO)).toBe(true);
    expect(pontoNoPoligono({ lon: 5, lat: 10 }, QUADRADO)).toBe(true);
    expect(pontoNoPoligono({ lon: 10, lat: 10 }, QUADRADO)).toBe(true);
  });

  it("polígono em L: os dois braços são dentro, o canto vazio é fora", () => {
    expect(pontoNoPoligono({ lon: 2, lat: 8 }, EM_L)).toBe(true);
    expect(pontoNoPoligono({ lon: 8, lat: 2 }, EM_L)).toBe(true);
    expect(pontoNoPoligono({ lon: 2, lat: 2 }, EM_L)).toBe(true);
    // o canto recortado está dentro da caixa envolvente, mas fora do polígono
    expect(pontoNoPoligono({ lon: 8, lat: 8 }, EM_L)).toBe(false);
    expect(pontoNoPoligono({ lon: 5.5, lat: 5.5 }, EM_L)).toBe(false);
    // a quina interna é borda
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, EM_L)).toBe(true);
  });

  it("furo: dentro do furo é fora; entre o furo e a borda é dentro; a borda do furo é borda (dentro)", () => {
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, COM_FURO)).toBe(false);
    expect(pontoNoPoligono({ lon: 2, lat: 2 }, COM_FURO)).toBe(true);
    expect(pontoNoPoligono({ lon: 8, lat: 5 }, COM_FURO)).toBe(true);
    expect(pontoNoPoligono({ lon: 4, lat: 5 }, COM_FURO)).toBe(true);
    // sem o furo, o mesmo ponto central é dentro: é o anel interno que o tira
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, QUADRADO)).toBe(true);
  });

  it("anel aberto (sem repetir o primeiro ponto) é fechado e funciona igual", () => {
    const aberto: Polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10]]] };
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, aberto)).toBe(true);
    expect(pontoNoPoligono({ lon: 11, lat: 5 }, aberto)).toBe(false);
  });

  it("geometria ausente, de outro tipo, degenerada ou ponto não numérico: fora (nunca lança)", () => {
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, null)).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, undefined)).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, { type: "Polygon", coordinates: [] })).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, { type: "Polygon", coordinates: [[[0, 0], [10, 0], [0, 0]]] })).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, { type: "Point", coordinates: [5, 5] } as unknown as Polygon)).toBe(false);
    expect(pontoNoPoligono({ lon: Number.NaN, lat: 5 }, QUADRADO)).toBe(false);
    expect(pontoNoPoligono({ lon: 5, lat: Number.POSITIVE_INFINITY }, QUADRADO)).toBe(false);
  });

  it("furo inválido é ignorado: vale o anel externo", () => {
    const furoRuim: Polygon = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 6]]] };
    expect(pontoNoPoligono({ lon: 5, lat: 5 }, furoRuim)).toBe(true);
  });

  it("coordenadas reais (lon/lat negativos, escala de piquete)", () => {
    const piquete: Polygon = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };
    expect(pontoNoPoligono({ lon: -54.995, lat: -15.005 }, piquete)).toBe(true);
    expect(pontoNoPoligono({ lon: -54.985, lat: -15.005 }, piquete)).toBe(false);
  });
});

describe("MM4 — areaNoPontoGeografico", () => {
  const a = (id: string, geometria: Polygon | null): AreaComGeometria => ({ id, geometria });
  const deslocado = (dx: number): Polygon => ({
    type: "Polygon",
    coordinates: [[[dx, 0], [dx + 10, 0], [dx + 10, 10], [dx, 10], [dx, 0]]]
  });

  it("devolve o id da área que contém o ponto", () => {
    const areas = [a("oeste", deslocado(0)), a("leste", deslocado(20))];
    expect(areaNoPontoGeografico({ lon: 5, lat: 5 }, areas)).toBe("oeste");
    expect(areaNoPontoGeografico({ lon: 25, lat: 5 }, areas)).toBe("leste");
  });

  it("fora de qualquer área: null", () => {
    const areas = [a("oeste", deslocado(0)), a("leste", deslocado(20))];
    expect(areaNoPontoGeografico({ lon: 15, lat: 5 }, areas)).toBeNull();
    expect(areaNoPontoGeografico({ lon: 5, lat: 5 }, [])).toBeNull();
  });

  it("área sem geometria nunca é destino", () => {
    expect(areaNoPontoGeografico({ lon: 5, lat: 5 }, [a("sem-contorno", null)])).toBeNull();
  });

  it("áreas sobrepostas: vale a de cima (a última da lista, a última desenhada)", () => {
    const areas = [a("embaixo", deslocado(0)), a("em-cima", deslocado(5))];
    expect(areaNoPontoGeografico({ lon: 7, lat: 5 }, areas)).toBe("em-cima");
    expect(areaNoPontoGeografico({ lon: 2, lat: 5 }, areas)).toBe("embaixo");
  });

  it("o furo de uma área não é dela: cai na área que está dentro do furo", () => {
    const dentroDoFuro: Polygon = { type: "Polygon", coordinates: [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    // a ilha vem ANTES na lista: mesmo assim o ponto não é da área com furo
    expect(areaNoPontoGeografico({ lon: 5, lat: 5 }, [a("ilha", dentroDoFuro), a("com-furo", COM_FURO)])).toBe("ilha");
  });
});
