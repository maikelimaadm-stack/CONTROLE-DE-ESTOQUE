"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CATALOGO_INDICES, enumLabel, type EstadoQualidade } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Input, NativeSelect } from "@/components/ui";
import { dateBR, dateTimeBR, num, pct } from "@/lib/utils";
import {
  AVISO_AGRONOMICO,
  INDICES_DA_ANOMALIA,
  ROTULO_JANELA_TENDENCIA,
  ROTULO_NIVEL_ANOMALIA,
  ROTULO_QUALIDADE,
  anomaliaDoHistorico,
  coberturaEmPercentual,
  estimativaLegivel,
  lerTendencia,
  type BundleDoResumo,
  type HistoricoIndice,
  type IdIndice,
  type IndiceDoResumo,
  type ResumoCondicao,
  type TendenciaDoResumo
} from "./condicao-modelo";
import { CHAVE_CONDICAO, useHistoricoIndice, useHistoricoPeriodo, useHistoricosDaArea, useResumoCondicao } from "./condicao-dados";
import { analiseIdDaData, type DataDaCamada } from "./data-camada";
import { PERIODOS_HISTORICO, PERIODO_HISTORICO_PADRAO, type PeriodoHistorico } from "./historico-periodo";
import { GraficoHistorico } from "./grafico-historico";
import { CompararModal } from "./comparar-modal";
import { nomeDoIndice } from "./paletas-indices";
import {
  gerarRasterDaAnalise,
  mensagemDoErroDeRaster,
  type EntradaRasterEmMemoria,
  type RasterIndiceDto
} from "./rasters-indice";

const PERMISSAO_PEDIR = "analises_satelitais.create";

const TOM_QUALIDADE: Readonly<Record<EstadoQualidade, "green" | "amber" | "red" | "slate">> = {
  excelente: "green",
  boa: "green",
  limitada: "amber",
  insuficiente: "red",
  sem_imagem_util: "red"
};

const ROTULO_TENDENCIA: Readonly<Record<string, string>> = {
  subiu: "subiu",
  estavel: "estável",
  caiu: "caiu",
  queda_forte: "queda forte",
  indeterminada: "sem base de comparação"
};

const INDICES_VEGETACAO: readonly IdIndice[] = ["ndvi", "evi2", "ndre"];
const INDICES_COBERTURA: readonly IdIndice[] = ["msavi2", "bsi"];

function Secao({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-0.5 border-t border-slate-100 pt-1.5" data-testid={testId}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      {children}
    </section>
  );
}

function LinhaIndice({ id, indice, ativo }: { id: IdIndice; indice: IndiceDoResumo | undefined; ativo: boolean }) {
  const nome = CATALOGO_INDICES[id].nome;
  const media = indice?.valor_medio ?? null;
  const comp = indice?.comparacao_observacao_anterior ?? null;
  const delta = comp?.delta_percentual ?? null;
  return (
    <div className={`flex items-baseline gap-2 text-xs ${ativo ? "font-semibold text-slate-800" : "text-slate-700"}`} data-testid={`condicao-indice-${id}`}>
      <span className="w-14 shrink-0">{nome}</span>
      <span className="tabular-nums" data-testid={`condicao-indice-${id}-valor`}>{media === null ? "—" : num(media, 2)}</span>
      {comp && (
        <span className={`tabular-nums ${delta !== null && delta < 0 ? "text-red-700" : delta !== null && delta > 0 ? "text-green-700" : "text-slate-500"}`}>
          {ROTULO_TENDENCIA[comp.tendencia] ?? comp.tendencia}
          {delta !== null && <> ({delta > 0 ? "+" : delta < 0 ? "−" : ""}{num(Math.abs(delta), 1)}%)</>}
          {comp.anterior_observacao_inicio && <span className="text-slate-400"> desde {dateBR(comp.anterior_observacao_inicio)}</span>}
        </span>
      )}
    </div>
  );
}

function BlocoQualidade({ obs }: { obs: BundleDoResumo }) {
  const q = obs.qualidade;
  const cobertura = coberturaEmPercentual(q.cobertura_valida);
  const limitante = q.indice_limitante;
  const coberturaLimitante = limitante ? coberturaEmPercentual(q.coberturas_por_indice[limitante]) : null;
  const nuvens = coberturaEmPercentual(q.cloud_ratio);
  return (
    <Secao titulo="Qualidade da imagem" testId="condicao-qualidade">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={TOM_QUALIDADE[q.estado]} data-testid="condicao-qualidade-estado">{ROTULO_QUALIDADE[q.estado]}</Badge>
        <span className="tabular-nums text-slate-600" data-testid="condicao-cobertura">
          {cobertura === null ? "Cobertura válida não informada" : `${pct(cobertura, 0)} da área com dado válido`}
        </span>
      </div>
      {limitante && (
        <p className="text-xs text-slate-600" data-testid="condicao-limitante">
          Índice limitante: {CATALOGO_INDICES[limitante].nome}
          {coberturaLimitante !== null && <> ({pct(coberturaLimitante, 0)} válido)</>}
          {" — "}o de menor cobertura válida; limita a confiança do conjunto.
        </p>
      )}
      {nuvens !== null && nuvens > 0 && <p className="text-xs tabular-nums text-slate-500">Nuvem ou sombra em {pct(nuvens, 0)} da área.</p>}
    </Secao>
  );
}

/** Tendência do NDVI por janela. Delta nulo = "Dados insuficientes" (NULL não é zero). */
function BlocoTendencia({ tendencia }: { tendencia: TendenciaDoResumo }) {
  return (
    <Secao titulo="Tendência do NDVI" testId="condicao-tendencia">
      {(["ultima", "30d", "90d"] as const).map((k) => {
        const t = tendencia[k];
        const leitura = lerTendencia(t, (v) => num(v, 2));
        const cor = leitura.direcao === "subiu" ? "text-green-700" : leitura.direcao === "caiu" ? "text-red-700" : "text-slate-500";
        return (
          <div key={k} className="flex items-baseline gap-2 text-xs" data-testid={`condicao-tendencia-${k}`}>
            <span className="w-36 shrink-0 text-slate-600">{ROTULO_JANELA_TENDENCIA[k]}</span>
            <span className={`tabular-nums font-medium ${cor}`} data-testid={`condicao-tendencia-${k}-valor`}>{leitura.texto}</span>
            {t && <span className="text-[10px] tabular-nums text-slate-400">{t.pontos} {t.pontos === 1 ? "observação útil" : "observações úteis"}</span>}
          </div>
        );
      })}
      <p className="text-[10px] leading-tight text-slate-500">Variação do NDVI médio entre observações do mesmo contorno.</p>
    </Secao>
  );
}

function BlocoAnomalia({ areaId, resumo }: { areaId: string; resumo: ResumoCondicao }) {
  const daApi = resumo.anomalia ?? null;
  const hist = useHistoricosDaArea(areaId, INDICES_DA_ANOMALIA, daApi === null);
  const calculada = React.useMemo(() => {
    if (daApi) return daApi;
    if (hist.carregando) return null;
    const hash = hist.porIndice.ndvi?.geometria_sha256 ?? null;
    return anomaliaDoHistorico(hist.porIndice, hash);
  }, [daApi, hist.carregando, hist.porIndice]);

  if (!calculada) return <Secao titulo="Possível alteração" testId="condicao-anomalia"><p className="text-xs text-slate-500">Avaliando o histórico…</p></Secao>;
  const forte = calculada.nivel === "moderada" || calculada.nivel === "forte";
  return (
    <Secao titulo="Possível alteração" testId="condicao-anomalia">
      <p className={`text-xs font-medium ${forte ? "text-amber-800" : calculada.nivel === "leve" ? "text-amber-700" : "text-slate-700"}`} data-testid="condicao-anomalia-nivel">
        {ROTULO_NIVEL_ANOMALIA[calculada.nivel]}
      </p>
      {calculada.motivos.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-slate-600" data-testid="condicao-anomalia-motivos">
          {calculada.motivos.map((m) => <li key={m.codigo}>{m.mensagem}</li>)}
        </ul>
      )}
      {calculada.vistoria_recomendada && <p className="text-xs font-medium text-amber-800" data-testid="condicao-vistoria">Vistoria de campo recomendada para confirmar.</p>}
    </Secao>
  );
}

export interface CondicaoDaAreaProps {
  areaId: string;
  temContorno: boolean;
  nomeDaArea: string;
  indiceAtivo: IdIndice;
  raster: EntradaRasterEmMemoria | null;
  /** Data ativa da camada: com data escolhida, "Gerar raster" é DESSA data e a falta de imagem é dita, não trocada. */
  data: DataDaCamada;
  /** A listagem de rasters da data escolhida não trouxe imagem para esta área. */
  semImagemNaData: boolean;
  /** O servidor informou o hash do contorno vigente: o mapa solta imagem guardada de outro contorno. */
  onHashAtual: (areaId: string, geometriaSha256: string) => void;
  onRasterGerado: (dto: RasterIndiceDto) => Promise<void> | void;
  onNovaConsulta: () => void;
}

/**
 * Painel "Condição da área": o resumo dos seis índices da última observação útil do contorno ATUAL, a qualidade, a
 * possível alteração e as ações. Linguagem de sinal ("alta resposta de vegetação", "solo exposto estimado"): satélite
 * indica, o campo confirma.
 */
export function CondicaoDaArea(p: CondicaoDaAreaProps) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const resumoQ = useResumoCondicao(p.areaId);
  const [verHistorico, setVerHistorico] = React.useState(false);
  const [comparando, setComparando] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState<null | "analisar" | "raster">(null);
  const [aviso, setAviso] = React.useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [periodo, setPeriodo] = React.useState<PeriodoHistorico>(PERIODO_HISTORICO_PADRAO);
  const [personalizado, setPersonalizado] = React.useState({ de: "", ate: "" });
  React.useEffect(() => { setVerHistorico(false); setComparando(false); setConfirmando(null); setAviso(null); }, [p.areaId]);

  const historicoQ = useHistoricoPeriodo(p.areaId, p.indiceAtivo, periodo, personalizado, verHistorico);
  const historicoDoPeriodo = React.useMemo<HistoricoIndice | null>(() => {
    const d = historicoQ.data;
    if (!d) return null;
    return { area_id: p.areaId, indice: p.indiceAtivo, geometria_sha256: d.carga.geometriaSha256, do_poligono_atual: true, itens: d.itens };
  }, [historicoQ.data, p.areaId, p.indiceAtivo]);
  // Para gerar a imagem de uma DATA escolhida é preciso a análise daquele dia (primeira página do histórico, em cache).
  const dataEscolhida = p.data.tipo === "data" ? p.data.data : null;
  const historicoBaseQ = useHistoricoIndice(p.areaId, p.indiceAtivo, dataEscolhida !== null);
  const podePedir = can(PERMISSAO_PEDIR);
  const resumo = resumoQ.data ?? null;
  const obs = resumo?.ultima_observacao_util ?? null;
  const analiseDoIndice = dataEscolhida !== null
    ? analiseIdDaData(historicoBaseQ.data?.itens ?? [], dataEscolhida)
    : (obs?.indices[p.indiceAtivo]?.id ?? null);

  const { onHashAtual } = p;
  const hashAtual = resumo?.geometria_sha256 ?? null;
  React.useEffect(() => {
    if (hashAtual) onHashAtual(p.areaId, hashAtual);
  }, [hashAtual, onHashAtual, p.areaId]);

  const analisar = useMutation({
    mutationFn: () => api<{ situacao?: string; motivo_qualidade?: string | null; reutilizada?: boolean }>(`/api/mapa/areas/${p.areaId}/analises-satelitais/condicao`, { method: "POST", body: {} }),
    onSuccess: async (r) => {
      setConfirmando(null);
      setAviso({
        tom: "ok",
        texto: r.reutilizada
          ? "Esta área já foi analisada neste período com este contorno: vale a análise registrada."
          : r.situacao === "sem_observacao_util"
            ? `Sem imagem útil nos últimos dias: ${enumLabel("analise_satelital_motivo", r.motivo_qualidade ?? null)}.`
            : "Análise registrada para o contorno atual."
      });
      await qc.invalidateQueries({ queryKey: CHAVE_CONDICAO });
      await qc.invalidateQueries({ queryKey: ["mapa-geral", "ndvi"] });
    },
    onError: (e) => {
      setConfirmando(null);
      const motivo503 = e instanceof ApiError && e.status === 503
        ? (e.details as { motivo?: unknown } | undefined)?.motivo
        : undefined;
      const texto503 = motivo503 === "configuracao"
        ? "A análise por satélite está ligada, mas a credencial do Copernicus não está configurada no servidor da API."
        : "A consulta por satélite está indisponível no momento.";
      setAviso({
        tom: "erro",
        texto: e instanceof ApiError && e.status === 503
          ? texto503
          : e instanceof Error ? e.message : "Não foi possível pedir a análise."
      });
    }
  });

  const gerar = useMutation({
    mutationFn: async () => {
      if (!analiseDoIndice) throw new Error(dataEscolhida ? "Não há análise útil deste índice nesta data para gerar a imagem." : "Não há análise útil deste índice para gerar a imagem.");
      return gerarRasterDaAnalise(analiseDoIndice);
    },
    onSuccess: async (r) => {
      setConfirmando(null);
      setAviso({ tom: "ok", texto: r.reutilizada ? "A imagem já existia: não houve custo adicional." : "Imagem gerada. O mapa mostra o índice por pixel." });
      await p.onRasterGerado(r.raster);
    },
    onError: (e) => {
      setConfirmando(null);
      setAviso({ tom: "erro", texto: mensagemDoErroDeRaster(e) });
    }
  });

  // A rota ausente (API anterior) ou a área fora do escopo: o painel some em silêncio.
  if (resumoQ.isLoading) return <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500" data-testid="condicao-carregando">Carregando a condição da área…</div>;
  if (resumoQ.error) {
    return <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-red-600" data-testid="condicao-erro">Não foi possível carregar a condição da área.</div>;
  }
  if (!resumo) return null;

  const derivados = obs?.indicadores_derivados ?? null;
  const rasterOk = p.raster && p.raster.blobUrl && !p.raster.erro ? p.raster : null;
  const nomeIndice = nomeDoIndice(p.indiceAtivo);
  const resolucaoNativa = CATALOGO_INDICES[p.indiceAtivo].resolucaoNativaM;
  const tentativa = resumo.ultima_tentativa;
  const fr = derivados?.fracoes_histograma ?? null;
  const fracao = (v: number | null | undefined) => (v === null || v === undefined ? null : ` (${pct(v * 100, 0)} da área)`);

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-200 pt-2" data-testid="condicao-area">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Condição da área</div>

      {obs ? (
        <>
          <div className="text-xs tabular-nums text-slate-600" data-testid="condicao-imagem">
            Imagem de {dateBR(obs.observacao_inicio)}{!obs.do_poligono_atual && " · contorno anterior"}
          </div>
          {derivados && (
            <p className="text-sm font-semibold text-slate-800" data-testid="condicao-resposta-vegetacao">{derivados.resposta_vegetacao}</p>
          )}

          <BlocoQualidade obs={obs} />

          <Secao titulo="Índices de vegetação" testId="condicao-vegetacao">
            {INDICES_VEGETACAO.map((id) => <LinhaIndice key={id} id={id} indice={obs.indices[id]} ativo={id === p.indiceAtivo} />)}
          </Secao>

          <Secao titulo="Cobertura e solo" testId="condicao-cobertura-solo">
            {derivados && (
              <ul className="flex flex-col gap-0.5 text-xs text-slate-700" data-testid="condicao-indicadores">
                <li data-testid="condicao-vegetacao-ativa">Vegetação ativa estimada: <strong>{estimativaLegivel(derivados.vegetacao_ativa_estimada)}</strong>{fracao(fr?.vegetacao_ativa)}</li>
                <li data-testid="condicao-baixa-cobertura">Baixa cobertura estimada: <strong>{estimativaLegivel(derivados.baixa_cobertura_estimada)}</strong>{fracao(fr?.baixa_cobertura)}</li>
                <li data-testid="condicao-solo-exposto">Solo exposto estimado: <strong>{estimativaLegivel(derivados.solo_exposto_estimado)}</strong>{fracao(fr?.solo_exposto)}</li>
              </ul>
            )}
            {INDICES_COBERTURA.map((id) => <LinhaIndice key={id} id={id} indice={obs.indices[id]} ativo={id === p.indiceAtivo} />)}
            <p className="text-[10px] leading-tight text-slate-500">Estimativas experimentais, calculadas a partir dos índices. Servem para priorizar a vistoria.</p>
          </Secao>

          <Secao titulo="Umidade (NDMI)" testId="condicao-umidade">
            <LinhaIndice id="ndmi" indice={obs.indices.ndmi} ativo={p.indiceAtivo === "ndmi"} />
            {derivados && <p className="text-xs text-slate-700" data-testid="condicao-hidrica">Umidade relativa na vegetação: <strong>{estimativaLegivel(derivados.condicao_hidrica)}</strong></p>}
            <p className="text-[10px] leading-tight text-slate-500">O NDMI indica a água na vegetação; não mede a umidade do solo.</p>
          </Secao>

          {resumo.tendencia && <BlocoTendencia tendencia={resumo.tendencia} />}

          <BlocoAnomalia areaId={p.areaId} resumo={resumo} />
        </>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="condicao-sem-analise">
          <p className="text-xs text-slate-700">
            {p.temContorno
              ? "Esta área não tem análise para o contorno atual. Se o contorno foi redesenhado, as análises anteriores não valem para a forma nova."
              : "Esta área ainda não tem contorno. Desenhe o contorno no cadastro para analisá-la por satélite."}
          </p>
          {tentativa && (
            <p className="text-xs text-slate-600" data-testid="condicao-ultima-tentativa">
              Última tentativa ({dateTimeBR(tentativa.criado_em)}): {enumLabel("analise_satelital_situacao", tentativa.situacao)}
              {tentativa.motivo_qualidade ? ` — ${enumLabel("analise_satelital_motivo", tentativa.motivo_qualidade)}` : ""}.
            </p>
          )}
          {podePedir && p.temContorno && confirmando !== "analisar" && (
            <div>
              <Button type="button" size="sm" disabled={analisar.isPending} onClick={() => { setAviso(null); setConfirmando("analisar"); }} data-testid="condicao-analisar-atual">
                Analisar área atual
              </Button>
            </div>
          )}
          {confirmando === "analisar" && (
            <div className="flex w-full flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid="condicao-analisar-confirmacao">
              <p className="text-xs text-amber-900">A análise consome crédito de satélite. Continuar?</p>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" loading={analisar.isPending} onClick={() => analisar.mutate()} data-testid="condicao-analisar-confirmar">Sim, analisar</Button>
                <Button type="button" size="sm" variant="ghost" disabled={analisar.isPending} onClick={() => setConfirmando(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="rounded bg-slate-50 px-2 py-1 text-[10px] leading-tight text-slate-600" data-testid="condicao-aviso-agronomico">{AVISO_AGRONOMICO}</p>

      {rasterOk && (
        <p className="text-xs tabular-nums text-slate-600" data-testid="condicao-raster-info">
          Imagem de {nomeIndice} de {dateBR(rasterOk.dto.data_imagem)} · resolução {num(rasterOk.dto.resolucao_m, 0)} m (nativa {resolucaoNativa} m)
        </p>
      )}
      {p.raster?.erro && <p className="text-xs text-red-600">{p.raster.erro}</p>}
      {aviso && <p className={`text-xs ${aviso.tom === "erro" ? "text-red-600" : "text-green-700"}`} role="status" data-testid="condicao-aviso">{aviso.texto}</p>}

      {confirmando === "raster" && (
        <div className="flex w-full flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid="condicao-gerar-confirmacao">
          <p className="text-xs text-amber-900">Gerar a imagem do {nomeIndice} consome crédito de satélite e pode levar até 2 minutos. Continuar?</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" loading={gerar.isPending} onClick={() => gerar.mutate()} data-testid="condicao-gerar-confirmar">Sim, gerar</Button>
            <Button type="button" size="sm" variant="ghost" disabled={gerar.isPending} onClick={() => setConfirmando(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" data-testid="condicao-acoes">
        {podePedir && p.temContorno && (
          <Button type="button" size="sm" variant="outline" onClick={p.onNovaConsulta} data-testid="condicao-nova-consulta">Analisar pastos</Button>
        )}
        {obs && (
          <Button type="button" size="sm" variant="ghost" aria-expanded={verHistorico} onClick={() => setVerHistorico((v) => !v)} data-testid="condicao-historico-abrir">
            {verHistorico ? "Ocultar histórico" : "Histórico"}
          </Button>
        )}
        {obs && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setComparando(true)} data-testid="condicao-comparar">Comparar</Button>
        )}
        {obs && podePedir && !rasterOk && analiseDoIndice && confirmando !== "raster" && (
          <Button type="button" size="sm" variant="outline" disabled={gerar.isPending} onClick={() => { setAviso(null); setConfirmando("raster"); }} data-testid="condicao-gerar-raster">
            Gerar raster {nomeIndice}{dataEscolhida ? ` de ${dateBR(dataEscolhida)}` : ""}
          </Button>
        )}
      </div>
      {dataEscolhida !== null && !rasterOk && p.semImagemNaData && (
        <p className="text-xs text-amber-700" data-testid="condicao-sem-imagem-data">
          Não há imagem de {nomeIndice} gerada em {dateBR(dataEscolhida)} para o contorno atual. Nenhuma outra data é usada no lugar.
        </p>
      )}

      {verHistorico && (
        <div data-testid="condicao-historico-painel">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">{nomeIndice} ao longo do tempo</span>
            <NativeSelect
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as PeriodoHistorico)}
              className="ml-auto h-[26px] w-auto py-0 text-xs"
              aria-label="Período do histórico"
              data-testid="condicao-historico-periodo"
            >
              {PERIODOS_HISTORICO.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </NativeSelect>
          </div>
          {periodo === "personalizado" && (
            <div className="mb-1 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-600" data-testid="condicao-historico-de">De
                <Input type="date" value={personalizado.de} onChange={(e) => setPersonalizado((x) => ({ ...x, de: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-600" data-testid="condicao-historico-ate">Até
                <Input type="date" value={personalizado.ate} onChange={(e) => setPersonalizado((x) => ({ ...x, ate: e.target.value }))} />
              </label>
            </div>
          )}
          {!historicoQ.janela.ok && <p className="text-xs text-amber-700" data-testid="condicao-historico-periodo-invalido">{historicoQ.janela.motivo}</p>}
          {historicoQ.janela.ok && historicoQ.isLoading && <p className="text-xs text-slate-500">Carregando o histórico…</p>}
          {historicoQ.error && <p className="text-xs text-red-600" data-testid="condicao-historico-erro">{historicoQ.error instanceof Error ? historicoQ.error.message : "Não foi possível carregar o histórico."}</p>}
          {historicoDoPeriodo && historicoQ.data && historicoQ.janela.ok && (
            <>
              <GraficoHistorico indice={p.indiceAtivo} historico={historicoDoPeriodo} />
              <p className="mt-1 text-[10px] leading-tight text-slate-500" data-testid="condicao-historico-cobertura">
                {historicoQ.data.itens.length} {historicoQ.data.itens.length === 1 ? "observação" : "observações"} de {dateBR(historicoQ.janela.janela.inicio)} a {dateBR(historicoQ.janela.janela.fim)}
                {historicoQ.data.carga.exaurido ? " · histórico completo" : historicoQ.data.carga.coberto ? " · período coberto" : " · limite de páginas: pode haver observações mais antigas fora desta lista"}.
              </p>
            </>
          )}
        </div>
      )}

      {comparando && <CompararModal aberto onFechar={() => setComparando(false)} areaId={p.areaId} areaNome={p.nomeDaArea} indiceAtivo={p.indiceAtivo} />}
    </div>
  );
}

