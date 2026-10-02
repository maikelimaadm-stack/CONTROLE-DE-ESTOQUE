import { describe, it, expect } from "vitest";
import {
  configuracaoNeutraTopV2, configuracaoNeutraTopV3, configuracaoNeutraTopV4, regrasGeraisDaVersaoTop,
  type ConfiguracaoTipoOperacao,
} from "@agro/domain";
import {
  regrasGeraisDaCentral, regrasGeraisDaVariante, regrasGeraisNeutrasDaCentral, type RegrasGeraisDaCentral,
} from "../../src/routes/regras-gerais-da-central.js";

/**
 * OPERACOES-01 F2 (decisão 279) — `regrasGerais` DE `/regras-da-operacao`, PROVADO SEM BANCO (RGU-1..RGU-5).
 *
 * O que está sob teste é a CONTA: a Central diz "Salvar e confirmar" e deixa salvar sem itens exatamente quando a
 * gravação vai confirmar e aceitar itens vazios. O oráculo NÃO é um literal escrito aqui: é `regrasGeraisDaVersaoTop`,
 * a função que a gravação usa (`confirmaAutomaticamente`, `aceitaSemItens`, `topQueAceitaSemItens`). Cada caso afirma
 * o valor esperado E a premissa — o que a função da gravação diz da MESMA versão —, para que um verde não possa vir
 * de uma conta paralela que por acaso concorde hoje. O caminho até o banco (a consulta, a variante da porta, a
 * coerência com o 201/422 do POST) é provado em `test/integration/operacoes-01-f2-regras-gerais.test.ts`.
 */
const NEUTRO: RegrasGeraisDaCentral = { confirmacaoAutomatica: false, aceitaSemItens: false };
const FAMILIA = "vendas.venda";

/** As duas regras que a Central lê, ligadas, sobre o neutro do formato pedido (o mesmo conteúdo nos três). */
function automaticaEPermitido<T extends ConfiguracaoTipoOperacao>(neutra: T): T {
  neutra.geral.confirmacao = "automatica";
  neutra.geral.documentoSemItens = "permitido";
  return neutra;
}
/** O que a gravação decide da versão: a projeção das duas booleanas, ou `null` quando ela não sabe ler (`ok: false`). */
function daGravacao(versao: { codigoBase: string; configuracao: unknown } | null): RegrasGeraisDaCentral | null {
  const r = regrasGeraisDaVersaoTop(versao);
  return r.ok ? { confirmacaoAutomatica: r.regras.confirmacaoAutomatica, aceitaSemItens: r.regras.aceitaSemItens } : null;
}

describe("RGU — regrasGeraisDaCentral: a régua da gravação, nunca uma segunda", () => {
  it("RGU-1 sem versão (documento ou TOP sem versão legível) → o neutro; a gravação também lê o neutro", () => {
    expect(daGravacao(null), "premissa: a gravação lê o neutro sem versão").toEqual(NEUTRO);
    expect(regrasGeraisDaCentral(null)).toEqual(NEUTRO);
    expect(regrasGeraisNeutrasDaCentral()).toEqual(NEUTRO);
    // Cada chamada devolve um objeto NOVO: quem muda a resposta de uma porta não muda a de outra.
    expect(regrasGeraisNeutrasDaCentral()).not.toBe(regrasGeraisNeutrasDaCentral());
    expect(regrasGeraisDaCentral(null)).not.toBe(regrasGeraisDaCentral(null));
  });

  it("RGU-2 formato 4 com Automática e Permitido → { true, true }, o que a gravação executa; cada regra sozinha liga só a sua", () => {
    const versao = { codigoBase: FAMILIA, configuracao: automaticaEPermitido(configuracaoNeutraTopV4()) };
    expect(daGravacao(versao), "premissa: a gravação confirma e aceita sem itens").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });
    expect(regrasGeraisDaCentral(versao)).toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });

    const soAutomatica = configuracaoNeutraTopV4();
    soAutomatica.geral.confirmacao = "automatica";
    const soPermitido = configuracaoNeutraTopV4();
    soPermitido.geral.documentoSemItens = "permitido";
    for (const [nome, configuracao, esperado] of [
      ["só Automática", soAutomatica, { confirmacaoAutomatica: true, aceitaSemItens: false }],
      ["só Permitido", soPermitido, { confirmacaoAutomatica: false, aceitaSemItens: true }],
      ["neutro do formato 4", configuracaoNeutraTopV4(), NEUTRO],
    ] as const) {
      const v = { codigoBase: FAMILIA, configuracao };
      expect(daGravacao(v), `premissa (${nome}): a gravação`).toEqual(esperado);
      expect(regrasGeraisDaCentral(v), nome).toEqual(esperado);
    }
  });

  it("RGU-3 o MESMO conteúdo gravado no formato 3 (e no 2) → o neutro: o corte da decisão 277; a premissa é o mesmo conteúdo valer no 4", () => {
    const no4 = { codigoBase: FAMILIA, configuracao: automaticaEPermitido(configuracaoNeutraTopV4()) };
    expect(regrasGeraisDaCentral(no4), "premissa: no formato 4 este conteúdo liga as duas").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });
    for (const [formato, configuracao] of [[3, automaticaEPermitido(configuracaoNeutraTopV3())], [2, automaticaEPermitido(configuracaoNeutraTopV2())]] as const) {
      expect(configuracao.versaoSchema, "premissa: o formato gravado").toBe(formato);
      expect([configuracao.geral.confirmacao, configuracao.geral.documentoSemItens], `premissa: o formato ${formato} DECLARA as duas`).toEqual(["automatica", "permitido"]);
      const v = { codigoBase: FAMILIA, configuracao };
      expect(daGravacao(v), `premissa: a gravação lê o formato ${formato} como neutro`).toEqual(NEUTRO);
      expect(regrasGeraisDaCentral(v), `formato ${formato}`).toEqual(NEUTRO);
    }
  });

  it("RGU-4 formato 4 malformado, formato desconhecido e configuração que não é objeto → o neutro (a gravação não sabe ler: ok false)", () => {
    const enumInvalido = { ...automaticaEPermitido(configuracaoNeutraTopV4()), geral: { ...automaticaEPermitido(configuracaoNeutraTopV4()).geral, confirmacao: "talvez" } };
    const chaveDesconhecida = { ...automaticaEPermitido(configuracaoNeutraTopV4()), secaoQueNaoExiste: {} };
    const desconhecido = { ...automaticaEPermitido(configuracaoNeutraTopV4()), versaoSchema: 99 };
    let casos = 0;
    for (const [nome, configuracao] of [
      ["formato 4 com enumerado inválido", enumInvalido],
      ["formato 4 com seção desconhecida", chaveDesconhecida],
      ["formato desconhecido (99) com Automática e Permitido", desconhecido],
      ["configuração nula", null],
      ["configuração texto", "automatica"],
    ] as const) {
      const v = { codigoBase: FAMILIA, configuracao };
      const r = regrasGeraisDaVersaoTop(v);
      expect(r, `premissa (${nome}): a gravação não sabe ler esta versão`).toEqual({ ok: false, motivo: "configuracao_ilegivel" });
      expect(regrasGeraisDaCentral(v), nome).toEqual(NEUTRO);
      casos++;
    }
    expect(casos).toBe(5);
  });
});

describe("RGU-5 — regrasGeraisDaVariante: a variante que não executa responde o neutro", () => {
  it("RGU-5 executa false → o neutro, qualquer que seja a versão; executa true → igual às lidas, em objeto novo", () => {
    const lidas = regrasGeraisDaCentral({ codigoBase: FAMILIA, configuracao: automaticaEPermitido(configuracaoNeutraTopV4()) });
    expect(lidas, "premissa: as lidas ligam as duas").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });

    expect(regrasGeraisDaVariante(lidas, false), "orçamento, pedido de venda, pedido de compra").toEqual(NEUTRO);

    const daVenda = regrasGeraisDaVariante(lidas, true);
    expect(daVenda).toEqual(lidas);
    expect(daVenda, "cópia: nenhuma referência compartilhada").not.toBe(lidas);
    daVenda.confirmacaoAutomatica = false;
    expect(lidas.confirmacaoAutomatica, "mudar a resposta não muda as lidas").toBe(true);

    const neutras = regrasGeraisNeutrasDaCentral();
    const naoExecuta = regrasGeraisDaVariante(neutras, false);
    expect(naoExecuta).toEqual(NEUTRO);
    expect(naoExecuta, "o neutro da variante também é objeto novo").not.toBe(neutras);
  });
});
