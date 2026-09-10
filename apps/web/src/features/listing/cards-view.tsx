"use client";
import * as React from "react";
import { Spinner, Empty } from "@/components/ui";
import type { Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

/** Visualização em cards de uma listagem: cada card mostra os campos escolhidos (label: valor). */
export function CardsView<T extends Record<string, unknown>>({ rows, columns, fields, perRow = 3, loading, onClick, actions, rowKey }: { rows: T[]; columns: Column<T>[]; fields?: string[]; perRow?: 2 | 3 | 4; loading?: boolean; onClick?: (r: T) => void; actions?: (r: T) => React.ReactNode; rowKey?: (r: T) => string }) {
  const key = rowKey ?? ((r: T) => String(r["id"]));
  const cols = (fields?.length ? fields.map((k) => columns.find((c) => c.key === k)).filter(Boolean) as Column<T>[] : columns.slice(0, 6));
  const grid = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[perRow];
  if (loading) return <div className="py-8 text-center"><Spinner className="mx-auto" /></div>;
  if (!rows.length) return <Empty />;
  return <div className={cn("grid grid-cols-1 gap-3", grid)}>
    {rows.map((r) => <div key={key(r)} className={cn("rounded-lg border bg-white p-3 shadow-xs", onClick && "cursor-pointer hover:border-brand-400")} onClick={() => onClick?.(r)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{cols[0] && <div className="truncate text-sm font-semibold text-slate-800">{cols[0].render ? cols[0].render(r) : String(r[cols[0].key] ?? "")}</div>}</div>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {cols.slice(1).map((c) => <div key={c.key} className="min-w-0"><dt className="truncate text-[10px] font-semibold uppercase text-slate-400">{c.label}</dt><dd className="truncate">{c.render ? c.render(r) : String(r[c.key] ?? "")}</dd></div>)}
      </dl>
    </div>)}
  </div>;
}
