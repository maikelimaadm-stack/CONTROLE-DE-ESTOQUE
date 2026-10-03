import { describe, it, expect } from "vitest";
import {
  CAPACIDADE_TOP_NO_MODULO,
  EXIGENCIAS_GERAIS_DOS_MODULOS_TOP,
  MENSAGEM_TOP_DA_OS_NAO_MUDA,
  MODULOS_COM_TOP,
  SEGMENTO_DO_MODULO_COM_TOP,
  TABELA_DO_MODULO_COM_TOP,
  custoPorUnidade,
  entendeTopNoModulo,
  exigenciasGeraisDoModuloTop,
  familiaDoModuloComTop,
  itensDaBatelada,
  itensDaProducaoDeRacao,
  leituraDoContadorDoBem,
  moduloComTopDaFamilia,
  quantidadeDoProdutoNoManejo,
  type ModuloComTop,
} from "../src/centrais-dos-modulos.js";
import { CODIGOS_TIPO_OPERACAO, tipoOperacao } from "../src/tipo-operacao.js";
import { EXIGENCIAS_GERAIS_TOP, exigenciasGeraisDaFamiliaTop } from "../src/tipo-operacao-restricoes.js";
import * as dominio from "../src/index.js";

/**
 * OPERACOES-01 F10 (decisão 287) — AS CENTRAIS DOS MÓDULOS COM PRODUTO: o que o domínio responde.
 *
 * (a) cada módulo tem a família no registry, pela tabela; ida e volta família ↔ módulo;
 * (b) os mapas de exigência: cada caminho é coluna da tabela do módulo (lista escrita À MÃO aqui) e
 *     `exigenciasGeraisDaFamiliaTop` devolve o mapa do módulo;
 * (c) a capacidade `topNoModulo: 1` e o leitor estrito;
 * (d)–(h) as contas da tela e do servidor, em decimal, totais (nunca lançam).
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o arquivo de produção não os escreve (pergunta ao
 * registry — `familia-operacional-ssot-audit`), e se o registry mudar, este teste falha alto.
 */

/** A família de cada módulo, escrita à mão: a resposta que o registry tem de dar pela tabela. */
const FAMILIA_ESPERADA: Readonly<Record<ModuloComTop, string>> = {
  abastecimento: "frota_ativos.abastecimento",
  manutencao: "frota_ativos.manutencao",
  ordem_servico: "ordens_servico.ordem_de_servico",
  manejo: "pecuaria.manejo",
  batelada: "confinamento.batelada",
  producao_racao: "estoque.producao_de_racao",
};

/**
 * As colunas de cada tabela que podem ser caminho de exigência, escritas à mão a partir das migrations
 * (0005: `fuel_supplies`, `maintenances`, `service_orders`; 0006: `animal_handlings`, `diet_batches`; 0003:
 * `feed_batches`) e da `erp.maintenances.note` que a migration dos módulos com TOP (F10) cria. Só as colunas de
 * cabeçalho que um usuário preenche — não a lista inteira.
 */
const COLUNAS_DO_REGISTRO: Readonly<Record<ModuloComTop, readonly string[]>> = {
  abastecimento: ["equipment_id", "operator_person_id", "warehouse_id", "product_id", "cost_center_id", "harvest_id", "note"],
  manutencao: ["harvest_id", "note"],
  ordem_servico: ["harvest_id", "activity_id", "operation_id", "cost_center_id", "responsible_person_id", "team_id", "description"],
  manejo: ["batch_id", "product_id", "warehouse_id", "responsible", "note"],
  batelada: ["diet_id", "warehouse_id", "equipment_id"],
  producao_racao: ["formula_id", "origin_warehouse_id", "destination_warehouse_id"],
};

describe("F10 (a) os módulos, as tabelas e as famílias do registry", () => {
  it("os seis módulos, na ordem do catálogo, com tabela e segmento de rota", () => {
    expect([...MODULOS_COM_TOP]).toEqual(["abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao"]);
    expect(TABELA_DO_MODULO_COM_TOP).toEqual({
      abastecimento: "erp.fuel_supplies", manutencao: "erp.maintenances", ordem_servico: "erp.service_orders",
      manejo: "erp.animal_handlings", batelada: "erp.diet_batches", producao_racao: "erp.feed_batches",
    });
    expect(SEGMENTO_DO_MODULO_COM_TOP).toEqual({
      abastecimento: "abastecimento", manutencao: "manutencao", ordem_servico: "ordem-servico",
      manejo: "manejo", batelada: "batelada", producao_racao: "producao-racao",
    });
    for (const m of MODULOS_COM_TOP) expect(SEGMENTO_DO_MODULO_COM_TOP[m], m).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(Object.isFrozen(TABELA_DO_MODULO_COM_TOP)).toBe(true);
    expect(Object.isFrozen(SEGMENTO_DO_MODULO_COM_TOP)).toBe(true);
  });

  it("cada módulo tem família no registry, de tabela inteira, e a família volta ao módulo", () => {
    for (const m of MODULOS_COM_TOP) {
      const familia = familiaDoModuloComTop(m);
      // A premissa: o registry declara a tabela (fail-closed seria `undefined`).
      expect(familia, m).not.toBeUndefined();
      expect(familia, m).toBe(FAMILIA_ESPERADA[m]);
      expect(CODIGOS_TIPO_OPERACAO, m).toContain(familia);
      const t = tipoOperacao(familia!);
      expect(t?.origem, m).toEqual({ tabela: TABELA_DO_MODULO_COM_TOP[m] });
      expect(moduloComTopDaFamilia(familia!), m).toBe(m);
    }
    // As duas famílias novas da F10, com o módulo de escopo de cada uma.
    expect(tipoOperacao("pecuaria.manejo")?.modulo).toBe("pecuaria");
    expect(tipoOperacao("confinamento.batelada")?.modulo).toBe("confinamento");
  });

  it("família que não é de módulo não tem módulo (quem chama nunca escolhe um vizinho)", () => {
    for (const f of ["vendas.venda", "estoque.saida", "compras.pedido", "financeiro.conta_a_pagar", "vendas.devolucao", ""]) {
      expect(moduloComTopDaFamilia(f), f).toBeUndefined();
      expect(exigenciasGeraisDoModuloTop(f), f).toBeUndefined();
    }
  });

  it("o índice do domínio exporta as peças da F10", () => {
    expect(dominio.MODULOS_COM_TOP).toBe(MODULOS_COM_TOP);
    expect(dominio.entendeTopNoModulo).toBe(entendeTopNoModulo);
    expect(dominio.CAPACIDADE_TOP_NO_MODULO).toBe(1);
  });
});

describe("F10 (b) as exigências gerais que o registro de cada módulo tem", () => {
  it("o mapa de cada módulo, exato", () => {
    const resumo = (m: ModuloComTop) => EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m].map((e) => [e.chave, e.caminho, e.rotulo]);
    expect(resumo("abastecimento")).toEqual([["exigeCentroResultado", "cost_center_id", "Centro de resultado"], ["exigeObservacao", "note", "Observação"]]);
    expect(resumo("manutencao")).toEqual([["exigeObservacao", "note", "Observação"]]);
    expect(resumo("ordem_servico")).toEqual([["exigeCentroResultado", "cost_center_id", "Centro de resultado"], ["exigeObservacao", "description", "Descrição"]]);
    expect(resumo("manejo")).toEqual([["exigeObservacao", "note", "Observação"]]);
    expect(resumo("batelada")).toEqual([]);
    expect(resumo("producao_racao")).toEqual([]);
  });

  it("todo caminho é coluna da tabela do módulo; nenhum módulo exige parceiro nem transportadora", () => {
    for (const m of MODULOS_COM_TOP) {
      for (const e of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m]) {
        expect(COLUNAS_DO_REGISTRO[m], `${m}: ${e.caminho}`).toContain(e.caminho);
        expect(["exigeParceiro", "exigeTransportadora"], `${m}: ${e.chave}`).not.toContain(e.chave);
      }
    }
  });

  it("exigenciasGeraisDaFamiliaTop devolve o mapa do módulo (o mesmo objeto), nunca o da venda", () => {
    for (const m of MODULOS_COM_TOP) {
      const familia = familiaDoModuloComTop(m)!;
      expect(exigenciasGeraisDaFamiliaTop(familia), m).toBe(EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m]);
      expect(exigenciasGeraisDoModuloTop(familia), m).toBe(EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m]);
      expect(exigenciasGeraisDaFamiliaTop(familia), m).not.toBe(EXIGENCIAS_GERAIS_TOP);
    }
    // A premissa: fora dos módulos, a venda continua com o mapa da venda.
    expect(exigenciasGeraisDaFamiliaTop("vendas.venda")).toBe(EXIGENCIAS_GERAIS_TOP);
  });

  it("o mapa é congelado em profundidade", () => {
    expect(Object.isFrozen(EXIGENCIAS_GERAIS_DOS_MODULOS_TOP)).toBe(true);
    for (const m of MODULOS_COM_TOP) {
      expect(Object.isFrozen(EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m]), m).toBe(true);
      for (const e of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m]) expect(Object.isFrozen(e), `${m}.${e.chave}`).toBe(true);
    }
  });
});

describe("F10 (c) a capacidade topNoModulo", () => {
  it("o valor declarado é 1", () => {
    expect(CAPACIDADE_TOP_NO_MODULO).toBe(1);
  });

  it("só { topNoModulo: 1 }, em propriedade própria, é entendida", () => {
    expect(entendeTopNoModulo({ topNoModulo: 1 })).toBe(true);
    expect(entendeTopNoModulo({ topNoModulo: 1, outra: true })).toBe(true);
    const recusadas: unknown[] = [
      { topNoModulo: 2 }, { topNoModulo: "1" }, { topNoModulo: true }, {}, { outra: 1 },
      null, undefined, 1, "topNoModulo", [{ topNoModulo: 1 }], Object.create({ topNoModulo: 1 }),
    ];
    for (const c of recusadas) expect(entendeTopNoModulo(c), JSON.stringify(c) ?? String(c)).toBe(false);
  });
});

describe("F10 (d) leituraDoContadorDoBem", () => {
  it("o horímetro; sem ele, o km; sem os dois, null", () => {
    expect(leituraDoContadorDoBem("1200", null)).toBe("1200");
    expect(leituraDoContadorDoBem(null, "5000")).toBe("5000");
    expect(leituraDoContadorDoBem(undefined, "5000.5")).toBe("5000.5");
    expect(leituraDoContadorDoBem("1200", "5000")).toBe("1200");
    expect(leituraDoContadorDoBem(null, null)).toBeNull();
    expect(leituraDoContadorDoBem(undefined, undefined)).toBeNull();
  });

  it("texto vazio (ou sem forma decimal) é ausente; o texto válido sai aparado", () => {
    expect(leituraDoContadorDoBem("", "")).toBeNull();
    expect(leituraDoContadorDoBem("  ", "5000")).toBe("5000");
    expect(leituraDoContadorDoBem("", "  7  ")).toBe("7");
    expect(leituraDoContadorDoBem("abc", "5000")).toBe("5000");
    expect(leituraDoContadorDoBem("1,5", null)).toBeNull();
  });
});

describe("F10 (e) quantidadeDoProdutoNoManejo", () => {
  it("dose × Σ cabeças, 4 casas", () => {
    expect(quantidadeDoProdutoNoManejo("2", ["1", "1", "1"])).toBe("6.0000");
    expect(quantidadeDoProdutoNoManejo("0.5", ["10"])).toBe("5.0000");
    expect(quantidadeDoProdutoNoManejo("1.25", ["3", "1"])).toBe("5.0000");
    expect(quantidadeDoProdutoNoManejo("0.33333", ["1"])).toBe("0.3333");
  });

  it("sem dose (nula, ausente ou vazia), Σ cabeças", () => {
    expect(quantidadeDoProdutoNoManejo(null, ["1", "1", "1"])).toBe("3.0000");
    expect(quantidadeDoProdutoNoManejo(undefined, ["10", "2"])).toBe("12.0000");
    expect(quantidadeDoProdutoNoManejo("", ["4"])).toBe("4.0000");
    expect(quantidadeDoProdutoNoManejo("  ", [])).toBe("0.0000");
  });

  it("entrada inválida conta 0 (cabeça e dose) e nunca lança", () => {
    expect(quantidadeDoProdutoNoManejo("2", ["1", "abc", "", "1"])).toBe("4.0000");
    expect(quantidadeDoProdutoNoManejo("abc", ["1", "1"])).toBe("0.0000");
    expect(quantidadeDoProdutoNoManejo(null, ["x"])).toBe("0.0000");
  });

  it("decimal de verdade, sem ponto flutuante", () => {
    // Em ponto flutuante, 0.1 × 3 = 0.30000000000000004; em decimal, 0.3.
    expect(quantidadeDoProdutoNoManejo("0.1", ["1", "1", "1"])).toBe("0.3000");
  });
});

describe("F10 (f) itensDaBatelada", () => {
  it("kg × % / 100, 4 casas, na ordem dos ingredientes", () => {
    expect(itensDaBatelada("100", [{ product_id: "a", percentage: "60" }, { product_id: "b", percentage: "40" }])).toEqual([
      { product_id: "a", quantidade: "60.0000" },
      { product_id: "b", quantidade: "40.0000" },
    ]);
  });

  it("arredonda a 4 casas (33,3333% de 100 kg)", () => {
    expect(itensDaBatelada("100", [{ product_id: "a", percentage: "33.33333" }, { product_id: "b", percentage: "66.66667" }])).toEqual([
      { product_id: "a", quantidade: "33.3333" },
      { product_id: "b", quantidade: "66.6667" },
    ]);
    expect(itensDaBatelada("250.5", [{ product_id: "a", percentage: "12.5" }])).toEqual([{ product_id: "a", quantidade: "31.3125" }]);
  });

  it("kg ou percentual inválido conta 0; sem ingredientes, nenhum item", () => {
    expect(itensDaBatelada("", [{ product_id: "a", percentage: "60" }])).toEqual([{ product_id: "a", quantidade: "0.0000" }]);
    expect(itensDaBatelada("100", [{ product_id: "a", percentage: "x" }])).toEqual([{ product_id: "a", quantidade: "0.0000" }]);
    expect(itensDaBatelada("100", [])).toEqual([]);
  });
});

describe("F10 (g) itensDaProducaoDeRacao", () => {
  it("quantidade da fórmula × multiplicador, 4 casas", () => {
    expect(itensDaProducaoDeRacao("2", [{ product_id: "a", quantity: "10" }, { product_id: "b", quantity: "2.5" }])).toEqual([
      { product_id: "a", quantidade: "20.0000" },
      { product_id: "b", quantidade: "5.0000" },
    ]);
    expect(itensDaProducaoDeRacao("1.5", [{ product_id: "a", quantity: "0.33333" }])).toEqual([{ product_id: "a", quantidade: "0.5000" }]);
  });

  it("multiplicador vazio ou inválido = 1; quantidade inválida conta 0", () => {
    expect(itensDaProducaoDeRacao("", [{ product_id: "a", quantity: "10" }])).toEqual([{ product_id: "a", quantidade: "10.0000" }]);
    expect(itensDaProducaoDeRacao("abc", [{ product_id: "a", quantity: "10" }])).toEqual([{ product_id: "a", quantidade: "10.0000" }]);
    expect(itensDaProducaoDeRacao("2", [{ product_id: "a", quantity: "" }])).toEqual([{ product_id: "a", quantidade: "0.0000" }]);
  });
});

describe("F10 (h) custoPorUnidade", () => {
  it("total / quantidade, 6 casas", () => {
    expect(custoPorUnidade("150.00", "100")).toBe("1.500000");
    expect(custoPorUnidade("100", "3")).toBe("33.333333");
    expect(custoPorUnidade("0", "10")).toBe("0.000000");
  });

  it("quantidade 0, vazia ou inválida → null (nunca divide por zero); total inválido → null", () => {
    expect(custoPorUnidade("150", "0")).toBeNull();
    expect(custoPorUnidade("150", "0.0000")).toBeNull();
    expect(custoPorUnidade("150", "")).toBeNull();
    expect(custoPorUnidade("150", "abc")).toBeNull();
    expect(custoPorUnidade("", "10")).toBeNull();
    expect(custoPorUnidade("x", "10")).toBeNull();
  });
});

describe("F10 a recusa do PUT da OS", () => {
  it("o texto exato", () => {
    expect(MENSAGEM_TOP_DA_OS_NAO_MUDA).toBe("O tipo de operação da OS não muda depois do lançamento.");
  });
});
