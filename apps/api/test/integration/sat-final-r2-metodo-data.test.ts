import { createHash, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import {
  VERSAO_METODO_NDVI,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  VERSAO_METODO_PASTAGEM_ESSENCIAL_V1
} from "@agro/domain";
import { TEST_URL, harness, type Harness } from "./setup.js";

/**
 * SATÉLITE COMPLETO R2 — método ativo pastagem-essencial-v2 + data civil + resumo por data.
 * Contexto `condicao` nunca mistura standalone/v1; data inválida = 422 (nunca 500).
 */

let h: Harness;
let admin: Db;
let A = "";

const POLIGONO = {
  type: "Polygon",
  coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]]
};

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  A = h.demo.empresaIds[0]!;
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await h?.app.close();
  await h?.db.end();
});

async function novaArea(code: string): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`,
    [h.demo.orgId, A, code, `[TEST] ${code}`, JSON.stringify(POLIGONO)]);
  return r.rows[0]!.id;
}

async function shaArea(areaId: string): Promise<string> {
  const r = await admin.query<{ sha: string }>(
    `select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') as sha from erp.areas where id=$1`, [areaId]);
  return r.rows[0]!.sha;
}

async function gravarAnalise(opts: {
  areaId: string; sha: string; metodo: string; createdAt: string;
  observacaoInicio: string; observacaoFim: string; valor: number; indice?: string;
}): Promise<string> {
  const medio = opts.valor;
  const r = await admin.query<{ id: string }>(
    `insert into erp.analises_satelitais (
        organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
        valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado,
        pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a',$4,$5,$6,
        $7::timestamptz,$8::timestamptz,10,'concluida',$9::timestamptz,$10::timestamptz,
        $11,$11-0.1,$11+0.1,0.05,100,10,90,100,0.9000,$12,$13::timestamptz) returning id`,
    [
      h.demo.orgId, A, opts.areaId, opts.indice ?? "ndvi", opts.metodo, opts.sha,
      new Date(Date.parse(opts.observacaoInicio) - 10 * 86_400_000).toISOString(),
      new Date(Date.parse(opts.observacaoFim) + 5 * 86_400_000).toISOString(),
      opts.observacaoInicio, opts.observacaoFim, medio,
      h.demo.adminUserId, opts.createdAt
    ]);
  return r.rows[0]!.id;
}

async function gravarRasterStub(opts: {
  areaId: string; analiseId: string; sha: string; dataImagem: string; chave: string;
}): Promise<string> {
  const path = `${h.demo.orgId}/${opts.areaId}/ndvi/${opts.dataImagem}/${opts.chave}.png`;
  const conteudo = Buffer.alloc(64, 1);
  const sha = createHash("sha256").update(conteudo).digest("hex");
  await admin.query(
    `insert into erp.satelite_raster_arquivos (organization_id, empresa_id, storage_path, conteudo, sha256_arquivo, tamanho_bytes)
     values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
    [h.demo.orgId, A, path, conteudo, sha, conteudo.length]);
  const r = await admin.query<{ id: string }>(
    `insert into erp.satelite_rasters (
        organization_id, empresa_id, criado_por, analise_id, area_id, geometria_sha256, indice, tipo,
        versao_evalscript, data_imagem, storage_path, sha256_arquivo, largura, altura,
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat, escala_min, escala_max,
        resolucao_m, chave_cache)
     values ($1,$2,$3,$4,$5,$6,'ndvi','valores','ndvi-valores-v1',$7::date,$8,$9,32,32,
        0,0,1,1,$10::jsonb,-0.2,1.0,10,$11)
     returning id`,
    [
      h.demo.orgId, A, h.demo.adminUserId, opts.analiseId, opts.areaId, opts.sha, opts.dataImagem, path, sha,
      JSON.stringify([[-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]),
      opts.chave
    ]);
  return r.rows[0]!.id;
}

function mediaDoResumo(body: { itens: { area_id: string; ultima_observacao: { valor_medio: string } | null }[] }, areaId: string) {
  const m = body.itens.find((i) => i.area_id === areaId)?.ultima_observacao?.valor_medio ?? null;
  return m === null ? null : Number(m);
}

describe("SAT-FINAL R2 — método ativo pastagem-essencial-v2", () => {
  it("MET-1: standalone mais recente + v2 anterior → Condição usa v2", async () => {
    const areaId = await novaArea("met1");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.45,
      createdAt: "2026-09-01T12:00:00Z", observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_NDVI, valor: 0.80,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&tamanho=500`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { area_id: string; ultima_observacao: { valor_medio: string } | null }[]; versao_metodo: string };
    expect(body.versao_metodo).toBe(VERSAO_METODO_PASTAGEM_ESSENCIAL);
    expect(mediaDoResumo(body, areaId)).toBeCloseTo(0.45, 4);
  });

  it("MET-2: v1 mais recente + v2 anterior → Condição usa v2", async () => {
    const areaId = await novaArea("met2");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.45,
      createdAt: "2026-09-01T12:00:00Z", observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, valor: 0.70,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&tamanho=500`,
      headers: h.headers()
    });
    expect(mediaDoResumo(r.json() as Parameters<typeof mediaDoResumo>[0], areaId)).toBeCloseTo(0.45, 4);
  });

  it("MET-3: raster v1 mais recente + raster v2 anterior → modo Última usa v2", async () => {
    const areaId = await novaArea("met3");
    const sha = await shaArea(areaId);
    const aV2 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.45,
      createdAt: "2026-09-01T12:00:00Z", observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    const aV1 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, valor: 0.70,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: aV2, sha, dataImagem: "2026-09-01", chave: "e".repeat(64) });
    await gravarRasterStub({ areaId, analiseId: aV1, sha, dataImagem: "2026-10-05", chave: "f".repeat(64) });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { data_imagem: string; analise_id: string }[]; versao_metodo: string };
    expect(body.versao_metodo).toBe(VERSAO_METODO_PASTAGEM_ESSENCIAL);
    expect(body.itens).toHaveLength(1);
    expect(body.itens[0]!.data_imagem).toBe("2026-09-01");
    expect(body.itens[0]!.analise_id).toBe(aV2);
  });

  it("MET-4: mesma data com raster v1 e v2 → Condição usa v2", async () => {
    const areaId = await novaArea("met4");
    const sha = await shaArea(areaId);
    const aV2 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.45,
      createdAt: "2026-10-01T11:00:00Z", observacaoInicio: "2026-10-01T00:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    const aV1 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, valor: 0.70,
      createdAt: "2026-10-01T12:00:00Z", observacaoInicio: "2026-10-01T06:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: aV2, sha, dataImagem: "2026-10-01", chave: "1".repeat(64) });
    await gravarRasterStub({ areaId, analiseId: aV1, sha, dataImagem: "2026-10-01", chave: "2".repeat(64) });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao&data_imagem=2026-10-01`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { analise_id: string; data_imagem: string }[] };
    expect(body.itens).toHaveLength(1);
    expect(body.itens[0]!.analise_id).toBe(aV2);
    expect(body.itens[0]!.data_imagem).toBe("2026-10-01");
  });

  it("MET-5: só v1 existente → Condição = sem análise atual (nunca fallback v1)", async () => {
    const areaId = await novaArea("met5");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, valor: 0.70,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    const resumo = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&tamanho=500`,
      headers: h.headers()
    });
    expect(mediaDoResumo(resumo.json() as Parameters<typeof mediaDoResumo>[0], areaId)).toBeNull();
    expect((resumo.json() as { itens: { area_id: string }[] }).itens.find((i) => i.area_id === areaId)).toBeUndefined();
    const rasters = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao`,
      headers: h.headers()
    });
    expect((rasters.json() as { itens: unknown[] }).itens).toHaveLength(0);
  });

  it("MET-6: Áreas desatualizadas inclui área com somente v1", async () => {
    const areaId = await novaArea("met6");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL_V1, valor: 0.70,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&tamanho=500`,
      headers: h.headers()
    });
    const body = r.json() as { itens: { area_id: string; ultima_observacao: unknown }[] };
    // Sem observação v2 no resumo → a UI trata como desatualizada (área com geometria e sem ultima_observacao).
    expect(body.itens.find((i) => i.area_id === areaId)).toBeUndefined();
  });
});

describe("SAT-FINAL R2 — resumo/raster por data (sem fallback temporal)", () => {
  it("DATA-1: seleciona 01/10 → resumo e raster de 01/10 (não 05/10)", async () => {
    const areaId = await novaArea("data1");
    const sha = await shaArea(areaId);
    const a01 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.42,
      createdAt: "2026-10-01T12:00:00Z", observacaoInicio: "2026-10-01T00:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    const a05 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.80,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: a01, sha, dataImagem: "2026-10-01", chave: "a".repeat(64) });
    await gravarRasterStub({ areaId, analiseId: a05, sha, dataImagem: "2026-10-05", chave: "b".repeat(64) });

    const resumo = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&data_imagem=2026-10-01&tamanho=500`,
      headers: h.headers()
    });
    expect(resumo.statusCode, resumo.body).toBe(200);
    const corpoResumo = resumo.json() as {
      modo: string; data_imagem: string; itens: { area_id: string; ultima_observacao: { valor_medio: string; observacao_inicio: string } | null }[]
    };
    expect(corpoResumo.modo).toBe("data");
    expect(corpoResumo.data_imagem).toBe("2026-10-01");
    expect(mediaDoResumo(corpoResumo, areaId)).toBeCloseTo(0.42, 4);
    expect(corpoResumo.itens.find((i) => i.area_id === areaId)?.ultima_observacao?.observacao_inicio.startsWith("2026-10-01")).toBe(true);

    const rasters = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao&data_imagem=2026-10-01`,
      headers: h.headers()
    });
    const corpoRaster = rasters.json() as { itens: { data_imagem: string }[] };
    expect(corpoRaster.itens).toHaveLength(1);
    expect(corpoRaster.itens[0]!.data_imagem).toBe("2026-10-01");
  });

  it("DATA-2: 01/10 stats sem raster + 05/10 completo → fallback = stats 01/10 (sem raster)", async () => {
    const areaId = await novaArea("data2");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.42,
      createdAt: "2026-10-01T12:00:00Z", observacaoInicio: "2026-10-01T00:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    const a05 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.80,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: a05, sha, dataImagem: "2026-10-05", chave: "c".repeat(64) });

    const resumo = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&data_imagem=2026-10-01&tamanho=500`,
      headers: h.headers()
    });
    expect(mediaDoResumo(resumo.json() as Parameters<typeof mediaDoResumo>[0], areaId)).toBeCloseTo(0.42, 4);

    const rasters = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao&data_imagem=2026-10-01`,
      headers: h.headers()
    });
    expect((rasters.json() as { itens: unknown[] }).itens).toHaveLength(0);
  });

  it("DATA-3: 01/10 sem stats/raster + 05/10 completo → neutro (nunca 05/10)", async () => {
    const areaId = await novaArea("data3");
    const sha = await shaArea(areaId);
    const a05 = await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.80,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: a05, sha, dataImagem: "2026-10-05", chave: "d".repeat(64) });

    const resumo = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&data_imagem=2026-10-01&tamanho=500`,
      headers: h.headers()
    });
    expect((resumo.json() as { itens: { area_id: string }[] }).itens.find((i) => i.area_id === areaId)).toBeUndefined();

    const rasters = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&contexto=condicao&data_imagem=2026-10-01`,
      headers: h.headers()
    });
    expect((rasters.json() as { itens: unknown[] }).itens).toHaveLength(0);
  });

  it("DATA-6: sem data_imagem → última útil v2", async () => {
    const areaId = await novaArea("data6");
    const sha = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.42,
      createdAt: "2026-10-01T12:00:00Z", observacaoInicio: "2026-10-01T00:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    await gravarAnalise({
      areaId, sha, metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL, valor: 0.80,
      createdAt: "2026-10-05T12:00:00Z", observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&tamanho=500`,
      headers: h.headers()
    });
    const body = r.json() as { modo: string; data_imagem: null; itens: { area_id: string; ultima_observacao: { valor_medio: string } | null }[] };
    expect(body.modo).toBe("ultima");
    expect(body.data_imagem).toBeNull();
    expect(mediaDoResumo(body, areaId)).toBeCloseTo(0.80, 4);
  });
});

describe("SAT-FINAL R2 — data civil inválida fail-closed", () => {
  it("API-DATE-1: data_imagem=2026-02-31 no raster → 422", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${randomUUID()}&indice=ndvi&contexto=condicao&data_imagem=2026-02-31`,
      headers: h.headers()
    });
    expect(r.statusCode).toBe(422);
  });

  it("API-DATE-2: resumo por data inválida → 422", async () => {
    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&contexto=condicao&data_imagem=2026-02-29&tamanho=10`,
      headers: h.headers()
    });
    expect(r.statusCode).toBe(422);
  });

  it("API-DATE-3: datas civis inválidas nunca viram 500", async () => {
    const invalidas = ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31", "2026-02-29"];
    for (const d of invalidas) {
      const raster = await h.app.inject({
        method: "GET",
        url: `/api/mapa/rasters?area_ids=${randomUUID()}&indice=ndvi&data_imagem=${d}`,
        headers: h.headers()
      });
      expect(raster.statusCode, `raster ${d}`).toBe(422);
      expect(raster.statusCode).not.toBe(500);
      const resumo = await h.app.inject({
        method: "GET",
        url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&data_imagem=${d}&tamanho=10`,
        headers: h.headers()
      });
      expect(resumo.statusCode, `resumo ${d}`).toBe(422);
      expect(resumo.statusCode).not.toBe(500);
    }
    const ok = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${randomUUID()}&indice=ndvi&data_imagem=2028-02-29`,
      headers: h.headers()
    });
    expect(ok.statusCode).not.toBe(422);
    expect(ok.statusCode).not.toBe(500);
  });
});
