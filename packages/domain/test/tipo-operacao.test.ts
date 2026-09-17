import { describe, it, expect } from "vitest";
import { ptBR } from "@erp/plataforma";
import {
  TIPOS_OPERACAO,
  CODIGOS_TIPO_OPERACAO,
  PREFIXO_I18N_TIPO_OPERACAO,
  tipoOperacao,
  tipoOperacaoDeclarada,
  discriminadorDeTabela,
  resolverTipoOperacao,
  tipoOperacaoDoRegistro,
  validarRegistroTipoOperacao
} from "../src/tipo-operacao.js";
import { CHAVES_MODULO_EMPRESA } from "../src/escopo-permissao.js";
import { DICIONARIO_DE_DADOS } from "../dicionario-dados.mjs";

/**
 * CONTRATO DO TIPO DE OPERAÇÃO (BASE2-02).
 *
 * O que estes casos defendem, e o que quebraria sem eles:
 *
 *  • CLASSIFICAR ≠ EXECUTAR. Uma TOP diz quem o lançamento é; ela não decide efeito, endpoint,
 *    permissão nem validação. O dia em que alguém acrescentar um `handler`, um `endpoint` ou um
 *    `efeitoEstoque` à definição, o registry terá virado o motor genérico que o roteiro adiou de
 *    propósito — e nenhum outro gate deste repositório perceberia. Os casos de FORMA reprovam isso.
 *
 *  • FAIL-CLOSED. Variante desconhecida caindo na TOP vizinha faria a tela afirmar, com confiança, uma
 *    operação que não é a do registro — uma transferência entre empresas exibida como entre armazéns.
 *    É pior que não classificar, porque a ausência se vê e o erro não.
 *
 *  • FONTE ÚNICA. O dicionário de dados referencia CHAVES; se uma delas deixar de existir no registry,
 *    ou passar a apontar para outra tabela, o cruzamento exaustivo aqui reprova. Antes da BASE2-02 o
 *    campo era prosa, e prosa não diverge com barulho: diverge em silêncio.
 */

const dicionario = DICIONARIO_DE_DADOS as readonly {
  codigo: string; tabela: string; natureza: string; top?: string; tops?: string[]; discriminadorTop?: string;
}[];

/** Referências de TOP do dicionário, achatadas: { entrada, chave }. */
const referencias = dicionario.flatMap((e) =>
  (e.tops ?? (e.top === undefined ? [] : [e.top])).map((chave) => ({ entrada: e, chave }))
);

describe("registry de Tipo de Operação: integridade", () => {
  it("1 · o gate do próprio registry não acusa problema", () => {
    expect(validarRegistroTipoOperacao()).toEqual([]);
  });

  it("2 · códigos são únicos", () => {
    expect(new Set(CODIGOS_TIPO_OPERACAO).size, "há código repetido").toBe(CODIGOS_TIPO_OPERACAO.length);
  });

  it("3 · todo código está na forma canônica <modulo>.<operacao>", () => {
    for (const t of TIPOS_OPERACAO) {
      expect(t.codigo, `${t.codigo}: fora da forma canônica`).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      // Rótulo humano jamais vira chave: acento, espaço e maiúscula são justamente o que muda com revisão de texto.
      expect(t.codigo, `${t.codigo}: chave não pode conter espaço, acento ou maiúscula`).not.toMatch(/[\sÀ-ÿA-Z]/);
    }
  });

  it("4 · toda TOP tem rótulo pt-BR no catálogo oficial, e a chave deriva do código", () => {
    for (const t of TIPOS_OPERACAO) {
      expect(t.chaveI18n, `${t.codigo}: chave de tradução não deriva do código`).toBe(`${PREFIXO_I18N_TIPO_OPERACAO}${t.codigo}`);
      const rotulo = ptBR.mensagens[t.chaveI18n];
      expect(rotulo, `${t.codigo}: sem rótulo em ${t.chaveI18n}`).toBeTruthy();
      expect(rotulo!.trim(), `${t.codigo}: rótulo vazio`).not.toBe("");
    }
  });

  it("5 · o módulo de toda TOP existe no vocabulário de módulos, e prefixa o código", () => {
    const modulos = new Set(CHAVES_MODULO_EMPRESA);
    for (const t of TIPOS_OPERACAO) {
      expect(modulos.has(t.modulo), `${t.codigo}: módulo "${t.modulo}" não existe`).toBe(true);
      expect(t.codigo.startsWith(`${t.modulo}.`), `${t.codigo}: código não começa pelo módulo`).toBe(true);
    }
  });

  it("6 · a origem de toda TOP é uma tabela canônica declarada no dicionário de dados", () => {
    const tabelas = new Set(dicionario.map((e) => e.tabela));
    for (const t of TIPOS_OPERACAO) {
      expect(t.origem.tabela, `${t.codigo}: origem precisa ser erp.<tabela>`).toMatch(/^erp\.[a-z_]+$/);
      expect(tabelas.has(t.origem.tabela), `${t.codigo}: ${t.origem.tabela} não está no dicionário`).toBe(true);
    }
  });

  it("7 · o discriminador declarado é a coluna que o dicionário declara para aquela tabela", () => {
    const porTabela = new Map(dicionario.map((e) => [e.tabela, e]));
    for (const t of TIPOS_OPERACAO) {
      const { tabela, discriminador, valor } = t.origem;
      if (!discriminador) {
        expect(valor, `${t.codigo}: valor sem discriminador`).toBeUndefined();
        continue;
      }
      expect(valor, `${t.codigo}: discriminador sem valor não seleciona nada`).toBeTruthy();
      expect(porTabela.get(tabela)?.discriminadorTop, `${t.codigo}: o dicionário não declara "${discriminador}" como discriminador de TOP de ${tabela}`).toBe(discriminador);
    }
  });

  it("8 · variante sem discriminador é inválida, e a mesma origem nunca pertence a duas TOPs", () => {
    const origens = new Map<string, string>();
    for (const t of TIPOS_OPERACAO) {
      const chave = `${t.origem.tabela}|${t.origem.valor ?? ""}`;
      expect(origens.has(chave), `${t.codigo}: mesma origem de ${origens.get(chave)}`).toBe(false);
      origens.set(chave, t.codigo);
    }
    // E uma tabela não é decidida por duas colunas diferentes.
    const colunas = new Map<string, string | undefined>();
    for (const t of TIPOS_OPERACAO) {
      if (colunas.has(t.origem.tabela)) {
        expect(colunas.get(t.origem.tabela), `${t.origem.tabela}: dois discriminadores diferentes`).toBe(t.origem.discriminador);
      }
      colunas.set(t.origem.tabela, t.origem.discriminador);
    }
  });
});

describe("registro de TOP × dicionário de dados: uma fonte, não duas", () => {
  it("9 · toda referência de TOP do dicionário resolve para uma TOP declarada", () => {
    expect(referencias.length, "o dicionário precisa referenciar TOPs — zero referência tornaria este teste vazio").toBeGreaterThan(0);
    for (const { entrada, chave } of referencias) {
      expect(tipoOperacaoDeclarada(chave), `${entrada.codigo}: TOP inexistente no registry: ${chave}`).toBe(true);
    }
  });

  it("10 · a TOP referenciada aponta de volta para a MESMA tabela da entrada (ninguém classifica outra entidade)", () => {
    for (const { entrada, chave } of referencias) {
      const t = tipoOperacao(chave)!;
      expect(t.origem.tabela, `${entrada.codigo}: ${chave} classifica ${t.origem.tabela}, não ${entrada.tabela}`).toBe(entrada.tabela);
    }
  });

  it("11 · nenhuma referência é texto livre — a prosa do formato anterior não pode voltar", () => {
    for (const { entrada, chave } of referencias) {
      expect(chave, `${entrada.codigo}: "${chave}" parece prosa, não chave`).not.toMatch(/[\s/]/);
      expect(chave, `${entrada.codigo}: "${chave}" tem acento ou maiúscula`).not.toMatch(/[À-ÿA-Z]/);
    }
  });

  it("12 · linha e infraestrutura nunca recebem TOP: não são lançamentos", () => {
    for (const e of dicionario) {
      const tem = e.top !== undefined || Boolean(e.tops);
      if (e.natureza !== "entidade") expect(tem, `${e.codigo}: natureza "${e.natureza}" não pode ter TOP`).toBe(false);
    }
    // O caso que dá nome à regra: movimento de estoque é a CONSEQUÊNCIA de uma operação, não uma operação.
    const movimento = dicionario.find((e) => e.tabela === "erp.stock_movements");
    expect(movimento?.top, "erp.stock_movements não pode ter TOP").toBeUndefined();
    expect(resolverTipoOperacao("erp.stock_movements"), "erp.stock_movements não pode resolver TOP").toBeUndefined();
  });

  it("13 · as sete formas do piloto Base 2 estão classificadas", () => {
    const piloto = [
      "erp.input_entries", "erp.invoices", "erp.requisitions", "erp.stock_writeoffs",
      "erp.devolutions", "erp.warehouse_transfers", "erp.feed_batches"
    ];
    for (const tabela of piloto) {
      const declaradas = TIPOS_OPERACAO.filter((t) => t.origem.tabela === tabela);
      expect(declaradas.length, `${tabela}: sem TOP declarada`).toBeGreaterThan(0);
    }
  });
});

describe("resolução: pura, determinística e fail-closed", () => {
  it("14 · entidade simples resolve pela tabela, e o resultado é estável", () => {
    const a = resolverTipoOperacao("erp.input_entries");
    const b = resolverTipoOperacao("erp.input_entries");
    expect(a?.codigo).toBe("estoque.entrada_manual");
    expect(a, "mesma entrada, mesma saída — e a mesma referência do registry").toBe(b);
  });

  it("15 · variante resolve pelo VALOR, e cada valor tem a sua própria TOP", () => {
    expect(resolverTipoOperacao("erp.warehouse_transfers", "warehouse")?.codigo).toBe("estoque.transferencia_entre_armazens");
    expect(resolverTipoOperacao("erp.warehouse_transfers", "farm")?.codigo).toBe("estoque.transferencia_entre_empresas");
    expect(resolverTipoOperacao("erp.financial_titles", "payable")?.codigo).toBe("financeiro.conta_a_pagar");
    expect(resolverTipoOperacao("erp.financial_titles", "receivable")?.codigo).toBe("financeiro.conta_a_receber");
    expect(resolverTipoOperacao("erp.sales_documents", "budget")?.codigo).toBe("vendas.orcamento");
    expect(resolverTipoOperacao("erp.sales_documents", "order")?.codigo).toBe("vendas.pedido");
    expect(resolverTipoOperacao("erp.sales_documents", "sale")?.codigo).toBe("vendas.venda");
  });

  it("16 · FAIL-CLOSED: variante desconhecida, ausente ou vazia NÃO cai na TOP vizinha", () => {
    for (const valor of ["inexistente", "", "__proto__", "constructor", null, undefined]) {
      expect(
        resolverTipoOperacao("erp.warehouse_transfers", valor as string | null | undefined),
        `transferência com kind=${String(valor)} não pode resolver`
      ).toBeUndefined();
    }
    // A primeira variante declarada é a que um fallback ingênuo escolheria. Ela não pode vir sem o valor.
    expect(resolverTipoOperacao("erp.warehouse_transfers")).toBeUndefined();
    expect(resolverTipoOperacao("erp.financial_titles")).toBeUndefined();
  });

  it("17 · FAIL-CLOSED: tabela sem TOP, desconhecida ou malformada devolve ausência", () => {
    for (const tabela of ["erp.stock_movements", "erp.input_entry_items", "erp.nao_existe", "input_entries", "", "__proto__"]) {
      expect(resolverTipoOperacao(tabela), `${tabela} não pode resolver TOP`).toBeUndefined();
    }
  });

  it("18 · resolução pelo REGISTRO lê o discriminador declarado, e nega registro sem ele", () => {
    expect(tipoOperacaoDoRegistro("erp.warehouse_transfers", { kind: "farm" })?.codigo).toBe("estoque.transferencia_entre_empresas");
    expect(tipoOperacaoDoRegistro("erp.input_entries", { kind: "farm" })?.codigo, "tabela sem variante ignora a coluna").toBe("estoque.entrada_manual");
    for (const registro of [{}, { kind: 7 }, { outra: "farm" }, null, undefined]) {
      expect(tipoOperacaoDoRegistro("erp.warehouse_transfers", registro as Record<string, unknown>), `registro ${JSON.stringify(registro)} não pode resolver`).toBeUndefined();
    }
  });

  it("19 · o discriminador é declarado pelo registry, não adivinhado por quem lê", () => {
    expect(discriminadorDeTabela("erp.warehouse_transfers")).toBe("kind");
    expect(discriminadorDeTabela("erp.financial_titles")).toBe("direction");
    expect(discriminadorDeTabela("erp.input_entries"), "tabela sem variante não tem discriminador").toBeUndefined();
    expect(discriminadorDeTabela("erp.nao_existe")).toBeUndefined();
  });
});

describe("a definição CLASSIFICA e não EXECUTA", () => {
  /**
   * A superfície é fechada de propósito. Este caso é o gate que impede o registry de virar motor: ele lê a
   * FORMA das entradas, e reprova qualquer campo novo que cheire a execução — mesmo que alguém o
   * acrescente com a melhor das intenções e com o resto da suíte verde.
   */
  const PERMITIDOS = ["codigo", "modulo", "chaveI18n", "origem"];
  const PERMITIDOS_ORIGEM = ["tabela", "discriminador", "valor"];

  it("20 · nenhuma TOP declara campo além dos quatro de identidade", () => {
    for (const t of TIPOS_OPERACAO) {
      expect(Object.keys(t).sort(), `${t.codigo}: superfície diferente do contrato`).toEqual([...PERMITIDOS].sort());
      expect(Object.keys(t.origem).every((k) => PERMITIDOS_ORIGEM.includes(k)), `${t.codigo}: campo estranho na origem`).toBe(true);
    }
  });

  it("21 · nenhum valor declarado é função: registry não carrega handler", () => {
    for (const t of TIPOS_OPERACAO) {
      for (const [campo, valor] of Object.entries({ ...t, ...t.origem })) {
        expect(typeof valor, `${t.codigo}.${campo} é função — isso é execução, não classificação`).not.toBe("function");
      }
    }
  });

  it("22 · nenhum campo carrega endpoint, rota, permissão ou configuração de efeito", () => {
    // Procura pelo CONTEÚDO, não só pelo nome do campo: um endpoint escondido dentro de `codigo` também é endpoint.
    const proibido = /^\/|\bhttps?:\/\/|\/api\/|\.(view|create|edit|delete)$/;
    for (const t of TIPOS_OPERACAO) {
      for (const [campo, valor] of Object.entries({ ...t, ...t.origem })) {
        if (typeof valor !== "string") continue;
        expect(valor, `${t.codigo}.${campo} = "${valor}" parece rota, endpoint ou permissão`).not.toMatch(proibido);
      }
    }
    const chaves = TIPOS_OPERACAO.flatMap((t) => Object.keys({ ...t, ...t.origem }));
    for (const proibida of ["endpoint", "rota", "route", "permissao", "permission", "handler", "service", "efeito", "efeitos", "campos", "layout", "workflow", "status"]) {
      expect(chaves.includes(proibida), `campo "${proibida}" não pertence a este contrato — ver docs/TIPO-OPERACAO-CONTRACT.md`).toBe(false);
    }
  });

  it("23 · a TOP não é permissão: nenhum código coincide com uma chave de permissão", () => {
    // Se um código de TOP fosse igual a uma permission key, alguém acabaria usando um no lugar do outro.
    for (const t of TIPOS_OPERACAO) {
      expect(t.codigo, `${t.codigo}: parece chave de permissão`).not.toMatch(/\.(view|create|edit|delete)$/);
    }
  });
});
