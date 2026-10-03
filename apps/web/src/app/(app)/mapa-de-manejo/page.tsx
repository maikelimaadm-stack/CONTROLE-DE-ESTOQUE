import { Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapaDeManejo } from "@/features/mapa-de-manejo/mapa-de-manejo";

/** MAPA-01 (decisão 289): página do módulo Mapa de Manejo (mapa + cadastro de áreas; neutro, sem gado). */
export default function Page() {
  return <Suspense><MapaDeManejo /></Suspense>;
}
