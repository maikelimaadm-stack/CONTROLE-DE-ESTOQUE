import { describe, expect, it } from "vitest";
import {
  canonizarAlvo,
  chaveDaPrevia,
  previaCorrespondeAoPedido,
  type AlvoConsulta,
  type PeriodoConsulta
} from "./consulta-satelite";

const periodoA: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 30 };
const periodoB: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 15 };

describe("chaveDaPrevia / ordem irrelevante", () => {
  it("canoniza area_ids independente da ordem", () => {
    const a: AlvoConsulta = { tipo: "areas", area_ids: ["b", "a", "a"] };
    const b: AlvoConsulta = { tipo: "areas", area_ids: ["a", "b"] };
    expect(canonizarAlvo(a)).toEqual({ tipo: "areas", area_ids: ["a", "b"] });
    expect(chaveDaPrevia({ alvo: a, periodo: periodoA, organizationId: "o1", empresaId: "e1" }))
      .toBe(chaveDaPrevia({ alvo: b, periodo: periodoA, organizationId: "o1", empresaId: "e1" }));
  });

  it("muda com período, org, empresa ou alvo", () => {
    const base = { alvo: { tipo: "todas" as const }, periodo: periodoA, organizationId: "o1", empresaId: "e1" };
    const k = chaveDaPrevia(base);
    expect(chaveDaPrevia({ ...base, periodo: periodoB })).not.toBe(k);
    expect(chaveDaPrevia({ ...base, organizationId: "o2" })).not.toBe(k);
    expect(chaveDaPrevia({ ...base, empresaId: "e2" })).not.toBe(k);
    expect(chaveDaPrevia({ ...base, alvo: { tipo: "areas", area_ids: ["x"] } })).not.toBe(k);
  });

  it("previaCorrespondeAoPedido ignora resposta antiga (cenário A/B)", () => {
    const chaveA = chaveDaPrevia({ alvo: { tipo: "todas" }, periodo: periodoA, organizationId: "o", empresaId: "e" });
    const chaveB = chaveDaPrevia({ alvo: { tipo: "todas" }, periodo: periodoB, organizationId: "o", empresaId: "e" });
    expect(previaCorrespondeAoPedido({ chave: chaveA }, chaveB)).toBe(false);
    expect(previaCorrespondeAoPedido({ chave: chaveB }, chaveB)).toBe(true);
    expect(previaCorrespondeAoPedido(null, chaveB)).toBe(false);
  });
});
