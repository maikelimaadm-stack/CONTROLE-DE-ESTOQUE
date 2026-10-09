import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, seedDemo, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-01 (decisão 305) — a leitura da ocupação de UMA área (MM-8a..MM-8c).
 *
 *   GET /api/mapa/areas/:areaId/ocupacao            abertas, últimas fechadas, descanso, lotação, rodízio
 *   GET /api/mapa/areas/:areaId/ocupacao/historico  o histórico inteiro, paginado no servidor
 *
 * O cenário é semeado pela conexão TESTEMUNHA (superusuário), com datas relativas ao `current_date` DO BANCO: o
 * esperado de cada número sai das datas semeadas, não do relógio do Node. A API lê como `erp_app` (sem bypass de RLS).
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
const TAG = `MM8${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const unico = () => `${TAG}-${++seq}`;
let E1: string; let E2: string; let especie: string; let categoria: string;
let hoje: string;
/** `hoje + n` dias, aritmética de calendário em UTC (o mesmo dia civil do banco). */
const dia = (n: number) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** A estação esperada pelo MÊS de hoje (águas de outubro a março) — conferência independente da do domínio. */
const estacaoEsperada = () => { const mes = Number(hoje.slice(5, 7)); return mes >= 10 || mes <= 3 ? "aguas" : "seca"; };

const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
const POLIGONO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };

const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers });
async function ok<T>(url: string, headers?: Hdr): Promise<T> { const r = await get(url, headers); expect(r.statusCode, `${url}: ${r.body}`).toBe(200); return r.json() as T; }

async function membro(nome: string, perms: string[], empresas: readonly string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico().toLowerCase().replace(/\W+/g, "")}@mm8.local`;
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
async function modulo(empresa: string, restDays: number | null, occupationDays: number | null): Promise<string> {
  return id(`insert into erp.grazing_modules (organization_id, empresa_id, code, module_date, description, rest_days, occupation_days)
             values ($1,$2,$3,current_date,$4,$5,$6) returning id`, [h.demo.orgId, empresa, unico(), `Módulo ${TAG}`, restDays, occupationDays]);
}
type OpcoesArea = { areaHa?: string; usavel?: string; aguas?: string | null; seca?: string | null; maxima?: string | null; modulo?: string | null; org?: string };
async function area(empresa: string, nome: string, o: OpcoesArea = {}): Promise<string> {
  return id(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure,
                                    support_capacity_rainy_ua_ha, support_capacity_dry_ua_ha, max_stocking_ua, grazing_module_id, geometria)
             values ($1,$2,$3,$4,$5,$6,'pastagem','ativa','propria',$7,$8,$9,$10,$11::jsonb) returning id`,
    [o.org ?? h.demo.orgId, empresa, unico(), nome, o.areaHa ?? "10", o.usavel ?? o.areaHa ?? "10", o.aguas ?? null, o.seca ?? null, o.maxima ?? null, o.modulo ?? null, JSON.stringify(POLIGONO)]);
}
type Lote = { id: string; code: string; description: string };
async function lote(empresa: string, nome: string): Promise<Lote> {
  const code = unico();
  const r = await admin.query<{ id: string }>(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, status)
                                               values ($1,$2,$3,current_date,$4,$5,'pasture','active') returning id`, [h.demo.orgId, empresa, code, nome, especie]);
  return { id: r.rows[0]!.id, code, description: nome };
}
/** Animal ativo do lote; peso nulo = sem pesagem (vale o fator da categoria, 0.75). */
async function animal(empresa: string, l: Lote, peso: string | null) {
  await admin.query(`insert into erp.animals (organization_id, empresa_id, species_id, category_id, batch_id, sex, entry_date, current_weight, status)
                     values ($1,$2,$3,$4,$5,'M',current_date,$6,'active')`, [h.demo.orgId, empresa, especie, categoria, l.id, peso]);
}
async function porContagem(empresa: string, l: Lote, quantidade: number, pesoMedio: string | null) {
  await admin.query(`insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, quantity, average_weight, entry_date)
                     values ($1,$2,$3,$4,$5,$6,$7,current_date)`, [h.demo.orgId, empresa, l.id, especie, categoria, quantidade, pesoMedio]);
}
type OpcoesOcupacao = { origem?: string; motivo?: string | null; cabecas?: number | null; ua?: string | null; excluida?: boolean };
async function ocupacao(empresa: string, areaId: string, l: Lote, inicio: number, fim: number | null, o: OpcoesOcupacao = {}): Promise<string> {
  return id(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data, motivo_saida,
                                               cabecas_na_entrada, ua_na_entrada, deleted_at)
             values ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10, case when $11 then now() end) returning id`,
    [h.demo.orgId, empresa, areaId, l.id, dia(inicio), fim === null ? null : dia(fim), o.origem ?? "movimento",
     fim === null ? null : (o.motivo ?? "transferencia"), o.cabecas ?? null, o.ua ?? null, o.excluida ?? false]);
}

type LoteDto = { id: string; code: string | null; description: string | null };
type Aberta = { id: string; lote: LoteDto; cabecas: number; ua: string; cabecas_na_entrada: number | null; ua_na_entrada: string | null; data_inicio: string; origem_da_data: string; dias_de_ocupacao: number };
type Fechada = { id: string; lote: LoteDto; data_inicio: string; data_fim: string; origem_da_data: string; motivo_saida: string; dias_de_ocupacao: number };
type Comparacao = { planejado: number | null; ultimo: number | null; medio: string | null; diferencaUltimo: number | null };
type Ocupacao = {
  hoje: string;
  area: Record<string, unknown> & { id: string };
  abertas: Aberta[]; fechadas: Fechada[];
  ultima_saida: string | null; dias_de_descanso: number | null; cabecas_total: number; ua_total: string;
  estacao: string; ua_por_hectare: string | null; capacidade_da_estacao: string | null; situacao_de_lotacao: string | null;
  rodizio: { ciclos: { inicio: string; fim: string | null; diasOcupacao: number; diasDescansoAntes: number | null }[]; ocupacao: Comparacao; descanso: Comparacao } | null;
};
type Historico = { items: (Fechada & { data_fim: string | null; cabecas_na_entrada: number | null; ua_na_entrada: string | null })[]; total: number; page: number; pageSize: number; hoje: string };
const dtoLote = (l: Lote): LoteDto => ({ id: l.id, code: l.code, description: l.description });

type Contagem = { total: number; areas: number; ocupacoes: number; animais: number; contagem: number; lotes: number; modulos: number };
/**
 * Conta as consultas de UMA requisição, no total e por tabela citada. Antes, a mesma requisição sem contar: o contexto do
 * usuário (vínculo, permissões, escopos) fica em cache por 30 s no plugin de autenticação, e a contagem tem de medir a
 * ROTA, não o cache frio.
 */
async function contar<T>(url: string, headers: Hdr = h.headers()): Promise<{ n: Contagem; corpo: T }> {
  await ok<T>(url, headers);
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const corpo = await ok<T>(url, headers);
    const sqls = espiao.mock.calls.map((c) => c[0]).filter((x): x is string => typeof x === "string");
    const de = (forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
    return {
      corpo,
      n: {
        total: espiao.mock.calls.length,
        areas: de(/erp\.areas\b/), ocupacoes: de(/erp\.ocupacoes_de_area\b/), animais: de(/erp\.animals\b/),
        contagem: de(/erp\.herd_lots\b/), lotes: de(/erp\.batches\b/), modulos: de(/erp\.grazing_modules\b/)
      }
    };
  } finally { espiao.mockRestore(); }
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2).not.toBe(E1);
  hoje = (await admin.query<{ d: string }>("select current_date::text as d")).rows[0]!.d;
  especie = (await admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]!.id;
  categoria = await id("insert into erp.animal_categories (organization_id, species_id, name, ua_factor) values ($1,$2,$3,0.75) returning id", [h.demo.orgId, especie, `Categoria ${TAG}`]);
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("MM-8a — GET ocupação: dias de ocupação, descanso, UA/ha pela área útil, estação, situação e rodízio", () => {
  it("cada número confere com o dado semeado (strings decimais e inteiros exatos)", async () => {
    // Módulo planejado: 30 dias de descanso, 7 de ocupação.
    const gm = await modulo(E1, 30, 7);
    // Área total 20 ha, útil 16 ha: a UA/ha tem de sair por 16 (pela área total daria outro número).
    const A = await area(E1, `${TAG} A ocupada`, { areaHa: "20", usavel: "16", aguas: "1.5", seca: "0.8", maxima: "30", modulo: gm });

    // L1: pesados 450 + 360 (animais) + 10 × 405 (contagem) = 4860 kg → 10,8 UA; sem peso: 1 animal + 4 por contagem,
    // fator 0,75 → 3,75 UA. Total 14,55 UA; 3 + 14 = 17 cabeças.
    const L1 = await lote(E1, `${TAG} Lote 1`);
    await animal(E1, L1, "450"); await animal(E1, L1, "360"); await animal(E1, L1, null);
    await porContagem(E1, L1, 10, "405"); await porContagem(E1, L1, 4, null);
    // L2: 540 kg → 1,20 UA; 1 cabeça.
    const L2 = await lote(E1, `${TAG} Lote 2`);
    await animal(E1, L2, "540");
    const L3 = await lote(E1, `${TAG} Lote 3`); const L4 = await lote(E1, `${TAG} Lote 4`); const L5 = await lote(E1, `${TAG} Lote 5`);

    const f1 = await ocupacao(E1, A, L3, -60, -50, { origem: "entrada_do_lote", motivo: "transferencia" });
    const f2 = await ocupacao(E1, A, L4, -40, -33, { origem: "movimento", motivo: "encerramento_do_lote" });
    const f3 = await ocupacao(E1, A, L3, -25, -20, { origem: "movimento", motivo: "transferencia" });
    const f4 = await ocupacao(E1, A, L4, -22, -18, { origem: "informada", motivo: "correcao" });
    const a1 = await ocupacao(E1, A, L1, -12, null, { origem: "informada", cabecas: 15, ua: "12.40" });
    const a2 = await ocupacao(E1, A, L2, -3, null, { origem: "movimento" });
    // excluída: não entra em nada (nem fechadas, nem última saída, nem rodízio)
    await ocupacao(E1, A, L5, -80, -5, { excluida: true });

    const r = await ok<Ocupacao>(`/api/mapa/areas/${A}/ocupacao`);
    expect(r.hoje).toBe(hoje);
    expect(r.area).toEqual({
      id: A, empresa_id: E1, code: expect.any(String), name: `${TAG} A ocupada`, area_ha: "20.0000", usable_area_ha: "16.0000",
      land_use: "pastagem", status: "ativa", retiro_id: null, grazing_module_id: gm,
      support_capacity_rainy_ua_ha: "1.500", support_capacity_dry_ua_ha: "0.800", max_stocking_ua: "30.00"
    });
    // abertas: as duas, mais recente primeiro; cabeças e UA de AGORA, números da entrada congelados
    expect(r.abertas).toEqual([
      { id: a2, lote: dtoLote(L2), cabecas: 1, ua: "1.20", cabecas_na_entrada: null, ua_na_entrada: null, data_inicio: dia(-3), origem_da_data: "movimento", dias_de_ocupacao: 3 },
      { id: a1, lote: dtoLote(L1), cabecas: 17, ua: "14.55", cabecas_na_entrada: 15, ua_na_entrada: "12.40", data_inicio: dia(-12), origem_da_data: "informada", dias_de_ocupacao: 12 }
    ]);
    // fechadas: as 4 vivas, a que fechou por último primeiro; período inclusivo, dias = fim − início
    expect(r.fechadas).toEqual([
      { id: f4, lote: dtoLote(L4), data_inicio: dia(-22), data_fim: dia(-18), origem_da_data: "informada", motivo_saida: "correcao", dias_de_ocupacao: 4 },
      { id: f3, lote: dtoLote(L3), data_inicio: dia(-25), data_fim: dia(-20), origem_da_data: "movimento", motivo_saida: "transferencia", dias_de_ocupacao: 5 },
      { id: f2, lote: dtoLote(L4), data_inicio: dia(-40), data_fim: dia(-33), origem_da_data: "movimento", motivo_saida: "encerramento_do_lote", dias_de_ocupacao: 7 },
      { id: f1, lote: dtoLote(L3), data_inicio: dia(-60), data_fim: dia(-50), origem_da_data: "entrada_do_lote", motivo_saida: "transferencia", dias_de_ocupacao: 10 }
    ]);
    // a última saída é −18 (a excluída, que "saiu" em −5, não conta); ocupada → sem descanso
    expect([r.ultima_saida, r.dias_de_descanso]).toEqual([dia(-18), null]);
    expect([r.cabecas_total, r.ua_total]).toEqual([18, "15.75"]);
    // 15,75 ÷ 16 = 0,984375 → "0.98" (por 20 ha seria "0.79")
    expect(r.ua_por_hectare).toBe("0.98");
    const estacao = estacaoEsperada();
    expect(r.estacao).toBe(estacao);
    // águas: 0,98 ÷ 1,5 = 0,65 e 15,75 ÷ 30 = 0,53 → dentro; seca: 0,98 ÷ 0,8 = 1,225 → acima
    expect([r.capacidade_da_estacao, r.situacao_de_lotacao]).toEqual(estacao === "aguas" ? ["1.500", "dentro"] : ["0.800", "acima"]);
    // rodízio: ciclos [−60,−50] [−40,−33] [−25,−18] (dois lotes que se sobrepõem) [−12, aberto] (absorve o −3)
    expect(r.rodizio).toEqual({
      ciclos: [
        { inicio: dia(-60), fim: dia(-50), diasOcupacao: 10, diasDescansoAntes: null },
        { inicio: dia(-40), fim: dia(-33), diasOcupacao: 7, diasDescansoAntes: 10 },
        { inicio: dia(-25), fim: dia(-18), diasOcupacao: 7, diasDescansoAntes: 8 },
        { inicio: dia(-12), fim: null, diasOcupacao: 12, diasDescansoAntes: 6 }
      ],
      ocupacao: { planejado: 7, ultimo: 12, medio: "8.0", diferencaUltimo: 5 },
      descanso: { planejado: 30, ultimo: 6, medio: "8.0", diferencaUltimo: -24 }
    });

    // ?fechadas=2: só as duas que fecharam por último; o resto não muda
    const duas = await ok<Ocupacao>(`/api/mapa/areas/${A}/ocupacao?fechadas=2`);
    expect(duas.fechadas.map((x) => x.id)).toEqual([f4, f3]);
    expect({ ...duas, fechadas: [] }).toEqual({ ...r, fechadas: [] });
  });

  it("área vazia com descanso (sem módulo, sem referência) e área nunca ocupada (com módulo)", async () => {
    const B = await area(E1, `${TAG} B vazia`, { areaHa: "12", usavel: "10" });
    const L6 = await lote(E1, `${TAG} Lote 6`);
    const f = await ocupacao(E1, B, L6, -30, -9, { origem: "criacao_do_lote", motivo: "encerramento_do_lote" });
    const rb = await ok<Ocupacao>(`/api/mapa/areas/${B}/ocupacao`);
    expect(rb).toMatchObject({
      abertas: [], ultima_saida: dia(-9), dias_de_descanso: 9, cabecas_total: 0, ua_total: "0.00", ua_por_hectare: "0.00",
      capacidade_da_estacao: null, situacao_de_lotacao: null, rodizio: null
    });
    expect(rb.fechadas).toEqual([{ id: f, lote: dtoLote(L6), data_inicio: dia(-30), data_fim: dia(-9), origem_da_data: "criacao_do_lote", motivo_saida: "encerramento_do_lote", dias_de_ocupacao: 21 }]);

    const gm = await modulo(E1, 40, 5);
    const C = await area(E1, `${TAG} C nunca`, { maxima: "10", modulo: gm });
    const rc = await ok<Ocupacao>(`/api/mapa/areas/${C}/ocupacao`);
    expect(rc).toMatchObject({
      abertas: [], fechadas: [], ultima_saida: null, dias_de_descanso: null, cabecas_total: 0, ua_total: "0.00", ua_por_hectare: "0.00",
      situacao_de_lotacao: "dentro"
    });
    expect(rc.rodizio).toEqual({
      ciclos: [],
      ocupacao: { planejado: 5, ultimo: null, medio: null, diferencaUltimo: null },
      descanso: { planejado: 40, ultimo: null, medio: null, diferencaUltimo: null }
    });
  });

  it("parâmetro fora da forma ou desconhecido → 422", async () => {
    const A = await area(E1, `${TAG} 422`);
    for (const qs of ["fechadas=0", "fechadas=51", "fechadas=1e1", "fechadas=05", "fechadas=", "outro=1", "fechadas=2&fechadas=3"]) {
      const r = await get(`/api/mapa/areas/${A}/ocupacao?${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
      expect((r.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
    // premissa: o mesmo sem o parâmetro responde
    expect((await get(`/api/mapa/areas/${A}/ocupacao?fechadas=50`)).statusCode).toBe(200);
  });
});

describe("MM-8b — número de consultas FIXO, contado", () => {
  /** Área com `lotes` abertos (cada um com 2 animais e um rebanho por contagem) e `fechadas` ocupações fechadas. */
  async function cenario(lotes: number, fechadas: number): Promise<string> {
    const A = await area(E1, `${TAG} conta ${lotes}x${fechadas}`, { areaHa: "50", usavel: "40", aguas: "2", seca: "1", maxima: "100", modulo: await modulo(E1, 30, 7) });
    for (let i = 0; i < lotes; i++) {
      const l = await lote(E1, `${TAG} conta L${i}`);
      await animal(E1, l, "450"); await animal(E1, l, null); await porContagem(E1, l, 3, "300");
      await ocupacao(E1, A, l, -(i + 1), null);
    }
    const passado = await lote(E1, `${TAG} conta passado`);
    for (let i = 0; i < fechadas; i++) await ocupacao(E1, A, passado, -200 + i * 5, -200 + i * 5 + 2);
    return A;
  }

  it("1 lote e 2 fechadas, 5 lotes e 20 fechadas, com o dono e com membro restrito: as mesmas consultas", async () => {
    const P = await cenario(1, 2);
    const G = await cenario(5, 20);
    const restrito = await membro("Ocupacao MM8b", ["batch_area.view"], [E1]);
    const p = await contar<Ocupacao>(`/api/mapa/areas/${P}/ocupacao`);
    const g = await contar<Ocupacao>(`/api/mapa/areas/${G}/ocupacao`);
    const g50 = await contar<Ocupacao>(`/api/mapa/areas/${G}/ocupacao?fechadas=50`);
    // premissas: o cenário chegou inteiro na resposta (verde sem dado é reprovação)
    expect([p.corpo.abertas.length, p.corpo.fechadas.length, p.corpo.rodizio?.ciclos.length]).toEqual([1, 2, 3]);
    expect([g.corpo.abertas.length, g.corpo.fechadas.length, g50.corpo.fechadas.length, g.corpo.rodizio?.ciclos.length]).toEqual([5, 5, 20, 21]);
    expect([p.corpo.cabecas_total, g.corpo.cabecas_total]).toEqual([5, 25]);
    // área + módulo (1), ocupações (abertas/fechadas e rodízio: 2), rebanho (animais e contagem numa: 1), lote (1);
    // no total, begin + as 4 da rota + commit = 6
    // As contagens numa asserção só: quando falha, o diff mostra os números de cada cenário lado a lado.
    const esperado = { total: 6, areas: 1, ocupacoes: 2, animais: 1, contagem: 1, lotes: 1, modulos: 1 };
    expect({ umLote: p.n, cincoLotes: g.n, cincoLotes50Fechadas: g50.n }).toEqual({ umLote: esperado, cincoLotes: esperado, cincoLotes50Fechadas: esperado });
    // membro com escopo selecionado (o exists do escopo entra DENTRO das mesmas consultas)
    const pr = await contar<Ocupacao>(`/api/mapa/areas/${P}/ocupacao`, restrito);
    const gr = await contar<Ocupacao>(`/api/mapa/areas/${G}/ocupacao`, restrito);
    expect(pr.corpo.abertas.length).toBe(1); expect(gr.corpo.abertas.length).toBe(5);
    expect({ umLote: pr.n, cincoLotes: gr.n }).toEqual({ umLote: esperado, cincoLotes: esperado });
  });
});

describe("MM-8c — histórico paginado no servidor; a mesma 404 para quem não deve ver", () => {
  it("total, páginas, ordem data_inicio desc, id desc; excluída fora", async () => {
    const H = await area(E1, `${TAG} H historico`);
    const lotes = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => lote(E1, `${TAG} H L${i}`)));
    const semeadas: { id: string; inicio: string }[] = [];
    const inicios = [-70, -60, -50, -50, -30, -20, -4]; // dois no mesmo dia: o desempate é o id
    for (let i = 0; i < 7; i++) {
      const aberta = i === 6;
      const oid = await ocupacao(E1, H, lotes[i]!, inicios[i]!, aberta ? null : inicios[i]! + 3);
      semeadas.push({ id: oid, inicio: dia(inicios[i]!) });
    }
    await ocupacao(E1, H, lotes[0]!, -100, -90, { excluida: true });
    const esperada = [...semeadas].sort((a, b) => (a.inicio !== b.inicio ? (a.inicio < b.inicio ? 1 : -1) : a.id < b.id ? 1 : -1)).map((x) => x.id);
    // premissa: a ordem do banco para uuid é a mesma da comparação de texto em minúsculas
    const ordemBanco = (await admin.query<{ id: string }>("select id::text as id from erp.ocupacoes_de_area where area_id=$1 and deleted_at is null order by data_inicio desc, id desc", [H])).rows.map((x) => x.id);
    expect(ordemBanco).toEqual(esperada);

    const p1 = await ok<Historico>(`/api/mapa/areas/${H}/ocupacao/historico?pageSize=3`);
    const p2 = await ok<Historico>(`/api/mapa/areas/${H}/ocupacao/historico?page=2&pageSize=3`);
    const p3 = await ok<Historico>(`/api/mapa/areas/${H}/ocupacao/historico?page=3&pageSize=3`);
    const p4 = await ok<Historico>(`/api/mapa/areas/${H}/ocupacao/historico?page=4&pageSize=3`);
    expect([p1.total, p2.total, p3.total, p4.total]).toEqual([7, 7, 7, 7]);
    expect([p1.items.length, p2.items.length, p3.items.length, p4.items.length]).toEqual([3, 3, 1, 0]);
    expect([p1.page, p1.pageSize, p2.page, p3.page]).toEqual([1, 3, 2, 3]);
    expect([...p1.items, ...p2.items, ...p3.items].map((x) => x.id)).toEqual(esperada);
    expect(p2.items.map((x) => x.id)).toEqual(esperada.slice(3, 6));
    // a aberta (−4) é a primeira, sem fim e contando até hoje; uma fechada conta fim − início
    expect(p1.items[0]).toMatchObject({ id: semeadas[6]!.id, lote: dtoLote(lotes[6]!), data_inicio: dia(-4), data_fim: null, motivo_saida: null, dias_de_ocupacao: 4 });
    expect(p3.items[0]).toMatchObject({ id: semeadas[0]!.id, data_inicio: dia(-70), data_fim: dia(-67), motivo_saida: "transferencia", dias_de_ocupacao: 3 });
    // sem parâmetro: a página padrão da casa (20) traz as 7
    const tudo = await ok<Historico>(`/api/mapa/areas/${H}/ocupacao/historico`);
    expect([tudo.page, tudo.pageSize, tudo.total, tudo.items.length]).toEqual([1, 20, 7, 7]);
    // consultas fixas: a página de 3 e a de 20 fazem as mesmas (área + total numa, a página na outra; o lote vem junto)
    const c3 = await contar<Historico>(`/api/mapa/areas/${H}/ocupacao/historico?pageSize=3`);
    const c20 = await contar<Historico>(`/api/mapa/areas/${H}/ocupacao/historico`);
    expect([c3.corpo.items.length, c20.corpo.items.length]).toEqual([3, 7]);
    const fixas = { total: 4, areas: 1, ocupacoes: 2, animais: 0, contagem: 0, lotes: 1, modulos: 0 };
    expect({ pagina3: c3.n, pagina20: c20.n }).toEqual({ pagina3: fixas, pagina20: fixas });
    for (const qs of ["pageSize=0", "page=0", "page=abc", "pageSize=1001", "sort=data_inicio", "fechadas=2"]) {
      const r = await get(`/api/mapa/areas/${H}/ocupacao/historico?${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
    }
  });

  it("inexistente, outra organização, fora do escopo, excluída e id malformado: a MESMA 404 nas duas rotas; sem capacidade, 403", async () => {
    const restrito = await membro("Ocupacao MM8c", ["batch_area.view"], [E1]);
    const semCapacidade = await membro("Ocupacao MM8c sem", ["weighings.view"], []);
    const dentro = await area(E1, `${TAG} escopo E1`);
    const foraDoEscopo = await area(E2, `${TAG} escopo E2`);
    const excluida = await area(E1, `${TAG} excluida`);
    await admin.query("update erp.areas set deleted_at = now() where id = $1", [excluida]);
    const outra = await seedDemo(admin, { orgName: "[TEST] Org MM8", adminEmail: "admin-mm8@demo.local", adminPassword: "Demo@12345", slug: "orgmm8" }, () => {});
    const deOutraOrg = await area(outra.empresaIds[0]!, `${TAG} outra org`, { org: outra.orgId });
    // premissa: o dono enxerga as duas empresas; o restrito enxerga a de dentro
    for (const a of [dentro, foraDoEscopo]) expect((await get(`/api/mapa/areas/${a}/ocupacao`)).statusCode).toBe(200);
    expect((await get(`/api/mapa/areas/${dentro}/ocupacao`, restrito)).statusCode).toBe(200);
    expect((await get(`/api/mapa/areas/${dentro}/ocupacao/historico`, restrito)).statusCode).toBe(200);

    const casos: [string, string, Hdr][] = [
      ["inexistente", NAO_ACHADO, h.headers()],
      ["outra organização", deOutraOrg, h.headers()],
      ["fora do escopo", foraDoEscopo, restrito],
      ["excluída", excluida, h.headers()],
      ["id malformado", "nao-e-uuid", h.headers()]
    ];
    const corpos = new Set<string>();
    for (const sufixo of ["ocupacao", "ocupacao/historico"]) {
      for (const [nome, alvo, headers] of casos) {
        const r = await get(`/api/mapa/areas/${alvo}/${sufixo}`, headers);
        expect(r.statusCode, `${sufixo} ${nome}: ${r.body}`).toBe(404);
        corpos.add(r.body);
      }
    }
    expect([...corpos]).toEqual([JSON.stringify({ error: { code: "NOT_FOUND", message: "Área não encontrada" } })]);
    // sem batch_area.view: 403 antes de qualquer leitura (inclusive para a área que existe)
    for (const sufixo of ["ocupacao", "ocupacao/historico"]) {
      expect((await get(`/api/mapa/areas/${dentro}/${sufixo}`, semCapacidade)).statusCode).toBe(403);
    }
  });
});
