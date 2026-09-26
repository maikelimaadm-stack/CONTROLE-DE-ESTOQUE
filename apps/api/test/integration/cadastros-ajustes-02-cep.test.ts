import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";
import { CACHE_CEP_DIAS } from "../../src/routes/consultas.js";

/**
 * CADASTROS — AJUSTES 02 · API: CEP × CIDADE. O CEP que a API já consultou (cache `erp.consulta_cep_cache`, dentro de
 * CACHE_CEP_DIAS) diz o município; cidade diferente → 422 VALIDATION_ERROR no campo da CIDADE. Só quando o CEP ou a
 * cidade MUDAM na gravação. Principal, endereço adicional, filial e importação. Toda recusa confere o BANCO.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Det = { path: string; message: string; aba?: string | null; detalhe?: string; linha?: number };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/api/resources/people", headers: hdr(), payload });
const put = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/resources/people/${id}`, headers: hdr(), payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const nome = (s: string) => `AJ02C ${s} ${Math.random().toString(36).slice(2, 8)}`;
const porNome = async (x: string) => Number((await um<{ n: string }>("select count(*)::text n from erp.people where organization_id=$1 and name=$2", [h.demo.orgId, x]))!.n);
const PONTES = 5106752; const CUIABA = 5103403;
const CEP = "78250000"; const CEP_VELHO = "78250001"; const CEP_FORA = "78250002";
const MSG = "O CEP 78250-000 é de Pontes e Lacerda - MT; a cidade escolhida é Cuiabá - MT. Corrija o CEP ou a cidade.";
const recusado = (r: Resp, path: string) => {
  expect(r.statusCode, r.body).toBe(422);
  const e = j(r).error as { code: string; details: Det[] };
  expect(e.code).toBe("VALIDATION_ERROR");
  expect(e.details, r.body).toHaveLength(1);
  expect(e.details[0]!.path).toBe(path);
  expect(e.details[0]!.message).toBe(MSG);
  return e.details[0]!;
};

const dados = (municipioIbge: number | null) => JSON.stringify({ cep: CEP, logradouro: null, complemento: null, bairro: null, municipioIbge, municipioNome: "Pontes e Lacerda", uf: "MT" });

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  await admin.query("insert into erp.consulta_cep_cache (cep, dados, fonte, consultado_em) values ($1,$2,'viacep',now()) on conflict (cep) do update set dados=excluded.dados, consultado_em=now()", [CEP, dados(PONTES)]);
  // mesmo município, consultado ANTES da janela do cache: não vale mais
  await admin.query(`insert into erp.consulta_cep_cache (cep, dados, fonte, consultado_em) values ($1,$2,'viacep',now() - interval '${CACHE_CEP_DIAS + 1} days') on conflict (cep) do update set dados=excluded.dados, consultado_em=excluded.consultado_em`, [CEP_VELHO, dados(PONTES)]);
  await admin.query("delete from erp.consulta_cep_cache where cep=$1", [CEP_FORA]);
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("CC-0 premissas", () => {
  it("cache e cidades", async () => {
    expect(await um("select name, state_code from erp.cities where id=$1", [PONTES])).toEqual({ name: "Pontes e Lacerda", state_code: "MT" });
    expect(await um("select name, state_code from erp.cities where id=$1", [CUIABA])).toEqual({ name: "Cuiabá", state_code: "MT" });
    expect(await um("select count(*)::int n from erp.consulta_cep_cache where cep=$1 and consultado_em > now() - make_interval(days => $2)", [CEP, CACHE_CEP_DIAS])).toEqual({ n: 1 });
    expect(await um("select count(*)::int n from erp.consulta_cep_cache where cep=$1 and consultado_em > now() - make_interval(days => $2)", [CEP_VELHO, CACHE_CEP_DIAS])).toEqual({ n: 0 });
    expect(await um("select count(*)::int n from erp.consulta_cep_cache where cep=$1", [CEP_FORA])).toEqual({ n: 0 });
  });
});

describe("CC-1 endereço principal", () => {
  it("criação com CEP de Pontes e cidade Cuiabá → 422 em city_id (aba do endereço), nada gravado; formatado 78250-000 também", async () => {
    for (const cep of [CEP, "78250-000"]) {
      const n = nome("div");
      const d = recusado(await post({ name: n, is_client: true, zip_code: cep, city_id: CUIABA }), "city_id");
      expect(d.aba).toBe("enderecos");
      expect(await porNome(n)).toBe(0);
    }
  });
  it("controle: mesmo CEP com a cidade certa → 201", async () => {
    const n = nome("ok");
    const r = await post({ name: n, is_client: true, zip_code: CEP, city_id: PONTES });
    expect(r.statusCode, r.body).toBe(201);
    expect(await porNome(n)).toBe(1);
  });
  it("cache vencido (fora de CACHE_CEP_DIAS) → grava; CEP fora do cache → grava", async () => {
    for (const cep of [CEP_VELHO, CEP_FORA]) {
      const n = nome(cep);
      const r = await post({ name: n, is_client: true, zip_code: cep, city_id: CUIABA });
      expect(r.statusCode, r.body).toBe(201);
      expect(await um("select zip_code, city_id from erp.people where id=$1", [j(r).id])).toEqual({ zip_code: cep, city_id: CUIABA });
    }
  });
  it("edição: PUT que não mexe no par (divergente gravado por SQL) → 200; mexer na cidade ou no CEP → 422", async () => {
    const n = nome("put");
    const r = await post({ name: n, is_client: true, zip_code: CEP, city_id: PONTES });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    await admin.query("update erp.people set city_id=$2 where id=$1", [id, CUIABA]);
    expect(await um("select zip_code, city_id from erp.people where id=$1", [id])).toEqual({ zip_code: CEP, city_id: CUIABA });
    const ok = await put(id, { phone: "65999990000" });
    expect(ok.statusCode, ok.body).toBe(200);
    // reenviar o MESMO par também não é mudança
    const ok2 = await put(id, { zip_code: CEP, city_id: CUIABA, phone: "65999990001" });
    expect(ok2.statusCode, ok2.body).toBe(200);
    expect(await um("select phone from erp.people where id=$1", [id])).toEqual({ phone: "65999990001" });
    // mudar o CEP para outro formato do mesmo número não é mudança; trocar a cidade de volta e de novo para Cuiabá é
    await admin.query("update erp.people set city_id=$2 where id=$1", [id, PONTES]);
    recusado(await put(id, { city_id: CUIABA }), "city_id");
    expect(await um("select city_id from erp.people where id=$1", [id])).toEqual({ city_id: PONTES });
    await admin.query("update erp.people set zip_code=$2, city_id=$3 where id=$1", [id, CEP_FORA, CUIABA]);
    recusado(await put(id, { zip_code: CEP }), "city_id");
    expect(await um("select zip_code from erp.people where id=$1", [id])).toEqual({ zip_code: CEP_FORA });
  });
});

describe("CC-2 endereço adicional e filial", () => {
  it("endereço adicional divergente → 422 em enderecos.N.city_id, nada gravado", async () => {
    const n = nome("end");
    const d = recusado(await post({ name: n, is_client: true, enderecos: [
      { tipo: "entrega", cep: CEP, city_id: PONTES },
      { tipo: "cobranca", cep: CEP, city_id: CUIABA }
    ] }), "enderecos.1.city_id");
    expect(d.detalhe).toBe("enderecos"); expect(d.linha).toBe(2);
    expect(await porNome(n)).toBe(0);
  });
  it("filial divergente → 422 em filiais.0.city_id, nada gravado", async () => {
    const n = nome("fil");
    const d = recusado(await post({ name: n, is_provider: true, filiais: [{ name: "F1", zip_code: CEP, city_id: CUIABA }] }), "filiais.0.city_id");
    expect(d.detalhe).toBe("filiais");
    expect(await porNome(n)).toBe(0);
  });
  it("linha gravada divergente (por SQL) reenviada sem mudar o par → 200; linha nova divergente → 422", async () => {
    const n = nome("edt");
    const r = await post({ name: n, is_client: true, is_provider: true, enderecos: [{ tipo: "entrega", cep: CEP, city_id: PONTES }], filiais: [{ name: "F1", zip_code: CEP, city_id: PONTES }] });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    await admin.query("update erp.parceiro_enderecos set city_id=$2 where person_id=$1", [id, CUIABA]);
    await admin.query("update erp.provider_branches set city_id=$2 where person_id=$1", [id, CUIABA]);
    const f = j(await h.app.inject({ method: "GET", url: `/api/resources/people/${id}`, headers: h.headers() }));
    expect(f.enderecos).toHaveLength(1); expect(f.filiais).toHaveLength(1);
    const end = { id: f.enderecos[0].id, tipo: "entrega", cep: CEP, city_id: CUIABA, descricao: "mudou só a descrição" };
    const fil = { id: f.filiais[0].id, name: "F1 renomeada", zip_code: CEP, city_id: CUIABA };
    const ok = await put(id, { enderecos: [end], filiais: [fil] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await um("select descricao from erp.parceiro_enderecos where id=$1", [end.id])).toEqual({ descricao: "mudou só a descrição" });
    const novo = await put(id, { enderecos: [end, { tipo: "cobranca", cep: CEP, city_id: CUIABA }] });
    recusado(novo, "enderecos.1.city_id");
    expect(await um("select count(*)::int n from erp.parceiro_enderecos where person_id=$1 and deleted_at is null", [id])).toEqual({ n: 1 });
    const mudaCidade = await put(id, { filiais: [{ ...fil, city_id: PONTES }] });
    expect(mudaCidade.statusCode, mudaCidade.body).toBe(200);
    recusado(await put(id, { filiais: [{ ...fil, city_id: CUIABA }] }), "filiais.0.city_id");
    expect(await um("select city_id from erp.provider_branches where id=$1", [fil.id])).toEqual({ city_id: PONTES });
  });
});

describe("CC-3 importação", () => {
  it("linha com CEP × cidade divergente é recusada; a certa, no controle, grava", async () => {
    const modelo = async () => {
      const r = await h.app.inject({ method: "GET", url: "/api/imports/people/modelo", headers: h.headers() });
      expect(r.statusCode).toBe(200);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
    };
    const enviar = async (wb: ExcelJS.Workbook) => h.app.inject({ method: "POST", url: "/api/imports/people?simular=0", headers: hdr(), payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
    const preencher = (wb: ExcelJS.Workbook, valores: Record<string, string>) => {
      const ws = wb.getWorksheet("Dados")!; const cab: string[] = []; ws.getRow(1).eachCell((c) => cab.push(String(c.value)));
      const row = ws.getRow(2);
      for (const [t, v] of Object.entries(valores)) { const c = cab.indexOf(t) + 1; if (!c) throw new Error(`coluna "${t}" ausente: ${cab.join(" | ")}`); row.getCell(c).value = v; }
      row.commit();
    };
    const n = nome("imp");
    const wb = await modelo();
    preencher(wb, { "Nome Social/Fantasia *": n, "Cliente": "Sim", "CEP": CEP, "Cidade": String(CUIABA) });
    const r = await enviar(wb);
    expect(r.statusCode, r.body).toBe(422);
    const erros = j(r).erros as { linha: number; coluna: string | null; mensagem: string }[];
    expect(erros).toHaveLength(1);
    expect(erros[0]!.linha).toBe(2);
    expect(erros[0]!.mensagem).toContain(MSG);
    expect(await porNome(n)).toBe(0);
    const wb2 = await modelo();
    preencher(wb2, { "Nome Social/Fantasia *": n, "Cliente": "Sim", "CEP": CEP, "Cidade": String(PONTES) });
    const ok = await enviar(wb2);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(j(ok)).toMatchObject({ linhas: 1, gravadas: 1, erros: [] });
    expect(await porNome(n)).toBe(1);
  });
});
