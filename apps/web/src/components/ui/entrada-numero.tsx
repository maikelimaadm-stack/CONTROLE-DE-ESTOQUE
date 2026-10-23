"use client";
import * as React from "react";
import { cn, num, numeroBR } from "@/lib/utils";
import { canonicoDoDigitado, ehZeroCanonico, filtrarDigitacao, paraDigitacao } from "@/lib/numero-digitado";

export type EntradaNumeroProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "inputMode"> & {
  /** Valor canônico (ponto decimal, sem milhar), como a API e o estado do lançamento usam. */
  value: string;
  onChange: (canonico: string) => void;
  /** Casas na digitação e na exibição fora do foco (padrão 2 → 315,00). */
  casas?: number;
  /** Só inteiro (sem vírgula). */
  inteiro?: boolean;
  /** Sem o chrome `mg-input` (pílula cinza) — uso na grade de itens, que traz o próprio estilo. */
  semChrome?: boolean;
};

/**
 * Campo numérico do lançamento: sem setas/spinner, sem roda do mouse, pt-BR na tela,
 * canônico no estado. No Tab/foco o valor já vem selecionado; ao sair, formata com as casas.
 */
export const EntradaNumero = React.forwardRef<HTMLInputElement, EntradaNumeroProps>(function EntradaNumero(
  { value, onChange, casas = 2, inteiro, semChrome, className, onFocus, onBlur, onWheel, ...rest },
  ref
) {
  const [foco, setFoco] = React.useState(false);
  const [texto, setTexto] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = React.useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
  }, [ref]);

  const exibido = foco
    ? texto
    : (value === "" || value == null
      ? ""
      : inteiro
        ? numeroBR(value, 0)
        : num(value, casas));

  return (
    <input
      ref={setRefs}
      type="text"
      inputMode={inteiro ? "numeric" : "decimal"}
      autoComplete="off"
      className={cn(!semChrome && "mg-input", className)}
      placeholder={rest.placeholder ?? (semChrome ? "" : " ")}
      value={exibido}
      onFocus={(e) => {
        setFoco(true);
        setTexto(ehZeroCanonico(value) ? "" : paraDigitacao(value));
        onFocus?.(e);
        // Tab/clique: valor já selecionado para digitar por cima
        requestAnimationFrame(() => inputRef.current?.select());
      }}
      onBlur={(e) => {
        const c = canonicoDoDigitado(texto);
        onChange(c === "0" && texto.trim() === "" ? "" : c);
        setFoco(false);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const filtrado = filtrarDigitacao(e.target.value, { casas, inteiro });
        setTexto(filtrado);
        onChange(canonicoDoDigitado(filtrado));
      }}
      onWheel={(e) => {
        (e.target as HTMLInputElement).blur();
        onWheel?.(e);
      }}
      {...rest}
    />
  );
});
EntradaNumero.displayName = "EntradaNumero";
