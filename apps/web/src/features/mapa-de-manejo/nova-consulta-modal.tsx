"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { Button, Dialog, Input, NativeSelect } from "@/components/ui";
import { DATA_MINIMA_SENTINEL2_L2A } from "@agro/domain";
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
 * Modal "Nova consulta": escolhe quais áreas e a janela, mostra a PRÉVIA de custo (nada é gravado) e só então cria a
 * consulta, acompanhando o progresso na API. A consulta roda em fila no servidor; fechar o modal não a cancela.
 */
export function NovaConsultaModal(p: NovaConsultaProps) {
  const qc = useQueryClient();
  const [selecao, setSelecao] = React.useState<SelecaoConsulta>(p.selecaoInicial ?? "atual");
  const [escolhidas, setEscolhidas] = React.useState<ReadonlySet<string>>(new Set());
  const [retiroId, setRetiroId] = React.useState("");
  const [periodo, setPeriodo] = React.useState<PeriodoDoFormulario>(PERIODO_PADRAO);
  const [busca, setBusca] = React.useState("");
  const [previa, setPrevia] = React.useState<PreviaConsulta | null>(null);
  const [consultaId, setConsultaId] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const avisouConclusaoRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!p.aberto) return;
    setSelecao(p.selecaoInicial ?? (p.areaAtualId ? "atual" : "viewport"));
    setPrevia(null);
    setErro(null);
    setConsultaId(null);
    avisouConclusaoRef.current = null;
  }, [p.aberto, p.selecaoInicial, p.areaAtualId]);

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
  const hoje = React.useMemo(() => new Date().toISOString().slice(0, 10), [p.aberto]);
  const periodoValidado = validarPeriodo(periodo, hoje);
  const itens = periodoValidado.ok && resolvido.ok ? itensDaConsulta(resolvido.quantidade, periodoValidado.slots) : null;
  const itensDemais = itens !== null && itens > LIMITE_AREAS_NA_CONSULTA;
  const motivoBloqueio = !resolvido.ok ? resolvido.motivo
    : !periodoValidado.ok ? periodoValidado.motivo
    : itensDemais ? `São ${itens} itens (áreas × recortes de tempo); o máximo é ${LIMITE_AREAS_NA_CONSULTA} por consulta. Reduza a seleção ou o período.`
    : null;
  const mudarPeriodo = (prox: PeriodoDoFormulario) => { setPeriodo(prox); setPrevia(null); setErro(null); };
  const hojeNoCampo = hoje;

  const pedir = useMutation({
    mutationFn: async (confirmar: boolean) => {
      if (!resolvido.ok) throw new Error(resolvido.motivo);
      if (!periodoValidado.ok) throw new Error(periodoValidado.motivo);
      const corpo = montarCorpoConsulta(resolvido.alvo, periodoValidado.periodo, confirmar);
      return api<PreviaConsulta | ConsultaCriada>("/api/satelite/consultas", { method: "POST", body: corpo });
    },
    onSuccess: (r, confirmar) => {
      setErro(null);
      if (confirmar) setConsultaId((r as ConsultaCriada).consulta.id);
      else setPrevia(r as PreviaConsulta);
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

  const { onConcluida } = p;
  React.useEffect(() => {
    if (!consulta || !terminou || avisouConclusaoRef.current === consulta.id) return;
    avisouConclusaoRef.current = consulta.id;
    void qc.invalidateQueries({ queryKey: CHAVE_CONDICAO });
    void qc.invalidateQueries({ queryKey: ["mapa-geral", "ndvi"] });
    onConcluida?.();
  }, [consulta, terminou, qc, onConcluida]);

  const mudarSelecao = (s: SelecaoConsulta) => { setSelecao(s); setPrevia(null); setErro(null); };
  const filtradas = p.areas.filter((a) => a.geometria && (!busca || a.name.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR"))));
  const bloqueado = consultaId !== null;

  return (
    <Dialog
      open={p.aberto}
      onOpenChange={(o) => { if (!o) p.onFechar(); }}
      title="Nova consulta de satélite"
      description="Busca a imagem útil das áreas escolhidas (a mais recente, a de uma data ou uma por mês/decêndio de um intervalo) e calcula a condição (vigor, umidade e cobertura). Gasta créditos de satélite."
      size="lg"
      testId="consulta-modal"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="consulta-fechar">{terminou ? "Fechar" : bloqueado ? "Continuar em segundo plano" : "Cancelar"}</Button>
          {!bloqueado && (
            <>
              <Button type="button" variant="outline" disabled={motivoBloqueio !== null || pedir.isPending} loading={pedir.isPending && !previa} onClick={() => pedir.mutate(false)} data-testid="consulta-previa">
                Ver prévia de custo
              </Button>
              <Button type="button" disabled={!previa || previa.excede_orcamento || motivoBloqueio !== null || pedir.isPending} loading={pedir.isPending && Boolean(previa)} onClick={() => pedir.mutate(true)} data-testid="consulta-confirmar">
                Confirmar consulta
              </Button>
            </>
          )}
        </>
      )}
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="consulta-conteudo">
        <fieldset className="flex flex-col gap-1.5" disabled={bloqueado}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quais áreas</legend>
          {ORDEM_SELECAO.map((s) => {
            const indisponivel = (s === "atual" && !p.areaAtualId) || (s === "desatualizadas" && p.idsDesatualizadas === null);
            return (
              <label key={s} className={`flex items-center gap-2 ${indisponivel ? "text-slate-400" : "text-slate-700"}`}>
                <input type="radio" name="selecao-consulta" className="accent-brand-500" checked={selecao === s} disabled={indisponivel} onChange={() => mudarSelecao(s)} data-testid={`consulta-selecao-${s}`} />
                <span>{ROTULO_SELECAO[s]}</span>
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

        {selecao === "escolhidas" && !bloqueado && (
          <div className="flex flex-col gap-1 rounded border border-slate-200 p-2" data-testid="consulta-escolhidas">
            <Input placeholder="Buscar área" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar área" />
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
                  </label>
                </li>
              ))}
            </ul>
            <span className="text-xs text-slate-500">{escolhidas.size} de no máximo {LIMITE_AREAS_NA_CONSULTA} áreas</span>
          </div>
        )}

        {selecao === "retiro" && !bloqueado && (
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Retiro
            <NativeSelect value={retiroId} onChange={(e) => { setRetiroId(e.target.value); setPrevia(null); }} data-testid="consulta-retiro" aria-label="Retiro">
              <option value="">{retiros.isLoading ? "Carregando…" : "Escolha o retiro"}</option>
              {opcoesRetiro.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          </label>
        )}

        <fieldset className="flex flex-col gap-1.5" disabled={bloqueado} data-testid="consulta-periodo">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Período</legend>
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
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Data da imagem
                <Input type="date" value={periodo.data} min={DATA_MINIMA_SENTINEL2_L2A} max={hojeNoCampo} onChange={(e) => mudarPeriodo({ ...periodo, data: e.target.value })} data-testid="consulta-data" aria-label="Data da imagem" />
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
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                De
                <Input type="date" value={periodo.de} min={DATA_MINIMA_SENTINEL2_L2A} max={hojeNoCampo} onChange={(e) => mudarPeriodo({ ...periodo, de: e.target.value })} data-testid="consulta-de" aria-label="Data inicial" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Até
                <Input type="date" value={periodo.ate} min={DATA_MINIMA_SENTINEL2_L2A} max={hojeNoCampo} onChange={(e) => mudarPeriodo({ ...periodo, ate: e.target.value })} data-testid="consulta-ate" aria-label="Data final" />
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

        {motivoBloqueio && !bloqueado && <p className="text-xs text-amber-700" data-testid="consulta-alvo-invalido">{motivoBloqueio}</p>}
        {erro && <p className="text-xs text-red-600" role="alert" data-testid="consulta-erro">{erro}</p>}

        {previa && !bloqueado && (
          <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-2 text-[13px]" data-testid="consulta-previa-resultado">
            <div className="font-semibold text-slate-700">Prévia (nada foi gravado)</div>
            <div className="tabular-nums">{previa.novos} {previa.novos === 1 ? "item novo" : "itens novos"} · {previa.reaproveitados} já existente{previa.reaproveitados === 1 ? "" : "s"} (sem custo) · {previa.total_itens} no total</div>
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
          </div>
        )}

        {bloqueado && (
          <div className="flex flex-col gap-1 rounded border border-slate-200 p-2" data-testid="consulta-progresso">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-semibold text-slate-700">{consulta ? (ROTULO_SITUACAO_CONSULTA[consulta.situacao] ?? consulta.situacao) : "Criando a consulta…"}</span>
              {consulta && <span className="tabular-nums text-slate-600">{progressoDaConsulta(consulta)}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={consulta ? progressoDaConsulta(consulta) : 0} aria-label="Progresso da consulta">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${consulta ? progressoDaConsulta(consulta) : 0}%` }} />
            </div>
            {consulta && (
              <div className="text-xs tabular-nums text-slate-600">
                {consulta.total_concluidos} concluído(s) · {consulta.total_reaproveitados} reaproveitado(s) · {consulta.total_falhos} com falha · {consulta.total_itens} no total
                {consulta.concluida_em && <> · terminou em {dateTimeBR(consulta.concluida_em)}</>}
              </div>
            )}
            {terminou && consulta && consulta.total_falhos > 0 && <p className="text-xs text-amber-700">Alguns itens falharam. Eles podem ser reprocessados numa nova consulta.</p>}
            {acompanhamento.error && <p className="text-xs text-red-600">{mensagemDoErro(acompanhamento.error)}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
