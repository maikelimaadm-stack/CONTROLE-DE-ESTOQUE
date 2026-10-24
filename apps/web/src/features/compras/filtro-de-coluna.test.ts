import { describe, expect, it } from "vitest";
import { ehCamadaAninhadaDoFiltro, SELETOR_CAMADA_ANINHADA_DO_FILTRO } from "@/features/base1/camada-aninhada-do-filtro";
import { casa, type FiltroAtivo } from "./filtro-de-coluna";

const filtro = (op: string, v1: string, v2 = ""): FiltroAtivo => ({ op, v1, v2, valores: null });

/** Enter aplica só no shell; na camada portalada da condição o Enter escolhe a opção (decisão 358). */
function enterAplicaNoFiltro(alvo: EventTarget | null): boolean {
  return !ehCamadaAninhadaDoFiltro(alvo);
}

describe("filtros dos cabeçalhos de Compras", () => {
  it("compara quantidade e moeda no formato exibido", () => {
    expect(casa(filtro("mai", "2.000"), "num", "2.400,0000")).toBe(true);
    expect(casa(filtro("men", "10"), "num", "R$ 6,19")).toBe(true);
    expect(casa(filtro("ig", "0"), "num", "—")).toBe(false);
  });
  it("combina a condição com a lista de valores marcada", () => {
    expect(casa({ ...filtro("cont", "diesel"), valores: new Set(["Diesel S10"]) }, "texto", "Diesel S10")).toBe(true);
    expect(casa({ ...filtro("cont", "diesel"), valores: new Set() }, "texto", "Diesel S10")).toBe(false);
  });
  it("compara datas brasileiras e rejeita datas inexistentes", () => {
    expect(casa(filtro("mai", "01/01/2099"), "data", "18/10/2026")).toBe(false);
    expect(casa(filtro("entre", "31/10/2026", "01/10/2026"), "data", "18/10/2026")).toBe(true);
    expect(casa(filtro("ig", "31/02/2026"), "data", "31/02/2026")).toBe(false);
  });
  it("não aplica um intervalo ainda incompleto", () => {
    expect(casa(filtro("entre", "10"), "num", "5")).toBe(true);
  });
  it("Enter no valor aplica; Enter na condição portalada não (358)", () => {
    const fora = { closest: () => null } as unknown as EventTarget;
    const naCondicao = {
      closest: (sel: string) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? ({} as Element) : null),
    } as unknown as EventTarget;
    expect(enterAplicaNoFiltro(fora)).toBe(true);
    expect(enterAplicaNoFiltro(naCondicao)).toBe(false);
  });
});
