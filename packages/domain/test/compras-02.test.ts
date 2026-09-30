import { describe, it, expect } from "vitest";
import {
  CODIGOS_TIPO_OPERACAO, TABELA_DOCUMENTO_COMPRA, TABELA_DOCUMENTO_VENDA,
  familiaExecutavelEmVendas, familiaTemProximasOperacoes, tabelaComercialDaFamilia, validarDestinoOperacao,
  varianteDeDocumentoCompraDaFamilia, varianteDeDocumentoVendaDaFamilia,
  MSG_ITENS_DO_RECEBIMENTO, pedidoTotalmenteRecebido, recebimentoZeraOPedido, saldoDoItemDoPedido, validarItensDoRecebimento,
  enumLabel, enumOptions,
  type ItemDoPedido, type RecusaDestinoOperacao
} from "../src/index.js";

/** COMPRAS-02 (decisão 268) — o grafo de compras, o saldo do pedido e a conferência de um recebimento. Puro. */

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";
const VENDAS = ["vendas.orcamento", "vendas.pedido", "vendas.venda"] as const;

/**
 * A regra de VENDAS como ela era antes desta fatia, escrita de novo aqui só para servir de régua: para todo
 * par em que nenhuma ponta é documento de compra, a função nova tem de responder EXATAMENTE isto.
 */
function regraAnteriorDeVendas(origem: string, destino: string): RecusaDestinoOperacao[] {
  const r: RecusaDestinoOperacao[] = [];
  if (!familiaExecutavelEmVendas(origem)) r.push({ motivo: "origem_nao_executavel", codigoBase: origem });
  if (!familiaExecutavelEmVendas(destino)) r.push({ motivo: "destino_nao_executavel", codigoBase: destino });
  if (origem === destino) r.push({ motivo: "mesma_familia", codigoBase: destino });
  return r;
}

describe("CP-D1 o grafo de compras (validarDestinoOperacao)", () => {
  it("espécie da família pelo registry, ida e volta; fail-closed fora da tabela de compra", () => {
    expect(varianteDeDocumentoCompraDaFamilia(PEDIDO)).toBe("pedido");
    expect(varianteDeDocumentoCompraDaFamilia(COMPRA)).toBe("compra");
    for (const c of ["compras.solicitacao", "vendas.pedido", "estoque.baixa", "nao.existe", "", null, undefined]) {
      expect(varianteDeDocumentoCompraDaFamilia(c), String(c)).toBeUndefined();
    }
  });

  it("tabela comercial: só as duas tabelas de documento comercial", () => {
    for (const v of VENDAS) expect(tabelaComercialDaFamilia(v)).toBe(TABELA_DOCUMENTO_VENDA);
    expect(tabelaComercialDaFamilia(PEDIDO)).toBe(TABELA_DOCUMENTO_COMPRA);
    expect(tabelaComercialDaFamilia(COMPRA)).toBe(TABELA_DOCUMENTO_COMPRA);
    for (const c of ["compras.solicitacao", "estoque.baixa", "financeiro.conta_a_pagar", "nao.existe", "", null]) {
      expect(tabelaComercialDaFamilia(c), String(c)).toBeUndefined();
    }
  });

  it("pedido de compra → compra: ACEITO", () => {
    expect(validarDestinoOperacao(PEDIDO, COMPRA)).toEqual([]);
  });

  it("compra → pedido de compra: RECUSADO (a compra não converte, o pedido não nasce de conversão)", () => {
    expect(validarDestinoOperacao(COMPRA, PEDIDO)).toEqual([{ motivo: "aresta_nao_executavel", origem: COMPRA, destino: PEDIDO }]);
  });

  it("mesma família em compras é cópia, não conversão", () => {
    expect(validarDestinoOperacao(PEDIDO, PEDIDO)).toEqual([{ motivo: "mesma_familia", codigoBase: PEDIDO }]);
    expect(validarDestinoOperacao(COMPRA, COMPRA)).toEqual([{ motivo: "mesma_familia", codigoBase: COMPRA }]);
  });

  it("compra × vendas: RECUSADO nos dois sentidos, para todo par", () => {
    for (const c of [PEDIDO, COMPRA]) {
      for (const v of VENDAS) {
        expect(validarDestinoOperacao(c, v), `${c} → ${v}`).toEqual([{ motivo: "tabelas_diferentes" }]);
        expect(validarDestinoOperacao(v, c), `${v} → ${c}`).toEqual([{ motivo: "tabelas_diferentes" }]);
      }
    }
  });

  it("solicitação e famílias de fora das tabelas comerciais continuam não executáveis", () => {
    expect(validarDestinoOperacao("compras.solicitacao", PEDIDO)).toEqual([{ motivo: "origem_nao_executavel", codigoBase: "compras.solicitacao" }]);
    expect(validarDestinoOperacao(PEDIDO, "estoque.baixa")).toEqual([{ motivo: "destino_nao_executavel", codigoBase: "estoque.baixa" }]);
  });

  it("em todo o registry, a única aresta de compras aceita é pedido → compra", () => {
    const aceitasEmCompras: string[] = [];
    for (const o of CODIGOS_TIPO_OPERACAO) for (const d of CODIGOS_TIPO_OPERACAO) {
      if (validarDestinoOperacao(o, d).length === 0 && (tabelaComercialDaFamilia(o) === TABELA_DOCUMENTO_COMPRA || tabelaComercialDaFamilia(d) === TABELA_DOCUMENTO_COMPRA)) {
        aceitasEmCompras.push(`${o} → ${d}`);
      }
    }
    expect(aceitasEmCompras).toEqual([`${PEDIDO} → ${COMPRA}`]);
  });
});

describe("CP-D2 vendas intactas", () => {
  it("todo par sem documento de compra responde EXATAMENTE a regra anterior (registry × registry, e desconhecidos)", () => {
    const codigos = [...CODIGOS_TIPO_OPERACAO, "nao.existe", "vendas.devolucao"];
    let conferidos = 0;
    for (const o of codigos) for (const d of codigos) {
      if (varianteDeDocumentoCompraDaFamilia(o) || varianteDeDocumentoCompraDaFamilia(d)) continue;
      expect(validarDestinoOperacao(o, d), `${o} → ${d}`).toEqual(regraAnteriorDeVendas(o, d));
      conferidos++;
    }
    // Verde que não prova nada é reprovação: o laço tem de ter conferido o registry inteiro menos as compras.
    expect(conferidos).toBe((codigos.length - 2) ** 2);
  });

  it("as seis arestas de vendas continuam aceitas, sem ordem obrigatória", () => {
    const aceitas: string[] = [];
    for (const o of VENDAS) for (const d of VENDAS) if (validarDestinoOperacao(o, d).length === 0) aceitas.push(`${o} → ${d}`);
    expect(aceitas).toHaveLength(6);
    expect(aceitas).toContain("vendas.orcamento → vendas.venda");
    expect(aceitas).toContain("vendas.venda → vendas.orcamento");
  });

  it("a variante de venda não mudou", () => {
    expect(VENDAS.map((v) => varianteDeDocumentoVendaDaFamilia(v))).toEqual(["budget", "order", "sale"]);
    expect(varianteDeDocumentoVendaDaFamilia(PEDIDO)).toBeUndefined();
    expect(familiaExecutavelEmVendas(COMPRA)).toBe(false);
  });
});

describe("CP-D3 quem tem próximas operações (a porta de /destinos-possiveis)", () => {
  it("as três de vendas (como antes) e o pedido de compra; a compra e o resto, não", () => {
    for (const v of VENDAS) expect(familiaTemProximasOperacoes(v), v).toBe(true);
    expect(familiaTemProximasOperacoes(PEDIDO)).toBe(true);
    expect(familiaTemProximasOperacoes(COMPRA)).toBe(false);
    for (const c of ["compras.solicitacao", "estoque.baixa", "nao.existe", "", null, undefined]) {
      expect(familiaTemProximasOperacoes(c), String(c)).toBe(false);
    }
  });

  it("no registry inteiro, só muda o pedido de compra em relação à porta anterior (só vendas)", () => {
    const mudaram = CODIGOS_TIPO_OPERACAO.filter((c) => familiaTemProximasOperacoes(c) !== (varianteDeDocumentoVendaDaFamilia(c) !== undefined));
    expect(mudaram).toEqual([PEDIDO]);
  });
});

const item = (id: string, quantidade: string, recebido = "0"): ItemDoPedido => ({ id, produtoId: `p-${id}`, quantidade, recebido });
/** a: 10 com 4 recebidos (saldo 6); b: 2 sem nada (saldo 2); c: todo recebido (saldo 0). */
const PEDIDO_BASE = [item("a", "10", "4"), item("b", "2"), item("c", "5", "5")];

describe("CP-D4 saldo do item do pedido", () => {
  it("saldo = quantidade − recebido, 4 casas, nunca negativo", () => {
    expect(saldoDoItemDoPedido({ quantidade: "10", recebido: "4" })).toBe("6.0000");
    expect(saldoDoItemDoPedido({ quantidade: "10", recebido: "12" })).toBe("0.0000");
    expect(saldoDoItemDoPedido({ quantidade: "2.5", recebido: "0.1234" })).toBe("2.3766");
    expect(saldoDoItemDoPedido({ quantidade: "3", recebido: "0" })).toBe("3.0000");
  });

  it("totalmente recebido: todos os saldos zerados; pedido sem item nunca é", () => {
    expect(pedidoTotalmenteRecebido(PEDIDO_BASE)).toBe(false);
    expect(pedidoTotalmenteRecebido([item("a", "10", "10"), item("b", "2", "2.0000")])).toBe(true);
    expect(pedidoTotalmenteRecebido([])).toBe(false);
  });

  it("o recebimento zera o pedido? — o recebido de agora mais o que está entrando", () => {
    const p = [item("a", "10", "4"), item("b", "2", "2")];
    expect(recebimentoZeraOPedido(p, [{ itemOrigemId: "a", quantidade: "6.0000" }])).toBe(true);
    expect(recebimentoZeraOPedido(p, [{ itemOrigemId: "a", quantidade: "5.9999" }])).toBe(false);
    expect(recebimentoZeraOPedido(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "6" }])).toBe(false);
  });
});

describe("CP-D5 receber INTEIRO (aresta sem \"Em partes\")", () => {
  const inteiro = { emPartes: false };

  it("todos os itens com saldo, cada um com o saldo: aceito, normalizado, NA ORDEM DO CORPO", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "b", quantidade: "2" }, { itemOrigemId: "a", quantidade: "6.0" }], inteiro))
      .toEqual({ ok: true, itens: [{ itemOrigemId: "b", quantidade: "2.0000" }, { itemOrigemId: "a", quantidade: "6.0000" }] });
  });

  it("faltou um item com saldo → recebimento_incompleto, sem posição (fala do recebimento inteiro)", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "6" }], inteiro))
      .toEqual({ ok: false, recusas: [{ motivo: "recebimento_incompleto", itemOrigemId: "b", saldo: "2.0000" }] });
  });

  it("quantidade menor que o saldo → recebimento_incompleto na linha", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "5" }, { itemOrigemId: "b", quantidade: "2" }], inteiro))
      .toEqual({ ok: false, recusas: [{ motivo: "recebimento_incompleto", posicao: 0, itemOrigemId: "a", saldo: "6.0000" }] });
  });

  it("item já todo recebido não entra, nem é exigido", () => {
    const r = validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "6" }, { itemOrigemId: "b", quantidade: "2" }, { itemOrigemId: "c", quantidade: "1" }], inteiro);
    expect(r).toEqual({ ok: false, recusas: [{ motivo: "item_sem_saldo", posicao: 2, itemOrigemId: "c" }] });
  });

  it("linha já recusada por outra razão não ganha também a recusa de incompleto", () => {
    const r = validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "7" }, { itemOrigemId: "b", quantidade: "2" }], inteiro);
    expect(r).toEqual({ ok: false, recusas: [{ motivo: "acima_do_saldo", posicao: 0, itemOrigemId: "a", saldo: "6.0000" }] });
  });
});

describe("CP-D6 receber EM PARTES", () => {
  const partes = { emPartes: true };

  it("qualquer subconjunto, quantidade > 0 e ≤ saldo", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "4" }], partes))
      .toEqual({ ok: true, itens: [{ itemOrigemId: "a", quantidade: "4.0000" }] });
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "b", quantidade: "0.5" }, { itemOrigemId: "a", quantidade: "6" }], partes))
      .toEqual({ ok: true, itens: [{ itemOrigemId: "b", quantidade: "0.5000" }, { itemOrigemId: "a", quantidade: "6.0000" }] });
  });

  it("acima do saldo → 422 na linha, com o saldo", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "6.0001" }], partes))
      .toEqual({ ok: false, recusas: [{ motivo: "acima_do_saldo", posicao: 0, itemOrigemId: "a", saldo: "6.0000" }] });
  });

  it("item repetido → recusado na segunda linha", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: "1" }, { itemOrigemId: "a", quantidade: "1" }], partes))
      .toEqual({ ok: false, recusas: [{ motivo: "item_repetido", posicao: 1, itemOrigemId: "a" }] });
  });

  it("item de fora do pedido, quantidade inválida e item sem saldo, todos de uma vez", () => {
    const r = validarItensDoRecebimento(PEDIDO_BASE, [
      { itemOrigemId: "x", quantidade: "1" }, { itemOrigemId: "a", quantidade: "0" }, { itemOrigemId: "b", quantidade: "1.12345" }, { itemOrigemId: "c", quantidade: "1" },
    ], partes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toEqual([
      { motivo: "item_desconhecido", posicao: 0, itemOrigemId: "x" },
      { motivo: "quantidade_invalida", posicao: 1, itemOrigemId: "a" },
      { motivo: "quantidade_invalida", posicao: 2, itemOrigemId: "b" },
      { motivo: "item_sem_saldo", posicao: 3, itemOrigemId: "c" },
    ]);
  });

  it("quantidade: negativo, vazio, texto e expoente são inválidos", () => {
    for (const q of ["-1", "", "abc", "1e3", " 1", "1,5"]) {
      const r = validarItensDoRecebimento(PEDIDO_BASE, [{ itemOrigemId: "a", quantidade: q }], partes);
      expect(r.ok ? [] : r.recusas.map((x) => x.motivo), JSON.stringify(q)).toEqual(["quantidade_invalida"]);
    }
  });

  it("sem itens → sem_itens, nas duas arestas", () => {
    expect(validarItensDoRecebimento(PEDIDO_BASE, [], partes)).toEqual({ ok: false, recusas: [{ motivo: "sem_itens" }] });
    expect(validarItensDoRecebimento(PEDIDO_BASE, [], { emPartes: false })).toEqual({ ok: false, recusas: [{ motivo: "sem_itens" }] });
  });
});

describe("CP-D7 textos e rótulo", () => {
  it("toda recusa tem texto de COMPRA, nenhum de venda", () => {
    const motivos = ["sem_itens", "item_desconhecido", "item_repetido", "quantidade_invalida", "item_sem_saldo", "acima_do_saldo", "recebimento_incompleto"] as const;
    expect(Object.keys(MSG_ITENS_DO_RECEBIMENTO).sort()).toEqual([...motivos].sort());
    for (const m of motivos) {
      expect(MSG_ITENS_DO_RECEBIMENTO[m].length, m).toBeGreaterThan(10);
      expect(MSG_ITENS_DO_RECEBIMENTO[m], m).not.toMatch(/venda|orçamento|fatur/i);
    }
    expect(MSG_ITENS_DO_RECEBIMENTO.recebimento_incompleto)
      .toBe("Esta operação recebe o pedido inteiro: informe todos os itens com saldo, cada um com a quantidade do saldo.");
    expect(MSG_ITENS_DO_RECEBIMENTO.item_desconhecido).toMatch(/pedido de compra/);
  });

  it("situação \"convertido\" do pedido tem rótulo e entra no filtro", () => {
    expect(enumLabel("situacao_documento_compra", "convertido")).toBe("Convertido");
    expect(enumOptions("situacao_documento_compra").map((o) => o.value)).toEqual(["aberto", "confirmado", "convertido", "cancelado"]);
  });
});
