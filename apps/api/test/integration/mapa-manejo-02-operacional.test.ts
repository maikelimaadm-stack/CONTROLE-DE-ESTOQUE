import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { COR_PADRAO_DO_IDENTIFICADOR, ENUM_LABELS, MODOS_DE_COLORACAO, TIPOS_DE_USO_DA_AREA, moduloDaPermissao } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-02 (decisão 306) — GET /api/mapa/operacional com o MARCADOR AGREGADO de cada área (MM2-13a..MM2-13d) e a
 * transferência de lote com o contrato de antes (MM2-14a).
 *
 * Tudo o que a 02 pôs na rota é ACRÉSCIMO: topo `coloracao`, `capacidades.icones`, e por área `centroide`,
 * `identificador`, `icone` e `faixa`. MM2-13a confere as chaves de antes INTACTAS (nome e tipo) contra uma constante
 * escrita aqui; MM2-13b conta as consultas (as mesmas 8 da 01, em todos os modos, com 3 e com 30 áreas); MM2-13c a
 * capacidade `icon_config.view` × `map_objects.view`; MM2-13d cada modo de coloração, o centróide, o identificador e
 * o ícone, área por área, com o dado semeado.
 *
 * Semeadura pela conexão TESTEMUNHA (superusuário), com datas relativas ao `current_date` do banco (o `hoje` da rota).
 * As categorias têm fator UA 1 e nenhum animal é pesado: a UA de cada área é o número de cabeças (conta à mão simples).
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
const TAG = `MM2${Math.random().toString(36).slice(2, 6)}`;
const TAG_UP = TAG.toUpperCase();
let seq = 0;
const unico = () => `${TAG}-${++seq}`;
let E1: string; let E2: string; let especie: string;
let hoje: string;
const dia = (n: number) => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- geometrias (GeoJSON Polygon, anel fechado) ----------
/** Quadrado de 0,01°: o centróide é o centro, (-54,995; -15,005) — o mesmo da 01. */
const QUADRADO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };
/**
 * Um L de braço largo (10 × 10 com braço 4, em milésimos de grau a partir de (-55,2; -15,2)). Centróide de área =
 * (3,875; 3,875) no sistema local → (-55,196125; -15,196125), DENTRO do L; o centro da caixa, (-55,195; -15,195), cai
 * no canto VAZIO do L — o marcador de quem usasse a caixa apareceria fora da área.
 */
const L_LARGO = { type: "Polygon", coordinates: [[[-55.2, -15.2], [-55.19, -15.2], [-55.19, -15.196], [-55.196, -15.196], [-55.196, -15.19], [-55.2, -15.19], [-55.2, -15.2]]] };
/** Triângulo retângulo de catetos 0,01°: centróide = média dos 3 vértices. */
const TRIANGULO = { type: "Polygon", coordinates: [[[-55.3, -15.3], [-55.29, -15.3], [-55.3, -15.29], [-55.3, -15.3]]] };
const PONTO = { type: "Point", coordinates: [-55.001, -15.001] };

/** Ponto em polígono (raio horizontal, regra par-ímpar) sobre o anel externo. */
function dentroDoPoligono(p: { lon: number; lat: number }, geometria: { coordinates: number[][][] }): boolean {
  const anel = geometria.coordinates[0]!;
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i] as [number, number]; const [xj, yj] = anel[j] as [number, number];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// ---------- tipos da resposta ----------
type LoteDto = { id: string; code: string | null; description: string | null };
type Aberta = { id: string; lote: LoteDto; cabecas: number; ua: string; cabecas_na_entrada: number | null; ua_na_entrada: string | null; data_inicio: string; origem_da_data: string; dias_de_ocupacao: number };
type Faixa = { chave: string; rotulo: string; numero: string | number | null; unidade: "ua_ha" | "dias" | "cabecas" | null };
type Icone = { config_id: string | null; categoria: string | null; icone_url: string | null; cor_padrao: string | null; categorias: string[] };
type Identificador = { misto: false; cor: string; sigla: string; nome: string } | { misto: true };
type AreaOp = {
  id: string; empresa_id: string; name: string; code: string; color: string | null; area_ha: string; usable_area_ha: string; land_use: string; status: string;
  geometria: unknown; retiro_id: string | null; grazing_module_id: string | null;
  support_capacity_rainy_ua_ha: string | null; support_capacity_dry_ua_ha: string | null; max_stocking_ua: string | null;
  ocupada: boolean; lotes: Aberta[]; cabecas_total: number; ua_total: string; ultima_saida: string | null; dias_de_descanso: number | null;
  ua_por_hectare: string | null; capacidade_da_estacao: string | null; situacao_de_lotacao: string | null;
  ultimo_manejo: string | null; ultima_pesagem: string | null;
  centroide: { lon: number; lat: number } | null; identificador: Identificador | null; icone: Icone | null; faixa: Faixa | null;
};
type Objeto = { id: string; empresa_id: string; area_id: string | null; tipo: string; capacidade: string | null };
type Capacidades = { objetos: boolean; manejo: boolean; pesagem: boolean; icones: boolean };
type Operacional = { hoje: string; estacao: string; coloracao: string; capacidades: Capacidades; areas: AreaOp[]; objetos: Objeto[] };

const get = (url: string, headers: Hdr = h.headers()) => h.app.inject({ method: "GET", url, headers });
async function ok(url: string, headers?: Hdr): Promise<Operacional> { const r = await get(url, headers); expect(r.statusCode, `${url}: ${r.body}`).toBe(200); return r.json() as Operacional; }
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const achar = (r: Operacional, areaId: string) => { const a = r.areas.find((x) => x.id === areaId); if (!a) throw new Error(`área ${areaId} ausente da resposta`); return a; };

/** Os cinco modos, escritos aqui: se o domínio ganhar um modo, MM2-13b/13d reprovam até o modo novo ser coberto. */
const MODOS = ["padrao", "uso_da_area", "lotacao_ua_ha", "situacao_pasto", "categoria"] as const;
type Modo = (typeof MODOS)[number];

async function membro(nome: string, perms: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico().toLowerCase().replace(/\W+/g, "")}@mm2.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

// ---------- semeadura (testemunha) ----------
const id = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0]!.id;
const retiro = (empresa: string) =>
  id("insert into erp.retiros (organization_id, empresa_id, code, name) values ($1,$2,$3,$4) returning id", [h.demo.orgId, empresa, unico(), `Retiro ${TAG}`]);
type OpcoesArea = { areaHa?: string; usavel?: string; uso?: string; retiro?: string | null; geometria?: unknown };
async function area(empresa: string, nome: string, o: OpcoesArea = {}): Promise<string> {
  const geometria = o.geometria === undefined ? QUADRADO : o.geometria;
  return id(`insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, retiro_id, geometria)
             values ($1,$2,$3,$4,$5,$6,$7,'ativa','propria',$8,$9::jsonb) returning id`,
    [h.demo.orgId, empresa, unico(), nome, o.areaHa ?? "10", o.usavel ?? o.areaHa ?? "10", o.uso ?? "pastagem", o.retiro ?? null,
     geometria === null ? null : JSON.stringify(geometria)]);
}
type Identificacao = { nome?: string | null; sigla?: string | null; cor?: string | null };
const lote = (empresa: string, nome: string, ident: Identificacao = {}) =>
  id(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, status,
                               identificador_nome, identificador_sigla, identificador_cor)
      values ($1,$2,$3,current_date,$4,$5,'pasture','active',$6,$7,$8) returning id`,
    [h.demo.orgId, empresa, unico(), nome, especie, ident.nome ?? null, ident.sigla ?? null, ident.cor ?? null]);
/** Animal sem peso: a UA é o fator da categoria (1). */
const animal = (empresa: string, loteId: string, categoriaId: string, status = "active") =>
  admin.query(`insert into erp.animals (organization_id, empresa_id, species_id, category_id, batch_id, sex, entry_date, current_weight, status)
               values ($1,$2,$3,$4,$5,'M',current_date,null,$6)`, [h.demo.orgId, empresa, especie, categoriaId, loteId, status]);
/** Rebanho por contagem sem peso médio: UA = quantidade × fator (1). */
const porContagem = (empresa: string, loteId: string, categoriaId: string, quantidade: number) =>
  admin.query(`insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, quantity, average_weight, entry_date)
               values ($1,$2,$3,$4,$5,$6,null,current_date)`, [h.demo.orgId, empresa, loteId, especie, categoriaId, quantidade]);
const ocupacao = (empresa: string, areaId: string, loteId: string, inicio: number, fim: number | null) =>
  id(`insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, data_fim, origem_da_data, motivo_saida)
      values ($1,$2,$3,$4,$5::date,$6::date,'movimento',$7) returning id`,
    [h.demo.orgId, empresa, areaId, loteId, dia(inicio), fim === null ? null : dia(fim), fim === null ? null : "transferencia"]);
const objeto = (empresa: string, areaId: string, nome: string, capacidade: string | null = null) =>
  id(`insert into erp.objetos_de_mapa (organization_id, empresa_id, area_id, tipo, forma, geometria, code, name, capacidade, unidade_capacidade)
      values ($1,$2,$3,'cocho','ponto',$4::jsonb,$5,$6,$7,$8) returning id`,
    [h.demo.orgId, empresa, areaId, JSON.stringify(PONTO), unico(), nome, capacidade, capacidade === null ? null : "m"]);
const manejo = (empresa: string, loteId: string, data: number) =>
  id(`insert into erp.animal_handlings (organization_id, empresa_id, code, handling_type, handling_date, batch_id)
      values ($1,$2,$3,'sanitary',$4::date,$5) returning id`, [h.demo.orgId, empresa, unico(), dia(data), loteId]);
const pesagem = (empresa: string, loteId: string, data: number) =>
  id("insert into erp.weighings (organization_id, empresa_id, code, weighing_date, batch_id) values ($1,$2,$3,$4::date,$5) returning id",
    [h.demo.orgId, empresa, unico(), dia(data), loteId]);
const categoria = (nome: string) =>
  id("insert into erp.animal_categories (organization_id, species_id, name, ua_factor) values ($1,$2,$3,1) returning id", [h.demo.orgId, especie, nome]);
type OpcoesConfig = { tipo?: string; misto?: string[] | null; url?: string | null; cor?: string | null; ativo?: boolean; excluida?: boolean };
const config = (empresa: string, cat: string, o: OpcoesConfig = {}) =>
  id(`insert into erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade, categoria, categorias_misto, icone_url, cor_padrao, ativo, deleted_at)
      values ($1,$2,$3,$4,$5::text[],$6,$7,$8, case when $9::boolean then now() end) returning id`,
    [h.demo.orgId, empresa, o.tipo ?? "lote", cat, o.misto ?? null, o.url ?? null, o.cor ?? null, o.ativo ?? true, o.excluida ?? false]);

// ---------- o cenário comum (MM2-13a, MM2-13c, MM2-13d): o retiro RD da empresa 1 com 8 áreas ----------
/** Nomes como CADASTRADOS (o rótulo da faixa de categoria é este) e a forma normalizada (a chave). O touro vem fora da forma de propósito. */
const NOME = { boi: `Boi ${TAG}`, vaca: `Vaca ${TAG}`, bezerro: `Bezerro ${TAG}`, touro: ` touro ${TAG} ` };
const N = { boi: `BOI ${TAG_UP}`, vaca: `VACA ${TAG_UP}`, bezerro: `BEZERRO ${TAG_UP}`, touro: `TOURO ${TAG_UP}` };
const URL = (n: number) => `https://imagens.exemplo.test/mm2/${TAG}/c${n}.png`;
const CHAVES = ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"] as const;
type Chave = (typeof CHAVES)[number];
let RD: string;
const A = {} as Record<Chave, string>;
let Z2: string;
const CAT = {} as Record<keyof typeof NOME, string>;
const CFG = {} as Record<"boi" | "vaca" | "mistoEspecifico" | "mistoLargo" | "bezerroInativa" | "touroExcluida" | "touroDeArea" | "touroDaEmpresa2", string>;
const OBJ: string[] = [];
const USO: Record<Chave, string> = { D01: "pastagem", D02: "confinamento", D03: "ilp", D04: "pastagem", D05: "pastagem", D06: "lavoura", D07: "silvipastoril", D08: "ilpf" };
const NOME_DA_AREA = (k: Chave) => `${TAG} ${k} ${USO[k]}`;

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2).not.toBe(E1);
  hoje = (await admin.query<{ d: string }>("select current_date::text as d")).rows[0]!.d;
  especie = (await admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]!.id;
  // premissas: as capacidades da rota respondem pelo MESMO módulo de escopo (o da área); os modos do domínio são os cinco daqui
  expect(["batch_area.view", "map_objects.view", "nutritions.view", "weighings.view", "icon_config.view"].map(moduloDaPermissao))
    .toEqual(["pecuaria", "pecuaria", "pecuaria", "pecuaria", "pecuaria"]);
  expect([...MODOS_DE_COLORACAO].sort()).toEqual([...MODOS].sort());

  for (const k of Object.keys(NOME) as (keyof typeof NOME)[]) CAT[k] = await categoria(NOME[k]);

  // Configurações de ícone. Empresa 1: boi, vaca, dois MISTO (o específico cobre 2 categorias, o largo 3), o bezerro
  // INATIVO, o touro EXCLUÍDO e o touro de tipo `area` (não serve para lote). Empresa 2: o touro de lote, vivo e ativo.
  CFG.boi = await config(E1, N.boi, { url: URL(1) });
  CFG.vaca = await config(E1, N.vaca, { cor: "#00AA00" });
  CFG.mistoEspecifico = await config(E1, "MISTO", { misto: [N.boi, N.vaca], url: URL(2), cor: "#123456" });
  CFG.mistoLargo = await config(E1, "MISTO", { misto: [N.bezerro, N.boi, N.vaca], url: URL(3) });
  CFG.bezerroInativa = await config(E1, N.bezerro, { url: URL(4), ativo: false });
  CFG.touroExcluida = await config(E1, N.touro, { url: URL(5), excluida: true });
  CFG.touroDeArea = await config(E1, N.touro, { tipo: "area", url: URL(7) });
  CFG.touroDaEmpresa2 = await config(E2, N.touro, { url: URL(6) });

  RD = await retiro(E1);
  const em = (k: Chave, o: OpcoesArea) => area(E1, NOME_DA_AREA(k), { retiro: RD, uso: USO[k], ...o });
  A.D01 = await em("D01", { areaHa: "100", usavel: "5", geometria: L_LARGO });
  A.D02 = await em("D02", { areaHa: "10", usavel: "10" });
  A.D03 = await em("D03", { areaHa: "5", usavel: "5" });
  A.D04 = await em("D04", { areaHa: "4", usavel: "2", geometria: TRIANGULO });
  A.D05 = await em("D05", { areaHa: "10", usavel: "0" });
  A.D06 = await em("D06", { areaHa: "8", usavel: "8", geometria: null });
  A.D07 = await em("D07", { areaHa: "10", usavel: "10" });
  A.D08 = await em("D08", { areaHa: "10", usavel: "10" });

  const NELORE = { nome: `Nelore ${TAG}`, sigla: "NL", cor: "#AA0000" };
  // D01 — 3 lotes abertos: LA e LB com o MESMO identificador (LB com espaços nas pontas, que o btrim tira), LB2 sem.
  //       Cabeças: LA 2 boi (animais), LB 3 vaca (contagem), LB2 2 boi (contagem) → boi 4 × vaca 3 (vaca ganharia
  //       lote a lote: a soma é por ÁREA). Mais uma ocupação fechada de outro lote (-70..-60).
  const LA = await lote(E1, `${TAG} LA`, NELORE); await animal(E1, LA, CAT.boi); await animal(E1, LA, CAT.boi);
  const LB = await lote(E1, `${TAG} LB`, { nome: `Nelore ${TAG} `, sigla: " NL", cor: "#AA0000" }); await porContagem(E1, LB, CAT.vaca, 3);
  const LB2 = await lote(E1, `${TAG} LB2`); await porContagem(E1, LB2, CAT.boi, 2);
  const LK = await lote(E1, `${TAG} LK`);
  await ocupacao(E1, A.D01, LA, -10, null); await ocupacao(E1, A.D01, LB, -50, null); await ocupacao(E1, A.D01, LB2, -20, null);
  await ocupacao(E1, A.D01, LK, -70, -60);
  OBJ.push(await objeto(E1, A.D01, `${TAG} cocho D01`, "12.5"));
  // D02 — LC só com sigla (cor padrão; nome = sigla), 10 vacas; LD sem identificador e sem cabeça.
  const LC = await lote(E1, `${TAG} LC`, { sigla: "AN" }); await porContagem(E1, LC, CAT.vaca, 10);
  const LD = await lote(E1, `${TAG} LD`);
  await ocupacao(E1, A.D02, LC, -45, null); await ocupacao(E1, A.D02, LD, -3, null);
  // D03 — dois identificadores diferentes (misto); 6 + 4 bois.
  const LE = await lote(E1, `${TAG} LE`, { nome: `Angus ${TAG}`, sigla: "AG", cor: "#0000AA" }); await porContagem(E1, LE, CAT.boi, 6);
  const LF = await lote(E1, `${TAG} LF`, NELORE); await porContagem(E1, LF, CAT.boi, 4);
  await ocupacao(E1, A.D03, LE, -91, null); await ocupacao(E1, A.D03, LF, -2, null);
  OBJ.push(await objeto(E1, A.D03, `${TAG} cocho D03`));
  // D04 — 6 touros (categoria cadastrada fora da forma), lote sem identificador.
  const LG = await lote(E1, `${TAG} LG`); await porContagem(E1, LG, CAT.touro, 6);
  await ocupacao(E1, A.D04, LG, -1, null);
  // D05 — área útil 0, vazia, com uma saída 9 dias atrás.
  const LH = await lote(E1, `${TAG} LH`);
  await ocupacao(E1, A.D05, LH, -20, -9);
  // D06 — sem geometria, nunca ocupada.
  // D07 — 2 bezerros (contagem) + 1 boi VENDIDO (não conta em cabeça, UA nem categoria).
  const LI = await lote(E1, `${TAG} LI`); await porContagem(E1, LI, CAT.bezerro, 2); await animal(E1, LI, CAT.boi, "sold");
  await ocupacao(E1, A.D07, LI, -30, null);
  // D08 — 1 bezerro, 1 boi, 1 vaca no mesmo lote: só o MISTO largo cobre as três.
  const LJ = await lote(E1, `${TAG} LJ`); await porContagem(E1, LJ, CAT.bezerro, 1); await porContagem(E1, LJ, CAT.boi, 1); await porContagem(E1, LJ, CAT.vaca, 1);
  await ocupacao(E1, A.D08, LJ, -5, null);

  // Empresa 2: uma área com 5 touros — a configuração de touro DELA serve aqui, nunca na D04 (empresa 1).
  Z2 = await area(E2, `${TAG} Z2 empresa 2`);
  const LZ = await lote(E2, `${TAG} LZ`); await porContagem(E2, LZ, CAT.touro, 5);
  await ocupacao(E2, Z2, LZ, -7, null);
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

// ---------- o que cada área do RD deve devolver (conta à mão) ----------
const rotuloDoUso = (uso: string) => { const r = TIPOS_DE_USO_DA_AREA.find(([v]) => v === uso)?.[1]; if (!r) throw new Error(`uso ${uso} fora do catálogo`); return r; };
const L = ENUM_LABELS.faixa_de_lotacao_ua_ha; const S = ENUM_LABELS.situacao_do_pasto;
const SEM_REBANHO: Faixa = { chave: "sem_rebanho", rotulo: ENUM_LABELS.faixa_de_categoria.sem_rebanho, numero: null, unidade: null };
const FAIXAS = (): Record<Exclude<Modo, "padrao">, Record<Chave, Faixa>> => ({
  uso_da_area: Object.fromEntries(CHAVES.map((k) => [k, { chave: USO[k], rotulo: rotuloDoUso(USO[k]), numero: null, unidade: null }])) as Record<Chave, Faixa>,
  // UA = cabeças (fator 1, ninguém pesado) ÷ área ÚTIL
  lotacao_ua_ha: {
    D01: { chave: "ideal", rotulo: L.ideal, numero: "1.40", unidade: "ua_ha" },             // 7 ÷ 5 (útil); pela total, 7 ÷ 100 = 0,07, sublotação
    D02: { chave: "moderada", rotulo: L.moderada, numero: "1.00", unidade: "ua_ha" },       // 10 ÷ 10
    D03: { chave: "alta", rotulo: L.alta, numero: "2.00", unidade: "ua_ha" },               // 10 ÷ 5
    D04: { chave: "superlotacao", rotulo: L.superlotacao, numero: "3.00", unidade: "ua_ha" }, // 6 ÷ 2 (útil); pela total, 6 ÷ 4 = 1,50, ideal
    D05: { chave: "sem_area_util", rotulo: L.sem_area_util, numero: null, unidade: null },  // útil 0: sem denominador
    D06: { chave: "sublotacao", rotulo: L.sublotacao, numero: "0.00", unidade: "ua_ha" },   // vazia
    D07: { chave: "sublotacao", rotulo: L.sublotacao, numero: "0.20", unidade: "ua_ha" },   // 2 ÷ 10 (o vendido não conta)
    D08: { chave: "sublotacao", rotulo: L.sublotacao, numero: "0.30", unidade: "ua_ha" }    // 3 ÷ 10
  },
  // pelo início da ocupação aberta MAIS ANTIGA; vazia → descanso desde a última saída; nunca ocupada → sem registro
  situacao_pasto: {
    D01: { chave: "atencao", rotulo: S.atencao, numero: 50, unidade: "dias" },        // abertas -10, -50, -20 → 50
    D02: { chave: "normal", rotulo: S.normal, numero: 45, unidade: "dias" },          // -45 (o limite do normal) e -3
    D03: { chave: "critico", rotulo: S.critico, numero: 91, unidade: "dias" },        // -91 e -2
    D04: { chave: "normal", rotulo: S.normal, numero: 1, unidade: "dias" },
    D05: { chave: "em_descanso", rotulo: S.em_descanso, numero: 9, unidade: "dias" }, // saída -9
    D06: { chave: "sem_registro", rotulo: S.sem_registro, numero: null, unidade: null },
    D07: { chave: "normal", rotulo: S.normal, numero: 30, unidade: "dias" },
    D08: { chave: "normal", rotulo: S.normal, numero: 5, unidade: "dias" }
  },
  // predominante por cabeças somadas NA ÁREA; chave normalizada, rótulo como cadastrado; empate → menor chave
  categoria: {
    D01: { chave: N.boi, rotulo: NOME.boi, numero: 4, unidade: "cabecas" },           // boi 2 + 2 × vaca 3
    D02: { chave: N.vaca, rotulo: NOME.vaca, numero: 10, unidade: "cabecas" },
    D03: { chave: N.boi, rotulo: NOME.boi, numero: 10, unidade: "cabecas" },          // 6 + 4, de dois lotes
    D04: { chave: N.touro, rotulo: NOME.touro, numero: 6, unidade: "cabecas" },       // rótulo cru, com os espaços
    D05: SEM_REBANHO,
    D06: SEM_REBANHO,
    D07: { chave: N.bezerro, rotulo: NOME.bezerro, numero: 2, unidade: "cabecas" },   // o boi vendido não conta
    D08: { chave: N.bezerro, rotulo: NOME.bezerro, numero: 1, unidade: "cabecas" }    // 1 × 1 × 1: BEZERRO < BOI < VACA
  }
});
const SEM_ICONE = (categorias: string[]): Icone => ({ config_id: null, categoria: null, icone_url: null, cor_padrao: null, categorias });
const ICONES = (): Record<Chave, Icone> => ({
  D01: { config_id: CFG.mistoEspecifico, categoria: "MISTO", icone_url: URL(2), cor_padrao: "#123456", categorias: [N.boi, N.vaca] }, // o MISTO de 2, não o de 3
  D02: { config_id: CFG.vaca, categoria: N.vaca, icone_url: null, cor_padrao: "#00AA00", categorias: [N.vaca] },
  D03: { config_id: CFG.boi, categoria: N.boi, icone_url: URL(1), cor_padrao: null, categorias: [N.boi] },
  D04: SEM_ICONE([N.touro]),          // a de touro da empresa 1 está excluída ou é de área; a da empresa 2 não serve aqui
  D05: SEM_ICONE([]),
  D06: SEM_ICONE([]),
  D07: SEM_ICONE([N.bezerro]),        // a de bezerro está inativa; UMA categoria nunca cai no MISTO
  D08: { config_id: CFG.mistoLargo, categoria: "MISTO", icone_url: URL(3), cor_padrao: null, categorias: [N.bezerro, N.boi, N.vaca] }
});
const IDENTIFICADORES = (): Record<Chave, Identificador | null> => ({
  D01: { misto: false, cor: "#AA0000", sigla: "NL", nome: `Nelore ${TAG}` },          // LA e LB iguais depois do btrim; LB2 não vota
  D02: { misto: false, cor: COR_PADRAO_DO_IDENTIFICADOR, sigla: "AN", nome: "AN" },   // só sigla: cor padrão, nome = sigla
  D03: { misto: true },
  D04: null, D05: null, D06: null, D07: null, D08: null
});

// ==================================================================================================
// MM2-13a — chaves novas presentes, as antigas INTACTAS (nome e tipo)
// ==================================================================================================
type Tipo = "string" | "number" | "boolean" | "object" | "array" | "null";
const tipoDe = (v: unknown): Tipo | "outro" => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? t : "outro";
};
type Nivel = "topo" | "capacidades" | "area" | "lote" | "loteDoLote" | "objeto";
/** ANTES — as chaves e os tipos da fatia 01 (a rota em 45d05ed5), nível a nível; "null" só onde a 01 permitia null. */
const CHAVES_ANTES: Record<Nivel, Record<string, readonly Tipo[]>> = {
  topo: { hoje: ["string"], estacao: ["string"], capacidades: ["object"], areas: ["array"], objetos: ["array"] },
  capacidades: { objetos: ["boolean"], manejo: ["boolean"], pesagem: ["boolean"] },
  area: {
    id: ["string"], empresa_id: ["string"], name: ["string"], code: ["string"], color: ["string", "null"], area_ha: ["string"], usable_area_ha: ["string"],
    land_use: ["string"], status: ["string"], geometria: ["object", "null"], retiro_id: ["string", "null"], grazing_module_id: ["string", "null"],
    support_capacity_rainy_ua_ha: ["string", "null"], support_capacity_dry_ua_ha: ["string", "null"], max_stocking_ua: ["string", "null"],
    ocupada: ["boolean"], lotes: ["array"], cabecas_total: ["number"], ua_total: ["string"], ultima_saida: ["string", "null"],
    dias_de_descanso: ["number", "null"], ua_por_hectare: ["string", "null"], capacidade_da_estacao: ["string", "null"],
    situacao_de_lotacao: ["string", "null"], ultimo_manejo: ["string", "null"], ultima_pesagem: ["string", "null"]
  },
  lote: {
    id: ["string"], lote: ["object"], cabecas: ["number"], ua: ["string"], cabecas_na_entrada: ["number", "null"], ua_na_entrada: ["string", "null"],
    data_inicio: ["string"], origem_da_data: ["string"], dias_de_ocupacao: ["number"]
  },
  loteDoLote: { id: ["string"], code: ["string", "null"], description: ["string", "null"] },
  objeto: {
    id: ["string"], empresa_id: ["string"], area_id: ["string", "null"], tipo: ["string"], forma: ["string"], geometria: ["object"], code: ["string", "null"],
    name: ["string"], descricao: ["string", "null"], capacidade: ["string", "null"], unidade_capacidade: ["string", "null"], trough_id: ["string", "null"],
    is_active: ["boolean"]
  }
};
/** O que a 02 ACRESCENTOU (e o tipo de cada uma). Lote e objeto não ganharam chave. */
const CHAVES_ACRESCIDAS: Record<Nivel, Record<string, readonly Tipo[]>> = {
  topo: { coloracao: ["string"] },
  capacidades: { icones: ["boolean"] },
  area: { centroide: ["object", "null"], identificador: ["object", "null"], icone: ["object", "null"], faixa: ["object", "null"] },
  lote: {}, loteDoLote: {}, objeto: {}
};
/** DEPOIS — as chaves da resposta da 02, escritas por extenso, em ordem alfabética. */
const CHAVES_DEPOIS: Record<Nivel, readonly string[]> = {
  topo: ["areas", "capacidades", "coloracao", "estacao", "hoje", "objetos"],
  capacidades: ["icones", "manejo", "objetos", "pesagem"],
  area: [
    "area_ha", "cabecas_total", "capacidade_da_estacao", "centroide", "code", "color", "dias_de_descanso", "empresa_id", "faixa", "geometria",
    "grazing_module_id", "icone", "id", "identificador", "land_use", "lotes", "max_stocking_ua", "name", "ocupada", "retiro_id", "situacao_de_lotacao",
    "status", "support_capacity_dry_ua_ha", "support_capacity_rainy_ua_ha", "ua_por_hectare", "ua_total", "ultima_pesagem", "ultima_saida",
    "ultimo_manejo", "usable_area_ha"
  ],
  lote: ["cabecas", "cabecas_na_entrada", "data_inicio", "dias_de_ocupacao", "id", "lote", "origem_da_data", "ua", "ua_na_entrada"],
  loteDoLote: ["code", "description", "id"],
  objeto: ["area_id", "capacidade", "code", "descricao", "empresa_id", "forma", "geometria", "id", "is_active", "name", "tipo", "trough_id", "unidade_capacidade"]
};
const NIVEIS: readonly Nivel[] = ["topo", "capacidades", "area", "lote", "loteDoLote", "objeto"];

/** As três conferências de UM objeto da resposta: conjunto de chaves = DEPOIS; nenhuma de ANTES sumiu; tipo de cada uma. */
function conferirChaves(nivel: Nivel, obj: Record<string, unknown>, onde: string) {
  expect(Object.keys(obj).sort(), `${onde}: chaves`).toEqual([...CHAVES_DEPOIS[nivel]]);
  expect(Object.keys(CHAVES_ANTES[nivel]).filter((k) => !(k in obj)), `${onde}: chave antiga sumiu`).toEqual([]);
  const foraDoTipo = (spec: Record<string, readonly Tipo[]>) =>
    Object.entries(spec).filter(([k, tipos]) => !(tipos as readonly string[]).includes(tipoDe(obj[k]))).map(([k]) => `${k}: ${tipoDe(obj[k])}`);
  expect(foraDoTipo(CHAVES_ANTES[nivel]), `${onde}: chave antiga com outro tipo`).toEqual([]);
  expect(foraDoTipo(CHAVES_ACRESCIDAS[nivel]), `${onde}: chave nova com tipo fora do contrato`).toEqual([]);
}

describe("MM2-13a — chaves novas presentes e as antigas INTACTAS (nome e tipo), em todos os modos", () => {
  it("MM2-13a DEPOIS = ANTES ∪ ACRESCIDAS; topo, capacidades, cada área, cada lote e cada objeto conferidos nos 5 modos", async () => {
    // as constantes entre si: as acrescidas são novas de fato e DEPOIS é exatamente a união
    for (const nivel of NIVEIS) {
      const antes = Object.keys(CHAVES_ANTES[nivel]); const novas = Object.keys(CHAVES_ACRESCIDAS[nivel]);
      expect(novas.filter((k) => antes.includes(k)), `${nivel}: acrescida que já existia`).toEqual([]);
      expect([...antes, ...novas].sort(), nivel).toEqual([...CHAVES_DEPOIS[nivel]]);
    }
    const contados = { respostas: 0, areas: 0, lotes: 0, objetos: 0, centroides: 0, identificadores: 0, icones: 0, faixas: 0 };
    for (const modo of MODOS) {
      const r = await ok(`/api/mapa/operacional?retiro_id=${RD}&coloracao=${modo}`);
      contados.respostas++;
      conferirChaves("topo", r, modo);
      expect(r.coloracao).toBe(modo);
      conferirChaves("capacidades", r.capacidades, `${modo} capacidades`);
      for (const a of r.areas) {
        contados.areas++;
        conferirChaves("area", a, `${modo} área ${a.name}`);
        for (const l of a.lotes) {
          contados.lotes++;
          conferirChaves("lote", l, `${modo} lote ${l.id}`);
          conferirChaves("loteDoLote", l.lote, `${modo} lote.lote ${l.id}`);
        }
        // a forma interna das chaves novas
        if (a.centroide) { contados.centroides++; expect(Object.keys(a.centroide).sort()).toEqual(["lat", "lon"]); expect([typeof a.centroide.lon, typeof a.centroide.lat]).toEqual(["number", "number"]); }
        if (a.identificador) { contados.identificadores++; expect(Object.keys(a.identificador).sort()).toEqual(a.identificador.misto ? ["misto"] : ["cor", "misto", "nome", "sigla"]); }
        if (a.icone) { contados.icones++; expect(Object.keys(a.icone).sort()).toEqual(["categoria", "categorias", "config_id", "cor_padrao", "icone_url"]); expect(Array.isArray(a.icone.categorias)).toBe(true); }
        if (a.faixa) { contados.faixas++; expect(Object.keys(a.faixa).sort()).toEqual(["chave", "numero", "rotulo", "unidade"]); }
        expect(a.faixa === null, `${modo} ${a.name}: faixa só fora do padrão`).toBe(modo === "padrao");
      }
      for (const o of r.objetos) { contados.objetos++; conferirChaves("objeto", o, `${modo} objeto ${o.id}`); }
    }
    // verde sem dado é reprovação: 5 respostas × (8 áreas, 10 lotes abertos, 2 objetos); centróide em 7 de 8 (D06 sem
    // geometria); identificador em 3; ícone em todas (o dono tem icon_config.view); faixa em 8 × 4 modos
    expect(contados).toEqual({ respostas: 5, areas: 40, lotes: 50, objetos: 10, centroides: 35, identificadores: 15, icones: 40, faixas: 32 });
  });
});

// ==================================================================================================
// MM2-13b — consultas CONTADAS: as mesmas 8 da 01, com 3 e com 30 áreas, em cada modo
// ==================================================================================================
type Contagem = {
  total: number; texto: number; areas: number; ocupacoes: number; lotes: number; animais: number; contagem: number; categorias: number;
  objetos: number; icones: number; manejos: number; pesagens: number; iconesNaDosObjetos: number; categoriasNaDoRebanho: number;
};
type Consulta = { sql: string; colunas: string[]; linhas: Record<string, unknown>[] };
/** O que `pg.Client.prototype.query` resolve (só o que a medição lê). */
type ResultadoLido = { fields?: { name: string }[]; rows?: Record<string, unknown>[] };
/**
 * Mede a ROTA (não o cache frio do plugin de autenticação, aquecido pela 1ª chamada): o SQL de cada consulta e o que
 * ela devolveu (colunas e linhas — o resultado de cada chamada de `pg.Client.prototype.query`).
 */
async function medir(url: string, headers: Hdr = h.headers()): Promise<{ n: Contagem; corpo: Operacional; consultas: Consulta[] }> {
  await ok(url, headers);
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const corpo = await ok(url, headers);
    const chamadas = espiao.mock.calls.map((c) => c[0] as unknown);
    const resultados: unknown[] = espiao.mock.results.map((r) => r.value as unknown);
    const consultas: Consulta[] = [];
    for (const [i, c] of chamadas.entries()) {
      let lido: ResultadoLido | null = null;
      try { lido = (await resultados[i]) as ResultadoLido | null; } catch { lido = null; }
      consultas.push({ sql: typeof c === "string" ? c : "", colunas: (lido?.fields ?? []).map((f) => f.name), linhas: lido?.rows ?? [] });
    }
    const sqls = chamadas.filter((x): x is string => typeof x === "string");
    const de = (forma: RegExp) => sqls.filter((s) => forma.test(s)).length;
    const com = (...formas: RegExp[]) => sqls.filter((s) => formas.every((f) => f.test(s))).length;
    return {
      corpo, consultas,
      n: {
        total: chamadas.length, texto: sqls.length,
        areas: de(/erp\.areas\b/), ocupacoes: de(/erp\.ocupacoes_de_area\b/), lotes: de(/erp\.batches\b/), animais: de(/erp\.animals\b/),
        contagem: de(/erp\.herd_lots\b/), categorias: de(/erp\.animal_categories\b/), objetos: de(/erp\.objetos_de_mapa\b/),
        icones: de(/erp\.configuracoes_de_icone\b/), manejos: de(/erp\.animal_handlings\b/), pesagens: de(/erp\.weighings\b/),
        iconesNaDosObjetos: com(/erp\.objetos_de_mapa\b/, /erp\.configuracoes_de_icone\b/),
        categoriasNaDoRebanho: com(/erp\.animals\b/, /erp\.herd_lots\b/, /erp\.animal_categories\b/)
      }
    };
  } finally { espiao.mockRestore(); }
}

describe("MM2-13b — consultas CONTADAS e FIXAS em cada modo: 3 e 30 áreas, no máximo as 8 da 01", () => {
  /** `n` áreas num retiro novo: geometria, um lote aberto IDENTIFICADO com 3 bois (ícone de boi casa), uma saída, um objeto, um manejo e uma pesagem. */
  async function cenario(n: number): Promise<string> {
    const R = await retiro(E1);
    const passado = await lote(E1, `${TAG} conta passado ${n}`);
    for (let i = 0; i < n; i++) {
      const a = await area(E1, `${TAG} conta ${n} ${String(i).padStart(2, "0")}`, { areaHa: "10", usavel: "5", retiro: R });
      const l = await lote(E1, `${TAG} conta ${n} L${i}`, { nome: `Lote ${n}-${i}`, sigla: "CT", cor: "#336699" });
      await animal(E1, l, CAT.boi); await porContagem(E1, l, CAT.boi, 2);
      await ocupacao(E1, a, l, -5, null);
      await ocupacao(E1, a, passado, -40 - i * 3, -39 - i * 3);
      await objeto(E1, a, `${TAG} conta ${n} cocho ${i}`);
      await manejo(E1, l, -2); await pesagem(E1, l, -1);
    }
    return R;
  }
  /** O que cada área do cenário devolve no modo (a premissa: o dado que as consultas deveriam multiplicar está lá). */
  const faixaDoCenario = (modo: Modo): Faixa | null => ({
    padrao: null,
    uso_da_area: { chave: "pastagem", rotulo: rotuloDoUso("pastagem"), numero: null, unidade: null },
    lotacao_ua_ha: { chave: "sublotacao", rotulo: L.sublotacao, numero: "0.60", unidade: "ua_ha" }, // 3 ÷ 5
    situacao_pasto: { chave: "normal", rotulo: S.normal, numero: 5, unidade: "dias" },
    categoria: { chave: N.boi, rotulo: NOME.boi, numero: 3, unidade: "cabecas" }
  } satisfies Record<Modo, Faixa | null>)[modo];

  it("MM2-13b 3 e 30 áreas, nos 5 modos: total 8 (≤ 8), por tabela igual; ícones na consulta dos objetos; categorias na do rebanho", async () => {
    const R3 = await cenario(3);
    const R30 = await cenario(30);
    // begin + áreas (1) + abertas com lote e identificador (1) + últimas saídas (1) + rebanho com categorias (1)
    // + objetos E configurações de ícone (1) + último manejo e última pesagem (1) + commit = 8 — o número da 01
    const esperado: Contagem = {
      total: 8, texto: 8, areas: 1, ocupacoes: 2, lotes: 1, animais: 1, contagem: 1, categorias: 1, objetos: 1, icones: 1, manejos: 1, pesagens: 1,
      iconesNaDosObjetos: 1, categoriasNaDoRebanho: 1
    };
    const porModo: Record<string, { tres: Contagem; trinta: Contagem }> = {};
    for (const modo of MODOS) {
      const p = await medir(`/api/mapa/operacional?retiro_id=${R3}&coloracao=${modo}`);
      const g = await medir(`/api/mapa/operacional?retiro_id=${R30}&coloracao=${modo}`);
      porModo[modo] = { tres: p.n, trinta: g.n };
      // as duas contagens numa asserção só: quando falha, o diff mostra o modo, tabela por tabela, com 3 e 30 lado a lado
      expect({ modo, tres: p.n, trinta: g.n }).toEqual({ modo, tres: esperado, trinta: esperado });
      expect(Math.max(p.n.total, g.n.total), `${modo}: nunca acima das 8 da 01`).toBeLessThanOrEqual(8);

      // premissas: o cenário inteiro chegou, com geometria, identificador, ícone que CASA e faixa (verde sem dado é reprovação)
      expect([p.corpo.areas.length, p.corpo.objetos.length, g.corpo.areas.length, g.corpo.objetos.length], modo).toEqual([3, 3, 30, 30]);
      for (const c of [p.corpo, g.corpo]) {
        expect(c.coloracao).toBe(modo);
        for (const a of c.areas) {
          expect({
            lotes: a.lotes.length, cabecas: a.cabecas_total, ua: a.ua_total, manejo: a.ultimo_manejo, pesagem: a.ultima_pesagem, saida: a.ultima_saida !== null,
            centroide: a.centroide && dentroDoPoligono(a.centroide, QUADRADO), identificador: a.identificador, config: a.icone?.config_id, faixa: a.faixa
          }, `${modo} ${a.name}`).toEqual({
            lotes: 1, cabecas: 3, ua: "3.00", manejo: dia(-2), pesagem: dia(-1), saida: true,
            centroide: true, identificador: { misto: false, cor: "#336699", sigla: "CT", nome: expect.stringMatching(/^Lote (3|30)-\d+$/) }, config: CFG.boi,
            faixa: faixaDoCenario(modo)
          });
        }
      }

      // as configurações de ícone vêm na MESMA consulta dos objetos (a que já existia na 01): é a única que as lê, e
      // devolve as duas colunas; as de boi da empresa 1 estão lá
      for (const m of [p, g]) {
        const deIcone = m.consultas.filter((c) => /erp\.configuracoes_de_icone\b/.test(c.sql));
        expect(deIcone.map((c) => [/erp\.objetos_de_mapa\b/.test(c.sql), c.colunas]), modo).toEqual([[true, ["objetos", "icones"]]]);
        const linha = deIcone[0]!.linhas[0]! as { objetos: { id: string }[]; icones: { id: string }[] };
        expect(linha.objetos.length, modo).toBe(m === p ? 3 : 30);
        expect(ids(linha.icones), modo).toEqual(expect.arrayContaining([CFG.boi, CFG.vaca, CFG.mistoEspecifico, CFG.mistoLargo]));
        // as categorias presentes vêm da consulta do REBANHO (cabeças e UA na mesma linha): nenhuma outra consulta as devolve
        const comCategorias = m.consultas.filter((c) => c.colunas.includes("categorias"));
        expect(comCategorias.map((c) => [c.colunas, /erp\.animals\b/.test(c.sql) && /erp\.herd_lots\b/.test(c.sql)]), modo)
          .toEqual([[["batch_id", "cabecas", "peso_kg", "ua_fator", "categorias"], true]]);
        expect(comCategorias[0]!.linhas.map((x) => x.categorias), modo).toEqual(Array.from({ length: m === p ? 3 : 30 }, () => [{ nome: NOME.boi, cabecas: 3 }]));
      }
    }
    // e a tabela inteira: os 5 modos medidos, todos iguais
    expect(porModo).toEqual(Object.fromEntries(MODOS.map((m) => [m, { tres: esperado, trinta: esperado }])));
  }, 180_000);
});

// ==================================================================================================
// MM2-13c — capacidade × ícone: sem icon_config.view → ícone null; com ela e sem map_objects.view → objetos [] e ícones
// ==================================================================================================
describe("MM2-13c — icon_config.view decide o bloco do ícone; sem map_objects.view a consulta roda só com a parte dos ícones", () => {
  it("MM2-13c sem icon_config.view: capacidades.icones false e icone null em TODA área; com ela e sem map_objects.view: objetos [] e ícones iguais aos do dono", async () => {
    const soArea = await membro("MM2 so area", ["batch_area.view"]);
    const comIcones = await membro("MM2 icones sem objetos", ["batch_area.view", "icon_config.view"]);
    const url = `/api/mapa/operacional?retiro_id=${RD}`;
    // premissas: o dono vê os objetos do RD e o ícone resolvido de 4 das 8 áreas
    const dono = await ok(url);
    expect(dono.capacidades).toEqual({ objetos: true, manejo: true, pesagem: true, icones: true });
    expect(ids(dono.objetos).sort()).toEqual([...OBJ].sort());
    expect(ids(dono.areas)).toEqual(CHAVES.map((k) => A[k]));
    expect(dono.areas.map((a) => a.icone?.config_id ?? null)).toEqual(CHAVES.map((k) => ICONES()[k].config_id));
    expect(dono.areas.filter((a) => a.icone?.config_id).length).toBe(4);
    const semDocs = (xs: AreaOp[], icone?: null) => xs.map((x) => ({ ...x, ultimo_manejo: null, ultima_pesagem: null, ...(icone === null ? { icone: null } : {}) }));

    const a = await medir(url, soArea);
    expect(a.corpo.capacidades).toEqual({ objetos: false, manejo: false, pesagem: false, icones: false });
    expect(a.corpo.objetos).toEqual([]);
    expect(a.corpo.areas.map((x) => x.icone)).toEqual(Array.from({ length: 8 }, () => null));
    // o resto da área é o do dono (capacidade não mexe em centróide, identificador, faixa nem lotação)
    expect(semDocs(a.corpo.areas)).toEqual(semDocs(dono.areas, null));
    // a configuração nem é lida, e a consulta dos objetos não roda
    expect([a.n.icones, a.n.objetos]).toEqual([0, 0]);

    const c = await medir(url, comIcones);
    expect(c.corpo.capacidades).toEqual({ objetos: false, manejo: false, pesagem: false, icones: true });
    expect(c.corpo.objetos).toEqual([]);
    expect(c.corpo.areas.map((x) => x.icone)).toEqual(CHAVES.map((k) => ICONES()[k]));
    expect(semDocs(c.corpo.areas)).toEqual(semDocs(dono.areas));
    // a consulta (5) roda SÓ com a parte dos ícones: nenhuma consulta lê erp.objetos_de_mapa; a coluna `objetos` vem nula
    const deIcone = c.consultas.filter((x) => /erp\.configuracoes_de_icone\b/.test(x.sql));
    expect(deIcone.map((x) => [/erp\.objetos_de_mapa\b/.test(x.sql), x.colunas, x.linhas.length, x.linhas[0]?.objetos])).toEqual([[false, ["objetos", "icones"], 1, null]]);
    // begin + áreas + abertas + saídas + rebanho + ícones + commit (sem manejo e pesagem: sem as capacidades)
    expect({ total: c.n.total, objetos: c.n.objetos, icones: c.n.icones, manejos: c.n.manejos, pesagens: c.n.pesagens })
      .toEqual({ total: 7, objetos: 0, icones: 1, manejos: 0, pesagens: 0 });
  });
});

// ==================================================================================================
// MM2-13d — ?coloracao=: cada modo área por área; centróide, identificador e ícone
// ==================================================================================================
describe("MM2-13d — cada modo de coloração com dado semeado; centróide, identificador e ícone por área", () => {
  it("MM2-13d faixas de uso_da_area, lotacao_ua_ha, situacao_pasto e categoria conferidas área por área (chave, rótulo, número, unidade); padrao → null", async () => {
    const faixas = FAIXAS();
    for (const modo of MODOS) {
      const r = await ok(`/api/mapa/operacional?retiro_id=${RD}&coloracao=${modo}`);
      expect(r.coloracao).toBe(modo);
      expect(r.areas.map((a) => a.name), modo).toEqual(CHAVES.map(NOME_DA_AREA));
      expect(r.areas.map((a) => [a.name, a.faixa]), modo)
        .toEqual(CHAVES.map((k) => [NOME_DA_AREA(k), modo === "padrao" ? null : faixas[modo][k]]));
    }
    // premissas das contas à mão: cabeças e UA por área; área útil ≠ total na D01 e D04; D05 com área útil 0
    const p = await ok(`/api/mapa/operacional?retiro_id=${RD}`);
    expect(p.areas.map((a) => [a.cabecas_total, a.ua_total, a.area_ha, a.usable_area_ha, a.ua_por_hectare])).toEqual([
      [7, "7.00", "100.0000", "5.0000", "1.40"], [10, "10.00", "10.0000", "10.0000", "1.00"], [10, "10.00", "5.0000", "5.0000", "2.00"],
      [6, "6.00", "4.0000", "2.0000", "3.00"], [0, "0.00", "10.0000", "0.0000", null], [0, "0.00", "8.0000", "8.0000", "0.00"],
      [2, "2.00", "10.0000", "10.0000", "0.20"], [3, "3.00", "10.0000", "10.0000", "0.30"]
    ]);
    // os usos são de verdade diferentes (6 distintos) e o modo padrão é o de quem não pede
    expect(new Set(p.areas.map((a) => a.land_use)).size).toBe(6);
    expect([p.coloracao, p.areas.every((a) => a.faixa === null)]).toEqual(["padrao", true]);
  });

  it("MM2-13d coloracao fora da lista → 422 (nunca traduzida, nunca ignorada)", async () => {
    for (const qs of ["coloracao=foo", "coloracao=", "coloracao=PADRAO", "coloracao=Categoria", "coloracao=lotacao", "coloracao=padrao&coloracao=categoria"]) {
      const r = await get(`/api/mapa/operacional?${qs}`);
      expect(r.statusCode, `${qs}: ${r.body}`).toBe(422);
      const e = (r.json() as { error: { code: string; details?: { path: string }[] } }).error;
      expect([e.code, (e.details ?? []).map((d) => d.path)], qs).toEqual(["VALIDATION_ERROR", ["coloracao"]]);
    }
  });

  it("MM2-13d centróide dentro do polígono semeado (o L não usa a caixa); identificador um, misto e nenhum; ícone MISTO mais específico; config de OUTRA empresa não serve", async () => {
    const r = await ok(`/api/mapa/operacional?retiro_id=${RD}&coloracao=categoria`);
    const porChave = Object.fromEntries(CHAVES.map((k) => [k, achar(r, A[k])])) as Record<Chave, AreaOp>;

    // CENTRÓIDE: ponto em polígono nas 7 com geometria; D06 sem geometria → null
    const GEOM: Record<Chave, typeof QUADRADO | null> = { D01: L_LARGO, D02: QUADRADO, D03: QUADRADO, D04: TRIANGULO, D05: QUADRADO, D06: null, D07: QUADRADO, D08: QUADRADO };
    expect(CHAVES.map((k) => { const c = porChave[k].centroide; const g = GEOM[k]; return [k, c === null ? null : g !== null && dentroDoPoligono(c, g)]; }))
      .toEqual(CHAVES.map((k) => [k, k === "D06" ? null : true]));
    // no L o centróide de área é (3,875; 3,875) local; o centro da caixa cai FORA do L (premissa da escolha)
    expect(porChave.D01.centroide).toEqual({ lon: expect.closeTo(-55.196125, 6), lat: expect.closeTo(-15.196125, 6) });
    expect(dentroDoPoligono({ lon: -55.195, lat: -15.195 }, L_LARGO)).toBe(false);
    expect(porChave.D04.centroide).toEqual({ lon: expect.closeTo(-55.3 + 0.01 / 3, 6), lat: expect.closeTo(-15.3 + 0.01 / 3, 6) });
    expect(porChave.D02.centroide).toEqual({ lon: expect.closeTo(-54.995, 6), lat: expect.closeTo(-15.005, 6) });

    // IDENTIFICADOR: um (D01, com btrim; D02 só sigla), misto (D03), nenhum (lote sem identificador ou área vazia)
    expect(CHAVES.map((k) => [k, porChave[k].identificador])).toEqual(CHAVES.map((k) => [k, IDENTIFICADORES()[k]]));

    // ÍCONE: área por área (MISTO de 2 na D01, MISTO de 3 na D08, exata na D02 e D03, nenhuma nas outras)
    expect(CHAVES.map((k) => [k, porChave[k].icone])).toEqual(CHAVES.map((k) => [k, ICONES()[k]]));

    // OUTRA EMPRESA: sem recorte (as duas empresas na MESMA resposta, as configurações das duas lidas), a de touro da
    // empresa 2 serve à Z2 e não à D04 da empresa 1 — que tem touro e nenhuma configuração dela que valha
    const tudo = await ok("/api/mapa/operacional?coloracao=categoria");
    const d04 = achar(tudo, A.D04); const z2 = achar(tudo, Z2);
    expect([d04.empresa_id, z2.empresa_id]).toEqual([E1, E2]);
    expect(z2.icone).toEqual({ config_id: CFG.touroDaEmpresa2, categoria: N.touro, icone_url: URL(6), cor_padrao: null, categorias: [N.touro] });
    expect(z2.faixa).toEqual({ chave: N.touro, rotulo: NOME.touro, numero: 5, unidade: "cabecas" });
    expect(d04.icone).toEqual(SEM_ICONE([N.touro]));
    expect(tudo.areas.filter((a) => a.empresa_id === E1).map((a) => a.icone?.config_id).filter((c) => c === CFG.touroDaEmpresa2)).toEqual([]);
    // e as excluídas, inativas e de outro tipo de entidade não servem a ninguém
    const usadas = new Set(tudo.areas.map((a) => a.icone?.config_id).filter((c): c is string => typeof c === "string"));
    expect([CFG.touroExcluida, CFG.bezerroInativa, CFG.touroDeArea].filter((c) => usadas.has(c))).toEqual([]);
  });
});

// ==================================================================================================
// MM2-14a — a transferência de lote: contrato INALTERADO; a ocupação abre e fecha como na 01
// ==================================================================================================
describe("MM2-14a — transferência: o contrato é o de antes e o mapa acompanha", () => {
  type Ocupacao = { area_id: string; data_inicio: string; data_fim: string | null; origem_da_data: string; motivo_saida: string | null; movimento_entrada_id: string | null; movimento_saida_id: string | null; cabecas_na_entrada: number | null; ua_na_entrada: string | null };
  const ocupacoesDoLote = async (loteId: string) => (await admin.query<Ocupacao>(
    `select area_id::text as area_id, data_inicio::text as data_inicio, data_fim::text as data_fim, origem_da_data, motivo_saida,
            movimento_entrada_id::text as movimento_entrada_id, movimento_saida_id::text as movimento_saida_id, cabecas_na_entrada, ua_na_entrada::text as ua_na_entrada
       from erp.ocupacoes_de_area where organization_id=$1 and batch_id=$2 order by created_at, data_inicio`, [h.demo.orgId, loteId])).rows;
  const transferir = (payload: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: "/api/livestock/transfers/batch-to-module-area", headers: { ...h.headers(), "content-type": "application/json" }, payload });

  it("MM2-14a POST /livestock/transfers/batch-to-module-area: 201 com EXATAMENTE [code, id]; fecha a de origem, abre a de destino; o mapa mostra o lote e o identificador na área nova", async () => {
    const RT = await retiro(E1);
    const T1 = await area(E1, `${TAG} T1 origem`, { retiro: RT });
    const T2 = await area(E1, `${TAG} T2 destino`, { retiro: RT });
    // o lote nasce em T1 (o gatilho abre a ocupação com a entry_date), identificado, com 4 vacas
    const l = await id(`insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, area_id, entry_date, status,
                                                 identificador_nome, identificador_sigla, identificador_cor)
                        values ($1,$2,$3,$4::date,$5,$6,'pasture',$7,$4::date,'active',$8,'TR','#ABCDEF') returning id`,
      [h.demo.orgId, E1, unico(), dia(-10), `${TAG} lote transferido`, especie, T1, `Transferido ${TAG}`]);
    await porContagem(E1, l, CAT.vaca, 4);
    const IDENT = { misto: false, cor: "#ABCDEF", sigla: "TR", nome: `Transferido ${TAG}` };
    expect(await ocupacoesDoLote(l), "premissa: o gatilho abriu a ocupação em T1").toEqual([
      { area_id: T1, data_inicio: dia(-10), data_fim: null, origem_da_data: "entrada_do_lote", motivo_saida: null, movimento_entrada_id: null, movimento_saida_id: null, cabecas_na_entrada: null, ua_na_entrada: null }
    ]);
    const antes = await ok(`/api/mapa/operacional?retiro_id=${RT}&coloracao=situacao_pasto`);
    expect(antes.areas.map((a) => [a.id, a.lotes.map((x) => x.lote.id), a.identificador, a.faixa?.chave])).toEqual([
      [T1, [l], IDENT, "normal"], [T2, [], null, "sem_registro"]
    ]);

    // o corpo que a web envia (opcionais em null): 201 com EXATAMENTE { code, id }
    const r = await transferir({ empresa_id: E1, movement_date: hoje, batch_id: l, grazing_module_id: null, area_id: T2, corral_id: null, note: null });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = r.json() as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(["code", "id"]);
    expect(corpo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(corpo.code).toMatch(/^\d{5,}$/);
    const m1 = corpo.id as string;
    expect(await ocupacoesDoLote(l)).toEqual([
      { area_id: T1, data_inicio: dia(-10), data_fim: hoje, origem_da_data: "entrada_do_lote", motivo_saida: "transferencia", movimento_entrada_id: null, movimento_saida_id: m1, cabecas_na_entrada: null, ua_na_entrada: null },
      { area_id: T2, data_inicio: hoje, data_fim: null, origem_da_data: "movimento", motivo_saida: null, movimento_entrada_id: m1, movimento_saida_id: null, cabecas_na_entrada: 4, ua_na_entrada: "4.00" }
    ]);
    const depois = await ok(`/api/mapa/operacional?retiro_id=${RT}&coloracao=situacao_pasto`);
    expect(depois.areas.map((a) => [a.id, a.lotes.map((x) => x.lote.id), a.identificador, a.faixa, a.icone?.config_id ?? null, a.icone?.categorias])).toEqual([
      [T1, [], null, { chave: "em_descanso", rotulo: S.em_descanso, numero: 0, unidade: "dias" }, null, []],
      [T2, [l], IDENT, { chave: "normal", rotulo: S.normal, numero: 0, unidade: "dias" }, CFG.vaca, [N.vaca]]
    ]);

    // o corpo MÍNIMO (sem as opcionais) continua aceito, com a mesma resposta; volta para T1
    const r2 = await transferir({ empresa_id: E1, movement_date: hoje, batch_id: l, area_id: T1 });
    expect(r2.statusCode, r2.body).toBe(201);
    expect(Object.keys(r2.json() as Record<string, unknown>).sort()).toEqual(["code", "id"]);
    const m2 = (r2.json() as { id: string }).id;
    const o = await ocupacoesDoLote(l);
    expect(o.map((x) => [x.area_id, x.data_inicio, x.data_fim, x.motivo_saida, x.movimento_entrada_id, x.movimento_saida_id])).toEqual([
      [T1, dia(-10), hoje, "transferencia", null, m1], [T2, hoje, hoje, "transferencia", m1, m2], [T1, hoje, null, null, m2, null]
    ]);
    expect(o.filter((x) => x.data_fim === null)).toHaveLength(1);
  });
});
