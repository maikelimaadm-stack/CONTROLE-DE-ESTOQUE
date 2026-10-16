"use client";
import type * as React from "react";
import { ColunaDeCampos } from "@/features/central/campo";

/**
 * Campos que antes moravam no acordeão "Dados adicionais · N campos" da Central de Compras.
 * Sem quebra: sempre à vista, na mesma coluna dos Dados principais — o portal de compras não oferece mais o botão.
 */
export function CamposExtrasDaCompra({ children, testId = "compras-campos-extras" }: {
  children: React.ReactNode; testId?: string;
}) {
  const lista = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  if (!lista.length) return null;
  /* Sem `contents` no invólucro do testid: o Playwright não considera `display: contents` visível. */
  return <div data-testid={testId}>
    <ColunaDeCampos>{children}</ColunaDeCampos>
  </div>;
}
