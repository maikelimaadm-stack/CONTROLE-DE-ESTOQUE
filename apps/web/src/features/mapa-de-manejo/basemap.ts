"use client";
import type { StyleSpecification } from "maplibre-gl";

/**
 * MAPA-01 (decisão 279): camada base do Mapa de Manejo.
 *
 * O satélite do Google entra pela Map Tiles API (sessão + tiles 2D), que é a forma PERMITIDA de exibir os
 * tiles do Google num renderizador de terceiro (MapLibre). A chave é pública (restrita por domínio no painel
 * do Google) e vem de NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — nunca lida nem gravada por nós.
 *
 * Sem chave, sem sessão ou offline, o mapa cai num FUNDO LISO (sem imagem): os polígonos continuam visíveis.
 * A troca para outro provedor (OSM, Sentinel, PMTiles) é um passo futuro; por isso a base vive atrás desta
 * função, e não espalhada pela tela.
 */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export interface SessaoBase {
  session: string;
  key: string;
}

/** Cria a sessão de tiles 2D do Google (satélite). Devolve nulo em qualquer falha — a tela usa o fundo liso. */
export async function criarSessaoGoogle(): Promise<SessaoBase | null> {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "satellite", language: "pt-BR", region: "BR" })
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { session?: string };
    return j?.session ? { session: j.session, key: GOOGLE_MAPS_KEY } : null;
  } catch {
    return null;
  }
}

/** Estilo MapLibre com o satélite do Google. A atribuição "Google" é exigida pelos termos da Map Tiles API. */
export function estiloSatelite(s: SessaoBase): StyleSpecification {
  return {
    version: 8,
    sources: {
      satelite: {
        type: "raster",
        tiles: [`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(s.session)}&key=${encodeURIComponent(s.key)}`],
        tileSize: 256,
        maxzoom: 20,
        attribution: "Google"
      }
    },
    layers: [{ id: "satelite", type: "raster", source: "satelite" }]
  };
}

/** Estilo de reserva: fundo liso escuro, sem buscar imagem de terceiro. */
export function estiloFundoLiso(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "fundo", type: "background", paint: { "background-color": "#20314a" } }]
  };
}

/** Centro inicial (Brasil central) e zoom, usados quando não há nenhuma área para enquadrar. */
export const CENTRO_PADRAO: [number, number] = [-55, -15];
export const ZOOM_PADRAO = 4;
