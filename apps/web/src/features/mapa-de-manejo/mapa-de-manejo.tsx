"use client";
import * as React from "react";
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";
import { X } from "lucide-react";
import { qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canonicalHref, entryById } from "@/lib/nav";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { Card, CardBody, Button, Spinner, EmptyState, ErrorState, buttonVariants } from "@/components/ui";
import { num } from "@/lib/utils";
import { CamadaDesenho } from "./camada-desenho";
import { COR_PADRAO_AREA } from "./cores";
import { AvisoDeLocalizacao, SeletorDeBase, desenharAreas, hectares, limites, marcarSelecao, rotulosDasAreas, useAreasDoMapa, useMapaBase } from "./mapa-base";

/**
 * Mapa de Manejo — SÓ VISUALIZAÇÃO das áreas (erp.areas). O cadastro de área existe num lugar só: a ficha de
 * Áreas/Piquetes, onde o contorno é desenhado com o editor completo. Daqui se abre o cadastro (da área clicada ou um
 * novo); o mapa não grava, não exclui e não importa nada.
 */

const NOVA_AREA = "/cadastros/areas/new";
const fichaDaArea = (id: string) => `/cadastros/areas/${id}`;

export function MapaDeManejo() {
  const { can } = useAuth();
  // A ficha nova já vem com a empresa da sessão (ou a primeira do contexto) — é PEDIDO; o servidor confere o escopo.
  const empresaId = useEmpresaPadrao();
  const lista = useAreasDoMapa();
  const areas = React.useMemo(() => lista.data?.items ?? [], [lista.data]);
  const [selecionada, setSelecionada] = React.useState<string | null>(null);
  /** Área sob o mouse (rótulo em destaque + contorno por cima). */
  const [hoverAreaId, setHoverAreaId] = React.useState<string | null>(null);
  const areasRef = React.useRef(areas);
  React.useEffect(() => { areasRef.current = areas; }, [areas]);
  React.useEffect(() => {
    (window as unknown as { __mapaAreasE2E?: typeof areas }).__mapaAreasE2E = areas;
  }, [areas]);

  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoE2E", aoCarregar: registrarEventos });
  const { mapRef } = mapa;

  /** Clique na área seleciona; passar o mouse destaca o contorno. */
  function registrarEventos(m: MapLibreMap) {
    m.on("click", "areas-fill", (e) => {
      const id = e.features?.[0]?.properties?.id != null ? String(e.features[0].properties.id) : null;
      if (id && areasRef.current.some((a) => a.id === id)) setSelecionada(id);
    });
    let hoverId: string | null = null;
    m.on("mousemove", "areas-fill", (e) => {
      m.getCanvas().style.cursor = "pointer";
      const id = e.features?.[0]?.properties?.id != null ? String(e.features[0].properties.id) : null;
      if (id === hoverId) return;
      if (hoverId) try { m.setFeatureState({ source: "areas", id: hoverId }, { hover: false }); } catch { /* */ }
      hoverId = id;
      if (hoverId) try { m.setFeatureState({ source: "areas", id: hoverId }, { hover: true }); } catch { /* */ }
      setHoverAreaId(hoverId);
    });
    m.on("mouseleave", "areas-fill", () => {
      m.getCanvas().style.cursor = "";
      if (hoverId) try { m.setFeatureState({ source: "areas", id: hoverId }, { hover: false }); } catch { /* */ }
      hoverId = null;
      setHoverAreaId(null);
    });
  }

  // ---------- áreas no mapa ----------
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, areas);
  }, [areas, mapa.pronto, mapRef]);
  // Contorno de seleção por cima dos vizinhos (feature-state na camada de destaque).
  const selecaoAnteriorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    const ant = selecaoAnteriorRef.current;
    if (ant && ant !== selecionada) marcarSelecao(m, ant, false);
    if (selecionada) marcarSelecao(m, selecionada, true);
    selecaoAnteriorRef.current = selecionada;
  }, [selecionada, mapa.pronto, areas, mapRef]);
  // Enquadra a propriedade uma vez, quando as áreas chegam.
  const enquadrouRef = React.useRef(false);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto || enquadrouRef.current) return;
    const caixa = limites(areas.map((a) => a.geometria));
    if (!caixa) return;
    enquadrouRef.current = true;
    m.fitBounds(caixa, { padding: 60, maxZoom: 16, duration: 0 });
  }, [areas, mapa.pronto, mapRef]);

  function selecionarNaLista(id: string) {
    setSelecionada(id);
    const a = areas.find((x) => x.id === id);
    const caixa = a ? limites([a.geometria]) : null;
    if (caixa) mapRef.current?.fitBounds(caixa, { padding: 60, maxZoom: 16 });
  }

  // ---------- derivados para a tela ----------
  const m = mapa.pronto ? mapRef.current : null;
  // Recalcula a cada redesenho do mapa (pan/zoom) — sem memo, senão o rótulo "gruda" na tela.
  const rotulos = m ? rotulosDasAreas(m, areas, hoverAreaId ?? selecionada) : [];
  const selecionadaObj = areas.find((a) => a.id === selecionada) ?? null;
  const totalHa = areas.reduce((s, a) => s + hectares(a.area_ha), 0);
  const podeCadastrar = can("batch_area.create");
  const entradaAreas = entryById("configuracoes.pecuaria.areas");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
          <p className="text-xs text-slate-500">Áreas da propriedade no mapa (lavoura e pecuária). O cadastro e o contorno de cada área ficam em Áreas/Piquetes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {entradaAreas && <Link href={canonicalHref(entradaAreas)} className={buttonVariants({ variant: "outline" })} data-testid="mapa-ir-areas">Áreas / Piquetes</Link>}
          {podeCadastrar && <Link href={`${NOVA_AREA}${qs({ empresa_id: empresaId || undefined })}`} className={buttonVariants()} data-testid="mapa-cadastrar-area">Cadastrar área</Link>}
        </div>
      </div>

      {mapa.erroBase && <Card><CardBody><p className="text-sm text-red-600" data-testid="mapa-erro">{mapa.erroBase}</p></CardBody></Card>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[280px_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardBody className="flex h-full min-h-0 flex-col gap-1 overflow-auto">
            <div className="mb-1 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Áreas</span>
              {areas.length > 0 && <span className="font-normal normal-case tabular-nums text-slate-400">{areas.length} · {num(totalHa, 2)} ha</span>}
            </div>
            {lista.isLoading && <Spinner />}
            {lista.error && <ErrorState title="Não foi possível carregar as áreas" error={lista.error} onRetry={() => void lista.refetch()} />}
            {!lista.isLoading && !lista.error && areas.length === 0 && <EmptyState title="Nenhuma área cadastrada" description="Cadastre as áreas em Áreas/Piquetes: o contorno desenhado na ficha aparece aqui." />}
            {areas.map((a) => (
              <button key={a.id} type="button" data-testid="mapa-item-area" onClick={() => selecionarNaLista(a.id)}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${a.id === selecionada ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}>
                <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: a.color ?? COR_PADRAO_AREA }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{a.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">{num(hectares(a.area_ha), 2)} ha</span>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card className="relative min-h-0 overflow-hidden">
          <div ref={mapa.containerRef} data-testid="mapa-canvas" className="h-full min-h-[420px] w-full" />
          {mapa.pronto && (
            <CamadaDesenho desenhando={false} rotulosAreas={rotulos} pts={[]} fechado={false} cur={null} raw={null} ima={null} travado={false}
              rumo={null} arrastando={false} arrastoVertice={-1} hover={null} lados={[]} />
          )}
          {!mapa.pronto && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}
          {mapa.pronto && (
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2">
              <SeletorDeBase mapa={mapa} aviso="Sem imagem de satélite (configure a chave do Google)." />
            </div>
          )}
          <AvisoDeLocalizacao mapa={mapa} />

          {/* Resumo da área clicada — só leitura; o cadastro abre na ficha de Áreas/Piquetes. */}
          {selecionadaObj && (
            <div className="absolute right-2 top-2 z-10 w-[min(18rem,calc(100%-1rem))] rounded-md border border-slate-200 bg-white p-3 shadow-lg" data-testid="mapa-area-selecionada">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: selecionadaObj.color ?? COR_PADRAO_AREA }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">{selecionadaObj.name}</div>
                  <div className="text-xs tabular-nums text-slate-500">
                    {selecionadaObj.code ? <>{selecionadaObj.code} · </> : null}{num(hectares(selecionadaObj.area_ha), 2)} ha
                    {!selecionadaObj.geometria && <> · sem contorno</>}
                  </div>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={() => setSelecionada(null)} aria-label="Fechar resumo" title="Fechar"><X className="h-4 w-4" aria-hidden /></Button>
              </div>
              <div className="mt-2 flex justify-end">
                <Link href={fichaDaArea(selecionadaObj.id)} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="mapa-abrir-cadastro">Abrir cadastro</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
