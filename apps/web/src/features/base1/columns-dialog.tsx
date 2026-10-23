"use client";
import * as React from "react";
import { Search, RotateCcw, Check, Columns3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";
import type { Base1Column } from "./types";

/**
 * "Configuração de colunas": rascunho até o Pronto (decisão 340). Restaurar fica antes do Fechar;
 * ESC/fora não fecham — só o Fechar descarta. Pronto aplica (ou restaura de verdade se pediu padrão).
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
  const setTodas = () => { setAplicarPadrao(false); setInUse(padrao); };
  const setMinimas = () => { setAplicarPadrao(false); setInUse((u) => u.slice(0, 1)); };
  const restaurarRascunho = () => { setInUse(padrao); setSel(null); setAplicarPadrao(true); };
  const salvar = () => { if (aplicarPadrao) onRestore(); else onApply(inUse); onOpenChange(false); };

  return <Dialog open={open} onOpenChange={onOpenChange} title="Colunas" size="lg" profile="large"
    className={cn("b1-portal-compras", className)}
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={restaurarRascunho}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" title="Pronto" aria-label="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-2 text-[12.5px]">
      <div className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border">
        <div className="border-b px-3 py-2 text-[12px] font-semibold text-slate-600">Disponíveis</div>
        <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={qa} onChange={(e) => setQa(e.target.value)} placeholder="Procurar coluna" aria-label="Procurar coluna" className="h-8 w-full rounded-full bg-slate-100 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-300" /></div></div>
        <div className="min-h-0 flex-1 overflow-auto">
          {available.filter((k) => match(k, qa)).length === 0 && <div className="py-10 text-center text-slate-400">Nenhuma coluna disponível.</div>}
          {available.filter((k) => match(k, qa)).map((k) => <button type="button" key={k} onDoubleClick={() => add(k)} onClick={() => setSel(k)} className={cn("flex w-full items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left hover:bg-slate-50", sel === k && "bg-brand-50")}><Columns3 className="h-3.5 w-3.5 text-slate-400" />{label(k)}</button>)}
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-1">
        {[{ i: <ChevronsLeft className="h-4 w-4" />, t: "Usar todas", f: setTodas }, { i: <ChevronLeft className="h-4 w-4" />, t: "Usar coluna selecionada", f: () => sel && add(sel) }, { i: <ChevronRight className="h-4 w-4" />, t: "Remover coluna selecionada", f: () => sel && remove(sel) }, { i: <ChevronsRight className="h-4 w-4" />, t: "Remover todas (mantém a primeira)", f: setMinimas }].map((b, i) => <button key={i} type="button" title={b.t} aria-label={b.t} onClick={b.f} className="tb-btn tb-btn-icon">{b.i}</button>)}
      </div>
      <div className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b px-3 py-2"><span className="text-[12px] font-semibold text-slate-600">Na tabela</span><span className="text-[11px] text-slate-500">{inUse.length}</span></div>
        <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={qu} onChange={(e) => setQu(e.target.value)} placeholder="Procurar coluna em uso" aria-label="Procurar coluna em uso" className="h-8 w-full rounded-full bg-slate-100 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-300" /></div></div>
        <div className="min-h-0 flex-1 overflow-auto">
          {inUse.map((k, i) => match(k, qu) && <div key={k} onClick={() => setSel(k)} onDoubleClick={() => remove(k)} className={cn("group flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1.5 hover:bg-slate-50", sel === k && "bg-brand-50")}>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{i + 1}</span><Columns3 className="h-3.5 w-3.5 text-slate-400" /><span className="flex-1 truncate">{label(k)}</span>
            <span className="hidden items-center gap-0.5 group-hover:flex"><button type="button" aria-label={`Subir ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, -1); }}><ArrowUp className="h-3 w-3" /></button><button type="button" aria-label={`Descer ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, 1); }}><ArrowDown className="h-3 w-3" /></button></span>
          </div>)}
        </div>
      </div>
    </div>
  </Dialog>;
}
