import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { D } from "@agro/shared";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { MSG_CONSULTA_CANCELADA, MSG_CONSULTA_NAO_ENCONTRADA, MSG_EXCEDE_ORCAMENTO } from "../../src/routes/satelite-consultas.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * SAT-03 (decisão 296) — `POST /api/satelite/consultas/:id/reprocessar-falhas`, de ponta a ponta sobre o banco real
 * (papel sem bypass de RLS). Prova: (6) só os 'falho' voltam (para 'pendente', rodada zerada, histórico mantido);
 * concluído, reaproveitado, pendente e em execução intactos; chave já viva noutro item → 'reaproveitado' (nenhum item
 * vivo duplicado, nem com duas chamadas ao mesmo tempo); contadores e situação recalculados; corpo e query estritos;
 * a MESMA 404 da SAT-02 (outra organização, inexistente, malformado, fora do escopo, empresa selecionada); 403 sem a
 * capacidade; nenhuma chamada ao provedor; com orçamento, reabrir que passa do saldo do mês → o 422 da criação e nada
 * muda. (10) o saldo da prévia da SAT-02 ignora a linha de consumo com crédito nulo.
 */

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });
const POLIGONO = quadrado(-56.1, -15.6, 0.01);
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-sat03r", COPERNICUS_CLIENT_SECRET: "segredo-falso-sat03r" };
const chamadasProvedor: string[] = [];
const buscarProibido: BuscarFn = async (url) => { chamadasProvedor.push(new URL(url).host); throw new Error("SAT-03: reprocessar chamou provedor externo"); };

let h: Harness;
let admin: Db;
let api: FastifyInstance;
let A = ""; let B = ""; let C = "";
const area: Record<string, string> = {};
let outraOrg = ""; let empresaOutra = ""; let areaOutra = "";
let soB: Record<string, string> = {}; let soVer: Record<string, string> = {};

interface ConsultaDto { id: string; situacao: string; total_itens: number; total_concluidos: number; total_falhos: number; total_reaproveitados: number; concluida_em: string | null; [k: string]: unknown }
interface Resposta { consulta: ConsultaDto; reprocessados: number; reaproveitados: number }
interface Erro { error: { code: string; message: string; details?: unknown } }
const j = <T>(r: { json: () => unknown }) => r.json() as T;
const url = (id: string) => `/api/satelite/consultas/${id}/reprocessar-falhas`;
const reprocessar = (id: string, headers = h.headers(), payload?: unknown, query = "") =>
  api.inject({ method: "POST", url: `${url(id)}${query}`, headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
const detalhe = (id: string, headers = h.headers()) => api.inject({ method: "GET", url: `/api/satelite/consultas/${id}`, headers });

async function novaArea(org: string, empresa: string, code: string) {
  return (await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`, [org, empresa, code, `[TEST] ${code}`, JSON.stringify(POLIGONO)])).rows[0]!.id;
}
async function novaConsulta(org: string, empresa: string, situacao: string, totais: { itens: number; concluidos?: number; falhos?: number; reaproveitados?: number }, estimativa = "10.00") {
  return (await admin.query<{ id: string }>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, situacao,
        total_itens, total_concluidos, total_falhos, total_reaproveitados, concluida_em)
     values ($1, $2, $3, '{}'::jsonb, $4, 0, $5::text, $6, $7, $8, $9, case when $5::text in ('concluida', 'concluida_com_falhas', 'cancelada') then now() - interval '1 hour' end)
     returning id`, [org, empresa, h.demo.adminUserId, estimativa, situacao, totais.itens, totais.concluidos ?? 0, totais.falhos ?? 0, totais.reaproveitados ?? 0])).rows[0]!.id;
}
let sequencia = 0;
/** Chave de 64 hex única por chamada (ou a dada, para provar a chave repetida). */
const chaveNova = () => (++sequencia).toString(16).padStart(64, "0");
interface Item { situacao: string; chave?: string; tentativas?: number; rodada?: number; erro?: string | null; proxima?: string | null; areaId?: string }
async function novoItem(consultaId: string, org: string, empresa: string, it: Item) {
  const chave = it.chave ?? chaveNova();
  return (await admin.query<{ id: string }>(
    `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
        janela_inicio, janela_fim, situacao, tentativas, tentativas_rodada, erro, proxima_tentativa_em, chave_idempotencia, chave_idempotencia_origem)
     values ($1, $2, $3, $4, repeat('b', 64), 'ndvi', 'ndvi-v2', '2026-08-01', '2026-08-10', $5, $6, $7, $8, $9::timestamptz, $10, $11) returning id`,
    [consultaId, org, empresa, it.areaId ?? (org === outraOrg ? areaOutra : empresa === B ? area["b1"] : empresa === C ? area["c1"] : area["a1"]), it.situacao,
      it.tentativas ?? 0, it.rodada ?? 0, it.erro ?? null, it.proxima ?? null, chave, `teste-sat03r-${chave.slice(-6)}`])).rows[0]!.id;
}
const COLUNAS_ITEM = "id, situacao, tentativas, tentativas_rodada, erro, proxima_tentativa_em, analise_id, pu_gasto, chave_idempotencia, updated_at";
const itens = async (consultaId: string) => (await admin.query(`select ${COLUNAS_ITEM} from erp.satelite_consulta_itens where consulta_id=$1 order by created_at, id`, [consultaId])).rows;
const porId = async (consultaId: string) => Object.fromEntries((await itens(consultaId)).map((l: { id: string }) => [l.id, l]));
const linhaConsulta = async (id: string) => (await admin.query("select * from erp.satelite_consultas where id=$1", [id])).rows[0];
/** Chaves com MAIS de um item vivo (pendente/executando/concluído) na organização — tem de ser sempre vazio. */
const chavesVivasDuplicadas = async () =>
  (await admin.query("select organization_id, chave_idempotencia from erp.satelite_consulta_itens where situacao in ('pendente','executando','concluido') group by 1, 2 having count(*) > 1")).rows;

async function membro(nome: string, email: string, permissoes: string[], escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]) {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Sat03@12345", role_id: j<{ id: string }>(papel).id, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Sat03@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j<{ token: string }>(login).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  C = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 94, '[TEST] Empresa saldo SAT-03') returning id", [h.demo.orgId])).rows[0]!.id;
  api = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno: buscarProibido });
  area["a1"] = await novaArea(h.demo.orgId, A, "SAT03R-a1");
  area["b1"] = await novaArea(h.demo.orgId, B, "SAT03R-b1");
  area["c1"] = await novaArea(h.demo.orgId, C, "SAT03R-c1");
  outraOrg = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra SAT-03R','outra-sat03r') returning id")).rows[0]!.id;
  empresaOutra = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 93, '[TEST] Empresa outra org SAT-03R') returning id", [outraOrg])).rows[0]!.id;
  areaOutra = await novaArea(outraOrg, empresaOutra, "SAT03R-x1");
  soB = await membro("SAT-03R só B", "sat03r-so-b@demo.local", ["analises_satelitais.view", "analises_satelitais.create"], [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
  soVer = await membro("SAT-03R só ver", "sat03r-so-ver@demo.local", ["analises_satelitais.view"], [{ modulo: "pecuaria", modo: "todas", empresas: [] }]);
}, 180_000);

afterAll(async () => {
  await api?.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
  expect(chamadasProvedor, "reprocessar nunca chama o provedor").toEqual([]);
});

describe("SAT-03 (6) reprocessar falhas — só os falhos voltam, sem duplicar", () => {
  it("concluida_com_falhas: falhos → pendente (rodada, erro e próxima zerados; tentativas = histórico); chave viva noutro item → reaproveitado; o resto intacto; contadores e situação recalculados", async () => {
    const outra = await novaConsulta(h.demo.orgId, A, "pendente", { itens: 1 });
    const chaveViva = chaveNova();
    const vivo = await novoItem(outra, h.demo.orgId, A, { situacao: "pendente", chave: chaveViva });
    const id = await novaConsulta(h.demo.orgId, A, "concluida_com_falhas", { itens: 5, concluidos: 1, falhos: 3, reaproveitados: 1 });
    const concluido = await novoItem(id, h.demo.orgId, A, { situacao: "concluido", tentativas: 1, rodada: 1 });
    const reaproveitado = await novoItem(id, h.demo.orgId, A, { situacao: "reaproveitado" });
    const falho1 = await novoItem(id, h.demo.orgId, A, { situacao: "falho", tentativas: 3, rodada: 3, erro: "indisponivel (HTTP 503)" });
    const falho2 = await novoItem(id, h.demo.orgId, A, { situacao: "falho", tentativas: 5, rodada: 2, erro: "erro_interno", proxima: "2026-12-01T00:00:00Z" });
    const falhoComChaveViva = await novoItem(id, h.demo.orgId, A, { situacao: "falho", chave: chaveViva, tentativas: 3, rodada: 3, erro: "limite (HTTP 429)" });
    const antes = await porId(id);
    const vivoAntes = (await porId(outra))[vivo];

    const r = await reprocessar(id);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j<Resposta>(r);
    expect(corpo.reprocessados).toBe(2);
    expect(corpo.reaproveitados).toBe(1);
    expect(Object.keys(corpo).sort()).toEqual(["consulta", "reaproveitados", "reprocessados"]);

    const depois = await porId(id);
    for (const [falho, tentativas] of [[falho1, 3], [falho2, 5]] as const) {
      expect(depois[falho], "falho → pendente").toMatchObject({ situacao: "pendente", tentativas, tentativas_rodada: 0, erro: null, proxima_tentativa_em: null });
    }
    expect(depois[falhoComChaveViva]).toMatchObject({ situacao: "reaproveitado", tentativas: 3, tentativas_rodada: 0, erro: null, proxima_tentativa_em: null });
    expect(depois[concluido], "concluído intacto").toEqual(antes[concluido]);
    expect(depois[reaproveitado], "reaproveitado intacto").toEqual(antes[reaproveitado]);
    expect((await porId(outra))[vivo], "o item vivo da outra consulta intacto").toEqual(vivoAntes);
    expect(await chavesVivasDuplicadas()).toEqual([]);

    // A consulta: o DTO da SAT-02 (o mesmo do GET), com contadores e situação derivados dos itens.
    expect(corpo.consulta).toStrictEqual(j<{ consulta: ConsultaDto }>(await detalhe(id)).consulta);
    expect(corpo.consulta).toMatchObject({ id, situacao: "executando", total_itens: 5, total_concluidos: 1, total_falhos: 0, total_reaproveitados: 2, concluida_em: null });
  });

  it("consulta em execução: pendente e executando intactos; o falho volta; a situação continua 'executando'", async () => {
    const id = await novaConsulta(h.demo.orgId, A, "executando", { itens: 4, concluidos: 1, falhos: 1 });
    const pendente = await novoItem(id, h.demo.orgId, A, { situacao: "pendente", tentativas: 1, rodada: 1, proxima: "2026-12-01T00:00:00Z", erro: "tempo" });
    const executando = await novoItem(id, h.demo.orgId, A, { situacao: "executando", tentativas: 2, rodada: 2, proxima: "2026-12-01T00:10:00Z" });
    const concluido = await novoItem(id, h.demo.orgId, A, { situacao: "concluido", tentativas: 1, rodada: 1 });
    const falho = await novoItem(id, h.demo.orgId, A, { situacao: "falho", tentativas: 3, rodada: 3, erro: "rede" });
    const antes = await porId(id);
    const r = await reprocessar(id, h.headers(), {});
    expect(r.statusCode, r.body).toBe(200);
    expect(j<Resposta>(r)).toMatchObject({ reprocessados: 1, reaproveitados: 0, consulta: { situacao: "executando", total_concluidos: 1, total_falhos: 0, total_reaproveitados: 0 } });
    const depois = await porId(id);
    for (const intacto of [pendente, executando, concluido]) expect(depois[intacto]).toEqual(antes[intacto]);
    expect(depois[falho]).toMatchObject({ situacao: "pendente", tentativas: 3, tentativas_rodada: 0, erro: null });
  });

  it("o MESMO pedido de outra consulta (chave repetida, as duas falhas): a primeira a reprocessar volta viva; a segunda vira reaproveitada", async () => {
    const chave = chaveNova();
    const c1 = await novaConsulta(h.demo.orgId, A, "concluida_com_falhas", { itens: 1, falhos: 1 });
    const c2 = await novaConsulta(h.demo.orgId, A, "concluida_com_falhas", { itens: 1, falhos: 1 });
    const i1 = await novoItem(c1, h.demo.orgId, A, { situacao: "falho", chave, tentativas: 3, rodada: 3, erro: "rede" });
    const i2 = await novoItem(c2, h.demo.orgId, A, { situacao: "falho", chave, tentativas: 3, rodada: 3, erro: "rede" });
    // o item já foi tentado antes (tentativas = histórico): a consulta volta como 'executando' (fechamento.ts)
    expect(j<Resposta>(await reprocessar(c1))).toMatchObject({ reprocessados: 1, reaproveitados: 0, consulta: { situacao: "executando", total_falhos: 0, concluida_em: null } });
    const r2 = await reprocessar(c2);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j<Resposta>(r2)).toMatchObject({ reprocessados: 0, reaproveitados: 1, consulta: { situacao: "concluida", total_falhos: 0, total_reaproveitados: 1 } });
    expect((await porId(c1))[i1]).toMatchObject({ situacao: "pendente" });
    expect((await porId(c2))[i2]).toMatchObject({ situacao: "reaproveitado" });
    expect(await chavesVivasDuplicadas()).toEqual([]);
  });

  it("duas chamadas AO MESMO TEMPO na mesma consulta: uma faz o trabalho, a outra encontra zero falhos; nada duplicado", async () => {
    const id = await novaConsulta(h.demo.orgId, A, "concluida_com_falhas", { itens: 3, falhos: 3 });
    for (let i = 0; i < 3; i++) await novoItem(id, h.demo.orgId, A, { situacao: "falho", tentativas: 3, rodada: 3, erro: "rede" });
    const [r1, r2] = await Promise.all([reprocessar(id), reprocessar(id)]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect([j<Resposta>(r1).reprocessados, j<Resposta>(r2).reprocessados].sort()).toEqual([0, 3]);
    expect((await itens(id)).map((l: { situacao: string }) => l.situacao)).toEqual(["pendente", "pendente", "pendente"]);
    expect(await chavesVivasDuplicadas()).toEqual([]);
  });

  it("sem falho nenhum: 200 com zero, e NADA é escrito (nem na consulta, nem nos itens)", async () => {
    const id = await novaConsulta(h.demo.orgId, A, "concluida", { itens: 1, concluidos: 1 });
    await novoItem(id, h.demo.orgId, A, { situacao: "concluido", tentativas: 1, rodada: 1 });
    const [consultaAntes, itensAntes] = [await linhaConsulta(id), await itens(id)];
    const r = await reprocessar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j<Resposta>(r)).toMatchObject({ reprocessados: 0, reaproveitados: 0, consulta: { id, situacao: "concluida" } });
    expect(await linhaConsulta(id)).toEqual(consultaAntes);
    expect(await itens(id)).toEqual(itensAntes);
  });

  it("consulta cancelada: 422, nada volta para a fila", async () => {
    const id = await novaConsulta(h.demo.orgId, A, "cancelada", { itens: 1, falhos: 1 });
    await novoItem(id, h.demo.orgId, A, { situacao: "falho", tentativas: 1, rodada: 1, erro: "rede" });
    const antes = await itens(id);
    const r = await reprocessar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j<Erro>(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_CONSULTA_CANCELADA });
    expect(await itens(id)).toEqual(antes);
  });
});

describe("SAT-03 reprocessar falhas — contrato estrito, a mesma 404, 403", () => {
  let deA = ""; let deB = ""; let daOutraOrg = "";
  let estado: { a: unknown[]; b: unknown[]; x: unknown[] };
  beforeAll(async () => {
    deA = await novaConsulta(h.demo.orgId, A, "concluida_com_falhas", { itens: 1, falhos: 1 });
    await novoItem(deA, h.demo.orgId, A, { situacao: "falho", tentativas: 1, rodada: 1, erro: "rede" });
    deB = await novaConsulta(h.demo.orgId, B, "concluida_com_falhas", { itens: 1, falhos: 1 });
    await novoItem(deB, h.demo.orgId, B, { situacao: "falho", tentativas: 1, rodada: 1, erro: "rede" });
    daOutraOrg = await novaConsulta(outraOrg, empresaOutra, "concluida_com_falhas", { itens: 1, falhos: 1 });
    await novoItem(daOutraOrg, outraOrg, empresaOutra, { situacao: "falho", tentativas: 1, rodada: 1, erro: "rede" });
    estado = { a: await itens(deA), b: await itens(deB), x: await itens(daOutraOrg) };
  });
  const nadaMudou = async () => expect({ a: await itens(deA), b: await itens(deB), x: await itens(daOutraOrg) }).toEqual(estado);

  it("corpo com chave, corpo que não é objeto, ou query desconhecida → 422; nada muda", async () => {
    for (const payload of [{ itens: ["x"] }, { confirmar: true }, [], "texto"]) {
      const r = await reprocessar(deA, h.headers(), payload);
      expect(r.statusCode, `${JSON.stringify(payload)}: ${r.body}`).toBe(422);
    }
    expect((await reprocessar(deA, h.headers(), undefined, "?empresa_id=x")).statusCode).toBe(422);
    expect((await reprocessar(deA, h.headers(), undefined, "?forcar=1")).statusCode).toBe(422);
    await nadaMudou();
  });

  it("outra organização, inexistente, malformado, fora do escopo e empresa selecionada fora: a MESMA 404 do GET da SAT-02; nada muda", async () => {
    const corpos = new Set<string>();
    const casos: [string, Record<string, string>][] = [
      [daOutraOrg, h.headers()], [randomUUID(), h.headers()], ["nao-e-uuid", h.headers()], ["00000000-0000-0000-0000-00000000000Z", h.headers()],
      [deA, soB], [deA, h.headers({ "x-empresa-id": B })]
    ];
    for (const [id, headers] of casos) {
      const r = await reprocessar(id, headers);
      expect(r.statusCode, `${id}: ${r.body}`).toBe(404);
      corpos.add(r.body);
      const g = await detalhe(id, headers);
      expect(g.statusCode, `GET ${id}`).toBe(404);
      corpos.add(g.body);
    }
    expect(corpos.size, [...corpos].join(" || ")).toBe(1);
    expect(JSON.parse([...corpos][0]!)).toEqual({ error: { code: "NOT_FOUND", message: MSG_CONSULTA_NAO_ENCONTRADA } });
    await nadaMudou();
  });

  it("sem `analises_satelitais.create` (só ver; operador): 403 antes de olhar a consulta — também para id inexistente; nada muda", async () => {
    for (const headers of [soVer, h.opHeaders()]) {
      for (const id of [deA, randomUUID(), "nao-e-uuid"]) {
        const r = await reprocessar(id, headers);
        expect(r.statusCode, `${id}: ${r.body}`).toBe(403);
        expect(j<Erro>(r).error.code).toBe("PERMISSION_DENIED");
      }
    }
    await nadaMudou();
  });

  it("empresa selecionada proibida para o usuário → 403; com escopo em B, reprocessa a consulta de B", async () => {
    const proibida = await reprocessar(deB, { ...soB, "x-empresa-id": A });
    expect(proibida.statusCode, proibida.body).toBe(403);
    await nadaMudou();
    const r = await reprocessar(deB, soB);
    expect(r.statusCode, r.body).toBe(200);
    expect(j<Resposta>(r)).toMatchObject({ reprocessados: 1, consulta: { id: deB, empresa_id: B } });
  });
});

const mes = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

describe("SAT-03 reprocessar falhas — barrado pelo saldo do mês (decisão do Maike)", () => {
  let D_ = ""; let areaD = "";
  beforeAll(async () => {
    D_ = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 92, '[TEST] Empresa orçamento reprocessar SAT-03') returning id", [h.demo.orgId])).rows[0]!.id;
    areaD = await novaArea(h.demo.orgId, D_, "SAT03R-d1");
  });
  const consumoDe = (consultaId: string | null, creditos: string) => admin.query(
    `insert into erp.satelite_consumo (organization_id, empresa_id, consulta_id, operacao, pu_gasto, creditos, origem_cabecalho)
     values ($1, $2, $3, 'statistical', $4::numeric / 100, $4, 'teste')`, [h.demo.orgId, D_, consultaId, creditos]);

  it("orçamento apertado: o que a consulta voltaria a reservar (estimativa − gasto dela) passa do saldo SEM ela → o 422 da criação e NADA muda; com folga, reabre", async () => {
    await admin.query("insert into erp.satelite_orcamentos (organization_id, empresa_id, mes_referencia, limite_creditos) values ($1,$2,$3,'20.00')", [h.demo.orgId, D_, mes()]);
    const id = await novaConsulta(h.demo.orgId, D_, "concluida_com_falhas", { itens: 2, concluidos: 1, falhos: 1 }, "30.00");
    await novoItem(id, h.demo.orgId, D_, { situacao: "concluido", tentativas: 1, rodada: 1, areaId: areaD });
    const falho = await novoItem(id, h.demo.orgId, D_, { situacao: "falho", tentativas: 3, rodada: 3, erro: "rede", areaId: areaD });
    await consumoDe(id, "5.00"); // a consulta já gastou 5.00 (no mês): voltaria a reservar 30 − 5 = 25; saldo sem ela = 20 − 5 = 15
    const [consultaAntes, itensAntes] = [await linhaConsulta(id), await itens(id)];
    const r = await reprocessar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j<Erro>(r).error).toEqual({ code: "VALIDATION_ERROR", message: MSG_EXCEDE_ORCAMENTO, details: { reserva_creditos: "25.00", saldo_creditos_mes: "15.00" } });
    expect(await linhaConsulta(id), "nenhum contador, nenhuma situação").toEqual(consultaAntes);
    expect(await itens(id), "nenhum item").toEqual(itensAntes);

    // Exatamente o saldo (25 ≤ 25) passa: o teto é "acima do saldo".
    await admin.query("update erp.satelite_orcamentos set limite_creditos='30.00' where organization_id=$1 and empresa_id=$2", [h.demo.orgId, D_]);
    const ok = await reprocessar(id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j<Resposta>(ok)).toMatchObject({ reprocessados: 1, reaproveitados: 0, consulta: { situacao: "executando", total_falhos: 0 } });
    expect((await porId(id))[falho]).toMatchObject({ situacao: "pendente", tentativas_rodada: 0 });
  });

  it("só reaproveitados (nada volta vivo) não reabre a consulta: passa mesmo sem saldo", async () => {
    await admin.query("update erp.satelite_orcamentos set limite_creditos='0.00' where organization_id=$1 and empresa_id=$2", [h.demo.orgId, D_]);
    const chave = chaveNova();
    const viva = await novaConsulta(h.demo.orgId, D_, "pendente", { itens: 1 }, "0.00");
    await novoItem(viva, h.demo.orgId, D_, { situacao: "pendente", chave, areaId: areaD });
    const id = await novaConsulta(h.demo.orgId, D_, "concluida_com_falhas", { itens: 1, falhos: 1 }, "50.00");
    await novoItem(id, h.demo.orgId, D_, { situacao: "falho", chave, tentativas: 3, rodada: 3, erro: "rede", areaId: areaD });
    const r = await reprocessar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j<Resposta>(r)).toMatchObject({ reprocessados: 0, reaproveitados: 1, consulta: { situacao: "concluida" } });
  });
});

describe("SAT-03 (10) — o saldo da prévia da SAT-02 ignora o consumo com crédito NULO", () => {
  const previa = async () => {
    const r = await api.inject({ method: "POST", url: "/api/satelite/consultas", headers: h.headers({ "content-type": "application/json" }),
      payload: JSON.stringify({ alvo: { tipo: "areas", area_ids: [area["c1"]] }, periodo: { tipo: "data", data: "2026-08-15", tolerancia_dias: 5 }, indices: ["ndvi"], confirmar: false }) });
    expect(r.statusCode, r.body).toBe(200);
    return j<{ saldo_creditos_mes: string | null }>(r).saldo_creditos_mes;
  };
  const consumo = (consultaId: string | null, pu: string | null, origem: string | null) => admin.query(
    `insert into erp.satelite_consumo (organization_id, empresa_id, consulta_id, operacao, pu_gasto, creditos, origem_cabecalho)
     values ($1, $2, $3, 'statistical', $4::numeric(14,4), round($4::numeric(14,4) * 100, 2), $5)`, [h.demo.orgId, C, consultaId, pu, origem]);

  it("linhas nulas no meio das preenchidas (no mês e na consulta em execução): o saldo é o mesmo de sem elas, e é a conta certa", async () => {
    await admin.query("insert into erp.satelite_orcamentos (organization_id, empresa_id, mes_referencia, limite_creditos) values ($1,$2,$3,'1000.00')", [h.demo.orgId, C, mes()]);
    const executando = await novaConsulta(h.demo.orgId, C, "executando", { itens: 1 }, "40.00");
    await consumo(null, "0.10", "0.10");      // 10.00 no mês
    await consumo(executando, "0.15", "0.15"); // 15.00 da consulta em execução (reserva = 40 − 15)
    const semNulas = await previa();
    // limite − consumo do mês (10 + 15) − reserva (max(40 − 15, 0))
    expect(semNulas).toBe(D("1000.00").minus("25.00").minus("25.00").toFixed(2));
    await consumo(null, null, "cabecalho_ausente");
    await consumo(executando, null, "cabecalho_invalido");
    await consumo(null, "0.05", "0.05");      // +5.00 depois das nulas
    const comNulas = await previa();
    expect(D(comNulas!).toFixed(2), "as nulas não mexem no saldo; a de 5.00 depois delas, sim").toBe(D(semNulas!).minus("5.00").toFixed(2));
    const nulas = await admin.query<{ n: number }>("select count(*)::int as n from erp.satelite_consumo where empresa_id=$1 and creditos is null", [C]);
    expect(nulas.rows[0]!.n, "premissa: as linhas nulas existem").toBe(2);
    // Só nulas na consulta: a reserva dela continua a estimativa inteira (nulo não vira gasto).
    const soNulas = await novaConsulta(h.demo.orgId, C, "pendente", { itens: 1 }, "7.00");
    await consumo(soNulas, null, "cabecalho_ausente");
    expect(await previa()).toBe(D(comNulas!).minus("7.00").toFixed(2));
  });
});
