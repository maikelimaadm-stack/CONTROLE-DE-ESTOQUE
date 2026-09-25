import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Cadastros em árvore: código sugerido pelo antecessor, máscara por cadastro, regras de hierarquia no
 * servidor e listagem na ordem da árvore. O cadastro de prova é Categorias Financeiras (a demo tem as
 * raízes "1" e "2", sintéticas, com filhos).
 */
let h: Harness; let admin: Db;
const j = (r: { body: string }) => JSON.parse(r.body);
const base = "/api/resources/financial_categories";
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: base, headers: h.headers({ "content-type": "application/json" }), payload });
const put = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `${base}/${id}`, headers: h.headers({ "content-type": "application/json" }), payload });
const params = (payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: h.headers({ "content-type": "application/json" }), payload });
const contar = async () => Number((await admin.query<{ n: string }>("select count(*) n from erp.financial_categories where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
const erroDoCampo = (r: { body: string }) => (j(r).error.details as { path: string[]; message: string }[])[0]!;
let raiz: string; let filho: string; let neto: string;

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("código hierárquico", () => {
  it("H1: sugestão na raiz e abaixo do antecessor segue a máscara padrão", async () => {
    const r = await get(`${base}/proximo-codigo`);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ codigo: "3", mascara: "9.99.999.9999" });
    const c = await post({ code: "3", name: "Outras Receitas", nature: "income", kind: "synthetic" });
    expect(c.statusCode, c.body).toBe(201); raiz = j(c).id;
    expect(j(await get(`${base}/proximo-codigo?parent_id=${raiz}`)).codigo).toBe("3.01");
    const f = await post({ code: "3.01", name: "Juros", nature: "income", kind: "synthetic", parent_id: raiz });
    expect(f.statusCode, f.body).toBe(201); filho = j(f).id;
    expect(j(await get(`${base}/proximo-codigo?parent_id=${filho}`)).codigo).toBe("3.01.001");
    const n = await post({ code: "3.01.001", name: "Juros de aplicação", nature: "income", kind: "analytic", parent_id: filho });
    expect(n.statusCode, n.body).toBe(201); neto = j(n).id;
    expect(j(await get(`${base}/proximo-codigo?parent_id=${filho}`)).codigo).toBe("3.01.002");
    // AJUSTES 01 (D-1): o código é GERADO no servidor. O sugerido (o que o web anterior manda) é aceito, como acima;
    // pular número deixou de ser permitido (422, nada gravado) e o POST sem código recebe o próximo.
    const pulo = await post({ code: "3.01.005", name: "Outros juros", nature: "income", kind: "analytic", parent_id: filho });
    expect(pulo.statusCode).toBe(422); expect(erroDoCampo(pulo)).toEqual({ path: ["code"], message: "O código é gerado pelo sistema." });
    const semCodigo = await post({ name: "Outros juros", nature: "income", kind: "analytic", parent_id: filho });
    expect(semCodigo.statusCode, semCodigo.body).toBe(201); expect(j(semCodigo).code).toBe("3.01.002");
    expect(j(await get(`${base}/proximo-codigo?parent_id=${filho}`)).codigo).toBe("3.01.003");
  });

  // AJUSTES 01 (D-1): pela API, qualquer código diferente do gerado é recusado ANTES da máscara (a regra da máscara
  // continua valendo na geração e na importação; coberta em packages/domain/test/codigo-hierarquico.test.ts).
  it("H2: código fora da máscara, com prefixo errado ou raiz com dois níveis → 422 no campo código; nada gravado", async () => {
    const antes = await contar();
    for (const [code, parent] of [["4.01", filho], ["3.01.1", filho], ["5.01", undefined], ["1.01.001.0001.1", undefined]] as const) {
      const r = await post({ code, name: "X", nature: "income", kind: "analytic", ...(parent ? { parent_id: parent } : {}) });
      expect(r.statusCode, code).toBe(422);
      expect(erroDoCampo(r)).toMatchObject({ path: ["code"], message: "O código é gerado pelo sistema." });
    }
    expect(await contar()).toBe(antes);
  });

  it("H3: antecessor analítico ou inexistente → 422 no antecessor", async () => {
    const r = await post({ code: "3.01.001.0001", name: "X", nature: "income", kind: "analytic", parent_id: neto });
    expect(r.statusCode).toBe(422); expect(erroDoCampo(r)).toMatchObject({ path: ["parent_id"], message: expect.stringMatching(/precisa ser sintético/) });
    const x = await post({ code: "3.02", name: "X", nature: "income", kind: "analytic", parent_id: "00000000-0000-4000-8000-000000000000" });
    expect(x.statusCode).toBe(422); expect(erroDoCampo(x).message).toBe("Superior não encontrado.");
    // antecessor de OUTRA organização é "não encontrado" (sem revelar existência)
    const outra = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('Outra','arvore-outra') returning id")).rows[0]!.id;
    const alheio = (await admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,'1','Alheia','income','synthetic') returning id", [outra])).rows[0]!.id;
    const y = await post({ code: "1.09", name: "X", nature: "income", kind: "analytic", parent_id: alheio });
    expect(y.statusCode).toBe(422); expect(erroDoCampo(y).message).toBe("Superior não encontrado.");
  });

  it("H4: registro com filhos não vira analítico; ciclo é recusado", async () => {
    const k = await put(filho, { kind: "analytic" });
    expect(k.statusCode).toBe(422); expect(erroDoCampo(k)).toMatchObject({ path: ["kind"] });
    // AJUSTES 01 (D-5): mudar o superior pela edição comum é recusado antes do ciclo ("Use Mover."); o ciclo
    // pelo Mover é cobrado em cadastros-ajustes-01-arvore.test.ts (MV-4)
    const c = await put(raiz, { parent_id: neto });
    expect(c.statusCode).toBe(422); expect(erroDoCampo(c).message).toMatch(/Use Mover\./);
    const s = await put(raiz, { parent_id: raiz });
    expect(s.statusCode).toBe(422);
    expect((await admin.query("select parent_id from erp.financial_categories where id=$1", [raiz])).rows[0]).toEqual({ parent_id: null });
  });

  it("H5: exclusão com filhos vivos é recusada; folha é excluída", async () => {
    const r = await h.app.inject({ method: "DELETE", url: `${base}/${filho}`, headers: h.headers() });
    expect(r.statusCode).toBe(422); expect(j(r).error.message).toMatch(/tem filhos/);
    expect((await admin.query("select deleted_at from erp.financial_categories where id=$1", [filho])).rows[0]).toEqual({ deleted_at: null });
  });

  it("H6: editar outro campo de registro antigo fora da máscara não é barrado", async () => {
    const antigo = (await admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,'77.7','Legado','income','analytic') returning id", [h.demo.orgId])).rows[0]!.id;
    const r = await put(antigo, { name: "Legado renomeado" });
    expect(r.statusCode, r.body).toBe(200);
    const m = await put(antigo, { code: "77.8" });
    expect(m.statusCode).toBe(422);
  });

  // AJUSTES 01 (D-4): a máscara só muda com o cadastro VAZIO. Naturezas tem registros → 422; o efeito da máscara
  // por cadastro é provado em Centros de Resultado esvaziado (excluído logicamente e restaurado ao fim).
  const esvaziarCentros = async () => (await admin.query<{ id: string }>("update erp.cost_centers set deleted_at=now() where organization_id=$1 and deleted_at is null returning id", [h.demo.orgId])).rows.map((x) => x.id);
  const restaurarCentros = async (ids: string[]) => { await admin.query("update erp.cost_centers set deleted_at=now() where organization_id=$1 and deleted_at is null", [h.demo.orgId]); await admin.query("update erp.cost_centers set deleted_at=null where id = any($1::uuid[])", [ids]); };
  it("H7: máscara por cadastro nos parâmetros; máscara inválida ou cadastro desconhecido → 422", async () => {
    const vivos = await contar();
    const travada = await params({ mascaras_codigo: { financial_categories: "9.9.99" } });
    expect(travada.statusCode).toBe(422);
    expect(erroDoCampo(travada).message).toMatch(/a máscara só muda com o cadastro vazio/);
    expect(vivos).toBeGreaterThan(0);
    const ids = await esvaziarCentros();
    try {
      expect((await params({ mascaras_codigo: { cost_centers: "9.9.99" } })).statusCode).toBe(200);
      expect(j(await get("/api/resources/cost_centers/proximo-codigo"))).toEqual({ codigo: "1", mascara: "9.9.99" });
      // outros cadastros seguem na padrão
      expect(j(await get(`${base}/proximo-codigo?parent_id=${raiz}`)).mascara).toBe("9.99.999.9999");
      for (const bad of [{ cost_centers: "x" }, { cost_centers: "9..9" }, { produtos: "9" }]) {
        const r = await params({ mascaras_codigo: bad });
        expect(r.statusCode, JSON.stringify(bad)).toBe(422);
      }
      expect((await admin.query("select parameters->'mascaras_codigo' m from erp.organizations where id=$1", [h.demo.orgId])).rows[0]).toEqual({ m: { cost_centers: "9.9.99" } });
      expect((await params({ mascaras_codigo: {} })).statusCode).toBe(200);
      expect(j(await get("/api/resources/cost_centers/proximo-codigo")).mascara).toBe("9.99.999.9999");
    } finally { await params({ mascaras_codigo: {} }); await restaurarCentros(ids); }
  });

  it("H8: último nível da máscara não tem sugestão (erro, não número inventado)", async () => {
    const ids = await esvaziarCentros();
    try {
      expect((await params({ mascaras_codigo: { cost_centers: "9.99" } })).statusCode).toBe(200);
      const r1 = await h.app.inject({ method: "POST", url: "/api/resources/cost_centers", headers: h.headers({ "content-type": "application/json" }), payload: { name: "H8 raiz", kind: "synthetic" } });
      expect(r1.statusCode, r1.body).toBe(201);
      const r2 = await h.app.inject({ method: "POST", url: "/api/resources/cost_centers", headers: h.headers({ "content-type": "application/json" }), payload: { name: "H8 filho", kind: "synthetic", parent_id: j(r1).id } });
      expect(r2.statusCode, r2.body).toBe(201); expect(j(r2).code).toMatch(/^1\.\d{2}$/); // excluídos seguram "1.01"…
      const r = await get(`/api/resources/cost_centers/proximo-codigo?parent_id=${j(r2).id}`);
      expect(r.statusCode).toBe(422); expect(erroDoCampo(r).message).toMatch(/último nível/);
    } finally {
      await admin.query("update erp.cost_centers set deleted_at=now() where organization_id=$1 and deleted_at is null", [h.demo.orgId]);
      expect((await params({ mascaras_codigo: {} })).statusCode).toBe(200);
      await restaurarCentros(ids);
    }
  });

  it("H9: sugestão exige permissão de criar; cadastro sem código hierárquico → 422", async () => {
    const op = await h.app.inject({ method: "GET", url: `${base}/proximo-codigo`, headers: h.opHeaders() });
    expect(op.statusCode).toBe(403);
    expect((await get("/api/resources/addressings/proximo-codigo")).statusCode).toBe(422);
  });
});

describe("listagem em árvore", () => {
  it("H10: sem ordenação, sai na ordem da árvore com nível, ancestrais e tem_filhos; com ordenação, lista plana", async () => {
    const r = j(await get(`${base}?pageSize=500`)) as { items: { id: string; code: string; nivel: number; ancestrais: string[]; tem_filhos: boolean }[] };
    expect(r.items.length).toBeGreaterThan(10);
    const por = new Map(r.items.map((x, i) => [x.id, { ...x, i }]));
    const f = por.get(filho)!, n = por.get(neto)!, rz = por.get(raiz)!;
    expect([rz.nivel, f.nivel, n.nivel]).toEqual([0, 1, 2]);
    expect(n.ancestrais).toEqual([raiz, filho]);
    expect(rz.i).toBeLessThan(f.i); expect(f.i).toBeLessThan(n.i);
    expect([rz.tem_filhos, n.tem_filhos]).toEqual([true, false]);
    // pai sempre antes do filho, em toda a lista
    for (const x of r.items) for (const a of x.ancestrais) expect(por.get(a)!.i, x.code).toBeLessThan(por.get(x.id)!.i);
    const plano = j(await get(`${base}?pageSize=500&sort=name`)) as { items: Record<string, unknown>[] };
    expect(plano.items[0]).not.toHaveProperty("nivel");
  });

  it("H11: endereçamento (árvore sem código) usa o rótulo como caminho", async () => {
    const a = j(await h.app.inject({ method: "POST", url: "/api/resources/addressings", headers: h.headers({ "content-type": "application/json" }), payload: { description: "Galpão A" } })).id;
    const b = await h.app.inject({ method: "POST", url: "/api/resources/addressings", headers: h.headers({ "content-type": "application/json" }), payload: { description: "Prateleira 1", parent_id: a } });
    expect(b.statusCode, b.body).toBe(201);
    const r = j(await get("/api/resources/addressings?pageSize=100")) as { items: { id: string; nivel: number; tem_filhos: boolean }[] };
    expect(r.items.find((x) => x.id === a)).toMatchObject({ nivel: 0, tem_filhos: true });
    expect(r.items.find((x) => x.id === j(b).id)).toMatchObject({ nivel: 1 });
  });
});
