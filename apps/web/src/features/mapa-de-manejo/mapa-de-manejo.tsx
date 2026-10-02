"use client";
import * as React from "react";
import type { Feature, Polygon } from "geojson";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, qs, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardBody, Button, Spinner, EmptyState, Field, Input, ConfirmDialog } from "@/components/ui";
import { criarSessaoGoogle, estiloSatelite, estiloFundoLiso, fonteRaster, ID_BASE, type TipoBase, CENTRO_PADRAO, ZOOM_PADRAO } from "./basemap";

/**
 * MAPA-01 (decisão 279) — Mapa de Manejo: cadastro de áreas NEUTRO (lavoura e pecuária). Só nome, tamanho e
 * cor; o polígono é desenhado no satélite (MapLibre + Terra Draw) e vale como GeoJSON. O tamanho sai do
 * desenho (Turf) e pode ser ajustado à mão. CRUD pela API do recurso `mapa_areas` (escopo por empresa no
 * servidor). Sem gado, sem base44.
 */

interface AreaApi {
  id: string;
  empresa_id: string;
  nome: string;
  tamanho_ha: string | number | null;
  cor: string | null;
  geometria: Polygon | null;
}

const COR_PADRAO = "#facc15";
const numeroBR = (v: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const hectares = (v: AreaApi["tamanho_ha"]) => (v === null || v === undefined || v === "" ? 0 : Number(v));

type Rascunho = { geometria: Polygon; tamanho_ha: number };

export function MapaDeManejo() {
  const { session } = useAuth();
  const empresaId = session?.empresaId ?? null;
  const queryClient = useQueryClient();

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  // Instância do Terra Draw (tipo carregado dinamicamente; mantido como unknown tipado nos pontos de uso).
  const drawRef = React.useRef<{ start: () => void; stop: () => void; setMode: (m: string) => void; getSnapshot: () => Feature[]; clear: () => void; on: (e: string, cb: (...a: unknown[]) => void) => void } | null>(null);
  const [mapaPronto, setMapaPronto] = React.useState(false);
  const [semImagem, setSemImagem] = React.useState(false);
  const [base, setBase] = React.useState<TipoBase>("satelite");
  const [desenhando, setDesenhando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [selecionada, setSelecionada] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ nome: string; cor: string; tamanho_ha: string }>({ nome: "", cor: COR_PADRAO, tamanho_ha: "" });
  const [excluir, setExcluir] = React.useState<AreaApi | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const listaQuery = useQuery({
    queryKey: ["mapa-areas", empresaId],
    queryFn: () => api<{ items: AreaApi[] }>(`/api/resources/mapa_areas${qs({ pageSize: 500 })}`)
  });
  const areas = React.useMemo(() => listaQuery.data?.items ?? [], [listaQuery.data]);

  // ---------- mapa (inicialização única) ----------
  React.useEffect(() => {
    let cancelado = false;
    let mapaCleanup: MapLibreMap | null = null;
    (async () => {
      const container = containerRef.current;
      if (!container) return;
      const maplibre = await import("maplibre-gl");
      const { TerraDraw, TerraDrawPolygonMode } = await import("terra-draw");
      const { TerraDrawMapLibreGLAdapter } = await import("terra-draw-maplibre-gl-adapter");
      if (cancelado) return;

      const sessao = await criarSessaoGoogle();
      if (cancelado) return;
      setSemImagem(!sessao);
      const m = new maplibre.Map({
        container,
        style: sessao ? estiloSatelite(sessao) : estiloFundoLiso(),
        center: CENTRO_PADRAO,
        zoom: ZOOM_PADRAO,
        attributionControl: { compact: true }
      });
      mapaCleanup = m;
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // "Habilitar minha localização": o controle do MapLibre pede a permissão do navegador e centra no usuário.
      m.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");
      mapRef.current = m;

      m.on("load", () => {
        if (cancelado) return;
        m.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        m.addLayer({ id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": ["coalesce", ["get", "cor"], COR_PADRAO], "fill-opacity": ["case", ["boolean", ["feature-state", "selecionada"], false], 0.45, 0.25] } });
        m.addLayer({ id: "areas-contorno", type: "line", source: "areas", paint: { "line-color": ["coalesce", ["get", "cor"], COR_PADRAO], "line-width": ["case", ["boolean", ["feature-state", "selecionada"], false], 3, 2] } });
        m.on("click", "areas-fill", (e) => { const f = e.features?.[0]; if (f && f.properties) setSelecionada(String(f.properties.id)); });
        m.on("mouseenter", "areas-fill", () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", "areas-fill", () => { m.getCanvas().style.cursor = ""; });

        // Terra Draw só inicia DEPOIS do estilo carregado: o adaptador chama addSource no primeiro render e
        // isso lança "Style is not done loading" se rodar antes do load — foi o que deixava o desenho inerte.
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
          modes: [new TerraDrawPolygonMode({ styles: { fillColor: COR_PADRAO, fillOpacity: 0.3, outlineColor: COR_PADRAO, outlineWidth: 2 } })]
        });
        draw.start();
        draw.on("finish", async () => {
          const feats = draw.getSnapshot();
          const poly = feats.find((f) => f.geometry?.type === "Polygon") as Feature<Polygon> | undefined;
          if (!poly) return;
          const area = (await import("@turf/area")).default;
          const m2 = area(poly);
          const ha = Math.round((m2 / 10000) * 10000) / 10000;
          setRascunho({ geometria: poly.geometry, tamanho_ha: ha });
          setForm({ nome: "", cor: COR_PADRAO, tamanho_ha: String(ha) });
          setDesenhando(false);
          draw.setMode("static");
          draw.clear();
        });
        drawRef.current = draw as unknown as typeof drawRef.current;
        setMapaPronto(true);
      });
    })();
    return () => { cancelado = true; try { drawRef.current?.stop(); } catch { /* adaptador já removido */ } mapaCleanup?.remove(); mapRef.current = null; };
  }, []);

  // ---------- desenhar as áreas salvas no mapa ----------
  React.useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || !mapaPronto) return;
    const src = mapa.getSource("areas") as GeoJSONSource | undefined;
    if (!src) return;
    const features: Feature<Polygon>[] = areas
      .filter((a) => a.geometria && a.geometria.type === "Polygon")
      .map((a) => ({ type: "Feature", id: a.id, properties: { id: a.id, nome: a.nome, cor: a.cor ?? COR_PADRAO }, geometry: a.geometria as Polygon }));
    src.setData({ type: "FeatureCollection", features });
  }, [areas, mapaPronto]);

  // ---------- realce da selecionada ----------
  React.useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || !mapaPronto) return;
    for (const a of areas) { try { mapa.setFeatureState({ source: "areas", id: a.id }, { selecionada: a.id === selecionada }); } catch { /* fonte ainda não pronta */ } }
  }, [selecionada, areas, mapaPronto]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!rascunho) return;
      if (!empresaId) throw new Error("Selecione uma empresa no topo para cadastrar a área.");
      const tamanho = form.tamanho_ha.trim() === "" ? rascunho.tamanho_ha : Number(form.tamanho_ha.replace(",", "."));
      await api("/api/resources/mapa_areas", { method: "POST", idempotencyKey: newIdem(), body: { empresa_id: empresaId, nome: form.nome.trim(), cor: form.cor, tamanho_ha: tamanho, geometria: rascunho.geometria } });
    },
    onSuccess: () => { setRascunho(null); setErro(null); void queryClient.invalidateQueries({ queryKey: ["mapa-areas"] }); },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível salvar a área.")
  });

  const remover = useMutation({
    mutationFn: async (id: string) => { await api(`/api/resources/mapa_areas/${id}`, { method: "DELETE" }); },
    onSuccess: () => { setExcluir(null); setSelecionada(null); void queryClient.invalidateQueries({ queryKey: ["mapa-areas"] }); },
    onError: (e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível excluir a área.")
  });

  function iniciarDesenho() {
    setErro(null); setSelecionada(null); setRascunho(null);
    const draw = drawRef.current;
    if (!draw) { setErro("O mapa ainda está carregando. Aguarde a imagem abrir e tente de novo."); return; }
    try {
      draw.setMode("polygon");
      setDesenhando(true);
    } catch {
      setErro("Não foi possível iniciar o desenho agora. Recarregue a página e tente de novo.");
    }
  }
  function cancelarDesenho() {
    const draw = drawRef.current;
    try { draw?.clear(); draw?.setMode("static"); } catch { /* nada desenhado */ }
    setDesenhando(false); setRascunho(null);
  }

  // Troca entre satélite e ruas sem recarregar o estilo: a base de ruas entra sob demanda, sob as áreas.
  async function trocarBase(novo: TipoBase) {
    if (novo === base || semImagem) return;
    const m = mapRef.current;
    if (!m) return;
    if (!m.getLayer(ID_BASE[novo])) {
      const s = await criarSessaoGoogle(novo);
      if (!mapRef.current) return;
      if (!s) { setErro(novo === "mapa" ? "Não foi possível carregar o mapa de ruas agora." : "Não foi possível carregar o satélite agora."); return; }
      m.addSource(ID_BASE[novo], fonteRaster(s));
      const sob = m.getLayer("areas-fill") ? "areas-fill" : undefined;
      m.addLayer({ id: ID_BASE[novo], type: "raster", source: ID_BASE[novo] }, sob);
    }
    for (const t of ["satelite", "mapa"] as const) {
      if (m.getLayer(ID_BASE[t])) m.setLayoutProperty(ID_BASE[t], "visibility", t === novo ? "visible" : "none");
    }
    setErro(null);
    setBase(novo);
  }

  const selecionadaObj = areas.find((a) => a.id === selecionada) ?? null;
  const podeCadastrar = Boolean(empresaId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
          <p className="text-xs text-slate-500">Áreas da propriedade desenhadas no mapa (lavoura e pecuária).</p>
        </div>
        <Button type="button" onClick={iniciarDesenho} disabled={!mapaPronto || desenhando || !podeCadastrar} data-testid="mapa-nova-area">Nova área</Button>
      </div>

      {!podeCadastrar && <Card><CardBody><p className="text-sm text-amber-700">Selecione uma empresa no topo para cadastrar e ver as áreas dela.</p></CardBody></Card>}
      {erro && <Card><CardBody><p className="text-sm text-red-600" data-testid="mapa-erro">{erro}</p></CardBody></Card>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[320px_1fr]">
        {/* Lista */}
        <Card className="min-h-0 overflow-hidden">
          <CardBody className="flex min-h-0 flex-col gap-1 overflow-auto">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Áreas {areas.length > 0 && <span className="font-normal normal-case text-slate-400">· {areas.length}</span>}</div>
            {listaQuery.isLoading && <Spinner />}
            {!listaQuery.isLoading && areas.length === 0 && <EmptyState title="Nenhuma área cadastrada" description="Use “Nova área” para desenhar a primeira no mapa." />}
            {areas.map((a) => (
              <button key={a.id} type="button" data-testid="mapa-item-area" onClick={() => { setSelecionada(a.id); const g = a.geometria; const mapa = mapRef.current; if (g && mapa) { const b = limites(g); if (b) mapa.fitBounds(b, { padding: 60, maxZoom: 16 }); } }}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${a.id === selecionada ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}>
                <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: a.cor ?? COR_PADRAO }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{a.nome}</span>
                <span className="shrink-0 text-xs text-slate-500">{numeroBR(hectares(a.tamanho_ha))} ha</span>
              </button>
            ))}
          </CardBody>
        </Card>

        {/* Mapa */}
        <Card className="relative min-h-0 overflow-hidden">
          <div ref={containerRef} data-testid="mapa-canvas" className="h-full min-h-[420px] w-full" />
          {!mapaPronto && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}
          {semImagem && mapaPronto && <div className="absolute left-2 top-2 rounded bg-slate-800/80 px-2 py-1 text-xs text-white">Sem imagem de satélite (configure a chave do Google). Desenho disponível.</div>}

          {/* Troca de base: satélite x ruas */}
          {mapaPronto && !semImagem && (
            <div className="absolute left-2 top-2 flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm" role="group" aria-label="Tipo de mapa">
              <button type="button" onClick={() => trocarBase("satelite")} aria-pressed={base === "satelite"} data-testid="mapa-base-satelite"
                className={`px-2.5 py-1 ${base === "satelite" ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}>Satélite</button>
              <button type="button" onClick={() => trocarBase("mapa")} aria-pressed={base === "mapa"} data-testid="mapa-base-mapa"
                className={`px-2.5 py-1 ${base === "mapa" ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}>Mapa</button>
            </div>
          )}
          {desenhando && <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-slate-800/80 px-3 py-1 text-xs text-white">Clique no mapa para marcar os pontos; feche no primeiro ponto para concluir. <button type="button" className="ml-2 underline" onClick={cancelarDesenho}>Cancelar</button></div>}

          {/* Formulário da área recém-desenhada */}
          {rascunho && (
            <Card className="absolute right-2 top-2 w-72 shadow-lg">
              <CardBody className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-slate-800">Nova área</div>
                <Field label="Nome" required><Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} data-testid="mapa-form-nome" /></Field>
                <Field label="Tamanho (ha)"><Input type="number" step="0.0001" value={form.tamanho_ha} onChange={(e) => setForm((f) => ({ ...f, tamanho_ha: e.target.value }))} data-testid="mapa-form-tamanho" /></Field>
                <Field label="Cor"><input type="color" value={form.cor} onChange={(e) => setForm((f) => ({ ...f, cor: e.target.value }))} className="h-8 w-16 cursor-pointer rounded border border-slate-300" data-testid="mapa-form-cor" /></Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setRascunho(null)}>Cancelar</Button>
                  <Button type="button" onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={form.nome.trim() === ""} data-testid="mapa-form-salvar">Salvar</Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Detalhe da área selecionada */}
          {selecionadaObj && !rascunho && (
            <Card className="absolute right-2 top-2 w-72 shadow-lg">
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm border border-slate-300" style={{ backgroundColor: selecionadaObj.cor ?? COR_PADRAO }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{selecionadaObj.nome}</span>
                </div>
                <div className="text-xs text-slate-500">{numeroBR(hectares(selecionadaObj.tamanho_ha))} ha</div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setSelecionada(null)}>Fechar</Button>
                  <Button type="button" variant="danger" onClick={() => setExcluir(selecionadaObj)} data-testid="mapa-excluir">Excluir</Button>
                </div>
              </CardBody>
            </Card>
          )}
        </Card>
      </div>

      <ConfirmDialog open={excluir !== null} onOpenChange={(o) => { if (!o) setExcluir(null); }} title="Excluir área" description={excluir ? `Excluir a área “${excluir.nome}”? Esta ação não pode ser desfeita.` : ""} confirmLabel="Excluir" danger loading={remover.isPending} onConfirm={() => { if (excluir) remover.mutate(excluir.id); }} />
    </div>
  );
}

/** Caixa envolvente [[oeste, sul],[leste, norte]] de um polígono GeoJSON, para enquadrar no mapa. */
function limites(g: Polygon): [[number, number], [number, number]] | null {
  const anel = g.coordinates?.[0];
  if (!anel || anel.length === 0) return null;
  let oeste = Infinity, sul = Infinity, leste = -Infinity, norte = -Infinity;
  for (const pos of anel) {
    const lng = pos[0], lat = pos[1];
    if (lng === undefined || lat === undefined) continue;
    if (lng < oeste) oeste = lng;
    if (lng > leste) leste = lng;
    if (lat < sul) sul = lat;
    if (lat > norte) norte = lat;
  }
  if (!Number.isFinite(oeste)) return null;
  return [[oeste, sul], [leste, norte]];
}
