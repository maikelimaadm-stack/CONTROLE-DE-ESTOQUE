"use client";
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoToBR } from "./mg-controls";
import { CalendarioDoSistema, painelDoCalendarioPadrao } from "./calendario-do-sistema";
import estilos from "./calendario-de-periodo.module.css";

type Formato = "iso" | "br";
const normalizar = (valor: string, formato: Formato) => formato === "br" ? valor.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, d: string, m: string, a: string) => `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`) : valor;
const dataDe = (valor: string) => {
  const data = new Date(`${valor}T00:00:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(data.getTime()) ? data : null;
};
const formatar = (iso: string, formato: Formato) => formato === "br" ? isoToBR(iso) : iso;

/** Os dois filtros usam o painel da Central, sem substituir a digitação nos campos. */
function CalendarioDoFiltro({ periodo, aberto, onOpenChange, children }: { periodo?: boolean; aberto: boolean; onOpenChange: (aberto: boolean) => void; children: React.ReactNode }) {
  return <Popover.Root open={aberto} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild><button type="button" className={estilos.gatilho} aria-label={periodo ? "Escolher período no calendário" : "Escolher data no calendário"}><Calendar size={14} /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content data-filtro-camada="" className={cn(painelDoCalendarioPadrao.className, periodo && estilos.painel)} align="center" sideOffset={6} collisionPadding={8} aria-label={periodo ? "Calendário do período" : "Calendário da data"} onEscapeKeyDown={(e) => e.stopPropagation()}>
      {children}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/** Gatilho entre os campos existentes. Cada calendário altera apenas seu lado do período. */
export function CalendarioDePeriodo({ inicio, fim, onInicio, onFim, formato = "iso" }: { inicio: string; fim: string; onInicio: (valor: string) => void; onFim: (valor: string) => void; formato?: Formato }) {
  const [aberto, setAberto] = React.useState(false);
  const de = normalizar(inicio, formato), ate = normalizar(fim, formato);
  const base = dataDe(de) ?? dataDe(ate) ?? new Date();
  return <CalendarioDoFiltro periodo aberto={aberto} onOpenChange={setAberto}>
    <div className={estilos.calendarios}>
      <section className={estilos.mes} aria-label="Data inicial">
        <div className={estilos.rotulo}>Data inicial:<span>{isoToBR(de) || "Selecione a data"}</span></div>
        <CalendarioDoSistema valor={de} inicial={base} intervalo={{ inicio: de, fim: ate }} escolher={(iso) => onInicio(formatar(iso, formato))} />
      </section>
      <section className={estilos.mes} aria-label="Data final">
        <div className={estilos.rotulo}>Data final:<span>{isoToBR(ate) || "Selecione a data"}</span></div>
        <CalendarioDoSistema valor={ate} inicial={new Date(base.getFullYear(), base.getMonth() + 1, 1)} intervalo={{ inicio: de, fim: ate }} escolher={(iso) => onFim(formatar(iso, formato))} />
      </section>
    </div>
  </CalendarioDoFiltro>;
}

/** Ícone dentro do campo quando o operador utiliza uma única data. */
export function CalendarioDeData({ valor, onChange, formato = "iso", children }: { valor: string; onChange: (valor: string) => void; formato?: Formato; children: React.ReactNode }) {
  const [aberto, setAberto] = React.useState(false);
  return <span className={estilos.campo}>
    {children}
    <CalendarioDoFiltro aberto={aberto} onOpenChange={setAberto}>
      <CalendarioDoSistema valor={normalizar(valor, formato)} escolher={(iso) => { onChange(formatar(iso, formato)); setAberto(false); }} />
    </CalendarioDoFiltro>
  </span>;
}
