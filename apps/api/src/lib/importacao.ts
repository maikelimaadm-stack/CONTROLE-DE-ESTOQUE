/**
 * Importação de cadastros por modelo XLSX (CADASTROS-IMPORTACAO).
 *
 * O MODELO nasce do Resource Registry (`packages/domain/src/resources/registries.ts`), que é a fonte única
 * dos campos: toda coluna editável do formulário vira coluna do modelo, com o mesmo rótulo. Obrigatório
 * vem destacado; referência, opção fixa e Sim/Não vêm como LISTA com os valores que existem na organização
 * no momento do download (aba "Listas").
 *
 * A IMPORTAÇÃO não confia no modelo — o arquivo pode ter sido editado, copiado de outro lugar ou baixado
 * antes de um cadastro mudar. Cada linha é traduzida (rótulo → id, "Sim" → true, "1.234,56" → "1234.56")
 * e passa pelo MESMO `createOne` da tela, com todas as regras do cadastro. Uma transação para o arquivo
 * inteiro, um savepoint por linha para listar TODOS os erros; havendo qualquer erro, nada é gravado.
 * Nunca atualiza registro existente: importar é criar.
 */
import ExcelJS from "exceljs";
import { ZodError } from "zod";
import { DomainError } from "@agro/shared";
import { getResource, type FieldDef, type ResourceDef } from "@agro/domain";
import { ident } from "./sql.js";
import { fromPgError } from "./errors.js";
import type { ServiceCtx } from "./context.js";

export const IMPORTACAO_LINHAS_MAXIMO = 5000;
const ABA_DADOS = "Dados";
const ABA_LISTAS = "Listas";
const SIM = "Sim"; const NAO = "Não";

/** Colunas do modelo: todo campo editável do formulário, na ordem da definição. */
export function camposImportaveis(def: ResourceDef): FieldDef[] {
  return def.fields.filter((f) => !f.readOnly && f.type !== "json");
}

/** Cabeçalho da coluna: o rótulo da tela; `*` marca obrigatório. Rótulo repetido ganha o nome técnico. */
export function cabecalhos(def: ResourceDef): { campo: FieldDef; titulo: string; chave: string }[] {
  const campos = camposImportaveis(def);
  const contagem = new Map<string, number>();
  for (const f of campos) contagem.set(f.label, (contagem.get(f.label) ?? 0) + 1);
  return campos.map((f) => {
    const chave = (contagem.get(f.label) ?? 0) > 1 ? `${f.label} [${f.name}]` : f.label;
    return { campo: f, chave, titulo: f.required ? `${chave} *` : chave };
  });
}

const normal = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

interface Referencia { exibicao: string[]; porTexto: Map<string, string[]> }

/** Valores de um cadastro referenciado, como aparecem na lista e como são reconhecidos na importação. */
async function carregarReferencia(ctx: ServiceCtx, alvo: ResourceDef): Promise<Referencia> {
  const cols = await ctx.tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='erp' and table_name=$1", [alvo.table]);
  const existe = new Set(cols.rows.map((c) => c.column_name));
  const where: string[] = [];
  const params: unknown[] = [];
  if (existe.has("organization_id")) { params.push(ctx.orgId); where.push(alvo.reference || alvo.sharedDefaults ? `(organization_id is null or organization_id=$${params.length})` : `organization_id=$${params.length}`); }
  if (alvo.softDelete && existe.has("deleted_at")) where.push("deleted_at is null");
  if (existe.has("is_active")) where.push("is_active");
  const temCodigo = existe.has("code");
  const r = await ctx.tx.query<{ id: string; label: string | null; code: string | null }>(
    `select id::text, ${ident(alvo.labelField)}::text as label, ${temCodigo ? "code::text" : "null::text"} as code from erp.${ident(alvo.table)} ${where.length ? "where " + where.join(" and ") : ""} order by ${temCodigo ? "code, " : ""}2 limit ${IMPORTACAO_LINHAS_MAXIMO}`, params);
  const ref: Referencia = { exibicao: [], porTexto: new Map() };
  for (const x of r.rows) adicionarReferencia(ref, x.id, x.label, x.code);
  return ref;
}

function adicionarReferencia(ref: Referencia, id: string, label: string | null, code: string | null) {
  const exibe = code ? `${code} - ${label ?? ""}` : label ?? "";
  if (!exibe) return;
  ref.exibicao.push(exibe);
  for (const t of new Set([exibe, label ?? "", code ?? ""].filter(Boolean).map(normal))) {
    const ids = ref.porTexto.get(t) ?? []; if (!ids.includes(id)) ids.push(id); ref.porTexto.set(t, ids);
  }
}

/**
 * O ExcelJS aplica validação a uma FAIXA inteira (uma regra só no XML, em vez de uma por célula), mas a
 * tipagem publicada não declara a propriedade. Interface estreita, sem `any`.
 */
interface ComValidacaoEmFaixa { dataValidations: { add(faixa: string, regra: ExcelJS.DataValidation): void } }

// ------------------------------------------------------------------ modelo

export async function gerarModelo(ctx: ServiceCtx, def: ResourceDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const dados = wb.addWorksheet(ABA_DADOS, { views: [{ state: "frozen", ySplit: 1 }] });
  const listas = wb.addWorksheet(ABA_LISTAS);
  const instrucoes = wb.addWorksheet("Instruções");
  const cols = cabecalhos(def);
  dados.columns = cols.map((c) => ({ header: c.titulo, key: c.campo.name, width: Math.max(14, Math.min(40, c.titulo.length + 4)) }));
  let colunaLista = 0;
  const letra = (n: number) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  for (const [i, c] of cols.entries()) {
    const f = c.campo;
    const cab = dados.getRow(1).getCell(i + 1);
    cab.font = { bold: true, color: { argb: f.required ? "FFFFFFFF" : "FF1F2937" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f.required ? "FFC62828" : "FFE5E7EB" } };
    let valores: string[] | null = null; let dica = f.help ?? "";
    if (f.type === "ref" && f.ref) { const alvo = getResource(f.ref.resource); if (alvo) { valores = (await carregarReferencia(ctx, alvo)).exibicao; dica = `${dica ? dica + " " : ""}Escolha da lista (cadastros de ${alvo.labelPlural} existentes).`; } }
    else if (f.type === "select" && f.options) { valores = f.options.map((o) => o.label); dica = `${dica ? dica + " " : ""}Escolha da lista.`; }
    else if (f.type === "boolean") { valores = [SIM, NAO]; dica = `${dica ? dica + " " : ""}Sim ou Não.`; }
    else if (f.type === "date") dica = `${dica ? dica + " " : ""}Data no formato DD/MM/AAAA.`;
    else if (["money", "quantity", "number", "percent"].includes(f.type)) dica = `${dica ? dica + " " : ""}Número (vírgula decimal).`;
    else if (f.type === "tags" && f.options) { dica = `${dica ? dica + " " : ""}Separe por ";": ${f.options.map((o) => o.label).join("; ")}.`; }
    if (f.required) dica = `OBRIGATÓRIO. ${dica}`;
    if (dica.trim()) cab.note = dica.trim();
    if (valores) {
      colunaLista += 1;
      const col = letra(colunaLista);
      listas.getCell(`${col}1`).value = c.chave; listas.getCell(`${col}1`).font = { bold: true };
      valores.forEach((v, k) => { listas.getCell(`${col}${k + 2}`).value = v; });
      listas.getColumn(colunaLista).width = 40;
      const fim = Math.max(2, valores.length + 1);
      const coluna = letra(i + 1);
      (dados as unknown as ComValidacaoEmFaixa).dataValidations.add(`${coluna}2:${coluna}${IMPORTACAO_LINHAS_MAXIMO + 1}`, {
        type: "list", allowBlank: !f.required, formulae: [`${ABA_LISTAS}!$${col}$2:$${col}$${fim}`],
        showErrorMessage: true, errorStyle: "stop", errorTitle: c.chave, error: valores.length ? "Escolha um valor da lista." : `Não há ${c.chave.toLowerCase()} cadastrado(a). Cadastre antes de importar.`,
      });
    }
  }
  instrucoes.getColumn(1).width = 110;
  const linhas = [
    `Modelo de importação — ${def.labelPlural}`,
    "",
    `1. Preencha a aba "${ABA_DADOS}", uma linha por registro (até ${IMPORTACAO_LINHAS_MAXIMO}). Não altere nem reordene o cabeçalho.`,
    "2. Colunas em VERMELHO com * são obrigatórias.",
    `3. Colunas com lista só aceitam valores da lista (aba "${ABA_LISTAS}"), que traz os cadastros existentes no momento do download. Cadastrou algo depois? Baixe o modelo de novo.`,
    "4. Sim/Não, opções e datas (DD/MM/AAAA) seguem o texto da tela.",
    "5. Ao importar, o sistema mostra a prévia com os erros linha a linha. Se houver qualquer erro, NADA é gravado.",
    "6. Importar sempre CRIA registros; não altera cadastros existentes. Código repetido é recusado.",
    ...(def.tree ? ["7. Cadastro em árvore: o antecessor pode ser um registro existente ou uma linha ANTERIOR deste mesmo arquivo."] : []),
  ];
  linhas.forEach((t, k) => { const c = instrucoes.getCell(`A${k + 1}`); c.value = t; if (k === 0) c.font = { bold: true, size: 13 }; });
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

// ------------------------------------------------------------------ importação

export interface ErroImportacao { linha: number; coluna: string | null; mensagem: string }
export interface ResultadoImportacao { linhas: number; gravadas: number; erros: ErroImportacao[]; simulacao: boolean }

function texto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return texto(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

function numero(v: ExcelJS.CellValue): string | null {
  if (typeof v === "number") return String(v);
  const s = texto(v).replace(/\s/g, "");
  if (!s) return null;
  const n = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
}

function data(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = texto(v);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Mensagem de um erro do `createOne`, com o campo quando houver. */
function errosDaGravacao(e: unknown, rotulo: (campo: string) => string): { coluna: string | null; mensagem: string }[] {
  if (e instanceof ZodError) return e.issues.map((i) => ({ coluna: i.path[0] ? rotulo(String(i.path[0])) : null, mensagem: i.message }));
  const d = e instanceof DomainError ? e : fromPgError(e);
  if (d) {
    const det = Array.isArray(d.details) ? (d.details as { path?: unknown; message?: string }[]) : [];
    if (det.length) return det.map((x) => ({ coluna: Array.isArray(x.path) && x.path[0] ? rotulo(String(x.path[0])) : null, mensagem: x.message ?? d.message }));
    return [{ coluna: null, mensagem: d.message }];
  }
  throw e;
}

type Criar = (ctx: ServiceCtx, def: ResourceDef, body: unknown) => Promise<Record<string, unknown>>;

export async function importarPlanilha(ctx: ServiceCtx, def: ResourceDef, arquivo: Buffer, criar: Criar, simulacao: boolean): Promise<ResultadoImportacao> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(arquivo as unknown as ArrayBuffer); } catch { return { linhas: 0, gravadas: 0, simulacao, erros: [{ linha: 0, coluna: null, mensagem: "Arquivo inválido: envie o modelo em XLSX." }] }; }
  const ws = wb.getWorksheet(ABA_DADOS) ?? wb.worksheets[0];
  if (!ws) return { linhas: 0, gravadas: 0, simulacao, erros: [{ linha: 0, coluna: null, mensagem: "Planilha vazia." }] };
  const cols = cabecalhos(def);
  const porChave = new Map(cols.map((c) => [normal(c.chave), c]));
  // cabeçalho: identifica cada coluna pelo rótulo; coluna desconhecida é RECUSADA (não descartada em silêncio)
  const mapa = new Map<number, (typeof cols)[number]>();
  const erros: ErroImportacao[] = [];
  ws.getRow(1).eachCell((cell, n) => {
    const t = texto(cell.value).replace(/\s*\*$/, "");
    if (!t) return;
    const c = porChave.get(normal(t));
    if (c) mapa.set(n, c); else erros.push({ linha: 1, coluna: t, mensagem: `Coluna desconhecida para ${def.labelPlural}. Baixe o modelo atualizado.` });
  });
  const presentes = new Set([...mapa.values()].map((c) => c.campo.name));
  for (const c of cols) if (c.campo.required && !presentes.has(c.campo.name)) erros.push({ linha: 1, coluna: c.chave, mensagem: "Coluna obrigatória ausente no arquivo." });
  if (erros.length) return { linhas: 0, gravadas: 0, simulacao, erros };

  const refs = new Map<string, Referencia>();
  for (const c of cols) if (c.campo.type === "ref" && c.campo.ref && !refs.has(c.campo.ref.resource)) { const alvo = getResource(c.campo.ref.resource); if (alvo) refs.set(c.campo.ref.resource, await carregarReferencia(ctx, alvo)); }
  const rotulo = (campo: string) => cols.find((c) => c.campo.name === campo)?.chave ?? campo;

  let linhas = 0; let gravadas = 0;
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const bruto = [...mapa.entries()].map(([col, c]) => ({ c, v: row.getCell(col).value }));
    if (bruto.every((x) => texto(x.v) === "")) continue;
    linhas += 1;
    if (linhas > IMPORTACAO_LINHAS_MAXIMO) { erros.push({ linha: n, coluna: null, mensagem: `Limite de ${IMPORTACAO_LINHAS_MAXIMO} linhas por arquivo.` }); break; }
    const corpo: Record<string, unknown> = {};
    const errosDaLinha: ErroImportacao[] = [];
    for (const { c, v } of bruto) {
      const f = c.campo; const t = texto(v);
      if (t === "") { if (f.required) errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: "Obrigatório." }); continue; }
      const recusa = (m: string) => errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: m });
      switch (f.type) {
        case "ref": {
          const ref = f.ref ? refs.get(f.ref.resource) : undefined;
          const ids = ref?.porTexto.get(normal(t)) ?? [];
          if (ids.length === 1) corpo[f.name] = ids[0]; else if (ids.length > 1) recusa(`"${t}" é ambíguo: há mais de um cadastro com esse nome. Use o valor da lista (com o código).`); else recusa(`"${t}" não existe no cadastro. Use um valor da lista.`);
          break;
        }
        case "select": { const o = f.options?.find((x) => normal(x.label) === normal(t) || normal(x.value) === normal(t)); if (o) corpo[f.name] = o.value; else recusa(`"${t}" não é uma opção válida.`); break; }
        case "boolean": { const b = normal(t); if (["sim", "s", "true", "1"].includes(b)) corpo[f.name] = true; else if (["não", "nao", "n", "false", "0"].includes(b)) corpo[f.name] = false; else recusa("Use Sim ou Não."); break; }
        case "date": { const d = data(v); if (d) corpo[f.name] = d; else recusa("Data inválida (use DD/MM/AAAA)."); break; }
        case "integer": { const x = numero(v); if (x !== null && /^-?\d+$/.test(x)) corpo[f.name] = Number(x); else recusa("Número inteiro inválido."); break; }
        case "number": case "money": case "quantity": case "percent": { const x = numero(v); if (x !== null) corpo[f.name] = x; else recusa("Número inválido."); break; }
        case "tags": { const partes = t.split(/[;,]/).map((p) => p.trim()).filter(Boolean); const vals = partes.map((p) => f.options?.find((o) => normal(o.label) === normal(p) || normal(o.value) === normal(p))?.value ?? (f.options ? null : p)); if (vals.some((x) => x === null)) recusa("Valor fora da lista."); else corpo[f.name] = vals; break; }
        default: corpo[f.name] = t;
      }
    }
    if (errosDaLinha.length) { erros.push(...errosDaLinha); continue; }
    await ctx.tx.query("savepoint importacao_linha");
    try {
      const criado = await criar(ctx, def, corpo);
      await ctx.tx.query("release savepoint importacao_linha");
      gravadas += 1;
      // registro criado nesta importação passa a valer como referência para as linhas seguintes (antecessor)
      const propria = refs.get(def.key);
      if (propria) adicionarReferencia(propria, String(criado["id"]), (criado[def.labelField] as string | null) ?? null, (criado["code"] as string | null) ?? null);
    } catch (e) {
      await ctx.tx.query("rollback to savepoint importacao_linha");
      for (const x of errosDaGravacao(e, rotulo)) erros.push({ linha: n, ...x });
    }
  }
  if (!linhas && !erros.length) erros.push({ linha: 0, coluna: null, mensagem: "Nenhuma linha preenchida." });
  return { linhas, gravadas: erros.length ? 0 : gravadas, erros, simulacao };
}
