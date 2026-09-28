import { describe, it, expect } from "vitest";
import {
  NATUREZA_OPERACAO_MAXIMO,
  TOLERANCIA_ATRASO_MAXIMA_DIAS,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V3,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoTopEhNeutra,
  configuracaoTopParaEdicao,
  configuracaoTopParaEdicaoV3,
  configuracoesTopIguais,
  execucaoDeclaradaTop,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  restricoesExecutamTop,
  secoesAlteradasTop,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV2,
  type ConfiguracaoTipoOperacaoV3,
  type RecusaConfiguracaoTop,
} from "../src/tipo-operacao-configuracao.js";

/**
 * O FORMATO 3 DA CONFIGURAÇÃO DA TOP (TOP-CONFIG-05) — leitor estrito, normalização e convivência com o legado.
 *
 * TR-D1 prova que o leitor do formato 3 RECUSA tudo que o contrato não descreve (chave nova ausente, chave
 * desconhecida, enum fora da lista, número fora do intervalo, CFOP fora da forma) e que a normalização decide
 * as dependências no domínio. TR-D2 prova que os formatos 1 e 2 continuam lidos EXATAMENTE como antes e que a
 * troca de formato só é "igual" quando não passa a executar exigência nenhuma (decisão 263).
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Saco = Record<string, unknown>;

/**
 * Cópia da configuração como saco de chaves, para SUJÁ-LA de propósito: a pergunta destes testes é o que
 * acontece com o payload que chega de fora do TypeScript, e passar por `unknown` torna isso explícito.
 */
const sujar = (c: ConfiguracaoTipoOperacao): Saco => clonar(c) as unknown as Saco;

/** A seção como saco; falha alto se ela não existir (o teste está errado, não o produto). */
function secaoDe(raiz: Saco, nome: string): Saco {
  const s = raiz[nome];
  if (typeof s !== "object" || s === null || Array.isArray(s)) throw new Error(`seção ausente no candidato: ${nome}`);
  return s as Saco;
}

/** Congela em profundidade: qualquer tentativa de mutar a entrada lança (módulo ESM = modo estrito). */
function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) congelar((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

const recusasDe = (bruto: unknown): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};

const valorDe = (bruto: unknown): ConfiguracaoTipoOperacao => {
  const r = lerConfiguracaoTop(bruto);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor;
};

/** Um formato 3 válido e NÃO neutro em todas as chaves novas. */
function v3Rico(): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  c.geral.exigeParceiro = true;
  c.geral.exigeTransportadora = true;
  c.estoque.atualizacao = "saida";
  c.financeiro.atualizacao = "receber";
  c.financeiro.clienteEmAtraso = "bloqueia";
  c.financeiro.toleranciaAtrasoDias = 5;
  c.fiscal.habilitado = true;
  c.fiscal.modeloDocumento = "nfe";
  c.fiscal.finalidade = "devolucao";
  c.fiscal.naturezaOperacao = "Venda de mercadoria";
  c.fiscal.cfopDentroEstado = "5102";
  c.fiscal.cfopForaEstado = "6102";
  c.fiscal.cfopExterior = "7102";
  c.execucao = { estoque: "configurada", financeiro: "legado" };
  return c;
}

/** Todas as chaves que o formato 3 acrescenta, por seção — a lista que o teste de "falta cada uma" percorre. */
const CHAVES_NOVAS_V3: ReadonlyArray<readonly [string, string]> = [
  ["geral", "exigeTransportadora"],
  ["financeiro", "clienteEmAtraso"],
  ["financeiro", "toleranciaAtrasoDias"],
  ["fiscal", "modeloDocumento"],
  ["fiscal", "finalidade"],
  ["fiscal", "naturezaOperacao"],
  ["fiscal", "cfopDentroEstado"],
  ["fiscal", "cfopForaEstado"],
  ["fiscal", "cfopExterior"],
];

const CAMPOS_CFOP = ["cfopDentroEstado", "cfopForaEstado", "cfopExterior"] as const;

// ---------------------------------------------------------------------------------------------------
// TR-D1 — o leitor do formato 3
// ---------------------------------------------------------------------------------------------------

describe("TR-D1 formato 3 — leitura de ida e volta", () => {
  it("TR-D1 o neutro v3 é lido pelo próprio leitor e volta IGUAL", () => {
    const n = configuracaoNeutraTopV3();
    const lido = valorDe(n);
    expect(lido).toEqual(n);
    expect(lido.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V3);
  });

  it("TR-D1 o neutro v3 tem as chaves novas no neutro do contrato", () => {
    const n = configuracaoNeutraTopV3();
    expect(n.geral.exigeTransportadora).toBe(false);
    expect(n.financeiro.clienteEmAtraso).toBe("nao_valida");
    expect(n.financeiro.toleranciaAtrasoDias).toBe(0);
    expect(n.fiscal).toMatchObject({
      modeloDocumento: "nenhum", finalidade: "normal", naturezaOperacao: "",
      cfopDentroEstado: "", cfopForaEstado: "", cfopExterior: "",
    });
    expect(n.execucao).toEqual({ estoque: "legado", financeiro: "legado" });
  });

  it("TR-D1 um v3 rico (todas as chaves novas fora do neutro) é lido e volta IGUAL", () => {
    const c = v3Rico();
    expect(valorDe(c)).toEqual(c);
  });

  it("TR-D1 o resultado é construído campo a campo: não devolve referência à entrada nem a muta", () => {
    const entrada = congelar(v3Rico());
    const lido = valorDe(entrada);
    expect(lido).not.toBe(entrada);
    if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
    expect(lido.geral).not.toBe(entrada.geral);
    expect(lido.financeiro).not.toBe(entrada.financeiro);
    expect(lido.fiscal).not.toBe(entrada.fiscal);
  });
});

describe("TR-D1 formato 3 — ESTRITO: chave nova ausente é recusa no caminho", () => {
  for (const [secao, campo] of CHAVES_NOVAS_V3) {
    it(`TR-D1 falta ${secao}.${campo} → tipo_invalido em "${secao}.${campo}"`, () => {
      const c = sujar(configuracaoNeutraTopV3());
      delete secaoDe(c, secao)[campo];
      expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: `${secao}.${campo}` }]);
    });
  }

  it("TR-D1 v3 sem `execucao` → recusa (não é tratado como legado)", () => {
    const c = sujar(configuracaoNeutraTopV3());
    delete c.execucao;
    expect(recusasDe(c)).toContainEqual({ motivo: "tipo_invalido", caminho: "execucao" });
  });

  it("TR-D1 v3 sem `aprovacao.valorMinimo` → recusa (a regra do formato 2 continua no formato 3)", () => {
    const c = sujar(configuracaoNeutraTopV3());
    delete secaoDe(c, "aprovacao").valorMinimo;
    expect(recusasDe(c)).toContainEqual({ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" });
  });
});

describe("TR-D1 formato 3 — chave desconhecida é campo_desconhecido", () => {
  it.each([
    ["geral", "exigeTransportadoraX"],
    ["financeiro", "limiteCredito"],
    ["fiscal", "cfop"],
    ["execucao", "fiscal"],
    ["estoque", "exigeTransportadora"],
  ])("TR-D1 %s.%s desconhecida → campo_desconhecido", (secao, campo) => {
    const c = sujar(configuracaoNeutraTopV3());
    secaoDe(c, secao)[campo] = false;
    expect(recusasDe(c)).toContainEqual({ motivo: "campo_desconhecido", caminho: `${secao}.${campo}` });
  });

  it("TR-D1 chave de raiz desconhecida (`restricoes`) → campo_desconhecido na raiz", () => {
    const c = sujar(configuracaoNeutraTopV3());
    c.restricoes = {};
    expect(recusasDe(c)).toContainEqual({ motivo: "campo_desconhecido", caminho: "restricoes" });
  });
});

describe("TR-D1 formato 3 — enum inválido é valor_invalido no caminho", () => {
  it.each([
    ["financeiro", "clienteEmAtraso", "x"],
    ["fiscal", "modeloDocumento", "nfx"],
    ["fiscal", "finalidade", "y"],
  ])("TR-D1 %s.%s = %j → valor_invalido", (secao, campo, valor) => {
    const c = sujar(configuracaoNeutraTopV3());
    secaoDe(c, secao)[campo] = valor;
    expect(recusasDe(c)).toEqual([{ motivo: "valor_invalido", caminho: `${secao}.${campo}` }]);
  });

  it("TR-D1 enum com tipo errado (número) → tipo_invalido, não cai no padrão", () => {
    const c = sujar(configuracaoNeutraTopV3());
    secaoDe(c, "financeiro").clienteEmAtraso = 1;
    expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: "financeiro.clienteEmAtraso" }]);
  });
});

describe("TR-D1 formato 3 — toleranciaAtrasoDias: inteiro de 0 a 365", () => {
  it.each([
    [366, "valor_invalido"],
    [-1, "valor_invalido"],
    [1.5, "tipo_invalido"],
    ["3", "tipo_invalido"],
    [null, "tipo_invalido"],
  ])("TR-D1 toleranciaAtrasoDias = %j → recusa (%s)", (valor, motivo) => {
    const c = sujar(configuracaoNeutraTopV3());
    const f = secaoDe(c, "financeiro");
    f.clienteEmAtraso = "avisa";
    f.toleranciaAtrasoDias = valor;
    expect(recusasDe(c)).toEqual([{ motivo, caminho: "financeiro.toleranciaAtrasoDias" }]);
  });

  it.each([0, 1, TOLERANCIA_ATRASO_MAXIMA_DIAS])("TR-D1 toleranciaAtrasoDias = %j (borda válida) é aceita e preservada", (dias) => {
    const c = configuracaoNeutraTopV3();
    c.financeiro.clienteEmAtraso = "avisa";
    c.financeiro.toleranciaAtrasoDias = dias;
    const lido = valorDe(c);
    if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
    expect(lido.financeiro.toleranciaAtrasoDias).toBe(dias);
    expect(TOLERANCIA_ATRASO_MAXIMA_DIAS).toBe(365);
  });
});

describe("TR-D1 formato 3 — naturezaOperacao: texto de até 60", () => {
  it("TR-D1 61 caracteres → valor_invalido em fiscal.naturezaOperacao", () => {
    const c = sujar(configuracaoNeutraTopV3());
    const fi = secaoDe(c, "fiscal");
    fi.habilitado = true;
    fi.naturezaOperacao = "a".repeat(NATUREZA_OPERACAO_MAXIMO + 1);
    expect(NATUREZA_OPERACAO_MAXIMO).toBe(60);
    expect(recusasDe(c)).toEqual([{ motivo: "valor_invalido", caminho: "fiscal.naturezaOperacao" }]);
  });

  it("TR-D1 60 caracteres é aceito e preservado com o fiscal ligado", () => {
    const c = configuracaoNeutraTopV3();
    c.fiscal.habilitado = true;
    c.fiscal.naturezaOperacao = "a".repeat(NATUREZA_OPERACAO_MAXIMO);
    const lido = valorDe(c);
    if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
    expect(lido.fiscal.naturezaOperacao).toBe("a".repeat(60));
  });

  it("TR-D1 naturezaOperacao não-texto → tipo_invalido", () => {
    const c = sujar(configuracaoNeutraTopV3());
    secaoDe(c, "fiscal").naturezaOperacao = 12;
    expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: "fiscal.naturezaOperacao" }]);
  });
});

describe("TR-D1 formato 3 — CFOP: só a FORMA (4 dígitos, primeiro de 1 a 7)", () => {
  for (const campo of CAMPOS_CFOP) {
    it.each(["0102", "8102", "510", "51023", "5a02"])(`TR-D1 fiscal.${campo} = %j → valor_invalido`, (valor) => {
      const c = sujar(configuracaoNeutraTopV3());
      const fi = secaoDe(c, "fiscal");
      fi.habilitado = true;
      fi[campo] = valor;
      expect(recusasDe(c)).toEqual([{ motivo: "valor_invalido", caminho: `fiscal.${campo}` }]);
    });

    it(`TR-D1 fiscal.${campo} = "" é aceito (não informado)`, () => {
      const c = configuracaoNeutraTopV3();
      c.fiscal.habilitado = true;
      c.fiscal[campo] = "";
      const lido = valorDe(c);
      if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
      expect(lido.fiscal[campo]).toBe("");
    });

    it(`TR-D1 fiscal.${campo} com forma válida ("1102" e "7949") é aceito e preservado`, () => {
      for (const valor of ["1102", "7949"]) {
        const c = configuracaoNeutraTopV3();
        c.fiscal.habilitado = true;
        c.fiscal[campo] = valor;
        const lido = valorDe(c);
        if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
        expect(lido.fiscal[campo]).toBe(valor);
      }
    });
  }

  it("TR-D1 CFOP fora da forma é recusado MESMO com o fiscal desligado (estrito antes de normalizar)", () => {
    const c = sujar(configuracaoNeutraTopV3());
    secaoDe(c, "fiscal").cfopDentroEstado = "0102";
    expect(recusasDe(c)).toEqual([{ motivo: "valor_invalido", caminho: "fiscal.cfopDentroEstado" }]);
  });
});

describe("TR-D1 formato 3 — normalização", () => {
  it("TR-D1 fiscal.habilitado = false zera modelo, finalidade, natureza e os três CFOPs (na leitura e na normalização)", () => {
    const c = v3Rico();
    c.fiscal.habilitado = false;
    const esperado = {
      modeloDocumento: "nenhum", finalidade: "normal", naturezaOperacao: "",
      cfopDentroEstado: "", cfopForaEstado: "", cfopExterior: "",
    };
    expect(normalizarConfiguracaoTop(c).fiscal).toMatchObject({ habilitado: false, ...esperado });
    const lido = valorDe(c);
    if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
    expect(lido.fiscal).toMatchObject({ habilitado: false, ...esperado });
  });

  it("TR-D1 fiscal.habilitado = true PRESERVA as chaves fiscais novas", () => {
    const c = v3Rico();
    expect(normalizarConfiguracaoTop(c).fiscal).toEqual(c.fiscal);
  });

  it("TR-D1 clienteEmAtraso = \"bloqueia\" com financeiro.atualizacao = \"nenhuma\" É PRESERVADO (independe do efeito financeiro)", () => {
    const c = configuracaoNeutraTopV3();
    c.financeiro.atualizacao = "nenhuma";
    c.financeiro.clienteEmAtraso = "bloqueia";
    c.financeiro.toleranciaAtrasoDias = 10;
    const n = normalizarConfiguracaoTop(c);
    expect(n.financeiro.clienteEmAtraso).toBe("bloqueia");
    expect(n.financeiro.toleranciaAtrasoDias).toBe(10);
    const lido = valorDe(c);
    if (!restricoesExecutamTop(lido)) throw new Error("esperava formato 3");
    expect(lido.financeiro.clienteEmAtraso).toBe("bloqueia");
    expect(lido.financeiro.toleranciaAtrasoDias).toBe(10);
  });

  it("TR-D1 financeiro desligado continua zerando as chaves ANTIGAS do financeiro (a régua do formato 2)", () => {
    const c = configuracaoNeutraTopV3();
    c.financeiro.atualizacao = "nenhuma";
    c.financeiro.exigeVencimento = true;
    c.financeiro.clienteEmAtraso = "avisa";
    const n = normalizarConfiguracaoTop(c);
    expect(n.financeiro.exigeVencimento).toBe(false);
    expect(n.financeiro.clienteEmAtraso).toBe("avisa");
  });

  it("TR-D1 tolerância zera quando a política é \"nao_valida\"; é preservada com \"avisa\"", () => {
    const c = configuracaoNeutraTopV3();
    c.financeiro.clienteEmAtraso = "nao_valida";
    c.financeiro.toleranciaAtrasoDias = 30;
    expect(normalizarConfiguracaoTop(c).financeiro.toleranciaAtrasoDias).toBe(0);
    c.financeiro.clienteEmAtraso = "avisa";
    expect(normalizarConfiguracaoTop(c).financeiro.toleranciaAtrasoDias).toBe(30);
  });

  it("TR-D1 exigeTransportadora é preservada (independe do estoque e do financeiro)", () => {
    const c = configuracaoNeutraTopV3();
    c.geral.exigeTransportadora = true;
    expect(normalizarConfiguracaoTop(c).geral.exigeTransportadora).toBe(true);
  });

  it("TR-D1 normalizar preserva o formato 3 e a execução", () => {
    const c = v3Rico();
    const n = normalizarConfiguracaoTop(c);
    expect(n.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V3);
    expect(n.execucao).toEqual({ estoque: "configurada", financeiro: "legado" });
  });

  it("TR-D1 normalizar é IDEMPOTENTE", () => {
    const casos: ConfiguracaoTipoOperacaoV3[] = [configuracaoNeutraTopV3(), v3Rico()];
    const semFiscal = v3Rico();
    semFiscal.fiscal.habilitado = false;
    casos.push(semFiscal);
    const naoValida = v3Rico();
    naoValida.financeiro.clienteEmAtraso = "nao_valida";
    casos.push(naoValida);
    for (const c of casos) {
      const uma = normalizarConfiguracaoTop(c);
      expect(normalizarConfiguracaoTop(uma)).toEqual(uma);
    }
  });

  it("TR-D1 normalizar NÃO muta a entrada", () => {
    const c = v3Rico();
    c.fiscal.habilitado = false;
    c.financeiro.clienteEmAtraso = "nao_valida";
    const copia = clonar(c);
    congelar(c);
    expect(() => normalizarConfiguracaoTop(c)).not.toThrow();
    expect(c).toEqual(copia);
  });

  it("TR-D1 o leitor NÃO muta a entrada (entrada congelada, inclusive na recusa)", () => {
    const valido = congelar(v3Rico());
    expect(() => lerConfiguracaoTop(valido)).not.toThrow();
    const invalido = sujar(v3Rico());
    secaoDe(invalido, "fiscal").cfopExterior = "8102";
    const copia = clonar(invalido);
    congelar(invalido);
    expect(() => lerConfiguracaoTop(invalido)).not.toThrow();
    expect(invalido).toEqual(copia);
  });
});

// ---------------------------------------------------------------------------------------------------
// TR-D2 — o legado (formatos 1 e 2) e a convivência com o formato 3
// ---------------------------------------------------------------------------------------------------

/** Um formato 2 válido com efeitos e execução configurada — para provar que a leitura dele não mudou. */
function v2Rico(): ConfiguracaoTipoOperacaoV2 {
  const c = configuracaoNeutraTopV2();
  c.geral.exigeParceiro = true;
  c.estoque.atualizacao = "saida";
  c.estoque.exigeArmazem = true;
  c.financeiro.atualizacao = "receber";
  c.financeiro.exigeVencimento = true;
  c.fiscal.habilitado = true;
  c.fiscal.exigeDocumentoFiscal = true;
  c.aprovacao.politica = "por_valor";
  c.aprovacao.valorMinimo = "1000.00";
  c.execucao = { estoque: "configurada", financeiro: "configurada" };
  return c;
}

describe("TR-D2 legado — formatos 1 e 2 lidos exatamente como antes", () => {
  it("TR-D2 neutro v1 é lido e volta igual, no formato 1", () => {
    const n = configuracaoNeutraTop();
    const lido = valorDe(n);
    expect(lido).toEqual(n);
    expect(lido.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP);
  });

  it("TR-D2 neutro v2 e v2 rico são lidos e voltam iguais, no formato 2", () => {
    for (const c of [configuracaoNeutraTopV2(), v2Rico()]) {
      const lido = valorDe(c);
      expect(lido).toEqual(c);
      expect(lido.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
    }
  });

  it("TR-D2 v1 sem `aprovacao.valorMinimo` continua legível (legado para sempre)", () => {
    const c = sujar(configuracaoNeutraTop());
    delete secaoDe(c, "aprovacao").valorMinimo;
    expect(valorDe(c)).toEqual(configuracaoNeutraTop());
  });

  it("TR-D2 v1 com `execucao` continua recusado (campo_desconhecido na raiz)", () => {
    const c = sujar(configuracaoNeutraTop());
    c.execucao = { estoque: "legado", financeiro: "legado" };
    expect(recusasDe(c)).toEqual([{ motivo: "campo_desconhecido", caminho: "execucao" }]);
  });

  it("TR-D2 v2 sem `execucao` continua recusado (tipo_invalido em execucao)", () => {
    const c = sujar(configuracaoNeutraTopV2());
    delete c.execucao;
    expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: "execucao" }]);
  });

  for (const versao of [VERSAO_SCHEMA_CONFIGURACAO_TOP, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2] as const) {
    const neutroDa = (): ConfiguracaoTipoOperacao =>
      versao === VERSAO_SCHEMA_CONFIGURACAO_TOP ? configuracaoNeutraTop() : configuracaoNeutraTopV2();
    const valorNeutroDaChave: Record<string, unknown> = {
      exigeTransportadora: false, clienteEmAtraso: "nao_valida", toleranciaAtrasoDias: 0,
      modeloDocumento: "nenhum", finalidade: "normal", naturezaOperacao: "",
      cfopDentroEstado: "", cfopForaEstado: "", cfopExterior: "",
    };
    for (const [secao, campo] of CHAVES_NOVAS_V3) {
      it(`TR-D2 v${versao} com ${secao}.${campo} (mesmo no valor neutro) → campo_desconhecido`, () => {
        const c = sujar(neutroDa());
        secaoDe(c, secao)[campo] = valorNeutroDaChave[campo];
        expect(recusasDe(c)).toEqual([{ motivo: "campo_desconhecido", caminho: `${secao}.${campo}` }]);
      });
    }
  }

  it("TR-D2 v2 com geral.exigeTransportadora = true → campo_desconhecido em geral.exigeTransportadora", () => {
    const c = sujar(configuracaoNeutraTopV2());
    secaoDe(c, "geral").exigeTransportadora = true;
    expect(recusasDe(c)).toEqual([{ motivo: "campo_desconhecido", caminho: "geral.exigeTransportadora" }]);
  });

  it("TR-D2 formato 4 continua recusado como schema_nao_suportado", () => {
    const c = sujar(configuracaoNeutraTopV3());
    c.versaoSchema = 4;
    expect(recusasDe(c)).toEqual([{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }]);
  });
});

describe("TR-D2 restricoesExecutamTop e execucaoDeclaradaTop", () => {
  it("TR-D2 restricoesExecutamTop só é true para o formato 3", () => {
    expect(restricoesExecutamTop(configuracaoNeutraTop())).toBe(false);
    expect(restricoesExecutamTop(configuracaoNeutraTopV2())).toBe(false);
    expect(restricoesExecutamTop(v2Rico())).toBe(false);
    expect(restricoesExecutamTop(configuracaoNeutraTopV3())).toBe(true);
    expect(restricoesExecutamTop(v3Rico())).toBe(true);
  });

  it("TR-D2 execucaoDeclaradaTop(v3) devolve a execução do v3 (cópia, não referência)", () => {
    const c = v3Rico();
    const x = execucaoDeclaradaTop(c);
    expect(x).toEqual({ estoque: "configurada", financeiro: "legado" });
    expect(x).not.toBe(c.execucao);
    c.execucao = { estoque: "legado", financeiro: "configurada" };
    expect(execucaoDeclaradaTop(c)).toEqual({ estoque: "legado", financeiro: "configurada" });
  });

  it("TR-D2 execucaoDeclaradaTop do v1 continua legado; do v2 continua a do v2", () => {
    expect(execucaoDeclaradaTop(configuracaoNeutraTop())).toEqual({ estoque: "legado", financeiro: "legado" });
    expect(execucaoDeclaradaTop(v2Rico())).toEqual({ estoque: "configurada", financeiro: "configurada" });
  });
});

describe("TR-D2 vistas de edição", () => {
  it("TR-D2 configuracaoTopParaEdicao(v3) → formato 2 SEM as chaves novas, e o leitor estrito do v2 aceita a vista", () => {
    const c = v3Rico();
    const vista = configuracaoTopParaEdicao(c);
    expect(vista.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
    expect(Object.keys(vista.geral)).not.toContain("exigeTransportadora");
    expect(Object.keys(vista.financeiro)).not.toContain("clienteEmAtraso");
    expect(Object.keys(vista.financeiro)).not.toContain("toleranciaAtrasoDias");
    for (const k of ["modeloDocumento", "finalidade", "naturezaOperacao", ...CAMPOS_CFOP]) {
      expect(Object.keys(vista.fiscal)).not.toContain(k);
    }
    // As chaves antigas e a execução atravessam intactas.
    expect(vista.geral.exigeParceiro).toBe(true);
    expect(vista.estoque.atualizacao).toBe("saida");
    expect(vista.financeiro.atualizacao).toBe("receber");
    expect(vista.fiscal.habilitado).toBe(true);
    expect(vista.execucao).toEqual({ estoque: "configurada", financeiro: "legado" });
    expect(valorDe(vista)).toEqual(vista);
  });

  it("TR-D2 configuracaoTopParaEdicao(v3) não muta a entrada", () => {
    const c = congelar(v3Rico());
    const copia = clonar(c);
    expect(() => configuracaoTopParaEdicao(c)).not.toThrow();
    expect(c).toEqual(copia);
  });

  it("TR-D2 configuracaoTopParaEdicaoV3(v1) → formato 3 com as chaves novas no neutro e execução legado", () => {
    const v1 = configuracaoNeutraTop();
    v1.geral.exigeObservacao = true;
    const vista = configuracaoTopParaEdicaoV3(v1);
    expect(vista.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V3);
    const esperado = configuracaoNeutraTopV3();
    esperado.geral.exigeObservacao = true;
    expect(vista).toEqual(esperado);
  });

  it("TR-D2 configuracaoTopParaEdicaoV3(v2) → formato 3 com as chaves antigas do v2 e as novas no neutro", () => {
    const v2 = v2Rico();
    const vista = configuracaoTopParaEdicaoV3(v2);
    expect(vista.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V3);
    expect(vista.execucao).toEqual(v2.execucao);
    expect(vista.geral).toEqual({ ...v2.geral, exigeTransportadora: false });
    expect(vista.estoque).toEqual(v2.estoque);
    expect(vista.financeiro).toEqual({ ...v2.financeiro, clienteEmAtraso: "nao_valida", toleranciaAtrasoDias: 0 });
    expect(vista.fiscal).toEqual({
      ...v2.fiscal, modeloDocumento: "nenhum", finalidade: "normal", naturezaOperacao: "",
      cfopDentroEstado: "", cfopForaEstado: "", cfopExterior: "",
    });
    expect(vista.aprovacao).toEqual(v2.aprovacao);
    expect(valorDe(vista)).toEqual(vista);
  });

  it("TR-D2 configuracaoTopParaEdicaoV3(v3) devolve o próprio v3 normalizado", () => {
    const c = v3Rico();
    expect(configuracaoTopParaEdicaoV3(c)).toEqual(normalizarConfiguracaoTop(c));
  });
});

describe("TR-D2 igualdade e diferença entre formatos", () => {
  it("TR-D2 neutro v2 × neutro v3 são IGUAIS (e neutro v1 × neutro v3 também), nos dois sentidos", () => {
    expect(configuracoesTopIguais(configuracaoNeutraTopV2(), configuracaoNeutraTopV3())).toBe(true);
    expect(configuracoesTopIguais(configuracaoNeutraTopV3(), configuracaoNeutraTopV2())).toBe(true);
    expect(configuracoesTopIguais(configuracaoNeutraTop(), configuracaoNeutraTopV3())).toBe(true);
    expect(secoesAlteradasTop(configuracaoNeutraTopV2(), configuracaoNeutraTopV3())).toEqual([]);
  });

  for (const exigencia of ["exigeParceiro", "exigeCentroResultado", "exigeObservacao"] as const) {
    it(`TR-D2 v2 com geral.${exigencia} = true × MESMO conteúdo em v3 → DIFERENTES, e "geral" está nas seções alteradas`, () => {
      const v2 = configuracaoNeutraTopV2();
      v2.geral[exigencia] = true;
      const v3 = configuracaoTopParaEdicaoV3(v2);
      expect(v3.geral[exigencia]).toBe(true);
      expect(configuracoesTopIguais(v2, v3)).toBe(false);
      expect(configuracoesTopIguais(v3, v2)).toBe(false);
      expect(secoesAlteradasTop(v2, v3)).toContain("geral");
      expect(secoesAlteradasTop(v2, v3)).toEqual(["geral"]);
      expect(secoesAlteradasTop(v3, v2)).toEqual(["geral"]);
    });
  }

  it("TR-D2 v1 com geral.exigeObservacao = true × mesmo conteúdo em v3 → DIFERENTES (a promoção passaria a executar)", () => {
    const v1 = configuracaoNeutraTop();
    v1.geral.exigeObservacao = true;
    const v3 = configuracaoTopParaEdicaoV3(v1);
    expect(configuracoesTopIguais(v1, v3)).toBe(false);
    expect(secoesAlteradasTop(v1, v3)).toEqual(["geral"]);
  });

  it("TR-D2 v2 com as exigências de geral DESLIGADAS × v3 equivalente → IGUAIS e nenhuma seção alterada", () => {
    const v2 = v2Rico();
    v2.geral.exigeParceiro = false;
    const v3 = configuracaoTopParaEdicaoV3(v2);
    expect(configuracoesTopIguais(v2, v3)).toBe(true);
    expect(configuracoesTopIguais(v3, v2)).toBe(true);
    expect(secoesAlteradasTop(v2, v3)).toEqual([]);
  });

  it("TR-D2 v2 × v3 que difere numa chave nova → DIFERENTES, apontando a seção da chave", () => {
    const v2 = configuracaoNeutraTopV2();
    const v3 = configuracaoNeutraTopV3();
    v3.geral.exigeTransportadora = true;
    expect(configuracoesTopIguais(v2, v3)).toBe(false);
    expect(secoesAlteradasTop(v2, v3)).toEqual(["geral"]);
    const v3b = configuracaoNeutraTopV3();
    v3b.financeiro.clienteEmAtraso = "avisa";
    expect(secoesAlteradasTop(v2, v3b)).toEqual(["financeiro"]);
  });

  it("TR-D2 v3 × v3 com as mesmas exigências ligadas são IGUAIS (formato igual não é mudança)", () => {
    const a = configuracaoNeutraTopV3();
    a.geral.exigeObservacao = true;
    const b = clonar(a);
    expect(configuracoesTopIguais(a, b)).toBe(true);
    expect(secoesAlteradasTop(a, b)).toEqual([]);
  });

  it("TR-D2 configuracaoTopEhNeutra(neutro v3) = true; com uma chave nova fora do neutro = false", () => {
    expect(configuracaoTopEhNeutra(configuracaoNeutraTopV3())).toBe(true);
    const c = configuracaoNeutraTopV3();
    c.geral.exigeTransportadora = true;
    expect(configuracaoTopEhNeutra(c)).toBe(false);
    const d = configuracaoNeutraTopV3();
    d.fiscal.habilitado = true;
    d.fiscal.cfopDentroEstado = "5102";
    expect(configuracaoTopEhNeutra(d)).toBe(false);
  });
});
