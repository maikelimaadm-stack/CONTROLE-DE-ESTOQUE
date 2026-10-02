import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ptBR } from "@erp/plataforma";
import {
  ESPECIES_DOCUMENTO_ESTOQUE,
  ESPECIES_MOVIMENTACAO_INTERNA,
  EXIGENCIAS_GERAIS_ESTOQUE_TOP,
  EXIGENCIAS_GERAIS_TOP,
  LIMITE_CUSTO_ESTOQUE,
  LIMITE_QUANTIDADE_ESTOQUE,
  MATRIZ_EXECUCAO_TOP,
  MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS,
  MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS_ESTOQUE,
  MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP,
  MOVIMENTOS_DA_ESPECIE_ESTOQUE,
  PERMISSION_RESOURCES,
  RECURSO_DA_ESPECIE_ESTOQUE,
  ROTULO_DA_ESPECIE_ESTOQUE,
  SEGMENTO_DA_ESPECIE_ESTOQUE,
  SITUACOES_DOCUMENTO_ESTOQUE,
  TABELA_DOCUMENTO_ESTOQUE,
  TIPOS_OPERACAO,
  camposExigidosTop,
  clienteEmAtrasoValeParaFamiliaTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  conferirNumeroEstoque,
  ehFamiliaDeDocumentoEstoque,
  entidadeIdGlobal,
  enumLabel,
  escopoDoRecurso,
  especieDoSegmentoEstoque,
  exigenciasGeraisDaFamiliaTop,
  exigenciasGeraisFaltando,
  familiaAceitaExecucaoConfiguradaTop,
  familiaOperacionalDeDocumentoEstoque,
  moduloDaPermissao,
  recusasClienteEmAtrasoDaFamiliaTop,
  recusasFiscaisDaFamiliaTop,
  resolverPoliticaEfetivaDaCompra,
  resolverRegistroGlobal,
  resolverTipoOperacao,
  tabelaComercialDaFamilia,
  tipoOperacao,
  validarExecucaoTop,
  validarRegistroIdGlobal,
  validarRegistroTipoOperacao,
  type ConfiguracaoTipoOperacaoV2,
  type EspecieEstoqueDaCentral,
  type ModoExecucaoTop,
} from "../src/index.js";

/** ESTOQUE-01 (decisão 274) — o domínio do documento de estoque. */

const FAMILIAS = ESPECIES_DOCUMENTO_ESTOQUE.map((e) => familiaOperacionalDeDocumentoEstoque(e)!);

/** As oito famílias de estoque que já existiam — ficam como estão, presas às tabelas antigas. */
const FAMILIAS_ANTIGAS: readonly [string, string, string | undefined][] = [
  ["estoque.entrada_manual", "erp.input_entries", undefined],
  ["estoque.documento_fiscal", "erp.invoices", undefined],
  ["estoque.requisicao", "erp.requisitions", undefined],
  ["estoque.baixa", "erp.stock_writeoffs", undefined],
  ["estoque.devolucao", "erp.devolutions", undefined],
  ["estoque.transferencia_entre_armazens", "erp.warehouse_transfers", "warehouse"],
  ["estoque.transferencia_entre_empresas", "erp.warehouse_transfers", "farm"],
  ["estoque.producao_de_racao", "erp.feed_batches", undefined],
];

function v2(execucao: { estoque: ModoExecucaoTop; financeiro: ModoExecucaoTop }, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}): ConfiguracaoTipoOperacaoV2 {
  const c = configuracaoNeutraTopV2();
  c.execucao = { ...execucao };
  ajuste(c);
  return c;
}

describe("ES-D1 as quatro famílias do documento de estoque no registry", () => {
  it("variantes de erp.documentos_estoque por especie, módulo estoque, rótulo pt-BR", () => {
    expect(TABELA_DOCUMENTO_ESTOQUE).toBe("erp.documentos_estoque");
    expect(ESPECIES_DOCUMENTO_ESTOQUE).toEqual(["entrada", "saida", "transferencia", "ajuste"]);
    expect(FAMILIAS).toEqual(["estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste"]);
    const rotulos: Record<EspecieEstoqueDaCentral, string> = {
      entrada: "Entrada de estoque", saida: "Saída de estoque", transferencia: "Transferência de estoque", ajuste: "Ajuste de estoque (inventário)",
    };
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
      const t = tipoOperacao(`estoque.${especie}`)!;
      expect(t.modulo).toBe("estoque");
      expect(t.origem).toEqual({ tabela: "erp.documentos_estoque", discriminador: "especie", valor: especie });
      expect(ptBR.mensagens[t.chaveI18n]).toBe(rotulos[especie]);
      expect(resolverTipoOperacao("erp.documentos_estoque", especie)?.codigo).toBe(`estoque.${especie}`);
    }
    expect(validarRegistroTipoOperacao()).toEqual([]);
  });

  it("as oito famílias antigas de estoque ficam como estão", () => {
    for (const [codigo, tabela, valor] of FAMILIAS_ANTIGAS) {
      const t = tipoOperacao(codigo)!;
      expect(t.origem.tabela, codigo).toBe(tabela);
      expect(t.origem.valor, codigo).toBe(valor);
      expect(ehFamiliaDeDocumentoEstoque(codigo), codigo).toBe(false);
    }
    // + as quatro do ESTOQUE-01 e as três da movimentação interna (OPERACOES-01 F5a, decisão 282).
    expect(TIPOS_OPERACAO.filter((t) => t.modulo === "estoque")).toHaveLength(FAMILIAS_ANTIGAS.length + 4 + 3);
  });

  it("espécie desconhecida, vazia, de outra tabela ou herdada do protótipo não tem família (fail-closed)", () => {
    for (const x of ["", "Entrada", "entradas", "compra", "sale", "constructor", "__proto__", "toString"]) {
      expect(familiaOperacionalDeDocumentoEstoque(x), x).toBeUndefined();
    }
  });

  it("ehFamiliaDeDocumentoEstoque: só as quatro novas", () => {
    for (const f of FAMILIAS) expect(ehFamiliaDeDocumentoEstoque(f), f).toBe(true);
    for (const f of ["", "estoque", "compras.compra", "vendas.venda", "estoque.inexistente", "constructor"]) expect(ehFamiliaDeDocumentoEstoque(f), f).toBe(false);
  });

  it("segmentos, recursos, rótulos e movimentos por espécie", () => {
    expect(SEGMENTO_DA_ESPECIE_ESTOQUE).toEqual({
      entrada: "entradas", saida: "saidas", transferencia: "transferencias", ajuste: "ajustes",
      requisicao: "requisicoes", consumo: "consumos", devolucao_consumo: "devolucoes-consumo",
    });
    for (const e of ESPECIES_DOCUMENTO_ESTOQUE) expect(especieDoSegmentoEstoque(SEGMENTO_DA_ESPECIE_ESTOQUE[e])).toBe(e);
    for (const s of ["", "entrada", "Entradas", "constructor", "__proto__", "documentos"]) expect(especieDoSegmentoEstoque(s), s).toBeUndefined();
    expect(RECURSO_DA_ESPECIE_ESTOQUE).toEqual({
      entrada: "entradas_estoque", saida: "saidas_estoque", transferencia: "transferencias_estoque", ajuste: "ajustes_estoque",
      requisicao: "requisicoes_estoque", consumo: "consumos_estoque", devolucao_consumo: "devolucoes_consumo_estoque",
    });
    expect(ROTULO_DA_ESPECIE_ESTOQUE).toEqual({
      entrada: "Entrada", saida: "Saída", transferencia: "Transferência", ajuste: "Ajuste",
      requisicao: "Requisição", consumo: "Consumo", devolucao_consumo: "Devolução de consumo",
    });
    for (const e of ESPECIES_DOCUMENTO_ESTOQUE) expect(enumLabel("especie_documento_estoque", e)).toBe(ROTULO_DA_ESPECIE_ESTOQUE[e]);
    expect(SITUACOES_DOCUMENTO_ESTOQUE).toEqual(["aberto", "confirmado", "cancelado"]);
    expect(SITUACOES_DOCUMENTO_ESTOQUE.map((s) => enumLabel("situacao_documento_estoque", s))).toEqual(["Aberto", "Confirmado", "Cancelado"]);
    expect(enumLabel("source_type", "documentos_estoque")).toBe("Documento de estoque");
    expect(MOVIMENTOS_DA_ESPECIE_ESTOQUE).toEqual({
      entrada: ["entry"], saida: ["writeoff"], transferencia: ["transfer_out", "transfer_in"], ajuste: ["correction_in", "correction_out"],
      requisicao: [], consumo: ["requisition"], devolucao_consumo: ["devolution"],
    });
  });

  it("sem grafo de conversão: não é documento comercial", () => {
    for (const f of FAMILIAS) expect(tabelaComercialDaFamilia(f), f).toBeUndefined();
  });
});

describe("ES-D2 paridade com o CHECK de espécie da 0040", () => {
  const caminho = fileURLToPath(new URL("../../../supabase/migrations/0040_documento_de_estoque.sql", import.meta.url));

  it("chk_documentos_estoque_especie lista exatamente as espécies do domínio e as variantes do registry", () => {
    expect(existsSync(caminho), "a migration 0040 precisa existir").toBe(true);
    const sql = readFileSync(caminho, "utf8");
    const m = /constraint\s+chk_documentos_estoque_especie\s+check\s*\(\s*especie\s+in\s*\(([^)]*)\)\s*\)/i.exec(sql);
    expect(m, "chk_documentos_estoque_especie não encontrado na 0040").not.toBeNull();
    const doBanco = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect(doBanco.length).toBe(4);
    expect([...doBanco].sort()).toEqual([...ESPECIES_DOCUMENTO_ESTOQUE].sort());
    const doRegistry = TIPOS_OPERACAO.filter((t) => t.origem.tabela === TABELA_DOCUMENTO_ESTOQUE).map((t) => t.origem.valor!);
    // OPERACOES-01 F5a (decisão 282): o registry tem também as três da movimentação interna, que a 0043 acrescenta ao
    // CHECK (a paridade com a 0043 é de `f5a-movimentacao-interna.test.ts`).
    expect([...doRegistry].sort()).toEqual([...doBanco, ...ESPECIES_MOVIMENTACAO_INTERNA].sort());
  });
});

describe("ES-D3 exigências gerais do documento de estoque", () => {
  const c = configuracaoNeutraTopV3();
  c.geral.exigeParceiro = true; c.geral.exigeCentroResultado = true; c.geral.exigeObservacao = true; c.geral.exigeTransportadora = true;

  it("mapa próprio: só a observação, no campo do documento", () => {
    expect(EXIGENCIAS_GERAIS_ESTOQUE_TOP.map((e) => [e.chave, e.caminho, e.rotulo])).toEqual([["exigeObservacao", "observacao", "Observação"]]);
    for (const f of FAMILIAS) expect(exigenciasGeraisDaFamiliaTop(f), f).toBe(EXIGENCIAS_GERAIS_ESTOQUE_TOP);
    // as famílias antigas de estoque continuam no mapa padrão, como sempre estiveram
    expect(exigenciasGeraisDaFamiliaTop("estoque.baixa")).toBe(EXIGENCIAS_GERAIS_TOP);
  });

  it("parceiro, centro de resultado e transportadora não se aplicam; observação vazia ou só espaço falta", () => {
    expect(camposExigidosTop(c, EXIGENCIAS_GERAIS_ESTOQUE_TOP)).toEqual(["observacao"]);
    expect(exigenciasGeraisFaltando(c, {}, EXIGENCIAS_GERAIS_ESTOQUE_TOP)).toEqual([{ caminho: "observacao", rotulo: "Observação" }]);
    expect(exigenciasGeraisFaltando(c, { observacao: "   " }, EXIGENCIAS_GERAIS_ESTOQUE_TOP)).toEqual([{ caminho: "observacao", rotulo: "Observação" }]);
    expect(exigenciasGeraisFaltando(c, { observacao: "inventário de setembro" }, EXIGENCIAS_GERAIS_ESTOQUE_TOP)).toEqual([]);
  });

  it("formato 1/2: nada a cobrar", () => {
    expect(exigenciasGeraisFaltando(configuracaoNeutraTopV2(), {}, EXIGENCIAS_GERAIS_ESTOQUE_TOP)).toEqual([]);
  });

  it("cliente em atraso não vale: recusa ≠ não valida com a mensagem do estoque; compras e venda inalteradas", () => {
    for (const f of FAMILIAS) expect(clienteEmAtrasoValeParaFamiliaTop(f), f).toBe(false);
    expect(clienteEmAtrasoValeParaFamiliaTop("estoque.baixa")).toBe(true);
    const x = configuracaoNeutraTopV3();
    for (const f of FAMILIAS) expect(recusasClienteEmAtrasoDaFamiliaTop(x, f)).toEqual([]);
    x.financeiro.clienteEmAtraso = "avisa";
    for (const f of FAMILIAS) {
      expect(recusasClienteEmAtrasoDaFamiliaTop(x, f)).toEqual([{ motivo: "valor_invalido", caminho: "financeiro.clienteEmAtraso", mensagem: MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS_ESTOQUE }]);
    }
    expect(recusasClienteEmAtrasoDaFamiliaTop(x, "compras.compra")[0]?.mensagem).toBe(MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS);
    expect(recusasClienteEmAtrasoDaFamiliaTop(x, "vendas.venda")).toEqual([]);
  });

  it("CFOP: o estoque não impõe sentido", () => {
    const x = configuracaoNeutraTopV3();
    x.fiscal.cfopDentroEstado = "1102";
    for (const f of FAMILIAS) expect(recusasFiscaisDaFamiliaTop(x, f)).toEqual([]);
  });
});

describe("ES-D4 execução configurada continua recusada para as famílias novas", () => {
  it("fora da MATRIZ_EXECUCAO_TOP", () => {
    expect(MATRIZ_EXECUCAO_TOP.map((m) => m.familia)).toEqual(["vendas.venda", "compras.compra"]);
    for (const f of FAMILIAS) expect(familiaAceitaExecucaoConfiguradaTop(f), f).toBe(false);
  });

  it("validarExecucaoTop recusa com a mensagem de hoje, efeito por efeito", () => {
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => { x.estoque.atualizacao = "entrada"; });
    for (const f of FAMILIAS) {
      expect(validarExecucaoTop(f, c)).toEqual([
        { motivo: "familia_sem_execucao_configurada", caminho: "execucao.estoque", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP },
        { motivo: "familia_sem_execucao_configurada", caminho: "execucao.financeiro", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP },
      ]);
    }
    expect(MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP).toBe("Execução configurada ainda não disponível para este movimento.");
    // legado nos dois efeitos: nada a recusar (a TOP só classifica e dá as exigências gerais)
    for (const f of FAMILIAS) expect(validarExecucaoTop(f, v2({ estoque: "legado", financeiro: "legado" }))).toEqual([]);
  });

  it("nem o resolvedor da compra executa uma família de estoque", () => {
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "entrada"; });
    for (const f of FAMILIAS) {
      expect(resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: f, configuracao: c }, execucaoConfiguradaHabilitada: true }))
        .toEqual({ ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "familia_sem_execucao_configurada", caminho: "execucao.estoque", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP }] });
    }
  });
});

describe("ES-D5 conferirNumeroEstoque — texto canônico, sem arredondar", () => {
  const q = { ...LIMITE_QUANTIDADE_ESTOQUE, minimo: "positivo" as const };
  const contada = { ...LIMITE_QUANTIDADE_ESTOQUE, minimo: "naoNegativo" as const };
  const custo = { ...LIMITE_CUSTO_ESTOQUE, minimo: "naoNegativo" as const };

  it("limites das colunas: numeric(18,4) e numeric(18,6)", () => {
    expect(LIMITE_QUANTIDADE_ESTOQUE).toEqual({ casas: 4, inteiros: 14 });
    expect(LIMITE_CUSTO_ESTOQUE).toEqual({ casas: 6, inteiros: 12 });
  });

  it("aceita a forma canônica e devolve o MESMO texto", () => {
    for (const v of ["1", "10", "0.5", "1.2345", "12345678901234", "12345678901234.1234", "1.50", "1.0000"]) expect(conferirNumeroEstoque(v, q), v).toEqual({ ok: true, valor: v });
    for (const v of ["0", "0.0000", "0.1"]) expect(conferirNumeroEstoque(v, contada), v).toEqual({ ok: true, valor: v });
    for (const v of ["0", "123456789012.123456", "0.000001"]) expect(conferirNumeroEstoque(v, custo), v).toEqual({ ok: true, valor: v });
  });

  it("casas a mais → recusa, nunca arredonda", () => {
    expect(conferirNumeroEstoque("1.23456", q)).toEqual({ ok: false, mensagem: "Use no máximo 4 casas decimais." });
    expect(conferirNumeroEstoque("0.00001", contada).ok).toBe(false);
    expect(conferirNumeroEstoque("1.1234567", custo)).toEqual({ ok: false, mensagem: "Use no máximo 6 casas decimais." });
  });

  it("inteiros a mais → recusa (14 na quantidade, 12 no custo)", () => {
    expect(conferirNumeroEstoque("123456789012345", q)).toEqual({ ok: false, mensagem: "O número passa do limite de 14 dígitos inteiros." });
    expect(conferirNumeroEstoque("1234567890123", custo)).toEqual({ ok: false, mensagem: "O número passa do limite de 12 dígitos inteiros." });
  });

  it("número JSON (não texto) → recusa, mesmo inteiro e válido", () => {
    for (const v of [1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10n]) expect(conferirNumeroEstoque(v, q)).toEqual({ ok: false, mensagem: "Informe o número como texto." });
  });

  it("ausente, nulo, vazio ou de outro tipo → recusa", () => {
    for (const v of [undefined, null, "", true, {}, [], ["1"]]) expect(conferirNumeroEstoque(v, q).ok, String(v)).toBe(false);
  });

  it("sinal, vírgula, expoente, espaço, zero à esquerda e ponto solto → recusa", () => {
    expect(conferirNumeroEstoque("-1", contada)).toEqual({ ok: false, mensagem: "O número não pode ser negativo." });
    expect(conferirNumeroEstoque("-0", contada).ok).toBe(false);
    expect(conferirNumeroEstoque("1,5", q)).toEqual({ ok: false, mensagem: "Use ponto como separador decimal." });
    for (const v of ["+1", "1e3", "1E3", " 1", "1 ", "01", "00.5", ".5", "1.", "1.2.3", "0x10", "Infinity", "NaN", "１"]) {
      expect(conferirNumeroEstoque(v, q).ok, v).toBe(false);
    }
  });

  it("mínimo: positivo recusa zero em qualquer grafia; não negativo aceita", () => {
    for (const v of ["0", "0.0", "0.0000"]) {
      expect(conferirNumeroEstoque(v, q), v).toEqual({ ok: false, mensagem: "Informe um número maior que zero." });
      expect(conferirNumeroEstoque(v, contada).ok, v).toBe(true);
    }
  });
});

describe("ES-D6 permissões e ID Global por espécie", () => {
  it("quatro recursos em Operacional > Estoque, só view/create/edit/approve, módulo de escopo estoque", () => {
    for (const recurso of Object.values(RECURSO_DA_ESPECIE_ESTOQUE)) {
      const r = PERMISSION_RESOURCES.find((x) => x.key === recurso)!;
      expect(r.module, recurso).toBe("Operacional > Estoque");
      // `approve` (TOP-CONFIG-08): a aprovação da TOP no formato 4; continua sem `delete` (a 0040 revoga DELETE).
      expect(r.actions, recurso).toEqual(["view", "create", "edit", "approve"]);
      for (const acao of r.actions) expect(moduloDaPermissao(`${recurso}.${acao}`), `${recurso}.${acao}`).toBe("estoque");
      expect(escopoDoRecurso(recurso)).toEqual({ tipo: "empresa", modulo: "estoque" });
    }
    expect(moduloDaPermissao("entradas_estoque.delete")).toBe("estoque");
    expect(PERMISSION_RESOURCES.map((r) => r.label)).toEqual(expect.arrayContaining(["Entradas de Estoque", "Saídas de Estoque", "Transferências de Estoque", "Ajustes de Estoque"]));
  });

  it("documentos_estoque: módulo estoque, sem exclusão lógica, rota e permissão por espécie", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
    const e = entidadeIdGlobal("documentos_estoque")!;
    expect(e.tabela).toBe("erp.documentos_estoque");
    expect(e.modulo).toBe("estoque");
    expect(e.colunaEmpresa).toBe("empresa_id");
    expect(e.exclusaoLogica).toBe(false);
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
      expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie }))
        .toEqual({ rota: `/estoque/movimentacoes/${SEGMENTO_DA_ESPECIE_ESTOQUE[especie]}/u1`, permissao: `${RECURSO_DA_ESPECIE_ESTOQUE[especie]}.view` });
    }
    for (const especie of ["", "outra", "Entrada", "entradas"]) expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie }), especie).toBeNull();
    expect(resolverRegistroGlobal("documentos_estoque", "u1", {})).toBeNull();
  });
});
