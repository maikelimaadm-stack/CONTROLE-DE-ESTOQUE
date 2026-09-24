import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { getResource } from "@agro/domain";
import { cabecalhos } from "../../src/lib/importacao.js";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS FASE 2 — importação PARCIAL: grava as linhas certas e devolve as erradas.
 *
 * Sempre pela rota real (`POST /api/imports/:key?modo=…`) e conferindo no banco. Os títulos das colunas saem do
 * MESMO `cabecalhos()` que gera o modelo (fonte: registry), para o teste seguir o rótulo da tela sem copiá-lo.
 */
let h: Harness; let admin: Db;

interface Erro { linha: number; coluna: string | null; mensagem: string }
interface Resposta { linhas: number; gravadas: number; erros: Erro[]; simulacao: boolean; modo: string; certas: number; com_erro: number; planilha_erros_base64: string | null }
const j = (r: { body: string }) => JSON.parse(r.body) as Resposta;

/** Título da coluna no modelo pelo NOME do campo (com o " *" do obrigatório). */
const titulo = (key: string, campo: string) => { const c = cabecalhos(getResource(key)!).find((x) => x.campo.name === campo); if (!c) throw new Error(`campo ${campo} fora do modelo de ${key}`); return c.titulo; };
const chave = (key: string, campo: string) => titulo(key, campo).replace(/ \*$/, "");

const modelo = async (key: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo`, headers: h.headers() });
  expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
};
const base64 = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64");
const enviarBase64 = (b64: string, key: string, query: string, headers = h.headers({ "content-type": "application/json" })) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}${query}`, headers, payload: { arquivo_base64: b64 } });
const enviar = async (wb: ExcelJS.Workbook, key: string, query: string) => enviarBase64(await base64(wb), key, query);
const cabecalho = (ws: ExcelJS.Worksheet) => { const r: string[] = []; ws.getRow(1).eachCell((c) => r.push(String(c.value))); return r; };
const preencher = (wb: ExcelJS.Workbook, key: string, linha: number, valores: Record<string, ExcelJS.CellValue>) => {
  const ws = wb.getWorksheet("Dados")!; const cab = cabecalho(ws); const row = ws.getRow(linha);
  for (const [campo, v] of Object.entries(valores)) { const n = cab.indexOf(titulo(key, campo)) + 1; if (!n) throw new Error(`coluna de ${campo} ausente`); row.getCell(n).value = v; }
  row.commit();
};

const pessoas = async (prefixo: string) => (await admin.query<{ id: string; name: string; document: string | null; email: string | null }>(
  "select id::text, name, document, email from erp.people where organization_id=$1 and name like $2 order by name", [h.demo.orgId, `${prefixo}%`])).rows;
const contador = async () => Number((await admin.query<{ v: string }>("select ultimo_valor::text v from erp.sequencias_id_global where organization_id=$1", [h.demo.orgId])).rows[0]?.v ?? 0);
const idGlobal = async (id: string) => (await admin.query<{ v: string }>("select id_global::text v from erp.registros_globais where organization_id=$1 and id_entidade=$2", [h.demo.orgId, id])).rows[0]?.v ?? null;

/**
 * CPF VÁLIDO com zero à esquerda a partir de 9 dígitos (desde a Fase 4 o documento é conferido pela regra única
 * de `@agro/domain`; o zero à esquerda continua sendo o que a planilha precisa preservar).
 */
const cpf = (base9: string) => { const d = base9.split("").map(Number); const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += d[i]! * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; d.push(dv(9)); d.push(dv(10)); return d.join(""); };
const docMisto = (d: string, n: number) => cpf(`00${d}0000${n}`);
/** Cinco pessoas (tipo Cliente — pelo menos um tipo, Fase 4): 2, 4 e 6 certas; 3 (e-mail inválido) e 5 (tipo de pessoa fora da lista) erradas. */
const arquivoMisto = async (p: string, d: string) => {
  const wb = await modelo("people");
  preencher(wb, "people", 2, { name: `${p} A`, document: docMisto(d, 1), is_client: "Sim" });
  preencher(wb, "people", 3, { name: `${p} B`, document: docMisto(d, 2), email: "nao-e-email", zip_code: "01234-000", is_client: "Sim" });
  preencher(wb, "people", 4, { name: `${p} C`, is_client: "Sim" });
  preencher(wb, "people", 5, { name: `${p} D`, document: docMisto(d, 3), person_type: "Marciano", is_client: "Sim" });
  preencher(wb, "people", 6, { name: `${p} E`, is_client: "Sim" });
  return wb;
};

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("modo parcial", () => {
  it("IM-1: 3 certas + 2 erradas → 201, 3 gravadas na ordem do arquivo, as 2 na lista, ID Global só nas 3; a prévia parcial diz exatamente isso sem gravar", async () => {
    const p = "IM1 Pessoa";
    const wb = await arquivoMisto(p, "11");
    const antes = await contador();

    const previa = await enviar(wb, "people", "?simular=1&modo=parcial");
    expect(previa.statusCode, previa.body).toBe(200);
    expect(j(previa)).toMatchObject({ linhas: 5, gravadas: 0, certas: 3, com_erro: 2, simulacao: true, modo: "parcial" });
    expect(await pessoas(p), "a prévia não grava").toEqual([]);
    expect(await contador(), "a prévia não reserva ID Global").toBe(antes);

    const r = await enviar(wb, "people", "?modo=parcial");
    expect(r.statusCode, r.body).toBe(201);
    const res = j(r);
    expect(res).toMatchObject({ linhas: 5, gravadas: 3, certas: 3, com_erro: 2, simulacao: false, modo: "parcial" });
    expect([...new Set(res.erros.map((e) => e.linha))]).toEqual([3, 5]);
    expect(res.erros.find((e) => e.linha === 3)!.coluna).toBe(chave("people", "email"));
    // opção inválida mostra as opções
    expect(res.erros.find((e) => e.linha === 5)!.mensagem).toMatch(/^"Marciano" não é uma opção válida\. Opções: .+\.$/);
    const gravadas = await pessoas(p);
    expect(gravadas.map((x) => x.name)).toEqual([`${p} A`, `${p} C`, `${p} E`]);
    const ids = await Promise.all(gravadas.map((x) => idGlobal(x.id)));
    expect(ids.every((x) => x !== null)).toBe(true);
    const n = ids.map(Number);
    expect(n[0]!).toBeLessThan(n[1]!); expect(n[1]!).toBeLessThan(n[2]!);
    expect(await contador(), "o contador andou exatamente 3").toBe(antes + 3);
  });

  it("IM-2: linha que cita uma linha anterior com erro → 'depende da linha N, que tem erro' (em cadeia); superior inexistente diz o que fazer e sugere com UMA correspondência", async () => {
    const livres = await admin.query("select 1 from erp.financial_categories where organization_id=$1 and (code like '6%' or name like 'IM2 %')", [h.demo.orgId]);
    expect(livres.rowCount, "premissa: códigos 6.* livres").toBe(0);
    const wb = await modelo("financial_categories");
    const k = "financial_categories";
    preencher(wb, k, 2, { code: "6", name: "IM2 Raiz", nature: "Natureza Inexistente", kind: "Não" });
    preencher(wb, k, 3, { code: "6.01", name: "IM2 Filha", nature: "Receita", kind: "Não", parent_id: "6 - IM2 Raiz" });
    preencher(wb, k, 4, { code: "6.01.001", name: "IM2 Neta", nature: "Receita", kind: "Sim", parent_id: "6.01 - IM2 Filha" });
    const r = await enviar(wb, k, "?modo=parcial");
    expect(r.statusCode, r.body).toBe(422);
    const erros = j(r).erros;
    const superior = chave(k, "parent_id");
    expect(erros.find((e) => e.linha === 3)).toEqual({ linha: 3, coluna: superior, mensagem: "\"6 - IM2 Raiz\" depende da linha 2, que tem erro. Corrija a linha 2 e importe as duas juntas." });
    expect(erros.find((e) => e.linha === 4)).toEqual({ linha: 4, coluna: superior, mensagem: "\"6.01 - IM2 Filha\" depende da linha 3, que tem erro. Corrija a linha 3 e importe as duas juntas." });
    expect((await admin.query("select 1 from erp.financial_categories where organization_id=$1 and name like 'IM2 %'", [h.demo.orgId])).rowCount).toBe(0);

    // superior inexistente: "inclua a linha do superior acima ou cadastre-o antes" + "você quis dizer" (maiúsculas e acentos ignorados)
    const criado = await h.app.inject({ method: "POST", url: "/api/resources/addressings", headers: h.headers({ "content-type": "application/json" }), payload: { description: "Galpão Sugestão IM2" } });
    expect(criado.statusCode, criado.body).toBe(201);
    const wa = await modelo("addressings");
    preencher(wa, "addressings", 2, { description: "IM2 Gaveta", parent_id: "galpao sugestao im2" });
    preencher(wa, "addressings", 3, { description: "IM2 Prateleira", parent_id: "Galpão Que Não Existe IM2" });
    const ra = await enviar(wa, "addressings", "?simular=1&modo=parcial");
    expect(ra.statusCode, ra.body).toBe(422);
    const pai = chave("addressings", "parent_id");
    const enderecos = getResource("addressings")!.labelPlural;
    expect(j(ra).erros).toEqual([
      { linha: 2, coluna: pai, mensagem: `"galpao sugestao im2\" não encontrado em ${enderecos}. Você quis dizer \"Galpão Sugestão IM2\"? Inclua a linha do superior acima desta ou cadastre-o antes.` },
      { linha: 3, coluna: pai, mensagem: `"Galpão Que Não Existe IM2\" não encontrado em ${enderecos}. Inclua a linha do superior acima desta ou cadastre-o antes.` },
    ]);
  });

  it("IM-3: nenhuma linha certa no modo parcial → 422, nada gravado, a planilha de erros volta", async () => {
    const p = "IM3 Pessoa";
    const wb = await modelo("people");
    preencher(wb, "people", 2, { name: `${p} A`, email: "x" });
    preencher(wb, "people", 3, { name: `${p} B`, person_type: "Nenhum" });
    const antes = await contador();
    const r = await enviar(wb, "people", "?modo=parcial");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r)).toMatchObject({ linhas: 2, gravadas: 0, certas: 0, com_erro: 2, modo: "parcial" });
    expect(j(r).planilha_erros_base64).toBeTruthy();
    expect(await pessoas(p)).toEqual([]);
    expect(await contador()).toBe(antes);
  });
});

describe("planilha de erros", () => {
  const lerPlanilha = async (b64: string) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(b64, "base64") as unknown as ArrayBuffer); return wb; };

  it("IM-4: só as linhas erradas, colunas do modelo + 'Erros' no fim, valores como vieram, texto com zero à esquerda preservado; também na prévia", async () => {
    const wb = await arquivoMisto("IM4 Pessoa", "44");
    const modeloCab = cabecalho(wb.getWorksheet("Dados")!);
    const previa = await enviar(wb, "people", "?simular=1&modo=parcial");
    expect(j(previa).planilha_erros_base64, "a prévia também devolve a planilha").toBeTruthy();
    const r = await enviar(wb, "people", "?modo=parcial");
    expect(r.statusCode, r.body).toBe(201);
    const erros = await lerPlanilha(j(r).planilha_erros_base64!);
    const ws = erros.getWorksheet("Dados")!;
    const cab = cabecalho(ws);
    expect(cab).toEqual([...modeloCab, "Erros"]);
    expect(ws.actualRowCount, "cabeçalho + as 2 erradas").toBe(3);
    const col = (campo: string) => cab.indexOf(titulo("people", campo)) + 1;
    const l2 = ws.getRow(2); const l3 = ws.getRow(3);
    expect(l2.getCell(col("name")).value).toBe("IM4 Pessoa B");
    expect(l2.getCell(col("document")).value, "zero à esquerda").toBe(docMisto("44", 2));
    expect(l2.getCell(col("document")).numFmt).toBe("@");
    expect(l2.getCell(col("zip_code")).value).toBe("01234-000");
    expect(l2.getCell(col("email")).value, "o valor errado, como o usuário mandou").toBe("nao-e-email");
    expect(String(l2.getCell(cab.length).value)).toContain(`${chave("people", "email")}: `);
    expect(l3.getCell(col("name")).value).toBe("IM4 Pessoa D");
    expect(l3.getCell(col("document")).value).toBe(docMisto("44", 3));
    expect(l3.getCell(col("person_type")).value).toBe("Marciano");
    expect(String(l3.getCell(cab.length).value)).toContain("não é uma opção válida");
  });

  it("IM-5: a planilha de erros corrigida volta pela mesma importação: grava, e a coluna 'Erros' é ignorada", async () => {
    const p = "IM5 Pessoa";
    const r = await enviar(await arquivoMisto(p, "55"), "people", "?modo=parcial");
    expect(r.statusCode, r.body).toBe(201);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(j(r).planilha_erros_base64!, "base64") as unknown as ArrayBuffer);
    preencher(wb, "people", 2, { email: "ok@exemplo.com.br" });
    preencher(wb, "people", 3, { person_type: null });
    const again = await enviar(wb, "people", "");
    expect(again.statusCode, again.body).toBe(201);
    expect(j(again)).toMatchObject({ linhas: 2, gravadas: 2, erros: [], modo: "tudo" });
    const todas = await pessoas(p);
    expect(todas.map((x) => x.name)).toEqual([`${p} A`, `${p} B`, `${p} C`, `${p} D`, `${p} E`]);
    expect(todas.find((x) => x.name === `${p} B`)).toMatchObject({ document: docMisto("55", 2), email: "ok@exemplo.com.br" });
  });
});

describe("modo tudo (o de antes) e porta", () => {
  it("IM-6: sem modo = tudo: qualquer erro → 422 e nada gravado, mesmo corpo com e sem `modo=tudo`; modo desconhecido → 422", async () => {
    const p = "IM6 Pessoa";
    const wb = await arquivoMisto(p, "66");
    const antes = await contador();
    const semModo = await enviar(wb, "people", "");
    const tudo = await enviar(wb, "people", "?modo=tudo");
    for (const r of [semModo, tudo]) {
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r)).toMatchObject({ linhas: 5, gravadas: 0, certas: 3, com_erro: 2, simulacao: false, modo: "tudo" });
    }
    // mesmo corpo; a planilha de erros é comparada pelo CONTEÚDO — o zip carrega a hora da geração
    const { planilha_erros_base64: xSem, ...restoSem } = j(semModo);
    const { planilha_erros_base64: xTudo, ...restoTudo } = j(tudo);
    expect(restoSem).toEqual(restoTudo);
    const celulas = async (b64: string | null) => {
      expect(b64).toBeTruthy();
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(b64!, "base64") as unknown as ArrayBuffer);
      return wb.worksheets.map((ws) => ({ nome: ws.name, linhas: ws.getSheetValues() }));
    };
    const [cSem, cTudo] = [await celulas(xSem), await celulas(xTudo)];
    expect(cSem.flatMap((w) => w.linhas).filter(Boolean).length, "a planilha tem linhas").toBeGreaterThan(1);
    expect(cSem).toEqual(cTudo);
    expect(await pessoas(p)).toEqual([]);
    expect(await contador()).toBe(antes);
    const invalido = await enviar(wb, "people", "?modo=metade");
    expect(invalido.statusCode, invalido.body).toBe(422);
    // sem erro, sem modo: grava tudo, como antes
    const ok = await modelo("people");
    preencher(ok, "people", 2, { name: `${p} Só`, is_client: "Sim" });
    const g = await enviar(ok, "people", "");
    expect(g.statusCode, g.body).toBe(201);
    expect(j(g)).toMatchObject({ linhas: 1, gravadas: 1, erros: [], planilha_erros_base64: null });
  });

  it("IM-7: sem permissão de criar → 403 antes de abrir o arquivo, também no modo parcial e com modo inválido", async () => {
    const lixo = Buffer.from("não é xlsx").toString("base64");
    for (const q of ["?modo=parcial", "?simular=1&modo=parcial", "?modo=metade"]) {
      const r = await enviarBase64(lixo, "financial_categories", q, { ...h.opHeaders(), "content-type": "application/json" });
      expect(r.statusCode, `${q}: ${r.body}`).toBe(403);
    }
    // controle: com permissão, o mesmo lixo chega a ser aberto e é recusado como arquivo
    const r = await enviarBase64(lixo, "financial_categories", "?modo=parcial");
    expect(r.statusCode).toBe(422);
    expect(j(r).erros[0]!.mensagem).toMatch(/Arquivo inválido/);
  });
});
