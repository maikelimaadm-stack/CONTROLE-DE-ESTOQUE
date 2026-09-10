"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { num } from "@/lib/utils";
import { Input } from "@/components/ui";
import { type Row } from "@/features/docs/shared";

export const MOV_PT: Record<string, string> = { purchase: "Compra", sale: "Venda", birth: "Nascimento", death: "Morte", loss: "Perda/desaparecimento", animal_batch_transfer: "Transf. animais → lote", batch_grouping: "Agrupamento de lotes", batch_module_area_transfer: "Transf. lote → módulo/área", farm_transfer: "Transf. entre fazendas", evolution: "Evolução de categoria", weaning: "Desmama", separation: "Apartação" };
export const HANDLING_PT: Record<string, string> = { nutrition: "Nutrição", sanitary: "Sanitário", weaning: "Desmama", separation: "Apartação", pasture: "Manejo de pastagem" };

/** Seletor múltiplo de animais ativos (busca por identificação, filtro por lote). */
export function AnimalPicker({ selected, onChange, batchId, farmId, single }: { selected: string[]; onChange: (ids: string[], rows: Row[]) => void; batchId?: string; farmId?: string; single?: boolean }) {
  const [search, setSearch] = React.useState("");
  const q = useQuery({ queryKey: ["animals-pick", search, batchId, farmId], queryFn: () => api<{ items: Row[] }>(`/api/livestock/animals${qs({ search, batch_id: batchId, farm_id: farmId, pageSize: 200 })}`) });
  const rows = q.data?.items ?? []; const all = rows.every((r) => selected.includes(String(r["id"]))) && rows.length > 0;
  const toggle = (id: string) => { const next = single ? [id] : selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]; onChange(next, rows.filter((r) => next.includes(String(r["id"])))); };
  return <div className="rounded border">
    <div className="flex items-center gap-2 border-b p-2"><Input placeholder="Buscar por brinco / identificação…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />{!single && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={all} onChange={() => { const ids = rows.map((r) => String(r["id"])); onChange(all ? selected.filter((s) => !ids.includes(s)) : [...new Set([...selected, ...ids])], rows); }} /> Todos ({rows.length})</label>}<span className="ml-auto text-xs text-slate-500">{selected.length} selecionado(s)</span></div>
    <div className="max-h-72 overflow-auto"><table className="table-dense w-full text-[12px]"><thead><tr><th className="w-8" /><th>Identificação</th><th>Categoria</th><th>Raça</th><th>Sexo</th><th>Lote</th><th className="text-right">Peso</th></tr></thead><tbody>
      {rows.map((r) => { const id = String(r["id"]); return <tr key={id} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(id)}><td><input type={single ? "radio" : "checkbox"} readOnly checked={selected.includes(id)} /></td><td>{String(r["identifications"] ?? "—")}</td><td>{String(r["category_name"])}</td><td>{String(r["breed_name"] ?? "")}</td><td>{String(r["sex"] ?? "")}</td><td>{String(r["batch_name"] ?? "")}</td><td className="num">{r["current_weight"] ? num(r["current_weight"] as string, 1) : ""}</td></tr>; })}
      {!q.isLoading && rows.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-slate-400">Nenhum animal ativo encontrado</td></tr>}
    </tbody></table></div>
  </div>;
}

/** Lotes por contagem (rebanho não individualizado). */
export function HerdLotSelect({ value, onChange, farmId }: { value: string; onChange: (id: string, row?: Row) => void; farmId?: string }) {
  const q = useQuery({ queryKey: ["herd-lots", farmId], queryFn: () => api<{ items: Row[] }>(`/api/livestock/herd-lots${qs({ farm_id: farmId })}`) });
  return <select className="h-8 w-full rounded-md border bg-white px-2 text-[13px]" value={value} onChange={(e) => onChange(e.target.value, q.data?.items.find((r) => r["id"] === e.target.value))}><option value="">Selecione o lote (contagem)</option>{q.data?.items.map((r) => <option key={String(r["id"])} value={String(r["id"])}>{String(r["batch_name"] ?? "sem lote")} · {String(r["category_name"])} {String(r["breed_name"] ?? "")} {String(r["sex"] ?? "")} · {String(r["quantity"])} cab.</option>)}</select>;
}
