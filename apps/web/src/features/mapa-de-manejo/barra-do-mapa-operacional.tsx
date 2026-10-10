"use client";
import * as React from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LocateFixed } from "lucide-react";
import { Button, NativeSelect } from "@/components/ui";
import { cn } from "@/lib/utils";
import { mostrarGrupo } from "./camada-lotes";
import { SeletorDeBase, type MapaBase } from "./mapa-base";
import type { FiltrosDoMapa } from "./operacional-dados";
import { useOpcoesDeFiltro, type OpcaoDeFiltro } from "./use-filtros-do-mapa";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 3: a BARRA DE CONTROLES do mapa operacional.
 *
 *   Mapa / Satélite ...... o `SeletorDeBase` de mapa-base.tsx (reusado, não mudado)
 *   Lotes · Objetos de mapa · Rótulos ... liga e desliga camadas (botões com `aria-pressed`)
 *   Retiro · Módulo de pastejo ......... os filtros que `GET /api/mapa/operacional` aceita (`retiro_id`,
 *                                        `grazing_module_id`); "Todos" = `null`
 *   Minha localização .... ATALHO para o `GeolocateControl` que mapa-base.tsx já pôs no canto do mapa: aciona aquele
 *                          botão (mesma permissão, mesmo acompanhamento, mesmo aviso de precisão); nenhum segundo
 *                          controle de localização é criado
 *   children ............. à direita: o seletor de coloração e o interruptor de arraste
 *
 * A barra não guarda estado: filtros e camadas são da tela, que põe em estado; mudar um filtro chama `aoMudarFiltros`
 * UMA vez, com o objeto novo inteiro, e a tela refaz UMA chamada à rota. A barra quebra linha em tela estreita
 * (flex-wrap), sem largura fixa.
 */

/** Camadas que a pessoa liga e desliga. Lotes e objetos são camadas do MapLibre; os rótulos são DOM (CamadaDesenho). */
export interface CamadasVisiveis {
  lotes: boolean;
  objetos: boolean;
  rotulos: boolean;
}

/** Tudo ligado ao abrir a tela. */
export const CAMADAS_INICIAIS: CamadasVisiveis = { lotes: true, objetos: true, rotulos: true };

/**
 * Aplica no mapa a visibilidade de lotes e objetos (visibilidade de layout: fonte e dados ficam, nada é recriado).
 * Só depois de `mapa.pronto`. Os rótulos não passam por aqui: são DOM, e a tela simplesmente não os entrega ao
 * `CamadaDesenho` quando estão desligados.
 */
export function aplicarCamadasVisiveis(m: MapLibreMap, camadas: CamadasVisiveis): void {
  mostrarGrupo(m, "lotes", camadas.lotes);
  mostrarGrupo(m, "objetos", camadas.objetos);
}

/**
 * Alvo de toque de 44 px em tela estreita; de `sm` para cima, o tamanho compacto da casa. Com `!` (importante): o
 * Button e o NativeSelect da casa recebem altura e altura mínima de classes próprias de globals.css (a do botão e a
 * do campo), que ficam FORA das camadas do Tailwind e por isso vencem qualquer utilitário comum — um `min-h-11` sem
 * `!` não teria efeito nesses dois. Altura mínima maior que a altura: vale a mínima.
 */
const ALVO_DE_TOQUE = "!min-h-11 sm:!min-h-0";

/**
 * O `SeletorDeBase` (compartilhado com o /mapa-geral e a ficha da área) não é mudado aqui: os botões dele, `<button>`
 * só com utilitários, ganham os mesmos 44 px por este contêiner.
 */
const ALVO_DE_TOQUE_DO_SELETOR_DE_BASE = "[&_button]:min-h-11 sm:[&_button]:min-h-0";

/**
 * "Minha localização": aciona o botão do `GeolocateControl` que já está no mapa (classe pública do MapLibre). Devolve
 * se acionou — `false` quando o controle ainda não está no mapa ou o navegador não oferece localização (o MapLibre
 * desabilita o próprio botão nesse caso).
 */
export function acionarMinhaLocalizacao(container: HTMLElement | null): boolean {
  const botao = container?.querySelector<HTMLButtonElement>("button.maplibregl-ctrl-geolocate");
  if (!botao || botao.disabled) return false;
  botao.click();
  return true;
}

function AlternadorDeCamada({ rotulo, ligado, aoAlternar, testId }: { rotulo: string; ligado: boolean; aoAlternar: () => void; testId: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={ligado ? "default" : "outline"}
      aria-pressed={ligado}
      onClick={aoAlternar}
      data-testid={testId}
      className={ALVO_DE_TOQUE}
    >
      {rotulo}
    </Button>
  );
}

/**
 * Select de um filtro de cadastro. Some quando as opções não estão disponíveis (sem permissão, recusa, erro) ou
 * quando o cadastro está vazio e nada está escolhido. Um id escolhido que não está na lista continua visível como
 * "Selecionado (fora da lista)": o select nunca mostra "Todos" com um filtro aplicado.
 */
function FiltroDeCadastro({ rotulo, valor, opcoes, aoMudar, testId }: {
  rotulo: string;
  valor: string | null;
  opcoes: OpcaoDeFiltro[] | null;
  aoMudar: (id: string | null) => void;
  testId: string;
}) {
  const id = React.useId();
  if (!opcoes || (opcoes.length === 0 && valor === null)) return null;
  const foraDaLista = valor !== null && !opcoes.some((o) => o.id === valor) ? valor : null;
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <label htmlFor={id} className="whitespace-nowrap text-xs font-medium text-slate-600">{rotulo}</label>
      <NativeSelect
        id={id}
        value={valor ?? ""}
        onChange={(e) => aoMudar(e.target.value === "" ? null : e.target.value)}
        data-testid={testId}
        className={cn(ALVO_DE_TOQUE, "min-w-[8rem] max-w-[16rem]")}
      >
        <option value="">Todos</option>
        {foraDaLista !== null && <option value={foraDaLista}>Selecionado (fora da lista)</option>}
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>{o.rotulo}</option>
        ))}
      </NativeSelect>
    </div>
  );
}

export interface BarraDoMapaOperacionalProps {
  mapa: MapaBase;
  filtros: FiltrosDoMapa;
  /** Chamado uma vez por mudança, com o objeto de filtros novo inteiro (a coloração vem junto, intocada). */
  aoMudarFiltros: (filtros: FiltrosDoMapa) => void;
  camadas: CamadasVisiveis;
  aoMudarCamadas: (camadas: CamadasVisiveis) => void;
  /**
   * `false` quando a resposta diz que objetos de mapa não vieram (`capacidades.objetos`): o botão de objetos some,
   * porque não haveria o que ligar. Sem a prop, ele aparece.
   */
  objetosDisponiveis?: boolean;
  /** Encaixe à direita: o seletor de coloração e o interruptor de arraste. */
  children?: React.ReactNode;
}

export function BarraDoMapaOperacional({
  mapa,
  filtros,
  aoMudarFiltros,
  camadas,
  aoMudarCamadas,
  objetosDisponiveis = true,
  children
}: BarraDoMapaOperacionalProps) {
  const opcoes = useOpcoesDeFiltro();
  const alternar = (k: keyof CamadasVisiveis) => aoMudarCamadas({ ...camadas, [k]: !camadas[k] });
  const mudarFiltro = (campo: "retiro_id" | "grazing_module_id", id: string | null) => {
    if (filtros[campo] === id) return;
    aoMudarFiltros({ ...filtros, [campo]: id });
  };
  const temEncaixe = React.Children.toArray(children).length > 0;

  return (
    <div
      role="group"
      aria-label="Controles do mapa"
      data-testid="mapa-barra-operacional"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-slate-200 bg-white px-3 py-2"
    >
      <div className={ALVO_DE_TOQUE_DO_SELETOR_DE_BASE} data-testid="mapa-barra-base">
        <SeletorDeBase mapa={mapa} aviso="Sem imagem de satélite: configure a chave do Google Maps." />
      </div>

      <div role="group" aria-label="Camadas do mapa" className="flex flex-wrap items-center gap-1.5" data-testid="mapa-barra-camadas-visiveis">
        <AlternadorDeCamada rotulo="Lotes" ligado={camadas.lotes} aoAlternar={() => alternar("lotes")} testId="camada-lotes" />
        {objetosDisponiveis && (
          <AlternadorDeCamada rotulo="Objetos de mapa" ligado={camadas.objetos} aoAlternar={() => alternar("objetos")} testId="camada-objetos" />
        )}
        <AlternadorDeCamada rotulo="Rótulos" ligado={camadas.rotulos} aoAlternar={() => alternar("rotulos")} testId="camada-rotulos" />
      </div>

      <FiltroDeCadastro
        rotulo="Retiro"
        valor={filtros.retiro_id}
        opcoes={opcoes.retiros}
        aoMudar={(id) => mudarFiltro("retiro_id", id)}
        testId="filtro-retiro"
      />
      <FiltroDeCadastro
        rotulo="Módulo de pastejo"
        valor={filtros.grazing_module_id}
        opcoes={opcoes.modulos}
        aoMudar={(id) => mudarFiltro("grazing_module_id", id)}
        testId="filtro-modulo"
      />

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!mapa.pronto}
        onClick={() => { acionarMinhaLocalizacao(mapa.containerRef.current); }}
        title="Mostra a sua posição no mapa (o mesmo botão de localização do canto do mapa)"
        data-testid="mapa-minha-localizacao"
        className={ALVO_DE_TOQUE}
      >
        <LocateFixed aria-hidden />
        Minha localização
      </Button>

      {temEncaixe && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto" data-testid="mapa-barra-encaixe">
          {children}
        </div>
      )}
    </div>
  );
}
