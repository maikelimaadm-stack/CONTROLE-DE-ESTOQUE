"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Altura do painel de itens ao abrir a tela; o divisor arrasta a partir daqui. */
export const ALTURA_PADRAO_DOS_ITENS = 340;
/** Livre: do painel só com a barra (recolhido na prática) até quase toda a área, deixando a barra da lista à vista. */
const MINIMO = 44;
const RESERVA_DA_LISTA = 56;

/**
 * O DIVISOR ENTRE AS DUAS TABELAS DO MESTRE-DETALHE — Documentos em cima, Itens embaixo — arrastável, como os
 * divisores da Central: faixa cinza fina, traço verde no hover, `role="separator"` focável com setas do teclado.
 *
 * A altura é estado de TELA e morre com ela (nada de localStorage nem perfil): é o mesmo critério dos divisores
 * da moldura, e um valor guardado "só por enquanto" viraria contrato no dia em que alguém dependesse dele.
 */
export function DivisorEntreTabelas({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  const inicio = React.useRef<{ y: number; h: number } | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const maximo = () => Math.max(MINIMO, (ref.current?.parentElement?.clientHeight ?? 800) - RESERVA_DA_LISTA);
  const limitar = (v: number) => Math.round(Math.min(maximo(), Math.max(MINIMO, v)));
  const terminar = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    inicio.current = null; setArrastando(false);
  };
  return <div
    ref={ref} role="separator" aria-orientation="horizontal" tabIndex={0}
    aria-label="Redimensionar os itens do documento" aria-valuemin={MINIMO} aria-valuemax={maximo()} aria-valuenow={Math.round(valor)}
    data-testid="compras-divisor-itens" data-arrastando={arrastando ? "true" : "false"}
    className={cn("group flex h-[7px] shrink-0 touch-none select-none items-center justify-center rounded-full bg-slate-200", arrastando && "bg-green-200")}
    // arrastar para CIMA aumenta o painel de baixo (o divisor anda junto com a borda de cima dos itens)
    style={{ cursor: "row-resize" }}
    onPointerDown={(e) => { e.preventDefault(); inicio.current = { y: e.clientY, h: valor }; setArrastando(true); e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => { const i = inicio.current; if (i) onChange(limitar(i.h + (i.y - e.clientY))); }}
    onPointerUp={terminar}
    onPointerCancel={terminar}
    onKeyDown={(e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault(); onChange(limitar(valor + (e.key === "ArrowUp" ? 16 : -16)));
    }}>
    <span className={cn("h-px w-10 rounded-full bg-slate-300", !arrastando && "group-hover:bg-green-500 group-focus-visible:bg-green-500", arrastando && "bg-green-600")} />
  </div>;
}
