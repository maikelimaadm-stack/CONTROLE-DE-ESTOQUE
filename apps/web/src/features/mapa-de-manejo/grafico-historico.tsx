"use client";
import * as React from "react";
import { dateBR, num } from "@/lib/utils";
import { pontosDoGrafico, type HistoricoIndice, serieDoHistorico } from "./condicao-modelo";
import { corDoValor, escalaDeCodificacao, nomeDoIndice, type IdIndice } from "./paletas-indices";

const L = 280;
const A = 84;
const M = 6;

/**
 * Histórico simples do índice: uma linha do tempo na escala FIXA de codificação do índice (nunca ajustada aos dados).
 * Ponto vazado = observação com cobertura baixa (menos confiável).
 */
export function GraficoHistorico({ indice, historico }: { indice: IdIndice; historico: HistoricoIndice }) {
  const serie = React.useMemo(() => serieDoHistorico(historico.itens), [historico.itens]);
  const escala = escalaDeCodificacao(indice);
  const pontos = React.useMemo(() => pontosDoGrafico(serie, escala), [serie, escala]);
  const nome = nomeDoIndice(indice);
  if (pontos.length === 0) {
    return <p className="text-xs text-slate-500" data-testid="condicao-historico-vazio">Nenhuma observação de {nome} no período para o contorno atual.</p>;
  }
  const x = (v: number) => M + v * (L - 2 * M);
  const y = (v: number) => A - M - v * (A - 2 * M);
  return (
    <div className="flex flex-col gap-1" data-testid="condicao-historico">
      <svg viewBox={`0 0 ${L} ${A}`} className="h-20 w-full" role="img" aria-label={`${nome} médio por imagem, da mais antiga para a mais recente`} data-testid="condicao-historico-grafico">
        <line x1={M} x2={L - M} y1={y(0)} y2={y(0)} stroke="#e2e8f0" strokeWidth={1} />
        <line x1={M} x2={L - M} y1={y(1)} y2={y(1)} stroke="#e2e8f0" strokeWidth={1} />
        {pontos.length > 1 && (
          <polyline fill="none" stroke="#475569" strokeWidth={1.5} points={pontos.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")} />
        )}
        {pontos.map((p) => {
          const [r, g, b] = corDoValor(indice, p.valor);
          return (
            <circle key={p.data} cx={x(p.x)} cy={y(p.y)} r={3} fill={p.qualidadeOk ? `rgb(${r} ${g} ${b})` : "#ffffff"} stroke="#334155" strokeWidth={0.8}>
              <title>{`${dateBR(p.data)}: ${num(p.valor, 2)}${p.qualidadeOk ? "" : " (cobertura baixa)"}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{dateBR(pontos[0]!.data)}</span>
        <span>escala fixa {num(escala.min, 1)} a {num(escala.max, 1)}</span>
        <span>{dateBR(pontos[pontos.length - 1]!.data)}</span>
      </div>
      <ul className="max-h-28 overflow-auto text-xs tabular-nums" data-testid="condicao-historico-lista">
        {[...pontos].reverse().map((p) => (
          <li key={p.data} className="flex items-center gap-2 py-0.5" data-testid="condicao-historico-item">
            <span className="text-slate-600">{dateBR(p.data)}</span>
            <span className="ml-auto font-medium text-slate-800">{num(p.valor, 2)}</span>
            {!p.qualidadeOk && <span className="text-[10px] text-amber-700">cobertura baixa</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
