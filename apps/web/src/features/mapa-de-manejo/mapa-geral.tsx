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
import { dateBR, num } from "@/lib/utils";
import { CamadaDesenho } from "./camada-desenho";
import { COR_PADRAO_AREA } from "./cores";
import { AvisoDeLocalizacao, desenharAreas, hectares, limites, marcarSelecao, rotulosDasAreas, useAreasDoMapa, useMapaBase } from "./mapa-base";
import { AtribuicaoCopernicus, LegendaNdvi, PERMISSAO_PEDIR_NDVI, anosDasImagens, useResumoIndice } from "./ndvi";
import { OPACIDADE_PADRAO, RENDER_PADRAO, amostrarPixelCanvas, idCamadaRaster, sincronizarRastersNoMapa, type RenderRaster } from "./camada-rasters";
import { assinaturaDaGeometria } from "./cache-rasters";
import { coresPorArea, mediaValidaDoIndice, type ModoCor } from "./cor-por-area";
import { DATA_ULTIMA_IMAGEM, dataEscolhida, datasUteisDoHistorico, opcoesDeData, type DataDaCamada } from "./data-camada";
import { useHistoricoIndice } from "./condicao-dados";
import { useRastersIndice, type RasterIndiceDto } from "./rasters-indice";
import { BarraCamadas } from "./barra-camadas";
import { CondicaoDaArea } from "./condicao-area";
import { LegendaIndice } from "./legenda-indice";
import { NovaConsultaModal } from "./nova-consulta-modal";
import { ehIndiceDoBundle } from "@agro/domain";
import { familiaDoIndice, familiaPorId, nomeDoIndice, type FamiliaCamada, type IdIndice } from "./paletas-indices";
import { selecionarAreasDaVista, type Vista } from "./viewport-rasters";
import { areasDesatualizadas, type SelecaoConsulta } from "./consulta-satelite";

/**
 * MAPA GERAL (decisões 294 e 298) — visualização das áreas e do NDVI: por pixel (gradiente da SAT-06/07),
 * por área (média sólida) ou cor do cadastro. O cadastro de área fica na ficha; o mapa não grava área.
 */

const NOVA_AREA = "/cadastros/areas/new";
const fichaDaArea = (id: string) => `/cadastros/areas/${id}`;

export type { ModoCor };

function vistaDoMapa(m: MapLibreMap | null): Vista | null {
  if (!m) return null;
  const b = m.getBounds();
  return { oeste: b.getWest(), sul: b.getSouth(), leste: b.getEast(), norte: b.getNorth() };
}

export function MapaGeral() {
  const { can } = useAuth();
  const empresaId = useEmpresaPadrao();
  const lista = useAreasDoMapa();
  const areas = React.useMemo(() => lista.data?.items ?? [], [lista.data]);
  const [indice, setIndice] = React.useState<IdIndice>("ndvi");
  const [data, setData] = React.useState<DataDaCamada>(DATA_ULTIMA_IMAGEM);
  /**
   * Resumo da camada (índice × data ativa × método v2): cor por área e valor da lista.
   * Resumo da última útil (mesmo índice): "Áreas desatualizadas" / sem análise — identidade operacional atual.
   * Quando a data é "última", a query key coincide e há UMA só ida à rede.
   */
  const resumoIndice = useResumoIndice(indice, data);
  const resumoUltima = useResumoIndice(indice, DATA_ULTIMA_IMAGEM);
  const comNdvi = resumoIndice.situacao === "pronto" || resumoUltima.situacao === "pronto";
  const [modoEscolhido, setModoCor] = React.useState<ModoCor | null>(null);
  const algumNdvi = React.useMemo(
    () => resumoUltima.situacao === "pronto" && [...resumoUltima.porArea.values()].some((i) => i.ultima_observacao !== null),
    [resumoUltima]
  );
  const [selecionada, setSelecionada] = React.useState<string | null>(null);
  const [hoverAreaId, setHoverAreaId] = React.useState<string | null>(null);
  const [vista, setVista] = React.useState<Vista | null>(null);
  const [familia, setFamilia] = React.useState<FamiliaCamada>("vigor");
  const [render, setRender] = React.useState<RenderRaster>(RENDER_PADRAO);
  const [opacidade, setOpacidade] = React.useState(OPACIDADE_PADRAO);
  const [consulta, setConsulta] = React.useState<{ aberta: boolean; selecao?: SelecaoConsulta }>({ aberta: false });
  /** Evita o flash "Por área" → "Por pixel" enquanto os rasters ainda carregam. */
  const padraoTravadoRef = React.useRef(false);
  const areasRef = React.useRef(areas);
  React.useEffect(() => { areasRef.current = areas; }, [areas]);
  React.useEffect(() => {
    (window as unknown as { __mapaAreasE2E?: typeof areas }).__mapaAreasE2E = areas;
  }, [areas]);

  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoE2E", aoCarregar: registrarEventos });
  const { mapRef } = mapa;

  // Vista do mapa → quais áreas pedem raster (teto por vista; só o índice ativo — ver `viewport-rasters.ts`).
  React.useEffect(() => {
    if (!mapa.pronto) return;
    const m = mapRef.current;
    if (!m) return;
    setVista(vistaDoMapa(m));
    const onMove = () => setVista(vistaDoMapa(m));
    m.on("moveend", onMove);
    return () => { m.off("moveend", onMove); };
  }, [mapa.pronto, mapRef]);

  const selecao = React.useMemo(
    () => selecionarAreasDaVista(areas, vista, { prioritarias: selecionada ? [selecionada] : [] }),
    [areas, vista, selecionada]
  );

  const assinaturas = React.useMemo(() => new Map(areas.map((a) => [a.id, assinaturaDaGeometria(a.geometria)] as const)), [areas]);
  const rasters = useRastersIndice({ areaIds: selecao.ids, indice, data, assinaturas, ativo: comNdvi });
  // Datas úteis da área aberta para o índice ativo (o mesmo histórico do painel: uma consulta só, em cache).
  const historicoDaSelecionada = useHistoricoIndice(selecionada ?? "", indice, Boolean(selecionada) && comNdvi);
  const opcoesData = React.useMemo(
    () => opcoesDeData(datasUteisDoHistorico(selecionada ? (historicoDaSelecionada.data?.itens ?? []) : []), data, dateBR),
    [selecionada, historicoDaSelecionada.data, data]
  );
  const algumRaster = React.useMemo(() => {
    for (const e of rasters.porArea.values()) if (e.blobUrl && !e.erro) return true;
    return false;
  }, [rasters.porArea]);
  const dataImagem = React.useMemo(() => {
    if (data.tipo !== "ultima") return null;
    let maior: string | null = null;
    for (const e of rasters.porArea.values()) if (e.blobUrl && !e.erro && (maior === null || e.dto.data_imagem > maior)) maior = e.dto.data_imagem;
    return maior;
  }, [rasters.porArea, data]);

  // Trava o padrão UMA vez, só depois que a vista tem áreas E a listagem de rasters
  // terminou — evita travar em "Por área" com a vista ainda vazia e depois
  // ignorar as imagens que chegam.
  React.useEffect(() => {
    if (!comNdvi || modoEscolhido !== null || padraoTravadoRef.current) return;
    if (selecao.ids.length === 0) return;
    if (rasters.situacao === "carregando" || rasters.situacao === "ocioso") return;
    padraoTravadoRef.current = true;
    setModoCor(algumRaster ? "pixel" : algumNdvi ? "area" : "cadastro");
  }, [comNdvi, modoEscolhido, rasters.situacao, algumRaster, algumNdvi, selecao.ids.length]);

  /** Índice que não é o NDVI abre por pixel (a menos que o usuário já esteja na cor por área). */
  function escolherIndice(i: IdIndice) {
    setIndice(i);
    setFamilia(familiaDoIndice(i));
    if (i !== "ndvi" && modoEscolhido !== "pixel" && modoEscolhido !== "area") setModoCor("pixel");
  }

  /** Imagem gerada pelo painel: leva a camada ao índice (e à data, se há uma escolhida) a que ela pertence. */
  async function aoGerarRaster(dto: RasterIndiceDto) {
    const doIndice: IdIndice = ehIndiceDoBundle(dto.indice) ? dto.indice : indice;
    if (doIndice !== indice) escolherIndice(doIndice);
    if (data.tipo === "data" && data.data !== dto.data_imagem) setData(dataEscolhida(dto.data_imagem));
    else if (doIndice === indice) await rasters.incorporarDto(dto);
    setModoCor("pixel");
  }
  function escolherFamilia(f: FamiliaCamada) {
    setFamilia(f);
    const indices = familiaPorId(f).indices;
    if (!indices.includes(indice)) escolherIndice(indices[0]!);
  }

  const modoCor: ModoCor = !comNdvi ? "cadastro" : (modoEscolhido ?? "cadastro");

  /**
   * Cor sólida do preenchimento: média do ÍNDICE ATIVO na paleta dele; área sem análise válida fica cinza. No modo pixel
   * vale para as áreas SEM raster. A cor do cadastro só aparece quando o usuário escolheu "Cor do cadastro".
   */
  const corPorArea = React.useMemo(
    () => coresPorArea(modoCor, indice, areas, resumoIndice.situacao === "pronto" ? resumoIndice.porArea : null),
    [modoCor, indice, areas, resumoIndice]
  );

  const opacidadePorArea = React.useMemo(() => {
    if (modoCor !== "pixel") return null;
    return new Map(areas.map((a) => {
      const tem = rasters.temRaster(a.id);
      // Com imagem: preenchimento some (o gradiente cobre). Sem imagem: opacidade menor = fallback distinto.
      return [a.id, tem ? 0 : 0.42] as const;
    }));
  }, [modoCor, areas, rasters]);

  React.useEffect(() => {
    (window as unknown as { __mapaNdviE2E?: unknown }).__mapaNdviE2E = {
      situacao: resumoUltima.situacao,
      modo: modoCor,
      indice,
      data: data.tipo === "ultima" ? "ultima" : data.data,
      resumoIndice: resumoIndice.situacao,
      cores: corPorArea ? Object.fromEntries(corPorArea) : null,
      rasters: Object.fromEntries([...rasters.porArea].map(([id, e]) => [id, { id: e.dto.id, erro: e.erro, temImagem: Boolean(e.blobUrl) }])),
      /** Amostra RGBA do canvas colorido (aceite: dois pixels diferentes no mesmo polígono). */
      amostrar: (areaId: string, x: number, y: number) => {
        const e = rasters.porArea.get(areaId);
        if (!e?.canvas.width) return null;
        return amostrarPixelCanvas(e.canvas, x, y);
      },
      camadaVisivel: (areaId: string) => {
        const m = mapRef.current;
        if (!m) return false;
        try { return m.getLayoutProperty(idCamadaRaster(areaId), "visibility") !== "none" && Boolean(m.getLayer(idCamadaRaster(areaId))); }
        catch { return false; }
      }
    };
  }, [resumoUltima.situacao, modoCor, indice, data, resumoIndice.situacao, corPorArea, rasters.porArea, mapRef]);

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

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, areas, null, corPorArea, opacidadePorArea);
  }, [areas, corPorArea, opacidadePorArea, mapa.pronto, mapRef]);

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    sincronizarRastersNoMapa(m, rasters.porArea, modoCor === "pixel", { resampling: render, opacidade });
  }, [rasters.porArea, modoCor, render, opacidade, mapa.pronto, mapRef, areas]);

  const selecaoAnteriorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    const ant = selecaoAnteriorRef.current;
    if (ant && ant !== selecionada) marcarSelecao(m, ant, false);
    if (selecionada) marcarSelecao(m, selecionada, true);
    selecaoAnteriorRef.current = selecionada;
  }, [selecionada, mapa.pronto, areas, corPorArea, mapRef]);

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

  const m = mapa.pronto ? mapRef.current : null;
  const rotulos = m ? rotulosDasAreas(m, areas, hoverAreaId ?? selecionada) : [];
  const selecionadaObj = areas.find((a) => a.id === selecionada) ?? null;
  const totalHa = areas.reduce((s, a) => s + hectares(a.area_ha), 0);
  const podeCadastrar = can("batch_area.create");
  const entradaAreas = entryById("configuracoes.pecuaria.areas");
  const anosNdvi = React.useMemo(() => {
    const fonte = resumoUltima.situacao === "pronto" ? resumoUltima : resumoIndice.situacao === "pronto" ? resumoIndice : null;
    if (!fonte) return null;
    const datas = areas.map((a) => fonte.porArea.get(a.id)?.ultima_observacao?.observacao_inicio);
    for (const e of rasters.porArea.values()) if (e.blobUrl && !e.erro) datas.push(e.dto.data_imagem);
    return anosDasImagens(datas);
  }, [resumoUltima, resumoIndice, areas, rasters.porArea]);
  const mostrarLegenda = comNdvi && (modoCor === "pixel" || modoCor === "area");
  const podeConsultar = can(PERMISSAO_PEDIR_NDVI);
  const idsSemAnalise = React.useMemo(
    () => (resumoUltima.situacao === "pronto"
      ? areas.filter((a) => a.geometria && !resumoUltima.porArea.get(a.id)?.ultima_observacao).map((a) => a.id)
      : []),
    [resumoUltima, areas]
  );
  // "Desatualizada" = contorno ATUAL sem análise válida do método ativo v2 (última útil — não a data da camada).
  const desatualizadas = React.useMemo(
    () => (resumoUltima.situacao === "pronto" && !resumoUltima.temMais ? areasDesatualizadas(areas, resumoUltima.porArea) : null),
    [resumoUltima, areas]
  );
  const semImagemDoIndice = modoCor === "pixel" && rasters.situacao === "pronto" && selecao.ids.length > 0 && !algumRaster;
  const ausentesNaVista = rasters.situacao === "pronto" ? selecao.ids.filter((id) => rasters.ausentes.has(id)).length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa geral</h1>
          <p className="text-xs text-slate-500">As áreas da propriedade e a condição de cada uma por satélite: vigor, umidade e cobertura/solo. O cadastro e o contorno de cada área ficam em Cadastro de Área.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {entradaAreas && <Link href={canonicalHref(entradaAreas)} className={buttonVariants({ variant: "outline" })} data-testid="mapa-ir-areas">Cadastro de Área</Link>}
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
            {!lista.isLoading && !lista.error && areas.length === 0 && <EmptyState title="Nenhuma área cadastrada" description="Cadastre as áreas em Cadastro de Área: o contorno desenhado na ficha aparece aqui." />}
            {areas.map((a) => {
              const media = resumoIndice.situacao === "pronto" ? mediaValidaDoIndice(resumoIndice.porArea.get(a.id)) : null;
              const tituloMedia = data.tipo === "data"
                ? `${nomeDoIndice(indice)} médio em ${dateBR(data.data)}`
                : `${nomeDoIndice(indice)} médio da última imagem útil`;
              return (
                <button key={a.id} type="button" data-testid="mapa-item-area" onClick={() => selecionarNaLista(a.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${a.id === selecionada ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}>
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: corPorArea?.get(a.id) ?? a.color ?? COR_PADRAO_AREA }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{a.name}</span>
                  {media !== null && <span className="shrink-0 text-xs font-medium tabular-nums text-slate-700" title={tituloMedia} data-testid="mapa-item-ndvi">{num(media, 2)}</span>}
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{num(hectares(a.area_ha), 2)} ha</span>
                </button>
              );
            })}
          </CardBody>
        </Card>

        <div className="flex min-h-0 flex-col gap-2">
        <BarraCamadas
          mapa={mapa}
          comSatelite={comNdvi}
          familia={familia}
          onFamilia={escolherFamilia}
          indice={indice}
          onIndice={escolherIndice}
          modoCor={modoCor}
          onModoCor={setModoCor}
          render={render}
          onRender={setRender}
          opacidade={opacidade}
          onOpacidade={setOpacidade}
          data={data}
          onData={setData}
          opcoesData={opcoesData}
          dataImagem={dataImagem}
          podeConsultar={podeConsultar}
          onNovaConsulta={() => setConsulta({ aberta: true, selecao: selecionada ? "atual" : "viewport" })}
        />
        <Card className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={mapa.containerRef} data-testid="mapa-canvas" className="h-full min-h-[420px] w-full" />
          {mapa.pronto && (
            <CamadaDesenho desenhando={false} rotulosAreas={rotulos} pts={[]} fechado={false} cur={null} raw={null} ima={null} travado={false}
              rumo={null} arrastando={false} arrastoVertice={-1} hover={null} lados={[]} />
          )}
          {!mapa.pronto && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><Spinner /></div>}
          {mapa.pronto && (
            <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-4rem)] flex-col items-start gap-1">
              {resumoUltima.situacao === "indisponivel" && <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-ndvi-indisponivel">Análise por satélite ainda não disponível neste servidor.</div>}
              {resumoUltima.situacao === "erro" && (
                <div className="pointer-events-auto flex items-center gap-2 rounded bg-white/90 px-2 py-1 text-xs text-red-600 shadow-sm" data-testid="mapa-ndvi-erro">
                  Não foi possível carregar o NDVI das áreas.
                  <Button type="button" size="sm" variant="ghost" onClick={resumoUltima.tentarDeNovo}>Tentar de novo</Button>
                </div>
              )}
              {resumoUltima.situacao === "pronto" && resumoUltima.temMais && <div className="rounded bg-white/90 px-2 py-1 text-xs text-amber-700 shadow-sm">O NDVI mostra as primeiras áreas do escopo; as demais aparecem sem cor de NDVI.</div>}
              {selecao.truncado && modoCor === "pixel" && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-amber-700 shadow-sm" data-testid="mapa-raster-truncado">
                  Mostrando a imagem de {selecao.ids.length} das {selecao.naVista} áreas à vista (as mais próximas do centro). Aproxime o mapa para ver as demais.
                </div>
              )}
              {data.tipo === "data" && modoCor === "pixel" && rasters.situacao === "pronto" && ausentesNaVista > 0 && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-sem-imagem-data">
                  {ausentesNaVista} de {selecao.ids.length} área(s) à vista sem imagem de {nomeDoIndice(indice)} em {dateBR(data.data)}. Nenhuma outra data é usada no lugar.
                </div>
              )}
              {data.tipo === "ultima" && semImagemDoIndice && indice !== "ndvi" && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-sem-imagem-indice">
                  Nenhuma área à vista tem imagem de {nomeDoIndice(indice)} gerada. Abra uma área e use Gerar raster.
                </div>
              )}
              {rasters.situacao === "erro" && rasters.erro && <div className="rounded bg-white/90 px-2 py-1 text-xs text-red-600 shadow-sm" data-testid="mapa-raster-erro">{rasters.erro}</div>}
              {mostrarLegenda && (modoCor === "pixel" ? <LegendaIndice indice={indice} /> : indice === "ndvi" ? <LegendaNdvi modo="area" /> : <LegendaIndice indice={indice} modo="area" />)}
              {anosNdvi && <div className="rounded bg-white/90 px-2 py-0.5 shadow-sm"><AtribuicaoCopernicus anos={anosNdvi} testId="mapa-atribuicao-copernicus-mapa" /></div>}
            </div>
          )}
          <AvisoDeLocalizacao mapa={mapa} />

          {selecionadaObj && (
            <div className="absolute right-2 top-2 z-10 max-h-[calc(100%-1rem)] w-[min(22rem,calc(100%-1rem))] overflow-auto rounded-md border border-slate-200 bg-white p-3 shadow-lg" data-testid="mapa-area-selecionada">
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
              {comNdvi && (
                <CondicaoDaArea
                  areaId={selecionadaObj.id}
                  nomeDaArea={selecionadaObj.name}
                  temContorno={Boolean(selecionadaObj.geometria)}
                  indiceAtivo={indice}
                  raster={rasters.porArea.get(selecionadaObj.id) ?? null}
                  data={data}
                  semImagemNaData={rasters.ausentes.has(selecionadaObj.id)}
                  onHashAtual={rasters.confirmarHashDaArea}
                  onRasterGerado={aoGerarRaster}
                  onNovaConsulta={() => setConsulta({ aberta: true, selecao: "atual" })}
                />
              )}
              <div className="mt-2 flex justify-end">
                <Link href={fichaDaArea(selecionadaObj.id)} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="mapa-abrir-cadastro">Abrir cadastro</Link>
              </div>
            </div>
          )}
        </Card>
        </div>
      </div>

      {podeConsultar && (
        <NovaConsultaModal
          aberto={consulta.aberta}
          onFechar={() => setConsulta({ aberta: false })}
          areas={areas}
          areaAtualId={selecionada}
          idsNaVista={selecao.idsNaVista}
          idsSemAnalise={idsSemAnalise}
          idsDesatualizadas={desatualizadas}
          indiceAtivo={indice}
          selecaoInicial={consulta.selecao}
        />
      )}
    </div>
  );
}
