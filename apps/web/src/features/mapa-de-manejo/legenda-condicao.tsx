"use client";
import * as React from "react";
import {
  CLASSES_CONDICAO_PASTO,
  AVISO_CONDICAO_PASTO_EXPERIMENTAL,
  type CodigoClasseCondicaoPasto,
  type ResumoCondicaoPasto
} from "@agro/domain";
import { num } from "@/lib/utils";

function linhaDe(resumo: ResumoCondicaoPasto | null, codigo: CodigoClasseCondicaoPasto) {
  return resumo?.classes.find((c) => c.codigo === codigo) ?? {
    codigo, id: CLASSES_CONDICAO_PASTO[codigo]!.id, nome: CLASSES_CONDICAO_PASTO[codigo]!.nome,
    cor: CLASSES_CONDICAO_PASTO[codigo]!.cor, pixels: 0, proporcao: "0", area_estimada_ha: "0.00", area_estimada_percentual: "0.0"
  };
}

export function LegendaCondicaoPasto(p: {
  resumo: ResumoCondicaoPasto | null;
  classe: CodigoClasseCondicaoPasto | null;
  onClasse: (c: CodigoClasseCondicaoPasto | null) => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 p-2 shadow-sm" data-testid="legenda-condicao-pasto">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Condição do pasto</p>
      <ul className="flex flex-col gap-0.5">
        {CLASSES_CONDICAO_PASTO.map((c) => {
          const l = linhaDe(p.resumo, c.codigo);
          const ativo = p.classe === c.codigo;
          return (
            <li key={c.codigo}>
              <button
                type="button"
                data-testid={`legenda-classe-${c.id}`}
                aria-pressed={ativo}
                onClick={() => p.onClasse(ativo ? null : c.codigo)}
                className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-100 ${ativo ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: c.cor }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-slate-700">{c.nome}</span>
                <span className="tabular-nums text-slate-600" data-testid={`legenda-ha-${c.id}`}>{num(Number(l.area_estimada_ha), 2)} ha</span>
                <span className="w-10 text-right tabular-nums text-slate-500" data-testid={`legenda-pct-${c.id}`}>{num(Number(l.area_estimada_percentual), 1)}%</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-slate-500">Resolução analítica: 20 m. {AVISO_CONDICAO_PASTO_EXPERIMENTAL}</p>
    </div>
  );
}

export function BarraEmpilhadaCondicao({ resumo }: { resumo: ResumoCondicaoPasto }) {
  const total = resumo.classes.reduce((s, c) => s + Number(c.area_estimada_ha), 0);
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-sm border border-slate-200" data-testid="barra-empilhada-condicao" role="img" aria-label="Distribuição das classes">
      {resumo.classes.map((c) => {
        const pct = total > 0 ? (Number(c.area_estimada_ha) / total) * 100 : 0;
        if (pct <= 0) return null;
        return <span key={c.codigo} style={{ width: `${pct}%`, backgroundColor: c.cor }} title={`${c.nome}: ${c.area_estimada_ha} ha`} />;
      })}
    </div>
  );
}

export function PainelAreaCondicao(p: {
  resumo: ResumoCondicaoPasto | null;
  dataImagem: string | null;
  semAnalise: boolean;
  onAtualizar?: () => void;
  onDadosTecnicos?: () => void;
}) {
  const coberturaPct = p.resumo ? Number((Number(p.resumo.cobertura_valida) * 100).toFixed(0)) : null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-sm" data-testid="painel-area-condicao">
      <p className="text-xs tabular-nums text-slate-500">
        {p.dataImagem ? <>Imagem: {p.dataImagem}</> : "Sem data de imagem"} · Resolução analítica: 20 m
      </p>
      {p.semAnalise && (
        <p className="text-xs text-slate-600" data-testid="condicao-pasto-sem-analise">Sem análise de condição</p>
      )}
      {p.resumo && (
        <>
          <BarraEmpilhadaCondicao resumo={p.resumo} />
          <ul className="grid grid-cols-1 gap-0.5">
            {p.resumo.classes.filter((c) => c.pixels > 0).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-xs" data-testid={`card-classe-${c.id}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: c.cor }} aria-hidden />
                  <span className="truncate text-slate-700">{c.nome}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">{num(Number(c.area_estimada_ha), 2)} ha · {num(Number(c.area_estimada_percentual), 1)}%</span>
              </li>
            ))}
          </ul>
          {coberturaPct !== null && (
            <p className="text-[11px] tabular-nums text-slate-500" data-testid="condicao-cobertura-valida">
              Cobertura válida: {coberturaPct}%
              {Number(p.resumo.cobertura_valida) < 0.8 ? " — Leitura parcial — nuvens/sombras reduziram a área observável." : ""}
            </p>
          )}
          <p className="text-[11px] text-slate-500">{AVISO_CONDICAO_PASTO_EXPERIMENTAL}</p>
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        {p.semAnalise && p.onAtualizar && (
          <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50" onClick={p.onAtualizar} data-testid="condicao-pasto-analisar">
            Analisar condição
          </button>
        )}
        {p.onDadosTecnicos && (
          <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50" onClick={p.onDadosTecnicos} data-testid="condicao-pasto-dados-tecnicos">
            Dados técnicos
          </button>
        )}
      </div>
    </div>
  );
}

export function PainelClasseCondicao(p: {
  codigo: CodigoClasseCondicaoPasto;
  resumos: ReadonlyMap<string, ResumoCondicaoPasto>;
  nomes: ReadonlyMap<string, string>;
  onLimpar: () => void;
}) {
  const c = CLASSES_CONDICAO_PASTO[p.codigo]!;
  const linhas = [...p.resumos.entries()]
    .map(([id, r]) => ({ id, nome: p.nomes.get(id) ?? id, ha: Number(r.classes.find((x) => x.codigo === p.codigo)?.area_estimada_ha ?? 0) }))
    .filter((x) => x.ha > 0)
    .sort((a, b) => b.ha - a.ha);
  const totalHa = linhas.reduce((s, x) => s + x.ha, 0);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm" data-testid="painel-classe-condicao">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-800" style={{ color: c.cor }}>{c.nome}</h3>
        <button type="button" className="text-xs text-slate-500 underline" onClick={p.onLimpar} data-testid="painel-classe-limpar">Limpar</button>
      </div>
      <p className="tabular-nums text-slate-700">Área estimada: {num(totalHa, 2)} ha · {linhas.length} {linhas.length === 1 ? "área" : "áreas"}</p>
      <p className="mt-1 text-xs text-slate-600">{c.interpretacao}</p>
      <p className="mt-1 text-xs text-slate-600">{c.acao}</p>
      <p className="mt-1 text-[11px] text-slate-500">{CLASSES_CONDICAO_PASTO[0] && c.id !== "sem_leitura" ? "Imagem de satélite não confirma causa, degradação ou espécie vegetal." : null}</p>
      {linhas.length > 0 && (
        <ol className="mt-2 flex flex-col gap-0.5 text-xs">
          {linhas.slice(0, 8).map((x) => (
            <li key={x.id} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate text-slate-700">{x.nome}</span>
              <span>{num(x.ha, 2)} ha</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
