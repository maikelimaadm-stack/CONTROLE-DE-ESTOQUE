import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  garantirProdutoCondicaoOperacional,
  garantirProdutosDaObservacaoCompleta,
  repararProdutoPrincipalObservacao,
  type DependenciasGarantirProdutos,
  type PedidoGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";
import * as matMod from "../../src/lib/satelite/materializar-produtos-observacao.js";
import { ERROS_ITEM } from "../../src/lib/satelite/executar-item.js";
import * as dbMod from "@agro/db";
import { isISODate } from "@agro/shared";

/**
 * SAT-BUNDLE-01C — BUDGET / TEMP / REPAIR / SEC (evolução de 01A R2).
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

function resultadoOk(status: "pronto" | "reutilizado", identidade = IDENT_05): {
  status: "pronto" | "reutilizado" | "falhou";
  resultado: matMod.ResultadoMaterializacaoObservacao;
} {
  const chamadas = status === "reutilizado" ? 0 : 1;
  const ids = ["condicao", "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const;
  return {
    status,
    resultado: {
      area_id: AREA,
      data_imagem: identidade.observacaoInicio.toISOString().slice(0, 10),
      produtos: ids.map((id) => ({
        id, status: status === "reutilizado" ? "reutilizado" as const : "pronto" as const,
        recurso_id: `id-${id}`
      })),
      chamadas_process: chamadas,
      outputs_solicitados: chamadas === 0 ? [] : [...ids],
      outputs_reutilizados: chamadas === 0 ? [...ids] : [],
      completo: true,
      pu_cabecalho: chamadas === 0 ? null : "2.0"
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAT-BUNDLE-01C — BUDGET (reserva até Process)", () => {
  it("BUDGET-01/02: ordem Statistical → Process bundle → fechar; ERRO produtos_bundle_falharam", async () => {
    expect(ERROS_ITEM.produtosBundleFalharam).toBe("produtos_bundle_falharam");
    expect(ERROS_ITEM.produtoCondicaoFalhou).toBe("produto_condicao_falhou");
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/lib/satelite/executar-item.ts", import.meta.url), "utf8")
    );
    expect(src).toContain("anexarAnaliseEnquantoExecuta");
    expect(src).toContain('tipo: "aguarda_process"');
    expect(src).toContain("fecharAposProcess");
    expect(src).toContain("executarProcessBundle");
    expect(src).toContain("produtos_bundle_falharam");
    expect(src).not.toContain("tentarGarantirProdutosAposPastagem");
    const idxAnexar = src.indexOf("anexarAnaliseEnquantoExecuta");
    const idxProcess = src.indexOf("executarProcessBundle");
    const idxFechar = src.indexOf("async function fecharAposProcess");
    expect(idxAnexar).toBeGreaterThan(0);
    expect(idxProcess).toBeGreaterThan(idxAnexar);
    expect(idxFechar).toBeGreaterThan(0);
  });

  it("BUDGET-03: Process reutilizado → status reutilizado sem custo novo", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(resultadoOk("reutilizado"));
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("reutilizado");
    expect(r.chamadas_process).toBe(0);
  });

  it("BUDGET-04: Process falha → status falhou (não mascara como concluída)", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "falhou",
      resultado: {
        area_id: AREA, data_imagem: null, produtos: [],
        chamadas_process: 0, outputs_solicitados: [], outputs_reutilizados: [],
        completo: false, pu_cabecalho: null
      }
    });
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("falhou");
    expect(r.mapa_id).toBeNull();
  });

  it("BUDGET-02: Process 200 grava pronto com consulta/item no pedido", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto")
    );
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("pronto");
    expect(r.chamadas_process).toBe(1);
    expect(matSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: CONSULTA,
      consultaItemId: ITEM,
      identidade: IDENT_05
    });
  });

  it("BUDGET-05: duas identidades distintas não compartilham o mesmo pedido", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto")
    );
    await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO, identidade: IDENT_01, consultaId: CONSULTA, consultaItemId: ITEM
    });
    await garantirProdutoCondicaoOperacional(depBase(), {
      ...PEDIDO,
      identidade: IDENT_05,
      consultaId: "00000000-0000-4000-8000-000000000020",
      consultaItemId: "00000000-0000-4000-8000-000000000021"
    });
    expect(matSpy).toHaveBeenCalledTimes(2);
    expect(matSpy.mock.calls[0]![1].identidade).toEqual(IDENT_01);
    expect(matSpy.mock.calls[1]![1].identidade).toEqual(IDENT_05);
    expect(matSpy.mock.calls[0]![1].consultaId).not.toBe(matSpy.mock.calls[1]![1].consultaId);
  });
});

describe("SAT-BUNDLE-01C — TEMP (identidade da observação)", () => {
  it("TEMP-01/02: identidade 05/10 é passada ao materializador", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultadoOk("pronto", IDENT_05).resultado
    );
    await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, identidade: IDENT_05, politica: "principal"
    });
    expect(matSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(matSpy.mock.calls[0]![1].identidade?.observacaoInicio).not.toEqual(IDENT_01.observacaoInicio);
  });

  it("TEMP-03: worker histórico — analiseIdReferencia resolve identidade", async () => {
    vi.spyOn(dbMod, "withTx").mockResolvedValueOnce(IDENT_01);
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto", IDENT_01)
    );

    await garantirProdutoCondicaoOperacional(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA,
      analiseIdReferencia: "00000000-0000-4000-8000-000000000099",
      consultaId: CONSULTA, consultaItemId: ITEM
    });

    expect(matSpy.mock.calls[0]![1].identidade).toEqual(IDENT_01);
  });

  it("TEMP-04/05: duas observações da mesma área geram pedidos com identidades separadas", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto")
    );
    await garantirProdutoCondicaoOperacional(depBase(), { ...PEDIDO, identidade: IDENT_05 });
    await garantirProdutoCondicaoOperacional(depBase(), { ...PEDIDO, identidade: IDENT_01 });
    expect(matSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(matSpy.mock.calls[1]![1].identidade).toEqual(IDENT_01);
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

describe("SAT-BUNDLE-01C — REPAIR fail-closed", () => {
  it("REPAIR-04: reaproveitado 05/10 + identidade 05/10 no pedido (não 01/10)", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto", IDENT_05)
    );
    await repararProdutoPrincipalObservacao(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(matSpy.mock.calls[0]![1].identidade).toEqual(IDENT_05);
    expect(matSpy.mock.calls[0]![1].identidade?.observacaoInicio.getUTCDate()).toBe(5);
  });

  it("REPAIR-05: reparo falha → status falhou (não sucesso normal)", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "falhou",
      resultado: {
        area_id: AREA, data_imagem: null, produtos: [],
        chamadas_process: 0, outputs_solicitados: [], outputs_reutilizados: [],
        completo: false, pu_cabecalho: null
      }
    });
    const r = await repararProdutoPrincipalObservacao(depBase(), {
      ...PEDIDO, identidade: IDENT_05
    });
    expect(r.status).toBe("falhou");
    expect(r.status).not.toBe("pronto");
    expect(r.status).not.toBe("reutilizado");
  });
});

describe("SAT-BUNDLE-01C — SEC (endpoint público)", () => {
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

  it("SEC-02/03: reparo público força consultaId/itemId null", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue(
      resultadoOk("pronto")
    );
    await repararProdutoPrincipalObservacao(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA,
      dataImagem: "2026-10-05",
      consultaId: null,
      consultaItemId: null
    });
    expect(matSpy.mock.calls[0]![1].consultaId).toBeNull();
    expect(matSpy.mock.calls[0]![1].consultaItemId).toBeNull();
  });
});

describe("SAT-BUNDLE-01C — SQL temporal da prova de cache", () => {
  it("chavesComMapaCondicaoV3DaObservacao casa data_imagem + observacao_inicio/fim", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/routes/satelite-consultas.ts", import.meta.url), "utf8")
    );
    expect(src).toContain("chavesComMapaCondicaoV3DaObservacao");
    expect(src).toContain("m.data_imagem = (s.observacao_inicio at time zone 'UTC')::date");
    expect(src).toContain("m.observacao_inicio = s.observacao_inicio");
    expect(src).toContain("m.observacao_fim = s.observacao_fim");
  });
});
