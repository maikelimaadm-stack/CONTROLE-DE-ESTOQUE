"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { Button, Dialog, Input, NativeSelect } from "@/components/ui";
import { dateTimeBR, num } from "@/lib/utils";
import type { AreaNoMapa } from "./mapa-base";
import { CHAVE_CONDICAO } from "./condicao-dados";
import { nomeDoIndice, type IdIndice } from "./paletas-indices";
import {
  JANELAS_DIAS_OPCOES,
  LIMITE_AREAS_NA_CONSULTA,
  ORDEM_SELECAO,
  PERIODO_PADRAO,
  ROTULO_CADENCIA,
  ROTULO_SELECAO,
  ROTULO_SITUACAO_CONSULTA,
  ROTULO_TIPO_PERIODO,
  TOLERANCIAS_DIAS_OPCOES,
  TOLERANCIA_DIAS_PADRAO,
  consultaTerminou,
  itensDaConsulta,
  montarCorpoConsulta,
  progressoDaConsulta,
  resolverAlvo,
  validarPeriodo,
  type ConsultaCriada,
  type PeriodoDoFormulario,
  type PreviaConsulta,
  type RespostaConsulta,
  type SelecaoConsulta
} from "./consulta-satelite";
import {
  MSG_FILA_INDISPONIVEL,
  deveAvisarFilaIndisponivel,
  feitosDaConsulta
} from "./operacao-analise";

const INTERVALO_ACOMPANHAMENTO_MS = 3000;

export interface NovaConsultaProps {
  aberto: boolean;
  onFechar: () => void;
  areas: readonly AreaNoMapa[];
  areaAtualId: string | null;
  idsNaVista: readonly string[];
  idsSemAnalise: readonly string[];
  /** Áreas sem análise válida do contorno atual para o índice ativo; `null` = ainda não dá para afirmar. */
  idsDesatualizadas: readonly string[] | null;
  indiceAtivo: IdIndice;
  selecaoInicial?: SelecaoConsulta;
  /** Chamado quando a consulta termina (para o mapa recarregar resumo e imagens). */
  onConcluida?: () => void;
  /** Total de pastos (com contorno) e hectares — mostrado ao lado de "Todos os pastos". */
  totalAreas?: number;
  totalHa?: number;
  /**
   * Se há análise viva: abre direto no acompanhamento (não inicia outra).
   * `consultaIdInicial` = id a acompanhar; `modoAcompanhar` força a mensagem "Há uma análise em andamento".
   */
  consultaIdInicial?: string | null;
  modoAcompanhar?: boolean;
  /** `fila_disponivel` de GET /api/satelite/capacidade — sem nomes de env. */
  filaDisponivel?: boolean | null;
  /** Notifica o mapa quando uma consulta nova foi criada (barra persistente). */
  onConsultaEmAndamento?: (consultaId: string) => void;
}

function mensagemDoErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return "A consulta por satélite está indisponível no momento.";
    if (e.status === 429) return `${e.message} Tente de novo em instantes.`;
    return e.message;
  }
  return e instanceof Error ? e.message : "Não foi possível concluir o pedido.";
}

type EtapaAnalise = 1 | 2 | 3;

/**
 * Modal "Analisar pastos" (MAPA-UX-02 + Part B): etapa 1 seleção → etapa 2 prévia → etapa 3 progresso.
 * A consulta roda em fila no servidor; fechar o modal não a cancela. Uma operação viva → acompanha.
 */
export function NovaConsultaModal(p: NovaConsultaProps) {
  const qc = useQueryClient();
  const [selecao, setSelecao] = React.useState<SelecaoConsulta>(p.selecaoInicial ?? "empresa");
  const [escolhidas, setEscolhidas] = React.useState<ReadonlySet<string>>(new Set());
  const [retiroId, setRetiroId] = React.useState("");
  const [periodo, setPeriodo] = React.useState<PeriodoDoFormulario>(PERIODO_PADRAO);
  const [busca, setBusca] = React.useState("");
  const [previa, setPrevia] = React.useState<PreviaConsulta | null>(null);
  const [consultaId, setConsultaId] = React.useState<string | null>(null);
  const [etapa, setEtapa] = React.useState<EtapaAnalise>(1);
  const [avancadasAbertas, setAvancadasAbertas] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [avisoFilaAoCriar, setAvisoFilaAoCriar] = React.useState(false);
  const avisouConclusaoRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!p.aberto) return;
    setSelecao(p.selecaoInicial ?? "empresa");
    setPrevia(null);
    setErro(null);
    setAvancadasAbertas(false);
    setPeriodo(PERIODO_PADRAO);
    setBusca("");
    setEscolhidas(new Set());
    setRetiroId("");
    avisouConclusaoRef.current = null;
    setAvisoFilaAoCriar(false);
    if (p.modoAcompanhar && p.consultaIdInicial) {
      setConsultaId(p.consultaIdInicial);
      setEtapa(3);
    } else {
      setConsultaId(null);
      setEtapa(1);
    }
  }, [p.aberto, p.selecaoInicial, p.modoAcompanhar, p.consultaIdInicial]);

  const retiros = useQuery({
    queryKey: ["mapa-geral", "retiros"],
    enabled: p.aberto && selecao === "retiro",
    queryFn: () => api<{ items: { id: string; name: string }[] }>(`/api/resources/retiros${qs({ pageSize: 200 })}`)
  });
  const retirosDasAreas = React.useMemo(() => new Set(p.areas.map((a) => a.retiro_id).filter((x): x is string => Boolean(x))), [p.areas]);
  const opcoesRetiro = (retiros.data?.items ?? []).filter((r) => retirosDasAreas.has(r.id));

  const resolvido = resolverAlvo(selecao, {
    areaAtualId: p.areaAtualId,
    escolhidas: [...escolhidas],
    naVista: p.idsNaVista,
    semAnalise: p.idsSemAnalise,
    desatualizadas: p.idsDesatualizadas,
    retiroId: retiroId || null
  });

  // Dia UTC de hoje, como o servidor conta (a data pedida não pode ser futura nem anterior ao acervo).
  const hoje = new Date().toISOString().slice(0, 10);
  const periodoValidado = validarPeriodo(periodo, hoje);
  const itens = periodoValidado.ok && resolvido.ok ? itensDaConsulta(resolvido.quantidade, periodoValidado.slots) : null;
  const itensDemais = itens !== null && itens > LIMITE_AREAS_NA_CONSULTA;
  const motivoBloqueio = !resolvido.ok ? resolvido.motivo
    : !periodoValidado.ok ? periodoValidado.motivo
    : itensDemais ? `São ${itens} itens (áreas × recortes de tempo); o máximo é ${LIMITE_AREAS_NA_CONSULTA} por consulta. Reduza a seleção ou o período.`
    : null;
  const mudarPeriodo = (prox: PeriodoDoFormulario) => { setPeriodo(prox); setPrevia(null); setErro(null); if (etapa === 2) setEtapa(1); };

  const pastosParaIniciar = previa
    ? Math.max(0, previa.novos + previa.reaproveitados)
    : (resolvido.ok && resolvido.quantidade !== null ? resolvido.quantidade : null);
  const rotuloIniciar = pastosParaIniciar !== null
    ? `Iniciar análise de ${pastosParaIniciar} ${pastosParaIniciar === 1 ? "pasto" : "pastos"}`
    : "Iniciar análise de pastos";

  const pedir = useMutation({
    mutationFn: async (confirmar: boolean) => {
      if (!resolvido.ok) throw new Error(resolvido.motivo);
      if (!periodoValidado.ok) throw new Error(periodoValidado.motivo);
      const corpo = montarCorpoConsulta(resolvido.alvo, periodoValidado.periodo, confirmar);
      return api<PreviaConsulta | ConsultaCriada>("/api/satelite/consultas", { method: "POST", body: corpo });
    },
    onSuccess: (r, confirmar) => {
      setErro(null);
      if (confirmar) {
        const criada = r as ConsultaCriada;
        setConsultaId(criada.consulta.id);
        setEtapa(3);
        if (p.filaDisponivel === false) setAvisoFilaAoCriar(true);
        p.onConsultaEmAndamento?.(criada.consulta.id);
        void qc.invalidateQueries({ queryKey: ["mapa-geral", "operacao-analise"] });
      } else {
        setPrevia(r as PreviaConsulta);
        setEtapa(2);
      }
    },
    onError: (e) => setErro(mensagemDoErro(e))
  });

  const acompanhamento = useQuery<RespostaConsulta>({
    queryKey: [...CHAVE_CONDICAO, "consulta", consultaId],
    enabled: consultaId !== null,
    retry: false,
    refetchInterval: (q) => {
      const s = q.state.data?.consulta.situacao;
      return s && consultaTerminou(s) ? false : INTERVALO_ACOMPANHAMENTO_MS;
    },
    queryFn: ({ signal }) => api<RespostaConsulta>(`/api/satelite/consultas/${consultaId}${qs({ pagina: 1, tamanho: 1 })}`, { signal })
  });
  const consulta = acompanhamento.data?.consulta ?? null;
  const terminou = consulta ? consultaTerminou(consulta.situacao) : false;
  const feitos = consulta ? feitosDaConsulta(consulta) : 0;

  const [agoraMs, setAgoraMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!consulta || terminou || p.filaDisponivel !== false) return;
    const t = window.setInterval(() => setAgoraMs(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, [consulta, terminou, p.filaDisponivel]);

  const avisoFilaAtraso = consulta
    ? deveAvisarFilaIndisponivel({
      filaDisponivel: p.filaDisponivel,
      situacao: consulta.situacao,
      feitos,
      criadoEmMs: Date.parse(consulta.criado_em),
      agoraMs
    })
    : false;
  /** Ao criar com fila off, ou pendente com 0 progresso após limiar. */
  const mostrarAvisoFila = avisoFilaAoCriar || avisoFilaAtraso;

  const { onConcluida } = p;
  React.useEffect(() => {
    if (!consulta || !terminou || avisouConclusaoRef.current === consulta.id) return;
    avisouConclusaoRef.current = consulta.id;
    void qc.invalidateQueries({ queryKey: CHAVE_CONDICAO });
    void qc.invalidateQueries({ queryKey: ["mapa-geral", "ndvi"] });
    void qc.invalidateQueries({ queryKey: ["mapa-geral", "operacao-analise"] });
    onConcluida?.();
  }, [consulta, terminou, qc, onConcluida]);

  const mudarSelecao = (s: SelecaoConsulta) => { setSelecao(s); setPrevia(null); setErro(null); if (etapa === 2) setEtapa(1); };
  const filtradas = p.areas.filter((a) => a.geometria && (!busca || a.name.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR"))));
  const haEscolhidas = React.useMemo(() => {
    let s = 0;
    for (const a of p.areas) if (escolhidas.has(a.id)) s += Number(a.area_ha) || 0;
    return s;
  }, [p.areas, escolhidas]);
  const bloqueado = consultaId !== null;
  const etapaAtiva: EtapaAnalise = bloqueado ? 3 : etapa;
  const totalAreas = p.totalAreas;
  const totalHa = p.totalHa;

  const footer = (() => {
    if (etapaAtiva === 3) {
      return (
        <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="consulta-fechar">
          {terminou ? "Fechar" : "Continuar em segundo plano"}
        </Button>
      );
    }
    if (etapaAtiva === 2) {
      return (
        <>
          <Button type="button" variant="ghost" onClick={() => { setEtapa(1); setErro(null); }} data-testid="consulta-voltar" disabled={pedir.isPending}>Voltar</Button>
          <Button
            type="button"
            disabled={!previa || previa.excede_orcamento || motivoBloqueio !== null || pedir.isPending}
            loading={pedir.isPending}
            onClick={() => pedir.mutate(true)}
            data-testid="consulta-confirmar"
          >
            {rotuloIniciar}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="consulta-fechar">Cancelar</Button>
        <Button
          type="button"
          disabled={motivoBloqueio !== null || pedir.isPending}
          loading={pedir.isPending}
          onClick={() => pedir.mutate(false)}
          data-testid="consulta-continuar"
        >
          Continuar
        </Button>
      </>
    );
  })();

  const tituloModal = p.modoAcompanhar && etapaAtiva === 3 && !terminou
    ? "Há uma análise em andamento"
    : "Analisar pastos";

  return (
    <Dialog
      open={p.aberto}
      onOpenChange={(o) => { if (!o) p.onFechar(); }}
      title={tituloModal}
      description={etapaAtiva === 3
        ? "A análise continua no servidor. Fechar não cancela."
        : etapaAtiva === 2
          ? "Confira o resumo antes de iniciar. Nada foi gravado ainda."
          : "Escolha quais pastos analisar. O pacote é a classificação integrada da condição do pasto."}
      size="lg"
      testId="consulta-modal"
      footer={footer}
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="consulta-conteudo" data-etapa={etapaAtiva}>
        {p.modoAcompanhar && etapaAtiva === 3 && !terminou && (
          <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700" data-testid="consulta-em-andamento-aviso">
            Há uma análise em andamento. Acompanhe o progresso abaixo — não é necessário iniciar outra.
          </p>
        )}

        {etapaAtiva === 1 && (
          <>
            <fieldset className="flex flex-col gap-1.5" disabled={bloqueado}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quais pastos?</legend>
              {ORDEM_SELECAO.map((s) => {
                const indisponivel = (s === "desatualizadas" && p.idsDesatualizadas === null);
                return (
                  <label key={s} className={`flex items-center gap-2 ${indisponivel ? "text-slate-400" : "text-slate-700"}`}>
                    <input type="radio" name="selecao-consulta" className="accent-brand-500" checked={selecao === s} disabled={indisponivel} onChange={() => mudarSelecao(s)} data-testid={`consulta-selecao-${s}`} />
                    <span>{ROTULO_SELECAO[s]}</span>
                    {s === "empresa" && totalAreas !== undefined && (
                      <span className="text-xs tabular-nums text-slate-500" data-testid="consulta-todos-contador">
                        ({totalAreas}{totalHa !== undefined ? ` · ${num(totalHa, 1)} ha` : ""})
                      </span>
                    )}
                    {s === "viewport" && <span className="text-xs tabular-nums text-slate-500">({p.idsNaVista.length})</span>}
                    {s === "sem_analise" && <span className="text-xs tabular-nums text-slate-500">({p.idsSemAnalise.length})</span>}
                    {s === "desatualizadas" && (
                      <span className="text-xs tabular-nums text-slate-500" title={`Sem análise válida do contorno atual para ${nomeDoIndice(p.indiceAtivo)}`}>
                        ({p.idsDesatualizadas === null ? "indisponível" : `${p.idsDesatualizadas.length} · ${nomeDoIndice(p.indiceAtivo)}`})
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>

            {selecao === "escolhidas" && (
              <div className="flex flex-col gap-1 rounded border border-slate-200 p-2" data-testid="consulta-escolhidas">
                <Input placeholder="Buscar área" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar área" />
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50" data-testid="consulta-selecionar-todas" onClick={() => {
                    setEscolhidas(new Set(filtradas.map((a) => a.id))); setPrevia(null);
                  }}>Selecionar todas</button>
                  <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50" data-testid="consulta-limpar-escolhidas" onClick={() => {
                    setEscolhidas(new Set()); setPrevia(null);
                  }}>Limpar</button>
                </div>
                <ul className="max-h-40 overflow-auto">
                  {filtradas.map((a) => (
                    <li key={a.id}>
                      <label className="flex items-center gap-2 py-0.5 text-[13px]">
                        <input type="checkbox" className="accent-brand-500" checked={escolhidas.has(a.id)} onChange={(e) => {
                          const prox = new Set(escolhidas);
                          if (e.target.checked) prox.add(a.id); else prox.delete(a.id);
                          setEscolhidas(prox); setPrevia(null);
                        }} />
                        <span className="truncate">{a.name}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-xs text-slate-500">{num(Number(a.area_ha) || 0, 1)} ha</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <span className="text-xs tabular-nums text-slate-500" data-testid="consulta-escolhidas-contador">
                  {escolhidas.size} de no máximo {LIMITE_AREAS_NA_CONSULTA} áreas · {num(haEscolhidas, 1)} ha
                </span>
              </div>
            )}

            {selecao === "retiro" && (
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Retiro
                <NativeSelect value={retiroId} onChange={(e) => { setRetiroId(e.target.value); setPrevia(null); }} data-testid="consulta-retiro" aria-label="Retiro">
                  <option value="">{retiros.isLoading ? "Carregando…" : "Escolha o retiro"}</option>
                  {opcoesRetiro.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </NativeSelect>
              </label>
            )}

            <div className="rounded border border-slate-200 p-2" data-testid="consulta-periodo-resumo">
              <p className="text-xs text-slate-600">Período: <span className="font-medium text-slate-800">{ROTULO_TIPO_PERIODO.mais_recente}</span></p>
              <div className="mt-2" data-testid="consulta-opcoes-avancadas">
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-600 underline hover:text-slate-800"
                  aria-expanded={avancadasAbertas}
                  onClick={() => setAvancadasAbertas((v) => !v)}
                  data-testid="consulta-opcoes-avancadas-toggle"
                >
                  Opções avançadas
                </button>
                {avancadasAbertas && (
                  <fieldset className="mt-2 flex flex-col gap-1.5" data-testid="consulta-periodo">
                    <label className="flex flex-col gap-1 text-xs text-slate-600">
                      Tipo de período
                      <NativeSelect
                        value={periodo.tipo}
                        onChange={(e) => {
                          const tipo = e.target.value as PeriodoDoFormulario["tipo"];
                          mudarPeriodo(
                            tipo === "mais_recente" ? PERIODO_PADRAO
                            : tipo === "data" ? { tipo: "data", data: "", toleranciaDias: TOLERANCIA_DIAS_PADRAO }
                            : { tipo: "intervalo", de: "", ate: "", cadencia: "mensal" }
                          );
                        }}
                        data-testid="consulta-periodo-tipo"
                        aria-label="Tipo de período"
                      >
                        {(Object.keys(ROTULO_TIPO_PERIODO) as PeriodoDoFormulario["tipo"][]).map((t) => <option key={t} value={t}>{ROTULO_TIPO_PERIODO[t]}</option>)}
                      </NativeSelect>
                    </label>

                    {periodo.tipo === "mais_recente" && (
                      <label className="flex flex-col gap-1 text-xs text-slate-600">
                        Procurar a imagem útil nos últimos
                        <NativeSelect value={periodo.janelaDias} onChange={(e) => mudarPeriodo({ tipo: "mais_recente", janelaDias: Number(e.target.value) })} data-testid="consulta-janela" aria-label="Janela em dias">
                          {JANELAS_DIAS_OPCOES.map((d) => <option key={d} value={d}>{d} dias</option>)}
                        </NativeSelect>
                      </label>
                    )}

                    {periodo.tipo === "data" && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-data">
                          Data da imagem
                          <Input type="date" value={periodo.data} onChange={(e) => mudarPeriodo({ ...periodo, data: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-slate-600">
                          Tolerância (dias antes e depois)
                          <NativeSelect value={periodo.toleranciaDias} onChange={(e) => mudarPeriodo({ ...periodo, toleranciaDias: Number(e.target.value) })} data-testid="consulta-tolerancia" aria-label="Tolerância em dias">
                            {TOLERANCIAS_DIAS_OPCOES.map((d) => <option key={d} value={d}>{d === 0 ? "Só a própria data" : `± ${d} dia${d === 1 ? "" : "s"}`}</option>)}
                          </NativeSelect>
                        </label>
                      </div>
                    )}

                    {periodo.tipo === "intervalo" && (
                      <div className="grid grid-cols-3 gap-3">
                        <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-de">
                          De
                          <Input type="date" value={periodo.de} onChange={(e) => mudarPeriodo({ ...periodo, de: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-ate">
                          Até
                          <Input type="date" value={periodo.ate} onChange={(e) => mudarPeriodo({ ...periodo, ate: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-slate-600">
                          Cadência
                          <NativeSelect value={periodo.cadencia} onChange={(e) => mudarPeriodo({ ...periodo, cadencia: e.target.value as "mensal" | "decendial" })} data-testid="consulta-cadencia" aria-label="Cadência">
                            {(Object.keys(ROTULO_CADENCIA) as ("mensal" | "decendial")[]).map((c) => <option key={c} value={c}>{ROTULO_CADENCIA[c]}</option>)}
                          </NativeSelect>
                        </label>
                      </div>
                    )}
                    {periodoValidado.ok && periodoValidado.slots > 1 && (
                      <p className="text-xs tabular-nums text-slate-500" data-testid="consulta-recortes">{periodoValidado.slots} recortes de tempo (uma imagem útil por recorte)</p>
                    )}
                  </fieldset>
                )}
              </div>
            </div>

            {motivoBloqueio && <p className="text-xs text-amber-700" data-testid="consulta-alvo-invalido">{motivoBloqueio}</p>}
            {erro && <p className="text-xs text-red-600" role="alert" data-testid="consulta-erro">{erro}</p>}
          </>
        )}

        {etapaAtiva === 2 && previa && (
          <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-3 text-[13px]" data-testid="consulta-previa-resultado">
            <div className="font-semibold uppercase tracking-wide text-slate-700" data-testid="consulta-previa-titulo">Resumo da análise</div>
            {resolvido.ok && resolvido.quantidade !== null && (
              <div className="tabular-nums" data-testid="consulta-previa-pastos">{resolvido.quantidade} {resolvido.quantidade === 1 ? "pasto selecionado" : "pastos selecionados"}</div>
            )}
            <div className="tabular-nums">{previa.novos} {previa.novos === 1 ? "pasto novo" : "pastos novos"} · {previa.reaproveitados} reaproveitado{previa.reaproveitados === 1 ? "" : "s"} · {previa.total_itens} no total</div>
            <div className="tabular-nums" data-testid="consulta-previa-creditos">
              Estimativa: {num(previa.estimativa_creditos.minimo, 2)} a {num(previa.estimativa_creditos.maximo, 2)} créditos
              {previa.saldo_creditos_mes !== null && <> · saldo do mês {num(previa.saldo_creditos_mes, 2)}</>}
            </div>
            {previa.excede_orcamento && <p className="text-red-600" data-testid="consulta-excede">A estimativa passa do saldo do mês. Reduza a seleção ou peça aumento do limite.</p>}
            {previa.areas_ignoradas.length > 0 && (
              <details className="text-xs text-amber-700">
                <summary>{previa.areas_ignoradas.length} área(s) ignorada(s)</summary>
                <ul className="mt-1 list-disc pl-4">{previa.areas_ignoradas.map((a) => <li key={a.area_id}>{a.nome}: {a.motivo}</li>)}</ul>
              </details>
            )}
            {erro && <p className="text-xs text-red-600" role="alert" data-testid="consulta-erro">{erro}</p>}
          </div>
        )}

        {etapaAtiva === 3 && (
          <div className="flex flex-col gap-1 rounded border border-slate-200 p-2" data-testid="consulta-progresso">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-semibold text-slate-700">{consulta ? (ROTULO_SITUACAO_CONSULTA[consulta.situacao] ?? consulta.situacao) : "Criando a consulta…"}</span>
              {consulta && <span className="tabular-nums text-slate-600">{progressoDaConsulta(consulta)}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={consulta ? progressoDaConsulta(consulta) : 0} aria-label="Progresso da consulta">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${consulta ? progressoDaConsulta(consulta) : 0}%` }} />
            </div>
            {consulta && (
              <div className="text-xs tabular-nums text-slate-600" data-testid="consulta-progresso-pastos">
                {feitos} de {consulta.total_itens} pastos
                {consulta.total_falhos > 0 && <> · {consulta.total_falhos} com falha</>}
                {consulta.concluida_em && <> · terminou em {dateTimeBR(consulta.concluida_em)}</>}
              </div>
            )}
            {mostrarAvisoFila && (
              <p className="text-xs text-amber-800" data-testid="consulta-fila-indisponivel" role="status">
                {MSG_FILA_INDISPONIVEL}
              </p>
            )}
            {terminou && consulta && consulta.total_falhos > 0 && <p className="text-xs text-amber-700">Alguns pastos falharam. Eles podem ser reprocessados numa nova consulta.</p>}
            {acompanhamento.error && <p className="text-xs text-red-600">{mensagemDoErro(acompanhamento.error)}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
