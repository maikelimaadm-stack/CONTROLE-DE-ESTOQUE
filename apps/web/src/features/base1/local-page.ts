import { isListOperator } from "@agro/shared";
import { fromParams, isActive } from "./params";
import type { Base1Column, Base1FilterDef, FilterValue, Row } from "./types";

/**
 * PÁGINA LOCAL — o contrato do `fetchPage` do Modelo Base1 sobre linhas JÁ carregadas.
 *
 * O painel mestre-detalhe de Compras abre UM documento e recebe, numa requisição só, TODOS os itens dele
 * (`/api/compras/<segmento>/<id>`). Filtrar, ordenar, buscar e paginar a partir daí é apresentação sobre linhas
 * que já estão na memória: nenhuma consulta nova, nenhuma consulta por linha, nada de N+1.
 *
 * O chip da coluna é o MESMO do modelo base (`Base1FilterDef` → `campo__operador`), e os valores chegam aqui como
 * os parâmetros que o `Base1List` já produziu — por isso a decodificação é a de `fromParams`, não uma segunda
 * gramática de filtro.
 *
 * A comparação segue a família de operador do `@agro/shared`: texto sem acento e sem caixa (o que o usuário digita
 * é o que ele vê na célula), número por valor e data por ISO (`YYYY-MM-DD`) — nunca por texto formatado, que
 * ordenaria "10/2026" antes de "9/2026".
 */

const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const bruto = (c: Base1Column, r: Row) => { const v = r[c.key]; return v === null || v === undefined ? "" : String(v); };
const exibido = (c: Base1Column, r: Row) => (c.text ? c.text(r) : bruto(c, r));

/** Número da célula; `null` quando a célula está vazia ou não é número (comparar com `null` nunca casa). */
const numeroDe = (c: Base1Column, r: Row) => { const t = bruto(c, r).trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

const igual = (c: Base1Column, r: Row, valor: string): boolean => {
  const kind = c.kind ?? "text";
  if (kind === "number") { const n = numeroDe(c, r); return n !== null && n === Number(valor); }
  // enum/ref/boolean comparam o VALOR guardado; texto compara o que está escrito na célula
  if (kind === "text") return normalizar(exibido(c, r)) === normalizar(valor);
  return bruto(c, r) === valor;
};

function casar(f: Base1FilterDef, v: FilterValue, c: Base1Column, r: Row): boolean {
  const kind = f.kind;
  // modo simple não tem operador: é "igual a" (ou "entre" na data com faixa de dois campos)
  const op = f.mode === "simple" ? (kind === "date" && f.range ? "between" : "eq") : v.op;
  const valor = f.mode === "simple" && v.values?.length ? v.values[0]! : v.value;
  if (op === "is_empty") return bruto(c, r).trim() === "";
  if (op === "is_not_empty") return bruto(c, r).trim() !== "";
  if (isListOperator(op)) return (v.values ?? []).some((x) => igual(c, r, x));
  if (op === "between") {
    if (kind === "number") {
      const n = numeroDe(c, r); const a = Number(v.value); const b = Number(v.value2);
      return n !== null && Number.isFinite(a) && Number.isFinite(b) && n >= a && n <= b;
    }
    const alvo = bruto(c, r); const de = v.value; const ate = v.value2 ?? "";
    return Boolean(de) && Boolean(ate) && alvo >= de && alvo <= ate;
  }
  if (kind === "number") {
    const n = numeroDe(c, r); const a = Number(valor);
    if (n === null || !Number.isFinite(a)) return false;
    if (op === "gt") return n > a;
    if (op === "gte") return n >= a;
    if (op === "lt") return n < a;
    if (op === "lte") return n <= a;
    if (op === "ne") return n !== a;
    return n === a;
  }
  if (kind === "date") {
    const alvo = bruto(c, r).slice(0, 10); const a = valor.slice(0, 10);
    if (!alvo || !a) return false;
    if (op === "before") return alvo < a;
    if (op === "after") return alvo > a;
    if (op === "ne") return alvo !== a;
    return alvo === a;
  }
  const texto = normalizar(exibido(c, r)); const procurado = normalizar(valor);
  switch (op) {
    case "contains": return texto.includes(procurado);
    case "not_contains": return !texto.includes(procurado);
    case "starts_with": return texto.startsWith(procurado);
    case "ends_with": return texto.endsWith(procurado);
    case "ne": return texto !== procurado;
    default: return texto === procurado;
  }
}

/** As linhas que passam pelos filtros da faixa (os mesmos chips do modelo base). */
export function filtrarLinhas(rows: Row[], columns: Base1Column[], filters: Base1FilterDef[], params: Record<string, string>): Row[] {
  const valores = fromParams(filters, params);
  const porChave = new Map(columns.map((c) => [c.key, c]));
  const ativos = filters.filter((f) => porChave.has(f.key) && isActive(f, valores[f.key]));
  if (!ativos.length) return rows;
  return rows.filter((r) => ativos.every((f) => casar(f, valores[f.key]!, porChave.get(f.key)!, r)));
}

const comparar = (c: Base1Column, a: Row, b: Row): number => {
  if (c.kind === "number") return (numeroDe(c, a) ?? -Number.MAX_VALUE) - (numeroDe(c, b) ?? -Number.MAX_VALUE);
  return exibido(c, a).localeCompare(exibido(c, b), "pt-BR", { numeric: true, sensitivity: "base" });
};

export interface PaginaLocal {
  rows: Row[];
  columns: Base1Column[];
  filters: Base1FilterDef[];
  /** parâmetros já serializados pelo Base1List (`campo__operador=valor`) */
  params: Record<string, string>;
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Filtro → busca → ordenação → página, na mesma ordem em que o servidor faria. */
export function paginaLocal({ rows, columns, filters, params, search, sort, dir, page, pageSize }: PaginaLocal): { items: Row[]; total: number } {
  let out = filtrarLinhas(rows, columns, filters, params);
  const termo = search ? normalizar(search) : "";
  if (termo) out = out.filter((r) => columns.some((c) => normalizar(exibido(c, r)).includes(termo)));
  const colunaDaOrdem = sort ? columns.find((c) => c.key === sort) : undefined;
  if (colunaDaOrdem) { const sinal = dir === "desc" ? -1 : 1; out = [...out].sort((a, b) => sinal * comparar(colunaDaOrdem, a, b)); }
  const total = out.length;
  const inicio = Math.max(0, (page - 1) * pageSize);
  return { items: out.slice(inicio, inicio + pageSize), total };
}
