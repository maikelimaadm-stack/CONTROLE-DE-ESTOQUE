import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { D } from "@agro/shared";
import {
  RESOLUCAO_PADRAO_M, VERSAO_METODO_NDVI_V2, estimarCreditosItem, origemChaveIdempotencia, slotsDoPeriodo, somarFaixas,
  type FaixaCreditos, type PeriodoConsulta
} from "@agro/domain";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { lerPoligono, planejarGrade } from "../../src/lib/satelite/geometria.js";
import { MSG_AREA_GRANDE, MSG_AREA_NAO_ENCONTRADA, MSG_AREA_PEQUENA, MSG_AREA_SEM_POLIGONO, MSG_POLIGONO_FORA_DO_FORMATO } from "../../src/routes/analises-satelitais.js";
import {
  MSG_ALVO_SEM_AREAS, MSG_CONSULTA_NAO_ENCONTRADA, MSG_EXCEDE_ORCAMENTO, MSG_NENHUMA_AREA_ANALISAVEL, MSG_RETIRO_NAO_ENCONTRADO, MSG_VARIAS_EMPRESAS,
  msgItensDemais
} from "../../src/routes/satelite-consultas.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-02 (decisão 295) — a CONSULTA SATELITAL EM LOTE, de ponta a ponta sobre o banco real (papel sem bypass de RLS).
 * Prova: capacidade × escopo com a mesma 404 (organização, empresa, módulo da permissão, seleção de empresa); o escopo
 * de empresa em CADA ocorrência de tabela de CADA consulta SQL (contado); prévia que não grava NADA (contagem das quatro
 * tabelas e nenhuma escrita no espião); idempotência por item (um vivo por chave, inclusive com dois POST simultâneos);
 * orçamento do mês (limite − consumo − reserva); áreas ignoradas; limite de 200 itens; contrato estrito (422); ETag; e
 * ZERO chamadas ao Copernicus em todas as rotas novas. A rota antiga da SAT-01 responde como antes.
 */

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });
/** 0,01° em -15,6°: ≈ 1.072 m × 1.106 m — analisável na grade de 10 m. */
const POLIGONO = quadrado(-56.1, -15.6, 0.01);
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-sat02", COPERNICUS_CLIENT_SECRET: "segredo-falso-sat02" };

const PERIODO_DATA: PeriodoConsulta = { tipo: "data", data: "2026-08-15", tolerancia_dias: 5 };
const PERIODO_MENSAL: PeriodoConsulta = { tipo: "intervalo", de: "2026-01-01", ate: "2026-03-31", cadencia: "mensal" };
const hoje = () => new Date().toISOString().slice(0, 10);
const diaMais = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const PIXELS_BBOX = (() => { const g = planejarGrade(lerPoligono(POLIGONO)!, RESOLUCAO_PADRAO_M); return g.larguraPx * g.alturaPx; })();
/** A estimativa que a rota TEM de devolver: a soma, item a item, da função do domínio sobre a caixa da grade. */
const estimativaEsperada = (nAreas: number, periodo: PeriodoConsulta): FaixaCreditos =>
  somarFaixas(Array.from({ length: nAreas }).flatMap(() => slotsDoPeriodo(periodo, hoje()).map((slot) => estimarCreditosItem({ pixelsBbox: PIXELS_BBOX, indice: "ndvi", slot }))));

type Alvo = { tipo: "areas"; area_ids: string[] } | { tipo: "todas" } | { tipo: "retiro"; retiro_id: string };
const areasAlvo = (...ids: string[]): Alvo => ({ tipo: "areas", area_ids: ids });
const TODAS: Alvo = { tipo: "todas" };
const pedido = (alvo: Alvo, periodo: PeriodoConsulta = PERIODO_DATA, confirmar = false) => ({ alvo, periodo, indices: ["ndvi"], confirmar });

interface Faixa { minimo: string; maximo: string }
interface Ignorada { area_id: string; nome: string; motivo: string }
interface Previa {
  total_itens: number; reaproveitados: number; novos: number; estimativa_creditos: Faixa; saldo_creditos_mes: string | null;
  excede_orcamento: boolean; empresa_id: string; areas_ignoradas: Ignorada[];
}
interface ConsultaDto {
  id: string; empresa_id: string; situacao: string; parametros: unknown; estimativa_creditos: Faixa; total_itens: number; total_concluidos: number;
  total_falhos: number; total_reaproveitados: number; criado_por: string; criado_em: string; concluida_em: string | null;
}
interface ItemDto {
  id: string; area_id: string; indice_bundle: string; versao_metodo: string; data_alvo: string | null; janela_inicio: string; janela_fim: string;
  situacao: string; tentativas: number; proxima_tentativa_em: string | null; erro: string | null; analise_id: string | null; pu_gasto: string | null; criado_em: string;
}
interface Criada { consulta: ConsultaDto; total_itens: number; reaproveitados: number; novos: number; estimativa_creditos: Faixa; saldo_creditos_mes: string | null; areas_ignoradas: Ignorada[] }
interface Detalhe { consulta: ConsultaDto; itens: ItemDto[]; pagina: number; tamanho: number; tem_mais: boolean }
interface Historico { itens: ConsultaDto[]; pagina: number; tamanho: number; tem_mais: boolean }
interface Erro { error: { code: string; message: string; details?: unknown } }
const j = <T>(r: { json: () => unknown }) => r.json() as T;

let h: Harness;
let admin: Db;
let api: FastifyInstance;
let A = ""; let B = ""; let C = "";
const area: Record<string, string> = {};
const retiro: Record<string, string> = {};
let consultaOutraOrg = "";
let soB: Record<string, string> = {}; let soMapa: Record<string, string> = {};

/**
 * O provedor das rotas NOVAS: qualquer chamada é registrada e falha. Toda requisição às rotas novas passa por
 * `novaRota`, que confere ZERO chamadas depois de cada resposta (e conta as requisições: a prova não é vazia).
 */
const chamadasCopernicus: string[] = [];
const buscarProibido: BuscarFn = async (url) => { chamadasCopernicus.push(new URL(url).host); throw new Error("SAT-02: rota nova chamou provedor externo"); };
let requisicoesNovas = 0;
async function novaRota(metodo: "GET" | "POST", caminho: string, headers: Record<string, string>, payload?: unknown) {
  const r = await api.inject({ method: metodo, url: caminho, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
  requisicoesNovas++;
  expect(chamadasCopernicus, `${metodo} ${caminho} chamou o provedor`).toEqual([]);
  return r;
}
const consultar = (payload: unknown, headers = h.headers(), query = "") => novaRota("POST", `/api/satelite/consultas${query}`, headers, payload);
const ler = (caminho: string, headers = h.headers()) => novaRota("GET", caminho, headers);
const detalhe = (id: string, query = "", headers = h.headers()) => ler(`/api/satelite/consultas/${id}${query}`, headers);
const historico = (query = "", headers = h.headers()) => ler(`/api/satelite/consultas${query}`, headers);

const TABELAS_SATELITE = ["satelite_consultas", "satelite_consulta_itens", "satelite_consumo", "satelite_orcamentos"] as const;
async function contagens(): Promise<Record<string, number>> {
  const r = await admin.query(`select ${TABELAS_SATELITE.map((t) => `(select count(*) from erp.${t})::int as ${t}`).join(", ")}`);
  return r.rows[0] as Record<string, number>;
}
/** Chaves com MAIS de um item vivo (pendente/executando/concluído) — tem de ser sempre vazio. */
async function chavesVivasDuplicadas() {
  return (await admin.query("select chave_idempotencia from erp.satelite_consulta_itens where situacao in ('pendente','executando','concluido') group by 1 having count(*) > 1")).rows;
}
async function itensDaConsulta(consultaId: string) {
  return (await admin.query<{ id: string; area_id: string; situacao: string; chave_idempotencia: string; chave_idempotencia_origem: string; geometria_sha256: string;
    indice_bundle: string; versao_metodo: string; data_alvo: string | null; janela_inicio: string; janela_fim: string; organization_id: string; empresa_id: string }>(
    "select * from erp.satelite_consulta_itens where consulta_id=$1 order by created_at, id", [consultaId])).rows;
}

/** Os textos SQL que a API mandou ao banco enquanto `fn` rodava (espião em pg.Client.prototype.query). */
async function comEspiao<T>(fn: () => Promise<T>): Promise<{ resultado: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const resultado = await fn();
    const sqls = espiao.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : (c[0] as { text?: string } | undefined)?.text ?? ""));
    return { resultado, sqls };
  } finally { espiao.mockRestore(); }
}
const escritasSatelite = (sqls: string[]) => sqls.filter((s) => /\b(insert\s+into|update|delete\s+from|truncate)\s+erp\.satelite_/i.test(s));

async function novaArea(empresa: string, code: string, geometria: unknown, opts: { org?: string; retiro?: string } = {}) {
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria, retiro_id)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5,$6) returning id`,
    [opts.org ?? h.demo.orgId, empresa, code, `[TEST] ${code}`, geometria === null ? null : JSON.stringify(geometria), opts.retiro ?? null]);
  return r.rows[0]!.id;
}
/** Área com contorno FORA do formato. O gatilho da 0051 recusaria; a gravação passa por fora dele (só no teste). */
async function areaForaDoFormato(empresa: string, code: string) {
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    const r = await c.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`,
      [h.demo.orgId, empresa, code, `[TEST] ${code}`, JSON.stringify({ type: "Point", coordinates: [-56.1, -15.6] })]);
    await c.query("commit");
    return r.rows[0]!.id;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
async function novoRetiro(empresa: string, code: string, org?: string) {
  return (await admin.query<{ id: string }>("insert into erp.retiros (organization_id, empresa_id, code, name) values ($1,$2,$3,$4) returning id",
    [org ?? h.demo.orgId, empresa, code, `[TEST] Retiro ${code}`])).rows[0]!.id;
}

async function membro(nome: string, email: string, escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]): Promise<Record<string, string>> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: ["analises_satelitais.view", "analises_satelitais.create"] } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Sat02@12345", role_id: j<{ id: string }>(papel).id, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Sat02@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j<{ token: string }>(login).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  C = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 93, '[TEST] Empresa orçamento SAT-02') returning id", [h.demo.orgId])).rows[0]!.id;
  api = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno: buscarProibido });
  retiro["A"] = await novoRetiro(A, "SAT02-RA");
  retiro["B"] = await novoRetiro(B, "SAT02-RB");
  for (const [nome, empresa, geo] of [
    ["a1", A, POLIGONO], ["a2", A, POLIGONO], ["a3", A, POLIGONO], ["a4", A, POLIGONO], ["etag", A, POLIGONO],
    ["lim1", A, POLIGONO], ["lim2", A, POLIGONO], ["lim3", A, POLIGONO],
    ["semContorno", A, null], ["pequena", A, quadrado(-56.3, -15.6, 0.0002)], ["grande", A, quadrado(-57, -16, 0.5)], ["excluida", A, POLIGONO],
    ["b1", B, POLIGONO], ["c1", C, POLIGONO], ["legado", A, POLIGONO]
  ] as const) area[nome] = await novaArea(empresa, `SAT02-${nome}`, geo);
  area["foraDoFormato"] = await areaForaDoFormato(A, "SAT02-foraDoFormato");
  area["ra1"] = await novaArea(A, "SAT02-ra1", POLIGONO, { retiro: retiro["A"] });
  area["ra2"] = await novaArea(A, "SAT02-ra2", POLIGONO, { retiro: retiro["A"] });
  area["b2"] = await novaArea(B, "SAT02-b2", POLIGONO, { retiro: retiro["B"] });
  await admin.query("update erp.areas set deleted_at = now() where id=$1", [area["excluida"]]);

  const outraOrg = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT-02','outra-sat02') returning id")).rows[0]!.id;
  const empresaOutra = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 95, '[TEST] Empresa outra org SAT-02') returning id", [outraOrg])).rows[0]!.id;
  retiro["X"] = await novoRetiro(empresaOutra, "SAT02-RX", outraOrg);
  area["x1"] = await novaArea(empresaOutra, "SAT02-x1", POLIGONO, { org: outraOrg, retiro: retiro["X"] });
  consultaOutraOrg = (await admin.query<{ id: string }>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
     values ($1, $2, $3, '{}'::jsonb, 0, 0, 'pendente', 0) returning id`, [outraOrg, empresaOutra, h.demo.adminUserId])).rows[0]!.id;

  soB = await membro("SAT-02 só B", "sat02-so-b@demo.local", [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
  soMapa = await membro("SAT-02 só mapa", "sat02-so-mapa@demo.local", [{ modulo: "mapa", modo: "todas", empresas: [] }]);
}, 180_000);

afterAll(async () => {
  await api?.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

let criada1: Criada;

describe("SAT-02 POST — prévia e criação", () => {
  it("prévia (confirmar=false): estimativa = soma do domínio item a item; NADA gravado (quatro tabelas iguais e nenhuma escrita em erp.satelite_*)", async () => {
    expect(slotsDoPeriodo(PERIODO_MENSAL, hoje()), "premissa: três meses").toHaveLength(3);
    const antes = await contagens();
    const { resultado: r, sqls } = await comEspiao(() => consultar(pedido(areasAlvo(area["a1"]!, area["a2"]!), PERIODO_MENSAL)));
    expect(r.statusCode, r.body).toBe(200);
    const esperado = estimativaEsperada(2, PERIODO_MENSAL);
    expect(D(esperado.maximo).gt(0), "premissa: a estimativa não é zero").toBe(true);
    expect(j<Previa>(r)).toEqual({
      total_itens: 6, reaproveitados: 0, novos: 6, estimativa_creditos: esperado, saldo_creditos_mes: null, excede_orcamento: false,
      empresa_id: A, areas_ignoradas: []
    });
    expect(await contagens()).toEqual(antes);
    expect(escritasSatelite(sqls)).toEqual([]);
    // premissa: o espião viu as leituras (a prova de "nenhuma escrita" não é vazia)
    expect(sqls.some((s) => /from erp\.satelite_consulta_itens i\b/.test(s)), "leu as chaves vivas").toBe(true);
    expect(sqls.some((s) => /from erp\.satelite_orcamentos o\b/.test(s)), "leu o orçamento").toBe(true);
  });

  it("criação (confirmar=true): 201; DTO exato; parametros = o corpo; itens pendentes com chave = sha256(origem do domínio); auditoria", async () => {
    const payload = pedido(areasAlvo(area["a1"]!, area["a2"]!), PERIODO_MENSAL, true);
    const r = await consultar(payload);
    expect(r.statusCode, r.body).toBe(201);
    criada1 = j<Criada>(r);
    const esperado = estimativaEsperada(2, PERIODO_MENSAL);
    expect(criada1).toEqual({
      consulta: {
        id: expect.any(String), empresa_id: A, situacao: "pendente", parametros: payload, estimativa_creditos: esperado,
        total_itens: 6, total_concluidos: 0, total_falhos: 0, total_reaproveitados: 0, criado_por: h.demo.adminUserId,
        criado_em: expect.any(String), concluida_em: null
      },
      total_itens: 6, reaproveitados: 0, novos: 6, estimativa_creditos: esperado, saldo_creditos_mes: null, areas_ignoradas: []
    });
    const itens = await itensDaConsulta(criada1.consulta.id);
    expect(itens).toHaveLength(6);
    const hash = (await admin.query<{ h: string }>("select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') h from erp.areas where id=$1", [area["a1"]])).rows[0]!.h;
    const slots = slotsDoPeriodo(PERIODO_MENSAL, hoje());
    for (const i of itens) {
      expect(i).toMatchObject({ situacao: "pendente", indice_bundle: "ndvi", versao_metodo: VERSAO_METODO_NDVI_V2, organization_id: h.demo.orgId, empresa_id: A, geometria_sha256: hash });
      const slot = slots.find((s) => s.janela_inicio === i.janela_inicio)!;
      expect({ data_alvo: i.data_alvo, janela_inicio: i.janela_inicio, janela_fim: i.janela_fim }).toEqual(slot);
      expect(i.chave_idempotencia_origem).toBe(origemChaveIdempotencia({ organizationId: h.demo.orgId, areaId: i.area_id, geometriaSha256: hash, indiceBundle: "ndvi", slot, versaoMetodo: VERSAO_METODO_NDVI_V2 }));
      expect(i.chave_idempotencia).toBe(createHash("sha256").update(i.chave_idempotencia_origem, "utf8").digest("hex"));
    }
    expect(new Set(itens.map((i) => `${i.area_id}|${i.janela_inicio}`)).size).toBe(6);
    const auditoria = await admin.query("select action from erp.audit_logs where entity='satelite_consultas' and entity_id=$1", [criada1.consulta.id]);
    expect(auditoria.rows).toEqual([{ action: "create" }]);
  });

  it("GET /:id devolve a mesma consulta e os itens no DTO do ERP", async () => {
    const r = await detalhe(criada1.consulta.id);
    expect(r.statusCode, r.body).toBe(200);
    const d = j<Detalhe>(r);
    expect(d.consulta).toEqual(criada1.consulta);
    expect(d).toMatchObject({ pagina: 1, tamanho: 50, tem_mais: false });
    expect(d.itens).toHaveLength(6);
    const banco = await itensDaConsulta(criada1.consulta.id);
    expect(d.itens.map((i) => i.id)).toEqual(banco.map((i) => i.id));
    expect(d.itens[0]).toEqual({
      id: banco[0]!.id, area_id: banco[0]!.area_id, indice_bundle: "ndvi", versao_metodo: VERSAO_METODO_NDVI_V2, data_alvo: banco[0]!.data_alvo,
      janela_inicio: banco[0]!.janela_inicio, janela_fim: banco[0]!.janela_fim, situacao: "pendente", tentativas: 0, proxima_tentativa_em: null,
      erro: null, analise_id: null, pu_gasto: null, criado_em: expect.any(String)
    });
  });

  it("idempotência: a MESMA consulta de novo → todos reaproveitados, estimativa 0; criada 'concluida'; um vivo por chave", async () => {
    const previa = j<Previa>(await consultar(pedido(areasAlvo(area["a1"]!, area["a2"]!), PERIODO_MENSAL)));
    expect(previa).toMatchObject({ total_itens: 6, reaproveitados: 6, novos: 0, estimativa_creditos: { minimo: "0.00", maximo: "0.00" } });
    const r = await consultar(pedido(areasAlvo(area["a1"]!, area["a2"]!), PERIODO_MENSAL, true));
    expect(r.statusCode, r.body).toBe(201);
    const segunda = j<Criada>(r);
    expect(segunda).toMatchObject({ total_itens: 6, reaproveitados: 6, novos: 0, estimativa_creditos: { minimo: "0.00", maximo: "0.00" } });
    expect(segunda.consulta).toMatchObject({ situacao: "concluida", total_reaproveitados: 6, estimativa_creditos: { minimo: "0.00", maximo: "0.00" } });
    expect(segunda.consulta.concluida_em).not.toBeNull();
    const itens = await itensDaConsulta(segunda.consulta.id);
    expect(itens.map((i) => i.situacao)).toEqual(Array(6).fill("reaproveitado"));
    const chaves = itens.map((i) => i.chave_idempotencia);
    const vivos = await admin.query<{ consulta_id: string }>("select consulta_id from erp.satelite_consulta_itens where chave_idempotencia = any($1) and situacao in ('pendente','executando','concluido')", [chaves]);
    expect(vivos.rows).toHaveLength(6);
    expect(new Set(vivos.rows.map((v) => v.consulta_id))).toEqual(new Set([criada1.consulta.id]));
    expect(await chavesVivasDuplicadas()).toEqual([]);
  });

  it("dois POST simultâneos idênticos: um vivo por chave; os novos somam o lote uma vez só", async () => {
    const periodo: PeriodoConsulta = { tipo: "intervalo", de: "2025-01-01", ate: "2025-02-28", cadencia: "mensal" };
    const payload = pedido(areasAlvo(area["a3"]!, area["a4"]!), periodo, true);
    const [r1, r2] = await Promise.all([consultar(payload), consultar(payload)]);
    expect([r1.statusCode, r2.statusCode], `${r1.body} || ${r2.body}`).toEqual([201, 201]);
    const [c1, c2] = [j<Criada>(r1), j<Criada>(r2)];
    expect(c1.novos + c2.novos).toBe(4);
    expect(c1.reaproveitados + c2.reaproveitados).toBe(4);
    expect([c1.consulta.situacao, c2.consulta.situacao].sort()).toEqual(["concluida", "pendente"]);
    const linhas = [...await itensDaConsulta(c1.consulta.id), ...await itensDaConsulta(c2.consulta.id)];
    expect(linhas).toHaveLength(8);
    const vivosPorChave = new Map<string, number>();
    for (const l of linhas) if (l.situacao === "pendente") vivosPorChave.set(l.chave_idempotencia, (vivosPorChave.get(l.chave_idempotencia) ?? 0) + 1);
    expect([...vivosPorChave.values()]).toEqual([1, 1, 1, 1]);
    expect(await chavesVivasDuplicadas()).toEqual([]);
  });

  it("item que PERDE a corrida (chave viva que a leitura do escopo não viu) → nasce reaproveitado; a consulta é ajustada; um vivo por chave", async () => {
    // A chave viva é gravada noutra empresa (B): o dono com A selecionada não a enxerga na leitura das chaves, planeja o
    // item como novo, e o índice único parcial recusa — exatamente o que acontece quando outra criação vence a corrida.
    const periodo: PeriodoConsulta = { tipo: "data", data: "2025-09-10", tolerancia_dias: 4 };
    const [slot] = slotsDoPeriodo(periodo, hoje());
    const hash = (await admin.query<{ h: string }>("select encode(sha256(convert_to(geometria::text, 'UTF8')), 'hex') h from erp.areas where id=$1", [area["a1"]])).rows[0]!.h;
    const origem = origemChaveIdempotencia({ organizationId: h.demo.orgId, areaId: area["a1"]!, geometriaSha256: hash, indiceBundle: "ndvi", slot: slot!, versaoMetodo: VERSAO_METODO_NDVI_V2 });
    const chave = createHash("sha256").update(origem, "utf8").digest("hex");
    const vencedora = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao, total_itens)
       values ($1, $2, $3, '{}'::jsonb, 0, 0, 'concluida', 1) returning id`, [h.demo.orgId, B, h.demo.adminUserId])).rows[0]!.id;
    await admin.query(
      `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
          data_alvo, janela_inicio, janela_fim, situacao, chave_idempotencia, chave_idempotencia_origem)
       values ($1, $2, $3, $4, $5, 'ndvi', $6, $7, $8, $9, 'concluido', $10, $11)`,
      [vencedora, h.demo.orgId, B, area["b1"], hash, VERSAO_METODO_NDVI_V2, slot!.data_alvo, slot!.janela_inicio, slot!.janela_fim, chave, origem]);
    const comA = h.headers({ "x-empresa-id": A });
    const previa = j<Previa>(await consultar(pedido(areasAlvo(area["a1"]!, area["a2"]!), periodo), comA));
    expect(previa, "premissa: a leitura do escopo não vê a chave viva de B").toMatchObject({ total_itens: 2, novos: 2, reaproveitados: 0 });
    const r = await consultar(pedido(areasAlvo(area["a1"]!, area["a2"]!), periodo, true), comA);
    expect(r.statusCode, r.body).toBe(201);
    const umItem = estimativaEsperada(1, periodo);
    expect(j<Criada>(r)).toMatchObject({ total_itens: 2, novos: 1, reaproveitados: 1, estimativa_creditos: umItem });
    expect(j<Criada>(r).consulta).toMatchObject({ situacao: "pendente", total_itens: 2, total_reaproveitados: 1, estimativa_creditos: umItem });
    const itens = await itensDaConsulta(j<Criada>(r).consulta.id);
    expect(itens.map((i) => [i.area_id, i.situacao]).sort()).toEqual([[area["a1"], "reaproveitado"], [area["a2"], "pendente"]].sort());
    expect(itens.find((i) => i.area_id === area["a1"])!.chave_idempotencia).toBe(chave);
    const banco = (await admin.query("select estimativa_creditos::text e, total_reaproveitados from erp.satelite_consultas where id=$1", [j<Criada>(r).consulta.id])).rows[0];
    expect(banco).toEqual({ e: umItem.maximo, total_reaproveitados: 1 });
    expect(await chavesVivasDuplicadas()).toEqual([]);
  });
});

describe("SAT-02 POST — alvo e áreas ignoradas", () => {
  it("sem contorno, fora do formato, pequena e grande: não viram item e voltam em areas_ignoradas com o motivo da SAT-01", async () => {
    const forma = await admin.query<{ ok: boolean }>("select erp.mapa_area_geometria_valida(geometria) ok from erp.areas where id=$1", [area["foraDoFormato"]]);
    expect(forma.rows[0]!.ok, "premissa: o contorno está mesmo fora do formato").toBe(false);
    const alvo = areasAlvo(area["a1"]!, area["semContorno"]!, area["foraDoFormato"]!, area["pequena"]!, area["grande"]!);
    const r = await consultar(pedido(alvo, PERIODO_DATA));
    expect(r.statusCode, r.body).toBe(200);
    const p = j<Previa>(r);
    expect(p).toMatchObject({ total_itens: 1, novos: 1, empresa_id: A });
    const porId = (l: Ignorada[]) => [...l].sort((x, y) => x.area_id.localeCompare(y.area_id));
    expect(porId(p.areas_ignoradas)).toEqual(porId([
      { area_id: area["semContorno"]!, nome: "[TEST] SAT02-semContorno", motivo: MSG_AREA_SEM_POLIGONO },
      { area_id: area["foraDoFormato"]!, nome: "[TEST] SAT02-foraDoFormato", motivo: MSG_POLIGONO_FORA_DO_FORMATO },
      { area_id: area["pequena"]!, nome: "[TEST] SAT02-pequena", motivo: MSG_AREA_PEQUENA },
      { area_id: area["grande"]!, nome: "[TEST] SAT02-grande", motivo: MSG_AREA_GRANDE }
    ]));
    const criada = await consultar(pedido(alvo, PERIODO_DATA, true));
    expect(criada.statusCode, criada.body).toBe(201);
    expect(j<Criada>(criada).areas_ignoradas).toHaveLength(4);
    expect((await itensDaConsulta(j<Criada>(criada).consulta.id)).map((i) => i.area_id)).toEqual([area["a1"]]);
  });

  it("só áreas ignoradas → 422 com as ignoradas nos detalhes; nada gravado", async () => {
    const antes = await contagens();
    const r = await consultar(pedido(areasAlvo(area["semContorno"]!, area["pequena"]!), PERIODO_DATA, true));
    expect(r.statusCode, r.body).toBe(422);
    const e = j<Erro>(r).error;
    expect(e).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_NENHUMA_AREA_ANALISAVEL });
    expect((e.details as { areas_ignoradas: Ignorada[] }).areas_ignoradas.map((i) => i.area_id).sort()).toEqual([area["semContorno"], area["pequena"]].sort());
    expect(await contagens()).toEqual(antes);
  });

  it("áreas de duas empresas → 422 pedindo a empresa; 'todas' do dono sem X-Empresa-Id também; nada gravado", async () => {
    const antes = await contagens();
    for (const alvo of [areasAlvo(area["a1"]!, area["b1"]!), TODAS]) {
      const r = await consultar(pedido(alvo, PERIODO_DATA, true));
      expect(r.statusCode, r.body).toBe(422);
      expect(j<Erro>(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_VARIAS_EMPRESAS });
    }
    expect(await contagens()).toEqual(antes);
  });

  it("alvo retiro: só as áreas daquele retiro; retiro inexistente ou de outra organização → a mesma 404", async () => {
    const r = await consultar(pedido({ tipo: "retiro", retiro_id: retiro["A"]! }, PERIODO_DATA, true));
    expect(r.statusCode, r.body).toBe(201);
    expect(j<Criada>(r)).toMatchObject({ total_itens: 2, consulta: { empresa_id: A } });
    expect((await itensDaConsulta(j<Criada>(r).consulta.id)).map((i) => i.area_id).sort()).toEqual([area["ra1"], area["ra2"]].sort());
    for (const id of [randomUUID(), retiro["X"]!]) {
      const n = await consultar(pedido({ tipo: "retiro", retiro_id: id }));
      expect(n.statusCode, n.body).toBe(404);
      expect(j<Erro>(n).error).toEqual({ code: "NOT_FOUND", message: MSG_RETIRO_NAO_ENCONTRADO });
    }
  });

  it("alvo todas com X-Empresa-Id B (dono): só as áreas de B — a seleção só diminui", async () => {
    const r = await consultar(pedido(TODAS), h.headers({ "x-empresa-id": B }));
    expect(r.statusCode, r.body).toBe(200);
    expect(j<Previa>(r)).toMatchObject({ empresa_id: B, total_itens: 2, areas_ignoradas: [] });
  });

  it("área excluída, inexistente ou misturada com uma válida → a MESMA 404 da SAT-01", async () => {
    for (const alvo of [areasAlvo(area["excluida"]!), areasAlvo(randomUUID()), areasAlvo(area["a1"]!, randomUUID())]) {
      const r = await consultar(pedido(alvo));
      expect(r.statusCode, r.body).toBe(404);
      expect(j<Erro>(r).error).toEqual({ code: "NOT_FOUND", message: MSG_AREA_NAO_ENCONTRADA });
    }
  });

  it("201 itens → 422 com a contagem na mensagem; exatamente 200 → aceito (prévia e criação com os 200 itens)", async () => {
    const p201: PeriodoConsulta = { tipo: "intervalo", de: "2024-01-01", ate: "2025-11-10", cadencia: "decendial" };
    const p200: PeriodoConsulta = { tipo: "intervalo", de: "2023-01-01", ate: "2025-10-10", cadencia: "decendial" };
    expect(slotsDoPeriodo(p201, hoje()), "premissa: 67 decêndios").toHaveLength(67);
    expect(slotsDoPeriodo(p200, hoje()), "premissa: 100 decêndios").toHaveLength(100);
    const antes = await contagens();
    const recusa = await consultar(pedido(areasAlvo(area["lim1"]!, area["lim2"]!, area["lim3"]!), p201, true));
    expect(recusa.statusCode, recusa.body).toBe(422);
    expect(j<Erro>(recusa).error).toMatchObject({ code: "VALIDATION_ERROR", message: msgItensDemais(201) });
    expect(j<Erro>(recusa).error.message).toContain("201");
    expect(await contagens()).toEqual(antes);
    const previa = await consultar(pedido(areasAlvo(area["lim1"]!, area["lim2"]!), p200));
    expect(previa.statusCode, previa.body).toBe(200);
    expect(j<Previa>(previa)).toMatchObject({ total_itens: 200, novos: 200 });
    const criada = await consultar(pedido(areasAlvo(area["lim1"]!, area["lim2"]!), p200, true));
    expect(criada.statusCode, criada.body).toBe(201);
    expect(await itensDaConsulta(j<Criada>(criada).consulta.id)).toHaveLength(200);
  });
});

describe("SAT-02 POST — orçamento do mês da empresa", () => {
  const mes = () => `${new Date().toISOString().slice(0, 7)}-01`;
  const P2: PeriodoConsulta = { tipo: "data", data: "2026-07-15", tolerancia_dias: 5 };
  const P3: PeriodoConsulta = { tipo: "data", data: "2026-06-15", tolerancia_dias: 5 };
  let reservaA = ""; let reservaB = ""; let consultaA = "";

  it("sem orçamento: saldo nulo, não excede, cria", async () => {
    const p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), PERIODO_DATA)));
    expect(p).toMatchObject({ empresa_id: C, saldo_creditos_mes: null, excede_orcamento: false, novos: 1 });
    const r = await consultar(pedido(areasAlvo(area["c1"]!), PERIODO_DATA, true));
    expect(r.statusCode, r.body).toBe(201);
    expect(j<Criada>(r).saldo_creditos_mes).toBeNull();
    reservaA = j<Criada>(r).consulta.estimativa_creditos.maximo;
    consultaA = j<Criada>(r).consulta.id;
    expect(D(reservaA).gt(0), "premissa: a consulta reserva crédito").toBe(true);
  });

  it("limite pequeno: a prévia avisa (excede_orcamento) e a criação recusa (422) sem gravar nada", async () => {
    await admin.query("insert into erp.satelite_orcamentos (organization_id, empresa_id, mes_referencia, limite_creditos) values ($1,$2,$3,'1.00')", [h.demo.orgId, C, mes()]);
    const p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P2)));
    expect(p.saldo_creditos_mes, "limite − reserva da consulta pendente do mês").toBe(D("1.00").minus(reservaA).toFixed(2));
    expect(p.excede_orcamento).toBe(true);
    const antes = await contagens();
    const r = await consultar(pedido(areasAlvo(area["c1"]!), P2, true));
    expect(r.statusCode, r.body).toBe(422);
    expect(j<Erro>(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_EXCEDE_ORCAMENTO });
    expect(await contagens()).toEqual(antes);
  });

  it("saldo = limite − consumo do mês − reserva das pendentes; consumo de outro mês e consulta cancelada não contam", async () => {
    await admin.query("update erp.satelite_orcamentos set limite_creditos='1000.00' where organization_id=$1 and empresa_id=$2", [h.demo.orgId, C]);
    await admin.query("insert into erp.satelite_consumo (organization_id, empresa_id, operacao, pu_gasto, creditos) values ($1,$2,'statistical',1,100)", [h.demo.orgId, C]);
    await admin.query("insert into erp.satelite_consumo (organization_id, empresa_id, operacao, pu_gasto, creditos, created_at) values ($1,$2,'statistical',5,500,'2020-01-15T12:00:00Z')", [h.demo.orgId, C]);
    let p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P2)));
    expect(p).toMatchObject({ saldo_creditos_mes: D("900.00").minus(reservaA).toFixed(2), excede_orcamento: false });
    const r = await consultar(pedido(areasAlvo(area["c1"]!), P2, true));
    expect(r.statusCode, r.body).toBe(201);
    expect(j<Criada>(r).saldo_creditos_mes).toBe(D("900.00").minus(reservaA).toFixed(2));
    reservaB = j<Criada>(r).consulta.estimativa_creditos.maximo;
    p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P3)));
    expect(p.saldo_creditos_mes, "a consulta recém-criada reserva").toBe(D("900.00").minus(reservaA).minus(reservaB).toFixed(2));
    await admin.query("update erp.satelite_consultas set situacao='cancelada', concluida_em=now() where id=$1", [consultaA]);
    p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P3)));
    expect(p.saldo_creditos_mes, "cancelada não reserva").toBe(D("900.00").minus(reservaB).toFixed(2));
  });

  it("saldo negativo: a consulta só de reaproveitados (custo 0) não excede e é criada; com custo novo, recusa", async () => {
    await admin.query("update erp.satelite_orcamentos set limite_creditos='0.01' where organization_id=$1 and empresa_id=$2", [h.demo.orgId, C]);
    // P2 já tem item vivo (consulta pendente do teste anterior): pedir de novo só reaproveita.
    const p = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P2)));
    expect(D(p.saldo_creditos_mes!).lt(0), "premissa: saldo do mês negativo").toBe(true);
    expect(p).toMatchObject({ novos: 0, reaproveitados: 1, estimativa_creditos: { minimo: "0.00", maximo: "0.00" }, excede_orcamento: false });
    const r = await consultar(pedido(areasAlvo(area["c1"]!), P2, true));
    expect(r.statusCode, r.body).toBe(201);
    expect(j<Criada>(r).consulta.situacao).toBe("concluida");
    const nova = j<Previa>(await consultar(pedido(areasAlvo(area["c1"]!), P3)));
    expect(nova).toMatchObject({ novos: 1, excede_orcamento: true });
  });
});

describe("SAT-02 — capacidade × escopo, a mesma 404", () => {
  let deB = "";
  it("outra organização: GET :id → 404 idêntica à de inexistente e malformado; a lista não mostra; POST com área ou retiro dela → 404", async () => {
    const respostas: string[] = [];
    for (const id of [consultaOutraOrg, randomUUID(), "nao-e-uuid"]) {
      const r = await detalhe(id);
      expect(r.statusCode, `${id}: ${r.body}`).toBe(404);
      respostas.push(r.body);
    }
    expect(new Set(respostas).size, respostas.join(" || ")).toBe(1);
    expect(j<Erro>({ json: () => JSON.parse(respostas[0]!) }).error).toEqual({ code: "NOT_FOUND", message: MSG_CONSULTA_NAO_ENCONTRADA });
    const lista = j<Historico>(await historico("?tamanho=100"));
    expect(lista.tem_mais, "premissa: a página tem tudo").toBe(false);
    expect(lista.itens.map((c) => c.id)).not.toContain(consultaOutraOrg);
    const area404 = await consultar(pedido(areasAlvo(area["x1"]!)));
    expect(area404.statusCode).toBe(404);
    expect(j<Erro>(area404).error).toEqual({ code: "NOT_FOUND", message: MSG_AREA_NAO_ENCONTRADA });
    const retiro404 = await consultar(pedido({ tipo: "retiro", retiro_id: retiro["X"]! }));
    expect(j<Erro>(retiro404).error).toEqual({ code: "NOT_FOUND", message: MSG_RETIRO_NAO_ENCONTRADO });
  });

  it("capacidade sem escopo no módulo da área (escopo só em `mapa`): lista VAZIA, GET :id 404, POST 'todas' → 422 sem áreas, nunca todas", async () => {
    const lista = await historico("", soMapa);
    expect(lista.statusCode, lista.body).toBe(200);
    expect(j<Historico>(lista)).toEqual({ itens: [], pagina: 1, tamanho: 20, tem_mais: false });
    const r = await detalhe(criada1.consulta.id, "", soMapa);
    expect(r.statusCode).toBe(404);
    expect(j<Erro>(r).error).toEqual({ code: "NOT_FOUND", message: MSG_CONSULTA_NAO_ENCONTRADA });
    const todas = await consultar(pedido(TODAS, PERIODO_DATA, true), soMapa);
    expect(todas.statusCode, todas.body).toBe(422);
    expect(j<Erro>(todas).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_ALVO_SEM_AREAS, details: { areas_ignoradas: [] } });
    expect((await consultar(pedido(areasAlvo(area["a1"]!)), soMapa)).statusCode).toBe(404);
  });

  it("escopo só na empresa B: cria só em B; a lista só tem B; a consulta de A é a MESMA 404; área e retiro de A → 404", async () => {
    const r = await consultar(pedido(TODAS, { tipo: "data", data: "2026-05-15", tolerancia_dias: 3 }, true), soB);
    expect(r.statusCode, r.body).toBe(201);
    const criada = j<Criada>(r);
    expect(criada).toMatchObject({ total_itens: 2, consulta: { empresa_id: B } });
    deB = criada.consulta.id;
    const lista = j<Historico>(await historico("?tamanho=100", soB));
    expect(lista.itens.length, "premissa: a lista não é vazia").toBeGreaterThan(0);
    expect(new Set(lista.itens.map((c) => c.empresa_id))).toEqual(new Set([B]));
    expect(lista.itens.map((c) => c.id)).toContain(deB);
    expect((await detalhe(deB, "", soB)).statusCode).toBe(200);
    const deA = await detalhe(criada1.consulta.id, "", soB);
    expect(deA.statusCode).toBe(404);
    expect(j<Erro>(deA).error).toEqual({ code: "NOT_FOUND", message: MSG_CONSULTA_NAO_ENCONTRADA });
    expect(j<Erro>(await consultar(pedido(areasAlvo(area["a1"]!)), soB)).error).toEqual({ code: "NOT_FOUND", message: MSG_AREA_NAO_ENCONTRADA });
    expect(j<Erro>(await consultar(pedido({ tipo: "retiro", retiro_id: retiro["A"]! }), soB)).error).toEqual({ code: "NOT_FOUND", message: MSG_RETIRO_NAO_ENCONTRADO });
  });

  it("X-Empresa-Id só diminui: o dono com B selecionada vê só B; empresa proibida → 403 em POST e GETs", async () => {
    const dono = h.headers({ "x-empresa-id": B });
    const lista = j<Historico>(await historico("?tamanho=100", dono));
    expect(new Set(lista.itens.map((c) => c.empresa_id))).toEqual(new Set([B]));
    expect((await detalhe(criada1.consulta.id, "", dono)).statusCode).toBe(404);
    expect((await consultar(pedido(areasAlvo(area["a1"]!)), dono)).statusCode).toBe(404);
    const proibida = { ...soB, "x-empresa-id": A };
    for (const r of [await consultar(pedido(TODAS), proibida), await historico("", proibida), await detalhe(deB, "", proibida)]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(j<Erro>(r).error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("sem a capacidade (operador): 403 em POST e nos GETs, antes de olhar qualquer dado", async () => {
    for (const r of [await consultar(pedido(areasAlvo(area["a1"]!)), h.opHeaders()), await historico("", h.opHeaders()),
      await detalhe(criada1.consulta.id, "", h.opHeaders()), await detalhe(randomUUID(), "", h.opHeaders())]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(j<Erro>(r).error.code).toBe("PERMISSION_DENIED");
    }
  });

  describe("o escopo de empresa está em CADA ocorrência de tabela de CADA consulta SQL (usuário com escopo selecionado)", () => {
    const ESCOPADAS = new Set(["areas", "retiros", "satelite_consultas", "satelite_consulta_itens", "satelite_consumo", "satelite_orcamentos"]);
    /** Para cada SQL: cada `from|join|update erp.<tabela> <alias>` tem o seu `me.empresa_id=<alias>.empresa_id`. Devolve o total. */
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
    const casos: { nome: string; ocorrencias: number; chamar: () => Promise<{ statusCode: number; body: string }> }[] = [
      // áreas (1) + chaves vivas (1) + orçamento, consumo e reserva (3)
      { nome: "POST prévia, alvo áreas", ocorrencias: 5, chamar: () => consultar(pedido(areasAlvo(area["b1"]!), PERIODO_DATA), soB) },
      { nome: "POST criação, alvo todas", ocorrencias: 5, chamar: () => consultar(pedido(TODAS, { tipo: "data", data: "2026-04-15", tolerancia_dias: 2 }, true), soB) },
      // + o retiro (1)
      { nome: "POST prévia, alvo retiro", ocorrencias: 6, chamar: () => consultar(pedido({ tipo: "retiro", retiro_id: retiro["B"]! }, PERIODO_DATA), soB) },
      // consulta (1) + itens (1)
      { nome: "GET /:id", ocorrencias: 2, chamar: () => detalhe(deB, "", soB) },
      { nome: "GET lista", ocorrencias: 1, chamar: () => historico("", soB) }
    ];
    for (const c of casos) {
      it(`${c.nome}: ${c.ocorrencias} ocorrência(s) de tabela com empresa, todas com o predicado`, async () => {
        const { resultado: r, sqls } = await comEspiao(c.chamar);
        expect([200, 201], r.body).toContain(r.statusCode);
        expect(conferirEscopo(sqls)).toBe(c.ocorrencias);
      });
    }
  });
});

describe("SAT-02 — contrato estrito (422, nunca descartado)", () => {
  const base = () => pedido(areasAlvo(area["a1"]!), PERIODO_DATA, true);
  it("chave desconhecida no corpo e nos sub-objetos, índice desconhecido, listas inválidas, tipos errados → 422; nada gravado", async () => {
    const b = base();
    const corpos: unknown[] = [
      { ...b, extra: 1 }, { ...b, empresa_id: B }, { ...b, geometria: POLIGONO },
      { ...b, alvo: { tipo: "areas", area_ids: [area["a1"]], empresa_id: B } }, { ...b, alvo: { tipo: "todas", area_ids: [area["a1"]] } },
      { ...b, alvo: { tipo: "outro" } }, { ...b, alvo: { tipo: "areas", area_ids: [] } }, { ...b, alvo: { tipo: "areas", area_ids: [area["a1"], area["a1"]] } },
      { ...b, alvo: { tipo: "areas", area_ids: ["nao-e-uuid"] } }, { ...b, alvo: { tipo: "areas", area_ids: [area["a1"]!.toUpperCase()] } },
      { ...b, alvo: { tipo: "areas", area_ids: Array.from({ length: 201 }, () => randomUUID()) } }, { ...b, alvo: { tipo: "retiro" } },
      { ...b, periodo: { ...PERIODO_DATA, extra: 1 } }, { ...b, periodo: { tipo: "semanal" } }, { ...b, periodo: { tipo: "mais_recente", janela_dias: 2.5 } },
      { ...b, periodo: { tipo: "mais_recente", janela_dias: "30" } }, { ...b, periodo: { tipo: "data", data: "2026-8-15", tolerancia_dias: 5 } },
      { ...b, periodo: { tipo: "intervalo", de: "2026-01-01", ate: "2026-02-01", cadencia: "semanal" } },
      { ...b, indices: ["evi"] }, { ...b, indices: [] }, { ...b, indices: ["ndvi", "ndvi"] }, { ...b, indices: "ndvi" },
      { alvo: b.alvo, periodo: b.periodo, indices: b.indices }, { ...b, confirmar: "true" }
    ];
    const antes = await contagens();
    for (const corpo of corpos) {
      const r = await consultar(corpo);
      expect(r.statusCode, `${JSON.stringify(corpo).slice(0, 200)}: ${r.body}`).toBe(422);
      expect(j<Erro>(r).error.code).toBe("VALIDATION_ERROR");
    }
    for (const q of [`?empresa_id=${B}`, "?confirmar=true"]) {
      const r = await consultar(base(), h.headers(), q);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(422);
    }
    expect(await contagens()).toEqual(antes);
  });

  it("período inválido (futuro, antes de 2017-03-28, de > ate, calendário, faixas) → 422 com o campo", async () => {
    const casos: [PeriodoConsulta, RegExp][] = [
      [{ tipo: "data", data: diaMais(10), tolerancia_dias: 5 }, /data$/],
      [{ tipo: "data", data: "2017-03-27", tolerancia_dias: 5 }, /data$/],
      [{ tipo: "data", data: "2026-02-30", tolerancia_dias: 5 }, /data$/],
      [{ tipo: "data", data: "2026-08-15", tolerancia_dias: 31 }, /tolerancia_dias$/],
      [{ tipo: "data", data: "2026-08-15", tolerancia_dias: -1 }, /tolerancia_dias$/],
      [{ tipo: "intervalo", de: "2026-03-01", ate: "2026-02-01", cadencia: "mensal" }, /(de|ate)$/],
      [{ tipo: "intervalo", de: "2026-01-01", ate: diaMais(40), cadencia: "mensal" }, /ate$/],
      [{ tipo: "intervalo", de: "2017-01-01", ate: "2017-06-30", cadencia: "mensal" }, /de$/],
      [{ tipo: "mais_recente", janela_dias: 0 }, /janela_dias$/],
      [{ tipo: "mais_recente", janela_dias: 91 }, /janela_dias$/]
    ];
    for (const [periodo, campo] of casos) {
      const r = await consultar(pedido(areasAlvo(area["a1"]!), periodo, true));
      expect(r.statusCode, `${JSON.stringify(periodo)}: ${r.body}`).toBe(422);
      const e = j<Erro>(r).error as { code: string; details: { path: string }[] };
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(e.details[0]!.path, JSON.stringify(periodo)).toMatch(campo);
    }
  });

  it("query dos GETs: chave desconhecida (inclusive empresa), tamanho fora de 1..100 e número fora da forma canônica → 422", async () => {
    const ruins = [`?empresa_id=${A}`, "?situacao=pendente", "?tamanho=0", "?tamanho=101", "?pagina=0",
      "?tamanho=1e2", "?pagina=0x2", "?tamanho=%203", "?tamanho=2.0", "?pagina=01", "?tamanho=-1", "?tamanho=1&tamanho=2"];
    for (const q of ruins) {
      for (const r of [await historico(q), await detalhe(criada1.consulta.id, q)]) {
        expect(r.statusCode, `${q}: ${r.body}`).toBe(422);
        expect(j<Erro>(r).error.code).toBe("VALIDATION_ERROR");
      }
    }
  });
});

describe("SAT-02 GET — ETag e paginação no servidor", () => {
  it("ETag fraco: If-None-Match igual → 304 sem corpo; muda quando a consulta ou um item muda; 404 nunca vira 304", async () => {
    const criada = await consultar(pedido(areasAlvo(area["etag"]!), PERIODO_MENSAL, true));
    expect(criada.statusCode, criada.body).toBe(201);
    const id = j<Criada>(criada).consulta.id;
    const r1 = await detalhe(id);
    const etag = String(r1.headers["etag"]);
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(r1.headers["cache-control"]).toBe("private, no-cache");
    for (const inm of [etag, `W/"outra", ${etag}`, etag.replace(/^W\//, ""), "*"]) {
      const r = await detalhe(id, "", h.headers({ "if-none-match": inm }));
      expect(r.statusCode, inm).toBe(304);
      expect(r.body, inm).toBe("");
    }
    expect((await detalhe(id, "", h.headers({ "if-none-match": 'W/"outra"' }))).statusCode).toBe(200);
    const primeiroItem = (await itensDaConsulta(id))[0]!.id;
    await admin.query("update erp.satelite_consulta_itens set tentativas = 1 where id=$1", [primeiroItem]);
    const r2 = await detalhe(id, "", h.headers({ "if-none-match": etag }));
    expect(r2.statusCode, "o item mudou").toBe(200);
    expect(j<Detalhe>(r2).itens.find((i) => i.id === primeiroItem)!.tentativas).toBe(1);
    const etag2 = String(r2.headers["etag"]);
    expect(etag2).not.toBe(etag);
    await admin.query("update erp.satelite_consultas set situacao = 'executando' where id=$1", [id]);
    const r3 = await detalhe(id, "", h.headers({ "if-none-match": etag2 }));
    expect(r3.statusCode, "a consulta mudou").toBe(200);
    expect(j<Detalhe>(r3).consulta.situacao).toBe("executando");
    expect(String(r3.headers["etag"])).not.toBe(etag2);
    const outra = await detalhe(id, "?tamanho=1", h.headers({ "if-none-match": String(r3.headers["etag"]) }));
    expect(outra.statusCode, "outra página é outro corpo").toBe(200);
    for (const alvo of [consultaOutraOrg, randomUUID()]) expect((await detalhe(alvo, "", h.headers({ "if-none-match": "*" }))).statusCode).toBe(404);
  });

  it("itens paginados no servidor (created_at, id), com tem_mais", async () => {
    const banco = (await itensDaConsulta(criada1.consulta.id)).map((i) => i.id);
    const p1 = j<Detalhe>(await detalhe(criada1.consulta.id, "?tamanho=4"));
    expect(p1).toMatchObject({ pagina: 1, tamanho: 4, tem_mais: true });
    const p2 = j<Detalhe>(await detalhe(criada1.consulta.id, "?tamanho=4&pagina=2"));
    expect(p2).toMatchObject({ pagina: 2, tamanho: 4, tem_mais: false });
    expect([...p1.itens, ...p2.itens].map((i) => i.id)).toEqual(banco);
    expect(j<Detalhe>(await detalhe(criada1.consulta.id, "?tamanho=4&pagina=3")).itens).toEqual([]);
  });

  it("histórico do escopo paginado no servidor (created_at desc, id desc), com tem_mais", async () => {
    const banco = (await admin.query<{ id: string }>("select id from erp.satelite_consultas where organization_id=$1 order by created_at desc, id desc", [h.demo.orgId])).rows.map((l) => l.id);
    expect(banco.length, "premissa: várias páginas").toBeGreaterThan(6);
    const vistos: string[] = [];
    for (let pagina = 1; ; pagina++) {
      const p = j<Historico>(await historico(`?tamanho=3&pagina=${pagina}`));
      expect(p).toMatchObject({ pagina, tamanho: 3 });
      vistos.push(...p.itens.map((c) => c.id));
      if (!p.tem_mais) break;
    }
    expect(vistos).toEqual(banco);
    expect(j<Historico>(await historico())).toMatchObject({ pagina: 1, tamanho: 20, tem_mais: banco.length > 20 });
  });
});

describe("SAT-02 POST — sem N+1", () => {
  it("o número de comandos SQL não cresce com o lote (1 item × 18 itens)", async () => {
    const pequeno = await comEspiao(() => consultar(pedido(areasAlvo(area["a1"]!), { tipo: "data", data: "2024-05-05", tolerancia_dias: 2 }, true)));
    const grande = await comEspiao(() => consultar(pedido(areasAlvo(area["a2"]!, area["a3"]!, area["a4"]!), { tipo: "intervalo", de: "2024-01-01", ate: "2024-06-30", cadencia: "mensal" }, true)));
    expect(j<Criada>(pequeno.resultado).total_itens).toBe(1);
    expect(j<Criada>(grande.resultado).total_itens).toBe(18);
    const noErp = (sqls: string[]) => sqls.filter((s) => /\berp\./.test(s)).length;
    expect(noErp(grande.sqls), grande.sqls.map((s) => s.replace(/\s+/g, " ").slice(0, 80)).join(" || ")).toBe(noErp(pequeno.sqls));
    expect(grande.sqls.filter((s) => /insert\s+into\s+erp\.satelite_consulta_itens/i.test(s)), "um INSERT em lote para os itens").toHaveLength(1);
  });
});

describe("SAT-02 — a rota antiga da SAT-01 responde como antes", () => {
  const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
  const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
  const chamadasSat01: string[] = [];
  /** Provedor FALSO da SAT-01: token e uma estatística com um dia útil (nenhuma rede, nenhuma conta Copernicus). */
  const provedorFalso: BuscarFn = async (url, init) => {
    const host = new URL(url).host;
    chamadasSat01.push(host);
    const responder = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });
    if (host === TOKEN_HOST) return responder(200, { access_token: "token-falso-sat02", expires_in: 3600, token_type: "Bearer" });
    if (host !== API_HOST) throw new Error(`host inesperado: ${host}`);
    const corpo = JSON.parse(init.body ?? "{}") as { aggregation: { timeRange: { to: string } } };
    const fim = Date.parse(corpo.aggregation.timeRange.to) - 3 * 86_400_000;
    const stats = { min: 0.31, max: 0.88, mean: 0.72, stDev: 0.09, sampleCount: 13_000, noDataCount: 2_000 };
    return responder(200, { status: "OK", data: [{ interval: { from: new Date(fim - 86_400_000).toISOString(), to: new Date(fim).toISOString() }, outputs: { ndvi: { bands: { B0: { stats } } } } }] });
  };
  let ligada: FastifyInstance; let desligada: FastifyInstance;
  beforeAll(async () => {
    ligada = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno: provedorFalso });
    desligada = await buildApp({ config: configDeTeste({ ...CREDENCIAL_FALSA, COPERNICUS_ENABLED: "0" }), db: h.db, logger: false, buscarExterno: provedorFalso });
  });
  afterAll(async () => { await ligada?.close(); await desligada?.close(); });
  const pedirNdvi = (app: FastifyInstance) => app.inject({ method: "POST", url: `/api/mapa/areas/${area["legado"]}/analises-satelitais/ndvi`, headers: h.headers({ "content-type": "application/json" }), payload: {} });
  /** As chaves do DTO da SAT-01, como eram antes da SAT-02 (a 0053 acrescenta colunas que NÃO podem aparecer aqui). */
  const CHAVES_DTO = [
    "id", "area_id", "provedor", "colecao", "indice", "versao_metodo", "janela_inicio", "janela_fim", "resolucao_m", "situacao", "motivo_qualidade",
    "observacao_inicio", "observacao_fim", "valor_medio", "valor_minimo", "valor_maximo", "desvio_padrao", "pixels_amostra", "pixels_sem_dado",
    "pixels_validos", "pixels_geometria", "cobertura_valida", "do_poligono_atual", "criado_em"
  ].sort();

  it("POST {} → 201 com o DTO de sempre (chaves exatas, versão sat01-ndvi-v1); as colunas novas da 0053 ficam nulas; repetir → 200 reutilizada sem provedor", async () => {
    chamadasSat01.length = 0;
    const r = await pedirNdvi(ligada);
    expect(r.statusCode, r.body).toBe(201);
    const corpo = j<{ analise: Record<string, unknown>; reutilizada: boolean }>(r);
    expect(Object.keys(corpo).sort()).toEqual(["analise", "reutilizada"]);
    expect(Object.keys(corpo.analise).sort()).toEqual(CHAVES_DTO);
    expect(corpo).toMatchObject({ reutilizada: false, analise: { versao_metodo: "sat01-ndvi-v1", situacao: "concluida", valor_medio: "0.7200", area_id: area["legado"] } });
    expect(chamadasSat01).toContain(API_HOST);
    const linha = (await admin.query("select consulta_item_id, resolucao_nativa_m, evalscript_sha256 from erp.analises_satelitais where id=$1", [corpo.analise["id"]])).rows[0];
    expect(linha).toEqual({ consulta_item_id: null, resolucao_nativa_m: null, evalscript_sha256: null });
    chamadasSat01.length = 0;
    const deNovo = await pedirNdvi(ligada);
    expect(deNovo.statusCode, deNovo.body).toBe(200);
    expect(j(deNovo)).toEqual({ analise: corpo.analise, reutilizada: true });
    expect(chamadasSat01).toEqual([]);
  });

  it("integração desligada → 503 `desligada`, como antes", async () => {
    const r = await pedirNdvi(desligada);
    expect(r.statusCode, r.body).toBe(503);
    expect(j<Erro>(r).error).toMatchObject({ code: "CONSULTA_INDISPONIVEL", details: { motivo: "desligada" } });
  });
});

describe("SAT-02 — nenhuma rota nova chama o Copernicus", () => {
  it("zero chamadas ao provedor em todas as requisições às rotas novas (e foram muitas)", () => {
    expect(requisicoesNovas, "premissa: a suíte exercitou as rotas novas").toBeGreaterThan(80);
    expect(chamadasCopernicus).toEqual([]);
  });
});
