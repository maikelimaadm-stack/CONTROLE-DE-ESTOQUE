"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CLASSES_NDVI_MAPA, RESUMO_ANALISE_SATELITAL_MAXIMO, classeNdvi, enumLabel, type ChaveClasseNdvi } from "@agro/domain";
import { api, ApiError, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { dateBR, dateTimeBR, num, pct } from "@/lib/utils";
import { PARADAS_NDVI_PIXEL } from "./paleta-ndvi-pixel";
import {
  desenharMiniaturaRaster,
  gerarRasterDaAnalise,
  mensagemDoErroDeRaster,
  type EntradaRasterEmMemoria
} from "./rasters-ndvi";

/**
 * MAPA GERAL (decisão 294) — o NDVI das áreas na tela: o resumo de TODAS as áreas numa chamada só, a escala fixa (as
 * classes moram no domínio; aqui só a COR de cada uma), a legenda, a atribuição exigida pelo Copernicus e o painel da
 * área com "Analisar agora" e o histórico. Quem decide acesso é o servidor: `can()` só esconde o que o usuário não
 * pode pedir. NDVI é vigor espectral — não é biomassa, oferta de forragem nem lotação.
 */

export const PERMISSAO_VER_NDVI = "analises_satelitais.view";
export const PERMISSAO_PEDIR_NDVI = "analises_satelitais.create";

/** Cor de cada classe da escala fixa (do vermelho ao verde escuro). A classe e o limite são do domínio. */
export const COR_CLASSE_NDVI: Readonly<Record<ChaveClasseNdvi, string>> = {
  sem_vegetacao: "#d73027",
  baixo: "#fc8d59",
  medio: "#d9ef8b",
  alto: "#1a9850"
};
/** Área sem observação útil (ou nunca analisada): cinza — nunca uma cor de classe inventada. */
export const COR_SEM_NDVI = "#94a3b8";

export const corDoNdvi = (valor: string | null | undefined) => {
  const c = classeNdvi(valor);
  return c ? COR_CLASSE_NDVI[c.chave] : COR_SEM_NDVI;
};

export interface ResumoNdviDaArea {
  area_id: string;
  ultima_execucao: { situacao: string; motivo_qualidade: string | null; criado_em: string };
  ultima_observacao: {
    observacao_inicio: string; observacao_fim: string | null; valor_medio: string; valor_minimo: string; valor_maximo: string;
    desvio_padrao: string; cobertura_valida: string; pixels_validos: number; do_poligono_atual: boolean; criado_em: string | null;
  } | null;
  observacao_anterior: { observacao_inicio: string; valor_medio: string } | null;
  variacao: string | null;
}

/**
 * O estado do NDVI para a tela inteira:
 * - `sem_permissao`: o usuário não tem `analises_satelitais.view` — nada é pedido, nada aparece;
 * - `indisponivel`: a API não tem a rota do resumo (a API anterior, na janela "web antes da API") — o mapa segue
 *   igual ao de antes, com um aviso discreto;
 * - `pronto`: o resumo por área (`temMais` quando o escopo passa do tamanho máximo da página).
 */
export type EstadoNdvi =
  | { situacao: "sem_permissao" }
  | { situacao: "carregando" }
  | { situacao: "indisponivel" }
  | { situacao: "erro"; erro: unknown; tentarDeNovo: () => void }
  | { situacao: "pronto"; porArea: ReadonlyMap<string, ResumoNdviDaArea>; temMais: boolean };

const CHAVE_NDVI = ["mapa-geral", "ndvi"] as const;

export function useResumoNdvi(): EstadoNdvi {
  const { can, session } = useAuth();
  const pode = can(PERMISSAO_VER_NDVI);
  const q = useQuery({
    queryKey: [...CHAVE_NDVI, "resumo", session?.empresaId ?? null],
    enabled: pode,
    retry: false,
    queryFn: async () => {
      try {
        return await api<{ itens: ResumoNdviDaArea[]; tem_mais: boolean }>(`/api/mapa/analises-satelitais/resumo${qs({ tamanho: RESUMO_ANALISE_SATELITAL_MAXIMO })}`);
      } catch (e) {
        // A rota não tem parâmetro de caminho: 404 aqui só pode ser a ROTA ausente (a API anterior a esta fatia).
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    }
  });
  const { data: dados, isLoading, error, refetch } = q;
  // Estado ESTÁVEL entre renderizações: o mapa redesenha a cada pan/zoom, e a cor das áreas só deve ser refeita
  // quando o resumo muda (senão a fonte do mapa seria reescrita a cada quadro).
  return React.useMemo<EstadoNdvi>(() => {
    if (!pode) return { situacao: "sem_permissao" };
    if (isLoading) return { situacao: "carregando" };
    // Um refetch que falha (rede caiu, aba voltou ao foco) não apaga o que já estava na tela: com dado em cache, ele
    // continua valendo; o erro só aparece quando não há resumo nenhum.
    if (dados === undefined) return error ? { situacao: "erro", erro: error, tentarDeNovo: () => void refetch() } : { situacao: "carregando" };
    if (dados === null) return { situacao: "indisponivel" };
    return { situacao: "pronto", porArea: new Map(dados.itens.map((i) => [i.area_id, i])), temMais: dados.tem_mais };
  }, [pode, isLoading, error, dados, refetch]);
}

interface ItemHistorico { id: string; observacao_inicio: string; valor_medio: string; cobertura_valida: string; do_poligono_atual: boolean }
/** Quantas imagens o histórico do painel mostra (a rota pagina no servidor; aqui só a primeira página). */
const LIMITE_HISTORICO_PAINEL = 12;

function useHistoricoNdvi(areaId: string, ativo: boolean) {
  return useQuery({
    queryKey: [...CHAVE_NDVI, "historico", areaId],
    enabled: ativo,
    queryFn: () => api<{ itens: ItemHistorico[]; proximo_cursor: string | null }>(`/api/mapa/areas/${areaId}/analises-satelitais${qs({ limite: LIMITE_HISTORICO_PAINEL })}`)
  });
}

/** O motivo do 503 vem em `details.motivo` (SAT-01): `desligada` (COPERNICUS_ENABLED) ou `configuracao` (sem credencial). */
export function mensagemDaRecusa(e: unknown): string {
  if (e instanceof ApiError && e.status === 503 && (e.details as { motivo?: unknown } | undefined)?.motivo === "configuracao") {
    return "A análise por satélite está ligada, mas a credencial do Copernicus não está configurada no servidor da API.";
  }
  return e instanceof Error ? e.message : "Não foi possível pedir a análise.";
}

interface RespostaAnalise { analise: { situacao: string; motivo_qualidade: string | null; valor_medio: string | null; observacao_inicio: string | null }; reutilizada: boolean }

/**
 * Os anos da imagem para a atribuição exigida pela licença do Copernicus ("Contains modified Copernicus Sentinel
 * data [ano]"): os anos das observações que a tela mostra, nunca o ano de hoje inventado.
 */
export function anosDasImagens(datas: readonly (string | null | undefined)[]): string | null {
  const anos = [...new Set(datas.flatMap((d) => (d && /^\d{4}/.test(d) ? [Number(d.slice(0, 4))] : [])))].sort((a, b) => a - b);
  if (anos.length === 0) return null;
  return anos.length === 1 ? String(anos[0]) : `${anos[0]}–${anos[anos.length - 1]}`;
}

export function AtribuicaoCopernicus({ anos, className, testId = "mapa-atribuicao-copernicus" }: { anos: string | null; className?: string; testId?: string }) {
  if (!anos) return null;
  return <p className={`text-[10px] leading-tight text-slate-500 ${className ?? ""}`} data-testid={testId}>Contains modified Copernicus Sentinel data {anos}</p>;
}

/**
 * Legenda FIXA (a mesma em qualquer data e área) e o lembrete de que NDVI não é biomassa.
 * No modo por pixel vira uma barra de gradiente com os valores das paradas; no modo por área
 * continua a lista de classes. A atribuição do Copernicus NÃO mora aqui — uma só no mapa.
 */
export function LegendaNdvi({ modo = "area", realceInterno = false }: { modo?: "pixel" | "area"; realceInterno?: boolean }) {
  const aviso = "NDVI mede o vigor da vegetação. Não é biomassa, oferta de forragem nem lotação.";
  if (modo === "pixel") {
    const gradiente = `linear-gradient(90deg, ${PARADAS_NDVI_PIXEL.map((p, i) => {
      const t = (i / (PARADAS_NDVI_PIXEL.length - 1)) * 100;
      return `rgb(${p.r} ${p.g} ${p.b}) ${t}%`;
    }).join(", ")})`;
    return (
      <div className="pointer-events-auto rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm" data-testid="mapa-legenda-ndvi">
        <div className="mb-1 font-semibold text-slate-700">NDVI por pixel</div>
        <div className="h-3 w-full rounded-sm border border-slate-300" style={{ background: gradiente }} data-testid="mapa-legenda-gradiente" aria-hidden />
        <div className="mt-0.5 flex justify-between tabular-nums text-[10px] text-slate-600" data-testid="mapa-legenda-marcas">
          {PARADAS_NDVI_PIXEL.map((p) => <span key={p.ndvi}>{num(p.ndvi, 2)}</span>)}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-3 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: COR_SEM_NDVI }} aria-hidden />
          <span className="text-slate-700">Sem imagem útil ou sem análise</span>
        </div>
        {realceInterno && (
          <p className="mt-1 max-w-[16rem] text-[10px] leading-tight text-amber-700" data-testid="mapa-legenda-relativa">
            Cores relativas a esta área nesta data (realce interno ligado).
          </p>
        )}
        <p className="mt-1 max-w-[16rem] text-[10px] leading-tight text-slate-500">{aviso}</p>
      </div>
    );
  }
  return (
    <div className="pointer-events-auto rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm" data-testid="mapa-legenda-ndvi">
      <div className="mb-1 font-semibold text-slate-700">NDVI médio da última imagem útil</div>
      <ul className="flex flex-col gap-0.5">
        {[...CLASSES_NDVI_MAPA].reverse().map((c) => (
          <li key={c.chave} className="flex items-center gap-2" data-testid="mapa-legenda-classe">
            <span className="h-3 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: COR_CLASSE_NDVI[c.chave] }} aria-hidden />
            <span className="text-slate-700">{c.rotulo}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: COR_SEM_NDVI }} aria-hidden />
          <span className="text-slate-700">Sem imagem útil ou sem análise</span>
        </li>
      </ul>
      <p className="mt-1 max-w-[16rem] text-[10px] leading-tight text-slate-500">{aviso}</p>
    </div>
  );
}

/** Sinal e duas casas: "+0,14" / "−0,05" / "0,00". */
function variacaoComSinal(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const texto = num(Math.abs(n), 2);
  return n > 0 ? `+${texto}` : n < 0 ? `−${texto}` : texto;
}

/** Linha do tempo do NDVI médio na escala FIXA [0, 1] (as linhas finas são os limites das classes). */
function Linha({ itens }: { itens: readonly ItemHistorico[] }) {
  const pontos = [...itens].sort((a, b) => a.observacao_inicio.localeCompare(b.observacao_inicio));
  if (pontos.length < 2) return null;
  const L = 260, A = 48, M = 4;
  const x = (i: number) => M + (i * (L - 2 * M)) / (pontos.length - 1);
  const y = (v: string) => { const n = Math.min(1, Math.max(0, Number(v))); return A - M - n * (A - 2 * M); };
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-12 w-full" role="img" aria-label="NDVI médio por imagem, da mais antiga para a mais recente" data-testid="mapa-ndvi-linha">
      {CLASSES_NDVI_MAPA.filter((c) => c.minimo > 0).map((c) => <line key={c.chave} x1={M} x2={L - M} y1={y(String(c.minimo))} y2={y(String(c.minimo))} stroke="#e2e8f0" strokeWidth={1} />)}
      <polyline fill="none" stroke="#475569" strokeWidth={1.5} points={pontos.map((p, i) => `${x(i)},${y(p.valor_medio)}`).join(" ")} />
      {pontos.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.valor_medio)} r={2.5} fill={corDoNdvi(p.valor_medio)} stroke="#334155" strokeWidth={0.5} />)}
    </svg>
  );
}

function Historico({ areaId }: { areaId: string }) {
  const h = useHistoricoNdvi(areaId, true);
  if (h.isLoading) return <p className="text-xs text-slate-500">Carregando o histórico…</p>;
  if (h.error) return <p className="text-xs text-red-600">{h.error instanceof Error ? h.error.message : "Não foi possível carregar o histórico."}</p>;
  const itens = h.data?.itens ?? [];
  if (itens.length === 0) return <p className="text-xs text-slate-500">Nenhuma imagem útil registrada.</p>;
  return (
    <div className="flex flex-col gap-1" data-testid="mapa-ndvi-historico">
      <Linha itens={itens} />
      <ul className="max-h-36 overflow-auto text-xs tabular-nums">
        {itens.map((i) => (
          <li key={i.id} className="flex items-center gap-2 py-0.5" data-testid="mapa-ndvi-historico-item">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: corDoNdvi(i.valor_medio) }} aria-hidden />
            <span className="text-slate-600">{dateBR(i.observacao_inicio)}</span>
            <span className="ml-auto font-medium text-slate-800">{num(i.valor_medio, 2)}</span>
            <span className="w-12 text-right text-slate-500">{pct(Number(i.cobertura_valida) * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniaturaRaster({ entrada }: { entrada: EntradaRasterEmMemoria }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    if (!ref.current || !entrada.canvas.width) return;
    desenharMiniaturaRaster(entrada.canvas, ref.current, 168);
  }, [entrada]);
  return (
    <canvas
      ref={ref}
      className="mt-1 max-w-full rounded border border-slate-200 bg-transparent"
      data-testid="mapa-ndvi-miniatura"
      aria-label="Miniatura do NDVI por pixel desta área"
    />
  );
}

/**
 * O bloco "Satélite (NDVI)" do painel da área clicada: números, histórico, "Analisar agora",
 * miniatura do raster (SAT-07) e "Gerar imagem" deliberado (consome crédito).
 */
export function NdviDaArea({
  areaId,
  estado,
  temContorno,
  raster,
  onRasterGerado
}: {
  areaId: string;
  estado: EstadoNdvi;
  temContorno: boolean;
  raster?: EntradaRasterEmMemoria | null;
  onRasterGerado?: (dto: import("./rasters-ndvi").RasterNdviDto) => Promise<void> | void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [verHistorico, setVerHistorico] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [confirmandoGerar, setConfirmandoGerar] = React.useState(false);
  React.useEffect(() => { setVerHistorico(false); setAviso(null); setConfirmandoGerar(false); }, [areaId]);
  const analisar = useMutation({
    mutationFn: () => api<RespostaAnalise>(`/api/mapa/areas/${areaId}/analises-satelitais/ndvi`, { method: "POST", body: {} }),
    onSuccess: async (r) => {
      const a = r.analise;
      setAviso({
        tom: "ok",
        texto: r.reutilizada
          ? "Esta área já foi analisada hoje com este contorno: vale a análise registrada."
          : a.situacao === "concluida"
            ? `Análise registrada: NDVI ${num(a.valor_medio, 2)} na imagem de ${dateBR(a.observacao_inicio)}.`
            : `Sem imagem útil nos últimos dias: ${enumLabel("analise_satelital_motivo", a.motivo_qualidade)}.`
      });
      await qc.invalidateQueries({ queryKey: CHAVE_NDVI });
    },
    onError: (e) => setAviso({ tom: "erro", texto: mensagemDaRecusa(e) })
  });

  // `analise_id` para gerar imagem: só quando o painel está aberto e ainda não há raster (nunca ao abrir a tela).
  const precisaAnaliseId = Boolean(temContorno && !raster?.blobUrl && can(PERMISSAO_PEDIR_NDVI) && estado.situacao === "pronto" && estado.porArea.get(areaId)?.ultima_observacao);
  const ultima = useQuery({
    queryKey: [...CHAVE_NDVI, "ultima-para-raster", areaId],
    enabled: precisaAnaliseId,
    queryFn: () => api<{ ultima_observacao_util: { id: string } | null }>(`/api/mapa/areas/${areaId}/analises-satelitais/ultima${qs({ indice: "ndvi" })}`)
  });
  const analiseIdParaRaster = ultima.data?.ultima_observacao_util?.id ?? null;

  const gerar = useMutation({
    mutationFn: async () => {
      if (!analiseIdParaRaster) throw new Error("Não há análise útil para gerar a imagem.");
      return gerarRasterDaAnalise(analiseIdParaRaster);
    },
    onSuccess: async (r) => {
      setConfirmandoGerar(false);
      setAviso({
        tom: "ok",
        texto: r.reutilizada
          ? "A imagem já existia: não houve custo adicional."
          : "Imagem gerada. O mapa será atualizado com o gradiente por pixel."
      });
      await onRasterGerado?.(r.raster);
    },
    onError: (e) => {
      setConfirmandoGerar(false);
      if (e instanceof ApiError && e.status === 403) {
        setAviso(null);
        return;
      }
      setAviso({ tom: "erro", texto: mensagemDoErroDeRaster(e) });
    }
  });

  if (estado.situacao === "sem_permissao") return null;
  const cabecalho = <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Satélite (NDVI)</div>;
  if (estado.situacao === "carregando") return <div className="mt-2 border-t border-slate-100 pt-2">{cabecalho}<p className="text-xs text-slate-500">Carregando…</p></div>;
  if (estado.situacao === "indisponivel") {
    return <div className="mt-2 border-t border-slate-100 pt-2">{cabecalho}<p className="text-xs text-slate-500" data-testid="mapa-ndvi-indisponivel-area">A análise por satélite ainda não está disponível neste servidor.</p></div>;
  }
  if (estado.situacao === "erro") {
    return <div className="mt-2 border-t border-slate-100 pt-2">{cabecalho}<p className="text-xs text-red-600">Não foi possível carregar o NDVI das áreas.</p></div>;
  }
  const item = estado.porArea.get(areaId) ?? null;
  const obs = item?.ultima_observacao ?? null;
  const classe = obs ? classeNdvi(obs.valor_medio) : null;
  const execucaoSemImagem = item && item.ultima_execucao.situacao === "sem_observacao_util" && (!obs || (obs.criado_em ?? "") < item.ultima_execucao.criado_em)
    ? item.ultima_execucao : null;
  const podePedir = can(PERMISSAO_PEDIR_NDVI) && temContorno;
  const podeGerarImagem = podePedir && Boolean(obs) && !raster?.blobUrl && Boolean(analiseIdParaRaster);
  const rasterOk = raster && raster.blobUrl && !raster.erro ? raster : null;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2" data-testid="mapa-ndvi-area">
      {cabecalho}
      {obs ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums text-slate-800" data-testid="mapa-ndvi-valor">{num(obs.valor_medio, 2)}</span>
            {classe && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-600" data-testid="mapa-ndvi-classe">
                <span className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ backgroundColor: COR_CLASSE_NDVI[classe.chave] }} aria-hidden />{classe.rotulo}
              </span>
            )}
          </div>
          <div className="text-xs tabular-nums text-slate-600" data-testid="mapa-ndvi-faixa">Mínimo {num(obs.valor_minimo, 2)} · Máximo {num(obs.valor_maximo, 2)}</div>
          <div className="text-xs tabular-nums text-slate-600" data-testid="mapa-ndvi-imagem">Imagem de {dateBR(obs.observacao_inicio)} · {pct(Number(obs.cobertura_valida) * 100, 0)} da área vista</div>
          {item?.variacao !== null && item?.variacao !== undefined && item.observacao_anterior && (
            <div className={`text-xs tabular-nums ${Number(item.variacao) > 0 ? "text-green-700" : Number(item.variacao) < 0 ? "text-red-700" : "text-slate-600"}`} data-testid="mapa-ndvi-variacao">
              {variacaoComSinal(item.variacao)} desde a imagem de {dateBR(item.observacao_anterior.observacao_inicio)}
            </div>
          )}
          {!obs.do_poligono_atual && <div className="text-xs text-amber-700" data-testid="mapa-ndvi-contorno-anterior">Calculado sobre o contorno anterior da área. Peça uma análise nova.</div>}
        </>
      ) : !execucaoSemImagem && <p className="text-xs text-slate-500" data-testid="mapa-ndvi-sem-analise">Nenhuma análise por satélite desta área ainda.</p>}
      {execucaoSemImagem && (
        <div className="text-xs text-slate-600" data-testid="mapa-ndvi-ultima-sem-imagem">
          Última análise ({dateTimeBR(execucaoSemImagem.criado_em)}): {enumLabel("analise_satelital_situacao", execucaoSemImagem.situacao)} — {enumLabel("analise_satelital_motivo", execucaoSemImagem.motivo_qualidade)}.
        </div>
      )}
      {rasterOk && (
        <div className="mt-1" data-testid="mapa-ndvi-raster-info">
          <MiniaturaRaster entrada={rasterOk} />
          <div className="mt-1 text-xs tabular-nums text-slate-600" data-testid="mapa-ndvi-raster-meta">
            Imagem de {dateBR(rasterOk.dto.data_imagem)} · resolução {num(rasterOk.dto.resolucao_m, 0)} m
          </div>
          {rasterOk.dto.resolucao_reduzida && (
            <p className="text-xs text-amber-700" data-testid="mapa-ndvi-resolucao-reduzida">
              Imagem gerada em {num(rasterOk.dto.resolucao_m, 0)} m por causa do tamanho da área.
            </p>
          )}
        </div>
      )}
      {raster?.erro && <p className="text-xs text-red-600" data-testid="mapa-ndvi-raster-erro">{raster.erro}</p>}
      {aviso && <p className={`text-xs ${aviso.tom === "erro" ? "text-red-600" : "text-green-700"}`} data-testid="mapa-ndvi-aviso" role="status">{aviso.texto}</p>}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {podePedir && (
          <Button type="button" size="sm" variant="outline" disabled={analisar.isPending} onClick={() => { setAviso(null); analisar.mutate(); }} data-testid="mapa-ndvi-analisar">
            {analisar.isPending ? "Analisando…" : "Analisar agora"}
          </Button>
        )}
        {podeGerarImagem && !confirmandoGerar && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={gerar.isPending}
            onClick={() => { setAviso(null); setConfirmandoGerar(true); }}
            data-testid="mapa-ndvi-gerar-imagem"
          >
            Gerar imagem
          </Button>
        )}
        {confirmandoGerar && (
          <div className="flex w-full flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid="mapa-ndvi-gerar-confirmacao">
            <p className="text-xs text-amber-900">Gerar a imagem consome crédito de satélite e pode levar até 2 minutos. Continuar?</p>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                disabled={gerar.isPending}
                onClick={() => gerar.mutate()}
                data-testid="mapa-ndvi-gerar-confirmar"
              >
                {gerar.isPending ? "Gerando imagem…" : "Sim, gerar"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={gerar.isPending} onClick={() => setConfirmandoGerar(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {obs && (
          <Button type="button" size="sm" variant="ghost" aria-expanded={verHistorico} onClick={() => setVerHistorico((v) => !v)} data-testid="mapa-ndvi-ver-historico">
            {verHistorico ? "Ocultar histórico" : "Histórico"}
          </Button>
        )}
      </div>
      {verHistorico && <Historico areaId={areaId} />}
    </div>
  );
}
