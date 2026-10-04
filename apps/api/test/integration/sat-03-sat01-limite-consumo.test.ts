import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { classificarLimite } from "../../src/lib/satelite/limite-global.js";
import { MSG_LIMITE_ANALISES, MSG_POLIGONO_MUDOU } from "../../src/routes/analises-satelitais.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-03 (decisão 296) — a rota avulsa da SAT-01 (`POST /api/mapa/areas/:id/analises-satelitais/ndvi`) com o LIMITE
 * GLOBAL contado pelo banco e o CONSUMO no ledger, sobre o banco real (papel sem bypass de RLS) e o provedor FALSO.
 * Prova: (14) a resposta é a da SAT-01, campo a campo (201 nova, 200 reutilizada sem chamada, 429 do limite, 409 do
 * polígono); análise e consumo nascem na MESMA transação (falha forçada no INSERT do ledger não deixa a análise); (e)
 * ledger do último minuto no teto (organização ou conta) ou itens 'executando' no teto de simultâneas → o 429 de sempre
 * SEM chamar o provedor; o PU do cabeçalho vai para o ledger — sem cabeçalho, ou inválido, o par nulo com a origem.
 */

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });
const POLIGONO = quadrado(-56.1, -15.6, 0.01);
const POLIGONO_REDESENHADO = quadrado(-56.1, -15.6, 0.012);
const TETOS_ALTOS = { SATELITE_LIMITE_MINUTO_CONTA: "100000", SATELITE_LIMITE_MINUTO_ORG: "100000", SATELITE_LIMITE_SIMULTANEAS: "1000" };
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-sat03", COPERNICUS_CLIENT_SECRET: "segredo-falso-sat03" };

type CorpoEstat = { aggregation: { timeRange: { from: string; to: string } } };
type Passo = { status: number; pu?: string; antes?: () => Promise<void> };
const util = { min: 0.31, max: 0.88, mean: 0.72, stDev: 0.09, sampleCount: 13_000, noDataCount: 2_000 };
/** Resposta da Statistical API com um dia útil 3 dias antes do fim da janela pedida. */
function corpoUtil(corpo: CorpoEstat) {
  const fim = Date.parse(corpo.aggregation.timeRange.to) - 3 * 86_400_000;
  return { status: "OK", data: [{ interval: { from: new Date(fim - 86_400_000).toISOString(), to: new Date(fim).toISOString() }, outputs: { ndvi: { bands: { B0: { stats: util } } } } }] };
}

let roteiro: Passo[] = [];
const chamadas: string[] = [];
const naApi = () => chamadas.filter((h) => h === API_HOST);
const buscarExterno: BuscarFn = async (url, init) => {
  const host = new URL(url).host;
  chamadas.push(host);
  if (host === TOKEN_HOST) return { status: 200, headers: { get: () => null }, json: async () => ({ access_token: "token-falso-sat03", expires_in: 3600 }) };
  if (host !== API_HOST) throw new Error(`host inesperado: ${host}`);
  const passo = roteiro.shift();
  if (!passo) throw new Error("Statistical API chamada sem roteiro no teste");
  await passo.antes?.();
  const corpo = JSON.parse(init.body ?? "{}") as CorpoEstat;
  return { status: passo.status, headers: { get: (n: string) => (n === "x-processingunits-spent" ? passo.pu ?? null : null) }, json: async () => corpoUtil(corpo) };
};

let h: Harness;
let admin: Db;
let A = "";
let orgX = ""; let empresaX = ""; let headersX: Record<string, string> = {};
let orgY = ""; let empresaY = ""; let areaY = "";
const area: Record<string, string> = {};
const instancias: FastifyInstance[] = [];
async function instancia(env: Record<string, string> = {}) {
  const app = await buildApp({ config: configDeTeste({ ...CREDENCIAL_FALSA, ...TETOS_ALTOS, ...env }), db: h.db, logger: false, buscarExterno });
  instancias.push(app);
  return app;
}
const pedir = (app: FastifyInstance, id: string, headers = h.headers()) => app.inject({ method: "POST", url: `/api/mapa/areas/${id}/analises-satelitais/ndvi`, headers });

async function novaArea(org: string, empresa: string, code: string, geometria: unknown = POLIGONO) {
  return (await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] ${code}`, JSON.stringify(geometria)])).rows[0]!.id;
}
const analises = async (areaId: string) => (await admin.query("select * from erp.analises_satelitais where area_id=$1 order by created_at", [areaId])).rows;
const idsDoLedger = async () => new Set((await admin.query<{ id: string }>("select id from erp.satelite_consumo")).rows.map((l) => l.id));
async function novasNoLedger(antes: Set<string>) {
  const r = await admin.query("select * from erp.satelite_consumo order by created_at, id");
  return r.rows.filter((l: { id: string }) => !antes.has(l.id));
}
/** `n` linhas no ledger do último minuto (agora) da organização/empresa — o "já gastou" de outros pedidos. */
const semearLedger = (org: string, empresa: string, n: number) => admin.query(
  `insert into erp.satelite_consumo (organization_id, empresa_id, operacao, pu_gasto, creditos, origem_cabecalho)
   select $1, $2, 'statistical', 0.01, 1, '0.01' from generate_series(1, $3)`, [org, empresa, n]);

/** As chaves do DTO da SAT-01 (o contrato de antes): nenhuma a mais, nenhuma a menos. */
const CHAVES_DTO = [
  "id", "area_id", "provedor", "colecao", "indice", "versao_metodo", "janela_inicio", "janela_fim", "resolucao_m", "situacao", "motivo_qualidade",
  "observacao_inicio", "observacao_fim", "valor_medio", "valor_minimo", "valor_maximo", "desvio_padrao", "pixels_amostra", "pixels_sem_dado",
  "pixels_validos", "pixels_geometria", "cobertura_valida", "do_poligono_atual", "criado_em"
].sort();
type Linha = Record<string, unknown> & { janela_inicio: Date; janela_fim: Date; observacao_inicio: Date | null; observacao_fim: Date | null; created_at: Date };
/** O DTO da SAT-01 montado da LINHA gravada (a regra do contrato da 0052/SAT-01, escrita de novo aqui de propósito). */
const dtoSat01 = (l: Linha) => ({
  id: l["id"], area_id: l["area_id"], provedor: l["provedor"], colecao: l["colecao"], indice: l["indice"], versao_metodo: l["versao_metodo"],
  janela_inicio: l.janela_inicio.toISOString(), janela_fim: l.janela_fim.toISOString(), resolucao_m: l["resolucao_m"],
  situacao: l["situacao"], motivo_qualidade: l["motivo_qualidade"],
  observacao_inicio: l.observacao_inicio?.toISOString() ?? null, observacao_fim: l.observacao_fim?.toISOString() ?? null,
  valor_medio: l["valor_medio"], valor_minimo: l["valor_minimo"], valor_maximo: l["valor_maximo"], desvio_padrao: l["desvio_padrao"],
  pixels_amostra: l["pixels_amostra"], pixels_sem_dado: l["pixels_sem_dado"], pixels_validos: l["pixels_validos"], pixels_geometria: l["pixels_geometria"],
  cobertura_valida: l["cobertura_valida"], do_poligono_atual: true, criado_em: l.created_at.toISOString()
});
const CORPO_429 = { error: { code: "RATE_LIMITED", message: MSG_LIMITE_ANALISES, details: { motivo: "limite_erp" } } };

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  A = h.demo.empresaIds[0]!;
  for (const nome of ["nova", "limite", "falhaTx", "mudou", "semPu", "puInvalido", "puValido", "corrida", "conta", "simult", "voo1", "voo2", "voo3", "voo4", "voo5"]) {
    area[nome] = await novaArea(h.demo.orgId, A, `SAT03-${nome}`);
  }
  // Organização X: o administrador do harness é DONO dela também (o mesmo token, outro X-Org-Id). O ledger dela começa
  // vazio — é onde a fronteira do teto por organização se mede sem herdar linha de outro teste.
  orgX = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Org X SAT-03','org-x-sat03') returning id")).rows[0]!.id;
  empresaX = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 96, '[TEST] Empresa X SAT-03') returning id", [orgX])).rows[0]!.id;
  await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [orgX, h.demo.adminUserId]);
  headersX = { authorization: `Bearer ${h.token}`, "x-org-id": orgX };
  area["x1"] = await novaArea(orgX, empresaX, "SAT03-x1");
  area["x2"] = await novaArea(orgX, empresaX, "SAT03-x2");
  // Organização Y: sem usuário; só gasta (ledger) e tem itens 'executando' — o teto da CONTA é de todas.
  orgY = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Org Y SAT-03','org-y-sat03') returning id")).rows[0]!.id;
  empresaY = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 95, '[TEST] Empresa Y SAT-03') returning id", [orgY])).rows[0]!.id;
  areaY = await novaArea(orgY, empresaY, "SAT03-y1");
}, 180_000);

afterAll(async () => {
  for (const app of instancias) await app.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("SAT-03 (14) — a resposta da rota da SAT-01 é a mesma", () => {
  let ligada: FastifyInstance;
  let analise201: Record<string, unknown>;
  beforeAll(async () => { ligada = await instancia(); });

  it("201 nova: corpo INTEIRO = o DTO da SAT-01 da linha gravada; e o consumo da chamada no ledger (PU, créditos, empresa da área)", async () => {
    chamadas.length = 0; const antes = await idsDoLedger();
    roteiro = [{ status: 200, pu: "0.5051" }];
    const r = await pedir(ligada, area["nova"]!);
    expect(r.statusCode, r.body).toBe(201);
    const [linha, ...resto] = await analises(area["nova"]!);
    expect(resto).toHaveLength(0);
    const corpo = r.json() as { analise: Record<string, unknown>; reutilizada: boolean };
    expect(corpo).toStrictEqual({ analise: dtoSat01(linha as Linha), reutilizada: false });
    expect(Object.keys(corpo.analise).sort()).toEqual(CHAVES_DTO);
    expect(r.headers["retry-after"]).toBeUndefined();
    analise201 = corpo.analise;
    expect(naApi()).toHaveLength(1);
    const novas = await novasNoLedger(antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ organization_id: h.demo.orgId, empresa_id: A, consulta_id: null, consulta_item_id: null, operacao: "statistical",
      pu_gasto: "0.5051", creditos: "50.51", origem_cabecalho: "0.5051" });
  });

  it("200 reutilizada: corpo INTEIRO igual ao de sempre (a MESMA análise), sem chamar o provedor e sem linha no ledger", async () => {
    chamadas.length = 0; const antes = await idsDoLedger();
    const r = await pedir(ligada, area["nova"]!);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toStrictEqual({ analise: analise201, reutilizada: true });
    expect(chamadas).toEqual([]);
    expect(await novasNoLedger(antes)).toEqual([]);
  });

  it("429 do limite: o corpo de sempre (RATE_LIMITED, mensagem e motivo `limite_erp`), sem Retry-After, sem chamar, sem gravar", async () => {
    const teto1 = await instancia({ SATELITE_LIMITE_MINUTO_ORG: "1" });
    await semearLedger(h.demo.orgId, A, 1); // a organização já gastou 1 no último minuto: o teto (1) está cheio
    chamadas.length = 0; const antes = await idsDoLedger();
    const r = await pedir(teto1, area["limite"]!);
    expect(r.statusCode, r.body).toBe(429);
    expect(r.json()).toStrictEqual(CORPO_429);
    expect(r.headers["retry-after"]).toBeUndefined();
    expect(chamadas).toEqual([]);
    expect(await novasNoLedger(antes)).toEqual([]);
    expect(await analises(area["limite"]!)).toHaveLength(0);
    // Com o limite CHEIO, a análise já gravada continua 200 reutilizada: reaproveitar não chama nem conta (como antes).
    const reuso = await pedir(teto1, area["nova"]!);
    expect(reuso.statusCode, reuso.body).toBe(200);
    expect(reuso.json()).toStrictEqual({ analise: analise201, reutilizada: true });
    expect(chamadas).toEqual([]);
  });
});

describe("SAT-03 — análise e consumo nascem na MESMA transação", () => {
  let ligada: FastifyInstance;
  beforeAll(async () => { ligada = await instancia(); });

  it("falha forçada no INSERT do ledger (DEPOIS do INSERT da análise): 500 e NENHUMA das duas linhas fica; sem a falha, as duas", async () => {
    chamadas.length = 0; const antes = await idsDoLedger();
    roteiro = [{ status: 200, pu: "0.2" }];
    const original = pg.Client.prototype.query;
    const textos: string[] = [];
    const espiao = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const texto = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text ?? "";
      textos.push(texto);
      if (/insert into erp\.satelite_consumo/i.test(texto)) return Promise.reject(new Error("falha forçada no ledger (teste SAT-03)"));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    let r;
    try { r = await pedir(ligada, area["falhaTx"]!); } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(500);
    // premissa: a análise FOI inserida antes (na mesma transação) e o INSERT do ledger veio depois dela
    const iAnalise = textos.findIndex((t) => /insert into erp\.analises_satelitais/i.test(t));
    const iConsumo = textos.findIndex((t) => /insert into erp\.satelite_consumo/i.test(t));
    expect(iAnalise, "premissa: a análise foi inserida").toBeGreaterThanOrEqual(0);
    expect(iConsumo, "premissa: o consumo foi tentado depois da análise").toBeGreaterThan(iAnalise);
    expect(naApi()).toHaveLength(1);
    expect(await analises(area["falhaTx"]!)).toHaveLength(0);
    expect(await novasNoLedger(antes)).toEqual([]);

    roteiro = [{ status: 200, pu: "0.2" }];
    const ok = await pedir(ligada, area["falhaTx"]!);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await analises(area["falhaTx"]!)).toHaveLength(1);
    expect((await novasNoLedger(antes)).map((l: { pu_gasto: string; creditos: string }) => [l.pu_gasto, l.creditos])).toEqual([["0.2000", "20.00"]]);
  });

  it("polígono muda durante a chamada: o 409 de sempre, a análise NÃO é gravada e o consumo da chamada FICA (o provedor cobrou)", async () => {
    chamadas.length = 0; const antes = await idsDoLedger();
    roteiro = [{ status: 200, pu: "0.3", antes: async () => { await admin.query("update erp.areas set geometria=$2 where id=$1", [area["mudou"], JSON.stringify(POLIGONO_REDESENHADO)]); } }];
    const r = await pedir(ligada, area["mudou"]!);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toStrictEqual({ error: { code: "CONCURRENCY_CONFLICT", message: MSG_POLIGONO_MUDOU } });
    expect(await analises(area["mudou"]!)).toHaveLength(0);
    expect((await novasNoLedger(antes)).map((l: { empresa_id: string; pu_gasto: string }) => [l.empresa_id, l.pu_gasto])).toEqual([[A, "0.3000"]]);
  });
});

describe("SAT-03 (e) — limite GLOBAL: no teto, o 429 de sempre SEM chamar o provedor", () => {
  it("organização: abaixo do teto chama (e a chamada conta); no teto → 429; o ledger de OUTRA organização não entra na conta da organização", async () => {
    const teto3 = await instancia({ SATELITE_LIMITE_MINUTO_ORG: "3" });
    const demoNoMinuto = (await admin.query<{ n: number }>("select count(*)::int as n from erp.satelite_consumo where organization_id=$1 and created_at > now() - interval '60 seconds'", [h.demo.orgId])).rows[0]!.n;
    expect(demoNoMinuto, "premissa: a organização demo já gastou no último minuto (se contasse aqui, X estaria no teto)").toBeGreaterThanOrEqual(1);
    await semearLedger(orgX, empresaX, 2);
    chamadas.length = 0;
    roteiro = [{ status: 200, pu: "0.1" }];
    const abaixo = await pedir(teto3, area["x1"]!, headersX);
    expect(abaixo.statusCode, abaixo.body).toBe(201);
    expect(naApi()).toHaveLength(1);
    const noTeto = await pedir(teto3, area["x2"]!, headersX);
    expect(noTeto.statusCode, noTeto.body).toBe(429);
    expect(noTeto.json()).toStrictEqual(CORPO_429);
    expect(naApi(), "o provedor não foi chamado no teto").toHaveLength(1);
    expect(await analises(area["x2"]!)).toHaveLength(0);
  });

  it("conta: linhas de OUTRA organização no ledger enchem o teto da CONTA → 429 na organização demo, sem chamar", async () => {
    const TETO = 40;
    const tetoConta = await instancia({ SATELITE_LIMITE_MINUTO_CONTA: String(TETO) });
    await semearLedger(orgY, empresaY, TETO);
    chamadas.length = 0; const antes = await idsDoLedger();
    const r = await pedir(tetoConta, area["conta"]!);
    expect(r.statusCode, r.body).toBe(429);
    expect(r.json()).toStrictEqual(CORPO_429);
    expect(chamadas).toEqual([]);
    expect(await novasNoLedger(antes)).toEqual([]);
  });

  it("simultâneas: itens 'executando' da fila (de qualquer organização) no teto → 429 sem chamar; abaixo do teto, chama", async () => {
    const tetoSimult = await instancia({ SATELITE_LIMITE_SIMULTANEAS: "2" });
    const consulta = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
       values ($1, $2, $3, '{}'::jsonb, 1, 0, 'executando', 2) returning id`, [orgY, empresaY, h.demo.adminUserId])).rows[0]!.id;
    const itens = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
          janela_inicio, janela_fim, situacao, tentativas, tentativas_rodada, proxima_tentativa_em, chave_idempotencia, chave_idempotencia_origem)
       select $1, $2, $3, $4, repeat('a', 64), 'ndvi', 'ndvi-v2', '2026-08-01', '2026-08-10', 'executando', 1, 1, now() + interval '10 minutes',
              repeat(n::text, 64), 'teste-sat03-' || n
         from generate_series(1, 2) n returning id`, [consulta, orgY, empresaY, areaY])).rows.map((l) => l.id);
    try {
      chamadas.length = 0;
      const r = await pedir(tetoSimult, area["simult"]!);
      expect(r.statusCode, r.body).toBe(429);
      expect(r.json()).toStrictEqual(CORPO_429);
      expect(chamadas).toEqual([]);
      await admin.query("update erp.satelite_consulta_itens set situacao='falho', proxima_tentativa_em=null, erro='teste' where id=$1", [itens[0]]);
      roteiro = [{ status: 200, pu: "0.1" }];
      const abaixo = await pedir(tetoSimult, area["simult"]!);
      expect(abaixo.statusCode, abaixo.body).toBe(201);
      expect(naApi()).toHaveLength(1);
    } finally {
      await admin.query("update erp.satelite_consulta_itens set situacao='falho', proxima_tentativa_em=null, erro='teste' where id = any($1::uuid[]) and situacao='executando'", [itens]);
    }
  });

  it("rajada: pedidos simultâneos com o banco ainda vazio — as chamadas EM VOO desta instância contam; além do teto, 429 sem chamar; a vaga volta quando a chamada termina", async () => {
    const tetoSimult = await instancia({ SATELITE_LIMITE_SIMULTANEAS: "2" });
    let liberar = () => {};
    const portao = new Promise<void>((resolve) => { liberar = resolve; });
    chamadas.length = 0;
    roteiro = [{ status: 200, pu: "0.1", antes: () => portao }, { status: 200, pu: "0.1", antes: () => portao }];
    let respondidos = 0;
    const pedidos = ["voo1", "voo2", "voo3", "voo4"].map((nome) => pedir(tetoSimult, area[nome]!).finally(() => { respondidos++; }));
    // Os dois que passaram ficam presos no provedor; os outros dois respondem ANTES de o portão abrir (sem chamar).
    await vi.waitFor(() => { expect(naApi()).toHaveLength(2); expect(respondidos).toBe(2); }, { timeout: 10_000 });
    liberar();
    const respostas = await Promise.all(pedidos);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 201, 429, 429]);
    for (const r of respostas.filter((x) => x.statusCode === 429)) expect(r.json()).toStrictEqual(CORPO_429);
    expect(naApi(), "só as duas vagas chamaram o provedor").toHaveLength(2);
    roteiro = [{ status: 200, pu: "0.1" }];
    const depois = await pedir(tetoSimult, area["voo5"]!);
    expect(depois.statusCode, depois.body).toBe(201);
  });

  it("classificação (pura): ledger + executando contra cada teto; contagem quebrada LANÇA (nunca vira livre)", () => {
    const l = { simultaneas: 2, porMinutoConta: 10, porMinutoOrganizacao: 5 };
    expect(classificarLimite({ conta_minuto: 0, conta_executando: 0, org_minuto: 0, org_executando: 0 }, l)).toBe("livre");
    expect(classificarLimite({ conta_minuto: 8, conta_executando: 1, org_minuto: 3, org_executando: 1 }, l)).toBe("livre");
    expect(classificarLimite({ conta_minuto: 9, conta_executando: 1, org_minuto: 0, org_executando: 0 }, l)).toBe("conta");
    expect(classificarLimite({ conta_minuto: 4, conta_executando: 1, org_minuto: 4, org_executando: 1 }, l)).toBe("organizacao");
    expect(classificarLimite({ conta_minuto: 0, conta_executando: 2, org_minuto: 0, org_executando: 0 }, l)).toBe("simultaneas");
    // as chamadas em voo do processo entram como 'executando'
    expect(classificarLimite({ conta_minuto: 0, conta_executando: 1, org_minuto: 0, org_executando: 0 }, l, { conta: 1, organizacao: 0 })).toBe("simultaneas");
    expect(classificarLimite({ conta_minuto: 0, conta_executando: 0, org_minuto: 4, org_executando: 0 }, l, { conta: 1, organizacao: 1 })).toBe("organizacao");
    for (const quebrado of [Number.NaN, -1, 1.5]) {
      expect(() => classificarLimite({ conta_minuto: quebrado, conta_executando: 0, org_minuto: 0, org_executando: 0 }, l)).toThrow(/fora do formato/);
    }
  });
});

describe("SAT-03 — o PU do cabeçalho no ledger", () => {
  let ligada: FastifyInstance;
  beforeAll(async () => { ligada = await instancia(); });
  const casos: [string, string | undefined, Record<string, unknown>][] = [
    ["semPu", undefined, { pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_ausente" }],
    ["puInvalido", "1e2", { pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_invalido" }],
    ["puValido", "1.23456", { pu_gasto: "1.2346", creditos: "123.46", origem_cabecalho: "1.23456" }]
  ];
  for (const [nome, pu, esperado] of casos) {
    it(`${pu === undefined ? "sem cabeçalho" : `cabeçalho ${pu}`} → ${JSON.stringify(esperado)}; a resposta não muda (201)`, async () => {
      const antes = await idsDoLedger();
      roteiro = [{ status: 200, ...(pu === undefined ? {} : { pu }) }];
      const r = await pedir(ligada, area[nome]!);
      expect(r.statusCode, r.body).toBe(201);
      expect(Object.keys((r.json() as { analise: object }).analise).sort()).toEqual(CHAVES_DTO);
      const novas = await novasNoLedger(antes);
      expect(novas).toHaveLength(1);
      expect(novas[0]).toMatchObject({ empresa_id: A, operacao: "statistical", ...esperado });
    });
  }
  it("dois pedidos simultâneos da mesma área: UMA linha de consumo por chamada feita ao provedor (quem compartilha não grava outra)", async () => {
    chamadas.length = 0; const antes = await idsDoLedger();
    roteiro = [{ status: 200, pu: "0.4" }, { status: 200, pu: "0.4" }];
    const [r1, r2] = await Promise.all([pedir(ligada, area["corrida"]!), pedir(ligada, area["corrida"]!)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
    expect(naApi().length).toBeGreaterThanOrEqual(1);
    expect(await novasNoLedger(antes)).toHaveLength(naApi().length);
  });
});
