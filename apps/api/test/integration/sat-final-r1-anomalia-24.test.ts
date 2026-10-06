import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";
import { TEST_URL, harness, type Harness } from "./setup.js";

/**
 * SATÉLITE COMPLETO R1 — anomalia usa as 24 observações MAIS RECENTES.
 * Se o SQL voltar a `ORDER BY observacao_inicio ASC LIMIT 24`, este teste falha.
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

/** 30 dias: 24 estáveis + 6 em queda. Datas ancoradas em 2026-09-01 … 2026-09-30. */
async function gravarSerie30(areaId: string, sha: string, indice: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const dia = String(i + 1).padStart(2, "0");
    const obs = `2026-09-${dia}T00:00:00Z`;
    const fim = `2026-09-${dia}T12:00:00Z`;
    const criado = `2026-09-${dia}T18:00:00Z`;
    // Primeiras 24: estáveis em 0.70. Últimas 6: queda até 0.20.
    const valor = i < 24 ? 0.70 : 0.70 - (i - 23) * 0.10;
    await admin.query(
      `insert into erp.analises_satelitais (
          organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
          janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
          valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado,
          pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
       values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a',$4,$5,$6,
          $7::timestamptz,$8::timestamptz,10,'concluida',$9::timestamptz,$10::timestamptz,
          $11,$11-0.05,$11+0.05,0.02,100,5,95,100,0.9500,$12,$13::timestamptz)`,
      [
        h.demo.orgId, A, areaId, indice, VERSAO_METODO_PASTAGEM_ESSENCIAL, sha,
        new Date(Date.parse(obs) - 5 * 86_400_000).toISOString(),
        new Date(Date.parse(fim) + 5 * 86_400_000).toISOString(),
        obs, fim, valor, h.demo.adminUserId, criado
      ]);
  }
}

describe("SAT-FINAL R1 — anomalia 24 mais recentes", () => {
  it("TEND-5 / 30 pontos: última observação participa; ASC LIMIT 24 direto falharia", async () => {
    const areaId = await novaArea("anom-24");
    const sha = await shaArea(areaId);
    // Séries multi-índice: a queda recente precisa entrar na janela das 24.
    for (const indice of ["ndvi", "ndre", "ndmi", "msavi2", "bsi"] as const) {
      await gravarSerie30(areaId, sha, indice);
    }

    const r = await h.app.inject({
      method: "GET",
      url: `/api/satelite/areas/${areaId}/resumo`,
      headers: h.headers()
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as {
      tendencia: { ultima: { delta: number | null; pontos: number } };
      anomalia: { nivel: string };
    };
    // Com as 24 RECENTES: o último ponto é 0.20 e o penúltimo 0.30 → delta negativo.
    // Com ASC LIMIT 24 dos mais antigos: ambos ~0.70 → delta ~0.
    expect(body.tendencia.ultima.pontos).toBe(24);
    expect(body.tendencia.ultima.delta).not.toBeNull();
    expect(body.tendencia.ultima.delta!).toBeLessThan(-0.05);
    expect(["leve", "moderada", "forte"]).toContain(body.anomalia.nivel);
  });
});
