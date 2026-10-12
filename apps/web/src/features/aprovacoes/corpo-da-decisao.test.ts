import { describe, expect, it } from "vitest";
import { VERSAO_NA_DECISAO, corpoDaDecisaoPelaVersao, situacaoDeclaraVersao, versaoDaDecisaoNaConsulta } from "./corpo-da-decisao";

/**
 * EDITAR-02 (decisão 313, P5) — o corpo da decisão de aprovação: a COMPRA manda a `version` SOMENTE quando uma resposta
 * que só a API nova emite a declarou — na fila, a própria linha; na consulta, a SITUAÇÃO da aprovação. A API da base
 * recusa (`.strict()`) a chave que não conhece: sem a declaração, o corpo é exatamente o de antes. A venda continua
 * mandando sempre; o estoque, nunca.
 */
describe("corpo da decisão de aprovação — a versão", () => {
  it("a regra de cada área: venda sempre, compra quando declarada, estoque nunca", () => {
    expect(VERSAO_NA_DECISAO).toEqual({ vendas: "sempre", compras: "quandoDeclarada", estoque: "nunca" });
  });

  it("compra: com a versão declarada, aprovar e reprovar a levam (o zero inclusive — a versão em que todo documento nasce)", () => {
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, "3", "aprovar", "  conferido ")).toEqual({ version: "3", observacao: "conferido" });
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, "3", "aprovar", "   ")).toEqual({ version: "3" });
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, "0", "reprovar", " preço alto ")).toEqual({ version: "0", motivo: "preço alto" });
  });

  it("compra: sem a versão declarada (a API da base), o corpo é o de antes — sem a chave `version`", () => {
    const aprovar = corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, undefined, "aprovar", "ok");
    expect(aprovar).toEqual({ observacao: "ok" });
    expect(Object.keys(aprovar)).not.toContain("version");
    const reprovar = corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, undefined, "reprovar", "não");
    expect(reprovar).toEqual({ motivo: "não" });
    expect(Object.keys(reprovar)).not.toContain("version");
    expect(JSON.stringify(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, undefined, "aprovar", ""))).toBe("{}");
  });

  it("venda: a versão vai sempre (como antes); estoque: nunca, mesmo informada", () => {
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.vendas, "7", "aprovar", "")).toEqual({ version: "7" });
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.vendas, "7", "reprovar", "x")).toEqual({ version: "7", motivo: "x" });
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.estoque, "7", "aprovar", "ok")).toEqual({ observacao: "ok" });
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.estoque, "7", "reprovar", "x")).toEqual({ motivo: "x" });
  });
});

/**
 * A CONSULTA da compra (o skew web nova × API da base): o GET por id do documento da base TRAZ `version` (`d.*`, com o
 * banco já na 0063) — a presença dela no documento não pode ser a declaração. Quem declara é a SITUAÇÃO da aprovação
 * (`GET /api/aprovacoes/compras/:id`), que a base responde só com `{ situacao, ultimaDecisao }`.
 */
describe("consulta da compra — a versão vai só quando a SITUAÇÃO da aprovação a declara", () => {
  /** O corpo que o bloco da aprovação da consulta manda: a versão do documento mostrado, pela situação lida. */
  const corpoNaConsulta = (versaoDoDocumento: string | undefined, situacao: unknown, decisao: "aprovar" | "reprovar", texto: string) =>
    corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.compras, versaoDaDecisaoNaConsulta(VERSAO_NA_DECISAO.compras, versaoDoDocumento, situacao), decisao, texto);
  const SITUACAO_DA_BASE = { situacao: "pendente", ultimaDecisao: null };

  it("documento COM `version` + situação SEM a declaração (a API da base) → a decisão sai SEM `version`", () => {
    expect(corpoNaConsulta("4", SITUACAO_DA_BASE, "aprovar", "")).toEqual({});
    expect(corpoNaConsulta("4", SITUACAO_DA_BASE, "reprovar", "não")).toEqual({ motivo: "não" });
    expect(corpoNaConsulta("0", { situacao: "reprovado", ultimaDecisao: { decisao: "reprovado" } }, "aprovar", "ok")).toEqual({ observacao: "ok" });
    // Situação ainda não lida, ou fora da forma: também não declara.
    for (const situacao of [undefined, null, "pendente", [], { ...SITUACAO_DA_BASE, version: null }]) {
      expect(Object.keys(corpoNaConsulta("4", situacao, "aprovar", "")), JSON.stringify(situacao)).not.toContain("version");
    }
  });

  it("situação COM a declaração (a API nova) → a decisão sai com a `version` do DOCUMENTO mostrado (o conteúdo visto)", () => {
    expect(corpoNaConsulta("4", { ...SITUACAO_DA_BASE, version: "4" }, "aprovar", "")).toEqual({ version: "4" });
    expect(corpoNaConsulta("0", { ...SITUACAO_DA_BASE, version: "0" }, "reprovar", "não")).toEqual({ version: "0", motivo: "não" });
    // A situação foi lida DEPOIS de uma edição: vai a do documento mostrado — o servidor responde 409 e a tela recarrega.
    expect(corpoNaConsulta("4", { ...SITUACAO_DA_BASE, version: "5" }, "aprovar", "")).toEqual({ version: "4" });
  });

  it("a declaração é só o texto canônico do bigint", () => {
    for (const v of ["0", "1", "9223372036854775807"]) expect(situacaoDeclaraVersao({ ...SITUACAO_DA_BASE, version: v }), v).toBe(true);
    for (const v of [undefined, null, 4, "", "01", "-1", " 4", "4.0", true]) expect(situacaoDeclaraVersao({ ...SITUACAO_DA_BASE, version: v }), String(v)).toBe(false);
    expect(situacaoDeclaraVersao(SITUACAO_DA_BASE)).toBe(false);
  });

  it("venda e estoque: a situação não muda nada (a venda manda a do documento sempre; o estoque, nunca)", () => {
    expect(versaoDaDecisaoNaConsulta(VERSAO_NA_DECISAO.vendas, "7", SITUACAO_DA_BASE)).toBe("7");
    expect(versaoDaDecisaoNaConsulta(VERSAO_NA_DECISAO.vendas, "7", { ...SITUACAO_DA_BASE, version: "9" })).toBe("7");
    expect(corpoDaDecisaoPelaVersao(VERSAO_NA_DECISAO.estoque, versaoDaDecisaoNaConsulta(VERSAO_NA_DECISAO.estoque, "7", { ...SITUACAO_DA_BASE, version: "7" }), "aprovar", ""))
      .toEqual({});
  });
});
