import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshDb } from "./setup.js";
import { MIGRATIONS_DIR } from "../src/migrate.js";
import type { Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * PA-1 (schema) — O QUE A 0030 PROMETEU, PROVADO CONTRA O BANCO (CADASTROS AJUSTES 01, decisão 257, C-5).
 *
 * Colunas novas de erp.people e erp.parceiro_enderecos, anuláveis ou com default e SEM backfill; checks de
 * CAEPF, sexo, latitude e longitude (e o PAR — as duas ou nenhuma, R1 A-11); a FK COMPOSTA da matriz (coluna única não prova tenant: matriz de OUTRA
 * organização é recusada pelo banco) e o check "não é ele mesmo". As regras que dependem do tipo de pessoa são da
 * API (lib/parceiro.ts) e ficam nos testes de integração. `db` é o papel de migração: constraint vale para todos.
 */
let db: Db; let demo: DemoOrg; let outraOrg: string;
const ALVO = "0030_cadastros_ajustes_01.sql";

async function novoParceiro(org: string, code: string): Promise<string> {
  return (await db.query<{ id: string }>("insert into erp.people (organization_id, code, name, is_client) values ($1,$2,$3,true) returning id", [org, code, `Parceiro ${code}`])).rows[0]!.id;
}
async function recusa(sql: string, params: unknown[]): Promise<string> {
  const c = await db.connect();
  try { await c.query("begin"); if (params.length) await c.query(sql, params); else await c.query(sql); await c.query("rollback"); return "aceito"; }
  catch (e) { await c.query("rollback").catch(() => {}); return (e as Error).message; } finally { c.release(); }
}

beforeAll(async () => {
  ({ db, demo } = await freshDb());
  outraOrg = (await db.query<{ id: string }>("insert into erp.organizations(name,slug) values ('Org PA-1 B','org-pa1-b') returning id")).rows[0]!.id;
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("PA-1 — 0030: colunas, checks e FK composta", () => {
  it("a 0030 está no ledger e as colunas existem com o tipo, a nulidade e o default prometidos", async () => {
    expect((await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount).toBe(1);
    const cols = (await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null; udt_name: string }>(
      `select table_name, column_name, data_type, is_nullable, column_default, udt_name from information_schema.columns
        where table_schema='erp' and ((table_name='people' and column_name in ('matriz_id','rg','caepf','sexo','site','caixa_postal','latitude','longitude','email_nfe','calcula_funrural'))
           or (table_name='parceiro_enderecos' and column_name in ('latitude','longitude')))
        order by table_name, column_name`)).rows;
    expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.udt_name}:${c.is_nullable}`)).toEqual([
      "parceiro_enderecos.latitude:numeric:YES", "parceiro_enderecos.longitude:numeric:YES",
      "people.caepf:text:YES", "people.caixa_postal:text:YES", "people.calcula_funrural:bool:NO", "people.email_nfe:citext:YES",
      "people.latitude:numeric:YES", "people.longitude:numeric:YES", "people.matriz_id:uuid:YES", "people.rg:text:YES",
      "people.sexo:text:YES", "people.site:text:YES"
    ]);
    expect(cols.find((c) => c.column_name === "calcula_funrural")!.column_default).toBe("false");
  });

  it("toda coluna nova tem comentário", async () => {
    const semComentario = (await db.query<{ c: string }>(
      `select c.relname || '.' || a.attname as c from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='erp' and ((c.relname='people' and a.attname in ('matriz_id','rg','caepf','sexo','site','caixa_postal','latitude','longitude','email_nfe','calcula_funrural'))
          or (c.relname='parceiro_enderecos' and a.attname in ('latitude','longitude'))) and col_description(c.oid, a.attnum) is null`)).rows;
    expect(semComentario).toEqual([]);
  });

  it("sem backfill: os parceiros do seed ficam com as colunas novas vazias e calcula_funrural = false", async () => {
    const r = (await db.query<{ total: string; vazios: string }>(
      `select count(*)::text total, count(*) filter (where matriz_id is null and rg is null and caepf is null and sexo is null and site is null
         and caixa_postal is null and latitude is null and longitude is null and email_nfe is null and not calcula_funrural)::text vazios
         from erp.people where organization_id=$1`, [demo.orgId])).rows[0]!;
    expect(Number(r.total), "o seed tem parceiros: verde com zero linhas não prova nada").toBeGreaterThan(0);
    expect(r.vazios).toBe(r.total);
  });

  it("checks: CAEPF 14 dígitos, sexo F/M, latitude −90..90, longitude −180..180 (people e parceiro_enderecos)", async () => {
    const p = await novoParceiro(demo.orgId, "PA1-CHK");
    const up = (col: string, v: unknown) => recusa(`update erp.people set ${col} = $2 where id = $1`, [p, v]);
    expect(await up("caepf", "12345678901234")).toBe("aceito");
    expect(await up("caepf", "1234567890123")).toMatch(/chk_people_caepf/);
    expect(await up("caepf", "1234567890123A")).toMatch(/chk_people_caepf/);
    expect(await up("sexo", "F")).toBe("aceito");
    expect(await up("sexo", "X")).toMatch(/chk_people_sexo/);
    // R1 (A-11): o PAR anda junto — a faixa é conferida com o par completo; o check da faixa fala antes do do par
    // (os CHECKs são conferidos em ordem de nome), então fora da faixa continua sendo a recusa da faixa
    const par = (lat: string | null, lon: string | null) => recusa("update erp.people set latitude = $2, longitude = $3 where id = $1", [p, lat, lon]);
    expect(await par("-15.123456", "-59.1")).toBe("aceito");
    expect(await par("90.5", "0")).toMatch(/chk_people_latitude/);
    expect(await par("0", "-180")).toBe("aceito");
    expect(await par("0", "-180.1")).toMatch(/chk_people_longitude/);
    expect(await up("latitude", "90.5"), "fora da faixa E sem o par: fala a faixa").toMatch(/chk_people_latitude/);
    expect(await par("-15.1", null)).toMatch(/chk_people_par_coordenadas/);
    expect(await par(null, "-59.1")).toMatch(/chk_people_par_coordenadas/);
    expect(await par(null, null)).toBe("aceito");
    const ins = (lat: string | null, lon: string | null) => recusa("insert into erp.parceiro_enderecos (organization_id, person_id, tipo, latitude, longitude) values ($1,$2,'entrega',$3,$4)", [demo.orgId, p, lat, lon]);
    expect(await ins("-15.5", "-59.9")).toBe("aceito");
    expect(await ins("-91", "0")).toMatch(/chk_parceiro_enderecos_latitude/);
    expect(await ins("0", "181")).toMatch(/chk_parceiro_enderecos_longitude/);
    expect(await ins("-15.5", null)).toMatch(/chk_parceiro_enderecos_par_coordenadas/);
    expect(await ins(null, "-59.9")).toMatch(/chk_parceiro_enderecos_par_coordenadas/);
    expect(await ins(null, null)).toBe("aceito");
  });

  it("Matriz: FK COMPOSTA recusa parceiro de OUTRA organização; ele mesmo é recusado; o da mesma organização é aceito", async () => {
    const filial = await novoParceiro(demo.orgId, "PA1-FIL");
    const matriz = await novoParceiro(demo.orgId, "PA1-MAT");
    const deFora = await novoParceiro(outraOrg, "PA1-FORA");
    const set = (m: string) => recusa("update erp.people set matriz_id = $2 where id = $1", [filial, m]);
    expect(await set(matriz)).toBe("aceito");
    expect(await set(deFora)).toMatch(/fk_people_matriz/);
    expect(await set(filial)).toMatch(/chk_people_matriz_nao_ele_mesmo/);
    const fk = (await db.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conname='fk_people_matriz'")).rows[0]!.def;
    expect(fk).toBe("FOREIGN KEY (matriz_id, organization_id) REFERENCES erp.people(id, organization_id)");
  });

  it("reaplicar a 0030 PARA na pré-condição nomeada (já aplicada) e nada muda", async () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8");
    expect(await recusa(sql, [])).toMatch(/CADASTROS-AJ01: erp\.people\.matriz_id ja existe/);
  });
});
