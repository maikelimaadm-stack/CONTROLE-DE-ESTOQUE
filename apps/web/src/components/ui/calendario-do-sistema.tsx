"use client";
import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PainelDoCalendario } from "./mg-controls";
import estilos from "./calendario-do-sistema.module.css";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const dois = (n: number) => String(n).padStart(2, "0");
const isoDe = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const brDe = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
const lerIso = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00`) : null);
type Nivel = "dia" | "mes" | "ano";

/**
 * O quadro de 240px do desenho: título "<mês> de <ano>" que sobe para meses e anos, setas (a roda do mouse anda no
 * nível em que o quadro está), 6 semanas fixas (a altura nunca muda), hoje marcado, "Hoje" e "Limpar".
 */
export function CalendarioDoSistema({ valor, escolher, inicial, intervalo }: { valor: string; escolher: (iso: string) => void; inicial?: Date; intervalo?: { inicio: string; fim: string } }) {
  const hoje = new Date();
  const escolhido = lerIso(valor);
  const base = escolhido ?? inicial ?? hoje;
  const [mes, setMes] = React.useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const [nivel, setNivel] = React.useState<Nivel>("dia");
  const roda = React.useRef(0);
  const ano = mes.getFullYear(), mesAtual = mes.getMonth();
  const decada = Math.floor(ano / 10) * 10;
  const andar = (p: number) => setMes((m) => nivel === "dia" ? new Date(m.getFullYear(), m.getMonth() + p, 1) : new Date(m.getFullYear() + (nivel === "mes" ? p : p * 10), m.getMonth(), 1));
  const titulo = nivel === "dia" ? `${MESES[mesAtual]} de ${ano}` : nivel === "mes" ? String(ano) : `${decada} – ${decada + 9}`;
  const aoRodar = (e: React.WheelEvent) => {
    roda.current += e.deltaY;
    let passos = 0;
    while (roda.current >= 48) { passos++; roda.current -= 48; }
    while (roda.current <= -48) { passos--; roda.current += 48; }
    if (passos) andar(passos);
  };
  const primeiro = new Date(ano, mesAtual, 1);
  const dias = Array.from({ length: 42 }, (_, i) => new Date(ano, mesAtual, 1 - primeiro.getDay() + i));
  const mesmoDia = (a: Date | null, b: Date) => Boolean(a) && isoDe(a!) === isoDe(b);
  const [inicio, fim] = [intervalo?.inicio ?? "", intervalo?.fim ?? ""].sort();
  return <div onWheel={aoRodar}>
    <div className={estilos.calCabecalho}>
      <button type="button" className={estilos.calTitulo} disabled={nivel === "ano"} aria-label={nivel === "dia" ? "Ver os meses" : nivel === "mes" ? "Ver os anos" : "Anos"}
        onClick={() => setNivel(nivel === "dia" ? "mes" : "ano")}>{titulo}</button>
      <span className={estilos.calSetas}>
        <button type="button" className={estilos.calSeta} aria-label="Anterior" onClick={() => andar(-1)}><ChevronUp aria-hidden /></button>
        <button type="button" className={estilos.calSeta} aria-label="Próximo" onClick={() => andar(1)}><ChevronDown aria-hidden /></button>
      </span>
    </div>
    {nivel === "dia" && <div className={estilos.calDias}>
      {SEMANA.map((l, i) => <span key={i} className={estilos.calSemana}>{l}</span>)}
      {dias.map((d) => {
        const marcado = mesmoDia(escolhido, d);
        return <button type="button" key={isoDe(d)} className={estilos.calDia} aria-label={brDe(d)} aria-pressed={marcado}
          data-intervalo={intervalo?.inicio && intervalo.fim && isoDe(d) >= inicio! && isoDe(d) <= fim! && d.getMonth() === mesAtual ? "" : undefined}
          data-fora={d.getMonth() !== mesAtual ? "" : undefined} data-hoje={!marcado && mesmoDia(hoje, d) ? "" : undefined}
          onClick={() => escolher(isoDe(d))}>{d.getDate()}</button>;
      })}
    </div>}
    {nivel === "mes" && <div className={estilos.calGrade}>
      {MESES.map((m, i) => {
        const marcado = Boolean(escolhido) && escolhido!.getFullYear() === ano && escolhido!.getMonth() === i;
        return <button type="button" key={m} className={estilos.calCelula} aria-label={`${m} de ${ano}`} aria-pressed={marcado}
          data-hoje={!marcado && hoje.getFullYear() === ano && hoje.getMonth() === i ? "" : undefined}
          onClick={() => { setMes(new Date(ano, i, 1)); setNivel("dia"); }}>{m.slice(0, 3)}</button>;
      })}
    </div>}
    {nivel === "ano" && <div className={estilos.calGrade}>
      {Array.from({ length: 12 }, (_, i) => decada - 1 + i).map((a) => {
        const marcado = Boolean(escolhido) && escolhido!.getFullYear() === a;
        return <button type="button" key={a} className={estilos.calCelula} aria-label={String(a)} aria-pressed={marcado}
          data-fora={a < decada || a > decada + 9 ? "" : undefined} data-hoje={!marcado && hoje.getFullYear() === a ? "" : undefined}
          onClick={() => { setMes(new Date(a, mesAtual, 1)); setNivel("mes"); }}>{a}</button>;
      })}
    </div>}
    <div className={estilos.calRodape}>
      <button type="button" className={estilos.calLink} onClick={() => escolher(isoDe(hoje))}>Hoje</button>
      <button type="button" className={estilos.calLink} onClick={() => escolher("")}>Limpar</button>
    </div>
  </div>;
}

/** Mesmo painel da Central, compartilhado sem alterar os campos ou seus valores ISO.
 * `className` é getter: o Playwright (specs unitário sem CSS modules) avalia o módulo sem
 * materializar `estilos` no topo — ler na hora do render evita `ReferenceError`. */
export const painelDoCalendarioPadrao: Pick<PainelDoCalendario, "className" | "desenhar"> = {
  get className() { return estilos.calendario; },
  desenhar: ({ valor, escolher }) => <CalendarioDoSistema valor={valor} escolher={escolher} />
};
