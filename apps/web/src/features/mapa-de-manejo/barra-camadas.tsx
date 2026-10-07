"use client";
import * as React from "react";
import { Button, NativeSelect } from "@/components/ui";
import { dateBR } from "@/lib/utils";
import { AVISO_RENDER_SUAVIZADO, ROTULO_RENDER, type RenderRaster } from "./camada-rasters";
import type { ModoCor } from "./cor-por-area";
import { dataDoSeletor, valorDoSeletorDeData, type DataDaCamada, type OpcaoDeData } from "./data-camada";
import { SeletorDeBase, type MapaBase } from "./mapa-base";
import { FAMILIAS_CAMADA, familiaPorId, nomeDoIndice, type FamiliaCamada, type IdIndice } from "./paletas-indices";
import { TEMAS_MAPA_PASTO, type ModoMapaPasto, type TemaMapaPasto } from "./temas-mapa-pasto";

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
      className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm"
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
          className={`px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${valor === o.valor ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}
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
  /** Modo operacional (temas) vs dados técnicos. */
  modo: ModoMapaPasto;
  onModo: (m: ModoMapaPasto) => void;
  tema: TemaMapaPasto;
  onTema: (t: TemaMapaPasto) => void;
  /** Compat legado — espelha modo. */
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
}

/**
 * Toolbar operacional SAT-BUNDLE-01B:
 * Base · [Condição|Umidade|Vigor|Cobertura|Solo] · Data · Dados técnicos · Analisar pastos
 */
export function BarraCamadas(p: BarraCamadasProps) {
  const modo = p.modo ?? (p.experiencia === "tecnico" ? "tecnico" : "operacional");
  const familia = familiaPorId(p.familia);
  const rasterAtivo = modo === "tecnico" && p.modoCor === "pixel";

  const setModo = (m: ModoMapaPasto) => {
    p.onModo(m);
    p.onExperiencia?.(m === "tecnico" ? "tecnico" : "condicao");
  };

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white px-3 py-2" data-testid="mapa-barra-camadas">
      {p.mapa.pronto && (
        <Grupo rotulo="Base" testId="mapa-grupo-base">
          <SeletorDeBase mapa={p.mapa} aviso="Sem imagem de satélite (configure a chave do Google)." />
        </Grupo>
      )}

      {p.comSatelite && (
        <>
          {modo === "operacional" && (
            <Grupo rotulo="Visualização" testId="mapa-grupo-tema">
              <Segmentado<TemaMapaPasto>
                rotulo="Tema do mapa"
                valor={p.tema}
                opcoes={TEMAS_MAPA_PASTO.map((t) => ({ valor: t.id, rotulo: t.rotulo, dica: t.linguagem }))}
                onTrocar={p.onTema}
                prefixoTestId="mapa-tema"
              />
              {p.carregandoTema && (
                <span className="text-[10px] text-slate-500" data-testid="mapa-tema-carregando">
                  Carregando visualização de {TEMAS_MAPA_PASTO.find((t) => t.id === p.tema)?.rotulo ?? "tema"}…
                </span>
              )}
            </Grupo>
          )}

          {modo === "tecnico" && (
            <>
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
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={p.opacidade}
                    disabled={!rasterAtivo}
                    onChange={(e) => p.onOpacidade(Number(e.target.value))}
                    data-testid="mapa-opacidade"
                    className="w-24"
                  />
                  <span className="text-[10px] tabular-nums text-slate-500">{Math.round(p.opacidade * 100)}%</span>
                </div>
              </Grupo>
            </>
          )}

          <Grupo rotulo="Data" testId="mapa-grupo-data">
            <NativeSelect
              aria-label="Data da observação"
              value={valorDoSeletorDeData(p.data)}
              onChange={(e) => p.onData(dataDoSeletor(e.target.value))}
              data-testid="mapa-data-camada"
              className="h-8 min-w-[10rem] text-xs"
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

          <Grupo rotulo="Ações" testId="mapa-grupo-acao">
            <div className="flex gap-1.5" data-testid="mapa-grupo-acoes">
              <Button
                type="button"
                size="sm"
                variant={modo === "tecnico" ? "default" : "outline"}
                aria-pressed={modo === "tecnico"}
                onClick={() => setModo(modo === "tecnico" ? "operacional" : "tecnico")}
                data-testid="mapa-dados-tecnicos"
              >
                Dados técnicos
              </Button>
              {/* Compat E2E legado: experiência binária ↔ modo operacional/técnico. */}
              <span className="sr-only">
                <button
                  type="button"
                  data-testid="mapa-experiencia-condicao"
                  aria-pressed={modo === "operacional"}
                  tabIndex={-1}
                  onClick={() => setModo("operacional")}
                />
                <button
                  type="button"
                  data-testid="mapa-experiencia-tecnico"
                  aria-pressed={modo === "tecnico"}
                  tabIndex={-1}
                  onClick={() => setModo("tecnico")}
                />
              </span>
              <Button
                type="button"
                size="sm"
                disabled={!p.podeConsultar}
                onClick={p.onNovaConsulta}
                data-testid="mapa-nova-consulta"
              >
                Analisar pastos
              </Button>
            </div>
          </Grupo>
        </>
      )}
    </div>
  );
}
