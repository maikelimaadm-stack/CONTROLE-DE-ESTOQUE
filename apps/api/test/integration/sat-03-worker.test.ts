import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, withTx, type Db } from "@agro/db";
import { VERSAO_METODO_NDVI_V2, type PeriodoConsulta } from "@agro/domain";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ClienteCopernicus, ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { MODULO_EXECUTOR, contextoDoCriador } from "../../src/lib/satelite/contexto-worker.js";
import { executarItem, type LogSatelite } from "../../src/lib/satelite/executar-item.js";
import { recalcularConsulta } from "../../src/lib/satelite/fechamento.js";
import { PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S, type LimitesSatelite } from "../../src/lib/satelite/limites.js";
import { EVALSCRIPT_NDVI_SHA256 } from "../../src/lib/satelite/ndvi-v2.js";
import { WorkerSatelite, type ResumoRodada } from "../../src/lib/satelite/worker.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-03 (decisão 296) — o EXECUTOR DA FILA SATELITAL de ponta a ponta sobre o banco real (papel sem bypass de RLS) e
 * o provedor SEMPRE FALSO (`buscarExterno`): nenhuma chamada de rede, nenhuma conta Copernicus. Prova: o lote fecha a
 * consulta com os contadores certos; duas réplicas nunca pegam o mesmo item; nenhuma transação fica aberta durante a
 * chamada; 429/400/Retry-After e o teto da rodada; parte falhando → 'concluida_com_falhas'; o PU do cabeçalho no ledger
 * e no item (e o par nulo com origem); a janela inclusiva do item vira exclusiva na análise E no corpo enviado; polígono
 * alterado não chama o provedor; sem imagem útil conclui o item; executor desligado não consome nada; o executor não
 * lê nem escreve fora do escopo do item (duas organizações, criador com escopo 'selecionadas'); limite global atingido
 * adia, nunca falha; nenhum segredo em log, coluna ou banco.
 */

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
const ID_FALSO = "id-falso-sat03";
const SEGREDO_FALSO = "segredo-falso-sat03-NAO-PODE-VAZAR";
const TOKEN_FALSO = "token-falso-sat03-NAO-PODE-VAZAR";
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: ID_FALSO, COPERNICUS_CLIENT_SECRET: SEGREDO_FALSO };
const TEST_URL_APP = process.env.TEST_DATABASE_URL_APP ?? "postgresql://erp_app_test:erp_app_test@127.0.0.1:5433/agro_erp_test";
const DIA = 86_400_000;
const SEM_TETO: LimitesSatelite = { simultaneas: 1000, porMinutoConta: 100_000, porMinutoOrganizacao: 100_000 };

// ---------------------------------------------------------------------------------------------------------------
// O PROVEDOR FALSO — uma regra por área (pela longitude do primeiro vértice, única por área), registro de cada chamada.
// ---------------------------------------------------------------------------------------------------------------
interface CorpoEstat { input: { bounds: { geometry: { coordinates: number[][][] } } }; aggregation: { timeRange: { from: string; to: string }; evalscript: string } }
type Resp = { status: number; body?: unknown; retryAfter?: string; pu?: string | null; jsonQuebrado?: boolean } | "rede";
type Regra = (corpo: CorpoEstat) => Resp;

const iso = (ms: number) => new Date(ms).toISOString();
const UTIL = { min: 0.31, max: 0.88, mean: 0.72, stDev: 0.09, sampleCount: 13_000, noDataCount: 2_000 };
const NUBLADO = { min: 0.1, max: 0.5, mean: 0.3, stDev: 0.1, sampleCount: 13_000, noDataCount: 12_000 };
const intervaloDoDia = (dia: string) => ({ from: `${dia}T00:00:00.000Z`, to: iso(Date.parse(`${dia}T00:00:00Z`) + DIA) });
const ultimoDia = (c: CorpoEstat) => { const to = Date.parse(c.aggregation.timeRange.to); return { from: iso(to - DIA), to: iso(to) }; };
const resposta = (dias: { interval: { from: string; to: string }; stats: Record<string, unknown> }[], pu?: string | null): Resp =>
  ({ status: 200, pu, body: { status: "OK", data: dias.map((d) => ({ interval: d.interval, outputs: { ndvi: { bands: { B0: { stats: d.stats } } } } })) } });
/** Padrão: um dia útil no ÚLTIMO dia da janela pedida (prova que o último dia inclusivo do item cabe na janela), 1.5 PU. */
const utilNoFim = (pu: string | null = "1.5"): Regra => (c) => resposta([{ interval: ultimoDia(c), stats: UTIL }], pu);

const regras = new Map<string, Regra>();
const chamadasApi: { area: string; de: string; ate: string; corpo: CorpoEstat; headers: Record<string, string> }[] = [];
let atrasoMs = 0;
let aoChamar: (() => Promise<void>) | null = null;
const chaveDaLon = (lon: number) => lon.toFixed(4);

const buscarMock: BuscarFn = async (url, init) => {
  const host = new URL(url).host;
  const responder = (r: Exclude<Resp, "rede">) => ({
    status: r.status,
    headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : n === "x-processingunits-spent" ? r.pu ?? null : null) },
    json: async () => { if (r.jsonQuebrado) throw new SyntaxError("corpo ilegível"); return r.body ?? null; }
  });
  if (host === TOKEN_HOST) return responder({ status: 200, body: { access_token: TOKEN_FALSO, expires_in: 3600, token_type: "Bearer" } });
  if (host !== API_HOST) throw new Error(`host inesperado: ${host}`);
  const corpo = JSON.parse(init.body ?? "{}") as CorpoEstat;
  const area = chaveDaLon(corpo.input.bounds.geometry.coordinates[0]![0]![0]!);
  chamadasApi.push({ area, de: corpo.aggregation.timeRange.from, ate: corpo.aggregation.timeRange.to, corpo, headers: init.headers });
  if (aoChamar) await aoChamar();
  if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
  const r = (regras.get(area) ?? utilNoFim())(corpo);
  if (r === "rede") throw new TypeError("fetch failed");
  return responder(r);
};
const chamadasDa = (chave: string) => chamadasApi.filter((c) => c.area === chave);

/** Tudo o que os executores dos testes escreveram no log, serializado (para procurar segredo depois). */
const logs: string[] = [];
const logCapturado: LogSatelite = {
  info: (o, m) => { logs.push(`${JSON.stringify(o)} ${m}`); },
  warn: (o, m) => { logs.push(`${JSON.stringify(o)} ${m}`); },
  error: (o, m) => { logs.push(`${JSON.stringify(o)} ${m}`); }
};

let h: Harness;
let admin: Db;
let api: FastifyInstance;
let A = ""; let B = "";
const poolsExtras: Db[] = [];

function novoWorker(o: { db?: Db; lote?: number; limites?: Partial<LimitesSatelite>; agora?: () => number } = {}) {
  const cliente = new ClienteCopernicus({ buscar: buscarMock, credenciais: { clienteId: ID_FALSO, segredo: SEGREDO_FALSO }, esperar: async () => {} });
  return new WorkerSatelite({ db: o.db ?? h.db, cliente, limites: { ...SEM_TETO, ...o.limites }, log: logCapturado, lote: o.lote ?? 50, ...(o.agora ? { agora: o.agora } : {}) });
}
const zero = (): ResumoRodada => ({ reservados: 0, concluidos: 0, falhos: 0, adiados: 0 });
const somar = (a: ResumoRodada, b: ResumoRodada) => { a.reservados += b.reservados; a.concluidos += b.concluidos; a.falhos += b.falhos; a.adiados += b.adiados; };
/** Rodadas até uma rodada não reservar nada (itens com `proxima_tentativa_em` no futuro ficam para depois). */
async function drenar(w: WorkerSatelite, maximo = 30): Promise<ResumoRodada> {
  const total = zero();
  for (let i = 0; i < maximo; i++) {
    const r = await w.rodarUmaVez();
    somar(total, r);
    if (r.reservados === 0) return total;
  }
  throw new Error("a fila não esvaziou");
}

let indiceArea = 0;
const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });
/** Área nova com polígono PRÓPRIO (0,01° ≈ 11.860 px de 10 m): a longitude do primeiro vértice identifica a área no provedor falso. */
async function novaArea(empresa: string, opts: { org?: string } = {}): Promise<{ id: string; chave: string }> {
  const lon = Number((-56.1 + 0.02 * indiceArea++).toFixed(4));
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`,
    [opts.org ?? h.demo.orgId, empresa, `SAT03-${indiceArea}`, `[TEST] SAT03 ${indiceArea}`, JSON.stringify(quadrado(lon, -15.6, 0.01))]);
  return { id: r.rows[0]!.id, chave: chaveDaLon(lon) };
}
async function novasAreas(n: number, empresa = A) { const out = []; for (let i = 0; i < n; i++) out.push(await novaArea(empresa)); return out; }

const MENSAL_5: PeriodoConsulta = { tipo: "intervalo", de: "2026-01-01", ate: "2026-05-31", cadencia: "mensal" };
const RECENTE: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 10 };
/** A consulta pela rota da SAT-02 (o pedido real), confirmada. Devolve o id; confere quantos itens NOVOS nasceram. */
async function criarConsulta(areas: { id: string }[], periodo: PeriodoConsulta, novos: number, headers = h.headers()): Promise<string> {
  const r = await api.inject({ method: "POST", url: "/api/satelite/consultas", headers, payload: { alvo: { tipo: "areas", area_ids: areas.map((a) => a.id) }, periodo, indices: ["ndvi"], confirmar: true } });
  expect(r.statusCode, r.body).toBe(201);
  const corpo = r.json() as { consulta: { id: string }; novos: number };
  expect(corpo.novos).toBe(novos);
  return corpo.consulta.id;
}

interface LinhaItem {
  id: string; area_id: string; situacao: string; tentativas: number; tentativas_rodada: number; proxima_tentativa_em: Date | null; erro: string | null;
  analise_id: string | null; pu_gasto: string | null; janela_inicio: string; janela_fim: string; data_alvo: string | null; consulta_id: string; organization_id: string;
}
const itens = async (consultaId: string) => (await admin.query<LinhaItem>("select * from erp.satelite_consulta_itens where consulta_id=$1 order by created_at, id", [consultaId])).rows;
const consulta = async (id: string) => (await admin.query<{ situacao: string; total_itens: number; total_concluidos: number; total_falhos: number; total_reaproveitados: number; concluida_em: Date | null }>(
  "select situacao, total_itens, total_concluidos, total_falhos, total_reaproveitados, concluida_em from erp.satelite_consultas where id=$1", [id])).rows[0]!;
const analisesDe = async (itemIds: string[]) => (await admin.query("select * from erp.analises_satelitais where consulta_item_id = any($1::uuid[]) order by created_at", [itemIds])).rows;
const consumoDe = async (consultaId: string) => (await admin.query<{ consulta_item_id: string; pu_gasto: string | null; creditos: string | null; origem_cabecalho: string | null; organization_id: string; operacao: string }>(
  "select * from erp.satelite_consumo where consulta_id=$1 order by created_at", [consultaId])).rows;
/** Retira do caminho dos testes seguintes um item deixado de propósito na fila (só o fixture faz isso, como superusuário). */
const tirarDaFila = (ids: string[]) => admin.query("update erp.satelite_consulta_itens set situacao='cancelado', proxima_tentativa_em=null where id = any($1::uuid[])", [ids]);

async function membro(nome: string, email: string, permissoes: string[], escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]) {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const roleId = (papel.json() as { id: string }).id;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Sat03@12345", role_id: roleId, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Sat03@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  const userId = (await admin.query<{ id: string }>("select id from erp.users where email=$1", [email])).rows[0]!.id;
  const membroId = (await admin.query<{ id: string }>("select id from erp.organization_members where organization_id=$1 and user_id=$2", [h.demo.orgId, userId])).rows[0]!.id;
  return { headers: { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId }, roleId, userId, membroId };
}

/** Os textos SQL mandados ao banco enquanto `fn` rodava (espião em pg.Client.prototype.query). */
async function comEspiao<T>(fn: () => Promise<T>): Promise<{ resultado: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const resultado = await fn();
    const sqls = espiao.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : (c[0] as { text?: string } | undefined)?.text ?? ""));
    return { resultado, sqls };
  } finally { espiao.mockRestore(); }
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 4 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  // A instância que cria as consultas (rota da SAT-02). SEM o executor (SATELITE_WORKER_ENABLED ausente): quem executa
  // nos testes é o WorkerSatelite de cada teste, rodada a rodada.
  api = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno: buscarMock });
}, 180_000);

afterAll(async () => {
  await api?.close();
  for (const p of poolsExtras) await p.end();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("SAT-03 — o lote", () => {
  it("(1) 50 itens numa rodada: todos concluídos, consulta 'concluida' com os contadores certos, análise e consumo por item", async () => {
    const areas = await novasAreas(10);
    const id = await criarConsulta(areas, MENSAL_5, 50);
    expect((await consulta(id)).situacao).toBe("pendente");
    const antes = chamadasApi.length;
    const r = await novoWorker({ lote: 50 }).rodarUmaVez();
    expect(r).toEqual({ reservados: 50, concluidos: 50, falhos: 0, adiados: 0 });
    expect(chamadasApi.length - antes).toBe(50);

    const c = await consulta(id);
    expect(c).toMatchObject({ situacao: "concluida", total_itens: 50, total_concluidos: 50, total_falhos: 0, total_reaproveitados: 0 });
    expect(c.concluida_em).not.toBeNull();
    const lista = await itens(id);
    expect(lista).toHaveLength(50);
    for (const i of lista) expect(i).toMatchObject({ situacao: "concluido", tentativas: 1, tentativas_rodada: 1, erro: null, proxima_tentativa_em: null, pu_gasto: "1.5000" });
    const analises = await analisesDe(lista.map((i) => i.id));
    expect(analises).toHaveLength(50);
    expect(new Set(analises.map((a) => a.id))).toEqual(new Set(lista.map((i) => i.analise_id)));
    for (const a of analises) {
      expect(a).toMatchObject({ versao_metodo: VERSAO_METODO_NDVI_V2, situacao: "concluida", resolucao_nativa_m: 10, evalscript_sha256: EVALSCRIPT_NDVI_SHA256, data_alvo: null, criado_por: h.demo.adminUserId, organization_id: h.demo.orgId, empresa_id: A });
      expect(lista.find((i) => i.id === a.consulta_item_id)?.area_id).toBe(a.area_id);
    }
    const consumo = await consumoDe(id);
    expect(consumo).toHaveLength(50);
    expect(new Set(consumo.map((l) => l.consulta_item_id))).toEqual(new Set(lista.map((i) => i.id)));
    for (const l of consumo) expect(l).toMatchObject({ operacao: "statistical", pu_gasto: "1.5000", creditos: "150.00", origem_cabecalho: "1.5" });
    // A situação passou por 'executando' (auditada a cada mudança de situação) antes de fechar.
    const trilha = (await admin.query<{ s: string }>("select after->>'situacao' as s from erp.audit_logs where entity='satelite_consultas' and entity_id=$1 order by created_at, id", [id])).rows.map((l) => l.s);
    expect(trilha).toEqual(["pendente", "executando", "concluida"]);
  });

  it("(2) DUAS réplicas (pools separados, ao mesmo tempo) nunca pegam o mesmo item: 1 chamada, 1 análise e 1 consumo por item", async () => {
    const areas = await novasAreas(10);
    const id = await criarConsulta(areas, MENSAL_5, 50);
    const chaves = new Set(areas.map((a) => a.chave));
    const p1 = createPool(TEST_URL_APP, { max: 4 }); const p2 = createPool(TEST_URL_APP, { max: 4 });
    poolsExtras.push(p1, p2);
    const w1 = novoWorker({ db: p1, lote: 5 }); const w2 = novoWorker({ db: p2, lote: 5 });
    const abertos = async () => (await admin.query<{ n: number }>("select count(*)::int as n from erp.satelite_consulta_itens where consulta_id=$1 and situacao in ('pendente','executando')", [id])).rows[0]!.n;
    // Cada réplica no SEU laço (como dois processos): reserva, executa o lote, volta. A trava da reserva é só da transação
    // curta, então uma reserva enquanto a outra ainda está chamando o provedor.
    async function ciclo(w: WorkerSatelite) {
      const total = zero();
      for (let i = 0; i < 400 && (await abertos()) > 0; i++) {
        const r = await w.rodarUmaVez();
        somar(total, r);
        if (r.reservados === 0) await new Promise((res) => setTimeout(res, 5));
      }
      return total;
    }
    atrasoMs = 15;
    let r1: ResumoRodada, r2: ResumoRodada;
    try { [r1, r2] = await Promise.all([ciclo(w1), ciclo(w2)]); } finally { atrasoMs = 0; }
    expect(r1.reservados + r2.reservados).toBe(50);
    // As duas trabalharam de verdade (a prova não é uma réplica só).
    expect(r1.reservados).toBeGreaterThan(0);
    expect(r2.reservados).toBeGreaterThan(0);
    expect(r1.concluidos + r2.concluidos).toBe(50);

    const porItem = new Map<string, number>();
    for (const c of chamadasApi.filter((x) => chaves.has(x.area))) porItem.set(`${c.area}|${c.de}|${c.ate}`, (porItem.get(`${c.area}|${c.de}|${c.ate}`) ?? 0) + 1);
    expect(porItem.size).toBe(50);
    expect([...porItem.values()].every((n) => n === 1)).toBe(true);
    const lista = await itens(id);
    const analises = await admin.query<{ consulta_item_id: string; n: number }>("select consulta_item_id, count(*)::int as n from erp.analises_satelitais where consulta_item_id = any($1::uuid[]) group by 1", [lista.map((i) => i.id)]);
    expect(analises.rows).toHaveLength(50);
    expect(analises.rows.every((l) => l.n === 1)).toBe(true);
    const consumo = await admin.query<{ consulta_item_id: string; n: number }>("select consulta_item_id, count(*)::int as n from erp.satelite_consumo where consulta_id=$1 group by 1", [id]);
    expect(consumo.rows).toHaveLength(50);
    expect(consumo.rows.every((l) => l.n === 1)).toBe(true);
    expect(lista.every((i) => i.situacao === "concluido" && i.tentativas === 1)).toBe(true);
    expect(await consulta(id)).toMatchObject({ situacao: "concluida", total_concluidos: 50, total_falhos: 0 });
  });

  it("(3) nenhuma transação aberta durante a chamada ao provedor (pg_stat_activity, dentro do provedor falso)", async () => {
    const areas = await novasAreas(3);
    const id = await criarConsulta(areas, RECENTE, 3);
    const abertasNaChamada: number[] = [];
    aoChamar = async () => {
      const r = await admin.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'");
      abertasNaChamada.push(r.rows[0]!.n);
    };
    try { await drenar(novoWorker({ lote: 1 })); } finally { aoChamar = null; }
    expect(abertasNaChamada).toHaveLength(3);
    expect(abertasNaChamada).toEqual([0, 0, 0]);
    expect((await itens(id)).every((i) => i.situacao === "concluido")).toBe(true);
  });
});

describe("SAT-03 — falhas do provedor e retentativa", () => {
  it("(4a) 429 → o item volta a 'pendente' com próxima tentativa ≈ +30 s (±20%); na 3ª da rodada → 'falho'; nunca consome", async () => {
    const [area] = await novasAreas(1);
    regras.set(area!.chave, () => ({ status: 429 }));
    const id = await criarConsulta([area!], RECENTE, 1);
    // Um executor NOVO a cada rodada: o 429 pausa a instância (teste próprio abaixo), e aqui o que se mede é o item.
    const w = () => novoWorker();
    const t0 = Date.now();
    expect(await w().rodarUmaVez()).toEqual({ reservados: 1, concluidos: 0, falhos: 0, adiados: 1 });
    const t1 = Date.now();
    let [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "pendente", tentativas: 1, tentativas_rodada: 1, erro: "limite (HTTP 429)", analise_id: null });
    const proxima = item!.proxima_tentativa_em!.getTime();
    expect(proxima).toBeGreaterThanOrEqual(t0 + 24_000);
    expect(proxima).toBeLessThanOrEqual(t1 + 36_000);
    expect(chamadasDa(area!.chave)).toHaveLength(1);
    expect((await consulta(id)).situacao).toBe("executando");
    // Antes da próxima tentativa, nada é reservado (executor novo: não é a pausa, é a próxima tentativa do item).
    expect((await w().rodarUmaVez()).reservados).toBe(0);

    // 2ª tentativa (o fixture adianta o relógio do item): espera BASE × FATOR = 120 s (±20%).
    await admin.query("update erp.satelite_consulta_itens set proxima_tentativa_em = now() - interval '1 second' where id=$1", [item!.id]);
    const t2 = Date.now();
    await w().rodarUmaVez();
    [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "pendente", tentativas: 2, tentativas_rodada: 2 });
    expect(item!.proxima_tentativa_em!.getTime()).toBeGreaterThanOrEqual(t2 + 96_000);
    expect(item!.proxima_tentativa_em!.getTime()).toBeLessThanOrEqual(Date.now() + 144_000);

    // 3ª tentativa: o teto da rodada (TENTATIVAS_POR_RODADA = 3) → 'falho'.
    await admin.query("update erp.satelite_consulta_itens set proxima_tentativa_em = now() - interval '1 second' where id=$1", [item!.id]);
    expect(await w().rodarUmaVez()).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "falho", tentativas: 3, tentativas_rodada: 3, erro: "limite (HTTP 429)", proxima_tentativa_em: null });
    expect(chamadasDa(area!.chave)).toHaveLength(3);
    expect(await consumoDe(id)).toEqual([]);
    expect(await consulta(id)).toMatchObject({ situacao: "concluida_com_falhas", total_falhos: 1, total_concluidos: 0 });
  });

  it("(4b) Retry-After MAIOR que a espera calculada é respeitado (120 s)", async () => {
    const [area] = await novasAreas(1);
    regras.set(area!.chave, () => ({ status: 429, retryAfter: "120" }));
    const id = await criarConsulta([area!], RECENTE, 1);
    const t0 = Date.now();
    await novoWorker().rodarUmaVez();
    const t1 = Date.now();
    const [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "pendente", tentativas: 1, erro: "limite (HTTP 429)" });
    expect(item!.proxima_tentativa_em!.getTime()).toBeGreaterThanOrEqual(t0 + 120_000);
    expect(item!.proxima_tentativa_em!.getTime()).toBeLessThanOrEqual(t1 + 121_000);
    // O cliente não esperou 120 s dentro da chamada (Retry-After acima do teto dele): uma chamada só.
    expect(chamadasDa(area!.chave)).toHaveLength(1);
    await tirarDaFila([item!.id]);
  });

  it("(4c) 400 → 'falho' na PRIMEIRA, sem repetir", async () => {
    const [area] = await novasAreas(1);
    regras.set(area!.chave, () => ({ status: 400, body: { error: { message: "bad request" } } }));
    const id = await criarConsulta([area!], RECENTE, 1);
    const w = novoWorker();
    expect(await drenar(w)).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    expect((await drenar(w)).reservados).toBe(0);
    const [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "falho", tentativas: 1, erro: "requisicao_recusada (HTTP 400)", analise_id: null, proxima_tentativa_em: null });
    expect(chamadasDa(area!.chave)).toHaveLength(1);
    expect(await consulta(id)).toMatchObject({ situacao: "concluida_com_falhas", total_falhos: 1 });
  });

  it("(I-3b) provedor sem serviço → o executor DESTA instância pausa: a rodada seguinte não reserva nem chama; passada a pausa (ou o Retry-After maior), volta", async () => {
    const [a429, aOk, a429b, aOk2] = await novasAreas(4);
    regras.set(a429!.chave, () => ({ status: 429 }));
    regras.set(a429b!.chave, () => ({ status: 429, retryAfter: "300" }));
    let deslocamentoMs = 0;
    const w = novoWorker({ lote: 1, agora: () => Date.now() + deslocamentoMs });
    const id429 = await criarConsulta([a429!], RECENTE, 1);
    expect(await w.rodarUmaVez()).toEqual({ reservados: 1, concluidos: 0, falhos: 0, adiados: 1 });
    const idOk = await criarConsulta([aOk!], RECENTE, 1);
    // Logo depois e ainda dentro da pausa: nada reservado, o provedor não é chamado, o item nem ganha tentativa.
    expect(await w.rodarUmaVez()).toEqual(zero());
    deslocamentoMs = (PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S - 1) * 1000;
    expect(await w.rodarUmaVez()).toEqual(zero());
    expect(chamadasDa(aOk!.chave)).toEqual([]);
    expect((await itens(idOk))[0]).toMatchObject({ situacao: "pendente", tentativas: 0 });
    // Passada a pausa, volta a reservar.
    deslocamentoMs = (PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S + 1) * 1000;
    expect(await w.rodarUmaVez()).toEqual({ reservados: 1, concluidos: 1, falhos: 0, adiados: 0 });
    expect(chamadasDa(aOk!.chave)).toHaveLength(1);

    // Retry-After de 300 s, MAIOR que a pausa padrão: vale ele.
    const id429b = await criarConsulta([a429b!], RECENTE, 1);
    expect((await w.rodarUmaVez()).adiados).toBe(1);
    const idOk2 = await criarConsulta([aOk2!], RECENTE, 1);
    deslocamentoMs += (PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S + 1) * 1000;
    expect(await w.rodarUmaVez()).toEqual(zero());
    deslocamentoMs += 300 * 1000;
    expect(await w.rodarUmaVez()).toEqual({ reservados: 1, concluidos: 1, falhos: 0, adiados: 0 });
    expect((await itens(idOk2))[0]).toMatchObject({ situacao: "concluido" });
    await tirarDaFila([...(await itens(id429)), ...(await itens(id429b))].map((i) => i.id));
  });

  it("(M-5) erro de gravação DEPOIS do 2xx → 'falho' erro_gravacao, com o consumo do 2xx gravado e SEM nova chamada", async () => {
    const [area] = await novasAreas(1);
    const id = await criarConsulta([area!], RECENTE, 1);
    // Falha FORÇADA na fase 3: a gravação da análise recusa (como um erro de banco), só durante esta rodada.
    const original = pg.Client.prototype.query;
    const falharAnalise = function (this: unknown, ...args: unknown[]) {
      const texto = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text ?? "";
      if (/insert into erp\.analises_satelitais/.test(texto)) return Promise.reject(Object.assign(new Error("falha forçada do teste"), { code: "XX000" }));
      return Reflect.apply(original, this, args);
    };
    const espiao = vi.spyOn(pg.Client.prototype, "query").mockImplementation(falharAnalise as unknown as typeof original);
    let r: ResumoRodada;
    try { r = await novoWorker().rodarUmaVez(); } finally { espiao.mockRestore(); }
    expect(r).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    const [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "falho", erro: "erro_gravacao", tentativas: 1, analise_id: null, proxima_tentativa_em: null });
    expect(await analisesDe([item!.id])).toEqual([]);
    expect(await consumoDe(id)).toEqual([expect.objectContaining({ consulta_item_id: item!.id, pu_gasto: "1.5000", creditos: "150.00" })]);
    expect(chamadasDa(area!.chave)).toHaveLength(1);
    // Nenhuma rodada seguinte cobra de novo.
    expect((await drenar(novoWorker())).reservados).toBe(0);
    expect(chamadasDa(area!.chave)).toHaveLength(1);
    expect(await consulta(id)).toMatchObject({ situacao: "concluida_com_falhas", total_falhos: 1 });
  });

  it("2xx com corpo ILEGÍVEL: a chamada foi cobrada — uma linha no ledger (o PU do cabeçalho, ou o par nulo) e o item segue o retry.ts", async () => {
    const [comPu, semPu] = await novasAreas(2);
    regras.set(comPu!.chave, () => ({ status: 200, pu: "2.5", jsonQuebrado: true }));
    regras.set(semPu!.chave, () => ({ status: 200, pu: null, jsonQuebrado: true }));
    const id = await criarConsulta([comPu!, semPu!], RECENTE, 2);
    expect(await novoWorker().rodarUmaVez()).toEqual({ reservados: 2, concluidos: 0, falhos: 2, adiados: 0 });
    const lista = await itens(id);
    // resposta_malformada falha na primeira (retry.ts): repetir não muda a resposta, só cobra de novo.
    expect(lista.map((i) => [i.situacao, i.erro, i.analise_id])).toEqual([["falho", "resposta_malformada (HTTP 200)", null], ["falho", "resposta_malformada (HTTP 200)", null]]);
    const consumo = await consumoDe(id);
    const doItem = (areaId: string) => consumo.filter((l) => l.consulta_item_id === lista.find((i) => i.area_id === areaId)!.id);
    expect(doItem(comPu!.id)).toEqual([expect.objectContaining({ pu_gasto: "2.5000", creditos: "250.00", origem_cabecalho: "2.5" })]);
    expect(doItem(semPu!.id)).toEqual([expect.objectContaining({ pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_ausente" })]);
    expect([...chamadasDa(comPu!.chave), ...chamadasDa(semPu!.chave)]).toHaveLength(2);
  });

  it("(5) parte falhando → 'concluida_com_falhas'; os concluídos ficam gravados", async () => {
    const areas = await novasAreas(4);
    regras.set(areas[2]!.chave, () => ({ status: 400 }));
    regras.set(areas[3]!.chave, () => ({ status: 403 }));
    const id = await criarConsulta(areas, RECENTE, 4);
    expect(await drenar(novoWorker())).toEqual({ reservados: 4, concluidos: 2, falhos: 2, adiados: 0 });
    const c = await consulta(id);
    expect(c).toMatchObject({ situacao: "concluida_com_falhas", total_itens: 4, total_concluidos: 2, total_falhos: 2 });
    expect(c.concluida_em).not.toBeNull();
    const lista = await itens(id);
    const ok = lista.filter((i) => i.situacao === "concluido");
    expect(ok.map((i) => i.area_id).sort()).toEqual([areas[0]!.id, areas[1]!.id].sort());
    expect(await analisesDe(ok.map((i) => i.id))).toHaveLength(2);
    expect(lista.filter((i) => i.situacao === "falho").map((i) => i.erro).sort()).toEqual(["acesso_negado (HTTP 403)", "requisicao_recusada (HTTP 400)"]);
  });
});

describe("SAT-03 — consumo, janela e método", () => {
  it("(7) o PU do cabeçalho x-processingunits-spent vai para o ledger e para o item; sem cabeçalho (ou inválido) → par nulo com a origem", async () => {
    const [comPu, semPu, invalido] = await novasAreas(3);
    regras.set(comPu!.chave, utilNoFim("12.5"));
    regras.set(semPu!.chave, utilNoFim(null));
    regras.set(invalido!.chave, utilNoFim("1e3"));
    const id = await criarConsulta([comPu!, semPu!, invalido!], RECENTE, 3);
    expect(await drenar(novoWorker())).toMatchObject({ reservados: 3, concluidos: 3 });
    const lista = await itens(id);
    const consumo = await consumoDe(id);
    const doItem = (areaId: string) => { const i = lista.find((x) => x.area_id === areaId)!; return { item: i, consumo: consumo.filter((l) => l.consulta_item_id === i.id) }; };
    const a = doItem(comPu!.id), b = doItem(semPu!.id), c = doItem(invalido!.id);
    expect(a.item).toMatchObject({ situacao: "concluido", pu_gasto: "12.5000" });
    expect(a.consumo).toEqual([expect.objectContaining({ pu_gasto: "12.5000", creditos: "1250.00", origem_cabecalho: "12.5" })]);
    expect(b.item).toMatchObject({ situacao: "concluido", pu_gasto: null });
    expect(b.consumo).toEqual([expect.objectContaining({ pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_ausente" })]);
    expect(c.item).toMatchObject({ situacao: "concluido", pu_gasto: null });
    expect(c.consumo).toEqual([expect.objectContaining({ pu_gasto: null, creditos: null, origem_cabecalho: "cabecalho_invalido" })]);
    for (const x of [a, b, c]) expect(x.item.analise_id).not.toBeNull();
  });

  it("(11) a janela INCLUSIVA do item vira EXCLUSIVA na análise E no corpo enviado ao provedor (virada de ano e data alvo)", async () => {
    const [area, alvo] = await novasAreas(2);
    const id = await criarConsulta([area!], { tipo: "intervalo", de: "2025-12-01", ate: "2026-01-31", cadencia: "mensal" }, 2);
    // Data alvo 15/08 ± 5: o provedor devolve o dia alvo e o último dia, ambos úteis — a v2 escolhe o mais perto do alvo.
    regras.set(alvo!.chave, (c) => resposta([{ interval: intervaloDoDia("2026-08-15"), stats: UTIL }, { interval: ultimoDia(c), stats: UTIL }], "2"));
    const idAlvo = await criarConsulta([alvo!], { tipo: "data", data: "2026-08-15", tolerancia_dias: 5 }, 1);
    expect(await drenar(novoWorker())).toMatchObject({ reservados: 3, concluidos: 3 });

    const lista = [...await itens(id), ...await itens(idAlvo)];
    const esperado: Record<string, { ini: string; fim: string; obs: string; alvo: string | null }> = {
      "2025-12-01": { ini: "2025-12-01T00:00:00.000Z", fim: "2026-01-01T00:00:00.000Z", obs: "2025-12-31T00:00:00.000Z", alvo: null },
      "2026-01-01": { ini: "2026-01-01T00:00:00.000Z", fim: "2026-02-01T00:00:00.000Z", obs: "2026-01-31T00:00:00.000Z", alvo: null },
      "2026-08-10": { ini: "2026-08-10T00:00:00.000Z", fim: "2026-08-21T00:00:00.000Z", obs: "2026-08-15T00:00:00.000Z", alvo: "2026-08-15" }
    };
    expect(lista.map((i) => `${i.janela_inicio}..${i.janela_fim}`).sort()).toEqual(["2025-12-01..2025-12-31", "2026-01-01..2026-01-31", "2026-08-10..2026-08-20"]);
    const analises = await analisesDe(lista.map((i) => i.id));
    expect(analises).toHaveLength(3);
    for (const i of lista) {
      const e = esperado[i.janela_inicio]!;
      const a = analises.find((x) => x.consulta_item_id === i.id)!;
      expect([a.janela_inicio.toISOString(), a.janela_fim.toISOString()], i.janela_inicio).toEqual([e.ini, e.fim]);
      expect(a.observacao_inicio.toISOString(), i.janela_inicio).toBe(e.obs);
      expect(a.data_alvo).toBe(e.alvo);
      const enviado = chamadasApi.filter((c) => c.area === (i.area_id === area!.id ? area!.chave : alvo!.chave) && c.de === e.ini);
      expect(enviado.map((c) => c.ate), `corpo enviado de ${i.janela_inicio}`).toEqual([e.fim]);
      expect(createHash("sha256").update(enviado[0]!.corpo.aggregation.evalscript, "utf8").digest("hex")).toBe(a.evalscript_sha256);
    }
  });

  it("(12) polígono alterado depois do pedido → 'falho' geometria_alterada: nenhuma análise, nenhuma chamada, nenhum consumo", async () => {
    const [area] = await novasAreas(1);
    const id = await criarConsulta([area!], RECENTE, 1);
    await admin.query("update erp.areas set geometria=$2 where id=$1", [area!.id, JSON.stringify(quadrado(-40.5, -15.6, 0.012))]);
    const antes = chamadasApi.length;
    expect(await drenar(novoWorker())).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    expect(chamadasApi.length).toBe(antes);
    const [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "falho", erro: "geometria_alterada", analise_id: null });
    expect(await analisesDe([item!.id])).toEqual([]);
    expect(await consumoDe(id)).toEqual([]);
    expect(await consulta(id)).toMatchObject({ situacao: "concluida_com_falhas", total_falhos: 1 });
  });

  it("(13) sem imagem útil → análise 'sem_observacao_util' (sem número) e item 'concluido'", async () => {
    const [area] = await novasAreas(1);
    regras.set(area!.chave, (c) => resposta([{ interval: ultimoDia(c), stats: NUBLADO }]));
    const id = await criarConsulta([area!], RECENTE, 1);
    expect(await drenar(novoWorker())).toMatchObject({ reservados: 1, concluidos: 1 });
    const [item] = await itens(id);
    expect(item).toMatchObject({ situacao: "concluido", pu_gasto: null });
    const [a] = await analisesDe([item!.id]);
    expect(a).toMatchObject({ id: item!.analise_id, situacao: "sem_observacao_util", motivo_qualidade: "cobertura_insuficiente", valor_medio: null, observacao_inicio: null });
    expect(await consulta(id)).toMatchObject({ situacao: "concluida", total_concluidos: 1 });
  });

  it("criador sem a capacidade de pedir → 'falho' sem_permissao, sem chamar o provedor", async () => {
    const m = await membro("SAT-03 perde create", "sat03-perde-create@demo.local", ["analises_satelitais.view", "analises_satelitais.create"], [{ modulo: "pecuaria", modo: "todas", empresas: [] }]);
    const [area] = await novasAreas(1);
    const id = await criarConsulta([area!], RECENTE, 1, m.headers);
    await admin.query("delete from erp.role_permissions where role_id=$1 and permission_key='analises_satelitais.create'", [m.roleId]);
    expect(await drenar(novoWorker())).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    expect(chamadasDa(area!.chave)).toEqual([]);
    expect((await itens(id))[0]).toMatchObject({ situacao: "falho", erro: "sem_permissao" });
  });

  it("item largado 'executando' por réplica caída além do teto da rodada → recuperado e 'falho' execucao_interrompida, sem chamar", async () => {
    const [area] = await novasAreas(1);
    const id = await criarConsulta([area!], RECENTE, 1);
    const [antes] = await itens(id);
    await admin.query("update erp.satelite_consulta_itens set situacao='executando', tentativas=3, tentativas_rodada=3, proxima_tentativa_em=now() - interval '1 minute' where id=$1", [antes!.id]);
    expect(await drenar(novoWorker())).toEqual({ reservados: 1, concluidos: 0, falhos: 1, adiados: 0 });
    expect(chamadasDa(area!.chave)).toEqual([]);
    expect((await itens(id))[0]).toMatchObject({ situacao: "falho", erro: "execucao_interrompida", tentativas: 4, tentativas_rodada: 4 });
  });
});

describe("SAT-03 — limite global", () => {
  it("teto atingido (conta, organização, simultâneas) → o item NÃO é reservado, fica 'pendente' sem tentativa; nunca 'falho'", async () => {
    const [area] = await novasAreas(1);
    const id = await criarConsulta([area!], RECENTE, 1);
    // Uma chamada FRESCA no ledger (do último minuto) e um item 'executando' de outra consulta: os três tetos em 1.
    await admin.query("insert into erp.satelite_consumo (organization_id, empresa_id, operacao, pu_gasto, creditos, origem_cabecalho) values ($1,$2,'statistical',0.1,10.00,'0.1')", [h.demo.orgId, A]);
    const [ocupante] = await novasAreas(1);
    const idOcupante = await criarConsulta([ocupante!], RECENTE, 1);
    const [itemOcupante] = await itens(idOcupante);
    for (const limites of [{ porMinutoConta: 1 }, { porMinutoOrganizacao: 1 }]) {
      expect(await novoWorker({ limites }).rodarUmaVez(), JSON.stringify(limites)).toEqual(zero());
    }
    await admin.query("update erp.satelite_consulta_itens set situacao='executando', proxima_tentativa_em=now() + interval '10 minutes' where id=$1", [itemOcupante!.id]);
    // simultâneas 2 − a vaga do pedido avulso (RESERVA_INTERATIVA) = 1 vaga do executor, já ocupada.
    expect(await novoWorker({ limites: { simultaneas: 2 } }).rodarUmaVez()).toEqual(zero());
    expect(chamadasDa(area!.chave)).toEqual([]);
    expect((await itens(id))[0]).toMatchObject({ situacao: "pendente", tentativas: 0, tentativas_rodada: 0, erro: null, proxima_tentativa_em: null });
    await tirarDaFila([itemOcupante!.id]);
    // Premissa: o item ERA reservável — sem teto, ele roda.
    expect(await drenar(novoWorker())).toMatchObject({ reservados: 1, concluidos: 1 });
  });
});

describe("SAT-03 — liga/desliga no processo da API", () => {
  it("(15) desligado (sem a variável, ou sem COPERNICUS_ENABLED): a API sobe, NADA é reservado nem consumido; ligado, o ciclo roda e para no close", async () => {
    const areas = await novasAreas(2);
    const id = await criarConsulta(areas, RECENTE, 2);
    const consumoAntes = (await admin.query<{ n: number }>("select count(*)::int as n from erp.satelite_consumo")).rows[0]!.n;
    for (const env of [{ ...CREDENCIAL_FALSA, SATELITE_WORKER_INTERVALO_S: "1" }, { ...CREDENCIAL_FALSA, SATELITE_WORKER_ENABLED: "1", COPERNICUS_ENABLED: "0", SATELITE_WORKER_INTERVALO_S: "1" }]) {
      const app = await buildApp({ config: configDeTeste(env), db: h.db, logger: false, buscarExterno: buscarMock });
      await app.ready();
      expect(app.executorSatelite).toBeNull();
      await new Promise((r) => setTimeout(r, 1_500));
      await app.close();
    }
    expect((await itens(id)).map((i) => [i.situacao, i.tentativas])).toEqual([["pendente", 0], ["pendente", 0]]);
    expect(areas.flatMap((a) => chamadasDa(a.chave))).toEqual([]);
    expect((await admin.query<{ n: number }>("select count(*)::int as n from erp.satelite_consumo")).rows[0]!.n).toBe(consumoAntes);

    // Ligado (as três condições): o onReady inicia o ciclo e os itens são executados; o close para o ciclo.
    const ligada = await buildApp({
      config: configDeTeste({ ...CREDENCIAL_FALSA, SATELITE_WORKER_ENABLED: "1", SATELITE_WORKER_INTERVALO_S: "1", SATELITE_LIMITE_SIMULTANEAS: "1000", SATELITE_LIMITE_MINUTO_CONTA: "100000", SATELITE_LIMITE_MINUTO_ORG: "100000" }),
      db: h.db, logger: false, buscarExterno: buscarMock
    });
    try {
      expect(ligada.executorSatelite).toBeInstanceOf(WorkerSatelite);
      await ligada.ready();
      for (let i = 0; i < 60 && (await consulta(id)).situacao !== "concluida"; i++) await new Promise((r) => setTimeout(r, 250));
    } finally { await ligada.close(); }
    expect(await consulta(id)).toMatchObject({ situacao: "concluida", total_concluidos: 2 });
    // Fechada a instância, o ciclo parou: um item novo continua na fila.
    const [outra] = await novasAreas(1);
    const idDepois = await criarConsulta([outra!], RECENTE, 1);
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await itens(idDepois))[0]).toMatchObject({ situacao: "pendente", tentativas: 0 });
    await tirarDaFila((await itens(idDepois)).map((i) => i.id));
  });
});

describe("SAT-03 — o executor não sai do escopo do item", () => {
  const ESCOPADAS = new Set(["areas", "satelite_consultas", "satelite_consulta_itens", "satelite_consumo", "analises_satelitais"]);
  /** Para cada SQL: cada `from|join|update erp.<tabela escopada> <alias>` tem o seu `me.empresa_id=<alias>.empresa_id`. Devolve o total. */
  function conferirEscopo(sqls: string[]): number {
    let total = 0;
    for (const sql of sqls) {
      const porAlias = new Map<string, number>();
      for (const m of sql.matchAll(/\b(?:from|join|update)\s+erp\.(\w+)\s+(\w+)/gi)) {
        if (!ESCOPADAS.has(m[1]!)) continue;
        porAlias.set(m[2]!, (porAlias.get(m[2]!) ?? 0) + 1);
      }
      for (const [alias, n] of porAlias) {
        const predicados = (sql.match(new RegExp(`me\\.empresa_id=${alias}\\.empresa_id`, "g")) ?? []).length;
        expect(predicados, `escopo do alias "${alias}" em: ${sql.replace(/\s+/g, " ").slice(0, 400)}`).toBe(n);
        total += n;
      }
    }
    return total;
  }

  it("(16a) criador com escopo 'selecionadas': o item é executado com o escopo DELE — o predicado de empresa em CADA ocorrência de tabela", async () => {
    const restrito = await membro("SAT-03 só A", "sat03-so-a@demo.local", ["analises_satelitais.view", "analises_satelitais.create"], [{ modulo: "pecuaria", modo: "selecionadas", empresas: [A] }]);
    const [area] = await novasAreas(1, A);
    const id = await criarConsulta([area!], RECENTE, 1, restrito.headers);
    const { resultado, sqls } = await comEspiao(() => novoWorker().rodarUmaVez());
    expect(resultado).toEqual({ reservados: 1, concluidos: 1, falhos: 0, adiados: 0 });
    // fase 1: consulta (travar), item, área, recálculo (consulta-alvo, itens, consulta) = 6; fase 3: as mesmas 6 + a mudança do item = 7.
    expect(conferirEscopo(sqls)).toBe(13);
    const [item] = await itens(id);
    const [a] = await analisesDe([item!.id]);
    expect(a).toMatchObject({ criado_por: restrito.userId, empresa_id: A, situacao: "concluida" });
  });

  it("(1a/1b) criador perde a empresa depois do pedido → a reserva fecha os pendentes como 'falho' criador_sem_acesso e a consulta em 'concluida_com_falhas', sem chamar; a chave fica livre", async () => {
    const restrito = await membro("SAT-03 perde A", "sat03-perde-a@demo.local", ["analises_satelitais.view", "analises_satelitais.create"], [{ modulo: "pecuaria", modo: "selecionadas", empresas: [A] }]);
    const areas = await novasAreas(2, A);
    const id = await criarConsulta(areas, RECENTE, 2, restrito.headers);
    await admin.query("delete from erp.membro_empresas where membro_id=$1 and empresa_id=$2", [restrito.membroId, A]);
    expect(await novoWorker().rodarUmaVez()).toEqual(zero());
    expect(areas.flatMap((x) => chamadasDa(x.chave))).toEqual([]);
    const lista = await itens(id);
    expect(lista.map((i) => [i.situacao, i.erro, i.analise_id])).toEqual([["falho", "criador_sem_acesso", null], ["falho", "criador_sem_acesso", null]]);
    const fechada = await consulta(id);
    expect(fechada).toMatchObject({ situacao: "concluida_com_falhas", total_itens: 2, total_falhos: 2, total_concluidos: 0, total_reaproveitados: 0 });
    expect(fechada.concluida_em).not.toBeNull();
    expect(await consumoDe(id)).toEqual([]);
    // A regra SQL da reserva é a do fechamento.ts: recalcular sob a RLS de quem ENXERGA a consulta (o dono) não muda nada.
    await withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId, modulo: MODULO_EXECUTOR }, async (tx) => {
      const ctx = await contextoDoCriador(tx, h.demo.orgId, h.demo.adminUserId);
      expect(ctx).not.toBeNull();
      await recalcularConsulta(ctx!, id);
    });
    expect(await consulta(id)).toEqual(fechada);
    // (1b) A chave ficou livre: o mesmo pedido, de quem tem acesso, nasce 'pendente' (não 'reaproveitado') e roda.
    const id2 = await criarConsulta(areas, RECENTE, 2);
    expect((await itens(id2)).map((i) => i.situacao)).toEqual(["pendente", "pendente"]);
    expect(await drenar(novoWorker())).toMatchObject({ reservados: 2, concluidos: 2 });
  });

  it("(16b) reserva que NÃO é do criador (escopo perdido depois da reserva, ou organização trocada): o item nem é visível — nada é lido, chamado ou gravado", async () => {
    const restrito = await membro("SAT-03 só B", "sat03-so-b@demo.local", ["analises_satelitais.view", "analises_satelitais.create"], [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
    const [area] = await novasAreas(1, B);
    const id = await criarConsulta([area!], RECENTE, 1, restrito.headers);
    const [item] = await itens(id);
    // A reserva já marcou o item (fixture) e o criador perdeu a empresa B logo depois.
    await admin.query("update erp.satelite_consulta_itens set situacao='executando', tentativas=1, tentativas_rodada=1, proxima_tentativa_em=now() + interval '10 minutes' where id=$1", [item!.id]);
    await admin.query("delete from erp.membro_empresas where membro_id=$1 and empresa_id=$2", [restrito.membroId, B]);
    const dep = { db: h.db, cliente: new ClienteCopernicus({ buscar: buscarMock, credenciais: { clienteId: ID_FALSO, segredo: SEGREDO_FALSO } }), log: logCapturado, agora: Date.now, aleatorio: Math.random };
    const reservado = { organization_id: h.demo.orgId, empresa_id: B, consulta_id: id, item_id: item!.id, criado_por: restrito.userId };
    const logsInicio = logs.length;
    expect((await executarItem(dep, reservado)).desfecho).toBe("adiado");
    // O criador AINDA é membro (há contexto): quem esconde o item é o escopo — a RLS e o predicado de empresa.
    expect(logs.slice(logsInicio).join("\n")).toContain("consulta_fora_do_escopo");
    // A mesma reserva com a organização TROCADA: o criador é dono da outra organização (há contexto), mas a GUC é a dela —
    // o item desta organização é invisível.
    const outraOrg = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT-03 b','outra-sat03-b') returning id")).rows[0]!.id;
    await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [outraOrg, h.demo.adminUserId]);
    const logsAntes = logs.length;
    expect((await executarItem(dep, { ...reservado, organization_id: outraOrg, criado_por: h.demo.adminUserId })).desfecho).toBe("adiado");
    expect(logs.slice(logsAntes).join("\n")).toContain("consulta_fora_do_escopo");
    expect(chamadasDa(area!.chave)).toEqual([]);
    expect((await itens(id))[0]).toMatchObject({ situacao: "executando", tentativas: 1, erro: null, analise_id: null });
    expect(await consumoDe(id)).toEqual([]);
    await tirarDaFila([item!.id]);
  });

  it("(16c) duas organizações: o item de uma é executado em nome do criador DELA e nada da outra é lido ou escrito", async () => {
    const orgX = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT-03','outra-sat03') returning id")).rows[0]!.id;
    const empresaX = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 97, '[TEST] Empresa X SAT-03') returning id", [orgX])).rows[0]!.id;
    const donoX = (await admin.query<{ id: string }>("insert into erp.users (email, name) values ('dono-x-sat03@demo.local', '[TEST] Dono X') returning id")).rows[0]!.id;
    await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [orgX, donoX]);
    const areaX = await novaArea(empresaX, { org: orgX });
    const consultaX = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
       values ($1, $2, $3, '{}'::jsonb, 1, 1, 'pendente', 1) returning id`, [orgX, empresaX, donoX])).rows[0]!.id;
    const hoje = new Date().toISOString().slice(0, 10);
    await admin.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
          janela_inicio, janela_fim, chave_idempotencia, chave_idempotencia_origem)
       select $1, $2, $3, a.id, encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'), 'ndvi', $4, $5::date - 9, $5::date, $6, 'teste-sat03'
         from erp.areas a where a.id = $7`, [consultaX, orgX, empresaX, VERSAO_METODO_NDVI_V2, hoje, createHash("sha256").update(randomUUID()).digest("hex"), areaX.id]);

    const contarDemo = async () => (await admin.query<{ a: number; c: number; i: string }>(
      `select (select count(*)::int from erp.analises_satelitais where organization_id=$1) as a,
              (select count(*)::int from erp.satelite_consumo where organization_id=$1) as c,
              (select string_agg(id::text || situacao || tentativas || coalesce(erro, ''), ',' order by id) from erp.satelite_consulta_itens where organization_id=$1) as i`, [h.demo.orgId])).rows[0]!;
    const antes = await contarDemo();
    expect(await drenar(novoWorker())).toEqual({ reservados: 1, concluidos: 1, falhos: 0, adiados: 0 });
    expect(await contarDemo()).toEqual(antes);
    const [item] = await itens(consultaX);
    expect(item).toMatchObject({ situacao: "concluido", organization_id: orgX });
    const [a] = await analisesDe([item!.id]);
    expect(a).toMatchObject({ organization_id: orgX, empresa_id: empresaX, criado_por: donoX });
    expect(await consumoDe(consultaX)).toEqual([expect.objectContaining({ organization_id: orgX })]);
    expect(await consulta(consultaX)).toMatchObject({ situacao: "concluida", total_concluidos: 1 });
  });
});

describe("SAT-03 — organização excluída", () => {
  it("(1c) organização com deleted_at → os pendentes viram 'falho' criador_sem_acesso e a consulta fecha, sem chamar o provedor", async () => {
    const orgY = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Excluída SAT-03','excluida-sat03') returning id")).rows[0]!.id;
    const empresaY = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 98, '[TEST] Empresa Y SAT-03') returning id", [orgY])).rows[0]!.id;
    const donoY = (await admin.query<{ id: string }>("insert into erp.users (email, name) values ('dono-y-sat03@demo.local', '[TEST] Dono Y') returning id")).rows[0]!.id;
    await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [orgY, donoY]);
    const areaY = await novaArea(empresaY, { org: orgY });
    const consultaY = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
       values ($1, $2, $3, '{}'::jsonb, 1, 1, 'pendente', 1) returning id`, [orgY, empresaY, donoY])).rows[0]!.id;
    const hoje = new Date().toISOString().slice(0, 10);
    await admin.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
          janela_inicio, janela_fim, chave_idempotencia, chave_idempotencia_origem)
       select $1, $2, $3, a.id, encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'), 'ndvi', $4, $5::date - 9, $5::date, $6, 'teste-sat03'
         from erp.areas a where a.id = $7`, [consultaY, orgY, empresaY, VERSAO_METODO_NDVI_V2, hoje, createHash("sha256").update(randomUUID()).digest("hex"), areaY.id]);
    await admin.query("update erp.organizations set deleted_at = now() where id = $1", [orgY]);
    expect(await novoWorker().rodarUmaVez()).toEqual(zero());
    expect(chamadasDa(areaY.chave)).toEqual([]);
    expect((await itens(consultaY)).map((i) => [i.situacao, i.erro])).toEqual([["falho", "criador_sem_acesso"]]);
    expect(await consulta(consultaY)).toMatchObject({ situacao: "concluida_com_falhas", total_falhos: 1 });
    expect(await consumoDe(consultaY)).toEqual([]);
  });
});

describe("SAT-03 — nenhum segredo sai", () => {
  it("(18) client secret e token do provedor falso não aparecem em log capturado, na coluna erro nem no banco", async () => {
    expect(logs.length).toBeGreaterThan(50); // a prova não é vazia: o executor escreveu de verdade
    const proibidos = [SEGREDO_FALSO, TOKEN_FALSO, "Bearer", "client_secret", "authorization"];
    for (const linha of logs) for (const p of proibidos) expect(linha.toLowerCase(), linha.slice(0, 200)).not.toContain(p.toLowerCase());
    // O token foi de fato usado nas chamadas (o cabeçalho existiu) — e só lá.
    expect(chamadasApi.some((c) => c.headers["authorization"] === `Bearer ${TOKEN_FALSO}`)).toBe(true);
    const r = await admin.query<{ n: number }>(
      `select (select count(*) from erp.satelite_consulta_itens where coalesce(erro,'') ~* $1)
            + (select count(*) from erp.analises_satelitais where metadados_provedor::text ~* $1)
            + (select count(*) from erp.satelite_consumo where coalesce(origem_cabecalho,'') ~* $1)
            + (select count(*) from erp.audit_logs where coalesce(metadata::text,'') || coalesce(before::text,'') || coalesce(after::text,'') ~* $1) as n`,
      [`${SEGREDO_FALSO}|${TOKEN_FALSO}|bearer`]);
    expect(Number(r.rows[0]!.n)).toBe(0);
    const erros = (await admin.query<{ erro: string }>("select distinct erro from erp.satelite_consulta_itens where erro is not null order by 1")).rows.map((l) => l.erro);
    expect(erros.length).toBeGreaterThan(3);
    for (const e of erros) expect(e).toMatch(/^[a-z_]+( \(HTTP \d{3}\))?$/);
  });
});
