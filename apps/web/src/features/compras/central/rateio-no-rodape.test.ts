import { describe, expect, it } from "vitest";
import {
  ABA_DO_RATEIO, CAMINHO_DA_CLASSIFICACAO_DO_ITEM, ROTULO_DA_ABA_DO_RATEIO, abaDoRateio, blocoFiscalNosDados, caminhoDoRateioComErro,
  ehCaminhoDoRateio, erroEscondidoNosDados, fiscalNoPainel, quantidadeDosDadosAdicionais, rateioNoPainel, testIdDoAlvoDoRateio
} from "./rateio-no-rodape";

/**
 * RATEIO-01 — rateio e classificação no painel ("Rateio e classificação"); fiscais na aba Fiscal (fora dos Dados).
 */

/** `CAMPOS_DOS_DADOS_FISCAIS.length` (estado.ts). */
const OITO_FISCAIS = 8;
const FISCAIS = ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto"] as const;
const TOP = { id: "t", codigo: "7001", nome: "Compra", movimento: "Compra" };

const estado = (o: { capacidade: boolean; top?: boolean; formulario?: boolean; rateio?: boolean }) =>
  ({
    mostrarFiscal: o.capacidade,
    mostrarRateio: o.rateio ?? o.capacidade,
    top: o.top === false ? null : TOP,
    mostrarFormulario: o.formulario ?? true
  });

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

describe("RATEIO-01 · onde o rateio e o fiscal moram — nunca nos Dados principais", () => {
  it("os fiscais NÃO ficam mais nos Dados; rateio e fiscal no painel com capacidade + TOP + formulário", () => {
    const e = estado({ capacidade: true });
    expect(blocoFiscalNosDados(e)).toBe(false);
    expect(fiscalNoPainel(e)).toBe(true);
    expect(rateioNoPainel(e)).toBe(true);
  });

  it("o campo único do painel (TOP zerada) não desenha rateio nem fiscal", () => {
    const umCampo = estado({ capacidade: true, top: false });
    expect(blocoFiscalNosDados(umCampo)).toBe(false);
    expect(fiscalNoPainel(umCampo)).toBe(false);
    expect(rateioNoPainel(umCampo)).toBe(false);
  });

  it("SEM mostrarFiscal: nenhuma aba de rateio/fiscal", () => {
    for (const formulario of [true, false]) {
      const e = estado({ capacidade: false, formulario });
      expect(blocoFiscalNosDados(e)).toBe(false);
      expect(rateioNoPainel(e)).toBe(false);
      expect(fiscalNoPainel(e)).toBe(false);
      expect(abaDoRateio(e, "rateio")).toBeNull();
    }
  });

  it("EDIÇÃO aberta com mostrarFiscal: abas no painel (nunca nos Dados)", () => {
    const e = estado({ capacidade: true });
    expect(blocoFiscalNosDados(e)).toBe(false);
    expect(fiscalNoPainel(e)).toBe(true);
    expect(rateioNoPainel(e)).toBe(true);
  });

  it("receber sem o pedido pronto (sem formulário): nenhuma aba", () => {
    expect(rateioNoPainel(estado({ capacidade: true, formulario: false }))).toBe(false);
  });
});

describe("RATEIO-01 · a recusa do rateio abre a aba dele e leva ao controle", () => {
  it("o caminho do rateio → a aba \"Rateio e classificação\"; o resto → null", () => {
    const e = estado({ capacidade: true });
    expect(ABA_DO_RATEIO).toBe("rateio");
    expect(ROTULO_DA_ABA_DO_RATEIO).toBe("Rateio e classificação");
    for (const c of ["rateio", "rateio.linhas[0].percentual", "itens[0].categoria_financeira_id", "itens.3.gera_estoque"]) expect(abaDoRateio(e, c), c).toBe(ABA_DO_RATEIO);
    for (const c of ["frete", "plano_parcelas", "observacao", "chave_acesso", "itens[0].armazem_id", "rateio.linhas[0].safra_id"]) expect(abaDoRateio(e, c), c).toBeNull();
  });

  it("o alvo: a linha do rateio por valor, a linha da classificação do item, ou o \"Rateio\"", () => {
    expect(testIdDoAlvoDoRateio("rateio")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.tipo")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.linhas")).toBe("compras-rateio");
    expect(testIdDoAlvoDoRateio("rateio.linhas[0].safra_id")).toBe("compras-safra");
    expect(testIdDoAlvoDoRateio("rateio.linhas[0].conta_contabil_id")).toBe("compras-rateio-conta");
    expect(testIdDoAlvoDoRateio("rateio.linhas.12.percentual")).toBe("compras-rateio-natureza-linha-12");
    expect(testIdDoAlvoDoRateio("rateio.linhas[3]")).toBe("compras-rateio-natureza-linha-3");
    expect(testIdDoAlvoDoRateio("rateio.linhas[1].categoria_financeira_id")).toBe("compras-rateio-natureza-linha-1");
    expect(testIdDoAlvoDoRateio("rateio.linhas[1].centro_custo_id")).toBe("compras-rateio-centro-linha-1");
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

describe("RATEIO-01 · contagem de campos extras (legado do acordeão)", () => {
  const n = (o: Partial<Parameters<typeof quantidadeDosDadosAdicionais>[0]>) =>
    quantidadeDosDadosAdicionais({ recolhidos: [], localNaGrade: false, fiscais: null, camposFiscais: OITO_FISCAIS, ...o });

  it("criação com fiscais anunciados: 8 (contagem legada; o desenho atual põe fiscais no painel)", () => {
    expect(n({ fiscais: "criacao" })).toBe(8);
  });

  it("SEM a capacidade: 0", () => {
    expect(n({ fiscais: null })).toBe(0);
  });

  it("EDIÇÃO em leitura: 9 — os fiscais e o rateio em leitura", () => {
    expect(n({ fiscais: "leitura" })).toBe(9);
  });
});
