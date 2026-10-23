"use client";
import * as React from "react";
import { cn, numeroBR } from "@/lib/utils";
import { canonicoDoDigitado, ehZeroCanonico, filtrarDigitacao, paraDigitacao } from "@/lib/numero-digitado";

export type EntradaNumeroProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "inputMode"> & {
  /** Valor canônico (ponto decimal, sem milhar), como a API e o estado do lançamento usam. */
  value: string;
  onChange: (canonico: string) => void;
  /** Teto de casas na digitação; no blur a exibição segue `numeroBR` (inteiro sem casas / decimal com 2, ou este teto). */
  casas?: number;
  /** Só inteiro (sem vírgula). */
  inteiro?: boolean;
};

/**
 * Campo numérico do lançamento: sem setas/spinner, sem roda do mouse, pt-BR na tela,
 * canônico no estado. No foco, zero some para digitar limpo.
 */
export const EntradaNumero = React.forwardRef<HTMLInputElement, EntradaNumeroProps>(function EntradaNumero(
  { value, onChange, casas, inteiro, className, onFocus, onBlur, onWheel, ...rest },
  ref
) {
  const [foco, setFoco] = React.useState(false);
  const [texto, setTexto] = React.useState("");

  // Dinheiro (casas 2 ou omitido): inteiro `1.000` / decimal `1.000,00`. Quantidade (casas ≠ 2): teto com trim.
  const exibido = foco
    ? texto
    : (value === "" || value == null
      ? ""
      : inteiro
        ? numeroBR(value, 0)
        : (casas !== undefined && casas !== 2 ? numeroBR(value, casas) : numeroBR(value)));

  return (
    <input
      ref={ref}
      type="text"
      inputMode={inteiro ? "numeric" : "decimal"}
      autoComplete="off"
      className={cn("mg-input", className)}
      placeholder={rest.placeholder ?? " "}
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
