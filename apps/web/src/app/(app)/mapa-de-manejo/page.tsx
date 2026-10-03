import { Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapaDeManejo } from "@/features/mapa-de-manejo/mapa-de-manejo";

/** MAPA-01 (decisão 289): página do módulo Mapa de Manejo (neutro, sem gado). CADASTRO-AREAS-03: só visualização — o cadastro de área é a ficha de Áreas/Piquetes. */
export default function Page() {
  return <Suspense><MapaDeManejo /></Suspense>;
}
