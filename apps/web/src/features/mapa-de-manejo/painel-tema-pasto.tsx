"use client";
/**
 * Painéis do Dialog central por tema operacional — SAT-BUNDLE-01B [F2] R2.
 * Distribuição = pixels internos; média/min/max = contrato F1 da área selecionada.
 */
import * as React from "react";
import { AVISO_UMIDADE_NAO_E_SOLO } from "@agro/domain";
import { num } from "@/lib/utils";
import {
  FAIXA_SEM_LEITURA_COR, FAIXA_SEM_LEITURA_ID, type DistribuicaoFaixasArea
} from "./distribuicao-faixas-raster";
import { indiceFonteDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export function PainelTemaContinuo(p: {
  tema: Exclude<TemaMapaPasto, "condicao">;
  /** Médias do bulk (fallback). Preferir sinal F1 completo. */
  medias?: Partial<Record<string, string | null>> | null;
  media?: string | null;
  minimo?: string | null;
  maximo?: string | null;
  coberturaValida?: string | null;
  dataImagem: string | null;
  distribuicao?: DistribuicaoFaixasArea | null;
  onFaixa?: (id: string | null) => void;
  faixaAtiva?: string | null;
}) {
  const fonte = indiceFonteDoTema(p.tema)!;
  const titulo =
    p.tema === "umidade" ? "Umidade do pasto"
    : p.tema === "vigor" ? "Vigor da vegetação"
    : p.tema === "cobertura" ? "Cobertura vegetal"
    : "Exposição de solo estimada";

  const media = p.media ?? p.medias?.[fonte] ?? null;
  const mediaNum = parseNum(media);
  const minNum = parseNum(p.minimo);
  const maxNum = parseNum(p.maximo);
  const cobertura = p.distribuicao
    ? p.distribuicao.cobertura_valida
    : parseNum(p.coberturaValida);

  const linhas = p.distribuicao
    ? [...p.distribuicao.faixas, p.distribuicao.sem_leitura]
    : [];

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="painel-tema-pasto" data-tema={p.tema}>
      <p className="text-xs tabular-nums text-slate-500">
        {p.dataImagem ? <>Observação {p.dataImagem}</> : "Sem data"} · 20 m · ● Análise completa
      </p>
      <h3 className="text-sm font-semibold text-slate-800" data-testid="painel-tema-titulo">{titulo}</h3>
      {p.tema === "umidade" && (
        <p className="text-xs text-slate-600" data-testid="painel-tema-aviso-umidade">
          Derivado do NDMI; {AVISO_UMIDADE_NAO_E_SOLO}
        </p>
      )}
      {p.tema === "vigor" && (
        <p className="text-xs text-slate-600" data-testid="painel-tema-aviso-vigor">
          Vigor relativo da vegetação (NDRE). Sem score 0–100.
        </p>
      )}
      {p.tema === "cobertura" && (
        <p className="text-xs text-slate-600" data-testid="painel-tema-aviso-cobertura">
          Resposta de cobertura vegetal (MSAVI2). Não é percentual calibrado de cobertura.
        </p>
      )}
      {p.tema === "solo" && (
        <p className="text-xs text-slate-600" data-testid="painel-tema-aviso-solo">
          Exposição de solo estimada (BSI). Não diagnostica erosão.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2" data-testid="painel-tema-cards">
        <CardNum rotulo={`${fonte.toUpperCase()} médio`} valor={fmt(mediaNum)} testId="painel-tema-media" />
        <CardNum
          rotulo="Cobertura válida"
          valor={cobertura !== null && Number.isFinite(cobertura) ? `${num(cobertura * 100, 0)}%` : "—"}
          testId="painel-tema-cobertura"
        />
        <CardNum rotulo={`${fonte.toUpperCase()} mínimo`} valor={fmt(minNum)} testId="painel-tema-min" />
        <CardNum rotulo={`${fonte.toUpperCase()} máximo`} valor={fmt(maxNum)} testId="painel-tema-max" />
      </div>
      {p.tema === "vigor" && (
        <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500" data-testid="painel-tema-apoio-vigor">
          Apoio: NDVI {fmtMedia(p.medias?.ndvi)} · EVI2 {fmtMedia(p.medias?.evi2)}
        </div>
      )}
      {linhas.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="painel-tema-distribuicao">
          {linhas.map((f) => {
            const ativa = p.faixaAtiva === f.id;
            const opaca = p.faixaAtiva != null && !ativa;
            const sem = f.id === FAIXA_SEM_LEITURA_ID;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  data-testid={`painel-tema-faixa-${f.id}`}
                  aria-pressed={ativa}
                  onClick={() => p.onFaixa?.(ativa ? null : f.id)}
                  className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs ${opaca ? "opacity-40" : ""} hover:bg-slate-50`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-300"
                    style={{ backgroundColor: sem ? FAIXA_SEM_LEITURA_COR : f.cor }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{f.rotulo}</span>
                  <span className="shrink-0 tabular-nums text-slate-600">
                    {num(f.area_estimada_ha, 1)} ha · {num(f.area_estimada_percentual, 0)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!p.distribuicao && (
        <p className="text-[11px] text-amber-700" data-testid="painel-tema-sem-distribuicao">
          Distribuição espacial disponível quando o raster da área estiver carregado.
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        Análise baseada em grade de 20 m; contornos suavizados apenas para visualização. Hectares por faixa = pixels internos ao polígono.
      </p>
    </div>
  );
}

function CardNum({ rotulo, valor, testId }: { rotulo: string; valor: string; testId?: string }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800">{valor}</div>
    </div>
  );
}

function parseNum(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number | null): string {
  return n !== null ? num(n, 2) : "—";
}

function fmtMedia(v: string | null | undefined): string {
  return fmt(parseNum(v));
}
