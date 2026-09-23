import { describe, it, expect } from "vitest";
import {
  CODIGOS_TIPO_OPERACAO,
  MATRIZ_EXECUCAO_TOP,
  MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP,
  SECOES_CONFIGURACAO_TOP_V2,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  VERSOES_SCHEMA_CONFIGURACAO_TOP,
  ATUALIZACOES_ESTOQUE,
  ATUALIZACOES_FINANCEIRO,
  MODOS_FINANCEIRO,
  POLITICAS_SALDO_NEGATIVO,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoTopEhNeutra,
  configuracaoTopParaEdicao,
  configuracoesTopIguais,
  declaraExecucaoConfiguradaTop,
  estoqueSobConfiguracaoTop,
  execucaoDeclaradaTop,
  familiaAceitaExecucaoConfiguradaTop,
  familiaOperacionalDeDocumentoVenda,
  financeiroSobConfiguracaoTop,
  lerConfiguracaoTop,
  lerMatrizExecucaoTop,
  normalizarConfiguracaoTop,
  resolverPoliticaEfetivaDaVenda,
  resumoDaPoliticaDaVenda,
  secoesAlteradasTop,
  validarExecucaoTop,
  versaoSchemaDaConfiguracaoTop,
  type ConfiguracaoTipoOperacaoV1,
  type ConfiguracaoTipoOperacaoV2,
  type ModoExecucaoTop,
} from "../src/index.js";

/**
 * A EXECUÇÃO CONFIGURADA DA TOP (TOP-CONFIG-04A) — D1 a D12.
 *
 * Duas perguntas atravessam o arquivo inteiro. A primeira: "uma versão HISTÓRICA pode mudar de
 * comportamento sem ninguém decidir?" — a resposta tem de ser NÃO, e os casos D1, D2, D11 e D12 são essa
 * prova. A segunda: "a configuração pode prometer um efeito que o produto não sabe executar?" — também
 * NÃO, e D7 a D10 provam a matriz. Os nomes D1–D12 são os da missão; casos adicionais levam o mesmo
 * prefixo da família que aprofundam.
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;

/** Um v1 que DECLARA saída e contas a receber — o caso que um consumidor ingênuo leria como "execute". */
function v1QueDeclaraEfeitos(): ConfiguracaoTipoOperacaoV1 {
  const c = configuracaoNeutraTop();
  c.estoque.atualizacao = "saida";
  c.estoque.exigeArmazem = true;
  c.financeiro.atualizacao = "receber";
  c.financeiro.exigeVencimento = true;
  return c;
}

/** Um v2 com a execução pedida e as seções escolhidas. */
function v2(
  execucao: { estoque: ModoExecucaoTop; financeiro: ModoExecucaoTop },
  ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {},
): ConfiguracaoTipoOperacaoV2 {
  const c = configuracaoNeutraTopV2();
  c.execucao = { ...execucao };
  ajuste(c);
  return c;
}

const resolver = (configuracao: unknown, gate = true, codigoBase = VENDA) =>
  resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase, configuracao }, execucaoConfiguradaHabilitada: gate });

describe("D1 — o formato 1 continua válido", () => {
  it("D1 o neutro e um v1 com efeitos declarados passam no parser e SAEM no formato 1", () => {
    for (const c of [configuracaoNeutraTop(), v1QueDeclaraEfeitos()]) {
      const r = lerConfiguracaoTop(clonar(c));
      expect(r.ok, r.ok ? "" : JSON.stringify(r.recusas)).toBe(true);
      if (r.ok) {
        expect(r.valor.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP);
        expect("execucao" in r.valor, "o formato 1 não ganha `execucao` ao ser lido").toBe(false);
      }
    }
  });

  it("D1b o formato 1 continua sendo o do neutro e o da 0022 — o formato novo é outra constante", () => {
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP).toBe(1);
    expect(configuracaoNeutraTop().versaoSchema).toBe(1);
    expect(VERSOES_SCHEMA_CONFIGURACAO_TOP).toEqual([1, 2]);
  });
});

describe("D2 — o formato 1 é LEGADO para sempre", () => {
  it("D2 um v1 que DECLARA saída e contas a receber continua legado nos dois efeitos", () => {
    const c = v1QueDeclaraEfeitos();
    expect(execucaoDeclaradaTop(c)).toEqual({ estoque: "legado", financeiro: "legado" });
    expect(estoqueSobConfiguracaoTop(c)).toBe(false);
    expect(financeiroSobConfiguracaoTop(c)).toBe(false);
    expect(declaraExecucaoConfiguradaTop(c)).toBe(false);
  });

  it("D2b a política da venda de um v1 é legado MESMO COM O GATE LIGADO", () => {
    const r = resolver(v1QueDeclaraEfeitos(), true);
    expect(r).toEqual({ ok: true, politica: { origem: 1, estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } } });
  });

  it("D2c a política de um v1 NÃO LÊ AS SEÇÕES: nem um v1 malformado deixa de ser legado", () => {
    // A regra é histórica: o formato 1 não decide execução, então o conteúdo dele não tem voto. Ler as
    // seções aqui seria o primeiro passo para "o v1 que diz saída baixa estoque".
    const malformado = { versaoSchema: 1, estoque: { atualizacao: "saida" }, lixo: true };
    const r = resolver(malformado, true);
    expect(r.ok && r.politica.estoque).toEqual({ autoridade: "legado" });
    expect(r.ok && r.politica.financeiro).toEqual({ autoridade: "legado" });
  });

  it("D2d documento sem TOP é legado", () => {
    const r = resolverPoliticaEfetivaDaVenda({ versaoCongelada: null, execucaoConfiguradaHabilitada: true });
    expect(r).toEqual({ ok: true, politica: { origem: "sem_top", estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } } });
  });
});

describe("D3 — o formato 2 é estrito", () => {
  it("D3 o neutro v2 é válido e nasce com os dois efeitos em legado", () => {
    const n = configuracaoNeutraTopV2();
    expect(n.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
    expect(n.execucao).toEqual({ estoque: "legado", financeiro: "legado" });
    const r = lerConfiguracaoTop(clonar(n));
    expect(r.ok && r.valor).toEqual(n);
  });

  it("D3b um v2 SEM `execucao` é recusado — não é um v1 com campo opcional", () => {
    const semExecucao = { ...clonar(configuracaoNeutraTop()), versaoSchema: 2 };
    const r = lerConfiguracaoTop(semExecucao);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toEqual([{ motivo: "tipo_invalido", caminho: "execucao" }]);
  });

  it("D3c um v1 carregando `execucao` é recusado — o formato 1 nunca pôde decidir execução", () => {
    const hibrido = { ...clonar(configuracaoNeutraTop()), execucao: { estoque: "configurada", financeiro: "legado" } };
    const r = lerConfiguracaoTop(hibrido);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toEqual([{ motivo: "campo_desconhecido", caminho: "execucao" }]);
  });

  it("D3d valor fora do enum de execução NEGA, e o tipo errado também", () => {
    const valor = clonar(configuracaoNeutraTopV2()) as unknown as { execucao: Record<string, unknown> };
    valor.execucao.estoque = "ativo";
    valor.execucao.financeiro = true;
    const r = lerConfiguracaoTop(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.recusas).toContainEqual({ motivo: "valor_invalido", caminho: "execucao.estoque" });
      expect(r.recusas).toContainEqual({ motivo: "tipo_invalido", caminho: "execucao.financeiro" });
    }
  });

  it("D3e o parser não muta a entrada v2 nem devolve referência a ela", () => {
    const entrada = v2({ estoque: "configurada", financeiro: "legado" }, (c) => { c.estoque.atualizacao = "saida"; });
    const copia = clonar(entrada);
    const r = lerConfiguracaoTop(entrada);
    expect(entrada).toEqual(copia);
    expect(r.ok && r.valor).not.toBe(entrada);
    expect(r.ok && (r.valor as ConfiguracaoTipoOperacaoV2).execucao).not.toBe(entrada.execucao);
  });

  it("D3f no formato 2, `aprovacao.valorMinimo` AUSENTE é recusado — só `null` explícito ou um valor passam", () => {
    // Ausência traduzida para `null` seria gravar como válido um corpo que o contrato não descreve.
    const sem = clonar(configuracaoNeutraTopV2()) as unknown as { aprovacao: Record<string, unknown> };
    delete sem.aprovacao.valorMinimo;
    const r = lerConfiguracaoTop(sem);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toEqual([{ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" }]);
    // A premissa: com a chave presente em `null`, o mesmo corpo é válido.
    expect(lerConfiguracaoTop(configuracaoNeutraTopV2()).ok).toBe(true);
    // O formato 1 NÃO muda: é legado para sempre, e versões antigas gravadas sem a chave continuam legíveis.
    const v1Sem = clonar(configuracaoNeutraTop()) as unknown as { aprovacao: Record<string, unknown> };
    delete v1Sem.aprovacao.valorMinimo;
    expect(lerConfiguracaoTop(v1Sem).ok).toBe(true);
  });
});

describe("D4 — formato futuro é recusado", () => {
  it("D4 qualquer formato fora dos conhecidos é UMA recusa só, antes de ler campo", () => {
    for (const versao of [0, 3, Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1, "2", null, 1.5]) {
      const r = lerConfiguracaoTop({ ...clonar(configuracaoNeutraTopV2()), versaoSchema: versao });
      expect(r.ok, `versaoSchema ${JSON.stringify(versao)}`).toBe(false);
      if (!r.ok) expect(r.recusas).toEqual([{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }]);
      expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: versao })).toBeNull();
    }
  });

  it("D4b uma versão congelada de formato futuro faz a venda PARAR, nunca cair no legado", () => {
    const r = resolver({ ...clonar(configuracaoNeutraTopV2()), versaoSchema: 3 }, true);
    expect(r).toEqual({ ok: false, motivo: "configuracao_ilegivel", recusas: [] });
  });

  it("D4c um formato 2 malformado também PARA a venda", () => {
    const r = resolver({ ...clonar(configuracaoNeutraTop()), versaoSchema: 2 }, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("configuracao_ilegivel");
  });
});

describe("D5 — chave desconhecida é recusada", () => {
  it("D5 na raiz do v2 e dentro de `execucao`", () => {
    const c = clonar(configuracaoNeutraTopV2()) as unknown as Record<string, Record<string, unknown>>;
    (c as unknown as Record<string, unknown>).motor = "x";
    c.execucao!.fiscal = "configurada";
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.recusas).toContainEqual({ motivo: "campo_desconhecido", caminho: "motor" });
      expect(r.recusas).toContainEqual({ motivo: "campo_desconhecido", caminho: "execucao.fiscal" });
    }
  });
});

describe("D6 — estoque e financeiro são independentes", () => {
  it("D6 estoque configurado com financeiro legado", () => {
    const r = resolver(v2({ estoque: "configurada", financeiro: "legado" }, (c) => { c.estoque.atualizacao = "saida"; }));
    expect(r.ok && r.politica.estoque).toEqual({ autoridade: "configurada", efeito: "saida", exigeArmazem: false });
    expect(r.ok && r.politica.financeiro).toEqual({ autoridade: "legado" });
  });

  it("D6b estoque legado com financeiro configurado", () => {
    const r = resolver(v2({ estoque: "legado", financeiro: "configurada" }, (c) => {
      c.financeiro.atualizacao = "receber";
      c.financeiro.exigeFormaPagamento = true;
    }));
    expect(r.ok && r.politica.estoque).toEqual({ autoridade: "legado" });
    expect(r.ok && r.politica.financeiro).toEqual({ autoridade: "configurada", efeito: "receber", exigeFormaPagamento: true, exigeVencimento: false });
  });

  it("D6c o efeito em legado NÃO é julgado pela matriz: a seção dele continua só declaração", () => {
    // Estoque legado com `entrada` declarada: nada executa a seção de estoque, então nada a recusar.
    const c = v2({ estoque: "legado", financeiro: "configurada" }, (x) => {
      x.estoque.atualizacao = "entrada";
      x.estoque.saldoNegativo = "permitir";
      x.financeiro.atualizacao = "receber";
    });
    expect(validarExecucaoTop(VENDA, c)).toEqual([]);
    const r = resolver(c);
    expect(r.ok && r.politica.estoque).toEqual({ autoridade: "legado" });
  });

  it("D6d `configurada` com `nenhuma` é decisão legítima — nenhum efeito, e não legado", () => {
    const r = resolver(v2({ estoque: "configurada", financeiro: "configurada" }));
    expect(r.ok && r.politica).toEqual({ origem: 2, estoque: { autoridade: "configurada", efeito: "nenhum" }, financeiro: { autoridade: "configurada", efeito: "nenhum" } });
    expect(r.ok && resumoDaPoliticaDaVenda(r.politica)).toEqual({ estoque: "configurada:nenhum", financeiro: "configurada:nenhum" });
  });
});

describe("D7 — matriz da venda: estoque", () => {
  it("D7 `nenhuma` e `saída` (com ou sem armazém exigido) são executáveis", () => {
    for (const atualizacao of ["nenhuma", "saida"] as const) {
      for (const exigeArmazem of [false, true]) {
        const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = atualizacao; x.estoque.exigeArmazem = exigeArmazem; });
        expect(validarExecucaoTop(VENDA, c), `${atualizacao}/${exigeArmazem}`).toEqual([]);
      }
    }
  });

  it("D7b entrada e transferência são recusadas, apontando o campo", () => {
    for (const atualizacao of ATUALIZACOES_ESTOQUE.filter((a) => a !== "nenhuma" && a !== "saida")) {
      const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = atualizacao; });
      const recusas = validarExecucaoTop(VENDA, c);
      expect(recusas.map((r) => [r.motivo, r.caminho]), atualizacao).toEqual([["combinacao_nao_suportada", "estoque.atualizacao"]]);
      expect(recusas[0]!.mensagem).toMatch(/Saída/);
    }
  });

  it("D7c saldo negativo `permitir` é recusado: o estoque não sabe permitir", () => {
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "saida"; x.estoque.saldoNegativo = "permitir"; });
    expect(validarExecucaoTop(VENDA, c).map((r) => r.caminho)).toEqual(["estoque.saldoNegativo"]);
  });
});

describe("D8 — matriz da venda: financeiro", () => {
  it("D8 `nenhuma` e `a receber` (com as exigências de forma de pagamento e vencimento) são executáveis", () => {
    for (const atualizacao of ["nenhuma", "receber"] as const) {
      const c = v2({ estoque: "legado", financeiro: "configurada" }, (x) => {
        x.financeiro.atualizacao = atualizacao;
        x.financeiro.exigeFormaPagamento = true;
        x.financeiro.exigeVencimento = true;
      });
      expect(validarExecucaoTop(VENDA, c), atualizacao).toEqual([]);
    }
  });

  it("D8b `a pagar`, `previsão` e exigir centro de resultado são recusados, cada um no seu campo", () => {
    const c = v2({ estoque: "legado", financeiro: "configurada" }, (x) => {
      x.financeiro.atualizacao = "pagar";
      x.financeiro.modo = "provisionar";
      x.financeiro.exigeCentroResultado = true;
    });
    expect(validarExecucaoTop(VENDA, c).map((r) => r.caminho)).toEqual(["financeiro.atualizacao", "financeiro.modo", "financeiro.exigeCentroResultado"]);
  });
});

describe("D9 — combinação sem primitive real é recusada, e nunca executada pela metade", () => {
  it("D9 TODAS as recusas vêm juntas, determinísticas, com mensagem em português", () => {
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => {
      x.estoque.atualizacao = "transferencia";
      x.estoque.saldoNegativo = "permitir";
      x.financeiro.atualizacao = "receber";
      x.financeiro.modo = "provisionar";
    });
    const recusas = validarExecucaoTop(VENDA, c);
    expect(recusas.map((r) => r.caminho)).toEqual(["estoque.atualizacao", "estoque.saldoNegativo", "financeiro.modo"]);
    expect(validarExecucaoTop(VENDA, clonar(c))).toEqual(recusas);
    for (const r of recusas) expect(r.mensagem.length).toBeGreaterThan(20);
  });

  it("D9b uma versão congelada fora da matriz (gravada por fora da API) PARA a venda — não executa a parte suportada", () => {
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => {
      x.estoque.atualizacao = "saida";
      x.financeiro.atualizacao = "receber";
      x.financeiro.modo = "provisionar";
    });
    const r = resolver(c, true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("execucao_nao_suportada");
      expect(r.recusas.map((x) => x.caminho)).toEqual(["financeiro.modo"]);
    }
  });

  it("D9c toda regra que restringe o domínio do campo explica o porquê", () => {
    const dominios: Record<string, readonly unknown[]> = {
      "estoque.atualizacao": ATUALIZACOES_ESTOQUE, "estoque.saldoNegativo": POLITICAS_SALDO_NEGATIVO,
      "financeiro.atualizacao": ATUALIZACOES_FINANCEIRO, "financeiro.modo": MODOS_FINANCEIRO,
    };
    for (const m of MATRIZ_EXECUCAO_TOP) {
      for (const efeito of ["estoque", "financeiro"] as const) {
        for (const [campo, regra] of Object.entries(m[efeito] as unknown as Record<string, { aceitos: readonly unknown[]; motivo?: string }>)) {
          const dominio = dominios[`${efeito}.${campo}`] ?? [false, true];
          const restringe = dominio.some((v) => !regra.aceitos.includes(v)) && campo !== "momento";
          if (restringe) expect(regra.motivo, `${efeito}.${campo} restringe e não explica`).toBeTruthy();
        }
      }
    }
  });

  it("D9d gate DESLIGADO: versão configurada PARA a venda — nunca legado", () => {
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "saida"; });
    expect(resolver(c, false)).toEqual({ ok: false, motivo: "execucao_desligada", recusas: [] });
    // e o mesmo v2 SEM nada configurado continua confirmando com o gate desligado
    expect(resolver(configuracaoNeutraTopV2(), false).ok).toBe(true);
  });
});

describe("D10 — outra família não ativa execução configurada", () => {
  it("D10 a matriz tem UMA família: a da venda, perguntada ao registry", () => {
    expect(MATRIZ_EXECUCAO_TOP.map((m) => m.familia)).toEqual([VENDA]);
    expect(familiaAceitaExecucaoConfiguradaTop(VENDA)).toBe(true);
  });

  it("D10b toda outra família do registry recebe a MESMA recusa objetiva, por efeito configurado", () => {
    const outras = CODIGOS_TIPO_OPERACAO.filter((c) => c !== VENDA);
    expect(outras.length).toBeGreaterThan(10);
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => { x.estoque.atualizacao = "saida"; x.financeiro.atualizacao = "receber"; });
    for (const familia of outras) {
      expect(familiaAceitaExecucaoConfiguradaTop(familia)).toBe(false);
      expect(validarExecucaoTop(familia, c), familia).toEqual([
        { motivo: "familia_sem_execucao_configurada", caminho: "execucao.estoque", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP },
        { motivo: "familia_sem_execucao_configurada", caminho: "execucao.financeiro", mensagem: MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP },
      ]);
      // legado não é ativação: a família sem consumidor continua editável
      expect(validarExecucaoTop(familia, configuracaoNeutraTopV2())).toEqual([]);
    }
    expect(MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP).toBe("Execução configurada ainda não disponível para esta família.");
  });

  it("D10c a política da VENDA recusa uma versão de outra família, mesmo que alguma matriz a aceitasse", () => {
    const outra = CODIGOS_TIPO_OPERACAO.find((c) => c !== VENDA)!;
    const matriz = [{ ...MATRIZ_EXECUCAO_TOP[0]!, familia: outra }];
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "saida"; });
    const r = resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: outra, configuracao: c }, execucaoConfiguradaHabilitada: true, matriz });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas.map((x) => x.motivo)).toEqual(["familia_sem_execucao_configurada"]);
  });
});

describe("D11 — a leitura para a tela não muta nem regrava o histórico", () => {
  it("D11 o v1 PARA EDIÇÃO é o v2 legado/legado; a entrada continua v1, intacta", () => {
    const v1 = v1QueDeclaraEfeitos();
    const antes = clonar(v1);
    const edicao = configuracaoTopParaEdicao(v1);
    expect(edicao.versaoSchema).toBe(2);
    expect(edicao.execucao).toEqual({ estoque: "legado", financeiro: "legado" });
    expect(v1).toEqual(antes);
    expect(v1.versaoSchema).toBe(1);
    expect("execucao" in v1).toBe(false);
    // as seções não mudam de significado na leitura
    const { versaoSchema: _a, execucao: _b, ...secoesEdicao } = edicao;
    const { versaoSchema: _c, ...secoesV1 } = normalizarConfiguracaoTop(v1);
    expect(secoesEdicao).toEqual(secoesV1);
  });

  it("D11b normalizar PRESERVA o formato: v2 sai v2 com a execução intocada; v1 sai v1", () => {
    const c = v2({ estoque: "configurada", financeiro: "legado" }, (x) => { x.estoque.atualizacao = "nenhuma"; x.estoque.exigeArmazem = true; });
    const n = normalizarConfiguracaoTop(c);
    expect(n.versaoSchema).toBe(2);
    expect(n.execucao).toEqual({ estoque: "configurada", financeiro: "legado" });
    expect(n.estoque.exigeArmazem, "o campo pendurado ainda é zerado").toBe(false);
    const v1n = normalizarConfiguracaoTop(v1QueDeclaraEfeitos());
    expect(v1n.versaoSchema).toBe(1);
    expect("execucao" in v1n).toBe(false);
  });
});

describe("D12 — salvar sem alterar continua não sendo escrita", () => {
  it("D12 um v1 e o mesmo conteúdo em v2 legado/legado SÃO IGUAIS — nenhuma versão só por formato", () => {
    const v1 = v1QueDeclaraEfeitos();
    expect(configuracoesTopIguais(v1, configuracaoTopParaEdicao(v1))).toBe(true);
    expect(secoesAlteradasTop(v1, configuracaoTopParaEdicao(v1))).toEqual([]);
    expect(configuracaoTopEhNeutra(configuracaoNeutraTopV2())).toBe(true);
  });

  it("D12b trocar a autoridade de um efeito É mudança, e a auditoria a nomeia `execucao`", () => {
    const antes = configuracaoTopParaEdicao(v1QueDeclaraEfeitos());
    const depois = clonar(antes);
    depois.execucao.estoque = "configurada";
    expect(configuracoesTopIguais(antes, depois)).toBe(false);
    expect(secoesAlteradasTop(antes, depois)).toEqual(["execucao"]);
    expect(secoesAlteradasTop(v1QueDeclaraEfeitos(), depois)).toEqual(["execucao"]);
    expect(configuracaoTopEhNeutra(depois)).toBe(false);
  });

  it("D12c a ordem das chaves de `execucao` não cria versão falsa", () => {
    const a = v2({ estoque: "configurada", financeiro: "legado" });
    const b = { ...clonar(a), execucao: { financeiro: "legado" as const, estoque: "configurada" as const } };
    expect(configuracoesTopIguais(a, b)).toBe(true);
  });

  it("D12d as seções comparadas no formato 2 são as do formato 1 mais `execucao`, nessa ordem", () => {
    expect(SECOES_CONFIGURACAO_TOP_V2).toEqual(["geral", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"]);
  });
});

describe("a matriz como contrato — o servidor declara, a tela lê estritamente", () => {
  it("ida e volta por JSON devolve a MESMA matriz, e a tela avalia igual ao servidor", () => {
    const lida = lerMatrizExecucaoTop(JSON.parse(JSON.stringify(MATRIZ_EXECUCAO_TOP)));
    expect(lida).toEqual(MATRIZ_EXECUCAO_TOP);
    const c = v2({ estoque: "configurada", financeiro: "configurada" }, (x) => { x.estoque.saldoNegativo = "permitir"; x.estoque.atualizacao = "saida"; x.financeiro.atualizacao = "pagar"; });
    expect(validarExecucaoTop(VENDA, c, lida!)).toEqual(validarExecucaoTop(VENDA, c));
  });

  it("qualquer desvio na matriz declarada é `null` — a tela não adivinha um pedaço", () => {
    const boa = JSON.parse(JSON.stringify(MATRIZ_EXECUCAO_TOP)) as Array<Record<string, Record<string, Record<string, unknown>>>>;
    const casos: unknown[] = [
      null, {}, [1],
      [{ ...boa[0], extra: 1 }],
      [{ ...boa[0], estoque: { ...boa[0]!.estoque, novo: { aceitos: [] } } }],
      [{ ...boa[0], estoque: { ...boa[0]!.estoque, atualizacao: { aceitos: ["teleporte"] } } }],
      [{ ...boa[0], financeiro: { ...boa[0]!.financeiro, modo: { aceitos: ["incluir"], motivo: 3 } } }],
    ];
    for (const caso of casos) expect(lerMatrizExecucaoTop(caso), JSON.stringify(caso)).toBeNull();
    expect(lerMatrizExecucaoTop([])).toEqual([]);
  });
});
