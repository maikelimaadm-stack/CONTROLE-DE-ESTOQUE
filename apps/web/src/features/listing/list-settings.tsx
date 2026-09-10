"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { FILTER_OPERATORS, LIST_PAGE_SIZES, defaultOperatorFor, type ListPreferences } from "@agro/shared";
import { Button, Dialog, Tabs, NativeSelect, Input, Badge, Confirm } from "@/components/ui";
import type { ListColumnInfo, ListFilterInfo } from "./list-prefs";
import type { ScreenPrefs } from "@/lib/preferences";

/** Diálogo de configuração da listagem: colunas, filtros, visualização; padrão da organização e restaurar. */
export function ListSettingsDialog({ open, onOpenChange, columns, filters, p, supportsCards = true, supportsFilterOperators = true }: { open: boolean; onOpenChange: (o: boolean) => void; columns: ListColumnInfo[]; filters: ListFilterInfo[]; p: ScreenPrefs<ListPreferences>; supportsCards?: boolean; supportsFilterOperators?: boolean }) {
  const { prefs, update } = p;
  const [confirmReset, setConfirmReset] = React.useState(false);
  const order = React.useMemo(() => { const rank = new Map((prefs.columns.order ?? []).map((k, i) => [k, i])); return [...columns].sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6)); }, [columns, prefs.columns.order]);
  const visible = prefs.columns.visible ?? columns.map((c) => c.key);
  const setVisible = (keys: string[]) => update((x) => ({ ...x, columns: { ...x.columns, visible: keys } }));
  const move = (key: string, dir: -1 | 1) => { const keys = order.map((c) => c.key); const i = keys.indexOf(key); const j = i + dir; if (j < 0 || j >= keys.length) return; [keys[i], keys[j]] = [keys[j]!, keys[i]!]; update((x) => ({ ...x, columns: { ...x.columns, order: keys } })); };
  const setWidth = (key: string, w: string) => update((x) => { const widths = { ...(x.columns.widths ?? {}) }; const n = Number(w); if (!w || !Number.isFinite(n) || n < 40) delete widths[key]; else widths[key] = Math.min(1200, Math.round(n)); return { ...x, columns: { ...x.columns, widths } }; });
  const fVisible = prefs.filters.visible ?? filters.map((f) => f.key);
  const setFVisible = (keys: string[]) => update((x) => ({ ...x, filters: { ...x.filters, visible: keys } }));
  const setOp = (key: string, op: string) => update((x) => ({ ...x, filters: { ...x.filters, operators: { ...(x.filters.operators ?? {}), [key]: op } } }));
  const cardFields = prefs.view.cardFields ?? columns.slice(0, 6).map((c) => c.key);
  return <>
    <Dialog open={open} onOpenChange={onOpenChange} title="Configurar listagem" size="lg" footer={<>
      {p.canEditOrg && <Button variant="outline" size="sm" onClick={() => void p.saveAsOrgDefault()} title="Usa a configuração atual como padrão para todos os usuários da organização">Salvar como padrão da organização</Button>}
      {p.canEditOrg && p.hasOrgDefault && <Button variant="ghost" size="sm" onClick={() => void p.clearOrgDefault()}>Remover padrão da organização</Button>}
      <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>Restaurar padrão</Button>
      <Button size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
    </>}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">Origem atual: <Badge tone={p.source === "user" ? "blue" : p.source === "org" ? "violet" : "slate"}>{p.source === "user" ? "minha personalização" : p.source === "org" ? "padrão da organização" : "padrão do sistema"}</Badge>{p.saving && <span>salvando…</span>}</div>
      <Tabs tabs={[
        { value: "columns", label: "Colunas", content: <div className="max-h-[55vh] overflow-auto"><table className="table-dense w-full text-[12.5px]"><thead><tr><th className="w-8">Exibir</th><th>Coluna</th><th className="w-28">Largura (px)</th><th className="w-20">Ordem</th></tr></thead><tbody>
          {order.map((c) => <tr key={c.key}><td><input type="checkbox" checked={visible.includes(c.key)} onChange={(e) => setVisible(e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key))} aria-label={`Exibir ${c.label}`} /></td><td>{c.label}</td><td><Input type="number" min={40} max={1200} step={10} value={prefs.columns.widths?.[c.key] ?? ""} placeholder="auto" onChange={(e) => setWidth(c.key, e.target.value)} /></td><td><div className="flex gap-1"><button type="button" className="rounded p-1 hover:bg-slate-100" onClick={() => move(c.key, -1)} aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="rounded p-1 hover:bg-slate-100" onClick={() => move(c.key, 1)} aria-label="Descer"><ArrowDown className="h-3.5 w-3.5" /></button></div></td></tr>)}
        </tbody></table><div className="mt-2 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setVisible(columns.map((c) => c.key))}>Exibir todas</Button><Button size="sm" variant="ghost" onClick={() => update((x) => ({ ...x, columns: { ...x.columns, order: undefined } }))}>Ordem padrão</Button></div></div> },
        { value: "filters", label: "Filtros", content: filters.length ? <div className="max-h-[55vh] overflow-auto"><table className="table-dense w-full text-[12.5px]"><thead><tr><th className="w-8">Exibir</th><th>Campo</th>{supportsFilterOperators && <th className="w-48">Operador padrão</th>}</tr></thead><tbody>
          {filters.map((f) => <tr key={f.key}><td><input type="checkbox" checked={fVisible.includes(f.key)} onChange={(e) => setFVisible(e.target.checked ? [...fVisible, f.key] : fVisible.filter((k) => k !== f.key))} aria-label={`Filtro ${f.label}`} /></td><td>{f.label}</td>{supportsFilterOperators && <td><NativeSelect value={prefs.filters.operators?.[f.key] ?? defaultOperatorFor(f.kind)} onChange={(e) => setOp(f.key, e.target.value)}>{FILTER_OPERATORS[f.kind].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect></td>}</tr>)}
        </tbody></table><div className="mt-2 text-[11px] text-slate-500">Filtros salvos: use o botão "Filtros salvos" na barra de filtros da listagem.</div></div> : <div className="text-sm text-slate-500">Esta listagem não possui filtros configuráveis.</div> },
        { value: "view", label: "Visualização", content: <div className="grid grid-cols-12 gap-3 text-[12.5px]">
          <div className="col-span-12 md:col-span-4"><label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Registros por página</label><NativeSelect value={prefs.pageSize ?? ""} onChange={(e) => update((x) => ({ ...x, pageSize: e.target.value ? Number(e.target.value) : undefined }))}><option value="">Padrão (20)</option>{LIST_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></div>
          {supportsCards && <div className="col-span-12 md:col-span-4"><label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Modo</label><NativeSelect value={prefs.view.mode} onChange={(e) => update((x) => ({ ...x, view: { ...x.view, mode: e.target.value as "table" | "cards" } }))}><option value="table">Tabela</option><option value="cards">Cards</option></NativeSelect></div>}
          {supportsCards && <div className="col-span-12 md:col-span-4"><label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Cards por linha</label><NativeSelect value={prefs.view.cardsPerRow ?? 3} onChange={(e) => update((x) => ({ ...x, view: { ...x.view, cardsPerRow: Number(e.target.value) as 2 | 3 | 4 } }))}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></div>}
          <div className="col-span-12 md:col-span-4"><label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Densidade</label><NativeSelect value={prefs.view.density ?? "normal"} onChange={(e) => update((x) => ({ ...x, view: { ...x.view, density: e.target.value as "compact" | "normal" } }))}><option value="normal">Normal</option><option value="compact">Compacta</option></NativeSelect></div>
          {supportsCards && <div className="col-span-12"><label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Campos exibidos nos cards</label><div className="flex flex-wrap gap-3">{columns.map((c) => <label key={c.key} className="flex items-center gap-1"><input type="checkbox" checked={cardFields.includes(c.key)} onChange={(e) => update((x) => ({ ...x, view: { ...x.view, cardFields: e.target.checked ? [...cardFields, c.key] : cardFields.filter((k) => k !== c.key) } }))} />{c.label}</label>)}</div></div>}
        </div> }
      ]} />
    </Dialog>
    <Confirm open={confirmReset} onOpenChange={setConfirmReset} title="Restaurar padrão" text="Remove a sua personalização desta listagem (volta ao padrão da organização ou do sistema)." onConfirm={() => { setConfirmReset(false); void p.reset(); }} />
  </>;
}

export function ListSettingsButton({ onClick, customized }: { onClick: () => void; customized: boolean }) {
  return <Button variant="outline" size="sm" onClick={onClick} title="Configurar colunas, filtros e visualização"><Settings2 className="h-3.5 w-3.5" />{customized && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="personalizada" />}</Button>;
}
