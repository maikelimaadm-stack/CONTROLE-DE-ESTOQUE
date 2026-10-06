import { describe, expect, it } from "vitest";
import {
  COR_CLASSE_NDVI,
  COR_SEM_ANALISE,
  corAnaliticaDaArea,
  corDaMediaDoIndice,
  coresPorArea,
  mediaValidaDoIndice
} from "./cor-por-area";
import { corDoValor } from "./paletas-indices";

const obs = (valor_medio: string | null, do_poligono_atual = true) => ({ ultima_observacao: { valor_medio, do_poligono_atual } });
const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

describe("média válida do índice ativo", () => {
  it("exige observação do contorno atual e média finita", () => {
    expect(mediaValidaDoIndice(obs("0.42"))).toBe(0.42);
    expect(mediaValidaDoIndice(obs("0"))).toBe(0);
    expect(mediaValidaDoIndice(obs("0.42", false))).toBeNull();
    expect(mediaValidaDoIndice(obs(null))).toBeNull();
    expect(mediaValidaDoIndice(obs(""))).toBeNull();
    expect(mediaValidaDoIndice(obs("abc"))).toBeNull();
    expect(mediaValidaDoIndice({ ultima_observacao: null })).toBeNull();
    expect(mediaValidaDoIndice(undefined)).toBeNull();
  });
});

describe("cor da área (fallback visual do índice ativo)", () => {
  it("com estatística válida: a cor vem da paleta DO índice ativo", () => {
    expect(corAnaliticaDaArea("ndmi", obs("0.30"))).toEqual({ cor: hex(corDoValor("ndmi", 0.3)), origem: "indice" });
    expect(corAnaliticaDaArea("bsi", obs("0.30"))).toEqual({ cor: hex(corDoValor("bsi", 0.3)), origem: "indice" });
    expect(corDaMediaDoIndice("ndmi", 0.3)).not.toBe(corDaMediaDoIndice("bsi", 0.3));
  });

  it("NDVI mantém as classes da escala fixa (legenda por área do NDVI)", () => {
    expect(corAnaliticaDaArea("ndvi", obs("0.80")).cor).toBe(COR_CLASSE_NDVI.alto);
    expect(corAnaliticaDaArea("ndvi", obs("0.10")).cor).toBe(COR_CLASSE_NDVI.sem_vegetacao);
  });

  it("sem análise válida: cinza neutro (nunca a cor do cadastro nem a de outro índice)", () => {
    for (const indice of ["ndvi", "ndmi", "bsi", "msavi2"] as const) {
      expect(corAnaliticaDaArea(indice, undefined)).toEqual({ cor: COR_SEM_ANALISE, origem: "sem_analise" });
      expect(corAnaliticaDaArea(indice, obs("0.5", false)).origem).toBe("sem_analise");
      expect(corAnaliticaDaArea(indice, obs(null)).origem).toBe("sem_analise");
    }
  });
});

describe("mapa de cores por área", () => {
  const areas = [{ id: "com" }, { id: "sem" }, { id: "antigo" }];
  const resumo = new Map([["com", obs("0.30")], ["antigo", obs("0.30", false)]]);

  it("'Cor do cadastro' é o ÚNICO modo sem cor analítica (null: o mapa usa o cadastro porque o usuário o escolheu)", () => {
    expect(coresPorArea("cadastro", "ndmi", areas, resumo)).toBeNull();
  });

  it("por área e por pixel: cada área ganha cor do índice ativo ou cinza — nunca fica de fora", () => {
    for (const modo of ["area", "pixel"] as const) {
      const m = coresPorArea(modo, "ndmi", areas, resumo)!;
      expect([...m.keys()]).toEqual(["com", "sem", "antigo"]);
      expect(m.get("com")).toBe(hex(corDoValor("ndmi", 0.3)));
      expect(m.get("sem")).toBe(COR_SEM_ANALISE);
      expect(m.get("antigo")).toBe(COR_SEM_ANALISE);
    }
  });

  it("resumo ainda não carregado: tudo cinza, sem cair no cadastro", () => {
    const m = coresPorArea("pixel", "ndmi", areas, null)!;
    expect([...m.values()].every((c) => c === COR_SEM_ANALISE)).toBe(true);
  });
});
