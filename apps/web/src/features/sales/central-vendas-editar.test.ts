import { describe, expect, it } from "vitest";
import {
  MSG_CONFERINDO_A_EDICAO_DE_VENDA, TEXTO_BAIXA_SEM_NUMEROS, TEXTO_NUMEROS_NA_EDICAO, TEXTO_RECEBER_SEM_NUMEROS, TEXTO_SALVAR_COM_RECUSA_PREVISTA,
  acaoEditarDaVenda, confirmarDoAvisoDesabilitado, dicaDaLeituraDaEdicao, type LeituraDaEdicaoNaConsulta
} from "./central-vendas-editar";
import { MSG_EDICAO_DE_VENDA_INDISPONIVEL } from "./central-vendas-edicao-api";
import type { PreviaDaConfirmacao } from "./previa-confirmacao";

/**
 * EDITAR-03 (decisão 315) — a ação "Editar" na consulta do documento de venda (`central-vendas-editar.ts`): SOME sem
 * `<variante>.edit` ou sem `.view`; com as duas, só HABILITA com o `podeEditar: true` do servidor, na forma inteira do
 * contrato; desabilitada, o motivo é o do SERVIDOR (o `/edicao`, a MESMA recusa da PATCH) — a tela não escreve regra de
 * editável. E o botão do aviso do Salvar que confirma: desabilitado só enquanto a prévia carrega.
 */

const ITEM = "11111111-0000-4000-8000-00000000000a";
const edicao = (extra: Record<string, unknown> = {}) => ({
  podeEditar: true, motivo: null, version: "0",
  limites: { somenteArmazemEObservacao: false, itens: [{ id: ITEM, armazemTravado: false }] },
  regras: { regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false }, condicoesPermitidas: null },
  condicoesPermitidas: null, layout: { estrutura: { cabecalho: [], rodape: [], itens: [] } }, situacaoCliente: { politica: "nao_valida" },
  ...extra
});
const lida = (corpo: unknown): LeituraDaEdicaoNaConsulta => ({ situacao: "lida", corpo });
const tudo = () => true;
const base = { perm: "sales", carregado: true, recusaDaAbertura: null };

describe("a pílula Editar: some sem a capacidade (AND das duas da PATCH)", () => {
  it("sem `.edit`, sem `.view`, sem variante conhecida ou sem o documento: NÃO aparece", () => {
    const habilitada = lida(edicao());
    expect(acaoEditarDaVenda({ ...base, leitura: habilitada, can: (p) => p !== "sales.edit" })).toEqual({ visivel: false, dicaDesabilitada: null });
    expect(acaoEditarDaVenda({ ...base, leitura: habilitada, can: (p) => p !== "sales.view" })).toEqual({ visivel: false, dicaDesabilitada: null });
    expect(acaoEditarDaVenda({ ...base, perm: null, leitura: habilitada, can: tudo })).toEqual({ visivel: false, dicaDesabilitada: null });
    expect(acaoEditarDaVenda({ ...base, carregado: false, leitura: habilitada, can: tudo })).toEqual({ visivel: false, dicaDesabilitada: null });
  });

  it("a capacidade é a da VARIANTE do registro: `budgets.edit` não abre o Editar do pedido", () => {
    const can = (p: string) => p === "budgets.edit" || p === "budgets.view" || p === "orders.view";
    expect(acaoEditarDaVenda({ ...base, perm: "budgets", leitura: lida(edicao()), can }).visivel).toBe(true);
    expect(acaoEditarDaVenda({ ...base, perm: "orders", leitura: lida(edicao()), can }).visivel).toBe(false);
  });
});

describe("a pílula Editar: habilitada SÓ com `podeEditar: true`; desabilitada com o motivo do servidor", () => {
  it("o /edicao respondeu podeEditar true, na forma do contrato: habilitada", () => {
    expect(acaoEditarDaVenda({ ...base, leitura: lida(edicao()), can: tudo })).toEqual({ visivel: true, dicaDesabilitada: null });
  });

  it("podeEditar false: desabilitada com o `motivo` do servidor, palavra por palavra", () => {
    for (const motivo of ["Documento não editável neste status", "Este documento não tem tipo de operação (registro anterior às operações) e não pode ser editado.",
      "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo."]) {
      expect(acaoEditarDaVenda({ ...base, leitura: lida(edicao({ podeEditar: false, motivo })), can: tudo }), motivo).toEqual({ visivel: true, dicaDesabilitada: motivo });
    }
  });

  it("enquanto a pergunta não volta: desabilitada com o texto do estado", () => {
    expect(dicaDaLeituraDaEdicao({ situacao: "carregando" })).toBe(MSG_CONFERINDO_A_EDICAO_DE_VENDA);
    expect(acaoEditarDaVenda({ ...base, leitura: { situacao: "carregando" }, can: tudo }).dicaDesabilitada).toBe("Conferindo se o documento pode ser editado…");
  });

  it("a porta ausente na API anterior (404 de ROTA): 'ainda não está disponível'; outro erro: a mensagem do servidor; erro sem mensagem: indisponível", () => {
    expect(dicaDaLeituraDaEdicao({ situacao: "erro", erro: { status: 404, code: "NOT_FOUND", message: "Rota não encontrada" } })).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
    expect(dicaDaLeituraDaEdicao({ situacao: "erro", erro: { status: 404, code: "NOT_FOUND", message: "Documento não encontrado" } })).toBe("Documento não encontrado");
    expect(dicaDaLeituraDaEdicao({ situacao: "erro", erro: new Error("Falha de rede") })).toBe("Falha de rede");
    expect(dicaDaLeituraDaEdicao({ situacao: "erro", erro: { status: 500, code: "INTERNAL", message: " " } })).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
    expect(dicaDaLeituraDaEdicao({ situacao: "erro", erro: "?" })).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
  });

  it("resposta fora do contrato (fail-closed, inclusive sem `regrasGerais`): desabilitada como indisponível — nunca habilitada", () => {
    expect(dicaDaLeituraDaEdicao(lida({ podeEditar: true }))).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
    expect(dicaDaLeituraDaEdicao(lida(edicao({ regras: { condicoesPermitidas: null } })))).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
    expect(dicaDaLeituraDaEdicao(lida(null))).toBe(MSG_EDICAO_DE_VENDA_INDISPONIVEL);
  });

  it("a recusa que o CLIQUE acabou de ouvir vence a leitura antiga (até a consulta perguntar de novo)", () => {
    expect(acaoEditarDaVenda({ ...base, recusaDaAbertura: "Documento não editável neste status", leitura: lida(edicao()), can: tudo }))
      .toEqual({ visivel: true, dicaDesabilitada: "Documento não editável neste status" });
    expect(acaoEditarDaVenda({ ...base, recusaDaAbertura: "x", leitura: lida(edicao()), can: (p) => p !== "sales.edit" }), "sem a capacidade, some mesmo assim").toEqual({ visivel: false, dicaDesabilitada: null });
  });
});

describe("o aviso do Salvar que confirma: o botão e os textos sem números", () => {
  const previa = (podeConfirmar: boolean): PreviaDaConfirmacao => ({
    contractVersion: 1, podeConfirmar, recusas: podeConfirmar ? [] : [{ code: "APROVACAO_PENDENTE", message: "Este documento precisa de aprovação." }],
    estoque: { efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 0 },
    financeiro: { efeito: "receber", valor: "20.00", primeiroVencimento: "2026-11-12", classificacao: null }
  } as PreviaDaConfirmacao);

  it("desabilitado SÓ enquanto a prévia carrega; recusa prevista NÃO desabilita (a edição pode ser a correção); sem prévia, habilitado", () => {
    expect(confirmarDoAvisoDesabilitado({ situacao: "carregando" })).toBe(true);
    expect(confirmarDoAvisoDesabilitado({ situacao: "pronto", previa: previa(false) })).toBe(false);
    expect(confirmarDoAvisoDesabilitado({ situacao: "pronto", previa: previa(true) })).toBe(false);
    expect(confirmarDoAvisoDesabilitado({ situacao: "nao-confirmado" })).toBe(false);
  });

  it("os textos que substituem os números da venda gravada não citam número nenhum", () => {
    for (const t of [TEXTO_NUMEROS_NA_EDICAO, TEXTO_BAIXA_SEM_NUMEROS, TEXTO_RECEBER_SEM_NUMEROS, TEXTO_SALVAR_COM_RECUSA_PREVISTA]) {
      expect(t.trim().length, t).toBeGreaterThan(0);
      expect(t, t).not.toMatch(/\d/);
    }
  });
});
