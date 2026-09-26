import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 02 · API: `<campo>_nome` aditivo para campo de BUSCA OFICIAL (município, banco, NCM, CBO) na
 * listagem e na ficha. Município "Pontes e Lacerda - MT"; os demais só o nome. UMA consulta por referência — contada.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers: hdr(), payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const PONTES = 5106752; const CUIABA = 5103403;
const TAG = `AJ02R${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("RT-1 parceiros: city_id_nome", () => {
  it("premissa: os municípios existem na referência oficial", async () => {
    expect(await um("select name, state_code from erp.cities where id=$1", [PONTES])).toEqual({ name: "Pontes e Lacerda", state_code: "MT" });
    expect(await um("select state_code from erp.cities where id=$1", [CUIABA])).toEqual({ state_code: "MT" });
  });

  it("listagem com várias linhas: city_id_nome em cada uma, null sem cidade; UMA consulta a erp.cities para a página", async () => {
    const ids: string[] = [];
    for (const [s, c] of [["a", PONTES], ["b", CUIABA], ["c", PONTES], ["d", null]] as const) {
      const r = await post("people", { name: `${TAG} ${s}`, is_client: true, city_id: c });
      expect(r.statusCode, r.body).toBe(201); ids.push(j(r).id);
    }
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let r: Resp;
    try {
      r = await get(`/api/resources/people?search=${TAG}&pageSize=50&sort=name&dir=asc`);
      const consultas = espiao.mock.calls.filter((c) => typeof c[0] === "string" && /from erp\."?cities"? /.test(c[0])).length;
      expect(consultas, `uma consulta por referência, não por linha: ${espiao.mock.calls.map((c) => String(c[0]).slice(0, 120)).filter((x) => /cities/.test(x)).join(" || ")}`).toBe(1);
    } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(200);
    const itens = j(r).items as { name: string; city_id: number | null; city_id_nome: string | null }[];
    expect(itens.map((x) => [x.name, x.city_id_nome])).toEqual([
      [`${TAG} a`, "Pontes e Lacerda - MT"], [`${TAG} b`, "Cuiabá - MT"], [`${TAG} c`, "Pontes e Lacerda - MT"], [`${TAG} d`, null]
    ]);
    // a ficha também
    const f = await get(`/api/resources/people/${ids[0]}`);
    expect(f.statusCode, f.body).toBe(200);
    expect(j(f).city_id_nome).toBe("Pontes e Lacerda - MT");
    expect(j(f).city_id).toBe(PONTES);
  });
});

describe("RT-2 funções: cbo_code_nome (só o nome)", () => {
  it("várias funções e uma sem CBO: o nome de cada uma e null; UMA consulta a erp.cbo_ocupacoes", async () => {
    const cbos = (await admin.query<{ codigo: string; titulo: string }>("select codigo, titulo from erp.cbo_ocupacoes order by codigo limit 3")).rows;
    expect(cbos, "premissa: referência CBO carregada").toHaveLength(3);
    // CBO inexistente não chega ao banco (FK fk_job_functions_cbo): o "código ausente" é a função sem CBO
    for (const [s, c] of [["1", cbos[0]!.codigo], ["2", cbos[1]!.codigo], ["3", cbos[2]!.codigo], ["4", null]] as const) {
      await admin.query("insert into erp.job_functions(organization_id,name,cbo_code,base_salary,hour_value) values ($1,$2,$3,1000,5)", [h.demo.orgId, `${TAG} F${s}`, c]);
    }
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let r: Resp;
    try {
      r = await get(`/api/resources/job_functions?search=${TAG}&pageSize=50&sort=name&dir=asc`);
      expect(espiao.mock.calls.filter((c) => typeof c[0] === "string" && /from erp\."?cbo_ocupacoes"? /.test(c[0])).length).toBe(1);
    } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(200);
    const itens = j(r).items as { name: string; cbo_code_nome: string | null }[];
    expect(itens.map((x) => [x.name, x.cbo_code_nome])).toEqual([[`${TAG} F1`, cbos[0]!.titulo], [`${TAG} F2`, cbos[1]!.titulo], [`${TAG} F3`, cbos[2]!.titulo], [`${TAG} F4`, null]]);
    for (const x of itens) if (x.cbo_code_nome) expect(x.cbo_code_nome, "o nome nunca contém o código").not.toMatch(/^\d{6}/);
  });
});
