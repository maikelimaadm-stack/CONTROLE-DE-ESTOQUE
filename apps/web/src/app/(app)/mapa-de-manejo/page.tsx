import { Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapaDeManejo } from "@/features/mapa-de-manejo/mapa-de-manejo";

/**
 * Mapa de Manejo: polígonos das áreas cadastradas, sem listagem lateral nem satélite.
 * Experiência separada do Mapa geral (`/mapa-geral`).
 */
export default function Page() {
  return (
    <Suspense>
      <MapaDeManejo />
    </Suspense>
  );
}
