import { describe, it, expect } from "vitest";
import { ErrorCodes, errorHttpStatus } from "@agro/shared";
import {
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV1,
  type ConfiguracaoTipoOperacaoV2,
  type ConfiguracaoTipoOperacaoV3,
} from "../src/tipo-operacao-configuracao.js";
import { TIPOS_OPERACAO } from "../src/tipo-operacao.js";
import {
  AVISO_FISCAL_SO_CONFIGURACAO,
  CAPACIDADE_REGRAS_DA_OPERACAO,
  ERRO_CLIENTE_EM_ATRASO,
  ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA,
  ERRO_EXIGENCIA_NAO_ATENDIDA,
  EXIGENCIAS_GERAIS_TOP,
  LIMITE_CONDICOES_PERMITIDAS,
  MENSAGEM_CONDICAO_NAO_PERMITIDA,
  MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
  SENTIDO_CFOP_POR_MODULO,
  camposExigidosTop,
  exigenciasFaltandoPorCampos,
  exigenciasGeraisFaltando,
  formatarDataBr,
  formatarDinheiroBr,
  mensagemClienteEmAtraso,
  recusasFiscaisDaFamiliaTop,
  sentidoCfopDaFamilia,
  textoSituacaoAtraso,
  type DocumentoParaExigencias,
  exigenciasQuePassamAValer,
} from "../src/tipo-operacao-restricoes.js";

/**
 * TR-D3 — AS RESTRIÇÕES DO FORMATO 3 NO DOMÍNIO (TOP-CONFIG-05, decisão 263).
 *
 * O que este arquivo prova:
 *   · exigências gerais: a MESMA régua na API (`exigenciasGeraisFaltando`) e na tela
 *     (`exigenciasFaltandoPorCampos(camposExigidosTop(c), doc)`), e formato 1/2 NUNCA cobra nada;
 *   · CFOP: prefixo por campo, mesmo sentido entre os três, e o sentido imposto pelo MÓDULO do registry;
 *   · cliente em atraso: o texto exato da faixa e da recusa, com dinheiro formatado sem ponto flutuante;
 *   · a capacidade e os códigos com os valores do contrato.
 */

// ─────────────── construtores de configuração ───────────────

type Flags = { exigeParceiro: boolean; exigeCentroResultado: boolean; exigeObservacao: boolean; exigeTransportadora: boolean };

const v3 = (geral: Partial<Flags> = {}, fiscal: Partial<ConfiguracaoTipoOperacaoV3["fiscal"]> = {}): ConfiguracaoTipoOperacaoV3 => {
  const n = configuracaoNeutraTopV3();
  return { ...n, geral: { ...n.geral, ...geral }, fiscal: { ...n.fiscal, ...fiscal } };
};

const TODAS_EXIGENCIAS: Flags = { exigeParceiro: true, exigeCentroResultado: true, exigeObservacao: true, exigeTransportadora: true };

/** v1 com as três exigências do formato 1 ligadas. */
const v1Exigente = (): ConfiguracaoTipoOperacaoV1 => {
  const n = configuracaoNeutraTop();
  return { ...n, geral: { ...n.geral, exigeParceiro: true, exigeCentroResultado: true, exigeObservacao: true } };
};

/** v2 com as três exigências ligadas E uma chave do formato 3 contrabandeada (chega em runtime, o tipo não a vê). */
const v2Exigente = (): ConfiguracaoTipoOperacaoV2 => {
  const n = configuracaoNeutraTopV2();
  const geral = { ...n.geral, exigeParceiro: true, exigeCentroResultado: true, exigeObservacao: true, exigeTransportadora: true };
  return { ...n, geral };
};

const DOC_VAZIO: DocumentoParaExigencias = {};
const DOC_PREENCHIDO: DocumentoParaExigencias = {
  client_id: "11111111-1111-4111-8111-111111111111",
  centro_custo_id: "22222222-2222-4222-8222-222222222222",
  note: "Entregar pela manhã",
  transporter_id: "33333333-3333-4333-8333-333333333333",
};

const TODOS_FALTANDO = [
  { caminho: "client_id", rotulo: "Cliente" },
  { caminho: "centro_custo_id", rotulo: "Centro de resultado" },
  { caminho: "note", rotulo: "Observação" },
  { caminho: "transporter_id", rotulo: "Transportadora" },
];

// ─────────────── exigências gerais ───────────────

describe("TR-D3 exigências gerais do formato 3", () => {
  it("TR-D3 o mapa exigência → campo → rótulo é o do contrato, nesta ordem", () => {
    expect(EXIGENCIAS_GERAIS_TOP.map((e) => [e.chave, e.caminho, e.rotulo])).toStrictEqual([
      ["exigeParceiro", "client_id", "Cliente"],
      ["exigeCentroResultado", "centro_custo_id", "Centro de resultado"],
      ["exigeObservacao", "note", "Observação"],
      ["exigeTransportadora", "transporter_id", "Transportadora"],
    ]);
  });

  it("TR-D3 v3 com as 4 exigências e documento vazio → 4 itens {caminho, rotulo} na ordem de EXIGENCIAS_GERAIS_TOP", () => {
    const faltando = exigenciasGeraisFaltando(v3(TODAS_EXIGENCIAS), DOC_VAZIO);
    // toStrictEqual: cada item tem SÓ caminho e rotulo — a chave interna (`chave`) não vaza para a resposta.
    expect(faltando).toStrictEqual(TODOS_FALTANDO);
    expect(faltando.map((f) => f.caminho)).toStrictEqual(EXIGENCIAS_GERAIS_TOP.map((e) => e.caminho));
  });

  it("TR-D3 null, undefined, string vazia e só espaços contam como faltando", () => {
    const doc: DocumentoParaExigencias = { client_id: null, centro_custo_id: undefined, note: "   ", transporter_id: "" };
    expect(exigenciasGeraisFaltando(v3(TODAS_EXIGENCIAS), doc)).toStrictEqual(TODOS_FALTANDO);
    expect(exigenciasGeraisFaltando(v3({ exigeObservacao: true }), { note: " \t\n " })).toStrictEqual([{ caminho: "note", rotulo: "Observação" }]);
  });

  it("TR-D3 documento preenchido → []", () => {
    expect(exigenciasGeraisFaltando(v3(TODAS_EXIGENCIAS), DOC_PREENCHIDO)).toStrictEqual([]);
    // Observação com conteúdo cercado de espaços é conteúdo.
    expect(exigenciasGeraisFaltando(v3({ exigeObservacao: true }), { note: "  x  " })).toStrictEqual([]);
  });

  it("TR-D3 só a exigência ligada é cobrada; campo não exigido vazio não conta", () => {
    expect(exigenciasGeraisFaltando(v3({ exigeTransportadora: true }), DOC_VAZIO)).toStrictEqual([{ caminho: "transporter_id", rotulo: "Transportadora" }]);
    expect(exigenciasGeraisFaltando(v3({ exigeParceiro: true, exigeObservacao: true }), { client_id: "c", note: "" })).toStrictEqual([
      { caminho: "note", rotulo: "Observação" },
    ]);
    expect(exigenciasGeraisFaltando(configuracaoNeutraTopV3(), DOC_VAZIO)).toStrictEqual([]);
  });

  it("TR-D3 formato 1 e 2 com exigências ligadas → SEMPRE [] (legado para sempre)", () => {
    for (const c of [v1Exigente(), v2Exigente()] as ConfiguracaoTipoOperacao[]) {
      // O documento vazio violaria todas as exigências se o formato 3 valesse — prova que a regra está desligada, não sem assunto.
      expect(exigenciasGeraisFaltando(c, DOC_VAZIO)).toStrictEqual([]);
      expect(exigenciasGeraisFaltando(c, { client_id: null, centro_custo_id: "", note: "   " })).toStrictEqual([]);
      expect(camposExigidosTop(c)).toStrictEqual([]);
    }
  });

  it("TR-D3 camposExigidosTop lê as flags do formato 3, na ordem do mapa", () => {
    expect(camposExigidosTop(v3(TODAS_EXIGENCIAS))).toStrictEqual(["client_id", "centro_custo_id", "note", "transporter_id"]);
    expect(camposExigidosTop(v3({ exigeTransportadora: true, exigeParceiro: true }))).toStrictEqual(["client_id", "transporter_id"]);
    expect(camposExigidosTop(configuracaoNeutraTopV3())).toStrictEqual([]);
  });

  it("TR-D3 mesma régua: exigenciasFaltandoPorCampos(camposExigidosTop(c), doc) === exigenciasGeraisFaltando(c, doc)", () => {
    const documentos: DocumentoParaExigencias[] = [
      DOC_VAZIO,
      DOC_PREENCHIDO,
      { client_id: null, centro_custo_id: undefined, note: "   ", transporter_id: "" },
      { client_id: "c" },
      { note: "obs", transporter_id: "t" },
      { centro_custo_id: "cc", note: " " },
    ];
    const configs: ConfiguracaoTipoOperacao[] = [v1Exigente(), v2Exigente(), configuracaoNeutraTop(), configuracaoNeutraTopV2()];
    // As 16 combinações das quatro exigências no formato 3.
    for (let m = 0; m < 16; m++) {
      configs.push(v3({ exigeParceiro: !!(m & 1), exigeCentroResultado: !!(m & 2), exigeObservacao: !!(m & 4), exigeTransportadora: !!(m & 8) }));
    }
    let comparacoes = 0;
    let naoVazias = 0;
    for (const c of configs) {
      for (const doc of documentos) {
        const api = exigenciasGeraisFaltando(c, doc);
        expect(exigenciasFaltandoPorCampos(camposExigidosTop(c), doc)).toStrictEqual(api);
        comparacoes++;
        if (api.length > 0) naoVazias++;
      }
    }
    // Verde que não prova nada é reprovação: a comparação cobriu casos em que HÁ o que cobrar.
    expect(comparacoes).toBe(20 * documentos.length);
    expect(naoVazias).toBeGreaterThan(30);
  });

  it("TR-D3 exigenciasFaltandoPorCampos ignora campo fora do mapa e segue a ordem do mapa, não a da lista", () => {
    expect(exigenciasFaltandoPorCampos(["transporter_id", "client_id"], DOC_VAZIO)).toStrictEqual([
      { caminho: "client_id", rotulo: "Cliente" },
      { caminho: "transporter_id", rotulo: "Transportadora" },
    ]);
    expect(exigenciasFaltandoPorCampos(["campo_inventado"], DOC_VAZIO)).toStrictEqual([]);
    expect(exigenciasFaltandoPorCampos([], DOC_VAZIO)).toStrictEqual([]);
  });
});

// ─────────────── CFOP ───────────────

describe("TR-D3 CFOP — recusasFiscaisDaFamiliaTop", () => {
  const VENDA = "vendas.venda";
  // Família de módulo que NÃO é vendas nem compras: não impõe sentido.
  const SEM_SENTIDO = "estoque.entrada_manual";
  const COMPRAS = "compras.solicitacao";

  it("TR-D3 as famílias usadas aqui existem no registry (o teste não inventa família)", () => {
    const codigos = TIPOS_OPERACAO.map((t) => t.codigo);
    expect(codigos).toContain(VENDA);
    expect(codigos).toContain(SEM_SENTIDO);
    expect(codigos).toContain(COMPRAS);
  });

  it("TR-D3 vendas.venda com cfopDentroEstado 1102 (entrada) → recusa em fiscal.cfopDentroEstado", () => {
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "1102" }), VENDA)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopDentroEstado", mensagem: "Esta operação é de saída: use um CFOP de saída (5, 6 ou 7)." },
    ]);
  });

  it("TR-D3 vendas.venda com 5102/6102/7102 nos campos certos → []", () => {
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "5102", cfopForaEstado: "6102", cfopExterior: "7102" }), VENDA)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "5102" }), VENDA)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopForaEstado: "6102" }), VENDA)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopExterior: "7102" }), VENDA)).toStrictEqual([]);
    // CFOPs vazios (neutro) não são cobrados.
    expect(recusasFiscaisDaFamiliaTop(configuracaoNeutraTopV3(), VENDA)).toStrictEqual([]);
  });

  it("TR-D3 6102 em cfopDentroEstado → recusa pelo prefixo do campo", () => {
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "6102" }), VENDA)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopDentroEstado", mensagem: "CFOP dentro do estado começa com 1 (entrada) ou 5 (saída)." },
    ]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopForaEstado: "7102" }), SEM_SENTIDO)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopForaEstado", mensagem: "CFOP fora do estado começa com 2 (entrada) ou 6 (saída)." },
    ]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopExterior: "5102" }), SEM_SENTIDO)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopExterior", mensagem: "CFOP exterior começa com 3 (entrada) ou 7 (saída)." },
    ]);
  });

  it("TR-D3 saída e entrada misturadas numa família sem sentido imposto → recusa de mesmo sentido", () => {
    expect(sentidoCfopDaFamilia(SEM_SENTIDO)).toBeNull();
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "1102", cfopForaEstado: "6102" }), SEM_SENTIDO)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopForaEstado", mensagem: "Todos os CFOPs precisam ter o mesmo sentido (entrada ou saída)." },
    ]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "5102", cfopExterior: "3102" }), SEM_SENTIDO)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopExterior", mensagem: "Todos os CFOPs precisam ter o mesmo sentido (entrada ou saída)." },
    ]);
    // Sem sentido imposto, qualquer sentido CONSISTENTE é aceito.
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "1102", cfopForaEstado: "2102", cfopExterior: "3102" }), SEM_SENTIDO)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "5102", cfopForaEstado: "6102", cfopExterior: "7102" }), SEM_SENTIDO)).toStrictEqual([]);
  });

  it("TR-D3 família de compras impõe entrada", () => {
    expect(sentidoCfopDaFamilia(COMPRAS)).toBe("entrada");
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "1102", cfopForaEstado: "2102", cfopExterior: "3102" }), COMPRAS)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "5102" }), COMPRAS)).toStrictEqual([
      { motivo: "valor_invalido", caminho: "fiscal.cfopDentroEstado", mensagem: "Esta operação é de entrada: use um CFOP de entrada (1, 2 ou 3)." },
    ]);
  });

  it("TR-D3 várias recusas saem uma por campo, na ordem dos campos", () => {
    expect(recusasFiscaisDaFamiliaTop(v3({}, { cfopDentroEstado: "6102", cfopForaEstado: "2102", cfopExterior: "7102" }), VENDA).map((r) => r.caminho)).toStrictEqual([
      "fiscal.cfopDentroEstado",
      "fiscal.cfopForaEstado",
    ]);
  });

  it("TR-D3 formato 1/2 → [] mesmo com família de vendas e CFOP de entrada contrabandeado", () => {
    const n2 = configuracaoNeutraTopV2();
    const fiscal = { ...n2.fiscal, habilitado: true, cfopDentroEstado: "1102", cfopForaEstado: "9999" };
    const v2: ConfiguracaoTipoOperacaoV2 = { ...n2, fiscal };
    expect(recusasFiscaisDaFamiliaTop(v2, VENDA)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(configuracaoNeutraTopV2(), VENDA)).toStrictEqual([]);
    expect(recusasFiscaisDaFamiliaTop(configuracaoNeutraTop(), COMPRAS)).toStrictEqual([]);
  });
});

describe("TR-D3 sentidoCfopDaFamilia lê o registry", () => {
  it("TR-D3 vendas.* = saida; compras = entrada; outro módulo e desconhecida → null", () => {
    expect(SENTIDO_CFOP_POR_MODULO).toStrictEqual({ vendas: "saida", compras: "entrada" });
    for (const f of ["vendas.orcamento", "vendas.pedido", "vendas.venda"]) expect(sentidoCfopDaFamilia(f)).toBe("saida");
    expect(sentidoCfopDaFamilia("compras.solicitacao")).toBe("entrada");
    expect(sentidoCfopDaFamilia("financeiro.conta_a_receber")).toBeNull();
    // Desconhecida → null, inclusive com prefixo de módulo conhecido: a resposta vem do REGISTRY, não do texto.
    expect(sentidoCfopDaFamilia("vendas.inexistente")).toBeNull();
    expect(sentidoCfopDaFamilia("xyz.abc")).toBeNull();
    expect(sentidoCfopDaFamilia("")).toBeNull();
    expect(sentidoCfopDaFamilia("constructor")).toBeNull();
  });

  it("TR-D3 toda família declarada responde pelo módulo dela", () => {
    expect(TIPOS_OPERACAO.length).toBeGreaterThan(0);
    for (const t of TIPOS_OPERACAO) {
      const esperado = t.modulo === "vendas" ? "saida" : t.modulo === "compras" ? "entrada" : null;
      expect(sentidoCfopDaFamilia(t.codigo), t.codigo).toBe(esperado);
    }
  });
});

// ─────────────── cliente em atraso ───────────────

describe("TR-D3 cliente em atraso", () => {
  const S = { titulos: 2, total: "1234.5", vencimentoMaisAntigo: "2026-08-01" };

  it("TR-D3 textoSituacaoAtraso e mensagemClienteEmAtraso — texto exato do contrato", () => {
    expect(textoSituacaoAtraso(S)).toBe("O cliente tem 2 título(s) vencido(s), total R$ 1.234,50, o mais antigo de 01/08/2026.");
    expect(mensagemClienteEmAtraso(S)).toBe(
      "O cliente tem 2 título(s) vencido(s), total R$ 1.234,50, o mais antigo de 01/08/2026. Esta operação não aceita cliente em atraso.",
    );
  });

  it("TR-D3 sem vencimento (zero títulos) não inventa data", () => {
    expect(textoSituacaoAtraso({ titulos: 0, total: "0", vencimentoMaisAntigo: null })).toBe("O cliente tem 0 título(s) vencido(s), total R$ 0,00.");
  });

  it("TR-D3 formatarDinheiroBr sem ponto flutuante", () => {
    expect(formatarDinheiroBr("0")).toBe("0,00");
    expect(formatarDinheiroBr("1000000.00")).toBe("1.000.000,00");
    expect(formatarDinheiroBr("12.3")).toBe("12,30");
    expect(formatarDinheiroBr("1234.5")).toBe("1.234,50");
    expect(formatarDinheiroBr("0.05")).toBe("0,05");
    expect(formatarDinheiroBr("999.99")).toBe("999,99");
    expect(formatarDinheiroBr("-1234.5")).toBe("-1.234,50");
    // Valor que um double não representa exatamente sai inteiro, dígito por dígito.
    expect(formatarDinheiroBr("90071992547409931.99")).toBe("90.071.992.547.409.931,99");
  });

  it("TR-D3 formatarDataBr", () => {
    expect(formatarDataBr("2026-08-01")).toBe("01/08/2026");
    expect(formatarDataBr("2026-12-31T00:00:00Z")).toBe("31/12/2026");
  });
});

// ─────────────── capacidade e códigos ───────────────

describe("TR-D3 capacidade, códigos e textos fixos", () => {
  it("TR-D3 CAPACIDADE_REGRAS_DA_OPERACAO === 1", () => {
    expect(CAPACIDADE_REGRAS_DA_OPERACAO).toBe(1);
  });

  it("TR-D3 códigos com os valores do contrato, e existentes (422) no catálogo de erros", () => {
    expect(ERRO_EXIGENCIA_NAO_ATENDIDA).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA).toBe("CONDICAO_PAGAMENTO_NAO_PERMITIDA");
    expect(ERRO_CLIENTE_EM_ATRASO).toBe("CLIENTE_EM_ATRASO");
    expect(ErrorCodes.TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA).toBe(ERRO_EXIGENCIA_NAO_ATENDIDA);
    expect(ErrorCodes.CONDICAO_PAGAMENTO_NAO_PERMITIDA).toBe(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA);
    expect(ErrorCodes.CLIENTE_EM_ATRASO).toBe(ERRO_CLIENTE_EM_ATRASO);
    for (const codigo of [ERRO_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, ERRO_CLIENTE_EM_ATRASO]) {
      expect(errorHttpStatus[codigo], codigo).toBe(422);
    }
  });

  it("TR-D3 mensagens, limite e aviso fiscal", () => {
    expect(MENSAGEM_CONDICAO_NAO_PERMITIDA).toBe("Esta operação não aceita esta condição de pagamento.");
    expect(MENSAGEM_EXIGENCIA_NAO_ATENDIDA).toBe("A operação exige dados que o documento não tem.");
    expect(LIMITE_CONDICOES_PERMITIDAS).toBe(50);
    expect(AVISO_FISCAL_SO_CONFIGURACAO).toBe("Usado na emissão da nota fiscal. A emissão ainda não existe no sistema.");
  });
});

describe("TR-D4 — exigências que passam a valer (R1)", () => {
  const v2 = (g: Partial<{ exigeParceiro: boolean; exigeCentroResultado: boolean; exigeObservacao: boolean }>) => {
    const n = configuracaoNeutraTopV2(); return { ...n, geral: { ...n.geral, ...g } };
  };
  const paraV3 = (c: ReturnType<typeof v2>, extra: Record<string, unknown> = {}) => {
    const n = configuracaoNeutraTopV3(); return { ...n, geral: { ...n.geral, ...c.geral, ...extra } };
  };
  it("TR-D4 v2 com as 3 marcas → v3: os 3 rótulos, na ordem do domínio; transportadora nova não entra", () => {
    const antes = v2({ exigeParceiro: true, exigeCentroResultado: true, exigeObservacao: true });
    expect(exigenciasQuePassamAValer(antes, paraV3(antes, { exigeTransportadora: true }))).toEqual(["Cliente", "Centro de resultado", "Observação"]);
  });
  it("TR-D4 v2 sem marcas → vazio; marca desmarcada na mesma gravação → não entra", () => {
    expect(exigenciasQuePassamAValer(v2({}), paraV3(v2({}), { exigeTransportadora: true }))).toEqual([]);
    const antes = v2({ exigeObservacao: true, exigeParceiro: true });
    expect(exigenciasQuePassamAValer(antes, paraV3(antes, { exigeObservacao: false }))).toEqual(["Cliente"]);
  });
  it("TR-D4 v3 → v3 e v2 → v2: vazio", () => {
    const a = paraV3(v2({ exigeObservacao: true }));
    expect(exigenciasQuePassamAValer(a, a)).toEqual([]);
    const b = v2({ exigeObservacao: true });
    expect(exigenciasQuePassamAValer(b, b)).toEqual([]);
  });
});
