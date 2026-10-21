"use client";
import * as React from "react";

/** Mesmas alturas do mestre-detalhe do HTML de referência. */
export const ALTURA_PADRAO_DOS_ITENS = 262;
const MINIMO = 118;
const MAXIMO = 560;
const limitar = (v: number) => Math.round(Math.min(MAXIMO, Math.max(MINIMO, v)));

/** Como no HTML: o movimento é acompanhado fora da faixa também, até soltar o mouse. */
export function DivisorEntreTabelas({ valor, onChange, onAbrir, onRecolher }: { valor: number; onChange: (v: number) => void; onAbrir: () => void; onRecolher: () => void }) {
  const inicio = React.useRef<{ y: number; h: number; escala: number } | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  React.useEffect(() => {
    if (!arrastando) return;
    const mover = (e: MouseEvent) => {
      const i = inicio.current;
      if (i) onChange(limitar(i.h + (i.y - e.clientY) / i.escala));
    };
    const terminar = () => { inicio.current = null; setArrastando(false); };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", terminar);
    window.addEventListener("blur", terminar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", terminar);
      window.removeEventListener("blur", terminar);
    };
  }, [arrastando, onChange]);
  return <div
    role="separator" aria-orientation="horizontal" tabIndex={0}
    aria-label="Redimensionar os itens do documento" aria-valuemin={MINIMO} aria-valuemax={MAXIMO} aria-valuenow={Math.round(valor)}
    title="Arraste para redimensionar · duplo clique recolhe"
    data-testid="compras-divisor-itens" data-arrastando={arrastando ? "true" : "false"}
    className="compras-divisor-itens" onDoubleClick={onRecolher}
    onMouseDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pai = e.currentTarget.parentElement;
      const escala = pai && pai.offsetHeight ? pai.getBoundingClientRect().height / pai.offsetHeight : 1;
      inicio.current = { y: e.clientY, h: valor, escala: escala || 1 };
      onAbrir(); setArrastando(true);
    }}
    onKeyDown={(e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault(); onAbrir(); onChange(limitar(valor + (e.key === "ArrowUp" ? 16 : -16)));
    }}>
    <span />
  </div>;
}
