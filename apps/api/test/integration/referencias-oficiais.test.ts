import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { harness, configDeTeste, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS Fase 3 — referências oficiais no BANCO (0026), buscas, consultas de CEP e CNPJ pela API
 * (fontes em MOCK: nenhuma chamada de rede) e formulários de hoje usando as buscas.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0]!;
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p)).n);

/** Instância da API sobre o mesmo banco, com fontes externas em mock e contagem de chamadas. */
type Rota = { status: number; body?: unknown } | "rede";
async function apiComFontes(rotas: Record<string, Rota | Rota[]>, env: Record<string, string> = {}) {
  const chamadas: string[] = [];
  const buscarExterno: BuscarFn = async (url) => {
    chamadas.push(url);
    const def = rotas[new URL(url).host]; const r = Array.isArray(def) ? def.shift() : def;
    if (!r || r === "rede") throw new TypeError("fetch failed");
    return { status: r.status, headers: { get: () => null }, json: async () => r.body };
  };
  const app: FastifyInstance = await buildApp({ config: configDeTeste(env), db: h.db, logger: false, buscarExterno });
  return { app, chamadas, get: (url: string, headers = h.headers()) => app.inject({ method: "GET", url, headers }) };
}

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("RF-1 cargas no banco (0026)", () => {
  it("≥ 5.570 municípios com a UF do prefixo IBGE; 27 UFs", async () => {
    expect(await n("select count(*)::text n from erp.cities")).toBeGreaterThanOrEqual(5570);
    expect(await n("select count(*)::text n from erp.states")).toBe(27);
    expect(await n("select count(*)::text n from erp.cities c join erp.states s on s.code=c.state_code where left(c.id::text,2)::int <> s.ibge_code")).toBe(0);
    expect(await um("select name, state_code from erp.cities where id=5101837")).toEqual({ name: "Boa Esperança do Norte", state_code: "MT" });
  });
  it("bancos 001, 104, 237, 341, 260 com ISPB; os 10 do seed continuam (inclusive 000)", async () => {
    expect(await n("select count(*)::text n from erp.banks where code = any($1) and ispb ~ '^[0-9]{8}$'", [["001", "104", "237", "341", "260"]])).toBe(5);
    expect(await n("select count(*)::text n from erp.banks where code = any($1)", [["001", "033", "104", "237", "341", "748", "756", "077", "260", "000"]])).toBe(10);
    expect(await n("select count(*)::text n from erp.cities where id = any($1)", [[5208707, 5300108, 3550308, 3106200, 5103403, 5002704, 1721000, 1709500, 2927408, 4106902, 5218805, 5107925, 3170206, 5006606]])).toBe(14);
  });
  it("NCM de 8 dígitos > 10.000, com descrição completa; CBO > 2.000", async () => {
    expect(await n("select count(*)::text n from erp.ncm where nivel=8 and descricao_completa is not null")).toBeGreaterThan(10000);
    expect((await um<{ d: string }>("select descricao_completa d from erp.ncm where code='01012100'")).d).toBe("Cavalos, asininos e muares, vivos. - Cavalos: - Reprodutores de raça pura");
    expect(await n("select count(*)::text n from erp.cbo_ocupacoes")).toBeGreaterThan(2000);
  });
  it("carga 2x não duplica nem apaga (seções 5 e 6 da 0026 reexecutadas, depois desfeitas)", async () => {
    const sql = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations/0026_referencias_oficiais.sql"), "utf8");
    const trecho = sql.slice(sql.indexOf("-- ---------- 5)"), sql.indexOf("-- ---------- 7)"));
    expect(trecho).toContain("insert into erp.cities");
    const contar = "select (select count(*) from erp.states)||'/'||(select count(*) from erp.cities)||'/'||(select count(*) from erp.banks)||'/'||(select count(*) from erp.ncm)||'/'||(select count(*) from erp.cbo_ocupacoes) as n";
    const antes = (await um<{ n: string }>(contar)).n;
    const c = await admin.connect();
    try {
      await c.query("begin"); await c.query(trecho);
      const depois = (await c.query<{ n: string }>(contar)).rows[0]!.n;
      expect(depois).toBe(antes);
    } finally { await c.query("rollback"); c.release(); }
  });
  it("caches só para a API: papel de cliente não lê", async () => {
    const r = await admin.query<{ g: boolean }>("select has_table_privilege('authenticated', 'erp.consulta_cnpj_cache', 'select') g");
    expect(r.rows[0]!.g).toBe(false);
  });
});

describe("RF-2 buscas de referência", () => {
  const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
  // AJUSTES 01 (A-2): o rótulo do município passou a trazer o código IBGE — "<ibge> · <nome> - <UF>".
  it("'sao paulo' acha '3550308 · São Paulo - SP'; 'Gurupi - TO' acha pelo rótulo", async () => {
    const r = j(await get("/api/referencias/municipios?search=sao%20paulo"));
    expect(r.items.map((x: { rotulo: string }) => x.rotulo)).toContain("3550308 · São Paulo - SP");
    expect(r.items.find((x: { rotulo: string }) => x.rotulo === "3550308 · São Paulo - SP").codigo).toBe(3550308);
    const g = j(await get("/api/referencias/municipios?search=Gurupi%20-%20TO"));
    expect(g.items).toEqual([{ codigo: 1709500, nome: "Gurupi", extra: "TO", rotulo: "1709500 · Gurupi - TO", escolhivel: true }]);
    expect(j(await get("/api/referencias/municipios/1709500")).rotulo).toBe("1709500 · Gurupi - TO");
  });
  // AJUSTES 01 (A-3): rótulo do banco "<código> · <nome>".
  it("banco '001 · Banco do Brasil S.A.'; CBO por código", async () => {
    expect(j(await get("/api/referencias/bancos/001")).rotulo).toBe("001 · Banco do Brasil S.A.");
    const c = j(await get("/api/referencias/cbo?search=622005"));
    expect(c.items[0].rotulo).toMatch(/^622005 - /);
  });
  it("NCM por código (com pontuação) e por descrição; só 8 dígitos vigente", async () => {
    const porCodigo = j(await get("/api/referencias/ncm?search=0102.21"));
    expect(porCodigo.items.length).toBeGreaterThan(0);
    expect(porCodigo.items.every((x: { codigo: string; escolhivel: boolean }) => x.codigo.length === 8 && x.codigo.startsWith("010221") && x.escolhivel)).toBe(true);
    expect(porCodigo.items[0].rotulo).toMatch(/^0102\.21\.\d{2} - /);
    const porDescricao = j(await get("/api/referencias/ncm?search=reprodutores%20de%20raca%20pura&pageSize=50"));
    expect(porDescricao.total).toBeGreaterThan(3);
    expect(porDescricao.items.every((x: { codigo: string }) => x.codigo.length === 8)).toBe(true);
    // capítulo (2 dígitos) nunca aparece; código vencido também não
    expect(j(await get("/api/referencias/ncm?search=01")).items.some((x: { codigo: string }) => x.codigo === "01")).toBe(false);
    await admin.query("update erp.ncm set vigencia_fim = current_date - 1 where code='01012100'");
    try { expect(j(await get("/api/referencias/ncm?search=01012100")).items).toEqual([]); }
    finally { await admin.query("update erp.ncm set vigencia_fim = '9999-12-31' where code='01012100'"); }
  });
  it("paginação no servidor e chave desconhecida = 404; query fora do contrato = 422", async () => {
    const p1 = j(await get("/api/referencias/municipios?search=santa&pageSize=10&page=1")); const p2 = j(await get("/api/referencias/municipios?search=santa&pageSize=10&page=2"));
    expect(p1.items).toHaveLength(10); expect(p1.total).toBeGreaterThan(20);
    expect(p2.items[0].codigo).not.toBe(p1.items[0].codigo);
    expect((await get("/api/referencias/people")).statusCode).toBe(404);
    expect((await get("/api/referencias/municipios?tabela=users")).statusCode).toBe(422);
  });
});

describe("RF-6 formulários de hoje com as buscas", () => {
  const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers: h.headers({ "content-type": "application/json" }), payload });
  it("produto com NCM de 8 dígitos vigente salva; capítulo é recusado com 422 no campo", async () => {
    const unidade = (j(await h.app.inject({ method: "GET", url: "/api/resources/measurement_units/options", headers: h.headers() })) as { id: string }[])[0]!.id;
    const grupo = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null and is_active order by code limit 1", [h.demo.orgId])).id;
    const base = { measurement_id: unidade, group_id: grupo, control_stock: false };
    const ok = await post("products", { ...base, description: "RF6 produto NCM", ncm_code: "01022110" });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await um("select ncm_code from erp.products where id=$1", [j(ok).id])).toEqual({ ncm_code: "01022110" });
    const ruim = await post("products", { ...base, description: "RF6 produto capitulo", ncm_code: "01" });
    expect(ruim.statusCode, ruim.body).toBe(422);
    expect(j(ruim).error.details[0].path).toEqual(["ncm_code"]);
  });
  it("pessoa com cidade (código IBGE inteiro) e banco pela busca salva o mesmo código", async () => {
    const r = await post("people", { name: "RF6 pessoa", person_type: "legal", is_client: true, city_id: 1709500, bank_code: "260" });
    expect(r.statusCode, r.body).toBe(201);
    expect(await um("select city_id, bank_code from erp.people where id=$1", [j(r).id])).toEqual({ city_id: 1709500, bank_code: "260" });
  });
});

const CNPJ = "00000000000191";
const BAPI_CNPJ = { razao_social: "BANCO DO BRASIL SA", descricao_situacao_cadastral: "ATIVA", codigo_municipio_ibge: 5300108, municipio: "BRASILIA", uf: "DF", qsa: [{ nome_socio: "SOCIO SECRETO" }] };
const CNPJA = { updated: "2026-09-23T19:26:29.263Z", company: { name: "BANCO DO BRASIL SA", members: [{ person: { name: "SOCIO SECRETO" } }] }, address: { city: "Brasília", state: "DF" } };

describe("RF-5 consulta de CNPJ pela API (fontes em mock)", () => {
  const auditorias = () => n("select count(*)::text n from erp.audit_logs where organization_id=$1 and entity='consulta_cnpj'", [h.demo.orgId]);
  it("ok: resposta sem QSA, município IBGE, fonte e consultadoEm; cache sem QSA; auditoria sem a resposta", async () => {
    await admin.query("delete from erp.consulta_cnpj_cache where cnpj=$1", [CNPJ]);
    const a0 = await auditorias();
    const f = await apiComFontes({ "brasilapi.com.br": { status: 200, body: BAPI_CNPJ } });
    try {
      const r = await f.get(`/api/consultas/cnpj/00.000.000%2F0001-91`);
      expect(r.statusCode, r.body).toBe(200);
      const b = j(r);
      expect(b).toMatchObject({ cnpj: CNPJ, razaoSocial: "BANCO DO BRASIL SA", fonte: "brasilapi", endereco: { municipio: { codigoIbge: 5300108, nome: "Brasília", uf: "DF" } } });
      expect(b.consultadoEm).toMatch(/^\d{4}-/);
      expect(r.body).not.toMatch(/SOCIO SECRETO|qsa/i);
      const cache = await um<{ dados: unknown }>("select dados from erp.consulta_cnpj_cache where cnpj=$1", [CNPJ]);
      expect(JSON.stringify(cache.dados)).not.toMatch(/SOCIO SECRETO|qsa/i);
      expect(await auditorias()).toBe(a0 + 1);
      const log = await um<{ metadata: unknown; after: unknown; user_id: string }>("select metadata, after, user_id from erp.audit_logs where organization_id=$1 and entity='consulta_cnpj' order by id desc limit 1", [h.demo.orgId]);
      expect(log).toMatchObject({ metadata: { fonte: "brasilapi", resultado: "ok" }, after: null });
      expect(log.user_id).toBeTruthy();
      // cache: a segunda consulta não chama fonte
      const c = await f.get(`/api/consultas/cnpj/${CNPJ}`);
      expect(c.statusCode).toBe(200); expect(f.chamadas).toHaveLength(1);
      expect(await auditorias()).toBe(a0 + 2);
    } finally { await f.app.close(); }
  });
  it("'consultar de novo' ignora o cache, no máximo 1 vez por minuto por CNPJ", async () => {
    const f = await apiComFontes({ "brasilapi.com.br": { status: 429 }, "open.cnpja.com": [{ status: 200, body: CNPJA }] });
    try {
      const r = await f.get(`/api/consultas/cnpj/${CNPJ}?atualizar=1`);
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ fonte: "cnpja", dataDaInformacao: "2026-09-23T19:26:29.263Z", endereco: { municipio: { codigoIbge: 5300108 } } });
      expect(r.body).not.toMatch(/SOCIO SECRETO|members/);
      expect((await f.get(`/api/consultas/cnpj/${CNPJ}?atualizar=1`)).statusCode).toBe(429);
      expect(f.chamadas).toHaveLength(2);
    } finally { await f.app.close(); }
  });
  it("todas 'não encontrado' → 404; todas fora → 503; nada gravado no cache", async () => {
    const outro = "11222333000181";
    await admin.query("delete from erp.consulta_cnpj_cache where cnpj=$1", [outro]);
    const nf = await apiComFontes({ "brasilapi.com.br": { status: 404 }, "open.cnpja.com": { status: 404 }, "publica.cnpj.ws": { status: 404 } });
    try {
      const r = await nf.get(`/api/consultas/cnpj/${outro}`);
      expect(r.statusCode).toBe(404); expect(j(r).error.message).toBe("CNPJ não encontrado nas fontes gratuitas");
    } finally { await nf.app.close(); }
    const fora = await apiComFontes({ "brasilapi.com.br": "rede", "open.cnpja.com": { status: 500 }, "publica.cnpj.ws": { status: 429 } });
    try {
      const r = await fora.get(`/api/consultas/cnpj/${outro}`);
      expect(r.statusCode).toBe(503); expect(j(r).error.message).toBe("consulta de CNPJ indisponível agora; preencha manualmente");
    } finally { await fora.app.close(); }
    expect(await n("select count(*)::text n from erp.consulta_cnpj_cache where cnpj=$1", [outro])).toBe(0);
  });
  it("caractere inválido ou DV errado → 422 SEM chamada; alfanumérico sem fonte que aceite → 422 SEM chamada", async () => {
    const f = await apiComFontes({});
    try {
      for (const c of ["00000000000192", "0000000000019*", "123"]) expect((await f.get(`/api/consultas/cnpj/${encodeURIComponent(c)}`)).statusCode, c).toBe(422);
      const a = await f.get("/api/consultas/cnpj/12.ABC.345%2F01DE-35");
      expect(a.statusCode).toBe(422); expect(j(a).error.message).toBe("as fontes gratuitas ainda não consultam CNPJ com letras; preencha manualmente");
      expect(f.chamadas).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("desligado → 503 sem chamada; sem people.create/edit → 403 sem chamada", async () => {
    const f = await apiComFontes({}, { CONSULTA_CNPJ_FONTES: "desligado" });
    try { expect((await f.get(`/api/consultas/cnpj/${CNPJ}?atualizar=1`)).statusCode).toBe(503); } finally { await f.app.close(); }
    const g = await apiComFontes({});
    try { expect((await g.get(`/api/consultas/cnpj/${CNPJ}`, h.opHeaders())).statusCode).toBe(403); expect(g.chamadas).toEqual([]); } finally { await g.app.close(); }
    expect(() => configDeTeste({ CONSULTA_CNPJ_FONTES: "brasilapi,serpro" })).toThrow(/CONSULTA_CNPJ_FONTES/);
  });
  it("limite de 20 por minuto por organização", async () => {
    const f = await apiComFontes({});
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 21; i++) codigos.push((await f.get(`/api/consultas/cnpj/${CNPJ}`)).statusCode);
      expect(codigos.slice(0, 20).every((c) => c === 200)).toBe(true); // cache: nenhuma fonte chamada
      expect(codigos[20]).toBe(429);
      expect(f.chamadas).toEqual([]);
    } finally { await f.app.close(); }
  });
});

describe("RF-4 consulta de CEP pela API (fontes em mock)", () => {
  const VIACEP = { cep: "77405-070", logradouro: "Rua de 14 Novembro", complemento: "", bairro: "Setor Central", localidade: "Gurupi", uf: "TO", ibge: "1709500" };
  it("ok (município IBGE), cache, 404 e 503", async () => {
    await admin.query("delete from erp.consulta_cep_cache");
    const f = await apiComFontes({ "viacep.com.br": [{ status: 200, body: VIACEP }, { status: 200, body: { erro: "true" } }, { status: 500 }], "brasilapi.com.br": [{ status: 404 }, "rede"] });
    try {
      const r = await f.get("/api/consultas/cep/77405-070");
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ cep: "77405070", logradouro: "Rua de 14 Novembro", complemento: null, bairro: "Setor Central", municipio: { codigoIbge: 1709500, nome: "Gurupi", uf: "TO" }, fonte: "viacep" });
      expect((await f.get("/api/consultas/cep/77405070")).statusCode).toBe(200);
      expect(f.chamadas).toHaveLength(1);
      expect((await f.get("/api/consultas/cep/99999999")).statusCode).toBe(404);
      const fora = await f.get("/api/consultas/cep/01001000");
      expect(fora.statusCode).toBe(503); expect(j(fora).error.message).toBe("consulta de CEP indisponível agora; preencha o endereço");
      expect((await f.get("/api/consultas/cep/123")).statusCode).toBe(422);
    } finally { await f.app.close(); }
  });
  it("reserva resolve o município por nome + UF quando falta o código IBGE", async () => {
    const f = await apiComFontes({ "viacep.com.br": "rede", "brasilapi.com.br": { status: 200, body: { cep: "01001000", state: "SP", city: "Sao Paulo", neighborhood: "Sé", street: "Praça da Sé" } } });
    try {
      const r = await f.get("/api/consultas/cep/01001000");
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ fonte: "brasilapi", municipio: { codigoIbge: 3550308, nome: "São Paulo", uf: "SP" } });
    } finally { await f.app.close(); }
  });
  it("limite de 60 por minuto por organização", async () => {
    const f = await apiComFontes({});
    try {
      let ultimo = 0; for (let i = 0; i < 61; i++) ultimo = (await f.get("/api/consultas/cep/77405070")).statusCode;
      expect(ultimo).toBe(429); expect(f.chamadas).toEqual([]);
    } finally { await f.app.close(); }
  });
});
