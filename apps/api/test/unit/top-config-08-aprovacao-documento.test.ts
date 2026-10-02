import { describe, it, expect } from "vitest";
import { DomainError, errorHttpStatus } from "@agro/shared";
import {
  MENSAGEM_APROVACAO_PENDENTE,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
} from "@agro/domain";
import type { ServiceCtx } from "../../src/lib/context.js";
import {
  TABELA_DA_APROVACAO,
  recusaDaAprovacao,
  registrarDecisao,
  situacaoDaAprovacao,
  type DadosDaAprovacao,
  type ModuloAprovacao,
} from "../../src/lib/aprovacao-documento.js";

/**
 * TOP-CONFIG-08 · A APROVAÇÃO DO DOCUMENTO — A FORMA DE PERGUNTAR, PROVADA SEM BANCO (decisão 277; SPEC §5 e §11).
 *
 * A integração prova a resposta do banco (as três tabelas, os gatilhos, as guardas — DB-1…DB-3, AP-1…AP-12). O que
 * só se prova CONTANDO é o resto, e é isto que este arquivo conta, com um contexto falso de propósito:
 *   · a WHITELIST: o módulo escolhe a tabela num mapa congelado; módulo de fora NEGA, nunca cai na tabela vizinha;
 *   · "não exigida" NÃO vai ao banco: toda TOP de formato 1 a 3 e todo documento sem TOP passam pela confirmação
 *     sem ganhar uma consulta — e o formato 1 a 3 nunca exige, nem declarando "Sempre" (o corte da decisão 277);
 *   · quando exige, UMA consulta lê a decisão vigente (sem N+1), e a recusa sai com o código e os details do contrato;
 *   · versão congelada ilegível RECUSA (TIPO_OPERACAO_EXECUCAO_INDISPONIVEL), nunca "não exigida";
 *   · a gravação manda só o pedido (o gatilho atribui o resto) e confere ROW COUNT.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const DOC = "44444444-4444-4444-8444-444444444444";
const EMPRESA = "55555555-5555-4555-8555-555555555555";
const APROVADORA = { id: "22222222-2222-4222-8222-222222222222", nome: "Aprovadora" };
const MODULOS: readonly ModuloAprovacao[] = ["vendas", "compras", "estoque"];
const FAMILIA: Record<ModuloAprovacao, string> = { vendas: "vendas.venda", compras: "compras.compra", estoque: "estoque.saida" };

interface Linha { decisao: "aprovado" | "reprovado"; observacao: string | null; decidido_por: string; decidido_por_nome: string; decidido_em: Date | string }

/** O contexto falso: grava cada consulta; a leitura da vigente devolve `vigente`; a inserção devolve `insercao`. */
function ctxFalso(o: { vigente?: Linha | null; insercao?: { rows: unknown[]; rowCount: number } } = {}) {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const ctx = {
    orgId: ORG,
    tx: {
      query: async (sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        if (/^\s*insert\b/i.test(sql)) return o.insercao ?? { rows: [{ id: "42", decidido_em: new Date("2026-10-01T12:00:00Z") }], rowCount: 1 };
        const linha = o.vigente ?? null;
        return { rows: linha ? [linha] : [], rowCount: linha ? 1 : 0 };
      },
    },
  } as unknown as ServiceCtx;
  return { ctx, consultas };
}

const neutra4 = configuracaoNeutraTopV4();
const comAprovacao = <C extends { aprovacao: object }>(c: C, politica: "nenhuma" | "sempre" | "por_valor", valorMinimo: string | null = null): C =>
  ({ ...c, aprovacao: { ...c.aprovacao, politica, valorMinimo } });

/** Os dados de um documento do módulo: a venda leva a versão; o estoque não tem valor. */
function dados(modulo: ModuloAprovacao, configuracao: unknown, valor: string | null = "10.00"): DadosDaAprovacao {
  return {
    modulo,
    documentoId: DOC,
    versaoDocumento: modulo === "vendas" ? "7" : null,
    valorDocumento: modulo === "estoque" ? null : valor,
    versaoTop: configuracao === null ? null : { codigoBase: FAMILIA[modulo], configuracao },
  };
}

describe("TABELA_DA_APROVACAO: a whitelist — o módulo escolhe a tabela, nada vem de entrada", () => {
  it("uma tabela por documento, no mapa congelado", () => {
    expect(TABELA_DA_APROVACAO).toStrictEqual({ vendas: "erp.aprovacoes_venda", compras: "erp.aprovacoes_compra", estoque: "erp.aprovacoes_estoque" });
    expect(Object.isFrozen(TABELA_DA_APROVACAO)).toBe(true);
    expect(() => {
      (TABELA_DA_APROVACAO as Record<string, string>).vendas = "erp.outra";
    }).toThrow(TypeError);
    expect(TABELA_DA_APROVACAO.vendas).toBe("erp.aprovacoes_venda");
  });

  it("cada módulo lê e grava SÓ a sua tabela", async () => {
    for (const modulo of MODULOS) {
      const { ctx, consultas } = ctxFalso();
      await situacaoDaAprovacao(ctx, dados(modulo, comAprovacao(neutra4, "sempre")));
      await registrarDecisao(ctx, { modulo, documentoId: DOC, empresaId: EMPRESA, versaoDocumento: modulo === "vendas" ? "7" : null, decisao: "aprovado", observacao: null });
      expect(consultas, modulo).toHaveLength(2);
      const [leitura, insercao] = consultas;
      expect(leitura!.sql, modulo).toContain(`from ${TABELA_DA_APROVACAO[modulo]} a`);
      expect(insercao!.sql, modulo).toContain(`insert into ${TABELA_DA_APROVACAO[modulo]} (`);
      for (const outro of MODULOS.filter((m) => m !== modulo)) {
        expect(leitura!.sql + insercao!.sql, `${modulo} não toca ${outro}`).not.toContain(TABELA_DA_APROVACAO[outro]);
      }
    }
  });

  it("módulo fora da whitelist NEGA, sem consulta — inclusive o nome que só existe no protótipo", async () => {
    for (const nome of ["financeiro", "", "toString", "constructor", "__proto__", "hasOwnProperty"]) {
      const modulo = nome as ModuloAprovacao;
      const { ctx, consultas } = ctxFalso();
      const d = { ...dados("compras", comAprovacao(neutra4, "sempre")), modulo };
      await expect(situacaoDaAprovacao(ctx, d), nome).rejects.toThrow(/módulo de aprovação desconhecido/);
      await expect(recusaDaAprovacao(ctx, d), nome).rejects.not.toBeInstanceOf(DomainError);
      await expect(registrarDecisao(ctx, { modulo, documentoId: DOC, empresaId: EMPRESA, versaoDocumento: null, decisao: "aprovado", observacao: null }), nome)
        .rejects.toThrow(/módulo de aprovação desconhecido/);
      expect(consultas, nome).toEqual([]);
    }
  });
});

describe("\"nao_exigida\" não vai ao banco", () => {
  const CASOS: { nome: string; configuracao: unknown; valor?: string; modulos?: readonly ModuloAprovacao[] }[] = [
    { nome: "documento sem TOP", configuracao: null },
    // O corte: formato 1 a 3 nunca executa a aprovação, nem com "Sempre" gravado.
    { nome: "formato 1 com Sempre", configuracao: comAprovacao(configuracaoNeutraTop(), "sempre") },
    { nome: "formato 2 com Sempre", configuracao: comAprovacao(configuracaoNeutraTopV2(), "sempre") },
    { nome: "formato 3 com Sempre", configuracao: comAprovacao(configuracaoNeutraTopV3(), "sempre") },
    { nome: "formato 3 com A partir de 1.00", configuracao: comAprovacao(configuracaoNeutraTopV3(), "por_valor", "1.00"), valor: "999.00", modulos: ["vendas", "compras"] },
    { nome: "formato 4 Sem aprovação", configuracao: neutra4 },
    // "A partir de" inclui o igual; um centavo abaixo não exige (AP-2).
    { nome: "formato 4 A partir de 1500.00, total 1499.99", configuracao: comAprovacao(neutra4, "por_valor", "1500.00"), valor: "1499.99", modulos: ["vendas", "compras"] },
  ];

  for (const caso of CASOS) {
    for (const modulo of caso.modulos ?? MODULOS) {
      it(`${caso.nome} (${modulo}) → nao_exigida, recusa null, zero consultas`, async () => {
        const { ctx, consultas } = ctxFalso({ vigente: { decisao: "reprovado", observacao: "não deveria ser lida", decidido_por: APROVADORA.id, decidido_por_nome: APROVADORA.nome, decidido_em: new Date() } });
        expect(await situacaoDaAprovacao(ctx, dados(modulo, caso.configuracao, caso.valor))).toBe("nao_exigida");
        expect(await recusaDaAprovacao(ctx, dados(modulo, caso.configuracao, caso.valor))).toBeNull();
        expect(consultas).toEqual([]);
      });
    }
  }
});

describe("exige: UMA consulta lê a decisão vigente, e a recusa sai com o contrato", () => {
  it("Sempre, sem decisão → pendente; 409 APROVACAO_PENDENTE com { politica, valorMinimo: null, valorDocumento }", async () => {
    for (const modulo of MODULOS) {
      const { ctx, consultas } = ctxFalso();
      const d = dados(modulo, comAprovacao(neutra4, "sempre"));
      expect(await situacaoDaAprovacao(ctx, d)).toBe("pendente");
      const recusa = await recusaDaAprovacao(ctx, d);
      expect(recusa).toBeInstanceOf(DomainError);
      expect(recusa!.toJSON()).toStrictEqual({
        code: "APROVACAO_PENDENTE",
        message: MENSAGEM_APROVACAO_PENDENTE,
        details: { politica: "sempre", valorMinimo: null, valorDocumento: modulo === "estoque" ? null : "10.00" },
      });
      expect(recusa!.httpStatus).toBe(409);
      expect(consultas, `${modulo}: uma consulta por pergunta`).toHaveLength(2);
    }
  });

  it("A partir de 1500.00 com total 1500.00 exige (o igual conta) — details com o valor mínimo e o total", async () => {
    for (const modulo of ["vendas", "compras"] as const) {
      const { ctx, consultas } = ctxFalso();
      const recusa = await recusaDaAprovacao(ctx, dados(modulo, comAprovacao(neutra4, "por_valor", "1500.00"), "1500.00"));
      expect(recusa!.code).toBe("APROVACAO_PENDENTE");
      expect(recusa!.details).toStrictEqual({ politica: "por_valor", valorMinimo: "1500.00", valorDocumento: "1500.00" });
      expect(consultas).toHaveLength(1);
    }
  });

  it("a vigente aprovada → aprovado, e a confirmação segue (recusa null)", async () => {
    for (const modulo of MODULOS) {
      const vigente: Linha = { decisao: "aprovado", observacao: null, decidido_por: APROVADORA.id, decidido_por_nome: APROVADORA.nome, decidido_em: new Date("2026-10-01T12:00:00Z") };
      const { ctx } = ctxFalso({ vigente });
      expect(await situacaoDaAprovacao(ctx, dados(modulo, comAprovacao(neutra4, "sempre")))).toBe("aprovado");
      expect(await recusaDaAprovacao(ctx, dados(modulo, comAprovacao(neutra4, "sempre")))).toBeNull();
    }
  });

  it("a vigente reprovada → reprovado; 409 APROVACAO_REPROVADA com o motivo e { motivo, decididoPor, decididoEm } em ISO", async () => {
    for (const decidido_em of [new Date("2026-10-01T12:34:56.789Z"), "2026-10-01T09:34:56.789-03:00"]) {
      const vigente: Linha = { decisao: "reprovado", observacao: "Preço abaixo da tabela", decidido_por: APROVADORA.id, decidido_por_nome: APROVADORA.nome, decidido_em };
      const { ctx } = ctxFalso({ vigente });
      const d = dados("compras", comAprovacao(neutra4, "sempre"));
      expect(await situacaoDaAprovacao(ctx, d)).toBe("reprovado");
      const recusa = await recusaDaAprovacao(ctx, d);
      expect(recusa!.toJSON()).toStrictEqual({
        code: "APROVACAO_REPROVADA",
        message: "Este documento foi reprovado: Preço abaixo da tabela.",
        details: { motivo: "Preço abaixo da tabela", decididoPor: APROVADORA, decididoEm: "2026-10-01T12:34:56.789Z" },
      });
      expect(errorHttpStatus[recusa!.code]).toBe(409);
    }
  });

  it("a vigente é a ÚLTIMA decisão da organização: venda pela versão ATUAL ($3::bigint); compra e estoque, do documento", async () => {
    for (const modulo of MODULOS) {
      const { ctx, consultas } = ctxFalso();
      await situacaoDaAprovacao(ctx, dados(modulo, comAprovacao(neutra4, "sempre")));
      const { sql, params } = consultas[0]!;
      expect(sql).toContain("a.documento_id = $1 and a.organization_id = $2");
      expect(sql).toMatch(/order by a\.id desc\s+limit 1/);
      if (modulo === "vendas") {
        expect(sql).toContain("a.versao_documento = $3::bigint");
        expect(params).toEqual([DOC, ORG, "7"]);
      } else {
        expect(sql).not.toContain("versao_documento");
        expect(params).toEqual([DOC, ORG]);
      }
    }
  });

  it("a versão da venda em número vira o texto do bigint", async () => {
    const { ctx, consultas } = ctxFalso();
    await situacaoDaAprovacao(ctx, { ...dados("vendas", comAprovacao(neutra4, "sempre")), versaoDocumento: 12 });
    expect(consultas[0]!.params).toEqual([DOC, ORG, "12"]);
  });

  it("venda sem versão, ou com versão que não é bigint: erro do chamador, nunca \"pendente\" calado — e nenhuma consulta", async () => {
    for (const versaoDocumento of [null, "", "-1", "1.5", "7 ", "abc", "12345678901234567890", -1, 1.5, Number.NaN]) {
      const { ctx, consultas } = ctxFalso();
      const d = { ...dados("vendas", comAprovacao(neutra4, "sempre")), versaoDocumento };
      await expect(situacaoDaAprovacao(ctx, d), String(versaoDocumento)).rejects.toThrow(/exige a versão do documento/);
      await expect(recusaDaAprovacao(ctx, d), String(versaoDocumento)).rejects.not.toBeInstanceOf(DomainError);
      expect(consultas).toEqual([]);
    }
  });
});

describe("versão congelada ilegível → TIPO_OPERACAO_EXECUCAO_INDISPONIVEL, sem consulta (fail-closed)", () => {
  const CASOS: { nome: string; configuracao: unknown }[] = [
    { nome: "formato desconhecido", configuracao: { ...comAprovacao(neutra4, "sempre"), versaoSchema: 99 } },
    { nome: "configuração que não é objeto", configuracao: "sempre" },
    { nome: "formato 4 sem as seções", configuracao: { versaoSchema: 4 } },
    { nome: "formato 4 com política desconhecida", configuracao: { ...neutra4, aprovacao: { ...neutra4.aprovacao, politica: "talvez" } } },
    { nome: "formato 4 A partir de um valor sem valor", configuracao: comAprovacao(neutra4, "por_valor", null) },
  ];
  for (const caso of CASOS) {
    for (const modulo of MODULOS) {
      it(`${caso.nome} (${modulo})`, async () => {
        const { ctx, consultas } = ctxFalso();
        const d = dados(modulo, caso.configuracao);
        await expect(situacaoDaAprovacao(ctx, d)).rejects.toMatchObject({ code: "TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", details: { motivo: "configuracao_ilegivel" } });
        await expect(recusaDaAprovacao(ctx, d)).rejects.toBeInstanceOf(DomainError);
        expect(consultas).toEqual([]);
      });
    }
  }
});

describe("registrarDecisao: manda só o pedido, e zero linha nunca é sucesso", () => {
  /** As colunas que a inserção nomeia — o resto é do gatilho. */
  const colunas = (sql: string): string[] => (/insert into \S+ \(([^)]*)\)/.exec(sql)?.[1] ?? "").split(",").map((c) => c.trim());

  it("venda: (organização, empresa, documento, versão, decisão, observação); devolve { id, decididoEm } em ISO", async () => {
    const { ctx, consultas } = ctxFalso();
    const r = await registrarDecisao(ctx, { modulo: "vendas", documentoId: DOC, empresaId: EMPRESA, versaoDocumento: 7, decisao: "aprovado", observacao: null });
    expect(r).toStrictEqual({ id: "42", decididoEm: "2026-10-01T12:00:00.000Z" });
    expect(consultas).toHaveLength(1);
    expect(colunas(consultas[0]!.sql)).toEqual(["organization_id", "empresa_id", "documento_id", "versao_documento", "decisao", "observacao"]);
    expect(consultas[0]!.params).toEqual([ORG, EMPRESA, DOC, "7", "aprovado", null]);
  });

  it("compra e estoque: sem versão; a TOP, o valor, quem decidiu e quando NUNCA vêm deste código", async () => {
    for (const modulo of ["compras", "estoque"] as const) {
      const { ctx, consultas } = ctxFalso();
      await registrarDecisao(ctx, { modulo, documentoId: DOC, empresaId: EMPRESA, versaoDocumento: null, decisao: "reprovado", observacao: "Fornecedor sem cadastro" });
      expect(colunas(consultas[0]!.sql)).toEqual(["organization_id", "empresa_id", "documento_id", "decisao", "observacao"]);
      expect(consultas[0]!.params).toEqual([ORG, EMPRESA, DOC, "reprovado", "Fornecedor sem cadastro"]);
    }
    const { ctx, consultas } = ctxFalso();
    await registrarDecisao(ctx, { modulo: "vendas", documentoId: DOC, empresaId: EMPRESA, versaoDocumento: "7", decisao: "aprovado", observacao: null });
    for (const atribuida of ["tipo_operacao_id", "tipo_operacao_versao_id", "valor_documento", "decidido_por", "decidido_em"]) {
      expect(colunas(consultas[0]!.sql)).not.toContain(atribuida);
    }
  });

  it("ROW COUNT zero → NOT_FOUND, nunca sucesso sem efeito", async () => {
    for (const modulo of MODULOS) {
      const { ctx } = ctxFalso({ insercao: { rows: [], rowCount: 0 } });
      await expect(registrarDecisao(ctx, { modulo, documentoId: DOC, empresaId: EMPRESA, versaoDocumento: modulo === "vendas" ? "7" : null, decisao: "aprovado", observacao: null }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("venda sem versão: erro do chamador antes de qualquer inserção", async () => {
    const { ctx, consultas } = ctxFalso();
    await expect(registrarDecisao(ctx, { modulo: "vendas", documentoId: DOC, empresaId: EMPRESA, versaoDocumento: null, decisao: "aprovado", observacao: null }))
      .rejects.toThrow(/exige a versão do documento/);
    expect(consultas).toEqual([]);
  });
});
