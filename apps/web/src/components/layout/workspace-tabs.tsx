"use client";
import * as React from "react";
import { X, Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Menu, ConfirmDialog } from "@/components/ui";
import { useWorkspaceTabs, HOME_KEY, type WsTab } from "@/lib/workspace-tabs";

/**
 * Barra global de abas (docs/UI-STANDARD.md › App Shell & Workspace): uma pílula por tela aberta, aba raiz "Início"
 * não fechável, × por aba (com confirmação quando há alterações não salvas), rail com rolagem horizontal, menu de
 * abas quando não cabem, "+" abre a busca global. Teclado: setas movem o foco, Enter/Espaço focam a aba, Delete fecha.
 */
export function WorkspaceTabsBar({ onNewTab }: { onNewTab: () => void }) {
  const ws = useWorkspaceTabs(); const railRef = React.useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = React.useState<WsTab | null>(null); const [overflow, setOverflow] = React.useState(false);
  React.useEffect(() => { const el = railRef.current?.querySelector<HTMLElement>('[aria-selected="true"]'); el?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [ws?.active, ws?.tabs.length]);
  React.useEffect(() => { const el = railRef.current; if (!el) return; const calc = () => setOverflow(el.scrollWidth > el.clientWidth + 1); calc(); const ro = new ResizeObserver(calc); ro.observe(el); return () => ro.disconnect(); }, [ws?.tabs.length]);
  if (!ws) return null;
  const close = (t: WsTab) => { if (!ws.closeTab(t.key)) setConfirm(t); };
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, t: WsTab, i: number) => {
    const list = ws.tabs;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const j = e.key === "ArrowRight" ? Math.min(i + 1, list.length - 1) : Math.max(i - 1, 0); railRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); railRef.current?.querySelector<HTMLElement>('[role="tab"]')?.focus(); }
    else if (e.key === "End") { e.preventDefault(); const all = railRef.current?.querySelectorAll<HTMLElement>('[role="tab"]'); all?.[all.length - 1]?.focus(); }
    else if (e.key === "Delete" && t.key !== HOME_KEY) { e.preventDefault(); close(t); }
  };
  return <div className="mg-tabbar no-print" data-testid="workspace-tabs">
    <div ref={railRef} className="mg-tabbar__rail" role="tablist" aria-label="Abas abertas">
      {ws.tabs.map((t, i) => { const on = t.key === ws.active; const dirty = ws.dirty.has(t.key); return <div key={t.key} className={cn("mg-tab", on && "is-active", dirty && "is-dirty")} data-testid="workspace-tab" data-tab-key={t.key} data-kind={t.kind}>
        <button type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} className="mg-tab__label" title={t.label} onClick={() => { if (!on) ws.focusTab(t.key); }} onKeyDown={(e) => onKey(e, t, i)} onAuxClick={(e) => { if (e.button === 1 && t.key !== HOME_KEY) { e.preventDefault(); close(t); } }}>
          <span className="truncate">{t.label}</span>{dirty && <span className="mg-tab__dirty" aria-label="Alterações não salvas" title="Alterações não salvas" />}
        </button>
        {t.key !== HOME_KEY && <button type="button" className="mg-tab__close" aria-label={`Fechar aba ${t.label}`} title="Fechar aba" tabIndex={-1} onClick={(e) => { e.stopPropagation(); close(t); }}><X aria-hidden /></button>}
      </div>; })}
    </div>
    {(overflow || ws.tabs.length > 6) && <Menu trigger={<button type="button" className="mg-tabbar__btn" aria-label="Lista de abas abertas" data-testid="workspace-tabs-menu"><ChevronDown /></button>} items={[...ws.tabs.map((t) => ({ label: `${t.key === ws.active ? "● " : ""}${t.label}`, onClick: () => ws.focusTab(t.key) })), { label: "Fechar as outras abas", onClick: () => ws.closeOthers(ws.active), danger: true }]} />}
    <button type="button" className="mg-tabbar__btn" aria-label="Nova aba (buscar tela)" title="Nova aba: buscar tela (Ctrl K)" data-testid="workspace-tabs-new" onClick={onNewTab}><Plus /></button>
    <span className="mg-tabbar__count" aria-live="polite">{ws.tabs.length} {ws.tabs.length === 1 ? "aba" : "abas"}</span>
    <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o) setConfirm(null); }} title="Fechar aba com alterações não salvas?" description={confirm ? `"${confirm.label}" tem ${COPY.alteracoesNaoSalvas.toLowerCase()}. Ao fechar, elas serão descartadas.` : undefined} confirmLabel="Fechar mesmo assim" danger onConfirm={() => { if (confirm) ws.closeTab(confirm.key, true); setConfirm(null); }} />
  </div>;
}
