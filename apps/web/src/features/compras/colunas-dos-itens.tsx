"use client";
import * as React from "react";
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GripVertical, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";

/**
 * Duas listas com busca cfgb e setas no meio (decisão 342). Rascunho até Pronto (340).
 * Fechar descarta; ESC/fora não fecham; Restaurar antes do Fechar.
 */
export function ColunasDosItens({ colunas, ocultas, onMudar, onOrdenar, onRestaurar, onFechar, titulo = "Colunas dos itens", className }: {
  colunas: { key: string; label: string }[]; ocultas: Set<string>;
  onMudar: (key: string, ocultar: boolean) => void; onOrdenar: (keys: string[]) => void;
  onRestaurar: () => void; onFechar: () => void; titulo?: string; className?: string;
}) {
  const ordemInicial = React.useMemo(() => colunas.map((c) => c.key), [colunas]);
  const [qa, setQa] = React.useState("");
  const [qu, setQu] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const [arrastada, setArrastada] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<string | null>(null);
  const [draftOcultas, setDraftOcultas] = React.useState(() => new Set(ocultas));
  const [draftOrdem, setDraftOrdem] = React.useState<string[]>(() => ordemInicial);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  React.useEffect(() => { setDraftOcultas(new Set(ocultas)); setDraftOrdem(ordemInicial); setQa(""); setQu(""); setSel(null); setAplicarPadrao(false); }, [ocultas, ordemInicial]);

  const porChave = React.useMemo(() => new Map(colunas.map((c) => [c.key, c])), [colunas]);
  const livres = draftOrdem.filter((k) => draftOcultas.has(k)).map((k) => porChave.get(k)!).filter(Boolean);
  const usadas = draftOrdem.filter((k) => !draftOcultas.has(k)).map((k) => porChave.get(k)!).filter(Boolean);
  const filtra = (itens: typeof colunas, q: string) => itens.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

  const mover = (key: string, ocultar: boolean, antes?: string) => {
    if (!porChave.has(key)) return;
    if (ocultar && !draftOcultas.has(key) && usadas.length <= 1) return;
    setAplicarPadrao(false);
    setDraftOcultas((p) => { const n = new Set(p); if (ocultar) n.add(key); else n.delete(key); return n; });
    setDraftOrdem((ordem) => {
      const sem = ordem.filter((k) => k !== key);
      const indice = antes ? sem.indexOf(antes) : -1;
      if (antes !== key) sem.splice(indice < 0 ? sem.length : indice, 0, key);
      return sem;
    });
  };

  const soltar = (e: React.DragEvent, ocultar: boolean, antes?: string) => {
    e.preventDefault(); e.stopPropagation();
    const key = arrastada ?? e.dataTransfer.getData("text/plain");
    mover(key, ocultar, antes);
    setArrastada(null); setAlvo(null);
  };

  const usarTodas = () => { setAplicarPadrao(false); setDraftOcultas(new Set()); setSel(null); };
  const removerTodas = () => {
    if (usadas.length <= 1) return;
    setAplicarPadrao(false);
    const manter = usadas[0]!.key;
    setDraftOcultas(new Set(draftOrdem.filter((k) => k !== manter)));
    setSel(null);
  };
  const usarSel = () => { if (sel && draftOcultas.has(sel)) mover(sel, false); };
  const removerSel = () => { if (sel && !draftOcultas.has(sel)) mover(sel, true); };

  const salvar = () => {
    if (aplicarPadrao) { onRestaurar(); onFechar(); return; }
    onOrdenar(draftOrdem);
    for (const c of colunas) {
      const agora = draftOcultas.has(c.key);
      if (agora !== ocultas.has(c.key)) onMudar(c.key, agora);
    }
    onFechar();
  };

  const restaurarRascunho = () => {
    setDraftOcultas(new Set());
    setDraftOrdem(ordemInicial);
    setSel(null);
    setAplicarPadrao(true);
  };

  const lista = (itens: typeof colunas, on: boolean, q: string, vazio: string) => {
    const vistas = filtra(itens, q);
    return <div className="dbox-l" data-testid={on ? "colunas-na-tabela" : "colunas-disponiveis"}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => soltar(e, !on)}>
      {vistas.map((c) => {
        const travada = on && usadas.length <= 1;
        return <div key={c.key} role="button" tabIndex={0} draggable data-coluna={c.key} aria-label={c.label} aria-disabled={travada}
          className={cn("dlin", on && "on", sel === c.key && "sel", arrastada === c.key && "indo", alvo === c.key && arrastada !== c.key && "mira")}
          title={travada ? "Ao menos uma coluna fica na tabela" : on ? "Clique para selecionar · duplo clique para ocultar · arraste para reordenar" : "Clique para selecionar · duplo clique para usar · arraste para a tabela"}
          onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.key); e.dataTransfer.effectAllowed = "move"; setArrastada(c.key); }}
          onDragEnd={() => { setArrastada(null); setAlvo(null); }}
          onDragOver={(e) => { e.preventDefault(); setAlvo(c.key); }} onDrop={(e) => soltar(e, !on, c.key)}
          onClick={() => setSel(c.key)}
          onDoubleClick={() => !travada && mover(c.key, on)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !travada) { e.preventDefault(); mover(c.key, on); }
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              setAplicarPadrao(false);
              setDraftOrdem((keys) => {
                const i = keys.indexOf(c.key), j = i + (e.key === "ArrowUp" ? -1 : 1);
                if (j < 0 || j >= keys.length) return keys;
                const n = [...keys]; [n[i], n[j]] = [n[j]!, n[i]!]; return n;
              });
            }
          }}>
          <span className="dlin-l">{c.label}</span><span className="gripe"><GripVertical size={13} /></span>
        </div>;
      })}
      {vistas.length === 0 && <span className="dvaz">{vazio}</span>}
    </div>;
  };

  const busca = (valor: string, onChange: (v: string) => void, rotulo: string) => (
    <label className="cfgb cfgb-lista"><Search size={14} aria-hidden />
      <input value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Procurar coluna" aria-label={rotulo} />
      {valor
        ? <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => onChange("")}><X size={12} /></button>
        : <span className="xlim" aria-hidden />}
    </label>
  );

  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={titulo} size="lg" profile="large"
    className={cn("b1-portal-compras b1-colunas-dlg", className)}
    bodyClassName="!p-4"
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" aria-label="Restaurar padrão" title="Restaurar padrão" onClick={restaurarRascunho}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" aria-label="Pronto" title="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <div className="b1ref flex h-full min-h-0 flex-col">
      <div className="dcol">
        <div className="dbox">
          {busca(qa, setQa, "Procurar em disponíveis")}
          <span className="dbox-h">Disponíveis<span className="bd t-plain">{livres.length}</span></span>
          {lista(livres, false, qa, qa ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}
        </div>
        <div className="dmid" aria-label="Mover colunas">
          <button type="button" className="dmid-btn" title="Usar todas" aria-label="Usar todas" onClick={usarTodas}><ChevronsRight /></button>
          <button type="button" className="dmid-btn" title="Usar coluna selecionada" aria-label="Usar coluna selecionada" onClick={usarSel}><ChevronRight /></button>
          <button type="button" className="dmid-btn" title="Remover coluna selecionada" aria-label="Remover coluna selecionada" onClick={removerSel}><ChevronLeft /></button>
          <button type="button" className="dmid-btn" title="Remover todas (mantém a primeira)" aria-label="Remover todas (mantém a primeira)" onClick={removerTodas}><ChevronsLeft /></button>
        </div>
        <div className="dbox">
          {busca(qu, setQu, "Procurar na tabela")}
          <span className="dbox-h">Na tabela<span className="bd t-positive">{usadas.length}</span></span>
          {lista(usadas, true, qu, "Nenhuma coluna com esse texto.")}
        </div>
      </div>
    </div>
  </Dialog>;
}
