import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-01 (decisão 305) — `POST /api/livestock/transfers/batch-to-module-area` e a OCUPAÇÃO DA ÁREA (MM-7a..MM-7e).
 *
 * O contrato da rota é o de antes (corpo, `{ id, code }` 201, permissão, 403 e 404 "Lote"): MM-7a o prova sem nenhuma
 * asserção sobre ocupação, para rodar igual contra o código da base. O gatilho `trg_batches_fechar_ocupacao` fecha e
 * abre a ocupação com a data de HOJE; a rota, na mesma transação, liga os dois movimentos, troca as datas pela data da
 * transferência, recusa (422) a data que inverteria o período e congela cabeças e UA na entrada.
 *
 * O cenário é semeado pela conexão TESTEMUNHA (superusuário, `TEST_URL`); o gatilho abre a ocupação quando o lote
 * nasce numa área (data_inicio = entry_date). As datas vêm do `current_date` do banco, a mesma fonte do gatilho.
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
const T = `MM7${Math.random().toString(36).slice(2, 6)}`;
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let org: string; let empA: string; let especie: string; let raca: string;
let D: { hoje: string; menos3: string; menos5: string; menos10: string; menos11: string };
let outraOrg: { org: string; lote: string };
let semCapacidade: Hdr;

let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;
async function area(nome: string): Promise<string> {
  return (await admin.query<{ id: string }>(
    "insert into erp.areas (organization_id, empresa_id, code, name, area_ha, land_use) values ($1,$2,$3,$4,10,'pastagem') returning id::text as id",
    [org, empA, `${T}-${nome}`, `Área ${nome} ${T}`])).rows[0]!.id;
}
async function lote(areaId: string | null, entrada: string, organizacao = org, empresa = empA): Promise<string> {
  const n = unico();
  return (await admin.query<{ id: string }>(
    "insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, area_id, entry_date, status) values ($1,$2,$3,$4,$5,$6,'pasture',$7,$4,'active') returning id::text as id",
    [organizacao, empresa, `${T}-L${n}`, entrada, `Lote ${T} ${n}`, especie, areaId])).rows[0]!.id;
}
/** O corpo que a web envia (transfer-batch-location.tsx): as opcionais vão como null. */
const corpo = (batchId: string, areaId: string | null, data: string, extra: Record<string, unknown> = {}) =>
  ({ empresa_id: empA, movement_date: data, batch_id: batchId, grazing_module_id: null, area_id: areaId, corral_id: null, note: null, ...extra });
const transferir = (payload: unknown, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "POST", url: "/api/livestock/transfers/batch-to-module-area", headers: { ...headers, "content-type": "application/json" }, payload: payload as Record<string, unknown> });

type Ocupacao = {
  id: string; area_id: string; data_inicio: string; data_fim: string | null; origem_da_data: string; motivo_saida: string | null;
  movimento_entrada_id: string | null; movimento_saida_id: string | null; cabecas_na_entrada: number | null; ua_na_entrada: string | null; updated_at: string;
};
/** As ocupações do lote, lidas pela testemunha, na ordem em que nasceram (cada transferência é uma transação). */
async function ocupacoes(batchId: string): Promise<Ocupacao[]> {
  return (await admin.query<Ocupacao>(
    `select id::text as id, area_id::text as area_id, data_inicio::text as data_inicio, data_fim::text as data_fim, origem_da_data, motivo_saida,
            movimento_entrada_id::text as movimento_entrada_id, movimento_saida_id::text as movimento_saida_id,
            cabecas_na_entrada, ua_na_entrada::text as ua_na_entrada, updated_at::text as updated_at
       from erp.ocupacoes_de_area where organization_id=$1 and batch_id=$2 order by created_at, data_inicio`, [org, batchId])).rows;
}
const totalDeOcupacoes = async (organizacao = org) => (await admin.query<{ n: number }>("select count(*)::int as n from erp.ocupacoes_de_area where organization_id=$1", [organizacao])).rows[0]!.n;
const movimentosDoLote = async (batchId: string) => (await admin.query<{ n: number }>("select count(*)::int as n from erp.animal_movements where batch_id=$1", [batchId])).rows[0]!.n;
const movimentosDaOrganizacao = async (organizacao = org) => (await admin.query<{ n: number }>("select count(*)::int as n from erp.animal_movements where organization_id=$1", [organizacao])).rows[0]!.n;
async function oLote(batchId: string) {
  return (await admin.query<{ area_id: string | null; grazing_module_id: string | null; corral_id: string | null; updated_at: string }>(
    "select area_id::text as area_id, grazing_module_id::text as grazing_module_id, corral_id::text as corral_id, updated_at::text as updated_at from erp.batches where id=$1", [batchId])).rows[0]!;
}

async function membro(nome: string, perms: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@mm7.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  org = h.demo.orgId; empA = h.demo.empresaIds[0]!;
  especie = (await admin.query<{ id: string }>("select id::text as id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]!.id;
  raca = (await admin.query<{ id: string }>("select id::text as id from erp.breeds where organization_id is null order by name limit 1")).rows[0]!.id;
  D = (await admin.query<typeof D>(
    "select current_date::text as hoje, (current_date - 3)::text as menos3, (current_date - 5)::text as menos5, (current_date - 10)::text as menos10, (current_date - 11)::text as menos11")).rows[0]!;
  // outra organização, com um lote numa área DELA (a ocupação dela existe e não pode ser tocada)
  const o = (await admin.query<{ id: string }>(
    "insert into erp.organizations (name, slug) values ($1, $2) returning id::text as id", [`[TEST] Org ${T}`, `org-${T.toLowerCase()}`])).rows[0]!.id;
  const e = (await admin.query<{ id: string }>(
    "insert into erp.empresas (organization_id, code, name) values ($1, '01', $2) returning id::text as id", [o, `Empresa ${T}`])).rows[0]!.id;
  const areaDela = (await admin.query<{ id: string }>(
    "insert into erp.areas (organization_id, empresa_id, code, name, area_ha, land_use) values ($1,$2,$3,$4,10,'pastagem') returning id::text as id", [o, e, `${T}-OO`, `Área outra org ${T}`])).rows[0]!.id;
  outraOrg = { org: o, lote: await lote(areaDela, D.menos10, o, e) };
  semCapacidade = await membro("Transferencia MM7 Sem Capacidade", ["batch_module_area_transfer.view"]);
});
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("MM-7a — o contrato da transferência é o de antes", () => {
  it("mesmo corpo aceito; 201 com EXATAMENTE { id, code }; 403 sem a capacidade; 404 igual para inexistente e de outra organização", async () => {
    const a1 = await area("7a1"); const a2 = await area("7a2");
    const l = await lote(a1, D.menos10);

    // o corpo da web (opcionais em null)
    const r = await transferir(corpo(l, a2, D.hoje));
    expect(r.statusCode, r.body).toBe(201);
    const b = r.json() as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(["code", "id"]);
    expect(b.id).toMatch(UUID); expect(b.code).toMatch(/^\d{5,}$/);
    const m = await admin.query("select movement_type, batch_id::text as batch_id, empresa_id::text as empresa_id, destination_area_id::text as destination_area_id, destination_module_id, movement_date::text as movement_date, quantity, note, status from erp.animal_movements where id=$1", [b.id]);
    expect(m.rows).toEqual([{ movement_type: "module_area_transfer", batch_id: l, empresa_id: empA, destination_area_id: a2, destination_module_id: null, movement_date: D.hoje, quantity: 0, note: null, status: "confirmed" }]);
    expect((await oLote(l)).area_id).toBe(a2);

    // o corpo mínimo (sem as chaves opcionais) continua aceito, com a mesma forma de resposta
    const r2 = await transferir({ empresa_id: empA, movement_date: D.hoje, batch_id: l, area_id: a1 });
    expect(r2.statusCode, r2.body).toBe(201);
    expect(Object.keys(r2.json() as Record<string, unknown>).sort()).toEqual(["code", "id"]);

    // a borda zod de sempre: data inválida é 422 no campo
    const z = await transferir(corpo(l, a2, "2026-02-30"));
    expect(z.statusCode, z.body).toBe(422);
    expect(z.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: "movement_date: Data inválida", details: [{ path: "movement_date", message: "Data inválida" }] } });

    // 403: membro sem batch_module_area_transfer.create — nada gravado
    const antes403 = { lote: await oLote(l), movimentos: await movimentosDoLote(l), ocupacoes: await ocupacoes(l) };
    const p = await transferir(corpo(l, a2, D.hoje), semCapacidade);
    expect(p.statusCode, p.body).toBe(403);
    expect(p.json()).toEqual({ error: { code: "PERMISSION_DENIED", message: "Sem permissão: batch_module_area_transfer.create" } });
    expect({ lote: await oLote(l), movimentos: await movimentosDoLote(l), ocupacoes: await ocupacoes(l) }).toEqual(antes403);

    // 404: inexistente e de OUTRA organização — a mesma resposta, byte a byte; nada gravado em nenhuma das duas
    const antesOutra = { lote: await oLote(outraOrg.lote), ocupacoes: await totalDeOcupacoes(outraOrg.org), movimentos: await movimentosDaOrganizacao(outraOrg.org) };
    const movimentosDaDemo = await movimentosDaOrganizacao();
    expect(antesOutra.ocupacoes, "premissa: a outra organização tem a ocupação do lote dela").toBe(1);
    expect((await admin.query("select 1 from erp.batches where id=$1", [NAO_ACHADO])).rowCount, "premissa: o inexistente não existe").toBe(0);
    const nx = await transferir(corpo(NAO_ACHADO, a2, D.hoje));
    const oo = await transferir(corpo(outraOrg.lote, a2, D.hoje));
    expect([nx.statusCode, oo.statusCode]).toEqual([404, 404]);
    expect(nx.json()).toEqual({ error: { code: "NOT_FOUND", message: "Lote não encontrado" } });
    expect(oo.body).toBe(nx.body);
    expect({ lote: await oLote(outraOrg.lote), ocupacoes: await totalDeOcupacoes(outraOrg.org), movimentos: await movimentosDaOrganizacao(outraOrg.org) }).toEqual(antesOutra);
    expect(await movimentosDaOrganizacao()).toBe(movimentosDaDemo);
  });
});

describe("MM-7b — fecha a anterior e abre a nova, com os dois movimentos ligados", () => {
  it("a1 → a2 → a3 encadeia saída e entrada; área igual não toca ocupação; área nula fecha sem abrir", async () => {
    const a1 = await area("7b1"); const a2 = await area("7b2"); const a3 = await area("7b3");
    const l = await lote(a1, D.menos10);
    const o0 = await ocupacoes(l);
    expect(o0, "premissa: o gatilho abriu a ocupação do lote criado na área").toHaveLength(1);
    expect(o0[0]).toMatchObject({ area_id: a1, data_inicio: D.menos10, data_fim: null, origem_da_data: "entrada_do_lote", movimento_entrada_id: null, movimento_saida_id: null });
    const total0 = await totalDeOcupacoes();

    // 1º elo: a1 → a2
    const r1 = await transferir(corpo(l, a2, D.hoje));
    expect(r1.statusCode, r1.body).toBe(201);
    const m1 = (r1.json() as { id: string }).id;
    const o1 = await ocupacoes(l);
    expect(o1).toHaveLength(2);
    expect(await totalDeOcupacoes()).toBe(total0 + 1);
    expect(o1[0]).toMatchObject({ id: o0[0]!.id, area_id: a1, data_inicio: D.menos10, data_fim: D.hoje, motivo_saida: "transferencia", movimento_entrada_id: null, movimento_saida_id: m1 });
    expect(o1[1]).toMatchObject({ area_id: a2, data_inicio: D.hoje, data_fim: null, origem_da_data: "movimento", motivo_saida: null, movimento_entrada_id: m1, movimento_saida_id: null, cabecas_na_entrada: 0, ua_na_entrada: "0.00" });
    expect([o1[0]!.movimento_saida_id, o1[1]!.movimento_entrada_id]).toEqual([m1, m1]);

    // 2º elo: a2 → a3 — a do meio fica com a entrada do 1º e a saída do 2º
    const r2 = await transferir(corpo(l, a3, D.hoje));
    expect(r2.statusCode, r2.body).toBe(201);
    const m2 = (r2.json() as { id: string }).id;
    const o2 = await ocupacoes(l);
    expect(o2).toHaveLength(3);
    expect(await totalDeOcupacoes()).toBe(total0 + 2);
    expect(o2[0]).toEqual(o1[0]);
    expect(o2[1]).toMatchObject({ id: o1[1]!.id, area_id: a2, data_inicio: D.hoje, data_fim: D.hoje, motivo_saida: "transferencia", movimento_entrada_id: m1, movimento_saida_id: m2 });
    expect(o2[2]).toMatchObject({ area_id: a3, data_inicio: D.hoje, data_fim: null, movimento_entrada_id: m2, movimento_saida_id: null });

    // área IGUAL (só observação): nenhuma ocupação é tocada — nem o updated_at — e nenhuma aponta para o movimento
    const r3 = await transferir(corpo(l, a3, D.menos3, { note: "mesma área" }));
    expect(r3.statusCode, r3.body).toBe(201);
    const m3 = (r3.json() as { id: string }).id;
    expect(await ocupacoes(l)).toEqual(o2);
    expect(await totalDeOcupacoes()).toBe(total0 + 2);
    expect((await admin.query("select 1 from erp.ocupacoes_de_area where movimento_entrada_id=$1 or movimento_saida_id=$1", [m3])).rowCount).toBe(0);

    // a MESMA área em maiúsculas (o corpo aceita) também não é troca: a aberta continua aberta, nada é ligado ao movimento
    expect(a3).toBe(a3.toLowerCase());
    const r3b = await transferir(corpo(l, a3.toUpperCase(), D.hoje, { note: "mesma área em maiúsculas" }));
    expect(r3b.statusCode, r3b.body).toBe(201);
    const m3b = (r3b.json() as { id: string }).id;
    const o3b = await ocupacoes(l);
    expect(o3b).toEqual(o2);
    expect(o3b.filter((x) => x.data_fim === null)).toHaveLength(1);
    expect(await totalDeOcupacoes()).toBe(total0 + 2);
    expect((await admin.query("select 1 from erp.ocupacoes_de_area where movimento_entrada_id=$1 or movimento_saida_id=$1", [m3b])).rowCount).toBe(0);
    expect((await admin.query<{ a: string }>("select area_id::text a from erp.batches where id=$1", [l])).rows[0]!.a).toBe(a3);

    // área → nula: fecha a aberta com a saída ligada e a data da transferência; nenhuma nova
    const r4 = await transferir(corpo(l, null, D.hoje));
    expect(r4.statusCode, r4.body).toBe(201);
    const m4 = (r4.json() as { id: string }).id;
    const o4 = await ocupacoes(l);
    expect(o4).toHaveLength(3);
    expect(await totalDeOcupacoes()).toBe(total0 + 2);
    expect(o4.slice(0, 2)).toEqual(o2.slice(0, 2));
    expect(o4[2]).toMatchObject({ id: o2[2]!.id, area_id: a3, data_fim: D.hoje, motivo_saida: "transferencia", movimento_entrada_id: m2, movimento_saida_id: m4 });
    expect(o4.filter((x) => x.data_fim === null)).toHaveLength(0);
  });
});

describe("MM-7c — data retroativa", () => {
  it("3 dias atrás (depois do início da anterior): data_fim da anterior e data_inicio da nova viram essa data", async () => {
    const a1 = await area("7c1"); const a2 = await area("7c2");
    const l = await lote(a1, D.menos10);
    const total0 = await totalDeOcupacoes();
    const r = await transferir(corpo(l, a2, D.menos3));
    expect(r.statusCode, r.body).toBe(201);
    const m = (r.json() as { id: string }).id;
    const o = await ocupacoes(l);
    expect(o).toHaveLength(2);
    expect(await totalDeOcupacoes()).toBe(total0 + 1);
    expect(o[0]).toMatchObject({ area_id: a1, data_inicio: D.menos10, data_fim: D.menos3, motivo_saida: "transferencia", movimento_saida_id: m });
    expect(o[1]).toMatchObject({ area_id: a2, data_inicio: D.menos3, data_fim: null, origem_da_data: "movimento", movimento_entrada_id: m });
    // o gatilho sozinho teria gravado HOJE nas duas pontas: a data é a da transferência
    expect(D.menos3 < D.hoje).toBe(true);
    expect((await admin.query<{ d: string }>("select movement_date::text as d from erp.animal_movements where id=$1", [m])).rows[0]!.d).toBe(D.menos3);
  });
});

describe("MM-7d — data que inverteria o período", () => {
  it("antes do início da anterior: 422 em movement_date e NADA gravado; a data igual ao início é a fronteira aceita", async () => {
    const a1 = await area("7d1"); const a2 = await area("7d2");
    const l = await lote(a1, D.menos10);
    const antes = { lote: await oLote(l), ocupacoes: await ocupacoes(l), total: await totalDeOcupacoes(), doLote: await movimentosDoLote(l), daOrg: await movimentosDaOrganizacao() };
    expect(antes.ocupacoes, "premissa: uma ocupação aberta em a1 desde 10 dias atrás").toHaveLength(1);
    expect(antes.ocupacoes[0]).toMatchObject({ area_id: a1, data_inicio: D.menos10, data_fim: null });
    expect(antes.doLote).toBe(0);

    const r = await transferir(corpo(l, a2, D.menos11));
    expect(r.statusCode, r.body).toBe(422);
    const msg = `A data da transferência (${D.menos11}) é anterior ao início da ocupação atual do lote na área (${D.menos10}).`;
    expect(r.json()).toEqual({ error: { code: "VALIDATION_ERROR", message: `movement_date: ${msg}`, details: [{ path: "movement_date", message: msg }] } });
    // a transação inteira voltou: o lote continua em a1, nenhum movimento novo, a anterior continua aberta, intacta
    expect({ lote: await oLote(l), ocupacoes: await ocupacoes(l), total: await totalDeOcupacoes(), doLote: await movimentosDoLote(l), daOrg: await movimentosDaOrganizacao() }).toEqual(antes);
    expect((await oLote(l)).area_id).toBe(a1);

    // fronteira: a data IGUAL ao início é aceita (período inclusivo de um dia)
    const f = await transferir(corpo(l, a2, D.menos10));
    expect(f.statusCode, f.body).toBe(201);
    const m = (f.json() as { id: string }).id;
    const o = await ocupacoes(l);
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ area_id: a1, data_inicio: D.menos10, data_fim: D.menos10, movimento_saida_id: m });
    expect(o[1]).toMatchObject({ area_id: a2, data_inicio: D.menos10, data_fim: null, movimento_entrada_id: m });
  });
});

describe("MM-7e — cabeças e UA na entrada", () => {
  it("animais ativos + herd_lots, UA com o peso mandando; o número de consultas não depende do tamanho do rebanho", async () => {
    const a1 = await area("7e1"); const a2 = await area("7e2"); const a3 = await area("7e3");
    const l = await lote(a1, D.menos5);
    const outro = await lote(a1, D.menos5);
    const categoria = async (nome: string, fator: string) => (await admin.query<{ id: string }>(
      "insert into erp.animal_categories (organization_id, species_id, name, ua_factor) values ($1,$2,$3,$4) returning id::text as id", [org, especie, `${T} ${nome}`, fator])).rows[0]!.id;
    const c075 = await categoria("fator 0,750", "0.750");
    const c125 = await categoria("fator 1,250", "1.250");
    const animal = (batchId: string, cat: string, peso: string | null, status = "active", excluido = false) => admin.query(
      `insert into erp.animals (organization_id, empresa_id, species_id, category_id, breed_id, batch_id, sex, entry_date, current_weight, status, deleted_at)
       values ($1,$2,$3,$4,$5,$6,'M',current_date,$7,$8, case when $9::boolean then now() end)`, [org, empA, especie, cat, raca, batchId, peso, status, excluido]);
    const rebanho = (batchId: string, cat: string, quantidade: number, pesoMedio: string | null) => admin.query(
      "insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, breed_id, quantity, average_weight, entry_date) values ($1,$2,$3,$4,$5,$6,$7,$8,current_date)",
      [org, empA, batchId, especie, cat, raca, quantidade, pesoMedio]);
    // no lote: 4 animais que contam e 2 que não contam (vendido; excluído)
    await animal(l, c075, "450.00");                 // pesado: 450 kg
    await animal(l, c125, "315.50");                 // pesado: 315,5 kg
    await animal(l, c075, null);                     // sem peso: fator 0,750
    await animal(l, c125, "0");                      // peso 0 = sem peso: fator 1,250
    await animal(l, c075, "500.00", "sold");         // inativo: fora
    await animal(l, c125, "400.00", "active", true); // excluído: fora
    await rebanho(l, c075, 10, "380.00");            // pesados: 10 × 380 = 3800 kg
    await rebanho(l, c125, 4, null);                 // sem peso: 4 × 1,250 = 5,000
    await rebanho(l, c075, 3, "0");                  // peso médio 0 = sem peso: 3 × 0,750 = 2,250
    // em OUTRO lote (não conta)
    await animal(outro, c075, "300.00");
    await rebanho(outro, c125, 7, "200.00");
    // à mão:
    //   cabeças = 4 animais ativos e vivos + (10 + 4 + 3) = 21
    //   peso dos pesados = 450 + 315,5 + 3800 = 4565,5 kg → 4565,5 / 450 = 10,14555… → 10,146 (animalUnits, 3 casas)
    //   fatores dos sem peso = 0,750 + 1,250 + 5,000 + 2,250 = 9,250
    //   UA = 10,146 + 9,250 = 19,396 → "19.40"
    const premissa = await admin.query<{ ativos: number; contagem: number }>(
      "select (select count(*)::int from erp.animals where batch_id=$1 and status='active' and deleted_at is null) as ativos, (select sum(quantity)::int from erp.herd_lots where batch_id=$1) as contagem", [l]);
    expect(premissa.rows[0], "premissa: o rebanho semeado").toEqual({ ativos: 4, contagem: 17 });

    const vazio = await lote(a1, D.menos5);
    // as consultas da transação do SERVIÇO (do número do movimento ao commit): a carga da sessão fica fora da conta
    const doServico = (calls: unknown[][]) => {
      const sqls = calls.map((c) => c[0]).filter((x): x is string => typeof x === "string");
      return sqls.slice(sqls.findIndex((x) => x.includes("erp.next_code(")));
    };
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let comRebanho: string[]; let semRebanho: string[];
    let r: Awaited<ReturnType<typeof transferir>>; let rv: Awaited<ReturnType<typeof transferir>>;
    try {
      r = await transferir(corpo(l, a2, D.hoje));
      comRebanho = doServico(espiao.mock.calls);
      espiao.mockClear();
      rv = await transferir(corpo(vazio, a3, D.hoje));
      semRebanho = doServico(espiao.mock.calls);
    } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(201);
    const m = (r.json() as { id: string }).id;
    const o = await ocupacoes(l);
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ area_id: a1, cabecas_na_entrada: null, ua_na_entrada: null, movimento_saida_id: m });
    expect(o[1]).toMatchObject({ area_id: a2, data_inicio: D.hoje, movimento_entrada_id: m, cabecas_na_entrada: 21, ua_na_entrada: "19.40" });
    // o lote vazio entra com 0 cabeças e UA "0.00" (medido, não nulo)
    expect(rv.statusCode, rv.body).toBe(201);
    const ov = await ocupacoes(vazio);
    expect(ov).toHaveLength(2);
    expect(ov[1]).toMatchObject({ area_id: a3, movimento_entrada_id: (rv.json() as { id: string }).id, cabecas_na_entrada: 0, ua_na_entrada: "0.00" });

    // nunca N+1: 4 animais ativos (6 no lote) e 3 rebanhos por contagem custam as MESMAS consultas que um lote vazio
    const de = (sqls: string[], forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
    const contagem = (sqls: string[]) => ({ total: sqls.length, animais: de(sqls, /\berp\.animals\b/), contagem: de(sqls, /\berp\.herd_lots\b/), ocupacoes: de(sqls, /\berp\.ocupacoes_de_area\b/), commit: de(sqls, /^commit$/) });
    // next_code, trava do lote, aberta, UPDATE do lote, contagem antiga, movimento, ID Global (2), fecha a anterior,
    // lê a nova, rebanho (1 consulta para animais + contagem), ajusta a nova, commit
    expect(contagem(comRebanho)).toEqual({ total: 13, animais: 2, contagem: 1, ocupacoes: 4, commit: 1 });
    expect(contagem(semRebanho)).toEqual(contagem(comRebanho));
  });
});
