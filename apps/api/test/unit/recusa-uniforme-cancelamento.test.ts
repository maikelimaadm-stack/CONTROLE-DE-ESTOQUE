import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SUPERFÍCIE DE RECUSA UNIFORME NO CANCELAMENTO DE BAIXA — E POR QUE ESTE GATE É ESTÁTICO.
 *
 * A rota `POST .../settlements/:sid/cancel` recusa por cinco motivos diferentes: título inexistente, de
 * outro tenant, excluído, de variante errada, e fora do escopo de empresa. O contrato
 * (`.claude/rules/security.md`) exige que sejam INDISTINGUÍVEIS de fora — "mesma 404, mesma mensagem".
 * Como `notFound(x)` e `exigirEmpresaVisivel(..., x)` produzem `${x} não encontrado`, rótulos diferentes
 * na mesma rota produzem MENSAGENS diferentes para o mesmo 404.
 *
 * POR QUE NÃO UM TESTE DE INTEGRAÇÃO. Foi a primeira tentativa, e a verificação reversa a reprovou: o
 * teste PASSAVA com o defeito reintroduzido. A causa é real e vale registrar, porque muda o tamanho do
 * problema: `erp.financial_titles` é categoria A na COMPANY-RLS-MATRIX e `runService` fixa
 * `app.modulo_empresa` na MESMA transação, então a RLS e o `empresaPermitida` respondem pelo mesmo
 * módulo. O SELECT já não devolve a linha fora de escopo, e a conferência seguinte é inalcançável por
 * aquele caminho. Ou seja: a divergência de rótulo NÃO é hoje um oráculo de existência explorável — é
 * uma inconsistência que só vira vazamento no dia em que a tabela mudar de categoria de RLS ou em que a
 * conferência passar a rodar antes do recorte.
 *
 * Duas conclusões, e as duas importam. A primeira é que um teste de comportamento aqui seria verde
 * permanente, indistinguível de um gate quebrado — e a decisão 171 já fixou que regressão
 * behavioralmente indistinguível se trava de forma ESTÁTICA. A segunda é que a uniformidade continua
 * valendo a pena: ela custa uma palavra e remove a armadilha antes que ela tenha consequência.
 */
const ROTA = path.resolve(__dirname, "../../src/routes/financial.ts");

/** Recorta o corpo da rota de cancelamento, do registro da rota até o fechamento do handler. */
function corpoDoCancelamento(fonte: string): string {
  const inicio = fonte.indexOf("app.post(`${base}/:id/settlements/:sid/cancel`");
  expect(inicio, "a rota de cancelamento sumiu do arquivo — não aprovo por ausência").toBeGreaterThan(-1);
  const fim = fonte.indexOf("app.get(`${base}/:id/receipt`", inicio);
  expect(fim, "não achei o fim do handler (a rota seguinte) — recorte inválido").toBeGreaterThan(inicio);
  return fonte.slice(inicio, fim);
}

describe("recusa uniforme no cancelamento de baixa", () => {
  it("todas as recusas da rota usam o MESMO rótulo, então produzem a mesma mensagem", () => {
    const corpo = corpoDoCancelamento(fs.readFileSync(ROTA, "utf8"));

    const deNotFound = [...corpo.matchAll(/notFound\("([^"]+)"\)/g)].map((m) => m[1]!);
    const deEscopo = [...corpo.matchAll(/exigirEmpresaVisivel\([^)]*?,\s*"([^"]+)"/g)].map((m) => m[1]!);

    // A premissa, contada — sem ela o teste aprovaria um arquivo onde as chamadas sumiram.
    expect(deNotFound.length, "esperava as recusas por inexistência/variante/tenant").toBeGreaterThanOrEqual(2);
    expect(deEscopo.length, "esperava as conferências de escopo de empresa dos DOIS títulos").toBeGreaterThanOrEqual(2);

    const rotulos = [...new Set([...deNotFound, ...deEscopo])];
    expect(rotulos, `rótulos diferentes na mesma rota viram MENSAGENS diferentes para o mesmo 404: ${rotulos.join(" · ")}`).toEqual(["Baixa"]);
  });
});
