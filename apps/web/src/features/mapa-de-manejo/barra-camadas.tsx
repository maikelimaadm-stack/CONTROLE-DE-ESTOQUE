"use client";
import * as React from "react";
import { Button, NativeSelect } from "@/components/ui";
import { dateBR } from "@/lib/utils";
import { AVISO_RENDER_SUAVIZADO, ROTULO_RENDER, type RenderRaster } from "./camada-rasters";
import type { ModoCor } from "./cor-por-area";
import { dataDoSeletor, valorDoSeletorDeData, type DataDaCamada, type OpcaoDeData } from "./data-camada";
import { SeletorDeBase, type MapaBase } from "./mapa-base";
import { FAMILIAS_CAMADA, familiaPorId, nomeDoIndice, type FamiliaCamada, type IdIndice } from "./paletas-indices";

export type { ModoCor };

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
    <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-xs shadow-sm" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          disabled={desabilitado || o.desabilitado}
          title={o.dica}
          aria-pressed={valor === o.valor}
          onClick={() => onTrocar(o.valor)}
          data-testid={`${prefixoTestId}-${o.valor}`}
          className={`px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50 ${valor === o.valor ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export interface BarraCamadasProps {
  mapa: MapaBase;
  /** Há satélite utilizável (permissão e rota da API)? Sem ele só a BASE aparece. */
  comSatelite: boolean;
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
  /** Data da camada: "Última imagem útil" ou um dia escolhido (nunca troca sozinha). */
  data: DataDaCamada;
  onData: (d: DataDaCamada) => void;
  /** "Última imagem útil" + as datas úteis do histórico da área aberta, para o índice ativo. */
  opcoesData: readonly OpcaoDeData[];
  /** Data das imagens carregadas (a mais recente), se houver — informativa, só na última imagem útil. */
  dataImagem: string | null;
  podeConsultar: boolean;
  onNovaConsulta: () => void;
}

/**
 * Barra de camadas do Mapa geral: BASE · VISUALIZAÇÃO · CAMADA · ÍNDICE · DATA · RENDER · OPACIDADE · AÇÃO.
 * A família escolhe a PERGUNTA (vigor, umidade, cobertura/solo); o índice é uma resposta dentro dela.
 */
export function BarraCamadas(p: BarraCamadasProps) {
  const familia = familiaPorId(p.familia);
  const rasterAtivo = p.modoCor === "pixel";
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white px-3 py-2" data-testid="mapa-barra-camadas">
      {p.mapa.pronto && (
        <Grupo rotulo="Base" testId="mapa-grupo-base">
          <SeletorDeBase mapa={p.mapa} aviso="Sem imagem de satélite (configure a chave do Google)." />
        </Grupo>
      )}

      {p.comSatelite && (
        <>
          <Grupo rotulo="Visualização" testId="mapa-grupo-visualizacao">
            <Segmentado<"condicao"> rotulo="Visualização" valor="condicao" opcoes={[{ valor: "condicao", rotulo: "Condição" }]} onTrocar={() => undefined} prefixoTestId="mapa-visualizacao" />
          </Grupo>

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

          <Grupo rotulo="Data" testId="mapa-grupo-data">
            <NativeSelect
              value={valorDoSeletorDeData(p.data)}
              onChange={(e) => p.onData(dataDoSeletor(e.target.value))}
              aria-label="Data da imagem"
              title={p.data.tipo === "ultima" ? "Mostra a imagem da última análise útil do contorno atual de cada área" : "Só as áreas com imagem gerada nesta data aparecem; nenhuma outra data é usada no lugar"}
              className="h-[26px] min-w-[11rem] py-0 text-xs"
              data-testid="mapa-data-camada"
            >
              {p.opcoesData.map((o) => <option key={o.valor} value={o.valor}>{o.valor === "ultima" && p.dataImagem ? `${o.rotulo} · ${dateBR(p.dataImagem)}` : o.rotulo}</option>)}
            </NativeSelect>
          </Grupo>

          <Grupo rotulo="Cor das áreas" testId="mapa-grupo-cor">
            <Segmentado<ModoCor>
              rotulo="Cor das áreas"
              valor={p.modoCor}
              opcoes={[
                { valor: "pixel", rotulo: "Por pixel" },
                { valor: "area", rotulo: "Por área", dica: `Cor da média do ${nomeDoIndice(p.indice)} de cada área, na paleta desse índice` },
                { valor: "cadastro", rotulo: "Cor do cadastro" }
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
                { valor: "linear", rotulo: ROTULO_RENDER.linear }
              ]}
              onTrocar={p.onRender}
              prefixoTestId="mapa-render"
              desabilitado={!rasterAtivo}
            />
          </Grupo>

          <Grupo rotulo="Opacidade" testId="mapa-grupo-opacidade">
            <label className="flex h-[26px] items-center gap-2 text-xs tabular-nums text-slate-600">
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
              <span className="w-9 text-right" data-testid="mapa-opacidade-valor">{Math.round(p.opacidade * 100)}%</span>
            </label>
          </Grupo>

          {p.podeConsultar && (
            <Grupo rotulo="Ação" testId="mapa-grupo-acao">
              <Button type="button" size="sm" variant="outline" onClick={p.onNovaConsulta} data-testid="mapa-nova-consulta">Nova consulta</Button>
            </Grupo>
          )}
        </>
      )}

      {p.comSatelite && p.render === "linear" && rasterAtivo && (
        <p className="basis-full text-[11px] leading-tight text-amber-700" role="note" data-testid="mapa-render-aviso">{AVISO_RENDER_SUAVIZADO}</p>
      )}
    </div>
  );
}
