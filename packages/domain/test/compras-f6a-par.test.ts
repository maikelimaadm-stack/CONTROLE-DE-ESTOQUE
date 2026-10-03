import { describe, it, expect } from "vitest";
import * as dominio from "../src/index.js";
import {
  AJUDA_FLUXO_COMPRA,
  CAMINHO_EXIGE_FINALIZAR,
  CAMINHO_POLITICA_APROVACAO,
  MATRIZ_REGRAS_GERAIS_TOP,
  MENSAGEM_APROVACAO_EXIGE_PEDIDO_FINALIZADO,
  MENSAGEM_EXIGE_FINALIZADO_SEM_APROVACAO,
  POLITICAS_APROVACAO,
  SECAO_FLUXO_COMPRA,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracaoTopParaEdicaoV5,
  fluxoCompraComAAprovacao,
  fluxoCompraDaVersaoTop,
  formato5Top,
  lerConfiguracaoTop,
  recusasDoFluxoCompraDaFamilia,
  regrasGeraisDaFamiliaTop,
  secoesExtensaoDaVersaoTop,
  type ConfiguracaoTipoOperacao,
  type PoliticaAprovacao,
} from "../src/index.js";

/**
 * OPERACOES-01 F6a — DECISÃO DO MAIKE DE 03/10 (decisão 283): APROVAÇÃO AO FINALIZAR E "EXIGIR PEDIDO FINALIZADO PARA
 * RECEBER" ANDAM JUNTAS, NOS DOIS SENTIDOS, no pedido de compra do formato 5.
 *
 * PAR-D1 a recusa da GRAVAÇÃO, cada lado no campo que falta, com o texto escrito aqui à mão: aprovação (Sempre ou A
 *        partir de um valor) sem "exigir" → `fluxoCompra.exigeFinalizar`; "exigir" sem aprovação →
 *        `aprovacao.politica`; as duas ligadas e as duas desligadas passam; outra família, nada.
 * PAR-D2 o editor liga e desliga as duas juntas (`fluxoCompraComAAprovacao`).
 * PAR-D3 a LEITURA não muda e os padrões de hoje não quebram: a TOP antiga (1 a 4) lida como 5 nos padrões de hoje
 *        ("sem aprovação" e "sem exigir") é válida; uma versão já gravada é lida como está.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere a derivação feita pelo registry.
 */

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";
const VENDA = "vendas.venda";

const MENSAGEM = "Com aprovação, o pedido de compra só é recebido depois de finalizado: \"Exigir pedido finalizado para receber\" tem de ser Sim. As duas andam juntas.";
const RECUSA = { motivo: "combinacao_nao_suportada", caminho: "fluxoCompra.exigeFinalizar", mensagem: MENSAGEM };
const MENSAGEM_INVERSA = "\"Exigir pedido finalizado para receber\" só vale com aprovação do pedido: escolha o critério de aprovação ou deixe a regra em Não. As duas andam juntas.";
const RECUSA_INVERSA = { motivo: "combinacao_nao_suportada", caminho: "aprovacao.politica", mensagem: MENSAGEM_INVERSA };

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A pergunta da GRAVAÇÃO como a API a compõe (`conferirFiscalDaFamilia`) e o editor (`tentarSalvar`): só no 5. */
const recusasDaGravacao = (familia: string, c: ConfiguracaoTipoOperacao) =>
  formato5Top(c) ? recusasDoFluxoCompraDaFamilia(familia, c.aprovacao.politica, secoesExtensaoDaVersaoTop(c).fluxoCompra) : [];

/** Um 5 do pedido com a aprovação e a regra dadas. */
function v5(politica: PoliticaAprovacao, exigeFinalizar: boolean) {
  const c = configuracaoNeutraTopV5();
  c.aprovacao = { ...c.aprovacao, politica, valorMinimo: politica === "por_valor" ? "1000.00" : null };
  c.fluxoCompra = { exigeFinalizar };
  return c;
}

describe("PAR-D1 a recusa da gravação do formato 5", () => {
  it("premissa: o pedido de compra aceita as três políticas de aprovação (a aprovação vale ao finalizar)", () => {
    expect(regrasGeraisDaFamiliaTop(PEDIDO, MATRIZ_REGRAS_GERAIS_TOP).aprovacao.aceitos).toEqual(["nenhuma", "sempre", "por_valor"]);
    expect(SECAO_FLUXO_COMPRA.usadaPor(PEDIDO), "premissa: a seção é do pedido de compra").toBe(true);
  });

  it("aprovação Sempre ou A partir de um valor SEM 'exigir' → uma recusa, no campo, com o texto do contrato", () => {
    for (const politica of ["sempre", "por_valor"] as const) {
      expect(recusasDoFluxoCompraDaFamilia(PEDIDO, politica, { exigeFinalizar: false }), politica).toEqual([RECUSA]);
      expect(recusasDaGravacao(PEDIDO, v5(politica, false)), `${politica}, pela composição da gravação`).toEqual([RECUSA]);
    }
    expect([MENSAGEM_APROVACAO_EXIGE_PEDIDO_FINALIZADO, CAMINHO_EXIGE_FINALIZAR]).toEqual([MENSAGEM, "fluxoCompra.exigeFinalizar"]);
  });

  it("as duas ligadas passam; as duas desligadas passam", () => {
    for (const politica of ["sempre", "por_valor"] as const) {
      expect(recusasDaGravacao(PEDIDO, v5(politica, true)), `${politica} + exigir`).toEqual([]);
    }
    expect(recusasDaGravacao(PEDIDO, v5("nenhuma", false)), "nenhuma + não exigir").toEqual([]);
  });

  it("'exigir' SEM aprovação → uma recusa, no campo da aprovação (o que falta ligar), com o texto do contrato", () => {
    expect(recusasDoFluxoCompraDaFamilia(PEDIDO, "nenhuma", { exigeFinalizar: true })).toEqual([RECUSA_INVERSA]);
    expect(recusasDaGravacao(PEDIDO, v5("nenhuma", true)), "pela composição da gravação").toEqual([RECUSA_INVERSA]);
    expect([MENSAGEM_EXIGE_FINALIZADO_SEM_APROVACAO, CAMINHO_POLITICA_APROVACAO]).toEqual([MENSAGEM_INVERSA, "aprovacao.politica"]);
  });

  it("outra família não passa pela regra (a seção é só do pedido de compra): a compra e a venda com aprovação, nada", () => {
    for (const familia of [COMPRA, VENDA]) {
      expect(SECAO_FLUXO_COMPRA.usadaPor(familia), `premissa: ${familia} não usa a seção`).toBe(false);
      expect(regrasGeraisDaFamiliaTop(familia, MATRIZ_REGRAS_GERAIS_TOP).aprovacao.aceitos, `premissa: ${familia} aceita a aprovação`).toContain("sempre");
      for (const politica of POLITICAS_APROVACAO) {
        for (const exigeFinalizar of [false, true]) {
          expect(recusasDoFluxoCompraDaFamilia(familia, politica, { exigeFinalizar }), `${familia} ${politica} ${exigeFinalizar}`).toEqual([]);
        }
      }
    }
  });

  it("a função e os textos saem pelo índice do pacote (a API e o editor importam de lá)", () => {
    expect(dominio.recusasDoFluxoCompraDaFamilia).toBe(recusasDoFluxoCompraDaFamilia);
    expect(dominio.fluxoCompraComAAprovacao).toBe(fluxoCompraComAAprovacao);
    expect(SECAO_FLUXO_COMPRA.ajuda, "a ajuda da aba é a constante exportada").toBe(AJUDA_FLUXO_COMPRA);
    expect(AJUDA_FLUXO_COMPRA, "a ajuda diz que andam juntas").toContain("Esta regra anda junto com a aprovação do pedido");
  });
});

describe("PAR-D2 o editor liga e desliga as duas juntas", () => {
  it("no pedido de compra, ligar a aprovação liga 'exigir'; desligá-la desliga", () => {
    expect(fluxoCompraComAAprovacao(PEDIDO, "sempre", { exigeFinalizar: false })).toEqual({ exigeFinalizar: true });
    expect(fluxoCompraComAAprovacao(PEDIDO, "por_valor", { exigeFinalizar: false })).toEqual({ exigeFinalizar: true });
    expect(fluxoCompraComAAprovacao(PEDIDO, "sempre", { exigeFinalizar: true })).toEqual({ exigeFinalizar: true });
    expect(fluxoCompraComAAprovacao(PEDIDO, "nenhuma", { exigeFinalizar: false })).toEqual({ exigeFinalizar: false });
    expect(fluxoCompraComAAprovacao(PEDIDO, "nenhuma", { exigeFinalizar: true }), "desligar a aprovação desliga 'exigir'").toEqual({ exigeFinalizar: false });
  });

  it("o resultado nunca é recusado pela gravação (a ligação e a recusa são a mesma regra)", () => {
    for (const politica of POLITICAS_APROVACAO) {
      for (const exigeFinalizar of [false, true]) {
        const ligado = fluxoCompraComAAprovacao(PEDIDO, politica, { exigeFinalizar });
        expect(recusasDoFluxoCompraDaFamilia(PEDIDO, politica, ligado), `${politica} ${exigeFinalizar}`).toEqual([]);
      }
    }
  });

  it("outra família: o valor como estava; sempre uma cópia nova", () => {
    expect(fluxoCompraComAAprovacao(COMPRA, "sempre", { exigeFinalizar: false })).toEqual({ exigeFinalizar: false });
    expect(fluxoCompraComAAprovacao(COMPRA, "nenhuma", { exigeFinalizar: true })).toEqual({ exigeFinalizar: true });
    const entrada = { exigeFinalizar: true };
    expect(fluxoCompraComAAprovacao(PEDIDO, "sempre", entrada)).not.toBe(entrada);
  });
});

describe("PAR-D3 a leitura não muda e os padrões de hoje não quebram", () => {
  it("o neutro do 5 (sem aprovação, sem exigir) é válido no pedido de compra", () => {
    const n = configuracaoNeutraTopV5();
    expect([n.aprovacao.politica, n.fluxoCompra.exigeFinalizar], "premissa: os padrões de hoje").toEqual(["nenhuma", false]);
    expect(recusasDaGravacao(PEDIDO, n)).toEqual([]);
  });

  it("a TOP antiga (3 de produção: Automática, Permitido, Permitida, sem aprovação; 4 neutro) lida como 5 é válida", () => {
    const producao = configuracaoNeutraTopV3();
    producao.geral = { ...producao.geral, confirmacao: "automatica", documentoSemItens: "permitido", alteracaoAposConfirmacao: "permitida" };
    for (const antiga of [producao, configuracaoNeutraTopV4()]) {
      const vista = configuracaoTopParaEdicaoV5(clonar(antiga));
      expect([vista.versaoSchema, vista.aprovacao.politica, vista.fluxoCompra.exigeFinalizar], `premissa: o ${antiga.versaoSchema} visto como 5`).toEqual([5, "nenhuma", false]);
      expect(recusasDaGravacao(PEDIDO, vista), `formato ${antiga.versaoSchema}`).toEqual([]);
      expect(recusasDaGravacao(PEDIDO, antiga), `o ${antiga.versaoSchema} gravado como está não passa pela regra`).toEqual([]);
    }
  });

  it("o 4 com aprovação continua gravável como 4 (a regra é do 5); visto como 5, cai na regra — o editor a cobra antes de enviar", () => {
    const v4 = configuracaoNeutraTopV4();
    v4.aprovacao = { ...v4.aprovacao, politica: "sempre" };
    expect(recusasDaGravacao(PEDIDO, v4)).toEqual([]);
    expect(recusasDaGravacao(PEDIDO, configuracaoTopParaEdicaoV5(clonar(v4)))).toEqual([RECUSA]);
  });

  it("a LEITURA não recusa: um 5 já gravado com aprovação e sem exigir é lido como está (a regra é da gravação)", () => {
    const gravado = clonar(v5("sempre", false));
    expect(lerConfiguracaoTop(gravado).ok, "o leitor estrito aceita").toBe(true);
    expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: gravado })).toEqual({ ok: true, valor: { exigeFinalizar: false } });
  });
});
