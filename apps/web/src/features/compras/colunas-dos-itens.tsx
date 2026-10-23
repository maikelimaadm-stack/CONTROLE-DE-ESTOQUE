"use client";
import * as React from "react";
import { Check, GripVertical, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";

/**
 * Duas listas: clique/arraste só mudam o RASCUNHO. A grade só muda no Pronto (decisão 340).
 * Fechar (X) descarta; ESC/fora não fecham; Restaurar fica antes do Fechar no cabeçalho.
 */
export function ColunasDosItens({ colunas, ocultas, onMudar, onOrdenar, onRestaurar, onFechar, titulo = "Colunas dos itens", className }: {
  colunas: { key: string; label: string }[]; ocultas: Set<string>;
  onMudar: (key: string, ocultar: boolean) => void; onOrdenar: (keys: string[]) => void;
  onRestaurar: () => void; onFechar: () => void; titulo?: string; className?: string;
}) {
  const ordemInicial = React.useMemo(() => colunas.map((c) => c.key), [colunas]);
  const [busca, setBusca] = React.useState("");
  const [arrastada, setArrastada] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<string | null>(null);
  const [draftOcultas, setDraftOcultas] = React.useState(() => new Set(ocultas));
  const [draftOrdem, setDraftOrdem] = React.useState<string[]>(() => ordemInicial);
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);
  React.useEffect(() => { setDraftOcultas(new Set(ocultas)); setDraftOrdem(ordemInicial); setBusca(""); setAplicarPadrao(false); }, [ocultas, ordemInicial]);

  const porChave = React.useMemo(() => new Map(colunas.map((c) => [c.key, c])), [colunas]);
  const livres = draftOrdem.filter((k) => draftOcultas.has(k)).map((k) => porChave.get(k)!).filter(Boolean);
  const usadas = draftOrdem.filter((k) => !draftOcultas.has(k)).map((k) => porChave.get(k)!).filter(Boolean);

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
    setAplicarPadrao(true);
  };

  const lista = (itens: typeof colunas, on: boolean, vazio: string) => <div className="dbox-l" data-testid={on ? "colunas-na-tabela" : "colunas-disponiveis"}
    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => soltar(e, !on)}>
    {itens.filter((c) => c.label.toLowerCase().includes(busca.toLowerCase())).map((c) => {
      const travada = on && usadas.length <= 1;
      return <div key={c.key} role="button" tabIndex={0} draggable data-coluna={c.key} aria-label={c.label} aria-disabled={travada}
        className={cn("dlin", on && "on", arrastada === c.key && "indo", alvo === c.key && arrastada !== c.key && "mira")}
        title={travada ? "Ao menos uma coluna fica na tabela" : on ? "Clique para ocultar · arraste para reordenar" : "Clique para exibir · arraste para a tabela"}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.key); e.dataTransfer.effectAllowed = "move"; setArrastada(c.key); }}
        onDragEnd={() => { setArrastada(null); setAlvo(null); }}
        onDragOver={(e) => { e.preventDefault(); setAlvo(c.key); }} onDrop={(e) => soltar(e, !on, c.key)}
        onClick={() => !travada && mover(c.key, on)}
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
    {!itens.some((c) => c.label.toLowerCase().includes(busca.toLowerCase())) && <span className="dvaz">{vazio}</span>}
  </div>;

  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={titulo} size="lg" profile="large"
    className={cn("b1-portal-compras", className)}
    fecharSoPeloBotao
    antesDoFechar={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" aria-label="Restaurar padrão" title="Restaurar padrão" onClick={restaurarRascunho}><RotateCcw className="h-4 w-4" /></button>}
    footer={<div className="b1ref flex w-full items-center justify-end gap-2">
      <button type="button" className="tb-btn tb-btn-icon" aria-label="Pronto" title="Pronto" onClick={salvar}><Check className="h-4 w-4" /></button>
    </div>}>
    <div className="b1ref">
      <label className="cfgb"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar coluna nas duas listas…" aria-label="Procurar coluna" />
        {busca && <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}
      </label>
      <div className="dcol" style={{ minHeight: 320 }}>
        <div className="dbox"><span className="dbox-h">Disponíveis<span className="bd t-plain">{livres.length}</span></span>{lista(livres, false, busca ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}</div>
        <div className="dbox"><span className="dbox-h">Na tabela<span className="bd t-positive">{usadas.length}</span></span>{lista(usadas, true, "Nenhuma coluna com esse texto.")}</div>
      </div>
    </div>
  </Dialog>;
}
