import { describe, it, expect } from "vitest";
import { resolverTipoOperacao } from "../src/tipo-operacao.js";
import {
  CODIGOS_TIPO_OPERACAO,
  FORMA_CODIGO_TIPO_OPERACAO,
  LIMITE_NOME_TIPO_OPERACAO,
  chaveI18nDaFamiliaOperacional,
  familiaOperacionalDeclarada,
  familiaOperacionalDeDocumentoVenda,
  familiasOperacionaisDisponiveis,
  moduloDaFamiliaOperacional,
  validarTipoOperacaoConfigurado,
  TABELA_DOCUMENTO_VENDA
} from "../src/index.js";
import { CHAVES_MODULO_EMPRESA } from "../src/escopo-permissao.js";

/**
 * A FRONTEIRA ENTRE AS DUAS CAMADAS — é isto que este arquivo protege.
 *
 * A TOP configurada é dado da organização; a FAMÍLIA canônica é código do produto. O defeito que custaria
 * caro não é "a validação recusa um nome vazio": é a camada configurável ganhar uma cópia da lista de
 * famílias, ou aceitar uma família que ninguém sabe executar.
 */
describe("TOP configurada — a lista de famílias tem um dono só", () => {
  it("as famílias disponíveis SÃO as do registry, pela mesma referência", () => {
    // Não `toEqual`: `toBe`. Se um dia alguém devolver uma cópia (`[...CODIGOS]`), a cópia pode ser
    // filtrada, reordenada ou ficar para trás sem que nada quebre — e este teste é o que impede.
    expect(familiasOperacionaisDisponiveis()).toBe(CODIGOS_TIPO_OPERACAO);
  });

  it("toda família declarada tem módulo conhecido e chave de rótulo derivada do código", () => {
    for (const codigo of familiasOperacionaisDisponiveis()) {
      expect(CHAVES_MODULO_EMPRESA, `módulo de ${codigo}`).toContain(moduloDaFamiliaOperacional(codigo));
      // A chave nunca é digitada: é `top.` + o código. Digitá-la abriria espaço para divergir do registry.
      expect(chaveI18nDaFamiliaOperacional(codigo)).toBe(`top.${codigo}`);
    }
  });

  it("família desconhecida NEGA — não cai em vizinha, não cai em padrão", () => {
    for (const impostor of ["vendas.inexistente", "vendas", "venda", "", "VENDAS.VENDA", "vendas.venda "]) {
      expect(familiaOperacionalDeclarada(impostor), impostor).toBe(false);
      expect(moduloDaFamiliaOperacional(impostor), impostor).toBeUndefined();
    }
  });
});

describe("TOP configurada — validação de entrada", () => {
  const valida = { codigo: "2103", codigoBase: "vendas.venda", nome: "Venda de Gado a Prazo" };

  it("aceita um candidato bem formado", () => {
    expect(validarTipoOperacaoConfigurado(valida)).toEqual([]);
  });

  it("o código preserva zero à esquerda e recusa o que não é código", () => {
    // "0101" e "101" são códigos DIFERENTES para o usuário; por isso o campo é texto, não inteiro.
    expect(FORMA_CODIGO_TIPO_OPERACAO.test("0101")).toBe(true);
    for (const ruim of ["", " ", "-1", "a".repeat(21), "tem espaço", "acentuação", "código/barra"]) {
      expect(FORMA_CODIGO_TIPO_OPERACAO.test(ruim), ruim).toBe(false);
    }
  });

  it("devolve TODAS as recusas, não só a primeira", () => {
    // Uma por vez faria o usuário corrigir em rodadas — e faria este teste provar menos do que parece:
    // um candidato com dois defeitos passaria exibindo apenas um.
    const r = validarTipoOperacaoConfigurado({ codigo: "com espaço", codigoBase: "nao.existe", nome: "  " });
    expect(r.map((x) => x.motivo).sort()).toEqual(["base_desconhecida", "codigo_invalido", "nome_invalido"]);
  });

  it("a recusa de família DIZ qual família foi recusada", () => {
    const r = validarTipoOperacaoConfigurado({ ...valida, codigoBase: "vendas.fantasma" });
    expect(r).toEqual([{ motivo: "base_desconhecida", codigoBase: "vendas.fantasma" }]);
  });

  it("nome só de espaços é nome vazio", () => {
    expect(validarTipoOperacaoConfigurado({ ...valida, nome: "   " }).map((x) => x.motivo)).toEqual(["nome_invalido"]);
  });

  it("o limite de nome é exclusivo no passo seguinte", () => {
    expect(validarTipoOperacaoConfigurado({ ...valida, nome: "a".repeat(LIMITE_NOME_TIPO_OPERACAO) })).toEqual([]);
    expect(validarTipoOperacaoConfigurado({ ...valida, nome: "a".repeat(LIMITE_NOME_TIPO_OPERACAO + 1) }).map((x) => x.motivo))
      .toEqual(["nome_invalido"]);
  });

  it("descrição ausente é legítima; descrição longa demais não", () => {
    expect(validarTipoOperacaoConfigurado({ ...valida, descricao: null })).toEqual([]);
    expect(validarTipoOperacaoConfigurado({ ...valida, descricao: "d".repeat(501) }).map((x) => x.motivo))
      .toEqual(["descricao_invalida"]);
  });
});

/**
 * A FAMÍLIA DA VARIANTE DE VENDA — derivada do registry, nunca copiada (TOP-CONFIG-02).
 *
 * Este bloco é a prova de que o helper NÃO tem uma segunda lista dentro dele. A asserção que vale é a
 * última: se o registry mudasse, a resposta mudaria junto — é isso que distingue derivar de copiar.
 */
describe("familiaOperacionalDeDocumentoVenda", () => {
  it("resolve as três variantes pelo registry", () => {
    expect(familiaOperacionalDeDocumentoVenda("budget")).toBe("vendas.orcamento");
    expect(familiaOperacionalDeDocumentoVenda("order")).toBe("vendas.pedido");
    expect(familiaOperacionalDeDocumentoVenda("sale")).toBe("vendas.venda");
  });

  it("FAIL-CLOSED: variante desconhecida, vazia ou ausente devolve undefined", () => {
    // Nunca cai na primeira variante nem numa família "parecida": classificar errado um lançamento é pior
    // do que recusá-lo, porque o documento nasceria afirmando ser uma operação que não é.
    for (const v of ["invoice", "", null, undefined, "SALE", "sales"]) {
      expect(familiaOperacionalDeDocumentoVenda(v as string), String(v)).toBeUndefined();
    }
  });

  it("a resposta É a do registry para `erp.sales_documents` — não uma cópia paralela", () => {
    // Se alguém trocasse o helper por um objeto literal, esta asserção continuaria passando ENQUANTO os
    // dois coincidissem — e é exatamente por isso que ela não anda sozinha: o gate estático
    // `familia-operacional-ssot-audit` reprova a enumeração, e a reversa RT11 prova que ele reprova.
    for (const kind of ["budget", "order", "sale"]) {
      expect(familiaOperacionalDeDocumentoVenda(kind))
        .toBe(resolverTipoOperacao(TABELA_DOCUMENTO_VENDA, kind)?.codigo);
    }
  });
});
