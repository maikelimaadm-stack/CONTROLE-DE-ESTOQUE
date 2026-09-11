/**
 * Personalização de telas ("modelo base"): preferências de listagem, layout de formulário e filtros avançados.
 *
 * Este módulo é a única fonte de verdade do formato dos documentos de preferência. É importado pela API (validação
 * no servidor antes de persistir) e pelo frontend (normalização antes de renderizar), então uma alteração aqui
 * propaga para todas as telas que usam o modelo.
 */

export const PREFERENCES_MAX_BYTES = 256 * 1024;
export const LIST_PREFERENCES_VERSION = 1;
export const FORM_LAYOUT_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------
// Filtros avançados (operadores)
// ---------------------------------------------------------------------------------------------------------------
export type FilterKind = "text" | "number" | "date" | "enum" | "boolean" | "ref";
export interface FilterOperator { value: string; label: string; /** 0 = sem valor, 1 = um valor, 2 = intervalo */ arity: 0 | 1 | 2 }

export const FILTER_OPERATORS: Record<FilterKind, FilterOperator[]> = {
  text: [
    { value: "contains", label: "Contém", arity: 1 }, { value: "not_contains", label: "Não contém", arity: 1 }, { value: "eq", label: "Igual a", arity: 1 },
    { value: "starts_with", label: "Começa com", arity: 1 }, { value: "ends_with", label: "Termina com", arity: 1 }, { value: "in", label: "Está na lista", arity: 1 },
    { value: "is_empty", label: "Está vazio", arity: 0 }, { value: "is_not_empty", label: "Não está vazio", arity: 0 }
  ],
  number: [
    { value: "eq", label: "Igual a", arity: 1 }, { value: "ne", label: "Diferente de", arity: 1 }, { value: "gt", label: "Maior que", arity: 1 }, { value: "gte", label: "Maior ou igual", arity: 1 },
    { value: "lt", label: "Menor que", arity: 1 }, { value: "lte", label: "Menor ou igual", arity: 1 }, { value: "between", label: "Entre", arity: 2 }, { value: "in", label: "Está na lista", arity: 1 },
    { value: "is_empty", label: "Está vazio", arity: 0 }, { value: "is_not_empty", label: "Não está vazio", arity: 0 }
  ],
  date: [
    { value: "eq", label: "Em", arity: 1 }, { value: "before", label: "Antes de", arity: 1 }, { value: "after", label: "Depois de", arity: 1 }, { value: "between", label: "Entre", arity: 2 },
    { value: "today", label: "Hoje", arity: 0 }, { value: "yesterday", label: "Ontem", arity: 0 }, { value: "this_week", label: "Esta semana", arity: 0 },
    { value: "this_month", label: "Este mês", arity: 0 }, { value: "last_month", label: "Mês passado", arity: 0 }, { value: "this_year", label: "Este ano", arity: 0 },
    { value: "is_empty", label: "Está vazio", arity: 0 }, { value: "is_not_empty", label: "Não está vazio", arity: 0 }
  ],
  enum: [{ value: "eq", label: "Igual a", arity: 1 }, { value: "ne", label: "Diferente de", arity: 1 }, { value: "in", label: "Está na lista", arity: 1 }, { value: "is_empty", label: "Está vazio", arity: 0 }, { value: "is_not_empty", label: "Não está vazio", arity: 0 }],
  boolean: [{ value: "eq", label: "Igual a", arity: 1 }],
  ref: [{ value: "eq", label: "Igual a", arity: 1 }, { value: "ne", label: "Diferente de", arity: 1 }, { value: "in", label: "Está na lista", arity: 1 }, { value: "is_empty", label: "Está vazio", arity: 0 }, { value: "is_not_empty", label: "Não está vazio", arity: 0 }]
};

/** Mapeia o tipo de campo declarativo para a família de operadores. */
export function filterKindOf(fieldType: string): FilterKind {
  switch (fieldType) {
    case "number": case "integer": case "money": case "quantity": case "percent": return "number";
    case "date": return "date";
    case "select": case "tags": return "enum";
    case "boolean": return "boolean";
    case "ref": return "ref";
    default: return "text";
  }
}
export const defaultOperatorFor = (kind: FilterKind): string => kind === "text" ? "contains" : "eq";
export const operatorArity = (kind: FilterKind, op: string): 0 | 1 | 2 => FILTER_OPERATORS[kind].find((o) => o.value === op)?.arity ?? 1;
export const isValidOperator = (kind: FilterKind, op: string): boolean => FILTER_OPERATORS[kind].some((o) => o.value === op);

/** Separador entre campo e operador na query string: `campo__operador=valor`. Intervalos usam `valor|valor2`. */
export const FILTER_OP_SEPARATOR = "__";
export const FILTER_RANGE_SEPARATOR = "|";
export function parseFilterKey(key: string): { field: string; op: string } | null {
  const i = key.lastIndexOf(FILTER_OP_SEPARATOR);
  if (i <= 0) return null;
  const field = key.slice(0, i); const op = key.slice(i + FILTER_OP_SEPARATOR.length);
  if (!/^[a-z_][a-z0-9_]*$/.test(field) || !/^[a-z_]+$/.test(op)) return null;
  return { field, op };
}
export const filterKey = (field: string, op: string) => `${field}${FILTER_OP_SEPARATOR}${op}`;
export function encodeRange(a: string, b: string) { return `${a}${FILTER_RANGE_SEPARATOR}${b}`; }
/** Listas de valores (operador `in`) usam o separador de unidade (U+001F), que não ocorre em valores digitados. */
export const FILTER_LIST_SEPARATOR = "\u001f";
export const encodeList = (values: string[]) => values.join(FILTER_LIST_SEPARATOR);
export const decodeList = (v: string): string[] => v.split(FILTER_LIST_SEPARATOR).filter((x) => x !== "");
/** Operador que recebe uma lista de valores (seleção múltipla no chip de filtro). */
export const isListOperator = (op: string) => op === "in";
export function decodeRange(v: string): [string, string] { const i = v.indexOf(FILTER_RANGE_SEPARATOR); return i < 0 ? [v, ""] : [v.slice(0, i), v.slice(i + 1)]; }

/** Intervalo de datas (ISO) para operadores relativos, em relação a `today` (AAAA-MM-DD). */
export function relativeDateRange(op: string, today: string): [string, string] | null {
  const d = new Date(today + "T00:00:00Z");
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (op) {
    case "today": return [today, today];
    case "yesterday": { const p = new Date(d); p.setUTCDate(p.getUTCDate() - 1); return [iso(p), iso(p)]; }
    case "this_week": { const s = new Date(d); s.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6); return [iso(s), iso(e)]; }
    case "this_month": return [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m + 1, 0)))];
    case "last_month": return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
    case "this_year": return [`${y}-01-01`, `${y}-12-31`];
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Preferências de listagem (colunas, ordenação, página, cards, filtros)
// ---------------------------------------------------------------------------------------------------------------
export interface SavedFilter { name: string; values: Record<string, string> }
export interface ListPreferences {
  version: number;
  columns: { visible?: string[]; order?: string[]; widths?: Record<string, number>; frozen?: number };
  sort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  view: { mode: "table" | "cards"; cardFields?: string[]; cardsPerRow?: 1 | 2 | 3 | 4; density?: "compact" | "normal" };
  filters: { visible?: string[]; operators?: Record<string, string>; saved?: SavedFilter[]; defaultSaved?: string | null };
  /** pesquisa: colunas exibidas como linhas de detalhe nos resultados da lista suspensa (máx. SEARCH_DROPDOWN_MAX_FIELDS) */
  search?: { fields?: string[] };
  meta?: { revision?: number; updatedAt?: string };
}
/** Máximo de campos de detalhe nos resultados da pesquisa (como no MG: 5). */
export const SEARCH_DROPDOWN_MAX_FIELDS = 5;
export interface ListKnown { columns?: string[]; filters?: string[]; filterKinds?: Record<string, FilterKind> }
export const LIST_PAGE_SIZES = [10, 20, 30, 50, 80, 100, 200, 300, 400, 500, 1000] as const;
/** Quantidade de registros por carregamento no rodapé do modelo base (como no MG: 100…1000). */
export const BASE1_PAGE_SIZES = [100, 200, 300, 400, 500, 1000] as const;
export const BASE1_DEFAULT_PAGE_SIZE = 100;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown, known?: string[], max = 200): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) { if (typeof x !== "string" || !x || out.includes(x)) continue; if (known && !known.includes(x)) continue; out.push(x); if (out.length >= max) break; }
  return out;
};

export function defaultListPreferences(): ListPreferences { return { version: LIST_PREFERENCES_VERSION, columns: {}, view: { mode: "table" }, filters: {} }; }

/** Normaliza um documento de preferências de listagem, descartando o que for inválido ou desconhecido. */
export function normalizeListPreferences(raw: unknown, known: ListKnown = {}): ListPreferences {
  const d = defaultListPreferences();
  if (!isObj(raw)) return d;
  const cols = isObj(raw["columns"]) ? raw["columns"] : {};
  d.columns.visible = strList(cols["visible"], known.columns);
  d.columns.order = strList(cols["order"], known.columns);
  if (isObj(cols["widths"])) { const w: Record<string, number> = {}; for (const [k, v] of Object.entries(cols["widths"])) if (typeof v === "number" && v >= 40 && v <= 1200 && (!known.columns || known.columns.includes(k))) w[k] = Math.round(v); d.columns.widths = w; }
  if (typeof cols["frozen"] === "number" && cols["frozen"] >= 0) d.columns.frozen = Math.min(30, Math.round(cols["frozen"]));
  const sort = raw["sort"];
  if (isObj(sort) && typeof sort["key"] === "string" && (sort["dir"] === "asc" || sort["dir"] === "desc") && (!known.columns || known.columns.includes(sort["key"]))) d.sort = { key: sort["key"], dir: sort["dir"] };
  if (typeof raw["pageSize"] === "number" && (LIST_PAGE_SIZES as readonly number[]).includes(raw["pageSize"])) d.pageSize = raw["pageSize"];
  const view = isObj(raw["view"]) ? raw["view"] : {};
  d.view.mode = view["mode"] === "cards" ? "cards" : "table";
  d.view.cardFields = strList(view["cardFields"], known.columns, 12);
  if (view["cardsPerRow"] === 1 || view["cardsPerRow"] === 2 || view["cardsPerRow"] === 3 || view["cardsPerRow"] === 4) d.view.cardsPerRow = view["cardsPerRow"];
  if (view["density"] === "compact" || view["density"] === "normal") d.view.density = view["density"];
  const fl = isObj(raw["filters"]) ? raw["filters"] : {};
  d.filters.visible = strList(fl["visible"], known.filters);
  if (isObj(fl["operators"])) { const o: Record<string, string> = {}; for (const [k, v] of Object.entries(fl["operators"])) { if (typeof v !== "string") continue; if (known.filters && !known.filters.includes(k)) continue; const kind = known.filterKinds?.[k]; if (kind && !isValidOperator(kind, v)) continue; o[k] = v; } d.filters.operators = o; }
  if (Array.isArray(fl["saved"])) {
    const s: SavedFilter[] = [];
    for (const x of fl["saved"]) { if (!isObj(x) || typeof x["name"] !== "string" || !x["name"].trim() || !isObj(x["values"])) continue; const values: Record<string, string> = {}; for (const [k, v] of Object.entries(x["values"])) if (typeof v === "string" && v !== "" && /^[a-z_][a-z0-9_]*$/.test(k)) values[k] = v.slice(0, 500); if (s.some((y) => y.name === x["name"])) continue; s.push({ name: x["name"].trim().slice(0, 60), values }); if (s.length >= 50) break; }
    d.filters.saved = s;
  }
  if (typeof fl["defaultSaved"] === "string" && d.filters.saved?.some((s) => s.name === fl["defaultSaved"])) d.filters.defaultSaved = fl["defaultSaved"];
  const se = isObj(raw["search"]) ? raw["search"] : {};
  const sfields = strList(se["fields"], known.columns); if (sfields) d.search = { fields: sfields.slice(0, SEARCH_DROPDOWN_MAX_FIELDS) };
  if (isObj(raw["meta"])) d.meta = { revision: typeof raw["meta"]["revision"] === "number" ? raw["meta"]["revision"] : undefined, updatedAt: typeof raw["meta"]["updatedAt"] === "string" ? raw["meta"]["updatedAt"] : undefined };
  return d;
}

/** Aplica visibilidade e ordem de colunas preservando a ordem padrão para colunas não mencionadas. */
export function applyColumnPreferences<T extends { key: string }>(columns: T[], prefs: ListPreferences["columns"]): T[] {
  const visible = prefs.visible?.length ? columns.filter((c) => prefs.visible!.includes(c.key)) : columns;
  if (!prefs.order?.length) return visible;
  const rank = new Map(prefs.order.map((k, i) => [k, i]));
  return [...visible].sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
}

// ---------------------------------------------------------------------------------------------------------------
// Layout de formulário (painéis → cards → linhas → campos)
// ---------------------------------------------------------------------------------------------------------------
export interface LayoutPanel { id: string; label: string; order: number; hidden?: boolean }
export interface LayoutRow { id: string; fieldIds: string[] }
export interface LayoutCard { id: string; panelId: string; label: string; order: number; colSpan: 6 | 12; collapsible?: boolean; rows: LayoutRow[] }
export interface FormLayout {
  version: number;
  panels: LayoutPanel[];
  cards: LayoutCard[];
  hiddenFieldIds: string[];
  lockedFieldIds: string[];
  requiredFieldIds: string[];
  fieldSizes: Record<string, number>;
  fieldLabels: Record<string, string>;
  fieldDefaultValues: Record<string, unknown>;
  meta?: { revision?: number; updatedAt?: string };
}
export interface LayoutFieldInfo { id: string; label: string; section?: string; span?: number; required?: boolean; readOnly?: boolean }
export const MAX_FIELDS_PER_ROW: Record<6 | 12, number> = { 12: 7, 6: 4 };
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "geral";

/** A partir deste número de campos o formulário padrão é dividido em abas (painéis): as duas primeiras seções ficam em "Principal" e cada seção seguinte vira uma aba. */
export const FORM_TABS_THRESHOLD = 16;

/** Layout padrão derivado da definição declarativa: um card por seção, linhas por soma de largura (12 colunas); formulários grandes ganham abas por seção. */
export function buildDefaultFormLayout(fields: LayoutFieldInfo[]): FormLayout {
  const sections = [...new Set(fields.map((f) => f.section ?? ""))];
  const tabbed = fields.length >= FORM_TABS_THRESHOLD && sections.length > 2;
  const panels: LayoutPanel[] = [{ id: "principal", label: "Principal", order: 1 }];
  const panelOf = (s: string, i: number) => { if (!tabbed || i < 2) return "principal"; const id = `p_${slug(s)}`; if (!panels.some((p) => p.id === id)) panels.push({ id, label: s || "Outros", order: panels.length + 1 }); return id; };
  const cards: LayoutCard[] = sections.map((s, i) => {
    const fs = fields.filter((f) => (f.section ?? "") === s);
    const rows: LayoutRow[] = []; let cur: string[] = []; let width = 0;
    for (const f of fs) { const w = f.span ?? 3; if (width + w > 12 || cur.length >= MAX_FIELDS_PER_ROW[12]) { rows.push({ id: `r${rows.length + 1}`, fieldIds: cur }); cur = []; width = 0; } cur.push(f.id); width += w; }
    if (cur.length) rows.push({ id: `r${rows.length + 1}`, fieldIds: cur });
    return { id: s ? slug(s) : "geral", panelId: panelOf(s, i), label: s || "Dados", order: i + 1, colSpan: 12, rows };
  });
  const fieldSizes: Record<string, number> = {}; for (const f of fields) if (f.span) fieldSizes[f.id] = f.span;
  return { version: FORM_LAYOUT_VERSION, panels, cards, hiddenFieldIds: [], lockedFieldIds: [], requiredFieldIds: [], fieldSizes, fieldLabels: {}, fieldDefaultValues: {} };
}

export interface LayoutIssue { path: string; message: string }
/**
 * Normaliza e valida um layout. Regras: ids únicos; card só em painel existente; campo aparece uma única vez;
 * limite de campos por linha conforme largura do card; campos conhecidos não posicionados e não ocultos são
 * anexados a um card "Outros campos" (nunca some campo por engano); campos desconhecidos são descartados.
 */
export function normalizeFormLayout(raw: unknown, fields: LayoutFieldInfo[]): { layout: FormLayout; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = [];
  const known = new Set(fields.map((f) => f.id));
  if (!isObj(raw)) return { layout: buildDefaultFormLayout(fields), issues: [{ path: "", message: "Layout inválido: usando padrão" }] };
  const out: FormLayout = { version: FORM_LAYOUT_VERSION, panels: [], cards: [], hiddenFieldIds: [], lockedFieldIds: [], requiredFieldIds: [], fieldSizes: {}, fieldLabels: {}, fieldDefaultValues: {} };
  const panelIds = new Set<string>();
  for (const [i, p] of (Array.isArray(raw["panels"]) ? raw["panels"] : []).entries()) {
    if (!isObj(p) || typeof p["id"] !== "string" || !p["id"]) { issues.push({ path: `panels[${i}]`, message: "Painel sem id" }); continue; }
    if (panelIds.has(p["id"])) { issues.push({ path: `panels[${i}]`, message: `Painel duplicado: ${p["id"]}` }); continue; }
    panelIds.add(p["id"]);
    out.panels.push({ id: p["id"], label: typeof p["label"] === "string" && p["label"] ? p["label"].slice(0, 60) : p["id"], order: typeof p["order"] === "number" ? p["order"] : i + 1, hidden: p["hidden"] === true || undefined });
  }
  if (!out.panels.length) { out.panels.push({ id: "principal", label: "Principal", order: 1 }); panelIds.add("principal"); }
  const placed = new Set<string>(); const cardIds = new Set<string>();
  for (const [i, c] of (Array.isArray(raw["cards"]) ? raw["cards"] : []).entries()) {
    if (!isObj(c) || typeof c["id"] !== "string" || !c["id"]) { issues.push({ path: `cards[${i}]`, message: "Card sem id" }); continue; }
    if (cardIds.has(c["id"])) { issues.push({ path: `cards[${i}]`, message: `Card duplicado: ${c["id"]}` }); continue; }
    const panelId = typeof c["panelId"] === "string" && panelIds.has(c["panelId"]) ? c["panelId"] : out.panels[0]!.id;
    if (c["panelId"] !== panelId) issues.push({ path: `cards[${i}].panelId`, message: "Painel desconhecido; card movido para o primeiro painel" });
    const colSpan: 6 | 12 = c["colSpan"] === 6 ? 6 : 12;
    const rows: LayoutRow[] = [];
    for (const [j, r] of (Array.isArray(c["rows"]) ? c["rows"] : []).entries()) {
      const ids = isObj(r) ? strList(r["fieldIds"]) ?? [] : [];
      const keep: string[] = [];
      for (const id of ids) { if (!known.has(id)) { issues.push({ path: `cards[${i}].rows[${j}]`, message: `Campo desconhecido descartado: ${id}` }); continue; } if (placed.has(id)) { issues.push({ path: `cards[${i}].rows[${j}]`, message: `Campo repetido descartado: ${id}` }); continue; } placed.add(id); keep.push(id); }
      // reempacota respeitando o máximo por linha
      const max = MAX_FIELDS_PER_ROW[colSpan];
      for (let k = 0; k < keep.length; k += max) rows.push({ id: rows.length ? `r${rows.length + 1}` : (isObj(r) && typeof r["id"] === "string" ? r["id"] : "r1"), fieldIds: keep.slice(k, k + max) });
      if (keep.length > max) issues.push({ path: `cards[${i}].rows[${j}]`, message: `Linha com mais de ${max} campos foi dividida` });
    }
    cardIds.add(c["id"]);
    out.cards.push({ id: c["id"], panelId, label: typeof c["label"] === "string" ? c["label"].slice(0, 60) : c["id"], order: typeof c["order"] === "number" ? c["order"] : i + 1, colSpan, collapsible: c["collapsible"] === true || undefined, rows });
  }
  out.hiddenFieldIds = (strList(raw["hiddenFieldIds"], [...known]) ?? []).filter((id) => !fields.find((f) => f.id === id)?.required);
  out.lockedFieldIds = strList(raw["lockedFieldIds"], [...known]) ?? [];
  out.requiredFieldIds = strList(raw["requiredFieldIds"], [...known]) ?? [];
  if (isObj(raw["fieldSizes"])) for (const [k, v] of Object.entries(raw["fieldSizes"])) if (known.has(k) && typeof v === "number" && v >= 1 && v <= 12) out.fieldSizes[k] = Math.round(v);
  if (isObj(raw["fieldLabels"])) for (const [k, v] of Object.entries(raw["fieldLabels"])) if (known.has(k) && typeof v === "string" && v.trim()) out.fieldLabels[k] = v.trim().slice(0, 60);
  if (isObj(raw["fieldDefaultValues"])) for (const [k, v] of Object.entries(raw["fieldDefaultValues"])) if (known.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)) out.fieldDefaultValues[k] = v;
  // campos conhecidos que não foram posicionados nem ocultados → card "Outros campos"
  const missing = fields.filter((f) => !placed.has(f.id) && !out.hiddenFieldIds.includes(f.id));
  if (missing.length) {
    const rows: LayoutRow[] = []; for (let k = 0; k < missing.length; k += MAX_FIELDS_PER_ROW[12]) rows.push({ id: `r${rows.length + 1}`, fieldIds: missing.slice(k, k + MAX_FIELDS_PER_ROW[12]).map((f) => f.id) });
    let id = "outros"; while (cardIds.has(id)) id += "_";
    out.cards.push({ id, panelId: out.panels[0]!.id, label: "Outros campos", order: out.cards.length + 1, colSpan: 12, rows });
    issues.push({ path: "cards", message: `${missing.length} campo(s) sem posição foram anexados ao card "Outros campos"` });
  }
  out.panels.sort((a, b) => a.order - b.order); out.cards.sort((a, b) => a.order - b.order);
  if (isObj(raw["meta"])) out.meta = { revision: typeof raw["meta"]["revision"] === "number" ? raw["meta"]["revision"] : undefined, updatedAt: typeof raw["meta"]["updatedAt"] === "string" ? raw["meta"]["updatedAt"] : undefined };
  return { layout: out, issues };
}

/** Campos de um card em ordem (útil para renderização). */
export const cardFieldIds = (c: LayoutCard) => c.rows.flatMap((r) => r.fieldIds);

export function preferencesByteSize(doc: unknown): number {
  const s = JSON.stringify(doc); let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3; }
  return n;
}
