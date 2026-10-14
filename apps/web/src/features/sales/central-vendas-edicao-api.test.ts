import { describe, expect, it } from "vitest";
import {
  MSG_DOCUMENTO_DE_VENDA_MUDOU, MSG_EDICAO_DE_VENDA_INDISPONIVEL, RELEITURAS_DA_ABERTURA, chaveDaEdicaoDeVenda, chaveDoDocumentoEmEdicaoDeVenda,
  conflitoDaEdicaoDeVenda, decidirAbertura, edicaoDeVendaIndisponivel, lerDocumentoDaEdicaoDeVenda, lerEdicaoDeVenda, lerErroDaApiNaEdicao,
  lerLimitesDaEdicaoDeVenda, lerRegrasGeraisDaEdicao, portaDaEdicaoDeVenda, portaDoDocumentoDeVenda, trocaAChaveDaEdicao, versaoCanonica, versaoConfere
} from "./central-vendas-edicao-api";

/**
 * EDITAR-03 (decisão 315) — o ADAPTADOR do contrato da edição de venda (`central-vendas-edicao-api.ts`): as portas, a
 * resposta do `GET /edicao` conferida FAIL-CLOSED (o `regrasGerais` estrito — a ausência nunca vira "não confirma"), a
 * GUARDA DE VERSÃO da abertura (o `/edicao` de vendas não traz o documento: `GET :id` + `/edicao`, da MESMA versão) e a
 * leitura do erro do salvar (o 409 que oferece recarregar, a chave de idempotência, a porta ausente na API anterior).
 */

const ITEM_A = "11111111-0000-4000-8000-00000000000a";
const ITEM_B = "11111111-0000-4000-8000-00000000000b";
const COND = "aaaaaaaa-0000-4000-8000-0000000000f3";
const DOC = "99999999-0000-4000-8000-000000000001";

/** A resposta do `/edicao` como o servidor a manda hoje (a forma de `vendas-edicao.ts`). */
const edicao = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  podeEditar: true, motivo: null, version: "3",
  limites: { somenteArmazemEObservacao: false, itens: [{ id: ITEM_A, armazemTravado: false }, { id: ITEM_B, armazemTravado: false }] },
  regras: { formato: 5, regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false }, condicoesPermitidas: null, exigencias: [], reservaEstoque: false },
  condicoesPermitidas: null,
  layout: { origem: "sistema", id: null, estrutura: { cabecalho: [], rodape: [], itens: [] }, padroesDeCadastro: {}, padroesInvalidos: [] },
  situacaoCliente: { politica: "nao_valida" },
  ...extra
});
const comRegras = (regras: Record<string, unknown>) => edicao({ regras: { ...(edicao()["regras"] as Record<string, unknown>), ...regras } });
const documento = (extra: Record<string, unknown> = {}) => ({ id: DOC, kind: "sale", version: "3", items: [{ id: ITEM_A }, { id: ITEM_B }], ...extra });
const erro = (status: number, code: string, message: string, details?: unknown) => ({ status, code, message, details });

describe("as portas da edição de venda (a MESMA da consulta; o id escapado)", () => {
  it("documento, edição e as chaves da abertura (a leitura entra na chave: recarregar nunca reaproveita o cache)", () => {
    expect(portaDoDocumentoDeVenda("sales", DOC)).toBe(`/api/sales/sales/${DOC}`);
    expect(portaDaEdicaoDeVenda("budgets", DOC)).toBe(`/api/sales/budgets/${DOC}/edicao`);
    expect(portaDaEdicaoDeVenda("orders", "a/b")).toBe("/api/sales/orders/a%2Fb/edicao");
    expect(chaveDoDocumentoEmEdicaoDeVenda("sales", DOC, 2)).toEqual(["sales-edicao-documento", "sales", DOC, 2]);
    expect(chaveDaEdicaoDeVenda("sales", DOC, 2)).toEqual(["sales-edicao", "sales", DOC, 2]);
  });
});

describe("o GET /edicao, fail-closed", () => {
  it("a resposta de hoje é lida inteira: a versão, os limites (ids em minúsculas), as regras gerais, as condições e o layout", () => {
    const lida = lerEdicaoDeVenda(edicao({ limites: { somenteArmazemEObservacao: true, itens: [{ id: ITEM_A.toUpperCase(), armazemTravado: true }] } }));
    expect(lida).toMatchObject({
      podeEditar: true, motivo: null, version: "3",
      limites: { somenteArmazemEObservacao: true, itens: [{ id: ITEM_A, armazemTravado: true }] },
      regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false }, condicoesPermitidas: null, situacaoCliente: { politica: "nao_valida" }
    });
  });

  it("a Confirmação Automática da versão congelada é lida como veio (é ela que liga o aviso do Salvar)", () => {
    expect(lerEdicaoDeVenda(comRegras({ regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false } }))?.regrasGerais)
      .toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
  });

  it("`regrasGerais` AUSENTE ou fora da forma ⇒ fora do contrato (null) — NUNCA o neutro: a ausência esconderia uma confirmação", () => {
    const { regrasGerais: _fora, ...semRegrasGerais } = edicao()["regras"] as Record<string, unknown>;
    expect(lerEdicaoDeVenda(edicao({ regras: semRegrasGerais }))).toBeNull();
    expect(lerEdicaoDeVenda(comRegras({ regrasGerais: { confirmacaoAutomatica: "true", aceitaSemItens: false } }))).toBeNull();
    expect(lerEdicaoDeVenda(comRegras({ regrasGerais: { confirmacaoAutomatica: true } }))).toBeNull();
    expect(lerEdicaoDeVenda(comRegras({ regrasGerais: null }))).toBeNull();
    expect(lerRegrasGeraisDaEdicao({ confirmacaoAutomatica: true, aceitaSemItens: true, extra: 1 }), "chave a mais é ignorada").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: true });
  });

  it("a recusa: `podeEditar` falso COM o motivo do servidor; sem motivo (ou só espaços) é resposta fora do contrato", () => {
    expect(lerEdicaoDeVenda(edicao({ podeEditar: false, motivo: "Documento não editável neste status" }))).toMatchObject({ podeEditar: false, motivo: "Documento não editável neste status" });
    expect(lerEdicaoDeVenda(edicao({ podeEditar: false, motivo: null }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ podeEditar: false, motivo: "   " }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ motivo: 7 }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ podeEditar: "sim" }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ motivo: "ignorado quando pode" }))?.motivo, "quando pode, o motivo é nulo").toBeNull();
  });

  it("a versão: texto de dígitos canônico, ou o inteiro seguro; o resto é fora do contrato", () => {
    expect(lerEdicaoDeVenda(edicao({ version: 3 }))?.version).toBe("3");
    for (const v of ["03", "-1", "1.5", "", null, 1.5, -1, "abc"]) expect(lerEdicaoDeVenda(edicao({ version: v })), String(v)).toBeNull();
    expect([versaoCanonica("0"), versaoCanonica("123"), versaoCanonica(Number.MAX_SAFE_INTEGER + 1)]).toEqual(["0", "123", null]);
  });

  it("os limites: fora da forma, a resposta inteira cai (nunca um limite inventado em nome do servidor)", () => {
    expect(lerLimitesDaEdicaoDeVenda({ somenteArmazemEObservacao: true, itens: [] })).toEqual({ somenteArmazemEObservacao: true, itens: [] });
    expect(lerEdicaoDeVenda(edicao({ limites: { itens: [] } }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ limites: { somenteArmazemEObservacao: false, itens: [{ id: "nao-e-uuid", armazemTravado: false }] } }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ limites: { somenteArmazemEObservacao: false, itens: [{ id: ITEM_A, armazemTravado: "true" }] } }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ limites: { somenteArmazemEObservacao: false, itens: [{ id: ITEM_A }] } }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ limites: null }))).toBeNull();
  });

  it("as condições permitidas: null ou lista de UUID, e o MESMO valor nas duas chaves (divergência é fora do contrato)", () => {
    const igual = lerEdicaoDeVenda(edicao({ condicoesPermitidas: [COND], regras: { ...(edicao()["regras"] as Record<string, unknown>), condicoesPermitidas: [COND] } }));
    expect(igual?.condicoesPermitidas).toEqual([COND]);
    expect(lerEdicaoDeVenda(edicao({ condicoesPermitidas: [COND] })), "a de cima diz uma, a de regras diz null").toBeNull();
    expect(lerEdicaoDeVenda(edicao({ condicoesPermitidas: ["x"], regras: { ...(edicao()["regras"] as Record<string, unknown>), condicoesPermitidas: ["x"] } }))).toBeNull();
  });

  it("o layout tem de trazer a `estrutura`; propriedade herdada não conta; corpo que não é objeto cai", () => {
    expect(lerEdicaoDeVenda(edicao({ layout: { origem: "sistema" } }))).toBeNull();
    expect(lerEdicaoDeVenda(edicao({ layout: null }))).toBeNull();
    expect(lerEdicaoDeVenda(Object.create(edicao()))).toBeNull();
    expect(lerEdicaoDeVenda([edicao()])).toBeNull();
    expect(lerEdicaoDeVenda(null)).toBeNull();
  });
});

describe("a abertura: GET :id + /edicao, com a GUARDA DE VERSÃO", () => {
  it("o documento que a edição abre: id, versão canônica, variante e itens com `id` UUID; fora disso, nenhum", () => {
    expect(lerDocumentoDaEdicaoDeVenda(documento())).toEqual(documento());
    expect(lerDocumentoDaEdicaoDeVenda(documento({ version: "x" }))).toBeNull();
    expect(lerDocumentoDaEdicaoDeVenda(documento({ kind: null }))).toBeNull();
    expect(lerDocumentoDaEdicaoDeVenda(documento({ items: [{ id: "x" }] }))).toBeNull();
    expect(lerDocumentoDaEdicaoDeVenda(documento({ items: null }))).toBeNull();
  });

  it("a versão do documento e a do /edicao: iguais (inclusive número × texto) conferem; diferentes, não", () => {
    const e = lerEdicaoDeVenda(edicao())!;
    expect(versaoConfere(documento(), e)).toBe(true);
    expect(versaoConfere(documento({ version: 3 }), e)).toBe(true);
    expect(versaoConfere(documento({ version: "4" }), e)).toBe(false);
    expect(versaoConfere(documento({ version: "abc" }), e)).toBe(false);
  });

  it("a decisão da abertura, nos quatro casos (a recusa vem antes do documento)", () => {
    expect(decidirAbertura(documento(), { podeEditar: true })).toEqual({ situacao: "fora-do-contrato" });
    expect(decidirAbertura(null, edicao({ podeEditar: false, motivo: "Documento não editável neste status" })), "a recusa não precisa do documento")
      .toEqual({ situacao: "recusada", motivo: "Documento não editável neste status" });
    expect(decidirAbertura({ id: DOC }, edicao())).toEqual({ situacao: "fora-do-contrato" });
    expect(decidirAbertura(documento({ version: "4" }), edicao()), "outra aba salvou entre as duas leituras").toEqual({ situacao: "versoes-diferentes" });
    const pronta = decidirAbertura(documento(), edicao());
    expect(pronta.situacao).toBe("pronta");
    if (pronta.situacao === "pronta") expect([pronta.documento["id"], pronta.edicao.version]).toEqual([DOC, "3"]);
    expect(RELEITURAS_DA_ABERTURA, "a abertura relê, e desiste depois de algumas vezes").toBe(3);
  });
});

describe("o erro do salvar", () => {
  it("o erro da API é lido pela ESTRUTURA (status, code, message); sem ela, nenhum", () => {
    expect(lerErroDaApiNaEdicao(erro(422, "VALIDATION_ERROR", "x", [{ path: "items[0].warehouse_id" }]))).toEqual({ status: 422, code: "VALIDATION_ERROR", message: "x", details: [{ path: "items[0].warehouse_id" }] });
    expect(lerErroDaApiNaEdicao(new Error("rede"))).toBeNull();
    expect(lerErroDaApiNaEdicao("409")).toBeNull();
  });

  it("o 409 de VERSÃO oferece recarregar, com a mensagem do servidor (ou a dele, espelhada, se vier vazia); os outros erros, não", () => {
    expect(conflitoDaEdicaoDeVenda(erro(409, "CONCURRENCY_CONFLICT", "Este documento mudou desde que você o abriu. Recarregue antes de salvar.")))
      .toBe("Este documento mudou desde que você o abriu. Recarregue antes de salvar.");
    expect(conflitoDaEdicaoDeVenda(erro(409, "CONCURRENCY_CONFLICT", "  "))).toBe(MSG_DOCUMENTO_DE_VENDA_MUDOU);
    expect(conflitoDaEdicaoDeVenda(erro(409, "INVALID_STATUS_TRANSITION", "Documento não editável neste status"))).toBeNull();
    expect(conflitoDaEdicaoDeVenda(erro(422, "VALIDATION_ERROR", "x"))).toBeNull();
    expect(conflitoDaEdicaoDeVenda(new Error("rede"))).toBeNull();
  });

  it("a chave de idempotência: a MESMA até o servidor recusar (4xx); o conflito de concorrência, a rede e o 5xx a mantêm", () => {
    expect(trocaAChaveDaEdicao(erro(422, "VALIDATION_ERROR", "x"))).toBe(true);
    expect(trocaAChaveDaEdicao(erro(409, "INVALID_STATUS_TRANSITION", "x"))).toBe(true);
    expect(trocaAChaveDaEdicao(erro(409, "CONFLICT", "outra operação com esta chave"))).toBe(true);
    expect(trocaAChaveDaEdicao(erro(409, "CONCURRENCY_CONFLICT", "Operação em andamento para esta chave"))).toBe(false);
    expect(trocaAChaveDaEdicao(erro(500, "INTERNAL", "x"))).toBe(false);
    expect(trocaAChaveDaEdicao(new Error("rede"))).toBe(false);
  });

  it("a porta ausente na API anterior é a 404 de ROTA (não a do documento): a frase de indisponível", () => {
    expect(edicaoDeVendaIndisponivel(erro(404, "NOT_FOUND", "Rota não encontrada"))).toBe(true);
    expect(edicaoDeVendaIndisponivel(erro(404, "NOT_FOUND", "Documento não encontrado"))).toBe(false);
    expect(MSG_EDICAO_DE_VENDA_INDISPONIVEL).toBe("A edição de documento de venda ainda não está disponível neste servidor.");
  });
});
