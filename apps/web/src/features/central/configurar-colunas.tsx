"use client";
import * as React from "react";
import * as PopoverP from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import estilos from "./moldura.module.css";
import grade from "./grade.module.css";
import type { PropsDeConfigurarColunas } from "./contrato";

export type { Preferencia, PropsDeConfigurarColunas } from "./contrato";

/**
 * "Configurar colunas": o popover de vidro do desenho (340px, ancorado ao botão, abrindo para baixo), com uma caixa por
 * coluna/campo, subir/descer, "Mostrar grade e formulário" e "Restaurar padrão". Radix Popover entrega o papel, o foco,
 * Esc e o clique fora; aqui só se veste. Só muda a lista que recebe — estado da tela. A última coluna à vista não se
 * desmarca (caixa desabilitada, como o desenho prevê): uma grade sem coluna nenhuma não mostraria item nenhum.
 */
export function ConfigurarColunas<K extends string>({ prefixoTestid, titulo, subtitulo, rotulos, lista, onLista, onRestaurar, ambos, onAmbos }: PropsDeConfigurarColunas<K>) {
  const [aberta, setAberta] = React.useState(false);
  const visiveis = lista.filter((c) => c.visivel).length;
  const alternar = (i: number) => onLista(lista.map((c, j) => (j === i ? { ...c, visivel: !c.visivel } : c)));
  const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= lista.length) return; const n = lista.slice(); [n[i], n[j]] = [n[j]!, n[i]!]; onLista(n); };
  return <PopoverP.Root open={aberta} onOpenChange={setAberta}>
    <PopoverP.Trigger asChild>
      <button type="button" className={cn(grade.botao, estilos.dicaFim)} aria-label="Configurar colunas" data-dica="Configurar colunas" data-testid={`${prefixoTestid}-configurar`}><Columns3 aria-hidden /></button>
    </PopoverP.Trigger>
    <PopoverP.Content side="bottom" align="end" sideOffset={11} collisionPadding={8} className={grade.config} aria-label={titulo} data-testid={`${prefixoTestid}-configuracao`}>
      <div className={grade.configCabecalho}><span className={grade.configTitulo}>{titulo}</span><span className={grade.configSub}>{subtitulo}</span></div>
      <div className={grade.configLista} role="list">
        {lista.map((c, i) => <div key={c.chave} className={grade.configLinha} role="listitem">
          <button type="button" role="checkbox" aria-checked={c.visivel} aria-label={`Mostrar ${rotulos[c.chave]}`} className={grade.caixa}
            disabled={c.visivel && visiveis <= 1} onClick={() => alternar(i)}>{c.visivel && <Check aria-hidden strokeWidth={2} />}</button>
          <span className={grade.configRotulo}>{rotulos[c.chave]}</span>
          <button type="button" className={grade.mover} aria-label={`Subir ${rotulos[c.chave]}`} title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ChevronUp aria-hidden /></button>
          <button type="button" className={grade.mover} aria-label={`Descer ${rotulos[c.chave]}`} title="Descer" disabled={i === lista.length - 1} onClick={() => mover(i, 1)}><ChevronDown aria-hidden /></button>
        </div>)}
      </div>
      <div className={grade.configVisao}>
        <div className={grade.configLinha}>
          <button type="button" role="checkbox" aria-checked={ambos} aria-label="Mostrar grade e formulário" className={grade.caixa} onClick={onAmbos}>{ambos && <Check aria-hidden strokeWidth={2} />}</button>
          <span className={grade.configRotulo}>Mostrar grade e formulário</span>
        </div>
      </div>
      <div className={grade.configRodape}>
        <span className={grade.configNota}>Campos disponíveis para esta operação</span>
        <button type="button" className={grade.link} onClick={onRestaurar}>Restaurar padrão</button>
      </div>
    </PopoverP.Content>
  </PopoverP.Root>;
}

