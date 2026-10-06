import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { VERSAO_METODO_PASTAGEM_ESSENCIAL } from "@agro/domain";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";
import { criarEmuladorProcessApi, type EmuladorProcessApi } from "../helpers/emulador-process-api.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";
import {
  MSG_GEOMETRIA_ALTERADA_CONDICAO, MSG_MAPA_NAO_ENCONTRADO, MSG_SEM_OBSERVACAO_CONDICAO
} from "../../src/routes/satelite-condicao-pasto.js";

/**
 * SAT-COND-01 — POST/GET do mapa categórico (emulador Process API, sem rede Copernicus).
 * Sem transação aberta durante o HTTP externo. Sem FK para análise de índice.
 */

const POLIGONO = { type: "Polygon" as const, coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] as [number, number][][] };
const POLIGONO2 = { type: "Polygon" as const, coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.088, -15.59], [-56.088, -15.6], [-56.1, -15.6]]] as [number, number][][] };
const TETOS = { SATELITE_LIMITE_MINUTO_CONTA: "100000", SATELITE_LIMITE_MINUTO_ORG: "100000", SATELITE_LIMITE_SIMULTANEAS: "1000" };
const CRED = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-cond", COPERNICUS_CLIENT_SECRET: "segredo-falso-cond-NAO-VAZAR" };

let h: Harness;
let admin: Db;
let emu: EmuladorProcessApi;
let app: FastifyInstance;
let areaId = "";
let empresaId = "";

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  empresaId = h.demo.empresaIds[0]!;
  emu = criarEmuladorProcessApi();
  app = await buildApp({
    config: configDeTeste({ ...CRED, ...TETOS }),
    db: h.db,
    logger: false,
    buscarExterno: (url, init) => emu.buscar(url, init)
  });
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,'COND','[TEST] condicao',12,12,'pastagem','ativa','propria',$3) returning id`,
    [h.demo.orgId, empresaId, JSON.stringify(POLIGONO)]);
  areaId = r.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await h?.app.close();
  await h?.db.end();
});

async function shaArea(id: string) {
  return (await admin.query<{ sha: string }>(
    `select encode(sha256(convert_to(geometria::text,'UTF8')),'hex') sha from erp.areas where id=$1`, [id])).rows[0]!.sha;
}

async function semearObservacao(id: string, sha: string, dia = "2026-10-05") {
  await admin.query(
    `insert into erp.analises_satelitais (
        organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, observacao_inicio, observacao_fim,
        valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado,
        pixels_validos, pixels_geometria, cobertura_valida, criado_por)
     values ($1,$2,$3,'copernicus_cdse','sentinel-2-l2a','ndvi',$4,$5,
        $6::timestamptz,$7::timestamptz,20,'concluida',$6::timestamptz,$7::timestamptz,
        0.55,0.2,0.8,0.05,100,10,90,100,0.9000,$8)`,
    [h.demo.orgId, empresaId, id, VERSAO_METODO_PASTAGEM_ESSENCIAL, sha,
      `${dia}T13:00:00Z`, `${dia}T13:10:00Z`, h.demo.adminUserId]);
}

describe("SAT-COND-01 — rota mapa de condição", () => {
  it("sem observação útil → 422; GET sem mapa → 404", async () => {
    const post = await app.inject({ method: "POST", url: `/api/satelite/areas/${areaId}/condicao-pasto`, headers: h.headers() });
    expect(post.statusCode).toBe(422);
    expect((post.json() as { error: { message: string } }).error.message).toBe(MSG_SEM_OBSERVACAO_CONDICAO);
    const get = await app.inject({ method: "GET", url: `/api/satelite/areas/${areaId}/condicao-pasto`, headers: h.headers() });
    expect(get.statusCode).toBe(404);
    expect((get.json() as { error: { message: string } }).error.message).toBe(MSG_MAPA_NAO_ENCONTRADO);
  });

  it("POST gera UINT8 categórico; segundo POST reutiliza; listagem e arquivo assinados", async () => {
    const sha = await shaArea(areaId);
    await semearObservacao(areaId, sha);
    const a = await app.inject({ method: "POST", url: `/api/satelite/areas/${areaId}/condicao-pasto`, headers: h.headers() });
    expect(a.statusCode, a.body).toBe(201);
    const corpo = a.json() as { mapa: { id: string; mapa: string; tipo: string; resolucao_m: number; versao_classificador: string; resumo: { classes: { codigo: number; pixels: number }[] }; url_assinada: string }; reutilizada: boolean };
    expect(corpo.reutilizada).toBe(false);
    expect(corpo.mapa.mapa).toBe("condicao_pasto");
    expect(corpo.mapa.tipo).toBe("classificacao");
    expect(corpo.mapa.resolucao_m).toBeGreaterThanOrEqual(20);
    expect(corpo.mapa.versao_classificador).toBe("condicao-pasto-v2");
    expect(corpo.mapa.resumo.classes).toHaveLength(7);
    expect(corpo.mapa.url_assinada).toMatch(/\/api\/mapa\/condicao-pasto\/.+\/arquivo\?t=/);
    expect(corpo.mapa).not.toHaveProperty("analise_id");
    const processos = emu.chamadasProcesso();
    expect(processos.length).toBeGreaterThanOrEqual(1);
    const evalscript = (processos[0]!.corpo as { evalscript: string }).evalscript;
    expect(evalscript).toContain('sampleType: "UINT8"');

    const b = await app.inject({ method: "POST", url: `/api/satelite/areas/${areaId}/condicao-pasto`, headers: h.headers() });
    expect(b.statusCode).toBe(200);
    expect((b.json() as { reutilizada: boolean }).reutilizada).toBe(true);
    expect(emu.chamadasProcesso().length).toBe(processos.length);

    const lista = await app.inject({ method: "GET", url: `/api/mapa/condicao-pasto?area_ids=${areaId}`, headers: h.headers() });
    expect(lista.statusCode).toBe(200);
    const itens = (lista.json() as { itens: { id: string }[] }).itens;
    expect(itens).toHaveLength(1);
    expect(itens[0]!.id).toBe(corpo.mapa.id);

    const arq = await app.inject({ method: "GET", url: corpo.mapa.url_assinada });
    expect(arq.statusCode).toBe(200);
    expect(arq.headers["content-type"]).toMatch(/image\/png/);
  });

  it("geometria alterada depois da observação → 422", async () => {
    const outra = (await admin.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'COND2','[TEST] condicao 2',12,12,'pastagem','ativa','propria',$3) returning id`,
      [h.demo.orgId, empresaId, JSON.stringify(POLIGONO)])).rows[0]!.id;
    const sha = await shaArea(outra);
    await semearObservacao(outra, sha, "2026-10-01");
    await admin.query(`update erp.areas set geometria=$1::jsonb where id=$2`, [JSON.stringify(POLIGONO2), outra]);
    const r = await app.inject({ method: "POST", url: `/api/satelite/areas/${outra}/condicao-pasto`, headers: h.headers() });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { message: string } }).error.message).toBe(MSG_GEOMETRIA_ALTERADA_CONDICAO);
  });
});
