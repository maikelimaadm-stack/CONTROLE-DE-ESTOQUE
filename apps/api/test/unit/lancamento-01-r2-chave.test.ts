import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

/**
 * LANCAMENTO-01, emenda R2 da decisão 311 — A CHAVE `COMPRAS_LOCAL_DO_PRODUTO_ENABLED`, lida no startup.
 *
 * O risco cercado é a chave LIGADA POR ENGANO: ligada, a linha nova da Central de Compras nasce com o local do cadastro
 * do produto, e a confirmação passa a dar entrada de estoque onde antes não dava (decisão 240 item 4: efeito novo nasce
 * desligado). Uma coerção booleana ligaria por `"true"`/`"false"` (string não vazia); por isso o valor é FECHADO, no
 * molde do `COPERNICUS_ENABLED`: `1` liga, `0` ou ausente desliga, QUALQUER outra coisa derruba o startup — e a recusa
 * não repete o valor.
 *
 *   LANC-K1  ausente ⇒ false (o padrão nunca é ligado);
 *   LANC-K2  "0" ⇒ false; "1" ⇒ true — e só estes;
 *   LANC-K3  "2", "true", "" (e os vizinhos que uma coerção leria como verdadeiros) ⇒ o schema REPROVA, nomeando a chave;
 *   LANC-K4  a recusa não repete o valor recebido.
 */
const AMBIENTE_MINIMO = { DATABASE_URL: "postgresql://exemplo-local/banco-de-exemplo" };
const CHAVE = "COMPRAS_LOCAL_DO_PRODUTO_ENABLED";
const startup = (valor?: string) => loadConfig({ ...AMBIENTE_MINIMO, ...(valor === undefined ? {} : { [CHAVE]: valor }) });

describe("LANC-K a chave do local do produto · leitura no startup", () => {
  it("LANC-K1 ausente = DESLIGADA — o padrão nunca é ligado", () => {
    const c = startup();
    expect(Object.hasOwn(AMBIENTE_MINIMO, CHAVE), "premissa: o ambiente do caso não tem a chave").toBe(false);
    expect(c.COMPRAS_LOCAL_DO_PRODUTO_ENABLED).toBe(false);
  });

  it("LANC-K2 `0` desliga e `1` liga — e só estes dois", () => {
    expect(startup("0").COMPRAS_LOCAL_DO_PRODUTO_ENABLED).toBe(false);
    expect(startup("1").COMPRAS_LOCAL_DO_PRODUTO_ENABLED).toBe(true);
  });

  it("LANC-K3 \"2\", \"true\", \"\" e qualquer outro valor DERRUBAM o startup, nomeando a chave", () => {
    const recusados = ["2", "true", "", "false", "TRUE", "yes", "on", " 1", "1 ", "01", "ligado"];
    let provados = 0;
    for (const valor of recusados) {
      expect(() => startup(valor), JSON.stringify(valor)).toThrow(new RegExp(`Configuração inválida: .*${CHAVE}: use 1 para ligar ou 0 \\(ou ausente\\) para desligar`));
      provados++;
    }
    expect(provados, "cada valor recusado foi medido").toBe(recusados.length);
  });

  it("LANC-K4 a recusa não repete o valor recebido", () => {
    for (const valor of ["valor-que-nao-deve-aparecer", "2", "true"]) {
      let mensagem = "";
      try { startup(valor); } catch (e) { mensagem = e instanceof Error ? e.message : String(e); }
      expect(mensagem, `premissa (${valor}): houve recusa`).toContain(CHAVE);
      // "2" e "true" são curtos demais para buscar soltos na mensagem: confere-se o que vem DEPOIS do nome da chave.
      const depois = mensagem.slice(mensagem.indexOf(CHAVE) + CHAVE.length);
      expect(depois, valor).toBe(": use 1 para ligar ou 0 (ou ausente) para desligar");
      expect(mensagem, valor).not.toContain("valor-que-nao-deve-aparecer");
    }
  });
});
