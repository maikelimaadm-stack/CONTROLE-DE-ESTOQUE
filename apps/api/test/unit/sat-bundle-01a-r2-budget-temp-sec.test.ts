import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  garantirProdutoCondicaoOperacional,
  garantirProdutosDaObservacaoCompleta,
  repararProdutoPrincipalObservacao,
  type DependenciasGarantirProdutos,
  type PedidoGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";
import * as mapaMod from "../../src/lib/satelite/gerar-mapa-condicao.js";
import { ERROS_ITEM } from "../../src/lib/satelite/executar-item.js";
import * as dbMod from "@agro/db";
import { isISODate } from "@agro/shared";

/**
 * SAT-BUNDLE-01A R2 — BUDGET / TEMP / REPAIR / SEC.
 * Provas unitárias dos blockers A–E sem banco real.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const AREA = "00000000-0000-4000-8000-000000000003";
const CONSULTA = "00000000-0000-4000-8000-000000000010";
const ITEM = "00000000-0000-4000-8000-000000000011";
const HASH = "a".repeat(64);

const PEDIDO: PedidoGarantirProdutos = {
  orgId: ORG, userId: USER, areaId: AREA,
  consultaId: CONSULTA, consultaItemId: ITEM
};

const IDENT_01 = {
  observacaoInicio: new Date("2026-10-01T12:00:00Z"),
  observacaoFim: new Date("2026-10-01T12:00:10Z"),
  geometriaSha256: HASH
};
const IDENT_05 = {
  observacaoInicio: new Date("2026-10-05T12:00:00Z"),
  observacaoFim: new Date("2026-10-05T12:00:10Z"),
  geometriaSha256: HASH
};

function depBase(): DependenciasGarantirProdutos {
  return {
    db: {} as DependenciasGarantirProdutos["db"],
    cliente: { configurado: true } as DependenciasGarantirProdutos["cliente"],
    limiteAvulso: {} as DependenciasGarantirProdutos["limiteAvulso"],
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    copernicusEnabled: true,
    armazenamento: {} as DependenciasGarantirProdutos["armazenamento"]
  };
}

function stubAnalises(): void {
  vi.spyOn(dbMod, "withTx").mockResolvedValue({
    analises: [{
      id: "analise-ndvi",
      indice: "ndvi",
      observacao_inicio: IDENT_05.observacaoInicio,
      observacao_fim: IDENT_05.observacaoFim,
      geometria_sha256: HASH
    }],
    dataImagem: "2026-10-05"
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAT-BUNDLE-01A R2 — BUDGET (reserva até Process)", () => {
  it("BUDGET-01/02: ordem Statistical → Process → fechar; ERRO estável produto_condicao_falhou", async () => {
    // Contrato estável do fechamento: falha do Process NÃO é concluido.
    expect(ERROS_ITEM.produtoCondicaoFalhou).toBe("produto_condicao_falhou");
    expect(ERROS_ITEM.produtoCondicaoFalhou).not.toBe("erro_gravacao");
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/lib/satelite/executar-item.ts", import.meta.url), "utf8")
    );
    // Statistical anexa análise SEM fechar; Process roda; só fecharAposProcess conclui.
    expect(src).toContain("anexarAnaliseEnquantoExecuta");
    expect(src).toContain('tipo: "aguarda_process"');
    expect(src).toContain("fecharAposProcess");
    expect(src).toContain("executarProcessCondicao");
    // Não pode voltar o padrão R1: fechar concluido e só então tentarGarantir best-effort.
    expect(src).not.toContain("tentarGarantirProdutosAposPastagem");
    const idxAnexar = src.indexOf("anexarAnaliseEnquantoExecuta");
    const idxProcess = src.indexOf("executarProcessCondicao");
    const idxFechar = src.indexOf("async function fecharAposProcess");
    expect(idxAnexar).toBeGreaterThan(0);
    expect(idxProcess).toBeGreaterThan(idxAnexar);
    expect(idxFechar).toBeGreaterThan(0);
  });

  it("BUDGET-03: Process reutilizado → status reutilizado sem custo novo", async () => {
    stubAnalises();
    vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-cache" } as mapaMod.LinhaMapaCondicao,
      reutilizada: true
    });
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("reutilizado");
    expect(r.chamadas_process).toBe(0);
  });

  it("BUDGET-04: Process falha → status falhou (não mascara como concluída)", async () => {
    stubAnalises();
    vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockRejectedValue(
      Object.assign(new Error("process down"), { code: "CONSULTA_INDISPONIVEL" })
    );
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("falhou");
    expect(r.mapa_id).toBeNull();
  });

  it("BUDGET-02: Process 200 grava pronto com consulta/item no pedido", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-novo" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("pronto");
    expect(r.chamadas_process).toBe(1);
    expect(mapaSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: CONSULTA,
      consultaItemId: ITEM,
      identidade: IDENT_05
    });
  });

  it("BUDGET-05: duas identidades distintas não compartilham o mesmo pedido de mapa", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "m" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_01, consultaId: CONSULTA, consultaItemId: ITEM
    });
    await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO,
      identidade: IDENT_05,
      consultaId: "00000000-0000-4000-8000-000000000020",
      consultaItemId: "00000000-0000-4000-8000-000000000021"
    });
    expect(mapaSpy).toHaveBeenCalledTimes(2);
    expect(mapaSpy.mock.calls[0]![1].identidade).toEqual(IDENT_01);
    expect(mapaSpy.mock.calls[1]![1].identidade).toEqual(IDENT_05);
    expect(mapaSpy.mock.calls[0]![1].consultaId).not.toBe(mapaSpy.mock.calls[1]![1].consultaId);
  });
});

describe("SAT-BUNDLE-01A R2 — TEMP (identidade da observação)", () => {
  it("TEMP-01/02: identidade 05/10 é passada ao gerador — mapa 01/10 não satisfaz por chave distinta", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-05" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, identidade: IDENT_05, politica: "principal"
    });
    expect(mapaSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(mapaSpy.mock.calls[0]![1].identidade?.observacaoInicio).not.toEqual(IDENT_01.observacaoInicio);
  });

  it("TEMP-03: worker histórico — analiseIdReferencia resolve identidade, não latest livre", async () => {
    const identidadeSpy = vi.spyOn(dbMod, "withTx")
      .mockResolvedValueOnce(IDENT_01) // resolverIdentidade via analiseId
      .mockResolvedValueOnce({
        analises: [{
          id: "a-ndvi", indice: "ndvi",
          observacao_inicio: IDENT_01.observacaoInicio,
          observacao_fim: IDENT_01.observacaoFim,
          geometria_sha256: HASH
        }],
        dataImagem: "2026-10-01"
      });
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-hist" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });

    await garantirProdutoCondicaoOperacional(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA,
      analiseIdReferencia: "00000000-0000-4000-8000-000000000099",
      consultaId: CONSULTA, consultaItemId: ITEM
    });

    expect(identidadeSpy).toHaveBeenCalled();
    expect(mapaSpy.mock.calls[0]![1].identidade).toEqual(IDENT_01);
  });

  it("TEMP-04/05: duas observações da mesma área geram pedidos com identidades separadas", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "m" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    // Fora de ordem: 05 primeiro, depois 01 — identidades não se trocam.
    await garantirProdutoCondicaoOperacional(depBase(), { ...PEDIDO, identidade: IDENT_05 });
    await garantirProdutoCondicaoOperacional(depBase(), { ...PEDIDO, identidade: IDENT_01 });
    expect(mapaSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(mapaSpy.mock.calls[1]![1].identidade).toEqual(IDENT_01);
  });

  it("chaveCacheCondicaoPasto inclui data_imagem — 01/10 ≠ 05/10", async () => {
    const { chaveCacheCondicaoPasto } = await import("../../src/lib/satelite/raster-condicao-pasto.js");
    const base = {
      areaId: AREA, geometriaSha256: HASH, colecao: "sentinel-2-l2a",
      versaoClassificador: "condicao-pasto-v3", versaoEvalscript: "condicao-pasto-v3",
      resolucaoM: 20, crs: "EPSG:3857", formato: "image/png"
    };
    const k01 = chaveCacheCondicaoPasto({ ...base, dataImagem: "2026-10-01" });
    const k05 = chaveCacheCondicaoPasto({ ...base, dataImagem: "2026-10-05" });
    expect(k01).not.toBe(k05);
  });
});

describe("SAT-BUNDLE-01A R2 — REPAIR fail-closed", () => {
  it("REPAIR-04: reaproveitado 05/10 + identidade 05/10 no pedido (não 01/10)", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-05" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    await repararProdutoPrincipalObservacao(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(mapaSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(mapaSpy.mock.calls[0]![1].identidade?.observacaoInicio.getUTCDate()).toBe(5);
  });

  it("REPAIR-05: reparo falha → status falhou (não sucesso normal)", async () => {
    stubAnalises();
    vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockRejectedValue(new Error("boom"));
    const r = await repararProdutoPrincipalObservacao(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("falhou");
    expect(r.status).not.toBe("pronto");
    expect(r.status).not.toBe("reutilizado");
  });
});

describe("SAT-BUNDLE-01A R2 — SEC (endpoint público)", () => {
  /** Espelho do schema público — IDs de ledger são RECUSADOS. */
  const reparoCorpoPublico = z.object({
    data_imagem: z.string().refine(isISODate, "Data inválida").optional()
  }).strict();

  it("SEC-01: consulta_id / consulta_item_id no corpo → 422 (strict)", () => {
    expect(() => reparoCorpoPublico.parse({
      data_imagem: "2026-10-05",
      consulta_id: CONSULTA
    })).toThrow();
    expect(() => reparoCorpoPublico.parse({
      consulta_item_id: ITEM
    })).toThrow();
    expect(reparoCorpoPublico.parse({ data_imagem: "2026-10-05" })).toEqual({
      data_imagem: "2026-10-05"
    });
    expect(reparoCorpoPublico.parse({})).toEqual({});
  });

  it("SEC-02/03: reparo público força consultaId/itemId null (não atribui ledger de outra área/consulta)", async () => {
    stubAnalises();
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-avulso" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    // Mesmo que o caller tente passar IDs, o contrato do endpoint zera — testamos o serviço
    // chamado como o endpoint faz (null/null).
    await repararProdutoPrincipalObservacao(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA,
      dataImagem: "2026-10-05",
      consultaId: null,
      consultaItemId: null
    });
    expect(mapaSpy.mock.calls[0]![1].consultaId).toBeNull();
    expect(mapaSpy.mock.calls[0]![1].consultaItemId).toBeNull();
  });
});

describe("SAT-BUNDLE-01A R2 — SQL temporal da prova de cache", () => {
  it("chavesComMapaCondicaoV3DaObservacao casa data_imagem + observacao_inicio/fim", async () => {
    // Importa o símbolo exportado e confere que a query textual exige identidade temporal.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/routes/satelite-consultas.ts", import.meta.url), "utf8")
    );
    expect(src).toContain("chavesComMapaCondicaoV3DaObservacao");
    expect(src).toContain("m.data_imagem = (s.observacao_inicio at time zone 'UTC')::date");
    expect(src).toContain("m.observacao_inicio = s.observacao_inicio");
    expect(src).toContain("m.observacao_fim = s.observacao_fim");
    // Regressão: prova antiga só por area+geom NÃO deve voltar.
    expect(src).not.toMatch(/areasComMapaCondicaoV3\s*\(/);
  });

  it("fechamento da consulta após reparo é fail-closed", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/routes/satelite-consultas.ts", import.meta.url), "utf8")
    );
    expect(src).toContain("garantirProdutoCondicaoOperacional");
    expect(src).toContain("algumFalhou");
    expect(src).toContain("if (!algumFalhou)");
    expect(src).not.toContain("tentarGarantirProdutosAposPastagem");
  });
});
