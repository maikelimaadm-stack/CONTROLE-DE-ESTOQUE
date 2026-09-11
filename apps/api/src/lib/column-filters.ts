import { parseFilterKey, decodeList, decodeRange, isISODate, relativeDateRange, todayISO } from "@agro/shared";
import { validation } from "./errors.js";

/**
 * Filtros genéricos por coluna nas listagens transacionais: `coluna__operador=valor` (mesmo protocolo dos
 * cadastros declarativos, ver packages/shared preferences.ts). A listagem é envolvida numa CTE (`rows`) e o
 * filtro é aplicado sobre as colunas RESULTANTES — inclusive as calculadas/juntadas (ex.: farm_name), por isso
 * qualquer coluna exibida na tela pode virar chip de filtro sem alterar a consulta de cada rota.
 *
 * Tipos não são conhecidos aqui: comparações numéricas e de data usam conversões tolerantes (texto que não é
 * número/data vira NULL e não casa), e "igual a" compara texto ou número. Texto sempre "contém" (ilike).
 */
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const NUM = /^-?\d+(\.\d+)?$/;
const isDate = (s: string): boolean => isISODate(s);

export interface ColumnFilterResult { where: string[]; params: unknown[] }

export function columnFilterClauses(query: Record<string, unknown>, params: unknown[], alias = "t"): string[] {
  const where: string[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  for (const [k, raw] of Object.entries(query)) {
    const adv = parseFilterKey(k); if (!adv || typeof raw !== "string") continue;
    const v: string = raw;
    if (!IDENT.test(adv.field)) throw validation(`Coluna de filtro inválida: ${adv.field}`);
    const col = `${alias}."${adv.field}"`; const txt = `${col}::text`;
    const num = `(case when ${txt} ~ '^-?\\d+(\\.\\d+)?$' then ${txt}::numeric end)`;
    const dt = `(case when ${txt} ~ '^\\d{4}-\\d{2}-\\d{2}' then left(${txt}, 10)::date end)`;
    const op = adv.op;
    switch (op) {
      case "is_empty": where.push(`(${col} is null or ${txt} = '')`); break;
      case "is_not_empty": where.push(`(${col} is not null and ${txt} <> '')`); break;
      case "contains": where.push(`${txt} ilike ${add(`%${escapeLike(v)}%`)}`); break;
      case "not_contains": where.push(`(${col} is null or ${txt} not ilike ${add(`%${escapeLike(v)}%`)})`); break;
      case "starts_with": where.push(`${txt} ilike ${add(`${escapeLike(v)}%`)}`); break;
      case "ends_with": where.push(`${txt} ilike ${add(`%${escapeLike(v)}`)}`); break;
      case "in": { const list = decodeList(v).slice(0, 500); if (list.length) where.push(`${txt} = any(${add(list)}::text[])`); break; }
      case "eq": case "ne": {
        const neg = op === "ne" ? "not " : "";
        if (NUM.test(v.trim())) where.push(`${neg}(${num} = ${add(v.trim())}::numeric or ${txt} = ${add(v)})`);
        else if (isDate(v)) where.push(`${neg}(${dt} = ${add(v)}::date)`);
        else where.push(`${neg}(${txt} = ${add(v)})`);
        break;
      }
      case "gt": case "gte": case "lt": case "lte": {
        const cmp: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=" };
        if (isDate(v)) where.push(`${dt} ${cmp[op]} ${add(v)}::date`);
        else if (NUM.test(v.trim())) where.push(`${num} ${cmp[op]} ${add(v.trim())}::numeric`);
        else throw validation(`Valor inválido no filtro ${adv.field}`);
        break;
      }
      case "before": if (!isDate(v)) throw validation(`Data inválida no filtro ${adv.field}`); where.push(`${dt} < ${add(v)}::date`); break;
      case "after": if (!isDate(v)) throw validation(`Data inválida no filtro ${adv.field}`); where.push(`${dt} > ${add(v)}::date`); break;
      case "between": {
        const [a, b] = decodeRange(v);
        if (isDate(a) && isDate(b)) where.push(`${dt} between ${add(a)}::date and ${add(b)}::date`);
        else if (NUM.test(a.trim()) && NUM.test(b.trim())) where.push(`${num} between ${add(a.trim())}::numeric and ${add(b.trim())}::numeric`);
        else throw validation(`Intervalo inválido no filtro ${adv.field}`);
        break;
      }
      default: {
        const range = relativeDateRange(op, todayISO());
        if (!range) throw validation(`Operador de filtro desconhecido: ${op}`);
        where.push(`${dt} between ${add(range[0])}::date and ${add(range[1])}::date`);
      }
    }
  }
  return where;
}

/** Há filtros genéricos na consulta? (evita envolver a listagem quando não é preciso) */
export const hasColumnFilters = (query: Record<string, unknown>) => Object.keys(query).some((k) => parseFilterKey(k) !== null);

/** Remove a cláusula `order by` final de um SQL de listagem e devolve-a sem prefixos de alias (para reaplicar sobre a CTE). */
export function splitOrderBy(sql: string): { body: string; orderBy: string } {
  const i = sql.toLowerCase().lastIndexOf(" order by ");
  if (i < 0 || sql.slice(i).includes(")")) return { body: sql, orderBy: "" };
  return { body: sql.slice(0, i), orderBy: sql.slice(i + 10).replace(/\b[a-z_][a-z0-9_]*\./g, "") };
}

/**
 * Envolve a listagem: `with rows as (<sql sem order/limit>) select * from rows t where <filtros> order by … limit …`.
 * `aggregates` (ex.: `, coalesce(sum(t.total),0) total`) entram na consulta de contagem para os totais do rodapé.
 */
export function wrapListing(sql: string, params: unknown[], query: Record<string, unknown>, page: { page: number; pageSize: number }, aggregates = "") {
  const { body, orderBy } = splitOrderBy(sql);
  const where = columnFilterClauses(query, params);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const cte = `with rows as (${body})`;
  return {
    pageSql: `${cte} select * from rows t ${w} ${orderBy ? `order by ${orderBy}` : ""} limit ${page.pageSize} offset ${(page.page - 1) * page.pageSize}`,
    countSql: `${cte} select count(*)::text n ${aggregates} from rows t ${w}`,
    params
  };
}
