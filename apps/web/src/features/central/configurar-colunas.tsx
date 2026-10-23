"use client";
import * as React from "react";
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, GripVertical, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";
import grade from "./grade.module.css";
import estilos from "./moldura.module.css";
import type { Preferencia, PropsDeConfigurarColunas } from "./contrato";

export type { Preferencia, PropsDeConfigurarColunas } from "./contrato";

/**
 * Configurar colunas/campos do lançamento — diálogo Disponíveis × Na tabela (decisões 340–342):
 * busca cfgb em cada lista, setas no meio, arraste, rascunho até Pronto; sem subtítulo.
 */
export function ConfigurarColunas<K extends string>({ prefixoTestid, titulo, rotulos, lista, onLista, onRestaurar }: PropsDeConfigurarColunas<K>) {
  const [aberta, setAberta] = React.useState(false);
  const ordemInicial = React.useMemo(() => lista.map((c) => c.chave), [lista]);
  const ocultasIniciais = React.useMemo(() => new Set(lista.filter((c) => !c.visivel).map((c) => c.chave)), [lista]);
  const [qa, setQa] = React.useState("");
  const [qu, setQu] = React.useState("");
  const [sel, setSel] = React.useState<K | null>(null);
  const [arrastada, setArrastada] = React.useState<K | null>(null);
  const [alvo, setAlvo] = React.useState<K | null>(null);
  const [draftOrdem, setDraftOrdem] = React.useState<K[]>(() => ordemInicial);
  const [draftOcultas, setDraftOcultas] = React.useState(() => new Set(ocultasIniciais));
  const [aplicarPadrao, setAplicarPadrao] = React.useState(false);

  React.useEffect(() => {
    if (!aberta) return;
    setDraftOrdem(ordemInicial);
    setDraftOcultas(new Set(ocultasIniciais));
    setQa(""); setQu(""); setSel(null);
    setAplicarPadrao(false);
    setArrastada(null); setAlvo(null);
  }, [aberta, ordemInicial, ocultasIniciais]);

  const itens = draftOrdem.map((chave) => ({ chave, label: rotulos[chave] ?? chave }));
  const livres = itens.filter((c) => draftOcultas.has(c.chave));
  const usadas = itens.filter((c) => !draftOcultas.has(c.chave));
  const filtra = (linhas: typeof itens, q: string) => linhas.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

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

  const usarTodas = () => { setAplicarPadrao(false); setDraftOcultas(new Set()); setSel(null); };
  const removerTodas = () => {
    if (usadas.length <= 1) return;
    setAplicarPadrao(false);
    const manter = usadas[0]!.chave;
    setDraftOcultas(new Set(draftOrdem.filter((k) => k !== manter)));
    setSel(null);
  };
  const usarSel = () => { if (sel && draftOcultas.has(sel)) mover(sel, false); };
  const removerSel = () => { if (sel && !draftOcultas.has(sel)) mover(sel, true); };

  const restaurarRascunho = () => {
    setDraftOcultas(new Set());
    setDraftOrdem(ordemInicial);
    setSel(null);
    setAplicarPadrao(true);
  };

  const salvar = () => {
    if (aplicarPadrao) onRestaurar();
    else onLista(draftOrdem.map((chave) => ({ chave, visivel: !draftOcultas.has(chave) })));
    setAberta(false);
  };

  const listaUi = (linhas: typeof itens, on: boolean, q: string, vazio: string) => {
    const vistas = filtra(linhas, q);
    return <div className="dbox-l" role="list" data-testid={on ? `${prefixoTestid}-na-tabela` : `${prefixoTestid}-disponiveis`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => soltar(e, !on)}>
      {vistas.map((c) => {
        const travada = on && usadas.length <= 1;
        return <div key={c.chave} role="listitem" tabIndex={0} draggable data-coluna={c.chave}
          aria-label={c.label}
          aria-checked={!draftOcultas.has(c.chave)}
          className={cn("dlin", on && "on", sel === c.chave && "sel", arrastada === c.chave && "indo", alvo === c.chave && arrastada !== c.chave && "mira")}
          title={travada ? "Ao menos uma coluna fica na tabela" : on ? "Clique para selecionar · duplo clique para ocultar · arraste para reordenar" : "Clique para selecionar · duplo clique para usar · arraste para a tabela"}
          onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.chave); e.dataTransfer.effectAllowed = "move"; setArrastada(c.chave); }}
          onDragEnd={() => { setArrastada(null); setAlvo(null); }}
          onDragOver={(e) => { e.preventDefault(); setAlvo(c.chave); }} onDrop={(e) => soltar(e, !on, c.chave)}
          onClick={() => setSel(c.chave)}
          onDoubleClick={() => !travada && mover(c.chave, on)}
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

  return <>
    <button type="button" className={cn("app-circulo-28", grade.botao, estilos.dicaFim)} aria-label="Configurar colunas" data-dica="Configurar colunas" data-testid={`${prefixoTestid}-configurar`} aria-expanded={aberta} onClick={() => setAberta(true)}><Columns3 aria-hidden /></button>
    {aberta && <Dialog open onOpenChange={(o) => { if (!o) setAberta(false); }} title={titulo} size="lg" profile="large"
      className="b1-portal-compras b1-colunas-dlg" testId={`${prefixoTestid}-configuracao`}
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
            {listaUi(livres, false, qa, qa ? "Nenhuma coluna com esse texto." : "Todas as colunas estão na tabela.")}
          </div>
          <div className="dmid" aria-label="Mover colunas">
            <button type="button" className="tb-btn tb-btn-icon" title="Usar todas" aria-label="Usar todas" onClick={usarTodas}><ChevronsRight className="h-4 w-4" /></button>
            <button type="button" className="tb-btn tb-btn-icon" title="Usar coluna selecionada" aria-label="Usar coluna selecionada" onClick={usarSel}><ChevronRight className="h-4 w-4" /></button>
            <button type="button" className="tb-btn tb-btn-icon" title="Remover coluna selecionada" aria-label="Remover coluna selecionada" onClick={removerSel}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="tb-btn tb-btn-icon" title="Remover todas (mantém a primeira)" aria-label="Remover todas (mantém a primeira)" onClick={removerTodas}><ChevronsLeft className="h-4 w-4" /></button>
          </div>
          <div className="dbox">
            {busca(qu, setQu, "Procurar na tabela")}
            <span className="dbox-h">Na tabela<span className="bd t-positive">{usadas.length}</span></span>
            {listaUi(usadas, true, qu, "Nenhuma coluna com esse texto.")}
          </div>
        </div>
      </div>
    </Dialog>}
  </>;
}
