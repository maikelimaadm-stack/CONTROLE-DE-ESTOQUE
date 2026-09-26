"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

const SPAN: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8", 9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12" };
/** Campo do modelo base: caixa cinza arredondada com rótulo pequeno acima do valor (como o cadastro de Empresas do MG). */
export function B1Field({ label, required, error, help, span = 3, disabled, locked, hasValue = true, multiline, open, children, className, flex, idDoControle, testId, abaixo }: { label: string; /** aviso/botão que fica abaixo da caixa (a caixa tem altura fixa) */ abaixo?: React.ReactNode; /** id já posto na caixa por quem a desenha (partes de um campo de busca): o rótulo aponta para ele, sem clonar */ idDoControle?: string; testId?: string; required?: boolean; error?: string; help?: string; span?: number; /** modo visualização */ disabled?: boolean; /** travado em edição (somente leitura) */ locked?: boolean; /** rótulo pequeno no topo e valor na base; vazio = rótulo centralizado */ hasValue?: boolean; multiline?: boolean; /** seletor/calendário aberto */ open?: boolean; children: React.ReactNode; className?: string; flex?: boolean }) {
  const gerado = React.useId(); const id = idDoControle ?? gerado;
  const child = !idDoControle && React.isValidElement(children) && !(children.props as { id?: string }).id ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children;
  return <div data-testid={testId} className={cn(flex ? "min-w-[140px] flex-1" : cn("col-span-12", SPAN[span] ?? "md:col-span-3"), className)}>
    <div className={cn("mg-field", disabled && "mg-field--disabled", locked && !disabled && "mg-field--locked", hasValue && "mg-has-value", multiline && "mg-field--multiline", open && "is-open", error && "is-invalid")}>
      <label htmlFor={id} title={help} className="mg-field__label">{label}{required && <span className="req text-red-500"> *</span>}</label>
      <div className="mg-field__control">{child}</div>
    </div>
    {error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}
    {abaixo && <div className="mt-0.5">{abaixo}</div>}
  </div>;
}

