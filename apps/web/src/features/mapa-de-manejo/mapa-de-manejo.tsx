"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner, EmptyState, ErrorState } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CamadaDesenho } from "./camada-desenho";
import {
  AvisoDeLocalizacao,
  desenharAreas,
  limites,
  rotulosDasAreas,
  useMapaBase
} from "./mapa-base";
import { instalarCamadasDeLotes, sincronizarLotes } from "./camada-lotes";
import { registrarImagensDosIcones } from "./imagens-do-mapa";
import { useMapaOperacional, type AreaOperacional, type FiltrosDoMapa } from "./operacional-dados";
import { coloracaoDasAreas, comLinhaExtra } from "./coloracao-no-mapa";
import { LegendaDoMapa, POSICAO_DA_LEGENDA } from "./legenda-do-mapa";
import { SeletorDeColoracao } from "./seletor-de-coloracao";
import { BarraDoMapaOperacional, CAMADAS_INICIAIS, aplicarCamadasVisiveis, type CamadasVisiveis } from "./barra-do-mapa-operacional";
import { MolduraDoPainel, PainelDoPasto } from "./painel-do-pasto";
import { destacarSelecao, registrarSelecao, useResizeAdiado } from "./selecao-no-mapa";
import { useEscEmCascata } from "./use-esc-em-cascata";
import { registrarArraste } from "./mover-lote";
import { InterruptorDeArraste, PERMISSAO_DE_MOVER, useArrasteLigado } from "./interruptor-de-arraste";
import { MoverLoteDialogo, avisarArraste } from "./mover-lote-dialogo";

/**
 * MAPA DE MANEJO (F2) — o mapa operacional: polígonos das áreas cadastradas e, em cada área ocupada, o MARCADOR
 * AGREGADO (ícone da configuração, contador de cabeças e identificador do lote); clique no marcador ou na área abre o
 * painel do pasto; a coloração pinta as áreas pela faixa que a API devolve, com legenda e texto no rótulo.
 *
 * UMA fonte de dados: `GET /api/mapa/operacional` (operacional-dados.ts), uma chamada por combinação de filtros e
 * coloração. Os polígonos, os rótulos, os marcadores, as faixas e o painel saem da MESMA resposta; a tela desenha o que
 * a API resolveu — a única decisão dela é a paleta (paleta-do-mapa.ts). Decisão 308.
 *
 * MOVER LOTE: o arraste nasce DESLIGADO (interruptor na barra, só com a permissão de transferir) e só ESCOLHE o
 * destino; quem grava é o Confirmar do formulário de movimentação que já existe.
 */

const FILTROS_INICIAIS: FiltrosDoMapa = { coloracao: "padrao", retiro_id: null, grazing_module_id: null };

export function MapaDeManejo() {
  const [filtros, setFiltros] = React.useState<FiltrosDoMapa>(FILTROS_INICIAIS);
  const [camadas, setCamadas] = React.useState<CamadasVisiveis>(CAMADAS_INICIAIS);
  const [faixaFiltro, setFaixaFiltro] = React.useState<string | null>(null);
  const [selecionada, setSelecionada] = React.useState<string | null>(null);
  const [movimento, setMovimento] = React.useState<{ origem: AreaOperacional; destino: AreaOperacional } | null>(null);
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeMover = can(PERMISSAO_DE_MOVER);
  const [arrasteLigado, setArrasteLigado] = useArrasteLigado();

  const operacional = useMapaOperacional(filtros);
  const resposta = operacional.data ?? null;
  const areas = React.useMemo(() => resposta?.areas ?? [], [resposta]);
  const cabecasPorArea = React.useMemo(() => new Map(areas.map((a) => [a.id, a.cabecas_total])), [areas]);
  // Cor, atenuação e linha do rótulo vêm da MESMA resposta (com keepPreviousData, a coloração da resposta vigente).
  const coloracao = React.useMemo(() => coloracaoDasAreas(resposta, faixaFiltro), [resposta, faixaFiltro]);
  const areaSelecionada = selecionada ? areas.find((a) => a.id === selecionada) ?? null : null;

  // As fontes e camadas do marcador entram no carregamento do mapa, acima das camadas das áreas.
  const mapa = useMapaBase({ ganchoE2E: "__mapaManejoE2E", aoCarregar: instalarCamadasDeLotes });
  const { mapRef } = mapa;

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    desenharAreas(m, areas, null, coloracao.corPorArea, coloracao.opacidadePorArea);
  }, [areas, coloracao, mapa.pronto, mapRef, mapa.redesenhar]);

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

  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    aplicarCamadasVisiveis(m, camadas);
  }, [camadas, mapa.pronto, mapRef]);

  // Clique no marcador ou na área → painel; clique no vazio → fecha.
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    return registrarSelecao(m, setSelecionada);
  }, [mapa.pronto, mapRef]);

  // Arraste de lote (registrado DEPOIS da seleção: o cursor "grab" vence o "pointer"). Os getters leem o valor da
  // última renderização sem reinstalar os eventos. Soltar em outra área abre o diálogo e fecha o painel — nunca dois
  // overlays; na própria área ou fora de qualquer área, só o aviso, e o marcador continua no centróide de origem.
  const ligadoRef = React.useRef(false);
  const areasRef = React.useRef(areas);
  React.useEffect(() => {
    ligadoRef.current = podeMover && arrasteLigado && movimento === null;
    areasRef.current = areas;
  });
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    return registrarArraste(m, {
      ligado: () => ligadoRef.current,
      areas: () => areasRef.current,
      aoSoltar: (r) => {
        if (r.tipo !== "destino") { avisarArraste(r); return; }
        setSelecionada(null);
        setMovimento({ origem: r.origem, destino: r.destino });
      }
    });
  }, [mapa.pronto, mapRef]);

  // A área selecionada que saiu da resposta (filtro novo) deixa de estar selecionada.
  React.useEffect(() => {
    if (selecionada && resposta && !areaSelecionada) setSelecionada(null);
  }, [selecionada, resposta, areaSelecionada]);

  const anteriorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapa.pronto) return;
    destacarSelecao(m, anteriorRef.current, selecionada);
    anteriorRef.current = selecionada;
  }, [selecionada, areas, mapa.pronto, mapRef]);

  // O canvas WebGL acompanha a abertura e o fechamento do painel lateral.
  useResizeAdiado(mapa, [areaSelecionada !== null]);

  // ESC desfaz em cascata: primeiro o filtro de faixa, depois a seleção, depois nada.
  useEscEmCascata([
    { ativo: coloracao.filtroAplicado !== null, desfazer: () => setFaixaFiltro(null) },
    { ativo: selecionada !== null, desfazer: () => setSelecionada(null) }
  ]);

  const mudarColoracao = React.useCallback((c: FiltrosDoMapa["coloracao"]) => {
    setFaixaFiltro(null);
    setFiltros((f) => ({ ...f, coloracao: c }));
  }, []);

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
  const rotulos = m ? comLinhaExtra(rotulosDasAreas(m, areas, selecionada, cabecasPorArea), coloracao.linhaPorArea) : [];

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
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-slate-800">Mapa de Manejo</h1>
        <p className="text-xs text-slate-500">
          Áreas com contorno, lotes presentes em cada área e a situação de cada pasto.
        </p>
      </div>

      <BarraDoMapaOperacional
        mapa={mapa}
        filtros={filtros}
        aoMudarFiltros={setFiltros}
        camadas={camadas}
        aoMudarCamadas={setCamadas}
        objetosDisponiveis={resposta?.capacidades.objetos ?? true}
      >
        <SeletorDeColoracao valor={filtros.coloracao} aoMudar={mudarColoracao} />
        {podeMover && <InterruptorDeArraste ligado={arrasteLigado} aoMudar={setArrasteLigado} />}
      </BarraDoMapaOperacional>

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          <div ref={mapa.containerRef} data-testid="mapa-manejo-canvas" className="h-full min-h-[480px] w-full" />
          {mapa.pronto && (
            <CamadaDesenho
              desenhando={false}
              rotulosAreas={rotulos}
              ocultarRotulos={!camadas.rotulos}
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
          {mapa.pronto && (
            <LegendaDoMapa
              // Em tela estreita o painel é bottom sheet: com ele aberto a legenda sai (nunca dois por cima do mapa).
              className={areaSelecionada ? `${POSICAO_DA_LEGENDA} hidden lg:block` : POSICAO_DA_LEGENDA}
              modo={resposta?.coloracao ?? "padrao"}
              faixas={coloracao.faixasPresentes}
              faixaFiltro={coloracao.filtroAplicado}
              aoFiltrar={setFaixaFiltro}
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
        {areaSelecionada && (
          <MolduraDoPainel>
            <PainelDoPasto area={areaSelecionada} objetos={resposta?.objetos ?? []} aoFechar={() => setSelecionada(null)} />
          </MolduraDoPainel>
        )}
      </div>

      <MoverLoteDialogo
        origem={movimento?.origem ?? null}
        destino={movimento?.destino ?? null}
        aberto={movimento !== null}
        aoFechar={() => setMovimento(null)}
        aoConcluir={() => { setMovimento(null); void qc.invalidateQueries({ queryKey: ["mapa", "operacional"] }); }}
      />
    </div>
  );
}
