"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { Button, Dialog, Input, NativeSelect } from "@/components/ui";
import { dateTimeBR, num } from "@/lib/utils";
import type { AreaNoMapa } from "./mapa-base";
import { CHAVE_CONDICAO } from "./condicao-dados";
import { useAuth } from "@/lib/auth";
import {
  JANELAS_DIAS_OPCOES,
  LIMITE_AREAS_NA_CONSULTA,
  PERIODO_PADRAO,
  ROTULO_CADENCIA,
  ROTULO_SELECAO,
  ROTULO_SITUACAO_CONSULTA,
  ROTULO_TIPO_PERIODO,
  TOLERANCIAS_DIAS_OPCOES,
  TOLERANCIA_DIAS_PADRAO,
  chaveDaPrevia,
  consultaTerminou,
  itensDaConsulta,
  montarCorpoConsulta,
  previaCorrespondeAoPedido,
  progressoDaConsulta,
  resolverAlvo,
  validarPeriodo,
  type ConsultaCriada,
  type ConsultaDto,
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
import {
  GestorTentativasPrevia,
  ehAbortError,
  marcarErroTentativa,
  montarSnapshotPedido,
  type PedidoTentativaPrevia
} from "./previa-tentativa";
import { textoLinhaResumoPedido, textoProgressoAnalises } from "./resumo-pedido";

type PreviaComChave = PreviaConsulta & { chave: string; tentativaId?: number };

const INTERVALO_ACOMPANHAMENTO_MS = 3000;

/** Seleções do popup enxuto (avançadas ficam recolhidas). */
const SELECAO_PRINCIPAL: readonly SelecaoConsulta[] = ["empresa", "viewport", "escolhidas"];
const SELECAO_AVANCADA: readonly SelecaoConsulta[] = ["retiro", "sem_analise", "desatualizadas"];

export interface NovaConsultaProps {
  aberto: boolean;
  onFechar: () => void;
  areas: readonly AreaNoMapa[];
  areaAtualId: string | null;
  idsNaVista: readonly string[];
  idsSemAnalise: readonly string[];
  idsDesatualizadas: readonly string[] | null;
  /** Legado — não escolhe índice; o pacote é sempre pastagem_essencial. */
  indiceAtivo?: string;
  selecaoInicial?: SelecaoConsulta;
  onConcluida?: () => void;
  totalAreas?: number;
  totalHa?: number;
  consultaIdInicial?: string | null;
  modoAcompanhar?: boolean;
  filaDisponivel?: boolean | null;
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

/**
 * Popup enxuto "Analisar áreas": áreas + período + uma linha ha/crédito + um botão.
 * Bundle pastagem_essencial (6 índices + condição). Sem checkboxes de índice.
 */
export function NovaConsultaModal(p: NovaConsultaProps) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [selecao, setSelecao] = React.useState<SelecaoConsulta>(p.selecaoInicial ?? "empresa");
  const [escolhidas, setEscolhidas] = React.useState<ReadonlySet<string>>(new Set());
  const [retiroId, setRetiroId] = React.useState("");
  const [periodo, setPeriodo] = React.useState<PeriodoDoFormulario>(PERIODO_PADRAO);
  const [busca, setBusca] = React.useState("");
  const [previa, setPrevia] = React.useState<PreviaComChave | null>(null);
  const [consultaId, setConsultaId] = React.useState<string | null>(null);
  const [avancadasAbertas, setAvancadasAbertas] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [avisoFilaAoCriar, setAvisoFilaAoCriar] = React.useState(false);
  const avisouConclusaoRef = React.useRef<string | null>(null);
  const previaAbortRef = React.useRef<AbortController | null>(null);
  const pedidoEnvioRef = React.useRef<{ chave: string } | null>(null);
  const gestorPreviaRef = React.useRef(new GestorTentativasPrevia());
  const chavePedidoAtualRef = React.useRef<string | null>(null);
  const snapshotPedidoRef = React.useRef<ReturnType<typeof montarSnapshotPedido> | null>(null);

  React.useEffect(() => {
    if (!p.aberto) {
      gestorPreviaRef.current.invalidar();
      previaAbortRef.current?.abort();
      return;
    }
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
    gestorPreviaRef.current.invalidar();
    if (p.modoAcompanhar && p.consultaIdInicial) {
      setConsultaId(p.consultaIdInicial);
    } else {
      setConsultaId(null);
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

  const hoje = new Date().toISOString().slice(0, 10);
  const periodoValidado = validarPeriodo(periodo, hoje);
  const itens = periodoValidado.ok && resolvido.ok ? itensDaConsulta(resolvido.quantidade, periodoValidado.slots) : null;
  const itensDemais = itens !== null && itens > LIMITE_AREAS_NA_CONSULTA;
  const motivoBloqueio = !resolvido.ok ? resolvido.motivo
    : !periodoValidado.ok ? periodoValidado.motivo
    : itensDemais ? `São ${itens} itens (áreas × recortes de tempo); o máximo é ${LIMITE_AREAS_NA_CONSULTA} por consulta.`
    : null;

  const mudarPeriodo = (prox: PeriodoDoFormulario) => { setPeriodo(prox); setPrevia(null); setErro(null); };
  const mudarSelecao = (s: SelecaoConsulta) => { setSelecao(s); setPrevia(null); setErro(null); };

  const filtradas = p.areas.filter((a) => a.geometria && (!busca || a.name.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR"))));
  const haEscolhidas = React.useMemo(() => {
    let s = 0;
    for (const a of p.areas) if (escolhidas.has(a.id)) s += Number(a.area_ha) || 0;
    return s;
  }, [p.areas, escolhidas]);

  const chavePedidoAtual = React.useMemo(() => {
    if (!resolvido.ok || !periodoValidado.ok) return null;
    return chaveDaPrevia({
      organizationId: session?.orgId ?? null,
      empresaId: session?.empresaId ?? null,
      alvo: resolvido.alvo,
      periodo: periodoValidado.periodo
    });
  }, [resolvido, periodoValidado, session?.orgId, session?.empresaId]);
  chavePedidoAtualRef.current = chavePedidoAtual;
  snapshotPedidoRef.current = (resolvido.ok && periodoValidado.ok)
    ? montarSnapshotPedido({
      organizationId: session?.orgId ?? null,
      empresaId: session?.empresaId ?? null,
      alvo: resolvido.alvo,
      periodo: periodoValidado.periodo
    })
    : null;

  const previaValida = previaCorrespondeAoPedido(previa, chavePedidoAtual);

  const haDoAlvo = React.useMemo(() => {
    if (selecao === "escolhidas") return haEscolhidas;
    if (selecao === "viewport") {
      return p.areas.filter((a) => p.idsNaVista.includes(a.id)).reduce((s, a) => s + (Number(a.area_ha) || 0), 0);
    }
    if (selecao === "sem_analise") {
      return p.areas.filter((a) => p.idsSemAnalise.includes(a.id)).reduce((s, a) => s + (Number(a.area_ha) || 0), 0);
    }
    if (selecao === "desatualizadas" && p.idsDesatualizadas) {
      const ids = p.idsDesatualizadas;
      return p.areas.filter((a) => ids.includes(a.id)).reduce((s, a) => s + (Number(a.area_ha) || 0), 0);
    }
    if (selecao === "empresa" && p.totalHa !== undefined) return p.totalHa;
    return null;
  }, [selecao, haEscolhidas, p.areas, p.idsNaVista, p.idsSemAnalise, p.idsDesatualizadas, p.totalHa]);

  const areasUnicasDoAlvo = React.useMemo(() => {
    if (resolvido.ok && resolvido.quantidade !== null) return resolvido.quantidade;
    if (selecao === "empresa" && p.totalAreas !== undefined) return p.totalAreas;
    return null;
  }, [resolvido, selecao, p.totalAreas]);

  const linhaResumo = React.useMemo(() => {
    const periodos = periodoValidado.ok ? periodoValidado.slots : null;
    if (previaValida && previa) {
      const analises = previa.total_itens;
      return textoLinhaResumoPedido({
        areasUnicas: areasUnicasDoAlvo,
        periodos,
        analises,
        areasIgnoradas: previa.areas_ignoradas?.length ?? 0,
        hectares: haDoAlvo,
        formatarHa: (ha) => num(ha, 1)
      });
    }
    return textoLinhaResumoPedido({
      areasUnicas: areasUnicasDoAlvo,
      periodos: periodos != null && periodos > 1 ? periodos : null,
      analises: itens,
      hectares: haDoAlvo,
      formatarHa: (ha) => num(ha, 1)
    });
  }, [previaValida, previa, areasUnicasDoAlvo, periodoValidado, haDoAlvo, itens]);

  // Prévia: snapshot + tentativa; sucesso E erro conferem a tentativa vigente (ref, não closure).
  const previaAuto = useMutation({
    mutationFn: async (pedido: PedidoTentativaPrevia) => {
      previaAbortRef.current?.abort();
      const ac = new AbortController();
      previaAbortRef.current = ac;
      const corpo = montarCorpoConsulta(pedido.alvo, pedido.periodo, false);
      try {
        const r = await api<PreviaConsulta>("/api/satelite/consultas", { method: "POST", body: corpo, signal: ac.signal });
        return { ...r, chave: pedido.chave, tentativaId: pedido.tentativaId };
      } catch (e) {
        throw marcarErroTentativa(e, { id: pedido.tentativaId, chave: pedido.chave });
      }
    },
    onSuccess: (r) => {
      if (!gestorPreviaRef.current.deveAplicar(
        { tentativaId: r.tentativaId, chave: r.chave },
        chavePedidoAtualRef.current
      )) return;
      setPrevia(r);
      setErro(null);
    },
    onError: (e) => {
      if (ehAbortError(e)) return;
      const tentativaId = (e as { tentativaId?: number }).tentativaId;
      const chave = (e as { chave?: string }).chave;
      if (tentativaId == null || !chave) return;
      if (!gestorPreviaRef.current.deveAplicar(
        { tentativaId, chave },
        chavePedidoAtualRef.current
      )) return;
      setPrevia(null);
      setErro(mensagemDoErro(e));
    }
  });

  // Depende só da chave (string estável). `resolvido`/`periodoValidado` mudam de identidade
  // a cada render — se entrassem nas deps, setErro/setPrevia re-disparariam a prévia e
  // apagariam o erro vigente com uma segunda tentativa.
  React.useEffect(() => {
    if (!p.aberto || consultaId || motivoBloqueio || !chavePedidoAtual) {
      if (motivoBloqueio) {
        setPrevia(null);
        gestorPreviaRef.current.invalidar();
      }
      return;
    }
    if (previa && previa.chave !== chavePedidoAtual) setPrevia(null);
    const t = window.setTimeout(() => {
      const snapshot = snapshotPedidoRef.current;
      if (!snapshot || snapshot.chave !== chavePedidoAtualRef.current) return;
      const tentativa = gestorPreviaRef.current.iniciar(snapshot.chave);
      previaAuto.mutate({ ...snapshot, tentativaId: tentativa.id });
    }, 280);
    return () => {
      window.clearTimeout(t);
      previaAbortRef.current?.abort();
    };
  }, [p.aberto, consultaId, chavePedidoAtual, motivoBloqueio]);

  const pedir = useMutation({
    mutationFn: async () => {
      if (!resolvido.ok) throw new Error(resolvido.motivo);
      if (!periodoValidado.ok) throw new Error(periodoValidado.motivo);
      if (!chavePedidoAtual || !previaCorrespondeAoPedido(previa, chavePedidoAtual)) {
        throw new Error("Aguarde a estimativa do pedido atual antes de analisar.");
      }
      if (previa?.excede_orcamento) throw new Error("A estimativa passa do saldo do mês.");
      pedidoEnvioRef.current = { chave: chavePedidoAtual };
      const corpo = montarCorpoConsulta(resolvido.alvo, periodoValidado.periodo, true);
      return api<ConsultaCriada>("/api/satelite/consultas", {
        method: "POST",
        body: corpo,
        idempotencyKey: `consulta:${chavePedidoAtual}`
      });
    },
    onSuccess: (criada) => {
      setErro(null);
      setConsultaId(criada.consulta.id);
      if (p.filaDisponivel === false) setAvisoFilaAoCriar(true);
      p.onConsultaEmAndamento?.(criada.consulta.id);
      void qc.invalidateQueries({ queryKey: ["mapa-geral", "operacao-analise"] });
    },
    onError: (e) => setErro(mensagemDoErro(e))
  });

  const reprocessar = useMutation({
    mutationFn: async (id: string) => {
      return api<{ consulta: ConsultaDto; reprocessados: number; reaproveitados: number }>(
        `/api/satelite/consultas/${id}/reprocessar-falhas`,
        { method: "POST", idempotencyKey: `reprocessar:${id}` }
      );
    },
    onSuccess: (r) => {
      setErro(null);
      setConsultaId(r.consulta.id);
      avisouConclusaoRef.current = null;
      p.onConsultaEmAndamento?.(r.consulta.id);
      void qc.invalidateQueries({ queryKey: [...CHAVE_CONDICAO, "consulta", r.consulta.id] });
      void qc.invalidateQueries({ queryKey: ["mapa-geral", "operacao-analise"] });
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

  const emProgresso = consultaId !== null;
  const excede = Boolean(previaValida && previa?.excede_orcamento);
  const calculandoPrevia = !emProgresso && !motivoBloqueio && Boolean(chavePedidoAtual) && previaAuto.isPending;
  const podeAnalisar = !emProgresso
    && !motivoBloqueio
    && previaValida
    && !excede
    && !pedir.isPending
    && !previaAuto.isPending;

  const tituloModal = p.modoAcompanhar && emProgresso && !terminou
    ? "Há uma análise em andamento"
    : "Analisar áreas";

  const radioSelecao = (s: SelecaoConsulta) => {
    const indisponivel = (s === "desatualizadas" && p.idsDesatualizadas === null);
    return (
      <label key={s} className={`flex min-h-11 items-center gap-2 ${indisponivel ? "text-slate-400" : "text-slate-700"}`}>
        <input type="radio" name="selecao-consulta" className="accent-brand-500" checked={selecao === s} disabled={indisponivel || emProgresso} onChange={() => mudarSelecao(s)} data-testid={`consulta-selecao-${s}`} />
        <span>{s === "empresa" ? "Todas as áreas do contexto" : ROTULO_SELECAO[s]}</span>
        {s === "empresa" && p.totalAreas !== undefined && (
          <span className="text-xs tabular-nums text-slate-500" data-testid="consulta-todos-contador">
            ({p.totalAreas}{p.totalHa !== undefined ? ` · ${num(p.totalHa, 1)} ha` : ""})
          </span>
        )}
        {s === "viewport" && <span className="text-xs tabular-nums text-slate-500">({p.idsNaVista.length})</span>}
        {s === "sem_analise" && <span className="text-xs tabular-nums text-slate-500">({p.idsSemAnalise.length})</span>}
        {s === "desatualizadas" && (
          <span className="text-xs tabular-nums text-slate-500">
            ({p.idsDesatualizadas === null ? "indisponível" : p.idsDesatualizadas.length})
          </span>
        )}
      </label>
    );
  };

  return (
    <Dialog
      open={p.aberto}
      onOpenChange={(o) => { if (!o) p.onFechar(); }}
      title={tituloModal}
      description={emProgresso
        ? "A análise continua no servidor. Fechar não cancela."
        : "Uma análise gera Condição, Umidade, Vigor, Cobertura e Solo."}
      size="md"
      testId="consulta-modal"
      footer={emProgresso ? (
        <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="consulta-fechar">
          {terminou ? "Fechar" : "Continuar em segundo plano"}
        </Button>
      ) : (
        <>
          <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="consulta-fechar">Cancelar</Button>
          <Button
            type="button"
            disabled={!podeAnalisar}
            loading={pedir.isPending}
            onClick={() => pedir.mutate()}
            data-testid="consulta-confirmar"
          >
            Analisar áreas
          </Button>
          {/* Compat E2E legado: mesmo CTA — um clique inicia (sem etapa Continuar). */}
          <button type="button" className="sr-only" data-testid="consulta-continuar" tabIndex={-1} disabled={!podeAnalisar || pedir.isPending} onClick={() => pedir.mutate()} />
        </>
      )}
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="consulta-conteudo" data-etapa={emProgresso ? 3 : 1}>
        {p.modoAcompanhar && emProgresso && !terminou && (
          <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700" data-testid="consulta-em-andamento-aviso">
            Há uma análise em andamento. Acompanhe o progresso — não é necessário iniciar outra.
          </p>
        )}

        {!emProgresso && (
          <>
            <fieldset className="flex flex-col gap-0.5" disabled={emProgresso}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Áreas</legend>
              {SELECAO_PRINCIPAL.map(radioSelecao)}
            </fieldset>

            {selecao === "escolhidas" && (
              <div className="flex flex-col gap-1 rounded border border-slate-200 p-2" data-testid="consulta-escolhidas">
                <Input placeholder="Buscar área" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar área" />
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button type="button" className="min-h-10 rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50" data-testid="consulta-selecionar-todas" onClick={() => {
                    setEscolhidas(new Set(filtradas.map((a) => a.id))); setPrevia(null);
                  }}>Selecionar todas</button>
                  <button type="button" className="min-h-10 rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50" data-testid="consulta-limpar-escolhidas" onClick={() => {
                    setEscolhidas(new Set()); setPrevia(null);
                  }}>Limpar</button>
                </div>
                <ul className="max-h-36 overflow-auto">
                  {filtradas.map((a) => (
                    <li key={a.id}>
                      <label className="flex min-h-10 items-center gap-2 py-0.5 text-[13px]">
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
                  {escolhidas.size} áreas · {num(haEscolhidas, 1)} ha
                </span>
              </div>
            )}

            <div className="rounded border border-slate-200 p-2" data-testid="consulta-periodo-resumo">
              <p className="text-xs text-slate-600">Período: <span className="font-medium text-slate-800">{ROTULO_TIPO_PERIODO[periodo.tipo] ?? ROTULO_TIPO_PERIODO.mais_recente}</span></p>
              <div className="mt-2" data-testid="consulta-opcoes-avancadas">
                <button
                  type="button"
                  className="min-h-10 text-xs font-semibold text-slate-600 underline hover:text-slate-800"
                  aria-expanded={avancadasAbertas}
                  onClick={() => setAvancadasAbertas((v) => !v)}
                  data-testid="consulta-opcoes-avancadas-toggle"
                >
                  Mais opções
                </button>
                {avancadasAbertas && (
                  <div className="mt-2 flex flex-col gap-2">
                    <fieldset className="flex flex-col gap-0.5">
                      <legend className="text-[10px] font-semibold uppercase text-slate-500">Outras seleções</legend>
                      {SELECAO_AVANCADA.map(radioSelecao)}
                    </fieldset>
                    {selecao === "retiro" && (
                      <NativeSelect value={retiroId} onChange={(e) => { setRetiroId(e.target.value); setPrevia(null); }} data-testid="consulta-retiro" aria-label="Retiro">
                        <option value="">{retiros.isLoading ? "Carregando…" : "Escolha o retiro"}</option>
                        {opcoesRetiro.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </NativeSelect>
                    )}
                    <fieldset className="flex flex-col gap-1.5" data-testid="consulta-periodo">
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
                          Janela (dias)
                          <NativeSelect value={periodo.janelaDias} onChange={(e) => mudarPeriodo({ tipo: "mais_recente", janelaDias: Number(e.target.value) })} data-testid="consulta-janela" aria-label="Janela em dias">
                            {JANELAS_DIAS_OPCOES.map((d) => <option key={d} value={d}>{d} dias</option>)}
                          </NativeSelect>
                        </label>
                      )}
                      {periodo.tipo === "data" && (
                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-data">
                            Data
                            <Input type="date" value={periodo.data} onChange={(e) => mudarPeriodo({ ...periodo, data: e.target.value })} />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-slate-600">
                            Tolerância
                            <NativeSelect value={periodo.toleranciaDias} onChange={(e) => mudarPeriodo({ ...periodo, toleranciaDias: Number(e.target.value) })} data-testid="consulta-tolerancia" aria-label="Tolerância em dias">
                              {TOLERANCIAS_DIAS_OPCOES.map((d) => <option key={d} value={d}>{d === 0 ? "Só a data" : `± ${d} d`}</option>)}
                            </NativeSelect>
                          </label>
                        </div>
                      )}
                      {periodo.tipo === "intervalo" && (
                        <div className="grid grid-cols-3 gap-2">
                          <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-de">De<Input type="date" value={periodo.de} onChange={(e) => mudarPeriodo({ ...periodo, de: e.target.value })} /></label>
                          <label className="flex flex-col gap-1 text-xs text-slate-600" data-testid="consulta-ate">Até<Input type="date" value={periodo.ate} onChange={(e) => mudarPeriodo({ ...periodo, ate: e.target.value })} /></label>
                          <label className="flex flex-col gap-1 text-xs text-slate-600">Cadência
                            <NativeSelect value={periodo.cadencia} onChange={(e) => mudarPeriodo({ ...periodo, cadencia: e.target.value as "mensal" | "decendial" })} data-testid="consulta-cadencia" aria-label="Cadência">
                              {(Object.keys(ROTULO_CADENCIA) as ("mensal" | "decendial")[]).map((c) => <option key={c} value={c}>{ROTULO_CADENCIA[c]}</option>)}
                            </NativeSelect>
                          </label>
                        </div>
                      )}
                    </fieldset>
                  </div>
                )}
              </div>
            </div>

            {linhaResumo && (
              <p className="text-sm font-medium tabular-nums text-slate-800" data-testid="consulta-linha-resumo">{linhaResumo}</p>
            )}

            {calculandoPrevia && (
              <p className="text-xs text-slate-500" data-testid="consulta-previa-calculando">Calculando estimativa…</p>
            )}

            {previaValida && previa && (
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700" data-testid="consulta-previa-resultado">
                <span data-testid="consulta-previa-creditos">
                  Estimativa: {num(previa.estimativa_creditos.minimo, 2)}–{num(previa.estimativa_creditos.maximo, 2)} créditos
                  {previa.saldo_creditos_mes !== null && <> · saldo {num(previa.saldo_creditos_mes, 2)}</>}
                </span>
                {previa.excede_orcamento && <p className="mt-1 text-red-600" data-testid="consulta-excede">A estimativa passa do saldo do mês.</p>}
                {previa.areas_ignoradas.length > 0 && (
                  <p className="mt-1 text-amber-700">{previa.areas_ignoradas.length} área(s) fora do pedido (sem contorno ou sem autorização).</p>
                )}
              </div>
            )}

            {motivoBloqueio && <p className="text-xs text-amber-700" data-testid="consulta-alvo-invalido">{motivoBloqueio}</p>}
            {erro && !emProgresso && (
              <div className="flex flex-col gap-1" data-testid="consulta-erro-bloco">
                <p className="text-xs text-red-600" role="alert" data-testid="consulta-erro">{erro}</p>
                {chavePedidoAtual && resolvido.ok && periodoValidado.ok && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start min-h-11 sm:min-h-0"
                    data-testid="consulta-previa-retry"
                    onClick={() => {
                      const snapshot = montarSnapshotPedido({
                        organizationId: session?.orgId ?? null,
                        empresaId: session?.empresaId ?? null,
                        alvo: resolvido.alvo,
                        periodo: periodoValidado.periodo
                      });
                      if (snapshot.chave !== chavePedidoAtual) return;
                      const tentativa = gestorPreviaRef.current.iniciar(snapshot.chave);
                      previaAuto.mutate({ ...snapshot, tentativaId: tentativa.id });
                    }}
                  >
                    Tentar estimativa de novo
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {emProgresso && (
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
                {textoProgressoAnalises(feitos, consulta.total_itens, consulta.total_falhos)}
                {consulta.concluida_em && <> · terminou em {dateTimeBR(consulta.concluida_em)}</>}
              </div>
            )}
            {mostrarAvisoFila && (
              <p className="text-xs text-amber-800" data-testid="consulta-fila-indisponivel" role="status">{MSG_FILA_INDISPONIVEL}</p>
            )}
            {terminou && consulta && consulta.total_falhos > 0 && (
              <div className="flex flex-col gap-1.5" data-testid="consulta-falha-parcial">
                <p className="text-xs text-amber-700">
                  Algumas análises falharam. Conclua a análise para reprocessar só as faltantes — o que já está pronto é reaproveitado.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="self-start min-h-11 sm:min-h-0"
                  loading={reprocessar.isPending}
                  disabled={reprocessar.isPending}
                  onClick={() => reprocessar.mutate(consulta.id)}
                  data-testid="consulta-reprocessar-falhas"
                >
                  Concluir análise
                </Button>
                {erro && <p className="text-xs text-red-600" role="alert" data-testid="consulta-erro">{erro}</p>}
              </div>
            )}
            {acompanhamento.error && <p className="text-xs text-red-600">{mensagemDoErro(acompanhamento.error)}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
