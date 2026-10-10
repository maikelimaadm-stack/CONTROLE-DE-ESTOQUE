"use client";
import * as React from "react";
import { Spinner, EmptyState, ErrorState } from "@/components/ui";
import { CamadaDesenho } from "./camada-desenho";
import {
  AvisoDeLocalizacao,
  SeletorDeBase,
  desenharAreas,
  limites,
  rotulosDasAreas,
  useMapaBase
} from "./mapa-base";
import { instalarCamadasDeLotes, sincronizarLotes } from "./camada-lotes";
import { registrarImagensDosIcones } from "./imagens-do-mapa";
import { useMapaOperacional, type FiltrosDoMapa } from "./operacional-dados";

/**
 * MAPA DE MANEJO (F2) — o mapa operacional: polígonos das áreas cadastradas e, em cada área ocupada, o MARCADOR
 * AGREGADO (ícone da configuração, contador de cabeças e identificador do lote).
 *
 * UMA fonte de dados: `GET /api/mapa/operacional` (operacional-dados.ts), uma chamada por combinação de filtros. Os
 * polígonos, os rótulos com as cabeças e os marcadores saem da MESMA resposta; a tela desenha o que a API resolveu.
 * Sem listagem lateral, satélite ou cadastro aqui (contorno e lotes nas fichas de Área/Lote).
 */

const FILTROS_INICIAIS: FiltrosDoMapa = { coloracao: "padrao", retiro_id: null, grazing_module_id: null };

export function MapaDeManejo() {
  const [filtros] = React.useState<FiltrosDoMapa>(FILTROS_INICIAIS);
  const operacional = useMapaOperacional(filtros);
  const resposta = operacional.data ?? null;
  const areas = React.useMemo(() => resposta?.areas ?? [], [resposta]);
  const cabecasPorArea = React.useMemo(() => new Map(areas.map((a) => [a.id, a.cabecas_total])), [areas]);

  // As fontes e camadas do marcador entram no carregamento do mapa, acima das camadas das áreas.
  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoE2E", aoCarregar: instalarCamadasDeLotes });
  const { mapRef } = mapa;

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, areas);
  }, [areas, mapa.pronto, mapRef, mapa.redesenhar]);

  // Marcadores: a fonte é sincronizada na hora com as imagens já registradas; quando a carga das imagens novas muda
  // o que está pronto, sincroniza de novo (fallback → ícone). setData só quando o estado serializado muda.
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    sincronizarLotes(m, resposta);
    let vigente = true;
    void registrarImagensDosIcones(m, resposta).then((mudou) => {
      if (vigente && mudou) sincronizarLotes(m, resposta);
    });
    return () => { vigente = false; };
  }, [resposta, mapa.pronto, mapRef]);

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
  const rotulos = m ? rotulosDasAreas(m, areas, null, cabecasPorArea) : [];

  const comContorno = areas.filter((a) => a.geometria?.type === "Polygon").length;
  const carregando = operacional.isLoading;
  const erro = operacional.error ?? null;

  // O contêiner do mapa fica SEMPRE montado: o mapa é criado uma vez, na montagem, sobre ele. Carregando, erro e
  // vazio aparecem POR CIMA do mapa.
  let aviso: React.ReactNode = null;
  if (erro && !carregando) {
    aviso = <ErrorState title="Não foi possível carregar o mapa" error={erro} onRetry={() => { void operacional.refetch(); }} />;
  } else if (!carregando && areas.length === 0) {
    aviso = <EmptyState title="Nenhuma área cadastrada" description="Cadastre as áreas em Cadastro de Área: o contorno desenhado na ficha aparece aqui como polígono." />;
  } else if (!carregando && comContorno === 0) {
    aviso = <EmptyState title="Nenhuma área com polígono" description="Desenhe o contorno na ficha de Cadastro de Área para ver o polígono no mapa." />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mapa-de-manejo">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
          <p className="text-xs text-slate-500">
            Áreas com contorno e quantidade de animais nos lotes vinculados a cada área (identificados e por contagem).
          </p>
        </div>
        <SeletorDeBase mapa={mapa} aviso="Sem imagem de satélite: configure a chave do Google Maps." />
      </div>

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
        {(!mapa.pronto || carregando) && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Spinner />
          </div>
        )}
        {aviso && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-md rounded-md border border-slate-200 bg-white shadow-sm" data-testid="mapa-manejo-aviso">
              {aviso}
            </div>
          </div>
        )}
        <AvisoDeLocalizacao mapa={mapa} />
      </div>
    </div>
  );
}
