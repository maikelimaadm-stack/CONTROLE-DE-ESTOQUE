"use client";
import * as React from "react";
import { GripVertical, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";

/** Duas listas do HTML: clique transfere, arraste transfere ou muda a ordem. Overlay = Dialog oficial (ui-audit). */
export function ColunasDosItens({ colunas, ocultas, onMudar, onOrdenar, onRestaurar, onFechar, titulo = "Colunas dos itens" }: {
  colunas: { key: string; label: string }[]; ocultas: Set<string>;
  onMudar: (key: string, ocultar: boolean) => void; onOrdenar: (keys: string[]) => void;
  onRestaurar: () => void; onFechar: () => void; titulo?: string;
}) {
  const [busca, setBusca] = React.useState("");
  const [arrastada, setArrastada] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<string | null>(null);
  const livres = colunas.filter((c) => ocultas.has(c.key));
  const usadas = colunas.filter((c) => !ocultas.has(c.key));
  const soltar = (e: React.DragEvent, ocultar: boolean, antes?: string) => {
    e.preventDefault(); e.stopPropagation();
    const key = arrastada ?? e.dataTransfer.getData("text/plain");
    if (!colunas.some((c) => c.key === key)) return;
    if (ocultar && !ocultas.has(key) && usadas.length <= 1) return;
    onMudar(key, ocultar);
    const ordem = colunas.map((c) => c.key).filter((k) => k !== key);
    const indice = antes ? ordem.indexOf(antes) : -1;
    if (antes !== key) { ordem.splice(indice < 0 ? ordem.length : indice, 0, key); onOrdenar(ordem); }
    setArrastada(null); setAlvo(null);
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
        onClick={() => !travada && onMudar(c.key, on)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !travada) { e.preventDefault(); onMudar(c.key, on); }
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault(); const keys = colunas.map((x) => x.key), i = keys.indexOf(c.key), j = i + (e.key === "ArrowUp" ? -1 : 1);
            if (j >= 0 && j < keys.length) { [keys[i], keys[j]] = [keys[j]!, keys[i]!]; onOrdenar(keys); }
          }
        }}>
        <span className="dlin-l">{c.label}</span><span className="gripe"><GripVertical size={13} /></span>
      </div>;
    })}
    {!itens.some((c) => c.label.toLowerCase().includes(busca.toLowerCase())) && <span className="dvaz">{vazio}</span>}
  </div>;
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={titulo} size="lg" profile="large"
    description="Escolha e ordene as colunas da tabela"
    footer={<div className="b1ref flex w-full items-center gap-2">
      <span className="ltmp" style={{ flexGrow: 1, paddingLeft: 6 }}>Arraste para ordenar ou mover entre as listas · <b>{usadas.length}</b> de {colunas.length}</span>
      <button type="button" className="tb-btn tb-btn-out sm" onClick={onRestaurar}>Restaurar padrão</button>
      <button type="button" className="tb-btn novo sm" onClick={onFechar}>Pronto</button>
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
