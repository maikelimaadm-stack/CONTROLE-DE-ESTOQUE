"use client";
/**
 * Painéis do Dialog central por tema operacional — SAT-BUNDLE-01B [F2].
 * Conteúdo muda com o tema; não inicia análise nem gera raster.
 */
import * as React from "react";
import { AVISO_UMIDADE_NAO_E_SOLO } from "@agro/domain";
import { num } from "@/lib/utils";
import { faixasDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export function PainelTemaContinuo(p: {
  tema: Exclude<TemaMapaPasto, "condicao">;
  medias: Partial<Record<string, string | null>> | null;
  coberturaValida?: string | null;
  dataImagem: string | null;
}) {
  const faixas = faixasDoTema(p.tema);
  const titulo =
    p.tema === "umidade" ? "Umidade do pasto"
    : p.tema === "vigor" ? "Vigor da vegetação"
    : p.tema === "cobertura" ? "Cobertura vegetal"
    : "Exposição de solo estimada";
  const fonte =
    p.tema === "umidade" ? "ndmi"
    : p.tema === "vigor" ? "ndre"
    : p.tema === "cobertura" ? "msavi2"
    : "bsi";
  const media = p.medias?.[fonte] ?? null;
  const mediaNum = media !== null && media !== undefined && media !== "" ? Number(media) : null;
  const cobertura = p.coberturaValida != null && p.coberturaValida !== ""
    ? Number(p.coberturaValida)
    : null;

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
        <CardNum rotulo={`${fonte.toUpperCase()} médio`} valor={mediaNum !== null && Number.isFinite(mediaNum) ? num(mediaNum, 2) : "—"} />
        <CardNum
          rotulo="Cobertura válida"
          valor={cobertura !== null && Number.isFinite(cobertura) ? `${num(cobertura * 100, 0)}%` : "—"}
        />
      </div>
      {p.tema === "vigor" && (
        <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500" data-testid="painel-tema-apoio-vigor">
          Apoio: NDVI {fmtMedia(p.medias?.ndvi)} · EVI2 {fmtMedia(p.medias?.evi2)}
        </div>
      )}
      {faixas && (
        <ul className="flex flex-col gap-0.5" data-testid="painel-tema-faixas">
          {faixas.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: f.cor }} aria-hidden />
              <span className="text-slate-700">{f.rotulo}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">
        Análise baseada em grade de 20 m; contornos suavizados apenas para visualização.
      </p>
    </div>
  );
}

function CardNum({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800">{valor}</div>
    </div>
  );
}

function fmtMedia(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? num(n, 2) : "—";
}
