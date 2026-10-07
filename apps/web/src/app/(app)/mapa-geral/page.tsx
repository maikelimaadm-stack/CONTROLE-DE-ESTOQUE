import { Suspense } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapaGeral } from "@/features/mapa-de-manejo/mapa-geral";

/**
 * MAPA-01 (decisão 289) → MAPA-GERAL (decisão 294): página do módulo Mapa geral (neutro, sem gado) — as áreas e os
 * resultados de cada uma. Só visualização: o cadastro de área é a ficha de Cadastro de Área.
 * O Mapa de Manejo (pastos com numeração) fica em `/mapa-de-manejo` (decisão 303).
 */
export default function Page() {
  return <Suspense><MapaGeral /></Suspense>;
}
