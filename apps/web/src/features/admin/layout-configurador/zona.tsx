"use client";
import type * as React from "react";
import type { ZonaDoLayout } from "@agro/domain";
import { MIME_ARRASTE, useConfigurador, type ConfiguradorCtx } from "./contrato";
import { moverCampo } from "./operacoes";

/**
 * Arrastar e soltar (HTML5) do configurador (VENDAS-A3-1c). Dono: W6. A zona aceita ou recusa pela MESMA operação que os
 * botões sem mouse usam (`moverCampo`, que aplica `motivoZonaProibida`): a regra tem um dono só.
 */

/** Motivo da recusa de soltar `chave` em `zona` (null = aceita). */
export function motivoDeSoltura(ctx: ConfiguradorCtx, chave: string, zona: ZonaDoLayout): string | null {
  const r = moverCampo(ctx.familia, ctx.estrutura, chave, zona);
  return r.ok ? null : r.motivo;
}

/** A chave do campo da prévia sob o cursor (o alvo do `antesDe`), ou undefined = no fim da zona. */
function chaveSobCursor(ev: React.DragEvent<HTMLElement>): string | undefined {
  const alvo = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-testid^=config-campo-]") : null;
  if (!alvo || !ev.currentTarget.contains(alvo)) return undefined;
  return alvo.dataset.testid?.slice("config-campo-".length) || undefined;
}

export interface PropsDeZona {
  onDragOver: (ev: React.DragEvent<HTMLElement>) => void;
  onDrop: (ev: React.DragEvent<HTMLElement>) => void;
  "data-recusa"?: string;
  "data-aceita"?: "true";
  title?: string;
}

/** Props de drop HTML5 para o contêiner de uma zona. */
export function useZonaDeSoltura(zona: ZonaDoLayout): PropsDeZona {
  const ctx = useConfigurador();
  const arrastando = ctx.editando ? ctx.arrastando : null;
  const motivo = arrastando ? motivoDeSoltura(ctx, arrastando, zona) : null;
  return {
    onDragOver: (ev) => {
      if (!arrastando || motivo !== null) return; // sem preventDefault = o navegador não aceita a soltura
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
    },
    onDrop: (ev) => {
      const chave = ev.dataTransfer.getData(MIME_ARRASTE) || arrastando;
      if (!chave || !ctx.editando) return;
      ev.preventDefault();
      ev.stopPropagation();
      ctx.aplicar(moverCampo(ctx.familia, ctx.estrutura, chave, zona, chaveSobCursor(ev)));
      ctx.setArrastando(null);
    },
    ...(arrastando && motivo !== null ? { "data-recusa": motivo, title: motivo } : {}),
    ...(arrastando && motivo === null ? { "data-aceita": "true" as const } : {})
  };
}

/** Props para um elemento arrastável (campo da prévia ou chip de disponíveis). */
export function propsArrastavel(chave: string, ctx: ConfiguradorCtx): {
  draggable: boolean;
  onDragStart: (ev: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
} {
  return {
    draggable: ctx.editando,
    onDragStart: (ev) => {
      if (!ctx.editando) { ev.preventDefault(); return; }
      ev.dataTransfer.setData(MIME_ARRASTE, chave);
      ev.dataTransfer.effectAllowed = "move";
      ctx.setArrastando(chave);
    },
    onDragEnd: () => ctx.setArrastando(null)
  };
}
