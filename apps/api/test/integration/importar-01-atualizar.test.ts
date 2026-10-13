import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { getResource } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";
import { MSG_NAO_GRAVOU, MSG_PRESENTE_VAZIA, MSG_SEM_CODIGO, atualizarPlanilha, cabecalhos, casarPorCodigo, lerPlanilha, type PortaDeEdicao } from "../../src/lib/importacao.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * IMPORTAR-01 (decisão 317) — A PLANILHA ATUALIZA, PELA PORTA DE EDIÇÃO DA TELA.
 *
 * Tudo pela rota real (`/api/imports/:key?acao=atualizar`, sob a RLS do papel da aplicação); a testemunha é o BANCO,
 * lido por superusuário: a LINHA INTEIRA (`to_jsonb`) antes e depois, a versão física (`xmin`), as linhas de
 * `erp.audit_logs` e as contagens. Os produtos de cada caso nascem pela porta da tela (`POST /api/resources/products`).
 */
let h: Harness; let admin: Db;
let GRUPO = ""; let UNIDADE = "";

interface Erro { linha: number; coluna: string | null; mensagem: string }
interface Resposta {
  linhas: number; gravadas: number; erros: Erro[]; simulacao: boolean; modo: string; certas: number; com_erro: number; planilha_erros_base64: string | null;
  acao?: string; casaram?: number; nao_casaram?: number; sem_alteracao?: number; alteracoes?: { linha: number; codigo: string; colunas: string[] }[];
  error?: { code: string; message: string; details?: unknown };
}
const j = (r: { body: string }) => JSON.parse(r.body) as Resposta;
const JSON_HDR = () => h.headers({ "content-type": "application/json" });
const b64 = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64");

/** Planilha montada à mão com SÓ as colunas dadas (a forma do ATUALIZAR: apagar as colunas que não mudam). */
function planilha(titulos: string[], linhas: ExcelJS.CellValue[][]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Dados");
  ws.addRow(titulos); for (const l of linhas) ws.addRow(l);
  ws.getColumn(1).numFmt = "@";
  return wb;
}
const enviar = async (wb: ExcelJS.Workbook, key: string, consulta: string, headers = JSON_HDR()) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}${consulta}`, headers, payload: { arquivo_base64: await b64(wb) } });
const modelo = (key: string, consulta: string, headers = h.headers()) => h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo${consulta}`, headers });
const abrir = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb; };
const titulosDe = (wb: ExcelJS.Workbook) => { const t: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => t.push(String(c.value))); return t; };
const listaDe = (wb: ExcelJS.Workbook, chave: string) => {
  const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; });
  if (!c) throw new Error(`lista "${chave}" fora da aba Listas`);
  const out: string[] = []; for (let i = 2; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v) out.push(String(v)); } return out;
};

/** Produto pela porta da TELA, com controle de estoque desligado (sem natureza obrigatória). */
async function criarProduto(descricao: string, extra: Record<string, unknown> = {}) {
  const r = await h.app.inject({ method: "POST", url: "/api/resources/products", headers: JSON_HDR(), payload: { description: descricao, group_id: GRUPO, measurement_id: UNIDADE, control_stock: false, marca: "Marca Antiga", ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  const p = JSON.parse(r.body) as { id: string; code: string };
  expect(p.code, "premissa: o produto nasce com código").toMatch(/^\d{5}$/);
  return p;
}
/** A LINHA INTEIRA do banco (sem `updated_at`, que o gatilho muda a cada UPDATE) e a versão física. */
const linha = async (tabela: string, id: string) => (await admin.query<{ j: Record<string, unknown>; x: string }>(`select to_jsonb(t) - 'updated_at' as j, xmin::text as x from erp.${tabela} t where id=$1`, [id])).rows[0]!;
const auditoria = async (entidade: string, id: string) => (await admin.query<{ action: string; user_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
  "select action, user_id::text, before, after from erp.audit_logs where organization_id=$1 and entity=$2 and entity_id=$3 order by id", [h.demo.orgId, entidade, id])).rows;
/** As chaves que o UPDATE auditado mudou (sem o `updated_at` do gatilho). */
const mudouNaAuditoria = (a: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) =>
  Object.keys(a.after ?? {}).filter((k) => k !== "updated_at" && JSON.stringify(a.before?.[k]) !== JSON.stringify(a.after?.[k])).sort();
const contar = async (tabela: string) => Number((await admin.query<{ n: string }>(`select count(*) n from erp.${tabela} where organization_id=$1`, [h.demo.orgId])).rows[0]!.n);
const contarAuditoria = async () => Number((await admin.query<{ n: string }>("select count(*) n from erp.audit_logs where organization_id=$1", [h.demo.orgId])).rows[0]!.n);

/** Membro com um perfil de permissões dadas (senha de fixture do repositório). */
async function membro(nome: string, email: string, permissoes: string[]) {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: nome, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Acesso@12345", role_id: (JSON.parse(papel.body) as { id: string }).id, escopos_empresas: [] } });
  expect(v.statusCode, v.body).toBe(201);
  const l = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Acesso@12345" } });
  expect(l.statusCode, l.body).toBe(200);
  return { authorization: `Bearer ${(JSON.parse(l.body) as { token: string }).token}`, "x-org-id": h.demo.orgId, "content-type": "application/json" };
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 3 });
  GRUPO = (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!.id;
  UNIDADE = (await admin.query<{ id: string }>("select measurement_id id from erp.products where organization_id=$1 and code='00001'", [h.demo.orgId])).rows[0]!.id;
}, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("o modelo do ATUALIZAR e o contrato", () => {
  it("IMP01-A1: o modelo do ATUALIZAR traz o Código primeiro (vermelho, a chave) e as colunas do formulário sem obrigatório; só com `.edit`; arquivo próprio", async () => {
    const r = await modelo("products", "?acao=atualizar");
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="modelo-products-atualizar.xlsx"');
    const wb = await abrir(r.rawPayload);
    const t = titulosDe(wb);
    // a premissa: o modelo do CRIAR NÃO tem Código (só leitura na tela) — é o ATUALIZAR que o acrescenta
    const doCriar = cabecalhos(getResource("products")!).map((c) => c.titulo);
    expect(doCriar.filter((x) => x === "Código" || x === "Código *"), "premissa: no CRIAR o Produto não tem a coluna Código").toEqual([]);
    expect(t[0]).toBe("Código *");
    expect(t.slice(1), "as mesmas colunas do CRIAR, nenhuma obrigatória").toEqual(doCriar.map((x) => x.replace(/ \*$/, "")));
    const cab = wb.getWorksheet("Dados")!.getRow(1).getCell(1);
    expect((cab.fill as ExcelJS.FillPattern).fgColor?.argb, "a chave em vermelho").toBe("FFC62828");
    expect(typeof cab.note === "string" ? cab.note : (cab.note?.texts ?? []).map((x) => x.text).join("")).toContain("CHAVE");
    expect(wb.getWorksheet("Dados")!.getColumn(1).numFmt, "o código como Texto (zeros à esquerda)").toBe("@");
    const instr = wb.getWorksheet("Instruções")!;
    expect(instr.getCell("A1").value).toBe("Modelo de atualização — Produtos");
    const textos = Array.from({ length: instr.rowCount }, (_, i) => String(instr.getCell(`A${i + 1}`).value ?? "")).join("\n");
    expect(textos).toContain("APAGUE as colunas que não quer mudar");
    expect(textos).toContain("Célula VAZIA numa coluna presente RECUSA a linha");
    expect(textos).toContain("atualizar nunca cria registro");
    // a árvore: o Código já é coluna (editável) — continua a primeira, e é a chave
    const contas = await abrir((await modelo("chart_accounts", "?acao=atualizar")).rawPayload);
    expect(titulosDe(contas)).toEqual(["Código *", "Descrição", "Condição", "Analítica", "Tipo", "Conta superior", "Ativo"]);
  });

  it("IMP01-A2: contrato — ação fora da lista ⇒ 422; cadastro sem código ⇒ 422; consulta do modelo com chave desconhecida ⇒ 422; tudo antes de abrir o arquivo", async () => {
    const lixo = planilha(["Código"], [["x"]]);
    const fora = await enviar(lixo, "products", "?acao=apagar");
    expect(fora.statusCode, fora.body).toBe(422);
    expect(j(fora).error).toMatchObject({ code: "VALIDATION_ERROR", message: "acao: Opção inválida" });
    const semCodigo = await enviar(lixo, "measurement_units", "?simular=1&acao=atualizar");
    expect(semCodigo.statusCode, semCodigo.body).toBe(422);
    expect(j(semCodigo).error).toMatchObject({ code: "VALIDATION_ERROR", message: MSG_SEM_CODIGO });
    // arquivo que nem é XLSX: a recusa do contrato vem antes da leitura (senão seria "Arquivo inválido")
    const naoXlsx = await h.app.inject({ method: "POST", url: "/api/imports/warehouses?acao=atualizar", headers: JSON_HDR(), payload: { arquivo_base64: "AAAA" } });
    expect(j(naoXlsx).error?.message).toBe(MSG_SEM_CODIGO);
    expect((await modelo("measurement_units", "?acao=atualizar")).statusCode).toBe(422);
    const chave = await modelo("products", "?acao=atualizar&lixo=1");
    expect(chave.statusCode, chave.body).toBe(422);
    expect((await modelo("products", "?acao=criar")).statusCode, "`acao=criar` é o modelo de sempre").toBe(200);
    // os 6 cadastros com código aceitam; os 4 sem código, não (C7)
    const aceitos: string[] = []; const recusados: string[] = [];
    for (const key of ["cost_centers", "product_groups", "measurement_units", "addressings", "warehouses", "cultivations", "products", "financial_categories", "chart_accounts", "people"]) {
      const m = await modelo(key, "?acao=atualizar");
      (m.statusCode === 200 ? aceitos : recusados).push(key);
    }
    expect(aceitos).toEqual(["cost_centers", "product_groups", "products", "financial_categories", "chart_accounts", "people"]);
    expect(recusados).toEqual(["measurement_units", "addressings", "warehouses", "cultivations"]);
  });

  it("IMP01-A3: só a coluna Código ⇒ 422 'Nenhuma coluna para atualizar'; sem a coluna Código ⇒ 422 'Coluna obrigatória ausente'", async () => {
    const p = await criarProduto("IMP01 A3 Produto");
    const so = await enviar(planilha(["Código"], [[p.code]]), "products", "?simular=1&acao=atualizar");
    expect(so.statusCode, so.body).toBe(422);
    expect(j(so).erros).toEqual([{ linha: 1, coluna: null, mensagem: "Nenhuma coluna para atualizar: deixe no arquivo a coluna Código e só as colunas que vão mudar." }]);
    const sem = await enviar(planilha(["Marca"], [["X"]]), "products", "?simular=1&acao=atualizar");
    expect(sem.statusCode, sem.body).toBe(422);
    expect(j(sem).erros).toEqual([{ linha: 1, coluna: "Código", mensagem: "Coluna obrigatória ausente no arquivo." }]);
  });
});

describe("a porta de edição da tela", () => {
  it("IMP01-A4: ATUALIZAR pela porta = a MESMA auditoria da tela (lado a lado com um PUT), e o Local de estoque padrão preenchido pela planilha", async () => {
    const pPlanilha = await criarProduto("IMP01 A4 Pela Planilha");
    const pTela = await criarProduto("IMP01 A4 Pela Tela");
    const wbModelo = await abrir((await modelo("products", "?acao=atualizar")).rawPayload);
    const local = listaDe(wbModelo, "Local de estoque padrão")[0]!;
    const localId = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and deleted_at is null and is_active", [h.demo.orgId])).rows;
    const r = await enviar(planilha(["Código", "Marca", "Estoque mínimo", "Local de estoque padrão"], [[pPlanilha.code, "Marca Nova", "7,5", local]]), "products", "?acao=atualizar");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ acao: "atualizar", linhas: 1, gravadas: 1, certas: 1, com_erro: 0, casaram: 1, nao_casaram: 0, sem_alteracao: 0, erros: [] });
    expect(j(r).alteracoes).toEqual([{ linha: 2, codigo: pPlanilha.code, colunas: ["Marca", "Estoque mínimo", "Local de estoque padrão"] }]);
    const gravado = (await linha("products", pPlanilha.id)).j;
    expect([gravado["marca"], gravado["min_stock"]]).toEqual(["Marca Nova", 7.5]);
    expect(localId.map((x) => x.id), "o local gravado é um local desta organização").toContain(gravado["default_warehouse_id"]);
    // a TELA: o mesmo pedido pela PUT da ficha
    const put = await h.app.inject({ method: "PUT", url: `/api/resources/products/${pTela.id}`, headers: JSON_HDR(), payload: { marca: "Marca Nova", min_stock: "7.5", default_warehouse_id: gravado["default_warehouse_id"] } });
    expect(put.statusCode, put.body).toBe(200);
    const [aPlanilha, aTela] = [await auditoria("products", pPlanilha.id), await auditoria("products", pTela.id)];
    expect(aPlanilha.map((a) => a.action), "criar + UMA atualização").toEqual(["create", "update"]);
    expect(aTela.map((a) => a.action)).toEqual(["create", "update"]);
    const lado = (a: typeof aPlanilha[number]) => ({ action: a.action, user_id: a.user_id, mudou: mudouNaAuditoria(a), depois: Object.fromEntries(mudouNaAuditoria(a).map((k) => [k, a.after?.[k]])) });
    expect(lado(aPlanilha[1]!), "a linha de auditoria da planilha = a da tela (quem, ação, o que mudou e para quê)").toEqual(lado(aTela[1]!));
    expect(lado(aPlanilha[1]!).mudou).toEqual(["default_warehouse_id", "marca", "min_stock"]);
    expect(aPlanilha[1]!.user_id).toBe((await admin.query<{ id: string }>("select id::text id from erp.users where email=$1", [h.demo.adminEmail])).rows[0]!.id);
  });

  it("IMP01-A5: as regras do cadastro valem como na tela — CEST normalizado pela regra do produto, CEST inválido e descrição longa recusados com a mensagem da tela", async () => {
    const p = await criarProduto("IMP01 A5 Produto");
    const ok = await enviar(planilha(["Código", "CEST"], [[p.code, "28.038.00"]]), "products", "?acao=atualizar");
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await linha("products", p.id)).j["cest"], "a regra do produto (conferirProduto) gravou só os dígitos").toBe("2803800");
    const ruim = await enviar(planilha(["Código", "CEST", "Descrição"], [[p.code, "123", "IMP01 A5 nova"], [p.code === "00001" ? "00002" : "00001", "1234567", "x".repeat(121)]]), "products", "?acao=atualizar&modo=parcial&simular=1");
    expect(ruim.statusCode, ruim.body).toBe(422);
    expect(j(ruim).erros).toEqual([
      { linha: 2, coluna: "CEST", mensagem: "CEST tem 7 dígitos." },
      { linha: 3, coluna: "Descrição", mensagem: "Máximo de 120 caracteres" },
    ]);
    expect((await linha("products", p.id)).j["cest"]).toBe("2803800");
  });

  it("IMP01-A6: coluna AUSENTE não mexe — a linha inteira comparada: só a coluna presente muda", async () => {
    const p = await criarProduto("IMP01 A6 Produto", { reference_price: "10.50", min_stock: "3", fabricante: "Fab A6", barcode: "789000000006", tipo_item: "00" });
    const antes = await linha("products", p.id);
    const r = await enviar(planilha(["Código", "Marca"], [[p.code, "Marca A6"]]), "products", "?acao=atualizar");
    expect(r.statusCode, r.body).toBe(200);
    const depois = await linha("products", p.id);
    expect(depois.x, "houve UPDATE").not.toBe(antes.x);
    expect(depois.j).toEqual({ ...antes.j, marca: "Marca A6" });
    // premissa anti-vacuidade: o que tinha valor continua com valor (não é um registro vazio que "não mudou")
    expect([antes.j["reference_price"], antes.j["min_stock"], antes.j["fabricante"], antes.j["barcode"], antes.j["group_id"]]).toEqual([10.5, 3, "Fab A6", "789000000006", GRUPO]);
  });

  it("IMP01-A7: coluna PRESENTE e célula VAZIA recusa a linha (não apaga, não ignora); nada muda", async () => {
    const p = await criarProduto("IMP01 A7 Produto", { fabricante: "Fab A7" });
    const antes = await linha("products", p.id);
    const r = await enviar(planilha(["Código", "Marca", "Fabricante"], [[p.code, "Marca A7", null]]), "products", "?acao=atualizar");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Fabricante", mensagem: MSG_PRESENTE_VAZIA }]);
    expect(j(r)).toMatchObject({ gravadas: 0, certas: 0, casaram: 1, com_erro: 1 });
    expect(await linha("products", p.id)).toEqual(antes);
    // controle: sem a coluna Fabricante, a MESMA linha passa (a recusa veio só da coluna presente vazia)
    const ok = await enviar(planilha(["Código", "Marca"], [[p.code, "Marca A7"]]), "products", "?acao=atualizar&simular=1");
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe("o casamento pelo código", () => {
  it("IMP01-A8: código inexistente ⇒ erro da linha e NADA criado; código de produto excluído também não casa (só registro vivo)", async () => {
    const excluido = await criarProduto("IMP01 A8 Excluído");
    const del = await h.app.inject({ method: "DELETE", url: `/api/resources/products/${excluido.id}`, headers: h.headers() });
    expect(del.statusCode, del.body).toBe(200);
    const vivo = await criarProduto("IMP01 A8 Vivo");
    const antesVivo = await linha("products", vivo.id); const antesExcluido = await linha("products", excluido.id);
    expect((await admin.query("select 1 from erp.products where organization_id=$1 and code='99999'", [h.demo.orgId])).rowCount, "premissa: 99999 não existe").toBe(0);
    const total = await contar("products");
    // a linha traz TUDO o que um cadastro novo exigiria (descrição, grupo, unidade): se o ATUALIZAR criasse, criaria
    const m = await abrir((await modelo("products", "?acao=atualizar")).rawPayload);
    const [grupo, unidade] = [listaDe(m, "Grupo")[0]!, listaDe(m, "1ª Un. Medida")[0]!];
    const wb = planilha(["Código", "Descrição", "Grupo", "1ª Un. Medida", "Controla estoque"], [
      ["99999", "IMP01 A8 Criado Disfarçado", grupo, unidade, "Não"], [excluido.code, "IMP01 A8 Ressuscitado", grupo, unidade, "Não"], [vivo.code, "IMP01 A8 Vivo Novo", grupo, unidade, "Não"]]);
    for (const consulta of ["?acao=atualizar", "?acao=atualizar&modo=parcial"]) {
      const r = await enviar(wb, "products", consulta);
      expect(j(r).erros, consulta).toEqual([
        { linha: 2, coluna: "Código", mensagem: '"99999" não encontrado em Produtos. Atualizar não cria registro: para criar, use "Criar registros".' },
        { linha: 3, coluna: "Código", mensagem: `"${excluido.code}" não encontrado em Produtos. Atualizar não cria registro: para criar, use "Criar registros".` },
      ]);
      expect(j(r)).toMatchObject({ casaram: 1, nao_casaram: 2 });
      if (consulta.includes("parcial")) expect(r.statusCode).toBe(200); else { expect(r.statusCode).toBe(422); expect((await linha("products", vivo.id)).j).toEqual(antesVivo.j); }
    }
    expect(await contar("products"), "nada criado").toBe(total);
    expect((await admin.query("select 1 from erp.products where organization_id=$1 and description like 'IMP01 A8 Criado%'", [h.demo.orgId])).rowCount).toBe(0);
    expect(await linha("products", excluido.id), "o excluído intacto (continua excluído)").toEqual(antesExcluido);
    expect((await linha("products", vivo.id)).j["description"], "o parcial gravou só a linha que casou").toBe("IMP01 A8 Vivo Novo");
  });

  it("IMP01-A9: código repetido no arquivo ⇒ erro nas DUAS linhas (nunca 'a primeira' ou 'a última'); nada muda", async () => {
    const p = await criarProduto("IMP01 A9 Produto");
    const antes = await linha("products", p.id);
    const r = await enviar(planilha(["Código", "Marca"], [[p.code, "Marca 1"], [p.code, "Marca 2"]]), "products", "?acao=atualizar&modo=parcial");
    expect(r.statusCode, r.body).toBe(422);
    const msg = "Código repetido no arquivo (linhas 2, 3): cada registro aparece uma vez.";
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Código", mensagem: msg }, { linha: 3, coluna: "Código", mensagem: msg }]);
    expect(await linha("products", p.id)).toEqual(antes);
  });

  it("IMP01-A10: outra organização — o código que só existe lá é ERRO aqui; o código que existe nas duas atualiza só o desta; a de lá intacta", async () => {
    const orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra IMP01','outra-imp01') returning id")).rows[0]!.id;
    const grupoB = (await admin.query<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'1','Grupo B','analytic') returning id", [orgB])).rows[0]!.id;
    const pA = await criarProduto("IMP01 A10 Daqui");
    const soB = (await admin.query<{ id: string }>("insert into erp.products(organization_id,code,description,group_id,measurement_id,control_stock,marca) values ($1,'ZZB01','Só na B',$2,$3,false,'Marca B') returning id", [orgB, grupoB, UNIDADE])).rows[0]!.id;
    const mesmoCodigoB = (await admin.query<{ id: string }>("insert into erp.products(organization_id,code,description,group_id,measurement_id,control_stock,marca) values ($1,$2,'Mesmo código na B',$3,$4,false,'Marca B') returning id", [orgB, pA.code, grupoB, UNIDADE])).rows[0]!.id;
    const [antesSoB, antesMesmo] = [await linha("products", soB), await linha("products", mesmoCodigoB)];
    const r = await enviar(planilha(["Código", "Marca"], [["ZZB01", "Invasão"], [pA.code, "Marca Daqui"]]), "products", "?acao=atualizar&modo=parcial");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Código", mensagem: '"ZZB01" não encontrado em Produtos. Atualizar não cria registro: para criar, use "Criar registros".' }]);
    expect(j(r)).toMatchObject({ gravadas: 1, casaram: 1, nao_casaram: 1 });
    expect((await linha("products", pA.id)).j["marca"]).toBe("Marca Daqui");
    expect(await linha("products", soB), "a da outra organização intacta").toEqual(antesSoB);
    expect(await linha("products", mesmoCodigoB), "a do MESMO código na outra organização intacta").toEqual(antesMesmo);
  });

  it("IMP01-A11: o casamento filtra a organização POR CONTA PRÓPRIA (não só pela RLS) — numa conexão SEM RLS, só os desta organização", async () => {
    const pA = await criarProduto("IMP01 A11 Daqui");
    const orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra IMP01 A11','outra-imp01-a11') returning id")).rows[0]!.id;
    const grupoB = (await admin.query<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'1','Grupo B','analytic') returning id", [orgB])).rows[0]!.id;
    const deB = (await admin.query<{ id: string }>("insert into erp.products(organization_id,code,description,group_id,measurement_id,control_stock) values ($1,$2,'Mesmo código na B',$3,$4,false) returning id", [orgB, pA.code, grupoB, UNIDADE])).rows[0]!.id;
    await admin.query("insert into erp.products(organization_id,code,description,group_id,measurement_id,control_stock) values ($1,'ZZA11','Só na B',$2,$3,false)", [orgB, grupoB, UNIDADE]);
    const cliente = await admin.connect();
    try {
      // premissa: a conexão de superusuário ENXERGA as duas organizações (a RLS não está filtrando aqui)
      expect((await cliente.query("select organization_id::text o from erp.products where code=$1 order by 1", [pA.code])).rows.length).toBe(2);
      const m = await casarPorCodigo({ tx: cliente, orgId: h.demo.orgId }, getResource("products")!, [pA.code, "ZZA11"]);
      expect([...m.entries()]).toEqual([[pA.code, [pA.id]]]);
      const mB = await casarPorCodigo({ tx: cliente, orgId: orgB }, getResource("products")!, [pA.code]);
      expect([...mB.entries()], "a mesma pergunta pela organização B acha o de lá").toEqual([[pA.code, [deB]]]);
    } finally { cliente.release(); }
  });
});

describe("permissão, prévia e transação", () => {
  it("IMP01-A12: `.create` sem `.edit` ⇒ 403 ANTES de abrir o arquivo (no envio e no modelo); `.edit` sem `.create` ⇒ ATUALIZAR sim, CRIAR não", async () => {
    const soCriar = await membro("IMP01 Só Criar", "imp01-so-criar@demo.local", ["products.view", "products.create"]);
    const soEditar = await membro("IMP01 Só Editar", "imp01-so-editar@demo.local", ["products.view", "products.edit"]);
    // corpo que NEM é XLSX: se o servidor abrisse o arquivo antes, a resposta seria "Arquivo inválido" (422)
    const lixo = { arquivo_base64: "AAAA" };
    const r = await h.app.inject({ method: "POST", url: "/api/imports/products?acao=atualizar&simular=1", headers: soCriar, payload: lixo });
    expect(r.statusCode, r.body).toBe(403);
    expect(j(r).error).toEqual({ code: "PERMISSION_DENIED", message: "Sem permissão: products.edit" });
    expect((await modelo("products", "?acao=atualizar", soCriar)).statusCode).toBe(403);
    // controle: o MESMO membro, no CRIAR, passa da permissão e chega ao arquivo (que é inválido)
    const criar = await h.app.inject({ method: "POST", url: "/api/imports/products?simular=1", headers: soCriar, payload: lixo });
    expect(criar.statusCode, criar.body).toBe(422);
    expect(j(criar).erros).toEqual([{ linha: 0, coluna: null, mensagem: "Arquivo inválido: envie o modelo em XLSX." }]);
    // `.edit` sem `.create`: o inverso
    const naoCria = await h.app.inject({ method: "POST", url: "/api/imports/products?simular=1", headers: soEditar, payload: lixo });
    expect(naoCria.statusCode, naoCria.body).toBe(403);
    expect(j(naoCria).error).toEqual({ code: "PERMISSION_DENIED", message: "Sem permissão: products.create" });
    const p = await criarProduto("IMP01 A12 Produto");
    const atualiza = await enviar(planilha(["Código", "Marca"], [[p.code, "Marca A12"]]), "products", "?acao=atualizar", soEditar);
    expect(atualiza.statusCode, atualiza.body).toBe(200);
    expect((await linha("products", p.id)).j["marca"]).toBe("Marca A12");
  });

  it("IMP01-A13: a PRÉVIA não grava — diz quantas casaram, quantas não e QUAIS colunas mudam; a linha (e o xmin) e a auditoria ficam iguais", async () => {
    const p1 = await criarProduto("IMP01 A13 Um"); const p2 = await criarProduto("IMP01 A13 Dois");
    const [a1, a2] = [await linha("products", p1.id), await linha("products", p2.id)];
    const audit = await contarAuditoria(); const total = await contar("products");
    const r = await enviar(planilha(["Código", "Marca", "Fabricante"], [[p1.code, "Marca Antiga", "Fab Nova"], [p2.code, "Marca Nova", "Fab Nova"], ["99998", "X", "Y"]]), "products", "?acao=atualizar&simular=1&modo=parcial");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ simulacao: true, gravadas: 0, linhas: 3, casaram: 2, nao_casaram: 1, certas: 2, com_erro: 1, sem_alteracao: 0 });
    expect(j(r).alteracoes).toEqual([{ linha: 2, codigo: p1.code, colunas: ["Fabricante"] }, { linha: 3, codigo: p2.code, colunas: ["Marca", "Fabricante"] }]);
    expect(await linha("products", p1.id), "prévia: linha e versão iguais").toEqual(a1);
    expect(await linha("products", p2.id)).toEqual(a2);
    expect(await contarAuditoria(), "prévia: nenhuma linha de auditoria").toBe(audit);
    expect(await contar("products")).toBe(total);
  });

  it("IMP01-A14: modo `tudo` com falha na ÚLTIMA linha (na porta) ⇒ NENHUMA atualizada; `parcial` grava as certas e devolve a planilha de erros só com as colunas presentes", async () => {
    const p1 = await criarProduto("IMP01 A14 Um"); const p2 = await criarProduto("IMP01 A14 Dois"); const p3 = await criarProduto("IMP01 A14 Três");
    const antes = [await linha("products", p1.id), await linha("products", p2.id), await linha("products", p3.id)];
    const audit = await contarAuditoria();
    // a 3ª passa na tradução e só é recusada DENTRO da porta (a regra do CEST), depois das duas primeiras gravadas no savepoint
    const wb = planilha(["Código", "Marca", "CEST"], [[p1.code, "Marca A14", "1234567"], [p2.code, "Marca A14", "1234567"], [p3.code, "Marca A14", "123"]]);
    const tudo = await enviar(wb, "products", "?acao=atualizar");
    expect(tudo.statusCode, tudo.body).toBe(422);
    expect(j(tudo)).toMatchObject({ gravadas: 0, certas: 2, com_erro: 1, erros: [{ linha: 4, coluna: "CEST", mensagem: "CEST tem 7 dígitos." }] });
    expect([await linha("products", p1.id), await linha("products", p2.id), await linha("products", p3.id)], "tudo: nada gravado").toEqual(antes);
    expect(await contarAuditoria(), "tudo: nenhuma auditoria").toBe(audit);
    const parcial = await enviar(wb, "products", "?acao=atualizar&modo=parcial");
    expect(parcial.statusCode, parcial.body).toBe(200);
    expect(j(parcial)).toMatchObject({ gravadas: 2, certas: 2, com_erro: 1 });
    expect((await linha("products", p1.id)).j).toMatchObject({ marca: "Marca A14", cest: "1234567" });
    expect((await linha("products", p2.id)).j).toMatchObject({ marca: "Marca A14", cest: "1234567" });
    expect(await linha("products", p3.id)).toEqual(antes[2]);
    const erros = await abrir(Buffer.from(j(parcial).planilha_erros_base64!, "base64"));
    expect(titulosDe(erros), "só as colunas que vieram, mais Erros").toEqual(["Código *", "Marca", "CEST", "Erros"]);
    // a planilha de erros corrigida volta pelo ATUALIZAR (o título com * é o mesmo cabeçalho)
    const ws = erros.getWorksheet("Dados")!; ws.getRow(2).getCell(3).value = "7654321"; ws.getRow(2).commit();
    const volta = await enviar(erros, "products", "?acao=atualizar");
    expect(volta.statusCode, volta.body).toBe(200);
    expect((await linha("products", p3.id)).j).toMatchObject({ marca: "Marca A14", cest: "7654321" });
  });

  it("IMP01-A15: linha em que NADA muda não grava (nem audita): `sem_alteracao`, versão física igual", async () => {
    const p = await criarProduto("IMP01 A15 Produto", { fabricante: "Fab A15" });
    const antes = await linha("products", p.id); const audit = await contarAuditoria();
    const r = await enviar(planilha(["Código", "Marca", "Fabricante"], [[p.code, "Marca Antiga", "Fab A15"]]), "products", "?acao=atualizar");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ gravadas: 0, certas: 1, sem_alteracao: 1, alteracoes: [], erros: [] });
    expect(await linha("products", p.id)).toEqual(antes);
    expect(await contarAuditoria()).toBe(audit);
  });

  it("IMP01-A16: ROW COUNT — a porta que não alcança a linha (versão física igual) recusa a linha; a que alcança grava", async () => {
    const def = getResource("products")!;
    const p = await criarProduto("IMP01 A16 Produto");
    const cliente = await admin.connect();
    try {
      await cliente.query("begin");
      const ctx = { tx: cliente, orgId: h.demo.orgId } as unknown as ServiceCtx;
      const lida = await lerPlanilha(def, Buffer.from(await b64(planilha(["Código", "Marca"], [[p.code, "Marca A16"]])), "base64"), "atualizar");
      const registro = async () => (await cliente.query<Record<string, unknown>>("select * from erp.products where id=$1", [p.id])).rows[0]!;
      // a porta que "responde" a mudança sem gravar: o caso da RLS que devolve zero linhas sem erro
      const muda: PortaDeEdicao = { ler: registro, atualizar: async () => ({ ...(await registro()), marca: "Marca A16" }) };
      const r = await atualizarPlanilha(ctx, def, lida, muda, false);
      expect(r.erros).toEqual([{ linha: 2, coluna: null, mensagem: MSG_NAO_GRAVOU }]);
      expect(r).toMatchObject({ certas: 0, gravadas: 0, alteracoes: [] });
      // controle: a porta que grava passa
      const grava: PortaDeEdicao = { ler: registro, atualizar: async () => { await cliente.query("update erp.products set marca='Marca A16' where id=$1", [p.id]); return registro(); } };
      const ok = await atualizarPlanilha(ctx, def, lida, grava, false);
      expect(ok).toMatchObject({ erros: [], gravadas: 1, alteracoes: [{ linha: 2, codigo: p.code, colunas: ["Marca"] }] });
    } finally { await cliente.query("rollback"); cliente.release(); }
  });
});

describe("os outros cadastros com código e o CRIAR ao lado", () => {
  it("IMP01-A17: plano de contas (árvore, código editável) e parceiro (código só leitura) atualizam pelo código, que não muda", async () => {
    const conta = (await admin.query<{ id: string; description: string }>("select id, description from erp.chart_accounts where organization_id=$1 and code='2'", [h.demo.orgId])).rows[0]!;
    expect(conta.description).toBe("PASSIVO");
    const r = await enviar(planilha(["Código", "Descrição"], [["2", "PASSIVO E PL"]]), "chart_accounts", "?acao=atualizar");
    expect(r.statusCode, r.body).toBe(200);
    expect((await linha("chart_accounts", conta.id)).j).toMatchObject({ code: "2", description: "PASSIVO E PL" });
    const pessoa = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: JSON_HDR(), payload: { name: "IMP01 A17 Parceiro", is_client: true } });
    expect(pessoa.statusCode, pessoa.body).toBe(201);
    const pe = JSON.parse(pessoa.body) as { id: string; code: string };
    const rp = await enviar(planilha(["Código", "Telefone"], [[pe.code, "(63) 3333-1717"]]), "people", "?acao=atualizar");
    expect(rp.statusCode, rp.body).toBe(200);
    expect((await linha("people", pe.id)).j).toMatchObject({ code: pe.code, name: "IMP01 A17 Parceiro", phone: "(63) 3333-1717" });
  });

  it("IMP01-A18: o CRIAR não atualiza — código que já existe continua o erro de hoje e o existente fica intacto", async () => {
    const antes = (await admin.query<{ description: string }>("select description from erp.chart_accounts where organization_id=$1 and code='1'", [h.demo.orgId])).rows;
    expect(antes.length, "premissa: o código 1 existe").toBe(1);
    const total = await contar("chart_accounts");
    for (const consulta of ["", "?acao=criar"]) {
      const r = await enviar(planilha(["Código", "Descrição", "Condição", "Analítica"], [["1", "IMP01 A18 Sobrescrita", "Crédito", "Não"]]), "chart_accounts", consulta);
      expect(r.statusCode, `${consulta}: ${r.body}`).toBe(422);
      expect(j(r).erros).toEqual([{ linha: 2, coluna: "Código", mensagem: "Já existe um registro com este valor." }]);
      expect(Object.keys(JSON.parse(r.body) as object), "o CRIAR não ganha chave nova").toEqual(["linhas", "gravadas", "erros", "simulacao", "modo", "certas", "com_erro", "planilha_erros_base64"]);
    }
    expect((await admin.query("select description from erp.chart_accounts where organization_id=$1 and code='1'", [h.demo.orgId])).rows).toEqual(antes);
    expect(await contar("chart_accounts")).toBe(total);
  });
});
