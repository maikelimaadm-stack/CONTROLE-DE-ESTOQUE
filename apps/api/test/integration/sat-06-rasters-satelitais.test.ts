import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { lerPngCinza8, escreverPngCinza8 } from "../../src/lib/satelite/png.js";
import { decodificarValor } from "../../src/lib/satelite/evalscript-raster.js";
import {
  ESCALA_NDVI_RASTER, LADO_MAXIMO_RASTER_PX, RESOLUCAO_ALVO_M, de3857ParaLngLat, deLngLatPara3857, planejarGradeRaster, type GradeRaster
} from "../../src/lib/satelite/raster.js";
import { dbArmazenamentoRaster, type ArmazenamentoRaster } from "../../src/lib/satelite/armazenamento-raster.js";
import { VALIDADE_URL_RASTER_S, criarAssinadorUrlRaster } from "../../src/lib/satelite/url-assinada.js";
import { TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA } from "../../src/lib/satelite/limites.js";
import { MSG_LIMITE_ANALISES } from "../../src/routes/analises-satelitais.js";
import {
  AREAS_POR_LISTAGEM_MAXIMO, MSG_ANALISE_NAO_ENCONTRADA, MSG_ARMAZENAMENTO_FALHOU, MSG_GEOMETRIA_ALTERADA, MSG_RASTER_NAO_ENCONTRADO, MSG_SEM_OBSERVACAO
} from "../../src/routes/rasters-satelitais.js";
import {
  CLASSE_AGUA, CLASSE_NUVEM, TOLERANCIA_MEDIA_NDVI, cenaSintetica, criarEmuladorProcessApi, ndviMedioEsperado, type EmuladorProcessApi
} from "../helpers/emulador-process-api.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-06 (decisão 297) — a imagem do NDVI POR PIXEL de uma análise que já existe: gerar (Process API pelo EMULADOR —
 * nenhuma rede, nenhuma conta Copernicus), guardar NO BANCO (`erp.satelite_raster_arquivos`) e servir por URL ASSINADA,
 * sobre o banco real com o papel sem bypass de RLS. Os números entre parênteses são os critérios do Maike:
 * (1) cache pela chave, (2) PNG 1 banda 8 bits do tamanho declarado, (3) recorte no polígono em L, (4) nuvem/água = 0,
 * (5) média decodificada ≈ a da análise, (6) cantos ↔ retângulo, (7) área grande com resolução reduzida, (8) sem
 * observação → 422, (9) polígono alterado → 422, (10) URL vence e não abre adulterada/de outra organização, (11) PU no
 * ledger como `process`, (12) limite → 429 sem chamar, (13) armazenamento falhando → sem linha e com consumo, (14) o
 * limite e o contrato da SAT-01 (o objeto compartilhado), (15) escopo e organização, (16) leitura não chama o provedor.
 */

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon" as const, coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] as [number, number][][] });
/** 0,01° em -15,6°: ≈ 1,07 km × 1,11 km — ~110 × 120 pixels de 10 m. */
const POLIGONO = quadrado(-56.1, -15.6, 0.01);
const POLIGONO_REDESENHADO = quadrado(-56.1, -15.6, 0.012);
/** Em L: o quadrado de 0,01° SEM o quadrante nordeste (a reentrância). */
const POLIGONO_L = {
  type: "Polygon" as const,
  coordinates: [[[-56.2, -15.6], [-56.2, -15.59], [-56.195, -15.59], [-56.195, -15.595], [-56.19, -15.595], [-56.19, -15.6], [-56.2, -15.6]]] as [number, number][][]
};
/** Faixa larga: 0,3° × 0,01° (≈ 32 km × 1,1 km) — a 10 m passaria de 2500 pixels de largura. */
const POLIGONO_GRANDE = {
  type: "Polygon" as const,
  coordinates: [[[-57, -16], [-57, -15.99], [-56.7, -15.99], [-56.7, -16], [-57, -16]]] as [number, number][][]
};

const TETOS_ALTOS = { SATELITE_LIMITE_MINUTO_CONTA: "100000", SATELITE_LIMITE_MINUTO_ORG: "100000", SATELITE_LIMITE_SIMULTANEAS: "1000" };
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-sat06", COPERNICUS_CLIENT_SECRET: "segredo-falso-sat06-NAO-PODE-VAZAR" };
const SEGREDO_AUTENTICACAO_DE_TESTE = "test-secret-please";

let h: Harness;
let admin: Db;
let emu: EmuladorProcessApi;
/** Gancho opcional ANTES de cada chamada à Process API (mudar o polígono no meio da chamada, por exemplo). */
let antesDoProcesso: (() => Promise<void>) | null = null;
/** Demora aplicada a TODA chamada à Process API enquanto definida (corrida entre instâncias). */
let atrasoDeCadaProcessoMs = 0;
const buscarExterno: BuscarFn = async (url, init) => {
  if (new URL(url).pathname === "/api/v1/process") {
    if (antesDoProcesso) { const g = antesDoProcesso; antesDoProcesso = null; await g(); }
    if (atrasoDeCadaProcessoMs > 0) await new Promise((resolver) => setTimeout(resolver, atrasoDeCadaProcessoMs));
  }
  return emu.buscar(url, init);
};
const instancias: FastifyInstance[] = [];
async function instancia(env: Record<string, string> = {}, extra: { armazenamentoRaster?: ArmazenamentoRaster; logStream?: NodeJS.WritableStream } = {}) {
  const app = await buildApp({ config: configDeTeste({ ...CREDENCIAL_FALSA, ...TETOS_ALTOS, ...env }), db: h.db, logger: extra.logStream ? true : false, buscarExterno, ...extra });
  instancias.push(app);
  return app;
}
/** O mesmo segredo de autenticação do harness: tokens forjados aqui são os que o servidor produziria. */
const assinador = criarAssinadorUrlRaster(configDeTeste());

let A = ""; let B = "";
let orgX = ""; let empresaX = ""; let headersX: Record<string, string> = {};
const area: Record<string, string> = {};
const analise: Record<string, string> = {};

interface Dto {
  id: string; analise_id: string; area_id: string; indice: string; tipo: string; data_imagem: string; largura: number; altura: number;
  cantos_lnglat: [number, number][]; escala_min: number; escala_max: number; resolucao_m: number; resolucao_reduzida: boolean;
  url_assinada: string; expira_em: string;
}
interface Corpo { raster: Dto; reutilizada: boolean; itens: Dto[]; pagina: number; tamanho: number; tem_mais: boolean; error: { code: string; message: string; details?: Record<string, unknown> }; id: string; token: string }
const j = (r: { json: () => unknown }) => r.json() as Corpo;

const urlRaster = (analiseId: string) => `/api/mapa/analises-satelitais/${analiseId}/raster`;
const gerar = (app: FastifyInstance, analiseId: string, headers = h.headers(), payload?: unknown) =>
  app.inject({ method: "POST", url: urlRaster(analiseId), headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const ler = (app: FastifyInstance, url: string, headers: Record<string, string> = h.headers()) => app.inject({ method: "GET", url, headers });
/** O arquivo SEM cabeçalho nenhum: é assim que o MapLibre busca a imagem. */
const baixar = (app: FastifyInstance, url: string) => app.inject({ method: "GET", url });

async function novaArea(org: string, empresa: string, code: string, geometria: unknown) {
  return (await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] ${code}`, JSON.stringify(geometria)])).rows[0]!.id;
}

const DIA_MS = 86_400_000;
/**
 * Análise gravada direto no banco (o mesmo formato da SAT-01): concluída com a observação no DIA pedido (dia UTC inteiro)
 * e o `valor_medio` dado — ou sem observação útil. O hash do polígono é o do banco (a expressão da 0052).
 */
async function novaAnalise(areaId: string, empresa: string, dia: string, valorMedio: string | null, org = h.demo.orgId) {
  const obs = Date.parse(`${dia}T00:00:00Z`);
  const concluida = valorMedio !== null;
  const r = await admin.query<{ id: string }>(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo,
        valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por)
     select $1, $2, $3, 'copernicus_cdse', 'sentinel-2-l2a', 'ndvi', 'sat01-ndvi-v1', encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'),
        $4::timestamptz, $5::timestamptz, 10, $6, $7, $8::timestamptz, $9::timestamptz, $10::numeric, $10::numeric - 0.2, $10::numeric + 0.1,
        case when $6 = 'concluida' then 0.05 end, case when $6 = 'concluida' then 13000 end, case when $6 = 'concluida' then 2000 end,
        case when $6 = 'concluida' then 11000 end, 11860, case when $6 = 'concluida' then 0.9275 end, $11
       from erp.areas a where a.id = $3 returning id`,
    [org, empresa, areaId, new Date(obs - 20 * DIA_MS).toISOString(), new Date(obs + DIA_MS).toISOString(), concluida ? "concluida" : "sem_observacao_util",
      concluida ? null : "cobertura_insuficiente", concluida ? new Date(obs).toISOString() : null, concluida ? new Date(obs + DIA_MS).toISOString() : null,
      valorMedio, h.demo.adminUserId]);
  return r.rows[0]!.id;
}
/** O `valor_medio` que o provedor teria dado para a cena do dia: a VERDADE do emulador, em 4 casas (o numeric da coluna). */
const mediaDoEmulador = (dia: string, poligono: Parameters<typeof planejarGradeRaster>[0]) => ndviMedioEsperado(dia, planejarGradeRaster(poligono)).toFixed(4);

const rastersDaArea = async (areaId: string) => (await admin.query("select * from erp.satelite_rasters where area_id = $1 order by created_at", [areaId])).rows;
const arquivosDaArea = async (areaId: string) => (await admin.query<{ storage_path: string }>("select storage_path from erp.satelite_raster_arquivos where split_part(storage_path, '/', 2) = $1", [areaId])).rows;
const idsDoLedger = async () => new Set((await admin.query<{ id: string }>("select id from erp.satelite_consumo")).rows.map((l) => l.id));
async function novasNoLedger(antes: Set<string>) {
  return (await admin.query("select * from erp.satelite_consumo order by created_at, id")).rows.filter((l: { id: string }) => !antes.has(l.id)) as Record<string, unknown>[];
}

/** Espera até `n` INSERTs em `erp.satelite_rasters` estarem parados esperando lock (teto de 15 s). */
async function esperarInsercoesBloqueadas(n: number) {
  for (let i = 0; i < 300; i++) {
    const r = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%insert into erp.satelite_rasters%'");
    if (r.rows[0]!.n >= n) return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error(`premissa: ${n} gravação(ões) da linha esperando o lock não apareceram`);
}

/** Membro com as duas capacidades da análise e o escopo de empresa pedido (por módulo). */
async function membro(nome: string, email: string, escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]) {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: ["analises_satelitais.view", "analises_satelitais.create"] } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Sat06@12345", role_id: j(papel).id, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Sat06@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  const userId = (await admin.query<{ id: string }>("select id from erp.users where email = $1", [email])).rows[0]!.id;
  return { headers: { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId }, userId };
}

/** Cabeçalho do PNG lido byte a byte (independente do leitor da API). */
function cabecalhoPng(b: Buffer) {
  return {
    assinatura: b.subarray(0, 8).toString("hex"), primeiroBloco: b.toString("ascii", 12, 16), largura: b.readUInt32BE(16), altura: b.readUInt32BE(20),
    profundidade: b[24], cor: b[25], entrelacamento: b[28]
  };
}
/** O centro do pixel (coluna, linha) em EPSG:3857: linha 0 no NORTE, coluna 0 no OESTE. */
function centroDoPixel(g: GradeRaster, coluna: number, linha: number): [number, number] {
  const [minx, miny, maxx, maxy] = g.bbox3857;
  return [minx + (coluna + 0.5) * ((maxx - minx) / g.largura), maxy - (linha + 0.5) * ((maxy - miny) / g.altura)];
}
/** Par-ímpar do CENTRO do pixel contra o polígono em 3857 — escrito aqui, sem usar o emulador. */
function centroDentro(g: GradeRaster, coluna: number, linha: number): boolean {
  const [x, y] = centroDoPixel(g, coluna, linha);
  let dentro = false;
  for (const anel of g.poligono3857.coordinates) {
    for (let i = 0, k = anel.length - 1; i < anel.length; k = i++) {
      const [xi, yi] = anel[i]!, [xk, yk] = anel[k]!;
      if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  emu = criarEmuladorProcessApi({ pu: "0.0123" });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  for (const [nome, empresa, geo] of [
    ["base", A, POLIGONO], ["L", A, POLIGONO_L], ["grande", A, POLIGONO_GRANDE], ["semObs", A, POLIGONO], ["mudou", A, POLIGONO],
    ["mudouNoMeio", A, POLIGONO], ["semPu", A, POLIGONO], ["falhaArm", A, POLIGONO], ["malformada", A, POLIGONO], ["dimensoes", A, POLIGONO],
    ["provedor500", A, POLIGONO], ["provedor429", A, POLIGONO], ["corrida", A, POLIGONO], ["dois", A, POLIGONO], ["desligada", A, POLIGONO],
    ["piso", A, POLIGONO], ["pisoSat01", A, POLIGONO], ["escopoA", A, POLIGONO], ["escopoB", B, POLIGONO], ["acesso", B, POLIGONO], ["logs", A, POLIGONO],
    ["gemeaA1", A, POLIGONO], ["gemeaA2", A, POLIGONO], ["gemeaB", B, POLIGONO], ["corridaReplicas", A, POLIGONO], ["janelaFaseC", A, POLIGONO],
    ["excluidaNoMeio", A, POLIGONO]
  ] as const) area[nome] = await novaArea(h.demo.orgId, empresa, `SAT06-${nome}`, geo);
  const DIA = "2026-08-14";
  analise["base"] = await novaAnalise(area["base"]!, A, DIA, mediaDoEmulador(DIA, POLIGONO));
  analise["L"] = await novaAnalise(area["L"]!, A, DIA, mediaDoEmulador(DIA, POLIGONO_L));
  analise["grande"] = await novaAnalise(area["grande"]!, A, DIA, "0.5000");
  analise["semObs"] = await novaAnalise(area["semObs"]!, A, DIA, null);
  for (const nome of ["mudou", "mudouNoMeio", "semPu", "falhaArm", "malformada", "dimensoes", "provedor500", "provedor429", "corrida", "desligada", "piso", "escopoA", "escopoB", "acesso", "logs",
    "gemeaA1", "gemeaA2", "gemeaB", "corridaReplicas", "janelaFaseC", "excluidaNoMeio"]) {
    analise[nome] = await novaAnalise(area[nome]!, nome === "escopoB" || nome === "acesso" || nome === "gemeaB" ? B : A, DIA, "0.5000");
  }
  // Duas análises da MESMA área em dias diferentes (a cena do emulador muda com o dia): a imagem é a DA ANÁLISE.
  analise["doisAntiga"] = await novaAnalise(area["dois"]!, A, "2026-07-20", mediaDoEmulador("2026-07-20", POLIGONO));
  analise["doisNova"] = await novaAnalise(area["dois"]!, A, "2026-08-10", mediaDoEmulador("2026-08-10", POLIGONO));
  // Organização X: o administrador do harness é DONO dela também (o mesmo token, outro X-Org-Id).
  orgX = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Org X SAT-06','org-x-sat06') returning id")).rows[0]!.id;
  empresaX = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 94, '[TEST] Empresa X SAT-06') returning id", [orgX])).rows[0]!.id;
  await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [orgX, h.demo.adminUserId]);
  headersX = { authorization: `Bearer ${h.token}`, "x-org-id": orgX };
  area["x"] = await novaArea(orgX, empresaX, "SAT06-x", POLIGONO);
  analise["x"] = await novaAnalise(area["x"]!, empresaX, DIA, "0.5000", orgX);
  area["xLimite"] = await novaArea(orgX, empresaX, "SAT06-xLimite", POLIGONO);
  analise["xLimite"] = await novaAnalise(area["xLimite"]!, empresaX, DIA, "0.5000", orgX);
}, 180_000);

afterAll(async () => {
  for (const app of instancias) await app.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("SAT-06 (1)(2)(6)(11) — gerar, guardar, reaproveitar e servir", () => {
  let app: FastifyInstance;
  let primeira: Corpo;
  beforeAll(async () => { app = await instancia(); });

  it("(1) 201 na primeira vez: UMA chamada à Process API com o polígono e a JANELA DA OBSERVAÇÃO; linha + arquivo no banco", async () => {
    emu.limpar(); emu.pu = "0.0123";
    const antes = await idsDoLedger();
    const r = await gerar(app, analise["base"]!);
    expect(r.statusCode, r.body).toBe(201);
    primeira = j(r);
    expect(primeira.reutilizada).toBe(false);
    const chamadas = emu.chamadasProcesso();
    expect(chamadas).toHaveLength(1);
    const corpo = chamadas[0]!.corpo as { input: { bounds: { bbox: number[]; geometry?: unknown }; data: { dataFilter: { timeRange: { from: string; to: string } } }[] }; output: { width: number; height: number } };
    expect(corpo.input.data[0]!.dataFilter.timeRange).toEqual({ from: "2026-08-14T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" });
    expect(corpo.input.bounds.geometry, "a geometria do BANCO vai junto (o provedor recorta)").toBeDefined();
    const grade = planejarGradeRaster(POLIGONO);
    expect({ largura: corpo.output.width, altura: corpo.output.height }).toEqual({ largura: grade.largura, altura: grade.altura });
    expect(primeira.raster).toEqual({
      id: expect.any(String), analise_id: analise["base"], area_id: area["base"], indice: "ndvi", tipo: "valores", data_imagem: "2026-08-14",
      largura: grade.largura, altura: grade.altura, cantos_lnglat: expect.any(Array), escala_min: ESCALA_NDVI_RASTER.min, escala_max: ESCALA_NDVI_RASTER.max,
      resolucao_m: RESOLUCAO_ALVO_M, resolucao_reduzida: false,
      geometria_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      encoding_version: "ndvi-valores-v1", nodata: 0, bits: 8,
      native_resolution_m: 10, processing_resolution_m: 10,
      url_assinada: expect.stringMatching(new RegExp(`^/api/mapa/rasters/${primeira.raster.id}/arquivo\\?t=[A-Za-z0-9_-]+$`)),
      expira_em: expect.any(String)
    });
    const restante = (Date.parse(primeira.raster.expira_em) - Date.now()) / 1000;
    expect(restante).toBeGreaterThan(VALIDADE_URL_RASTER_S - 30);
    expect(restante).toBeLessThanOrEqual(VALIDADE_URL_RASTER_S);
    const [linha, ...resto] = await rastersDaArea(area["base"]!);
    expect(resto).toHaveLength(0);
    expect(linha).toMatchObject({ id: primeira.raster.id, organization_id: h.demo.orgId, empresa_id: A, criado_por: h.demo.adminUserId, analise_id: analise["base"], tipo: "valores", versao_evalscript: "ndvi-valores-v1" });
    expect(linha!.storage_path).toBe(`${h.demo.orgId}/${area["base"]}/ndvi/2026-08-14/${linha!.chave_cache}.png`);
    const arquivo = (await admin.query("select * from erp.satelite_raster_arquivos where organization_id = $1 and storage_path = $2", [h.demo.orgId, linha!.storage_path])).rows[0];
    expect(arquivo).toMatchObject({ empresa_id: A, sha256_arquivo: linha!.sha256_arquivo, tamanho_bytes: emu.ultimoPng!.length });
    expect(Buffer.compare(arquivo.conteudo as Buffer, emu.ultimoPng!), "o arquivo guardado é o PNG que o provedor devolveu").toBe(0);
    // (11) o consumo da chamada, NA MESMA TRANSAÇÃO da linha: operação process, PU do cabeçalho, créditos pelo banco.
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ organization_id: h.demo.orgId, empresa_id: A, operacao: "process", pu_gasto: "0.0123", creditos: "1.23", origem_cabecalho: "0.0123", consulta_id: null })]);
    expect(linha!.pu_gasto).toBe("0.0123");
    const auditoria = await admin.query("select action from erp.audit_logs where entity = 'satelite_rasters' and entity_id = $1", [primeira.raster.id]);
    expect(auditoria.rows).toEqual([{ action: "create" }]);
  });

  it("(1) a segunda vez: 200 `reutilizada`, a MESMA imagem, SEM chamar o provedor, sem linha nem consumo novos — também noutra instância", async () => {
    emu.limpar();
    const antes = await idsDoLedger();
    const r = await gerar(app, analise["base"]!);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).reutilizada).toBe(true);
    expect({ ...j(r).raster, url_assinada: "", expira_em: "" }).toEqual({ ...primeira.raster, url_assinada: "", expira_em: "" });
    const outra = await gerar(await instancia(), analise["base"]!);
    expect(outra.statusCode, outra.body).toBe(200);
    expect(j(outra).raster.id).toBe(primeira.raster.id);
    expect(emu.chamadas, "nem token, nem Process API").toHaveLength(0);
    expect(await rastersDaArea(area["base"]!)).toHaveLength(1);
    expect(await novasNoLedger(antes)).toHaveLength(0);
  });

  it("(2) o arquivo pela URL assinada, SEM autenticação: PNG cinza de 8 bits, 1 banda, do tamanho declarado; cabeçalhos de cache privado", async () => {
    const r = await baixar(app, primeira.raster.url_assinada);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const cache = /^private, max-age=(\d+)$/.exec(String(r.headers["cache-control"]));
    expect(cache).not.toBeNull();
    expect(Number(cache![1])).toBeGreaterThan(0);
    expect(Number(cache![1])).toBeLessThanOrEqual(VALIDADE_URL_RASTER_S);
    const png = r.rawPayload;
    expect(cabecalhoPng(png)).toEqual({
      assinatura: "89504e470d0a1a0a", primeiroBloco: "IHDR", largura: primeira.raster.largura, altura: primeira.raster.altura,
      profundidade: 8, cor: 0, entrelacamento: 0
    });
    const [linha] = await rastersDaArea(area["base"]!);
    expect(createHash("sha256").update(png).digest("hex")).toBe(linha!.sha256_arquivo);
    expect(lerPngCinza8(png).pixels).toHaveLength(primeira.raster.largura * primeira.raster.altura);
  });

  it("(6) cantos ↔ retângulo EPSG:3857: ida e volta, na ordem do MapLibre; o retângulo gravado é o pedido ao provedor", async () => {
    const [linha] = await rastersDaArea(area["base"]!);
    const bbox = [linha!.bbox_min_x, linha!.bbox_min_y, linha!.bbox_max_x, linha!.bbox_max_y].map(Number) as [number, number, number, number];
    const [minx, miny, maxx, maxy] = bbox;
    const cantos = primeira.raster.cantos_lnglat;
    expect(cantos).toHaveLength(4);
    expect(cantos).toEqual(linha!.cantos_lnglat);
    const esperado: [number, number][] = [[minx, maxy], [maxx, maxy], [maxx, miny], [minx, miny]];
    cantos.forEach(([lng, lat], i) => {
      const [x, y] = deLngLatPara3857(lng, lat);
      expect(Math.abs(x - esperado[i]![0])).toBeLessThan(1e-6);
      expect(Math.abs(y - esperado[i]![1])).toBeLessThan(1e-6);
      const [lng2, lat2] = de3857ParaLngLat(esperado[i]![0], esperado[i]![1]);
      expect(Math.abs(lng2 - lng)).toBeLessThan(1e-12);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-12);
    });
    // sup-esq a oeste e ao norte; inf-dir a leste e ao sul — e o polígono da área cabe dentro dos cantos.
    expect(cantos[0]![0]).toBeLessThan(cantos[1]![0]);
    expect(cantos[0]![1]).toBeGreaterThan(cantos[3]![1]);
    expect(cantos[0]![0]).toBeLessThan(-56.1);
    expect(cantos[2]![0]).toBeGreaterThan(-56.09);
    expect(cantos[0]![1]).toBeGreaterThan(-15.59);
    expect(cantos[2]![1]).toBeLessThan(-15.6);
    const grade = planejarGradeRaster(POLIGONO);
    expect(bbox.map((v, i) => Math.abs(v - grade.bbox3857[i]!) < 1e-6)).toEqual([true, true, true, true]);
  });

  it("(11) sem cabeçalho de PU: o consumo entra com o PAR NULO e a origem `cabecalho_ausente`; a linha da imagem também sem PU", async () => {
    emu.limpar(); emu.pu = null;
    const antes = await idsDoLedger();
    const r = await gerar(app, analise["semPu"]!);
    expect(r.statusCode, r.body).toBe(201);
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_ausente", empresa_id: A })]);
    expect((await rastersDaArea(area["semPu"]!))[0]!.pu_gasto).toBeNull();
    emu.pu = "0.0123";
  });

  it("concorrência: dois pedidos simultâneos da mesma imagem nesta instância compartilham UMA chamada; uma linha, um consumo", async () => {
    emu.limpar();
    const antes = await idsDoLedger();
    // O provedor demora 1 s para responder: o segundo pedido termina a FASE A com a primeira chamada ainda em voo (sem a
    // demora, o emulador responde antes de o segundo pedido chegar, e a prova seria de outra coisa).
    antesDoProcesso = () => new Promise((resolver) => setTimeout(resolver, 1000));
    const [r1, r2] = await Promise.all([gerar(app, analise["corrida"]!), gerar(app, analise["corrida"]!)]);
    expect([r1.statusCode, r2.statusCode].sort(), r1.body + r2.body).toEqual([200, 201]);
    expect(j(r1).raster.id).toBe(j(r2).raster.id);
    expect(emu.chamadasProcesso()).toHaveLength(1);
    expect(await rastersDaArea(area["corrida"]!)).toHaveLength(1);
    expect(await novasNoLedger(antes)).toHaveLength(1);
  });
});

describe("SAT-06 — a chamada em andamento vale até o COMMIT da FASE C (nenhuma segunda chamada paga na janela)", () => {
  it("pedido que termina a FASE A entre o arquivo gravado e o commit da linha espera a MESMA chamada: 1 chamada, 201 + 200 `reutilizada`, 1 consumo", async () => {
    const app = await instancia();
    emu.limpar();
    const antes = await idsDoLedger();
    // A trava SHARE na tabela das linhas deixa passar a leitura da FASE A (ACCESS SHARE) e PARA a gravação da FASE C
    // (ROW EXCLUSIVE): o primeiro pedido fica com o arquivo gravado e a linha por gravar — a janela, aberta de propósito.
    const trava = await admin.connect();
    let p1: ReturnType<typeof gerar> | undefined; let p2: ReturnType<typeof gerar> | undefined;
    try {
      await trava.query("begin");
      await trava.query("lock table erp.satelite_rasters in share mode");
      p1 = gerar(app, analise["janelaFaseC"]!);
      await esperarInsercoesBloqueadas(1);
      expect(emu.chamadasProcesso(), "premissa: o primeiro já chamou o provedor").toHaveLength(1);
      expect(await arquivosDaArea(area["janelaFaseC"]!), "premissa: o arquivo já está gravado, a linha não").toHaveLength(1);
      p2 = gerar(app, analise["janelaFaseC"]!);
      await esperarInsercoesBloqueadas(2);
    } finally {
      await trava.query("commit");
      trava.release();
    }
    const [r1, r2] = await Promise.all([p1!, p2!]);
    expect(emu.chamadasProcesso(), "o segundo pedido esperou a chamada aberta: nenhuma segunda chamada paga").toHaveLength(1);
    // Liberada a trava, as duas gravações correm juntas: qualquer uma pode ganhar a chave; a outra relê a linha.
    expect([r1.statusCode, r2.statusCode].sort(), r1.body + " | " + r2.body).toEqual([200, 201]);
    expect([j(r1).reutilizada, j(r2).reutilizada].sort()).toEqual([false, true]);
    expect(j(r2).raster.id).toBe(j(r1).raster.id);
    expect(await rastersDaArea(area["janelaFaseC"]!)).toHaveLength(1);
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: "0.0123" })]);
  });
});

describe("SAT-06 — corrida entre RÉPLICAS (duas instâncias, a mesma imagem, ao mesmo tempo)", () => {
  it("duas gerações simultâneas: UMA linha de imagem, nenhum 500, o consumo de CADA chamada feita; a linha leva o hash do arquivo GUARDADO", async () => {
    const [r1, r2] = [await instancia(), await instancia()];
    emu.limpar();
    const grade = planejarGradeRaster(POLIGONO);
    // As duas respostas do provedor têm BYTES diferentes (a primeira a chegar recebe um PNG válido do tamanho certo, mas
    // outro conteúdo): quem guardar primeiro decide o arquivo, e a linha da imagem tem de levar o hash DESSE arquivo.
    emu.roteiro = [{ status: 200, corpo: escreverPngCinza8(grade.largura, grade.altura, new Array(grade.largura * grade.altura).fill(7)) }];
    const antes = await idsDoLedger();
    atrasoDeCadaProcessoMs = 500;
    let respostas: Awaited<ReturnType<typeof gerar>>[];
    try {
      respostas = await Promise.all([gerar(r1, analise["corridaReplicas"]!), gerar(r2, analise["corridaReplicas"]!)]);
    } finally { atrasoDeCadaProcessoMs = 0; }
    expect(respostas.map((r) => r.statusCode).sort(), respostas.map((r) => r.body).join(" | ")).toEqual([200, 201]);
    expect(j(respostas[0]!).raster.id).toBe(j(respostas[1]!).raster.id);
    expect(emu.chamadasProcesso(), "premissa: as duas réplicas chamaram o provedor (corrida real)").toHaveLength(2);
    const linhas = await rastersDaArea(area["corridaReplicas"]!);
    expect(linhas).toHaveLength(1);
    const arquivos = (await admin.query<{ storage_path: string; sha256_arquivo: string; conteudo: Buffer }>(
      "select storage_path, sha256_arquivo, conteudo from erp.satelite_raster_arquivos where split_part(storage_path, '/', 2) = $1", [area["corridaReplicas"]])).rows;
    expect(arquivos).toHaveLength(1);
    expect(linhas[0]!.storage_path).toBe(arquivos[0]!.storage_path);
    expect(linhas[0]!.sha256_arquivo).toBe(arquivos[0]!.sha256_arquivo);
    expect(createHash("sha256").update(arquivos[0]!.conteudo).digest("hex")).toBe(arquivos[0]!.sha256_arquivo);
    // O arquivo servido é o guardado.
    const servido = await baixar(r1, j(respostas[0]!).raster.url_assinada);
    expect(servido.statusCode).toBe(200);
    expect(Buffer.compare(servido.rawPayload, arquivos[0]!.conteudo)).toBe(0);
    expect(await novasNoLedger(antes), "as duas chamadas foram cobradas: dois consumos").toEqual([
      expect.objectContaining({ operacao: "process", empresa_id: A }), expect.objectContaining({ operacao: "process", empresa_id: A })
    ]);
  });
});

describe("SAT-06 (3)(4)(5)(7) — o conteúdo da imagem", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await instancia(); });
  const pngDe = async (analiseId: string) => {
    const r = await gerar(app, analiseId);
    expect([200, 201], r.body).toContain(r.statusCode);
    const arquivo = await baixar(app, j(r).raster.url_assinada);
    expect(arquivo.statusCode, arquivo.body).toBe(200);
    return { dto: j(r).raster, img: lerPngCinza8(arquivo.rawPayload) };
  };

  it("(3) polígono em L: TODO pixel com centro fora do polígono (inclusive a reentrância) vale 0; dentro há valor", async () => {
    const { dto, img } = await pngDe(analise["L"]!);
    const grade = planejarGradeRaster(POLIGONO_L);
    expect({ largura: img.largura, altura: img.altura }).toEqual({ largura: dto.largura, altura: dto.altura });
    let foraNaoZero = 0, fora = 0, reentrancia = 0, dentroComValor = 0;
    const [rx0, ry0] = deLngLatPara3857(-56.195, -15.595); // o canto interno do L: a reentrância é o quadrante NE
    for (let linha = 0; linha < img.altura; linha++) {
      for (let coluna = 0; coluna < img.largura; coluna++) {
        const v = img.pixels[linha * img.largura + coluna]!;
        if (!centroDentro(grade, coluna, linha)) {
          fora++; if (v !== 0) foraNaoZero++;
          const [x, y] = centroDoPixel(grade, coluna, linha);
          if (x > rx0 && y > ry0) reentrancia++;
        } else if (v !== 0) dentroComValor++;
      }
    }
    expect(reentrancia, "premissa: a reentrância tem centenas de pixels fora do polígono").toBeGreaterThan(1000);
    expect(fora).toBeGreaterThan(reentrancia);
    expect(foraNaoZero).toBe(0);
    expect(dentroComValor, "premissa: dentro do L há pixels com valor").toBeGreaterThan(3000);
  });

  it("(4) nuvem (SCL 9) e água (SCL 6) valem 0, dentro do polígono também; a classe mantida (solo) tem valor", async () => {
    const { img } = await pngDe(analise["base"]!);
    const cena = cenaSintetica("2026-08-14", planejarGradeRaster(POLIGONO));
    let nuvemOuAgua = 0, naoZero = 0, nuvemDentro = 0, aguaDentro = 0;
    for (let i = 0; i < img.pixels.length; i++) {
      const scl = cena.scl[i]!;
      if (scl === CLASSE_NUVEM || scl === CLASSE_AGUA) {
        nuvemOuAgua++;
        if (img.pixels[i] !== 0) naoZero++;
        if (cena.dentro[i] === 1) { if (scl === CLASSE_NUVEM) nuvemDentro++; else aguaDentro++; }
      }
    }
    expect(nuvemDentro, "premissa: a faixa de nuvem cruza o polígono").toBeGreaterThan(500);
    expect(aguaDentro, "premissa: a faixa de água cruza o polígono").toBeGreaterThan(500);
    expect(nuvemOuAgua).toBeGreaterThan(nuvemDentro + aguaDentro);
    expect(naoZero).toBe(0);
    const solo = Array.from(img.pixels).filter((v, i) => cena.scl[i] === 5 && cena.dentro[i] === 1);
    expect(solo.length).toBeGreaterThan(100);
    expect(solo.every((v) => v !== 0)).toBe(true);
  });

  it("(5) a média DECODIFICADA dos pixels com valor ≈ o `valor_medio` da análise (a mesma cena, a mesma máscara)", async () => {
    const { img } = await pngDe(analise["base"]!);
    let soma = 0, n = 0;
    for (const byte of img.pixels) { const v = decodificarValor(byte, ESCALA_NDVI_RASTER.min, ESCALA_NDVI_RASTER.max); if (v !== null) { soma += v; n++; } }
    const valorMedio = Number((await admin.query<{ valor_medio: string }>("select valor_medio from erp.analises_satelitais where id = $1", [analise["base"]])).rows[0]!.valor_medio);
    expect(n).toBeGreaterThan(3000);
    expect(Math.abs(soma / n - valorMedio)).toBeLessThanOrEqual(TOLERANCIA_MEDIA_NDVI);
  });

  it("(5) duas análises da mesma área em dias diferentes: cada imagem é a DO DIA DA SUA ANÁLISE, nunca a mais recente", async () => {
    const media = (img: { pixels: Uint8Array }) => {
      let soma = 0, n = 0;
      for (const byte of img.pixels) { const v = decodificarValor(byte, ESCALA_NDVI_RASTER.min, ESCALA_NDVI_RASTER.max); if (v !== null) { soma += v; n++; } }
      return soma / n;
    };
    const antiga = await pngDe(analise["doisAntiga"]!);
    const nova = await pngDe(analise["doisNova"]!);
    expect(antiga.dto.data_imagem).toBe("2026-07-20");
    expect(nova.dto.data_imagem).toBe("2026-08-10");
    expect(antiga.dto.id).not.toBe(nova.dto.id);
    const [mAntiga, mNova] = [Number(mediaDoEmulador("2026-07-20", POLIGONO)), Number(mediaDoEmulador("2026-08-10", POLIGONO))];
    expect(Math.abs(mAntiga - mNova), "premissa: as cenas dos dois dias diferem bem acima da tolerância").toBeGreaterThan(4 * TOLERANCIA_MEDIA_NDVI);
    expect(Math.abs(media(antiga.img) - mAntiga)).toBeLessThanOrEqual(TOLERANCIA_MEDIA_NDVI);
    expect(Math.abs(media(nova.img) - mNova)).toBeLessThanOrEqual(TOLERANCIA_MEDIA_NDVI);
    // A leitura por análise acha a imagem DA análise (pela chave dela), e não a mais recente da área.
    const lida = await ler(app, urlRaster(analise["doisAntiga"]!));
    expect(lida.statusCode, lida.body).toBe(200);
    expect((lida.json() as Dto).id).toBe(antiga.dto.id);
  });

  it("(7) área grande: resolução REDUZIDA (inteira, > 10 m) para caber em 2500 pixels — gravada e devolvida", async () => {
    const { dto, img } = await pngDe(analise["grande"]!);
    expect(dto.resolucao_reduzida).toBe(true);
    expect(dto.resolucao_m).toBeGreaterThan(RESOLUCAO_ALVO_M);
    expect(Number.isInteger(dto.resolucao_m)).toBe(true);
    expect(Math.max(dto.largura, dto.altura)).toBeLessThanOrEqual(LADO_MAXIMO_RASTER_PX);
    expect(Math.max(dto.largura, dto.altura), "premissa: o lado maior chega perto do teto").toBeGreaterThan(2000);
    expect({ largura: img.largura, altura: img.altura }).toEqual({ largura: dto.largura, altura: dto.altura });
    const [linha] = await rastersDaArea(area["grande"]!);
    expect(linha).toMatchObject({ resolucao_m: dto.resolucao_m, largura: dto.largura, altura: dto.altura });
  });
});

describe("SAT-06 (8)(9)(13) — recusas e falhas: nada gerado que não devesse", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await instancia(); });

  it("(8) análise sem observação útil → 422 (não há o que pintar), sem chamada, sem linha, sem consumo", async () => {
    emu.limpar();
    const antes = await idsDoLedger();
    const r = await gerar(app, analise["semObs"]!);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual({ code: "VALIDATION_ERROR", message: MSG_SEM_OBSERVACAO, details: { motivo: "sem_observacao" } });
    expect(emu.chamadas).toHaveLength(0);
    expect(await rastersDaArea(area["semObs"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toHaveLength(0);
    const g = await ler(app, urlRaster(analise["semObs"]!));
    expect(g.statusCode).toBe(404);
    expect(j(g).error.message).toBe(MSG_RASTER_NAO_ENCONTRADO);
  });

  it("(9) polígono da área alterado depois da análise → 422 com motivo, sem chamada, sem linha, sem arquivo", async () => {
    await admin.query("update erp.areas set geometria = $2 where id = $1", [area["mudou"], JSON.stringify(POLIGONO_REDESENHADO)]);
    emu.limpar();
    const antes = await idsDoLedger();
    const r = await gerar(app, analise["mudou"]!);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual({ code: "VALIDATION_ERROR", message: MSG_GEOMETRIA_ALTERADA, details: { motivo: "geometria_alterada" } });
    expect(emu.chamadas).toHaveLength(0);
    expect(await rastersDaArea(area["mudou"]!)).toHaveLength(0);
    expect(await arquivosDaArea(area["mudou"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toHaveLength(0);
  });

  it("(9) polígono alterado DURANTE a chamada → 422, nenhuma linha de imagem, e o consumo da chamada (cobrada) gravado", async () => {
    emu.limpar();
    const antes = await idsDoLedger();
    antesDoProcesso = async () => { await admin.query("update erp.areas set geometria = $2 where id = $1", [area["mudouNoMeio"], JSON.stringify(POLIGONO_REDESENHADO)]); };
    const r = await gerar(app, analise["mudouNoMeio"]!);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.details).toEqual({ motivo: "geometria_alterada" });
    expect(emu.chamadasProcesso()).toHaveLength(1);
    expect(await rastersDaArea(area["mudouNoMeio"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: "0.0123", empresa_id: A })]);
  });

  it("área EXCLUÍDA durante a chamada → a 404 da análise, nenhuma linha de imagem, e o consumo da chamada (cobrada) gravado", async () => {
    emu.limpar();
    const antes = await idsDoLedger();
    antesDoProcesso = async () => { await admin.query("update erp.areas set deleted_at = now() where id = $1", [area["excluidaNoMeio"]]); };
    const r = await gerar(app, analise["excluidaNoMeio"]!);
    expect(r.statusCode, r.body).toBe(404);
    expect(r.json()).toEqual({ error: { code: "NOT_FOUND", message: MSG_ANALISE_NAO_ENCONTRADA } });
    expect(emu.chamadasProcesso()).toHaveLength(1);
    expect(await rastersDaArea(area["excluidaNoMeio"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: "0.0123", creditos: "1.23", empresa_id: A })]);
  });

  it("(13) armazenamento falhando: 503 estável, NENHUMA linha de imagem, consumo gravado; depois, com o armazenamento de volta, gera", async () => {
    const falha: ArmazenamentoRaster = { bucket: "db", gravar: async () => { throw new Error("falha simulada do armazenamento"); }, ler: dbArmazenamentoRaster.ler };
    const quebrada = await instancia({}, { armazenamentoRaster: falha });
    emu.limpar();
    const antes = await idsDoLedger();
    const r = await gerar(quebrada, analise["falhaArm"]!);
    expect(r.statusCode, r.body).toBe(503);
    expect(j(r).error).toEqual({ code: "CONSULTA_INDISPONIVEL", message: MSG_ARMAZENAMENTO_FALHOU, details: { motivo: "armazenamento" } });
    expect(emu.chamadasProcesso()).toHaveLength(1);
    expect(await rastersDaArea(area["falhaArm"]!)).toHaveLength(0);
    expect(await arquivosDaArea(area["falhaArm"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: "0.0123", creditos: "1.23", empresa_id: A })]);
    const depois = await gerar(app, analise["falhaArm"]!);
    expect(depois.statusCode, depois.body).toBe(201);
    expect(await rastersDaArea(area["falhaArm"]!)).toHaveLength(1);
  });

  it("2xx com corpo que não é PNG, ou PNG de outro tamanho → 503 `resposta_malformada` E o consumo (cobrada); nada gravado", async () => {
    for (const [nome, passo] of [
      ["malformada", { status: 200, corpo: "nao-png" as const }],
      ["dimensoes", { status: 200, corpo: escreverPngCinza8(3, 2, [1, 2, 3, 4, 5, 6]) }]
    ] as const) {
      emu.limpar();
      emu.roteiro = [passo];
      const antes = await idsDoLedger();
      const r = await gerar(app, analise[nome]!);
      expect(r.statusCode, r.body).toBe(503);
      expect(j(r).error.details).toEqual({ motivo: "resposta_malformada" });
      expect(await rastersDaArea(area[nome]!)).toHaveLength(0);
      expect(await arquivosDaArea(area[nome]!)).toHaveLength(0);
      expect(await novasNoLedger(antes)).toEqual([expect.objectContaining({ operacao: "process", pu_gasto: "0.0123" })]);
    }
  });

  it("falha do provedor: 5xx → o 503 da SAT-01 sem consumo; 429 → o 429 do provedor com Retry-After", async () => {
    emu.limpar();
    emu.roteiro = [{ status: 500 }, { status: 500 }];
    let antes = await idsDoLedger();
    const r500 = await gerar(app, analise["provedor500"]!);
    expect(r500.statusCode, r500.body).toBe(503);
    expect(j(r500).error.code).toBe("CONSULTA_INDISPONIVEL");
    expect(j(r500).error.details).toEqual({ motivo: "indisponivel" });
    expect(await novasNoLedger(antes)).toHaveLength(0);
    emu.limpar();
    emu.roteiro = [{ status: 429, retryAfter: "120" }];
    antes = await idsDoLedger();
    const r429 = await gerar(app, analise["provedor429"]!);
    expect(r429.statusCode, r429.body).toBe(429);
    expect(j(r429).error.details).toEqual({ motivo: "limite_provedor", tentar_apos_segundos: 120 });
    expect(r429.headers["retry-after"]).toBe("120");
    expect(await novasNoLedger(antes)).toHaveLength(0);
    expect(await rastersDaArea(area["provedor429"]!)).toHaveLength(0);
  });

  it("desligada: pedir imagem nova responde 503 controlado, mas a leitura (por análise e o arquivo) continua", async () => {
    const r0 = await gerar(app, analise["desligada"]!);
    expect(r0.statusCode, r0.body).toBe(201);
    const desligada = await instancia({ COPERNICUS_ENABLED: "0" });
    emu.limpar();
    const r = await gerar(desligada, analise["desligada"]!);
    expect(r.statusCode).toBe(503);
    expect(j(r).error.details).toEqual({ motivo: "desligada" });
    const lida = await ler(desligada, urlRaster(analise["desligada"]!));
    expect(lida.statusCode, lida.body).toBe(200);
    expect((await baixar(desligada, (lida.json() as Dto).url_assinada)).statusCode).toBe(200);
    expect(emu.chamadas).toHaveLength(0);
  });
});

describe("SAT-06 (12)(14) — o limite é o da SAT-01: o mesmo 429, o mesmo objeto por instância", () => {
  const CORPO_429 = { error: { code: "RATE_LIMITED", message: MSG_LIMITE_ANALISES, details: { motivo: "limite_erp" } } };

  it("(12) ledger da organização no teto → o MESMO 429 da SAT-01, SEM chamar o provedor", async () => {
    const app = await instancia({ SATELITE_LIMITE_MINUTO_ORG: "3" });
    await admin.query(
      `insert into erp.satelite_consumo (organization_id, empresa_id, operacao, pu_gasto, creditos, origem_cabecalho)
       select $1, $2, 'statistical', 0.01, 1, '0.01' from generate_series(1, 3)`, [orgX, empresaX]);
    emu.limpar();
    const r = await gerar(app, analise["xLimite"]!, headersX);
    expect(r.statusCode, r.body).toBe(429);
    expect(r.json()).toEqual(CORPO_429);
    expect(emu.chamadas).toHaveLength(0);
    expect(await rastersDaArea(area["xLimite"]!)).toHaveLength(0);
    // A rota da SAT-01 vê o mesmo teto (o ledger é um só): o mesmo corpo.
    const sat01 = await app.inject({ method: "POST", url: `/api/mapa/areas/${area["x"]}/analises-satelitais/ndvi`, headers: headersX });
    expect(sat01.statusCode, sat01.body).toBe(429);
    expect(sat01.json()).toEqual(CORPO_429);
    expect(emu.chamadas).toHaveLength(0);
  });

  it("(14) o PISO por instância é COMPARTILHADO: as tentativas de imagem esgotam o piso e a análise da SAT-01 recebe 429 sem chamar", async () => {
    const app = await instancia();
    emu.limpar();
    // Cada tentativa de imagem chama o provedor (400 → recusa sem repetir, sem cobrança) e conta UMA tentativa no piso.
    emu.roteiro = Array.from({ length: TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA }, () => ({ status: 400 }));
    for (let i = 0; i < TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA; i++) {
      const r = await gerar(app, analise["piso"]!);
      expect(r.statusCode, r.body).toBe(503);
    }
    expect(emu.chamadasProcesso()).toHaveLength(TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA);
    const antesDaSat01 = emu.chamadas.length;
    const sat01 = await app.inject({ method: "POST", url: `/api/mapa/areas/${area["pisoSat01"]}/analises-satelitais/ndvi`, headers: h.headers() });
    expect(sat01.statusCode, sat01.body).toBe(429);
    expect(sat01.json()).toEqual(CORPO_429);
    const outraImagem = await gerar(app, analise["piso"]!);
    expect(outraImagem.statusCode).toBe(429);
    expect(outraImagem.json()).toEqual(CORPO_429);
    expect(emu.chamadas.length, "nenhuma chamada depois do piso").toBe(antesDaSat01);
    // Instância NOVA: piso novo (é por instância), como na SAT-01.
    emu.limpar();
    const nova = await gerar(await instancia(), analise["piso"]!);
    expect(nova.statusCode, nova.body).toBe(201);
  });
});

describe("SAT-06 (10) — a URL assinada", () => {
  let app: FastifyInstance;
  let dto: Dto;
  let corpo404: unknown;
  beforeAll(async () => {
    app = await instancia();
    dto = j(await gerar(app, analise["base"]!)).raster;
    const inexistente = assinador.assinar({ rasterId: "00000000-0000-4000-8000-000000000000", organizationId: h.demo.orgId, userId: h.demo.adminUserId });
    const r = await baixar(app, `/api/mapa/rasters/00000000-0000-4000-8000-000000000000/arquivo?t=${inexistente.token}`);
    expect(r.statusCode).toBe(404);
    corpo404 = r.json();
    expect(corpo404).toEqual({ error: { code: "NOT_FOUND", message: MSG_RASTER_NAO_ENCONTRADO } });
  });
  const tokenDe = (u: string) => new URL(u, "http://x").searchParams.get("t")!;
  const arquivo = (id: string, t: string) => `/api/mapa/rasters/${id}/arquivo?t=${t}`;

  it("válida abre; VENCIDA, ADULTERADA, sem token, de outro raster ou id malformado → a MESMA 404", async () => {
    expect((await baixar(app, dto.url_assinada)).statusCode).toBe(200);
    const agora = Math.floor(Date.now() / 1000);
    const vencida = assinador.assinar({ rasterId: dto.id, organizationId: h.demo.orgId, userId: h.demo.adminUserId }, agora - VALIDADE_URL_RASTER_S - 1);
    const quaseVencida = assinador.assinar({ rasterId: dto.id, organizationId: h.demo.orgId, userId: h.demo.adminUserId }, agora - VALIDADE_URL_RASTER_S + 30);
    expect((await baixar(app, arquivo(dto.id, quaseVencida.token))).statusCode, "premissa: o token forjado aqui é aceito enquanto vale").toBe(200);
    const t = tokenDe(dto.url_assinada);
    const meio = Math.floor(t.length / 2);
    const adulterada = t.slice(0, meio) + (t[meio] === "A" ? "B" : "A") + t.slice(meio + 1);
    const outroRaster = j(await gerar(app, analise["L"]!)).raster;
    for (const url of [
      arquivo(dto.id, vencida.token), arquivo(dto.id, adulterada), `/api/mapa/rasters/${dto.id}/arquivo`, arquivo(dto.id, ""), arquivo(dto.id, "x".repeat(119)),
      arquivo(outroRaster.id, t), arquivo(dto.id, tokenDe(outroRaster.url_assinada)), arquivo("nao-e-uuid", t), arquivo(dto.id, t + "A")
    ]) {
      const r = await baixar(app, url);
      expect(r.statusCode, url).toBe(404);
      expect(r.json(), url).toEqual(corpo404);
    }
  });

  it("token de OUTRA organização (o mesmo usuário é dono das duas) não abre a imagem desta; o de quem não é membro também não", async () => {
    const daOutra = assinador.assinar({ rasterId: dto.id, organizationId: orgX, userId: h.demo.adminUserId });
    const r = await baixar(app, arquivo(dto.id, daOutra.token));
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual(corpo404);
    // E a imagem da organização X, com token da organização X mas de um usuário que não é membro dela.
    const naX = await gerar(app, analise["x"]!, headersX);
    expect(naX.statusCode, naX.body).toBe(201);
    expect((await baixar(app, j(naX).raster.url_assinada)).statusCode, "premissa: a URL da organização X abre").toBe(200);
    const operador = (await admin.query<{ id: string }>("select id from erp.users where email = 'operador@demo.local'")).rows[0]!.id;
    const naoMembro = assinador.assinar({ rasterId: j(naX).raster.id, organizationId: orgX, userId: operador });
    expect((await baixar(app, arquivo(j(naX).raster.id, naoMembro.token))).json()).toEqual(corpo404);
  });

  it("a chave é DERIVADA do segredo de autenticação: outro segredo assina tokens que não abrem; o token não é um JWT", async () => {
    const outro = criarAssinadorUrlRaster(configDeTeste({ LOCAL_AUTH_SECRET: "outro-segredo-qualquer" }));
    const forjado = outro.assinar({ rasterId: dto.id, organizationId: h.demo.orgId, userId: h.demo.adminUserId });
    expect((await baixar(app, arquivo(dto.id, forjado.token))).json()).toEqual(corpo404);
    const t = tokenDe(dto.url_assinada);
    expect(t).not.toContain(".");
    expect(t).not.toContain(SEGREDO_AUTENTICACAO_DE_TESTE);
    // O JWT da sessão também não serve como token da URL.
    expect((await baixar(app, arquivo(dto.id, h.token))).statusCode).toBe(404);
  });

  it("CORS: o MapLibre busca a imagem em modo CORS — a origem da web configurada recebe `access-control-allow-origin`; outra origem não", async () => {
    const origem = configDeTeste().WEB_ORIGIN.split(",")[0]!.trim();
    const r = await app.inject({ method: "GET", url: dto.url_assinada, headers: { origin: origem } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(origem);
    expect(r.headers["access-control-allow-credentials"]).toBe("true");
    // O helmet manda CORP same-origin: ele só barra a carga SEM CORS (`<img>` sem crossorigin); a busca em modo CORS passa.
    expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
    const outra = await app.inject({ method: "GET", url: dto.url_assinada, headers: { origin: "https://outra-origem.example" } });
    expect(outra.headers["access-control-allow-origin"]).toBeUndefined();
    // Sem cabeçalho nenhum além do Origin, a busca é "simples": não há preflight (o MapLibre não manda Authorization).
    const preflight = await app.inject({ method: "OPTIONS", url: dto.url_assinada, headers: { origin: origem, "access-control-request-method": "GET" } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(origem);
  });

  it("query fora do contrato na rota do arquivo → 422 (nunca descartada)", async () => {
    const r = await baixar(app, `${dto.url_assinada}&x=1`);
    expect(r.statusCode).toBe(422);
  });

  it("o token NUNCA vai para o log: a URL do arquivo é registrada com a query omitida, e nada do segredo aparece", async () => {
    const linhas: string[] = [];
    const destino = new Writable({ write(chunk: Buffer, _enc, feito) { linhas.push(chunk.toString("utf8")); feito(); } });
    const comLog = await instancia({ API_LOG_LEVEL: "info" }, { logStream: destino });
    emu.limpar();
    const g = await gerar(comLog, analise["logs"]!);
    expect(g.statusCode, g.body).toBe(201);
    const url = j(g).raster.url_assinada;
    expect((await baixar(comLog, url)).statusCode).toBe(200);
    expect((await baixar(comLog, `${url.slice(0, -2)}xx`)).statusCode).toBe(404);
    // Variação errada do caminho (barra a mais): "rota não encontrada" também é registrada — e também sem o token.
    expect((await baixar(comLog, url.replace("/arquivo?", "/arquivo/?"))).statusCode).toBe(404);
    // Caminho CODIFICADO que o roteador decodifica e atende (`%72asters` = `rasters`): abre, e o log não leva o token.
    const codificada = url.replace("/rasters/", "/%72asters/");
    expect((await baixar(comLog, codificada)).statusCode, "premissa: o roteador decodifica e atende a rota").toBe(200);
    const log = linhas.join("");
    expect(log, "premissa: o log registrou a rota do arquivo").toContain(`/api/mapa/rasters/${j(g).raster.id}/arquivo?t=[omitido]`);
    expect(log, "premissa: o log registrou a chamada ao provedor").toContain("chamada ao provedor de satélite");
    expect(log).not.toContain(tokenDe(url));
    expect(log).not.toContain(tokenDe(url).slice(0, 40));
    expect(log).not.toContain(SEGREDO_AUTENTICACAO_DE_TESTE);
    expect(log).not.toContain(CREDENCIAL_FALSA.COPERNICUS_CLIENT_SECRET);
    expect(log).not.toMatch(/Bearer|token-falso-emulador/);
  });
});

describe("SAT-06 (15)(16) — escopo de empresa, organização, listagem em lote; leitura sem provedor", () => {
  let app: FastifyInstance;
  let rA: Dto; let rB: Dto; let rX: Dto;
  let soB: { headers: Record<string, string>; userId: string };
  let soMapa: { headers: Record<string, string>; userId: string };
  let corpoAnalise404: unknown;
  beforeAll(async () => {
    app = await instancia();
    rA = j(await gerar(app, analise["escopoA"]!)).raster;
    rB = j(await gerar(app, analise["escopoB"]!)).raster;
    const x = await gerar(app, analise["x"]!, headersX);
    rX = j(x).raster;
    expect([rA, rB, rX].every((r) => typeof r?.id === "string")).toBe(true);
    soB = await membro("SAT-06 só B", "sat06-so-b@demo.local", [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
    soMapa = await membro("SAT-06 só mapa", "sat06-so-mapa@demo.local", [{ modulo: "mapa", modo: "todas", empresas: [] }]);
    const r = await gerar(app, "00000000-0000-4000-8000-000000000000");
    expect(r.statusCode).toBe(404);
    corpoAnalise404 = r.json();
    expect(corpoAnalise404).toEqual({ error: { code: "NOT_FOUND", message: MSG_ANALISE_NAO_ENCONTRADA } });
  });
  const lista = (ids: string[], headers = h.headers(), extra = "") => ler(app, `/api/mapa/rasters?area_ids=${ids.join(",")}${extra}`, headers);

  it("(15) fora do escopo da empresa, de outra organização, inexistente ou id malformado: a MESMA 404 no POST e no GET", async () => {
    emu.limpar();
    for (const [id, headers] of [
      [analise["escopoA"]!, soB.headers], [analise["escopoA"]!, soMapa.headers], [analise["x"]!, h.headers()], ["00000000-0000-4000-8000-000000000001", h.headers()], ["nao-e-uuid", h.headers()]
    ] as const) {
      const p = await gerar(app, id, headers);
      expect(p.statusCode, `POST ${id}`).toBe(404);
      expect(p.json()).toEqual(corpoAnalise404);
      const g = await ler(app, urlRaster(id), headers);
      expect(g.statusCode, `GET ${id}`).toBe(404);
      expect(g.json()).toEqual(corpoAnalise404);
    }
    // No escopo dele, o membro só-B lê e reaproveita a imagem de B.
    const g = await ler(app, urlRaster(analise["escopoB"]!), soB.headers);
    expect(g.statusCode, g.body).toBe(200);
    expect((g.json() as Dto).id).toBe(rB.id);
    const p = await gerar(app, analise["escopoB"]!, soB.headers);
    expect(p.statusCode, p.body).toBe(200);
    expect(j(p).reutilizada).toBe(true);
    expect(emu.chamadas).toHaveLength(0);
  });

  it("(15) sem a capacidade (operador): 403 (falta de capacidade não é escopo); a URL assinada para ele não abre (404)", async () => {
    expect((await gerar(app, analise["escopoA"]!, h.opHeaders())).statusCode).toBe(403);
    expect((await gerar(app, "00000000-0000-4000-8000-000000000001", h.opHeaders())).statusCode, "antes de olhar a análise").toBe(403);
    expect((await ler(app, urlRaster(analise["escopoA"]!), h.opHeaders())).statusCode).toBe(403);
    expect((await lista([area["escopoA"]!], h.opHeaders())).statusCode).toBe(403);
    const operador = (await admin.query<{ id: string }>("select id from erp.users where email = 'operador@demo.local'")).rows[0]!.id;
    const t = assinador.assinar({ rasterId: rA.id, organizationId: h.demo.orgId, userId: operador });
    expect((await baixar(app, `/api/mapa/rasters/${rA.id}/arquivo?t=${t.token}`)).statusCode).toBe(404);
  });

  it("(15) listagem em lote: a imagem mais recente de cada área pedida NO ESCOPO — nada de outra empresa, nada de outra organização", async () => {
    const pedidas = [area["escopoA"]!, area["escopoB"]!, area["x"]!, area["semObs"]!];
    const dono = await lista(pedidas);
    expect(dono.statusCode, dono.body).toBe(200);
    expect(j(dono).itens.map((i) => i.id).sort()).toEqual([rA.id, rB.id].sort());
    expect(j(dono)).toMatchObject({ pagina: 1, tamanho: 50, tem_mais: false });
    const doSoB = await lista(pedidas, soB.headers);
    expect(doSoB.statusCode, doSoB.body).toBe(200);
    expect(j(doSoB).itens.map((i) => i.id)).toEqual([rB.id]);
    const doSoMapa = await lista(pedidas, soMapa.headers);
    expect(doSoMapa.statusCode, doSoMapa.body).toBe(200);
    expect(j(doSoMapa).itens).toEqual([]);
    const naX = await lista(pedidas, headersX);
    expect(j(naX).itens.map((i) => i.id)).toEqual([rX.id]);
    // A empresa SELECIONADA (X-Empresa-Id) só diminui: o dono com B selecionada vê só a de B — na listagem e por análise.
    const selecionadaB = await lista(pedidas, h.headers({ "x-empresa-id": B }));
    expect(selecionadaB.statusCode, selecionadaB.body).toBe(200);
    expect(j(selecionadaB).itens.map((i) => i.id)).toEqual([rB.id]);
    expect((await ler(app, urlRaster(analise["escopoA"]!), h.headers({ "x-empresa-id": B }))).json()).toEqual(corpoAnalise404);
    // As URLs da listagem abrem (cada uma assinada para quem pediu).
    expect((await baixar(app, j(doSoB).itens[0]!.url_assinada)).statusCode).toBe(200);
  });

  it("(15) a URL assinada não ultrapassa o escopo de quem a recebe: token do membro só-B para a imagem de A → 404; perdeu o acesso → 404", async () => {
    const paraA = assinador.assinar({ rasterId: rA.id, organizationId: h.demo.orgId, userId: soB.userId });
    expect((await baixar(app, `/api/mapa/rasters/${rA.id}/arquivo?t=${paraA.token}`)).statusCode).toBe(404);
    const paraMapa = assinador.assinar({ rasterId: rA.id, organizationId: h.demo.orgId, userId: soMapa.userId });
    expect((await baixar(app, `/api/mapa/rasters/${rA.id}/arquivo?t=${paraMapa.token}`)).statusCode).toBe(404);
    const acesso = await membro("SAT-06 acesso", "sat06-acesso@demo.local", [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
    const r = await gerar(app, analise["acesso"]!, acesso.headers);
    expect(r.statusCode, r.body).toBe(201);
    const url = j(r).raster.url_assinada;
    expect((await baixar(app, url)).statusCode, "premissa: a URL dele abre enquanto ele tem acesso").toBe(200);
    await admin.query("update erp.organization_members set is_active = false where user_id = $1 and organization_id = $2", [acesso.userId, h.demo.orgId]);
    expect((await baixar(app, url)).statusCode, "vínculo desativado: a URL ainda dentro da validade não abre").toBe(404);
  });

  it("áreas GÊMEAS (o mesmo polígono, a mesma data), na mesma empresa e em empresas diferentes: cada uma com a SUA imagem — sem 409, sem uma ver a da outra", async () => {
    emu.limpar();
    const a1 = await gerar(app, analise["gemeaA1"]!);
    const a2 = await gerar(app, analise["gemeaA2"]!);
    const b = await gerar(app, analise["gemeaB"]!, soB.headers);
    for (const r of [a1, a2, b]) expect(r.statusCode, r.body).toBe(201);
    expect(emu.chamadasProcesso(), "cada área chama o provedor uma vez (a imagem é da área)").toHaveLength(3);
    const ids = [j(a1).raster.id, j(a2).raster.id, j(b).raster.id];
    expect(new Set(ids).size).toBe(3);
    expect([j(a1).raster.area_id, j(a2).raster.area_id, j(b).raster.area_id]).toEqual([area["gemeaA1"], area["gemeaA2"], area["gemeaB"]]);
    const linhas = (await admin.query<{ area_id: string; chave_cache: string; storage_path: string; geometria_sha256: string }>(
      "select area_id, chave_cache, storage_path, geometria_sha256 from erp.satelite_rasters where id = any($1::uuid[])", [ids])).rows;
    expect(new Set(linhas.map((l) => l.geometria_sha256)).size, "premissa: o MESMO polígono nas três").toBe(1);
    expect(new Set(linhas.map((l) => l.chave_cache)).size).toBe(3);
    expect(new Set(linhas.map((l) => l.storage_path)).size).toBe(3);
    // Cada leitura por análise acha a imagem DA SUA área; o membro só-B não vê as de A, nem pela listagem.
    for (const [nome, r] of [["gemeaA1", a1], ["gemeaA2", a2]] as const) {
      const g = await ler(app, urlRaster(analise[nome]!));
      expect((g.json() as Dto).id).toBe(j(r).raster.id);
      expect((await ler(app, urlRaster(analise[nome]!), soB.headers)).statusCode).toBe(404);
    }
    expect(((await ler(app, urlRaster(analise["gemeaB"]!), soB.headers)).json() as Dto).id).toBe(j(b).raster.id);
    const l = await lista([area["gemeaA1"]!, area["gemeaA2"]!, area["gemeaB"]!], soB.headers);
    expect(j(l).itens.map((i) => i.id)).toEqual([j(b).raster.id]);
    // De novo: as três reaproveitadas, sem chamar.
    emu.limpar();
    for (const [nome, headers] of [["gemeaA1", h.headers()], ["gemeaA2", h.headers()], ["gemeaB", soB.headers]] as const) {
      const r = await gerar(app, analise[nome]!, headers);
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r).reutilizada).toBe(true);
    }
    expect(emu.chamadas).toHaveLength(0);
  });

  it("listagem: uma consulta por página (sem N+1), paginada no servidor, a mais recente por área", async () => {
    async function contar(ids: string[], extra = "") {
      const espiao = vi.spyOn(pg.Client.prototype, "query");
      try {
        const r = await lista(ids, h.headers(), extra);
        expect(r.statusCode, r.body).toBe(200);
        const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
        return { rasters: sqls.filter((s) => /erp\.satelite_rasters/.test(s)).length, todas: sqls.length, corpo: j(r) };
      } finally { espiao.mockRestore(); }
    }
    const um = await contar([area["escopoA"]!]);
    const varios = await contar([area["escopoA"]!, area["escopoB"]!, area["base"]!, area["L"]!, area["grande"]!, area["dois"]!]);
    expect([um.corpo.itens.length, varios.corpo.itens.length], "premissa: 1 e 6 imagens").toEqual([1, 6]);
    expect(um.rasters).toBe(1);
    expect(varios.rasters).toBe(1);
    expect(varios.todas).toBe(um.todas);
    // A área com duas imagens devolve a MAIS RECENTE (data da imagem).
    expect(varios.corpo.itens.find((i) => i.area_id === area["dois"])!.data_imagem).toBe("2026-08-10");
    // Página de 2 em 6.
    const p1 = await contar([area["escopoA"]!, area["escopoB"]!, area["base"]!, area["L"]!, area["grande"]!, area["dois"]!], "&tamanho=2");
    const p3 = await contar([area["escopoA"]!, area["escopoB"]!, area["base"]!, area["L"]!, area["grande"]!, area["dois"]!], "&tamanho=2&pagina=3");
    expect([p1.corpo.itens.length, p1.corpo.tem_mais, p3.corpo.itens.length, p3.corpo.tem_mais]).toEqual([2, true, 2, false]);
    const todasDasPaginas = new Set([...p1.corpo.itens, ...p3.corpo.itens].map((i) => i.id));
    expect(todasDasPaginas.size).toBe(4);
  });

  it("listagem: contrato estrito (422) — sem área, área repetida, fora da forma canônica, acima de 200, índice ou página fora do contrato, chave desconhecida", async () => {
    const um = area["escopoA"]!;
    const ids201 = Array.from({ length: AREAS_POR_LISTAGEM_MAXIMO + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const ids200 = ids201.slice(0, AREAS_POR_LISTAGEM_MAXIMO);
    for (const q of [
      "", "area_ids=", `area_ids=${um},${um}`, `area_ids=${um.toUpperCase()}`, `area_ids=${um},`, `area_ids=${ids201.join(",")}`, `area_ids=${um}&indice=foo`,
      `area_ids=${um}&tamanho=0`, `area_ids=${um}&tamanho=201`, `area_ids=${um}&pagina=1e2`, `area_ids=${um}&pagina=01`, `area_ids=${um}&empresa_id=x`, `area_ids=${um}&x=1`,
      `area_ids=${um}&area_ids=${um}`
    ]) {
      const r = await ler(app, `/api/mapa/rasters?${q}`);
      expect(r.statusCode, q).toBe(422);
    }
    const r200 = await ler(app, `/api/mapa/rasters?area_ids=${ids200.join(",")}`);
    expect(r200.statusCode, "200 áreas é o teto, aceito").toBe(200);
    expect(j(r200).itens).toEqual([]);
  });

  it("POST e GET por análise: contrato estrito (422) — corpo com chave, query desconhecida", async () => {
    expect((await gerar(app, analise["escopoA"]!, h.headers(), { x: 1 })).statusCode).toBe(422);
    expect((await gerar(app, analise["escopoA"]!, h.headers(), { indice: "ndvi" })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `${urlRaster(analise["escopoA"]!)}?forcar=1`, headers: h.headers() })).statusCode).toBe(422);
    expect((await ler(app, `${urlRaster(analise["escopoA"]!)}?x=1`)).statusCode).toBe(422);
    const vazio = await gerar(app, analise["escopoA"]!, h.headers(), {});
    expect(vazio.statusCode, vazio.body).toBe(200);
  });

  it("(16) NENHUMA rota de leitura chama o provedor: por análise, listagem e arquivo (inclusive de imagem não gerada)", async () => {
    emu.limpar();
    expect((await ler(app, urlRaster(analise["escopoA"]!))).statusCode).toBe(200);
    expect((await ler(app, urlRaster(analise["provedor500"]!))).statusCode, "não gerada: 404, e não gera").toBe(404);
    expect((await lista([area["escopoA"]!, area["provedor500"]!, area["escopoB"]!])).statusCode).toBe(200);
    expect((await baixar(app, rA.url_assinada)).statusCode).toBe(200);
    expect((await ler(app, urlRaster(analise["escopoB"]!), soB.headers)).statusCode).toBe(200);
    expect(emu.chamadas).toHaveLength(0);
    expect(await rastersDaArea(area["provedor500"]!)).toHaveLength(0);
  });
});
