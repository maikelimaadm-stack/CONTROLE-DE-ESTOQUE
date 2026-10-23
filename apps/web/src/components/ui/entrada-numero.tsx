"use client";
import * as React from "react";
import { cn, num, numeroBR } from "@/lib/utils";
import { canonicoDoDigitado, ehZeroCanonico, filtrarDigitacao, paraDigitacao } from "@/lib/numero-digitado";

export type EntradaNumeroProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "inputMode"> & {
  /** Valor canônico (ponto decimal, sem milhar), como a API e o estado do lançamento usam. */
  value: string;
  onChange: (canonico: string) => void;
  /** Teto de casas na digitação; fora do foco a exibição força essas casas (315 → 315,00). */
  casas?: number;
  /** Só inteiro (sem vírgula). */
  inteiro?: boolean;
  /** Sem o chrome `mg-input` (pílula cinza) — uso na grade de itens, que traz o próprio estilo. */
  semChrome?: boolean;
};

/**
 * Campo numérico do lançamento: sem setas/spinner, sem roda do mouse, pt-BR na tela,
 * canônico no estado. No foco, zero some para digitar limpo.
 */
export const EntradaNumero = React.forwardRef<HTMLInputElement, EntradaNumeroProps>(function EntradaNumero(
  { value, onChange, casas, inteiro, semChrome, className, onFocus, onBlur, onWheel, ...rest },
  ref
) {
  const [foco, setFoco] = React.useState(false);
  const [texto, setTexto] = React.useState("");

  // Fora do foco: casas fixas (`num`) — inteiro também mostra decimais (decisão 349). Sem `casas`: numeroBR.
  const exibido = foco
    ? texto
    : (value === "" || value == null
      ? ""
      : inteiro
        ? numeroBR(value, 0)
        : (casas !== undefined ? num(value, casas) : numeroBR(value)));

  return (
    <input
      ref={ref}
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
        // nunca negociar o número com a roda do mouse
        (e.target as HTMLInputElement).blur();
        onWheel?.(e);
      }}
      {...rest}
    />
  );
});
EntradaNumero.displayName = "EntradaNumero";
