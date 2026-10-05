/**
 * Desempenho do Mapa geral: ~200 áreas e 6 índices NÃO viram 1.200 pedidos. Só o que está à vista, só o índice ativo,
 * com teto por vista, em lotes e abortável. `fetch` simulado conta os pedidos de verdade.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AREAS_POR_LISTAGEM,
  TETO_RASTERS_NO_VIEWPORT,
  idsFaltando,
  listarRastersPorAreas,
  selecionarAreasDaVista,
  type RasterIndiceDto,
  type RequisitarJson
} from "./viewport-rasters";

const INDICES = ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"] as const;

/** Grade 20×10 = 200 áreas de ~0,01° (≈1 km). */
function gradeDeAreas(colunas = 20, linhas = 10) {
  const areas: { id: string; geometria: { type: "Polygon"; coordinates: number[][][] } }[] = [];
  for (let c = 0; c < colunas; c++) {
    for (let l = 0; l < linhas; l++) {
      const x = -55 + c * 0.012, y = -15 + l * 0.012;
      areas.push({
        id: `area-${String(c).padStart(2, "0")}-${String(l).padStart(2, "0")}`,
        geometria: { type: "Polygon", coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]] }
      });
    }
  }
  return areas;
}

const VISTA_TODA = { oeste: -56, sul: -16, leste: -54, norte: -14 };

function dtoDe(areaId: string, indice: string): RasterIndiceDto {
  return {
    id: `r-${areaId}-${indice}`, analise_id: "a", area_id: areaId, indice, tipo: "valores", data_imagem: "2026-09-10",
    largura: 4, altura: 4, cantos_lnglat: [[0, 0], [1, 0], [1, 1], [0, 1]], escala_min: -0.2, escala_max: 1,
    resolucao_m: 10, resolucao_reduzida: false, url_assinada: "/x", expira_em: "2099-01-01T00:00:00.000Z"
  };
}

/** `fetch` simulado: responde a listagem de acordo com `area_ids` e `indice` da URL. */
function fetchSimulado() {
  const fn = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) throw new DOMException("abortado", "AbortError");
    const u = new URL(url, "http://api.local");
    const ids = (u.searchParams.get("area_ids") ?? "").split(",").filter(Boolean);
    const indice = u.searchParams.get("indice") ?? "ndvi";
    return { ok: true, json: async () => ({ itens: ids.map((id) => dtoDe(id, indice)), pagina: 1, tamanho: AREAS_POR_LISTAGEM, tem_mais: false }) };
  });
  const requisitar: RequisitarJson = async <T,>(caminho: string, opcoes?: { signal?: AbortSignal }) => {
    const r = await fn(caminho, { signal: opcoes?.signal });
    return (await r.json()) as T;
  };
  return { fn, requisitar };
}

describe("selecionarAreasDaVista", () => {
  const areas = gradeDeAreas();

  it("200 áreas à vista: o teto limita as imagens e marca como truncado", () => {
    const sel = selecionarAreasDaVista(areas, VISTA_TODA);
    expect(areas).toHaveLength(200);
    expect(sel.naVista).toBe(200);
    expect(sel.idsNaVista).toHaveLength(200);
    expect(sel.ids).toHaveLength(TETO_RASTERS_NO_VIEWPORT);
    expect(sel.truncado).toBe(true);
  });

  it("só entram as áreas que cruzam a vista", () => {
    const sel = selecionarAreasDaVista(areas, { oeste: -55.001, sul: -15.001, leste: -54.97, norte: -14.97 });
    expect(sel.naVista).toBeGreaterThan(0);
    expect(sel.naVista).toBeLessThan(20);
    expect(sel.truncado).toBe(false);
    for (const id of sel.ids) expect(id.startsWith("area-0")).toBe(true);
  });

  it("sem vista (mapa não pronto) nada é pedido; polígono sem geometria é ignorado", () => {
    expect(selecionarAreasDaVista(areas, null).ids).toEqual([]);
    expect(selecionarAreasDaVista([{ id: "x", geometria: null }], VISTA_TODA).ids).toEqual([]);
  });

  it("as mais próximas do centro vêm primeiro e a área prioritária sempre entra", () => {
    const longe = areas[0]!.id;
    const sel = selecionarAreasDaVista(areas, VISTA_TODA, { teto: 5, prioritarias: [longe] });
    expect(sel.ids[0]).toBe(longe);
    expect(sel.ids).toHaveLength(5);
  });
});

describe("pedidos de raster (fetch simulado)", () => {
  const areas = gradeDeAreas();

  it("200 áreas × 6 índices: uma listagem do índice ativo, com no máximo o teto de ids — nunca 200×6", async () => {
    const { fn, requisitar } = fetchSimulado();
    const sel = selecionarAreasDaVista(areas, VISTA_TODA);
    const dtos = await listarRastersPorAreas(sel.ids, "ndvi", requisitar);
    expect(dtos).toHaveLength(TETO_RASTERS_NO_VIEWPORT);
    expect(fn).toHaveBeenCalledTimes(1);
    const url = new URL(fn.mock.calls[0]![0], "http://api.local");
    expect(url.searchParams.get("indice")).toBe("ndvi");
    expect(url.searchParams.get("area_ids")!.split(",")).toHaveLength(TETO_RASTERS_NO_VIEWPORT);
  });

  it("data escolhida: manda data_imagem; sem data (última imagem útil) o parâmetro NÃO existe", async () => {
    const { fn, requisitar } = fetchSimulado();
    await listarRastersPorAreas(["a1"], "ndmi", requisitar, { dataImagem: "2026-09-10" });
    await listarRastersPorAreas(["a1"], "ndmi", requisitar);
    const [comData, semData] = fn.mock.calls.map((c) => new URL(c[0], "http://api.local").searchParams);
    expect(comData!.get("data_imagem")).toBe("2026-09-10");
    expect(comData!.get("indice")).toBe("ndmi");
    expect(semData!.has("data_imagem")).toBe(false);
  });

  it("contexto=condicao: a listagem operacional manda o enum estrito (backend resolve pastagem-essencial-v2)", async () => {
    const { fn, requisitar } = fetchSimulado();
    await listarRastersPorAreas(["a1"], "ndvi", requisitar, { contexto: "condicao" });
    const params = new URL(fn.mock.calls[0]![0], "http://api.local").searchParams;
    expect(params.get("contexto")).toBe("condicao");
  });

  it("navegar pelos 6 índices na mesma vista = 6 listagens, não 1.200", async () => {
    const { fn, requisitar } = fetchSimulado();
    const sel = selecionarAreasDaVista(areas, VISTA_TODA);
    for (const indice of INDICES) await listarRastersPorAreas(sel.ids, indice, requisitar);
    expect(fn).toHaveBeenCalledTimes(INDICES.length);
    const pedidos = fn.mock.calls.flatMap((c) => new URL(c[0], "http://api.local").searchParams.get("indice"));
    expect(pedidos).toEqual([...INDICES]);
    const idsPedidos = fn.mock.calls.reduce((n, c) => n + new URL(c[0], "http://api.local").searchParams.get("area_ids")!.split(",").length, 0);
    expect(idsPedidos).toBe(INDICES.length * TETO_RASTERS_NO_VIEWPORT);
    expect(idsPedidos).toBeLessThan(areas.length * INDICES.length);
  });

  it("o cache evita repetir: só os ids que faltam vão à rede", () => {
    const sel = selecionarAreasDaVista(areas, VISTA_TODA);
    const emCache = new Set(sel.ids.slice(0, 50));
    expect(idsFaltando(sel.ids, emCache)).toHaveLength(TETO_RASTERS_NO_VIEWPORT - 50);
    expect(idsFaltando(sel.ids, new Set(sel.ids))).toEqual([]);
  });

  it("acima de 200 ids a listagem parte em lotes de 200", async () => {
    const { fn, requisitar } = fetchSimulado();
    const ids = Array.from({ length: 450 }, (_, i) => `a-${i}`);
    const dtos = await listarRastersPorAreas(ids, "bsi", requisitar);
    expect(dtos).toHaveLength(450);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("ids repetidos e vazios não geram pedido; lista vazia não chama a rede", async () => {
    const { fn, requisitar } = fetchSimulado();
    expect(await listarRastersPorAreas([], "ndvi", requisitar)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
    await listarRastersPorAreas(["a", "a", ""], "ndvi", requisitar);
    expect(new URL(fn.mock.calls[0]![0], "http://api.local").searchParams.get("area_ids")).toBe("a");
  });

  it("pedido obsoleto é abortado antes de ir à rede", async () => {
    const { fn, requisitar } = fetchSimulado();
    const controle = new AbortController();
    controle.abort();
    await expect(listarRastersPorAreas(["a"], "ndvi", requisitar, { signal: controle.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).not.toHaveBeenCalled();
  });
});
