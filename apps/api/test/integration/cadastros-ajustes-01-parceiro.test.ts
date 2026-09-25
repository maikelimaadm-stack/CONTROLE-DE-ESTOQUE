import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · FRENTE C (teste PA-1 da seção 8): migration 0030 e regras do Parceiro (C-5, C-6).
 * Toda recusa confere o BANCO (nada gravado / nada mudado).
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Det = { path: string | string[]; message: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/api/resources/people", headers: hdr(), payload });
const put = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/resources/people/${id}`, headers: hdr(), payload });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const nome = (s: string) => `AJ01 ${s} ${Math.random().toString(36).slice(2, 8)}`;
const porNome = async (x: string) => Number((await um<{ n: string }>("select count(*)::text n from erp.people where organization_id=$1 and name=$2", [h.demo.orgId, x]))!.n);
const campoRecusado = (r: Resp, campo: string) => {
  expect(r.statusCode, r.body).toBe(422);
  const d = (j(r).error.details ?? []) as Det[];
  expect(d.map((x) => (Array.isArray(x.path) ? x.path.join(".") : x.path)), `422 NO CAMPO ${campo}: ${r.body}`).toEqual(expect.arrayContaining([expect.stringContaining(campo)]));
};

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PA-1 0030 — colunas, checks e FK composta", () => {
  it("colunas novas de erp.people e erp.parceiro_enderecos, anuláveis (calcula_funrural not null default false), com comentário", async () => {
    const cols = (await admin.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null; comentario: string | null }>(`
      select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
             col_description(format('erp.%I', c.table_name)::regclass, c.ordinal_position) comentario
        from information_schema.columns c where c.table_schema='erp' and c.table_name in ('people','parceiro_enderecos')`)).rows;
    const col = (t: string, c: string) => cols.find((x) => x.table_name === t && x.column_name === c);
    const esperadas: [string, string, string][] = [["people", "matriz_id", "uuid"], ["people", "rg", "text"], ["people", "caepf", "text"], ["people", "sexo", "text"], ["people", "site", "text"], ["people", "caixa_postal", "text"], ["people", "latitude", "numeric"], ["people", "longitude", "numeric"], ["people", "email_nfe", "USER-DEFINED"], ["people", "calcula_funrural", "boolean"], ["parceiro_enderecos", "latitude", "numeric"], ["parceiro_enderecos", "longitude", "numeric"]];
    for (const [t, c, tipo] of esperadas) {
      const x = col(t, c);
      expect(x, `${t}.${c}`).toBeTruthy();
      expect(x!.data_type, `${t}.${c}`).toBe(tipo);
      expect(x!.comentario, `${t}.${c} tem comentário`).toBeTruthy();
      if (c === "calcula_funrural") { expect(x!.is_nullable).toBe("NO"); expect(x!.column_default).toBe("false"); }
      else expect(x!.is_nullable, `${t}.${c} anulável`).toBe("YES");
    }
    // numeric(9,6)
    const prec = (await admin.query<{ n: string }>("select count(*)::text n from information_schema.columns where table_schema='erp' and table_name in ('people','parceiro_enderecos') and column_name in ('latitude','longitude') and numeric_precision=9 and numeric_scale=6")).rows[0]!.n;
    expect(prec).toBe("4");
    // SEM backfill: os parceiros semeados continuam com tudo nulo
    expect(await um("select count(*) filter (where rg is not null or caepf is not null or sexo is not null or matriz_id is not null or latitude is not null or calcula_funrural)::text n from erp.people where organization_id=$1", [h.demo.orgId])).toEqual({ n: "0" });
  });

  it("checks no BANCO: caepf 14 dígitos, sexo F/M, latitude −90..90, longitude −180..180, matriz ≠ ele mesmo", async () => {
    const id = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and deleted_at is null order by code limit 1", [h.demo.orgId]))!.id;
    for (const [sql, p] of [["update erp.people set caepf='123' where id=$1", [id]], ["update erp.people set sexo='X' where id=$1", [id]], ["update erp.people set latitude=91, longitude=0 where id=$1", [id]], ["update erp.people set latitude=0, longitude=-181 where id=$1", [id]], ["update erp.people set matriz_id=id where id=$1", [id]], ["update erp.parceiro_enderecos set latitude=-90.5 where id = (select id from erp.parceiro_enderecos limit 1)", []]] as [string, unknown[]][]) {
      const c = await admin.connect();
      try {
        await c.query("begin");
        const r: { ok: boolean; rc?: number | null; code?: string } = await c.query(sql, p).then((x) => ({ ok: true, rc: x.rowCount }), (e: { code?: string }) => ({ ok: false, code: e.code }));
        if (sql.includes("parceiro_enderecos") && r.ok && r.rc === 0) continue; // nenhum endereço semeado: o check é conferido abaixo
        expect(r, sql).toMatchObject({ ok: false });
      } finally { await c.query("rollback"); c.release(); }
    }
    const chk = (await admin.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.parceiro_enderecos'::regclass and contype='c'")).rows.map((x) => x.def).join(" | ");
    expect(chk).toMatch(/latitude/); expect(chk).toMatch(/longitude/);
  });

  it("FK COMPOSTA (matriz_id, organization_id) → people (id, organization_id)", async () => {
    const fk = (await admin.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.people'::regclass and contype='f' and pg_get_constraintdef(oid) ilike '%matriz_id%'")).rows;
    expect(fk).toHaveLength(1);
    expect(fk[0]!.def.replace(/\s+/g, " ")).toMatch(/FOREIGN KEY \(matriz_id, organization_id\) REFERENCES erp\.people\(id, organization_id\)/);
  });
});

describe("PA-1 regras da API (lib/parceiro.ts)", () => {
  let matriz: string;
  beforeAll(async () => { matriz = criado(await post({ name: nome("matriz"), person_type: "legal", is_client: true })); });

  it("Jurídica com Matriz viva da mesma organização → 201; Matriz = ele mesmo → 422; Matriz de outra organização → recusa sem gravar", async () => {
    const filial = criado(await post({ name: nome("filial"), person_type: "legal", is_client: true, matriz_id: matriz }));
    expect(await um("select matriz_id from erp.people where id=$1", [filial])).toEqual({ matriz_id: matriz });
    campoRecusado(await put(filial, { matriz_id: filial }), "matriz_id");
    expect(await um("select matriz_id from erp.people where id=$1", [filial])).toEqual({ matriz_id: matriz });
    const outra = (await um<{ id: string }>("insert into erp.organizations(name,slug) values ('AJ01 outra','aj01-outra-parceiro') returning id"))!.id;
    const alheio = (await um<{ id: string }>("insert into erp.people(organization_id,code,name,person_type,is_client) values ($1,'1','Alheio','legal',true) returning id", [outra]))!.id;
    const x = nome("matriz alheia");
    const r = await post({ name: x, person_type: "legal", is_client: true, matriz_id: alheio });
    expect([404, 422], r.body).toContain(r.statusCode);
    expect(await porNome(x)).toBe(0);
    // matriz excluída também não serve
    const morta = criado(await post({ name: nome("matriz morta"), person_type: "legal", is_client: true }));
    await admin.query("update erp.people set deleted_at=now() where id=$1", [morta]);
    campoRecusado(await put(filial, { matriz_id: morta }), "matriz_id");
  });

  it("Física com Matriz → 422; Jurídica com RG, CAEPF ou Sexo → 422 no campo; Física com RG/CAEPF/Sexo → 201", async () => {
    const x = nome("fisica matriz");
    campoRecusado(await post({ name: x, person_type: "natural", is_client: true, matriz_id: matriz }), "matriz_id");
    expect(await porNome(x)).toBe(0);
    for (const [campo, valor] of [["rg", "1234567"], ["caepf", "12345678901234"], ["sexo", "F"]] as const) {
      const y = nome(`juridica ${campo}`);
      campoRecusado(await post({ name: y, person_type: "legal", is_client: true, [campo]: valor }), campo);
      expect(await porNome(y), campo).toBe(0);
    }
    const f = criado(await post({ name: nome("fisica ok"), person_type: "natural", is_client: true, rg: "1234567", caepf: "12345678901234", sexo: "M" }));
    expect(await um("select rg, caepf, sexo from erp.people where id=$1", [f])).toEqual({ rg: "1234567", caepf: "12345678901234", sexo: "M" });
  });

  it("latitude sem longitude → 422 (no cadastro e na linha de endereço); e-mail NF-e inválido → 422; par completo grava", async () => {
    const x = nome("lat");
    const r = await post({ name: x, person_type: "legal", is_client: true, latitude: "-15.2", longitude: null });
    expect(r.statusCode, r.body).toBe(422); expect(await porNome(x)).toBe(0);
    const y = nome("lat end");
    const e = await post({ name: y, person_type: "legal", is_client: true, enderecos: [{ tipo: "entrega", logradouro: "Rua AJ", longitude: "-59.3" }] });
    expect(e.statusCode, e.body).toBe(422); expect(await porNome(y)).toBe(0);
    campoRecusado(await post({ name: nome("nfe"), person_type: "legal", is_client: true, email_nfe: "nao-e-email" }), "email_nfe");
    const ok = criado(await post({ name: nome("coords"), person_type: "legal", is_client: true, latitude: "-15.228", longitude: "-59.335", email_nfe: "nfe@exemplo.com.br", calcula_funrural: true }));
    expect(await um("select latitude::text, longitude::text, email_nfe::text, calcula_funrural from erp.people where id=$1", [ok])).toEqual({ latitude: "-15.228000", longitude: "-59.335000", email_nfe: "nfe@exemplo.com.br", calcula_funrural: true });
  });

  it("PUT sem os campos novos não muda nada (web anterior)", async () => {
    const f = criado(await post({ name: nome("put antigo"), person_type: "natural", is_client: true, rg: "999", sexo: "F", latitude: "1", longitude: "2" }));
    const r = await put(f, { name: nome("put antigo renomeado") });
    expect(r.statusCode, r.body).toBe(200);
    expect(await um("select rg, sexo, latitude::text lat from erp.people where id=$1", [f])).toEqual({ rg: "999", sexo: "F", lat: "1.000000" });
  });
});
