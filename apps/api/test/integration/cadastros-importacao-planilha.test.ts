import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { performance } from "node:perf_hooks";
import { crc32, deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { RESOURCES } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Importação de cadastros — LEITURA DO ARQUIVO (R1 da PR #59): tamanho, forma, células que não têm valor
 * legível, números em pt-BR, zeros à esquerda e texto que o XML não aceita.
 *
 * Cada teste prova a premissa junto com a conclusão: o arquivo enviado é RELIDO pelo ExcelJS antes do envio
 * (a célula guarda mesmo o que o teste diz que guarda), o zip montado à mão tem um CONTROLE aceito (o 422 é
 * pelo tamanho, não por pacote quebrado), e o banco é conferido depois (valor gravado ou nada gravado).
 */
let h: Harness; let admin: Db;
interface Erro { linha: number; coluna: string | null; mensagem: string }
interface Resposta { linhas: number; gravadas: number; erros: Erro[]; simulacao: boolean }
const j = (r: { body: string }) => JSON.parse(r.body) as Resposta;

const MB = 1024 * 1024;
const LIMITE_DESCOMPRIMIDO = 48 * MB;
const MSG = {
  invalido: "Arquivo inválido: envie o modelo em XLSX.",
  grande: "Arquivo grande demais depois de descompactado (limite de 48 MB). Divida em arquivos menores.",
  limite: "Limite de 5000 linhas por arquivo.",
  repetida: "Coluna repetida no arquivo.",
  semTitulo: "Valor em coluna sem título. Apague o valor ou use o modelo.",
  erroCelula: (codigo: string) => `Célula com erro (${codigo}). Corrija ou cole só os valores.`,
  semResultado: "Fórmula sem valor calculado. Cole só os valores.",
  obrigatorio: "Obrigatório.",
  dataCelula: "Data inválida na célula.",
  numero: "Número inválido. Use vírgula decimal (1234,56 ou 1.234,56).",
  inteiro: "Número inteiro inválido.",
  zeros: "A célula é um número com formato de zeros à esquerda: o arquivo guarda só o número, sem os zeros. Formate a coluna como Texto e digite de novo.",
} as const;

// ------------------------------------------------------------------ helpers de API e planilha

const modelo = async (key: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo`, headers: h.headers() });
  expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
};
const bufferDe = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
const enviar = (arquivo: Buffer, key: string, simular = false) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}?simular=${simular ? 1 : 0}`, headers: h.headers({ "content-type": "application/json" }), payload: { arquivo_base64: arquivo.toString("base64") } });
const cronometrado = async <T>(fn: () => Promise<T>) => { const t0 = performance.now(); const r = await fn(); return { r, ms: performance.now() - t0 }; };
/** Relê o arquivo EXATAMENTE como vai ao servidor: o que a célula guarda depois de salvo é a premissa do teste. */
const releitura = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb.getWorksheet("Dados")!; };
const cabecalho = (wb: ExcelJS.Workbook) => { const r: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => r.push(String(c.value))); return r; };
const col = (wb: ExcelJS.Workbook, titulo: string) => { const n = cabecalho(wb).indexOf(titulo) + 1; if (!n) throw new Error(`coluna "${titulo}" fora do modelo: ${cabecalho(wb).join(" | ")}`); return n; };
const listaDe = (wb: ExcelJS.Workbook, chave: string) => { const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; }); if (!c) throw new Error(`lista "${chave}" fora do modelo`); const out: string[] = []; for (let i = 2; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v) out.push(String(v)); } return out; };
const daLista = (wb: ExcelJS.Workbook, chave: string, casa: (x: string) => boolean) => { const v = listaDe(wb, chave).find(casa); if (!v) throw new Error(`nenhum item da lista "${chave}" atende ao critério`); return v; };
const porLinha = (e: Erro[]) => [...e].sort((a, b) => a.linha - b.linha || String(a.coluna).localeCompare(String(b.coluna)));
const contar = async (tabela: "product_groups" | "products" | "people") => Number((await admin.query<{ n: string }>(`select count(*) n from erp.${tabela} where organization_id=$1`, [h.demo.orgId])).rows[0]!.n);
const gruposComo = async (like: string) => (await admin.query<{ name: string }>("select name from erp.product_groups where organization_id=$1 and name like $2 order by name", [h.demo.orgId, like])).rows.map((r) => r.name);
/** numeric do banco sem os zeros de escala (`1234.5600` → `1234.56`), comparado como TEXTO — nunca ponto flutuante. */
const dec = (s: string | null) => (s === null ? null : s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/**
 * Grupos de produto: linhas `Código *` + `Nome *` a partir da linha 2, com UMA linha vazia no meio (2502). Devolve
 * as linhas usadas. CADASTROS-ESTRUTURA: o grupo virou árvore com código obrigatório; os códigos são raízes da
 * máscara de 4 dígitos que o `beforeAll` configura (a padrão só tem 9 raízes).
 */
function preencherGrupos(wb: ExcelJS.Workbook, quantas: number, prefixo: string): number[] {
  const ws = wb.getWorksheet("Dados")!; const c = col(wb, "Nome *"); const cc = col(wb, "Código *"); const usadas: number[] = [];
  for (let n = 2; usadas.length < quantas; n++) {
    if (n === 2502) continue;
    ws.getRow(n).getCell(cc).value = String(usadas.length + 1).padStart(4, "0");
    ws.getRow(n).getCell(c).value = `${prefixo} ${String(usadas.length + 1).padStart(4, "0")}`;
    usadas.push(n);
  }
  return usadas;
}

interface BaseProduto { grupo: string; sigla: string; unidade: string }
let base: BaseProduto;
/** Produto com as colunas obrigatórias preenchidas com valores da aba Listas (grupo analítico "código - nome"). */
function produto(wb: ExcelJS.Workbook, n: number, descricao: string, extra: Record<string, ExcelJS.CellValue> = {}, b: BaseProduto = base) {
  const row = wb.getWorksheet("Dados")!.getRow(n);
  const valores: Record<string, ExcelJS.CellValue> = {
    "Descrição *": descricao,
    "1ª Un. Medida *": daLista(wb, "1ª Un. Medida", (x) => x.startsWith(`${b.sigla} - ${b.unidade}`)),
    "Grupo *": daLista(wb, "Grupo", (x) => x === b.grupo || x.startsWith(`${b.grupo} [`)),
    // "Não" dispensa a categoria financeira (obrigatória só quando controla estoque)
    "Controla estoque": "Não",
    ...extra,
  };
  for (const [t, v] of Object.entries(valores)) row.getCell(col(wb, t)).value = v;
  row.commit();
}

// ------------------------------------------------------------------ zip montado à mão

interface Parte { nome: string; dados: Buffer; tamanhoDeclarado?: number }
/** Zip (deflate) byte a byte: cabeçalhos locais + diretório central + fim. `tamanhoDeclarado` permite MENTIR o tamanho. */
function zip(partes: Parte[]): Buffer {
  const locais: Buffer[] = []; const centrais: Buffer[] = []; let offset = 0;
  for (const p of partes) {
    const nome = Buffer.from(p.nome, "utf8"); const comprimido = deflateRawSync(p.dados); const crc = crc32(p.dados) >>> 0;
    const tamanho = p.tamanhoDeclarado ?? p.dados.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comprimido.length, 18); lh.writeUInt32LE(tamanho, 22); lh.writeUInt16LE(nome.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); // extra, comentário, disco e atributos ficam zerados
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comprimido.length, 20); ch.writeUInt32LE(tamanho, 24); ch.writeUInt16LE(nome.length, 28); ch.writeUInt32LE(offset, 42);
    locais.push(lh, nome, comprimido); centrais.push(ch, nome);
    offset += lh.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(partes.length, 8); fim.writeUInt16LE(partes.length, 10); fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
/** Tamanhos descomprimidos que o PRÓPRIO zip declara no diretório central (o que um leitor ingênuo confiaria). */
function tamanhosDeclarados(z: Buffer): number[] {
  const fim = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error("sem fim de diretório central");
  const n = z.readUInt16LE(fim + 10); let p = z.readUInt32LE(fim + 16); const out: number[] = [];
  for (let k = 0; k < n; k++) { out.push(z.readUInt32LE(p + 24)); p += 46 + z.readUInt16LE(p + 28) + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32); }
  return out;
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`, "utf8");
/**
 * XLSX mínimo de GRUPOS DE PRODUTO montado à mão: aba "Dados" com `Nome *` e `Código *` e uma linha. O enchimento é espaço
 * entre elementos — XML válido, que o deflate comprime ~1000:1 (60 MB viram ~60 KB).
 */
function pacote(nome: string, o: { enchimentoPlanilha?: number; enchimentoStrings?: number; declararPlanilha?: number } = {}) {
  const planilha = Buffer.concat([
    xml(`<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>`),
    Buffer.alloc(o.enchimentoPlanilha ?? 0, 0x20),
    Buffer.from(`<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>`, "utf8"),
  ]);
  const strings = Buffer.concat([
    xml(`<sst xmlns="${NS}" count="4" uniqueCount="4"><si><t>Nome *</t></si>`),
    Buffer.alloc(o.enchimentoStrings ?? 0, 0x20),
    Buffer.from(`<si><t>${nome}</t></si><si><t>Código *</t></si><si><t>0999</t></si></sst>`, "utf8"),
  ]);
  const partes: Parte[] = [
    { nome: "[Content_Types].xml", dados: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`) },
    { nome: "_rels/.rels", dados: xml(`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { nome: "xl/workbook.xml", dados: xml(`<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { nome: "xl/_rels/workbook.xml.rels", dados: xml(`<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`) },
    { nome: "xl/worksheets/sheet1.xml", dados: planilha, tamanhoDeclarado: o.declararPlanilha },
    { nome: "xl/sharedStrings.xml", dados: strings },
  ];
  return { arquivo: zip(partes), descomprimido: partes.reduce((s, p) => s + p.dados.length, 0), maiorParte: Math.max(...partes.map((p) => p.dados.length)) };
}

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  // grupo e unidade de um produto do seed: combinação que existe de verdade
  base = (await admin.query<BaseProduto>(
    `select g.code || ' - ' || g.name grupo, u.symbol sigla, u.name unidade
       from erp.products p join erp.product_groups g on g.id=p.group_id join erp.measurement_units u on u.id=p.measurement_id
      where p.organization_id=$1 and p.description like 'Sal Mineral%' limit 1`, [h.demo.orgId])).rows[0]!;
  expect(base).toBeTruthy();
  // CADASTROS-ESTRUTURA: Grupos de Produtos tem código hierárquico obrigatório. Os testes de tamanho usam o grupo
  // como cadastro de uma coluna só e precisam de até 5001 códigos de raiz: máscara de 4 dígitos, de propósito.
  await admin.query(`update erp.organizations set parameters = jsonb_set(coalesce(parameters, '{}'::jsonb), '{mascaras_codigo}', coalesce(parameters->'mascaras_codigo', '{}'::jsonb) || '{"product_groups":"9999"}'::jsonb) where id=$1`, [h.demo.orgId]);
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

// ------------------------------------------------------------------ tamanho e forma do arquivo

describe("leitura — tamanho e forma do arquivo", () => {
  it("X1: célula solitária na linha 1.048.576 → resposta em segundos, erro NESSA linha, memória sem explodir (só as linhas que existem são lidas)", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    ws.getRow(2).getCell(col(wb, "Código *")).value = "0101";
    ws.getRow(2).getCell(col(wb, "Nome *")).value = "XLSX Grupo Linha Dois"; ws.getRow(2).getCell(col(wb, "Ativo")).value = "Sim";
    ws.getRow(1_048_576).getCell(col(wb, "Ativo")).value = "Sim";
    const buf = await bufferDe(wb);
    // premissa: arquivo pequeno, com a última linha do Excel, e só 3 linhas existindo de fato
    expect(buf.length).toBeLessThan(64 * 1024);
    const lida = await releitura(buf); expect(lida.rowCount).toBe(1_048_576);
    const existentes: number[] = []; lida.eachRow((_r, n) => existentes.push(n)); expect(existentes).toEqual([1, 2, 1_048_576]);
    const antes = await contar("product_groups");
    // Calibragem: o laço antigo (getRow de 2 até rowCount) custava ~1,8 s e ~860 MB de RSS com 2 colunas. O tempo
    // sozinho não separa os dois; a memória separa com folga.
    const rss0 = process.memoryUsage().rss;
    const { r, ms } = await cronometrado(() => enviar(buf, "product_groups"));
    const crescimento = process.memoryUsage().rss - rss0;
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(porLinha(j(r).erros)).toEqual([{ linha: 1_048_576, coluna: "Código", mensagem: MSG.obrigatorio }, { linha: 1_048_576, coluna: "Nome", mensagem: MSG.obrigatorio }]);
    expect(j(r)).toMatchObject({ linhas: 2, gravadas: 0 });
    expect(ms).toBeLessThan(15_000);
    expect(crescimento).toBeLessThan(300 * MB);
    expect(await contar("product_groups")).toBe(antes);
    expect(await gruposComo("XLSX Grupo Linha%")).toEqual([]);
  });

  it("X2: zip-bomba — sheet1.xml com 60 MB de espaços (poucos KB comprimido) → 422 com a mensagem exata, rápido; o MESMO pacote sem enchimento é aceito", async () => {
    // controle: o pacote montado à mão é um XLSX que o servidor lê (o 422 abaixo é pelo tamanho, não por forma)
    const controle = pacote("XLSX Grupo Pacote");
    const ok = await enviar(controle.arquivo, "product_groups", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, gravadas: 0, erros: [], simulacao: true });

    const bomba = pacote("XLSX Grupo Pacote", { enchimentoPlanilha: 60 * MB });
    expect(bomba.arquivo.length).toBeLessThan(256 * 1024);
    expect(bomba.maiorParte).toBeGreaterThan(LIMITE_DESCOMPRIMIDO);
    expect(Math.max(...tamanhosDeclarados(bomba.arquivo))).toBe(bomba.maiorParte); // cabeçalho honesto
    const antes = await contar("product_groups");
    const { r, ms } = await cronometrado(() => enviar(bomba.arquivo, "product_groups"));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 0, coluna: null, mensagem: MSG.grande }]);
    expect(j(r).gravadas).toBe(0);
    expect(ms).toBeLessThan(15_000);
    expect(await contar("product_groups")).toBe(antes);
    expect(await gruposComo("XLSX Grupo Pacote")).toEqual([]);
  });

  it("X3: zip-bomba pela SOMA das partes (2 × 30 MB, cada uma abaixo de 48 MB) → mesma recusa", async () => {
    const bomba = pacote("XLSX Grupo Soma", { enchimentoPlanilha: 30 * MB, enchimentoStrings: 30 * MB });
    expect(bomba.arquivo.length).toBeLessThan(256 * 1024);
    expect(bomba.maiorParte).toBeLessThan(LIMITE_DESCOMPRIMIDO);
    expect(bomba.descomprimido).toBeGreaterThan(LIMITE_DESCOMPRIMIDO);
    const { r, ms } = await cronometrado(() => enviar(bomba.arquivo, "product_groups"));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 0, coluna: null, mensagem: MSG.grande }]);
    expect(ms).toBeLessThan(15_000);
    expect(await gruposComo("XLSX Grupo Soma")).toEqual([]);
  });

  it("X4: zip-bomba com tamanho declarado MENTIROSO (1000 bytes no cabeçalho, 60 MB de verdade) → mesma recusa", async () => {
    const bomba = pacote("XLSX Grupo Mentira", { enchimentoPlanilha: 60 * MB, declararPlanilha: 1000 });
    const declarados = tamanhosDeclarados(bomba.arquivo);
    expect(declarados.reduce((s, x) => s + x, 0)).toBeLessThan(LIMITE_DESCOMPRIMIDO);
    expect(declarados).toContain(1000);
    expect(bomba.descomprimido).toBeGreaterThan(LIMITE_DESCOMPRIMIDO);
    const { r, ms } = await cronometrado(() => enviar(bomba.arquivo, "product_groups"));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 0, coluna: null, mensagem: MSG.grande }]);
    expect(ms).toBeLessThan(15_000);
    expect(await gruposComo("XLSX Grupo Mentira")).toEqual([]);
  });

  it("X5: arquivo que não é zip (texto, PDF, zip cortado ao meio) → 422 `Arquivo inválido: envie o modelo em XLSX.`", async () => {
    const controle = pacote("XLSX Grupo Cortado").arquivo;
    const casos: [string, Buffer][] = [
      ["texto", Buffer.from("isto não é uma planilha", "utf8")],
      ["pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1")],
      ["zip cortado", controle.subarray(0, Math.floor(controle.length / 2))],
    ];
    const antes = await contar("product_groups");
    for (const [nome, arquivo] of casos) {
      const r = await enviar(arquivo, "product_groups");
      expect(r.statusCode, `${nome}: ${r.body.slice(0, 200)}`).toBe(422);
      expect(j(r).erros, nome).toEqual([{ linha: 0, coluna: null, mensagem: MSG.invalido }]);
    }
    expect(await contar("product_groups")).toBe(antes);
  });

  it("X6: zip VÁLIDO que não é XLSX (só um leia-me.txt) → 422 `Arquivo inválido: envie o modelo em XLSX.`", async () => {
    const arquivo = zip([{ nome: "leia-me.txt", dados: Buffer.from("isto é um zip, mas não é planilha", "utf8") }]);
    expect(tamanhosDeclarados(arquivo)).toHaveLength(1); // premissa: zip bem formado
    const r = await enviar(arquivo, "product_groups");
    expect(r.statusCode, r.body.slice(0, 200)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 0, coluna: null, mensagem: MSG.invalido }]);
  });

  it("X7: exatamente 5000 linhas preenchidas (com uma linha vazia no meio) → aceitas na prévia, nada gravado", async () => {
    const wb = await modelo("product_groups");
    const usadas = preencherGrupos(wb, 5000, "XLSX Grupo Lote A");
    const buf = await bufferDe(wb);
    const lida = await releitura(buf); const existentes: number[] = []; lida.eachRow((_r, n) => { if (n > 1) existentes.push(n); });
    expect(existentes).toEqual(usadas); expect(existentes).toHaveLength(5000); expect(existentes).not.toContain(2502);
    const antes = await contar("product_groups");
    const r = await enviar(buf, "product_groups", true);
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(j(r)).toMatchObject({ linhas: 5000, gravadas: 0, erros: [], simulacao: true });
    expect(await contar("product_groups")).toBe(antes);
  }, 300_000);

  it("X8: 5001 linhas preenchidas → 422 `Limite de 5000 linhas por arquivo.` na 5001ª PREENCHIDA (linha 5003), nada gravado", async () => {
    const wb = await modelo("product_groups");
    const usadas = preencherGrupos(wb, 5001, "XLSX Grupo Lote B");
    expect(usadas).toHaveLength(5001); expect(usadas[5000]).toBe(5003); // a vazia (2502) empurra a 5001ª para 5003
    const antes = await contar("product_groups");
    const { r, ms } = await cronometrado(async () => enviar(await bufferDe(wb), "product_groups"));
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 5003, coluna: null, mensagem: MSG.limite }]);
    expect(j(r).gravadas).toBe(0);
    expect(ms).toBeLessThan(60_000);
    expect(await contar("product_groups")).toBe(antes);
    expect(await gruposComo("XLSX Grupo Lote B%")).toEqual([]);
  }, 120_000);

  it("X9: a MESMA coluna duas vezes no cabeçalho → linha 1, coluna = o título, `Coluna repetida no arquivo.`; sem ela o arquivo passa", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    const extra = cabecalho(wb).length + 1;
    ws.getRow(2).getCell(col(wb, "Código *")).value = "0102";
    ws.getRow(2).getCell(col(wb, "Nome *")).value = "XLSX Grupo Cabecalho"; ws.getRow(2).getCell(col(wb, "Ativo")).value = "Sim";
    const ok = await enviar(await bufferDe(wb), "product_groups", true);
    expect(ok.statusCode, ok.body).toBe(200); expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
    ws.getRow(1).getCell(extra).value = "Ativo"; ws.getRow(2).getCell(extra).value = "Não";
    expect(cabecalho(wb).filter((t) => t === "Ativo")).toHaveLength(2);
    const antes = await contar("product_groups");
    const r = await enviar(await bufferDe(wb), "product_groups");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 1, coluna: "Ativo", mensagem: MSG.repetida }]);
    expect(await contar("product_groups")).toBe(antes);
    expect(await gruposComo("XLSX Grupo Cabecalho")).toEqual([]);
  });

  it("X10: valor em coluna SEM título → `Coluna Z`/`Coluna AB` + mensagem exata; a linha só com esse valor conta e não some", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    expect(cabecalho(wb).length).toBeLessThan(26); // Z (26) e AB (28) ficam fora do cabeçalho
    ws.getRow(2).getCell(col(wb, "Código *")).value = "0103"; ws.getRow(2).getCell(col(wb, "Nome *")).value = "XLSX Grupo Sem Titulo A";
    ws.getRow(3).getCell(26).value = "perdido";
    ws.getRow(4).getCell(col(wb, "Código *")).value = "0104"; ws.getRow(4).getCell(col(wb, "Nome *")).value = "XLSX Grupo Sem Titulo B"; ws.getRow(4).getCell(28).value = "x";
    const buf = await bufferDe(wb);
    const lida = await releitura(buf); const naLinha3: number[] = []; lida.getRow(3).eachCell((_c, n) => naLinha3.push(n));
    expect(naLinha3).toEqual([26]); // premissa: a linha 3 só tem o valor na coluna Z
    const r = await enviar(buf, "product_groups");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).linhas).toBe(3);
    expect(porLinha(j(r).erros)).toEqual([
      { linha: 3, coluna: "Código", mensagem: MSG.obrigatorio },
      { linha: 3, coluna: "Coluna Z", mensagem: MSG.semTitulo },
      { linha: 3, coluna: "Nome", mensagem: MSG.obrigatorio },
      { linha: 4, coluna: "Coluna AB", mensagem: MSG.semTitulo },
    ]);
    expect(await gruposComo("XLSX Grupo Sem Titulo%")).toEqual([]);
  });
});

// ------------------------------------------------------------------ células sem valor legível

describe("leitura — células de erro, datas e rich text", () => {
  it("X11: #N/A, fórmula com resultado #REF!, fórmula sem resultado, #DIV/0! em Sim/Não → mensagens exatas; linha SÓ com erro conta; fórmula com resultado vale", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    const nome = col(wb, "Nome *"); const ativo = col(wb, "Ativo");
    for (let n = 2; n <= 6; n++) ws.getRow(n).getCell(col(wb, "Código *")).value = String(200 + n).padStart(4, "0");
    ws.getRow(2).getCell(nome).value = { error: "#N/A" };
    ws.getRow(3).getCell(nome).value = { formula: "A1", result: { error: "#REF!" } };
    ws.getRow(4).getCell(nome).value = { formula: "A1" };
    ws.getRow(5).getCell(nome).value = "XLSX Grupo Erro Ativo"; ws.getRow(5).getCell(ativo).value = { error: "#DIV/0!" };
    ws.getRow(6).getCell(nome).value = { formula: "\"XLSX Grupo Formula\"", result: "XLSX Grupo Formula" };
    const buf = await bufferDe(wb);
    const lida = await releitura(buf);
    expect(lida.getRow(2).getCell(nome).value).toEqual({ error: "#N/A" });
    expect(lida.getRow(3).getCell(nome).value).toEqual({ formula: "A1", result: { error: "#REF!" } });
    expect(lida.getRow(4).getCell(nome).value).toMatchObject({ formula: "A1" });
    expect((lida.getRow(4).getCell(nome).value as ExcelJS.CellFormulaValue).result).toBeUndefined();
    expect(lida.getRow(5).getCell(ativo).value).toEqual({ error: "#DIV/0!" });
    expect(lida.getRow(6).getCell(nome).value).toMatchObject({ result: "XLSX Grupo Formula" });
    const antes = await contar("product_groups");
    const r = await enviar(buf, "product_groups");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).linhas).toBe(5);
    expect(porLinha(j(r).erros)).toEqual([
      { linha: 2, coluna: "Nome", mensagem: MSG.erroCelula("#N/A") },
      { linha: 3, coluna: "Nome", mensagem: MSG.erroCelula("#REF!") },
      { linha: 4, coluna: "Nome", mensagem: MSG.semResultado },
      { linha: 5, coluna: "Ativo", mensagem: MSG.erroCelula("#DIV/0!") },
    ]);
    expect(await contar("product_groups")).toBe(antes);
  });

  it("X12: célula Date inválida (new Date(NaN)) → `Data inválida na célula.` (422, nunca 500)", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    ws.getRow(2).getCell(col(wb, "Código *")).value = "0301";
    const c = ws.getRow(2).getCell(col(wb, "Nome *")); c.value = new Date(Number.NaN); c.numFmt = "dd/mm/yyyy";
    const buf = await bufferDe(wb);
    const v = (await releitura(buf)).getRow(2).getCell(col(wb, "Nome *")).value;
    expect(v instanceof Date && Number.isNaN(v.getTime())).toBe(true); // premissa: o arquivo guarda uma data inválida
    const r = await enviar(buf, "product_groups");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r)).toMatchObject({ linhas: 1, gravadas: 0 });
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Nome", mensagem: MSG.dataCelula }]);
  });

  it("X13: a única data editável dos importáveis é Nascimento/Abertura do parceiro (Fase 4) — `31/02/2024` → Data inválida (use DD/MM/AAAA)., nada gravado", async () => {
    // Este teste falhou de propósito quando o Parceiro ganhou data editável (CADASTROS Fase 4), como pedia:
    // o caso 31/02/2024 (texto) passa a ser coberto aqui. "Última compra" do produto continua readOnly.
    const importaveis = RESOURCES.filter((r) => r.importacao);
    expect(importaveis.map((r) => r.key).sort()).toEqual(["addressings", "chart_accounts", "cost_centers", "cultivations", "financial_categories", "measurement_units", "people", "product_groups", "products", "warehouses"]);
    const datas = importaveis.flatMap((r) => r.fields.filter((f) => f.type === "date" && !f.readOnly).map((f) => `${r.key}.${f.name}`));
    expect(datas).toEqual(["people.nascimento_abertura"]);
    const wb = await modelo("people"); const row = wb.getWorksheet("Dados")!.getRow(2);
    row.getCell(col(wb, "Nome Social/Fantasia *")).value = "XLSX Data Inexistente";
    row.getCell(col(wb, "Cliente")).value = "Sim";
    row.getCell(col(wb, "Nascimento/Abertura")).value = "31/02/2024";
    const antes = await contar("people");
    const r = await enviar(await bufferDe(wb), "people");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Nascimento/Abertura", mensagem: "Data inválida (use DD/MM/AAAA)." }]);
    expect(await contar("people")).toBe(antes);
    const defProduto = RESOURCES.find((r) => r.key === "products")!;
    expect(defProduto.fields.find((f) => f.name === "last_purchase_date")).toMatchObject({ type: "date", readOnly: true });
  });

  it("X14: rich text só com espaços em obrigatório → `Obrigatório.`; rich text com espaços nas pontas grava aparado; hyperlink com rich text grava o texto", async () => {
    const wb = await modelo("product_groups"); const ws = wb.getWorksheet("Dados")!;
    const nome = col(wb, "Nome *"); const ativo = col(wb, "Ativo");
    ws.getRow(2).getCell(nome).value = { richText: [{ text: "   " }, { font: { bold: true }, text: "  " }] };
    ws.getRow(2).getCell(ativo).value = "Sim"; // a linha tem outro valor: conta, e o Nome "vazio" é recusado
    ws.getRow(2).getCell(col(wb, "Código *")).value = "0401";
    const vazio = await bufferDe(wb);
    expect((await releitura(vazio)).getRow(2).getCell(nome).value).toMatchObject({ richText: [{ text: "   " }, { text: "  " }] });
    const r1 = await enviar(vazio, "product_groups");
    expect(r1.statusCode, r1.body.slice(0, 300)).toBe(422);
    expect(j(r1).erros).toEqual([{ linha: 2, coluna: "Nome", mensagem: MSG.obrigatorio }]);

    const wb2 = await modelo("product_groups"); const ws2 = wb2.getWorksheet("Dados")!;
    ws2.getRow(2).getCell(col(wb2, "Código *")).value = "0402"; ws2.getRow(3).getCell(col(wb2, "Código *")).value = "0403";
    ws2.getRow(2).getCell(nome).value = { richText: [{ text: "  XLSX Grupo " }, { font: { bold: true }, text: "Rico  " }] };
    ws2.getRow(3).getCell(nome).value = { text: { richText: [{ text: " XLSX Grupo Link " }] }, hyperlink: "http://x" } as unknown as ExcelJS.CellHyperlinkValue;
    const buf = await bufferDe(wb2);
    const lida = await releitura(buf);
    expect(lida.getRow(2).getCell(nome).value).toMatchObject({ richText: [{ text: "  XLSX Grupo " }, { text: "Rico  " }] });
    expect(lida.getRow(3).getCell(nome).value).toMatchObject({ text: { richText: [{ text: " XLSX Grupo Link " }] }, hyperlink: "http://x" });
    const r2 = await enviar(buf, "product_groups");
    expect(r2.statusCode, r2.body.slice(0, 300)).toBe(201);
    expect(j(r2)).toMatchObject({ linhas: 2, gravadas: 2, erros: [] });
    expect(await gruposComo("%XLSX Grupo Li%")).toEqual(["XLSX Grupo Link"]);
    expect(await gruposComo("%XLSX Grupo Ri%")).toEqual(["XLSX Grupo Rico"]);
    expect(await gruposComo("%object%")).toEqual([]);
  });
});

// ------------------------------------------------------------------ números

describe("leitura — números em pt-BR", () => {
  it("X15: `1.000`, `1.5`, `1,234.56`, `1.23,4` recusados (quantidade e dinheiro) e `1,5` em inteiro recusado — mensagens exatas, nada gravado", async () => {
    const wb = await modelo("products");
    const recusados = ["1.000", "1.5", "1,234.56", "1.23,4"];
    recusados.forEach((v, k) => produto(wb, k + 2, `XLSX Num Ruim ${k + 1}`, { "Estoque mínimo": v }));
    produto(wb, 6, "XLSX Num Ruim Inteiro", { "Período de Carência (dias)": "1,5" });
    produto(wb, 7, "XLSX Num Ruim Dinheiro", { "Valor de referência": "1.000" });
    const buf = await bufferDe(wb);
    const lida = await releitura(buf);
    expect(recusados.map((_, k) => lida.getRow(k + 2).getCell(col(wb, "Estoque mínimo")).value)).toEqual(recusados); // texto, como digitado
    const antes = await contar("products");
    const r = await enviar(buf, "products");
    expect(r.statusCode, r.body.slice(0, 500)).toBe(422);
    expect(j(r).linhas).toBe(6);
    expect(porLinha(j(r).erros)).toEqual([
      ...recusados.map((_, k) => ({ linha: k + 2, coluna: "Estoque mínimo", mensagem: MSG.numero })),
      { linha: 6, coluna: "Período de Carência (dias)", mensagem: MSG.inteiro },
      { linha: 7, coluna: "Valor de referência", mensagem: MSG.numero },
    ]);
    expect(await contar("products")).toBe(antes);
  });

  it("X16: `1234,56`, `1.234,56`, `1,5`, `12` e o número nativo 2.5 aceitos — valor conferido no banco (quantidade, dinheiro, estoque máximo, inteiro)", async () => {
    const wb = await modelo("products");
    const casos: [string, ExcelJS.CellValue, string][] = [
      ["XLSX Num A", "1234,56", "1234.56"],
      ["XLSX Num B", "1.234,56", "1234.56"],
      ["XLSX Num C", "1,5", "1.5"],
      ["XLSX Num D", "12", "12"],
      ["XLSX Num E", 2.5, "2.5"],
    ];
    casos.forEach(([d, v], k) => produto(wb, k + 2, d, { "Estoque mínimo": v }));
    const ws = wb.getWorksheet("Dados")!;
    ws.getRow(2).getCell(col(wb, "Valor de referência")).value = "1.234,56";
    ws.getRow(2).getCell(col(wb, "Estoque máximo")).value = "1,5"; // Fase 6: o fator foi para a grade de unidades
    ws.getRow(3).getCell(col(wb, "Período de Carência (dias)")).value = "30";
    const buf = await bufferDe(wb);
    const lida = await releitura(buf);
    expect(casos.map((_, k) => typeof lida.getRow(k + 2).getCell(col(wb, "Estoque mínimo")).value)).toEqual(["string", "string", "string", "string", "number"]);
    const r = await enviar(buf, "products");
    expect(r.statusCode, r.body.slice(0, 500)).toBe(201);
    expect(j(r)).toMatchObject({ linhas: 5, gravadas: 5, erros: [] });
    const gravados = (await admin.query<{ description: string; min_stock: string | null; reference_price: string; estoque_maximo: string | null; withdrawal_period_days: number | null }>(
      "select description, min_stock::text, reference_price::text, estoque_maximo::text, withdrawal_period_days from erp.products where organization_id=$1 and description like 'XLSX Num _' and deleted_at is null order by description", [h.demo.orgId])).rows;
    expect(gravados.map((x) => [x.description, dec(x.min_stock)])).toEqual(casos.map(([d, , esperado]) => [d, esperado]));
    const a = gravados.find((x) => x.description === "XLSX Num A")!;
    expect(dec(a.reference_price)).toBe("1234.56"); expect(dec(a.estoque_maximo)).toBe("1.5");
    expect(gravados.find((x) => x.description === "XLSX Num B")!.withdrawal_period_days).toBe(30);
  });
});

// ------------------------------------------------------------------ texto e zeros à esquerda

describe("leitura — colunas de texto e zeros à esquerda", () => {
  const TIPOS_TEXTO = ["text", "textarea", "email", "tags", "ref"];

  it("X17: no MODELO, colunas de texto têm formato Texto (`@`); Sim/Não, opção e número não", async () => {
    const wb = await modelo("people"); const ws = wb.getWorksheet("Dados")!;
    const pessoas = RESOURCES.find((r) => r.key === "people")!;
    let comTexto = 0; let semTexto = 0;
    for (const [i, titulo] of cabecalho(wb).entries()) {
      const rotulo = titulo.replace(/ \*$/, "");
      const f = pessoas.fields.find((x) => x.label === rotulo && !x.readOnly);
      if (!f) throw new Error(`coluna "${rotulo}" sem campo no registry de pessoas`);
      const fmt = ws.getColumn(i + 1).numFmt;
      if (TIPOS_TEXTO.includes(f.type)) { expect(fmt, rotulo).toBe("@"); comTexto += 1; } else { expect(fmt, rotulo).not.toBe("@"); semTexto += 1; }
    }
    for (const t of ["CPF/CNPJ", "CEP", "Agência", "Conta", "Telefone", "Número", "Nome Social/Fantasia *"]) expect(ws.getColumn(col(wb, t)).numFmt, t).toBe("@");
    for (const t of ["Fornecedor", "Ativo", "Tipo de pessoa", "Tipo chave Pix", "Município"]) expect(ws.getColumn(col(wb, t)).numFmt, t).not.toBe("@");
    expect(comTexto).toBeGreaterThanOrEqual(10); expect(semTexto).toBeGreaterThanOrEqual(8);
    // produto: referência é texto; quantidade e dinheiro não
    const wp = await modelo("products"); const dp = wp.getWorksheet("Dados")!;
    expect(dp.getColumn(col(wp, "Grupo *")).numFmt).toBe("@");
    expect(dp.getColumn(col(wp, "Estoque mínimo")).numFmt).not.toBe("@");
    expect(dp.getColumn(col(wp, "Valor de referência")).numFmt).not.toBe("@");
  });

  it("X18: texto `01310100` em CEP e `01234567890` em CPF/CNPJ gravados iguais; número 123 com formato Geral em Número → aceito, grava \"123\"", async () => {
    const wb = await modelo("people"); const row = wb.getWorksheet("Dados")!.getRow(2);
    row.getCell(col(wb, "Nome Social/Fantasia *")).value = "XLSX Pessoa Zeros";
    row.getCell(col(wb, "CPF/CNPJ")).value = "01234567890";
    row.getCell(col(wb, "CEP")).value = "01310100";
    row.getCell(col(wb, "Cliente")).value = "Sim"; // pelo menos um tipo (CADASTROS Fase 4)
    row.getCell(col(wb, "Tipo de pessoa")).value = "Física"; // CPF é de pessoa física (R1-6, decisão 253)
    const numero = row.getCell(col(wb, "Número")); numero.value = 123; numero.numFmt = "General";
    const buf = await bufferDe(wb);
    const lida = (await releitura(buf)).getRow(2);
    expect(lida.getCell(col(wb, "CEP")).value).toBe("01310100"); expect(lida.getCell(col(wb, "CEP")).numFmt).toBe("@");
    expect(lida.getCell(col(wb, "CPF/CNPJ")).value).toBe("01234567890");
    expect(lida.getCell(col(wb, "Número")).value).toBe(123); expect([undefined, "General"]).toContain(lida.getCell(col(wb, "Número")).numFmt);
    const r = await enviar(buf, "people");
    expect(r.statusCode, r.body.slice(0, 500)).toBe(201);
    expect(j(r)).toMatchObject({ linhas: 1, gravadas: 1, erros: [] });
    const p = (await admin.query("select document, zip_code, address_number from erp.people where organization_id=$1 and name='XLSX Pessoa Zeros' and deleted_at is null", [h.demo.orgId])).rows;
    expect(p).toEqual([{ document: "01234567890", zip_code: "01310100", address_number: "123" }]);
  });

  it("X19: célula NUMÉRICA com formato de zeros à esquerda (`00000\\-000`, `000\\.000\\.000\\-00`, `00000000000`) em coluna de texto → recusada com a mensagem exata", async () => {
    const wb = await modelo("people"); const ws = wb.getWorksheet("Dados")!;
    const casos: [string, number, string][] = [["CEP", 1310100, "00000\\-000"], ["CPF/CNPJ", 12345678901, "000\\.000\\.000\\-00"], ["CPF/CNPJ", 1234567890, "00000000000"]];
    casos.forEach(([titulo, v, fmt], k) => {
      const row = ws.getRow(k + 2);
      row.getCell(col(wb, "Nome Social/Fantasia *")).value = `XLSX Pessoa Num ${k + 1}`;
      const c = row.getCell(col(wb, titulo)); c.value = v; c.numFmt = fmt;
    });
    const buf = await bufferDe(wb);
    const lida = await releitura(buf);
    casos.forEach(([titulo, v], k) => {
      const c = lida.getRow(k + 2).getCell(col(wb, titulo));
      expect(c.value, titulo).toBe(v); expect(c.numFmt, titulo).toMatch(/^000/); // premissa: número, com formato de zeros
    });
    const antes = await contar("people");
    const r = await enviar(buf, "people");
    expect(r.statusCode, r.body.slice(0, 500)).toBe(422);
    expect(j(r).linhas).toBe(3);
    expect(porLinha(j(r).erros)).toEqual([
      { linha: 2, coluna: "CEP", mensagem: MSG.zeros },
      { linha: 3, coluna: "CPF/CNPJ", mensagem: MSG.zeros },
      { linha: 4, coluna: "CPF/CNPJ", mensagem: MSG.zeros },
    ]);
    expect(await contar("people")).toBe(antes);
  });

  it("X20: nome de cadastro com U+FFFF / U+FFFE / controle → o modelo de produtos continua um XLSX válido, a lista sai sem o caractere e o valor resolve", async () => {
    const org = h.demo.orgId;
    const grupo = async (nome: string) => (await admin.query<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,$2) returning id", [org, nome])).rows[0]!.id;
    const gEspecial = await grupo("XLSX Grupo￿ Especial");
    const gDois = await grupo("XLSX Grupo￾ Dois");
    const gTres = await grupo("XLSX Grupo\u0001 Tres");
    // premissa: o banco guarda os caracteres que o XML 1.0 proíbe
    const nomes = (await admin.query<{ id: string; name: string }>("select id, name from erp.product_groups where id = any($1::uuid[])", [[gEspecial, gDois, gTres]])).rows;
    expect(nomes.find((x) => x.id === gEspecial)!.name).toContain("￿");
    expect(nomes.find((x) => x.id === gDois)!.name).toContain("￾");
    expect(nomes.find((x) => x.id === gTres)!.name).toContain("\u0001");

    const wb = await modelo("products"); // 200 e o ExcelJS carrega: XML válido
    expect(listaDe(wb, "Grupo")).toEqual(expect.arrayContaining(["XLSX Grupo Especial", "XLSX Grupo Dois", "XLSX Grupo Tres"]));
    const proibido = (s: string) => [...s].some((ch) => { const c = ch.codePointAt(0)!; return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff; });
    const textos: string[] = []; wb.getWorksheet("Listas")!.eachRow((r) => r.eachCell((c) => textos.push(String(c.value))));
    expect(textos.length).toBeGreaterThan(10);
    expect(textos.filter(proibido)).toEqual([]);

    produto(wb, 2, "XLSX Produto Grupo Especial", {}, { ...base, grupo: "XLSX Grupo Especial" });
    expect(wb.getWorksheet("Dados")!.getRow(2).getCell(col(wb, "Grupo *")).value).toBe("XLSX Grupo Especial");
    const r = await enviar(await bufferDe(wb), "products");
    expect(r.statusCode, r.body.slice(0, 500)).toBe(201);
    expect(j(r)).toMatchObject({ linhas: 1, gravadas: 1, erros: [] });
    const p = (await admin.query<{ group_id: string; category_id: string | null }>("select group_id, category_id from erp.products where organization_id=$1 and description='XLSX Produto Grupo Especial'", [org])).rows;
    expect(p).toEqual([{ group_id: gEspecial, category_id: null }]);
  });
});
