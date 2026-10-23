"use client";
import * as React from "react";
import { Check, Columns3, GripVertical, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";
import grade from "./grade.module.css";
import estilos from "./moldura.module.css";
import type { Preferencia, PropsDeConfigurarColunas } from "./contrato";

export type { Preferencia, PropsDeConfigurarColunas } from "./contrato";

/**
 * Configurar colunas/campos do lançamento — mesmo diálogo da tabela principal (decisão 340):
 * Disponíveis × Na tabela, rascunho até Pronto, Restaurar antes do Fechar, ESC/fora não fecham.
 * Visão Grade|Formulário é só o segmento da barra (decisão 341: sem "os dois juntos").
 */
export function ConfigurarColunas<K extends string>({ prefixoTestid, titulo, subtitulo, rotulos, lista, onLista, onRestaurar }: PropsDeConfigurarColunas<K>) {
  const [aberta, setAberta] = React.useState(false);
  const ordemInicial = React.useMemo(() => lista.map((c) => c.chave), [lista]);
  const ocultasIniciais = React.useMemo(() => new Set(lista.filter((c) => !c.visivel).map((c) => c.chave)), [lista]);
  const [busca, setBusca] = React.useState("");
  const [arrastada, setArrastada] = React.useState<K | null>(null);
  const [alvo, setAlvo] = React.useState<K | null>(null);
  const [draftOrdem, setDraftOrdem] = React.useState<K[]>(() => ordemInicial);
  const [draftOcultas, setDraftOcultas] = React.useState(() => new Set(ocultasIniciais));
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);

  React.useEffect(() => {
    if (!aberta) return;
    setDraftOrdem(ordemInicial);
    setDraftOcultas(new Set(ocultasIniciais));
    setBusca("");
    setAplicarPadrao(false);
    setArrastada(null);
    setAlvo(null);
  }, [aberta, ordemInicial, ocultasIniciais]);

  const itens = draftOrdem.map((chave) => ({ chave, label: rotulos[chave] ?? chave }));
  const livres = itens.filter((c) => draftOcultas.has(c.chave));
  const usadas = itens.filter((c) => !draftOcultas.has(c.chave));

  const mover = (chave: K, ocultar: boolean, antes?: K) => {
    if (ocultar && !draftOcultas.has(chave) && usadas.length <= 1) return;
    setAplicarPadrao(false);
    setDraftOcultas((p) => { const n = new Set(p); if (ocultar) n.add(chave); else n.delete(chave); return n; });
    setDraftOrdem((ordem) => {
      const sem = ordem.filter((k) => k !== chave);
      const indice = antes ? sem.indexOf(antes) : -1;
      if (antes !== chave) sem.splice(indice < 0 ? sem.length : indice, 0, chave);
      return sem;
    });
  };

  const soltar = (e: React.DragEvent, ocultar: boolean, antes?: K) => {
    e.preventDefault(); e.stopPropagation();
    const chave = (arrastada ?? e.dataTransfer.getData("text/plain")) as K;
    if (!draftOrdem.includes(chave)) return;
    mover(chave, ocultar, antes);
    setArrastada(null); setAlvo(null);
  };

  const restaurarRascunho = () => {
    setDraftOcultas(new Set());
    setDraftOrdem(ordemInicial);
    setAplicarPadrao(true);
  };

  const salvar = () => {
    if (aplicarPadrao) onRestaurar();
    else {
      const nova: Preferencia<K>[] = draftOrdem.map((chave) => ({ chave, visivel: !draftOcultas.has(chave) }));
      onLista(nova);
    }
    setAberta(false);
  };

  const listaUi = (linhas: typeof itens, on: boolean, vazio: string) => <div className="dbox-l" role="list" data-testid={on ? `${prefixoTestid}-na-tabela` : `${prefixoTestid}-disponiveis`}
    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => soltar(e, !on)}>
    {linhas.filter((c) => c.label.toLowerCase().includes(busca.toLowerCase())).map((c) => {
      const travada = on && usadas.length <= 1;
      return <div key={c.chave} role="listitem" tabIndex={0} draggable data-coluna={c.chave}
        aria-label={c.label}
        aria-checked={!draftOcultas.has(c.chave)}
        className={cn("dlin", on && "on", arrastada === c.chave && "indo", alvo === c.chave && arrastada !== c.chave && "mira")}
        title={travada ? "Ao menos uma coluna fica na tabela" : on ? "Clique para ocultar · arraste para reordenar" : "Clique para exibir · arraste para a tabela"}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.chave); e.dataTransfer.effectAllowed = "move"; setArrastada(c.chave); }}
        onDragEnd={() => { setArrastada(null); setAlvo(null); }}
        onDragOver={(e) => { e.preventDefault(); setAlvo(c.chave); }} onDrop={(e) => soltar(e, !on, c.chave)}
        onClick={() => !travada && mover(c.chave, on)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !travada) { e.preventDefault(); mover(c.chave, on); }
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            setAplicarPadrao(false);
            setDraftOrdem((keys) => {
              const i = keys.indexOf(c.chave), j = i + (e.key === "ArrowUp" ? -1 : 1);
              if (j < 0 || j >= keys.length) return keys;
              const n = [...keys]; [n[i], n[j]] = [n[j]!, n[i]!]; return n;
            });
          }
        }}>
        <span className="dlin-l">{c.label}</span><span className="gripe"><GripVertical size={13} /></span>
      </div>;
    })}
    {!linhas.some((c) => c.label.toLowerCase().includes(busca.toLowerCase())) && <span className="dvaz">{vazio}</span>}
  </div>;

  return <>
    <button type="button" className={cn("app-circulo-28", grade.botao, estilos.dicaFim)} aria-label="Configurar colunas" data-dica="Configurar colunas" data-testid={`${prefixoTestid}-configurar`} aria-expanded={aberta} onClick={() => setAberta(true)}><Columns3 aria-hidden /></button>
    {aberta && <Dialog open onOpenChange={(o) => { if (!o) setAberta(false); }} title={titulo} description={subtitulo} size="lg" profile="large"
      className="b1-portal-compras" testId={`${prefixoTestid}-configuracao`}
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
          <div className="dbox"><span className="dbox-h">Disponíveis<span className="bd t-plain">{livres.length}</span></span>{listaUi(livres, false, busca ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}</div>
          <div className="dbox"><span className="dbox-h">Na tabela<span className="bd t-positive">{usadas.length}</span></span>{listaUi(usadas, true, "Nenhuma coluna com esse texto.")}</div>
        </div>
      </div>
    </Dialog>}
  </>;
}
