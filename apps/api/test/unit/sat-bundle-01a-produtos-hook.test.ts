import { describe, expect, it, vi } from "vitest";
import {
  tentarGarantirProdutosAposPastagem, type DependenciasGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";

/**
 * SAT-BUNDLE-01A — gancho best-effort do worker após pastagem-essencial.
 * Sem Copernicus nem banco: falha NÃO propaga (Statistical permanece válido).
 */
describe("SAT-BUNDLE-01A — tentarGarantirProdutosAposPastagem (best-effort)", () => {
  it("PRD-05/07: engole erro e registra warn — nunca propaga", async () => {
    const warns: string[] = [];
    const infos: string[] = [];
    const dep = {
      db: {} as DependenciasGarantirProdutos["db"],
      cliente: { configurado: false } as DependenciasGarantirProdutos["cliente"],
      limiteAvulso: {} as DependenciasGarantirProdutos["limiteAvulso"],
      log: {
        info: (_o: Record<string, unknown>, msg: string) => { infos.push(msg); },
        warn: (_o: Record<string, unknown>, msg: string) => { warns.push(msg); },
        error: vi.fn()
      },
      copernicusEnabled: false,
      armazenamento: {} as DependenciasGarantirProdutos["armazenamento"]
    };
    await expect(tentarGarantirProdutosAposPastagem(dep, {
      orgId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      areaId: "00000000-0000-4000-8000-000000000003"
    })).resolves.toBeUndefined();
    // Sem DB real a orquestração pode falhar cedo — o importante é não propagar.
    expect(warns.length + infos.length).toBeGreaterThan(0);
  });
});
