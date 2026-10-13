import ExcelJS from "exceljs";
import { getResource } from "@agro/domain";
import type { Db } from "@agro/db";
import type { Harness } from "./setup.js";

/**
 * IMPORTAR-01 (decisão 317) — OS CENÁRIOS DO CRIAR, para provar que ele ficou IDÊNTICO.
 *
 * Módulo de apoio (não é teste: o nome não termina em `.test.ts`). Roda, sempre na MESMA ordem e sobre o banco recém
 * semeado pelo `harness()`, um conjunto fixo de pedidos do CRIAR — os modelos, a prévia e a gravação nos modos
 * `tudo` e `parcial`, o código repetido da árvore, a coluna Código no Produto, o modo fora da lista e a falta de
 * permissão — e devolve o que a API respondeu e o que ficou no banco, NORMALIZADO (sem UUID, sem data, a planilha de
 * erros pelo conteúdo). `importar-01-criar-identico.test.ts` compara essa saída com a REFERÊNCIA
 * (`importar-01-criar-referencia.json`), gerada por estes mesmos cenários no commit base 33291879, com o fonte da
 * importação sem mudança nenhuma.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Desempate das listas (`[<8 hex do UUID>]`) e UUIDs: aleatórios a cada semeadura. */
const semAcaso = (s: string) => s.replace(UUID, "<uuid>").replace(/\[[0-9a-f]{8}\]/g, "[<uuid8>]");

function normal(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return semAcaso(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normal);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, normal(x)]));
  return String(v);
}

const textoDaNota = (n: unknown): string | null => (n === undefined || n === null ? null : typeof n === "string" ? n : ((n as ExcelJS.Comment).texts ?? []).map((t) => t.text).join(""));
const valorDaCelula = (c: ExcelJS.Cell): Json => normal(c.value as unknown);

function trocarEmpresas(v: Json, empresas: { code: number; name: string }[]): Json {
  if (typeof v === "string") return empresas.reduce((t, e) => t.split(e.name).join(`<empresa:${e.code}>`), v);
  if (Array.isArray(v)) return v.map((x) => trocarEmpresas(x, empresas));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trocarEmpresas(x, empresas)]));
  return v;
}

/** O XLSX inteiro pelo CONTEÚDO: por aba, as células com valor (endereço → valor), o formato e a nota do cabeçalho. */
async function conteudo(buf: Buffer): Promise<Json> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const abas: Record<string, Json> = {};
  wb.eachSheet((ws) => {
    const celulas: Record<string, Json> = {};
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
      celulas[c.address] = { v: valorDaCelula(c), fmt: c.numFmt ?? null, nota: textoDaNota(c.note), cor: ((c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb) ?? null };
    }));
    // a validação é gravada por FAIXA, mas o ExcelJS a expande célula a célula na leitura: resumo por coluna e regra
    const validacoes = (ws as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model;
    const faixas = new Map<string, { coluna: string; regra: Json; de: number; ate: number; celulas: number }>();
    for (const [endereco, regra] of Object.entries(validacoes ?? {})) {
      const m = /^([A-Z]+)(\d+)$/.exec(endereco); if (!m) throw new Error(`endereço de validação inesperado: ${endereco}`);
      const r = normal(regra); const chave = `${m[1]}|${JSON.stringify(r)}`; const linha = Number(m[2]);
      const f = faixas.get(chave) ?? { coluna: m[1]!, regra: r, de: linha, ate: linha, celulas: 0 };
      f.de = Math.min(f.de, linha); f.ate = Math.max(f.ate, linha); f.celulas += 1; faixas.set(chave, f);
    }
    abas[ws.name] = { celulas, colunas: (ws.columns ?? []).map((c) => normal({ largura: c.width ?? null, fmt: c.numFmt ?? null })), validacoes: [...faixas.values()].sort((a, b) => a.coluna.localeCompare(b.coluna) || a.de - b.de) };
  });
  return abas;
}

/**
 * A ORDEM POR PONTO DE CÓDIGO — a mesma de um banco com colação C.UTF-8, em que a referência foi gerada.
 *
 * As listas da aba "Listas" que vêm do BANCO (campo `ref`: `carregarReferencia`, `order by code, rótulo`, que esta
 * fatia não mudou) seguem a COLAÇÃO do banco: sob C.UTF-8 "L - Litro" vem antes de "ar - Arroba"; sob en_US (o
 * `postgres:16` do CI) vem depois de "km". O CONTEÚDO de cada uma continua comparado inteiro (valor, formato, nota e cor
 * de cada célula), na ordem por ponto de código, que é a ordem C.UTF-8. As listas FIXAS do código (`select`: Sim/Não,
 * Tipo do item…) não dependem do banco e seguem comparadas na ordem do modelo.
 */
const porPontoDeCodigo = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Os títulos das listas que vêm do banco no modelo do cadastro: os campos `ref` (o título da lista é o rótulo do campo). */
export function listasDoBanco(key: string): string[] {
  const def = getResource(key);
  if (!def) throw new Error(`cadastro ${key} fora do registry`);
  return def.fields.filter((f) => f.type === "ref").map((f) => f.label);
}

/** O conteúdo de um modelo com as listas que vêm do banco na ordem por ponto de código; o resto, intacto. */
export function semColacao(key: string, modelo: Json): Json {
  if (!modelo || typeof modelo !== "object" || Array.isArray(modelo)) return modelo;
  const listas = modelo["Listas"];
  if (!listas || typeof listas !== "object" || Array.isArray(listas)) return modelo;
  const celulas = { ...(listas["celulas"] as Record<string, Json>) };
  const doBanco = new Set(listasDoBanco(key));
  const colunaDe = (endereco: string) => /^[A-Z]+/.exec(endereco)![0];
  const valorDe = (c: Json | undefined) => (c && typeof c === "object" && !Array.isArray(c) ? c["v"] : null);
  for (const col of new Set(Object.keys(celulas).map(colunaDe))) {
    const titulo = valorDe(celulas[`${col}1`]);
    if (typeof titulo !== "string" || !doBanco.has(titulo)) continue;
    const linhas = Object.keys(celulas).filter((e) => colunaDe(e) === col && e !== `${col}1`).sort((a, b) => Number(a.slice(col.length)) - Number(b.slice(col.length)));
    const valores = linhas.map((e) => celulas[e]!).sort((x, y) => porPontoDeCodigo(String(valorDe(x)), String(valorDe(y))));
    linhas.forEach((e, i) => { celulas[e] = valores[i]!; });
  }
  return { ...modelo, Listas: { ...listas, celulas } };
}

const b64 = (wb: ExcelJS.Workbook) => wb.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer).toString("base64"));

/** Resposta da API normalizada; a planilha de erros vira o conteúdo dela. */
async function resposta(r: { statusCode: number; body: string }): Promise<Json> {
  const corpo = JSON.parse(r.body) as Record<string, unknown>;
  const out: Record<string, Json> = { status: r.statusCode, chaves: Object.keys(corpo) };
  for (const [k, v] of Object.entries(corpo)) {
    out[k] = k === "planilha_erros_base64" && typeof v === "string" ? await conteudo(Buffer.from(v, "base64")) : normal(v);
  }
  return out;
}

export async function cenariosDoCriar(h: Harness, admin: Db): Promise<Record<string, Json>> {
  const org = h.demo.orgId;
  // o NOME de cada empresa do seed vira `<empresa:código>`: a lista do modelo continua comparada registro a registro
  // (qual empresa), sem copiar para o repositório o nome do seed (a catraca do nicho, `farm-inventory`, conta testes da API)
  const empresas = (await admin.query<{ code: number; name: string }>("select code, name from erp.empresas where organization_id=$1 order by length(name) desc", [org])).rows;
  const saida: Record<string, Json> = {};
  const modelo = async (key: string, consulta = "") => {
    const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo${consulta}`, headers: h.headers() });
    if (r.statusCode !== 200) throw new Error(`modelo ${key}: ${r.statusCode} ${r.body.slice(0, 200)}`);
    return r.rawPayload;
  };
  const abrir = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb; };
  const enviar = async (wb: ExcelJS.Workbook, key: string, consulta: string, headers = h.headers({ "content-type": "application/json" })) =>
    h.app.inject({ method: "POST", url: `/api/imports/${key}${consulta}`, headers, payload: { arquivo_base64: await b64(wb) } });
  const titulos = (wb: ExcelJS.Workbook) => { const t: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => t.push(String(c.value))); return t; };
  const preencher = (wb: ExcelJS.Workbook, linha: number, valores: Record<string, ExcelJS.CellValue>) => {
    const ws = wb.getWorksheet("Dados")!; const t = titulos(wb); const row = ws.getRow(linha);
    for (const [titulo, v] of Object.entries(valores)) { const n = t.indexOf(titulo) + 1; if (!n) throw new Error(`coluna ${titulo} fora do modelo: ${t.join(" | ")}`); row.getCell(n).value = v; }
    row.commit();
  };
  // o primeiro da lista na ordem por ponto de código (a da referência, C.UTF-8), não na do banco que roda o teste
  const primeiroDaLista = (wb: ExcelJS.Workbook, chave: string) => {
    const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; });
    const valores: string[] = [];
    if (c) ws.getColumn(c).eachCell((x, linha) => { if (linha > 1 && x.value !== null && x.value !== undefined) valores.push(String(x.value)); });
    if (!valores.length) throw new Error(`lista ${chave} vazia`);
    return valores.sort(porPontoDeCodigo)[0]!;
  };

  // 1. OS MODELOS do CRIAR (o que a tela baixa hoje): conteúdo inteiro, quatro cadastros (com e sem código)
  for (const key of ["products", "people", "chart_accounts", "measurement_units"]) saida[`modelo_${key}`] = await conteudo(await modelo(key));

  // 2. PRODUTOS: uma linha certa e três erradas (obrigatório vazio, referência inexistente, número ambíguo)
  const mp = await abrir(await modelo("products"));
  const base = { "1ª Un. Medida *": primeiroDaLista(mp, "1ª Un. Medida"), "Grupo *": primeiroDaLista(mp, "Grupo"), "Controla estoque": "Não" };
  preencher(mp, 2, { ...base, "Descrição *": "IMP01 Criar Certo A" });
  preencher(mp, 3, { ...base, "Descrição *": null });
  preencher(mp, 4, { ...base, "Descrição *": "IMP01 Criar Grupo Errado", "Grupo *": "Grupo Que Nao Existe IMP01" });
  preencher(mp, 5, { ...base, "Descrição *": "IMP01 Criar Numero Ambiguo", "Estoque mínimo": "1.000" });
  saida["produtos_previa_tudo"] = await resposta(await enviar(mp, "products", "?simular=1"));
  saida["produtos_previa_parcial"] = await resposta(await enviar(mp, "products", "?simular=1&modo=parcial"));
  saida["produtos_gravar_tudo_com_erro"] = await resposta(await enviar(mp, "products", ""));
  saida["produtos_gravar_parcial"] = await resposta(await enviar(mp, "products", "?modo=parcial"));

  // 3. PRODUTOS só certos, modo tudo: grava as duas, na ordem
  const mp2 = await abrir(await modelo("products"));
  preencher(mp2, 2, { ...base, "Descrição *": "IMP01 Criar Certo B", "Marca": "Marca IMP01", "Estoque mínimo": "12,5" });
  preencher(mp2, 3, { ...base, "Descrição *": "IMP01 Criar Certo C", "Controla estoque": "Não", "Valor de referência": "1.234,56" });
  saida["produtos_gravar_tudo"] = await resposta(await enviar(mp2, "products", ""));

  // 4. PLANO DE CONTAS: código que JÁ EXISTE (o erro de hoje) ao lado de um código livre
  const mc = await abrir(await modelo("chart_accounts"));
  preencher(mc, 2, { "Código *": "2", "Descrição *": "IMP01 Conta Repetida", "Condição *": "Crédito", "Analítica *": "Não" });
  preencher(mc, 3, { "Código *": "9", "Descrição *": "IMP01 Conta Nova", "Condição *": "Crédito", "Analítica *": "Não" });
  saida["contas_codigo_existente"] = await resposta(await enviar(mc, "chart_accounts", ""));

  // 5. PRODUTO com a coluna "Código" (fora do modelo do CRIAR): o arquivo é recusado
  const mk = await abrir(await modelo("products"));
  const ws = mk.getWorksheet("Dados")!; const n = titulos(mk).length + 1;
  ws.getRow(1).getCell(n).value = "Código"; ws.getRow(1).commit();
  preencher(mk, 2, { ...base, "Descrição *": "IMP01 Criar Com Codigo" }); ws.getRow(2).getCell(n).value = "00001"; ws.getRow(2).commit();
  saida["produtos_coluna_codigo"] = await resposta(await enviar(mk, "products", "?simular=1"));

  // 6. PARCEIROS, modo tudo, duas linhas certas
  const mpe = await abrir(await modelo("people"));
  preencher(mpe, 2, { "Nome Social/Fantasia *": "IMP01 Parceiro A", "Cliente": "Sim" });
  preencher(mpe, 3, { "Nome Social/Fantasia *": "IMP01 Parceiro B", "Fornecedor": "Sim", "Telefone": "(63) 3333-0000" });
  saida["parceiros_gravar_tudo"] = await resposta(await enviar(mpe, "people", ""));

  // 7. MODO fora da lista e chave desconhecida na query: 422 antes de abrir o arquivo
  saida["modo_fora_da_lista"] = await resposta(await enviar(mpe, "people", "?modo=metade"));
  saida["chave_desconhecida"] = await resposta(await enviar(mpe, "people", "?simular=1&lixo=1"));

  // 8. SEM a permissão de criar (o operador não tem people.create): 403 antes de abrir o arquivo
  saida["sem_permissao"] = await resposta(await enviar(mpe, "people", "?simular=1", { ...h.opHeaders(), "content-type": "application/json" }));

  // 9. O QUE FICOU NO BANCO: os registros IMP01, sem id e sem data, com o código, a referência pelo código e a trilha
  const produtos = await admin.query(
    `select p.code, p.description, g.code as grupo, m.symbol as unidade, p.control_stock, p.min_stock, p.reference_price, p.marca, p.is_active,
            (select count(*)::int from erp.registros_globais r where r.organization_id = p.organization_id and r.id_entidade = p.id) as id_global,
            (select array_agg(a.action order by a.id) from erp.audit_logs a where a.organization_id = p.organization_id and a.entity = 'products' and a.entity_id = p.id::text) as auditoria
       from erp.products p left join erp.product_groups g on g.id = p.group_id left join erp.measurement_units m on m.id = p.measurement_id
      where p.organization_id = $1 and p.description like 'IMP01 %' order by p.code`, [org]);
  saida["banco_produtos"] = normal(produtos.rows);
  const pessoas = await admin.query(
    `select code, name, is_client, is_provider, phone,
            (select count(*)::int from erp.registros_globais r where r.organization_id = p.organization_id and r.id_entidade = p.id) as id_global
       from erp.people p where organization_id = $1 and name like 'IMP01 %' order by code`, [org]);
  saida["banco_parceiros"] = normal(pessoas.rows);
  const contas = await admin.query("select code, description from erp.chart_accounts where organization_id = $1 and (description like 'IMP01 %' or code in ('2','9')) order by code", [org]);
  saida["banco_contas"] = normal(contas.rows);
  return trocarEmpresas(saida, empresas) as Record<string, Json>;
}
