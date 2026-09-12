"use client";
import * as React from "react";
import * as DialogP from "@radix-ui/react-dialog";
import { Search, RotateCcw, X, Columns3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PillBtn } from "./ui";
import type { Base1Column } from "./types";

/**
 * "Configuração de colunas": colunas disponíveis × colunas em uso (numeradas, com busca em cada lista),
 * setas para mover, ↺ para restaurar, Cancelar/Ok. Edita um rascunho e só aplica no Ok.
 */
export function ColumnsDialog({ open, onOpenChange, columns, visible, onApply, onRestore }: { open: boolean; onOpenChange: (o: boolean) => void; columns: Base1Column[]; visible: string[]; onApply: (keys: string[]) => void; onRestore: () => void }) {
  const [inUse, setInUse] = React.useState<string[]>(visible);
  const [sel, setSel] = React.useState<string | null>(null);
  const [qa, setQa] = React.useState(""); const [qu, setQu] = React.useState("");
  React.useEffect(() => { if (open) { setInUse(visible); setSel(null); setQa(""); setQu(""); } }, [open]);
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const available = columns.map((c) => c.key).filter((k) => !inUse.includes(k));
  const match = (k: string, q: string) => !q || label(k).toLowerCase().includes(q.toLowerCase());
  const add = (k: string) => setInUse((u) => (u.includes(k) ? u : [...u, k]));
  const remove = (k: string) => setInUse((u) => (u.length > 1 ? u.filter((x) => x !== k) : u));
  const move = (k: string, dir: -1 | 1) => setInUse((u) => { const i = u.indexOf(k); const j = i + dir; if (i < 0 || j < 0 || j >= u.length) return u; const c = [...u]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  return <DialogP.Root open={open} onOpenChange={onOpenChange}><DialogP.Portal>
    <DialogP.Overlay className="fixed inset-0 z-40 bg-black/50" />
    <DialogP.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[95vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between px-5 py-3"><DialogP.Title className="text-[13px] font-semibold text-slate-800">Configuração de colunas</DialogP.Title><DialogP.Description className="sr-only">Escolha e ordene as colunas da tabela</DialogP.Description>
        <div className="flex items-center gap-1"><button type="button" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" title="Restaurar padrão" aria-label="Restaurar padrão" onClick={() => { onRestore(); onOpenChange(false); }}><RotateCcw className="h-4 w-4" /></button><DialogP.Close className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X className="h-4 w-4" /></DialogP.Close></div></div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-2 border-t px-4 py-3 text-[12.5px]">
        <div className="flex min-h-[320px] flex-col rounded-lg border">
          <div className="border-b px-3 py-2 font-semibold text-slate-700">Colunas disponíveis</div>
          <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={qa} onChange={(e) => setQa(e.target.value)} placeholder="Procurar coluna" aria-label="Procurar coluna" className="h-8 w-full rounded-full bg-slate-100 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-300" /></div></div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {available.filter((k) => match(k, qa)).length === 0 && <div className="py-10 text-center text-slate-400">Nenhuma coluna disponível.</div>}
            {available.filter((k) => match(k, qa)).map((k) => <button type="button" key={k} onDoubleClick={() => add(k)} onClick={() => setSel(k)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50", sel === k && "bg-brand-50 ring-1 ring-brand-300")}><Columns3 className="h-3.5 w-3.5 text-slate-400" />{label(k)}</button>)}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          {[{ i: <ChevronsLeft className="h-4 w-4" />, t: "Usar todas", f: () => setInUse(columns.map((c) => c.key)) }, { i: <ChevronLeft className="h-4 w-4" />, t: "Usar coluna selecionada", f: () => sel && add(sel) }, { i: <ChevronRight className="h-4 w-4" />, t: "Remover coluna selecionada", f: () => sel && remove(sel) }, { i: <ChevronsRight className="h-4 w-4" />, t: "Remover todas (mantém a primeira)", f: () => setInUse((u) => u.slice(0, 1)) }].map((b, i) => <button key={i} type="button" title={b.t} aria-label={b.t} onClick={b.f} className="rounded-full border bg-white p-1.5 text-slate-500 hover:bg-slate-100">{b.i}</button>)}
        </div>
        <div className="flex min-h-[320px] flex-col rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2"><span className="font-semibold text-slate-700">Colunas em uso</span><span className="text-[11px] text-slate-500">{inUse.length} colunas</span></div>
          <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={qu} onChange={(e) => setQu(e.target.value)} placeholder="Procurar coluna em uso" aria-label="Procurar coluna em uso" className="h-8 w-full rounded-full bg-slate-100 pl-8 pr-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-300" /></div></div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {inUse.map((k, i) => match(k, qu) && <div key={k} onClick={() => setSel(k)} onDoubleClick={() => remove(k)} className={cn("group flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50", sel === k && "bg-brand-50 ring-1 ring-brand-300")}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{i + 1}</span><Columns3 className="h-3.5 w-3.5 text-slate-400" /><span className="flex-1 truncate">{label(k)}</span>
              <span className="hidden items-center gap-0.5 group-hover:flex"><button type="button" aria-label={`Subir ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, -1); }}><ArrowUp className="h-3 w-3" /></button><button type="button" aria-label={`Descer ${label(k)}`} className="rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); move(k, 1); }}><ArrowDown className="h-3 w-3" /></button></span>
              <span className="text-[10.5px] font-medium text-brand-700">Em uso</span>
            </div>)}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-3"><PillBtn tone="gray" onClick={() => onOpenChange(false)}>Cancelar</PillBtn><PillBtn onClick={() => { onApply(inUse); onOpenChange(false); }}>OK</PillBtn></div>
    </DialogP.Content>
  </DialogP.Portal></DialogP.Root>;
}
