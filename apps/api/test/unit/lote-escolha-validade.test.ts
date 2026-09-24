import { describe, it, expect } from "vitest";
import { compararLotesPorValidade, dividirPorValidade, type LoteCandidato } from "../../src/services/stock-core.js";

/**
 * R1-1 — a ORDEM e a DIVISÃO da escolha automática de lote, sem banco. O que o banco acrescenta (quais linhas são
 * candidatas, vencido fora, trava) é medido em `test/integration/cadastros-lote-saida.test.ts`.
 */
const c = (lote: string, validade: string | null, quantidade: string): LoteCandidato => ({ lote, validade, quantidade });

describe("compararLotesPorValidade", () => {
  it("validade mais próxima primeiro; sem validade por último; empate pelo lote em ordem alfabética", () => {
    const lotes = [c("0-SEM", null, "1"), c("Z", "2026-10-05", "1"), c("A", "2026-10-10", "1"), c("m", "2026-10-05", "1"), c("B-SEM", null, "1")];
    expect([...lotes].sort(compararLotesPorValidade).map((l) => l.lote)).toEqual(["m", "Z", "A", "0-SEM", "B-SEM"]);
  });
  it("o resultado não depende da ordem de entrada (determinístico)", () => {
    const a = [c("L2", "2027-01-01", "1"), c("L1", "2027-01-01", "1"), c("L3", null, "1")];
    const b = [...a].reverse();
    expect(a.sort(compararLotesPorValidade)).toEqual(b.sort(compararLotesPorValidade));
  });
});

describe("dividirPorValidade", () => {
  it("esgota o lote de validade mais próxima antes de tocar o seguinte, em decimal exato", () => {
    const r = dividirPorValidade([c("TARDE", "2026-10-10", "10"), c("CEDO", "2026-10-05", "0.3")], "0.5");
    expect(r).toEqual({ partes: [{ lote: "CEDO", validade: "2026-10-05", quantidade: "0.3000" }, { lote: "TARDE", validade: "2026-10-10", quantidade: "0.2000" }], falta: "0.0000" });
  });
  it("devolve o que faltou quando os lotes não bastam (e não inventa parte)", () => {
    expect(dividirPorValidade([c("A", "2026-10-05", "3")], "5")).toEqual({ partes: [{ lote: "A", validade: "2026-10-05", quantidade: "3.0000" }], falta: "2.0000" });
    expect(dividirPorValidade([], "1")).toEqual({ partes: [], falta: "1.0000" });
  });
  it("não pega de lote que não precisa: 4 de um lote de 10 é uma parte só", () => {
    expect(dividirPorValidade([c("B", "2026-10-05", "10"), c("A", "2026-10-10", "10")], "4").partes).toEqual([{ lote: "B", validade: "2026-10-05", quantidade: "4.0000" }]);
  });
});
