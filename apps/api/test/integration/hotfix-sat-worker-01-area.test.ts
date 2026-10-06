import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createPool, withTx, type Db } from "@agro/db";
import type { PeriodoConsulta } from "@agro/domain";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ClienteCopernicus, ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { MODULO_EXECUTOR } from "../../src/lib/satelite/contexto-worker.js";
import {
  conferirAreaAposReserva, ERROS_ITEM, executarItem, type ItemReservado, type LogSatelite
} from "../../src/lib/satelite/executar-item.js";
import { LimiteAvulsoSatelite } from "../../src/lib/satelite/limite-avulso.js";
import type { LimitesSatelite } from "../../src/lib/satelite/limites.js";
import { WorkerSatelite } from "../../src/lib/satelite/worker.js";
import { TEST_URL, configDeTeste, harness, type Harness } from "./setup.js";

/**
 * HOTFIX-SAT-WORKER-01 — contrato reserva → execução e escopos.
 * Prova: o que a reserva devolve é legível por `lerArea` no mesmo MODULO_EXECUTOR;
 * área deletada / sem acesso / org outra NÃO são reservadas (ou falham coerente, sem divergência).
 */

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
const ID_FALSO = "id-falso-hotfix-area";
const SEGREDO_FALSO = "segredo-falso-hotfix-area";
const TOKEN_FALSO = "token-falso-hotfix-area";
const CREDENCIAL_FALSA = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: ID_FALSO, COPERNICUS_CLIENT_SECRET: SEGREDO_FALSO };
const SEM_TETO: LimitesSatelite = { simultaneas: 1000, porMinutoConta: 100_000, porMinutoOrganizacao: 100_000 };
const VAZIO = { orgId: null, userId: null, modulo: null };
const RECENTE: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 10 };
const UTIL = { min: 0.31, max: 0.88, mean: 0.72, stDev: 0.09, sampleCount: 13_000, noDataCount: 2_000 };

const log: LogSatelite = { info: () => {}, warn: () => {}, error: () => {} };
const buscarMock: BuscarFn = async (url, init) => {
  const host = new URL(url).host;
  if (host === TOKEN_HOST) {
    return { status: 200, headers: { get: () => null }, json: async () => ({ access_token: TOKEN_FALSO, expires_in: 3600, token_type: "Bearer" }) };
  }
  if (host !== API_HOST) throw new Error(`host inesperado: ${host}`);
  const corpo = JSON.parse(init.body ?? "{}") as { aggregation: { timeRange: { to: string } } };
  const to = Date.parse(corpo.aggregation.timeRange.to);
  const from = new Date(to - 86_400_000).toISOString();
  return {
    status: 200,
    headers: { get: (n: string) => (n === "x-processingunits-spent" ? "1.5" : null) },
    json: async () => ({
      status: "OK",
      data: [{ interval: { from, to: new Date(to).toISOString() }, outputs: { ndvi: { bands: { B0: { stats: UTIL } } } } }]
    })
  };
};

let h: Harness;
let admin: Db;
let api: FastifyInstance;
let A = "";
let B = "";
let indiceArea = 0;

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });

async function novaArea(empresa: string, opts: { org?: string; deleted?: boolean } = {}): Promise<string> {
  const lon = Number((-55.5 + 0.02 * indiceArea++).toFixed(4));
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria, deleted_at)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5, $6) returning id`,
    [opts.org ?? h.demo.orgId, empresa, `HF01-${indiceArea}`, `[TEST] HF01 ${indiceArea}`, JSON.stringify(quadrado(lon, -15.6, 0.01)),
      opts.deleted ? new Date() : null]);
  return r.rows[0]!.id;
}

async function criarConsulta(areaIds: string[], headers = h.headers()): Promise<string> {
  const r = await api.inject({
    method: "POST", url: "/api/satelite/consultas", headers,
    payload: { alvo: { tipo: "areas", area_ids: areaIds }, periodo: RECENTE, indices: ["ndvi"], confirmar: true }
  });
  expect(r.statusCode, r.body).toBe(201);
  return (r.json() as { consulta: { id: string } }).consulta.id;
}

async function reservar(limite = 10): Promise<ItemReservado[]> {
  const r = await withTx(h.db, VAZIO, (tx) =>
    tx.query<ItemReservado>(
      "select organization_id, empresa_id, consulta_id, item_id, criado_por from erp.satelite_reservar_itens($1,$2,$3,$4,$5)",
      [limite, SEM_TETO.simultaneas, SEM_TETO.porMinutoConta, SEM_TETO.porMinutoOrganizacao, 600]));
  return r.rows;
}

async function membro(nome: string, email: string, permissoes: string[], escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]) {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const roleId = (papel.json() as { id: string }).id;
  const vinculo = await h.app.inject({
    method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: nome, email, password: "Hotfix@12345", role_id: roleId, escopos_empresas: escopos }
  });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Hotfix@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  const userId = (await admin.query<{ id: string }>("select id from erp.users where email=$1", [email])).rows[0]!.id;
  return { headers: { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId }, userId };
}

const itemDe = async (consultaId: string) =>
  (await admin.query<{ id: string; situacao: string; erro: string | null; area_id: string }>(
    "select id, situacao, erro, area_id from erp.satelite_consulta_itens where consulta_id=$1 order by created_at", [consultaId])).rows;

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 4 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  api = await buildApp({ config: configDeTeste(CREDENCIAL_FALSA), db: h.db, logger: false, buscarExterno: buscarMock });
}, 180_000);

afterAll(async () => {
  await api?.close();
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("HOTFIX-SAT-WORKER-01 — SSOT módulo", () => {
  it("MODULO_EXECUTOR Node = erp.modulo_satelite_executor()", async () => {
    expect(MODULO_EXECUTOR).toBe("pecuaria");
    const r = await admin.query<{ m: string }>("select erp.modulo_satelite_executor() m");
    expect(r.rows[0]!.m).toBe(MODULO_EXECUTOR);
  });
});

describe("HOTFIX-SAT-WORKER-01 — contrato reserva → execução", () => {
  it("item reservado pelo owner: conferirAreaAposReserva encontra a mesma área; smoke completa", async () => {
    const areaId = await novaArea(A);
    const consultaId = await criarConsulta([areaId]);
    const reservados = await reservar();
    const item = reservados.find((x) => x.consulta_id === consultaId);
    expect(item).toBeTruthy();
    const conf = await conferirAreaAposReserva({ db: h.db }, item!);
    expect(conf).toEqual({ ok: true, areaId });

    const cliente = new ClienteCopernicus({
      buscar: buscarMock, credenciais: { clienteId: ID_FALSO, segredo: SEGREDO_FALSO }, esperar: async () => {}
    });
    const dep = {
      db: h.db, cliente, log, agora: Date.now, aleatorio: () => 0.5,
      limiteAvulso: new LimiteAvulsoSatelite(SEM_TETO), copernicusEnabled: true
    };
    const r = await executarItem(dep, item!);
    expect(r.desfecho).toBe("concluido");
    expect(r.motivo).toBeNull();
    expect((await itemDe(consultaId))[0]).toMatchObject({ situacao: "concluido", erro: null });
  });

  it("escopo todas: reserva → área encontrada", async () => {
    const m = await membro("Todas HF", `todas-hf-${randomUUID().slice(0, 8)}@demo.local`,
      ["analises_satelitais.create", "analises_satelitais.view", "batch_area.view"],
      [{ modulo: "pecuaria", modo: "todas", empresas: [] }]);
    const areaId = await novaArea(A);
    const consultaId = await criarConsulta([areaId], m.headers);
    const item = (await reservar()).find((x) => x.consulta_id === consultaId);
    expect(item?.criado_por).toBe(m.userId);
    expect(await conferirAreaAposReserva({ db: h.db }, item!)).toEqual({ ok: true, areaId });
    await admin.query("update erp.satelite_consulta_itens set situacao='cancelado' where consulta_id=$1", [consultaId]);
  });

  it("escopo selecionadas (empresa A): reserva → área encontrada", async () => {
    const m = await membro("Sel HF", `sel-hf-${randomUUID().slice(0, 8)}@demo.local`,
      ["analises_satelitais.create", "analises_satelitais.view", "batch_area.view"],
      [{ modulo: "pecuaria", modo: "selecionadas", empresas: [A] }]);
    const areaId = await novaArea(A);
    const consultaId = await criarConsulta([areaId], m.headers);
    const item = (await reservar()).find((x) => x.consulta_id === consultaId);
    expect(item).toBeTruthy();
    expect(await conferirAreaAposReserva({ db: h.db }, item!)).toEqual({ ok: true, areaId });
    await admin.query("update erp.satelite_consulta_itens set situacao='cancelado' where consulta_id=$1", [consultaId]);
  });

  it("sem acesso à empresa: reserva marca criador_sem_acesso (não area_nao_encontrada por divergência)", async () => {
    const m = await membro("SemA HF", `sema-hf-${randomUUID().slice(0, 8)}@demo.local`,
      ["analises_satelitais.create", "analises_satelitais.view", "batch_area.view"],
      [{ modulo: "pecuaria", modo: "selecionadas", empresas: [A] }]);
    // Consulta criada pelo admin na empresa B; depois transferimos criado_por para o membro sem acesso a B.
    const areaId = await novaArea(B);
    const consultaId = await criarConsulta([areaId]);
    await admin.query("update erp.satelite_consultas set criado_por=$1 where id=$2", [m.userId, consultaId]);
    const antes = await reservar();
    expect(antes.find((x) => x.consulta_id === consultaId)).toBeUndefined();
    const itens = await itemDe(consultaId);
    expect(itens.every((i) => i.situacao === "falho" && i.erro === "criador_sem_acesso")).toBe(true);
  });

  it("área soft-deleted: reserva NÃO devolve o item; marca area_nao_encontrada na reserva", async () => {
    const areaViva = await novaArea(A);
    const consultaId = await criarConsulta([areaViva]);
    // Soft-delete depois do pedido (cenário produção: área sumiu antes do worker).
    await admin.query("update erp.areas set deleted_at=now() where id=$1", [areaViva]);
    const reservados = await reservar();
    expect(reservados.find((x) => x.consulta_id === consultaId)).toBeUndefined();
    const itens = await itemDe(consultaId);
    expect(itens[0]).toMatchObject({ situacao: "falho", erro: ERROS_ITEM.areaNaoEncontrada });
  });

  it("organização diferente com criador dono: reserva → área encontrada no escopo dela", async () => {
    const orgX = (await admin.query<{ id: string }>(
      `insert into erp.organizations (name, slug) values ('[TEST] HF Org X','hf-org-x-${randomUUID().slice(0, 8)}') returning id`)).rows[0]!.id;
    const empresaX = (await admin.query<{ id: string }>(
      "insert into erp.empresas (organization_id, code, name) values ($1, 91, '[TEST] Emp X HF') returning id", [orgX])).rows[0]!.id;
    const donoX = (await admin.query<{ id: string }>(
      `insert into erp.users (email, name) values ('dono-x-hf-${randomUUID().slice(0, 8)}@demo.local', '[TEST] Dono X HF') returning id`)).rows[0]!.id;
    await admin.query("insert into erp.organization_members (organization_id, user_id, is_owner) values ($1, $2, true)", [orgX, donoX]);
    const areaX = await novaArea(empresaX, { org: orgX });
    const chave = createHash("sha256").update(randomUUID()).digest("hex");
    const cX = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima, total_itens, situacao)
       values ($1,$2,$3,'{}'::jsonb,1,1,1,'pendente') returning id`, [orgX, empresaX, donoX])).rows[0]!.id;
    const iX = (await admin.query<{ id: string }>(
      `insert into erp.satelite_consulta_itens
         (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, situacao, tentativas, chave_idempotencia, chave_idempotencia_origem,
          indice_bundle, versao_metodo, janela_inicio, janela_fim)
       select $1,$2,$3,a.id, encode(sha256(convert_to(a.geometria::text,'UTF8')),'hex'), 'pendente',0,$4,$5,'ndvi','ndvi-v2','2026-09-05','2026-10-04'
         from erp.areas a where a.id=$6 returning id`,
      [cX, orgX, empresaX, chave, `o|${chave}`, areaX])).rows[0]!.id;
    const item = (await reservar(50)).find((x) => x.item_id === iX);
    expect(item).toBeTruthy();
    expect(await conferirAreaAposReserva({ db: h.db }, item!)).toEqual({ ok: true, areaId: areaX });
    await admin.query("update erp.satelite_consulta_itens set situacao='cancelado' where id=$1", [iX]);
  });
});

describe("HOTFIX-SAT-WORKER-01 — fail-safe cascata + reprocessar", () => {
  it("≥2 area_nao_encontrada na rodada pausam o executor; reprocessar-falhas reabre os afetados", async () => {
    const areas = [await novaArea(A), await novaArea(A), await novaArea(A)];
    const consultaIds: string[] = [];
    for (const a of areas) consultaIds.push(await criarConsulta([a]));
    const reservados = await reservar(3);
    const alvo = reservados.filter((x) => consultaIds.includes(x.consulta_id));
    expect(alvo.length).toBe(3);
    await admin.query("update erp.areas set deleted_at=now() where id = any($1::uuid[])", [areas]);

    const agora = 10_000_000;
    let fila: ItemReservado[] = [...alvo];
    const cliente = new ClienteCopernicus({
      buscar: buscarMock, credenciais: { clienteId: ID_FALSO, segredo: SEGREDO_FALSO }, esperar: async () => {}
    });
    const w = new WorkerSatelite({
      db: h.db, cliente, limites: SEM_TETO, log,
      limiteAvulso: new LimiteAvulsoSatelite(SEM_TETO), copernicusEnabled: true,
      agora: () => agora,
      reservarFn: async () => {
        const out = fila;
        fila = [{ ...alvo[0]! }]; // se não pausar, a 2ª rodada ainda acharia algo
        return out;
      }
    });
    const r1 = await w.rodarUmaVez();
    expect(r1.falhos).toBe(3);
    expect(r1.concluidos).toBe(0);
    // Em pausa estrutural: mesmo com reservarFn pronto, não consome.
    const r2 = await w.rodarUmaVez();
    expect(r2).toEqual({ reservados: 0, concluidos: 0, falhos: 0, adiados: 0 });

    const reproc = await api.inject({
      method: "POST", url: `/api/satelite/consultas/${consultaIds[0]}/reprocessar-falhas`, headers: h.headers(), payload: {}
    });
    expect(reproc.statusCode, reproc.body).toBe(200);
    expect((reproc.json() as { reprocessados: number }).reprocessados).toBe(1);
    expect((await itemDe(consultaIds[0]!))[0]?.situacao).toBe("pendente");
  });
});
