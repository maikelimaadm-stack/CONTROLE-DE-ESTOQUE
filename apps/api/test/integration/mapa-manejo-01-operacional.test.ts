import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { moduloDaPermissao } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-01 (decisão 305) — GET /api/mapa/operacional: UMA chamada com tudo o que o mapa operacional desenha
 * (MM-10a..MM-10c).
 *
 * Áreas no escopo com a ocupação aberta (lotes, cabeças, UA, dias), descanso, UA/ha e situação de lotação; objetos
 * de mapa (só com `map_objects.view`); último manejo (só com `nutritions.view`) e última pesagem (só com
 * `weighings.view`) por área. Filtros `retiro_id`, `grazing_module_id`, `land_use` e `situacao`; o resto é 422.
 * O número de consultas é FIXO e CONTADO (MM-10b): 3 e 30 áreas fazem as mesmas consultas, tabela por tabela.
 *
 * Semeadura pela conexão TESTEMUNHA (superusuário), com datas relativas ao dia da EMPRESA do cenário lido no banco
 * (`(now() at time zone fuso_horario)::date`, o `hoje` da rota — MAPA-MANEJO-03, decisão 307).
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
const TAG = `MM10${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const unico = () => `${TAG}-${++seq}`;
let E1: string; let E2: string; let especie: string; let categoria: string;
let hoje: string;
const dia = (n: number) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const estacaoEsperada = () => { const mes = Number(hoje.slice(5, 7)); return mes >= 10 || mes <= 3 ? "aguas" : "seca"; };
const POLIGONO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };
const PONTO = { type: "Point", coordinates: [-55.001, -15.001] };

const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers });
async function ok(url: string, headers?: Hdr): Promise<Operacional> { const r = await get(url, headers); expect(r.statusCode, `${url}: ${r.body}`).toBe(200); return r.json() as Operacional; }

async function membro(nome: string, perms: string[], empresas: readonly string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico().toLowerCase().replace(/\W+/g, "")}@mm10.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

// ---------- semeadura (testemunha) ----------
const id = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0]!.id;
const retiro = (empresa: string) =>
  id("insert into erp.retiros (organization_id, empresa_id, code, name) values ($1,$2,$3,$4) returning id", [h.demo.orgId, empresa, unico(), `Retiro ${TAG}`]);
const modulo = (empresa: string) =>
  id(`insert into erp.grazing_modules (organization_id, empresa_id, code, module_date, description, rest_days, occupation_days)
      values ($1,$2,$3,current_date,$4,30,7) returning id`, [h.demo.orgId, empresa, unico(), `Módulo ${TAG}`]);
type OpcoesArea = { areaHa?: string; usavel?: string; aguas?: string | null; seca?: string | null; maxima?: string | null; modulo?: string | null; retiro?: string | null; uso?: string; cor?: string | null };
async function area(empresa: string, nome: string, o: OpcoesArea = {}): Promise<string> {
  return id(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure,
                                    support_capacity_rainy_ua_ha, support_capacity_dry_ua_ha, max_stocking_ua, grazing_module_id, retiro_id, color, geometria)
             values ($1,$2,$3,$4,$5,$6,$7,'ativa','propria',$8,$9,$10,$11,$12,$13,$14::jsonb) returning id`,
    [h.demo.orgId, empresa, unico(), nome, o.areaHa ?? "10", o.usavel ?? o.areaHa ?? "10", o.uso ?? "pastagem", o.aguas ?? null, o.seca ?? null,
     o.maxima ?? null, o.modulo ?? null, o.retiro ?? null, o.cor ?? null, JSON.stringify(POLIGONO)]);
}
type Lote = { id: string; code: string; description: string };
async function lote(empresa: string, nome: string): Promise<Lote> {
  const code = unico();
  const r = await admin.query<{ id: string }>(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, status)
                                               values ($1,$2,$3,current_date,$4,$5,'pasture','active') returning id`, [h.demo.orgId, empresa, code, nome, especie]);
  return { id: r.rows[0]!.id, code, description: nome };
}
async function animal(empresa: string, l: Lote, peso: string | null) {
  await admin.query(`insert into erp.animals (organization_id, empresa_id, species_id, category_id, batch_id, sex, entry_date, current_weight, status)
                     values ($1,$2,$3,$4,$5,'M',current_date,$6,'active')`, [h.demo.orgId, empresa, especie, categoria, l.id, peso]);
}
async function porContagem(empresa: string, l: Lote, quantidade: number, pesoMedio: string | null) {
  await admin.query(`insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, quantity, average_weight, entry_date)
                     values ($1,$2,$3,$4,$5,$6,$7,current_date)`, [h.demo.orgId, empresa, l.id, especie, categoria, quantidade, pesoMedio]);
}
async function ocupacao(empresa: string, areaId: string, l: Lote, inicio: number, fim: number | null, origem = "movimento"): Promise<string> {
  return id(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data, motivo_saida)
             values ($1,$2,$3,$4,$5::date,$6::date,$7,$8) returning id`,
    [h.demo.orgId, empresa, areaId, l.id, dia(inicio), fim === null ? null : dia(fim), origem, fim === null ? null : "transferencia"]);
}
async function objeto(empresa: string, areaId: string | null, tipo: "cocho" | "deposito_a_pasto", nome: string, o: { capacidade?: string; excluido?: boolean } = {}): Promise<string> {
  return id(`insert into erp.objetos_de_mapa (organization_id, empresa_id, area_id, tipo, forma, geometria, code, name, capacidade, unidade_capacidade, deleted_at)
             values ($1,$2,$3,$4,'ponto',$5::jsonb,$6,$7,$8,$9, case when $10 then now() end) returning id`,
    [h.demo.orgId, empresa, areaId, tipo, JSON.stringify(PONTO), unico(), nome, o.capacidade ?? null, o.capacidade ? (tipo === "cocho" ? "m" : "t") : null, o.excluido ?? false]);
}
/** Manejo do lote na data: o gatilho da 0061 preenche `area_id` com a área da ocupação do lote NAQUELA data. */
const manejo = (empresa: string, l: Lote, data: number, excluido = false) =>
  id(`insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id, deleted_at)
      values ($1,$2,$3,'sanitary',$4::date,$5, case when $6 then now() end) returning id`, [h.demo.orgId, empresa, unico(), dia(data), l.id, excluido]);
const pesagem = (empresa: string, l: Lote, data: number) =>
  id(`insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id) values ($1,$2,$3,$4::date,$5) returning id`,
    [h.demo.orgId, empresa, unico(), dia(data), l.id]);
const areaDoDocumento = async (tabela: "animal_handlings" | "weighings", docId: string) =>
  (await admin.query<{ area_id: string | null }>(`select area_id from erp.${tabela} where id=$1`, [docId])).rows[0]!.area_id;

type LoteDto = { id: string; code: string | null; description: string | null };
type Aberta = { id: string; lote: LoteDto; cabecas: number; ua: string; cabecas_na_entrada: number | null; ua_na_entrada: string | null; data_inicio: string; origem_da_data: string; dias_de_ocupacao: number };
type AreaOp = {
  id: string; empresa_id: string; name: string; code: string; color: string | null; area_ha: string; usable_area_ha: string; land_use: string; status: string;
  geometria: unknown; retiro_id: string | null; grazing_module_id: string | null;
  support_capacity_rainy_ua_ha: string | null; support_capacity_dry_ua_ha: string | null; max_stocking_ua: string | null;
  ocupada: boolean; lotes: Aberta[]; cabecas_total: number; ua_total: string; ultima_saida: string | null; dias_de_descanso: number | null;
  ua_por_hectare: string | null; capacidade_da_estacao: string | null; situacao_de_lotacao: string | null;
  ultimo_manejo: string | null; ultima_pesagem: string | null;
  centroide: { lon: number; lat: number } | null; identificador: unknown; icone: unknown; faixa: unknown;
};
type Objeto = { id: string; empresa_id: string; area_id: string | null; tipo: string; forma: string; geometria: unknown; code: string | null; name: string; descricao: string | null; capacidade: string | null; unidade_capacidade: string | null; trough_id: string | null; is_active: boolean };
type Operacional = { hoje: string; estacao: string; coloracao: string; capacidades: { objetos: boolean; manejo: boolean; pesagem: boolean; icones: boolean }; areas: AreaOp[]; objetos: Objeto[] };
const dtoLote = (l: Lote): LoteDto => ({ id: l.id, code: l.code, description: l.description });
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const achar = (r: Operacional, areaId: string) => { const a = r.areas.find((x) => x.id === areaId); if (!a) throw new Error(`área ${areaId} ausente da resposta`); return a; };

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2).not.toBe(E1);
  hoje = (await admin.query<{ d: string }>("select (now() at time zone fuso_horario)::date::text as d from erp.empresas where id = $1", [E1])).rows[0]!.d;
  especie = (await admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]!.id;
  categoria = await id("insert into erp.animal_categories (organization_id, species_id, name, ua_factor) values ($1,$2,$3,0.75) returning id", [h.demo.orgId, especie, `Categoria ${TAG}`]);
  // premissa: as quatro capacidades da rota respondem pelo MESMO módulo de escopo (o da área) — capacidade AND escopo
  expect(["batch_area.view", "map_objects.view", "nutritions.view", "weighings.view"].map(moduloDaPermissao)).toEqual(["pecuaria", "pecuaria", "pecuaria", "pecuaria"]);
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("MM-10a — uma chamada devolve tudo: áreas, ocupação, descanso, lotação, objetos, manejo e pesagem", () => {
  it("três áreas (ocupada por 2 lotes, vazia com descanso, nunca ocupada) conferidas campo a campo", async () => {
    const R = await retiro(E1);
    const gm = await modulo(E1);
    const A1 = await area(E1, `${TAG} A1 ocupada`, { areaHa: "50", usavel: "40", aguas: "2", seca: "1", maxima: "100", modulo: gm, retiro: R, cor: "#112233" });
    const A2 = await area(E1, `${TAG} A2 vazia`, { areaHa: "15", usavel: "12", retiro: R });
    const A3 = await area(E1, `${TAG} A3 nunca`, { maxima: "10", retiro: R, uso: "lavoura" });

    // L1: 450 + 450 (animais) + 8 × 225 (contagem) = 2700 kg → 6,00 UA; 10 cabeças. L2: 5 por contagem sem peso → 3,75 UA.
    const L1 = await lote(E1, `${TAG} L1`); await animal(E1, L1, "450"); await animal(E1, L1, "450"); await porContagem(E1, L1, 8, "225");
    const L2 = await lote(E1, `${TAG} L2`); await porContagem(E1, L2, 5, null);
    const L3 = await lote(E1, `${TAG} L3`);
    const o1 = await ocupacao(E1, A1, L1, -10, null, "movimento");
    const o2 = await ocupacao(E1, A1, L2, -4, null, "entrada_do_lote");
    await ocupacao(E1, A1, L3, -50, -30);
    await ocupacao(E1, A2, L3, -20, -9);

    const c1 = await objeto(E1, A1, "cocho", `${TAG} cocho A1`, { capacidade: "12.5" });
    const d2 = await objeto(E1, A2, "deposito_a_pasto", `${TAG} deposito A2`, { capacidade: "3" });
    const solto = await objeto(E1, null, "cocho", `${TAG} cocho fora de area`);
    const excluido = await objeto(E1, A1, "cocho", `${TAG} cocho excluido`, { excluido: true });

    // manejos e pesagens: o gatilho põe a área da ocupação do lote NA DATA (premissa conferida abaixo)
    const m1 = await manejo(E1, L1, -5); const m2 = await manejo(E1, L1, -2); const m3 = await manejo(E1, L1, -1, true);
    const m4 = await manejo(E1, L3, -15); const m5 = await manejo(E1, L3, -40);
    const p1 = await pesagem(E1, L2, -3);
    expect([await areaDoDocumento("animal_handlings", m1), await areaDoDocumento("animal_handlings", m2), await areaDoDocumento("animal_handlings", m3),
      await areaDoDocumento("animal_handlings", m4), await areaDoDocumento("animal_handlings", m5), await areaDoDocumento("weighings", p1)])
      .toEqual([A1, A1, A1, A2, A1, A1]);

    const r = await ok("/api/mapa/operacional");
    expect(r.hoje).toBe(hoje);
    const estacao = estacaoEsperada();
    expect(r.estacao).toBe(estacao);
    expect(r.capacidades).toEqual({ objetos: true, manejo: true, pesagem: true, icones: true });

    expect(achar(r, A1)).toEqual({
      id: A1, empresa_id: E1, name: `${TAG} A1 ocupada`, code: expect.any(String), color: "#112233", area_ha: "50.0000", usable_area_ha: "40.0000",
      land_use: "pastagem", status: "ativa", geometria: POLIGONO, retiro_id: R, grazing_module_id: gm,
      support_capacity_rainy_ua_ha: "2.000", support_capacity_dry_ua_ha: "1.000", max_stocking_ua: "100.00",
      ocupada: true,
      lotes: [
        { id: o2, lote: dtoLote(L2), cabecas: 5, ua: "3.75", cabecas_na_entrada: null, ua_na_entrada: null, data_inicio: dia(-4), origem_da_data: "entrada_do_lote", dias_de_ocupacao: 4 },
        { id: o1, lote: dtoLote(L1), cabecas: 10, ua: "6.00", cabecas_na_entrada: null, ua_na_entrada: null, data_inicio: dia(-10), origem_da_data: "movimento", dias_de_ocupacao: 10 }
      ],
      cabecas_total: 15, ua_total: "9.75",
      // ocupada: a última saída existe (−30), mas não há descanso em curso
      ultima_saida: dia(-30), dias_de_descanso: null,
      // 9,75 ÷ 40 (área ÚTIL) = 0,24375 → "0.24"; nas duas estações a razão fica abaixo de 0,90
      ua_por_hectare: "0.24", capacidade_da_estacao: estacao === "aguas" ? "2.000" : "1.000", situacao_de_lotacao: "dentro",
      // o manejo excluído (−1) não conta; o de −40 (L3 em A1 naquela data) é mais antigo
      ultimo_manejo: dia(-2), ultima_pesagem: dia(-3),
      // MAPA-MANEJO-02: centróide do quadrado de 0,01° (-55..-54,99 × -15,01..-15) = o centro dele; nenhum lote com
      // identificador; o dono tem icon_config.view e não há configuração para a categoria desta semeadura (a 1 categoria
      // de L1 e L2, normalizada); `padrao` não tem faixa
      centroide: { lon: expect.closeTo(-54.995, 6), lat: expect.closeTo(-15.005, 6) },
      identificador: null,
      icone: { config_id: null, categoria: null, icone_url: null, cor_padrao: null, categorias: [`Categoria ${TAG}`.toUpperCase()] },
      faixa: null
    });
    expect(achar(r, A2)).toMatchObject({
      ocupada: false, lotes: [], cabecas_total: 0, ua_total: "0.00", ultima_saida: dia(-9), dias_de_descanso: 9,
      ua_por_hectare: "0.00", capacidade_da_estacao: null, situacao_de_lotacao: null, ultimo_manejo: dia(-15), ultima_pesagem: null,
      area_ha: "15.0000", usable_area_ha: "12.0000", color: null, grazing_module_id: null, retiro_id: R
    });
    expect(achar(r, A3)).toMatchObject({
      ocupada: false, lotes: [], cabecas_total: 0, ua_total: "0.00", ultima_saida: null, dias_de_descanso: null, land_use: "lavoura",
      ua_por_hectare: "0.00", capacidade_da_estacao: null, max_stocking_ua: "10.00", situacao_de_lotacao: "dentro", ultimo_manejo: null, ultima_pesagem: null
    });

    const meus = r.objetos.filter((o) => [c1, d2, solto, excluido].includes(o.id));
    expect(meus).toEqual([
      { id: c1, empresa_id: E1, area_id: A1, tipo: "cocho", forma: "ponto", geometria: PONTO, code: expect.any(String), name: `${TAG} cocho A1`, descricao: null, capacidade: "12.500", unidade_capacidade: "m", trough_id: null, is_active: true },
      { id: solto, empresa_id: E1, area_id: null, tipo: "cocho", forma: "ponto", geometria: PONTO, code: expect.any(String), name: `${TAG} cocho fora de area`, descricao: null, capacidade: null, unidade_capacidade: null, trough_id: null, is_active: true },
      { id: d2, empresa_id: E1, area_id: A2, tipo: "deposito_a_pasto", forma: "ponto", geometria: PONTO, code: expect.any(String), name: `${TAG} deposito A2`, descricao: null, capacidade: "3.000", unidade_capacidade: "t", trough_id: null, is_active: true }
    ]);

    // com o filtro do retiro: exatamente as três, em ordem de nome; objetos só os das três (o solto sai)
    const f = await ok(`/api/mapa/operacional?retiro_id=${R}`);
    expect(ids(f.areas)).toEqual([A1, A2, A3]);
    expect(ids(f.objetos)).toEqual([c1, d2]);
    expect(f.areas).toEqual([achar(r, A1), achar(r, A2), achar(r, A3)]);
  });
});

describe("MM-10b — consultas CONTADAS e FIXAS: 3 e 30 áreas, o mesmo número no total e por tabela", () => {
  type Contagem = { total: number; areas: number; ocupacoes: number; lotes: number; animais: number; contagem: number; objetos: number; manejos: number; pesagens: number };
  async function contar(url: string, headers: Hdr = h.headers()): Promise<{ n: Contagem; corpo: Operacional }> {
    await ok(url, headers); // o contexto do usuário fica em cache no plugin de autenticação: mede-se a ROTA, não o cache frio
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const corpo = await ok(url, headers);
      const sqls = espiao.mock.calls.map((c) => c[0]).filter((x): x is string => typeof x === "string");
      const de = (forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
      return {
        corpo,
        n: {
          total: espiao.mock.calls.length,
          areas: de(/erp\.areas\b/), ocupacoes: de(/erp\.ocupacoes_de_area\b/), lotes: de(/erp\.batches\b/), animais: de(/erp\.animals\b/),
          contagem: de(/erp\.herd_lots\b/), objetos: de(/erp\.objetos_de_mapa\b/), manejos: de(/erp\.animal_handlings\b/), pesagens: de(/erp\.weighings\b/)
        }
      };
    } finally { espiao.mockRestore(); }
  }
  /** `n` áreas num retiro novo, cada uma com um lote aberto (animal + contagem), uma saída, um objeto, um manejo e uma pesagem. */
  async function cenario(n: number): Promise<string> {
    const R = await retiro(E1);
    const passado = await lote(E1, `${TAG} conta passado ${n}`);
    for (let i = 0; i < n; i++) {
      const a = await area(E1, `${TAG} conta ${n} ${String(i).padStart(2, "0")}`, { maxima: "50", retiro: R });
      const l = await lote(E1, `${TAG} conta ${n} L${i}`);
      await animal(E1, l, "450"); await porContagem(E1, l, 2, "300");
      await ocupacao(E1, a, l, -5, null);
      await ocupacao(E1, a, passado, -40 - i * 3, -39 - i * 3);
      await objeto(E1, a, "cocho", `${TAG} conta ${n} cocho ${i}`);
      await manejo(E1, l, -2); await pesagem(E1, l, -1);
    }
    return R;
  }

  it("3 áreas e 30 áreas: mesmas consultas; nada por área", async () => {
    const R3 = await cenario(3);
    const R30 = await cenario(30);
    const p = await contar(`/api/mapa/operacional?retiro_id=${R3}`);
    const g = await contar(`/api/mapa/operacional?retiro_id=${R30}`);
    // premissas: o cenário inteiro chegou (verde sem dado é reprovação)
    expect([p.corpo.areas.length, p.corpo.objetos.length, g.corpo.areas.length, g.corpo.objetos.length]).toEqual([3, 3, 30, 30]);
    for (const c of [p.corpo, g.corpo]) {
      for (const a of c.areas) {
        expect([a.lotes.length, a.cabecas_total, a.ua_total, a.ultimo_manejo, a.ultima_pesagem, a.ultima_saida !== null], a.name).toEqual([1, 3, "2.33", dia(-2), dia(-1), true]);
      }
    }
    // áreas (1) + ocupações abertas e últimas saídas (2) + lote junto das abertas (1) + rebanho (animais e contagem numa: 1)
    // + objetos (1) + último manejo e última pesagem numa só (1); total: begin + 6 da rota + commit = 8
    // As duas contagens numa asserção só: quando falha, o diff mostra os DOIS números (3 e 30 áreas) lado a lado.
    const esperado = { total: 8, areas: 1, ocupacoes: 2, lotes: 1, animais: 1, contagem: 1, objetos: 1, manejos: 1, pesagens: 1 };
    expect({ tres: p.n, trinta: g.n }).toEqual({ tres: esperado, trinta: esperado });
  });
});

describe("MM-10c — filtros, 422, escopo de empresa e capacidade × escopo", () => {
  let RF: string; let RF2: string; let GMF: string;
  let F1: string; let F2: string; let F3: string; let F4: string; let F5: string; let Z: string;
  let OF1: string; let OF5: string; let OSOLTO: string; let OZ: string;

  beforeAll(async () => {
    RF = await retiro(E1); RF2 = await retiro(E1); GMF = await modulo(E1);
    // sem capacidade da estação: só a lotação máxima (UA total) decide — o resultado não depende do mês
    F1 = await area(E1, `${TAG} F1`, { retiro: RF, modulo: GMF, maxima: "2" });     // 1,20 ÷ 2    = 0,60 → dentro
    F2 = await area(E1, `${TAG} F2`, { retiro: RF, maxima: "1.25" });               // 1,20 ÷ 1,25 = 0,96 → proximo
    F3 = await area(E1, `${TAG} F3`, { retiro: RF, maxima: "1", uso: "ilp" });      // 1,20 ÷ 1    = 1,20 → acima
    F4 = await area(E1, `${TAG} F4`, { retiro: RF, uso: "lavoura" });               // sem referência
    F5 = await area(E1, `${TAG} F5`, { retiro: RF2, modulo: GMF, maxima: "100" });  // dentro
    Z = await area(E2, `${TAG} Z empresa 2`, { maxima: "100" });
    for (const [a, e] of [[F1, E1], [F2, E1], [F3, E1], [F5, E1], [Z, E2]] as const) {
      const l = await lote(e, `${TAG} lote de ${a.slice(0, 8)}`);
      await animal(e, l, "540"); // 1,20 UA
      await ocupacao(e, a, l, -6, null);
      if (a === F1) { await manejo(E1, l, -3); await pesagem(E1, l, -2); }
      if (a === Z) await manejo(E2, l, -3);
    }
    OF1 = await objeto(E1, F1, "cocho", `${TAG} obj F1`);
    OF5 = await objeto(E1, F5, "cocho", `${TAG} obj F5`);
    OSOLTO = await objeto(E1, null, "deposito_a_pasto", `${TAG} obj solto`);
    OZ = await objeto(E2, Z, "cocho", `${TAG} obj Z`);
  });

  it("retiro_id, grazing_module_id e land_use recortam no SQL; com filtro, só os objetos das áreas que passaram", async () => {
    const porRetiro = await ok(`/api/mapa/operacional?retiro_id=${RF}`);
    expect(ids(porRetiro.areas)).toEqual([F1, F2, F3, F4]);
    expect(ids(porRetiro.objetos)).toEqual([OF1]);
    const porModulo = await ok(`/api/mapa/operacional?grazing_module_id=${GMF}`);
    expect(ids(porModulo.areas)).toEqual([F1, F5]);
    expect(ids(porModulo.objetos)).toEqual([OF1, OF5]);
    expect(ids((await ok(`/api/mapa/operacional?retiro_id=${RF}&land_use=pastagem`)).areas)).toEqual([F1, F2]);
    expect(ids((await ok(`/api/mapa/operacional?retiro_id=${RF}&land_use=ilp`)).areas)).toEqual([F3]);
    expect(ids((await ok(`/api/mapa/operacional?retiro_id=${RF}&land_use=lavoura`)).areas)).toEqual([F4]);
    const ilp = await ok("/api/mapa/operacional?land_use=ilp");
    expect(ids(ilp.areas)).toContain(F3);
    expect(ilp.areas.every((a) => a.land_use === "ilp")).toBe(true);
    // filtro sem área nenhuma: nada, nem objeto solto
    const vazio = await ok(`/api/mapa/operacional?retiro_id=${RF2}&land_use=lavoura`);
    expect([vazio.areas.length, vazio.objetos.length]).toEqual([0, 0]);
    // sem filtro: as do retiro, a do outro retiro, o solto e os da empresa 2 (o dono vê tudo)
    const tudo = await ok("/api/mapa/operacional");
    expect(ids(tudo.areas)).toEqual(expect.arrayContaining([F1, F2, F3, F4, F5, Z]));
    expect(ids(tudo.objetos)).toEqual(expect.arrayContaining([OF1, OF5, OSOLTO, OZ]));
  });

  it("situacao: cada valor recorta depois das agregações (dentro, proximo, acima, sem_referencia)", async () => {
    const esperado: [string, string[]][] = [["dentro", [F1]], ["proximo", [F2]], ["acima", [F3]], ["sem_referencia", [F4]]];
    for (const [s, areas] of esperado) {
      const r = await ok(`/api/mapa/operacional?retiro_id=${RF}&situacao=${s}`);
      expect(ids(r.areas), s).toEqual(areas);
      expect(r.areas.map((a) => a.situacao_de_lotacao), s).toEqual([s === "sem_referencia" ? null : s]);
      expect(ids(r.objetos), s).toEqual(s === "dentro" ? [OF1] : []);
    }
    const dentro = await ok("/api/mapa/operacional?situacao=dentro");
    expect(ids(dentro.areas)).toEqual(expect.arrayContaining([F1, F5]));
    for (const fora of [F2, F3, F4]) expect(ids(dentro.areas)).not.toContain(fora);
    expect(dentro.areas.every((a) => a.situacao_de_lotacao === "dentro")).toBe(true);
    const sem = await ok("/api/mapa/operacional?situacao=sem_referencia");
    expect(ids(sem.areas)).toContain(F4);
    expect(sem.areas.every((a) => a.situacao_de_lotacao === null)).toBe(true);
  });

  it("parâmetro desconhecido ou fora da forma → 422", async () => {
    for (const qs of ["filtro=1", "situacao=cheia", "situacao=", "retiro_id=abc", "grazing_module_id=123", "land_use=marte", "page=1",
      `retiro_id=${RF}&retiro_id=${RF2}`, "empresa_id=" + E1]) {
      const r = await get(`/api/mapa/operacional?${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
      expect((r.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("membro só na empresa 1 não vê área nem objeto da empresa 2", async () => {
    const m = await membro("Operacional MM10 E1", ["batch_area.view", "map_objects.view", "nutritions.view", "weighings.view"], [E1]);
    const dono = await ok("/api/mapa/operacional");
    // premissa: o dono vê a área e o objeto da empresa 2, com manejo
    expect(achar(dono, Z).ultimo_manejo).toBe(dia(-3));
    expect(ids(dono.objetos)).toContain(OZ);
    const r = await ok("/api/mapa/operacional", m);
    expect(r.capacidades).toEqual({ objetos: true, manejo: true, pesagem: true, icones: false });
    expect(ids(r.areas)).toEqual(expect.arrayContaining([F1, F2, F3, F4, F5]));
    expect(ids(r.areas)).not.toContain(Z);
    expect(r.areas.every((a) => a.empresa_id === E1)).toBe(true);
    expect(ids(r.objetos)).toEqual(expect.arrayContaining([OF1, OF5, OSOLTO]));
    expect(ids(r.objetos)).not.toContain(OZ);
    expect(r.objetos.every((o) => o.empresa_id === E1)).toBe(true);
    expect(achar(r, F1)).toMatchObject({ ultimo_manejo: dia(-3), ultima_pesagem: dia(-2), cabecas_total: 1, ua_total: "1.20" });
  });

  it("sem map_objects.view → objetos []; sem a capacidade de manejo → ultimo_manejo null; sem a de pesagem → ultima_pesagem null; sem batch_area.view → 403", async () => {
    const soArea = await membro("Operacional MM10 so area", ["batch_area.view"], []);
    const comPesagem = await membro("Operacional MM10 pesagem", ["batch_area.view", "weighings.view"], []);
    const semArea = await membro("Operacional MM10 sem area", ["map_objects.view", "nutritions.view", "weighings.view"], []);
    // premissa: o dono vê os objetos e o manejo/pesagem de F1
    const dono = await ok(`/api/mapa/operacional?retiro_id=${RF}`);
    expect(ids(dono.objetos)).toEqual([OF1]);
    expect(achar(dono, F1)).toMatchObject({ ultimo_manejo: dia(-3), ultima_pesagem: dia(-2) });

    const a = await ok(`/api/mapa/operacional?retiro_id=${RF}`, soArea);
    expect(a.capacidades).toEqual({ objetos: false, manejo: false, pesagem: false, icones: false });
    expect(a.objetos).toEqual([]);
    expect(ids(a.areas)).toEqual([F1, F2, F3, F4]);
    expect(a.areas.map((x) => [x.ultimo_manejo, x.ultima_pesagem])).toEqual([[null, null], [null, null], [null, null], [null, null]]);
    // o resto da área continua igual ao do dono (capacidade não mexe em lotação); sem icon_config.view o ícone é null
    expect(a.areas.map((x) => ({ ...x, ultimo_manejo: null, ultima_pesagem: null }))).toEqual(dono.areas.map((x) => ({ ...x, ultimo_manejo: null, ultima_pesagem: null, icone: null })));

    const p = await ok(`/api/mapa/operacional?retiro_id=${RF}`, comPesagem);
    expect(p.capacidades).toEqual({ objetos: false, manejo: false, pesagem: true, icones: false });
    expect(p.objetos).toEqual([]);
    expect(achar(p, F1)).toMatchObject({ ultimo_manejo: null, ultima_pesagem: dia(-2) });

    const r = await get("/api/mapa/operacional", semArea);
    expect(r.statusCode, r.body).toBe(403);
  });
});
