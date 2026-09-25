import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · FRENTE D (testes da seção 8): CD-1..CD-3 (código gerado no servidor), MK-1 (máscara
 * travada com registros), MV-1..MV-6 (Mover com renumeração). Cadastro de prova: Naturezas (financial_categories),
 * a única árvore com Tipo (herdaDoSuperior). A demo tem "1" RECEITAS (income) e "2" DESPESAS (expense).
 *
 * RV-M1 (reversa): tirar a troca de prefixo dos descendentes em lib/arvore-cadastro.ts → MV-2 reprova (os
 * descendentes ficam com o prefixo antigo "1.xx…" debaixo do superior novo).
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Det = { path: string | string[]; message: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const url = (key: string) => `/api/resources/${key}`;
const get = (u: string) => h.app.inject({ method: "GET", url: u, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: url(key), headers: hdr(), payload });
const put = (key: string, id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `${url(key)}/${id}`, headers: hdr(), payload });
const NAT = "financial_categories";
const nova = (payload: Record<string, unknown>) => post(NAT, { nature: "income", kind: "analytic", ...payload });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r) as { id: string; code: string }; };
const codigoDe = async (id: string, tabela = "financial_categories") => (await admin.query<{ code: string }>(`select code from erp.${tabela} where id=$1`, [id])).rows[0]!.code;
const idPorCodigo = async (code: string) => (await admin.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code=$2 and deleted_at is null", [h.demo.orgId, code])).rows[0]!.id;
const mensagens = (r: Resp) => [j(r).error?.message, ...((j(r).error?.details ?? []) as Det[]).map((d) => d.message)].join(" | ");
const previa = (key: string, id: string, superior: string | null) => get(`${url(key)}/${id}/mover/previa?superior=${superior ?? "raiz"}`);
const mover = (key: string, id: string, superior: string | null) => h.app.inject({ method: "POST", url: `${url(key)}/${id}/mover`, headers: hdr(), payload: { superior } });
const params = (payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: hdr(), payload });

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 4 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("CD-1 código gerado no servidor (Naturezas)", () => {
  it("POST sem code na raiz → próximo da raiz; Novo filho sem code → superior + máscara; code IGUAL ao gerado é aceito (web anterior)", async () => {
    const raiz = criado(await nova({ name: "AJ CD1 raiz", kind: "synthetic" }));
    expect(raiz.code ?? await codigoDe(raiz.id)).toBe("3");
    const f1 = criado(await nova({ name: "AJ CD1 f1", parent_id: raiz.id }));
    expect(await codigoDe(f1.id)).toBe("3.01");
    const sug = j(await get(`${url(NAT)}/proximo-codigo?parent_id=${raiz.id}`)).codigo;
    expect(sug).toBe("3.02");
    const f2 = criado(await nova({ name: "AJ CD1 f2", parent_id: raiz.id, code: sug }));
    expect(await codigoDe(f2.id)).toBe("3.02");
  });

  it("code DIFERENTE do gerado → 422 \"O código é gerado pelo sistema.\", nada gravado", async () => {
    const raiz = await idPorCodigo("3");
    const antes = (await admin.query("select 1 from erp.financial_categories where organization_id=$1", [h.demo.orgId])).rowCount;
    const r = await nova({ name: "AJ CD1 pulando", parent_id: raiz, code: "3.09" });
    expect(r.statusCode, r.body).toBe(422);
    expect(mensagens(r)).toContain("O código é gerado pelo sistema.");
    expect((await admin.query("select 1 from erp.financial_categories where organization_id=$1", [h.demo.orgId])).rowCount).toBe(antes);
  });

  it("PUT mudando code → 422; mudar o superior pela edição comum → 422 \"Use Mover.\"; nada muda", async () => {
    const id = await idPorCodigo("3.02");
    const r = await put(NAT, id, { code: "3.07" });
    expect(r.statusCode, r.body).toBe(422);
    expect(await codigoDe(id)).toBe("3.02");
    const outro = await idPorCodigo("1");
    const p = await put(NAT, id, { parent_id: outro });
    expect(p.statusCode, p.body).toBe(422);
    expect(mensagens(p)).toContain("Use Mover.");
    expect((await admin.query("select parent_id from erp.financial_categories where id=$1", [id])).rows[0]).toEqual({ parent_id: await idPorCodigo("3") });
    // PUT com o MESMO code (web anterior reenviando a ficha) passa
    const mesmo = await put(NAT, id, { code: "3.02", name: "AJ CD1 f2 renomeada" });
    expect(mesmo.statusCode, mesmo.body).toBe(200);
  });

  it("dois \"Novo filho\" simultâneos → códigos diferentes, nenhum 409 (trava por tabela + organização)", async () => {
    const pai = await idPorCodigo("3");
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => nova({ name: `AJ CD1 simultaneo ${i}`, parent_id: pai })));
    expect(rs.map((r) => r.statusCode), rs.map((r) => r.body).join("\n")).toEqual(Array(6).fill(201));
    const codigos = await Promise.all(rs.map((r) => codigoDe(j(r).id)));
    expect(new Set(codigos).size).toBe(6);
    expect(codigos.every((c) => /^3\.\d{2}$/.test(c))).toBe(true);
  });

  it("as outras árvores com código também geram (Plano de Contas, Centros de Resultado, Grupos de Produtos)", async () => {
    for (const [key, extra] of [["chart_accounts", { description: "AJ CD1 conta", condition: "both", kind: "synthetic" }], ["cost_centers", { name: "AJ CD1 centro", kind: "synthetic" }], ["product_groups", { name: "AJ CD1 grupo", kind: "synthetic" }]] as const) {
      const r = await post(key, extra);
      expect(r.statusCode, `${key}: ${r.body}`).toBe(201);
      const code = await codigoDe(j(r).id, key);
      expect(code, key).toMatch(/^\d+$/);
      const x = await post(key, { ...extra, code: "987" });
      expect(x.statusCode, `${key} com code diferente: ${x.body}`).toBe(422);
    }
  });
});

describe("CD-2 código sequencial (Contas bancárias, Áreas, Currais)", () => {
  const casos = async () => {
    const empresa = h.demo.empresaIds[0]!;
    const setor = (await admin.query<{ id: string }>("select id from erp.feedlot_sectors where organization_id=$1 and deleted_at is null limit 1", [h.demo.orgId])).rows[0]!.id;
    return [
      ["bank_accounts", "bank_accounts", (n: string) => ({ description: `AJ CD2 conta ${n}`, type: "checking" })],
      ["areas", "areas", (n: string) => ({ empresa_id: empresa, name: `AJ CD2 area ${n}`, area_ha: "1" })],
      ["feedlot_corrals", "feedlot_corrals", (n: string) => ({ sector_id: setor, name: `AJ CD2 curral ${n}`, capacity: 10 })]
    ] as const;
  };
  it("sem code → sequencial; com code → 422 legível; número já usado por código antigo é pulado; nome livre", async () => {
    for (const [key, tabela, corpo] of await casos()) {
      const a = await post(key, corpo("a"));
      expect(a.statusCode, `${key}: ${a.body}`).toBe(201);
      const c1 = await codigoDe(j(a).id, tabela);
      expect(c1, key).toMatch(/^\d+$/);
      const b = await post(key, corpo("b"));
      const c2 = await codigoDe(j(b).id, tabela);
      expect(Number(c2), `${key}: sequencial`).toBe(Number(c1) + 1);
      // código ANTIGO igual ao próximo número (mesma largura) → é pulado
      const antigo = String(Number(c2) + 1).padStart(c2.length, "0");
      const org = h.demo.orgId;
      const linha = await admin.query<{ id: string }>(`select * from erp.${tabela} where id=$1`, [j(b).id]);
      const cols = Object.keys(linha.rows[0]!).filter((k) => !["id", "created_at", "updated_at", "deleted_at", "id_global"].includes(k));
      await admin.query(`insert into erp.${tabela} (${cols.join(",")}) select ${cols.map((k) => (k === "code" ? "$2" : k === "name" || k === "description" ? `${k} || ' antigo'` : k)).join(",")} from erp.${tabela} where id=$1`, [j(b).id, antigo]);
      expect(org).toBeTruthy();
      const c = await post(key, corpo("c"));
      expect(c.statusCode, c.body).toBe(201);
      expect(Number(await codigoDe(j(c).id, tabela)), `${key}: ${antigo} já existia e foi pulado`).toBe(Number(c2) + 2);
      // nome repetido é permitido
      expect((await post(key, corpo("c"))).statusCode, `${key}: nome livre`).toBe(201);
      const x = await post(key, { ...corpo("x"), code: "ZZ9" });
      expect(x.statusCode, x.body).toBe(422);
      expect(mensagens(x).length).toBeGreaterThan(5);
      expect(mensagens(x)).not.toMatch(/Unrecognized|Expected/);
    }
  });
});

describe("CD-3 importação continua aceitando o código da planilha", () => {
  it("plano de contas importado com códigos próprios (inclusive pulando número) grava os códigos da planilha", async () => {
    const m = await h.app.inject({ method: "GET", url: "/api/imports/chart_accounts/modelo", headers: h.headers() });
    expect(m.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(m.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Dados")!; const cab: string[] = []; ws.getRow(1).eachCell((c) => cab.push(String(c.value)));
    const col = (t: string) => { const n = cab.indexOf(t) + 1; if (!n) throw new Error(`coluna ${t}: ${cab.join("|")}`); return n; };
    for (const [i, code] of ["8", "6"].entries()) {
      const row = ws.getRow(i + 2);
      row.getCell(col("Código *")).value = code; row.getCell(col("Descrição *")).value = `AJ CD3 ${code}`; row.getCell(col("Condição *")).value = "Ambos"; row.getCell(col("Analítica *")).value = "Não"; row.commit();
    }
    const r = await h.app.inject({ method: "POST", url: "/api/imports/chart_accounts?simular=0", headers: hdr(), payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
    expect(r.statusCode, r.body).toBe(200);
    const g = (await admin.query<{ code: string }>("select code from erp.chart_accounts where organization_id=$1 and description like 'AJ CD3 %' order by code", [h.demo.orgId])).rows.map((x) => x.code);
    expect(g).toEqual(["6", "8"]);
  });
});

describe("MK-1 máscara travada com registros", () => {
  it("com vivos → 422 no campo \"Há N registros: a máscara só muda com o cadastro vazio.\"; sem vivos → aceita", async () => {
    const vivos = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.financial_categories where organization_id=$1 and deleted_at is null", [h.demo.orgId])).rows[0]!.n);
    expect(vivos).toBeGreaterThan(0);
    const r = await params({ mascaras_codigo: { financial_categories: "9.9.99" } });
    expect(r.statusCode, r.body).toBe(422);
    expect(mensagens(r)).toContain(`Há ${vivos} registros: a máscara só muda com o cadastro vazio.`);
    expect((await admin.query("select parameters->'mascaras_codigo' m from erp.organizations where id=$1", [h.demo.orgId])).rows[0]!.m ?? {}).not.toHaveProperty("financial_categories");
    // cadastro vazio (Endereçamentos não tem máscara; usa-se Grupos de Produtos esvaziado dentro de uma transação desfeita não serve: a API tem outra conexão) → esvazia de verdade um cadastro com máscara
    await admin.query("update erp.cost_centers set deleted_at=now() where organization_id=$1 and deleted_at is null", [h.demo.orgId]);
    const ok = await params({ mascaras_codigo: { cost_centers: "9.9.99" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await admin.query("select parameters->'mascaras_codigo'->>'cost_centers' m from erp.organizations where id=$1", [h.demo.orgId])).rows[0]).toEqual({ m: "9.9.99" });
  });
});

describe("MV Mover com renumeração (Naturezas)", () => {
  let destino: string; // "4" Receita e despesa, sintético: aceita qualquer Tipo
  let galho: string; let filho: string; let neto: string; let folha: string;
  beforeAll(async () => {
    destino = criado(await nova({ name: "AJ MV destino", nature: "both", kind: "synthetic" })).id;
    // na raiz "1" (income): galho sintético → filho sintético → neto analítico; e uma folha analítica
    const r1 = await idPorCodigo("1");
    galho = criado(await nova({ name: "AJ MV galho", parent_id: r1, kind: "synthetic" })).id;
    filho = criado(await nova({ name: "AJ MV filho", parent_id: galho, kind: "synthetic" })).id;
    neto = criado(await nova({ name: "AJ MV neto", parent_id: filho })).id;
    folha = criado(await nova({ name: "AJ MV folha", parent_id: r1 })).id;
  });

  it("MV-1 + MV-5: folha \"1.0X\" para o destino → \"<destino>.01\"; prévia = resultado do POST; id igual; audit", async () => {
    const codDestino = await codigoDe(destino);
    const antes = await codigoDe(folha);
    const p = await previa(NAT, folha, destino);
    expect(p.statusCode, p.body).toBe(200);
    const r = await mover(NAT, folha, destino);
    expect(r.statusCode, r.body).toBe(200);
    const depois = await codigoDe(folha);
    expect(depois).toBe(`${codDestino}.01`);
    expect(JSON.stringify(j(p))).toContain(depois);
    expect(JSON.stringify(j(p))).toContain(antes);
    expect((await admin.query("select parent_id, kind from erp.financial_categories where id=$1", [folha])).rows[0]).toEqual({ parent_id: destino, kind: "analytic" });
    const log = (await admin.query<{ metadata: { de: unknown; para: unknown; codigos: { id: string; antes: string; depois: string }[] } }>("select metadata from erp.audit_logs where organization_id=$1 and entity_id=$2 and action='mover' order by id desc limit 1", [h.demo.orgId, folha])).rows[0];
    expect(log?.metadata.codigos).toEqual([{ id: folha, antes, depois }]);
  });

  it("MV-2 + MV-5: galho com filho e neto (e um descendente EXCLUÍDO) → só o prefixo troca; ids iguais; lançamento antigo no mesmo id", async () => {
    const excluido = criado(await nova({ name: "AJ MV neto excluido", parent_id: filho })).id;
    await admin.query("update erp.financial_categories set deleted_at=now() where id=$1", [excluido]);
    const produto = (await admin.query<{ id: string }>("select id from erp.products where organization_id=$1 order by created_at limit 1", [h.demo.orgId])).rows[0]!.id;
    await admin.query("update erp.products set financial_category_id=$2 where id=$1", [produto, neto]);
    const cg = await codigoDe(galho); const cf = await codigoDe(filho); const cn = await codigoDe(neto); const ce = await codigoDe(excluido);
    expect(cf.startsWith(`${cg}.`) && cn.startsWith(`${cf}.`)).toBe(true);
    const p = j(await previa(NAT, galho, destino));
    const r = await mover(NAT, galho, destino);
    expect(r.statusCode, r.body).toBe(200);
    const ng = await codigoDe(galho);
    expect(ng).toBe(`${await codigoDe(destino)}.02`);
    const troca = (c: string) => ng + c.slice(cg.length);
    expect(await codigoDe(filho), "filho: só o prefixo").toBe(troca(cf));
    expect(await codigoDe(neto), "neto: só o prefixo").toBe(troca(cn));
    expect(await codigoDe(excluido), "descendente excluído vai junto").toBe(troca(ce));
    expect((await admin.query("select financial_category_id from erp.products where id=$1", [produto])).rows[0]).toEqual({ financial_category_id: neto });
    expect((await admin.query("select kind from erp.financial_categories where id=$1", [neto])).rows[0]).toEqual({ kind: "analytic" });
    // prévia = resultado
    for (const [id, c] of [[galho, ng], [filho, troca(cf)], [neto, troca(cn)]] as const) expect(JSON.stringify(p), `prévia traz ${c} de ${id}`).toContain(c);
  });

  it("MV-3 mover para a RAIZ → próximo da raiz; descendentes acompanham", async () => {
    const maiorRaiz = Math.max(...(await admin.query<{ code: string }>("select code from erp.financial_categories where organization_id=$1 and parent_id is null and code ~ '^[0-9]+$'", [h.demo.orgId])).rows.map((x) => Number(x.code)));
    const p = await previa(NAT, galho, null);
    expect(p.statusCode, p.body).toBe(200);
    const r = await mover(NAT, galho, null);
    expect(r.statusCode, r.body).toBe(200);
    const ng = await codigoDe(galho);
    expect(ng).toBe(String(maiorRaiz + 1));
    expect(await codigoDe(filho)).toBe(`${ng}.01`);
    expect((await codigoDe(neto)).startsWith(`${ng}.01.`)).toBe(true);
    expect((await admin.query("select parent_id from erp.financial_categories where id=$1", [galho])).rows[0]).toEqual({ parent_id: null });
  });

  it("MV-4 recusas 422: dentro de si/descendente; destino analítico; estoura a máscara; Tipo incompatível; destino inativo — nada muda", async () => {
    const foto = async () => (await admin.query("select id, code, parent_id from erp.financial_categories where organization_id=$1 order by id", [h.demo.orgId])).rows;
    const antes = await foto();
    const casos: [string, string | null, RegExp][] = [
      [galho, galho, /descendente|próprio|si mesmo/i],
      [galho, filho, /descendente/i],
      [folha, neto, /o superior precisa ser sintético/i],
      [galho, await idPorCodigo("2"), /Tipo|tipo/],
      [folha, await idPorCodigo("2.01"), /Tipo|tipo/]
    ];
    // estoura a máscara (padrão 4 níveis): galho tem 3 níveis (galho/filho/neto) → debaixo de um nível 2 = 5 níveis
    const funda = criado(await nova({ name: "AJ MV funda", parent_id: destino, kind: "synthetic" })).id;
    casos.push([galho, funda, /máximo de \d+ níveis/]);
    const inativo = criado(await nova({ name: "AJ MV inativo", nature: "both", kind: "synthetic" })).id;
    await admin.query("update erp.financial_categories set is_active=false where id=$1", [inativo]);
    casos.push([folha, inativo, /inativ/i]);
    const depoisDoFixture = await foto();
    for (const [id, dest, msg] of casos) {
      const r = await mover(NAT, id, dest);
      expect(r.statusCode, `${id}→${dest}: ${r.body}`).toBe(422);
      expect(mensagens(r)).toMatch(msg);
      const pr = await previa(NAT, id, dest);
      expect(pr.statusCode, `prévia ${id}→${dest}`).toBe(422);
    }
    expect(await foto()).toEqual(depoisDoFixture);
    expect(antes.length).toBeLessThan(depoisDoFixture.length);
  });

  it("MV-4 sem <permission>.edit → 403 (operador)", async () => {
    const r = await h.app.inject({ method: "POST", url: `${url(NAT)}/${folha}/mover`, headers: { ...h.opHeaders(), "content-type": "application/json" }, payload: { superior: null } });
    expect(r.statusCode).toBe(403);
  });

  it("MV-6 PUT comum mudando o superior de registro com filhos → 422 \"Use Mover.\"", async () => {
    const r = await put(NAT, galho, { parent_id: destino });
    expect(r.statusCode, r.body).toBe(422);
    expect(mensagens(r)).toContain("Use Mover.");
    expect((await admin.query("select parent_id from erp.financial_categories where id=$1", [galho])).rows[0]).toEqual({ parent_id: null });
  });
});
