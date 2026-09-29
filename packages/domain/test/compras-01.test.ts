import { describe, it, expect } from "vitest";
import {
  EXIGENCIAS_GERAIS_COMPRA_TOP,
  EXIGENCIAS_GERAIS_TOP,
  MATRIZ_EXECUCAO_TOP,
  MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP,
  PERMISSION_RESOURCES,
  TABELA_DOCUMENTO_COMPRA,
  camposExigidosTop,
  clienteEmAtrasoValeParaFamiliaTop,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  enumLabel,
  entidadeIdGlobal,
  exigenciasFaltandoPorCampos,
  exigenciasGeraisDaFamiliaTop,
  exigenciasGeraisFaltando,
  familiaOperacionalDeDocumentoCompra,
  familiaOperacionalDeDocumentoVenda,
  moduloDaPermissao,
  ratearCustoDeEntrada,
  recusasClienteEmAtrasoDaFamiliaTop,
  resolverPoliticaEfetivaDaCompra,
  resolverRegistroGlobal,
  resumoDaPoliticaDaCompra,
  tipoOperacao,
  validarExecucaoTop,
  validarRegistroIdGlobal,
  validarRegistroTipoOperacao,
  type ConfiguracaoTipoOperacaoV2,
  type ModoExecucaoTop,
} from "../src/index.js";

/** COMPRAS-01 (decisão 267) — o domínio do documento de compra. */

const COMPRA = familiaOperacionalDeDocumentoCompra("compra")!;
const PEDIDO = familiaOperacionalDeDocumentoCompra("pedido")!;
const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;

function v2(execucao: { estoque: ModoExecucaoTop; financeiro: ModoExecucaoTop }, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}): ConfiguracaoTipoOperacaoV2 {
  const c = configuracaoNeutraTopV2();
  c.execucao = { ...execucao };
  ajuste(c);
  return c;
}

describe("CO-D1 famílias do documento de compra", () => {
  it("pedido e compra são variantes de erp.documentos_compra por especie, módulo compras, com rótulo", () => {
    expect(TABELA_DOCUMENTO_COMPRA).toBe("erp.documentos_compra");
    expect(PEDIDO).toBe("compras.pedido");
    expect(COMPRA).toBe("compras.compra");
    expect(tipoOperacao(PEDIDO)?.origem).toEqual({ tabela: "erp.documentos_compra", discriminador: "especie", valor: "pedido" });
    expect(tipoOperacao(COMPRA)?.modulo).toBe("compras");
    expect(validarRegistroTipoOperacao()).toEqual([]);
  });
  it("espécie desconhecida, vazia ou ausente não tem família (fail-closed)", () => {
    for (const x of ["orcamento", "", null, undefined, "sale"]) expect(familiaOperacionalDeDocumentoCompra(x)).toBeUndefined();
  });
});

describe("CO-D2 resolverPoliticaEfetivaDaCompra — tabela de casos", () => {
  const casos: { nome: string; versao: { codigoBase: string; configuracao: unknown } | null; ligado: boolean; esperado: unknown }[] = [
    { nome: "sem TOP → padrão", versao: null, ligado: true, esperado: { ok: true, politica: { origem: "sem_top", estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } } },
    { nome: "formato 1 → padrão sem ler seções", versao: { codigoBase: COMPRA, configuracao: (() => { const c = configuracaoNeutraTop(); c.estoque.atualizacao = "saida"; return c; })() }, ligado: true, esperado: { ok: true, politica: { origem: 1, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } } },
    { nome: "formato 2 legado/legado → padrão", versao: { codigoBase: COMPRA, configuracao: configuracaoNeutraTopV2() }, ligado: false, esperado: { ok: true, politica: { origem: 2, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } } },
    { nome: "formato 3 neutro → padrão", versao: { codigoBase: COMPRA, configuracao: configuracaoNeutraTopV3() }, ligado: true, esperado: { ok: true, politica: { origem: 3, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } } },
    { nome: "config ilegível (formato 99) → recusa", versao: { codigoBase: COMPRA, configuracao: { versaoSchema: 99 } }, ligado: true, esperado: { ok: false, motivo: "configuracao_ilegivel", recusas: [] } },
    { nome: "formato 2 malformado → recusa", versao: { codigoBase: COMPRA, configuracao: { versaoSchema: 2, lixo: true } }, ligado: true, esperado: { ok: false, motivo: "configuracao_ilegivel", recusas: [] } },
    { nome: "configurada com runtime desligado → recusa (nunca padrão)", versao: { codigoBase: COMPRA, configuracao: v2({ estoque: "configurada", financeiro: "legado" }, (c) => { c.estoque.atualizacao = "entrada"; }) }, ligado: false, esperado: { ok: false, motivo: "execucao_desligada", recusas: [] } },
    { nome: "só estoque (entrada, exigeArmazem)", versao: { codigoBase: COMPRA, configuracao: v2({ estoque: "configurada", financeiro: "legado" }, (c) => { c.estoque.atualizacao = "entrada"; c.estoque.exigeArmazem = true; }) }, ligado: true, esperado: { ok: true, politica: { origem: 2, estoque: { autoridade: "configurada", efeito: "entrada", exigeArmazem: true }, financeiro: { autoridade: "padrao" } } } },
    { nome: "só financeiro (a pagar, exigências)", versao: { codigoBase: COMPRA, configuracao: v2({ estoque: "legado", financeiro: "configurada" }, (c) => { c.financeiro.atualizacao = "pagar"; c.financeiro.exigeVencimento = true; c.financeiro.exigeFormaPagamento = true; c.financeiro.exigeCentroResultado = true; }) }, ligado: true, esperado: { ok: true, politica: { origem: 2, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "configurada", efeito: "pagar", exigeFormaPagamento: true, exigeVencimento: true, exigeCentroResultado: true } } } },
    { nome: "nenhum efeito nos dois", versao: { codigoBase: COMPRA, configuracao: v2({ estoque: "configurada", financeiro: "configurada" }) }, ligado: true, esperado: { ok: true, politica: { origem: 2, estoque: { autoridade: "configurada", efeito: "nenhum" }, financeiro: { autoridade: "configurada", efeito: "nenhum" } } } },
  ];
  for (const c of casos) {
    it(c.nome, () => {
      expect(resolverPoliticaEfetivaDaCompra({ versaoCongelada: c.versao, execucaoConfiguradaHabilitada: c.ligado })).toEqual(c.esperado);
    });
  }

  it("fora da matriz: saída, a receber, previsão ou saldo negativo permitido → recusa por campo", () => {
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => { x.estoque.atualizacao = "saida"; x.financeiro.atualizacao = "receber"; x.financeiro.modo = "provisionar"; x.estoque.saldoNegativo = "permitir"; });
    const r = resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: COMPRA, configuracao: c }, execucaoConfiguradaHabilitada: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("execucao_nao_suportada");
      expect(r.recusas.map((x) => x.caminho).sort()).toEqual(["estoque.atualizacao", "estoque.saldoNegativo", "financeiro.atualizacao", "financeiro.modo"]);
    }
  });

  it("família que não é a da compra (pedido de compra, venda) → recusa, mesmo configurada", () => {
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "entrada"; });
    for (const familia of [PEDIDO, VENDA]) {
      const r = resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: familia, configuracao: c }, execucaoConfiguradaHabilitada: true });
      expect(r).toEqual({ ok: false, motivo: "execucao_nao_suportada", recusas: [{ motivo: "familia_sem_execucao_configurada", caminho: "execucao.estoque", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP }] });
    }
  });

  it("matriz: venda primeiro, compra depois; pedido fora; validarExecucaoTop da compra aceita entrada/pagar", () => {
    expect(MATRIZ_EXECUCAO_TOP.map((m) => m.familia)).toEqual([VENDA, COMPRA]);
    const ok = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => { x.estoque.atualizacao = "entrada"; x.financeiro.atualizacao = "pagar"; x.financeiro.exigeCentroResultado = true; });
    expect(validarExecucaoTop(COMPRA, ok)).toEqual([]);
    expect(validarExecucaoTop(PEDIDO, ok).map((r) => r.motivo)).toEqual(["familia_sem_execucao_configurada", "familia_sem_execucao_configurada"]);
    // a venda continua recusando entrada/pagar
    expect(validarExecucaoTop(VENDA, ok).map((r) => r.caminho)).toEqual(["estoque.atualizacao", "financeiro.atualizacao", "financeiro.exigeCentroResultado"]);
  });

  it("resumo estável para auditoria", () => {
    expect(resumoDaPoliticaDaCompra({ origem: "sem_top", estoque: { autoridade: "padrao" }, financeiro: { autoridade: "configurada", efeito: "pagar", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false } }))
      .toEqual({ estoque: "padrao", financeiro: "configurada:pagar" });
  });
});

describe("CO-D3 ratearCustoDeEntrada (maior resto)", () => {
  const soma = (r: { valorEntrada: string }[]) => r.reduce((a, x) => a + Math.round(Number(x.valorEntrada) * 100), 0);
  it("proporção pelo total do item; frete/outras/desconto entram no custo", () => {
    const r = ratearCustoDeEntrada([{ quantidade: "10", valorTotal: "100.00" }, { quantidade: "3", valorTotal: "300.00" }], "450.00");
    expect(r).toEqual([{ valorEntrada: "112.50", custoUnitario: "11.250000" }, { valorEntrada: "337.50", custoUnitario: "112.500000" }]);
  });
  it("100 e 50, frete 15, outras 5, desconto 10 → 106.67 e 53.33", () => {
    const r = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "100.00" }, { quantidade: "1", valorTotal: "50.00" }], "160.00");
    expect(r.map((x) => x.valorEntrada)).toEqual(["106.67", "53.33"]);
    expect(soma(r)).toBe(16000);
  });
  it("3000 unidades por 1000.00 → custo 0.333333 e valor fecha em 1000.00", () => {
    expect(ratearCustoDeEntrada([{ quantidade: "3000", valorTotal: "1000.00" }], "1000.00")).toEqual([{ valorEntrada: "1000.00", custoUnitario: "0.333333" }]);
  });
  it("empate de resto → maior valor do item, depois a ordem; soma exata", () => {
    const r = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "1" }, { quantidade: "3", valorTotal: "1" }], "100.00");
    expect(r.map((x) => x.valorEntrada)).toEqual(["33.34", "33.33", "33.33"]);
    expect(r[2]!.custoUnitario).toBe("11.110000");
    const r2 = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "2" }], "0.03");
    expect(r2.map((x) => x.valorEntrada)).toEqual(["0.01", "0.02"]);
    const r3 = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "2" }], "0.01");
    expect(r3.map((x) => x.valorEntrada)).toEqual(["0.00", "0.00", "0.01"]);
  });
  it("nenhum item negativo; item de valor zero não recebe centavo", () => {
    const r = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "1" }, { quantidade: "1", valorTotal: "0" }], "0.02");
    expect(r.map((x) => x.valorEntrada)).toEqual(["0.01", "0.01", "0.00", "0.00"]);
  });
  it("tudo bonificado com frete → pela quantidade", () => {
    expect(ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "0" }, { quantidade: "3", valorTotal: "0.00" }], "20.00"))
      .toEqual([{ valorEntrada: "5.00", custoUnitario: "5.000000" }, { valorEntrada: "15.00", custoUnitario: "5.000000" }]);
    const r = ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "0" }, { quantidade: "2", valorTotal: "0" }], "10.00");
    expect(r.map((x) => x.valorEntrada)).toEqual(["3.33", "6.67"]);
  });
  it("soma sempre igual ao total e nunca negativa (varredura)", () => {
    const vals = ["0", "0.01", "1", "7.77", "33.33", "100", "250.5"];
    for (const t of ["0.00", "0.01", "0.07", "1.00", "99.99", "1000.00", "12345.67"]) {
      for (let k = 1; k <= 5; k++) {
        const itens = Array.from({ length: k }, (_, n) => ({ quantidade: String(n + 1), valorTotal: vals[(n * 3 + k) % vals.length]! }));
        const r = ratearCustoDeEntrada(itens, t);
        expect(soma(r)).toBe(Math.round(Number(t) * 100));
        for (const x of r) expect(x.valorEntrada.startsWith("-")).toBe(false);
      }
    }
  });
  it("custo unitário com 6 casas e quantidade fracionária", () => {
    expect(ratearCustoDeEntrada([{ quantidade: "3", valorTotal: "10.00" }], "10.00")).toEqual([{ valorEntrada: "10.00", custoUnitario: "3.333333" }]);
    expect(ratearCustoDeEntrada([{ quantidade: "0.5", valorTotal: "10.00" }], "10.00")).toEqual([{ valorEntrada: "10.00", custoUnitario: "20.000000" }]);
  });
  it("sem itens → vazio; quantidade zero ou total negativo → erro", () => {
    expect(ratearCustoDeEntrada([], "10.00")).toEqual([]);
    expect(() => ratearCustoDeEntrada([{ quantidade: "0", valorTotal: "1" }], "1")).toThrow(RangeError);
    expect(() => ratearCustoDeEntrada([{ quantidade: "1", valorTotal: "1" }], "-1")).toThrow(RangeError);
  });
});

describe("CO-D4 exigências gerais por documento", () => {
  const c = configuracaoNeutraTopV3();
  c.geral.exigeParceiro = true; c.geral.exigeCentroResultado = true; c.geral.exigeObservacao = true; c.geral.exigeTransportadora = true;

  it("vendas inalterada: mapa, campos e rótulos de sempre", () => {
    expect(EXIGENCIAS_GERAIS_TOP.map((e) => [e.caminho, e.rotulo])).toEqual([["client_id", "Cliente"], ["centro_custo_id", "Centro de resultado"], ["note", "Observação"], ["transporter_id", "Transportadora"]]);
    expect(camposExigidosTop(c)).toEqual(["client_id", "centro_custo_id", "note", "transporter_id"]);
    expect(exigenciasGeraisFaltando(c, { client_id: "x", note: " " })).toEqual([{ caminho: "centro_custo_id", rotulo: "Centro de resultado" }, { caminho: "note", rotulo: "Observação" }, { caminho: "transporter_id", rotulo: "Transportadora" }]);
    expect(exigenciasGeraisDaFamiliaTop(VENDA)).toBe(EXIGENCIAS_GERAIS_TOP);
  });
  it("compra: parceiro = Fornecedor, observação e transportadora nos campos da compra", () => {
    expect(exigenciasGeraisDaFamiliaTop(COMPRA)).toBe(EXIGENCIAS_GERAIS_COMPRA_TOP);
    expect(exigenciasGeraisDaFamiliaTop(PEDIDO)).toBe(EXIGENCIAS_GERAIS_COMPRA_TOP);
    expect(camposExigidosTop(c, EXIGENCIAS_GERAIS_COMPRA_TOP)).toEqual(["fornecedor_id", "centro_custo_id", "observacao", "transportadora_id"]);
    expect(exigenciasGeraisFaltando(c, { centro_custo_id: "c", observacao: "ok" }, EXIGENCIAS_GERAIS_COMPRA_TOP))
      .toEqual([{ caminho: "fornecedor_id", rotulo: "Fornecedor" }, { caminho: "transportadora_id", rotulo: "Transportadora" }]);
    expect(exigenciasFaltandoPorCampos(["fornecedor_id"], {}, EXIGENCIAS_GERAIS_COMPRA_TOP)).toEqual([{ caminho: "fornecedor_id", rotulo: "Fornecedor" }]);
  });
  it("formato 1/2: nada a cobrar, nos dois mapas", () => {
    expect(exigenciasGeraisFaltando(configuracaoNeutraTopV2(), {}, EXIGENCIAS_GERAIS_COMPRA_TOP)).toEqual([]);
  });
});

describe("CO-D5 cliente em atraso não vale para compras", () => {
  it("predicado por família", () => {
    expect(clienteEmAtrasoValeParaFamiliaTop(VENDA)).toBe(true);
    expect(clienteEmAtrasoValeParaFamiliaTop(COMPRA)).toBe(false);
    expect(clienteEmAtrasoValeParaFamiliaTop(PEDIDO)).toBe(false);
  });
  it("recusa valor ≠ não valida nas famílias de compra; aceita na venda; ignora formato 2", () => {
    const c = configuracaoNeutraTopV3();
    expect(recusasClienteEmAtrasoDaFamiliaTop(c, COMPRA)).toEqual([]);
    c.financeiro.clienteEmAtraso = "bloqueia";
    expect(recusasClienteEmAtrasoDaFamiliaTop(c, COMPRA).map((r) => r.caminho)).toEqual(["financeiro.clienteEmAtraso"]);
    expect(recusasClienteEmAtrasoDaFamiliaTop(c, PEDIDO)).toHaveLength(1);
    expect(recusasClienteEmAtrasoDaFamiliaTop(c, VENDA)).toEqual([]);
    expect(recusasClienteEmAtrasoDaFamiliaTop(configuracaoNeutraTopV2(), COMPRA)).toEqual([]);
  });
});

describe("CO-D6 permissões, módulo, rótulos e ID Global", () => {
  it("pedidos_compra e compras: CRUD em Operacional > Compras, módulo compras", () => {
    for (const [key, label] of [["pedidos_compra", "Pedidos de Compra"], ["compras", "Compras"]] as const) {
      const r = PERMISSION_RESOURCES.find((x) => x.key === key);
      expect(r).toEqual({ key, label, module: "Operacional > Compras", actions: ["view", "create", "edit", "delete"] });
      for (const a of r!.actions) expect(moduloDaPermissao(`${key}.${a}`)).toBe("compras");
    }
  });
  it("rótulos de espécie e situação", () => {
    expect(enumLabel("especie_documento_compra", "pedido")).toBe("Pedido de compra");
    expect(enumLabel("especie_documento_compra", "compra")).toBe("Compra");
    expect(["aberto", "confirmado", "cancelado"].map((v) => enumLabel("situacao_documento_compra", v))).toEqual(["Aberto", "Confirmado", "Cancelado"]);
  });
  it("ID Global por variante; espécie desconhecida nega", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
    expect(entidadeIdGlobal("documentos_compra")?.tabela).toBe("erp.documentos_compra");
    expect(resolverRegistroGlobal("documentos_compra", "u1", { especie: "pedido" })).toEqual({ rota: "/compras/pedidos/u1", permissao: "pedidos_compra.view" });
    expect(resolverRegistroGlobal("documentos_compra", "u1", { especie: "compra" })).toEqual({ rota: "/compras/compras/u1", permissao: "compras.view" });
    expect(resolverRegistroGlobal("documentos_compra", "u1", { especie: "outra" })).toBeNull();
  });
});
