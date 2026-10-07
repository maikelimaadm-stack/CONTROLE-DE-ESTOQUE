import { describe, expect, it, vi, afterEach } from "vitest";
import {
  garantirProdutosDaObservacaoCompleta,
  repararProdutoPrincipalObservacao,
  tentarGarantirProdutosAposPastagem,
  type DependenciasGarantirProdutos,
  type PedidoGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";
import * as mapaMod from "../../src/lib/satelite/gerar-mapa-condicao.js";
import * as rasterMod from "../../src/lib/satelite/gerar-raster-indice.js";
import * as dbMod from "@agro/db";
import { INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";

/**
 * SAT-BUNDLE-01A R1 — AUTO / REPAIR / COST consumo.
 * Stubs: withTx (leitura de análises) + serviços de geração.
 */

const PEDIDO: PedidoGarantirProdutos = {
  orgId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  areaId: "00000000-0000-4000-8000-000000000003",
  consultaId: "00000000-0000-4000-8000-000000000010",
  consultaItemId: "00000000-0000-4000-8000-000000000011"
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

function stubAnalises(comIndices = false): void {
  const analises = comIndices
    ? INDICES_BUNDLE_ESSENCIAL.map((indice) => ({
      id: `analise-${indice}`,
      indice,
      observacao_inicio: new Date("2026-10-01T12:00:00Z")
    }))
    : [];
  vi.spyOn(dbMod, "withTx").mockResolvedValue({ analises, dataImagem: "2026-10-01" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAT-BUNDLE-01A R1 — AUTO (worker só condição)", () => {
  it("AUTO-01/02: política principal gera só condição; rasters ficam indisponíveis", async () => {
    stubAnalises(false);
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-1" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    const rasterSpy = vi.spyOn(rasterMod, "gerarOuReutilizarRasterIndice");

    const r = await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "principal"
    });

    expect(r.politica).toBe("principal");
    expect(mapaSpy).toHaveBeenCalledTimes(1);
    expect(mapaSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: PEDIDO.consultaId,
      consultaItemId: PEDIDO.consultaItemId
    });
    expect(rasterSpy).not.toHaveBeenCalled();
    for (const i of INDICES_BUNDLE_ESSENCIAL) {
      expect(r.rasters[i].status).toBe("indisponivel");
    }
    expect(r.condicao.status).toBe("pronto");
    expect(r.chamadas_process).toBe(1);
  });

  it("COST-03: Process automático recebe consultaId/itemId no pedido do mapa", async () => {
    stubAnalises(false);
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-1" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });

    await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "principal"
    });
    expect(mapaSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: PEDIDO.consultaId,
      consultaItemId: PEDIDO.consultaItemId
    });
  });

  it("COST-04: sem contexto de consulta, mapa permanece avulso (null)", async () => {
    stubAnalises(false);
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-1" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });

    await garantirProdutosDaObservacaoCompleta(depBase(), {
      orgId: PEDIDO.orgId, userId: PEDIDO.userId, areaId: PEDIDO.areaId, politica: "principal"
    });
    expect(mapaSpy.mock.calls[0]![1].consultaId ?? null).toBeNull();
    expect(mapaSpy.mock.calls[0]![1].consultaItemId ?? null).toBeNull();
  });

  it("AUTO-03: raster_explicito gera um; AUTO-04: repetido reutiliza", async () => {
    stubAnalises(true);
    const rasterSpy = vi.spyOn(rasterMod, "gerarOuReutilizarRasterIndice")
      .mockResolvedValueOnce({
        raster: { id: "r-ndmi" } as Awaited<ReturnType<typeof rasterMod.gerarOuReutilizarRasterIndice>>["raster"],
        reutilizada: false
      })
      .mockResolvedValueOnce({
        raster: { id: "r-ndmi" } as Awaited<ReturnType<typeof rasterMod.gerarOuReutilizarRasterIndice>>["raster"],
        reutilizada: true
      });

    const r1 = await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "raster_explicito", indiceRaster: "ndmi"
    });
    expect(r1.rasters.ndmi.status).toBe("pronto");
    expect(r1.chamadas_process).toBe(1);
    expect(r1.rasters.ndvi.status).toBe("indisponivel");
    expect(rasterSpy).toHaveBeenCalledTimes(1);

    const r2 = await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "raster_explicito", indiceRaster: "ndmi"
    });
    expect(r2.rasters.ndmi.status).toBe("reutilizado");
    expect(r2.reutilizacoes).toBe(1);
    expect(r2.chamadas_process).toBe(0);
  });
});

describe("SAT-BUNDLE-01A R1 — REPAIR", () => {
  it("REPAIR-01: reparo gera mapa sem chamar raster; política principal", async () => {
    stubAnalises(false);
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-reparo" } as mapaMod.LinhaMapaCondicao,
      reutilizada: false
    });
    const rasterSpy = vi.spyOn(rasterMod, "gerarOuReutilizarRasterIndice");

    const r = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(r.status).toBe("pronto");
    expect(r.chamadas_process).toBe(1);
    expect(rasterSpy).not.toHaveBeenCalled();
    expect(mapaSpy.mock.calls[0]![1].consultaId).toBe(PEDIDO.consultaId);
  });

  it("REPAIR-02: mapa existente → 0 Process", async () => {
    stubAnalises(false);
    vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao").mockResolvedValue({
      mapa: { id: "mapa-cache" } as mapaMod.LinhaMapaCondicao,
      reutilizada: true
    });

    const r = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(r.status).toBe("reutilizado");
    expect(r.chamadas_process).toBe(0);
    expect(r.mapa_id).toBe("mapa-cache");
  });

  it("REPAIR-03: falha transitória pode ser tentada de novo (idempotente)", async () => {
    stubAnalises(false);
    const mapaSpy = vi.spyOn(mapaMod, "gerarOuReutilizarMapaCondicao")
      .mockRejectedValueOnce(Object.assign(new Error("transiente"), { code: "CONSULTA_INDISPONIVEL" }))
      .mockResolvedValueOnce({
        mapa: { id: "mapa-ok" } as mapaMod.LinhaMapaCondicao,
        reutilizada: false
      });

    const falha = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(falha.status).toBe("falhou");

    const ok = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(ok.status).toBe("pronto");
    expect(mapaSpy).toHaveBeenCalledTimes(2);
  });

  it("best-effort do worker não propaga", async () => {
    vi.spyOn(dbMod, "withTx").mockRejectedValue(new Error("db"));
    await expect(tentarGarantirProdutosAposPastagem(depBase(), PEDIDO)).resolves.toBeUndefined();
  });
});
