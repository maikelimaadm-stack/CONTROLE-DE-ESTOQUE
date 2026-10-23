"use client";
import * as React from "react";
import { Search, RotateCcw, Check, Columns3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUp, ArrowDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";
import type { Base1Column } from "./types";

/**
 * "Configuração de colunas": rascunho até o Pronto (decisão 340). Restaurar antes do Fechar;
 * ESC/fora não fecham. Busca cfgb em cada lista e setas no meio (decisão 342).
 */
export function ColumnsDialog({ open, onOpenChange, columns, visible, onApply, onRestore, className }: { open: boolean; onOpenChange: (o: boolean) => void; columns: Base1Column[]; visible: string[]; onApply: (keys: string[]) => void; onRestore: () => void; className?: string }) {
  const padrao = React.useMemo(() => columns.map((c) => c.key), [columns]);
  const [inUse, setInUse] = React.useState<string[]>(visible);
  const [sel, setSel] = React.useState<string | null>(null);
  const [qa, setQa] = React.useState(""); const [qu, setQu] = React.useState("");
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  React.useEffect(() => { if (open) { setInUse(visible); setSel(null); setQa(""); setQu(""); setAplicarPadrao(false); } }, [open, visible]);
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const available = padrao.filter((k) => !inUse.includes(k));
  const match = (k: string, q: string) => !q || label(k).toLowerCase().includes(q.toLowerCase());
  const tocar = <T,>(fn: (prev: string[]) => T) => { setAplicarPadrao(false); return fn; };
  const add = (k: string) => setInUse(tocar((u) => (u.includes(k) ? u : [...u, k])));
  const remove = (k: string) => setInUse(tocar((u) => (u.length > 1 ? u.filter((x) => x !== k) : u)));
  const move = (k: string, dir: -1 | 1) => setInUse(tocar((u) => { const i = u.indexOf(k); const j = i + dir; if (i < 0 || j < 0 || j >= u.length) return u; const c = [...u]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; }));
  const setTodas = () => { setAplicarPadrao(false); setInUse(padrao); setSel(null); };
  const setMinimas = () => { setAplicarPadrao(false); setInUse((u) => u.slice(0, 1)); setSel(null); };
  const restaurarRascunho = () => { setInUse(padrao); setSel(null); setAplicarPadrao(true); };
  const salvar = () => { if (aplicarPadrao) onRestore(); else onApply(inUse); onOpenChange(false); };

  const busca = (valor: string, onChange: (v: string) => void, rotulo: string) => (
    <label className="cfgb cfgb-lista"><Search size={14} aria-hidden />
      <input value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Procurar coluna" aria-label={rotulo} />
      {valor
        ? <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => onChange("")}><X size={12} /></button>
        : <span className="xlim" aria-hidden />}
    </label>
  );

  return <Dialog open={open} onOpenChange={onOpenChange} title="Colunas" size="lg" profile="large"
    className={cn("b1-portal-compras b1-colunas-dlg", className)}
    bodyClassName="!p-4"
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={restaurarRascunho}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" title="Pronto" aria-label="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <div className="b1ref flex h-full min-h-0 flex-col">
      <div className="dcol">
        <div className="dbox">
          {busca(qa, setQa, "Procurar em disponíveis")}
          <div className="dbox-h">Disponíveis<span className="bd t-plain">{available.length}</span></div>
          <div className="dbox-l">
            {available.filter((k) => match(k, qa)).length === 0 && <span className="dvaz">{qa ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela."}</span>}
            {available.filter((k) => match(k, qa)).map((k) => <button type="button" key={k} onDoubleClick={() => add(k)} onClick={() => setSel(k)} className={cn("dlin", sel === k && "sel")}><span className="dlin-l">{label(k)}</span><Columns3 className="h-3.5 w-3.5 shrink-0 text-slate-400" /></button>)}
          </div>
        </div>
        <div className="dmid" aria-label="Mover colunas">
          <button type="button" className="tb-btn tb-btn-icon" title="Usar todas" aria-label="Usar todas" onClick={setTodas}><ChevronsRight className="h-4 w-4" /></button>
          <button type="button" className="tb-btn tb-btn-icon" title="Usar coluna selecionada" aria-label="Usar coluna selecionada" onClick={() => sel && add(sel)}><ChevronRight className="h-4 w-4" /></button>
          <button type="button" className="tb-btn tb-btn-icon" title="Remover coluna selecionada" aria-label="Remover coluna selecionada" onClick={() => sel && remove(sel)}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className="tb-btn tb-btn-icon" title="Remover todas (mantém a primeira)" aria-label="Remover todas (mantém a primeira)" onClick={setMinimas}><ChevronsLeft className="h-4 w-4" /></button>
        </div>
        <div className="dbox">
          {busca(qu, setQu, "Procurar na tabela")}
          <div className="dbox-h">Na tabela<span className="bd t-positive">{inUse.length}</span></div>
          <div className="dbox-l">
            {inUse.map((k, i) => match(k, qu) && <div key={k} role="button" tabIndex={0} onClick={() => setSel(k)} onDoubleClick={() => remove(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(k); } }} className={cn("dlin group", sel === k && "sel")}>
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{i + 1}</span>
              <span className="dlin-l">{label(k)}</span>
              <span className="hidden items-center gap-0.5 group-hover:flex"><button type="button" aria-label={`Subir ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, -1); }}><ArrowUp className="h-3 w-3" /></button><button type="button" aria-label={`Descer ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, 1); }}><ArrowDown className="h-3 w-3" /></button></span>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </Dialog>;
}
