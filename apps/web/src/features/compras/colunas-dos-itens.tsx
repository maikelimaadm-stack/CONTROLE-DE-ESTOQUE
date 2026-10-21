"use client";
import * as React from "react";
import { Check, GripVertical, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Configurador de colunas do painel de itens — o modal "modelo único" do HTML de referência: duas listas
 * (Disponíveis × Na tabela), procurar coluna, "Restaurar padrão" e "Pronto". Clicar numa coluna troca de lista.
 * Ao menos uma coluna fica sempre na tabela.
 */
export function ColunasDosItens({ colunas, ocultas, onMudar, onRestaurar, onFechar }: {
  colunas: { key: string; label: string }[]; ocultas: Set<string>;
  onMudar: (key: string, ocultar: boolean) => void; onRestaurar: () => void; onFechar: () => void;
}) {
  const [busca, setBusca] = React.useState("");
  const casa = (l: string) => l.toLowerCase().includes(busca.toLowerCase());
  const livres = colunas.filter((c) => ocultas.has(c.key));
  const usadas = colunas.filter((c) => !ocultas.has(c.key));
  const lista = (itens: typeof colunas, on: boolean, vazio: string) => <div className="dbox-l">
    {itens.filter((c) => casa(c.label)).map((c) => {
      const travada = on && usadas.length <= 1;
      return <div key={c.key} role="button" tabIndex={0} className={cn("dlin", on && "on")} title={travada ? "Ao menos uma coluna fica na tabela" : on ? "Clique para ocultar" : "Clique para exibir"}
        onClick={() => !travada && onMudar(c.key, on)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !travada) { e.preventDefault(); onMudar(c.key, on); } }}>
        <span className="chk">{on && <Check strokeWidth={3} />}</span>
        <span className="dlin-l">{c.label}</span>
        <span className="gripe"><GripVertical size={13} /></span>
      </div>;
    })}
    {itens.filter((c) => casa(c.label)).length === 0 && <span className="dvaz">{vazio}</span>}
  </div>;
  return <div className="b1ref">
    <div className="mdl" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="mdlc" role="dialog" aria-label="Colunas dos itens">
        <div className="mdl-h">
          <span className="mdl-t">Colunas dos itens</span>
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="tb-btn tb-btn-out sm" onClick={onRestaurar}>Restaurar padrão</button>
          <button type="button" className="rm" aria-label="Fechar" onClick={onFechar}><X size={14} /></button>
        </div>
        <div className="mdl-b">
          <label className="cfgb"><Search size={14} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar coluna nas duas listas…" aria-label="Procurar coluna" />
            {busca && <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}
          </label>
          <div className="dcol">
            <div className="dbox"><span className="dbox-h">Disponíveis<span className="bd t-plain">{livres.length}</span></span>{lista(livres, false, busca ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}</div>
            <div className="dbox"><span className="dbox-h">Na tabela<span className="bd t-positive">{usadas.length}</span></span>{lista(usadas, true, "Nenhuma coluna com esse texto.")}</div>
          </div>
        </div>
        <div className="mdl-f">
          <span className="ltmp" style={{ flexGrow: 1, paddingLeft: 6 }}>{usadas.length} de {colunas.length} colunas na tabela</span>
          <button type="button" className="tb-btn novo sm" onClick={onFechar}>Pronto</button>
        </div>
      </div>
    </div>
  </div>;
}
