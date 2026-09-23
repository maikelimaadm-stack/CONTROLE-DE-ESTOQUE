import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Importação de cadastros por modelo XLSX: o modelo sai do registry com obrigatórios destacados e listas
 * dos cadastros existentes; a importação confere tudo no servidor e grava tudo ou nada.
 */
let h: Harness; let admin: Db;
const j = (r: { body: string }) => JSON.parse(r.body);
const modelo = async (key: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo`, headers: h.headers() });
  expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
};
const importar = async (wb: ExcelJS.Workbook, key: string, simular = false, headers = h.headers()) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}?simular=${simular ? 1 : 0}`, headers: { ...headers, "content-type": "application/json" }, payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
const cabecalho = (wb: ExcelJS.Workbook) => { const r: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => r.push(String(c.value))); return r; };
const col = (wb: ExcelJS.Workbook, titulo: string) => cabecalho(wb).indexOf(titulo) + 1;
const listaDe = (wb: ExcelJS.Workbook, chave: string) => { const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; }); const out: string[] = []; for (let i = 2; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v) out.push(String(v)); } return out; };
const contar = async (tabela: string) => Number((await admin.query<{ n: string }>(`select count(*) n from erp.${tabela} where organization_id=$1`, [h.demo.orgId])).rows[0]!.n);

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("modelo", () => {
  it("I1: produtos — todos os campos editáveis do formulário, obrigatórios com * e destacados, listas dos cadastros existentes", async () => {
    const wb = await modelo("products");
    const cab = cabecalho(wb);
    expect(cab).toContain("Descrição *"); expect(cab).toContain("Grupo *"); expect(cab).toContain("1ª Un. Medida *");
    expect(cab).toContain("Controla estoque"); expect(cab).not.toContain("Código"); expect(cab).not.toContain("Custo médio (calculado)");
    const obrig = wb.getWorksheet("Dados")!.getRow(1).getCell(col(wb, "Grupo *"));
    expect((obrig.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFC62828");
    expect(String(obrig.note)).toMatch(/^OBRIGATÓRIO/);
    const grupos = (await admin.query<{ name: string }>("select name from erp.product_groups where organization_id=$1 and is_active", [h.demo.orgId])).rows.map((r) => r.name).sort();
    expect(grupos.length).toBeGreaterThan(2);
    expect(listaDe(wb, "Grupo").sort()).toEqual(grupos);
    expect(listaDe(wb, "Controla estoque")).toEqual(["Sim", "Não"]);
    expect(wb.getWorksheet("Instruções")).toBeTruthy();
  });
  it("I2: cadastro com código mostra 'código - nome' na lista; cadastro sem importação → 404; sem permissão de criar → 403", async () => {
    const wb = await modelo("products");
    expect(listaDe(wb, "Categoria financeira (custo)")).toContain("2.02.001 - Nutrição Animal");
    expect((await h.app.inject({ method: "GET", url: "/api/imports/hr_events/modelo", headers: h.headers() })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: "/api/imports/financial_categories/modelo", headers: h.opHeaders() })).statusCode).toBe(403);
  });
});

describe("importação", () => {
  const produtoValido = (wb: ExcelJS.Workbook, linha: number, desc: string) => {
    const ws = wb.getWorksheet("Dados")!; const row = ws.getRow(linha);
    const pega = (chave: string) => listaDe(wb, chave)[0]!;
    row.getCell(col(wb, "Descrição *")).value = desc;
    for (const t of ["1ª Un. Medida *", "Grupo *", "Categoria *", "Classe *"]) row.getCell(col(wb, t)).value = pega(t.replace(" *", ""));
    row.getCell(col(wb, "Controla estoque")).value = "Não";
    row.getCell(col(wb, "Estoque mínimo")).value = "1.234,5";
    row.commit();
  };

  it("I3: prévia não grava; importação grava todas as linhas convertendo Sim/Não, listas e número com vírgula", async () => {
    const wb = await modelo("products");
    produtoValido(wb, 2, "Imp Produto A"); produtoValido(wb, 3, "Imp Produto B");
    const antes = await contar("products");
    const p = await importar(wb, "products", true);
    expect(p.statusCode, p.body).toBe(200); expect(j(p)).toMatchObject({ linhas: 2, gravadas: 0, erros: [], simulacao: true });
    expect(await contar("products")).toBe(antes);
    const r = await importar(wb, "products");
    expect(r.statusCode, r.body).toBe(201); expect(j(r)).toMatchObject({ linhas: 2, gravadas: 2, erros: [] });
    const a = (await admin.query("select control_stock, min_stock, code from erp.products where organization_id=$1 and description='Imp Produto A'", [h.demo.orgId])).rows[0] as { control_stock: boolean; min_stock: string; code: string };
    expect(a.control_stock).toBe(false); expect(Number(a.min_stock)).toBe(1234.5); expect(a.code).toMatch(/^\d{5}$/);
  });

  it("I4: obrigatório vazio, valor fora da lista, Sim/Não inválido → erros por linha e coluna; NADA gravado (nem a linha boa)", async () => {
    const wb = await modelo("products");
    produtoValido(wb, 2, "Imp Boa");
    produtoValido(wb, 3, "Imp Ruim"); const ws = wb.getWorksheet("Dados")!;
    ws.getRow(3).getCell(col(wb, "Grupo *")).value = "Grupo Que Não Existe";
    ws.getRow(3).getCell(col(wb, "Controla estoque")).value = "talvez";
    ws.getRow(4).getCell(col(wb, "Estoque mínimo")).value = 5; // linha só com campo opcional: faltam obrigatórios
    const antes = await contar("products");
    const r = await importar(wb, "products");
    expect(r.statusCode).toBe(422);
    const erros = j(r).erros as { linha: number; coluna: string; mensagem: string }[];
    expect(erros).toEqual(expect.arrayContaining([
      { linha: 3, coluna: "Grupo", mensagem: '"Grupo Que Não Existe" não existe no cadastro. Use um valor da lista.' },
      { linha: 3, coluna: "Controla estoque", mensagem: "Use Sim ou Não." },
      { linha: 4, coluna: "Descrição", mensagem: "Obrigatório." },
    ]));
    expect(j(r).gravadas).toBe(0);
    expect(await contar("products")).toBe(antes);
    expect((await admin.query("select 1 from erp.products where description='Imp Boa'")).rowCount).toBe(0);
  });

  it("I5: regras do cadastro valem na importação (árvore: antecessor da própria planilha, código conferido)", async () => {
    const wb = await modelo("financial_categories"); const ws = wb.getWorksheet("Dados")!;
    const linha = (n: number, v: Record<string, string>) => { const row = ws.getRow(n); for (const [k, x] of Object.entries(v)) row.getCell(col(wb, k)).value = x; row.commit(); };
    linha(2, { "Código *": "7", "Descrição *": "Imp Raiz", "Natureza *": "Receita", "Classe": "Sintética" });
    linha(3, { "Código *": "7.01", "Descrição *": "Imp Filha", "Natureza *": "Receita", "Classe": "Analítica", "Antecessor": "7" });
    expect(cabecalho(wb)).toEqual(expect.arrayContaining(["Código *", "Descrição *", "Natureza *", "Antecessor"]));
    const ok = await importar(wb, "financial_categories");
    expect(ok.statusCode, ok.body).toBe(201); expect(j(ok).gravadas).toBe(2);
    const filha = (await admin.query<{ pai: string }>("select p.code pai from erp.financial_categories c join erp.financial_categories p on p.id=c.parent_id where c.organization_id=$1 and c.code='7.01'", [h.demo.orgId])).rows[0];
    expect(filha).toEqual({ pai: "7" });
    // código fora do prefixo do antecessor → erro da regra da árvore, na coluna Código
    const wb2 = await modelo("financial_categories"); const ws2 = wb2.getWorksheet("Dados")!;
    const r2 = ws2.getRow(2); for (const [k, x] of Object.entries({ "Código *": "8.01", "Descrição *": "X", "Natureza *": "Receita", "Antecessor": "7 - Imp Raiz" })) r2.getCell(col(wb2, k)).value = x; r2.commit();
    const bad = await importar(wb2, "financial_categories");
    expect(bad.statusCode).toBe(422);
    expect(j(bad).erros[0]).toMatchObject({ linha: 2, coluna: "Código", mensagem: expect.stringMatching(/antecessor/) });
  });

  it("I6: código repetido é recusado (importar nunca atualiza); coluna desconhecida é recusada", async () => {
    const wb = await modelo("financial_categories"); const ws = wb.getWorksheet("Dados")!;
    const r = ws.getRow(2); for (const [k, x] of Object.entries({ "Código *": "1", "Descrição *": "Sobrescreve", "Natureza *": "Receita" })) r.getCell(col(wb, k)).value = x; r.commit();
    const dup = await importar(wb, "financial_categories");
    expect(dup.statusCode).toBe(422); expect(j(dup).erros[0]).toMatchObject({ linha: 2 });
    expect((await admin.query("select name from erp.financial_categories where organization_id=$1 and code='1'", [h.demo.orgId])).rows[0]).toEqual({ name: "RECEITAS" });
    ws.getRow(1).getCell(cabecalho(wb).length + 1).value = "Coluna Inventada"; ws.getRow(1).commit();
    const col2 = await importar(wb, "financial_categories");
    expect(col2.statusCode).toBe(422); expect(j(col2).erros[0]).toMatchObject({ linha: 1, coluna: "Coluna Inventada" });
  });

  it("I7: sem permissão de criar → 403; arquivo inválido → 422 sem gravar", async () => {
    const wb = await modelo("financial_categories");
    expect((await importar(wb, "financial_categories", false, h.opHeaders())).statusCode).toBe(403);
    const lixo = await h.app.inject({ method: "POST", url: "/api/imports/financial_categories", headers: h.headers({ "content-type": "application/json" }), payload: { arquivo_base64: Buffer.from("não é xlsx").toString("base64") } });
    expect(lixo.statusCode).toBe(422); expect(j(lixo).erros[0].mensagem).toMatch(/Arquivo inválido/);
  });
});
