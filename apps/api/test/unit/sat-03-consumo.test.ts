import { describe, it, expect } from "vitest";
import type { Tx } from "@agro/db";
import { gravarConsumo, lerPuDoCabecalho } from "../../src/lib/satelite/consumo.js";

/**
 * SAT-03 (decisão 296) — a leitura do PU do cabeçalho `x-processingunits-spent` (forma estrita, nunca traduzida) e a
 * gravação no ledger: crédito calculado no SQL, par nulo com a origem quando o PU não vale, ROW COUNT conferido.
 * A gravação de verdade (com o CHECK do banco) está nos testes de integração; aqui, o SQL e os parâmetros enviados.
 */

describe("SAT-03 lerPuDoCabecalho — forma estrita", () => {
  it("válidos: inteiro e decimal até 12 casas, a origem é o bruto", () => {
    for (const v of ["0", "1", "0.5", "12.3456", "0000000001.000000000001", "9999999999", "0.000000000001", "9999999999.9999", "9999999999.99994999"]) {
      expect(lerPuDoCabecalho(v), v).toEqual({ pu: v, origem: v });
    }
  });
  it("ausente → par nulo com `cabecalho_ausente`", () => {
    expect(lerPuDoCabecalho(null)).toEqual({ pu: null, origem: "cabecalho_ausente" });
  });
  it("fora da forma → par nulo com `cabecalho_invalido` (nunca traduzido)", () => {
    const invalidos = ["1e2", "-1", "", "abc", "1,5", "NaN", "Infinity", " 1", "1 ", "+1", ".5", "5.", "0x2", "1.2.3", "１",
      "12345678901", "1.0000000000001", "7".repeat(70), "1;2", "1\n",
      // cabe na forma, mas arredondado para 4 casas passa do numeric(14,4) da coluna (derrubaria a transação)
      "9999999999.99995", "9999999999.999999999999"];
    for (const v of invalidos) expect(lerPuDoCabecalho(v), JSON.stringify(v)).toEqual({ pu: null, origem: "cabecalho_invalido" });
  });
});

/** Transação falsa: registra o SQL e os parâmetros; devolve as linhas pedidas. */
function txFalsa(resposta: { rowCount: number; rows: unknown[] }) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const tx = { query: async (sql: string, params: unknown[]) => { chamadas.push({ sql, params }); return resposta; } } as unknown as Tx;
  return { tx, chamadas };
}
const DADOS = { organizationId: "o", empresaId: "e", consultaId: null, consultaItemId: null };

describe("SAT-03 gravarConsumo — uma linha no ledger", () => {
  it("PU válido: operação statistical, crédito calculado PELO BANCO sobre o PU no tipo da coluna, origem = o bruto", async () => {
    const f = txFalsa({ rowCount: 1, rows: [{ id: "c1", pu_gasto: "0.5051", creditos: "50.51" }] });
    expect(await gravarConsumo(f.tx, { ...DADOS, puCabecalho: "0.5051" })).toEqual({ id: "c1", pu_gasto: "0.5051", creditos: "50.51" });
    const [c] = f.chamadas;
    expect(c!.sql).toMatch(/insert into erp\.satelite_consumo/);
    expect(c!.sql).toMatch(/'statistical'/);
    expect(c!.sql).toMatch(/\$5::numeric\(14,4\), round\(\$5::numeric\(14,4\) \* 100, 2\)/);
    expect(c!.params).toEqual(["o", "e", null, null, "0.5051", "0.5051"]);
  });
  it("sem cabeçalho ou inválido: PU nulo (o crédito do SQL também sai nulo) e a origem com o motivo", async () => {
    for (const [bruto, origem] of [[null, "cabecalho_ausente"], ["1e2", "cabecalho_invalido"]] as const) {
      const f = txFalsa({ rowCount: 1, rows: [{ id: "c", pu_gasto: null, creditos: null }] });
      await gravarConsumo(f.tx, { ...DADOS, consultaId: "q", consultaItemId: "i", puCabecalho: bruto });
      expect(f.chamadas[0]!.params).toEqual(["o", "e", "q", "i", null, origem]);
    }
  });
  it("ROW COUNT ≠ 1 (RLS devolveu zero linhas) → erro, nunca sucesso sem efeito", async () => {
    await expect(gravarConsumo(txFalsa({ rowCount: 0, rows: [] }).tx, { ...DADOS, puCabecalho: "1" })).rejects.toThrow(/exatamente uma linha/);
  });
});
