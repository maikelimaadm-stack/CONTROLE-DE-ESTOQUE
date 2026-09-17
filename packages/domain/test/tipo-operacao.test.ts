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
  validarRegistroTipoOperacao,
  type TipoOperacao
} from "../src/tipo-operacao.js";
import { CHAVES_MODULO_EMPRESA } from "../src/escopo-permissao.js";
import { allPermissionKeys } from "../src/permissions.js";
import { DICIONARIO_DE_DADOS } from "../dicionario-dados.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    // Guarda de não-vacuidade: metade dos casos desta suíte percorre TIPOS_OPERACAO, e um registry vazio
    // os deixaria verdes sem provar nada — inclusive os que travam "CLASSIFICAR ≠ EXECUTAR".
    expect(TIPOS_OPERACAO.length, "registry vazio tornaria metade desta suíte vácua").toBeGreaterThan(0);
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

  it("10b · e o cruzamento vale nos DOIS sentidos: toda TOP declarada é referenciada pelo dicionário", () => {
    // Sem este caso o cruzamento é de mão única: uma TOP órfã — declarada no registry, ausente do
    // dicionário — resolveria em produção e apareceria na tela, enquanto o documento gerado não a
    // listaria. Seria a "segunda lista que envelhece em silêncio" com os papéis invertidos.
    const referenciadas = new Set(referencias.map((r) => r.chave));
    for (const t of TIPOS_OPERACAO) {
      expect(referenciadas.has(t.codigo), `${t.codigo}: declarada no registry e não referenciada por nenhuma entrada do dicionário`).toBe(true);
    }
    expect(referenciadas.size, "o dicionário não pode referenciar TOP que não existe").toBe(TIPOS_OPERACAO.length);
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
    // Propriedade HERDADA não classifica: um `Object.prototype.kind` faria toda transferência afirmar a
    // mesma variante, e o registro que não a declara não tem essa variante.
    expect(tipoOperacaoDoRegistro("erp.warehouse_transfers", Object.create({ kind: "farm" }) as Record<string, unknown>), "propriedade herdada não é do registro").toBeUndefined();
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

  it("23 · a TOP não é permissão: nenhum código existe no catálogo real de permissões", () => {
    // Cruzamento com o SSOT, não heurística de sufixo: se um código de TOP fosse também uma permission
    // key, alguém acabaria passando um no lugar do outro, e a confusão só apareceria como acesso.
    const permissoes = new Set(allPermissionKeys());
    expect(permissoes.size, "o catálogo de permissões precisa estar carregado").toBeGreaterThan(0);
    for (const t of TIPOS_OPERACAO) {
      expect(permissoes.has(t.codigo), `${t.codigo}: colide com uma chave de permissão real`).toBe(false);
      expect(t.codigo, `${t.codigo}: parece chave de permissão`).not.toMatch(/\.(view|create|edit|delete)$/);
    }
  });

  it("24 · o TIPO também é fechado: nenhum campo de execução declarado na interface, mesmo sem valor", () => {
    // POR QUE ESTE CASO EXISTE. Os casos 20-22 leem as ENTRADAS, e `Object.keys` não vê campo opcional
    // sem valor. Um `efeitoEstoque?: string` acrescentado à interface e ao construtor, sem povoar nenhuma
    // TOP, passaria nos quatro — e a fatia seguinte o povoaria com o argumento de que "sempre esteve lá e
    // o teste sempre passou". É assim que um registry vira motor: em duas etapas, cada uma inocente.
    // Por isso este caso lê o ARQUIVO-FONTE, como `scripts/naming-audit.mjs` já faz no repositório.
    const fonte = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/tipo-operacao.ts"), "utf8");
    const interfaces = [...fonte.matchAll(/export interface (TipoOperacao|OrigemTipoOperacao)\s*\{([\s\S]*?)\n\}/g)];
    expect(interfaces.length, "as duas interfaces do contrato precisam existir").toBe(2);

    // `readonly` é EXIGIDO, não apenas tolerado: a propriedade é capturada com o modificador, e a
    // ausência dele aparece como um nome sem prefixo — que a asserção abaixo reprova pelo próprio valor.
    const props = interfaces.flatMap(([, , corpo]) => [...corpo!.matchAll(/^\s{2}(readonly\s+)?([a-zA-Z][a-zA-Z0-9_]*)\??:/gm)]);
    for (const [, modificador, nome] of props) {
      expect(modificador, `"${nome}" precisa ser \`readonly\` na interface — imutabilidade é do contrato, não do costume`).toBeTruthy();
    }
    const declarados = props.map((m) => m[2]!);
    expect(declarados.sort(), "superfície declarada diferente do contrato").toEqual(
      ["chaveI18n", "codigo", "discriminador", "modulo", "origem", "tabela", "valor"]
    );

    // E o nome proibido não volta por outro caminho (campo, tipo auxiliar ou função exportada).
    for (const proibido of ["efeito", "efeitos", "handler", "endpoint", "posting", "contabiliz", "obrigatori", "workflow", "motor", "engine"]) {
      const regex = new RegExp(`^\\s*(export (interface|type|function|const) \\w*${proibido}|\\s{2}\\w*${proibido}\\w*\\??:)`, "im");
      expect(fonte, `"${proibido}" apareceu como superfície declarada — ver docs/TIPO-OPERACAO-CONTRACT.md §2`).not.toMatch(regex);
    }
  });
});

describe("imutável POR CONSTRUÇÃO, não por convenção", () => {
  /**
   * `readonly` do TypeScript some na compilação: em runtime o objeto continua mutável, e qualquer
   * consumidor — ou um bundle de terceiro — poderia reescrever a origem de uma TOP e mudar como TODA a
   * aplicação classifica aquele registro. Um SSOT que o leitor pode reescrever não é fonte única.
   * Por isso a imutabilidade é verificada em runtime, e não na assinatura.
   */
  it("25 · a lista, cada TOP e cada origem estão congeladas, e a lista de códigos também", () => {
    expect(Object.isFrozen(TIPOS_OPERACAO), "TIPOS_OPERACAO precisa estar congelada").toBe(true);
    expect(Object.isFrozen(CODIGOS_TIPO_OPERACAO), "CODIGOS_TIPO_OPERACAO precisa estar congelada").toBe(true);
    for (const t of TIPOS_OPERACAO) {
      expect(Object.isFrozen(t), `${t.codigo}: a TOP precisa estar congelada`).toBe(true);
      expect(Object.isFrozen(t.origem), `${t.codigo}: a origem precisa estar congelada`).toBe(true);
    }
  });

  it("26 · tentativa de mutação não altera código, origem, resolução nem a quantidade de TOPs", () => {
    const antes = {
      quantidade: TIPOS_OPERACAO.length,
      codigos: [...CODIGOS_TIPO_OPERACAO],
      resolvida: resolverTipoOperacao("erp.warehouse_transfers", "farm")?.codigo
    };
    const alvo = tipoOperacao("estoque.entrada_manual")!;
    const mutar = (fn: () => void) => { try { fn(); } catch { /* strict mode lança; sloppy ignora — os dois são aceitáveis */ } };

    mutar(() => { (alvo as { codigo: string }).codigo = "sequestrada"; });
    mutar(() => { (alvo.origem as { tabela: string }).tabela = "erp.outra"; });
    // As mutações de LISTA ficam em try/finally que restaura. Hoje são inertes porque o freeze existe;
    // no dia em que alguém o remover, este caso reprova (certo) e, sem a restauração, os casos
    // seguintes reprovariam em cascata sobre um TIPOS_OPERACAO esvaziado, com mensagens que não
    // apontam a causa. Um gate deve falhar UMA vez, com o diagnóstico certo.
    const copiaTops = [...TIPOS_OPERACAO];
    const copiaCodigos = [...CODIGOS_TIPO_OPERACAO];
    try {
      mutar(() => { (TIPOS_OPERACAO as TipoOperacao[]).push(alvo); });
      mutar(() => { (TIPOS_OPERACAO as TipoOperacao[]).length = 0; });
      mutar(() => { (CODIGOS_TIPO_OPERACAO as string[]).push("inventada"); });
    } finally {
      if (!Object.isFrozen(TIPOS_OPERACAO)) (TIPOS_OPERACAO as TipoOperacao[]).splice(0, TIPOS_OPERACAO.length, ...copiaTops);
      if (!Object.isFrozen(CODIGOS_TIPO_OPERACAO)) (CODIGOS_TIPO_OPERACAO as string[]).splice(0, CODIGOS_TIPO_OPERACAO.length, ...copiaCodigos);
    }

    expect(alvo.codigo, "o código não pode ter mudado").toBe("estoque.entrada_manual");
    expect(alvo.origem.tabela, "a origem não pode ter mudado").toBe("erp.input_entries");
    expect(TIPOS_OPERACAO.length, "a quantidade de TOPs não pode ter mudado").toBe(antes.quantidade);
    expect([...CODIGOS_TIPO_OPERACAO], "a lista de códigos não pode ter mudado").toEqual(antes.codigos);
    expect(resolverTipoOperacao("erp.warehouse_transfers", "farm")?.codigo, "a resolução não pode ter mudado").toBe(antes.resolvida);
    expect(tipoOperacao("estoque.entrada_manual")?.origem.tabela, "o índice não pode ter mudado").toBe("erp.input_entries");
  });
});

describe("a TOP responde O QUE O REGISTRO É, não o efeito de alguns dos seus tipos", () => {
  /**
   * `erp.invoices` guarda NOVE tipos de documento. "Entrada por documento fiscal" descrevia o EFEITO
   * dos que dão entrada de estoque, e era simplesmente falso para um DARF (guia de tributo) ou um CT-e
   * (frete). Enquanto isso vivia na prosa do dicionário ninguém lia; a partir da BASE2-02 a tela AFIRMA
   * a classificação, e afirmação falsa na tela é pior que ausência.
   *
   * A correção é uma TOP NEUTRA e verdadeira para a tabela inteira — não nove TOPs inventadas a partir
   * de sigla, que é o que o contrato §9 proíbe, e não um mapa de efeito por `document_type`, que seria
   * a TOP decidindo o que o lançamento FAZ.
   */
  it("27 · a classificação de erp.invoices é NEUTRA: nfe e darf resolvem para a MESMA TOP", () => {
    const nfe = tipoOperacaoDoRegistro("erp.invoices", { document_type: "nfe" });
    const darf = tipoOperacaoDoRegistro("erp.invoices", { document_type: "darf" });
    expect(nfe?.codigo, "nfe precisa resolver").toBe("estoque.documento_fiscal");
    expect(darf?.codigo, "darf precisa resolver para a MESMA TOP — a tabela inteira é uma classificação só").toBe(nfe?.codigo);
    for (const tipo of ["cte", "nfse", "nfce", "danfe", "dare", "gru", "other"]) {
      expect(tipoOperacaoDoRegistro("erp.invoices", { document_type: tipo })?.codigo, `${tipo}: mesma TOP neutra`).toBe(nfe?.codigo);
    }
  });

  it("28 · nenhuma TOP afirma EFEITO no nome de uma tabela que mistura tipos com efeitos diferentes", () => {
    // `erp.invoices` é a tabela com o problema: o gate trava o nome de volta.
    const invoice = TIPOS_OPERACAO.filter((t) => t.origem.tabela === "erp.invoices");
    expect(invoice, "erp.invoices tem exatamente UMA TOP, neutra").toHaveLength(1);
    expect(invoice[0]!.codigo, "o código não pode voltar a afirmar entrada de estoque").not.toMatch(/entrada|saida|baixa/);
    // E o registry não ganhou nove TOPs por sigla.
    // Ancorado por LIMITE DE TOKEN, não por substring: `c.includes("gru")` reprovaria uma TOP
    // legítima chamada `cadastros.grupo_...`, e gate que acusa o inocente é desligado.
    for (const sigla of ["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru"]) {
      const comoToken = new RegExp(`(^|[._])${sigla}([._]|$)`);
      expect(CODIGOS_TIPO_OPERACAO.some((c) => comoToken.test(c)), `TOP inventada a partir da sigla "${sigla}"`).toBe(false);
    }
  });

  it("29 · e a tabela inteira sendo uma operação só, o document_type não é discriminador", () => {
    // Confirma que a neutralidade não foi obtida declarando uma variante silenciosa.
    expect(discriminadorDeTabela("erp.invoices"), "erp.invoices não tem variante declarada").toBeUndefined();
    // Registro sem document_type nenhum continua resolvendo: a tabela já é a resposta.
    expect(tipoOperacaoDoRegistro("erp.invoices", {})?.codigo).toBe("estoque.documento_fiscal");
  });
});
