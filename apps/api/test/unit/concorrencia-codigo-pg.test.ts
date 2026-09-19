import { describe, it, expect } from "vitest";
import { errorHttpStatus } from "@agro/shared";
import { fromPgError } from "../../src/lib/errors.js";

/**
 * O QUE ESTE TESTE PROVA — E, TÃO IMPORTANTE QUANTO, O QUE ELE NÃO PROVA.
 *
 * A baixa cruzada trava DOIS títulos com `for update`: o principal e o contrário. Como a ordem depende
 * de qual rota recebeu a chamada, duas requisições simultâneas em sentidos opostos sobre o MESMO par
 * podem pegar os locks em ordem inversa — tanto na CRIAÇÃO quanto no CANCELAMENTO. Ordenação canônica
 * de locks é dívida declarada, fora do escopo deste hotfix.
 *
 * O runbook afirma que isso não corrompe nada: o Postgres aborta uma das transações e a API devolve um
 * erro RETRYABLE. Esta é a metade da afirmação que dá para provar de forma determinística — o
 * mapeamento. Um teste que tentasse PRODUZIR um deadlock real seria não determinístico por construção,
 * e um teste frágil que às vezes fica verde é indistinguível de um gate quebrado.
 *
 * Então: aqui se prova o mapeamento, e só ele. Que o deadlock nunca aconteça NÃO está provado, e o
 * relatório não afirma isso. O que garante a ausência de meia operação persistida é outra coisa, já
 * coberta: `runService` executa tudo em UMA transação — a abortada não deixa metade escrita.
 */
describe("códigos de concorrência do Postgres viram erro retryable", () => {
  // 40P01 = deadlock_detected · 40001 = serialization_failure. São os dois que o runbook cita.
  for (const code of ["40P01", "40001"] as const) {
    it(`${code} → CONCURRENCY_CONFLICT, com status de repetição`, () => {
      const e = fromPgError({ code, message: "deadlock detected" });
      // `fromPgError` devolve null para o que não conhece, e null vira 500 na borda: um mapeamento
      // ausente seria erro interno, não convite a repetir. Por isso a não-nulidade é asserção própria.
      expect(e, `${code} sem mapeamento cairia como INTERNAL_ERROR`).not.toBeNull();
      expect(e!.code).toBe("CONCURRENCY_CONFLICT");
      expect(errorHttpStatus[e!.code], "409 é o que diz ao chamador que repetir é a resposta certa").toBe(409);
    });
  }

  it("um código NÃO relacionado continua sem mapeamento — o teste acima não passa por acidente", () => {
    // Sem este contraste, `fromPgError` poderia devolver CONCURRENCY_CONFLICT para qualquer coisa e os
    // dois casos acima ficariam verdes sem provar nada sobre o código recebido.
    expect(fromPgError({ code: "22P02", message: "invalid input syntax" })).toBeNull();
  });
});
