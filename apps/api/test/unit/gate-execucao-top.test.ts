import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

/**
 * O GATE DA EXECUÇÃO CONFIGURADA DA TOP (TOP-CONFIG-04A) — o que o PROCESSO aceita como configuração.
 *
 * O risco que esta suíte cerca não é o gate desligado: é o gate LIGADO POR ENGANO. Uma coerção booleana
 * trataria `"false"` como verdadeiro (string não vazia), e um erro de digitação no painel da plataforma
 * poria execução configurada em circulação antes da hora. Por isso o valor é fechado: `1` liga, `0` ou
 * ausente desliga, e QUALQUER outra coisa derruba o startup — alto, na hora, e sem ecoar o valor.
 */
const AMBIENTE_MINIMO = { DATABASE_URL: "postgresql://exemplo-local/banco-de-exemplo" };
const startup = (valor?: string) =>
  loadConfig({ ...AMBIENTE_MINIMO, ...(valor === undefined ? {} : { TOP_EFFECTS_RUNTIME_V1_ENABLED: valor }) });

describe("gate da execução configurada · leitura no startup", () => {
  it("ausente = DESLIGADO — o padrão nunca é ligado", () => {
    expect(startup().TOP_EFFECTS_RUNTIME_V1_ENABLED).toBe(false);
  });

  it("`0` desliga e `1` liga — e só estes dois", () => {
    expect(startup("0").TOP_EFFECTS_RUNTIME_V1_ENABLED).toBe(false);
    expect(startup("1").TOP_EFFECTS_RUNTIME_V1_ENABLED).toBe(true);
  });

  it("qualquer outro valor DERRUBA o startup, inclusive os que uma coerção leria como verdadeiros", () => {
    for (const valor of ["true", "false", "yes", "on", "TRUE", " 1", "1 ", "2", "", "ligado"]) {
      expect(() => startup(valor), JSON.stringify(valor)).toThrow(/TOP_EFFECTS_RUNTIME_V1_ENABLED/);
    }
  });

  it("a recusa não repete o valor recebido", () => {
    let mensagem = "";
    try { startup("valor-que-nao-deve-aparecer"); } catch (e) { mensagem = e instanceof Error ? e.message : String(e); }
    expect(mensagem).toContain("TOP_EFFECTS_RUNTIME_V1_ENABLED");
    expect(mensagem).not.toContain("valor-que-nao-deve-aparecer");
  });
});
