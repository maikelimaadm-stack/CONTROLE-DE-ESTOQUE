"use client";
import * as React from "react";
import type { Polygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { EditorDeContorno } from "@/features/mapa-de-manejo/editor-contorno";
import { useAreasDoMapa } from "@/features/mapa-de-manejo/mapa-base";

/**
 * Campo "Mapa" da ficha de Área/Piquete: o contorno (GeoJSON Polygon) é desenhado AQUI, com o editor completo — o
 * cadastro de área existe num lugar só (Áreas/Piquetes), e o Mapa de Manejo só mostra. As outras áreas visíveis entram
 * como vizinhas (aparecem no mapa e o ímã gruda nelas); a própria área fica de fora delas.
 */

function lerGeometria(v: unknown): Polygon | null {
  if (v == null || v === "") return null;
  let g: unknown = v;
  if (typeof v === "string") {
    try { g = JSON.parse(v); } catch { return null; }
  }
  if (!g || typeof g !== "object") return null;
  const o = g as { type?: string; coordinates?: unknown };
  if (o.type !== "Polygon" || !Array.isArray(o.coordinates)) return null;
  return o as Polygon;
}

export function CampoMapaArea({
  value,
  onChange,
  onAreaHa,
  disabled,
  cor,
  areaId
}: {
  value: unknown;
  onChange: (geometria: Polygon | null) => void;
  /** Preenche a área total (ha) a partir do contorno gravado. */
  onAreaHa?: (ha: number) => void;
  disabled?: boolean;
  cor?: string;
  /** A área desta ficha (edição): não é vizinha dela mesma. */
  areaId?: string | null;
}) {
  const geom = React.useMemo(() => lerGeometria(value), [value]);
  const lista = useAreasDoMapa();
  const vizinhas = React.useMemo(() => (lista.data?.items ?? []).filter((a) => a.id !== areaId), [lista.data, areaId]);
  return (
    <EditorDeContorno
      value={geom}
      vizinhas={vizinhas}
      cor={cor}
      disabled={disabled}
      onGravar={(g, ha) => { onChange(g); onAreaHa?.(Math.round(ha * 100) / 100); }}
      onRemover={() => onChange(null)}
    />
  );
}
