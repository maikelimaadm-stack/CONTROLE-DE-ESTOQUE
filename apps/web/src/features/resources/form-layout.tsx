"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus, Trash2, RectangleHorizontal, Square, ChevronsLeft, ChevronsRight, Settings2, Building2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { FieldDef } from "@agro/domain";
import { buildDefaultFormLayout, normalizeFormLayout, cardFieldIds, MAX_FIELDS_PER_ROW, type FormLayout, type LayoutCard, type LayoutFieldInfo } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Input, NativeSelect, Confirm } from "@/components/ui";
import { IconBtn, PillBtn, B1Popover } from "@/features/base1/ui";

export const toLayoutFields = (fields: FieldDef[]): LayoutFieldInfo[] => fields.map((f) => ({ id: f.name, label: f.label, section: f.section, span: f.span, required: f.required, readOnly: f.readOnly }));

/** Layout do formulário de um cadastro declarativo (preferência por usuário > organização > padrão derivado da definição). */
export function useFormLayout(resourceKey: string, fields: FieldDef[]): ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] } {
  const fieldsInfo = React.useMemo(() => toLayoutFields(fields), [fields]);
  const normalize = React.useCallback((raw: unknown) => (raw ? normalizeFormLayout(raw, fieldsInfo).layout : buildDefaultFormLayout(fieldsInfo)), [fieldsInfo]);
  const p = useScreenPrefs<FormLayout>(resourceKey, "form", normalize);
  return { ...p, fieldsInfo };
}

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
type Drag = { fieldId: string } | null;

/**
 * "Configuração de layout" (réplica da tela do MG): Voltar / Editar; à esquerda os campos disponíveis (fora do
 * formulário); à direita as abas de painéis, as abas de cards (inteiro / meio), e as linhas com os campos
 * (verde; vermelho = obrigatório). Arraste um campo para uma linha ou para a zona "nova linha"; ou clique no campo
 * e depois na linha. Salva automaticamente na preferência do usuário; pode virar padrão da organização.
 */
export function FormLayoutPage({ p, resourceLabel, backHref }: { p: ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] }; resourceLabel: string; backHref: string }) {
  const { prefs: l, update, fieldsInfo } = p;
  const [editing, setEditing] = React.useState(false);
  const [panelId, setPanelId] = React.useState<string>(l.panels[0]?.id ?? "principal");
  const cards = l.cards.filter((c) => c.panelId === panelId).sort((a, b) => a.order - b.order);
  const [cardId, setCardId] = React.useState<string>(cards[0]?.id ?? "");
  const [sel, setSel] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<Drag>(null);
  const [search, setSearch] = React.useState("");
  const [confirmReset, setConfirmReset] = React.useState(false);
  React.useEffect(() => { if (!l.panels.some((x) => x.id === panelId)) setPanelId(l.panels[0]?.id ?? "principal"); }, [l.panels, panelId]);
  React.useEffect(() => { if (!cards.some((c) => c.id === cardId)) setCardId(cards[0]?.id ?? ""); }, [cards.map((c) => c.id).join(","), cardId]);
  const card = cards.find((c) => c.id === cardId);
  const label = (id: string) => l.fieldLabels[id] ?? fieldsInfo.find((f) => f.id === id)?.label ?? id;
  const info = (id: string) => fieldsInfo.find((f) => f.id === id);
  const placed = new Set(l.cards.flatMap(cardFieldIds));
  const available = fieldsInfo.filter((f) => !placed.has(f.id) && (!search || f.label.toLowerCase().includes(search.toLowerCase())));
  const setCards = (fn: (cards: LayoutCard[]) => LayoutCard[]) => update((x) => ({ ...x, cards: fn(x.cards).map((c, i) => ({ ...c, order: i + 1 })) }));
  const updCard = (id: string, fn: (c: LayoutCard) => LayoutCard) => setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const strip = (cs: LayoutCard[], fid: string) => cs.map((c) => ({ ...c, rows: c.rows.map((r) => ({ ...r, fieldIds: r.fieldIds.filter((x) => x !== fid) })).filter((r) => r.fieldIds.length) }));
  /** coloca o campo na linha (ou em nova linha) do card; respeita o máximo por linha */
  const place = (fid: string, target: { cardId: string; rowIdx?: number; before?: string }) => {
    if (!editing) return;
    setCards((cs) => { const s = strip(cs, fid); return s.map((c) => { if (c.id !== target.cardId) return c; const rows = c.rows.map((r) => ({ ...r, fieldIds: [...r.fieldIds] })); const max = MAX_FIELDS_PER_ROW[c.colSpan]; const row = target.rowIdx !== undefined ? rows[target.rowIdx] : undefined; if (row) { if (row.fieldIds.length >= max) { toast.warning(`Esta linha já tem ${max} campos`); return c; } const at = target.before ? row.fieldIds.indexOf(target.before) : -1; if (at >= 0) row.fieldIds.splice(at, 0, fid); else row.fieldIds.push(fid); } else rows.push({ id: uid("r"), fieldIds: [fid] }); return { ...c, rows: rows.filter((r) => r.fieldIds.length) }; }); });
    update((x) => ({ ...x, hiddenFieldIds: x.hiddenFieldIds.filter((h) => h !== fid) }));
    setSel(null); setDrag(null);
  };
  const remove = (fid: string) => { if (!editing) return; const f = info(fid); if (f?.required) { toast.warning("Campo obrigatório não pode sair do formulário"); return; } setCards((cs) => strip(cs, fid)); update((x) => ({ ...x, hiddenFieldIds: [...new Set([...x.hiddenFieldIds, fid])] })); setSel(null); };
  const onDrop = (e: React.DragEvent, target: { cardId: string; rowIdx?: number; before?: string }) => { e.preventDefault(); e.stopPropagation(); const fid = e.dataTransfer.getData("text/field") || drag?.fieldId; if (fid) place(fid, target); };
  const dragProps = (fid: string) => editing ? { draggable: true, onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/field", fid); e.dataTransfer.effectAllowed = "move"; setDrag({ fieldId: fid }); }, onDragEnd: () => setDrag(null) } : {};
  const chip = (fid: string, extra?: string) => { const f = info(fid); const required = Boolean(f?.required) || l.requiredFieldIds.includes(fid); return (
    <div key={fid} role="button" tabIndex={0} aria-label={label(fid)} onClick={() => setSel(sel === fid ? null : fid)} onKeyDown={(e) => { if (e.key === "Enter") setSel(sel === fid ? null : fid); }} {...dragProps(fid)}
      className={cn("flex min-w-[120px] flex-1 cursor-pointer select-none items-center rounded-lg px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition", required ? "bg-red-600 hover:bg-red-700" : "bg-brand-500 hover:bg-brand-600", sel === fid && "ring-2 ring-offset-1 ring-slate-800", extra)}>
      <span className="truncate">{label(fid)}</span>
    </div>); };
  const FieldProps = ({ fid }: { fid: string }) => { const f = info(fid)!; return <div className="space-y-2 text-[12px]">
    <div className="font-semibold text-slate-800">{f.label}</div>
    <label className="block"><span className="text-[10.5px] uppercase text-slate-500">Rótulo exibido</span><Input value={l.fieldLabels[fid] ?? ""} placeholder={f.label} onChange={(e) => update((x) => { const fl = { ...x.fieldLabels }; if (e.target.value.trim()) fl[fid] = e.target.value; else delete fl[fid]; return { ...x, fieldLabels: fl }; })} /></label>
    <label className="block"><span className="text-[10.5px] uppercase text-slate-500">Valor padrão (novos registros)</span><Input value={String(l.fieldDefaultValues[fid] ?? "")} onChange={(e) => update((x) => { const d = { ...x.fieldDefaultValues }; if (e.target.value === "") delete d[fid]; else d[fid] = e.target.value; return { ...x, fieldDefaultValues: d }; })} /></label>
    <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-500" checked={l.lockedFieldIds.includes(fid)} onChange={(e) => update((x) => ({ ...x, lockedFieldIds: e.target.checked ? [...new Set([...x.lockedFieldIds, fid])] : x.lockedFieldIds.filter((i) => i !== fid) }))} />Somente leitura (travado)</label>
    <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-500" disabled={Boolean(f.required)} checked={Boolean(f.required) || l.requiredFieldIds.includes(fid)} onChange={(e) => update((x) => ({ ...x, requiredFieldIds: e.target.checked ? [...new Set([...x.requiredFieldIds, fid])] : x.requiredFieldIds.filter((i) => i !== fid) }))} />Obrigatório</label>
    {placed.has(fid) && <label className="block"><span className="text-[10.5px] uppercase text-slate-500">Mover para o card</span><NativeSelect value="" onChange={(e) => { if (e.target.value) place(fid, { cardId: e.target.value }); }}><option value="">Selecione…</option>{l.cards.map((c) => <option key={c.id} value={c.id}>{l.panels.find((pn) => pn.id === c.panelId)?.label} › {c.label}</option>)}</NativeSelect></label>}
    {placed.has(fid) && !f.required && <PillBtn tone="red" className="h-7 px-3 text-[11.5px]" onClick={() => remove(fid)}><Trash2 className="h-3.5 w-3.5" /> Retirar do formulário</PillBtn>}
  </div>; };
  const dropZone = (target: { cardId: string; rowIdx?: number }, cls: string, children: React.ReactNode) => <div onDragOver={(e) => { if (editing) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={(e) => onDrop(e, target)} onClick={() => { if (sel && editing && !placed.has(sel)) place(sel, target); else if (sel && editing && target.rowIdx !== undefined) place(sel, target); }} className={cls}>{children}</div>;
  return <div className="b1 flex flex-col gap-2" data-testid="layout-config">
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm no-print">
      <Link href={backHref}><PillBtn tone="gray">Voltar</PillBtn></Link>
      <PillBtn tone={editing ? "green" : "gray"} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>{editing ? "Concluir edição" : "Editar"}</PillBtn>
      <span className="text-[12px] text-slate-500">{resourceLabel} · {p.source === "user" ? "minha personalização" : p.source === "org" ? "padrão da organização" : "padrão do sistema"}{p.saving && " · salvando…"}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {p.canEditOrg && <PillBtn tone="outline" onClick={() => void p.saveAsOrgDefault()} title="Usa este layout como padrão para todos os usuários da organização"><Building2 className="h-3.5 w-3.5" /> Padrão da organização</PillBtn>}
        {p.canEditOrg && p.hasOrgDefault && <PillBtn tone="outline" onClick={() => void p.clearOrgDefault()}>Remover padrão da organização</PillBtn>}
        <PillBtn tone="outline" onClick={() => setConfirmReset(true)}><RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão</PillBtn>
      </span>
    </div>
    <div className="grid grid-cols-12 gap-2">
      {/* campos disponíveis */}
      <div className="col-span-12 flex flex-col rounded-2xl bg-white p-3 shadow-sm md:col-span-3 lg:col-span-2">
        <div className="mb-2 text-[12.5px] font-semibold text-slate-800">Campos disponíveis</div>
        <div className="relative mb-2"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar campo disponível" aria-label="Procurar campo disponível" className="h-8 w-full rounded-full bg-slate-100 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-300" /></div>
        <div className="flex min-h-[200px] flex-col gap-2" onDragOver={(e) => { if (editing) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); const fid = e.dataTransfer.getData("text/field") || drag?.fieldId; if (fid) remove(fid); }}>
          {available.map((f) => <div key={f.id}>{chip(f.id, "flex-col items-start")}<div className="-mt-1 px-3 text-[10px] text-brand-100" /></div>)}
          {available.length === 0 && <div className="py-6 text-center text-[11.5px] text-slate-400">Todos os campos estão no formulário.</div>}
        </div>
      </div>
      {/* setas */}
      <div className="col-span-12 flex items-center justify-center gap-2 md:col-span-1 md:flex-col">
        <IconBtn aria-label="Enviar campo selecionado para o card atual" title="Enviar campo selecionado para o card atual" disabled={!editing || !sel || placed.has(sel) || !card} onClick={() => sel && card && place(sel, { cardId: card.id })}><ChevronsLeft className="h-4 w-4 md:hidden" /><ChevronsRight className="hidden h-4 w-4 md:block" /></IconBtn>
        <IconBtn aria-label="Retirar campo selecionado do formulário" title="Retirar campo selecionado do formulário" disabled={!editing || !sel || !placed.has(sel)} onClick={() => sel && remove(sel)}><ChevronsRight className="h-4 w-4 md:hidden" /><ChevronsLeft className="hidden h-4 w-4 md:block" /></IconBtn>
      </div>
      {/* painéis, cards e linhas */}
      <div className="col-span-12 rounded-2xl bg-white p-3 shadow-sm md:col-span-8 lg:col-span-9">
        <div className="flex items-center gap-1 border-b">
          {editing && <><IconBtn size="sm" aria-label="Adicionar painel" title="Adicionar painel" className="bg-brand-500 text-white hover:bg-brand-600" onClick={() => update((x) => { const id = uid("p"); setPanelId(id); return { ...x, panels: [...x.panels, { id, label: "Novo painel", order: x.panels.length + 1 }] }; })}><Plus className="h-4 w-4" /></IconBtn><IconBtn size="sm" aria-label="Remover painel" title="Remover painel (só vazio)" disabled={l.panels.length <= 1 || cards.length > 0} className="text-red-600" onClick={() => update((x) => ({ ...x, panels: x.panels.filter((q) => q.id !== panelId) }))}><Trash2 className="h-4 w-4" /></IconBtn></>}
          {l.panels.map((pn) => <button key={pn.id} type="button" role="tab" aria-selected={pn.id === panelId} onClick={() => setPanelId(pn.id)} onDoubleClick={() => { if (!editing) return; const name = prompt("Nome do painel", pn.label); if (name?.trim()) update((x) => ({ ...x, panels: x.panels.map((q) => (q.id === pn.id ? { ...q, label: name.trim().slice(0, 60) } : q)) })); }} className={cn("-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium", pn.id === panelId ? "border-slate-800 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>{pn.label}</button>)}
        </div>
        <div className="mt-1 flex items-center gap-1 border-b">
          {editing && <><IconBtn size="sm" aria-label="Adicionar card" title="Adicionar card" className="bg-brand-500 text-white hover:bg-brand-600" onClick={() => setCards((cs) => { const id = uid("c"); setCardId(id); return [...cs, { id, panelId, label: "Novo card", order: cs.length + 1, colSpan: 12, rows: [] }]; })}><Plus className="h-4 w-4" /></IconBtn><IconBtn size="sm" aria-label="Remover card" title="Remover card (só vazio)" disabled={!card || cardFieldIds(card).length > 0} className="text-red-600" onClick={() => card && setCards((cs) => cs.filter((x) => x.id !== card.id))}><Trash2 className="h-4 w-4" /></IconBtn>{card && <IconBtn size="sm" aria-label={card.colSpan === 12 ? "Card inteiro (clique para meio)" : "Card meio (clique para inteiro)"} title={card.colSpan === 12 ? "Card inteiro (clique para meio)" : "Card meio (clique para inteiro)"} onClick={() => updCard(card.id, (x) => ({ ...x, colSpan: x.colSpan === 12 ? 6 : 12 }))}>{card.colSpan === 12 ? <RectangleHorizontal className="h-4 w-4" /> : <Square className="h-4 w-4" />}</IconBtn>}</>}
          {cards.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === cardId} onClick={() => setCardId(c.id)} onDoubleClick={() => { if (!editing) return; const name = prompt("Nome do card", c.label); if (name?.trim()) updCard(c.id, (x) => ({ ...x, label: name.trim().slice(0, 60) })); }} className={cn("-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-[12px] font-medium", c.id === cardId ? "border-slate-800 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>{c.label}<span className="text-[10px] text-slate-400">{c.colSpan === 12 ? "▭" : "½"}</span></button>)}
          {cards.length === 0 && <span className="px-2 py-2 text-[11.5px] text-slate-400">Nenhum card neste painel</span>}
        </div>
        <p className="my-2 text-[10.5px] text-slate-500"><span className="text-brand-700">Painel</span> → <span className="text-brand-700">Card</span> → <span className="text-brand-700">Linha</span> → Campo. Card inteiro: até <b>{MAX_FIELDS_PER_ROW[12]}</b> por linha; card meio (½): até <b>{MAX_FIELDS_PER_ROW[6]}</b>. Os campos da mesma linha ficam lado a lado e o espaço é redistribuído automaticamente (como no formulário).{editing ? " Arraste os campos ou clique em um campo e depois na linha de destino; duplo clique renomeia painel/card." : " Clique em Editar para alterar."}</p>
        {card && <div className="space-y-2">
          {card.rows.map((r, ri) => dropZone({ cardId: card.id, rowIdx: ri }, "rounded-xl border bg-white p-3 shadow-sm", <>
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600"><span>Linha {ri + 1} <span className={r.fieldIds.length >= MAX_FIELDS_PER_ROW[card.colSpan] ? "text-amber-600" : "text-slate-400"}>({r.fieldIds.length}/{MAX_FIELDS_PER_ROW[card.colSpan]})</span></span>{editing && <button type="button" aria-label={`Remover linha ${ri + 1}`} className="rounded-full bg-red-50 p-1 text-red-600 hover:bg-red-100" onClick={(e) => { e.stopPropagation(); if (r.fieldIds.some((fid) => info(fid)?.required)) { toast.warning("A linha tem campo obrigatório"); return; } updCard(card.id, (x) => ({ ...x, rows: x.rows.filter((_, i) => i !== ri) })); update((x) => ({ ...x, hiddenFieldIds: [...new Set([...x.hiddenFieldIds, ...r.fieldIds])] })); }}><Trash2 className="h-3.5 w-3.5" /></button>}</div>
            <div className="flex flex-wrap gap-2">{r.fieldIds.map((fid) => <div key={fid} className="flex min-w-[120px] flex-1" onDragOver={(e) => { if (editing) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => onDrop(e, { cardId: card.id, rowIdx: ri, before: fid })}>{chip(fid)}</div>)}</div>
          </>))}
          {editing && dropZone({ cardId: card.id }, "flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-[11.5px] text-slate-400 hover:border-brand-400 hover:text-brand-700", <><Plus className="h-4 w-4" /> Arraste um campo para adicionar nova linha</>)}
          {!editing && card.rows.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-[11.5px] text-slate-400">Card vazio</div>}
        </div>}
      </div>
    </div>
    {sel && editing && info(sel) && <B1Popover open onOpenChange={(o) => { if (!o) setSel(null); }} align="start" className="w-72" trigger={<span className="fixed bottom-4 left-1/2 h-0 w-0" aria-hidden />}><div className="mb-1 flex items-center gap-1 text-[11px] uppercase text-slate-500"><Settings2 className="h-3.5 w-3.5" /> Propriedades do campo</div><FieldProps fid={sel} /></B1Popover>}
    <Confirm open={confirmReset} onOpenChange={setConfirmReset} title="Restaurar padrão" text="Remove a sua personalização deste formulário (volta ao padrão da organização ou do sistema)." onConfirm={() => { setConfirmReset(false); void p.reset(); }} />
  </div>;
}
