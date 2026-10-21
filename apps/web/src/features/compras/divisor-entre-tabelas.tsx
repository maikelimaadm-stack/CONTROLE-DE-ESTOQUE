"use client";
import * as React from "react";

export const ALTURA_PADRAO_DOS_ITENS = 262;
export const ALTURA_RECOLHIDA_DOS_ITENS = 34;

/** O limite superior preserva o cabeçalho da grade principal, não uma altura fixa de tela. */
export function limiteDosItens(divisor: HTMLElement): number {
  const pai = divisor.parentElement;
  if (!pai) return ALTURA_PADRAO_DOS_ITENS;
  const escala = pai.getBoundingClientRect().height / pai.offsetHeight || 1;
  const cabecalho = pai.querySelector("[data-compras-mestre] thead");
  const topo = cabecalho?.getBoundingClientRect().bottom ?? pai.getBoundingClientRect().top;
  return Math.max(ALTURA_RECOLHIDA_DOS_ITENS, Math.floor((pai.getBoundingClientRect().bottom - topo - divisor.getBoundingClientRect().height) / escala - 12));
}

/** Captura o ponteiro: o arraste continua fora da faixa e funciona também com toque. */
export function DivisorEntreTabelas({ valor, onChange, onRecolher }: { valor: number; onChange: (v: number) => void; onRecolher: () => void }) {
  const inicio = React.useRef<{ y: number; h: number; escala: number; max: number } | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const limitar = (v: number, max: number) => Math.round(Math.min(max, Math.max(ALTURA_RECOLHIDA_DOS_ITENS, v)));
  const terminar = () => { inicio.current = null; setArrastando(false); };
  return <div
    role="separator" aria-orientation="horizontal" tabIndex={0}
    aria-label="Redimensionar os itens do documento" aria-valuemin={ALTURA_RECOLHIDA_DOS_ITENS} aria-valuenow={Math.round(valor)}
    title="Arraste para redimensionar · duplo clique recolhe"
    data-testid="compras-divisor-itens" data-arrastando={arrastando ? "true" : "false"}
    className="compras-divisor-itens" onDoubleClick={onRecolher}
    onPointerDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pai = e.currentTarget.parentElement;
      const escala = pai && pai.offsetHeight ? pai.getBoundingClientRect().height / pai.offsetHeight : 1;
      inicio.current = { y: e.clientY, h: valor, escala: escala || 1, max: limiteDosItens(e.currentTarget) };
      e.currentTarget.setPointerCapture(e.pointerId);
      setArrastando(true);
    }}
    onPointerMove={(e) => {
      const i = inicio.current;
      if (i) onChange(limitar(i.h + (i.y - e.clientY) / i.escala, i.max));
    }}
    onPointerUp={terminar} onPointerCancel={terminar} onLostPointerCapture={terminar}
    onKeyDown={(e) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const max = limiteDosItens(e.currentTarget);
      onChange(limitar(e.key === "Home" ? max : e.key === "End" ? ALTURA_RECOLHIDA_DOS_ITENS : valor + (e.key === "ArrowUp" ? 16 : -16), max));
    }}>
    <span />
  </div>;
}
