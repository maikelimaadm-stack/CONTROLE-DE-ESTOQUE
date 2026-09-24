import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS-ESTRUTURA (entrega B) — Grupo de Produtos em ÁRVORE, produto só em grupo analítico, aceitação
 * legada de categoria/classe, regra do Tipo da natureza, relatório/painel pela árvore e importação.
 *
 * Toda recusa confere também o banco (nada gravado) e todo aceite confere a linha gravada: um 422/201 sem a
 * premissa conferida não prova nada.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers: hdr(), payload });
const put = (key: string, id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/resources/${key}/${id}`, headers: hdr(), payload });
const del = (key: string, id: string) => h.app.inject({ method: "DELETE", url: `/api/resources/${key}/${id}`, headers: h.headers() });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
/** O primeiro erro de campo, com o caminho normalizado para lista (Zod e regra de negócio o entregam em formas diferentes). */
const erroDoCampo = (r: Resp) => { const d = (j(r).error.details as { path: string[] | string; message: string }[])[0]!; return { path: ([] as string[]).concat(d.path), message: d.message }; };
const umaLinha = async <T extends Record<string, unknown>>(sql: string, p: unknown[]) => (await admin.query<T>(sql, p)).rows[0];
const contarGrupos = async () => Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.product_groups where organization_id=$1", [h.demo.orgId]))!.n);
const grupoDoSeed = async (code: string) => (await umaLinha<{ id: string }>("select id from erp.product_groups where organization_id=$1 and code=$2 and deleted_at is null", [h.demo.orgId, code]))!.id;
let unidade: string;
const produto = (group_id: string, extra: Record<string, unknown> = {}) => ({ description: `CE produto ${Math.random().toString(36).slice(2, 8)}`, measurement_id: unidade, group_id, control_stock: false, ...extra });

const MSG_GRUPO_PRODUTO = "Escolha um grupo de produtos analítico e ativo (Analítico: Sim).";

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 }); I = await ids(h);
  unidade = (j(await get("/api/resources/measurement_units/options")) as { id: string }[])[0]!.id;
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("CE-1 — Grupo de Produtos em árvore, com as regras da decisão 244", () => {
  let raiz: string; let filho: string;

  it("raiz sintética + filho analítico com o código SUGERIDO pelo servidor", async () => {
    const s = await get("/api/resources/product_groups/proximo-codigo");
    expect(s.statusCode, s.body).toBe(200);
    // premissa: a demo tem as raízes 1, 2 e 3
    expect(j(s)).toEqual({ codigo: "4", mascara: "9.99.999.9999" });
    raiz = criado(await post("product_groups", { code: "4", name: "CE Raiz", kind: "synthetic" }));
    const sf = j(await get(`/api/resources/product_groups/proximo-codigo?parent_id=${raiz}`));
    expect(sf.codigo).toBe("4.01");
    filho = criado(await post("product_groups", { code: sf.codigo, name: "CE Filho", kind: "analytic", parent_id: raiz }));
    expect(await umaLinha("select code, kind, parent_id from erp.product_groups where id=$1", [filho])).toEqual({ code: "4.01", kind: "analytic", parent_id: raiz });
  });

  it("filho sob grupo ANALÍTICO → 422 no superior; nada gravado", async () => {
    const antes = await contarGrupos();
    const r = await post("product_groups", { code: "4.01.001", name: "CE Neto", parent_id: filho });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r).path).toEqual(["parent_id"]);
    expect(await contarGrupos()).toBe(antes);
  });

  it("código fora do prefixo do superior → 422 no código", async () => {
    const r = await post("product_groups", { code: "5.01", name: "CE Prefixo", kind: "analytic", parent_id: raiz });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r).path).toEqual(["code"]);
  });

  it("ciclo → 422; grupo com filhos não vira analítico; exclusão com filho vivo → 422", async () => {
    const c = await put("product_groups", raiz, { parent_id: filho });
    expect(c.statusCode, c.body).toBe(422); expect(erroDoCampo(c).message).toMatch(/descendente/);
    const k = await put("product_groups", raiz, { kind: "analytic" });
    expect(k.statusCode, k.body).toBe(422); expect(erroDoCampo(k).path).toEqual(["kind"]);
    const d = await del("product_groups", raiz);
    expect(d.statusCode, d.body).toBe(422);
    expect(await umaLinha("select parent_id, kind, deleted_at from erp.product_groups where id=$1", [raiz])).toEqual({ parent_id: null, kind: "synthetic", deleted_at: null });
  });

  it("mesmo nome sob pais diferentes → ok; entre irmãos (também sem diferenciar maiúsculas) → 422; duas raízes com o mesmo nome → 422", async () => {
    const pecuaria = await grupoDoSeed("2");
    criado(await post("product_groups", { code: "4.02", name: "CE Comum", parent_id: raiz }));
    criado(await post("product_groups", { code: "2.03", name: "CE Comum", parent_id: pecuaria }));
    const antes = await contarGrupos();
    for (const name of ["CE Comum", "ce comum"]) {
      const r = await post("product_groups", { code: "4.03", name, parent_id: raiz });
      expect(r.statusCode, r.body).toBe(422); expect(erroDoCampo(r).path).toEqual(["name"]);
    }
    const r = await post("product_groups", { code: "5", name: "CE Raiz", kind: "synthetic" });
    expect(r.statusCode, r.body).toBe(422); expect(erroDoCampo(r).path).toEqual(["name"]);
    expect(await contarGrupos()).toBe(antes);
    // a rede do banco (índice da 0025) também cobre a raiz: o insert direto, sem a API, colide
    await expect(admin.query("insert into erp.product_groups(organization_id,code,name) values ($1,'6','ce raiz')", [h.demo.orgId])).rejects.toMatchObject({ code: "23505", constraint: "uq_product_groups_nome_irmaos" });
  });

  it("grupo SEM código → 422 ao criar e ao editar; o grupo do acervo sem código aparece como raiz, no fim da lista", async () => {
    const r = await post("product_groups", { name: "CE Sem Código" });
    expect(r.statusCode, r.body).toBe(422); expect(erroDoCampo(r).path).toEqual(["code"]);
    const acervo = (await umaLinha<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,'AAA Acervo CE') returning id", [h.demo.orgId]))!.id;
    for (const payload of [{ name: "AAA Acervo CE 2" }, { code: null }]) {
      const e = await put("product_groups", acervo, payload);
      expect(e.statusCode, e.body).toBe(422); expect(erroDoCampo(e).path).toEqual(["code"]);
    }
    expect(await umaLinha("select code, name from erp.product_groups where id=$1", [acervo])).toEqual({ code: null, name: "AAA Acervo CE" });
    const lista = j(await get("/api/resources/product_groups?pageSize=200")).items as { id: string; nivel: number }[];
    // premissa: o nome "AAA…" viria PRIMEIRO numa ordem por nome; ele sai por último por não ter código
    expect(lista.length).toBeGreaterThan(5);
    expect(lista.at(-1)).toMatchObject({ id: acervo, nivel: 0 });
    // com código, o acervo passa a valer como qualquer grupo
    const ok = await put("product_groups", acervo, { code: "7" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("grupo analítico com produto VIVO não vira sintético (422); sem produto vivo, vira", async () => {
    const g = criado(await post("product_groups", { code: "4.04", name: "CE Com Produto", parent_id: raiz }));
    const p = criado(await post("products", produto(g)));
    const r = await put("product_groups", g, { kind: "synthetic" });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r)).toMatchObject({ path: ["kind"], message: expect.stringMatching(/mova os produtos para um grupo analítico antes/) });
    expect(await umaLinha("select kind from erp.product_groups where id=$1", [g])).toEqual({ kind: "analytic" });
    expect((await del("products", p)).statusCode).toBe(200);
    const ok = await put("product_groups", g, { kind: "synthetic" });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe("CE-2 — produto só em grupo ANALÍTICO, ativo, vivo, da organização", () => {
  it("grupo sintético → 422 no grupo; nada gravado", async () => {
    const antes = Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.products where organization_id=$1", [h.demo.orgId]))!.n);
    const r = await post("products", produto(await grupoDoSeed("2")));
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDoCampo(r)).toEqual({ path: ["group_id"], message: MSG_GRUPO_PRODUTO });
    expect(Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.products where organization_id=$1", [h.demo.orgId]))!.n)).toBe(antes);
  });

  it("inexistente, de outra organização, excluído e inativo → a MESMA recusa", async () => {
    const outra = (await umaLinha<{ id: string }>("insert into erp.organizations(name,slug) values ('Outra CE','ce-outra') returning id", []))!.id;
    const alheio = (await umaLinha<{ id: string }>("insert into erp.product_groups(organization_id,code,name) values ($1,'1','Alheio') returning id", [outra]))!.id;
    const excluido = (await umaLinha<{ id: string }>("insert into erp.product_groups(organization_id,code,name,deleted_at) values ($1,'9','CE Excluído',now()) returning id", [h.demo.orgId]))!.id;
    const inativo = (await umaLinha<{ id: string }>("insert into erp.product_groups(organization_id,code,name,is_active) values ($1,'8','CE Inativo',false) returning id", [h.demo.orgId]))!.id;
    for (const g of ["00000000-0000-4000-8000-000000000000", alheio, excluido, inativo]) {
      const r = await post("products", produto(g));
      expect(r.statusCode, `${g}: ${r.body}`).toBe(422);
      expect(erroDoCampo(r)).toEqual({ path: ["group_id"], message: MSG_GRUPO_PRODUTO });
    }
    // editar o produto para um grupo sintético também é recusado
    const p = criado(await post("products", produto(await grupoDoSeed("2.01"))));
    const e = await put("products", p, { group_id: await grupoDoSeed("1") });
    expect(e.statusCode, e.body).toBe(422);
  });

  it("grupo analítico → 201 SEM categoria nem classe", async () => {
    const g = await grupoDoSeed("2.01");
    const id = criado(await post("products", produto(g)));
    expect(await umaLinha("select group_id, category_id, kind_id from erp.products where id=$1", [id])).toEqual({ group_id: g, category_id: null, kind_id: null });
  });

  it("a lista de opções do grupo no produto pode ser recortada nos analíticos (registry ref.filtro)", async () => {
    const todas = j(await get("/api/resources/product_groups/options")) as { id: string; code: string | null }[];
    const analiticas = j(await get("/api/resources/product_groups/options?kind=analytic")) as { id: string; code: string | null }[];
    expect(todas.some((o) => o.code === "2")).toBe(true);
    expect(analiticas.some((o) => o.code === "2")).toBe(false);
    expect(analiticas.some((o) => o.code === "2.01")).toBe(true);
  });
});

describe("CE-3 — janela de deploy: corpo ANTIGO de produto (web anterior) na API nova", () => {
  it("com category_id e kind_id → 201, e a API grava o que veio", async () => {
    const g = await grupoDoSeed("2.01");
    const cat = (await umaLinha<{ id: string }>("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'CE Categoria Legada') returning id", [h.demo.orgId, g]))!.id;
    const kind = (await umaLinha<{ id: string }>("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'CE Classe Legada') returning id", [h.demo.orgId, cat]))!.id;
    const id = criado(await post("products", produto(g, { category_id: cat, kind_id: kind })));
    expect(await umaLinha("select category_id, kind_id from erp.products where id=$1", [id])).toEqual({ category_id: cat, kind_id: kind });
    // e na edição
    const u = await put("products", id, { category_id: null, kind_id: null });
    expect(u.statusCode, u.body).toBe(200);
    expect(await umaLinha("select category_id, kind_id from erp.products where id=$1", [id])).toEqual({ category_id: null, kind_id: null });
    // os cadastros legados continuam na API (lookups da web anterior)
    expect((await get("/api/resources/product_categories/options")).statusCode).toBe(200);
    expect((await get("/api/resources/product_kinds/options")).statusCode).toBe(200);
  });
  it("campo desconhecido continua recusado pelo .strict() (a aceitação legada é só a declarada)", async () => {
    const r = await post("products", produto(await grupoDoSeed("2.01"), { subcategoria_id: "x" }));
    expect(r.statusCode, r.body).toBe(422);
  });
});

describe("CE-4 — Tipo da natureza (financial_categories.nature) segue o superior", () => {
  it("filha com Tipo divergente de superior Receita → 422 no Tipo; sob 'Receita e despesa' → ok", async () => {
    const receitas = (await umaLinha<{ id: string; nature: string }>("select id, nature from erp.financial_categories where organization_id=$1 and code='1'", [h.demo.orgId]))!;
    expect(receitas.nature).toBe("income");
    const antes = Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.financial_categories where organization_id=$1", [h.demo.orgId]))!.n);
    const r = await post("financial_categories", { code: "1.09", name: "CE Divergente", nature: "expense", kind: "analytic", parent_id: receitas.id });
    expect(r.statusCode, r.body).toBe(422); expect(erroDoCampo(r).path).toEqual(["nature"]);
    expect(Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.financial_categories where organization_id=$1", [h.demo.orgId]))!.n)).toBe(antes);
    const ambos = criado(await post("financial_categories", { code: "7", name: "CE Ambos", nature: "both", kind: "synthetic" }));
    criado(await post("financial_categories", { code: "7.01", name: "CE Receita", nature: "income", kind: "analytic", parent_id: ambos }));
    criado(await post("financial_categories", { code: "7.02", name: "CE Despesa", nature: "expense", kind: "analytic", parent_id: ambos }));
    // mesmo Tipo do superior: ok
    criado(await post("financial_categories", { code: "1.09", name: "CE Igual", nature: "income", kind: "analytic", parent_id: receitas.id }));
  });

  it("o outro lado: superior com filha Despesa não muda para Receita (422); para 'Receita e despesa' pode", async () => {
    const pai = criado(await post("financial_categories", { code: "8", name: "CE Pai Despesa", nature: "expense", kind: "synthetic" }));
    const filha = criado(await post("financial_categories", { code: "8.01", name: "CE Filha Despesa", nature: "expense", kind: "analytic", parent_id: pai }));
    const r = await put("financial_categories", pai, { nature: "income" });
    expect(r.statusCode, r.body).toBe(422); expect(erroDoCampo(r).path).toEqual(["nature"]);
    expect(await umaLinha("select nature from erp.financial_categories where id=$1", [pai])).toEqual({ nature: "expense" });
    // a filha também não diverge por edição
    const f = await put("financial_categories", filha, { nature: "income" });
    expect(f.statusCode, f.body).toBe(422);
    const ok = await put("financial_categories", pai, { nature: "both" });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("o seed já segue a regra: nenhuma natureza viva diverge do superior", async () => {
    const r = await admin.query<{ n: string; total: string }>(
      `select count(*) filter (where p.nature <> 'both' and p.nature <> f.nature)::text n, count(*)::text total
         from erp.financial_categories f join erp.financial_categories p on p.id = f.parent_id
        where f.organization_id=$1 and f.deleted_at is null and f.code not like '7%' and f.code not like '8%'`, [h.demo.orgId]);
    expect(Number(r.rows[0]!.total), "premissa: a demo tem naturezas com superior").toBeGreaterThan(5);
    expect(r.rows[0]!.n).toBe("0");
  });
});

describe("CE-6 — relatório e painel de nutrição olham a ÁRVORE", () => {
  let raiz6: string; let filhoA: string; let filhoB: string; let pA: string; let pB: string; let pFora: string; let pNutriFilho: string; let pNutriRaiz: string;
  const saldo = (produtoId: string, qtd: string) => admin.query(
    "insert into erp.stock_balances(organization_id,warehouse_id,product_id,quantity,average_cost,total_value) values ($1,$2,$3,$4,1,$4)", [h.demo.orgId, I.warehouse, produtoId, qtd]);
  beforeAll(async () => {
    raiz6 = criado(await post("product_groups", { code: "6", name: "CE6 Raiz", kind: "synthetic" }));
    const meio = criado(await post("product_groups", { code: "6.01", name: "CE6 Meio", kind: "synthetic", parent_id: raiz6 }));
    filhoA = criado(await post("product_groups", { code: "6.01.001", name: "CE6 Folha A", parent_id: meio }));
    filhoB = criado(await post("product_groups", { code: "6.02", name: "CE6 Folha B", parent_id: raiz6 }));
    pA = criado(await post("products", produto(filhoA, { description: "CE6 Produto A" })));
    pB = criado(await post("products", produto(filhoB, { description: "CE6 Produto B" })));
    pFora = criado(await post("products", produto(await grupoDoSeed("1.01"), { description: "CE6 Produto Fora" })));
    // painel: produto num FILHO de "Pecuária" (o nome do filho não tem pecu/nutri) e um num grupo RAIZ "Nutrição…"
    const filhoPec = criado(await post("product_groups", { code: "2.04", name: "CE6 Suplemento", parent_id: await grupoDoSeed("2") }));
    pNutriFilho = criado(await post("products", produto(filhoPec, { description: "CE6 Suplemento do filho" })));
    const raizNutri = await grupoDoSeed("7"); // o acervo do CE-1 ganhou o código 7; renomeia para cair no filtro por nome
    await admin.query("update erp.product_groups set name='Nutrição CE6' where id=$1", [raizNutri]);
    pNutriRaiz = criado(await post("products", produto(raizNutri, { description: "CE6 Nutrição da raiz" })));
    for (const p of [pA, pB, pFora, pNutriFilho, pNutriRaiz]) await saldo(p, "10");
  });

  const produtosDoRelatorio = async (query: string) => {
    const r = await get(`/api/reports/stocks_consolidated${query}`);
    expect(r.statusCode, r.body).toBe(200);
    return (j(r).rows as { product: string }[]).map((x) => x.product).filter((x) => x.startsWith("CE6")).sort();
  };

  it("filtro pelo grupo sintético traz TODOS os descendentes (dois níveis); pela folha, só a folha", async () => {
    expect(await produtosDoRelatorio("")).toEqual(["CE6 Nutrição da raiz", "CE6 Produto A", "CE6 Produto B", "CE6 Produto Fora", "CE6 Suplemento do filho"]);
    expect(await produtosDoRelatorio(`?group_id=${raiz6}`)).toEqual(["CE6 Produto A", "CE6 Produto B"]);
    expect(await produtosDoRelatorio(`?group_id=${filhoB}`)).toEqual(["CE6 Produto B"]);
    expect(await produtosDoRelatorio(`?group_id=${filhoA}`)).toEqual(["CE6 Produto A"]);
  });

  it("painel de nutrição acha o produto em grupo FILHO de 'Pecuária' e continua achando o de grupo raiz pelo nome", async () => {
    const r = await get("/api/dashboards/nutrition-stock");
    expect(r.statusCode, r.body).toBe(200);
    const nomes = (j(r).products as { product: string }[]).map((x) => x.product);
    expect(nomes).toContain("CE6 Suplemento do filho");
    expect(nomes).toContain("CE6 Nutrição da raiz");
    expect(nomes).not.toContain("CE6 Produto A");
    expect(nomes).not.toContain("CE6 Produto Fora");
  });
});

describe("CE-7 — importação: árvore de grupos e produto sem categoria/classe", () => {
  const modelo = async (key: string) => {
    const r = await get(`/api/imports/${key}/modelo`);
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((r as unknown as { rawPayload: Buffer }).rawPayload as unknown as ArrayBuffer); return wb;
  };
  const cabecalho = (wb: ExcelJS.Workbook) => { const out: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => out.push(String(c.value))); return out; };
  const preencher = (wb: ExcelJS.Workbook, linhas: Record<string, string>[]) => {
    const cab = cabecalho(wb); const ws = wb.getWorksheet("Dados")!;
    linhas.forEach((l, i) => { for (const [k, v] of Object.entries(l)) { const c = cab.indexOf(k) + 1; if (!c) throw new Error(`coluna ${k} fora do modelo: ${cab.join(" | ")}`); ws.getRow(i + 2).getCell(c).value = v; } });
  };
  const enviar = async (wb: ExcelJS.Workbook, key: string) => {
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    return h.app.inject({ method: "POST", url: `/api/imports/${key}?simular=0`, headers: hdr(), payload: { arquivo_base64: buf.toString("base64") } });
  };
  const listaDe = (wb: ExcelJS.Workbook, chave: string) => { const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; }); const out: string[] = []; for (let i = 2; c && i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v) out.push(String(v)); } return out; };

  it("modelo do grupo: Código, Nome, Analítico, Grupo superior; superior pode ser a linha ANTERIOR do arquivo", async () => {
    const wb = await modelo("product_groups");
    expect(cabecalho(wb)).toEqual(["Código *", "Nome *", "Analítico", "Grupo superior", "Ativo"]);
    preencher(wb, [
      { "Código *": "9", "Nome *": "CE7 Raiz", "Analítico": "Não" },
      { "Código *": "9.01", "Nome *": "CE7 Filho", "Analítico": "Não", "Grupo superior": "9" },
      { "Código *": "9.01.001", "Nome *": "CE7 Neto", "Analítico": "Sim", "Grupo superior": "9.01 - CE7 Filho" },
    ]);
    const r = await enviar(wb, "product_groups");
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)).toMatchObject({ linhas: 3, gravadas: 3, erros: [] });
    const arv = await admin.query<{ code: string; kind: string; pai: string | null }>(
      "select g.code, g.kind, p.code as pai from erp.product_groups g left join erp.product_groups p on p.id=g.parent_id where g.organization_id=$1 and g.name like 'CE7 %' order by g.code", [h.demo.orgId]);
    expect(arv.rows).toEqual([{ code: "9", kind: "synthetic", pai: null }, { code: "9.01", kind: "synthetic", pai: "9" }, { code: "9.01.001", kind: "analytic", pai: "9.01" }]);
  });

  it("modelo do produto sem Categoria/Classe; grupo da lista só analítico; produto em grupo sintético RECUSADO", async () => {
    const wb = await modelo("products");
    const cab = cabecalho(wb);
    expect(cab).toContain("Grupo *");
    expect(cab.some((c) => /^Categoria( \*)?$/.test(c) || /^Classe( \*)?$/.test(c))).toBe(false);
    const grupos = listaDe(wb, "Grupo");
    expect(grupos).toContain("2.01 - Rações e Suplementos");
    expect(grupos).not.toContain("2 - Pecuária");
    const antes = Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.products where organization_id=$1", [h.demo.orgId]))!.n);
    preencher(wb, [
      { "Descrição *": "CE7 Produto OK", "1ª Un. Medida *": "un", "Grupo *": "2.01 - Rações e Suplementos", "Controla estoque": "Não" },
      { "Descrição *": "CE7 Produto Sintético", "1ª Un. Medida *": "un", "Grupo *": "2 - Pecuária", "Controla estoque": "Não" },
    ]);
    const r = await enviar(wb, "products");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r)).toMatchObject({ gravadas: 0, erros: [{ linha: 3, coluna: "Grupo", mensagem: MSG_GRUPO_PRODUTO }] });
    expect(j(r).erros).toHaveLength(1);
    expect(Number((await umaLinha<{ n: string }>("select count(*)::text n from erp.products where organization_id=$1", [h.demo.orgId]))!.n)).toBe(antes);
  });

  it("planilha de produto com o cabeçalho ANTIGO (Categoria/Classe) é recusada mandando baixar o modelo", async () => {
    const wb = await modelo("products");
    const ws = wb.getWorksheet("Dados")!; const n = cabecalho(wb).length;
    ws.getRow(1).getCell(n + 1).value = "Categoria *"; ws.getRow(1).getCell(n + 2).value = "Classe *";
    preencher(wb, [{ "Descrição *": "CE7 Antigo", "1ª Un. Medida *": "un", "Grupo *": "2.01 - Rações e Suplementos", "Controla estoque": "Não" }]);
    const r = await enviar(wb, "products");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).gravadas).toBe(0);
    expect(j(r).erros.map((e: { coluna: string; mensagem: string }) => [e.coluna, e.mensagem])).toEqual([
      ["Categoria", "Coluna desconhecida para Produtos. Baixe o modelo atualizado."],
      ["Classe", "Coluna desconhecida para Produtos. Baixe o modelo atualizado."],
    ]);
  });
});
