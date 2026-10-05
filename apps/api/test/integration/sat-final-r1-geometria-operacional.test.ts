import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";
import { TEST_URL, harness, type Harness } from "./setup.js";

/**
 * SATÉLITE COMPLETO R1 — GEO + última útil × último raster.
 * /mapa/rasters e /mapa/analises-satelitais/resumo só operam no polígono atual.
 */

let h: Harness;
let admin: Db;
let A = "";

const POLIGONO_A = {
  type: "Polygon",
  coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]]
};
const POLIGONO_B = {
  type: "Polygon",
  coordinates: [[[-56.1, -15.6], [-56.1, -15.585], [-56.085, -15.585], [-56.085, -15.6], [-56.1, -15.6]]]
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
    [h.demo.orgId, A, code, `[TEST] ${code}`, JSON.stringify(POLIGONO_A)]);
  return r.rows[0]!.id;
}

async function shaArea(areaId: string): Promise<string> {
  const r = await admin.query<{ sha: string }>(
    `select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') as sha from erp.areas where id=$1`, [areaId]);
  return r.rows[0]!.sha;
}

async function gravarAnalise(opts: {
  areaId: string; sha: string; createdAt: string; observacaoInicio: string; observacaoFim: string;
  valor?: number;
}): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `insert into erp.analises_satelitais (
        organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
        valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado,
        pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi',$4,$5,
        $6::timestamptz,$7::timestamptz,10,'concluida',$8::timestamptz,$9::timestamptz,
        $10,0.4,0.7,0.05,100,10,90,100,0.9000,$11,$12::timestamptz) returning id`,
    [
      h.demo.orgId, A, opts.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL, opts.sha,
      new Date(Date.parse(opts.observacaoInicio) - 10 * 86_400_000).toISOString(),
      new Date(Date.parse(opts.observacaoFim) + 5 * 86_400_000).toISOString(),
      opts.observacaoInicio, opts.observacaoFim, opts.valor ?? 0.55,
      h.demo.adminUserId, opts.createdAt
    ]);
  return r.rows[0]!.id;
}

/** Metadado mínimo de raster (arquivo stub) ligado a uma análise. */
async function gravarRasterStub(opts: {
  areaId: string; analiseId: string; sha: string; dataImagem: string; chave: string;
}): Promise<string> {
  const path = `${h.demo.orgId}/${opts.areaId}/ndvi/${opts.dataImagem}/${opts.chave}.png`;
  // Conteúdo mínimo válido (CHECK: 1..16 MiB) — sha256 do corpo, não do caminho.
  const conteudo = Buffer.alloc(64, 1);
  const crypto = await import("node:crypto");
  const sha = crypto.createHash("sha256").update(conteudo).digest("hex");
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

describe("SAT-FINAL R1 — geometria operacional", () => {
  it("GEO-1: após redesenho B, /mapa/rasters não devolve raster A", async () => {
    const areaId = await novaArea("geo1");
    const shaA = await shaArea(areaId);
    const analiseA = await gravarAnalise({
      areaId, sha: shaA, createdAt: "2026-09-01T12:00:00Z",
      observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    const chaveA = "a".repeat(64);
    await gravarRasterStub({ areaId, analiseId: analiseA, sha: shaA, dataImagem: "2026-09-01", chave: chaveA });

    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const shaB = await shaArea(areaId);
    expect(shaB).not.toBe(shaA);

    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { id: string; geometria_sha256: string }[] };
    expect(body.itens.every((i) => i.geometria_sha256 === shaB)).toBe(true);
    expect(body.itens).toHaveLength(0);
  });

  it("GEO-2: resumo global não serve valor A após redesenho B", async () => {
    const areaId = await novaArea("geo2");
    const shaA = await shaArea(areaId);
    await gravarAnalise({
      areaId, sha: shaA, createdAt: "2026-09-01T12:00:00Z",
      observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z", valor: 0.77
    });
    const antes = await h.app.inject({
      method: "GET", url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&tamanho=500`, headers: h.headers()
    });
    expect(antes.statusCode).toBe(200);
    const itensAntes = (antes.json() as { itens: { area_id: string; ultima_observacao: { valor_medio: string } | null }[] }).itens;
    expect(itensAntes.find((i) => i.area_id === areaId)?.ultima_observacao?.valor_medio).toBeTruthy();

    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const depois = await h.app.inject({
      method: "GET", url: `/api/mapa/analises-satelitais/resumo?indice=ndvi&tamanho=500`, headers: h.headers()
    });
    const itensDepois = (depois.json() as { itens: { area_id: string; ultima_observacao: unknown }[] }).itens;
    expect(itensDepois.find((i) => i.area_id === areaId)).toBeUndefined();
  });

  it("GEO-6: análise A permanece no banco após redesenho", async () => {
    const areaId = await novaArea("geo6");
    const shaA = await shaArea(areaId);
    const idA = await gravarAnalise({
      areaId, sha: shaA, createdAt: "2026-09-01T12:00:00Z",
      observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const ainda = await admin.query(`select id from erp.analises_satelitais where id=$1`, [idA]);
    expect(ainda.rows[0]).toBeTruthy();
  });

  it("última útil sem raster: não devolve raster antigo como se fosse a útil nova", async () => {
    const areaId = await novaArea("ultima-util");
    const sha = await shaArea(areaId);
    const a1 = await gravarAnalise({
      areaId, sha, createdAt: "2026-09-01T12:00:00Z",
      observacaoInicio: "2026-09-01T00:00:00Z", observacaoFim: "2026-09-02T00:00:00Z"
    });
    await gravarRasterStub({
      areaId, analiseId: a1, sha, dataImagem: "2026-09-01", chave: "b".repeat(64)
    });
    // Nova análise útil SEM raster
    await gravarAnalise({
      areaId, sha, createdAt: "2026-10-05T12:00:00Z",
      observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z", valor: 0.33
    });

    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { data_imagem: string }[]; modo: string };
    expect(body.modo).toBe("ultima");
    // Não pode devolver 2026-09-01 como se fosse a última útil (05/10)
    expect(body.itens.some((i) => i.data_imagem === "2026-09-01")).toBe(false);
    expect(body.itens).toHaveLength(0);
  });

  it("DATA exata: nunca faz fallback para latest", async () => {
    const areaId = await novaArea("data-exata");
    const sha = await shaArea(areaId);
    const a1 = await gravarAnalise({
      areaId, sha, createdAt: "2026-10-01T12:00:00Z",
      observacaoInicio: "2026-10-01T00:00:00Z", observacaoFim: "2026-10-02T00:00:00Z"
    });
    const a2 = await gravarAnalise({
      areaId, sha, createdAt: "2026-10-05T12:00:00Z",
      observacaoInicio: "2026-10-05T00:00:00Z", observacaoFim: "2026-10-06T00:00:00Z"
    });
    await gravarRasterStub({ areaId, analiseId: a1, sha, dataImagem: "2026-10-01", chave: "c".repeat(64) });
    await gravarRasterStub({ areaId, analiseId: a2, sha, dataImagem: "2026-10-05", chave: "d".repeat(64) });

    const r = await h.app.inject({
      method: "GET",
      url: `/api/mapa/rasters?area_ids=${areaId}&indice=ndvi&data_imagem=2026-10-01`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { itens: { data_imagem: string }[]; modo: string };
    expect(body.modo).toBe("data");
    expect(body.itens).toHaveLength(1);
    expect(body.itens[0]!.data_imagem).toBe("2026-10-01");
  });
});
