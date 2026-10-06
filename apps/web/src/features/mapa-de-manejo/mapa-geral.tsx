"use client";
import * as React from "react";
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  badgePrincipalCondicao,
  corPredominanteCondicao,
  ehIndiceDoBundle,
  ordenarAreasCondicao,
  ROTULO_ORDENACAO_CONDICAO,
  type CodigoClasseCondicaoPasto,
  type OrdenacaoListaCondicao
} from "@agro/domain";
import { qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canonicalHref, entryById } from "@/lib/nav";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { Card, CardBody, Button, Dialog, Spinner, EmptyState, ErrorState, buttonVariants, NativeSelect } from "@/components/ui";
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
import { useMapasCondicao } from "./rasters-condicao";
import { BarraCamadas, type ExperienciaMapa } from "./barra-camadas";
import { CondicaoDaArea } from "./condicao-area";
import { LegendaIndice } from "./legenda-indice";
import { DialogAreaCondicao, DialogClasseCondicao, LegendaCondicaoPasto } from "./legenda-condicao";
import { NovaConsultaModal } from "./nova-consulta-modal";
import { AvisoAtualizandoMapa, BarraStatusAnalise } from "./barra-status-analise";
import { useOperacaoAnaliseViva } from "./use-operacao-analise";
import { familiaDoIndice, familiaPorId, nomeDoIndice, type FamiliaCamada, type IdIndice } from "./paletas-indices";
import { selecionarAreasDaVista, type Vista } from "./viewport-rasters";
import { areasDesatualizadas, type SelecaoConsulta } from "./consulta-satelite";

/**
 * MAPA GERAL (decisões 294, 298, 302) — experiência padrão: classificação integrada da condição do pasto.
 * Família, índice e paleta contínua ficam em Dados técnicos. O cadastro de área permanece na ficha.
 */

const NOVA_AREA = "/cadastros/areas/new";
const fichaDaArea = (id: string) => `/cadastros/areas/${id}`;
const CINZA_SEM_ANALISE = "#94a3b8";

function vistaDoMapa(m: MapLibreMap | null): Vista | null {
  if (!m) return null;
  const b = m.getBounds();
  return { oeste: b.getWest(), sul: b.getSouth(), leste: b.getEast(), norte: b.getNorth() };
}

export type { ModoCor };

export function MapaGeral() {
  const { can } = useAuth();
  const empresaId = useEmpresaPadrao();
  const lista = useAreasDoMapa();
  const areas = React.useMemo(() => lista.data?.items ?? [], [lista.data]);
  const [experiencia, setExperiencia] = React.useState<ExperienciaMapa>("condicao");
  const [classeFiltro, setClasseFiltro] = React.useState<CodigoClasseCondicaoPasto | null>(null);
  const [ordenacao, setOrdenacao] = React.useState<OrdenacaoListaCondicao>("atencao");
  const [indice, setIndice] = React.useState<IdIndice>("ndvi");
  const [data, setData] = React.useState<DataDaCamada>(DATA_ULTIMA_IMAGEM);
  /**
   * Resumo da camada (índice × data ativa × método v2): cor por área e valor da lista no modo técnico.
   * Resumo da última útil (mesmo índice): "Áreas desatualizadas" / sem análise — identidade operacional atual.
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
  const [consulta, setConsulta] = React.useState<{ aberta: boolean; selecao?: SelecaoConsulta; acompanhar?: boolean }>({ aberta: false });
  const padraoTravadoRef = React.useRef(false);
  const areasRef = React.useRef(areas);
  React.useEffect(() => { areasRef.current = areas; }, [areas]);
  React.useEffect(() => {
    (window as unknown as { __mapaAreasE2E?: typeof areas }).__mapaAreasE2E = areas;
  }, [areas]);

  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoE2E", aoCarregar: registrarEventos });
  const { mapRef } = mapa;
  const modoCondicao = experiencia === "condicao";

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
  const rasters = useRastersIndice({ areaIds: selecao.ids, indice, data, assinaturas, ativo: comNdvi && !modoCondicao });
  const mapasCond = useMapasCondicao({
    areaIds: selecao.ids,
    data,
    assinaturas,
    ativo: comNdvi && modoCondicao,
    classeDestaque: classeFiltro
  });
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
    const fonte = modoCondicao ? mapasCond.porArea : rasters.porArea;
    for (const e of fonte.values()) if (e.blobUrl && !e.erro && (maior === null || e.dto.data_imagem > maior)) maior = e.dto.data_imagem;
    for (const d of mapasCond.datasPorArea.values()) if (maior === null || d > maior) maior = d;
    return maior;
  }, [rasters.porArea, mapasCond.porArea, mapasCond.datasPorArea, data, modoCondicao]);

  React.useEffect(() => {
    if (!comNdvi || modoEscolhido !== null || padraoTravadoRef.current) return;
    if (selecao.ids.length === 0) return;
    if (rasters.situacao === "carregando" || rasters.situacao === "ocioso") return;
    padraoTravadoRef.current = true;
    setModoCor(algumRaster ? "pixel" : algumNdvi ? "area" : "cadastro");
  }, [comNdvi, modoEscolhido, rasters.situacao, algumRaster, algumNdvi, selecao.ids.length]);

  function escolherIndice(i: IdIndice) {
    setIndice(i);
    setFamilia(familiaDoIndice(i));
    if (i !== "ndvi" && modoEscolhido !== "pixel" && modoEscolhido !== "area") setModoCor("pixel");
  }

  async function aoGerarRaster(dto: RasterIndiceDto) {
    const doIndice: IdIndice = ehIndiceDoBundle(dto.indice) ? dto.indice : indice;
    if (doIndice !== indice) escolherIndice(doIndice);
    if (data.tipo === "data" && data.data !== dto.data_imagem) setData(dataEscolhida(dto.data_imagem));
    else if (doIndice === indice) await rasters.incorporarDto(dto);
    setModoCor("pixel");
    setExperiencia("tecnico");
  }
  function escolherFamilia(f: FamiliaCamada) {
    setFamilia(f);
    const indices = familiaPorId(f).indices;
    if (!indices.includes(indice)) escolherIndice(indices[0]!);
  }

  const modoCor: ModoCor = !comNdvi ? "cadastro" : (modoEscolhido ?? "cadastro");

  const corPorArea = React.useMemo(() => {
    if (modoCondicao) {
      const m = new Map<string, string>();
      for (const a of areas) {
        const resumo = mapasCond.resumos.get(a.id);
        m.set(a.id, corPredominanteCondicao(resumo) ?? CINZA_SEM_ANALISE);
      }
      return m;
    }
    return coresPorArea(modoCor, indice, areas, resumoIndice.situacao === "pronto" ? resumoIndice.porArea : null);
  }, [modoCondicao, modoCor, indice, areas, resumoIndice, mapasCond.resumos]);

  const overlayPixel = modoCondicao || modoCor === "pixel";
  const rastersAtivos = modoCondicao ? mapasCond.porArea : rasters.porArea;
  const temRaster = modoCondicao ? mapasCond.temRaster : rasters.temRaster;

  const opacidadePorArea = React.useMemo(() => {
    if (!overlayPixel) return null;
    return new Map(areas.map((a) => {
      const tem = temRaster(a.id);
      return [a.id, tem ? 0 : 0.42] as const;
    }));
  }, [overlayPixel, areas, temRaster, rastersAtivos]);

  React.useEffect(() => {
    (window as unknown as { __mapaNdviE2E?: unknown }).__mapaNdviE2E = {
      situacao: resumoUltima.situacao,
      modo: modoCondicao ? "condicao" : modoCor,
      experiencia,
      indice,
      data: data.tipo === "ultima" ? "ultima" : data.data,
      resumoIndice: resumoIndice.situacao,
      cores: corPorArea ? Object.fromEntries(corPorArea) : null,
      rasters: Object.fromEntries([...rastersAtivos].map(([id, e]) => [id, { id: e.dto.id, erro: e.erro, temImagem: Boolean(e.blobUrl) }])),
      amostrar: (areaId: string, x: number, y: number) => {
        const e = rastersAtivos.get(areaId);
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
  }, [resumoUltima.situacao, modoCor, modoCondicao, experiencia, indice, data, resumoIndice.situacao, corPorArea, rastersAtivos, mapRef]);

  function registrarEventos(m: MapLibreMap) {
    m.on("click", "areas-fill", (e) => {
      const id = e.features?.[0]?.properties?.id != null ? String(e.features[0].properties.id) : null;
      if (id && areasRef.current.some((a) => a.id === id)) {
        setConsulta((c) => (c.aberta ? { aberta: false } : c));
        setClasseFiltro(null);
        setSelecionada(id);
      }
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
    sincronizarRastersNoMapa(m, rastersAtivos, overlayPixel, { resampling: modoCondicao ? "nearest" : render, opacidade });
  }, [rastersAtivos, overlayPixel, render, opacidade, mapa.pronto, mapRef, areas, modoCondicao]);

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

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (consulta.aberta) return;
      if (classeFiltro !== null) { setClasseFiltro(null); return; }
      if (selecionada) setSelecionada(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [classeFiltro, selecionada, consulta.aberta]);

  const podeConsultar = can(PERMISSAO_PEDIR_NDVI);
  const operacao = useOperacaoAnaliseViva(podeConsultar);

  /** Abre "Analisar pastos" e fecha popups de área/classe (um de cada vez). Com análise viva → acompanhar. */
  function abrirAnalise(selecao?: SelecaoConsulta) {
    setClasseFiltro(null);
    setSelecionada(null);
    if (operacao.viva && operacao.consultaId) {
      setConsulta({ aberta: true, acompanhar: true });
      return;
    }
    setConsulta({ aberta: true, selecao: selecao ?? "empresa" });
  }

  function acompanharAnalise() {
    setClasseFiltro(null);
    setSelecionada(null);
    setConsulta({ aberta: true, acompanhar: true });
  }

  function selecionarNaLista(id: string) {
    if (consulta.aberta) setConsulta({ aberta: false });
    setClasseFiltro(null);
    setSelecionada(id);
    const a = areas.find((x) => x.id === id);
    const caixa = a ? limites([a.geometria]) : null;
    if (caixa) mapRef.current?.fitBounds(caixa, { padding: 60, maxZoom: 16 });
  }

  function filtrarClasse(c: CodigoClasseCondicaoPasto | null) {
    if (consulta.aberta) setConsulta({ aberta: false });
    if (c !== null) setSelecionada(null);
    setClasseFiltro(c);
  }

  const m = mapa.pronto ? mapRef.current : null;
  /** Só hover/selecionada — evita colisão de nomes; declutter em rotulosDasAreas fica como rede de segurança. */
  const rotulos = m
    ? (() => {
        const id = hoverAreaId ?? selecionada;
        if (!id) return [];
        return rotulosDasAreas(m, areas.filter((a) => a.id === id), id);
      })()
    : [];
  const selecionadaObj = areas.find((a) => a.id === selecionada) ?? null;
  const temObservacaoUtil = (areaId: string) => {
    if (resumoIndice.situacao === "pronto" && resumoIndice.porArea.get(areaId)?.ultima_observacao) return true;
    if (resumoUltima.situacao === "pronto" && resumoUltima.porArea.get(areaId)?.ultima_observacao) return true;
    return false;
  };
  const temMapaCondicao = (areaId: string) => mapasCond.resumos.has(areaId);
  /** Popups mutuamente exclusivos com o modal Analisar pastos. */
  const dialogAreaAberto = Boolean(modoCondicao && selecionadaObj && !consulta.aberta && classeFiltro === null);
  const dialogClasseAberto = Boolean(modoCondicao && classeFiltro !== null && !consulta.aberta);
  const dialogTecnicoAberto = Boolean(!modoCondicao && selecionadaObj && !consulta.aberta);
  const totalHa = areas.reduce((s, a) => s + hectares(a.area_ha), 0);
  const pastosComContorno = React.useMemo(() => areas.filter((a) => a.geometria), [areas]);
  const totalAreasAnalisaveis = pastosComContorno.length;
  const totalHaAnalisaveis = pastosComContorno.reduce((s, a) => s + hectares(a.area_ha), 0);
  const podeCadastrar = can("batch_area.create");
  const entradaAreas = entryById("configuracoes.pecuaria.areas");
  const anosNdvi = React.useMemo(() => {
    const fonte = resumoUltima.situacao === "pronto" ? resumoUltima : resumoIndice.situacao === "pronto" ? resumoIndice : null;
    if (!fonte) return null;
    const datas = areas.map((a) => fonte.porArea.get(a.id)?.ultima_observacao?.observacao_inicio);
    for (const e of rastersAtivos.values()) if (e.blobUrl && !e.erro) datas.push(e.dto.data_imagem);
    for (const d of mapasCond.datasPorArea.values()) datas.push(d);
    return anosDasImagens(datas);
  }, [resumoUltima, resumoIndice, areas, rastersAtivos, mapasCond.datasPorArea]);
  const mostrarLegendaTecnica = !modoCondicao && comNdvi && (modoCor === "pixel" || modoCor === "area");
  const idsSemAnalise = React.useMemo(
    () => (resumoUltima.situacao === "pronto"
      ? areas.filter((a) => a.geometria && !resumoUltima.porArea.get(a.id)?.ultima_observacao).map((a) => a.id)
      : []),
    [resumoUltima, areas]
  );
  const desatualizadas = React.useMemo(
    () => (resumoUltima.situacao === "pronto" && !resumoUltima.temMais ? areasDesatualizadas(areas, resumoUltima.porArea) : null),
    [resumoUltima, areas]
  );
  const semImagemDoIndice = !modoCondicao && modoCor === "pixel" && rasters.situacao === "pronto" && selecao.ids.length > 0 && !algumRaster;
  const ausentesNaVista = !modoCondicao && rasters.situacao === "pronto" ? selecao.ids.filter((id) => rasters.ausentes.has(id)).length : 0;

  const nomesPorId = React.useMemo(() => new Map(areas.map((a) => [a.id, a.name] as const)), [areas]);
  const areasOrdenadas = React.useMemo(() => {
    if (!modoCondicao) return areas;
    return ordenarAreasCondicao(
      areas.map((a) => ({ id: a.id, nome: a.name, areaHa: hectares(a.area_ha), resumo: mapasCond.resumos.get(a.id) })),
      ordenacao,
      classeFiltro
    ).map((x) => areas.find((a) => a.id === x.id)!);
  }, [modoCondicao, areas, mapasCond.resumos, ordenacao, classeFiltro]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-800">Mapa geral</h1>
          <p className="text-xs text-slate-500">Condição do pasto por satélite: um mapa categórico da cobertura, do vigor e da umidade juntos. Os índices individuais ficam em Dados técnicos. O cadastro e o contorno de cada área ficam em Cadastro de Área.</p>
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
            {modoCondicao && comNdvi && (
              <NativeSelect
                value={ordenacao}
                onChange={(e) => setOrdenacao(e.target.value as OrdenacaoListaCondicao)}
                aria-label="Ordenar áreas"
                className="mb-1 h-[26px] py-0 text-xs"
                data-testid="mapa-ordenacao-condicao"
              >
                {(Object.keys(ROTULO_ORDENACAO_CONDICAO) as OrdenacaoListaCondicao[]).map((k) => (
                  <option key={k} value={k}>{ROTULO_ORDENACAO_CONDICAO[k]}</option>
                ))}
              </NativeSelect>
            )}
            {lista.isLoading && <Spinner />}
            {lista.error && <ErrorState title="Não foi possível carregar as áreas" error={lista.error} onRetry={() => void lista.refetch()} />}
            {!lista.isLoading && !lista.error && areas.length === 0 && <EmptyState title="Nenhuma área cadastrada" description="Cadastre as áreas em Cadastro de Área: o contorno desenhado na ficha aparece aqui." />}
            {areasOrdenadas.map((a) => {
              const resumo = mapasCond.resumos.get(a.id);
              const badge = resumo ? badgePrincipalCondicao(resumo) : null;
              const media = !modoCondicao && resumoIndice.situacao === "pronto" ? mediaValidaDoIndice(resumoIndice.porArea.get(a.id)) : null;
              const tituloMedia = data.tipo === "data"
                ? `${nomeDoIndice(indice)} médio em ${dateBR(data.data)}`
                : `${nomeDoIndice(indice)} médio da última imagem útil`;
              return (
                <button key={a.id} type="button" data-testid="mapa-item-area" onClick={() => selecionarNaLista(a.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${a.id === selecionada ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}>
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: corPorArea?.get(a.id) ?? a.color ?? COR_PADRAO_AREA }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-700">{a.name}</span>
                    {modoCondicao && badge && (
                      <span className="block truncate text-[11px]" style={{ color: badge.cor }} data-testid="mapa-item-badge">{badge.rotulo}</span>
                    )}
                  </span>
                  {media !== null && <span className="shrink-0 text-xs font-medium tabular-nums text-slate-700" title={tituloMedia} data-testid="mapa-item-ndvi">{num(media, 2)}</span>}
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{num(hectares(a.area_ha), 1)} ha</span>
                </button>
              );
            })}
          </CardBody>
        </Card>

        <div className="flex min-h-0 flex-col gap-2">
        <BarraCamadas
          mapa={mapa}
          comSatelite={comNdvi}
          experiencia={experiencia}
          onExperiencia={setExperiencia}
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
          onData={(d) => { setData(d); setClasseFiltro(null); }}
          opcoesData={opcoesData}
          dataImagem={dataImagem}
          podeConsultar={podeConsultar}
          onNovaConsulta={() => abrirAnalise("empresa")}
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
              {operacao.viva && operacao.consulta && (
                <BarraStatusAnalise
                  consulta={operacao.consulta}
                  onAcompanhar={acompanharAnalise}
                  filaIndisponivel={operacao.filaIndisponivel}
                />
              )}
              <AvisoAtualizandoMapa visivel={modoCondicao && mapasCond.situacao === "carregando"} />
              {resumoUltima.situacao === "indisponivel" && <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-ndvi-indisponivel">Análise por satélite ainda não disponível neste servidor.</div>}
              {resumoUltima.situacao === "erro" && (
                <div className="pointer-events-auto flex items-center gap-2 rounded bg-white/90 px-2 py-1 text-xs text-red-600 shadow-sm" data-testid="mapa-ndvi-erro">
                  Não foi possível carregar o NDVI das áreas.
                  <Button type="button" size="sm" variant="ghost" onClick={resumoUltima.tentarDeNovo}>Tentar de novo</Button>
                </div>
              )}
              {resumoUltima.situacao === "pronto" && resumoUltima.temMais && <div className="rounded bg-white/90 px-2 py-1 text-xs text-amber-700 shadow-sm">O NDVI mostra as primeiras áreas do escopo; as demais aparecem sem cor de NDVI.</div>}
              {selecao.truncado && overlayPixel && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-amber-700 shadow-sm" data-testid="mapa-raster-truncado">
                  Mostrando a imagem de {selecao.ids.length} das {selecao.naVista} áreas à vista (as mais próximas do centro). Aproxime o mapa para ver as demais.
                </div>
              )}
              {data.tipo === "data" && !modoCondicao && modoCor === "pixel" && rasters.situacao === "pronto" && ausentesNaVista > 0 && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-sem-imagem-data">
                  {ausentesNaVista} de {selecao.ids.length} área(s) à vista sem imagem de {nomeDoIndice(indice)} em {dateBR(data.data)}. Nenhuma outra data é usada no lugar.
                </div>
              )}
              {data.tipo === "ultima" && semImagemDoIndice && indice !== "ndvi" && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm" data-testid="mapa-sem-imagem-indice">
                  Nenhuma área à vista tem imagem de {nomeDoIndice(indice)} gerada. Abra uma área e use Gerar raster.
                </div>
              )}
              {modoCondicao && mapasCond.datasDistintas.length > 1 && (
                <div className="rounded bg-white/90 px-2 py-1 text-xs text-amber-700 shadow-sm" data-testid="mapa-datas-incompativeis">
                  Há imagens de datas diferentes na vista. Escolha uma data para agregar hectares.
                </div>
              )}
              {rasters.situacao === "erro" && rasters.erro && <div className="rounded bg-white/90 px-2 py-1 text-xs text-red-600 shadow-sm" data-testid="mapa-raster-erro">{rasters.erro}</div>}
              {modoCondicao && comNdvi && (
                <div className="pointer-events-auto w-[min(18rem,calc(100vw-2rem))]">
                  <LegendaCondicaoPasto resumo={mapasCond.agregado} classe={classeFiltro} onClasse={filtrarClasse} />
                </div>
              )}
              {mostrarLegendaTecnica && (modoCor === "pixel" ? <LegendaIndice indice={indice} /> : indice === "ndvi" ? <LegendaNdvi modo="area" /> : <LegendaIndice indice={indice} modo="area" />)}
              {anosNdvi && <div className="rounded bg-white/90 px-2 py-0.5 shadow-sm"><AtribuicaoCopernicus anos={anosNdvi} testId="mapa-atribuicao-copernicus-mapa" /></div>}
            </div>
          )}
          <AvisoDeLocalizacao mapa={mapa} />
        </Card>
        </div>
      </div>

      {modoCondicao && selecionadaObj && (
        <DialogAreaCondicao
          aberto={dialogAreaAberto}
          onFechar={() => setSelecionada(null)}
          nome={selecionadaObj.name}
          ha={hectares(selecionadaObj.area_ha)}
          dataImagem={mapasCond.datasPorArea.get(selecionadaObj.id) ? dateBR(mapasCond.datasPorArea.get(selecionadaObj.id)!) : null}
          resumo={mapasCond.resumos.get(selecionadaObj.id) ?? null}
          semAnalise={!temMapaCondicao(selecionadaObj.id) && !temObservacaoUtil(selecionadaObj.id)}
          statsSemMapa={!temMapaCondicao(selecionadaObj.id) && temObservacaoUtil(selecionadaObj.id) && mapasCond.situacao === "pronto"}
          onDadosTecnicos={() => setExperiencia("tecnico")}
          hrefCadastro={fichaDaArea(selecionadaObj.id)}
        />
      )}

      {!modoCondicao && selecionadaObj && (
        <Dialog
          open={dialogTecnicoAberto}
          onOpenChange={(o) => { if (!o) setSelecionada(null); }}
          title={selecionadaObj.name}
          description={`${selecionadaObj.code ? `${selecionadaObj.code} · ` : ""}${num(hectares(selecionadaObj.area_ha), 2)} ha${!selecionadaObj.geometria ? " · sem contorno" : ""}`}
          size="md"
          profile="content"
          testId="mapa-area-selecionada"
          footer={(
            <>
              <Button type="button" variant="ghost" onClick={() => setSelecionada(null)} data-testid="dialog-area-fechar">Fechar</Button>
              <Link href={fichaDaArea(selecionadaObj.id)} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="mapa-abrir-cadastro">Abrir cadastro</Link>
            </>
          )}
        >
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
              onNovaConsulta={() => abrirAnalise("empresa")}
            />
          )}
        </Dialog>
      )}

      <DialogClasseCondicao
        aberto={dialogClasseAberto}
        codigo={classeFiltro}
        resumos={mapasCond.resumos}
        nomes={nomesPorId}
        onFechar={() => setClasseFiltro(null)}
      />

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
          selecaoInicial={consulta.selecao ?? "empresa"}
          totalAreas={totalAreasAnalisaveis}
          totalHa={totalHaAnalisaveis}
          modoAcompanhar={Boolean(consulta.acompanhar)}
          consultaIdInicial={consulta.acompanhar ? operacao.consultaId : null}
          filaDisponivel={operacao.capacidade?.fila_disponivel ?? null}
          onConsultaEmAndamento={() => operacao.recarregar()}
          onConcluida={() => { mapasCond.recarregar(); operacao.recarregar(); }}
        />
      )}
    </div>
  );
}
