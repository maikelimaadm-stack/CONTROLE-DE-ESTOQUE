"use client";
import type { StyleSpecification, RasterSourceSpecification } from "maplibre-gl";

/**
 * MAPA-01 (decisão 289): camada base do Mapa de Manejo.
 *
 * As imagens do Google entram pela Map Tiles API (sessão + tiles 2D), que é a forma PERMITIDA de exibir os
 * tiles do Google num renderizador de terceiro (MapLibre). A chave é pública (restrita por domínio no painel
 * do Google) e vem de NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — nunca lida nem gravada por nós.
 *
 * Há duas bases: SATÉLITE (`satellite`) e MAPA de ruas (`roadmap`). A tela troca entre elas sem recarregar o
 * estilo — cada base é uma fonte raster própria, ligada/desligada por visibilidade. Sem chave, sem sessão ou
 * offline, o mapa cai num FUNDO LISO (sem imagem): os polígonos continuam visíveis.
 */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** Base escolhida na tela. `satelite` = imagem aérea; `mapa` = ruas (roadmap). */
export type TipoBase = "satelite" | "mapa";
const MAP_TYPE: Record<TipoBase, "satellite" | "roadmap"> = { satelite: "satellite", mapa: "roadmap" };

/** Ids estáveis da fonte/camada de cada base, usados para ligar e desligar a visibilidade. */
export const ID_BASE: Record<TipoBase, string> = { satelite: "base-satelite", mapa: "base-mapa" };

export interface SessaoBase {
  session: string;
  key: string;
}

/**
 * Cria a sessão de tiles 2D do Google para a base pedida (satélite ou ruas). Devolve nulo em qualquer falha —
 * a tela usa o fundo liso quando nem a satélite abre, e avisa quando só a de ruas falha.
 */
export async function criarSessaoGoogle(tipo: TipoBase = "satelite"): Promise<SessaoBase | null> {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: MAP_TYPE[tipo], language: "pt-BR", region: "BR" })
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { session?: string };
    return j?.session ? { session: j.session, key: GOOGLE_MAPS_KEY } : null;
  } catch {
    return null;
  }
}

/** Fonte raster MapLibre para uma sessão de tiles do Google. A atribuição "Google" é exigida pelos termos. */
export function fonteRaster(s: SessaoBase): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(s.session)}&key=${encodeURIComponent(s.key)}`],
    tileSize: 256,
    maxzoom: 20,
    attribution: "Google"
  };
}

/** Estilo inicial com a base de satélite (única carregada na abertura). A de ruas entra sob demanda na troca. */
export function estiloSatelite(s: SessaoBase): StyleSpecification {
  return {
    version: 8,
    sources: { [ID_BASE.satelite]: fonteRaster(s) },
    layers: [{ id: ID_BASE.satelite, type: "raster", source: ID_BASE.satelite }]
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
