import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { INDICES_BUNDLE_ESSENCIAL, VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";
import { TEST_URL, harness, type Harness } from "./setup.js";

/**
 * SAT-08 R3 — GET /api/satelite/areas/:areaId/resumo
 * Última observação útil (bundle concluído completo) ≠ última tentativa
 * (pode ser sem_observacao_util). Nunca mistura índices de bundles distintos.
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

async function gravarBundle(opts: {
  areaId: string;
  janelaInicio: string;
  janelaFim: string;
  situacao: "concluida" | "sem_observacao_util";
  observacaoInicio?: string | null;
  observacaoFim?: string | null;
  motivo?: string | null;
  cobertura?: number;
  createdAt?: string;
  incompleto?: boolean;
  sha?: string;
}): Promise<Record<string, string>> {
  const sha = opts.sha ?? await shaArea(opts.areaId);
  const indices = opts.incompleto ? (["ndvi", "evi2"] as const) : INDICES_BUNDLE_ESSENCIAL;
  const ids: Record<string, string> = {};
  const cob = opts.cobertura ?? 0.85;
  const concluida = opts.situacao === "concluida";
  for (const indice of indices) {
    const r = await admin.query<{ id: string }>(
      `insert into erp.analises_satelitais (
          organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
          janela_inicio, janela_fim, resolucao_m, resolucao_nativa_m, situacao, motivo_qualidade,
          observacao_inicio, observacao_fim, valor_medio, valor_minimo, valor_maximo, desvio_padrao,
          pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a',$4,$5,$6,$7,$8,20,10,$9,$10,
          $11::timestamptz,$12::timestamptz,
          case when $9='concluida' then 0.55 end, case when $9='concluida' then 0.40 end,
          case when $9='concluida' then 0.70 end, case when $9='concluida' then 0.05 end,
          case when $9='concluida' then 100 end, case when $9='concluida' then 15 end,
          case when $9='concluida' then 85 end, 100,
          case when $9='concluida' then $13::numeric end, $14, coalesce($15::timestamptz, now()))
       returning id`,
      [
        h.demo.orgId, A, opts.areaId, indice, VERSAO_METODO_PASTAGEM_ESSENCIAL, sha,
        opts.janelaInicio, opts.janelaFim, opts.situacao,
        concluida ? null : (opts.motivo ?? "cobertura_insuficiente"),
        concluida ? (opts.observacaoInicio ?? null) : null,
        concluida ? (opts.observacaoFim ?? null) : null,
        cob, h.demo.adminUserId, opts.createdAt ?? null
      ]);
    ids[indice] = r.rows[0]!.id;
    await admin.query(
      `insert into erp.analises_satelitais_ext (analise_id, organization_id, empresa_id, area_id, qualidade, versao_distribuicao)
       values ($1,$2,$3,$4,$5::jsonb,$6) on conflict do nothing`,
      [
        ids[indice], h.demo.orgId, A, opts.areaId,
        JSON.stringify({
          versao: "1", estado: concluida ? "boa" : "sem_imagem_util",
          cobertura_valida: concluida ? cob.toFixed(4) : null,
          valid_ratio: concluida ? "0.8500" : null,
          cloud_ratio: "0.1000", scl_composition: { "4": 0.5 },
          denominadores: {
            pixels_geometricos: 100, pixels_com_dado_fonte: 90,
            pixels_validos_indice: 85, pixels_mascarados_qualidade: 9
          },
          mascara: {
            scl_excluidas: [0, 1, 3, 6, 8, 9, 10, 11],
            cld: false, dataMask: true, por_output: true
          },
          motivo: concluida ? null : (opts.motivo ?? "cobertura_insuficiente")
        }),
        VERSAO_METODO_PASTAGEM_ESSENCIAL
      ]);
  }
  return ids;
}

const resumo = (areaId: string) =>
  h.app.inject({ method: "GET", url: `/api/satelite/areas/${areaId}/resumo`, headers: h.headers() });

describe("SAT-08 R3 — resumo última útil × última tentativa", () => {
  it("R1: consulta nova sem_observacao_util NÃO apaga a útil antiga", async () => {
    const areaId = await novaArea("sat08-r1");
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-01T00:00:00Z", janelaFim: "2026-10-01T00:00:00Z",
      situacao: "concluida",
      observacaoInicio: "2026-09-20T00:00:00Z", observacaoFim: "2026-09-21T00:00:00Z",
      createdAt: "2026-09-21T12:00:00Z", cobertura: 0.85
    });
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-15T00:00:00Z", janelaFim: "2026-10-15T00:00:00Z",
      situacao: "sem_observacao_util", motivo: "cobertura_insuficiente",
      createdAt: "2026-10-05T12:00:00Z"
    });
    const r = await resumo(areaId);
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as {
      ultima_observacao_util: {
        observacao_inicio: string;
        indices: Record<string, { situacao: string; valor_medio: string }>;
      } | null;
      ultima_tentativa: { situacao: string; motivo_qualidade: string | null; criado_em: string } | null;
    };
    expect(body.ultima_observacao_util).not.toBeNull();
    expect(body.ultima_observacao_util!.observacao_inicio).toBe("2026-09-20T00:00:00.000Z");
    expect(body.ultima_observacao_util!.indices.ndvi.situacao).toBe("concluida");
    expect(body.ultima_observacao_util!.indices.ndvi.valor_medio).toBe("0.5500");
    expect(body.ultima_tentativa).not.toBeNull();
    expect(body.ultima_tentativa!.situacao).toBe("sem_observacao_util");
    expect(body.ultima_tentativa!.motivo_qualidade).toBe("cobertura_insuficiente");
    expect(body.ultima_tentativa!.criado_em).toContain("2026-10-05");
  });

  it("R2: entre duas concluídas, a mais recente observação vence", async () => {
    const areaId = await novaArea("sat08-r2");
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-01T00:00:00Z", janelaFim: "2026-10-01T00:00:00Z",
      situacao: "concluida",
      observacaoInicio: "2026-09-28T00:00:00Z", observacaoFim: "2026-09-29T00:00:00Z",
      createdAt: "2026-09-29T12:00:00Z"
    });
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-10T00:00:00Z", janelaFim: "2026-10-10T00:00:00Z",
      situacao: "concluida",
      observacaoInicio: "2026-10-03T00:00:00Z", observacaoFim: "2026-10-04T00:00:00Z",
      createdAt: "2026-10-04T12:00:00Z"
    });
    const body = (await resumo(areaId)).json() as {
      ultima_observacao_util: { observacao_inicio: string };
    };
    expect(body.ultima_observacao_util.observacao_inicio).toBe("2026-10-03T00:00:00.000Z");
  });

  it("R3: após sem_observacao_util, valores dos índices continuam os da útil", async () => {
    const areaId = await novaArea("sat08-r3");
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-01T00:00:00Z", janelaFim: "2026-10-10T00:00:00Z",
      situacao: "concluida",
      observacaoInicio: "2026-10-03T00:00:00Z", observacaoFim: "2026-10-04T00:00:00Z",
      createdAt: "2026-10-04T08:00:00Z", cobertura: 0.77
    });
    await gravarBundle({
      areaId,
      janelaInicio: "2026-09-20T00:00:00Z", janelaFim: "2026-10-20T00:00:00Z",
      situacao: "sem_observacao_util", motivo: "cobertura_insuficiente",
      createdAt: "2026-10-05T18:00:00Z"
    });
    const body = (await resumo(areaId)).json() as {
      ultima_observacao_util: {
        observacao_inicio: string;
        indices: Record<string, { valor_medio: string | null; cobertura_valida: string | null }>;
        qualidade: { cobertura_valida: string | null };
      };
      ultima_tentativa: { situacao: string };
    };
    expect(body.ultima_observacao_util.observacao_inicio).toBe("2026-10-03T00:00:00.000Z");
    expect(body.ultima_observacao_util.indices.ndvi.valor_medio).toBe("0.5500");
    expect(body.ultima_observacao_util.indices.ndre.valor_medio).toBe("0.5500");
    expect(body.ultima_observacao_util.qualidade.cobertura_valida).toBe("0.7700");
    expect(body.ultima_tentativa.situacao).toBe("sem_observacao_util");
  });

  it("R4: índices de bundles distintos NÃO montam híbrido (fail-closed)", async () => {
    const areaId = await novaArea("sat08-r4");
    const sha = await shaArea(areaId);
    await gravarBundle({
      areaId, sha,
      janelaInicio: "2026-09-01T00:00:00Z", janelaFim: "2026-10-01T00:00:00Z",
      situacao: "concluida",
      observacaoInicio: "2026-09-20T00:00:00Z", observacaoFim: "2026-09-21T00:00:00Z",
      createdAt: "2026-09-21T12:00:00Z", incompleto: true
    });
    await admin.query(
      `insert into erp.analises_satelitais (
          organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
          janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
          valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado,
          pixels_validos, pixels_geometria, cobertura_valida, criado_por)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndre',$4,$5,
          '2026-09-05T00:00:00Z','2026-10-05T00:00:00Z',20,'concluida',
          '2026-09-20T00:00:00Z','2026-09-21T00:00:00Z',
          0.33,0.2,0.4,0.05,100,10,90,100,0.9000,$6)`,
      [h.demo.orgId, A, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL, sha, h.demo.adminUserId]);

    const body = (await resumo(areaId)).json() as {
      ultima_observacao_util: null | { indices: Record<string, unknown> };
      ultima_tentativa: null | { indices: Record<string, unknown> };
    };
    expect(body.ultima_observacao_util).toBeNull();
    expect(body.ultima_tentativa).toBeNull();
  });
});
