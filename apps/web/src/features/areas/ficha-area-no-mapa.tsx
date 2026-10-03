"use client";
import * as React from "react";
import type { Polygon } from "geojson";
import { ResourceForm } from "@/features/resources/resource-form";
import { Button } from "@/components/ui";

/**
 * Mesma ficha de Áreas/Piquetes no Mapa de Manejo (SSOT erp.areas).
 * Geometria fica no mapa grande (opcional no cadastro); aqui vêm medidas, uso, cor em lista, etc.
 */
export function FichaAreaNoMapa({
  mode,
  areaId,
  empresaId,
  geometria,
  areaHa,
  onSaved,
  onCancel,
  onEditarContorno,
  onExcluir
}: {
  mode: "new" | "edit";
  areaId?: string;
  empresaId: string;
  /** Contorno já desenhado no mapa (omitido na UI; vai no corpo). */
  geometria?: Polygon | null;
  areaHa?: number;
  onSaved: () => void;
  onCancel: () => void;
  onEditarContorno?: () => void;
  onExcluir?: () => void;
}) {
  const haStr = areaHa != null && Number.isFinite(areaHa) ? (Math.round(areaHa * 100) / 100).toFixed(2) : undefined;
  const geomStr = geometria ? JSON.stringify(geometria) : undefined;
  const preset = React.useMemo(() => {
    if (mode !== "new") return undefined;
    const p: Record<string, string> = { empresa_id: empresaId };
    if (geomStr) p.geometria = geomStr;
    if (haStr) { p.area_ha = haStr; p.usable_area_ha = haStr; }
    return p;
  }, [mode, empresaId, geomStr, haStr]);
  const sobrescrever = React.useMemo(() => {
    if (mode !== "edit" || !geometria) return undefined;
    const o: Record<string, unknown> = { geometria };
    // Contorno novo atualiza a área total; a útil o usuário mantém/ajusta na ficha.
    if (haStr) o.area_ha = haStr;
    return o;
  }, [mode, geometria, haStr]);

  return (
    <div className="flex max-h-[calc(100%-1rem)] w-[min(26rem,calc(100%-1rem))] flex-col overflow-auto rounded-md border border-slate-200 bg-white shadow-lg" data-testid="mapa-ficha-cadastro">
      <ResourceForm
        key={mode === "new" ? `nova-${geomStr ?? "sem-geom"}` : `edit-${areaId}-${geomStr ?? "ok"}`}
        resourceKey="areas"
        id={mode === "new" ? "new" : (areaId ?? "new")}
        presetExtra={preset}
        sobrescrever={sobrescrever}
        camposOcultos={["geometria"]}
        afterSave={() => onSaved()}
        onCancel={onCancel}
      />
      {mode === "edit" && (onEditarContorno || onExcluir) && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-3 py-2">
          {onEditarContorno && (
            <Button type="button" variant="outline" size="sm" onClick={onEditarContorno} data-testid="mapa-editar-contorno">
              Editar contorno
            </Button>
          )}
          {onExcluir && (
            <Button type="button" variant="danger" size="sm" onClick={onExcluir} data-testid="mapa-excluir">
              Excluir
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
