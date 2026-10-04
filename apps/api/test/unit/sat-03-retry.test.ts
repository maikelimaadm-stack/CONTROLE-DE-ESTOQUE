import { describe, it, expect } from "vitest";
import { FalhaCopernicus, type TipoFalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import { ERRO_INTERNO, decidirAposFalha } from "../../src/lib/satelite/retry.js";
import { ESPERA_BASE_S, ESPERA_FATOR, ESPERA_JITTER, TENTATIVAS_POR_RODADA } from "../../src/lib/satelite/limites.js";

/**
 * SAT-03 (decisão 296) — a decisão depois de uma falha de item da fila: repetir (quando) ou falhar (com qual erro).
 * Os números vêm de `limites.ts`; o teste os lê de lá (nenhum número repetido aqui) e confere a conta.
 */

const AGORA = Date.parse("2026-10-04T12:00:00Z");
const MEIO = () => 0.5;        // sorteio no meio: variação zero
const MINIMO = () => 0;        // −JITTER
const MAXIMO = () => 1;        // +JITTER
const esperaS = (d: ReturnType<typeof decidirAposFalha>) => (d.tipo === "repetir" ? (d.proximaTentativaEm.getTime() - AGORA) / 1000 : NaN);
const base = (n: number) => ESPERA_BASE_S * ESPERA_FATOR ** (n - 1);

describe("SAT-03 retry — o que repete", () => {
  const REPETEM: [TipoFalhaCopernicus, number | null][] = [["limite", 429], ["indisponivel", 503], ["tempo", null], ["rede", null], ["processamento_parcial", null]];
  for (const [tipo, status] of REPETEM) {
    it(`${tipo}: repete com espera BASE × FATOR^(n−1) enquanto n < ${TENTATIVAS_POR_RODADA}; esgotou → falha`, () => {
      const f = new FalhaCopernicus(tipo, status);
      const texto = `${tipo}${status ? ` (HTTP ${status})` : ""}`;
      for (let n = 1; n < TENTATIVAS_POR_RODADA; n++) {
        const d = decidirAposFalha(f, n, AGORA, MEIO);
        expect(d, `tentativa ${n}`).toMatchObject({ tipo: "repetir", erro: texto });
        expect(esperaS(d)).toBe(base(n));
      }
      expect(decidirAposFalha(f, TENTATIVAS_POR_RODADA, AGORA, MEIO)).toEqual({ tipo: "falhar", erro: texto });
      expect(decidirAposFalha(f, TENTATIVAS_POR_RODADA + 4, AGORA, MEIO)).toEqual({ tipo: "falhar", erro: texto });
    });
  }
  it("os números de hoje: 30 s na primeira, 2 min na segunda, a terceira falha", () => {
    const f = new FalhaCopernicus("indisponivel", 500);
    expect(esperaS(decidirAposFalha(f, 1, AGORA, MEIO))).toBe(30);
    expect(esperaS(decidirAposFalha(f, 2, AGORA, MEIO))).toBe(120);
    expect(decidirAposFalha(f, 3, AGORA, MEIO).tipo).toBe("falhar");
  });
  it(`variação de ±${ESPERA_JITTER * 100}%: o sorteio injetado decide, dentro da faixa`, () => {
    const f = new FalhaCopernicus("rede");
    expect(esperaS(decidirAposFalha(f, 2, AGORA, MINIMO))).toBeCloseTo(base(2) * (1 - ESPERA_JITTER), 3);
    expect(esperaS(decidirAposFalha(f, 2, AGORA, MAXIMO))).toBeCloseTo(base(2) * (1 + ESPERA_JITTER), 3);
    for (let i = 0; i < 200; i++) {
      const s = esperaS(decidirAposFalha(f, 1, AGORA));
      expect(s).toBeGreaterThanOrEqual(base(1) * (1 - ESPERA_JITTER));
      expect(s).toBeLessThanOrEqual(base(1) * (1 + ESPERA_JITTER) + 0.001);
    }
    // sorteio fora de [0, 1] (função injetada errada) fica preso à faixa
    expect(esperaS(decidirAposFalha(f, 1, AGORA, () => 7))).toBeCloseTo(base(1) * (1 + ESPERA_JITTER), 3);
    expect(esperaS(decidirAposFalha(f, 1, AGORA, () => Number.NaN))).toBeCloseTo(base(1) * (1 - ESPERA_JITTER), 3);
  });
  it("Retry-After MAIOR que a espera calculada é respeitado; menor não encurta", () => {
    expect(esperaS(decidirAposFalha(new FalhaCopernicus("limite", 429, 600), 1, AGORA, MEIO))).toBe(600);
    expect(esperaS(decidirAposFalha(new FalhaCopernicus("limite", 429, 5), 1, AGORA, MEIO))).toBe(base(1));
    expect(esperaS(decidirAposFalha(new FalhaCopernicus("limite", 429, null), 2, AGORA, MEIO))).toBe(base(2));
  });
  it("erro desconhecido (não é do provedor) repete como 5xx, e o erro gravado é `erro_interno` — nunca a mensagem crua", () => {
    const cru = new Error("connect ECONNREFUSED postgresql://usuario:senha@host/db Authorization: Bearer abc");
    const d = decidirAposFalha(cru, 1, AGORA, MEIO);
    expect(d).toMatchObject({ tipo: "repetir", erro: ERRO_INTERNO });
    expect(esperaS(d)).toBe(base(1));
    expect(JSON.stringify(d)).not.toMatch(/senha|Bearer|ECONNREFUSED|postgresql/);
    expect(decidirAposFalha("texto solto", TENTATIVAS_POR_RODADA, AGORA, MEIO)).toEqual({ tipo: "falhar", erro: ERRO_INTERNO });
    expect(decidirAposFalha(undefined, 1, AGORA, MEIO)).toMatchObject({ tipo: "repetir", erro: ERRO_INTERNO });
  });
});

describe("SAT-03 retry — o que falha na primeira", () => {
  const FALHAM: [TipoFalhaCopernicus, number | null][] = [
    ["requisicao_recusada", 400], ["requisicao_recusada", 404], ["requisicao_recusada", 422], ["acesso_negado", 403], ["autenticacao", 401],
    ["resposta_malformada", 200], ["resposta_malformada", null], ["configuracao", null]
  ];
  for (const [tipo, status] of FALHAM) {
    it(`${tipo}${status ? ` ${status}` : ""}: falha já na primeira tentativa, erro estável`, () => {
      expect(decidirAposFalha(new FalhaCopernicus(tipo, status), 1, AGORA, MEIO)).toEqual({ tipo: "falhar", erro: `${tipo}${status ? ` (HTTP ${status})` : ""}` });
    });
  }
  it("tipo de falha que a tabela não conhece: FALHA (fail-closed), erro `erro_interno`", () => {
    const estranha = new FalhaCopernicus("tipo_novo" as TipoFalhaCopernicus, 418);
    expect(decidirAposFalha(estranha, 1, AGORA, MEIO)).toEqual({ tipo: "falhar", erro: ERRO_INTERNO });
  });
  it("contador de tentativas fora de inteiro ≥ 1 é tratado como esgotado (nunca abre laço)", () => {
    const f = new FalhaCopernicus("indisponivel", 500);
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(decidirAposFalha(f, n, AGORA, MEIO).tipo, String(n)).toBe("falhar");
  });
  it("o erro nunca carrega a mensagem da FalhaCopernicus além de tipo e status", () => {
    const d = decidirAposFalha(new FalhaCopernicus("acesso_negado", 403), 1, AGORA, MEIO);
    expect(d.erro).toBe("acesso_negado (HTTP 403)");
  });
});
