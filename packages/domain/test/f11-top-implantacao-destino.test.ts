import { describe, it, expect } from "vitest";
import {
  CAMPOS_DESTINO_ESTOQUE,
  CAPACIDADE_SALDO_INICIAL_ESTOQUE,
  DEFINICOES_SECOES_V5,
  SECAO_DESTINO,
  SECAO_IMPLANTACAO,
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  configuracaoNeutraTop,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  entendeSaldoInicialEstoque,
  familiaOperacionalDeDocumentoEstoque,
  lerConfiguracaoTop,
  recusasDoDestinoPelaTop,
  recusasDoPerfilTop,
  regrasDaOperacaoDoEstoque,
  saldoInicialPelaTop,
  type ConfiguracaoTipoOperacao,
  type DimensaoDestinoEstoque,
  type RecusaConfiguracaoTop,
  type SecaoDestinoTop,
} from "../src/index.js";

/**
 * OPERACOES-01 F11 (decisão 288) — O NEUTRO DO DESTINO E A SEÇÃO IMPLANTAÇÃO (o I-2 e o I-3(a) da F5a).
 *
 * D1 o neutro do Destino é "opcional" nas seis dimensões: a TOP sem a seção (formatos 1 a 4, versão ilegível) aceita
 *    o destino como a baixa e a requisição antigas aceitavam, e nada é exigido. "Não usada" só quando gravada.
 * I1 a seção `implantacao`: neutro `{ saldoInicial: false }`, só a família da espécie `entrada`, leitura estrita,
 *    linhas do histórico.
 * I2 `saldoInicialPelaTop`: só com a seção LIGADA num 5, na família da entrada.
 * I3 `entendeSaldoInicialEstoque`: o leitor estrito da capacidade.
 * I4 o 5 neutro traz a seção desligada, e a seção ligada numa TOP que não é de entrada é recusada pelo perfil.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere o registry, e se ele mudar, falha alto.
 */

const ENTRADA = "estoque.entrada";
const SAIDA = "estoque.saida";

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Saco = Record<string, unknown>;

/** Um 5 bruto (JSON) — o neutro do 5 com estas seções de extensão sobrepostas. */
const v5Com = (secoes: Saco): Saco => ({ ...(clonar(configuracaoNeutraTopV5()) as unknown as Saco), ...secoes });

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

const SEIS_OPCIONAIS: SecaoDestinoTop = {
  centroCusto: "opcional", equipamento: "opcional", ordemServico: "opcional", loteAnimais: "opcional", area: "opcional", safra: "opcional",
};
const SEIS_NAO_USADAS: SecaoDestinoTop = {
  centroCusto: "nao_usada", equipamento: "nao_usada", ordemServico: "nao_usada", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada",
};

/** Os valores finais do destino: todas nulas, menos as dadas. */
const valores = (dados: Partial<Record<DimensaoDestinoEstoque, string>> = {}): Record<DimensaoDestinoEstoque, string | null> => ({
  centroCusto: null, equipamento: null, ordemServico: null, loteAnimais: null, area: null, safra: null, ...dados,
});

// ---------------------------------------------------------------------------------------------------
// D1 — o neutro do Destino
// ---------------------------------------------------------------------------------------------------

describe("D1 o neutro do Destino é Opcional (288)", () => {
  it("D1 SECAO_DESTINO.neutro() = as seis em 'opcional'; objeto novo a cada chamada", () => {
    expect(CAMPOS_DESTINO_ESTOQUE.map((c) => c.chave), "a premissa: são as seis dimensões").toEqual([
      "centroCusto", "equipamento", "ordemServico", "loteAnimais", "area", "safra",
    ]);
    expect(SECAO_DESTINO.neutro()).toEqual(SEIS_OPCIONAIS);
    expect(SECAO_DESTINO.neutro()).not.toBe(SECAO_DESTINO.neutro());
  });

  it("D1 a TOP sem a seção (configuração nula, formato 1, formato 4, ilegível) → as regras da saída dão as seis em 'opcional'", () => {
    const familiaDaSaida = familiaOperacionalDeDocumentoEstoque("saida");
    expect(familiaDaSaida, "a premissa: a família da saída é a do registry").toBe(SAIDA);
    const semSecao: readonly unknown[] = [null, configuracaoNeutraTop(), configuracaoNeutraTopV4(), { versaoSchema: 99 }];
    for (const c of semSecao) {
      expect(regrasDaOperacaoDoEstoque(SAIDA, c).destino, JSON.stringify(c).slice(0, 30)).toEqual(SEIS_OPCIONAIS);
    }
  });

  it("D1 no neutro, o destino INFORMADO é aceito (nenhuma recusa); com 'nao_usada' a MESMA chamada recusa", () => {
    const informado = valores({ centroCusto: "c1" });
    const informadas = new Set<DimensaoDestinoEstoque>(["centroCusto"]);
    // A premissa: a TOP que grava "não usada" recusa o centro informado.
    expect(recusasDoDestinoPelaTop(SEIS_NAO_USADAS, informado, informadas)).toEqual([
      { chave: "centroCusto", coluna: "centro_custo_id", mensagem: "Esta operação não usa centro de resultado." },
    ]);
    // A conclusão: o neutro (Opcional) aceita.
    expect(recusasDoDestinoPelaTop(SECAO_DESTINO.neutro(), informado, informadas)).toEqual([]);
    // E nada é exigido: nada informado também passa.
    expect(recusasDoDestinoPelaTop(SECAO_DESTINO.neutro(), valores(), new Set())).toEqual([]);
  });

  it("D1 o 5 gravado SEM a seção Destino é lido no neutro novo; o 5 com 'nao_usada' explícito continua 'nao_usada'", () => {
    const { destino: _semDestino, ...semADestino } = v5Com({});
    expect(Object.hasOwn(semADestino, "destino"), "a premissa: o bruto não tem a seção").toBe(false);
    expect(regrasDaOperacaoDoEstoque(SAIDA, valorDe(semADestino)).destino).toEqual(SEIS_OPCIONAIS);
    expect(regrasDaOperacaoDoEstoque(SAIDA, v5Com({ destino: { ...SEIS_NAO_USADAS } })).destino).toEqual(SEIS_NAO_USADAS);
  });
});

// ---------------------------------------------------------------------------------------------------
// I1 — a seção Implantação
// ---------------------------------------------------------------------------------------------------

describe("I1 a seção Implantação do formato 5", () => {
  it("I1 a definição: nome, rótulo, ajuda, a chave e o neutro desligado; congelada; na lista depois de Padrões financeiros", () => {
    expect(SECAO_IMPLANTACAO.nome).toBe("implantacao");
    expect(SECAO_IMPLANTACAO.rotulo).toBe("Implantação");
    expect(SECAO_IMPLANTACAO.ajuda).toBe(
      "Marque quando esta entrada lança o saldo inicial do estoque (a implantação). O movimento passa a ser \"Estoque inicial\" e o mesmo produto, local de estoque e lote não recebe dois saldos iniciais: o segundo é recusado até o primeiro ser cancelado. No padrão, a entrada é comum.",
    );
    expect(SECAO_IMPLANTACAO.chaves).toEqual(["saldoInicial"]);
    expect(SECAO_IMPLANTACAO.neutro()).toEqual({ saldoInicial: false });
    expect(SECAO_IMPLANTACAO.neutro()).not.toBe(SECAO_IMPLANTACAO.neutro());
    expect(Object.isFrozen(SECAO_IMPLANTACAO)).toBe(true);
    expect(Object.isFrozen(SECAO_IMPLANTACAO.chaves)).toBe(true);
    const nomes = DEFINICOES_SECOES_V5.map((d) => d.nome);
    expect(nomes.indexOf("implantacao"), "logo depois de Padrões financeiros").toBe(nomes.indexOf("financeiroPadrao") + 1);
  });

  it("I1 usada só pela família da espécie 'entrada' — nunca pelas outras seis espécies, pela entrada manual antiga nem pela venda", () => {
    expect(familiaOperacionalDeDocumentoEstoque("entrada"), "a premissa: a família da entrada é a do registry").toBe(ENTRADA);
    expect(SECAO_IMPLANTACAO.usadaPor(ENTRADA)).toBe(true);
    const outras = TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.filter((e) => e !== "entrada");
    expect(outras, "a premissa: as outras seis espécies").toHaveLength(6);
    for (const e of outras) {
      const f = familiaOperacionalDeDocumentoEstoque(e);
      expect(f, `a premissa: ${e} tem família`).toBeDefined();
      if (f !== undefined) expect(SECAO_IMPLANTACAO.usadaPor(f), f).toBe(false);
    }
    for (const f of ["estoque.entrada_manual", "vendas.venda", "compras.compra", "", "constructor"]) {
      expect(SECAO_IMPLANTACAO.usadaPor(f), f).toBe(false);
    }
  });

  it("I1 leitura: presente → lida; ausente num 5 → neutro; ler e normalizar devolvem objeto novo", () => {
    const lido = valorDe(v5Com({ implantacao: { saldoInicial: true } }));
    expect((lido as unknown as Saco).implantacao).toEqual({ saldoInicial: true });
    const { implantacao: _sem, ...semASecao } = v5Com({});
    expect(Object.hasOwn(semASecao, "implantacao"), "a premissa: o bruto não tem a seção").toBe(false);
    expect((valorDe(semASecao) as unknown as Saco).implantacao).toEqual({ saldoInicial: false });
    const v = { saldoInicial: true };
    const n = SECAO_IMPLANTACAO.normalizar(v);
    expect(n).toEqual(v);
    expect(n).not.toBe(v);
  });

  it("I1 leitura ESTRITA: texto no lugar do booleano, chave a mais, seção não-objeto e o formato 4 com a chave → recusa no caminho", () => {
    // A premissa: o mesmo 5 com o booleano é aceito.
    expect(lerConfiguracaoTop(v5Com({ implantacao: { saldoInicial: true } })).ok).toBe(true);
    expect(recusasDe(v5Com({ implantacao: { saldoInicial: "sim" } }))).toEqual([{ motivo: "tipo_invalido", caminho: "implantacao.saldoInicial" }]);
    expect(recusasDe(v5Com({ implantacao: { saldoInicial: false, x: true } }))).toEqual([{ motivo: "campo_desconhecido", caminho: "implantacao.x" }]);
    expect(recusasDe(v5Com({ implantacao: {} }))).toEqual([{ motivo: "tipo_invalido", caminho: "implantacao.saldoInicial" }]);
    expect(recusasDe(v5Com({ implantacao: true }))).toEqual([{ motivo: "tipo_invalido", caminho: "implantacao" }]);
    const v4 = clonar(configuracaoNeutraTopV4()) as unknown as Saco;
    expect(recusasDe({ ...v4, implantacao: { saldoInicial: false } })).toEqual([{ motivo: "campo_desconhecido", caminho: "implantacao" }]);
  });

  it("I1 as linhas do histórico", () => {
    expect(SECAO_IMPLANTACAO.linhas({ saldoInicial: false })).toEqual([["Lança o saldo inicial", "Não"]]);
    expect(SECAO_IMPLANTACAO.linhas({ saldoInicial: true })).toEqual([["Lança o saldo inicial", "Sim"]]);
  });
});

// ---------------------------------------------------------------------------------------------------
// I2 — saldoInicialPelaTop
// ---------------------------------------------------------------------------------------------------

describe("I2 saldoInicialPelaTop", () => {
  const ligada = (): Saco => v5Com({ implantacao: { saldoInicial: true } });

  it("I2 5 com a seção ligada, na entrada → true", () => {
    expect(lerConfiguracaoTop(ligada()).ok, "a premissa: o 5 é legível").toBe(true);
    expect(saldoInicialPelaTop(ENTRADA, ligada())).toBe(true);
  });

  it("I2 formatos 1 e 4, 5 sem a seção, 5 com a seção desligada → false (o neutro)", () => {
    const { implantacao: _sem, ...semASecao } = v5Com({});
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV4(), semASecao, v5Com({ implantacao: { saldoInicial: false } })]) {
      expect(lerConfiguracaoTop(c).ok, "a premissa: legível").toBe(true);
      expect(saldoInicialPelaTop(ENTRADA, c), JSON.stringify(c).slice(0, 30)).toBe(false);
    }
  });

  it("I2 a MESMA configuração ligada numa família que não é a da entrada → false", () => {
    for (const f of [SAIDA, "estoque.ajuste", "estoque.entrada_manual", "vendas.venda"]) {
      expect(saldoInicialPelaTop(f, ligada()), f).toBe(false);
    }
  });

  it("I2 configuração nula ou ilegível → false", () => {
    const ilegiveis: readonly unknown[] = [null, undefined, "config", [], { versaoSchema: 99 }, { ...ligada(), lixo: true }];
    for (const c of ilegiveis) {
      expect(lerConfiguracaoTop(c).ok, `a premissa: ${String(JSON.stringify(c)).slice(0, 30)} é ilegível`).toBe(false);
      expect(saldoInicialPelaTop(ENTRADA, c)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// I3 — a capacidade
// ---------------------------------------------------------------------------------------------------

describe("I3 a capacidade saldoInicial", () => {
  it("I3 só o objeto com saldoInicial === 1 (propriedade própria, de dado) entende o saldo inicial pela TOP", () => {
    expect(CAPACIDADE_SALDO_INICIAL_ESTOQUE).toBe(1);
    expect(entendeSaldoInicialEstoque({ saldoInicial: 1 })).toBe(true);
    expect(entendeSaldoInicialEstoque({ documentoEstoque: 1, movimentacaoInterna: 1, saldoInicial: 1 })).toBe(true);
    const recusados: readonly unknown[] = [
      { saldoInicial: 2 }, { saldoInicial: "1" }, { saldoInicial: true }, { saldoInicial: null }, { documentoEstoque: 1 }, {},
      null, undefined, 1, "saldoInicial", [1], Object.create({ saldoInicial: 1 }),
      Object.defineProperty({}, "saldoInicial", { get: () => 1, enumerable: true }),
    ];
    for (const c of recusados) expect(entendeSaldoInicialEstoque(c), String(JSON.stringify(c))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// I4 — o 5 neutro e o perfil
// ---------------------------------------------------------------------------------------------------

describe("I4 o 5 neutro e a recusa do perfil", () => {
  it("I4 configuracaoNeutraTopV5().implantacao = { saldoInicial: false }", () => {
    expect(configuracaoNeutraTopV5().implantacao).toEqual({ saldoInicial: false });
  });

  it("I4 a seção ligada numa TOP de SAÍDA → 'Esta operação não usa a seção Implantação.'; na entrada é aceita", () => {
    const c = valorDe(v5Com({ implantacao: { saldoInicial: true } }));
    // A premissa: na entrada a MESMA configuração é aceita.
    expect(recusasDoPerfilTop(ENTRADA, c)).toEqual([]);
    expect(recusasDoPerfilTop(SAIDA, c)).toEqual([
      { motivo: "combinacao_nao_suportada", caminho: "implantacao", mensagem: "Esta operação não usa a seção Implantação." },
    ]);
    // No neutro (desligada) a saída também aceita: a seção que não é usada só recusa fora do neutro.
    expect(recusasDoPerfilTop(SAIDA, valorDe(v5Com({})))).toEqual([]);
  });
});
