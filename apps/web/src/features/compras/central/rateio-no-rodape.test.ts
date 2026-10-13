import { describe, expect, it } from "vitest";
import {
  ABA_DO_RATEIO, CAMINHO_DA_CLASSIFICACAO_DO_ITEM, ROTULO_DA_ABA_DO_RATEIO, abaDoRateio, blocoFiscalNosDados, caminhoDoRateioComErro,
  ehCaminhoDoRateio, erroEscondidoNosDados, quantidadeDosDadosAdicionais, rateioNoPainel, testIdDoAlvoDoRateio
} from "./rateio-no-rodape";

/**
 * RATEIO-01 (decisão 316) — as contas PURAS de onde o rateio da compra mora: no painel (aba "Rateio"), nunca nos Dados;
 * a recusa dele abre a aba dele (e não mais os Dados adicionais); a contagem de "Dados adicionais · N campos" cai de
 * 9 para 8 na criação; sem a capacidade `importacaoXml`, nada muda. O que a tela DESENHA em cada lugar (um campo nunca
 * em dois lugares, no DOM) é provado pelo E2E `rateio-01-rodape.spec.ts`.
 */

/** `CAMPOS_DOS_DADOS_FISCAIS.length` (estado.ts): chave, UF, tipo de documento, IPI, ICMS-ST, seguro, tipo de título, classificação. */
const OITO_FISCAIS = 8;
const FISCAIS = ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto"] as const;
const TOP = { id: "t", codigo: "7001", nome: "Compra", movimento: "Compra" };

/** O estado mínimo que as contas leem: a capacidade (F7), a TOP travada (os Dados × o campo único do painel), o formulário. */
const estado = (o: { capacidade: boolean; top?: boolean; formulario?: boolean }) =>
  ({ dadosFiscaisAtivos: o.capacidade, top: o.top === false ? null : TOP, mostrarFormulario: o.formulario ?? true });

describe("RATEIO-01 · os caminhos de recusa que são do rateio", () => {
  it("o rateio (tipo, linhas nos dois formatos) e a classificação de cada item (nos dois formatos) são do rateio", () => {
    for (const c of ["rateio", "rateio.tipo", "rateio.linhas", "rateio.linhas[0].percentual", "rateio.linhas.1.categoria_financeira_id",
      "itens[0].gera_estoque", "itens[2].imobilizado", "itens.0.categoria_financeira_id", "itens.11.centro_custo_id"]) {
      expect(ehCaminhoDoRateio(c), c).toBe(true);
    }
  });

  it("o resto NÃO é: o cabeçalho (natureza e centro do documento, os fiscais) e os campos da grade do item", () => {
    for (const c of ["categoria_financeira_id", "centro_custo_id", "chave_acesso", "tipo_titulo_id", "itens", "itens[0]", "itens[0].armazem_id",
      "itens[0].quantidade", "itens.0.lote", "itens[0].categoria_financeira_idx", "xitens[0].imobilizado"]) {
      expect(ehCaminhoDoRateio(c), c).toBe(false);
    }
    expect(CAMINHO_DA_CLASSIFICACAO_DO_ITEM.test("itens[0].gera_estoque.x"), "o caminho inteiro, ancorado").toBe(false);
  });

  it("a primeira recusa do rateio, na ordem do servidor; nenhuma → null", () => {
    expect(caminhoDoRateioComErro({ chave_acesso: "x", "itens[1].categoria_financeira_id": "a", rateio: "b" })).toBe("itens[1].categoria_financeira_id");
    expect(caminhoDoRateioComErro({ rateio: "soma", "itens[0].imobilizado": "x" })).toBe("rateio");
    expect(caminhoDoRateioComErro({ chave_acesso: "x", "itens[0].quantidade": "y", categoria_financeira_id: "z" })).toBeNull();
    expect(caminhoDoRateioComErro({})).toBeNull();
  });
});

describe("RATEIO-01 · onde o rateio mora — nunca em dois lugares", () => {
  const casos = [true, false].flatMap((capacidade) => [true, false].flatMap((top) => [true, false].map((formulario) => ({ capacidade, top, formulario }))));

  it("o rateio está no painel EXATAMENTE quando o bloco fiscal está nos Dados (com o formulário à vista)", () => {
    for (const c of casos) {
      const e = estado(c);
      const dadosDesenham = e.mostrarFormulario && blocoFiscalNosDados(e);  // `DadosDaCriacao` não desenha nada sem o formulário
      expect(rateioNoPainel(e), JSON.stringify(c)).toBe(dadosDesenham);
    }
  });

  it("com a capacidade na criação da compra: os fiscais nos Dados, o rateio no painel", () => {
    const e = estado({ capacidade: true });
    expect(blocoFiscalNosDados(e)).toBe(true);
    expect(rateioNoPainel(e)).toBe(true);
  });

  it("o campo único que o painel desenha pelo mesmo componente (TOP zerada) não desenha o bloco — nem o rateio", () => {
    const umCampo = estado({ capacidade: true, top: false });
    expect(blocoFiscalNosDados(umCampo)).toBe(false);
    expect(rateioNoPainel(umCampo)).toBe(false);
  });

  it("SEM a capacidade `importacaoXml` (ou no pedido, no receber, na edição — `dadosFiscaisAtivos` falso): nenhuma aba, como hoje", () => {
    for (const formulario of [true, false]) {
      const e = estado({ capacidade: false, formulario });
      expect(blocoFiscalNosDados(e)).toBe(false);
      expect(rateioNoPainel(e)).toBe(false);
      expect(abaDoRateio(e, "rateio")).toBeNull();
    }
  });

  it("receber sem o pedido pronto (sem formulário): nenhuma aba", () => {
    expect(rateioNoPainel(estado({ capacidade: true, formulario: false }))).toBe(false);
  });
});

describe("RATEIO-01 · a recusa do rateio abre a aba dele e leva ao controle", () => {
  it("o caminho do rateio → a aba \"Rateio\"; o resto → null (cada um na aba de sempre)", () => {
    const e = estado({ capacidade: true });
    expect(ABA_DO_RATEIO).toBe("rateio");
    expect(ROTULO_DA_ABA_DO_RATEIO).toBe("Rateio");
    for (const c of ["rateio", "rateio.linhas[0].percentual", "itens[0].categoria_financeira_id", "itens.3.gera_estoque"]) expect(abaDoRateio(e, c), c).toBe(ABA_DO_RATEIO);
    for (const c of ["frete", "plano_parcelas", "observacao", "chave_acesso", "itens[0].armazem_id"]) expect(abaDoRateio(e, c), c).toBeNull();
  });

  it("o alvo: a linha do rateio por valor, a linha da classificação do item, ou o \"Rateio\"", () => {
    expect(testIdDoAlvoDoRateio("rateio")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.tipo")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.linhas")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.linhas[0].safra_id")).toBe("compras-rateio-linha-0");
    expect(testIdDoAlvoDoRateio("rateio.linhas.12.percentual")).toBe("compras-rateio-linha-12");
    expect(testIdDoAlvoDoRateio("rateio.linhas[3]")).toBe("compras-rateio-linha-3");
    expect(testIdDoAlvoDoRateio("itens[1].categoria_financeira_id")).toBe("compras-item-classificacao-1");
    expect(testIdDoAlvoDoRateio("itens.0.imobilizado")).toBe("compras-item-classificacao-0");
    for (const c of ["itens[0].armazem_id", "itens[0].quantidade", "categoria_financeira_id", "chave_acesso", "itens"]) expect(testIdDoAlvoDoRateio(c), c).toBeNull();
  });

  it("a recusa do rateio NÃO abre mais os Dados adicionais; a dos fiscais e a dos recolhidos, sim", () => {
    const erros = (m: Record<string, string>) => (c: string) => m[c];
    const base = { recolhidos: ["observacao"], blocoFiscal: true, camposFiscais: FISCAIS };
    expect(erroEscondidoNosDados({ ...base, erro: erros({ rateio: "soma", "itens[0].categoria_financeira_id": "x", "rateio.linhas[0].percentual": "y" }) }),
      "só recusa do rateio: os Dados ficam como estão (a aba abre)").toBe(false);
    expect(erroEscondidoNosDados({ ...base, erro: erros({ chave_acesso: "DV" }) }), "fiscal com erro: abre").toBe(true);
    expect(erroEscondidoNosDados({ ...base, erro: erros({ observacao: "obrigatório" }) }), "recolhido com erro: abre").toBe(true);
    expect(erroEscondidoNosDados({ ...base, blocoFiscal: false, erro: erros({ chave_acesso: "DV" }) }), "sem o bloco fiscal, o fiscal não conta").toBe(false);
    expect(erroEscondidoNosDados({ ...base, erro: erros({}) })).toBe(false);
  });
});

describe("RATEIO-01 · \"Dados adicionais · N campos\"", () => {
  const n = (o: Partial<Parameters<typeof quantidadeDosDadosAdicionais>[0]>) =>
    quantidadeDosDadosAdicionais({ recolhidos: [], localNaGrade: false, fiscais: null, camposFiscais: OITO_FISCAIS, ...o });

  it("compra COM a capacidade, layout do sistema (nada recolhido): 8 — antes 9 (os oito fiscais + o rateio, que saiu)", () => {
    expect(n({ fiscais: "criacao" })).toBe(8);
  });

  it("SEM a capacidade, layout do sistema: 0 — o botão não aparece, antes e depois", () => {
    expect(n({ fiscais: null })).toBe(0);
  });

  it("EDIÇÃO (EDITAR-02), em leitura: 9 como antes — os fiscais e o rateio em leitura continuam nos Dados", () => {
    expect(n({ fiscais: "leitura" })).toBe(9);
  });

  it("recolhidos e o Local de estoque (com a Empresa nos adicionais) somam como antes", () => {
    expect(n({ recolhidos: ["observacao", "empresa_id"], localNaGrade: true, fiscais: "criacao" })).toBe(2 + 1 + 8);
    expect(n({ recolhidos: ["observacao", "empresa_id"], localNaGrade: false, fiscais: null })).toBe(2);
    expect(n({ recolhidos: ["observacao"], localNaGrade: true, fiscais: null }), "o Local só conta com a Empresa recolhida").toBe(1);
  });
});
