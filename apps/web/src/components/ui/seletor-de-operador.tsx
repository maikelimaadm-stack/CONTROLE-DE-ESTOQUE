"use client";
import * as React from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lista flutuante única dos filtros de Compras, sem aumentar o painel ao abrir. */
export function SeletorDeOperador({ valor, opcoes, onChange }: {
  valor: string;
  opcoes: readonly { value: string; label: string }[];
  onChange: (valor: string) => void;
}) {
  return <Select.Root value={valor} onValueChange={onChange}>
    <Select.Trigger className="fselb" aria-label="Condição">
      <span className="fselb-l"><Select.Value /></span>
      <Select.Icon className="fselb-c"><ChevronDown size={14} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><div className="b1ref">
      <Select.Content position="popper" sideOffset={4} className="fsell foperadores" aria-label="Condição" onEscapeKeyDown={(e) => e.stopPropagation()}>
        <Select.Viewport>
          {opcoes.map((o) => <Select.Item key={o.value} value={o.value} className={cn("fopt", o.value === valor && "on")}>
            <span className="fopt-c"><Select.ItemIndicator><Check size={12} /></Select.ItemIndicator></span>
            <Select.ItemText>{o.label}</Select.ItemText>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </div></Select.Portal>
  </Select.Root>;
}
