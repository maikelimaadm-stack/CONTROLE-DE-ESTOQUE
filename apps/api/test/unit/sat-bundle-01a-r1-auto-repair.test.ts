import { describe, expect, it, vi, afterEach } from "vitest";
import {
  garantirProdutosDaObservacaoCompleta,
  repararProdutoPrincipalObservacao,
  tentarGarantirProdutosAposPastagem,
  type DependenciasGarantirProdutos,
  type PedidoGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";
import * as matMod from "../../src/lib/satelite/materializar-produtos-observacao.js";
import * as rasterMod from "../../src/lib/satelite/gerar-raster-indice.js";
import * as dbMod from "@agro/db";
import { INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";

/**
 * SAT-BUNDLE-01C — AUTO / REPAIR (evolução de 01A R1).
 * Stubs: materializar (principal) + raster legado (explicito).
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

function resultadoCompleto(opts: {
  chamadas?: number;
  reutilizados?: matMod.ResultadoMaterializacaoObservacao["outputs_reutilizados"];
  solicitados?: matMod.ResultadoMaterializacaoObservacao["outputs_solicitados"];
} = {}): matMod.ResultadoMaterializacaoObservacao {
  const reutilizados = opts.reutilizados ?? [];
  const solicitados = opts.solicitados ?? (
    opts.chamadas === 0
      ? []
      : ["condicao", "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const
  );
  const produtos = (["condicao", "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const).map((id) => ({
    id,
    status: (reutilizados.includes(id) ? "reutilizado" : "pronto") as "pronto" | "reutilizado",
    recurso_id: `id-${id}`
  }));
  return {
    area_id: PEDIDO.areaId,
    data_imagem: "2026-10-01",
    produtos,
    chamadas_process: opts.chamadas ?? 1,
    outputs_solicitados: [...solicitados],
    outputs_reutilizados: [...reutilizados],
    completo: true,
    pu_cabecalho: opts.chamadas === 0 ? null : "1.5"
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

describe("SAT-BUNDLE-01C — AUTO (worker bundle multi-output)", () => {
  it("AUTO-01/02: política principal materializa 7 produtos; 1 Process", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultadoCompleto({ chamadas: 1 })
    );
    const rasterSpy = vi.spyOn(rasterMod, "gerarOuReutilizarRasterIndice");

    const r = await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "principal"
    });

    expect(r.politica).toBe("principal");
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(matSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: PEDIDO.consultaId,
      consultaItemId: PEDIDO.consultaItemId
    });
    expect(rasterSpy).not.toHaveBeenCalled();
    expect(r.condicao.status).toBe("pronto");
    for (const i of INDICES_BUNDLE_ESSENCIAL) {
      expect(r.rasters[i].status).toBe("pronto");
    }
    expect(r.completo).toBe(true);
    expect(r.chamadas_process).toBe(1);
  });

  it("COST-03: Process automático recebe consultaId/itemId no pedido", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultadoCompleto()
    );
    await garantirProdutosDaObservacaoCompleta(depBase(), {
      ...PEDIDO, politica: "principal"
    });
    expect(matSpy.mock.calls[0]![1]).toMatchObject({
      consultaId: PEDIDO.consultaId,
      consultaItemId: PEDIDO.consultaItemId
    });
  });

  it("COST-04: sem contexto de consulta, materialização permanece avulsa (null)", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultadoCompleto()
    );
    await garantirProdutosDaObservacaoCompleta(depBase(), {
      orgId: PEDIDO.orgId, userId: PEDIDO.userId, areaId: PEDIDO.areaId, politica: "principal"
    });
    expect(matSpy.mock.calls[0]![1].consultaId ?? null).toBeNull();
    expect(matSpy.mock.calls[0]![1].consultaItemId ?? null).toBeNull();
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

describe("SAT-BUNDLE-01C — REPAIR", () => {
  it("REPAIR-01: reparo materializa bundle sem raster legado", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "pronto",
      resultado: resultadoCompleto({ chamadas: 1 })
    });
    const rasterSpy = vi.spyOn(rasterMod, "gerarOuReutilizarRasterIndice");

    const r = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(r.status).toBe("pronto");
    expect(r.chamadas_process).toBe(1);
    expect(r.completo).toBe(true);
    expect(rasterSpy).not.toHaveBeenCalled();
    expect(matSpy.mock.calls[0]![1].consultaId).toBe(PEDIDO.consultaId);
  });

  it("REPAIR-02: cache total → 0 Process", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "reutilizado",
      resultado: resultadoCompleto({
        chamadas: 0,
        reutilizados: ["condicao", "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"]
      })
    });

    const r = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(r.status).toBe("reutilizado");
    expect(r.chamadas_process).toBe(0);
    expect(r.mapa_id).toBe("id-condicao");
  });

  it("REPAIR-03: falha transitória pode ser tentada de novo (idempotente)", async () => {
    const matSpy = vi.spyOn(matMod, "materializarProdutosOperacional")
      .mockResolvedValueOnce({
        status: "falhou",
        resultado: {
          area_id: PEDIDO.areaId, data_imagem: null, produtos: [],
          chamadas_process: 0, outputs_solicitados: [], outputs_reutilizados: [],
          completo: false, pu_cabecalho: null
        }
      })
      .mockResolvedValueOnce({
        status: "pronto",
        resultado: resultadoCompleto()
      });

    const falha = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(falha.status).toBe("falhou");

    const ok = await repararProdutoPrincipalObservacao(depBase(), PEDIDO);
    expect(ok.status).toBe("pronto");
    expect(matSpy).toHaveBeenCalledTimes(2);
  });

  it("best-effort do worker não propaga", async () => {
    vi.spyOn(matMod, "materializarProdutosDaObservacao").mockRejectedValue(new Error("db"));
    await expect(tentarGarantirProdutosAposPastagem(depBase(), PEDIDO)).resolves.toBeUndefined();
  });
});
