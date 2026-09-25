import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import * as dominio from "@agro/domain";
import { REFERENCIAS_DE_BUSCA } from "@agro/domain";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { harness, configDeTeste, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · FRENTE A (testes da seção 8: BR-1..BR-4, CP-1).
 *
 * Fato de produção (0.1): `GET /api/referencias/<chave>?pageSize=30` SEM texto — o que a tela pede ao ABRIR o
 * campo — respondia 500 ("bind message supplies 2 parameters, but prepared statement requires 0"). Nenhum teste
 * antigo chamava a busca sem `search`: todos digitavam texto. Aqui cada combinação é chamada de verdade, com o
 * banco da 0026 carregado, e o que se confere é o 200 COM itens (lista vazia não prova nada).
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Item = { codigo: string | number; nome: string; rotulo: string; extra?: string | null };
const j = (r: Resp) => JSON.parse(r.body);
const get = (url: string, headers = h.headers()) => h.app.inject({ method: "GET", url, headers });
const itens = (r: Resp) => j(r).items as Item[];

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("BR-1 as 4 chaves sem texto e com texto", () => {
  const exemplos: Record<string, { texto: string; codigo: string }> = {
    municipios: { texto: "Pontes e Lacerda - MT", codigo: "5106752" },
    bancos: { texto: "banco do brasil", codigo: "001" },
    ncm: { texto: "cavalos", codigo: "01012100" },
    cbo: { texto: "trabalhador", codigo: "622005" }
  };
  for (const chave of ["municipios", "bancos", "ncm", "cbo"]) {
    it(`${chave}: sem search (página 1 e 2) → 200 com itens distintos; com texto e com código → 200`, async () => {
      const p1 = await get(`/api/referencias/${chave}?pageSize=30`);
      expect(p1.statusCode, p1.body).toBe(200);
      expect(itens(p1).length, "a lista ao ABRIR o campo não pode vir vazia").toBeGreaterThan(0);
      const p2 = await get(`/api/referencias/${chave}?pageSize=30&page=2`);
      expect(p2.statusCode, p2.body).toBe(200);
      expect(itens(p2).length).toBeGreaterThan(0);
      expect(itens(p2)[0]!.codigo).not.toEqual(itens(p1)[0]!.codigo);
      const vazio = await get(`/api/referencias/${chave}?search=&pageSize=30`);
      expect(vazio.statusCode, "search vazio é o mesmo que sem texto").toBe(200);
      const t = await get(`/api/referencias/${chave}?search=${encodeURIComponent(exemplos[chave]!.texto)}`);
      expect(t.statusCode, t.body).toBe(200); expect(itens(t).length).toBeGreaterThan(0);
      const c = await get(`/api/referencias/${chave}?search=${exemplos[chave]!.codigo}`);
      expect(c.statusCode, c.body).toBe(200);
      expect(itens(c).map((x) => String(x.codigo))).toContain(exemplos[chave]!.codigo);
    });
  }
});

describe("BR-2 toda chave da whitelist sem query", () => {
  it("REFERENCIAS_DE_BUSCA inteira: sem nenhuma query → 200 com itens (não só as 4 conhecidas)", async () => {
    expect(REFERENCIAS_DE_BUSCA.length).toBeGreaterThanOrEqual(4);
    for (const r of REFERENCIAS_DE_BUSCA) {
      const x = await get(`/api/referencias/${r.chave}`);
      expect(x.statusCode, `${r.chave}: ${x.body}`).toBe(200);
      expect(itens(x).length, r.chave).toBeGreaterThan(0);
      expect(j(x).total, r.chave).toBeGreaterThan(0);
    }
  });
});

describe("BR-3 bancos: código com/sem zeros, nome sem acento, ISPB e apelido", () => {
  const primeiro = async (termo: string) => {
    const r = await get(`/api/referencias/bancos?search=${encodeURIComponent(termo)}`);
    expect(r.statusCode, `${termo}: ${r.body}`).toBe(200);
    return itens(r);
  };
  it("'1' e '001' acham o 001 em primeiro; 'banco do brasil', 'nubank', 'itau' e o ISPB acham o banco certo", async () => {
    for (const [termo, codigo] of [["1", "001"], ["001", "001"], ["banco do brasil", "001"], ["nubank", "260"], ["itau", "341"], ["itaú", "341"], ["cef", "104"], ["bb", "001"]] as const) {
      const r = await primeiro(termo);
      expect(r.length, termo).toBeGreaterThan(0);
      expect(String(r[0]!.codigo), `"${termo}" → primeiro resultado`).toBe(codigo);
    }
    const ispb = (await admin.query<{ ispb: string }>("select ispb from erp.banks where code='001'")).rows[0]!.ispb;
    expect(ispb).toMatch(/^\d{8}$/);
    expect(String((await primeiro(ispb))[0]!.codigo)).toBe("001");
  });
  it("rótulo \"001 · Banco do Brasil S.A.\"", async () => {
    expect(j(await get("/api/referencias/bancos/001")).rotulo).toBe("001 · Banco do Brasil S.A.");
  });
  it("tabela de apelidos do domínio: cada código existe na 0026 e o nome bate", async () => {
    const tabela = Object.entries(dominio).find(([k, v]) => /apelido/i.test(k) && v && typeof v === "object")?.[1] as unknown;
    expect(tabela, "a tabela de apelidos de banco é exportada pelo domínio").toBeTruthy();
    const pares: [string, string][] = Array.isArray(tabela)
      ? (tabela as Record<string, unknown>[]).flatMap((e) => {
        const cod = String(e["codigo"] ?? e["code"]); const ap = e["apelidos"] ?? e["apelido"];
        return (Array.isArray(ap) ? ap : [ap]).map((a) => [String(a), cod] as [string, string]);
      })
      : Object.entries(tabela as Record<string, string>).map(([a, c]) => [a, String(c)]);
    const exigidos: Record<string, string> = { bb: "001", "banco do brasil": "001", caixa: "104", cef: "104", bradesco: "237", itau: "341", santander: "033", nubank: "260", nu: "260", inter: "077", c6: "336", sicredi: "748", sicoob: "756", original: "212", btg: "208", banrisul: "041", safra: "422", "mercado pago": "323", pagbank: "290", pagseguro: "290", picpay: "380", brb: "070", bnb: "004", "banco do nordeste": "004", unicred: "136", ailos: "085", cora: "403", stone: "197", bv: "655", votorantim: "655" };
    const mapa = new Map(pares.map(([a, c]) => [a.toLowerCase(), c]));
    for (const [a, c] of Object.entries(exigidos)) expect(mapa.get(a), `apelido "${a}"`).toBe(c);
    // conferido contra a 0026: o código existe e o nome do banco "bate" com o apelido (palavra do apelido no nome, ou apelido de sigla)
    const sql = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations/0026_referencias_oficiais.sql"), "utf8");
    const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const [apelido, codigo] of pares) {
      const b = (await admin.query<{ name: string }>("select name from erp.banks where code=$1", [codigo])).rows[0];
      expect(b, `código ${codigo} (apelido ${apelido}) existe em erp.banks`).toBeTruthy();
      expect(sql.includes(`'${codigo}'`), `código ${codigo} está na 0026`).toBe(true);
      const nome = semAcento(b!.name);
      const siglas: Record<string, string> = { bb: "brasil", cef: "caixa", nu: "nu", bnb: "nordeste", bv: "bv", brb: "brasilia", c6: "c6", btg: "btg", pagbank: "pagseguro", pagseguro: "pagseguro", inter: "inter", ailos: "ailos", cora: "cora", stone: "stone", votorantim: "bv", itau: "itau", caixa: "caixa" };
      const chave = siglas[semAcento(apelido)] ?? semAcento(apelido).split(" ").find((p) => p.length > 2) ?? semAcento(apelido);
      expect(nome.replace(/[^a-z0-9 ]/g, " "), `nome "${b!.name}" bate com o apelido "${apelido}"`).toContain(chave);
    }
  });
});

describe("BR-4 município por código IBGE e por \"Nome - UF\"", () => {
  it("rótulo \"5106752 · Pontes e Lacerda - MT\"; '5106752', 'pontes' e 'Pontes e Lacerda - MT' acham; nome sem acento", async () => {
    const ROT = "5106752 · Pontes e Lacerda - MT";
    expect(j(await get("/api/referencias/municipios/5106752")).rotulo).toBe(ROT);
    for (const termo of ["5106752", "pontes", "Pontes e Lacerda - MT", "pontes e lacerda"]) {
      const r = await get(`/api/referencias/municipios?search=${encodeURIComponent(termo)}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(itens(r).map((x) => x.rotulo), termo).toContain(ROT);
    }
    const sp = itens(await get("/api/referencias/municipios?search=sao%20paulo%20-%20sp"));
    expect(sp.map((x) => Number(x.codigo))).toContain(3550308);
  });
});

describe("CP-1 CEP para qualquer membro da organização", () => {
  const VIACEP = { cep: "78250-000", logradouro: "", complemento: "", bairro: "", localidade: "Pontes e Lacerda", uf: "MT", ibge: "5106752" };
  it("usuário SEM people.* consulta CEP → 200 (CNPJ continua 403 para ele)", async () => {
    const perms = (await admin.query<{ n: string }>("select count(*)::text n from erp.role_permissions rp join erp.organization_members m on m.role_id=rp.role_id join erp.users u on u.id=m.user_id where u.email='operador@demo.local' and rp.permission_key like 'people.%'")).rows[0]!.n;
    expect(perms, "premissa: o operador não tem people.*").toBe("0");
    await admin.query("delete from erp.consulta_cep_cache where cep='78250000'");
    const chamadas: string[] = [];
    const buscarExterno: BuscarFn = async (url) => { chamadas.push(url); return { status: 200, headers: { get: () => null }, json: async () => VIACEP }; };
    const app: FastifyInstance = await buildApp({ config: configDeTeste(), db: h.db, logger: false, buscarExterno });
    try {
      const r = await app.inject({ method: "GET", url: "/api/consultas/cep/78250-000", headers: h.opHeaders() });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ municipio: { codigoIbge: 5106752 } });
      const c = await app.inject({ method: "GET", url: "/api/consultas/cnpj/00000000000191", headers: h.opHeaders() });
      expect(c.statusCode, "CNPJ mantém a permissão de hoje").toBe(403);
    } finally { await app.close(); }
  });
});
