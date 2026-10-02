import { describe, it, expect } from "vitest";
import {
  CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE,
  SECAO_DESTINO,
  SECAO_FLUXO,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  lerConfiguracaoTop,
  lerRegrasDaOperacaoDoEstoque,
  regrasDaOperacaoDoEstoque,
  regrasGeraisDaVersaoTop,
  type ConfiguracaoTipoOperacaoV5,
  type RegrasDaOperacaoDoEstoque
} from "../src/index.js";

/*
 * OPERACOES-01 F5b (decisão 282) — AS REGRAS DA TOP QUE A CENTRAL DE ESTOQUE LÊ ANTES DE SALVAR.
 *
 * RO-D1 o neutro: configuração nula, formato 2 e ilegível → nada exigido, sem confirmação automática, Destino e Fluxo
 *       no neutro só nas famílias que os usam (as outras recebem null).
 * RO-D2 formato 5 com Destino, Fluxo, "Exigir observação" e "Confirmação: Automática" → a resposta diz cada um; na
 *       entrada, Destino e Fluxo são null. Formato 4: as regras gerais valem, as seções no neutro.
 * RO-D3 "aceita sem itens" é sempre false, mesmo com "Documento sem itens: Permitido".
 * RO-D4 o leitor estrito do fio.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito.
 */

const ENTRADA = "estoque.entrada";
const SAIDA = "estoque.saida";
const TRANSFERENCIA = "estoque.transferencia";
const AJUSTE = "estoque.ajuste";
const REQUISICAO = "estoque.requisicao_material";
const CONSUMO = "estoque.consumo";
const DEVOLUCAO = "estoque.devolucao_consumo";
const SETE = [ENTRADA, SAIDA, TRANSFERENCIA, AJUSTE, REQUISICAO, CONSUMO, DEVOLUCAO];
const COM_DESTINO = [SAIDA, REQUISICAO, CONSUMO];

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** O formato 5 do RO-D2: centro obrigatório, OS opcional; exige requisição em todos, sem parcial; observação; automática. */
function v5Completo(): ConfiguracaoTipoOperacaoV5 {
  const c = configuracaoNeutraTopV5();
  c.destino.centroCusto = "obrigatoria";
  c.destino.ordemServico = "opcional";
  c.fluxo = { exigeRequisicao: "todos", permiteParcial: false };
  c.geral.exigeObservacao = true;
  c.geral.confirmacao = "automatica";
  return c;
}

const DESTINO_DO_RO_D2 = {
  centroCusto: "obrigatoria", equipamento: "nao_usada", ordemServico: "opcional", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada"
};

/** O neutro esperado para a família. */
const neutroDa = (f: string): RegrasDaOperacaoDoEstoque => ({
  contractVersion: 1,
  exigencias: [],
  regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false },
  destino: COM_DESTINO.includes(f) ? SECAO_DESTINO.neutro() : null,
  fluxo: f === CONSUMO ? SECAO_FLUXO.neutro() : null
});

// ---------------------------------------------------------------------------------------------------
// RO-D1 — o neutro
// ---------------------------------------------------------------------------------------------------

describe("RO-D1 o neutro (o comportamento de hoje)", () => {
  it("RO-D1 as famílias que usam Destino e Fluxo são as que a seção diz (premissa do resto do arquivo)", () => {
    expect(SETE.filter((f) => SECAO_DESTINO.usadaPor(f))).toEqual(COM_DESTINO);
    expect(SETE.filter((f) => SECAO_FLUXO.usadaPor(f))).toEqual([CONSUMO]);
    expect(SECAO_DESTINO.neutro(), "a premissa: o neutro do Destino é 'não usada' em todas").toEqual({
      centroCusto: "nao_usada", equipamento: "nao_usada", ordemServico: "nao_usada", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada"
    });
    expect(SECAO_FLUXO.neutro(), "a premissa: o neutro do Fluxo é o consumo direto que atende em parte").toEqual({ exigeRequisicao: "nao", permiteParcial: true });
    expect(CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE).toBe(1);
  });

  it("RO-D1 configuração nula → o neutro, nas sete", () => {
    for (const f of SETE) expect(regrasDaOperacaoDoEstoque(f, null), f).toEqual(neutroDa(f));
  });

  it("RO-D1 formato 2 com 'Exigir observação' e 'Automática' gravados → o neutro (o 2 não executa)", () => {
    const c = configuracaoNeutraTopV2();
    c.geral.exigeObservacao = true;
    c.geral.confirmacao = "automatica";
    const lida = lerConfiguracaoTop(c);
    expect(lida.ok, "a premissa: o formato 2 é legível").toBe(true);
    if (!lida.ok) return;
    expect(lida.valor.geral.exigeObservacao && lida.valor.geral.confirmacao === "automatica", "a premissa: as duas gravadas").toBe(true);
    for (const f of SETE) expect(regrasDaOperacaoDoEstoque(f, c), f).toEqual(neutroDa(f));
  });

  it("RO-D1 configuração ilegível (formato desconhecido, não-objeto, chave desconhecida) → o neutro", () => {
    const ilegiveis: readonly unknown[] = [
      { versaoSchema: 99 },
      "configuracao",
      [],
      { ...v5Completo(), lixo: true }
    ];
    for (const c of ilegiveis) {
      expect(lerConfiguracaoTop(c).ok, `a premissa: ${JSON.stringify(c).slice(0, 40)} é ilegível`).toBe(false);
      for (const f of SETE) expect(regrasDaOperacaoDoEstoque(f, c), f).toEqual(neutroDa(f));
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// RO-D2 — o formato 5 (e o 4)
// ---------------------------------------------------------------------------------------------------

describe("RO-D2 a versão diz o que vale", () => {
  it("RO-D2 formato 5 com Destino, Fluxo, Exigir observação e Automática → a resposta diz cada um", () => {
    const c = v5Completo();
    expect(lerConfiguracaoTop(c).ok, "a premissa: o 5 é legível").toBe(true);
    expect(regrasDaOperacaoDoEstoque(CONSUMO, c)).toEqual({
      contractVersion: 1,
      exigencias: ["observacao"],
      regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false },
      destino: DESTINO_DO_RO_D2,
      fluxo: { exigeRequisicao: "todos", permiteParcial: false }
    });
    for (const f of [REQUISICAO, SAIDA]) {
      expect(regrasDaOperacaoDoEstoque(f, c), f).toEqual({
        contractVersion: 1,
        exigencias: ["observacao"],
        regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false },
        destino: DESTINO_DO_RO_D2,
        fluxo: null
      });
    }
  });

  it("RO-D2 a MESMA configuração numa TOP de entrada (e nas outras que não usam as seções) → destino e fluxo null", () => {
    const c = v5Completo();
    for (const f of [ENTRADA, TRANSFERENCIA, AJUSTE, DEVOLUCAO]) {
      expect(SECAO_DESTINO.usadaPor(f), `a premissa: ${f} não usa o Destino`).toBe(false);
      expect(SECAO_FLUXO.usadaPor(f), `a premissa: ${f} não usa o Fluxo`).toBe(false);
      expect(regrasDaOperacaoDoEstoque(f, c), f).toEqual({
        contractVersion: 1,
        exigencias: ["observacao"],
        regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false },
        destino: null,
        fluxo: null
      });
    }
  });

  it("RO-D2 formato 4: as exigências e a confirmação automática valem; Destino e Fluxo no neutro (o 4 não tem seção)", () => {
    const c = configuracaoNeutraTopV4();
    c.geral.exigeObservacao = true;
    c.geral.confirmacao = "automatica";
    expect(lerConfiguracaoTop(c).ok, "a premissa: o 4 é legível").toBe(true);
    expect(regrasDaOperacaoDoEstoque(CONSUMO, c)).toEqual({
      contractVersion: 1,
      exigencias: ["observacao"],
      regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false },
      destino: SECAO_DESTINO.neutro(),
      fluxo: SECAO_FLUXO.neutro()
    });
  });

  it("RO-D2 objeto NOVO a cada chamada, sem referência à configuração", () => {
    const c = v5Completo();
    const a = regrasDaOperacaoDoEstoque(CONSUMO, c);
    const b = regrasDaOperacaoDoEstoque(CONSUMO, c);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.destino).not.toBe(b.destino);
    expect(a.fluxo).not.toBe(b.fluxo);
    expect(a.destino).not.toBe(c.destino);
    expect(a.fluxo).not.toBe(c.fluxo);
    c.destino.safra = "obrigatoria";
    c.fluxo.permiteParcial = true;
    expect(a.destino?.safra, "mudar a configuração depois não muda a resposta").toBe("nao_usada");
    expect(a.fluxo?.permiteParcial).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// RO-D3 — sem itens, nunca
// ---------------------------------------------------------------------------------------------------

describe("RO-D3 'aceita sem itens' é sempre false no estoque", () => {
  it("RO-D3 com 'Documento sem itens: Permitido' na versão (formato 5 e 4) → aceitaSemItens false", () => {
    const v5 = v5Completo();
    v5.geral.documentoSemItens = "permitido";
    const v4 = configuracaoNeutraTopV4();
    v4.geral.documentoSemItens = "permitido";
    for (const c of [v5, v4]) {
      for (const f of SETE) {
        const rg = regrasGeraisDaVersaoTop({ codigoBase: f, configuracao: c });
        expect(rg.ok && rg.regras.aceitaSemItens, `a premissa: a versão de ${f} diz "permitido"`).toBe(true);
        expect(regrasDaOperacaoDoEstoque(f, c).regrasGerais.aceitaSemItens, f).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// RO-D4 — o leitor do fio
// ---------------------------------------------------------------------------------------------------

describe("RO-D4 o leitor estrito da resposta (para a tela)", () => {
  /** A resposta do RO-D2 para o consumo, como chega pelo fio (JSON). */
  const doFio = (): Record<string, unknown> => clonar(regrasDaOperacaoDoEstoque(CONSUMO, v5Completo())) as unknown as Record<string, unknown>;
  type Mudanca = (r: Record<string, unknown>) => unknown;
  const sub = (r: Record<string, unknown>, k: string): Record<string, unknown> => r[k] as Record<string, unknown>;

  it("RO-D4 a resposta volta igual (as sete, com destino e fluxo null ou não), num objeto novo", () => {
    for (const f of SETE) {
      const r = regrasDaOperacaoDoEstoque(f, v5Completo());
      const fio = clonar(r);
      const lido = lerRegrasDaOperacaoDoEstoque(fio);
      expect(lido, f).toEqual(r);
      expect(lido, f).not.toBe(fio);
    }
    const lido = lerRegrasDaOperacaoDoEstoque(doFio());
    expect(lido?.destino).toEqual(DESTINO_DO_RO_D2);
    expect(lido?.fluxo).toEqual({ exigeRequisicao: "todos", permiteParcial: false });
  });

  it("RO-D4 forma errada → null (premissa: a resposta sem a mudança é lida)", () => {
    expect(lerRegrasDaOperacaoDoEstoque(doFio()), "a premissa").not.toBeNull();
    const recusas: readonly (readonly [string, Mudanca])[] = [
      ["contractVersion 2", (r) => { r.contractVersion = 2; return r; }],
      ["contractVersion '1'", (r) => { r.contractVersion = "1"; return r; }],
      ["sem contractVersion", (r) => { delete r.contractVersion; return r; }],
      ["exigencias com não-texto", (r) => { r.exigencias = ["observacao", 1]; return r; }],
      ["exigencias que não é lista", (r) => { r.exigencias = "observacao"; return r; }],
      ["sem exigencias", (r) => { delete r.exigencias; return r; }],
      ["regrasGerais que não é objeto", (r) => { r.regrasGerais = true; return r; }],
      ["confirmacaoAutomatica não booleana", (r) => { sub(r, "regrasGerais").confirmacaoAutomatica = "true"; return r; }],
      ["sem confirmacaoAutomatica", (r) => { delete sub(r, "regrasGerais").confirmacaoAutomatica; return r; }],
      ["aceitaSemItens não booleano", (r) => { sub(r, "regrasGerais").aceitaSemItens = null; return r; }],
      ["sem aceitaSemItens", (r) => { delete sub(r, "regrasGerais").aceitaSemItens; return r; }],
      ["destino sem uma dimensão", (r) => { delete sub(r, "destino").safra; return r; }],
      ["dimensão com valor fora da lista", (r) => { sub(r, "destino").ordemServico = "talvez"; return r; }],
      ["dimensão com valor não-texto", (r) => { sub(r, "destino").centroCusto = true; return r; }],
      ["destino que é lista", (r) => { r.destino = []; return r; }],
      ["sem destino (ausente não é null)", (r) => { delete r.destino; return r; }],
      ["fluxo com exigeRequisicao desconhecido", (r) => { sub(r, "fluxo").exigeRequisicao = "sempre"; return r; }],
      ["fluxo com permiteParcial não booleano", (r) => { sub(r, "fluxo").permiteParcial = "sim"; return r; }],
      ["fluxo sem permiteParcial", (r) => { delete sub(r, "fluxo").permiteParcial; return r; }],
      ["fluxo que é texto", (r) => { r.fluxo = "nao"; return r; }],
      ["sem fluxo (ausente não é null)", (r) => { delete r.fluxo; return r; }],
      ["não-objeto: null", () => null],
      ["não-objeto: lista", () => []],
      ["não-objeto: texto", () => "regras"],
      ["contractVersion herdado do protótipo", (r) => { const { contractVersion: _v, ...resto } = r; return Object.assign(Object.create({ contractVersion: 1 }) as object, resto); }],
      ["contractVersion num getter", (r) => { delete r.contractVersion; return Object.defineProperty(r, "contractVersion", { get: () => 1, enumerable: true }); }]
    ];
    for (const [nome, mudar] of recusas) expect(lerRegrasDaOperacaoDoEstoque(mudar(doFio())), nome).toBeNull();
  });

  it("RO-D4 chave a mais é ignorada (na raiz, nas regras gerais, no destino e no fluxo) e não volta no lido", () => {
    const r = doFio();
    r.novidade = { qualquer: 1 };
    sub(r, "regrasGerais").outraRegra = true;
    sub(r, "destino").dimensaoNova = "obrigatoria";
    sub(r, "fluxo").outraChave = 3;
    const lido = lerRegrasDaOperacaoDoEstoque(r);
    expect(lido).toEqual(regrasDaOperacaoDoEstoque(CONSUMO, v5Completo()));
    expect(Object.keys(lido ?? {})).toEqual(["contractVersion", "exigencias", "regrasGerais", "destino", "fluxo"]);
    expect(Object.keys(lido?.destino ?? {})).toEqual(["centroCusto", "equipamento", "ordemServico", "loteAnimais", "area", "safra"]);
  });

  it("RO-D4 aceitaSemItens true no fio é lido false (o documento de estoque nunca é gravado sem itens)", () => {
    const r = doFio();
    sub(r, "regrasGerais").aceitaSemItens = true;
    expect(lerRegrasDaOperacaoDoEstoque(r)?.regrasGerais).toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
  });

  it("RO-D4 a lista lida é cópia: mudar o fio depois não muda o lido", () => {
    const r = doFio();
    const lido = lerRegrasDaOperacaoDoEstoque(r);
    expect(lido?.exigencias, "a premissa").toEqual(["observacao"]);
    (r.exigencias as string[]).push("outra");
    sub(r, "destino").centroCusto = "nao_usada";
    expect(lido?.exigencias).toEqual(["observacao"]);
    expect(lido?.destino?.centroCusto).toBe("obrigatoria");
  });
});
