import { describe, expect, it } from "vitest";
import {
  LIMITE_AREAS_NA_CONSULTA,
  consultaTerminou,
  montarCorpoConsulta,
  progressoDaConsulta,
  resolverAlvo,
  type FonteDeSelecao
} from "./consulta-satelite";

const fonte = (p: Partial<FonteDeSelecao> = {}): FonteDeSelecao => ({ areaAtualId: null, escolhidas: [], naVista: [], semAnalise: [], retiroId: null, ...p });

describe("resolverAlvo", () => {
  it("área aberta, escolhidas, vista e sem análise viram lista de ids sem repetição", () => {
    expect(resolverAlvo("atual", fonte({ areaAtualId: "a" }))).toEqual({ ok: true, alvo: { tipo: "areas", area_ids: ["a"] }, quantidade: 1 });
    expect(resolverAlvo("escolhidas", fonte({ escolhidas: ["a", "b", "a"] }))).toMatchObject({ ok: true, quantidade: 2 });
    expect(resolverAlvo("viewport", fonte({ naVista: ["x", "y"] }))).toMatchObject({ ok: true, alvo: { area_ids: ["x", "y"] } });
    expect(resolverAlvo("sem_analise", fonte({ semAnalise: ["z"] }))).toMatchObject({ ok: true, quantidade: 1 });
  });

  it("retiro e fazenda mandam o alvo do servidor, sem geometria nem empresa", () => {
    expect(resolverAlvo("retiro", fonte({ retiroId: "r1" }))).toEqual({ ok: true, alvo: { tipo: "retiro", retiro_id: "r1" }, quantidade: null });
    expect(resolverAlvo("fazenda", fonte())).toEqual({ ok: true, alvo: { tipo: "todas" }, quantidade: null });
  });

  it("seleção vazia ou acima do teto de 200 itens é recusada na tela", () => {
    expect(resolverAlvo("atual", fonte()).ok).toBe(false);
    expect(resolverAlvo("escolhidas", fonte()).ok).toBe(false);
    expect(resolverAlvo("retiro", fonte()).ok).toBe(false);
    const muitas = Array.from({ length: LIMITE_AREAS_NA_CONSULTA + 1 }, (_, i) => `a${i}`);
    expect(resolverAlvo("viewport", fonte({ naVista: muitas })).ok).toBe(false);
    expect(resolverAlvo("viewport", fonte({ naVista: muitas.slice(0, LIMITE_AREAS_NA_CONSULTA) })).ok).toBe(true);
  });
});

describe("montarCorpoConsulta", () => {
  it("corpo estrito: alvo, período, bundle de 6 índices e confirmar — nada mais", () => {
    const c = montarCorpoConsulta({ tipo: "todas" }, 30, false);
    expect(Object.keys(c).sort()).toEqual(["alvo", "confirmar", "indices", "periodo"]);
    expect(c).toEqual({ alvo: { tipo: "todas" }, periodo: { tipo: "mais_recente", janela_dias: 30 }, indices: ["pastagem_essencial"], confirmar: false });
  });

  it("a janela fica nos limites do domínio (1..90)", () => {
    expect(montarCorpoConsulta({ tipo: "todas" }, 0, true).periodo.janela_dias).toBe(1);
    expect(montarCorpoConsulta({ tipo: "todas" }, 500, true).periodo.janela_dias).toBe(90);
    expect(montarCorpoConsulta({ tipo: "todas" }, 15, true).confirmar).toBe(true);
  });
});

describe("progresso", () => {
  const base = { total_itens: 10, total_concluidos: 0, total_falhos: 0, total_reaproveitados: 0 };
  it("conta concluídos + reaproveitados + falhos, limitado ao total", () => {
    expect(progressoDaConsulta({ ...base, situacao: "executando", total_concluidos: 3, total_reaproveitados: 2 })).toBe(50);
    expect(progressoDaConsulta({ ...base, situacao: "executando", total_concluidos: 30 })).toBe(100);
    expect(progressoDaConsulta({ ...base, total_itens: 0, situacao: "pendente" })).toBe(0);
  });
  it("situação final = 100% e para o acompanhamento", () => {
    expect(progressoDaConsulta({ ...base, situacao: "concluida_com_falhas", total_falhos: 1 })).toBe(100);
    expect(consultaTerminou("concluida")).toBe(true);
    expect(consultaTerminou("executando")).toBe(false);
  });
});
