import { describe, it, expect } from "vitest";
import {
  SECOES_CONFIGURACAO_TOP,
  SECOES_CONFIGURACAO_TOP_V2,
  SECOES_CONFIGURACAO_TOP_V5,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V4,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V5,
  VERSOES_SCHEMA_CONFIGURACAO_TOP,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracaoTopEhNeutra,
  configuracaoTopParaEdicaoV3,
  configuracaoTopParaEdicaoV4,
  configuracaoTopParaEdicaoV5,
  configuracaoV5DaV4,
  configuracoesTopIguais,
  formato5Top,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  regrasGeraisExecutamTop,
  restricoesExecutamTop,
  secaoNoNeutroTopV5,
  secoesAlteradasTop,
  secoesExtensaoDaVersaoTop,
  secoesExtensaoNeutrasTop,
  versaoSchemaDaConfiguracaoTop,
  versaoSchemaExecutaRegrasGeraisTop,
  voltarSecoesAoNeutroTopV5,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV1,
  type ConfiguracaoTipoOperacaoV2,
  type ConfiguracaoTipoOperacaoV3,
  type ConfiguracaoTipoOperacaoV4,
  type ConfiguracaoTipoOperacaoV5,
  type RecusaConfiguracaoTop,
} from "../src/tipo-operacao-configuracao.js";
import {
  CHAVES_RAIZ_RESERVADAS_TOP,
  DEFINICOES_SECOES_V5,
  ROTULOS_SECOES_EXTENSAO_V5,
  SECOES_EXTENSAO_V5,
  definicaoDaSecaoV5,
  definirSecaoV5,
  type DefinicaoSecaoV5,
} from "../src/tipo-operacao-secoes-v5.js";
import {
  exigeAprovacao,
  normalizarRegrasGeraisDaFamiliaTop,
  regrasGeraisDaVersaoTop,
  regrasGeraisQuePassamAValer,
  validarRegrasGeraisTop,
} from "../src/tipo-operacao-regras-gerais.js";
import {
  confirmacaoExigeMarcaDaGuarda,
  resolverPoliticaEfetivaDaCompra,
  resolverPoliticaEfetivaDaVenda,
} from "../src/tipo-operacao-execucao.js";
import { exigenciasGeraisFaltando } from "../src/tipo-operacao-restricoes.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "../src/tipo-operacao-configurado.js";

/**
 * OPERACOES-01 F4 (decisão 281) — O FORMATO 5 DA CONFIGURAÇÃO DA TOP.
 *
 * F5-D1 as constantes (o 5 é conhecido; o 1 continua o do neutro; a lista do formato 1 não cresce; o 5 nasce sem
 *       seção) e o CONTRATO de toda definição de seção — conferido na lista do produto e, como premissa de que a
 *       conferência pega alguma coisa, na seção fictícia deste teste.
 * F5-D2 o neutro do 5 = o neutro do 4 com o número 5.
 * F5-D3 a leitura estrita do 5 (as chaves do 3/4, o número preservado, o 6 recusado).
 * F5-D4 A MÁQUINA DAS SEÇÕES, provada com uma seção FICTÍCIA (`SECAO_DE_TESTE`) passada como `definicoes`: ausente =
 *       neutro, presente = estrita, normalizada; no 1-4 a chave é recusada; 1-4 executam as seções no neutro; a vista,
 *       a comparação e a auditoria enxergam a seção.
 * F5-D5 os portões: o 5 executa tudo o que o 4 executa; o 3 continua o corte.
 * F5-D6 as TOPs dos formatos 1 a 4 são LIDAS como 5, sem regravar e sem passar a executar o que não executavam.
 * F5-D7 a normalização, a promoção e a matriz das regras gerais preservam o 5.
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Saco = Record<string, unknown>;
const sujar = (c: ConfiguracaoTipoOperacao): Saco => clonar(c) as unknown as Saco;

/** Congela em profundidade: qualquer tentativa de mutar a entrada lança (módulo ESM = modo estrito). */
function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) congelar((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

const recusasDe = (bruto: unknown, definicoes?: readonly DefinicaoSecaoV5[]): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto, definicoes);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};

const valorDe = (bruto: unknown, definicoes?: readonly DefinicaoSecaoV5[]): ConfiguracaoTipoOperacao => {
  const r = lerConfiguracaoTop(bruto, definicoes);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor;
};

/** A raiz do objeto como registro, para ler a seção de extensão de teste (que o tipo do produto não conhece). */
const raiz = (c: object): Readonly<Record<string, unknown>> => c as Readonly<Record<string, unknown>>;

const VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const COMPRA = familiaOperacionalDeDocumentoCompra("compra")!;
const PEDIDO_COMPRA = familiaOperacionalDeDocumentoCompra("pedido")!;

// ---------------------------------------------------------------------------------------------------
// A SEÇÃO FICTÍCIA — exercita os cinco métodos do leitor
// ---------------------------------------------------------------------------------------------------

const MODOS_TESTE = ["desligado", "avisa", "bloqueia"] as const;
interface SecaoTeste {
  modo: (typeof MODOS_TESTE)[number];
  notificar: boolean;
  tolerancia: string;
  dias: number;
  nota: string;
}

const SECAO_DE_TESTE = definirSecaoV5({
  nome: "teste",
  rotulo: "Seção de teste",
  ajuda: "Só existe neste teste.",
  chaves: ["modo", "notificar", "tolerancia", "dias", "nota"],
  neutro(): SecaoTeste {
    return { modo: "desligado", notificar: false, tolerancia: "0", dias: 0, nota: "" };
  },
  ler(l) {
    return {
      modo: l.enumerado("modo", MODOS_TESTE),
      notificar: l.booleano("notificar"),
      tolerancia: l.decimal("tolerancia", 2, "100"),
      dias: l.inteiro("dias", 0, 30),
      nota: l.texto("nota", 20),
    };
  },
  // "Desligado" não decide nada: o resto da seção volta ao neutro (o molde de `estoque.atualizacao = nenhuma`).
  normalizar(v): SecaoTeste {
    return v.modo === "desligado" ? { modo: "desligado", notificar: false, tolerancia: "0", dias: 0, nota: "" } : { ...v };
  },
  usadaPor(familia) {
    return familia === VENDA;
  },
  linhas(v) {
    return [["Modo", v.modo], ["Notificar", v.notificar ? "Sim" : "Não"]];
  },
});
const DEFS: readonly DefinicaoSecaoV5[] = [SECAO_DE_TESTE];

const secaoTeste = (ajuste: Partial<SecaoTeste> = {}): SecaoTeste => Object.assign(SECAO_DE_TESTE.neutro(), ajuste);
const BLOQUEIA: SecaoTeste = { modo: "bloqueia", notificar: true, tolerancia: "12.50", dias: 3, nota: "Conferir" };

/** Um 5 bruto (JSON) com a seção de teste presente. */
const v5ComTeste = (teste: unknown): Saco => ({ ...sujar(configuracaoNeutraTopV5(DEFS)), teste });

// ---------------------------------------------------------------------------------------------------
// OS FORMATOS DE ORIGEM
// ---------------------------------------------------------------------------------------------------

/** Um formato 1 com conteúdo nas seções e NENHUMA exigência nem regra geral (o que o 3/4 passaria a executar). */
function v1Rico(): ConfiguracaoTipoOperacaoV1 {
  const c = configuracaoNeutraTop();
  c.estoque.atualizacao = "saida";
  c.estoque.exigeArmazem = true;
  c.financeiro.atualizacao = "receber";
  c.financeiro.exigeVencimento = true;
  c.fiscal.habilitado = true;
  return c;
}

function v2Rico(): ConfiguracaoTipoOperacaoV2 {
  const c = configuracaoNeutraTopV2();
  c.estoque.atualizacao = "saida";
  c.financeiro.atualizacao = "receber";
  c.execucao = { estoque: "configurada", financeiro: "configurada" };
  return c;
}

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
  c.fiscal.cfopDentroEstado = "5102";
  c.execucao = { estoque: "configurada", financeiro: "configurada" };
  return c;
}

/** Um formato 4 com as quatro regras gerais fora do neutro. */
function v4ComRegras(): ConfiguracaoTipoOperacaoV4 {
  const c: ConfiguracaoTipoOperacaoV4 = { ...v3Rico(), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V4 };
  c.geral.confirmacao = "automatica";
  c.geral.documentoSemItens = "permitido";
  c.aprovacao = { politica: "por_valor", valorMinimo: "1500.00", momento: "antes_da_confirmacao" };
  return c;
}

/** O gêmeo do 5: as mesmas chaves e valores, com o número 5 (e as seções de extensão no neutro). */
const comoV5 = (c: ConfiguracaoTipoOperacaoV3 | ConfiguracaoTipoOperacaoV4): ConfiguracaoTipoOperacaoV5 =>
  ({ ...clonar(c), versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V5, ...secoesExtensaoNeutrasTop() });

/** Um 3 com Confirmação Automática — o pedido de compra de produção. */
function v3Automatica(): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  c.geral.confirmacao = "automatica";
  return c;
}

// ---------------------------------------------------------------------------------------------------
// F5-D1 — as constantes e o contrato das definições
// ---------------------------------------------------------------------------------------------------

/**
 * O contrato que TODA definição de seção cumpre. Roda sobre a lista do produto (vazia na F4 — cada fase que
 * acrescentar uma seção passa por ele sem mudar este teste) e sobre a seção fictícia (a premissa: ele confere algo).
 */
function conferirContratoDaSecao(d: DefinicaoSecaoV5): void {
  expect((CHAVES_RAIZ_RESERVADAS_TOP as readonly string[]).includes(d.nome), `${d.nome}: nome reservado`).toBe(false);
  expect(d.nome, "nome de chave de raiz").toMatch(/^[a-z][A-Za-z0-9]*$/);
  expect(d.rotulo.trim().length, `${d.nome}: rótulo`).toBeGreaterThan(0);
  expect(d.ajuda.trim().length, `${d.nome}: ajuda`).toBeGreaterThan(0);
  const a = d.neutro();
  const b = d.neutro();
  expect(a, `${d.nome}: neutro() devolve objeto NOVO a cada chamada`).not.toBe(b);
  expect(a).toEqual(b);
  // O neutro é completo e só tem chaves declaradas: o leitor estrito o aceita como veio.
  expect(Object.keys(a).sort(), `${d.nome}: chaves do neutro`).toEqual([...d.chaves].sort());
  expect(d.normalizar(a), `${d.nome}: o neutro já está normalizado`).toEqual(a);
  const congelado = congelar(d.neutro());
  expect(() => d.normalizar(congelado), `${d.nome}: normalizar não muta`).not.toThrow();
  const n5 = configuracaoNeutraTopV5([d]);
  expect(raiz(n5)[d.nome]).toEqual(a);
  const lido = valorDe(clonar(n5), [d]);
  expect(raiz(lido)[d.nome], `${d.nome}: o neutro sobrevive à leitura estrita`).toEqual(a);
  for (const linha of d.linhas(a)) {
    expect(linha).toHaveLength(2);
    expect(typeof linha[0] === "string" && typeof linha[1] === "string").toBe(true);
  }
}

describe("F5-D1 as constantes do formato 5 e o contrato das seções", () => {
  it("F5-D1 o 5 é conhecido; o 1 continua o do neutro; a lista publicada do formato 1 não cresce", () => {
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP_V5).toBe(5);
    expect(VERSOES_SCHEMA_CONFIGURACAO_TOP).toEqual([1, 2, 3, 4, 5]);
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 5 })).toBe(5);
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 6 })).toBeNull();
    expect(VERSAO_SCHEMA_CONFIGURACAO_TOP).toBe(1);
    expect(configuracaoNeutraTop().versaoSchema).toBe(1);
    expect(SECOES_CONFIGURACAO_TOP).toEqual(["geral", "estoque", "financeiro", "fiscal", "aprovacao"]);
  });

  it("F5-D1 o 5 nasceu SEM seção de extensão; a F9 acrescenta financeiroPadrao, depois das do formato 2", () => {
    expect(DEFINICOES_SECOES_V5.map((d: DefinicaoSecaoV5) => d.nome)).toEqual(["financeiroPadrao"]);
    expect(SECOES_EXTENSAO_V5).toEqual(["financeiroPadrao"]);
    expect(ROTULOS_SECOES_EXTENSAO_V5).toEqual({ financeiroPadrao: "Padrões financeiros" });
    expect(SECOES_CONFIGURACAO_TOP_V5).toEqual([...SECOES_CONFIGURACAO_TOP_V2, "financeiroPadrao"]);
    // O neutro é o comportamento de hoje: nenhuma provisão, o documento decide, e sem natureza e centro vale a 1ª por código.
    expect(secoesExtensaoNeutrasTop()).toEqual({ financeiroPadrao: { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" } });
  });

  it("F5-D1 os nomes reservados são exatamente as chaves de raiz de hoje", () => {
    expect([...CHAVES_RAIZ_RESERVADAS_TOP]).toEqual(["versaoSchema", ...SECOES_CONFIGURACAO_TOP_V2]);
  });

  it("F5-D1 toda seção do produto cumpre o contrato — e a conferência pega a seção fictícia também", () => {
    for (const d of DEFINICOES_SECOES_V5) conferirContratoDaSecao(d);
    // A premissa: a conferência roda de verdade sobre uma definição (a lista do produto nasceu vazia na F4).
    conferirContratoDaSecao(SECAO_DE_TESTE);
    const nomes = DEFINICOES_SECOES_V5.map((d: DefinicaoSecaoV5) => d.nome);
    expect(new Set(nomes).size, "nenhum nome repetido na lista").toBe(nomes.length);
  });

  it("F5-D1 a conferência REPROVA uma definição que viola o contrato (neutro incompleto, normalizar que muda o neutro)", () => {
    const incompleta = definirSecaoV5<"incompleta", Partial<SecaoTeste>>({ ...SECAO_DE_TESTE, nome: "incompleta", neutro: () => ({ modo: "desligado" }) });
    expect(() => conferirContratoDaSecao(incompleta)).toThrow();
    const normalizaErrado = definirSecaoV5({ ...SECAO_DE_TESTE, nome: "errada", normalizar: (v: SecaoTeste) => ({ ...v, dias: v.dias + 1 }) });
    expect(() => conferirContratoDaSecao(normalizaErrado)).toThrow();
  });

  it("F5-D1 definicaoDaSecaoV5 acha pelo nome e nega o resto (nunca a vizinha)", () => {
    expect(definicaoDaSecaoV5("teste", DEFS)).toBe(SECAO_DE_TESTE);
    expect(definicaoDaSecaoV5("geral", DEFS)).toBeUndefined();
    expect(definicaoDaSecaoV5("teste")).toBeUndefined();
    expect(Object.isFrozen(SECAO_DE_TESTE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D2 — o neutro do 5
// ---------------------------------------------------------------------------------------------------

describe("F5-D2 o neutro do formato 5", () => {
  it("F5-D2 é o neutro do 4 com o número 5 e as seções de extensão no neutro — nenhuma chave a mais", () => {
    const n5 = configuracaoNeutraTopV5();
    const n4 = configuracaoNeutraTopV4();
    expect(n5).toEqual({ ...n4, versaoSchema: 5, ...secoesExtensaoNeutrasTop() });
    expect(Object.keys(n5).sort()).toEqual([...Object.keys(n4), ...SECOES_EXTENSAO_V5].sort());
    // A premissa: sem as seções de extensão, é o neutro do 4 com o número 5.
    expect(configuracaoNeutraTopV5([])).toEqual({ ...n4, versaoSchema: 5 });
  });

  it("F5-D2 o leitor devolve o neutro do 5 igual a ele, no 5", () => {
    const n5 = configuracaoNeutraTopV5();
    const lido = valorDe(clonar(n5));
    expect(lido).toEqual(n5);
    expect(lido.versaoSchema).toBe(5);
  });

  it("F5-D2 as quatro regras gerais nascem no neutro (as regras que travam começam desligadas)", () => {
    const n5 = configuracaoNeutraTopV5();
    expect(n5.geral.confirmacao).toBe("manual");
    expect(n5.geral.documentoSemItens).toBe("proibido");
    expect(n5.geral.alteracaoAposConfirmacao).toBe("bloqueada");
    expect(n5.aprovacao).toEqual({ politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" });
    expect(configuracaoTopEhNeutra(n5)).toBe(true);
  });

  it("F5-D2 cada chamada devolve um objeto novo; com uma seção declarada, ela entra no neutro dela", () => {
    const a = configuracaoNeutraTopV5();
    a.geral.exigeParceiro = true;
    expect(configuracaoNeutraTopV5().geral.exigeParceiro).toBe(false);
    expect(raiz(configuracaoNeutraTopV5(DEFS)).teste).toEqual(SECAO_DE_TESTE.neutro());
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D3 — a leitura estrita do 5
// ---------------------------------------------------------------------------------------------------

describe("F5-D3 a leitura estrita do formato 5", () => {
  it("F5-D3 o número sai 5 — nunca 4 —, com as chaves do 3/4 lidas iguais", () => {
    const rico = comoV5(v4ComRegras());
    const lido = valorDe(sujar(rico));
    expect(lido.versaoSchema).toBe(5);
    expect(lido).toEqual(normalizarConfiguracaoTop(rico));
    // A premissa: o mesmo corpo no 4 é lido com os mesmos valores, só o número muda (e as seções de extensão no neutro).
    expect({ ...valorDe(sujar(v4ComRegras())), versaoSchema: 5, ...secoesExtensaoNeutrasTop() }).toEqual(lido);
  });

  it("F5-D3 chave de raiz desconhecida → campo_desconhecido nela (a seção que nenhuma fase declarou)", () => {
    expect(recusasDe({ ...sujar(configuracaoNeutraTopV5()), secaoInexistente: {} })).toEqual([{ motivo: "campo_desconhecido", caminho: "secaoInexistente" }]);
  });

  it("F5-D3 sem `execucao` → recusa (o 5 é estrito como o 2)", () => {
    const c = sujar(configuracaoNeutraTopV5());
    delete c.execucao;
    expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: "execucao" }]);
  });

  it("F5-D3 sem uma chave do formato 3 → recusa no caminho dela", () => {
    const c = sujar(configuracaoNeutraTopV5());
    delete (c.geral as Saco).exigeTransportadora;
    expect(recusasDe(c)).toEqual([{ motivo: "tipo_invalido", caminho: "geral.exigeTransportadora" }]);
    const f = sujar(configuracaoNeutraTopV5());
    delete (f.fiscal as Saco).cfopExterior;
    expect(recusasDe(f)).toEqual([{ motivo: "tipo_invalido", caminho: "fiscal.cfopExterior" }]);
  });

  it("F5-D3 o 6 (o próximo formato) é schema_nao_suportado, antes de ler campo", () => {
    expect(Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1).toBe(6);
    expect(recusasDe({ ...sujar(configuracaoNeutraTopV5()), versaoSchema: 6, secaoInexistente: "lixo" }))
      .toEqual([{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }]);
  });

  it("F5-D3 não muta a entrada e não devolve referência a ela", () => {
    const bruto = congelar(sujar(comoV5(v4ComRegras())));
    const lido = valorDe(bruto);
    expect(raiz(lido).geral).not.toBe(bruto.geral);
    expect(raiz(lido).aprovacao).not.toBe(bruto.aprovacao);
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D4 — a máquina das seções de extensão, com a seção fictícia
// ---------------------------------------------------------------------------------------------------

describe("F5-D4 a máquina das seções (seção fictícia passada como `definicoes`)", () => {
  it("F5-D4 AUSENTE num 5 → o neutro da seção (o 5 gravado antes da fase continua legível)", () => {
    const bruto = sujar(configuracaoNeutraTopV5([]));
    expect(Object.hasOwn(bruto, "teste"), "a premissa: o bruto não tem a chave").toBe(false);
    const lido = valorDe(bruto, DEFS);
    expect(raiz(lido).teste).toEqual(SECAO_DE_TESTE.neutro());
    expect(lido.versaoSchema).toBe(5);
  });

  it("F5-D4 PRESENTE → lida campo a campo, pelos cinco métodos do leitor", () => {
    const lido = valorDe(v5ComTeste({ ...BLOQUEIA }), DEFS);
    expect(raiz(lido).teste).toEqual(BLOQUEIA);
  });

  it("F5-D4 chave desconhecida DENTRO da seção → campo_desconhecido em <secao>.<chave>", () => {
    expect(recusasDe(v5ComTeste({ ...BLOQUEIA, x: 1 }), DEFS)).toEqual([{ motivo: "campo_desconhecido", caminho: "teste.x" }]);
  });

  it("F5-D4 valor fora do enumerado → valor_invalido (nunca o vizinho nem o padrão)", () => {
    expect(recusasDe(v5ComTeste({ ...BLOQUEIA, modo: "quase" }), DEFS)).toEqual([{ motivo: "valor_invalido", caminho: "teste.modo" }]);
  });

  it("F5-D4 tipo errado → tipo_invalido no campo; seção que não é objeto → tipo_invalido na seção", () => {
    expect(recusasDe(v5ComTeste({ ...BLOQUEIA, modo: 1 }), DEFS)).toEqual([{ motivo: "tipo_invalido", caminho: "teste.modo" }]);
    expect(recusasDe(v5ComTeste({ ...BLOQUEIA, notificar: "sim" }), DEFS)).toEqual([{ motivo: "tipo_invalido", caminho: "teste.notificar" }]);
    for (const secao of ["texto", 1, null, [], true]) {
      expect(recusasDe(v5ComTeste(secao), DEFS), JSON.stringify(secao)).toEqual([{ motivo: "tipo_invalido", caminho: "teste" }]);
    }
  });

  it("F5-D4 PRESENTE é estrita: campo que falta é recusa (ausente só vale para a seção inteira)", () => {
    const { notificar: _semNotificar, ...semUmCampo } = BLOQUEIA;
    expect(recusasDe(v5ComTeste(semUmCampo), DEFS)).toEqual([{ motivo: "tipo_invalido", caminho: "teste.notificar" }]);
  });

  it("F5-D4 decimal, inteiro e texto: forma, faixa e tipo, cada um no caminho do campo", () => {
    const casos: ReadonlyArray<readonly [Partial<Record<keyof SecaoTeste, unknown>>, RecusaConfiguracaoTop]> = [
      [{ tolerancia: "12.345" }, { motivo: "valor_invalido", caminho: "teste.tolerancia" }],
      [{ tolerancia: "100.01" }, { motivo: "valor_invalido", caminho: "teste.tolerancia" }],
      [{ tolerancia: "1e2" }, { motivo: "valor_invalido", caminho: "teste.tolerancia" }],
      [{ tolerancia: "-1" }, { motivo: "valor_invalido", caminho: "teste.tolerancia" }],
      [{ tolerancia: 10 }, { motivo: "tipo_invalido", caminho: "teste.tolerancia" }],
      [{ dias: 31 }, { motivo: "valor_invalido", caminho: "teste.dias" }],
      [{ dias: 1.5 }, { motivo: "tipo_invalido", caminho: "teste.dias" }],
      [{ nota: "x".repeat(21) }, { motivo: "valor_invalido", caminho: "teste.nota" }],
      [{ nota: 5 }, { motivo: "tipo_invalido", caminho: "teste.nota" }],
    ];
    for (const [ajuste, recusa] of casos) {
      expect(recusasDe(v5ComTeste({ ...BLOQUEIA, ...ajuste }), DEFS), JSON.stringify(ajuste)).toEqual([recusa]);
    }
    // A premissa: as bordas aceitas (o máximo inclusive, em decimal) passam.
    for (const ajuste of [{ tolerancia: "100" }, { tolerancia: "100.00" }, { tolerancia: "0.5" }, { dias: 30 }, { nota: "x".repeat(20) }]) {
      expect(raiz(valorDe(v5ComTeste({ ...BLOQUEIA, ...ajuste }), DEFS)).teste, JSON.stringify(ajuste)).toEqual({ ...BLOQUEIA, ...ajuste });
    }
  });

  it("F5-D4 a seção é NORMALIZADA depois de lida (o que não decide nada volta ao neutro)", () => {
    const lido = valorDe(v5ComTeste({ ...BLOQUEIA, modo: "desligado" }), DEFS);
    expect(raiz(lido).teste).toEqual(SECAO_DE_TESTE.neutro());
  });

  it("F5-D4 as recusas saem na ordem fixa: raiz, seções de hoje, seções de extensão", () => {
    const bruto: Saco = { ...v5ComTeste({ ...BLOQUEIA, modo: "quase" }), secaoInexistente: {} };
    (bruto.geral as Saco).confirmacao = "talvez";
    expect(recusasDe(bruto, DEFS)).toEqual([
      { motivo: "campo_desconhecido", caminho: "secaoInexistente" },
      { motivo: "valor_invalido", caminho: "geral.confirmacao" },
      { motivo: "valor_invalido", caminho: "teste.modo" },
    ]);
  });

  it("F5-D4 a MESMA chave num formato 1 a 4 → campo_desconhecido (o 4 nunca carrega seção nova)", () => {
    // A premissa: no 5, a mesma seção é aceita.
    expect(raiz(valorDe(v5ComTeste({ ...BLOQUEIA }), DEFS)).teste).toEqual(BLOQUEIA);
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), configuracaoNeutraTopV4()]) {
      expect(recusasDe({ ...sujar(c), teste: { ...BLOQUEIA } }, DEFS), `formato ${c.versaoSchema}`)
        .toEqual([{ motivo: "campo_desconhecido", caminho: "teste" }]);
    }
  });

  it("F5-D4 sem a definição (a lista do produto), a seção de teste num 5 é chave desconhecida", () => {
    expect(recusasDe(v5ComTeste({ ...BLOQUEIA }))).toEqual([{ motivo: "campo_desconhecido", caminho: "teste" }]);
  });

  it("F5-D4 a leitura de EXECUÇÃO: 1 a 4 → a seção no neutro; 5 → a dela, copiada", () => {
    for (const c of [v1Rico(), v2Rico(), v3Rico(), v4ComRegras()]) {
      expect(secoesExtensaoDaVersaoTop(c, DEFS), `formato ${c.versaoSchema}`).toEqual({ teste: SECAO_DE_TESTE.neutro() });
    }
    const v5 = valorDe(v5ComTeste({ ...BLOQUEIA }), DEFS);
    const lidas = raiz(secoesExtensaoDaVersaoTop(v5, DEFS));
    expect(lidas).toEqual({ teste: BLOQUEIA });
    expect(lidas.teste).not.toBe(raiz(v5).teste);
    // A premissa do neutro: com a lista do produto, cada seção dela no neutro.
    expect(secoesExtensaoDaVersaoTop(v4ComRegras())).toEqual(secoesExtensaoNeutrasTop());
  });

  it("F5-D4 a vista do 5 de um 4 tem a seção no neutro, e a comparação e a auditoria a enxergam", () => {
    const v4 = configuracaoNeutraTopV4();
    const vista = configuracaoTopParaEdicaoV5(v4, DEFS);
    expect(vista.versaoSchema).toBe(5);
    expect(raiz(vista).teste).toEqual(SECAO_DE_TESTE.neutro());
    const v5Neutro = configuracaoNeutraTopV5(DEFS);
    const v5Bloqueia = valorDe(v5ComTeste({ ...BLOQUEIA }), DEFS);
    expect(configuracoesTopIguais(v4, v5Neutro, DEFS), "4 → 5 com a seção no neutro: salvar sem mexer").toBe(true);
    expect(configuracoesTopIguais(v4, v5Bloqueia, DEFS), "a seção fora do neutro é mudança").toBe(false);
    expect(secoesAlteradasTop(v4, v5Bloqueia, DEFS)).toEqual(["teste"]);
    expect(secoesAlteradasTop(v4, v5Neutro, DEFS)).toEqual([]);
    // Mudar SÓ a seção de extensão entre dois 5 também é mudança — na vista do 4 de antes ela seria invisível.
    const outroModo = valorDe(v5ComTeste({ ...BLOQUEIA, modo: "avisa" }), DEFS);
    expect(configuracoesTopIguais(v5Bloqueia, outroModo, DEFS)).toBe(false);
    expect(secoesAlteradasTop(v5Bloqueia, outroModo, DEFS)).toEqual(["teste"]);
    expect(configuracaoTopParaEdicaoV4(v5Bloqueia), "a premissa: a vista do 4 não enxerga a seção").toEqual(configuracaoTopParaEdicaoV4(outroModo));
  });

  it("F5-D4 normalizar com a definição: normaliza a seção, preserva o 5 e copia (não aponta para a entrada)", () => {
    const entrada = congelar({ ...configuracaoNeutraTopV5(DEFS), teste: secaoTeste({ modo: "desligado", dias: 9 }) });
    const n = normalizarConfiguracaoTop(entrada, DEFS);
    expect(n.versaoSchema).toBe(5);
    expect(raiz(n).teste).toEqual(SECAO_DE_TESTE.neutro());
    const comBloqueia = congelar({ ...configuracaoNeutraTopV5(DEFS), teste: { ...BLOQUEIA } });
    const n2 = normalizarConfiguracaoTop(comBloqueia, DEFS);
    expect(raiz(n2).teste).toEqual(BLOQUEIA);
    expect(raiz(n2).teste).not.toBe(comBloqueia.teste);
    expect(normalizarConfiguracaoTop(n2, DEFS)).toEqual(n2);
  });

  it("F5-D4 a seção no neutro e a volta ao neutro, só da seção pedida", () => {
    const v5 = valorDe(v5ComTeste({ ...BLOQUEIA }), DEFS);
    if (!formato5Top(v5)) throw new Error("premissa: o lido é um 5");
    expect(secaoNoNeutroTopV5(v5, "geral", DEFS)).toBe(true);
    const voltou = voltarSecoesAoNeutroTopV5(v5, [], DEFS);
    expect(raiz(voltou).teste, "sem pedir, nada volta").toEqual(BLOQUEIA);
    const v5Financeiro: ConfiguracaoTipoOperacaoV5 = { ...v5, financeiro: { ...v5.financeiro, atualizacao: "pagar" } };
    expect(secaoNoNeutroTopV5(v5Financeiro, "financeiro", DEFS)).toBe(false);
    const semFinanceiro = voltarSecoesAoNeutroTopV5(v5Financeiro, ["financeiro"], DEFS);
    expect(semFinanceiro.financeiro).toEqual(configuracaoNeutraTopV5().financeiro);
    expect(raiz(semFinanceiro).teste, "a outra seção fica como estava").toEqual(BLOQUEIA);
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D5 — os portões
// ---------------------------------------------------------------------------------------------------

describe("F5-D5 os portões: o 5 executa tudo o que o 4 executa", () => {
  it("F5-D5 restrições, regras gerais e formato 5 no 5; o 3 continua o corte das regras gerais", () => {
    const n5 = configuracaoNeutraTopV5();
    expect(restricoesExecutamTop(n5)).toBe(true);
    expect(regrasGeraisExecutamTop(n5)).toBe(true);
    expect(formato5Top(n5)).toBe(true);
    // As premissas: no 3 as regras gerais não executam; o 4 executa e não é o 5.
    expect(regrasGeraisExecutamTop(configuracaoNeutraTopV3())).toBe(false);
    expect(restricoesExecutamTop(configuracaoNeutraTopV3())).toBe(true);
    expect(regrasGeraisExecutamTop(configuracaoNeutraTopV4())).toBe(true);
    expect(formato5Top(configuracaoNeutraTopV4())).toBe(false);
  });

  it("F5-D5 versaoSchemaExecutaRegrasGeraisTop: 4 e 5 sim; 1, 2, 3, 6 e desconhecido não", () => {
    for (const v of [4, 5]) expect(versaoSchemaExecutaRegrasGeraisTop(v), String(v)).toBe(true);
    for (const v of [1, 2, 3, 6, 0, null]) expect(versaoSchemaExecutaRegrasGeraisTop(v), String(v)).toBe(false);
  });

  it("F5-D5 regras gerais da versão no 5: Automática executa; o MESMO conteúdo no 3 é o neutro do corte", () => {
    const v5 = comoV5(v3Automatica());
    expect(regrasGeraisDaVersaoTop({ codigoBase: VENDA, configuracao: sujar(v5) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: true, aceitaSemItens: false, aprovacao: null } });
    expect(regrasGeraisDaVersaoTop({ codigoBase: VENDA, configuracao: sujar(v3Automatica()) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: null } });
  });

  it("F5-D5 aprovação no 5: \"Sempre\" exige, a mesma conta da 0041 (que trata ≥ 4)", () => {
    const v5 = comoV5(configuracaoNeutraTopV3());
    v5.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" };
    const r = regrasGeraisDaVersaoTop({ codigoBase: VENDA, configuracao: sujar(v5) });
    expect(r).toEqual({ ok: true, regras: { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: { politica: "sempre" } } });
    if (r.ok) expect(exigeAprovacao(r.regras, "10.00")).toBe(true);
  });

  it("F5-D5 um 5 malformado é ILEGÍVEL (nunca o neutro do corte)", () => {
    const comChaveNova = { ...sujar(configuracaoNeutraTopV5()), regrasGerais: {} };
    const malformado = sujar(configuracaoNeutraTopV5());
    (malformado.geral as Saco).confirmacao = "quase";
    for (const configuracao of [comChaveNova, malformado, { versaoSchema: 5 }]) {
      expect(regrasGeraisDaVersaoTop({ codigoBase: VENDA, configuracao }), JSON.stringify(configuracao))
        .toEqual({ ok: false, motivo: "configuracao_ilegivel" });
      expect(resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: VENDA, configuracao }, execucaoConfiguradaHabilitada: true }))
        .toEqual({ ok: false, motivo: "configuracao_ilegivel", recusas: [] });
    }
  });

  it("F5-D5 a política da venda e da compra no 5 neutro: origem 5, legado/padrão, e a venda confirma pela marca da 0023", () => {
    const configuracao = sujar(configuracaoNeutraTopV5());
    const venda = resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: VENDA, configuracao }, execucaoConfiguradaHabilitada: false });
    expect(venda).toEqual({ ok: true, politica: { origem: 5, estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } } });
    if (venda.ok) expect(confirmacaoExigeMarcaDaGuarda(venda.politica)).toBe(true);
    expect(resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: COMPRA, configuracao }, execucaoConfiguradaHabilitada: false }))
      .toEqual({ ok: true, politica: { origem: 5, estoque: { autoridade: "padrao" }, financeiro: { autoridade: "padrao" } } });
    // A premissa da marca: o 2 neutro (legado declarado) é o único que a dispensa, além do 1.
    expect(confirmacaoExigeMarcaDaGuarda({ origem: 2, estoque: { autoridade: "legado" }, financeiro: { autoridade: "legado" } })).toBe(false);
  });

  it("F5-D5 a execução configurada no 5 decide como no 4", () => {
    const v4 = configuracaoNeutraTopV4();
    v4.estoque.atualizacao = "saida";
    v4.financeiro.atualizacao = "receber";
    v4.execucao = { estoque: "configurada", financeiro: "configurada" };
    const r4 = resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: VENDA, configuracao: sujar(v4) }, execucaoConfiguradaHabilitada: true });
    const r5 = resolverPoliticaEfetivaDaVenda({ versaoCongelada: { codigoBase: VENDA, configuracao: sujar(comoV5(v4)) }, execucaoConfiguradaHabilitada: true });
    expect(r4.ok && r5.ok).toBe(true);
    if (r4.ok && r5.ok) expect(r5.politica).toEqual({ ...r4.politica, origem: 5 });
  });

  it("F5-D5 as restrições executam no 5 (exigências cobradas como no 3 e no 4)", () => {
    const v5 = configuracaoNeutraTopV5();
    v5.geral.exigeParceiro = true;
    expect(exigenciasGeraisFaltando(v5, {})).toEqual([{ caminho: "client_id", rotulo: "Cliente" }]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D6 — os formatos 1 a 4 LIDOS como 5
// ---------------------------------------------------------------------------------------------------

describe("F5-D6 as TOPs dos formatos 1 a 4 são LIDAS como 5", () => {
  const origens = (): ConfiguracaoTipoOperacao[] => [v1Rico(), v2Rico(), v3Rico(), v4ComRegras()];

  it("F5-D6 a vista do 5 de cada formato é a vista do 4 de hoje com o número 5 (e as seções no neutro)", () => {
    for (const c of origens()) {
      expect(configuracaoTopParaEdicaoV5(c), `formato ${c.versaoSchema}`)
        .toEqual({ ...configuracaoTopParaEdicaoV4(c), versaoSchema: 5, ...secoesExtensaoNeutrasTop() });
    }
  });

  it("F5-D6 salvar sem mexer (a vista do 5 de volta) NÃO é mudança — nenhuma versão nova", () => {
    for (const c of origens()) {
      const vista = configuracaoTopParaEdicaoV5(c);
      expect(configuracoesTopIguais(c, vista), `formato ${c.versaoSchema}`).toBe(true);
      expect(secoesAlteradasTop(c, vista), `formato ${c.versaoSchema}`).toEqual([]);
    }
  });

  it("F5-D6 o que PASSA A EXECUTAR no 5 é mudança: a regra geral do 3 e a exigência do 1", () => {
    const v3 = v3Automatica();
    const vista3 = configuracaoTopParaEdicaoV5(v3);
    expect(vista3.geral.confirmacao, "a premissa: a vista leva a regra como está").toBe("automatica");
    expect(configuracoesTopIguais(v3, vista3)).toBe(false);
    expect(secoesAlteradasTop(v3, vista3)).toEqual(["geral"]);
    expect(regrasGeraisQuePassamAValer(v3, vista3)).toEqual(["Confirmação automática"]);
    const v1 = configuracaoNeutraTop();
    v1.geral.exigeParceiro = true;
    expect(configuracoesTopIguais(v1, configuracaoTopParaEdicaoV5(v1))).toBe(false);
  });

  it("F5-D6 do 4 para o 5 nada passa a valer (o 4 já executava as regras gerais)", () => {
    const v4 = v4ComRegras();
    expect(regrasGeraisQuePassamAValer(v4, configuracaoTopParaEdicaoV5(v4))).toEqual([]);
    expect(regrasGeraisQuePassamAValer(comoV5(v4), configuracaoTopParaEdicaoV5(v4))).toEqual([]);
  });

  it("F5-D6 ler como 5 não faz executar: a execução segue o número GRAVADO", () => {
    const v3 = v3Automatica();
    expect(regrasGeraisExecutamTop(v3)).toBe(false);
    expect(regrasGeraisDaVersaoTop({ codigoBase: VENDA, configuracao: sujar(v3) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: null } });
    // E a vista é só leitura: o 3 continua 3.
    expect(v3.versaoSchema).toBe(3);
  });

  it("F5-D6 nenhuma das funções muta a entrada", () => {
    for (const c of origens()) {
      const congelada = congelar(clonar(c));
      expect(() => configuracaoTopParaEdicaoV5(congelada)).not.toThrow();
      expect(() => configuracoesTopIguais(congelada, configuracaoNeutraTopV5())).not.toThrow();
      expect(() => secoesAlteradasTop(congelada, configuracaoNeutraTopV5())).not.toThrow();
      expect(congelada).toEqual(c);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// F5-D7 — a normalização e a matriz das regras gerais preservam o 5
// ---------------------------------------------------------------------------------------------------

describe("F5-D7 a normalização preserva o 5", () => {
  it("F5-D7 normalizar sai 5, é idempotente e zera o pendurado como no 4", () => {
    const v4 = v4ComRegras();
    v4.estoque.atualizacao = "nenhuma";
    v4.estoque.exigeArmazem = true;
    v4.fiscal.habilitado = false;
    const v5 = comoV5(v4);
    const n5 = normalizarConfiguracaoTop(v5);
    expect(n5.versaoSchema).toBe(5);
    expect(normalizarConfiguracaoTop(n5)).toEqual(n5);
    expect(n5.estoque.exigeArmazem).toBe(false);
    expect(n5.fiscal.cfopDentroEstado).toBe("");
    // A premissa: é a mesma régua do 4, só o número difere (e as seções de extensão, no neutro).
    expect(n5).toEqual({ ...normalizarConfiguracaoTop(v4), versaoSchema: 5, ...secoesExtensaoNeutrasTop() });
  });

  it("F5-D7 a promoção explícita: 3 e 4 → 5 com o mesmo conteúdo; 5 entra e sai igual", () => {
    expect(configuracaoV5DaV4(v4ComRegras())).toEqual({ ...normalizarConfiguracaoTop(v4ComRegras()), versaoSchema: 5, ...secoesExtensaoNeutrasTop() });
    expect(configuracaoV5DaV4(v3Rico())).toEqual({ ...normalizarConfiguracaoTop(v3Rico()), versaoSchema: 5, ...secoesExtensaoNeutrasTop() });
    const v5 = configuracaoV5DaV4(v4ComRegras());
    expect(configuracaoV5DaV4(v5)).toEqual(v5);
    expect(raiz(configuracaoV5DaV4(v3Rico(), DEFS)).teste).toEqual(SECAO_DE_TESTE.neutro());
  });

  it("F5-D7 as vistas antigas: a do 3 deixa o 5 ser 5; a do 4 o mostra como 4 (só exibição)", () => {
    const v5 = comoV5(v4ComRegras());
    expect(configuracaoTopParaEdicaoV3(v5).versaoSchema).toBe(5);
    expect(configuracaoTopParaEdicaoV4(v5)).toEqual(normalizarConfiguracaoTop(v4ComRegras()));
  });

  it("F5-D7 a matriz das regras gerais no 5: a regra que a família não aceita volta, o 5 fica 5, nada aponta para a entrada", () => {
    const v5 = congelar(comoV5(v3Automatica()));
    const { configuracao, voltaram } = normalizarRegrasGeraisDaFamiliaTop(PEDIDO_COMPRA, v5);
    expect(voltaram).toEqual([{ caminho: "geral.confirmacao", de: "automatica", para: "manual" }]);
    expect(configuracao.versaoSchema).toBe(5);
    expect(configuracao.geral.confirmacao).toBe("manual");
    for (const s of ["geral", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"] as const) {
      expect(configuracao[s], s).not.toBe(v5[s]);
    }
    // A premissa: o mesmo conteúdo no 4 recusa e volta igual — o 5 é o 4 para a matriz.
    const v4: ConfiguracaoTipoOperacaoV4 = { ...clonar(v3Automatica()), versaoSchema: 4 };
    expect(validarRegrasGeraisTop(PEDIDO_COMPRA, v5)).toEqual(validarRegrasGeraisTop(PEDIDO_COMPRA, v4));
    expect(validarRegrasGeraisTop(PEDIDO_COMPRA, v5)).toHaveLength(1);
    expect(normalizarRegrasGeraisDaFamiliaTop(PEDIDO_COMPRA, v4).configuracao.versaoSchema).toBe(4);
  });

  it("F5-D7 a matriz copia as seções de extensão do 5 (com a lista do produto, nenhuma a mais)", () => {
    const v5 = comoV5(configuracaoNeutraTopV3());
    const { configuracao } = normalizarRegrasGeraisDaFamiliaTop(VENDA, v5);
    expect(Object.keys(configuracao).sort()).toEqual(Object.keys(v5).sort());
    expect(configuracao).toEqual(v5);
  });
});
