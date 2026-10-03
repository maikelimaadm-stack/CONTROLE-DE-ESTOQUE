import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { MSG_AREA_NAO_ENCONTRADA, LIMITE_ANALISES_POR_MINUTO } from "../../src/routes/analises-satelitais.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-01 (decisão 293) — a API da análise por satélite, de ponta a ponta sobre o banco real (papel sem bypass de RLS)
 * e o provedor FALSO (nenhuma chamada de rede, nenhuma conta Copernicus). Prova: o servidor lê a geometria do banco
 * e só ela vai ao provedor; capacidade × escopo com a mesma 404; histórico imutável e sem duplicata; falha do
 * provedor não grava nada nem apaga o passado; integração desligada responde de forma controlada.
 */

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
const ID_FALSO = "id-falso-sat01";
const SEGREDO_FALSO = "segredo-falso-sat01-NAO-PODE-VAZAR";
const TOKEN_FALSO = "token-falso-sat01-NAO-PODE-VAZAR";

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });
/** 0,01° em -15,6°: ≈ 1.072 m × 1.106 m ≈ 11.860 pixels de 10 m. */
const POLIGONO = quadrado(-56.1, -15.6, 0.01);
const POLIGONO_REDESENHADO = quadrado(-56.1, -15.6, 0.012);

type CorpoEstat = { input: { bounds: { geometry: unknown } }; aggregation: { timeRange: { from: string; to: string } } };
type Resp = { status: number; body?: unknown; retryAfter?: string } | "rede";
type Passo = Resp | ((corpo: CorpoEstat) => Resp | Promise<Resp>);

/** O dia (intervalo P1D) `n` dias antes do fim da janela pedida. */
function diaAntes(corpo: CorpoEstat, n: number) {
  const fim = Date.parse(corpo.aggregation.timeRange.to) - n * 86_400_000;
  return { from: new Date(fim - 86_400_000).toISOString(), to: new Date(fim).toISOString() };
}
const util = { min: 0.31, max: 0.88, mean: 0.72, stDev: 0.09, sampleCount: 13_000, noDataCount: 2_000 };
const nublado = { min: 0.1, max: 0.5, mean: 0.3, stDev: 0.1, sampleCount: 13_000, noDataCount: 12_000 };
const tudoMascarado = { min: "NaN", max: "NaN", mean: "NaN", stDev: "NaN", sampleCount: 13_000, noDataCount: 13_000 };
/** Resposta da Statistical API com os dias pedidos (n dias antes do fim da janela). */
const estatistica = (dias: { n: number; stats: Record<string, unknown> }[]) => (corpo: CorpoEstat): Resp =>
  ({ status: 200, body: { status: "OK", data: dias.map((d) => ({ interval: diaAntes(corpo, d.n), outputs: { ndvi: { bands: { B0: { stats: d.stats } } } } })) } });

let h: Harness;
let admin: Db;
let ligada: FastifyInstance; let desligada: FastifyInstance; let semCredencial: FastifyInstance;
const instancias: FastifyInstance[] = [];
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: ID_FALSO, COPERNICUS_CLIENT_SECRET: SEGREDO_FALSO };
/**
 * Instância NOVA da API ligada (mesmo banco). O limite do ERP é por instância e por minuto: cada bloco de testes que
 * chama o provedor começa com o seu, para um bloco não esgotar o limite do outro (o limite tem teste próprio).
 */
async function novaInstanciaLigada() {
  ligada = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno });
  instancias.push(ligada);
}
let roteiro: Passo[] = [];
const chamadas: { host: string; body: string | undefined; headers: Record<string, string> }[] = [];
const naApi = () => chamadas.filter((c) => c.host === API_HOST);

const buscarExterno: BuscarFn = async (url, init) => {
  const host = new URL(url).host;
  chamadas.push({ host, body: init.body, headers: init.headers });
  const responder = (r: Exclude<Resp, "rede">) => ({ status: r.status, headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : null) }, json: async () => r.body ?? null });
  if (host === TOKEN_HOST) return responder({ status: 200, body: { access_token: TOKEN_FALSO, expires_in: 3600, token_type: "Bearer" } });
  if (host !== API_HOST) throw new Error(`host inesperado: ${host}`);
  const passo = roteiro.shift();
  if (!passo) throw new Error("Statistical API chamada sem roteiro no teste");
  const r = typeof passo === "function" ? await passo(JSON.parse(init.body ?? "{}") as CorpoEstat) : passo;
  if (r === "rede") throw new TypeError("fetch failed");
  return responder(r);
};

let A = ""; let B = "";
const area: Record<string, string> = {};
let outraOrg = ""; let soB: Record<string, string> = {};

const url = (id: string, sufixo = "/ndvi") => `/api/mapa/areas/${id}/analises-satelitais${sufixo}`;
const pedir = (app: FastifyInstance, id: string, headers = h.headers(), payload?: unknown) =>
  app.inject({ method: "POST", url: url(id), headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const ler = (app: FastifyInstance, caminho: string, headers = h.headers()) => app.inject({ method: "GET", url: caminho, headers });
/** Forma das respostas lidas nos testes (o DTO completo é conferido campo a campo no primeiro teste). */
interface Dto { id: string; situacao: string; motivo_qualidade: string | null; valor_medio: string | null; observacao_inicio: string | null; criado_em: string; do_poligono_atual: boolean; [campo: string]: unknown }
interface Corpo {
  analise: Dto; reutilizada: boolean; ultima_observacao_util: Dto; itens: Dto[]; proximo_cursor: string;
  error: { code: string; message: string; details?: Record<string, unknown> }; id: string; token: string;
}
const j = (r: { json: () => unknown }) => r.json() as Corpo;
const linhas = async (areaId: string) => (await admin.query("select * from erp.analises_satelitais where area_id=$1 order by created_at", [areaId])).rows;

async function novaArea(empresa: string, code: string, geometria: unknown, org?: string) {
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`,
    [org ?? h.demo.orgId, empresa, code, `[TEST] ${code}`, geometria === null ? null : JSON.stringify(geometria)]);
  return r.rows[0]!.id;
}

/** Análise "antiga" gravada direto no banco (janela no passado), para provar que o histórico não se perde. */
async function analiseAntiga(areaId: string, empresa: string, janelaInicio: string, obs: { inicio: string; media: string } | null) {
  const inicio = Date.parse(janelaInicio);
  const fim = new Date(inicio + 30 * 86_400_000).toISOString();
  const concluida = obs !== null;
  const r = await admin.query<{ id: string }>(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo,
        valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por)
     select $1, $2, $3, 'copernicus_cdse', 'sentinel-2-l2a', 'ndvi', 'sat01-ndvi-v1', encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'),
        $4, $5, 10, $6, $7, $8::timestamptz, $8::timestamptz + interval '1 day', $9::numeric, $9::numeric - 0.2, $9::numeric + 0.1, case when $6 = 'concluida' then 0.05 end,
        case when $6 = 'concluida' then 13000 end, case when $6 = 'concluida' then 2000 end, case when $6 = 'concluida' then 11000 end,
        11860, case when $6 = 'concluida' then 0.9275 end, $10
       from erp.areas a where a.id = $3 returning id`,
    [h.demo.orgId, empresa, areaId, janelaInicio, fim, concluida ? "concluida" : "sem_observacao_util", concluida ? null : "sem_aquisicao",
      obs?.inicio ?? null, obs?.media ?? null, h.demo.adminUserId]);
  return r.rows[0]!.id;
}

async function membroSoB(): Promise<Record<string, string>> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Perfil SAT-01 só B", permissions: ["analises_satelitais.view", "analises_satelitais.create"] } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = "sat01-so-b@demo.local";
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: "SAT-01 só B", email, password: "Sat01@12345", role_id: j(papel).id, escopos_empresas: [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }] } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Sat01@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  await novaInstanciaLigada();
  desligada = await buildApp({ config: configDeTeste({ COPERNICUS_ENABLED: "0", COPERNICUS_CLIENT_ID: ID_FALSO, COPERNICUS_CLIENT_SECRET: SEGREDO_FALSO }), db: h.db, logger: false, buscarExterno });
  semCredencial = await buildApp({ config: configDeTeste({ COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "", COPERNICUS_CLIENT_SECRET: "" }), db: h.db, logger: false, buscarExterno });
  for (const [nome, empresa, geo] of [
    ["A", A, POLIGONO], ["B", B, POLIGONO], ["nuvem", A, POLIGONO], ["vazia", A, POLIGONO], ["falha", A, POLIGONO], ["corrida", A, POLIGONO],
    ["mudou", A, POLIGONO], ["historico", A, POLIGONO], ["limite", A, POLIGONO], ["excluida", A, POLIGONO], ["leitura", B, POLIGONO],
    ["semPoligono", A, null], ["pequena", A, quadrado(-56.3, -15.6, 0.0002)], ["grande", A, quadrado(-57, -16, 0.5)]
  ] as const) area[nome] = await novaArea(empresa, `SAT01-${nome}`, geo);
  await admin.query("update erp.areas set deleted_at = now() where id=$1", [area["excluida"]]);
  outraOrg = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT-01','outra-sat01') returning id")).rows[0]!.id;
  const empresaOutra = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 97, '[TEST] Empresa outra org SAT-01') returning id", [outraOrg])).rows[0]!.id;
  area["outraOrg"] = await novaArea(empresaOutra, "SAT01-X", POLIGONO, outraOrg);
  soB = await membroSoB();
}, 180_000);

afterAll(async () => {
  for (const app of [...instancias, desligada, semCredencial]) await app?.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("SAT-01 POST — análise concluída, gravada e reaproveitada", () => {
  beforeAll(novaInstanciaLigada);
  let primeira: Corpo;
  it("201: a geometria enviada ao provedor é a do BANCO; DTO do ERP; linha com organização, empresa e autor corretos", async () => {
    chamadas.length = 0;
    roteiro = [estatistica([{ n: 2, stats: nublado }, { n: 9, stats: util }, { n: 20, stats: { ...util, mean: 0.5 } }])];
    const r = await pedir(ligada, area["A"]!);
    expect(r.statusCode, r.body).toBe(201);
    primeira = j(r);
    expect(primeira.reutilizada).toBe(false);
    const enviado = JSON.parse(naApi()[0]!.body!) as CorpoEstat;
    expect(enviado.input.bounds.geometry).toEqual(POLIGONO);
    expect(naApi()[0]!.headers["authorization"]).toBe(`Bearer ${TOKEN_FALSO}`);
    const esperado = diaAntes(enviado, 9);
    expect(primeira.analise).toEqual({
      id: expect.any(String), area_id: area["A"], provedor: "copernicus_cdse", colecao: "sentinel-2-l2a", indice: "ndvi", versao_metodo: "sat01-ndvi-v1",
      janela_inicio: enviado.aggregation.timeRange.from, janela_fim: enviado.aggregation.timeRange.to, resolucao_m: "10.00",
      situacao: "concluida", motivo_qualidade: null, observacao_inicio: esperado.from, observacao_fim: esperado.to,
      valor_medio: "0.7200", valor_minimo: "0.3100", valor_maximo: "0.8800", desvio_padrao: "0.0900",
      pixels_amostra: 13_000, pixels_sem_dado: 2_000, pixels_validos: 11_000, pixels_geometria: expect.any(Number),
      cobertura_valida: expect.stringMatching(/^0\.9\d{3}$/), do_poligono_atual: true, criado_em: expect.any(String)
    });
    expect(primeira.analise.observacao_inicio).not.toBe(primeira.analise.criado_em);
    const [linha, ...resto] = await linhas(area["A"]!);
    expect(resto).toHaveLength(0);
    expect(linha).toMatchObject({ id: primeira.analise.id, organization_id: h.demo.orgId, empresa_id: A, criado_por: h.demo.adminUserId });
    expect(Object.keys(linha!.metadados_provedor).sort()).toEqual(["fonte_pixels_geometria", "intervalos_com_dado", "intervalos_com_erro", "intervalos_recebidos", "intervalos_uteis", "maior_cobertura", "status_provedor"]);
    expect(JSON.stringify([linha, primeira])).not.toMatch(new RegExp(`${TOKEN_FALSO}|${SEGREDO_FALSO}|Bearer|evalscript`));
    const auditoria = await admin.query("select action from erp.audit_logs where entity='analises_satelitais' and entity_id=$1", [primeira.analise.id]);
    expect(auditoria.rows).toEqual([{ action: "create" }]);
  });
  it("repetir no mesmo dia: 200 `reutilizada`, a MESMA análise, sem chamar o provedor, sem linha nova", async () => {
    chamadas.length = 0;
    const r = await pedir(ligada, area["A"]!);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ analise: primeira.analise, reutilizada: true });
    expect(chamadas).toHaveLength(0);
    expect(await linhas(area["A"]!)).toHaveLength(1);
  });
  it("polígono redesenhado: análise NOVA ao lado da anterior (que continua lá, intacta)", async () => {
    await admin.query("update erp.areas set geometria=$2 where id=$1", [area["A"], JSON.stringify(POLIGONO_REDESENHADO)]);
    try {
      const antes = await linhas(area["A"]!);
      roteiro = [estatistica([{ n: 1, stats: { ...util, sampleCount: 18_000, noDataCount: 2_000 } }])];
      const r = await pedir(ligada, area["A"]!);
      expect(r.statusCode, r.body).toBe(201);
      expect(j(r).analise.id).not.toBe(primeira.analise.id);
      const depois = await linhas(area["A"]!);
      expect(depois).toHaveLength(2);
      expect(depois[0]).toEqual(antes[0]);
      const hist = j(await ler(ligada, url(area["A"]!, "")));
      expect(hist.itens.map((i) => [i.id, i.do_poligono_atual])).toEqual([[j(r).analise.id, true], [primeira.analise.id, false]]);
    } finally {
      await admin.query("update erp.areas set geometria=$2 where id=$1", [area["A"], JSON.stringify(POLIGONO)]);
    }
  });
});

describe("SAT-01 POST — sem observação útil é registrada SEM número", () => {
  beforeAll(novaInstanciaLigada);
  it("imagens só com nuvem/pixel inválido → 201 sem_observacao_util / cobertura_insuficiente", async () => {
    roteiro = [estatistica([{ n: 3, stats: tudoMascarado }, { n: 8, stats: nublado }])];
    const r = await pedir(ligada, area["nuvem"]!);
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).analise).toMatchObject({ situacao: "sem_observacao_util", motivo_qualidade: "cobertura_insuficiente", observacao_inicio: null, valor_medio: null, valor_minimo: null, valor_maximo: null, desvio_padrao: null, cobertura_valida: null });
  });
  it("nenhuma imagem na janela → 201 sem_observacao_util / sem_aquisicao", async () => {
    roteiro = [estatistica([])];
    const r = await pedir(ligada, area["vazia"]!);
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).analise).toMatchObject({ situacao: "sem_observacao_util", motivo_qualidade: "sem_aquisicao", valor_medio: null });
  });
});

describe("SAT-01 POST — falha do provedor não grava nada e não apaga o passado", () => {
  beforeAll(novaInstanciaLigada);
  let antiga = "";
  beforeAll(async () => { antiga = await analiseAntiga(area["falha"]!, A, "2026-07-01T00:00:00Z", { inicio: "2026-07-20T00:00:00Z", media: "0.6500" }); });
  const casos: { nome: string; passos: Passo[]; status: number; motivo: string; chamadasApi: number }[] = [
    { nome: "5xx persistente", passos: [{ status: 500 }, { status: 502 }], status: 503, motivo: "indisponivel", chamadasApi: 2 },
    { nome: "rede fora", passos: ["rede", "rede"], status: 503, motivo: "rede", chamadasApi: 2 },
    { nome: "403 do provedor", passos: [{ status: 403 }], status: 503, motivo: "acesso_negado", chamadasApi: 1 },
    { nome: "401 persistente", passos: [{ status: 401 }, { status: 401 }], status: 503, motivo: "autenticacao", chamadasApi: 2 },
    { nome: "400 do provedor", passos: [{ status: 400, body: { error: { message: "bad" } } }], status: 503, motivo: "requisicao_recusada", chamadasApi: 1 },
    { nome: "resposta malformada", passos: [{ status: 200, body: { data: [{ interval: { from: "x" } }] } }], status: 503, motivo: "resposta_malformada", chamadasApi: 1 }
  ];
  for (const c of casos) {
    it(`${c.nome} → ${c.status} (${c.motivo}); nenhuma linha nova; a análise anterior continua a última útil`, async () => {
      chamadas.length = 0;
      roteiro = [...c.passos];
      const r = await pedir(ligada, area["falha"]!);
      expect(r.statusCode, r.body).toBe(c.status);
      expect(j(r).error).toMatchObject({ code: "CONSULTA_INDISPONIVEL", details: { motivo: c.motivo } });
      expect(r.body).not.toMatch(new RegExp(`${TOKEN_FALSO}|${SEGREDO_FALSO}|Bearer|bad`));
      expect(naApi()).toHaveLength(c.chamadasApi);
      expect(roteiro).toHaveLength(0);
      expect((await linhas(area["falha"]!)).map((l) => l.id)).toEqual([antiga]);
      const ultima = j(await ler(ligada, url(area["falha"]!, "/ultima")));
      expect(ultima.ultima_observacao_util.id).toBe(antiga);
    });
  }
  it("429 do provedor com Retry-After longo → 429 RATE_LIMITED com o tempo de espera (corpo e cabeçalho)", async () => {
    roteiro = [{ status: 429, retryAfter: "120" }];
    const r = await pedir(ligada, area["falha"]!);
    expect(r.statusCode, r.body).toBe(429);
    expect(j(r).error).toMatchObject({ code: "RATE_LIMITED", details: { motivo: "limite_provedor", tentar_apos_segundos: 120 } });
    expect(r.headers["retry-after"]).toBe("120");
    expect((await linhas(area["falha"]!)).map((l) => l.id)).toEqual([antiga]);
  });
  it("depois da falha, um pedido que dá certo grava ao lado; /ultima mostra a execução nova e a útil mais recente", async () => {
    roteiro = [estatistica([])];
    const r = await pedir(ligada, area["falha"]!);
    expect(r.statusCode, r.body).toBe(201);
    const ultima = j(await ler(ligada, url(area["falha"]!, "/ultima")));
    expect(ultima.analise).toMatchObject({ id: j(r).analise.id, situacao: "sem_observacao_util", motivo_qualidade: "sem_aquisicao" });
    expect(ultima.ultima_observacao_util).toMatchObject({ id: antiga, valor_medio: "0.6500", observacao_inicio: "2026-07-20T00:00:00.000Z" });
  });
});

describe("SAT-01 POST — recusas antes de qualquer chamada ao provedor", () => {
  it("área sem polígono, pequena demais ou grande demais → 422; o provedor não é chamado", async () => {
    chamadas.length = 0;
    for (const [nome, trecho] of [["semPoligono", "não tem polígono"], ["pequena", "pequena demais"], ["grande", "grande demais"]] as const) {
      const r = await pedir(ligada, area[nome]!);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error.message).toContain(trecho);
    }
    expect(chamadas).toHaveLength(0);
  });
  it("o cliente NÃO manda geometria, empresa, provedor nem fórmula: qualquer corpo com chave ou query desconhecida → 422", async () => {
    chamadas.length = 0;
    for (const payload of [{ geometria: quadrado(0, 0, 1) }, { empresa_id: B }, { provedor: "outro" }, { area_id: area["B"] }]) {
      const r = await pedir(ligada, area["A"]!, h.headers({ "content-type": "application/json" }), payload);
      expect(r.statusCode, r.body).toBe(422);
    }
    const q = await ligada.inject({ method: "POST", url: `${url(area["A"]!)}?empresa_id=${B}`, headers: h.headers() });
    expect(q.statusCode).toBe(422);
    expect(chamadas).toHaveLength(0);
  });
  it("integração DESLIGADA → 503 `desligada`; ligada SEM credencial → 503 `configuracao`; nenhuma chamada; o histórico continua legível", async () => {
    chamadas.length = 0;
    const off = await pedir(desligada, area["B"]!);
    expect(off.statusCode).toBe(503);
    expect(j(off).error).toMatchObject({ code: "CONSULTA_INDISPONIVEL", details: { motivo: "desligada" } });
    const semCred = await pedir(semCredencial, area["B"]!);
    expect(semCred.statusCode).toBe(503);
    expect(j(semCred).error).toMatchObject({ code: "CONSULTA_INDISPONIVEL", details: { motivo: "configuracao" } });
    expect(chamadas).toHaveLength(0);
    // Desligada, nem a existência da área é revelada pelo POST (a resposta é a mesma para área inexistente).
    expect((await pedir(desligada, "00000000-0000-4000-8000-000000000000")).statusCode).toBe(503);
    const antiga = await analiseAntiga(area["leitura"]!, B, "2026-05-01T00:00:00Z", { inicio: "2026-05-15T00:00:00Z", media: "0.4000" });
    const hist = await ler(desligada, url(area["leitura"]!, ""));
    expect(hist.statusCode).toBe(200);
    expect(j(hist).itens.map((i) => i.id)).toEqual([antiga]);
    const ultima = await ler(desligada, url(area["leitura"]!, "/ultima"));
    expect(ultima.statusCode).toBe(200);
    expect(j(ultima).analise.id).toBe(antiga);
  });
  it(`limite do ERP: ${LIMITE_ANALISES_POR_MINUTO} chamadas ao provedor por minuto por organização; a seguinte → 429 sem chamar`, async () => {
    const instancia = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno });
    try {
      chamadas.length = 0;
      roteiro = Array.from({ length: LIMITE_ANALISES_POR_MINUTO }, () => ({ status: 400 }));
      for (let i = 0; i < LIMITE_ANALISES_POR_MINUTO; i++) expect((await pedir(instancia, area["limite"]!)).statusCode).toBe(503);
      const r = await pedir(instancia, area["limite"]!);
      expect(r.statusCode, r.body).toBe(429);
      expect(j(r).error).toMatchObject({ code: "RATE_LIMITED", details: { motivo: "limite_erp" } });
      expect(naApi()).toHaveLength(LIMITE_ANALISES_POR_MINUTO);
    } finally { await instancia.close(); }
  });
});

describe("SAT-01 autorização — capacidade × escopo, a mesma 404", () => {
  beforeAll(novaInstanciaLigada);
  const CAMINHOS = (id: string) => [["POST", url(id)], ["GET", url(id, "/ultima")], ["GET", url(id, "")]] as const;
  const chamar = (app: FastifyInstance, metodo: "GET" | "POST", caminho: string, headers: Record<string, string>) => app.inject({ method: metodo, url: caminho, headers });
  it("inexistente, malformada, de outra organização, excluída: 404 idêntica em POST e nos GETs; provedor nunca chamado", async () => {
    chamadas.length = 0;
    const alvos = ["00000000-0000-4000-8000-000000000000", "nao-e-uuid", area["outraOrg"]!, area["excluida"]!];
    for (const alvo of alvos) {
      for (const [metodo, caminho] of CAMINHOS(alvo)) {
        const r = await chamar(ligada, metodo, caminho, h.headers());
        expect(r.statusCode, `${metodo} ${caminho}`).toBe(404);
        expect(j(r).error).toEqual({ code: "NOT_FOUND", message: MSG_AREA_NAO_ENCONTRADA });
      }
    }
    expect(chamadas).toHaveLength(0);
  });
  it("usuário com escopo só na empresa B: a área de A é a MESMA 404; a de B funciona e grava com a empresa B", async () => {
    chamadas.length = 0;
    for (const [metodo, caminho] of CAMINHOS(area["A"]!)) {
      const r = await chamar(ligada, metodo, caminho, soB);
      expect(r.statusCode, `${metodo} ${caminho}`).toBe(404);
      expect(j(r).error).toEqual({ code: "NOT_FOUND", message: MSG_AREA_NAO_ENCONTRADA });
    }
    expect(chamadas).toHaveLength(0);
    roteiro = [estatistica([{ n: 4, stats: util }])];
    const r = await pedir(ligada, area["B"]!, soB);
    expect(r.statusCode, r.body).toBe(201);
    const [linha] = await linhas(area["B"]!);
    expect(linha).toMatchObject({ empresa_id: B, organization_id: h.demo.orgId });
    expect((await ler(ligada, url(area["B"]!, "/ultima"), soB)).statusCode).toBe(200);
  });
  it("empresa selecionada (X-Empresa-Id) proibida para o usuário → 403; selecionar outra empresa não amplia o escopo (404)", async () => {
    const r = await pedir(ligada, area["B"]!, { ...soB, "x-empresa-id": A });
    expect(r.statusCode, r.body).toBe(403);
    // O dono seleciona a empresa B e pede a área de A: a seleção só DIMINUI o escopo.
    const dono = await ler(ligada, url(area["A"]!, "/ultima"), h.headers({ "x-empresa-id": B }));
    expect(dono.statusCode).toBe(404);
  });
  it("sem a capacidade (operador): 403 em POST e GETs, antes de olhar a área", async () => {
    for (const alvo of [area["A"]!, "00000000-0000-4000-8000-000000000000"]) {
      for (const [metodo, caminho] of CAMINHOS(alvo)) {
        const r = await chamar(ligada, metodo, caminho, h.opHeaders());
        expect(r.statusCode, `${metodo} ${caminho}`).toBe(403);
        expect(j(r).error.code).toBe("PERMISSION_DENIED");
      }
    }
  });
});

describe("SAT-01 concorrência", () => {
  beforeAll(novaInstanciaLigada);
  it("dois pedidos ao mesmo tempo: UMA linha, a mesma análise nas duas respostas (um 201, um 200 reutilizada)", async () => {
    chamadas.length = 0;
    roteiro = [estatistica([{ n: 5, stats: util }]), estatistica([{ n: 5, stats: util }])];
    const [r1, r2] = await Promise.all([pedir(ligada, area["corrida"]!), pedir(ligada, area["corrida"]!)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
    expect(j(r1).analise.id).toBe(j(r2).analise.id);
    expect(await linhas(area["corrida"]!)).toHaveLength(1);
    expect(naApi().length).toBeGreaterThanOrEqual(1);
    expect(naApi().length).toBeLessThanOrEqual(2);
  });
  it("o polígono muda ENQUANTO o provedor responde → 409, nada gravado (o número não fica atribuído a outro polígono)", async () => {
    roteiro = [async (corpo) => {
      await admin.query("update erp.areas set geometria=$2 where id=$1", [area["mudou"], JSON.stringify(POLIGONO_REDESENHADO)]);
      return estatistica([{ n: 2, stats: util }])(corpo);
    }];
    const r = await pedir(ligada, area["mudou"]!);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error.code).toBe("CONCURRENCY_CONFLICT");
    expect(await linhas(area["mudou"]!)).toHaveLength(0);
  });
});

describe("SAT-01 histórico — observações úteis, uma por imagem, paginado no servidor", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const id = area["historico"]!;
    ids["jun"] = await analiseAntiga(id, A, "2026-06-01T00:00:00Z", { inicio: "2026-06-10T00:00:00Z", media: "0.5000" });
    ids["jul"] = await analiseAntiga(id, A, "2026-07-01T00:00:00Z", { inicio: "2026-07-10T00:00:00Z", media: "0.6000" });
    // A MESMA imagem de julho pedida de novo noutra janela: aparece uma vez (a análise mais recente dela).
    ids["julDeNovo"] = await analiseAntiga(id, A, "2026-07-02T00:00:00Z", { inicio: "2026-07-10T00:00:00Z", media: "0.6000" });
    ids["semObs"] = await analiseAntiga(id, A, "2026-08-01T00:00:00Z", null);
    ids["set"] = await analiseAntiga(id, A, "2026-09-01T00:00:00Z", { inicio: "2026-09-10T00:00:00Z", media: "0.7000" });
  });
  it("ordem da imagem mais recente; sem execução sem observação; sem duplicata da mesma imagem; cursor até o fim", async () => {
    const p1 = await ler(ligada, `${url(area["historico"]!, "")}?limite=2`);
    expect(p1.statusCode, p1.body).toBe(200);
    expect(j(p1).itens.map((i) => i.id)).toEqual([ids["set"], ids["julDeNovo"]]);
    expect(j(p1).proximo_cursor).toBe("2026-07-10T00:00:00.000Z");
    const p2 = await ler(ligada, `${url(area["historico"]!, "")}?limite=2&antes=${encodeURIComponent(j(p1).proximo_cursor)}`);
    expect(j(p2).itens.map((i) => i.id)).toEqual([ids["jun"]]);
    expect(j(p2).proximo_cursor).toBeNull();
    const tudo = j(await ler(ligada, url(area["historico"]!, "")));
    expect(tudo.itens.map((i) => i.valor_medio)).toEqual(["0.7000", "0.6000", "0.5000"]);
    expect(tudo.itens.every((i) => i.situacao === "concluida")).toBe(true);
  });
  it("parâmetros fora do contrato → 422 (limite 0/101, cursor que não é data, índice desconhecido, chave desconhecida)", async () => {
    for (const q of ["limite=0", "limite=101", "antes=ontem", "indice=evi", "empresa_id=x"]) {
      expect((await ler(ligada, `${url(area["historico"]!, "")}?${q}`)).statusCode, q).toBe(422);
    }
    expect((await ler(ligada, `${url(area["historico"]!, "/ultima")}?indice=evi`)).statusCode).toBe(422);
  });
  it("área sem análise: /ultima devolve nulos e o histórico vem vazio (200, não 404)", async () => {
    const u = await ler(ligada, url(area["semPoligono"]!, "/ultima"));
    expect(u.statusCode).toBe(200);
    expect(j(u)).toEqual({ analise: null, ultima_observacao_util: null });
    expect(j(await ler(ligada, url(area["semPoligono"]!, "")))).toEqual({ itens: [], proximo_cursor: null });
  });
});
