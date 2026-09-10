"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, LayoutPanelTop, Plus, Trash2 } from "lucide-react";
import type { FieldDef } from "@agro/domain";
import { buildDefaultFormLayout, normalizeFormLayout, cardFieldIds, MAX_FIELDS_PER_ROW, type FormLayout, type LayoutCard, type LayoutFieldInfo } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";
import { Button, Dialog, Input, NativeSelect, Badge, Confirm } from "@/components/ui";

export const toLayoutFields = (fields: FieldDef[]): LayoutFieldInfo[] => fields.map((f) => ({ id: f.name, label: f.label, section: f.section, span: f.span, required: f.required, readOnly: f.readOnly }));

/** Layout do formulário de um cadastro declarativo (preferência por usuário > organização > padrão derivado da definição). */
export function useFormLayout(resourceKey: string, fields: FieldDef[]): ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] } {
  const fieldsInfo = React.useMemo(() => toLayoutFields(fields), [fields]);
  const normalize = React.useCallback((raw: unknown) => (raw ? normalizeFormLayout(raw, fieldsInfo).layout : buildDefaultFormLayout(fieldsInfo)), [fieldsInfo]);
  const p = useScreenPrefs<FormLayout>(resourceKey, "form", normalize);
  return { ...p, fieldsInfo };
}

const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => { const j = i + dir; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; };
const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Configurador do layout: painéis → cards → linhas → campos, propriedades por campo (oculto, travado,
 * obrigatório, tamanho, rótulo, valor padrão). Sem arrastar-e-soltar: botões de mover/enviar para, acessíveis.
 */
export function FormLayoutConfigurator({ open, onOpenChange, p, resourceLabel }: { open: boolean; onOpenChange: (o: boolean) => void; p: ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] }; resourceLabel: string }) {
  const { prefs: l, update, fieldsInfo } = p;
  const [panelId, setPanelId] = React.useState<string>(l.panels[0]?.id ?? "principal");
  const [sel, setSel] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  React.useEffect(() => { if (!l.panels.some((x) => x.id === panelId)) setPanelId(l.panels[0]?.id ?? "principal"); }, [l.panels, panelId]);
  const label = (id: string) => l.fieldLabels[id] ?? fieldsInfo.find((f) => f.id === id)?.label ?? id;
  const fieldOf = (id: string) => fieldsInfo.find((f) => f.id === id);
  const cards = l.cards.filter((c) => c.panelId === panelId).sort((a, b) => a.order - b.order);
  const setCards = (fn: (cards: LayoutCard[]) => LayoutCard[]) => update((x) => ({ ...x, cards: fn(x.cards).map((c, i) => ({ ...c, order: i + 1 })) }));
  const updCard = (id: string, fn: (c: LayoutCard) => LayoutCard) => setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const stripField = (cs: LayoutCard[], fid: string) => cs.map((c) => ({ ...c, rows: c.rows.map((r) => ({ ...r, fieldIds: r.fieldIds.filter((x) => x !== fid) })).filter((r) => r.fieldIds.length) }));
  const placeField = (fid: string, cardId: string, rowIdx?: number) => setCards((cs) => { const s = stripField(cs, fid); return s.map((c) => { if (c.id !== cardId) return c; const rows = [...c.rows]; const max = MAX_FIELDS_PER_ROW[c.colSpan]; const target = rowIdx !== undefined && rows[rowIdx] && rows[rowIdx]!.fieldIds.length < max ? rowIdx : rows.findIndex((r) => r.fieldIds.length < max); if (target >= 0) rows[target] = { ...rows[target]!, fieldIds: [...rows[target]!.fieldIds, fid] }; else rows.push({ id: uid("r"), fieldIds: [fid] }); return { ...c, rows }; }); });
  const moveField = (cardId: string, ri: number, fi: number, dir: -1 | 1) => updCard(cardId, (c) => { const rows = c.rows.map((r) => ({ ...r, fieldIds: [...r.fieldIds] })); const row = rows[ri]!; const j = fi + dir; if (j >= 0 && j < row.fieldIds.length) { row.fieldIds = move(row.fieldIds, fi, dir); return { ...c, rows }; } const tr = ri + dir; if (tr < 0 || tr >= rows.length) return c; const [f] = row.fieldIds.splice(fi, 1); if (dir === 1) rows[tr]!.fieldIds.unshift(f!); else rows[tr]!.fieldIds.push(f!); return { ...c, rows: rows.filter((r) => r.fieldIds.length) }; });
  const toggle = (list: "hiddenFieldIds" | "lockedFieldIds" | "requiredFieldIds", fid: string, on: boolean) => update((x) => ({ ...x, [list]: on ? [...new Set([...x[list], fid])] : x[list].filter((i) => i !== fid) }));
  const hiddenList = l.hiddenFieldIds;
  const unplaced = fieldsInfo.filter((f) => !l.cards.some((c) => cardFieldIds(c).includes(f.id)));
  const f = sel ? fieldOf(sel) : undefined;
  return <>
    <Dialog open={open} onOpenChange={onOpenChange} title={`Layout do formulário — ${resourceLabel}`} size="xl" footer={<>
      {p.canEditOrg && <Button variant="outline" size="sm" onClick={() => void p.saveAsOrgDefault()}>Salvar como padrão da organização</Button>}
      {p.canEditOrg && p.hasOrgDefault && <Button variant="ghost" size="sm" onClick={() => void p.clearOrgDefault()}>Remover padrão da organização</Button>}
      <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>Restaurar padrão</Button>
      <Button size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
    </>}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">Origem: <Badge tone={p.source === "user" ? "blue" : p.source === "org" ? "violet" : "slate"}>{p.source === "user" ? "minha personalização" : p.source === "org" ? "padrão da organização" : "padrão do sistema"}</Badge>{p.saving && <span>salvando…</span>}<span className="ml-auto">Máx. {MAX_FIELDS_PER_ROW[12]} campos por linha (card largo) / {MAX_FIELDS_PER_ROW[6]} (card meia largura)</span></div>
      <div className="grid grid-cols-12 gap-3 text-[12.5px]">
        {/* Painéis */}
        <div className="col-span-12 md:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Painéis (abas)</div>
          <div className="space-y-1">
            {l.panels.map((pn, i) => <div key={pn.id} className={`flex items-center gap-1 rounded border px-2 py-1 ${pn.id === panelId ? "border-brand-500 bg-brand-50" : ""}`}>
              <button type="button" className="flex-1 truncate text-left" onClick={() => setPanelId(pn.id)}>{pn.label}{pn.hidden && <span className="ml-1 text-slate-400">(oculto)</span>}</button>
              <button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => update((x) => ({ ...x, panels: move(x.panels, i, -1).map((q, k) => ({ ...q, order: k + 1 })) }))} aria-label="Subir painel"><ArrowUp className="h-3 w-3" /></button>
              <button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => update((x) => ({ ...x, panels: move(x.panels, i, 1).map((q, k) => ({ ...q, order: k + 1 })) }))} aria-label="Descer painel"><ArrowDown className="h-3 w-3" /></button>
            </div>)}
          </div>
          {l.panels.some((x) => x.id === panelId) && <div className="mt-2 space-y-1">
            <Input value={l.panels.find((x) => x.id === panelId)!.label} onChange={(e) => update((x) => ({ ...x, panels: x.panels.map((q) => (q.id === panelId ? { ...q, label: e.target.value } : q)) }))} aria-label="Nome do painel" />
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => update((x) => { const id = uid("p"); return { ...x, panels: [...x.panels, { id, label: "Novo painel", order: x.panels.length + 1 }] }; })}><Plus className="h-3 w-3" /> Painel</Button>
              {l.panels.length > 1 && cards.length === 0 && <Button size="sm" variant="ghost" onClick={() => update((x) => ({ ...x, panels: x.panels.filter((q) => q.id !== panelId) }))}><Trash2 className="h-3 w-3" /> Remover</Button>}</div>
          </div>}
          {(unplaced.length > 0 || hiddenList.length > 0) && <div className="mt-3"><div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Campos ocultos</div><div className="flex flex-wrap gap-1">{[...new Set([...hiddenList, ...unplaced.map((u) => u.id)])].map((id) => <button key={id} type="button" className={`rounded border px-1.5 py-0.5 text-[11px] ${sel === id ? "border-brand-500 bg-brand-50" : "bg-slate-50"}`} onClick={() => setSel(id)}>{label(id)}</button>)}</div></div>}
        </div>
        {/* Cards e linhas */}
        <div className="col-span-12 md:col-span-6">
          <div className="mb-1 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase text-slate-500">Cards do painel</span><Button size="sm" variant="outline" onClick={() => setCards((cs) => [...cs, { id: uid("c"), panelId, label: "Novo card", order: cs.length + 1, colSpan: 12, rows: [] }])}><Plus className="h-3 w-3" /> Card</Button></div>
          <div className="space-y-2">
            {cards.map((c, ci) => <div key={c.id} className="rounded border">
              <div className="flex flex-wrap items-center gap-1 border-b bg-slate-50 px-2 py-1">
                <Input className="h-7 w-44" value={c.label} onChange={(e) => updCard(c.id, (x) => ({ ...x, label: e.target.value }))} aria-label="Nome do card" />
                <NativeSelect className="h-7 w-36" value={c.colSpan} onChange={(e) => updCard(c.id, (x) => ({ ...x, colSpan: Number(e.target.value) as 6 | 12 }))} aria-label="Largura do card"><option value={12}>Largura total</option><option value={6}>Meia largura</option></NativeSelect>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={Boolean(c.collapsible)} onChange={(e) => updCard(c.id, (x) => ({ ...x, collapsible: e.target.checked || undefined }))} />recolhível</label>
                <span className="ml-auto flex gap-0.5">
                  <button type="button" className="rounded p-0.5 hover:bg-slate-200" onClick={() => setCards((cs) => { const ids = cards.map((x) => x.id); const i = ids.indexOf(c.id); const j = i - 1; if (j < 0) return cs; const a = cs.find((x) => x.id === ids[i])!, b = cs.find((x) => x.id === ids[j])!; return cs.map((x) => (x.id === a.id ? { ...x, order: b.order } : x.id === b.id ? { ...x, order: a.order } : x)).sort((x, y) => x.order - y.order); })} aria-label="Subir card"><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" className="rounded p-0.5 hover:bg-slate-200" onClick={() => setCards((cs) => { const ids = cards.map((x) => x.id); const i = ids.indexOf(c.id); const j = i + 1; if (j >= ids.length) return cs; const a = cs.find((x) => x.id === ids[i])!, b = cs.find((x) => x.id === ids[j])!; return cs.map((x) => (x.id === a.id ? { ...x, order: b.order } : x.id === b.id ? { ...x, order: a.order } : x)).sort((x, y) => x.order - y.order); })} aria-label="Descer card"><ArrowDown className="h-3 w-3" /></button>
                  <button type="button" className="rounded p-0.5 text-red-600 hover:bg-red-50" disabled={cardFieldIds(c).length > 0} title={cardFieldIds(c).length ? "Mova os campos antes de remover" : "Remover card"} onClick={() => setCards((cs) => cs.filter((x) => x.id !== c.id))} aria-label="Remover card"><Trash2 className="h-3 w-3" /></button>
                </span>
              </div>
              <div className="space-y-1 p-2">
                {c.rows.map((r, ri) => <div key={r.id} className="flex flex-wrap items-center gap-1 rounded bg-slate-50 p-1"><span className="w-10 text-[10px] uppercase text-slate-400">Linha {ri + 1}</span>
                  {r.fieldIds.map((fid, fi) => <span key={fid} className={`inline-flex items-center gap-0.5 rounded border bg-white px-1.5 py-0.5 ${sel === fid ? "border-brand-500 ring-1 ring-brand-300" : ""}`}>
                    <button type="button" className="max-w-[140px] truncate" onClick={() => setSel(fid)}>{label(fid)}{fieldOf(fid)?.required && <span className="text-red-500"> *</span>}</button>
                    <button type="button" className="rounded p-0.5 text-slate-400 hover:text-slate-700" onClick={() => moveField(c.id, ri, fi, -1)} aria-label={`Mover ${label(fid)} para trás`}>‹</button>
                    <button type="button" className="rounded p-0.5 text-slate-400 hover:text-slate-700" onClick={() => moveField(c.id, ri, fi, 1)} aria-label={`Mover ${label(fid)} para frente`}>›</button>
                  </span>)}
                </div>)}
                {ci === cards.length - 1 && cards.length === 0 && <div className="text-slate-400">Sem cards</div>}
                <Button size="sm" variant="ghost" onClick={() => updCard(c.id, (x) => ({ ...x, rows: [...x.rows, { id: uid("r"), fieldIds: [] }] }))}><Plus className="h-3 w-3" /> Linha</Button>
              </div>
            </div>)}
            {cards.length === 0 && <div className="rounded border border-dashed p-3 text-center text-slate-400">Nenhum card neste painel</div>}
          </div>
        </div>
        {/* Propriedades do campo */}
        <div className="col-span-12 md:col-span-3">
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Campo selecionado</div>
          {!f ? <div className="rounded border border-dashed p-3 text-slate-400">Clique em um campo para editar suas propriedades.</div> : <div className="space-y-2 rounded border p-2">
            <div className="font-semibold">{f.label}{f.required && <Badge tone="amber" className="ml-1">obrigatório</Badge>}</div>
            <label className="block"><span className="text-[11px] uppercase text-slate-500">Rótulo exibido</span><Input value={l.fieldLabels[f.id] ?? ""} placeholder={f.label} onChange={(e) => update((x) => { const fl = { ...x.fieldLabels }; if (e.target.value.trim()) fl[f.id] = e.target.value; else delete fl[f.id]; return { ...x, fieldLabels: fl }; })} /></label>
            <label className="block"><span className="text-[11px] uppercase text-slate-500">Largura (1–12 colunas)</span><NativeSelect value={l.fieldSizes[f.id] ?? f.span ?? 3} onChange={(e) => update((x) => ({ ...x, fieldSizes: { ...x.fieldSizes, [f.id]: Number(e.target.value) } }))}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></label>
            <label className="block"><span className="text-[11px] uppercase text-slate-500">Valor padrão (novos registros)</span><Input value={String(l.fieldDefaultValues[f.id] ?? "")} onChange={(e) => update((x) => { const d = { ...x.fieldDefaultValues }; if (e.target.value === "") delete d[f.id]; else d[f.id] = e.target.value; return { ...x, fieldDefaultValues: d }; })} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" disabled={Boolean(f.required)} checked={hiddenList.includes(f.id)} onChange={(e) => { toggle("hiddenFieldIds", f.id, e.target.checked); if (e.target.checked) setCards((cs) => stripField(cs, f.id)); else placeField(f.id, cards[0]?.id ?? l.cards[0]?.id ?? ""); }} />Oculto no formulário</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={l.lockedFieldIds.includes(f.id)} onChange={(e) => toggle("lockedFieldIds", f.id, e.target.checked)} />Somente leitura (travado)</label>
            <label className="flex items-center gap-1"><input type="checkbox" disabled={Boolean(f.required)} checked={Boolean(f.required) || l.requiredFieldIds.includes(f.id)} onChange={(e) => toggle("requiredFieldIds", f.id, e.target.checked)} />Obrigatório</label>
            {!hiddenList.includes(f.id) && <label className="block"><span className="text-[11px] uppercase text-slate-500">Enviar para o card</span><NativeSelect value="" onChange={(e) => { if (e.target.value) placeField(f.id, e.target.value); }}><option value="">Selecione…</option>{l.cards.map((c) => <option key={c.id} value={c.id}>{l.panels.find((pn) => pn.id === c.panelId)?.label} › {c.label}</option>)}</NativeSelect></label>}
          </div>}
        </div>
      </div>
    </Dialog>
    <Confirm open={confirmReset} onOpenChange={setConfirmReset} title="Restaurar padrão" text="Remove a sua personalização deste formulário (volta ao padrão da organização ou do sistema)." onConfirm={() => { setConfirmReset(false); void p.reset(); }} />
  </>;
}

export function FormLayoutButton({ onClick, customized }: { onClick: () => void; customized: boolean }) {
  return <Button variant="outline" size="sm" type="button" onClick={onClick} title="Configurar layout do formulário"><LayoutPanelTop className="h-3.5 w-3.5" />{customized && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="personalizado" />}</Button>;
}
