"use client";
import * as React from "react";
import Link from "next/link";
import { Search, Plus, Trash2, RectangleHorizontal, BetweenHorizontalStart, ChevronFirst, ChevronLast, Settings, X, Redo2, Building2, RotateCcw, LockKeyhole, EyeOff } from "lucide-react";
import { toast } from "@/lib/toast";
import type { FieldDef } from "@agro/domain";
import { buildDefaultFormLayout, normalizeFormLayout, cardFieldIds, MAX_FIELDS_PER_ROW, type FormLayout, type LayoutCard, type LayoutFieldInfo } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Input, Confirm } from "@/components/ui";
import { MgCheck } from "@/features/base1/ui";

export const toLayoutFields = (fields: FieldDef[]): LayoutFieldInfo[] => fields.map((f) => ({ id: f.name, label: f.label, section: f.section, span: f.span, required: f.required, readOnly: f.readOnly }));

/** Layout do formulário de um cadastro declarativo (preferência por usuário > organização > padrão derivado da definição). */
export function useFormLayout(resourceKey: string, fields: FieldDef[]): ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] } {
  const fieldsInfo = React.useMemo(() => toLayoutFields(fields), [fields]);
  const normalize = React.useCallback((raw: unknown) => (raw ? normalizeFormLayout(raw, fieldsInfo).layout : buildDefaultFormLayout(fieldsInfo)), [fieldsInfo]);
  const p = useScreenPrefs<FormLayout>(resourceKey, "form", normalize);
  return { ...p, fieldsInfo };
}

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
const WIDTHS: { label: string; span: number }[] = [{ label: "Pequena", span: 2 }, { label: "Média", span: 3 }, { label: "Grande", span: 6 }, { label: "Inteira", span: 12 }];
type Target = { cardId: string; rowIdx?: number; before?: string };

/**
 * "Configuração de layout" — réplica do configurador do MG (EmpLayoutConfiguratorDialog): grade 268 / 40 / 1fr com os campos
 * disponíveis à esquerda (chips verdes; vermelho = obrigatório), coluna de transferência, e à direita as abas de painéis, as abas
 * de cards (inteiro / meio) e as linhas com os campos. Painel → Card → Linha → Campo. Editar → rascunho; Salvar grava a preferência.
 */
export function FormLayoutPage({ p, resourceLabel, backHref }: { p: ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[] }; resourceLabel: string; backHref: string }) {
  const { prefs: saved, update, fieldsInfo } = p;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<FormLayout>(saved);
  const l = editing ? draft : saved;
  const [panelId, setPanelId] = React.useState<string>(saved.panels[0]?.id ?? "principal");
  const cards = l.cards.filter((c) => c.panelId === panelId).sort((a, b) => a.order - b.order);
  const [cardId, setCardId] = React.useState<string>(cards[0]?.id ?? "");
  const [sel, setSel] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<{ fid: string; rect: DOMRect } | null>(null);
  const [drag, setDrag] = React.useState<string | null>(null); const [overRow, setOverRow] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [renaming, setRenaming] = React.useState<{ kind: "panel" | "card"; id: string } | null>(null);
  React.useEffect(() => { if (!l.panels.some((x) => x.id === panelId)) setPanelId(l.panels[0]?.id ?? "principal"); }, [l.panels, panelId]);
  React.useEffect(() => { if (!cards.some((c) => c.id === cardId)) setCardId(cards[0]?.id ?? ""); }, [cards.map((c) => c.id).join(","), cardId]);
  const card = cards.find((c) => c.id === cardId);
  const info = (id: string) => fieldsInfo.find((f) => f.id === id);
  const label = (id: string) => l.fieldLabels[id] ?? info(id)?.label ?? id;
  const isRequired = (id: string) => Boolean(info(id)?.required) || l.requiredFieldIds.includes(id);
  const placed = new Set(l.cards.flatMap(cardFieldIds));
  const available = fieldsInfo.filter((f) => !placed.has(f.id) && (!search || f.label.toLowerCase().includes(search.toLowerCase())));
  const mut = (fn: (x: FormLayout) => FormLayout) => { if (editing) setDraft((d) => fn(d)); };
  const setCards = (fn: (cards: LayoutCard[]) => LayoutCard[]) => mut((x) => ({ ...x, cards: fn(x.cards).map((c, i) => ({ ...c, order: i + 1 })) }));
  const updCard = (id: string, fn: (c: LayoutCard) => LayoutCard) => setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const strip = (cs: LayoutCard[], fid: string) => cs.map((c) => ({ ...c, rows: c.rows.map((r) => ({ ...r, fieldIds: r.fieldIds.filter((x) => x !== fid) })).filter((r) => r.fieldIds.length) }));
  const startEdit = () => { setDraft(saved); setEditing(true); };
  const save = () => { const clean = { ...draft, cards: draft.cards.map((c) => ({ ...c, rows: c.rows.filter((r) => r.fieldIds.length) })) }; update(() => clean); setEditing(false); setSel(null); setSettings(null); toast.success("Layout salvo"); };
  const cancel = () => { setDraft(saved); setEditing(false); setSel(null); setSettings(null); };
  /** coloca o campo na linha (ou em nova linha) do card; respeita o máximo por linha */
  const place = (fid: string, target: Target) => {
    if (!editing) return;
    const dest = l.cards.find((c) => c.id === target.cardId); const destRow = dest && target.rowIdx !== undefined ? dest.rows[target.rowIdx] : undefined;
    if (dest && destRow && !destRow.fieldIds.includes(fid) && destRow.fieldIds.length >= MAX_FIELDS_PER_ROW[dest.colSpan]) { toast.warning(`Esta linha já tem ${MAX_FIELDS_PER_ROW[dest.colSpan]} campos (máximo para este card).`); setDrag(null); return; }
    setCards((cs) => { const s = strip(cs, fid); return s.map((c) => { if (c.id !== target.cardId) return c; const rows = c.rows.map((r) => ({ ...r, fieldIds: [...r.fieldIds] })); const row = target.rowIdx !== undefined ? rows[target.rowIdx] : undefined; if (row) { const at = target.before ? row.fieldIds.indexOf(target.before) : -1; if (at >= 0) row.fieldIds.splice(at, 0, fid); else row.fieldIds.push(fid); } else rows.push({ id: uid("r"), fieldIds: [fid] }); return { ...c, rows }; }); });
    mut((x) => ({ ...x, hiddenFieldIds: x.hiddenFieldIds.filter((h) => h !== fid) }));
    setSel(null); setDrag(null); setOverRow(null);
  };
  const remove = (fid: string) => { if (!editing) return; if (info(fid)?.required) { toast.warning("Campo obrigatório não pode sair do formulário"); return; } setCards((cs) => strip(cs, fid)); mut((x) => ({ ...x, hiddenFieldIds: [...new Set([...x.hiddenFieldIds, fid])] })); setSel(null); setSettings(null); setDrag(null); };
  const onDrop = (e: React.DragEvent, target: Target) => { e.preventDefault(); e.stopPropagation(); const fid = e.dataTransfer.getData("text/field") || drag; if (fid) place(fid, target); };
  const dragProps = (fid: string) => editing ? { draggable: true, onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/field", fid); e.dataTransfer.effectAllowed = "move"; setDrag(fid); }, onDragEnd: () => { setDrag(null); setOverRow(null); } } : {};
  const openSettings = (fid: string, el: HTMLElement) => { setSel(fid); setSettings({ fid, rect: el.getBoundingClientRect() }); };
  React.useEffect(() => { if (!settings) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setSettings(null); setSel(null); } }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [settings]);
  const statusIcons = (fid: string) => <span className="emp-layout-config-field-status-icons flex items-center">{l.hiddenFieldIds.includes(fid) && <EyeOff className="h-3 w-3" aria-label="Oculto" />}{(l.lockedFieldIds.includes(fid) || info(fid)?.readOnly) && <LockKeyhole className="h-3 w-3" aria-label="Travado" />}</span>;
  /** chip de campo (verde; vermelho = obrigatório; texto branco); no painel: ações remover e configurar */
  const chip = (fid: string, where: "panel" | "available", row?: { cardId: string; rowIdx: number }) => {
    const required = isRequired(fid); const selected = sel === fid; const f = info(fid);
    return <div key={fid} role="button" tabIndex={0} aria-label={label(fid)} aria-disabled={!editing} {...dragProps(fid)}
      onClick={(e) => { if (!editing) return; if (selected) { setSel(null); setSettings(null); } else openSettings(fid, e.currentTarget); }}
      onKeyDown={(e) => { if (e.key === "Enter") openSettings(fid, e.currentTarget); }}
      onDragOver={(e) => { if (editing && row) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => row && onDrop(e, { cardId: row.cardId, rowIdx: row.rowIdx, before: fid })}
      className={cn("emp-layout-config-field", required ? "emp-layout-config-field-required" : "emp-layout-config-field-optional", where === "panel" ? "emp-layout-config-field-panel" : "emp-layout-config-field-available", selected && "emp-layout-config-field-selected", !editing && "emp-layout-config-field-readonly", drag === fid && "emp-layout-config-field--dragging")}>
      {where === "available" ? <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{label(fid)}</div><div className="truncate text-[10px] opacity-75">{f?.section ?? "Dados"}</div></div> : <span className="min-w-0 flex-1 truncate text-xs font-semibold">{label(fid)}</span>}
      {statusIcons(fid)}
      <span className="emp-layout-config-field-actions flex shrink-0 items-center">
        {where === "available"
          ? <button type="button" className="emp-layout-config-field-action" title="Adicionar ao painel" aria-label={`Adicionar ${label(fid)} ao painel`} disabled={!editing || !card} onClick={(e) => { e.stopPropagation(); if (card) place(fid, { cardId: card.id }); }}><Redo2 /></button>
          : <><button type="button" className="emp-layout-config-field-action" title="Remover do painel" aria-label={`Remover ${label(fid)} do painel`} disabled={!editing || Boolean(f?.required)} onClick={(e) => { e.stopPropagation(); remove(fid); }}><X /></button>
            <button type="button" className="emp-layout-config-field-action" title="Configurações do campo" aria-label={`Configurações de ${label(fid)}`} disabled={!editing} onClick={(e) => { e.stopPropagation(); openSettings(fid, e.currentTarget.closest("[role=button]") as HTMLElement); }}><Settings /></button></>}
      </span>
    </div>;
  };
  const rowMax = card ? MAX_FIELDS_PER_ROW[card.colSpan] : 7;
  const addAll = () => { if (!card) return; available.forEach((f) => place(f.id, { cardId: card.id })); };
  const removeAll = () => { if (!card) return; cardFieldIds(card).filter((fid) => !info(fid)?.required).forEach(remove); };
  const source = p.source === "user" ? "minha personalização" : p.source === "org" ? "padrão da organização" : "padrão do sistema";
  const settingsField = settings ? info(settings.fid) : undefined;
  return <div className="b1 emp-layout-configurator flex flex-col gap-2" data-testid="layout-config">
    {/* barra de ações (bridge do MgActionBar em modo configuração de layout) */}
    <div className="mg-toolbar mg-card flex-wrap no-print">
      <Link href={backHref}><button type="button" className="tb-btn tb-btn-ghost is-primary">Voltar</button></Link>
      {!editing && <button type="button" className="tb-btn tb-btn-ghost is-primary" onClick={startEdit}>Editar</button>}
      {editing && <><button type="button" className="tb-btn tb-btn-green" onClick={save}>Salvar</button><button type="button" className="tb-btn tb-btn-ghost is-primary" onClick={cancel}>Cancelar</button></>}
      <span className="text-[12px] text-[var(--mg-text-2)]">{resourceLabel} · {source}{p.saving && " · salvando…"}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {p.canEditOrg && <button type="button" className="tb-btn tb-btn-ghost is-primary" onClick={() => void p.saveAsOrgDefault()} title="Usa este layout como padrão para todos os usuários da organização"><Building2 /> Padrão da organização</button>}
        {p.canEditOrg && p.hasOrgDefault && <button type="button" className="tb-btn tb-btn-ghost is-primary" onClick={() => void p.clearOrgDefault()}>Remover padrão da organização</button>}
        <button type="button" className="tb-btn tb-btn-ghost is-primary" onClick={() => setConfirmReset(true)}><RotateCcw /> Restaurar padrão</button>
      </span>
    </div>
    <div className={cn("emp-layout-config-grid", editing && "emp-layout-config-editing", drag && "emp-layout-config-is-dragging")}>
      {/* campos disponíveis */}
      <aside className="emp-layout-config-sidebar" onDragOver={(e) => { if (editing) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); const fid = e.dataTransfer.getData("text/field") || drag; if (fid) remove(fid); }}>
        <div className="emp-layout-config-sidebar-title">Campos disponíveis</div>
        <div className="mg-search-pill emp-layout-config-sidebar-search" role="search"><Search className="mg-search-pill-icon" aria-hidden /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar campo disponível" aria-label="Procurar campo disponível" /></div>
        <div className={cn("emp-layout-config-available-list", drag && placed.has(drag) && "emp-layout-config-drop-target")}>
          {available.map((f) => chip(f.id, "available"))}
          {available.length === 0 && <div className="py-6 text-center text-[11px] text-[var(--mg-text-3)]">{editing ? "Solte aqui para remover do painel." : "Todos os campos estão no formulário."}</div>}
        </div>
      </aside>
      {/* transferência */}
      <section className="emp-layout-config-transfer">
        <button type="button" className="mg-nav-btn emp-layout-config-transfer-btn" title="Remover todos" aria-label="Remover todos os campos do card" disabled={!editing || !card} onClick={removeAll}><ChevronFirst /></button>
        <button type="button" className="mg-nav-btn emp-layout-config-transfer-btn" title="Adicionar todos" aria-label="Adicionar todos os campos ao card" disabled={!editing || !card || available.length === 0} onClick={addAll}><ChevronLast /></button>
      </section>
      {/* painéis, cards e linhas */}
      <main className="emp-layout-config-main">
        <div className="mg-panel-tabs-strip emp-layout-config-panel-tabs">
          {editing && <div className="emp-layout-config-panel-actions">
            <button type="button" className="mg-nav-btn is-green" title="Novo painel" aria-label="Novo painel" onClick={() => { const id = uid("p"); mut((x) => ({ ...x, panels: [...x.panels, { id, label: `Painel Personalizado ${x.panels.length}`, order: x.panels.length + 1 }] })); setPanelId(id); setRenaming({ kind: "panel", id }); }}><Plus /></button>
            <button type="button" className="mg-nav-btn is-danger" title="Excluir painel" aria-label="Excluir painel" disabled={l.panels.length <= 1 || cards.length > 0} onClick={() => mut((x) => ({ ...x, panels: x.panels.filter((q) => q.id !== panelId) }))}><Trash2 /></button>
          </div>}
          <div className="seg-control" role="tablist">
            {l.panels.map((pn) => <button key={pn.id} type="button" role="tab" aria-selected={pn.id === panelId} onClick={() => { setPanelId(pn.id); setSel(null); }} onDoubleClick={() => editing && setRenaming({ kind: "panel", id: pn.id })} className={cn("seg-tab", pn.id === panelId && "active")}>
              {renaming?.kind === "panel" && renaming.id === pn.id ? <input autoFocus className="h-6 w-40 border-0 bg-transparent p-0 text-xs font-semibold outline-none" value={pn.label} onBlur={() => setRenaming(null)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setRenaming(null); }} onChange={(e) => mut((x) => ({ ...x, panels: x.panels.map((q) => (q.id === pn.id ? { ...q, label: e.target.value.slice(0, 60) } : q)) }))} aria-label="Nome do painel" /> : pn.label}
            </button>)}
          </div>
        </div>
        <div className="mg-panel-tabs-strip emp-layout-config-card-tabs">
          {editing && <div className="emp-layout-config-card-actions">
            <button type="button" className="mg-nav-btn is-green" title="Novo card" aria-label="Novo card" onClick={() => { const id = uid("c"); setCards((cs) => [...cs, { id, panelId, label: `Card ${cs.filter((c) => c.panelId === panelId).length + 1}`, order: cs.length + 1, colSpan: 6, rows: [] }]); setCardId(id); setRenaming({ kind: "card", id }); }}><Plus /></button>
            {cards.length > 1 && <button type="button" className="mg-nav-btn is-danger" title="Excluir card" aria-label="Excluir card" disabled={!card || cardFieldIds(card).length > 0} onClick={() => card && setCards((cs) => cs.filter((c) => c.id !== card.id))}><Trash2 /></button>}
            {card && <button type="button" className="mg-nav-btn" title={card.colSpan === 12 ? "Card inteiro (clique para meio)" : "Card meio (clique para inteiro)"} aria-label="Alternar largura do card" onClick={() => updCard(card.id, (c) => ({ ...c, colSpan: c.colSpan === 12 ? 6 : 12 }))}>{card.colSpan === 12 ? <RectangleHorizontal strokeWidth={2.1} /> : <BetweenHorizontalStart strokeWidth={2.1} />}</button>}
          </div>}
          <div className="seg-control" role="tablist">
            {cards.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === cardId} onClick={() => { setCardId(c.id); setSel(null); }} onDoubleClick={() => editing && setRenaming({ kind: "card", id: c.id })} className={cn("seg-tab emp-layout-config-card-tab-btn", c.id === cardId && "active")}>
              {renaming?.kind === "card" && renaming.id === c.id ? <input autoFocus className="h-6 w-28 border-0 bg-transparent p-0 text-xs font-semibold outline-none" value={c.label} onBlur={() => setRenaming(null)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setRenaming(null); }} onChange={(e) => updCard(c.id, (cc) => ({ ...cc, label: e.target.value.slice(0, 60) }))} aria-label="Nome do card" /> : <>{c.label}<span className="ml-1 inline-flex opacity-70">{c.colSpan === 12 ? <RectangleHorizontal className="h-2.5 w-2.5" /> : <BetweenHorizontalStart className="h-2.5 w-2.5" />}</span></>}
            </button>)}
            {cards.length === 0 && <span className="px-2 py-2 text-[11.5px] text-[var(--mg-text-3)]">Nenhum card neste painel</span>}
          </div>
        </div>
        <div className="emp-layout-config-panel-body">
          <p className="emp-layout-config-help">Painel → Card → Linha → Campo. Card inteiro: até <b>{MAX_FIELDS_PER_ROW[12]}</b> por linha; card meio (½): até <b>{MAX_FIELDS_PER_ROW[6]}</b>. Os campos da mesma linha ficam lado a lado e o espaço é redistribuído automaticamente (como no formulário).</p>
          {card && <div className="emp-layout-config-rows">
            {card.rows.map((r, ri) => { const full = r.fieldIds.length >= rowMax; return <div key={r.id} className={cn("emp-layout-config-row emp-layout-config-card-shell", full && "emp-layout-config-row--full")} onDragOver={(e) => { if (editing) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverRow(r.id); } }} onDragLeave={() => setOverRow((o) => (o === r.id ? null : o))} onDrop={(e) => onDrop(e, { cardId: card.id, rowIdx: ri })}>
              <div className="emp-layout-config-row-header"><span className="emp-layout-config-row-label">Linha {ri + 1} <span className={cn("ml-1 font-semibold", full && "emp-layout-config-row-label--full")}>({r.fieldIds.length}/{rowMax})</span></span>{editing && <button type="button" className="mg-nav-btn is-danger" title="Excluir linha" aria-label={`Excluir linha ${ri + 1}`} onClick={() => { if (r.fieldIds.some((fid) => info(fid)?.required)) { toast.warning("A linha tem campo obrigatório: mova-o antes de excluir a linha."); return; } updCard(card.id, (c) => ({ ...c, rows: c.rows.filter((x) => x.id !== r.id) })); mut((x) => ({ ...x, hiddenFieldIds: [...new Set([...x.hiddenFieldIds, ...r.fieldIds])] })); }}><Trash2 /></button>}</div>
              <div className={cn("emp-layout-config-panel-fields", overRow === r.id && drag && "emp-layout-config-row-drop--active")}>
                {r.fieldIds.length === 0 && editing && <span className="emp-layout-config-row-dropzone">Arraste campos para esta linha</span>}
                {r.fieldIds.map((fid) => <div key={fid} className="emp-layout-config-field-slot" style={{ flex: `${l.fieldSizes[fid] ?? info(fid)?.span ?? 3} 1 0` }}>{chip(fid, "panel", { cardId: card.id, rowIdx: ri })}</div>)}
              </div>
            </div>; })}
            {editing && <div className="emp-layout-config-row emp-layout-config-row--draft emp-layout-config-card-shell" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => onDrop(e, { cardId: card.id })}>
              <div className="emp-layout-config-row-draft"><button type="button" className="emp-layout-config-row-draft-add" title="Adicionar linha" aria-label="Adicionar linha" onClick={() => { if (sel && !placed.has(sel)) place(sel, { cardId: card.id }); else updCard(card.id, (c) => ({ ...c, rows: [...c.rows, { id: uid("r"), fieldIds: [] }] })); }}><Plus /></button><span className="text-[10px] text-[var(--mg-text-3)]">Arraste um campo para adicionar nova linha</span></div>
            </div>}
            {!editing && card.rows.length === 0 && <div className="emp-layout-config-card-shell text-center text-[11.5px] text-[var(--mg-text-3)]">Card vazio</div>}
          </div>}
          {editing && sel && placed.has(sel) && <div className="emp-layout-config-footer">
            <span className="emp-layout-config-footer-label">Tipo de largura:</span>
            {WIDTHS.map((w) => <button key={w.span} type="button" className={cn("emp-layout-config-footer-btn", (l.fieldSizes[sel] ?? info(sel)?.span ?? 3) === w.span && "emp-layout-config-footer-btn--active")} onClick={() => mut((x) => ({ ...x, fieldSizes: { ...x.fieldSizes, [sel]: w.span } }))}>{w.label}</button>)}
            <button type="button" className="emp-layout-config-footer-btn" onClick={() => mut((x) => { const fs = { ...x.fieldSizes }; delete fs[sel]; return { ...x, fieldSizes: fs }; })}>Padrão do tipo</button>
          </div>}
        </div>
      </main>
    </div>
    {/* configurações do campo (EmpLayoutFieldSettingsPopover): ancorado ao chip */}
    {editing && settings && settingsField && <>
      <button type="button" className="mg-config-backdrop" tabIndex={-1} aria-label="Fechar configurações" onClick={() => { setSettings(null); setSel(null); }} onKeyDown={(e) => { if (e.key === "Escape") { setSettings(null); setSel(null); } }} />
      <div role="dialog" aria-label={`Configurações de ${settingsField.label}`} className="mg-card fixed z-[60] w-72 p-3 text-[12px]" style={{ top: Math.min(settings.rect.bottom + 6, (typeof window !== "undefined" ? window.innerHeight : 800) - 330), left: Math.min(settings.rect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300) }} onKeyDown={(e) => { if (e.key === "Escape") { setSettings(null); setSel(null); } }}>
        <div className="mb-2 flex items-center justify-between"><span className="font-semibold text-[var(--mg-text-1)]">{settingsField.label}</span><button type="button" className="mg-nav-btn !h-6 !w-6" aria-label="Fechar" onClick={() => { setSettings(null); setSel(null); }}><X /></button></div>
        <div className="space-y-2">
          <label className="block"><span className="mg-label">Rótulo exibido</span><Input value={l.fieldLabels[settings.fid] ?? ""} placeholder={settingsField.label} onChange={(e) => mut((x) => { const fl = { ...x.fieldLabels }; if (e.target.value.trim()) fl[settings.fid] = e.target.value; else delete fl[settings.fid]; return { ...x, fieldLabels: fl }; })} /></label>
          <label className="block"><span className="mg-label">Valor padrão (novos registros)</span><Input value={String(l.fieldDefaultValues[settings.fid] ?? "")} onChange={(e) => mut((x) => { const d = { ...x.fieldDefaultValues }; if (e.target.value) d[settings.fid] = e.target.value; else delete d[settings.fid]; return { ...x, fieldDefaultValues: d }; })} /></label>
          <label className="flex items-center gap-2"><MgCheck checked={l.lockedFieldIds.includes(settings.fid)} onChange={(on) => mut((x) => ({ ...x, lockedFieldIds: on ? [...new Set([...x.lockedFieldIds, settings.fid])] : x.lockedFieldIds.filter((q) => q !== settings.fid) }))} /><span>Travado (somente leitura)</span></label>
          <label className="flex items-center gap-2"><MgCheck disabled={Boolean(settingsField.required)} checked={isRequired(settings.fid)} onChange={(on) => mut((x) => ({ ...x, requiredFieldIds: on ? [...new Set([...x.requiredFieldIds, settings.fid])] : x.requiredFieldIds.filter((q) => q !== settings.fid), hiddenFieldIds: on ? x.hiddenFieldIds.filter((q) => q !== settings.fid) : x.hiddenFieldIds, lockedFieldIds: on ? x.lockedFieldIds.filter((q) => q !== settings.fid) : x.lockedFieldIds }))} /><span>Obrigatório</span></label>
          {placed.has(settings.fid) && !settingsField.required && <button type="button" className="tb-btn tb-btn-red" onClick={() => remove(settings.fid)}><Trash2 /> Retirar do formulário</button>}
          {!placed.has(settings.fid) && card && <button type="button" className="tb-btn tb-btn-green" onClick={() => { place(settings.fid, { cardId: card.id }); setSettings(null); }}><Redo2 /> Adicionar ao card atual</button>}
        </div>
      </div>
    </>}
    <Confirm open={confirmReset} onOpenChange={setConfirmReset} title="Restaurar padrão" text="Remove a sua personalização deste formulário (volta ao padrão da organização ou do sistema)." onConfirm={() => { setConfirmReset(false); setEditing(false); void p.reset(); }} />
  </div>;
}
