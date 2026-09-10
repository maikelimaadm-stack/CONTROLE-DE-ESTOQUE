import { defaultOperatorFor, operatorArity, filterKey, encodeRange, decodeRange, encodeList, decodeList, isListOperator, parseFilterKey } from "@agro/shared";
import type { Base1FilterDef, FilterValue, FilterValues } from "./types";

/** Valor vazio (sem filtro) para um campo. */
export const emptyValue = (f: Base1FilterDef, op?: string): FilterValue => ({ op: op ?? defaultOperatorFor(f.kind), value: "", values: [] });

/** Um valor de filtro está ativo quando tem conteúdo (ou o operador dispensa valor). */
export function isActive(f: Base1FilterDef, v: FilterValue | undefined): boolean {
  if (!v) return false;
  if (f.mode === "simple") return Boolean(v.value) || Boolean(v.value2) || Boolean(v.values?.length);
  const ar = operatorArity(f.kind, v.op);
  if (ar === 0) return true;
  if (isListOperator(v.op)) return Boolean(v.values?.length);
  if (ar === 2) return Boolean(v.value) && Boolean(v.value2);
  return v.value !== "";
}

/** Converte os valores da faixa de filtros em parâmetros de consulta. */
export function toParams(filters: Base1FilterDef[], values: FilterValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) {
    const v = values[f.key]; if (!v || !isActive(f, v)) continue;
    if (f.mode === "simple") {
      if (f.kind === "date" && f.range) { if (v.value) out[f.range.from] = v.value; if (v.value2) out[f.range.to] = v.value2; }
      else if (v.values?.length) out[f.key] = v.values[0]!;
      else out[f.key] = v.value;
      continue;
    }
    const ar = operatorArity(f.kind, v.op);
    if (ar === 0) out[filterKey(f.key, v.op)] = "1";
    else if (isListOperator(v.op)) out[filterKey(f.key, v.op)] = encodeList(v.values ?? []);
    else if (ar === 2) out[filterKey(f.key, v.op)] = encodeRange(v.value, v.value2 ?? "");
    else out[filterKey(f.key, v.op)] = v.value;
  }
  return out;
}

/** Reconstrói os valores da faixa a partir de parâmetros (URL, filtro salvo). */
export function fromParams(filters: Base1FilterDef[], params: Record<string, string>, ops?: Record<string, string>): FilterValues {
  const out: FilterValues = {};
  for (const f of filters) {
    if (f.mode === "simple") {
      if (f.kind === "date" && f.range) { const a = params[f.range.from], b = params[f.range.to]; if (a || b) out[f.key] = { op: "between", value: a ?? "", value2: b ?? "" }; }
      else if (params[f.key] !== undefined) out[f.key] = { op: "eq", value: params[f.key]!, values: [params[f.key]!] };
      continue;
    }
    for (const [k, raw] of Object.entries(params)) {
      const p = parseFilterKey(k); const field = p?.field ?? k; if (field !== f.key) continue;
      const op = p?.op ?? ops?.[f.key] ?? defaultOperatorFor(f.kind);
      if (isListOperator(op)) out[f.key] = { op, value: "", values: decodeList(raw) };
      else if (operatorArity(f.kind, op) === 2) { const [a, b] = decodeRange(raw); out[f.key] = { op, value: a, value2: b }; }
      else out[f.key] = { op, value: raw };
    }
  }
  return out;
}

/** Descrição curta de um filtro ativo (rótulo do chip). */
export function describe(f: Base1FilterDef, v: FilterValue | undefined, labelOf: (value: string) => string): string | null {
  if (!v || !isActive(f, v)) return null;
  if (v.values?.length) return v.values.length === 1 ? labelOf(v.values[0]!) : `${v.values.length} selecionados`;
  if (f.kind === "date" && (v.op === "between" || f.mode === "simple")) return [v.value, v.value2].filter((x): x is string => Boolean(x)).map(br).join(" a ");
  if (operatorArity(f.kind, v.op) === 0) return v.op;
  return labelOf(v.value);
}
const br = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
