import { Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapaDeManejo } from "@/features/mapa-de-manejo/mapa-de-manejo";

/**
 * Mapa de Manejo: pastos com numeração no mapa, sem listagem lateral nem satélite.
 * Experiência separada do Mapa geral (`/mapa-geral`).
 */
export default function Page() {
  return (
    <Suspense>
      <MapaDeManejo />
    </Suspense>
  );
}
