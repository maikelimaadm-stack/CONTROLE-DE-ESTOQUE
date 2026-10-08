"use client";
import * as React from "react";
import { Button, NativeSelect } from "@/components/ui";
import { dateBR } from "@/lib/utils";
import { AVISO_RENDER_SUAVIZADO, ROTULO_RENDER, type RenderRaster } from "./camada-rasters";
import type { ModoCor } from "./cor-por-area";
import { dataDoSeletor, valorDoSeletorDeData, type DataDaCamada, type OpcaoDeData } from "./data-camada";
import { SeletorDeBase, type MapaBase } from "./mapa-base";
import { FAMILIAS_CAMADA, familiaPorId, nomeDoIndice, type FamiliaCamada, type IdIndice } from "./paletas-indices";
import {
  VISUALIZACOES_MAPA_PASTO,
  ehTemaAnalitico,
  type ModoMapaPasto,
  type TemaMapaPasto,
  type VisualizacaoMapaPasto
} from "./temas-mapa-pasto";

export type { ModoCor };
/** @deprecated use ModoMapaPasto — mantido para testes legados. */
export type ExperienciaMapa = "condicao" | "tecnico";

function Grupo({ rotulo, children, testId }: { rotulo: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</span>
      {children}
    </div>
  );
}

function Segmentado<T extends string>({ rotulo, valor, opcoes, onTrocar, prefixoTestId, desabilitado }: {
  rotulo: string;
  valor: T;
  opcoes: readonly { valor: T; rotulo: string; desabilitado?: boolean; dica?: string }[];
  onTrocar: (v: T) => void;
  prefixoTestId: string;
  desabilitado?: boolean;
}) {
  return (
    <div
      className="flex max-w-full overflow-x-auto overflow-y-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={rotulo}
    >
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          disabled={desabilitado || o.desabilitado}
          title={o.dica}
          aria-selected={valor === o.valor}
          aria-pressed={valor === o.valor}
          onClick={() => onTrocar(o.valor)}
          data-testid={`${prefixoTestId}-${o.valor}`}
          className={`min-h-11 shrink-0 px-2.5 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1 ${valor === o.valor ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export interface BarraCamadasProps {
  mapa: MapaBase;
  comSatelite: boolean;
  modo: ModoMapaPasto;
  onModo: (m: ModoMapaPasto) => void;
  /** Visualização: Só áreas ou um tema analítico. */
  visualizacao: VisualizacaoMapaPasto;
  onVisualizacao: (v: VisualizacaoMapaPasto) => void;
  /** Tema analítico (quando visualizacao ≠ areas). */
  tema: TemaMapaPasto;
  onTema: (t: TemaMapaPasto) => void;
  experiencia?: ExperienciaMapa;
  onExperiencia?: (e: ExperienciaMapa) => void;
  familia: FamiliaCamada;
  onFamilia: (f: FamiliaCamada) => void;
  indice: IdIndice;
  onIndice: (i: IdIndice) => void;
  modoCor: ModoCor;
  onModoCor: (m: ModoCor) => void;
  render: RenderRaster;
  onRender: (r: RenderRaster) => void;
  opacidade: number;
  onOpacidade: (v: number) => void;
  data: DataDaCamada;
  onData: (d: DataDaCamada) => void;
  opcoesData: readonly OpcaoDeData[];
  dataImagem: string | null;
  podeConsultar: boolean;
  onNovaConsulta: () => void;
  carregandoTema?: boolean;
  onAbrirLista?: () => void;
  listaAberta?: boolean;
}

/**
 * Toolbar: Visualização · Data · Analisar áreas · Mais opções (Base + Dados técnicos).
 * Áreas (lista) fica acessível mesmo sem capacidade satélite.
 */
export function BarraCamadas(p: BarraCamadasProps) {
  const modo = p.modo ?? (p.experiencia === "tecnico" ? "tecnico" : "operacional");
  const familia = familiaPorId(p.familia);
  const rasterAtivo = modo === "tecnico" && p.modoCor === "pixel";
  /** Painel secundário aberto: Mais opções OU dados técnicos ativos. */
  const [maisOpcoes, setMaisOpcoes] = React.useState(false);
  const painelSecundarioAberto = maisOpcoes || modo === "tecnico";

  const setModo = (m: ModoMapaPasto) => {
    p.onModo(m);
    p.onExperiencia?.(m === "tecnico" ? "tecnico" : "condicao");
  };

  const setVisualizacao = (v: VisualizacaoMapaPasto) => {
    p.onVisualizacao(v);
    if (ehTemaAnalitico(v)) p.onTema(v);
    if (modo === "tecnico") setModo("operacional");
  };

  const toggleMaisOpcoes = () => {
    if (modo === "tecnico") {
      // Fechar dados técnicos volta ao operacional e recolhe o painel.
      setModo("operacional");
      setMaisOpcoes(false);
      return;
    }
    setMaisOpcoes((v) => !v);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3 py-2" data-testid="mapa-barra-camadas">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {p.comSatelite && (
          <>
            <Grupo rotulo="Visualização" testId="mapa-grupo-tema">
              {/* Mobile/tablet: seletor compacto; desktop: segmentos. */}
              <NativeSelect
                aria-label="Visualização do mapa"
                value={p.visualizacao}
                onChange={(e) => setVisualizacao(e.target.value as VisualizacaoMapaPasto)}
                data-testid="mapa-tema-select"
                className="h-11 min-w-[10rem] text-xs md:hidden"
              >
                {VISUALIZACOES_MAPA_PASTO.map((t) => (
                  <option key={t.id} value={t.id}>{t.rotulo}</option>
                ))}
              </NativeSelect>
              <div className="hidden md:block">
                <Segmentado<VisualizacaoMapaPasto>
                  rotulo="Visualização do mapa"
                  valor={p.visualizacao}
                  opcoes={VISUALIZACOES_MAPA_PASTO.map((t) => ({ valor: t.id, rotulo: t.rotulo }))}
                  onTrocar={setVisualizacao}
                  prefixoTestId="mapa-tema"
                />
              </div>
              {p.carregandoTema && ehTemaAnalitico(p.visualizacao) && (
                <span className="text-[10px] text-slate-500" data-testid="mapa-tema-carregando">
                  Carregando visualização…
                </span>
              )}
            </Grupo>

            {ehTemaAnalitico(p.visualizacao) && (
              <Grupo rotulo="Data" testId="mapa-grupo-data">
                <NativeSelect
                  aria-label="Data da observação"
                  value={valorDoSeletorDeData(p.data)}
                  onChange={(e) => p.onData(dataDoSeletor(e.target.value))}
                  data-testid="mapa-data-camada"
                  className="h-11 min-w-[10rem] text-xs sm:h-8"
                >
                  {p.opcoesData.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                  ))}
                </NativeSelect>
                {p.dataImagem && (
                  <span className="text-[10px] text-slate-500" data-testid="mapa-data-imagem">
                    {dateBR(p.dataImagem)}
                  </span>
                )}
              </Grupo>
            )}
          </>
        )}

        <Grupo rotulo="Ações" testId="mapa-grupo-acao">
          <div className="flex flex-wrap gap-1.5" data-testid="mapa-grupo-acoes">
            {p.onAbrirLista && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-0 lg:hidden"
                aria-pressed={p.listaAberta}
                onClick={p.onAbrirLista}
                data-testid="mapa-abrir-lista"
              >
                Áreas
              </Button>
            )}
            {p.comSatelite && (
              <Button
                type="button"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={!p.podeConsultar}
                onClick={p.onNovaConsulta}
                data-testid="mapa-nova-consulta"
              >
                Analisar áreas
              </Button>
            )}
            {(p.comSatelite || p.mapa.pronto) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-0"
                aria-expanded={painelSecundarioAberto}
                onClick={toggleMaisOpcoes}
                data-testid="mapa-mais-opcoes"
              >
                Mais opções
              </Button>
            )}
          </div>
        </Grupo>
      </div>

      {painelSecundarioAberto && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-2" data-testid="mapa-mais-opcoes-painel">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {p.mapa.pronto && (
              <Grupo rotulo="Base" testId="mapa-grupo-base">
                <SeletorDeBase mapa={p.mapa} aviso="Sem imagem de satélite (configure a chave do Google)." />
              </Grupo>
            )}
            {p.comSatelite && (
              <Grupo rotulo="Modo" testId="mapa-grupo-modo-tecnico">
                <Button
                  type="button"
                  size="sm"
                  variant={modo === "tecnico" ? "default" : "outline"}
                  className="min-h-11 sm:min-h-0"
                  aria-pressed={modo === "tecnico"}
                  onClick={() => {
                    if (modo === "tecnico") {
                      setModo("operacional");
                    } else {
                      setModo("tecnico");
                      setMaisOpcoes(true);
                    }
                  }}
                  data-testid="mapa-dados-tecnicos"
                >
                  Dados técnicos
                </Button>
              </Grupo>
            )}
          </div>

          {p.comSatelite && modo === "tecnico" && (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2" data-testid="mapa-barra-tecnica">
              <Grupo rotulo="Camada" testId="mapa-grupo-camada">
                <Segmentado<FamiliaCamada>
                  rotulo="Camada"
                  valor={p.familia}
                  opcoes={FAMILIAS_CAMADA.map((f) => ({ valor: f.id, rotulo: f.rotulo, dica: f.pergunta }))}
                  onTrocar={p.onFamilia}
                  prefixoTestId="mapa-camada"
                />
              </Grupo>
              <Grupo rotulo="Índice" testId="mapa-grupo-indice">
                <Segmentado<IdIndice>
                  rotulo="Índice"
                  valor={p.indice}
                  opcoes={familia.indices.map((i) => ({ valor: i, rotulo: nomeDoIndice(i) }))}
                  onTrocar={p.onIndice}
                  prefixoTestId="mapa-indice"
                />
              </Grupo>
              <Grupo rotulo="Cor" testId="mapa-grupo-cor">
                <Segmentado<ModoCor>
                  rotulo="Cor"
                  valor={p.modoCor}
                  opcoes={[
                    { valor: "pixel", rotulo: "Por pixel" },
                    { valor: "area", rotulo: "Por área" },
                    { valor: "cadastro", rotulo: "Cadastro" }
                  ]}
                  onTrocar={p.onModoCor}
                  prefixoTestId="mapa-cor"
                />
              </Grupo>
              <Grupo rotulo="Render" testId="mapa-grupo-render">
                <Segmentado<RenderRaster>
                  rotulo="Render"
                  valor={p.render}
                  opcoes={[
                    { valor: "nearest", rotulo: ROTULO_RENDER.nearest },
                    { valor: "linear", rotulo: ROTULO_RENDER.linear, dica: AVISO_RENDER_SUAVIZADO }
                  ]}
                  onTrocar={p.onRender}
                  prefixoTestId="mapa-render"
                  desabilitado={!rasterAtivo}
                />
              </Grupo>
              <Grupo rotulo="Opacidade" testId="mapa-grupo-opacidade">
                <label className="flex h-11 items-center gap-2 text-xs tabular-nums text-slate-600 sm:h-[26px]">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={Math.round(p.opacidade * 100)}
                    disabled={!rasterAtivo}
                    onChange={(e) => p.onOpacidade(Number(e.target.value) / 100)}
                    aria-label="Opacidade da imagem de satélite"
                    className="w-24 accent-slate-700"
                    data-testid="mapa-opacidade"
                  />
                  <span className="w-9 text-right" data-testid="mapa-opacidade-valor">
                    {Math.round(p.opacidade * 100)}%
                  </span>
                </label>
              </Grupo>
              {p.render === "linear" && rasterAtivo && (
                <p className="basis-full text-[11px] leading-tight text-amber-700" role="note" data-testid="mapa-render-aviso">
                  {AVISO_RENDER_SUAVIZADO}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
