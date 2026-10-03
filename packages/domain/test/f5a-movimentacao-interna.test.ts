import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ptBR } from "@erp/plataforma";
import {
  ATENDIMENTOS_REQUISICAO_ESTOQUE,
  CAMPOS_DESTINO_ESTOQUE,
  CAPACIDADE_MOVIMENTACAO_INTERNA,
  CATALOGO_TIPOS_MOVIMENTO_TOP,
  ENUM_LABELS,
  ESPECIES_COM_DESTINO_ESTOQUE,
  ESPECIES_DOCUMENTO_ESTOQUE,
  ESPECIES_MOVIMENTACAO_INTERNA,
  EXIGENCIAS_DESTINO_TOP,
  EXIGENCIAS_GERAIS_ESTOQUE_TOP,
  EXIGENCIAS_REQUISICAO_TOP,
  LIMITE_JUSTIFICATIVA_SAIDA,
  MATRIZ_REGRAS_GERAIS_TOP,
  MOTIVOS_SAIDA_ESTOQUE,
  MOVIMENTOS_DA_ESPECIE_ESTOQUE,
  PERMISSION_RESOURCES,
  RECURSO_DA_ESPECIE_ESTOQUE,
  ROTULOS_EXIGENCIA_DESTINO_TOP,
  ROTULOS_EXIGENCIA_REQUISICAO_TOP,
  ROTULO_DA_ESPECIE_ESTOQUE,
  SECAO_DESTINO,
  SECAO_FLUXO,
  SEGMENTO_DA_ESPECIE_ESTOQUE,
  TABELA_DOCUMENTO_ESTOQUE,
  TIPOS_OPERACAO,
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  configuracaoNeutraTop,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracaoTopParaEdicaoV5,
  configuracoesTopIguais,
  ehFamiliaDeDocumentoEstoque,
  entendeMovimentacaoInterna,
  entidadeIdGlobal,
  enumLabel,
  escopoDoRecurso,
  especieDeOrigemEstoque,
  especieDoSegmentoEstoque,
  exigenciasGeraisDaFamiliaTop,
  familiaAceitaExecucaoConfiguradaTop,
  familiaOperacionalDeDocumentoEstoque,
  formato5Top,
  lerConfiguracaoTop,
  moduloDaPermissao,
  normalizarPeloPerfilTop,
  perfilDaFamiliaTop,
  recusasDoDestinoPelaTop,
  recusasDoFluxoDoConsumo,
  recusasDoPerfilTop,
  regrasGeraisDaFamiliaTop,
  resolverRegistroGlobal,
  resolverTipoOperacao,
  secoesAlteradasTop,
  secoesExtensaoDaVersaoTop,
  tipoOperacao,
  type ConfiguracaoTipoOperacao,
  type DimensaoDestinoEstoque,
  type PerfilDoTipoTop,
  type RecusaConfiguracaoTop,
  type SecaoDestinoTop,
  type SecaoFluxoTop,
} from "../src/index.js";

/**
 * OPERACOES-01 F5a (decisão 282) — A MOVIMENTAÇÃO INTERNA NO DOMÍNIO.
 *
 * MI-1 as listas de espécies (a Central de hoje continua com as quatro; TODAS = as quatro + as três).
 * MI-2 segmentos, recursos, rótulos, movimentos e origem das sete.
 * MI-3 as famílias pelo registry (a requisição NOVA não é a `estoque.requisicao` antiga), a matriz das regras gerais
 *      e os mapas que as famílias de documento de estoque herdam.
 * MI-4 o vocabulário da saída e do destino (motivos, justificativa, as seis dimensões, o atendimento).
 * MI-5 a seção Destino (leitura, recusa, `recusasDoDestinoPelaTop`).
 * MI-6 a seção Fluxo (leitura, `recusasDoFluxoDoConsumo`).
 * MI-7 os perfis, a recusa do formato 5 e o catálogo.
 * MI-8 a capacidade `movimentacaoInterna`.
 * MI-9 permissões, escopo e ID Global.
 * MI-10 a paridade com o banco (a migration que redefine os CHECKs da 0040 e o CHECK da baixa antiga, 0003).
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere o registry, e se ele mudar, falha alto.
 */

const REQUISICAO = "estoque.requisicao_material";
const CONSUMO = "estoque.consumo";
const DEVOLUCAO = "estoque.devolucao_consumo";
const SAIDA = "estoque.saida";
const ENTRADA = "estoque.entrada";

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Saco = Record<string, unknown>;
const sujar = (c: ConfiguracaoTipoOperacao): Saco => clonar(c) as unknown as Saco;

const perfil = (familia: string): PerfilDoTipoTop => {
  const p = perfilDaFamiliaTop(familia);
  if (!p) throw new Error(`sem perfil: ${familia}`);
  return p;
};

const valorDe = (bruto: unknown): ConfiguracaoTipoOperacao => {
  const r = lerConfiguracaoTop(bruto);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor;
};

const recusasDe = (bruto: unknown): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};

const raiz = (c: object): Readonly<Record<string, unknown>> => c as Readonly<Record<string, unknown>>;

/** A seção Destino no neutro com um ajuste. */
const destino = (ajuste: Partial<SecaoDestinoTop> = {}): SecaoDestinoTop => ({ ...SECAO_DESTINO.neutro(), ...ajuste });
/** A seção Fluxo no neutro com um ajuste. */
const fluxo = (ajuste: Partial<SecaoFluxoTop> = {}): SecaoFluxoTop => ({ ...SECAO_FLUXO.neutro(), ...ajuste });

/** Os valores finais do destino: todas nulas, menos as dadas. */
const valores = (dados: Partial<Record<DimensaoDestinoEstoque, string>> = {}): Record<DimensaoDestinoEstoque, string | null> => ({
  centroCusto: null, equipamento: null, ordemServico: null, loteAnimais: null, area: null, safra: null, ...dados,
});

/** Um 5 bruto (JSON) com estas seções de extensão. */
const v5Com = (secoes: Saco): Saco => ({ ...sujar(configuracaoNeutraTopV5()), ...secoes });

// ---------------------------------------------------------------------------------------------------
// MI-1 — as listas
// ---------------------------------------------------------------------------------------------------

describe("MI-1 as listas de espécies do documento de estoque", () => {
  it("MI-1 a Central de hoje continua com as QUATRO; a movimentação interna são três; TODAS = as quatro seguidas das três", () => {
    expect(ESPECIES_DOCUMENTO_ESTOQUE).toEqual(["entrada", "saida", "transferencia", "ajuste"]);
    expect(ESPECIES_MOVIMENTACAO_INTERNA).toEqual(["requisicao", "consumo", "devolucao_consumo"]);
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE).toEqual([...ESPECIES_DOCUMENTO_ESTOQUE, ...ESPECIES_MOVIMENTACAO_INTERNA]);
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE).toEqual(["entrada", "saida", "transferencia", "ajuste", "requisicao", "consumo", "devolucao_consumo"]);
    expect(new Set(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE).size).toBe(7);
    for (const lista of [ESPECIES_DOCUMENTO_ESTOQUE, ESPECIES_MOVIMENTACAO_INTERNA, TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]) {
      expect(Object.isFrozen(lista)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-2 — segmentos, recursos, rótulos, movimentos e origem
// ---------------------------------------------------------------------------------------------------

describe("MI-2 o vocabulário das sete espécies", () => {
  it("MI-2 os quatro mapas têm EXATAMENTE as sete espécies", () => {
    for (const mapa of [SEGMENTO_DA_ESPECIE_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, ROTULO_DA_ESPECIE_ESTOQUE, MOVIMENTOS_DA_ESPECIE_ESTOQUE]) {
      expect(Object.keys(mapa)).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
    }
  });

  it("MI-2 as três novas: segmento, recurso, rótulo (do dono dos rótulos) e movimento", () => {
    expect([SEGMENTO_DA_ESPECIE_ESTOQUE.requisicao, SEGMENTO_DA_ESPECIE_ESTOQUE.consumo, SEGMENTO_DA_ESPECIE_ESTOQUE.devolucao_consumo])
      .toEqual(["requisicoes", "consumos", "devolucoes-consumo"]);
    expect([RECURSO_DA_ESPECIE_ESTOQUE.requisicao, RECURSO_DA_ESPECIE_ESTOQUE.consumo, RECURSO_DA_ESPECIE_ESTOQUE.devolucao_consumo])
      .toEqual(["requisicoes_estoque", "consumos_estoque", "devolucoes_consumo_estoque"]);
    expect(ESPECIES_MOVIMENTACAO_INTERNA.map((e) => ROTULO_DA_ESPECIE_ESTOQUE[e])).toEqual(["Requisição", "Consumo", "Devolução de consumo"]);
    for (const e of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) expect(enumLabel("especie_documento_estoque", e), e).toBe(ROTULO_DA_ESPECIE_ESTOQUE[e]);
    // A requisição não move o razão (reserva); o consumo baixa e a devolução volta — tipos que já existem na 0003.
    expect(MOVIMENTOS_DA_ESPECIE_ESTOQUE.requisicao).toEqual([]);
    expect(MOVIMENTOS_DA_ESPECIE_ESTOQUE.consumo).toEqual(["requisition"]);
    expect(MOVIMENTOS_DA_ESPECIE_ESTOQUE.devolucao_consumo).toEqual(["devolution"]);
  });

  it("MI-2 especieDoSegmentoEstoque acha as SETE (só propriedade própria; o resto não é espécie)", () => {
    for (const e of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) expect(especieDoSegmentoEstoque(SEGMENTO_DA_ESPECIE_ESTOQUE[e]), e).toBe(e);
    expect(especieDoSegmentoEstoque("requisicoes")).toBe("requisicao");
    expect(especieDoSegmentoEstoque("devolucoes-consumo")).toBe("devolucao_consumo");
    for (const s of ["requisicao", "consumo", "devolucoes_consumo", "Consumos", "requisicoes ", "constructor", "__proto__"]) {
      expect(especieDoSegmentoEstoque(s), s).toBeUndefined();
    }
  });

  it("MI-2 a origem: o consumo puxa da requisição, a devolução do consumo; as outras cinco não têm origem", () => {
    expect(especieDeOrigemEstoque("consumo")).toBe("requisicao");
    expect(especieDeOrigemEstoque("devolucao_consumo")).toBe("consumo");
    for (const e of ["entrada", "saida", "transferencia", "ajuste", "requisicao"] as const) expect(especieDeOrigemEstoque(e), e).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-3 — as famílias pelo registry e a matriz
// ---------------------------------------------------------------------------------------------------

describe("MI-3 as famílias da movimentação interna no registry", () => {
  it("MI-3 a requisição NOVA é estoque.requisicao_material; a estoque.requisicao continua a de erp.requisitions", () => {
    // A premissa: a família antiga continua presa à tabela antiga, e não é documento de estoque.
    expect(tipoOperacao("estoque.requisicao")?.origem).toEqual({ tabela: "erp.requisitions" });
    expect(ehFamiliaDeDocumentoEstoque("estoque.requisicao")).toBe(false);
    expect(familiaOperacionalDeDocumentoEstoque("requisicao")).toBe(REQUISICAO);
    expect(familiaOperacionalDeDocumentoEstoque("consumo")).toBe(CONSUMO);
    expect(familiaOperacionalDeDocumentoEstoque("devolucao_consumo")).toBe(DEVOLUCAO);
  });

  it("MI-3 as três são variantes de erp.documentos_estoque por especie, no módulo estoque, com rótulo pt-BR", () => {
    const rotulos = { [REQUISICAO]: "Requisição de material", [CONSUMO]: "Consumo", [DEVOLUCAO]: "Devolução de consumo" };
    for (const [familia, especie] of [[REQUISICAO, "requisicao"], [CONSUMO, "consumo"], [DEVOLUCAO, "devolucao_consumo"]] as const) {
      const t = tipoOperacao(familia)!;
      expect(t.modulo, familia).toBe("estoque");
      expect(t.origem, familia).toEqual({ tabela: TABELA_DOCUMENTO_ESTOQUE, discriminador: "especie", valor: especie });
      expect(ptBR.mensagens[t.chaveI18n], familia).toBe(rotulos[familia]);
      expect(resolverTipoOperacao(TABELA_DOCUMENTO_ESTOQUE, especie)?.codigo, familia).toBe(familia);
      expect(ehFamiliaDeDocumentoEstoque(familia), familia).toBe(true);
    }
  });

  it("MI-3 a matriz das regras gerais tem as 13 famílias (com o orçamento de compra da F6a), e as três novas com a linha do estoque (Manual|Automática; Sem aprovação|Sempre)", () => {
    expect(MATRIZ_REGRAS_GERAIS_TOP).toHaveLength(13);
    const linhaDaEntrada = regrasGeraisDaFamiliaTop(ENTRADA);
    expect(linhaDaEntrada.confirmacao.aceitos, "a premissa: a linha do estoque").toEqual(["manual", "automatica"]);
    expect(linhaDaEntrada.aprovacao.aceitos, "a premissa: a linha do estoque").toEqual(["nenhuma", "sempre"]);
    for (const f of [REQUISICAO, CONSUMO, DEVOLUCAO]) {
      expect(MATRIZ_REGRAS_GERAIS_TOP.filter((m) => m.familia === f), f).toHaveLength(1);
      expect(clonar(regrasGeraisDaFamiliaTop(f)), f).toEqual({ ...clonar(linhaDaEntrada), familia: f });
    }
    // Na ordem do documento de estoque: as quatro de hoje e logo depois as três.
    const doEstoque = MATRIZ_REGRAS_GERAIS_TOP.map((m) => m.familia).filter((f) => ehFamiliaDeDocumentoEstoque(f));
    expect(doEstoque).toEqual(["estoque.entrada", SAIDA, "estoque.transferencia", "estoque.ajuste", REQUISICAO, CONSUMO, DEVOLUCAO]);
  });

  it("MI-3 as três herdam o que o documento de estoque é: só Observação, sem execução configurada", () => {
    for (const f of [REQUISICAO, CONSUMO, DEVOLUCAO]) {
      expect(exigenciasGeraisDaFamiliaTop(f), f).toBe(EXIGENCIAS_GERAIS_ESTOQUE_TOP);
      expect(familiaAceitaExecucaoConfiguradaTop(f), f).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-4 — saída e destino: o vocabulário
// ---------------------------------------------------------------------------------------------------

describe("MI-4 o vocabulário da saída, do destino e do atendimento", () => {
  it("MI-4 os 13 motivos da saída são as chaves de ENUM_LABELS.writeoff_reason, na mesma ordem; justificativa até 2000", () => {
    expect(MOTIVOS_SAIDA_ESTOQUE).toHaveLength(13);
    expect([...MOTIVOS_SAIDA_ESTOQUE]).toEqual(Object.keys(ENUM_LABELS.writeoff_reason));
    for (const m of MOTIVOS_SAIDA_ESTOQUE) expect(enumLabel("writeoff_reason", m).length, m).toBeGreaterThan(0);
    expect(LIMITE_JUSTIFICATIVA_SAIDA).toBe(2000);
  });

  it("MI-4 as seis dimensões do destino: chave, coluna e rótulo, na ordem da tela", () => {
    expect(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.chave, c.coluna, c.rotulo])).toEqual([
      ["centroCusto", "centro_custo_id", "Centro de resultado"],
      ["equipamento", "equipamento_id", "Máquina/equipamento"],
      ["ordemServico", "ordem_servico_id", "Ordem de serviço"],
      ["loteAnimais", "lote_animais_id", "Lote de animais"],
      ["area", "area_id", "Área/talhão"],
      ["safra", "safra_id", "Safra"],
    ]);
    expect(Object.isFrozen(CAMPOS_DESTINO_ESTOQUE)).toBe(true);
    expect(Object.isFrozen(CAMPOS_DESTINO_ESTOQUE[0])).toBe(true);
    for (const c of CAMPOS_DESTINO_ESTOQUE) expect(/armaz/i.test(c.rotulo), c.rotulo).toBe(false);
  });

  it("MI-4 levam destino a saída e a movimentação interna; entrada, transferência e ajuste não", () => {
    expect(ESPECIES_COM_DESTINO_ESTOQUE).toEqual(["saida", "requisicao", "consumo", "devolucao_consumo"]);
    for (const e of ["entrada", "transferencia", "ajuste"] as const) expect(ESPECIES_COM_DESTINO_ESTOQUE.includes(e), e).toBe(false);
  });

  it("MI-4 o atendimento da requisição: quatro estados calculados, com rótulo", () => {
    expect(ATENDIMENTOS_REQUISICAO_ESTOQUE).toEqual(["pendente", "parcial", "atendido", "encerrado"]);
    expect(ATENDIMENTOS_REQUISICAO_ESTOQUE.map((a) => enumLabel("atendimento_requisicao_estoque", a)))
      .toEqual(["Pendente", "Atendida em parte", "Atendida", "Saldo encerrado"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-5 — a seção Destino
// ---------------------------------------------------------------------------------------------------

describe("MI-5 a seção Destino do formato 5", () => {
  it("MI-5 a definição: nome, rótulo, ajuda, as seis chaves e o neutro 'não usada' em todas", () => {
    expect(SECAO_DESTINO.nome).toBe("destino");
    expect(SECAO_DESTINO.rotulo).toBe("Destino");
    expect(SECAO_DESTINO.ajuda).toBe(
      "O destino diz para onde vai o que sai do estoque: centro de resultado, máquina/equipamento, ordem de serviço, lote de animais, área/talhão e safra. Cada um pode ser não usado, opcional ou obrigatório nesta operação. Vale para a requisição, o consumo e a saída; o consumo que atende uma requisição leva o destino dela, e a devolução de consumo leva o do consumo.",
    );
    expect(SECAO_DESTINO.chaves).toEqual(CAMPOS_DESTINO_ESTOQUE.map((c) => c.chave));
    expect(SECAO_DESTINO.neutro()).toEqual({ centroCusto: "nao_usada", equipamento: "nao_usada", ordemServico: "nao_usada", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada" });
    expect(EXIGENCIAS_DESTINO_TOP).toEqual(["nao_usada", "opcional", "obrigatoria"]);
    expect(ROTULOS_EXIGENCIA_DESTINO_TOP).toEqual({ nao_usada: "Não usada", opcional: "Opcional", obrigatoria: "Obrigatória" });
    expect(Object.isFrozen(SECAO_DESTINO)).toBe(true);
  });

  it("MI-5 as linhas do histórico: rótulo da dimensão e da exigência, na ordem", () => {
    expect(SECAO_DESTINO.linhas(destino({ centroCusto: "obrigatoria", area: "opcional" }))).toEqual([
      ["Centro de resultado", "Obrigatória"],
      ["Máquina/equipamento", "Não usada"],
      ["Ordem de serviço", "Não usada"],
      ["Lote de animais", "Não usada"],
      ["Área/talhão", "Opcional"],
      ["Safra", "Não usada"],
    ]);
  });

  it("MI-5 usada pela requisição, pelo consumo e pela saída — nunca pela devolução, pelas outras do estoque nem pela família antiga", () => {
    for (const f of [REQUISICAO, CONSUMO, SAIDA]) expect(SECAO_DESTINO.usadaPor(f), f).toBe(true);
    for (const f of [DEVOLUCAO, ENTRADA, "estoque.transferencia", "estoque.ajuste", "estoque.requisicao", "estoque.baixa", "vendas.venda", "", "constructor"]) {
      expect(SECAO_DESTINO.usadaPor(f), f).toBe(false);
    }
  });

  it("MI-5 lerConfiguracaoTop de um 5 com o destino: lido campo a campo; ausente → neutro", () => {
    const d = destino({ centroCusto: "obrigatoria", equipamento: "opcional", safra: "obrigatoria" });
    const lido = valorDe(v5Com({ destino: { ...d } }));
    expect(lido.versaoSchema).toBe(5);
    expect(raiz(lido).destino).toEqual(d);
    const { destino: _semDestino, ...semADestino } = v5Com({});
    expect(Object.hasOwn(semADestino, "destino"), "a premissa: o bruto não tem a seção").toBe(false);
    expect(raiz(valorDe(semADestino)).destino).toEqual(SECAO_DESTINO.neutro());
  });

  it("MI-5 chave desconhecida, valor fora, tipo errado e seção que falta campo → recusa no caminho", () => {
    expect(recusasDe(v5Com({ destino: { ...destino(), x: "opcional" } }))).toEqual([{ motivo: "campo_desconhecido", caminho: "destino.x" }]);
    expect(recusasDe(v5Com({ destino: { ...destino(), area: "sempre" } }))).toEqual([{ motivo: "valor_invalido", caminho: "destino.area" }]);
    expect(recusasDe(v5Com({ destino: { ...destino(), safra: true } }))).toEqual([{ motivo: "tipo_invalido", caminho: "destino.safra" }]);
    const { loteAnimais: _semLote, ...semUmCampo } = destino();
    expect(recusasDe(v5Com({ destino: semUmCampo }))).toEqual([{ motivo: "tipo_invalido", caminho: "destino.loteAnimais" }]);
    expect(recusasDe(v5Com({ destino: "obrigatoria" }))).toEqual([{ motivo: "tipo_invalido", caminho: "destino" }]);
    // Ordem das recusas = a das dimensões.
    expect(recusasDe(v5Com({ destino: { ...destino(), safra: "x", centroCusto: "y" } }))).toEqual([
      { motivo: "valor_invalido", caminho: "destino.centroCusto" },
      { motivo: "valor_invalido", caminho: "destino.safra" },
    ]);
  });

  it("MI-5 num formato 1 a 4 a chave `destino` é RECUSADA (o 4 nunca carrega seção nova)", () => {
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV4()]) {
      expect(recusasDe({ ...sujar(c), destino: destino() }), `formato ${c.versaoSchema}`).toEqual([{ motivo: "campo_desconhecido", caminho: "destino" }]);
    }
  });

  it("MI-5 a execução lê o destino da versão: 1 a 4 → neutro; 5 → o dela", () => {
    expect(raiz(secoesExtensaoDaVersaoTop(configuracaoNeutraTop())).destino).toEqual(SECAO_DESTINO.neutro());
    const d = destino({ ordemServico: "obrigatoria" });
    expect(raiz(secoesExtensaoDaVersaoTop(valorDe(v5Com({ destino: d })))).destino).toEqual(d);
  });

  it("MI-5 salvar o 4 como 5 no neutro NÃO é mudança; ligar uma dimensão é mudança da seção Destino", () => {
    const v4 = configuracaoNeutraTopV4();
    expect(configuracoesTopIguais(v4, configuracaoTopParaEdicaoV5(v4))).toBe(true);
    const ligado = valorDe(v5Com({ destino: destino({ centroCusto: "obrigatoria" }) }));
    expect(configuracoesTopIguais(v4, ligado)).toBe(false);
    expect(secoesAlteradasTop(v4, ligado)).toEqual(["destino"]);
  });
});

describe("MI-5 recusasDoDestinoPelaTop", () => {
  it("MI-5 no neutro, nada informado → nenhuma recusa (o comportamento de hoje)", () => {
    expect(recusasDoDestinoPelaTop(SECAO_DESTINO.neutro(), valores(), new Set())).toEqual([]);
  });

  it("MI-5 informada com a TOP dizendo 'não usada' → recusa na coluna, com a mensagem exata", () => {
    expect(recusasDoDestinoPelaTop(destino(), valores({ equipamento: "e1" }), new Set(["equipamento"]))).toEqual([
      { chave: "equipamento", coluna: "equipamento_id", mensagem: "Esta operação não usa máquina/equipamento." },
    ]);
  });

  it("MI-5 obrigatória sem valor final → recusa; cada uma das seis com a sua mensagem", () => {
    const todas = destino({ centroCusto: "obrigatoria", equipamento: "obrigatoria", ordemServico: "obrigatoria", loteAnimais: "obrigatoria", area: "obrigatoria", safra: "obrigatoria" });
    expect(recusasDoDestinoPelaTop(todas, valores(), new Set())).toEqual([
      { chave: "centroCusto", coluna: "centro_custo_id", mensagem: "Esta operação exige centro de resultado." },
      { chave: "equipamento", coluna: "equipamento_id", mensagem: "Esta operação exige máquina/equipamento." },
      { chave: "ordemServico", coluna: "ordem_servico_id", mensagem: "Esta operação exige ordem de serviço." },
      { chave: "loteAnimais", coluna: "lote_animais_id", mensagem: "Esta operação exige lote de animais." },
      { chave: "area", coluna: "area_id", mensagem: "Esta operação exige área/talhão." },
      { chave: "safra", coluna: "safra_id", mensagem: "Esta operação exige safra." },
    ]);
  });

  it("MI-5 a obrigatória é satisfeita pelo valor informado OU herdado da requisição", () => {
    const secao = destino({ centroCusto: "obrigatoria" });
    // A premissa: sem valor, recusa.
    expect(recusasDoDestinoPelaTop(secao, valores(), new Set())).toHaveLength(1);
    expect(recusasDoDestinoPelaTop(secao, valores({ centroCusto: "c1" }), new Set(["centroCusto"]))).toEqual([]);
    expect(recusasDoDestinoPelaTop(secao, valores({ centroCusto: "c1" }), new Set()), "herdada").toEqual([]);
  });

  it("MI-5 a herdada que a TOP do consumo não usa NÃO é recusada (quem a escolheu foi a requisição)", () => {
    expect(recusasDoDestinoPelaTop(destino(), valores({ area: "a1" }), new Set())).toEqual([]);
    // A premissa: a mesma dimensão INFORMADA é recusada.
    expect(recusasDoDestinoPelaTop(destino(), valores({ area: "a1" }), new Set(["area"]))).toHaveLength(1);
  });

  it("MI-5 opcional passa informada ou vazia", () => {
    const secao = destino({ loteAnimais: "opcional" });
    expect(recusasDoDestinoPelaTop(secao, valores({ loteAnimais: "l1" }), new Set(["loteAnimais"]))).toEqual([]);
    expect(recusasDoDestinoPelaTop(secao, valores(), new Set())).toEqual([]);
  });

  it("MI-5 as recusas saem na ordem das dimensões, misturando 'não usa' e 'exige'", () => {
    const secao = destino({ area: "obrigatoria" });
    expect(recusasDoDestinoPelaTop(secao, valores({ centroCusto: "c1" }), new Set(["centroCusto"])).map((r) => r.mensagem)).toEqual([
      "Esta operação não usa centro de resultado.",
      "Esta operação exige área/talhão.",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-6 — a seção Fluxo
// ---------------------------------------------------------------------------------------------------

describe("MI-6 a seção Fluxo do formato 5", () => {
  it("MI-6 a definição: nome, rótulo, ajuda, as chaves e o neutro (consumo direto, atende em parte)", () => {
    expect(SECAO_FLUXO.nome).toBe("fluxo");
    expect(SECAO_FLUXO.rotulo).toBe("Fluxo");
    expect(SECAO_FLUXO.ajuda).toBe(
      "O fluxo diz se o consumo precisa vir de uma requisição de material e se pode atender a requisição em parte. No padrão, o consumo pode ser lançado direto e atende em parte.",
    );
    expect(SECAO_FLUXO.chaves).toEqual(["exigeRequisicao", "permiteParcial"]);
    expect(SECAO_FLUXO.neutro()).toEqual({ exigeRequisicao: "nao", permiteParcial: true });
    expect(EXIGENCIAS_REQUISICAO_TOP).toEqual(["nao", "algum_item", "todos"]);
    expect(ROTULOS_EXIGENCIA_REQUISICAO_TOP).toEqual({ nao: "Não", algum_item: "Em algum item", todos: "Em todos os itens" });
    expect(SECAO_FLUXO.linhas(fluxo({ exigeRequisicao: "todos", permiteParcial: false }))).toEqual([
      ["Exigir requisição", "Em todos os itens"],
      ["Atender requisição em parte", "Não"],
    ]);
  });

  it("MI-6 usada SÓ pelo consumo", () => {
    expect(SECAO_FLUXO.usadaPor(CONSUMO)).toBe(true);
    for (const f of [REQUISICAO, DEVOLUCAO, SAIDA, ENTRADA, "estoque.requisicao", "compras.pedido", ""]) expect(SECAO_FLUXO.usadaPor(f), f).toBe(false);
  });

  it("MI-6 lida estrita num 5; ausente → neutro; num 4, recusada", () => {
    const f = fluxo({ exigeRequisicao: "algum_item", permiteParcial: false });
    expect(raiz(valorDe(v5Com({ fluxo: { ...f } }))).fluxo).toEqual(f);
    expect(recusasDe(v5Com({ fluxo: { ...f, exigeRequisicao: "sempre" } }))).toEqual([{ motivo: "valor_invalido", caminho: "fluxo.exigeRequisicao" }]);
    expect(recusasDe(v5Com({ fluxo: { ...f, permiteParcial: "nao" } }))).toEqual([{ motivo: "tipo_invalido", caminho: "fluxo.permiteParcial" }]);
    expect(recusasDe(v5Com({ fluxo: { ...f, extra: 1 } }))).toEqual([{ motivo: "campo_desconhecido", caminho: "fluxo.extra" }]);
    const { fluxo: _semFluxo, ...semAFluxo } = v5Com({});
    expect(raiz(valorDe(semAFluxo)).fluxo).toEqual(SECAO_FLUXO.neutro());
    expect(recusasDe({ ...sujar(configuracaoNeutraTopV4()), fluxo: f })).toEqual([{ motivo: "campo_desconhecido", caminho: "fluxo" }]);
  });
});

describe("MI-6 recusasDoFluxoDoConsumo", () => {
  const SEM_ORIGEM = { temOrigem: false, ligados: [false, false], atendeTudo: false };
  const ORIGEM_NENHUM_LIGADO = { temOrigem: true, ligados: [false, false], atendeTudo: false };
  const ORIGEM_PARTE = { temOrigem: true, ligados: [true, false, true, false], atendeTudo: false };
  const ORIGEM_TUDO = { temOrigem: true, ligados: [true, true], atendeTudo: true };

  it("MI-6 no neutro nada é recusado: consumo direto e atendimento parcial (o comportamento de hoje)", () => {
    for (const c of [SEM_ORIGEM, ORIGEM_NENHUM_LIGADO, ORIGEM_PARTE, ORIGEM_TUDO]) expect(recusasDoFluxoDoConsumo(SECAO_FLUXO.neutro(), c)).toEqual([]);
  });

  it("MI-6 'algum item' ou 'todos' sem requisição de origem → origem_documento_id", () => {
    for (const exigeRequisicao of ["algum_item", "todos"] as const) {
      expect(recusasDoFluxoDoConsumo(fluxo({ exigeRequisicao }), SEM_ORIGEM), exigeRequisicao).toEqual([
        { caminho: "origem_documento_id", mensagem: "Esta operação exige requisição: informe a requisição de origem." },
      ]);
    }
  });

  it("MI-6 'algum item' com origem e nenhum item ligado → itens; com um ligado, passa", () => {
    expect(recusasDoFluxoDoConsumo(fluxo({ exigeRequisicao: "algum_item" }), ORIGEM_NENHUM_LIGADO)).toEqual([
      { caminho: "itens", mensagem: "Esta operação exige ao menos um item da requisição." },
    ]);
    expect(recusasDoFluxoDoConsumo(fluxo({ exigeRequisicao: "algum_item" }), ORIGEM_PARTE)).toEqual([]);
  });

  it("MI-6 'todos' → cada item não ligado, no caminho dele; todos ligados, passa", () => {
    expect(recusasDoFluxoDoConsumo(fluxo({ exigeRequisicao: "todos" }), ORIGEM_PARTE)).toEqual([
      { caminho: "itens.1.origem_item_id", mensagem: "Esta operação exige que todo item venha da requisição." },
      { caminho: "itens.3.origem_item_id", mensagem: "Esta operação exige que todo item venha da requisição." },
    ]);
    expect(recusasDoFluxoDoConsumo(fluxo({ exigeRequisicao: "todos" }), ORIGEM_TUDO)).toEqual([]);
  });

  it("MI-6 sem atendimento parcial: com origem, levar parte → itens; levar tudo passa; sem origem não se aplica", () => {
    const secao = fluxo({ permiteParcial: false });
    expect(recusasDoFluxoDoConsumo(secao, ORIGEM_PARTE)).toEqual([
      { caminho: "itens", mensagem: "Esta operação não atende requisição em parte: leve o saldo inteiro de todos os itens pendentes da requisição." },
    ]);
    expect(recusasDoFluxoDoConsumo(secao, ORIGEM_TUDO)).toEqual([]);
    expect(recusasDoFluxoDoConsumo(secao, SEM_ORIGEM)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-7 — perfis, recusa do 5 e catálogo
// ---------------------------------------------------------------------------------------------------

describe("MI-7 os perfis, a recusa do formato 5 e o catálogo", () => {
  it("MI-7 os perfis das três novas e da saída", () => {
    expect(perfil(REQUISICAO).abas).toEqual(["identificacao", "geral", "estoque", "destino", "aprovacao"]);
    expect(perfil(REQUISICAO).secoesNeutras).toEqual(["estoque", "financeiro", "fiscal", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    expect(perfil(CONSUMO).abas).toEqual(["identificacao", "geral", "estoque", "destino", "fluxo", "aprovacao"]);
    expect(perfil(CONSUMO).secoesNeutras).toEqual(["estoque", "financeiro", "fiscal", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    expect(perfil(DEVOLUCAO).abas).toEqual(["identificacao", "geral", "estoque", "aprovacao"]);
    expect(perfil(DEVOLUCAO).secoesNeutras).toEqual(["estoque", "financeiro", "fiscal", "destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    expect(perfil(SAIDA).abas).toEqual(["identificacao", "geral", "estoque", "destino", "aprovacao"]);
    for (const f of [REQUISICAO, CONSUMO, DEVOLUCAO]) expect(perfil(f).exigencias.map((e) => e.rotulo), f).toEqual(["Observação"]);
  });

  it("MI-7 entrada, transferência e ajuste: sem Destino e sem Fluxo (as duas no padrão)", () => {
    for (const f of [ENTRADA, "estoque.transferencia", "estoque.ajuste"]) {
      expect(perfil(f).abas, f).toEqual(["identificacao", "geral", "estoque", "aprovacao"]);
      expect(perfil(f).secoesNeutras, f).toEqual(["estoque", "financeiro", "fiscal", "destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    }
  });

  it("MI-7 a saída no 5 com Fluxo fora do neutro → 'Esta operação não usa a seção Fluxo.'; o Destino passa", () => {
    const c = valorDe(v5Com({ fluxo: fluxo({ exigeRequisicao: "todos" }), destino: destino({ centroCusto: "obrigatoria" }) }));
    expect(recusasDoPerfilTop(SAIDA, c)).toEqual([{ motivo: "combinacao_nao_suportada", caminho: "fluxo", mensagem: "Esta operação não usa a seção Fluxo." }]);
    // A premissa: no consumo a MESMA configuração é aceita (usa as duas).
    expect(recusasDoPerfilTop(CONSUMO, c)).toEqual([]);
  });

  it("MI-7 a entrada no 5 com Destino fora do neutro → 'Esta operação não usa a seção Destino.'; o editor volta ao padrão antes de gravar", () => {
    const c = valorDe(v5Com({ destino: destino({ safra: "opcional" }) }));
    expect(recusasDoPerfilTop(ENTRADA, c)).toEqual([{ motivo: "combinacao_nao_suportada", caminho: "destino", mensagem: "Esta operação não usa a seção Destino." }]);
    if (!formato5Top(c)) throw new Error("premissa: o lido é um 5");
    const { configuracao, voltaram } = normalizarPeloPerfilTop(perfil(ENTRADA), c);
    expect(voltaram).toEqual([{ caminho: "destino", texto: "Destino: volta ao padrão" }]);
    expect(raiz(configuracao).destino).toEqual(SECAO_DESTINO.neutro());
    expect(recusasDoPerfilTop(ENTRADA, configuracao)).toEqual([]);
  });

  it("MI-7 o catálogo: requisição, consumo e devolução de consumo com a família LIGADA e COM tela (a F5b ligou: a Central de Estoque no motor)", () => {
    const tipos = CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => ["requisicao", "consumo", "devolucao_consumo"].includes(t.chave));
    // A premissa: as três famílias existem no registry (`temTela` só vale com família).
    for (const f of [REQUISICAO, CONSUMO, DEVOLUCAO]) expect(tipoOperacao(f)?.origem.tabela, f).toBe("erp.documentos_estoque");
    expect(tipos.map((t) => [t.chave, t.grupo, t.rotulo, t.familia, t.temTela])).toEqual([
      ["requisicao", "movimentacao_interna", "Requisição", REQUISICAO, true],
      ["consumo", "movimentacao_interna", "Consumo", CONSUMO, true],
      ["devolucao_consumo", "movimentacao_interna", "Devolução de consumo", DEVOLUCAO, true],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-8 — a capacidade
// ---------------------------------------------------------------------------------------------------

describe("MI-8 a capacidade movimentacaoInterna", () => {
  it("MI-8 só o objeto com movimentacaoInterna === 1 (propriedade própria, de dado) entende a movimentação interna", () => {
    expect(CAPACIDADE_MOVIMENTACAO_INTERNA).toBe(1);
    expect(entendeMovimentacaoInterna({ movimentacaoInterna: 1 })).toBe(true);
    expect(entendeMovimentacaoInterna({ documentoEstoque: 1, movimentacaoInterna: 1 })).toBe(true);
    const recusados: readonly unknown[] = [
      { movimentacaoInterna: 2 }, { movimentacaoInterna: "1" }, { movimentacaoInterna: true }, { documentoEstoque: 1 }, {},
      null, undefined, 1, "movimentacaoInterna", [1], Object.create({ movimentacaoInterna: 1 }),
      Object.defineProperty({}, "movimentacaoInterna", { get: () => 1, enumerable: true }),
    ];
    for (const c of recusados) expect(entendeMovimentacaoInterna(c), String(JSON.stringify(c))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-9 — permissões, escopo e ID Global
// ---------------------------------------------------------------------------------------------------

describe("MI-9 permissões, escopo e ID Global", () => {
  it("MI-9 três recursos em Operacional > Estoque, view/create/edit/approve (sem delete), escopo de empresa no módulo estoque", () => {
    const esperados = [["requisicoes_estoque", "Requisições de Material"], ["consumos_estoque", "Consumos de Estoque"], ["devolucoes_consumo_estoque", "Devoluções de Consumo"]] as const;
    for (const [chave, rotulo] of esperados) {
      const r = PERMISSION_RESOURCES.find((x) => x.key === chave);
      expect(r, chave).toBeDefined();
      expect(r?.label, chave).toBe(rotulo);
      expect(r?.module, chave).toBe("Operacional > Estoque");
      expect(r?.actions, chave).toEqual(["view", "create", "edit", "approve"]);
      for (const acao of ["view", "create", "edit", "approve"]) expect(moduloDaPermissao(`${chave}.${acao}`), `${chave}.${acao}`).toBe("estoque");
      expect(escopoDoRecurso(chave)).toEqual({ tipo: "empresa", modulo: "estoque" });
    }
  });

  it("MI-9 ID Global: as três rotas de detalhe e permissões distintas, uma por espécie", () => {
    const e = entidadeIdGlobal("documentos_estoque");
    expect(e?.tabela).toBe("erp.documentos_estoque");
    expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie: "requisicao" }))
      .toEqual({ rota: "/estoque/movimentacoes/requisicoes/u1", permissao: "requisicoes_estoque.view" });
    expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie: "consumo" }))
      .toEqual({ rota: "/estoque/movimentacoes/consumos/u1", permissao: "consumos_estoque.view" });
    expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie: "devolucao_consumo" }))
      .toEqual({ rota: "/estoque/movimentacoes/devolucoes-consumo/u1", permissao: "devolucoes_consumo_estoque.view" });
    const permissoes = TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.map((especie) => resolverRegistroGlobal("documentos_estoque", "u1", { especie })?.permissao);
    expect(new Set(permissoes).size, "uma permissão por espécie").toBe(7);
    for (const especie of ["requisicoes", "devolucao-consumo", "Consumo"]) expect(resolverRegistroGlobal("documentos_estoque", "u1", { especie }), especie).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// MI-10 — a paridade com o banco
// ---------------------------------------------------------------------------------------------------

const DIR_MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/**
 * A lista `in (...)` da ÚLTIMA migration (pela ordem do número) que casa `padrao` (com `g`), e o arquivo dela. A
 * última é a que vale no banco: a 0043 redefine os CHECKs da 0040 com `drop constraint … add constraint`.
 */
function listaDaUltimaMigration(padrao: RegExp): { arquivo: string; valores: string[] } | null {
  const arquivos = readdirSync(DIR_MIGRATIONS).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().reverse();
  for (const arquivo of arquivos) {
    const achados = [...readFileSync(join(DIR_MIGRATIONS, arquivo), "utf8").matchAll(padrao)];
    const ultimo = achados.at(-1);
    if (ultimo?.[1] !== undefined) return { arquivo, valores: [...ultimo[1].matchAll(/'([^']*)'/g)].map((x) => x[1] ?? "") };
  }
  return null;
}

describe("MI-10 a paridade do domínio com os CHECKs do banco", () => {
  it("MI-10 os 13 motivos são os do CHECK da baixa antiga (erp.stock_writeoffs.reason, 0003), na mesma ordem", () => {
    const r = listaDaUltimaMigration(/reason\s+text\s+not\s+null\s+check\s*\(\s*reason\s+in\s*\(([^)]*)\)/gi);
    expect(r?.arquivo, "a premissa: o CHECK é o da 0003").toMatch(/^0003_/);
    expect(r?.valores).toEqual([...MOTIVOS_SAIDA_ESTOQUE]);
  });

  it("MI-10 a espécie do cabeçalho e do item: a migration que redefine os CHECKs da 0040 tem as SETE espécies do domínio", () => {
    for (const nome of ["chk_documentos_estoque_especie", "chk_documentos_estoque_itens_especie"]) {
      const r = listaDaUltimaMigration(new RegExp(`constraint\\s+${nome}\\s+check\\s*\\(\\s*especie\\s+in\\s*\\(([^)]*)\\)`, "gi"));
      expect(r?.arquivo && r.arquivo >= "0043", `${nome}: a premissa — a última definição é da 0043 ou depois (${r?.arquivo})`).toBe(true);
      expect([...(r?.valores ?? [])].sort(), nome).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE].sort());
    }
    const doRegistry = TIPOS_OPERACAO.filter((t) => t.origem.tabela === TABELA_DOCUMENTO_ESTOQUE).map((t) => t.origem.valor);
    expect(doRegistry, "o registry declara as mesmas sete").toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
  });

  it("MI-10 o motivo da saída no documento de estoque: o CHECK tem os 13 motivos do domínio, na mesma ordem", () => {
    const r = listaDaUltimaMigration(/motivo_saida\s+in\s*\(([^)]*)\)/gi);
    expect(r?.arquivo && r.arquivo >= "0043", `a premissa — o CHECK nasce na 0043 (${r?.arquivo})`).toBe(true);
    expect(r?.valores).toEqual([...MOTIVOS_SAIDA_ESTOQUE]);
  });

  it("MI-10 o layout por TOP aceita as sete famílias do documento de estoque (preparação da F5b)", () => {
    const r = listaDaUltimaMigration(/constraint\s+chk_layouts_documento_familia\s+check\s*\(\s*familia\s+in\s*\(([^)]*)\)/gi);
    expect(r?.arquivo && r.arquivo >= "0043", `a premissa — redefinido na 0043 ou depois (${r?.arquivo})`).toBe(true);
    const familias = TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.map((e) => familiaOperacionalDeDocumentoEstoque(e));
    expect(familias.every((f) => typeof f === "string")).toBe(true);
    expect(r?.valores).toEqual(expect.arrayContaining(familias));
  });
});
