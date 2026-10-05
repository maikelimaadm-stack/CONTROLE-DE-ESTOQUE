import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { INDICES_BUNDLE_ESSENCIAL, VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";
import { TEST_URL, harness, type Harness } from "./setup.js";

/**
 * SATÉLITE COMPLETO — Checkpoint A / HG-1..HG-5
 * GET /api/satelite/areas/:areaId/historico opera SÓ com geometria_sha256 vigente.
 * Banco preserva contornos antigos; paginação nunca atravessa B→A.
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

async function novaArea(code: string, poligono = POLIGONO_A): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,50,50,'pastagem','ativa','propria',$5) returning id`,
    [h.demo.orgId, A, code, `[TEST] ${code}`, JSON.stringify(poligono)]);
  return r.rows[0]!.id;
}

async function shaArea(areaId: string): Promise<string | null> {
  const r = await admin.query<{ sha: string | null }>(
    `select case when geometria is null then null
            else encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') end as sha
       from erp.areas where id=$1`, [areaId]);
  return r.rows[0]!.sha;
}

async function gravarLinha(opts: {
  areaId: string; sha: string; indice?: string; createdAt: string;
  observacaoInicio?: string; observacaoFim?: string;
}): Promise<string> {
  const indice = opts.indice ?? "ndvi";
  const r = await admin.query<{ id: string }>(
    `insert into erp.analises_satelitais (
        organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, resolucao_nativa_m, situacao,
        observacao_inicio, observacao_fim, valor_medio, valor_minimo, valor_maximo, desvio_padrao,
        pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a',$4,$5,$6,
        '2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',20,10,'concluida',
        $7::timestamptz,$8::timestamptz,0.55,0.40,0.70,0.05,100,15,85,100,0.8500,$9,$10::timestamptz)
     returning id`,
    [
      h.demo.orgId, A, opts.areaId, indice, VERSAO_METODO_PASTAGEM_ESSENCIAL, opts.sha,
      opts.observacaoInicio ?? "2026-09-20T00:00:00Z",
      opts.observacaoFim ?? "2026-09-21T00:00:00Z",
      h.demo.adminUserId, opts.createdAt
    ]);
  return r.rows[0]!.id;
}

const historico = (areaId: string, qs = "indice=ndvi&limite=10") =>
  h.app.inject({ method: "GET", url: `/api/satelite/areas/${areaId}/historico?${qs}`, headers: h.headers() });

describe("SAT-FINAL HG — histórico operacional por geometria atual", () => {
  it("HG-1: A antiga + B atual → /historico retorna somente B", async () => {
    const areaId = await novaArea("hg1");
    const shaA = (await shaArea(areaId))!;
    const idA1 = await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-10T10:00:00Z" });
    const idA2 = await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-15T10:00:00Z", observacaoInicio: "2026-09-14T00:00:00Z", observacaoFim: "2026-09-15T00:00:00Z" });
    const idA3 = await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-20T10:00:00Z", observacaoInicio: "2026-09-19T00:00:00Z", observacaoFim: "2026-09-20T00:00:00Z" });

    await admin.query(`update erp.areas set geometria=$2, area_ha=42, usable_area_ha=42 where id=$1`,
      [areaId, JSON.stringify(POLIGONO_B)]);
    const shaB = (await shaArea(areaId))!;
    expect(shaB).not.toBe(shaA);
    const idB1 = await gravarLinha({ areaId, sha: shaB, createdAt: "2026-10-01T10:00:00Z", observacaoInicio: "2026-09-28T00:00:00Z", observacaoFim: "2026-09-29T00:00:00Z" });
    const idB2 = await gravarLinha({ areaId, sha: shaB, createdAt: "2026-10-05T10:00:00Z", observacaoInicio: "2026-10-03T00:00:00Z", observacaoFim: "2026-10-04T00:00:00Z" });

    const r = await historico(areaId);
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { geometria_sha256: string; itens: { id: string; geometria_sha256: string; do_poligono_atual: boolean }[] };
    expect(body.geometria_sha256).toBe(shaB);
    expect(body.itens.map((i) => i.id).sort()).toEqual([idB1, idB2].sort());
    expect(body.itens.every((i) => i.geometria_sha256 === shaB && i.do_poligono_atual)).toBe(true);
    expect(body.itens.some((i) => [idA1, idA2, idA3].includes(i.id))).toBe(false);
  });

  it("HG-2: só A antiga + área atual B sem análise → itens=[]", async () => {
    const areaId = await novaArea("hg2");
    const shaA = (await shaArea(areaId))!;
    await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-10T10:00:00Z" });
    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const shaB = (await shaArea(areaId))!;
    expect(shaB).not.toBe(shaA);

    const body = (await historico(areaId)).json() as { itens: unknown[]; geometria_sha256: string };
    expect(body.geometria_sha256).toBe(shaB);
    expect(body.itens).toEqual([]);
  });

  it("HG-3: paginação em B nunca chega em A", async () => {
    const areaId = await novaArea("hg3");
    const shaA = (await shaArea(areaId))!;
    for (let i = 0; i < 5; i++) {
      await gravarLinha({
        areaId, sha: shaA,
        createdAt: `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z`,
        observacaoInicio: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
        observacaoFim: `2026-09-${String(10 + i).padStart(2, "0")}T12:00:00Z`
      });
    }
    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const shaB = (await shaArea(areaId))!;
    const idsB: string[] = [];
    for (let i = 0; i < 3; i++) {
      idsB.push(await gravarLinha({
        areaId, sha: shaB,
        createdAt: `2026-10-${String(1 + i).padStart(2, "0")}T10:00:00Z`,
        observacaoInicio: `2026-09-${String(28 + i).padStart(2, "0")}T00:00:00Z`,
        observacaoFim: `2026-09-${String(28 + i).padStart(2, "0")}T12:00:00Z`
      }));
    }

    const pagina1 = (await historico(areaId, "indice=ndvi&limite=2")).json() as {
      itens: { id: string; criado_em: string; geometria_sha256: string }[];
    };
    expect(pagina1.itens).toHaveLength(2);
    expect(pagina1.itens.every((i) => i.geometria_sha256 === shaB)).toBe(true);

    const antes = pagina1.itens[1]!.criado_em;
    const pagina2 = (await historico(areaId, `indice=ndvi&limite=10&antes=${encodeURIComponent(antes)}`)).json() as {
      itens: { id: string; geometria_sha256: string }[];
    };
    expect(pagina2.itens.every((i) => i.geometria_sha256 === shaB)).toBe(true);
    expect(pagina2.itens.every((i) => idsB.includes(i.id))).toBe(true);
    const todos = [...pagina1.itens, ...pagina2.itens].map((i) => i.id);
    expect(new Set(todos).size).toBe(3);
    expect(todos.sort()).toEqual(idsB.sort());
  });

  it("HG-4: área sem geometria → itens=[]", async () => {
    const areaId = await novaArea("hg4");
    const shaA = (await shaArea(areaId))!;
    await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-10T10:00:00Z" });
    await admin.query(`update erp.areas set geometria = null where id = $1`, [areaId]);

    const body = (await historico(areaId)).json() as { itens: unknown[]; geometria_sha256: null };
    expect(body.geometria_sha256).toBeNull();
    expect(body.itens).toEqual([]);
  });

  it("HG-5: registros da geometria A continuam no banco após redesenho", async () => {
    const areaId = await novaArea("hg5");
    const shaA = (await shaArea(areaId))!;
    const idA = await gravarLinha({ areaId, sha: shaA, createdAt: "2026-09-10T10:00:00Z" });
    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    const shaB = (await shaArea(areaId))!;
    await gravarLinha({ areaId, sha: shaB, createdAt: "2026-10-01T10:00:00Z" });

    const noBanco = await admin.query<{ n: string }>(
      `select count(*)::text as n from erp.analises_satelitais
        where area_id=$1 and geometria_sha256=$2 and indice='ndvi'`,
      [areaId, shaA]);
    expect(Number(noBanco.rows[0]!.n)).toBeGreaterThanOrEqual(1);
    const ainda = await admin.query<{ id: string }>(
      `select id from erp.analises_satelitais where id=$1`, [idA]);
    expect(ainda.rows[0]?.id).toBe(idA);

    const api = (await historico(areaId)).json() as { itens: { id: string }[] };
    expect(api.itens.some((i) => i.id === idA)).toBe(false);
  });

  it("HG-bundle: filtro por geometria vale também para outros índices do bundle", async () => {
    const areaId = await novaArea("hg-bundle");
    const shaA = (await shaArea(areaId))!;
    for (const indice of INDICES_BUNDLE_ESSENCIAL) {
      await gravarLinha({ areaId, sha: shaA, indice, createdAt: "2026-09-10T10:00:00Z" });
    }
    await admin.query(`update erp.areas set geometria=$2 where id=$1`, [areaId, JSON.stringify(POLIGONO_B)]);
    for (const indice of ["ndvi", "evi2", "bsi"] as const) {
      const body = (await historico(areaId, `indice=${indice}&limite=5`)).json() as { itens: unknown[] };
      expect(body.itens, indice).toEqual([]);
    }
  });
});
