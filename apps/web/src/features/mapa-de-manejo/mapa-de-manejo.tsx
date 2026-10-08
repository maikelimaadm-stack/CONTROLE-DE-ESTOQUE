"use client";
import * as React from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Spinner, EmptyState, ErrorState } from "@/components/ui";
import { CamadaDesenho } from "./camada-desenho";
import {
  AvisoDeLocalizacao,
  SeletorDeBase,
  desenharAreas,
  limites,
  rotulosDasAreas,
  useAreasDoMapa,
  useMapaBase
} from "./mapa-base";
import { rotuloPasto } from "./rotulo-pasto";

/**
 * MAPA DE MANEJO (F2) — mapa só dos pastos: polígonos + numeração/código no contorno.
 * Sem listagem lateral, sem satélite/índices/consulta. Cadastro continua na ficha de Área.
 */

function registrarEventos(_m: MapLibreMap) {
  // só visualização — sem seleção, popup ou desenho nesta fatia
}

export function MapaDeManejo() {
  const lista = useAreasDoMapa();
  const areas = React.useMemo(() => lista.data?.items ?? [], [lista.data]);
  const areasComRotulo = React.useMemo(
    () => areas.map((a) => ({ ...a, name: rotuloPasto(a) })),
    [areas]
  );

  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoPastosE2E", aoCarregar: registrarEventos });
  const { mapRef } = mapa;

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, areas);
  }, [areas, mapa.pronto, mapRef, mapa.redesenhar]);

  const enquadrouRef = React.useRef(false);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto || enquadrouRef.current) return;
    const caixa = limites(areas.map((a) => a.geometria));
    if (!caixa) return;
    enquadrouRef.current = true;
    m.fitBounds(caixa, { padding: 60, maxZoom: 16, duration: 0 });
  }, [areas, mapa.pronto, mapRef]);

  const m = mapa.pronto ? mapRef.current : null;
  const rotulos = m ? rotulosDasAreas(m, areasComRotulo, null) : [];
  const comContorno = areas.filter((a) => a.geometria?.type === "Polygon").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mapa-de-manejo">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
          <p className="text-xs text-slate-500">
            Pastos da propriedade com a numeração de cada um. Só visualização — sem listagem ao lado.
          </p>
        </div>
        <SeletorDeBase mapa={mapa} aviso="Sem imagem de satélite: configure a chave do Google Maps." />
      </div>

      {lista.isLoading && (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      )}
      {lista.error && (
        <ErrorState title="Não foi possível carregar as áreas" error={lista.error} onRetry={() => void lista.refetch()} />
      )}
      {!lista.isLoading && !lista.error && areas.length === 0 && (
        <EmptyState title="Nenhuma área cadastrada" description="Cadastre as áreas em Cadastro de Área: o contorno desenhado na ficha aparece aqui." />
      )}
      {!lista.isLoading && !lista.error && areas.length > 0 && comContorno === 0 && (
        <EmptyState title="Nenhuma área com contorno" description="Desenhe o contorno na ficha de Cadastro de Área para ver o pasto no mapa." />
      )}

      {!lista.isLoading && !lista.error && comContorno > 0 && (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          <div ref={mapa.containerRef} data-testid="mapa-manejo-canvas" className="h-full min-h-[480px] w-full" />
          {mapa.pronto && (
            <CamadaDesenho
              desenhando={false}
              rotulosAreas={rotulos}
              pts={[]}
              fechado={false}
              cur={null}
              raw={null}
              ima={null}
              travado={false}
              rumo={null}
              arrastando={false}
              arrastoVertice={-1}
              hover={null}
              lados={[]}
            />
          )}
          {!mapa.pronto && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <Spinner />
            </div>
          )}
          <AvisoDeLocalizacao mapa={mapa} />
        </div>
      )}
    </div>
  );
}
