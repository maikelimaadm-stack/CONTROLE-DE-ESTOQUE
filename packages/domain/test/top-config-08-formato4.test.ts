import { describe, it, expect } from "vitest";
import {
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V3,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V4,
  VERSOES_SCHEMA_CONFIGURACAO_TOP,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoTopEhNeutra,
  configuracaoTopParaEdicao,
  configuracaoTopParaEdicaoV3,
  configuracaoTopParaEdicaoV4,
  configuracaoV4DaV3,
  configuracoesTopIguais,
  declaraRegrasGerais,
  execucaoDeclaradaTop,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  regrasGeraisExecutamTop,
  restricoesExecutamTop,
  secoesAlteradasTop,
  versaoSchemaDaConfiguracaoTop,
  type ConfiguracaoComRestricoesTop,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV3,
  type ConfiguracaoTipoOperacaoV4,
  type RecusaConfiguracaoTop,
} from "../src/tipo-operacao-configuracao.js";
import {
  confirmacaoExigeMarcaDaGuarda,
  efeitosAtivadosTop,
  resolverPoliticaEfetivaDaCompra,
  resolverPoliticaEfetivaDaVenda,
  validarExecucaoTop,
} from "../src/tipo-operacao-execucao.js";
import {
  camposExigidosTop,
  exigenciasGeraisFaltando,
  exigenciasQuePassamAValer,
  recusasClienteEmAtrasoDaFamiliaTop,
  recusasFiscaisDaFamiliaTop,
} from "../src/tipo-operacao-restricoes.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "../src/tipo-operacao-configurado.js";

/**
 * TOP-CONFIG-08 — O FORMATO 4 DA CONFIGURAÇÃO DA TOP (decisão 277), o marcador de corte das regras gerais e da
 * aprovação.
 *
 * F4-D1 prova que o 4 é lido, normalizado e editado SEM VIRAR 3 no caminho (a API grava o número a partir do
 * normalizado: se ele se perdesse, a versão seria gravada no 3 e nada executaria) e que o formato futuro (o 6,
 * desde que a OPERACOES-01 F4 tornou o 5 conhecido — decisão 281) continua recusado.
 * F4-D2 prova a comparação SEM o número: 3 → 4 no neutro não é mudança; 3 → 4 com regra fora do neutro é, porque
 * ela passa a valer — e as seções alteradas dizem qual (geral, aprovacao), cada uma por si.
 * F4-D3 prova os portões: as restrições executam no 3 e no 4; as regras gerais, só no 4.
 * F4-D4 prova que a política da venda e da compra e a marca da guarda da 0023 tratam o 4 como o 3.
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Saco = Record<string, unknown>;
const sujar = (c: ConfiguracaoTipoOperacao): Saco => clonar(c) as unknown as Saco;

function secaoDe(raiz: Saco, nome: string): Saco {
  const s = raiz[nome];
  if (typeof s !== "object" || s === null || Array.isArray(s)) throw new Error(`seção ausente no candidato: ${nome}`);
  return s as Saco;
}

/** Congela em profundidade: qualquer tentativa de mutar a entrada lança (módulo ESM = modo estrito). */
function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) congelar((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

const recusasDe = (bruto: unknown): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};

const valorDe = (bruto: unknown): ConfiguracaoTipoOperacao => {
  const r = lerConfiguracaoTop(bruto);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor;
};

const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const COMPRA = familiaOperacionalDeDocumentoCompra("compra")!;

/** Um formato 3 com as restrições fora do neutro e as quatro regras gerais NO neutro. */
function v3Rico(): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  c.geral.exigeParceiro = true;
  c.geral.exigeTransportadora = true;
  c.estoque.atualizacao = "saida";
  c.financeiro.atualizacao = "receber";
  c.financeiro.clienteEmAtraso = "bloqueia";
  c.financeiro.toleranciaAtrasoDias = 5;
  c.fiscal.habilitado = true;
  c.fiscal.modeloDocumento = "nfe";
  c.fiscal.naturezaOperacao = "Venda de mercadoria";
  c.fiscal.cfopDentroEstado = "5102";
  c.fiscal.cfopForaEstado = "6102";
  c.execucao = { estoque: "configurada", financeiro: "configurada" };
  return c;
}

/** O gêmeo do formato 4: as mesmas chaves e valores, com o número 4. */
const comoV4 = (c: ConfiguracaoTipoOperacaoV3): ConfiguracaoTipoOperacaoV4 => ({ ...clonar(c), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V4 });

/** Um formato 4 com as quatro regras gerais fora do neutro (por valor, com limite). */
function v4ComRegras(): ConfiguracaoTipoOperacaoV4 {
  const c = comoV4(v3Rico());
  c.geral.confirmacao = "automatica";
  c.geral.documentoSemItens = "permitido";
  c.geral.alteracaoAposConfirmacao = "permitida";
  c.aprovacao = { politica: "por_valor", valorMinimo: "1500.00", momento: "antes_da_confirmacao" };
  return c;
}

/** Cada regra geral fora do neutro, uma por vez — o nome diz qual seção ela muda. */
const REGRAS_FORA_DO_NEUTRO: ReadonlyArray<readonly [string, "geral" | "aprovacao", (c: ConfiguracaoTipoOperacao) => void]> = [
  ["Confirmação Automática", "geral", (c) => { c.geral.confirmacao = "automatica"; }],
  ["Documento sem itens Permitido", "geral", (c) => { c.geral.documentoSemItens = "permitido"; }],
  ["Alteração após confirmar Permitida", "geral", (c) => { c.geral.alteracaoAposConfirmacao = "permitida"; }],
  ["Aprovação Sempre", "aprovacao", (c) => { c.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; }],
  ["Aprovação a partir de um valor", "aprovacao", (c) => { c.aprovacao = { politica: "por_valor", valorMinimo: "1500.00", momento: "antes_da_confirmacao" }; }],
];

/** Aplica um ajuste numa cópia — nunca no objeto de quem chamou. */
function com<T extends ConfiguracaoTipoOperacao>(c: T, ajuste: (x: ConfiguracaoTipoOperacao) => void): T {
  const x = clonar(c);
  ajuste(x);
  return x;
}

// ---------------------------------------------------------------------------------------------------
// F4-D1 — ler, normalizar e editar sem perder o 4
// ---------------------------------------------------------------------------------------------------

describe("F4-D1 o formato 4 é conhecido e preserva o número", () => {
  it("F4-D1 a constante é 4, entra na lista dos formatos lidos, e as do 1, 2 e 3 não mudam", () => {
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP_V4).toBe(4);
    // OPERACOES-01 F4 (decisão 281): o 5 entrou na lista depois do 4; o 4 continua nela, com o mesmo número.
    expect(VERSOES_SCHEMA_CONFIGURACAO_TOP).toEqual([1, 2, 3, 4, 5]);
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP).toBe(1);
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2).toBe(2);
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP_V3).toBe(3);
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 4 })).toBe(4);
  });

  it("F4-D1 o neutro do 4 é o neutro do 3 com o número 4 — nenhuma chave nova", () => {
    const n4 = configuracaoNeutraTopV4();
    expect(n4.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V4);
    expect({ ...n4, versaoSchema: 3 }).toEqual(configuracaoNeutraTopV3());
    expect(n4.geral).toMatchObject({ confirmacao: "manual", documentoSemItens: "proibido", alteracaoAposConfirmacao: "bloqueada" });
    expect(n4.aprovacao).toEqual({ politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" });
    // Cada chamada devolve um objeto novo (o neutro não é uma constante compartilhada).
    expect(configuracaoNeutraTopV4()).not.toBe(n4);
    expect(configuracaoNeutraTopV4().geral).not.toBe(n4.geral);
  });

  it("F4-D1 o neutro do 4 e um 4 com as quatro regras fora do neutro são lidos e voltam IGUAIS, no 4", () => {
    for (const c of [configuracaoNeutraTopV4(), v4ComRegras()]) {
      const lido = valorDe(c);
      expect(lido).toEqual(c);
      expect(lido.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V4);
    }
  });

  it("F4-D1 a ida e volta pelo JSON (o caminho do banco) continua no 4", () => {
    const gravado = JSON.parse(JSON.stringify(normalizarConfiguracaoTop(v4ComRegras()))) as unknown;
    const lido = valorDe(gravado);
    expect(lido.versaoSchema).toBe(4);
    expect(valorDe(JSON.parse(JSON.stringify(lido)) as unknown)).toEqual(lido);
  });

  it("F4-D1 a leitura não muta a entrada e não devolve referência a ela", () => {
    const entrada = congelar(v4ComRegras());
    const lido = valorDe(entrada);
    expect(lido).not.toBe(entrada);
    expect(lido.geral).not.toBe(entrada.geral);
    expect(lido.fiscal).not.toBe(entrada.fiscal);
    expect(lido.aprovacao).not.toBe(entrada.aprovacao);
  });

  it("F4-D1 o 4 é tão estrito quanto o 3: o mesmo defeito dá a MESMA recusa nos dois formatos", () => {
    const defeitos: ReadonlyArray<readonly [string, (c: Saco) => void]> = [
      ["chave desconhecida em geral", (c) => { secaoDe(c, "geral").regraNova = true; }],
      ["chave desconhecida na raiz", (c) => { c.regrasGerais = {}; }],
      ["chave do 3 ausente (exigeTransportadora)", (c) => { delete secaoDe(c, "geral").exigeTransportadora; }],
      ["chave do 3 ausente (cfopExterior)", (c) => { delete secaoDe(c, "fiscal").cfopExterior; }],
      ["execucao ausente", (c) => { delete c.execucao; }],
      ["valorMinimo ausente", (c) => { delete secaoDe(c, "aprovacao").valorMinimo; }],
      ["confirmação fora do enum", (c) => { secaoDe(c, "geral").confirmacao = "imediata"; }],
      ["por valor sem valor", (c) => { secaoDe(c, "aprovacao").politica = "por_valor"; secaoDe(c, "aprovacao").valorMinimo = null; }],
      ["valor mínimo em número", (c) => { secaoDe(c, "aprovacao").politica = "por_valor"; secaoDe(c, "aprovacao").valorMinimo = 1500; }],
      ["tolerância fora do intervalo", (c) => { secaoDe(c, "financeiro").toleranciaAtrasoDias = 366; }],
    ];
    for (const [nome, sujeira] of defeitos) {
      const c3 = sujar(configuracaoNeutraTopV3());
      const c4 = sujar(configuracaoNeutraTopV4());
      sujeira(c3);
      sujeira(c4);
      const r3 = recusasDe(c3);
      expect(r3.length, nome).toBeGreaterThan(0);
      expect(recusasDe(c4), nome).toEqual(r3);
    }
  });

  it("F4-D1 o formato 6 (o futuro; e o 4 em texto) continua recusado como schema_nao_suportado, antes de ler campo", () => {
    // A premissa: desde a OPERACOES-01 F4 (decisão 281) o 5 é conhecido, e o 6 é o primeiro formato futuro.
    expect(Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1).toBe(6);
    for (const versao of [6, Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1, "4", "5", 4.5, 0]) {
      const c = { ...sujar(configuracaoNeutraTopV4()), versaoSchema: versao };
      expect(recusasDe(c), `versaoSchema ${JSON.stringify(versao)}`).toEqual([{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }]);
      expect(versaoSchemaDaConfiguracaoTop(c)).toBeNull();
    }
  });

  it("F4-D1 normalizar PRESERVA o formato: 4 fica 4, 3 fica 3 — nunca rebaixa nem promove", () => {
    expect(normalizarConfiguracaoTop(configuracaoNeutraTopV4()).versaoSchema).toBe(4);
    expect(normalizarConfiguracaoTop(v4ComRegras()).versaoSchema).toBe(4);
    expect(normalizarConfiguracaoTop(configuracaoNeutraTopV3()).versaoSchema).toBe(3);
    expect(normalizarConfiguracaoTop(v3Rico()).versaoSchema).toBe(3);
    // Pela assinatura da união também (é como o editor e a API chamam).
    const uniao: ConfiguracaoComRestricoesTop = v4ComRegras();
    expect(normalizarConfiguracaoTop(uniao).versaoSchema).toBe(4);
    const qualquer: ConfiguracaoTipoOperacao = v4ComRegras();
    expect(normalizarConfiguracaoTop(qualquer).versaoSchema).toBe(4);
  });

  it("F4-D1 normalizar o 4 aplica a MESMA régua do 3, é idempotente e não muta a entrada", () => {
    const sujo = comoV4(v3Rico());
    sujo.fiscal.habilitado = false;                  // fiscal desligado zera as chaves fiscais
    sujo.financeiro.clienteEmAtraso = "nao_valida";  // tolerância zera
    sujo.aprovacao = { politica: "sempre", valorMinimo: "10.00", momento: "antes_da_confirmacao" }; // valor pendurado
    const entrada = congelar(clonar(sujo));
    const n4 = normalizarConfiguracaoTop(entrada);
    const n3 = normalizarConfiguracaoTop({ ...clonar(sujo), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V3 });
    expect({ ...n4, versaoSchema: 3 }).toEqual(n3);
    expect(n4.fiscal).toMatchObject({ modeloDocumento: "nenhum", naturezaOperacao: "", cfopDentroEstado: "" });
    expect(n4.financeiro.toleranciaAtrasoDias).toBe(0);
    expect(n4.aprovacao.valorMinimo).toBeNull();
    expect(normalizarConfiguracaoTop(n4)).toEqual(n4);
    expect(entrada).toEqual(sujo);
  });

  it("F4-D1 configuracaoTopParaEdicaoV3: o 4 continua 4 (nunca vira 3); 1, 2 e 3 saem no 3 como hoje", () => {
    const e4 = configuracaoTopParaEdicaoV3(v4ComRegras());
    expect(e4.versaoSchema).toBe(4);
    expect(e4).toEqual(normalizarConfiguracaoTop(v4ComRegras()));
    expect(configuracaoTopParaEdicaoV3(configuracaoNeutraTopV4()).versaoSchema).toBe(4);
    expect(configuracaoTopParaEdicaoV3(configuracaoNeutraTop()).versaoSchema).toBe(3);
    expect(configuracaoTopParaEdicaoV3(configuracaoNeutraTopV2()).versaoSchema).toBe(3);
    expect(configuracaoTopParaEdicaoV3(v3Rico()).versaoSchema).toBe(3);
    // Não muta a entrada.
    const entrada = congelar(v4ComRegras());
    expect(() => configuracaoTopParaEdicaoV3(entrada)).not.toThrow();
  });

  it("F4-D1 a vista do formato 2 de um 4 tira as chaves novas e PRESERVA a execução (nunca vira legado)", () => {
    const v2 = configuracaoTopParaEdicao(v4ComRegras());
    expect(v2.versaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
    expect(v2.execucao).toEqual({ estoque: "configurada", financeiro: "configurada" });
    expect("exigeTransportadora" in v2.geral).toBe(false);
    expect("clienteEmAtraso" in v2.financeiro).toBe(false);
    expect("cfopDentroEstado" in v2.fiscal).toBe(false);
    expect(v2.geral.confirmacao).toBe("automatica");
    expect(v2.aprovacao).toEqual({ politica: "por_valor", valorMinimo: "1500.00", momento: "antes_da_confirmacao" });
    expect(v2).toEqual(configuracaoTopParaEdicao(v3ComAsMesmasChaves(v4ComRegras())));
  });

  it("F4-D1 configuracaoV4DaV3: as mesmas chaves e valores, o número 4, normalizada, sem mutar a entrada", () => {
    const c3 = congelar(v3Rico());
    const c4 = configuracaoV4DaV3(c3);
    expect(c4.versaoSchema).toBe(4);
    expect({ ...c4, versaoSchema: 3 }).toEqual(normalizarConfiguracaoTop(v3Rico()));
    expect(c4.geral).not.toBe(c3.geral);
    // Idempotente: um 4 entra e sai igual.
    expect(configuracaoV4DaV3(c4)).toEqual(c4);
  });

  it("F4-D1 configuracaoTopParaEdicaoV4: 1/2 pela vista do 3 de hoje, 3 vira 4, 4 sai como está (normalizado)", () => {
    const de1 = configuracaoTopParaEdicaoV4(configuracaoNeutraTop());
    expect(de1).toEqual(configuracaoNeutraTopV4());
    const v1ComExigencia = com(configuracaoNeutraTop(), (c) => { c.geral.exigeObservacao = true; c.geral.confirmacao = "automatica"; });
    expect(configuracaoTopParaEdicaoV4(v1ComExigencia)).toEqual({ ...configuracaoTopParaEdicaoV3(v1ComExigencia), versaoSchema: 4 });
    expect(configuracaoTopParaEdicaoV4(configuracaoNeutraTopV2())).toEqual(configuracaoNeutraTopV4());
    expect(configuracaoTopParaEdicaoV4(v3Rico())).toEqual({ ...normalizarConfiguracaoTop(v3Rico()), versaoSchema: 4 });
    expect(configuracaoTopParaEdicaoV4(v4ComRegras())).toEqual(normalizarConfiguracaoTop(v4ComRegras()));
    const entrada = congelar(v4ComRegras());
    expect(configuracaoTopParaEdicaoV4(entrada)).not.toBe(entrada);
  });

  it("F4-D1 a execução declarada do 4 é a do bloco `execucao`, como no 2 e no 3", () => {
    expect(execucaoDeclaradaTop(v4ComRegras())).toEqual({ estoque: "configurada", financeiro: "configurada" });
    expect(execucaoDeclaradaTop(configuracaoNeutraTopV4())).toEqual({ estoque: "legado", financeiro: "legado" });
  });
});

/** O mesmo formato 4 rebaixado ao 3 — só para comparar a vista do formato 2 (que não tem número). */
function v3ComAsMesmasChaves(c: ConfiguracaoTipoOperacaoV4): ConfiguracaoTipoOperacaoV3 {
  return { ...clonar(c), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V3 };
}

// ---------------------------------------------------------------------------------------------------
// F4-D2 — comparar sem o número; "passa a valer" nas seções alteradas
// ---------------------------------------------------------------------------------------------------

describe("F4-D2 igualdade sem o número do formato", () => {
  it("F4-D2 3 → 4 com as quatro regras no neutro NÃO é mudança (sem versão nova), nos dois sentidos", () => {
    expect(configuracoesTopIguais(configuracaoNeutraTopV3(), configuracaoNeutraTopV4())).toBe(true);
    expect(configuracoesTopIguais(configuracaoNeutraTopV4(), configuracaoNeutraTopV3())).toBe(true);
    // As restrições já executam no 3: levá-las ao 4 também não muda nada.
    expect(configuracoesTopIguais(v3Rico(), comoV4(v3Rico()))).toBe(true);
    expect(secoesAlteradasTop(v3Rico(), comoV4(v3Rico()))).toEqual([]);
  });

  it("F4-D2 1 e 2 no neutro → 4 no neutro também não é mudança", () => {
    expect(configuracoesTopIguais(configuracaoNeutraTop(), configuracaoNeutraTopV4())).toBe(true);
    expect(configuracoesTopIguais(configuracaoNeutraTopV2(), configuracaoNeutraTopV4())).toBe(true);
  });

  for (const [nome, secao, ajuste] of REGRAS_FORA_DO_NEUTRO) {
    it(`F4-D2 3 → 4 com ${nome} É mudança (versão N+1): a regra passa a valer → ["${secao}"]`, () => {
      const antes = com(v3Rico(), ajuste);
      const depois = com(comoV4(v3Rico()), ajuste);
      expect(configuracoesTopIguais(antes, depois)).toBe(false);
      expect(secoesAlteradasTop(antes, depois)).toEqual([secao]);
      // O 4 contra ele mesmo continua igual: o que difere é o portão, não os valores.
      expect(configuracoesTopIguais(depois, clonar(depois))).toBe(true);
      expect(secoesAlteradasTop(depois, clonar(depois))).toEqual([]);
    });
  }

  it("F4-D2 geral e aprovacao passam a valer CADA UMA POR SI", () => {
    const soAprovacao = (c: ConfiguracaoTipoOperacao) => { c.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; };
    const soGeral = (c: ConfiguracaoTipoOperacao) => { c.geral.confirmacao = "automatica"; };
    const ambas = (c: ConfiguracaoTipoOperacao) => { soGeral(c); soAprovacao(c); };
    expect(secoesAlteradasTop(com(v3Rico(), soAprovacao), com(comoV4(v3Rico()), soAprovacao))).toEqual(["aprovacao"]);
    expect(secoesAlteradasTop(com(v3Rico(), soGeral), com(comoV4(v3Rico()), soGeral))).toEqual(["geral"]);
    expect(secoesAlteradasTop(com(v3Rico(), ambas), com(comoV4(v3Rico()), ambas))).toEqual(["geral", "aprovacao"]);
  });

  it("F4-D2 2 → 4: as exigências e as regras gerais passam a valer juntas (geral), e a aprovação por si", () => {
    const antes = com(configuracaoNeutraTopV2(), (c) => { c.geral.exigeParceiro = true; c.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; });
    const depois = configuracaoTopParaEdicaoV4(antes);
    expect(configuracoesTopIguais(antes, depois)).toBe(false);
    expect(secoesAlteradasTop(antes, depois)).toEqual(["geral", "aprovacao"]);
  });

  it("F4-D2 2 → 3 com Aprovação Sempre continua como hoje: o 3 não executa a aprovação, então não é mudança", () => {
    const antes = com(configuracaoNeutraTopV2(), (c) => { c.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; });
    const depois = configuracaoTopParaEdicaoV3(antes);
    expect(depois.versaoSchema).toBe(3);
    expect(configuracoesTopIguais(antes, depois)).toBe(true);
    expect(secoesAlteradasTop(antes, depois)).toEqual([]);
  });

  it("F4-D2 4 → 4 mudando o valor mínimo: aprovacao, pela diferença dos valores", () => {
    const antes = v4ComRegras();
    const depois = com(v4ComRegras(), (c) => { c.aprovacao.valorMinimo = "1499.99"; });
    expect(configuracoesTopIguais(antes, depois)).toBe(false);
    expect(secoesAlteradasTop(antes, depois)).toEqual(["aprovacao"]);
  });

  it("F4-D2 configuracaoTopEhNeutra diz true para o neutro de TODO formato, o 4 inclusive", () => {
    expect(configuracaoTopEhNeutra(configuracaoNeutraTopV4())).toBe(true);
    expect(configuracaoTopEhNeutra(configuracaoNeutraTopV3())).toBe(true);
    expect(configuracaoTopEhNeutra(configuracaoNeutraTopV2())).toBe(true);
    expect(configuracaoTopEhNeutra(configuracaoNeutraTop())).toBe(true);
    for (const [nome, , ajuste] of REGRAS_FORA_DO_NEUTRO) {
      expect(configuracaoTopEhNeutra(com(configuracaoNeutraTopV4(), ajuste)), nome).toBe(false);
    }
  });

  it("F4-D2 efeitosAtivadosTop: levar a TOP do 3 ao 4 no neutro não ativa efeito nenhum", () => {
    expect(efeitosAtivadosTop(configuracaoNeutraTopV3(), configuracaoNeutraTopV4())).toEqual([]);
    expect(efeitosAtivadosTop(v3Rico(), comoV4(v3Rico()))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F4-D3 — os portões: restrições no 3 e no 4; regras gerais só no 4
// ---------------------------------------------------------------------------------------------------

describe("F4-D3 restricoesExecutamTop, regrasGeraisExecutamTop e declaraRegrasGerais", () => {
  it("F4-D3 as restrições executam no 3 e no 4; 1 e 2 continuam legado", () => {
    expect(restricoesExecutamTop(configuracaoNeutraTop())).toBe(false);
    expect(restricoesExecutamTop(configuracaoNeutraTopV2())).toBe(false);
    expect(restricoesExecutamTop(configuracaoNeutraTopV3())).toBe(true);
    expect(restricoesExecutamTop(configuracaoNeutraTopV4())).toBe(true);
    expect(restricoesExecutamTop(v4ComRegras())).toBe(true);
  });

  it("F4-D3 as regras gerais executam SÓ no 4 — o 3 com Automática gravado (como produção) não executa: é o corte", () => {
    const tudoForaDoNeutro = (c: ConfiguracaoTipoOperacao) => { for (const [, , ajuste] of REGRAS_FORA_DO_NEUTRO.slice(0, 4)) ajuste(c); };
    expect(regrasGeraisExecutamTop(com(configuracaoNeutraTop(), tudoForaDoNeutro))).toBe(false);
    expect(regrasGeraisExecutamTop(com(configuracaoNeutraTopV2(), tudoForaDoNeutro))).toBe(false);
    expect(regrasGeraisExecutamTop(com(configuracaoNeutraTopV3(), tudoForaDoNeutro))).toBe(false);
    expect(regrasGeraisExecutamTop(configuracaoNeutraTopV4())).toBe(true);
    expect(regrasGeraisExecutamTop(v4ComRegras())).toBe(true);
  });

  it("F4-D3 declaraRegrasGerais: falso no neutro; verdadeiro com QUALQUER das quatro fora do neutro, em todo formato", () => {
    const neutros: ConfiguracaoTipoOperacao[] = [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), configuracaoNeutraTopV4()];
    for (const n of neutros) {
      expect(declaraRegrasGerais(n), `neutro do formato ${n.versaoSchema}`).toBe(false);
      for (const [nome, , ajuste] of REGRAS_FORA_DO_NEUTRO) {
        expect(declaraRegrasGerais(com(n, ajuste)), `${nome} no formato ${n.versaoSchema}`).toBe(true);
      }
    }
    // As exigências (parceiro, transportadora…) não são regra geral.
    expect(declaraRegrasGerais(v3Rico())).toBe(false);
  });

  it("F4-D3 tudo o que o 3 executa vale igual no 4: exigências, cliente em atraso, CFOP e a matriz de execução", () => {
    const c3 = v3Rico();
    const c4 = comoV4(v3Rico());
    expect(camposExigidosTop(c4)).toEqual(camposExigidosTop(c3));
    expect(camposExigidosTop(c4)).toEqual(["client_id", "transporter_id"]);
    expect(exigenciasGeraisFaltando(c4, {})).toEqual(exigenciasGeraisFaltando(c3, {}));
    expect(exigenciasGeraisFaltando(c4, {}).map((e) => e.rotulo)).toEqual(["Cliente", "Transportadora"]);
    const cfopErrado = (c: ConfiguracaoTipoOperacao) => { c.fiscal.habilitado = true; (c.fiscal as unknown as Saco).cfopDentroEstado = "1102"; };
    expect(recusasFiscaisDaFamiliaTop(com(c4, cfopErrado), VENDA)).toEqual(recusasFiscaisDaFamiliaTop(com(c3, cfopErrado), VENDA));
    expect(recusasFiscaisDaFamiliaTop(com(c4, cfopErrado), VENDA).length).toBeGreaterThan(0);
    expect(recusasClienteEmAtrasoDaFamiliaTop(c4, COMPRA)).toEqual(recusasClienteEmAtrasoDaFamiliaTop(c3, COMPRA));
    expect(recusasClienteEmAtrasoDaFamiliaTop(c4, COMPRA).length).toBe(1);
    expect(validarExecucaoTop(VENDA, c4)).toEqual(validarExecucaoTop(VENDA, c3));
  });

  it("F4-D3 exigências que passam a valer: 3 → 4 nenhuma (já eram cobradas); 2 → 4 as do 2", () => {
    expect(exigenciasQuePassamAValer(v3Rico(), comoV4(v3Rico()))).toEqual([]);
    const v2 = com(configuracaoNeutraTopV2(), (c) => { c.geral.exigeParceiro = true; });
    expect(exigenciasQuePassamAValer(v2, configuracaoTopParaEdicaoV4(v2))).toEqual(["Cliente"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F4-D4 — a política da venda e da compra, e a marca da guarda da 0023, tratam o 4 como o 3
// ---------------------------------------------------------------------------------------------------

describe("F4-D4 política efetiva e a marca da guarda com versão no formato 4", () => {
  const venda = (configuracao: unknown) =>
    resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: VENDA, configuracao }, execucaoConfiguradaHabilitada: true });
  const compra = (configuracao: unknown) =>
    resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: COMPRA, configuracao }, execucaoConfiguradaHabilitada: true });

  it("F4-D4 venda, formato 4 legado/legado: origem 4, legado — e EXIGE a marca (a guarda só dispensa 1 e 2 legado/legado)", () => {
    const r = venda(configuracaoNeutraTopV4());
    expect(r).toEqual({ ok: true, politica: { origem: 4, estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } } });
    if (r.ok) expect(confirmacaoExigeMarcaDaGuarda(r.politica)).toBe(true);
    // As regras gerais fora do neutro não mexem na política de estoque e financeiro.
    const comRegras = com(configuracaoNeutraTopV4(), (c) => { c.geral.confirmacao = "automatica"; c.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; });
    expect(venda(comRegras)).toEqual(r);
  });

  it("F4-D4 venda, formato 4 configurado: a mesma decisão do 3, com origem 4, e exige a marca", () => {
    const r3 = venda(v3Rico());
    const r4 = venda(comoV4(v3Rico()));
    expect(r3.ok && r4.ok).toBe(true);
    if (r3.ok && r4.ok) {
      expect(r4.politica).toEqual({ ...r3.politica, origem: 4 });
      expect(r4.politica.estoque).toEqual({ autoridade: "configurada", efeito: "saida", exigeArmazem: false });
      expect(confirmacaoExigeMarcaDaGuarda(r4.politica)).toBe(true);
    }
  });

  it("F4-D4 a marca da guarda: o 4 confirma pela marca como o 3, em qualquer execução", () => {
    for (const execucao of [
      { estoque: "legado", financeiro: "legado" },
      { estoque: "configurada", financeiro: "legado" },
      { estoque: "legado", financeiro: "configurada" },
    ] as const) {
      const r = venda({ ...configuracaoNeutraTopV4(), execucao });
      if (!r.ok) throw new Error(`premissa: a política resolve (${r.motivo})`);
      expect(r.politica.origem).toBe(4);
      expect(confirmacaoExigeMarcaDaGuarda(r.politica), JSON.stringify(execucao)).toBe(true);
    }
    expect(confirmacaoExigeMarcaDaGuarda({ origem: 4, estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } })).toBe(true);
  });

  it("F4-D4 compra, formato 4: origem 4, padrão no neutro e a mesma decisão do 3 quando configurada", () => {
    expect(compra(configuracaoNeutraTopV4())).toEqual({ ok: true, politica: { origem: 4, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } });
    const c3 = com(configuracaoNeutraTopV3(), (c) => {
      c.estoque.atualizacao = "entrada";
      c.financeiro.atualizacao = "pagar";
      if (c.versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP) c.execucao = { estoque: "configurada", financeiro: "configurada" };
    });
    const r3 = compra(c3);
    const r4 = compra({ ...c3, versaoSchema: 4 });
    expect(r3.ok && r4.ok).toBe(true);
    if (r3.ok && r4.ok) expect(r4.politica).toEqual({ ...r3.politica, origem: 4 });
  });

  it("F4-D4 formato 4 malformado e formato 6 (o futuro) → configuracao_ilegivel, na venda e na compra (nunca legado)", () => {
    const malformado = { ...sujar(configuracaoNeutraTopV4()), regrasGerais: {} };
    // OPERACOES-01 F4 (decisão 281): o 5 é conhecido; o futuro é o 6 (a premissa abaixo).
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 6 })).toBeNull();
    const futuro = { ...sujar(configuracaoNeutraTopV4()), versaoSchema: 6 };
    for (const c of [malformado, futuro]) {
      expect(venda(c)).toEqual({ ok: false, motivo: "configuracao_ilegivel", recusas: [] });
      expect(compra(c)).toEqual({ ok: false, motivo: "configuracao_ilegivel", recusas: [] });
    }
  });
});
