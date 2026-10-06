import { describe, expect, it, vi } from "vitest";
import {
  tentarGerarMapaCondicaoAposPastagem, type DependenciasGerarMapaCondicao
} from "../../src/lib/satelite/gerar-mapa-condicao.js";

/**
 * MAPA-UX-02 — o gancho best-effort do worker após pastagem-essencial.
 * Sem Copernicus nem banco: só confere que a falha do mapa NÃO propaga.
 */

describe("MAPA-UX-02 — tentarGerarMapaCondicaoAposPastagem (best-effort)", () => {
  it("engole erro (provedor desligado) e registra warn — nunca propaga", async () => {
    const warns: string[] = [];
    const dep = {
      db: {} as DependenciasGerarMapaCondicao["db"],
      cliente: { configurado: false } as DependenciasGerarMapaCondicao["cliente"],
      limiteAvulso: {} as DependenciasGerarMapaCondicao["limiteAvulso"],
      log: {
        info: vi.fn(),
        warn: (obj: Record<string, unknown>, msg: string) => { warns.push(msg); void obj; },
        error: vi.fn()
      },
      copernicusEnabled: false
    };
    await expect(tentarGerarMapaCondicaoAposPastagem(dep, {
      orgId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      areaId: "00000000-0000-4000-8000-000000000003"
    })).resolves.toBeUndefined();
    expect(warns).toEqual(["mapa de condição automático não gerado"]);
  });
});
