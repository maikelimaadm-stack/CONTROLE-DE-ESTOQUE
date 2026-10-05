import { describe, expect, it } from "vitest";
import {
  LIMITE_AREAS_NA_CONSULTA,
  areasDesatualizadas,
  consultaTerminou,
  itensDaConsulta,
  montarCorpoConsulta,
  progressoDaConsulta,
  resolverAlvo,
  validarPeriodo,
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

  it("retiro e empresa mandam o alvo do servidor, sem geometria nem empresa_id no corpo", () => {
    expect(resolverAlvo("retiro", fonte({ retiroId: "r1" }))).toEqual({ ok: true, alvo: { tipo: "retiro", retiro_id: "r1" }, quantidade: null });
    expect(resolverAlvo("empresa", fonte())).toEqual({ ok: true, alvo: { tipo: "todas" }, quantidade: null });
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
    const c = montarCorpoConsulta({ tipo: "todas" }, { tipo: "mais_recente", janela_dias: 30 }, false);
    expect(Object.keys(c).sort()).toEqual(["alvo", "confirmar", "indices", "periodo"]);
    expect(c).toEqual({ alvo: { tipo: "todas" }, periodo: { tipo: "mais_recente", janela_dias: 30 }, indices: ["pastagem_essencial"], confirmar: false });
  });

  it("expõe os três períodos que a API aceita, sem traduzir nem descartar campo", () => {
    expect(montarCorpoConsulta({ tipo: "todas" }, { tipo: "data", data: "2026-09-10", tolerancia_dias: 3 }, true).periodo)
      .toEqual({ tipo: "data", data: "2026-09-10", tolerancia_dias: 3 });
    expect(montarCorpoConsulta({ tipo: "todas" }, { tipo: "intervalo", de: "2026-07-01", ate: "2026-09-30", cadencia: "mensal" }, true).periodo)
      .toEqual({ tipo: "intervalo", de: "2026-07-01", ate: "2026-09-30", cadencia: "mensal" });
  });
});

describe("validarPeriodo (a mesma regra do servidor)", () => {
  const HOJE = "2026-10-05";

  it("mais recente: janela na faixa 1..90 vira 1 recorte; fora da faixa é recusada, nunca corrigida", () => {
    expect(validarPeriodo({ tipo: "mais_recente", janelaDias: 30 }, HOJE)).toEqual({ ok: true, periodo: { tipo: "mais_recente", janela_dias: 30 }, slots: 1 });
    expect(validarPeriodo({ tipo: "mais_recente", janelaDias: 0 }, HOJE).ok).toBe(false);
    expect(validarPeriodo({ tipo: "mais_recente", janelaDias: 500 }, HOJE).ok).toBe(false);
  });

  it("data: exige a data; futura, anterior ao acervo ou tolerância fora da faixa são recusadas", () => {
    const base = { tipo: "data", toleranciaDias: 3 } as const;
    expect(validarPeriodo({ ...base, data: "" }, HOJE)).toEqual({ ok: false, motivo: "Escolha a data." });
    expect(validarPeriodo({ ...base, data: "2026-09-10" }, HOJE)).toMatchObject({ ok: true, slots: 1, periodo: { tipo: "data", data: "2026-09-10", tolerancia_dias: 3 } });
    expect(validarPeriodo({ ...base, data: "2026-10-06" }, HOJE).ok).toBe(false);
    expect(validarPeriodo({ ...base, data: "2017-01-01" }, HOJE).ok).toBe(false);
    expect(validarPeriodo({ ...base, data: "2026-09-10", toleranciaDias: 31 }, HOJE).ok).toBe(false);
    expect(validarPeriodo({ ...base, data: "2026-09-10", toleranciaDias: 0 }, HOJE).ok).toBe(true);
  });

  it("intervalo: um recorte por mês ou decêndio; de depois de até é recusado", () => {
    const m = validarPeriodo({ tipo: "intervalo", de: "2026-07-01", ate: "2026-09-30", cadencia: "mensal" }, HOJE);
    expect(m).toMatchObject({ ok: true, slots: 3 });
    const d = validarPeriodo({ tipo: "intervalo", de: "2026-07-01", ate: "2026-09-30", cadencia: "decendial" }, HOJE);
    expect(d).toMatchObject({ ok: true, slots: 9 });
    expect(validarPeriodo({ tipo: "intervalo", de: "2026-09-30", ate: "2026-07-01", cadencia: "mensal" }, HOJE).ok).toBe(false);
    expect(validarPeriodo({ tipo: "intervalo", de: "", ate: "2026-07-01", cadencia: "mensal" }, HOJE)).toEqual({ ok: false, motivo: "Escolha a data inicial e a final." });
  });

  it("itens = áreas × recortes (acima de 200 a tela recusa antes do servidor)", () => {
    expect(itensDaConsulta(10, 3)).toBe(30);
    expect(itensDaConsulta(null, 3)).toBeNull();
  });
});

describe("Áreas desatualizadas", () => {
  const a = (id: string, geometria: unknown = { type: "Polygon" }) => ({ id, geometria });
  const resumo = new Map([
    ["valida", { ultima_observacao: { do_poligono_atual: true } }],
    ["contorno-antigo", { ultima_observacao: { do_poligono_atual: false } }],
    ["so-tentativa", { ultima_observacao: null }]
  ]);

  it("sem observação útil, ou com observação de outro contorno, está desatualizada; sem contorno nunca entra", () => {
    const ids = areasDesatualizadas([a("valida"), a("contorno-antigo"), a("so-tentativa"), a("ausente"), a("sem-contorno", null)], resumo);
    expect(ids).toEqual(["contorno-antigo", "so-tentativa", "ausente"]);
  });

  it("vira alvo de áreas; sem lista (resumo incompleto) a seleção é recusada, nunca chutada", () => {
    expect(resolverAlvo("desatualizadas", fonte({ desatualizadas: ["x", "y"] }))).toMatchObject({ ok: true, alvo: { tipo: "areas", area_ids: ["x", "y"] }, quantidade: 2 });
    expect(resolverAlvo("desatualizadas", fonte({ desatualizadas: null })).ok).toBe(false);
    expect(resolverAlvo("desatualizadas", fonte()).ok).toBe(false);
    expect(resolverAlvo("desatualizadas", fonte({ desatualizadas: [] })).ok).toBe(false);
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
