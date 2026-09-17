import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DICIONARIO_DE_DADOS, dicionarioPorTabela, validarDicionarioDeDados } from "../dicionario-dados.mjs";

/**
 * O DICIONÁRIO COMO CÓDIGO, NÃO COMO DOCUMENTO.
 *
 * Duas funções deste módulo nunca haviam sido executadas por ninguém, e por isso nunca haviam sido
 * corrigidas. `dicionarioPorTabela()` referenciava `DATA_DICTIONARY` e `e.table` — dois nomes que não
 * existem neste arquivo — e lançava `ReferenceError` a qualquer chamada. O gerador lia
 * `override.name`/`override.description` onde os dados curados usam `nome`/`descricao`, e por isso as
 * colunas "Nome funcional" e "Descrição" do documento publicado saíam SEMPRE vazias, inclusive para as
 * entidades que se deram ao trabalho de curar os campos.
 *
 * Os dois defeitos têm a mesma causa: exportado sem leitor não é testado por acidente. Estes casos são
 * o leitor que faltava.
 */

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("índice por tabela", () => {
  it("1 · devolve um Map indexado pela tabela canônica, com uma entrada por entidade curada", () => {
    const indice = dicionarioPorTabela();
    expect(indice).toBeInstanceOf(Map);
    expect(indice.size, "uma entrada por entidade curada").toBe(DICIONARIO_DE_DADOS.length);
    expect(indice.has("erp.input_entries"), "erp.input_entries precisa estar indexada").toBe(true);
  });

  it("2 · devolve as MESMAS referências do SSOT, nunca cópias", () => {
    // Cópia criaria uma segunda versão da entrada: quem indexa acabaria lendo dados que divergem em
    // silêncio da fonte. A identidade referencial é o que impede isso.
    const indice = dicionarioPorTabela();
    for (const entrada of DICIONARIO_DE_DADOS) {
      expect(indice.get(entrada.tabela), `${entrada.codigo}: precisa ser a MESMA referência do SSOT`).toBe(entrada);
    }
  });

  it("3 · toda tabela indexada é a `tabela` declarada, e nenhuma chave é `undefined`", () => {
    // O defeito anterior lia `e.table`, inexistente: o Map teria UMA chave `undefined` para todas as
    // entradas. Esta asserção reprova exatamente essa forma de quebra.
    for (const chave of dicionarioPorTabela().keys()) {
      expect(chave, "chave indefinida indica campo errado no índice").toBeTruthy();
      expect(chave).toMatch(/^erp\./);
    }
  });

  it("4 · o módulo carrega e expõe o validador — o que faltava era o leitor, não a função", () => {
    // O cruzamento com o schema real é do gate (`data-dictionary --check`), que carrega as migrations.
    // Aqui o que se garante é que o módulo importa sem erro e que a superfície pública existe: era a
    // ausência de QUALQUER leitor que deixava `dicionarioPorTabela` quebrada por tanto tempo.
    expect(typeof validarDicionarioDeDados).toBe("function");
    expect(DICIONARIO_DE_DADOS.length, "o dicionário não pode estar vazio").toBeGreaterThan(0);
  });
});

describe("o documento gerado publica o que foi curado", () => {
  /**
   * GATE DE EFEITO, não de existência. Não basta o gerador rodar: o Nome funcional e a Descrição de um
   * override conhecido precisam APARECER no documento. Enquanto o gerador lia a chave errada, ele rodava
   * perfeitamente e publicava células vazias — verde que não provava nada.
   */
  it("5 · Nome funcional e Descrição de overrides conhecidos aparecem em docs/DATA-DICTIONARY.md", () => {
    const documento = fs.readFileSync(path.join(raiz, "docs/DATA-DICTIONARY.md"), "utf8");

    // Amostra de três entidades diferentes, para que o caso não passe por coincidência de uma só.
    const esperados: [string, string, string][] = [
      ["erp.empresas", "Código", "Código curto da empresa dentro da organização."],
      ["erp.financial_titles", "Sentido", "payable = conta a pagar; receivable = conta a receber."],
      ["erp.registros_globais", "ID Global", "Número sequencial por organização, exibido como #55."]
    ];

    for (const [tabela, nomeFuncional, trechoDescricao] of esperados) {
      const entrada = dicionarioPorTabela().get(tabela);
      expect(entrada, `${tabela} precisa estar no dicionário`).toBeTruthy();
      const curados = Object.values(entrada!.campos ?? {}).map((c) => (c as { nome?: string }).nome);
      expect(curados, `${tabela}: "${nomeFuncional}" precisa estar CURADO`).toContain(nomeFuncional);
      expect(documento, `${tabela}: "${nomeFuncional}" curado mas AUSENTE do documento gerado`).toContain(`| ${nomeFuncional} |`);
      expect(documento, `${tabela}: a descrição curada não chegou ao documento gerado`).toContain(trechoDescricao);
    }
  });

  it("6 · nenhuma entidade com campos curados publica a coluna Nome funcional inteiramente vazia", () => {
    // Forma agregada do mesmo gate: se o gerador voltar a ler a chave errada, TODAS as entidades com
    // `campos` perdem o conteúdo de uma vez, e este caso pega mesmo que a amostra acima mude.
    const documento = fs.readFileSync(path.join(raiz, "docs/DATA-DICTIONARY.md"), "utf8");
    const comCampos = DICIONARIO_DE_DADOS.filter((e) => e.campos && Object.keys(e.campos).length > 0);
    expect(comCampos.length, "o dicionário precisa ter entidades com campos curados").toBeGreaterThan(0);

    for (const entrada of comCampos) {
      const nomes = Object.values(entrada.campos!).map((c) => (c as { nome?: string }).nome).filter(Boolean);
      const publicados = nomes.filter((n) => documento.includes(`| ${n} |`));
      expect(publicados.length, `${entrada.codigo}: nenhum dos ${nomes.length} nomes funcionais curados aparece no documento`).toBeGreaterThan(0);
    }
  });
});
