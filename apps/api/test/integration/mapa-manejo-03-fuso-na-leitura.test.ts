import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { ENUM_LABELS, MODOS_DE_COLORACAO } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-03 (decisão 307) — o FUSO NA LEITURA: as três leituras do Mapa de Manejo contam os dias pelo dia da
 * EMPRESA DA ÁREA, `(now() at time zone e.fuso_horario)::date`, e não pelo `current_date` da sessão do banco (UTC).
 *
 *   MM3-1a GET /api/mapa/areas/:id/ocupacao — a expressão da rota = `erp.dia_no_fuso` em instante FIXO (22h e 14h de
 *          Cuiabá, o mesmo dia) e, com o relógio vivo, `hoje`, dias de ocupação e de descanso pelo dia da empresa
 *   MM3-1b GET /api/mapa/areas/:id/ocupacao/historico — `hoje` e os dias da aberta pelo dia da empresa
 *   MM3-1c GET /api/mapa/operacional?coloracao=situacao_pasto — a faixa no limite 45/46 pelo dia da empresa da área
 *   MM3-1d a empresa de São Paulo inalterada na MESMA resposta; o topo é o dia MAIS ANTIGO das empresas do escopo
 *   MM3-2a consultas CONTADAS: as mesmas de antes (8, 6 e 4); `erp.empresas` nunca numa consulta própria
 *   MM3-2b chaves (nome e tipo) das três respostas = constantes escritas aqui; nenhuma nova, nenhuma removida
 *
 * O RELÓGIO é o MESMO método da 02 (packages/db/test/mapa-manejo-02-0062.test.ts, MM2-1c e `fusoDoCaso`): instante
 * FIXO para a regra; para a rota, o relógio vivo com a empresa 1 num fuso escolhido NA HORA para que o dia local
 * DIFIRA do dia UTC (hora UTC < 11 → Etc/GMT+12, ainda é ontem; senão Pacific/Kiritimati, já é amanhã), com a
 * premissa conferida. Assim a rota que voltasse ao `current_date` reprova nos DOIS ramos (o oeste dá +1, o leste −1).
 * A empresa 1 volta para America/Sao_Paulo no afterAll (os arquivos de integração rodam em sequência no mesmo banco).
 *
 * Semeadura pela conexão TESTEMUNHA (superusuário); as datas das ocupações são relativas ao dia da empresa DONA da
 * área (o mesmo que a rota usa). A API lê como `erp_app` (sem bypass de RLS).
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
const TAG = `MM3${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const unico = () => `${TAG}-${++seq}`;
const SP = "America/Sao_Paulo";
let E1: string; let E2: string; let especie: string; let categoria: string;
/** O fuso do caso (posto na empresa 1), o dia local nele e o dia UTC no momento da escolha. */
let caso: { fuso: string; local: string; utc: string };
/** O dia da empresa 1 no fuso do caso (o `hoje` que a rota tem de devolver para as áreas dela). */
let diaLocal: string;
/** `base + n` dias, aritmética de calendário em UTC (só data civil, sem relógio). */
const mais = (base: string, n: number) => { const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const local = (n: number) => mais(diaLocal, n);
/** A estação pelo MÊS (águas de outubro a março) — conferência independente da do domínio. */
const estacaoDe = (d: string) => { const mes = Number(d.slice(5, 7)); return mes >= 10 || mes <= 3 ? "aguas" : "seca"; };

/** A expressão do dia como está na ROTA (as três leituras); a parte fixa a avalia com instante e fuso dados. */
const EXPRESSAO_DA_ROTA = "(now() at time zone e.fuso_horario)::date";

const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers });
async function ok<T>(url: string, headers?: Hdr): Promise<T> { const r = await get(url, headers); expect(r.statusCode, `${url}: ${r.body}`).toBe(200); return r.json() as T; }

async function membro(nome: string, perms: string[], empresas: readonly string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico().toLowerCase().replace(/\W+/g, "")}@mm3.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

// ---------- o fuso e o dia das empresas (testemunha) ----------
const fusoDe = async (empresa: string) =>
  (await admin.query<{ f: string }>("select fuso_horario f from erp.empresas where id=$1", [empresa])).rows[0]!.f;
/** O dia da empresa pela MESMA regra da rota. */
const diaDaEmpresa = async (empresa: string) =>
  (await admin.query<{ d: string }>("select (now() at time zone fuso_horario)::date::text d from erp.empresas where id=$1", [empresa])).rows[0]!.d;
/** Muda o fuso da empresa e confere que UMA linha mudou (gravação confere ROW COUNT) e que o valor ficou. */
async function fusoDa(empresa: string, fuso: string) {
  const r = await admin.query("update erp.empresas set fuso_horario=$2 where id=$1", [empresa, fuso]);
  expect(r.rowCount, `fuso ${fuso} na empresa ${empresa}`).toBe(1);
  expect(await fusoDe(empresa)).toBe(fuso);
}
/**
 * O fuso do caso, escolhido AGORA para que o dia local DIFIRA do dia UTC: hora UTC < 11 → Etc/GMT+12 (UTC−12: ainda é
 * ontem; a meia-noite local é às 12h UTC, uma hora de folga no mínimo); senão Pacific/Kiritimati (UTC+14: já é amanhã;
 * a meia-noite local é às 10h UTC do dia seguinte). Premissas conferidas: a sessão do banco que a API usa roda em UTC
 * (o `current_date` dela é o dia UTC — o que a rota antiga devolveria) e o dia local difere dele.
 */
async function fusoDoCaso(): Promise<{ fuso: string; local: string; utc: string }> {
  const r = (await h.db.query<{ h: number; utc: string; hoje: string; tz: string }>(
    "select extract(hour from now() at time zone 'UTC')::int h, (now() at time zone 'UTC')::date::text utc, current_date::text hoje, current_setting('TimeZone') tz")).rows[0]!;
  expect(r.hoje, `premissa: a sessão da API (TimeZone ${r.tz}) tem current_date = dia UTC`).toBe(r.utc);
  const fuso = r.h < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
  const dia = (await h.db.query<{ d: string }>("select (now() at time zone $1::text)::date::text d", [fuso])).rows[0]!.d;
  expect(dia, `premissa: no fuso ${fuso} o dia local (${dia}) difere do dia UTC (${r.utc})`).not.toBe(r.utc);
  return { fuso, local: dia, utc: r.utc };
}

// ---------- semeadura (testemunha) ----------
const id = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0]!.id;
const uma = async (sql: string, params: unknown[]) => { const r = await admin.query(sql, params); expect(r.rowCount, sql).toBe(1); };
const retiro = (empresa: string) =>
  id("insert into erp.retiros (organization_id, empresa_id, code, name) values ($1,$2,$3,$4) returning id", [h.demo.orgId, empresa, unico(), `Retiro ${TAG}`]);
const modulo = (empresa: string) =>
  id(`insert into erp.grazing_modules (organization_id, empresa_id, code, module_date, description, rest_days, occupation_days)
      values ($1,$2,$3,current_date,$4,30,7) returning id`, [h.demo.orgId, empresa, unico(), `Módulo ${TAG}`]);
const QUADRADO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };
const PONTO = { type: "Point", coordinates: [-55.001, -15.001] };
type OpcoesArea = { usavel?: string; retiro?: string | null; modulo?: string | null };
const area = (empresa: string, nome: string, o: OpcoesArea = {}) =>
  id(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, retiro_id, grazing_module_id, geometria)
      values ($1,$2,$3,$4,10,$5,'pastagem','ativa','propria',$6,$7,$8::jsonb) returning id`,
    [h.demo.orgId, empresa, unico(), nome, o.usavel ?? "10", o.retiro ?? null, o.modulo ?? null, JSON.stringify(QUADRADO)]);
const lote = (empresa: string, nome: string) =>
  id(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, status)
      values ($1,$2,$3,current_date,$4,$5,'pasture','active') returning id`, [h.demo.orgId, empresa, unico(), nome, especie]);
/** Animal sem peso: a UA é o fator da categoria (1). */
const animal = (empresa: string, loteId: string) =>
  uma(`insert into erp.animals (organization_id, empresa_id, species_id, category_id, batch_id, sex, entry_date, current_weight, status)
       values ($1,$2,$3,$4,$5,'M',current_date,null,'active')`, [h.demo.orgId, empresa, especie, categoria, loteId]);
const porContagem = (empresa: string, loteId: string, quantidade: number) =>
  uma(`insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, quantity, average_weight, entry_date)
       values ($1,$2,$3,$4,$5,$6,null,current_date)`, [h.demo.orgId, empresa, loteId, especie, categoria, quantidade]);
/** Ocupação com datas CIVIS dadas (o chamador as tira do dia da empresa dona da área). */
const ocupacao = (empresa: string, areaId: string, loteId: string, inicio: string, fim: string | null) =>
  id(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data, motivo_saida)
      values ($1,$2,$3,$4,$5::date,$6::date,'movimento',$7) returning id`,
    [h.demo.orgId, empresa, areaId, loteId, inicio, fim, fim === null ? null : "transferencia"]);
const objeto = (empresa: string, areaId: string, nome: string) =>
  id(`insert into erp.objetos_de_mapa (organization_id, empresa_id, area_id, tipo, forma, geometria, code, name)
      values ($1,$2,$3,'cocho','ponto',$4::jsonb,$5,$6) returning id`, [h.demo.orgId, empresa, areaId, JSON.stringify(PONTO), unico(), nome]);
const manejo = (empresa: string, loteId: string, data: string) =>
  id(`insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id)
      values ($1,$2,$3,'sanitary',$4::date,$5) returning id`, [h.demo.orgId, empresa, unico(), data, loteId]);
const pesagem = (empresa: string, loteId: string, data: string) =>
  id("insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id) values ($1,$2,$3,$4::date,$5) returning id",
    [h.demo.orgId, empresa, unico(), data, loteId]);

// ---------- tipos das respostas ----------
type LoteDto = { id: string; code: string | null; description: string | null };
type Aberta = { id: string; lote: LoteDto; cabecas: number; ua: string; cabecas_na_entrada: number | null; ua_na_entrada: string | null; data_inicio: string; origem_da_data: string; dias_de_ocupacao: number };
type Fechada = { id: string; lote: LoteDto; data_inicio: string; data_fim: string; origem_da_data: string; motivo_saida: string | null; dias_de_ocupacao: number };
type Ciclo = { inicio: string; fim: string | null; diasOcupacao: number; diasDescansoAntes: number | null };
type Comparacao = { planejado: number | null; ultimo: number | null; medio: string | null; diferencaUltimo: number | null };
type Ocupacao = {
  hoje: string; area: Record<string, unknown> & { id: string }; abertas: Aberta[]; fechadas: Fechada[];
  ultima_saida: string | null; dias_de_descanso: number | null; cabecas_total: number; ua_total: string; estacao: string;
  ua_por_hectare: string | null; capacidade_da_estacao: string | null; situacao_de_lotacao: string | null;
  rodizio: { ciclos: Ciclo[]; ocupacao: Comparacao; descanso: Comparacao } | null;
};
type ItemDoHistorico = Omit<Fechada, "data_fim"> & {
  data_fim: string | null; cabecas_na_entrada: number | null; ua_na_entrada: string | null;
  movimento_entrada_id: string | null; movimento_saida_id: string | null; note: string | null;
};
type Historico = { items: ItemDoHistorico[]; total: number; page: number; pageSize: number; hoje: string };
type Faixa = { chave: string; rotulo: string; numero: string | number | null; unidade: string | null };
type AreaOp = {
  id: string; empresa_id: string; name: string; ocupada: boolean; lotes: Aberta[]; cabecas_total: number; ua_total: string;
  ultima_saida: string | null; dias_de_descanso: number | null; ultimo_manejo: string | null; ultima_pesagem: string | null; faixa: Faixa | null;
};
type Operacional = { hoje: string; estacao: string; coloracao: string; capacidades: Record<string, boolean>; areas: AreaOp[]; objetos: { id: string }[] };
const achar = (r: Operacional, areaId: string) => { const a = r.areas.find((x) => x.id === areaId); if (!a) throw new Error(`área ${areaId} ausente da resposta`); return a; };
const S = ENUM_LABELS.situacao_do_pasto;
const faixaPasto = (chave: keyof typeof S, numero: number | null): Faixa => ({ chave, rotulo: S[chave], numero, unidade: numero === null ? null : "dias" });

// ---------- o cenário comum (MM3-1a..1c, MM3-2b): o retiro R1 da empresa 1, no fuso do caso ----------
let R1: string;
/** A: aberta desde local−5 e uma fechada antiga (local−40..local−30), com módulo. B: vazia, saída em local−9. X: aberta desde local−45. Y: desde local−46. */
const AR = {} as Record<"A" | "B" | "X" | "Y", string>;
const OC = {} as Record<"abertaA" | "fechadaA" | "fechadaB" | "abertaX" | "abertaY", string>;
const LT = {} as Record<"LA" | "LA0" | "LB" | "LX" | "LY", string>;

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2).not.toBe(E1);
  // premissa: as duas empresas do cenário nascem em São Paulo (o default da 0062)
  expect([await fusoDe(E1), await fusoDe(E2)]).toEqual([SP, SP]);
  caso = await fusoDoCaso();
  await fusoDa(E1, caso.fuso);
  diaLocal = await diaDaEmpresa(E1);
  expect(diaLocal, "o dia da empresa 1 é o dia local do fuso do caso").toBe(caso.local);
  especie = (await admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]!.id;
  categoria = await id("insert into erp.animal_categories (organization_id, species_id, name, ua_factor) values ($1,$2,$3,1) returning id", [h.demo.orgId, especie, `Categoria ${TAG}`]);

  R1 = await retiro(E1);
  AR.A = await area(E1, `${TAG} A aberta 5`, { retiro: R1, modulo: await modulo(E1) });
  AR.B = await area(E1, `${TAG} B vazia 9`, { retiro: R1 });
  AR.X = await area(E1, `${TAG} X aberta 45`, { retiro: R1 });
  AR.Y = await area(E1, `${TAG} Y aberta 46`, { retiro: R1 });
  LT.LA = await lote(E1, `${TAG} LA`); await animal(E1, LT.LA); await porContagem(E1, LT.LA, 2);
  LT.LA0 = await lote(E1, `${TAG} LA0`);
  LT.LB = await lote(E1, `${TAG} LB`);
  LT.LX = await lote(E1, `${TAG} LX`); await porContagem(E1, LT.LX, 4);
  LT.LY = await lote(E1, `${TAG} LY`); await porContagem(E1, LT.LY, 4);
  OC.fechadaA = await ocupacao(E1, AR.A, LT.LA0, local(-40), local(-30));
  OC.abertaA = await ocupacao(E1, AR.A, LT.LA, local(-5), null);
  OC.fechadaB = await ocupacao(E1, AR.B, LT.LB, local(-20), local(-9));
  OC.abertaX = await ocupacao(E1, AR.X, LT.LX, local(-45), null);
  OC.abertaY = await ocupacao(E1, AR.Y, LT.LY, local(-46), null);
  await objeto(E1, AR.A, `${TAG} cocho A`);
}, 240_000);

afterAll(async () => {
  try {
    if (admin && E1) {
      // a empresa 1 volta para São Paulo: UMA linha, conferida depois; nenhuma empresa da organização fica fora de SP
      await fusoDa(E1, SP);
      expect((await admin.query<{ f: string }>("select string_agg(distinct fuso_horario, ',') f from erp.empresas where organization_id=$1", [h.demo.orgId])).rows[0]!.f).toBe(SP);
    }
  } finally { await admin?.end(); await h?.app.close(); await h?.db.end(); }
});

// ==================================================================================================
// MM3-1a — GET /ocupacao: a regra em instante fixo e a rota no dia da empresa
// ==================================================================================================
describe("MM3-1a — GET /api/mapa/areas/:id/ocupacao conta pelo dia da empresa da área", () => {
  it("MM3-1a GET /api/mapa/areas/:id/ocupacao às 22h de Cuiabá dá os mesmos dias que às 14h", async () => {
    // PARTE FIXA: a expressão da rota, com o instante e o fuso no lugar de now() e e.fuso_horario, = erp.dia_no_fuso
    // (a regra do gatilho, 0062) no MESMO instante — a regra escrita nos dois lugares, amarrada (decisão 307 item 6).
    const naRota = EXPRESSAO_DA_ROTA.replace("now()", "$1::timestamptz").replace("e.fuso_horario", "$2::text");
    expect(naRota).toBe("($1::timestamptz at time zone $2::text)::date");
    const fixo = async (instante: string) => (await admin.query<{ rota: string; funcao: string; hora_local: string; utc: string }>(
      `select (${naRota})::text rota, erp.dia_no_fuso($1::timestamptz, $2::text)::text funcao,
              to_char($1::timestamptz at time zone $2::text, 'HH24:MI') hora_local, ($1::timestamptz at time zone 'UTC')::date::text utc`,
      [instante, "America/Cuiaba"])).rows[0]!;
    expect({ as22h: await fixo("2026-10-10T02:00:00Z"), as14h: await fixo("2026-10-09T18:00:00Z") }).toEqual({
      as22h: { rota: "2026-10-09", funcao: "2026-10-09", hora_local: "22:00", utc: "2026-10-10" }, // às 22h o dia UTC já virou; o local não
      as14h: { rota: "2026-10-09", funcao: "2026-10-09", hora_local: "14:00", utc: "2026-10-09" }
    });
    // e no instante VIVO, para as empresas da organização: a expressão da rota = dia_no_fuso = hoje_na_empresa (o gatilho)
    const vivas = (await admin.query<{ id: string; rota: string; funcao: string; gatilho: string }>(
      `select e.id, ${EXPRESSAO_DA_ROTA}::text rota, erp.dia_no_fuso(now(), e.fuso_horario)::text funcao, erp.hoje_na_empresa(e.id)::text gatilho
         from erp.empresas e where e.id = any($1::uuid[]) order by e.id`, [[E1, E2]])).rows;
    expect(vivas).toHaveLength(2);
    for (const v of vivas) expect([v.funcao, v.gatilho], `empresa ${v.id}`).toEqual([v.rota, v.rota]);
    expect(vivas.find((v) => v.id === E1)!.rota).toBe(diaLocal);

    // PARTE VIVA: a empresa 1 no fuso do caso (o dia local ≠ dia UTC). Pelo dia UTC a aberta teria 6 (oeste) ou 4 (leste)
    // dias e o descanso 10 ou 8 — a rota no current_date reprova aqui.
    const a = await ok<Ocupacao>(`/api/mapa/areas/${AR.A}/ocupacao`);
    expect([a.hoje, a.hoje === caso.utc], `fuso ${caso.fuso}`).toEqual([diaLocal, false]);
    expect(a.abertas.map((x) => [x.id, x.data_inicio, x.dias_de_ocupacao])).toEqual([[OC.abertaA, local(-5), 5]]);
    expect(a.fechadas.map((x) => [x.id, x.data_inicio, x.data_fim, x.dias_de_ocupacao])).toEqual([[OC.fechadaA, local(-40), local(-30), 10]]);
    expect([a.ultima_saida, a.dias_de_descanso, a.cabecas_total, a.estacao]).toEqual([local(-30), null, 3, estacaoDe(diaLocal)]);
    // o rodízio conta o ciclo aberto pelo mesmo dia: 5 dias de ocupação; o descanso antes dele (−30 → −5) é 25
    expect(a.rodizio).toEqual({
      ciclos: [
        { inicio: local(-40), fim: local(-30), diasOcupacao: 10, diasDescansoAntes: null },
        { inicio: local(-5), fim: null, diasOcupacao: 5, diasDescansoAntes: 25 }
      ],
      ocupacao: { planejado: 7, ultimo: 5, medio: "10.0", diferencaUltimo: -2 },
      descanso: { planejado: 30, ultimo: 25, medio: "25.0", diferencaUltimo: -5 }
    });

    const b = await ok<Ocupacao>(`/api/mapa/areas/${AR.B}/ocupacao`);
    expect({ hoje: b.hoje, abertas: b.abertas, ultima_saida: b.ultima_saida, dias_de_descanso: b.dias_de_descanso, rodizio: b.rodizio })
      .toEqual({ hoje: diaLocal, abertas: [], ultima_saida: local(-9), dias_de_descanso: 9, rodizio: null });
    // a fechada conta fim − início: não depende do dia
    expect(b.fechadas.map((x) => [x.id, x.dias_de_ocupacao])).toEqual([[OC.fechadaB, 11]]);
  });
});

// ==================================================================================================
// MM3-1b — GET /historico
// ==================================================================================================
describe("MM3-1b — GET /api/mapa/areas/:id/ocupacao/historico conta pelo dia da empresa da área", () => {
  it("MM3-1b GET /api/mapa/areas/:id/ocupacao/historico: hoje = dia local; a aberta com 5 dias; a fechada antiga com os dias dela", async () => {
    const r = await ok<Historico>(`/api/mapa/areas/${AR.A}/ocupacao/historico`);
    expect([r.hoje, r.hoje === caso.utc, r.total, r.page], `fuso ${caso.fuso}`).toEqual([diaLocal, false, 2, 1]);
    expect(r.items.map((x) => [x.id, x.lote.id, x.data_inicio, x.data_fim, x.dias_de_ocupacao])).toEqual([
      [OC.abertaA, LT.LA, local(-5), null, 5],
      [OC.fechadaA, LT.LA0, local(-40), local(-30), 10]
    ]);
    // a área vazia: só a fechada, inalterada; o hoje é o mesmo dia local
    const b = await ok<Historico>(`/api/mapa/areas/${AR.B}/ocupacao/historico`);
    expect([b.hoje, b.total, b.items.map((x) => [x.id, x.dias_de_ocupacao])]).toEqual([diaLocal, 1, [[OC.fechadaB, 11]]]);
  });
});

// ==================================================================================================
// MM3-1c — situacao_pasto no limite 45/46
// ==================================================================================================
describe("MM3-1c — GET /api/mapa/operacional?coloracao=situacao_pasto: a faixa pelo dia da empresa da área", () => {
  it("MM3-1c X (desde local−45) normal 45 e Y (desde local−46) atenção 46; A e B pelos mesmos dias da leitura da ocupação; nenhuma chave hoje_da_area", async () => {
    const r = await ok<Operacional>(`/api/mapa/operacional?retiro_id=${R1}&coloracao=situacao_pasto`);
    expect(r.coloracao).toBe("situacao_pasto");
    expect(r.areas.map((a) => a.id)).toEqual([AR.A, AR.B, AR.X, AR.Y]);
    const por = (k: keyof typeof AR) => { const a = achar(r, AR[k]); return { dias: a.lotes.map((l) => l.dias_de_ocupacao), descanso: a.dias_de_descanso, faixa: a.faixa }; };
    // a oeste (dia UTC = local + 1) X viraria 46/atenção; a leste (dia UTC = local − 1) Y viraria 45/normal
    expect({ A: por("A"), B: por("B"), X: por("X"), Y: por("Y") }, `fuso ${caso.fuso}`).toEqual({
      A: { dias: [5], descanso: null, faixa: faixaPasto("normal", 5) },
      B: { dias: [], descanso: 9, faixa: faixaPasto("em_descanso", 9) },
      X: { dias: [45], descanso: null, faixa: faixaPasto("normal", 45) },
      Y: { dias: [46], descanso: null, faixa: faixaPasto("atencao", 46) }
    });
    // a coluna interna do dia nunca sai na área (nem em lugar nenhum da resposta)
    expect(r.areas.filter((a) => "hoje_da_area" in a).map((a) => a.id)).toEqual([]);
    expect(JSON.stringify(r).includes("hoje_da_area")).toBe(false);
  });
});

// ==================================================================================================
// MM3-1d — a empresa de São Paulo inalterada; o topo é o dia mais antigo do escopo
// ==================================================================================================
describe("MM3-1d — empresa de São Paulo inalterada na mesma resposta; o topo é o dia MAIS ANTIGO das empresas do escopo", () => {
  it("MM3-1d a área de E2 conta pelo dia de SP e a de E1 pelo dia local, na MESMA resposta; x-empresa-id e escopo mudam o topo; sem eles, o mínimo do banco", async () => {
    expect(await fusoDe(E2), "premissa: a empresa 2 continua em São Paulo").toBe(SP);
    // o dia de SP lido AGORA (a semeadura e as leituras vêm em seguida)
    const diaSP = await diaDaEmpresa(E2);
    const RZ = await retiro(E2);
    const Z = await area(E2, `${TAG} Z sp aberta 5`, { retiro: RZ });
    const W = await area(E2, `${TAG} W sp vazia 9`, { retiro: RZ });
    const LZ = await lote(E2, `${TAG} LZ`); await porContagem(E2, LZ, 2);
    const LW = await lote(E2, `${TAG} LW`);
    await ocupacao(E2, Z, LZ, mais(diaSP, -5), null);
    await ocupacao(E2, W, LW, mais(diaSP, -20), mais(diaSP, -9));

    const tudo = await ok<Operacional>("/api/mapa/operacional?coloracao=situacao_pasto");
    const por = (areaId: string) => { const a = achar(tudo, areaId); return { empresa: a.empresa_id, dias: a.lotes.map((l) => l.dias_de_ocupacao), descanso: a.dias_de_descanso, faixa: a.faixa }; };
    expect({ Z: por(Z), W: por(W), X: por(AR.X), B: por(AR.B) }, `SP ${diaSP}, local ${diaLocal} (${caso.fuso})`).toEqual({
      Z: { empresa: E2, dias: [5], descanso: null, faixa: faixaPasto("normal", 5) },
      W: { empresa: E2, dias: [], descanso: 9, faixa: faixaPasto("em_descanso", 9) },
      X: { empresa: E1, dias: [45], descanso: null, faixa: faixaPasto("normal", 45) },
      B: { empresa: E1, dias: [], descanso: 9, faixa: faixaPasto("em_descanso", 9) }
    });
    // o topo sem empresa selecionada: o dia MAIS ANTIGO entre as empresas do escopo (o dono vê as duas), conferido
    // com o mínimo calculado no banco
    const minBanco = (await admin.query<{ d: string; n: number }>(
      "select min((now() at time zone fuso_horario)::date)::text d, count(*)::int n from erp.empresas where organization_id=$1 and deleted_at is null",
      [h.demo.orgId])).rows[0]!;
    expect(minBanco).toEqual({ d: [diaLocal, diaSP].sort()[0], n: 2 });
    expect([tudo.hoje, tudo.estacao]).toEqual([minBanco.d, estacaoDe(minBanco.d)]);

    // com x-empresa-id = E2: o topo é o dia de SP e a área de E1 não aparece
    const soE2 = await ok<Operacional>("/api/mapa/operacional?coloracao=situacao_pasto", h.headers({ "x-empresa-id": E2 }));
    expect([soE2.hoje, soE2.estacao]).toEqual([diaSP, estacaoDe(diaSP)]);
    expect([soE2.areas.some((a) => a.id === Z), soE2.areas.some((a) => a.id === AR.X), soE2.areas.filter((a) => a.empresa_id !== E2).length]).toEqual([true, false, 0]);
    expect(achar(soE2, Z).lotes.map((l) => l.dias_de_ocupacao)).toEqual([5]);
    // com x-empresa-id = E1: o topo é o dia local e a área de E2 não aparece
    const soE1 = await ok<Operacional>("/api/mapa/operacional?coloracao=situacao_pasto", h.headers({ "x-empresa-id": E1 }));
    expect([soE1.hoje, soE1.areas.some((a) => a.id === Z), soE1.areas.filter((a) => a.empresa_id !== E1).length]).toEqual([diaLocal, false, 0]);

    // pelo ESCOPO (membro restrito, o exists do escopo sobre e.id): o mínimo é só das empresas que ele enxerga
    const deE2 = await membro("MM3 escopo E2", ["batch_area.view"], [E2]);
    const deE1 = await membro("MM3 escopo E1", ["batch_area.view"], [E1]);
    const m2 = await ok<Operacional>("/api/mapa/operacional?coloracao=situacao_pasto", deE2);
    const m1 = await ok<Operacional>("/api/mapa/operacional?coloracao=situacao_pasto", deE1);
    expect({
      e2: [m2.hoje, m2.areas.some((a) => a.id === Z), m2.areas.filter((a) => a.empresa_id !== E2).length],
      e1: [m1.hoje, m1.areas.some((a) => a.id === AR.X), m1.areas.filter((a) => a.empresa_id !== E1).length]
    }).toEqual({ e2: [diaSP, true, 0], e1: [diaLocal, true, 0] });
    expect(achar(m1, AR.Y).faixa).toEqual(faixaPasto("atencao", 46));
  });
});

// ==================================================================================================
// MM3-2a — consultas CONTADAS: as mesmas de antes; erp.empresas só dentro das que já existiam
// ==================================================================================================
/** A lista FIXA de tabelas contadas (erp.empresas NÃO está aqui: ela não pode ter consulta própria). */
const TABELAS = {
  areas: /erp\.areas\b/, ocupacoes: /erp\.ocupacoes_de_area\b/, lotes: /erp\.batches\b/, animais: /erp\.animals\b/, contagem: /erp\.herd_lots\b/,
  modulos: /erp\.grazing_modules\b/, objetos: /erp\.objetos_de_mapa\b/, icones: /erp\.configuracoes_de_icone\b/,
  manejos: /erp\.animal_handlings\b/, pesagens: /erp\.weighings\b/
} as const;
const EMPRESAS = /erp\.empresas\b/;
type Contagem = Record<keyof typeof TABELAS | "total" | "texto" | "comEmpresas" | "empresasNaDasAreas" | "soDeEmpresas", number>;
/**
 * Conta as consultas de UMA requisição, no total e por tabela citada. Antes, a mesma requisição sem contar: o contexto
 * do usuário fica em cache no plugin de autenticação, e a contagem mede a ROTA, não o cache frio.
 */
async function medir<T>(url: string, headers: Hdr = h.headers()): Promise<{ n: Contagem; corpo: T }> {
  await ok<T>(url, headers);
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const corpo = await ok<T>(url, headers);
    const chamadas = espiao.mock.calls.map((c) => c[0] as unknown);
    const sqls = chamadas.filter((x): x is string => typeof x === "string");
    const de = (forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
    const porTabela = Object.fromEntries(Object.entries(TABELAS).map(([k, forma]) => [k, de(forma)])) as Record<keyof typeof TABELAS, number>;
    return {
      corpo,
      n: {
        total: chamadas.length, texto: sqls.length, ...porTabela,
        comEmpresas: de(EMPRESAS),
        empresasNaDasAreas: sqls.filter((s) => EMPRESAS.test(s) && TABELAS.areas.test(s)).length,
        // uma consulta que cita erp.empresas e nenhuma das tabelas da lista seria uma consulta NOVA, só do dia
        soDeEmpresas: sqls.filter((s) => EMPRESAS.test(s) && !Object.values(TABELAS).some((t) => t.test(s))).length
      }
    };
  } finally { espiao.mockRestore(); }
}
const zero: Contagem = {
  total: 0, texto: 0, areas: 0, ocupacoes: 0, lotes: 0, animais: 0, contagem: 0, modulos: 0, objetos: 0, icones: 0, manejos: 0, pesagens: 0,
  comEmpresas: 0, empresasNaDasAreas: 0, soDeEmpresas: 0
};

describe("MM3-2a — consultas CONTADAS: /operacional 8, /ocupacao 6, /historico 4; erp.empresas nunca numa consulta própria", () => {
  it("MM3-2a com E1 no fuso do caso: /operacional 8 com 3 e 30 áreas nos 5 modos; /ocupacao 6 com 1 e 5 lotes; /historico 4 com página de 3 e de 20", async () => {
    const MODOS = [...MODOS_DE_COLORACAO];
    expect(MODOS).toHaveLength(5);
    /** `n` áreas num retiro novo da empresa 1: um lote aberto com 3 cabeças desde local−5, uma saída, um objeto, um manejo e uma pesagem. */
    async function cenarioOperacional(n: number): Promise<string> {
      const R = await retiro(E1);
      const passado = await lote(E1, `${TAG} conta passado ${n}`);
      for (let i = 0; i < n; i++) {
        const a = await area(E1, `${TAG} conta ${n} ${String(i).padStart(2, "0")}`, { usavel: "5", retiro: R });
        const l = await lote(E1, `${TAG} conta ${n} L${i}`);
        await animal(E1, l); await porContagem(E1, l, 2);
        await ocupacao(E1, a, l, local(-5), null);
        await ocupacao(E1, a, passado, local(-40 - i * 3), local(-39 - i * 3));
        await objeto(E1, a, `${TAG} conta ${n} cocho ${i}`);
        await manejo(E1, l, local(-2)); await pesagem(E1, l, local(-1));
      }
      return R;
    }
    const R3 = await cenarioOperacional(3);
    const R30 = await cenarioOperacional(30);
    // begin + áreas (com erp.empresas DENTRO) + abertas + últimas saídas + rebanho + objetos e ícones + manejo e pesagem + commit
    const operacional: Contagem = {
      ...zero, total: 8, texto: 8, areas: 1, ocupacoes: 2, lotes: 1, animais: 1, contagem: 1, objetos: 1, icones: 1, manejos: 1, pesagens: 1,
      comEmpresas: 1, empresasNaDasAreas: 1
    };
    const porModo: Record<string, { tres: Contagem; trinta: Contagem }> = {};
    for (const modo of MODOS) {
      const p = await medir<Operacional>(`/api/mapa/operacional?retiro_id=${R3}&coloracao=${modo}`);
      const g = await medir<Operacional>(`/api/mapa/operacional?retiro_id=${R30}&coloracao=${modo}`);
      porModo[modo] = { tres: p.n, trinta: g.n };
      // premissas: o cenário inteiro chegou, com os dias pelo dia local (verde sem dado é reprovação)
      expect([p.corpo.areas.length, p.corpo.objetos.length, g.corpo.areas.length, g.corpo.objetos.length], modo).toEqual([3, 3, 30, 30]);
      for (const c of [p.corpo, g.corpo]) {
        expect(c.capacidades, modo).toEqual({ objetos: true, manejo: true, pesagem: true, icones: true });
        for (const a of c.areas) {
          expect([a.lotes.map((l) => l.dias_de_ocupacao), a.cabecas_total, a.ultima_saida !== null, a.ultimo_manejo, a.ultima_pesagem], `${modo} ${a.id}`)
            .toEqual([[5], 3, true, local(-2), local(-1)]);
        }
      }
    }
    expect(porModo).toEqual(Object.fromEntries(MODOS.map((m) => [m, { tres: operacional, trinta: operacional }])));

    /** Área com módulo, `lotes` abertos (2 cabeças cada) e `fechadas` ocupações fechadas. */
    async function cenarioOcupacao(lotes: number, fechadas: number): Promise<string> {
      const A = await area(E1, `${TAG} conta ocupacao ${lotes}x${fechadas}`, { modulo: await modulo(E1) });
      for (let i = 0; i < lotes; i++) {
        const l = await lote(E1, `${TAG} conta ocupacao L${i}`);
        await animal(E1, l); await porContagem(E1, l, 1);
        await ocupacao(E1, A, l, local(-(i + 1)), null);
      }
      const passado = await lote(E1, `${TAG} conta ocupacao passado ${lotes}`);
      for (let i = 0; i < fechadas; i++) await ocupacao(E1, A, passado, local(-200 + i * 5), local(-200 + i * 5 + 2));
      return A;
    }
    const P = await cenarioOcupacao(1, 2);
    const G = await cenarioOcupacao(5, 20);
    // begin + área e módulo (com erp.empresas DENTRO) + abertas e fechadas + rebanho + rodízio + commit
    const ocupacaoEsperada: Contagem = { ...zero, total: 6, texto: 6, areas: 1, ocupacoes: 2, lotes: 1, animais: 1, contagem: 1, modulos: 1, comEmpresas: 1, empresasNaDasAreas: 1 };
    const p = await medir<Ocupacao>(`/api/mapa/areas/${P}/ocupacao`);
    const g = await medir<Ocupacao>(`/api/mapa/areas/${G}/ocupacao?fechadas=50`);
    expect([p.corpo.hoje, p.corpo.abertas.map((x) => x.dias_de_ocupacao), p.corpo.fechadas.length, p.corpo.rodizio?.ciclos.length]).toEqual([diaLocal, [1], 2, 3]);
    expect([g.corpo.abertas.map((x) => x.dias_de_ocupacao), g.corpo.fechadas.length, g.corpo.cabecas_total]).toEqual([[1, 2, 3, 4, 5], 20, 10]);
    expect({ umLote: p.n, cincoLotes: g.n }).toEqual({ umLote: ocupacaoEsperada, cincoLotes: ocupacaoEsperada });

    // begin + área e total (com erp.empresas DENTRO) + a página + commit
    const historicoEsperado: Contagem = { ...zero, total: 4, texto: 4, areas: 1, ocupacoes: 2, lotes: 1, comEmpresas: 1, empresasNaDasAreas: 1 };
    const h3 = await medir<Historico>(`/api/mapa/areas/${G}/ocupacao/historico?pageSize=3`);
    const h20 = await medir<Historico>(`/api/mapa/areas/${G}/ocupacao/historico`);
    expect([h3.corpo.hoje, h3.corpo.total, h3.corpo.items.length, h20.corpo.items.length]).toEqual([diaLocal, 25, 3, 20]);
    expect(h3.corpo.items.map((x) => x.dias_de_ocupacao)).toEqual([1, 2, 3]);
    expect({ pagina3: h3.n, pagina20: h20.n }).toEqual({ pagina3: historicoEsperado, pagina20: historicoEsperado });
  }, 180_000);
});

// ==================================================================================================
// MM3-2b — o conjunto de chaves (nome e tipo) das três respostas, idêntico ao de antes
// ==================================================================================================
type Tipo = "string" | "number" | "boolean" | "object" | "array" | "null";
const tipoDe = (v: unknown): Tipo | "outro" => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? t : "outro";
};
type Spec = Record<string, readonly Tipo[]>;
const LOTE_DO_LOTE: Spec = { id: ["string"], code: ["string", "null"], description: ["string", "null"] };
const LOTE_ABERTO: Spec = {
  id: ["string"], lote: ["object"], cabecas: ["number"], ua: ["string"], cabecas_na_entrada: ["number", "null"], ua_na_entrada: ["string", "null"],
  data_inicio: ["string"], origem_da_data: ["string"], dias_de_ocupacao: ["number"]
};
/** /mapa/operacional — as chaves da MAPA-MANEJO-02 (MM2-13a: ANTES ∪ ACRESCIDAS, com os tipos); a 03 não acrescenta nenhuma. */
const OPERACIONAL: Record<"topo" | "capacidades" | "area" | "lote" | "loteDoLote" | "objeto", Spec> = {
  topo: { hoje: ["string"], estacao: ["string"], coloracao: ["string"], capacidades: ["object"], areas: ["array"], objetos: ["array"] },
  capacidades: { objetos: ["boolean"], manejo: ["boolean"], pesagem: ["boolean"], icones: ["boolean"] },
  area: {
    id: ["string"], empresa_id: ["string"], name: ["string"], code: ["string"], color: ["string", "null"], area_ha: ["string"], usable_area_ha: ["string"],
    land_use: ["string"], status: ["string"], geometria: ["object", "null"], retiro_id: ["string", "null"], grazing_module_id: ["string", "null"],
    support_capacity_rainy_ua_ha: ["string", "null"], support_capacity_dry_ua_ha: ["string", "null"], max_stocking_ua: ["string", "null"],
    ocupada: ["boolean"], lotes: ["array"], cabecas_total: ["number"], ua_total: ["string"], ultima_saida: ["string", "null"],
    dias_de_descanso: ["number", "null"], ua_por_hectare: ["string", "null"], capacidade_da_estacao: ["string", "null"],
    situacao_de_lotacao: ["string", "null"], ultimo_manejo: ["string", "null"], ultima_pesagem: ["string", "null"],
    centroide: ["object", "null"], identificador: ["object", "null"], icone: ["object", "null"], faixa: ["object", "null"]
  },
  lote: LOTE_ABERTO,
  loteDoLote: LOTE_DO_LOTE,
  objeto: {
    id: ["string"], empresa_id: ["string"], area_id: ["string", "null"], tipo: ["string"], forma: ["string"], geometria: ["object"], code: ["string", "null"],
    name: ["string"], descricao: ["string", "null"], capacidade: ["string", "null"], unidade_capacidade: ["string", "null"], trough_id: ["string", "null"],
    is_active: ["boolean"]
  }
};
const COMPARACAO: Spec = { planejado: ["number", "null"], ultimo: ["number", "null"], medio: ["string", "null"], diferencaUltimo: ["number", "null"] };
/** /mapa/areas/:id/ocupacao — lido da rota em 7371fcf1 (HEAD~1 da fatia): o objeto devolvido, campo a campo. */
const OCUPACAO: Record<"topo" | "area" | "aberta" | "loteDoLote" | "fechada" | "rodizio" | "ciclo" | "comparacao", Spec> = {
  topo: {
    hoje: ["string"], area: ["object"], abertas: ["array"], fechadas: ["array"], ultima_saida: ["string", "null"], dias_de_descanso: ["number", "null"],
    cabecas_total: ["number"], ua_total: ["string"], estacao: ["string"], ua_por_hectare: ["string", "null"], capacidade_da_estacao: ["string", "null"],
    situacao_de_lotacao: ["string", "null"], rodizio: ["object", "null"]
  },
  area: {
    id: ["string"], empresa_id: ["string"], code: ["string"], name: ["string"], area_ha: ["string"], usable_area_ha: ["string"], land_use: ["string"],
    status: ["string"], retiro_id: ["string", "null"], grazing_module_id: ["string", "null"], support_capacity_rainy_ua_ha: ["string", "null"],
    support_capacity_dry_ua_ha: ["string", "null"], max_stocking_ua: ["string", "null"]
  },
  aberta: LOTE_ABERTO,
  loteDoLote: LOTE_DO_LOTE,
  fechada: {
    id: ["string"], lote: ["object"], data_inicio: ["string"], data_fim: ["string"], origem_da_data: ["string"], motivo_saida: ["string", "null"],
    dias_de_ocupacao: ["number"]
  },
  rodizio: { ciclos: ["array"], ocupacao: ["object"], descanso: ["object"] },
  ciclo: { inicio: ["string"], fim: ["string", "null"], diasOcupacao: ["number"], diasDescansoAntes: ["number", "null"] },
  comparacao: COMPARACAO
};
/** /mapa/areas/:id/ocupacao/historico — idem. */
const HISTORICO: Record<"topo" | "item" | "loteDoLote", Spec> = {
  topo: { items: ["array"], total: ["number"], page: ["number"], pageSize: ["number"], hoje: ["string"] },
  item: {
    id: ["string"], lote: ["object"], data_inicio: ["string"], data_fim: ["string", "null"], origem_da_data: ["string"], motivo_saida: ["string", "null"],
    cabecas_na_entrada: ["number", "null"], ua_na_entrada: ["string", "null"], movimento_entrada_id: ["string", "null"], movimento_saida_id: ["string", "null"],
    note: ["string", "null"], dias_de_ocupacao: ["number"]
  },
  loteDoLote: LOTE_DO_LOTE
};

describe("MM3-2b — o conjunto de chaves (nome e tipo) de /operacional, /ocupacao e /historico é o de antes", () => {
  it("MM3-2b chaves = constantes escritas aqui, nível a nível; nenhuma nova (hoje_da_area não aparece), nenhuma removida, nenhum tipo trocado", async () => {
    const vistos: Record<string, number> = {};
    const conferir = (spec: Spec, obj: unknown, onde: string) => {
      vistos[onde.split(" ")[0]!] = (vistos[onde.split(" ")[0]!] ?? 0) + 1;
      expect(tipoDe(obj), `${onde}: é objeto`).toBe("object");
      const o = obj as Record<string, unknown>;
      expect(Object.keys(o).sort(), `${onde}: chaves`).toEqual(Object.keys(spec).sort());
      expect(Object.entries(spec).filter(([k, tipos]) => !(tipos as readonly string[]).includes(tipoDe(o[k]))).map(([k]) => `${k}: ${tipoDe(o[k])}`), `${onde}: tipos`).toEqual([]);
    };

    for (const modo of MODOS_DE_COLORACAO) {
      const r = await ok<Operacional>(`/api/mapa/operacional?retiro_id=${R1}&coloracao=${modo}`);
      conferir(OPERACIONAL.topo, r, `op.topo ${modo}`);
      conferir(OPERACIONAL.capacidades, r.capacidades, `op.capacidades ${modo}`);
      for (const a of r.areas) {
        conferir(OPERACIONAL.area, a, `op.area ${modo} ${a.id}`);
        for (const l of a.lotes) { conferir(OPERACIONAL.lote, l, `op.lote ${modo} ${l.id}`); conferir(OPERACIONAL.loteDoLote, l.lote, `op.loteDoLote ${modo} ${l.id}`); }
      }
      for (const o of r.objetos) conferir(OPERACIONAL.objeto, o, `op.objeto ${modo} ${o.id}`);
    }

    // A (abertas, fechadas, rodízio com ciclos) e B (sem módulo: rodízio nulo; só fechada)
    for (const areaId of [AR.A, AR.B]) {
      const r = await ok<Ocupacao>(`/api/mapa/areas/${areaId}/ocupacao`);
      conferir(OCUPACAO.topo, r, `oc.topo ${areaId}`);
      conferir(OCUPACAO.area, r.area, `oc.area ${areaId}`);
      for (const x of r.abertas) { conferir(OCUPACAO.aberta, x, `oc.aberta ${x.id}`); conferir(OCUPACAO.loteDoLote, x.lote, `oc.loteDoLote ${x.id}`); }
      for (const x of r.fechadas) { conferir(OCUPACAO.fechada, x, `oc.fechada ${x.id}`); conferir(OCUPACAO.loteDoLote, x.lote, `oc.loteDoLote ${x.id}`); }
      if (r.rodizio) {
        conferir(OCUPACAO.rodizio, r.rodizio, `oc.rodizio ${areaId}`);
        for (const c of r.rodizio.ciclos) conferir(OCUPACAO.ciclo, c, `oc.ciclo ${c.inicio}`);
        conferir(OCUPACAO.comparacao, r.rodizio.ocupacao, `oc.comparacao ocupacao`);
        conferir(OCUPACAO.comparacao, r.rodizio.descanso, `oc.comparacao descanso`);
      }
    }

    const hr = await ok<Historico>(`/api/mapa/areas/${AR.A}/ocupacao/historico`);
    conferir(HISTORICO.topo, hr, "hi.topo");
    for (const x of hr.items) { conferir(HISTORICO.item, x, `hi.item ${x.id}`); conferir(HISTORICO.loteDoLote, x.lote, `hi.loteDoLote ${x.id}`); }

    // verde sem dado é reprovação: cada nível conferido de fato. /operacional: 5 modos × (4 áreas, 3 lotes abertos, 1 objeto);
    // /ocupacao: A (1 aberta, 1 fechada, rodízio com 2 ciclos) e B (1 fechada, sem rodízio); /historico: 2 itens
    expect(vistos).toEqual({
      "op.topo": 5, "op.capacidades": 5, "op.area": 20, "op.lote": 15, "op.loteDoLote": 15, "op.objeto": 5,
      "oc.topo": 2, "oc.area": 2, "oc.aberta": 1, "oc.fechada": 2, "oc.loteDoLote": 3, "oc.rodizio": 1, "oc.ciclo": 2, "oc.comparacao": 2,
      "hi.topo": 1, "hi.item": 2, "hi.loteDoLote": 2
    });
  });
});
