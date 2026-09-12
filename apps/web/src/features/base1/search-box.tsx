"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Bookmark, Columns3Cog } from "lucide-react";
import { SEARCH_DROPDOWN_MAX_FIELDS } from "@agro/shared";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { IconBtn, MgCheck } from "./ui";
import type { Base1Column, Row } from "./types";

/** Destaca as palavras pesquisadas (mgSearchHighlight do MG). */
export function highlight(text: string, query: string): React.ReactNode {
  const t = text || "—"; const q = query.trim(); if (!q || t === "—") return t;
  const parts = q.split(/\s+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${parts.join("|")})`, "gi"); const out: React.ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(t))) { if (m.index > last) out.push(t.slice(last, m.index)); out.push(<mark key={i++} className="mg-search-dropdown__mark">{m[0]}</mark>); last = m.index + m[0].length; if (!m[0]) re.lastIndex++; }
  if (last < t.length) out.push(t.slice(last)); return out;
}

export interface SearchBoxProps {
  value: string; onChange: (v: string) => void;
  onApply: () => void; onApplyFavorites?: () => void; onClear: () => void; active: boolean; placeholder?: string; favoritesDisabled?: boolean;
  /** consulta dos resultados sugeridos enquanto digita */
  fetchResults?: (search: string) => Promise<{ items: Row[]; total: number }>;
  onPick?: (row: Row) => void; columns: Base1Column[]; scope: string;
  /** colunas exibidas como linhas de detalhe (configuração da pesquisa, máx. 5) */
  detailFields: string[]; onDetailFieldsChange: (keys: string[]) => void; onDetailFieldsRestore: () => void;
  isFavorite?: (row: Row) => boolean;
}

/**
 * Pesquisa do modelo base (mg-desktop-search + mg-search-dropdown do MG): o ícone vira a pílula; ao digitar aparecem os registros
 * (CÓDIGO • nome + linhas de detalhe configuráveis com destaque); rodapé Buscar todos / contador / Buscar favoritos / configurar.
 */
export function SearchBox({ value, onChange, onApply, onApplyFavorites, onClear, active, placeholder, favoritesDisabled, fetchResults, onPick, columns, scope, detailFields, onDetailFieldsChange, onDetailFieldsRestore, isFavorite }: SearchBoxProps) {
  const [open, setOpen] = React.useState(false); const [config, setConfig] = React.useState(false); const [draft, setDraft] = React.useState<string[]>(detailFields);
  const inputRef = React.useRef<HTMLInputElement>(null); const rootRef = React.useRef<HTMLDivElement>(null);
  const [debounced, setDebounced] = React.useState(""); React.useEffect(() => { const t = setTimeout(() => setDebounced(value.trim()), 180); return () => clearTimeout(t); }, [value]);
  React.useEffect(() => { if (open) { inputRef.current?.focus(); setConfig(false); } }, [open]);
  React.useEffect(() => { setDraft(detailFields); }, [detailFields, config]);
  React.useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (config) setConfig(false); else setOpen(false); } }; document.addEventListener("mousedown", h); document.addEventListener("keydown", k); return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); }; }, [open, config]);
  const q = useQuery({ queryKey: ["b1-search", scope, debounced], queryFn: () => fetchResults!(debounced), enabled: open && Boolean(fetchResults) && debounced.length > 0, staleTime: 30_000 });
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const text = (c: Base1Column | undefined, r: Row) => (c ? (c.text ? c.text(r) : String(r[c.key] ?? "")) : "");
  const codeCol = byKey.get("code"); const nameCol = byKey.get("name") ?? byKey.get("description") ?? byKey.get("title") ?? columns.find((c) => c.key !== "code");
  const primaries = new Set([codeCol?.key, nameCol?.key].filter(Boolean) as string[]);
  const detail = detailFields.map((k) => byKey.get(k)).filter((c): c is Base1Column => Boolean(c) && !primaries.has(c!.key));
  const hasQuery = debounced.length > 0; const items = q.data?.items ?? []; const total = q.data?.total ?? 0;
  const showLoading = hasQuery && q.isLoading; const hasData = hasQuery && !showLoading && total > 0;
  const favInResults = items.some((r) => isFavorite?.(r));
  const canFav = !hasQuery ? !favoritesDisabled : hasData && favInResults;
  const catalog = [...columns].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
  const draftCount = draft.filter((k) => !primaries.has(k)).length;
  const toggleDraft = (k: string, on: boolean) => { if (on && draftCount >= SEARCH_DROPDOWN_MAX_FIELDS) { toast.warning(`É permitido selecionar no máximo ${SEARCH_DROPDOWN_MAX_FIELDS} campos.`); return; } setDraft((d) => (on ? [...d, k] : d.filter((x) => x !== k))); };
  return <div ref={rootRef} className={cn("mg-desktop-search", open && "is-open")}>
    <IconBtn className="mg-desktop-search__trigger" aria-label={active ? "Pesquisa ativa" : "Pesquisar"} title={active ? "Limpar pesquisa" : "Pesquisar"} active={active} aria-expanded={open} onClick={() => { if (active) onClear(); else setOpen(true); }}>{active ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}</IconBtn>
    {config && open && <button type="button" className="mg-config-backdrop" tabIndex={-1} aria-label="Fechar configuração" onClick={() => setConfig(false)} />}
    <div className="mg-desktop-search__panel" aria-hidden={!open}>
      <div className="mg-desktop-search__panel-inner">
        <div className="mg-search-pill-wrap">
          <div className="mg-search-pill" role="search">
            {active ? <button type="button" className="mg-search-pill-clear" aria-label="Limpar pesquisa" onMouseDown={(e) => e.preventDefault()} onClick={() => { onClear(); setOpen(false); }}><X className="mg-search-pill-icon" aria-hidden /></button>
              : <button type="button" className="mg-search-pill-toggle" aria-label="Fechar pesquisa" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}><Search className="mg-search-pill-icon" aria-hidden /></button>}
            <input ref={inputRef} type="text" aria-label="Campo de pesquisa" placeholder={placeholder ?? "Pesquisar..."} value={value} onChange={(e) => onChange(e.target.value)} tabIndex={open ? 0 : -1} aria-haspopup="listbox" aria-expanded={open}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onApply(); setOpen(false); } }} />
          </div>
          <div className={cn("mg-search-dropdown", config && "is-config-open")} role="group" aria-label="Resultados da pesquisa">
            {config ? <div className="mg-search-dropdown__config">
              <div className="mg-search-dropdown__config-list">{catalog.map((c) => { const locked = primaries.has(c.key); const on = locked || draft.includes(c.key); return <label key={c.key} className={cn("mg-search-dropdown__config-item", locked && "is-locked")}><MgCheck checked={on} disabled={locked} onChange={(v) => toggleDraft(c.key, v)} aria-label={c.label} /><span className="min-w-0 flex-1 truncate">{c.label}</span></label>; })}</div>
              <div className="mg-search-dropdown__config-footer">
                <button type="button" className="tb-btn tb-btn-ghost mg-search-dropdown__footer-btn" onClick={() => { onDetailFieldsRestore(); setConfig(false); }}>Restaurar</button>
                <span className="mg-search-dropdown__config-counter" aria-live="polite">{draftCount}/{SEARCH_DROPDOWN_MAX_FIELDS}</span>
                <button type="button" className="tb-btn tb-btn-green mg-search-dropdown__footer-btn" onClick={() => { onDetailFieldsChange(draft.filter((k) => !primaries.has(k))); setConfig(false); }}>OK</button>
              </div>
            </div> : <>
              <div className={cn("mg-search-dropdown__list", !hasQuery && "mg-search-dropdown__list--idle")} role="listbox">
                {showLoading && <div className="mg-search-dropdown__empty">Carregando...</div>}
                {hasQuery && !showLoading && items.length === 0 && <div className="mg-search-dropdown__empty">Nenhum registro encontrado</div>}
                {hasQuery && !showLoading && items.map((r) => { const code = text(codeCol, r); const name = text(nameCol, r); return <button type="button" key={String(r["id"])} role="option" className="mg-search-dropdown__item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick?.(r); setOpen(false); }}>
                  <div className="mg-search-dropdown__head"><Bookmark className={cn("mg-search-dropdown__fav", isFavorite?.(r) && "is-active")} aria-hidden /><div className="mg-search-dropdown__title">{code && code !== "—" && <><span>{highlight(code, debounced)}</span><span className="mg-search-dropdown__sep"> • </span></>}<span>{highlight(name, debounced)}</span></div></div>
                  {detail.length > 0 && <div className="mg-search-dropdown__meta">{detail.map((c) => <div key={c.key} className="mg-search-dropdown__field-line"><span className="mg-search-dropdown__field-label">{c.label}:</span><span className="mg-search-dropdown__field-value">{highlight(text(c, r), debounced)}</span></div>)}</div>}
                </button>; })}
              </div>
              <div className={cn("mg-search-dropdown__footer", hasQuery && !showLoading && "mg-search-dropdown__footer--with-counter")}>
                <button type="button" className="tb-btn tb-btn-ghost mg-search-dropdown__footer-btn" disabled={!hasData} onMouseDown={(e) => e.preventDefault()} onClick={() => { onApply(); setOpen(false); }}>Buscar todos</button>
                {hasQuery && !showLoading && <span className="mg-search-dropdown__results-counter" aria-live="polite">{total}</span>}
                <button type="button" className="tb-btn tb-btn-ghost mg-search-dropdown__footer-btn" disabled={!canFav || !onApplyFavorites} onMouseDown={(e) => e.preventDefault()} onClick={() => { onApplyFavorites?.(); setOpen(false); }}>Buscar favoritos</button>
                <button type="button" className="mg-search-dropdown__config-btn" aria-label="Configurar campos da pesquisa" title="Configurar campos da pesquisa" onMouseDown={(e) => e.preventDefault()} onClick={() => setConfig(true)}><Columns3Cog strokeWidth={2.1} /></button>
              </div>
            </>}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
