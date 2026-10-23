"use client";
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoToBR } from "./mg-controls";
import estilos from "./calendario-de-periodo.module.css";

const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const semana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const isoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataDe = (valor: string) => {
  const data = new Date(`${valor}T00:00:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(data.getTime()) && isoDe(data) === valor ? data : null;
};

/** Cada lado edita apenas seu campo; navegar não altera o período escolhido. */
function MesDoPeriodo({ rotulo, valor, inicio, fim, inicial, escolher }: { rotulo: string; valor: string; inicio: string; fim: string; inicial: Date; escolher: (iso: string) => void }) {
  const [cursor, setCursor] = React.useState(() => dataDe(valor) ?? inicial);
  const [vista, setVista] = React.useState<"dias" | "meses" | "anos">("dias");
  const ano = cursor.getFullYear(), mes = cursor.getMonth(), primeiroAno = ano - 5;
  const primeiro = new Date(ano, mes, 1);
  const dias = Array.from({ length: 42 }, (_, i) => new Date(ano, mes, 1 - primeiro.getDay() + i));
  const navegar = (sentido: number) => setCursor(new Date(ano + (vista === "anos" ? sentido * 12 : vista === "meses" ? sentido : 0), mes + (vista === "dias" ? sentido : 0), 1));
  const titulo = vista === "dias" ? `${meses[mes]} de ${ano}` : vista === "meses" ? String(ano) : `${primeiroAno} – ${primeiroAno + 11}`;
  const hoje = isoDe(new Date());
  const intervaloValido = dataDe(inicio) && dataDe(fim);
  const menor = inicio < fim ? inicio : fim, maior = inicio < fim ? fim : inicio;
  return <section className={estilos.mes} aria-label={rotulo}>
    <div className={estilos.rotulo}>{rotulo}<span>{isoToBR(valor) || "Selecione a data"}</span></div>
    <div className="mg-dp-header">
      <button type="button" className="mg-dp-nav" aria-label={`Anterior — ${rotulo}`} onClick={() => navegar(-1)}><ChevronLeft /></button>
      <button type="button" className="mg-dp-title" onClick={() => setVista(vista === "dias" ? "meses" : "anos")}>{titulo}</button>
      <button type="button" className="mg-dp-nav" aria-label={`Próximo — ${rotulo}`} onClick={() => navegar(1)}><ChevronRight /></button>
    </div>
    {vista === "dias" ? <>
      <div className="mg-dp-weekdays">{semana.map((dia) => <div key={dia} className="mg-dp-wd">{dia}</div>)}</div>
      <div className="mg-dp-days">{dias.map((dia) => {
        const iso = isoDe(dia), outro = dia.getMonth() !== mes;
        return <div key={iso} className={cn(estilos.celula, !outro && intervaloValido && iso >= menor && iso <= maior && estilos.intervalo)}>
          <button type="button" disabled={outro} aria-label={isoToBR(iso)} aria-pressed={iso === valor} className={cn("mg-dp-day", outro && "other", iso === hoje && "today", iso === valor && "selected")} onClick={() => escolher(iso)}>{dia.getDate()}</button>
        </div>;
      })}</div>
    </> : <div className="mg-dp-view-layer mg-dp-view-layer--grid"><div className="mg-dp-grid">
      {vista === "meses" ? meses.map((nome, i) => <button key={nome} type="button" className={cn("mg-dp-pick", i === mes && "selected")} aria-label={nome} onClick={() => { setCursor(new Date(ano, i, 1)); setVista("dias"); }}>{nome.slice(0, 3)}</button>) : Array.from({ length: 12 }, (_, i) => primeiroAno + i).map((a) => <button key={a} type="button" className={cn("mg-dp-pick", a === ano && "selected")} onClick={() => { setCursor(new Date(a, mes, 1)); setVista("meses"); }}>{a}</button>)}
    </div></div>}
  </section>;
}

/** Gatilho entre os campos existentes. Não aplica o filtro nem fecha ao escolher uma data. */
export function CalendarioDePeriodo({ inicio, fim, onInicio, onFim, formato = "iso" }: { inicio: string; fim: string; onInicio: (valor: string) => void; onFim: (valor: string) => void; formato?: "iso" | "br" }) {
  const [aberto, setAberto] = React.useState(false);
  const normalizar = (valor: string) => formato === "br" ? valor.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, d: string, m: string, a: string) => `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`) : valor;
  const de = normalizar(inicio), ate = normalizar(fim);
  const base = dataDe(de) ?? dataDe(ate) ?? new Date();
  const emitir = (callback: (valor: string) => void, iso: string) => callback(formato === "br" ? isoToBR(iso) : iso);
  return <Popover.Root open={aberto} onOpenChange={setAberto}>
    <Popover.Trigger asChild><button type="button" className={estilos.gatilho} aria-label="Escolher período no calendário"><Calendar size={14} /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className={cn("mg-dp-panel", estilos.painel)} align="center" sideOffset={6} collisionPadding={8} aria-label="Calendário do período" onEscapeKeyDown={(e) => e.stopPropagation()}>
      <div className={estilos.calendarios}>
        <MesDoPeriodo rotulo="Data inicial" valor={de} inicio={de} fim={ate} inicial={base} escolher={(iso) => emitir(onInicio, iso)} />
        <MesDoPeriodo rotulo="Data final" valor={ate} inicio={de} fim={ate} inicial={new Date(base.getFullYear(), base.getMonth() + 1, 1)} escolher={(iso) => emitir(onFim, iso)} />
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
