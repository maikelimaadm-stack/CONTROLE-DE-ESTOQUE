"use client";
import * as React from "react";
import { FilterX } from "lucide-react";
import { MgCheck } from "@/features/base1/ui";

/**
 * Filtro de cabeçalho do painel de itens (fpop do HTML de referência): lista dos valores distintos da coluna,
 * com contagem, "Selecionar todos", busca e "Limpar filtro". Recorta só as linhas já carregadas.
 * `marcados = null` é "sem filtro"; aplicar com todos marcados também remove o filtro.
 */
export function FiltroDeColuna({ rotulo, ancora, valores, marcados, onAplicar, onFechar }: {
  rotulo: string; ancora: string; valores: string[]; marcados: Set<string> | null;
  onAplicar: (vs: Set<string> | null) => void; onFechar: () => void;
}) {
  const contagem = React.useMemo(() => { const m = new Map<string, number>(); for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })); }, [valores]);
  const [sel, setSel] = React.useState<Set<string>>(() => new Set(marcados ?? contagem.map(([v]) => v)));
  const [busca, setBusca] = React.useState("");
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  React.useLayoutEffect(() => {
    const el = document.querySelector(ancora)?.closest("th");
    if (el) { const b = el.getBoundingClientRect(); setPos({ top: b.bottom + 4, left: Math.min(b.left, window.innerWidth - 262) }); }
  }, [ancora]);
  const vistos = contagem.filter(([v]) => v.toLowerCase().includes(busca.toLowerCase()));
  const todos = vistos.every(([v]) => sel.has(v));
  const alternar = (v: string) => setSel((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  return <>
    <button type="button" aria-label="Fechar o filtro" tabIndex={-1} className="fixed inset-0 z-[59] cursor-default" onClick={onFechar} />
    <div className="fpop" role="menu" aria-label="Filtrar coluna" style={pos}>
      <div className="fpop-h"><span>Filtrar</span><b>{rotulo}</b></div>
      <button type="button" className="fmi" disabled={!marcados} onClick={() => onAplicar(null)}><FilterX className="h-3.5 w-3.5" /><span className="fval-l">Limpar filtro de “{rotulo}”</span></button>
      <div className="px-2.5 pb-1.5"><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar valor" className="h-7 w-full rounded-full bg-[var(--mg-gray-fill)] px-3 text-[12px] focus:outline-none" /></div>
      <div className="fpop-l">
        <label className="fval cursor-pointer font-semibold"><MgCheck checked={todos} indeterminate={!todos && vistos.some(([v]) => sel.has(v))} onChange={(on) => setSel((p) => { const n = new Set(p); for (const [v] of vistos) { if (on) n.add(v); else n.delete(v); } return n; })} /><span className="fval-l">Selecionar todos</span></label>
        {vistos.map(([v, n]) => <label key={v} className="fval cursor-pointer"><MgCheck checked={sel.has(v)} onChange={() => alternar(v)} /><span className="fval-l">{v || "(vazio)"}</span><span className="r">{n}</span></label>)}
      </div>
      <div className="fpop-f">
        <span className="flex-1 text-[11px] text-slate-400">{sel.size} de {contagem.length}</span>
        <button type="button" className="tb-btn tb-btn-out sm" onClick={onFechar}>Cancelar</button>
        <button type="button" className="tb-btn novo sm" disabled={sel.size === 0} onClick={() => onAplicar(sel.size === contagem.length ? null : sel)}>Aplicar</button>
      </div>
    </div>
  </>;
}
