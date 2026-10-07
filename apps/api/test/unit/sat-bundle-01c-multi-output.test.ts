import { describe, expect, it, vi, afterEach } from "vitest";
import { pack as tarPack } from "tar-stream";
import { PassThrough } from "node:stream";
import {
  IDS_OUTPUT_BUNDLE_ESPACIAL, montarCorpoProcessoBundleEspacial, montarEvalscriptBundleEspacial,
  RESOLUCAO_BUNDLE_ESPACIAL_M, VERSAO_EVALSCRIPT_BUNDLE_ESPACIAL
} from "../../src/lib/satelite/evalscript-bundle-espacial.js";
import {
  FalhaTarProcesso, TAMANHO_MAXIMO_MEMBRO_TAR_BYTES, extrairPngsDoTarProcesso, identifierDoMembroTar
} from "../../src/lib/satelite/tar-processo.js";
import { escreverPngCinza8 } from "../../src/lib/satelite/png.js";
import * as matMod from "../../src/lib/satelite/materializar-produtos-observacao.js";
import {
  garantirProdutoCondicaoOperacional, garantirProdutosDaObservacaoCompleta,
  repararProdutoPrincipalObservacao, type DependenciasGarantirProdutos
} from "../../src/lib/satelite/garantir-produtos-observacao.js";
import { ERROS_ITEM } from "../../src/lib/satelite/executar-item.js";
import { statusBundleDe, identidadeDoBundle, INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";

const AREA = "00000000-0000-4000-8000-000000000003";
const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const CONSULTA = "00000000-0000-4000-8000-000000000010";
const ITEM = "00000000-0000-4000-8000-000000000011";

function pngTiny(v = 1): Buffer {
  return escreverPngCinza8(2, 2, [v, v, v, v]);
}

async function montarTar(membros: Array<{ nome: string; corpo: Buffer }>): Promise<Buffer> {
  const pack = tarPack();
  const chunks: Buffer[] = [];
  const out = new PassThrough();
  out.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const done = new Promise<Buffer>((resolve, reject) => {
    out.on("finish", () => resolve(Buffer.concat(chunks)));
    out.on("error", reject);
    pack.on("error", reject);
  });
  pack.pipe(out);
  for (const m of membros) {
    pack.entry({ name: m.nome, size: m.corpo.length }, m.corpo);
  }
  pack.finalize();
  return done;
}

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

function resultado(opts: {
  chamadas: number;
  solicitados?: typeof IDS_OUTPUT_BUNDLE_ESPACIAL[number][];
  reutilizados?: typeof IDS_OUTPUT_BUNDLE_ESPACIAL[number][];
  falhos?: typeof IDS_OUTPUT_BUNDLE_ESPACIAL[number][];
  completo?: boolean;
}): matMod.ResultadoMaterializacaoObservacao {
  const reutilizados = opts.reutilizados ?? [];
  const solicitados = opts.solicitados ?? [];
  const falhos = new Set(opts.falhos ?? []);
  const produtos = IDS_OUTPUT_BUNDLE_ESPACIAL.map((id) => {
    if (falhos.has(id)) return { id, status: "falhou" as const, recurso_id: null, erro: "membro_ausente" };
    if (reutilizados.includes(id)) return { id, status: "reutilizado" as const, recurso_id: `r-${id}` };
    if (solicitados.includes(id) || opts.chamadas > 0) {
      return { id, status: "pronto" as const, recurso_id: `p-${id}` };
    }
    return { id, status: "reutilizado" as const, recurso_id: `r-${id}` };
  });
  const completo = opts.completo ?? produtos.every((p) => p.status === "pronto" || p.status === "reutilizado");
  return {
    area_id: AREA, data_imagem: "2026-10-01", produtos,
    chamadas_process: opts.chamadas,
    outputs_solicitados: solicitados,
    outputs_reutilizados: reutilizados,
    completo, pu_cabecalho: opts.chamadas > 0 ? "3.1" : null
  };
}

afterEach(() => vi.restoreAllMocks());

describe("SAT-BUNDLE-01C — MO (multi-output / TAR)", () => {
  it("MO-01: corpo Process pede 7 responses quando tudo falta", () => {
    const grade = {
      bbox3857: [1, 2, 3, 4] as const,
      poligono3857: { coordinates: [[[1, 2], [3, 2], [3, 4], [1, 4], [1, 2]]] },
      largura: 10, altura: 10
    };
    const corpo = montarCorpoProcessoBundleEspacial(
      grade,
      { inicio: new Date("2026-10-01T00:00:00Z"), fim: new Date("2026-10-01T00:00:10Z") },
      [...IDS_OUTPUT_BUNDLE_ESPACIAL],
      "sentinel-2-l2a"
    ) as { output: { responses: Array<{ identifier: string }> }; evalscript: string };
    expect(corpo.output.responses.map((r) => r.identifier)).toEqual([...IDS_OUTPUT_BUNDLE_ESPACIAL]);
    expect(corpo.evalscript).toContain("ndvi");
    expect(corpo.evalscript).toContain("condicao");
    expect(corpo.evalscript).toContain(VERSAO_EVALSCRIPT_BUNDLE_ESPACIAL);
    expect(RESOLUCAO_BUNDLE_ESPACIAL_M).toBe(20);
  });

  it("MO-02: TAR válido com 7 entries → 7 PNGs extraídos", async () => {
    const tar = await montarTar(IDS_OUTPUT_BUNDLE_ESPACIAL.map((id) => ({
      nome: `${id}.png`, corpo: pngTiny(id === "condicao" ? 1 : 40)
    })));
    const m = await extrairPngsDoTarProcesso(tar, [...IDS_OUTPUT_BUNDLE_ESPACIAL]);
    expect(m.size).toBe(7);
    for (const id of IDS_OUTPUT_BUNDLE_ESPACIAL) {
      expect(m.get(id)?.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    }
  });

  it("MO-03: todos em cache → zero Process", async () => {
    vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultado({
        chamadas: 0,
        reutilizados: [...IDS_OUTPUT_BUNDLE_ESPACIAL]
      })
    );
    const r = await garantirProdutosDaObservacaoCompleta(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA, politica: "principal"
    });
    expect(r.chamadas_process).toBe(0);
    expect(r.completo).toBe(true);
    expect(r.outputs_solicitados).toEqual([]);
  });

  it("MO-04: 3 faltantes → uma Process, não três", async () => {
    const faltantes = ["ndmi", "msavi2", "bsi"] as const;
    vi.spyOn(matMod, "materializarProdutosDaObservacao").mockResolvedValue(
      resultado({
        chamadas: 1,
        solicitados: [...faltantes],
        reutilizados: ["condicao", "ndvi", "evi2", "ndre"]
      })
    );
    const r = await garantirProdutosDaObservacaoCompleta(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA, politica: "principal"
    });
    expect(r.chamadas_process).toBe(1);
    expect(r.outputs_solicitados).toEqual([...faltantes]);
    expect(r.outputs_solicitados).toHaveLength(3);
  });

  it("MO-05/06/07: evalscript parcial só declara faltantes; v3 no builder", () => {
    const es = montarEvalscriptBundleEspacial(["ndmi", "bsi"]);
    expect(es).toContain('id: "ndmi"');
    expect(es).toContain('id: "bsi"');
    expect(es).not.toContain('id: "ndvi"');
    expect(es).not.toContain("byte_condicao");
    const esCond = montarEvalscriptBundleEspacial(["condicao"]);
    expect(esCond).toContain("byte_condicao");
    expect(esCond).toContain("MSAVI2_BOA");
  });

  it("MO-08: membro TAR faltante → fail-closed", async () => {
    const tar = await montarTar([
      { nome: "ndvi.png", corpo: pngTiny() },
      { nome: "evi2.png", corpo: pngTiny() }
    ]);
    await expect(extrairPngsDoTarProcesso(tar, ["ndvi", "evi2", "ndre"]))
      .rejects.toMatchObject({ motivo: "membro_ausente" });
  });

  it("MO-09: membro TAR duplicado → fail-closed", async () => {
    const tar = await montarTar([
      { nome: "ndvi.png", corpo: pngTiny() },
      { nome: "ndvi", corpo: pngTiny(2) }
    ]);
    await expect(extrairPngsDoTarProcesso(tar, ["ndvi"]))
      .rejects.toMatchObject({ motivo: "membro_duplicado" });
  });

  it("MO-10: membro inesperado não confunde identifier", async () => {
    const tar = await montarTar([
      { nome: "userdata.json", corpo: Buffer.from("{}") },
      { nome: "ndvi.png", corpo: pngTiny() }
    ]);
    const m = await extrairPngsDoTarProcesso(tar, ["ndvi"]);
    expect(m.size).toBe(1);
    expect(m.has("ndvi")).toBe(true);
  });

  it("MO-11: path traversal → rejeitado", async () => {
    expect(identifierDoMembroTar("../ndvi.png")).toBeNull();
    expect(identifierDoMembroTar("/ndvi.png")).toBeNull();
    expect(identifierDoMembroTar("foo/ndvi.png")).toBeNull();
    const tar = await montarTar([{ nome: "../ndvi.png", corpo: pngTiny() }]);
    await expect(extrairPngsDoTarProcesso(tar, ["ndvi"]))
      .rejects.toBeInstanceOf(FalhaTarProcesso);
  });

  it("MO-12: arquivo acima do limite → rejeitado", async () => {
    const grande = Buffer.alloc(TAMANHO_MAXIMO_MEMBRO_TAR_BYTES + 1, 0);
    grande[0] = 0x89; grande[1] = 0x50; grande[2] = 0x4e; grande[3] = 0x47;
    const tar = await montarTar([{ nome: "ndvi.png", corpo: grande }]);
    await expect(extrairPngsDoTarProcesso(tar, ["ndvi"]))
      .rejects.toMatchObject({ motivo: "tamanho_excedido" });
  });

  it("MO-13: TAR malformado → resposta_malformada", async () => {
    await expect(extrairPngsDoTarProcesso(Buffer.from("not-a-tar"), ["ndvi"]))
      .rejects.toMatchObject({ motivo: "tar_malformado" });
  });
});

describe("SAT-BUNDLE-01C — PST / LED / WK / contrato", () => {
  it("PST-07 / LED-05: reparo com cache total → zero Process / zero consumo novo", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "reutilizado",
      resultado: resultado({ chamadas: 0, reutilizados: [...IDS_OUTPUT_BUNDLE_ESPACIAL] })
    });
    const r = await repararProdutoPrincipalObservacao(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA, consultaId: null, consultaItemId: null
    });
    expect(r.status).toBe("reutilizado");
    expect(r.chamadas_process).toBe(0);
  });

  it("PST-07 parcial: reparo pede só faltantes", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "pronto",
      resultado: resultado({
        chamadas: 1,
        solicitados: ["ndmi", "bsi"],
        reutilizados: ["condicao", "ndvi", "evi2", "ndre", "msavi2"]
      })
    });
    const r = await repararProdutoPrincipalObservacao(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA
    });
    expect(r.outputs_solicitados).toEqual(["ndmi", "bsi"]);
    expect(r.chamadas_process).toBe(1);
  });

  it("LED-01/02: 1 Process → chamadas_process=1 com consulta/item", async () => {
    const spy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "pronto",
      resultado: resultado({ chamadas: 1, solicitados: [...IDS_OUTPUT_BUNDLE_ESPACIAL] })
    });
    const r = await garantirProdutoCondicaoOperacional(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA,
      consultaId: CONSULTA, consultaItemId: ITEM
    });
    expect(r.chamadas_process).toBe(1);
    expect(spy.mock.calls[0]![1]).toMatchObject({ consultaId: CONSULTA, consultaItemId: ITEM });
  });

  it("LED-03: reparo público null/null", async () => {
    const spy = vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValue({
      status: "pronto",
      resultado: resultado({ chamadas: 1, solicitados: ["condicao"] })
    });
    await repararProdutoPrincipalObservacao(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA, consultaId: null, consultaItemId: null
    });
    expect(spy.mock.calls[0]![1].consultaId).toBeNull();
    expect(spy.mock.calls[0]![1].consultaItemId).toBeNull();
  });

  it("WK-01/03: completo → pronto; parcial → falhou + produtos_bundle_falharam", async () => {
    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValueOnce({
      status: "pronto",
      resultado: resultado({ chamadas: 1, solicitados: [...IDS_OUTPUT_BUNDLE_ESPACIAL] })
    });
    const ok = await garantirProdutoCondicaoOperacional(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA
    });
    expect(ok.status).toBe("pronto");
    expect(ok.completo).toBe(true);

    vi.spyOn(matMod, "materializarProdutosOperacional").mockResolvedValueOnce({
      status: "falhou",
      resultado: resultado({
        chamadas: 1,
        solicitados: [...IDS_OUTPUT_BUNDLE_ESPACIAL],
        falhos: ["bsi"],
        completo: false
      })
    });
    const falha = await garantirProdutoCondicaoOperacional(depBase(), {
      orgId: ORG, userId: USER, areaId: AREA
    });
    expect(falha.status).toBe("falhou");
    expect(falha.erro).toBe("produtos_bundle_falharam");
    expect(ERROS_ITEM.produtosBundleFalharam).toBe("produtos_bundle_falharam");
  });

  it("WK-05: motivo estável não é area_nao_encontrada", () => {
    expect(ERROS_ITEM.produtosBundleFalharam).not.toBe(ERROS_ITEM.areaNaoEncontrada);
  });

  it("CONTRATO 7/7: status_bundle completo só com condição + 6 rasters", () => {
    const linhas = INDICES_BUNDLE_ESSENCIAL.map((indice) => ({
      indice,
      organization_id: ORG,
      empresa_id: ORG,
      area_id: AREA,
      geometria_sha256: "b".repeat(64),
      versao_metodo: "pastagem-essencial-v2",
      observacao_inicio: "2026-10-01T12:00:00.000Z",
      observacao_fim: "2026-10-01T12:00:10.000Z"
    }));
    const id = identidadeDoBundle(linhas)!;
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: true, rastersDisponiveis: 6
    })).toBe("completo");
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: true, rastersDisponiveis: 5
    })).toBe("produtos_parciais");
  });
});
