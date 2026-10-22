"use client";
import * as React from "react";
import { createPortal } from "react-dom";

type Botao = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** Dica no visual da Central, portalada para não ser cortada pelas barras roláveis. */
export function DicaDeAcao({ texto, children }: { texto?: string; children: React.ReactElement<Botao> }) {
  const id = React.useId();
  const [pos, setPos] = React.useState<React.CSSProperties | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dica = React.useRef<HTMLSpanElement>(null);
  const ancora = React.useRef<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    if (!pos || !dica.current || !ancora.current) return;
    const b = ancora.current, d = dica.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.left, window.innerWidth - d.width - 8));
    const top = b.bottom + 7 + d.height <= window.innerHeight - 8 ? b.bottom + 7 : b.top - d.height - 7;
    if (pos.left !== left || pos.top !== top) setPos({ left, top });
  }, [pos]);
  const limpar = () => { if (timer.current) clearTimeout(timer.current); };
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const fechar = () => { limpar(); setPos(null); };
  const abrir = (el: HTMLButtonElement) => {
    limpar();
    if (!texto || el.disabled || el.getAttribute("aria-expanded") === "true") return;
    timer.current = setTimeout(() => {
      const b = el.getBoundingClientRect();
      ancora.current = b;
      setPos({ top: b.bottom + 7, left: b.left });
    }, 300);
  };
  const p = children.props;
  return <>{React.cloneElement(children, {
    "aria-describedby": pos ? [p["aria-describedby"], id].filter(Boolean).join(" ") : p["aria-describedby"],
    onMouseEnter: (e) => { p.onMouseEnter?.(e); abrir(e.currentTarget); },
    onMouseLeave: (e) => { p.onMouseLeave?.(e); fechar(); },
    onFocus: (e) => { p.onFocus?.(e); abrir(e.currentTarget); },
    onBlur: (e) => { p.onBlur?.(e); fechar(); },
    onPointerDown: (e) => { p.onPointerDown?.(e); fechar(); }
  })}{pos && createPortal(<span ref={dica} id={id} role="tooltip" className="dica-de-acao" style={pos}>{texto}</span>, document.body)}</>;
}
