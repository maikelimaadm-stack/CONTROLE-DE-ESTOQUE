import { describe, expect, it, vi } from "vitest";
import { CacheRasters, SEM_HASH, assinaturaDaGeometria, identidadeDoRaster, type EntradaComIdentidade } from "./cache-rasters";

interface E extends EntradaComIdentidade { blobUrl: string }

const entrada = (areaId: string, hash: string | null | undefined, extra: { indice?: string; data?: string } = {}): E => ({
  dto: { area_id: areaId, indice: extra.indice ?? "ndvi", data_imagem: extra.data ?? "2026-09-10", geometria_sha256: hash },
  blobUrl: `blob:${areaId}:${hash ?? "x"}`
});

function novo() {
  const liberar = vi.fn<(e: E) => void>();
  return { cache: new CacheRasters<E>(liberar), liberar };
}

describe("identidade do raster", () => {
  it("inclui índice, data, área e geometria_sha256", () => {
    expect(identidadeDoRaster({ indice: "ndvi", data: "2026-09-10", areaId: "a1", geometriaSha256: "h1" })).toBe("ndvi|2026-09-10|a1|h1");
    expect(identidadeDoRaster({ indice: "ndvi", data: "2026-09-10", areaId: "a1", geometriaSha256: "h1" }))
      .not.toBe(identidadeDoRaster({ indice: "ndvi", data: "2026-09-10", areaId: "a1", geometriaSha256: "h2" }));
    expect(identidadeDoRaster({ indice: "ndvi", data: "d", areaId: "a", geometriaSha256: null })).toBe(`ndvi|d|a|${SEM_HASH}`);
  });

  it("a entrada guardada tem a identidade com o hash do DTO", () => {
    const { cache } = novo();
    cache.guardar("a1", entrada("a1", "h1"));
    expect(cache.identidade("a1")).toBe("ndvi|2026-09-10|a1|h1");
    expect(cache.get("a1")?.blobUrl).toBe("blob:a1:h1");
  });
});

describe("contorno novo solta a imagem da área", () => {
  it("hash diferente: a entrada sai do cache e a ObjectURL é revogada", () => {
    const { cache, liberar } = novo();
    const velha = entrada("a1", "h1");
    cache.guardar("a1", velha);
    cache.guardar("a2", entrada("a2", "z"));
    expect(cache.invalidarSeHashDiferente("a1", "h2")).toBe(true);
    expect(cache.has("a1")).toBe(false);
    expect(liberar).toHaveBeenCalledTimes(1);
    expect(liberar).toHaveBeenCalledWith(velha);
    expect(cache.has("a2")).toBe(true);
  });

  it("hash igual não mexe em nada", () => {
    const { cache, liberar } = novo();
    cache.guardar("a1", entrada("a1", "h1"));
    expect(cache.invalidarSeHashDiferente("a1", "h1")).toBe(false);
    expect(cache.has("a1")).toBe(true);
    expect(liberar).not.toHaveBeenCalled();
  });

  it("a listagem trouxe outro hash para a mesma área: a anterior é revogada ao guardar a nova", () => {
    const { cache, liberar } = novo();
    const velha = entrada("a1", "h1");
    cache.guardar("a1", velha);
    cache.guardar("a1", entrada("a1", "h2"));
    expect(liberar).toHaveBeenCalledWith(velha);
    expect(cache.identidade("a1")).toBe("ndvi|2026-09-10|a1|h2");
    expect(cache.tamanho).toBe(1);
  });

  it("o desenho da área mudou na lista de áreas: só a área alterada é solta", () => {
    const { cache, liberar } = novo();
    cache.guardar("a1", entrada("a1", "h1"));
    cache.guardar("a2", entrada("a2", "h2"));
    expect(cache.sincronizarGeometrias(new Map([["a1", "s1"], ["a2", "s2"]]))).toEqual([]);
    expect(cache.sincronizarGeometrias(new Map([["a1", "s1-novo"], ["a2", "s2"]]))).toEqual(["a1"]);
    expect(cache.has("a1")).toBe(false);
    expect(cache.has("a2")).toBe(true);
    expect(liberar).toHaveBeenCalledTimes(1);
  });

  it("assinatura local: mesmo desenho = mesma assinatura; vértice movido = outra", () => {
    const poligono = (x: number) => ({ type: "Polygon", coordinates: [[[0, 0], [x, 0], [x, 1], [0, 0]]] });
    expect(assinaturaDaGeometria(poligono(1))).toBe(assinaturaDaGeometria(poligono(1)));
    expect(assinaturaDaGeometria(poligono(1))).not.toBe(assinaturaDaGeometria(poligono(1.000001)));
    expect(assinaturaDaGeometria(null)).toBe("");
  });
});

describe("contexto índice × data", () => {
  it("trocar de contexto solta tudo (e revoga); o primeiro contexto não solta nada", () => {
    const { cache, liberar } = novo();
    expect(cache.trocarContexto("ndvi|ultima")).toBe(false);
    cache.guardar("a1", entrada("a1", "h1"));
    cache.guardar("a2", entrada("a2", "h2"));
    expect(cache.trocarContexto("ndvi|ultima")).toBe(false);
    expect(cache.trocarContexto("ndvi|data:2026-09-10")).toBe(true);
    expect(cache.tamanho).toBe(0);
    expect(liberar).toHaveBeenCalledTimes(2);
  });

  it("sair da vista libera a área; limpar libera o resto", () => {
    const { cache, liberar } = novo();
    cache.guardar("a1", entrada("a1", "h1"));
    cache.guardar("a2", entrada("a2", "h2"));
    cache.manter(new Set(["a2"]));
    expect(cache.keys()).toEqual(["a2"]);
    expect(liberar).toHaveBeenCalledTimes(1);
    cache.limpar();
    expect(cache.tamanho).toBe(0);
    expect(liberar).toHaveBeenCalledTimes(2);
  });
});
