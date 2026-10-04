import { describe, it, expect } from "vitest";
import { chaveIdempotencia } from "../../src/lib/satelite/chave-consulta.js";

/**
 * SAT-02 (decisão 295) — o hash da chave de idempotência do item. O índice único parcial da 0053 compara ESTA
 * string: se o hash mudasse de formato ou de codificação, o mesmo pedido deixaria de ser reconhecido e o crédito
 * seria gasto duas vezes. Por isso os vetores abaixo são fixos, calculados fora do código testado.
 */
describe("chaveIdempotencia — sha256 hex da origem", () => {
  it("vetores conhecidos: o 'abc' do FIPS 180-2 e a string vazia", () => {
    expect(chaveIdempotencia("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(chaveIdempotencia("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("origem no formato do domínio e texto acentuado: o hash é dos bytes UTF-8", () => {
    expect(chaveIdempotencia("org|area|geom|ndvi|recente@2026-09-05..2026-10-04|ndvi-v2"))
      .toBe("eaf972ae4fe398640fec28a935a295bc0e45843a3aaf43ad1f8333f950bb2c24");
    expect(chaveIdempotencia("consulta satelital — ção")).toBe("8c9b31cca68c49765d45786f67b4b260998a93f4f49d1f8a67d6b2fddad62748");
  });

  it("64 caracteres hex minúsculos — o formato que o CHECK da 0053 aceita", () => {
    for (const origem of ["abc", "", "x".repeat(10_000), "org|area|geom|ndvi|2026-01-10@2026-01-05..2026-01-15|ndvi-v2"]) {
      expect(chaveIdempotencia(origem)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("estável: a mesma origem dá sempre a mesma chave", () => {
    const origem = "org|area|geom|ndvi|recente@2026-09-05..2026-10-04|ndvi-v2";
    const chaves = new Set(Array.from({ length: 5 }, () => chaveIdempotencia(origem)));
    expect(chaves.size).toBe(1);
  });

  it("um caractere a mais, a menos ou trocado muda a chave", () => {
    const base = "org|area|geom|ndvi|recente@2026-09-05..2026-10-04|ndvi-v2";
    const chave = chaveIdempotencia(base);
    expect(chaveIdempotencia(base.replace("2026-10-04", "2026-10-05"))).not.toBe(chave);
    expect(chaveIdempotencia(`${base} `)).not.toBe(chave);
    expect(chaveIdempotencia(base.slice(1))).not.toBe(chave);
    expect(chaveIdempotencia(base.toUpperCase())).not.toBe(chave);
  });
});
