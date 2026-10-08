"use client";
import * as React from "react";
import {
  CLASSES_CONDICAO_PASTO,
  AVISO_CONDICAO_PASTO_EXPERIMENTAL,
  badgePrincipalCondicao,
  type CodigoClasseCondicaoPasto,
  type ResumoCondicaoPasto
} from "@agro/domain";
import { Button, Dialog, buttonVariants } from "@/components/ui";
import { num } from "@/lib/utils";
import type { DistribuicaoFaixasArea } from "./distribuicao-faixas-raster";
import { PainelTemaContinuo } from "./painel-tema-pasto";
import type { TemaMapaPasto } from "./temas-mapa-pasto";

function linhaDe(resumo: ResumoCondicaoPasto | null, codigo: CodigoClasseCondicaoPasto) {
  return resumo?.classes.find((c) => c.codigo === codigo) ?? {
    codigo, id: CLASSES_CONDICAO_PASTO[codigo]!.id, nome: CLASSES_CONDICAO_PASTO[codigo]!.nome,
    cor: CLASSES_CONDICAO_PASTO[codigo]!.cor, pixels: 0, proporcao: "0", area_estimada_ha: "0.00", area_estimada_percentual: "0.0"
  };
}

const IDS_OCULTAVEIS = new Set(["agua", "sem_leitura"]);

export function LegendaCondicaoPasto(p: {
  resumo: ResumoCondicaoPasto | null;
  classe: CodigoClasseCondicaoPasto | null;
  onClasse: (c: CodigoClasseCondicaoPasto | null) => void;
}) {
  const [verTodas, setVerTodas] = React.useState(false);
  const ocultasComZero = CLASSES_CONDICAO_PASTO.filter((c) => {
    if (!IDS_OCULTAVEIS.has(c.id)) return false;
    const pct = Number(linhaDe(p.resumo, c.codigo).area_estimada_percentual);
    return pct <= 0;
  });
  const visiveis = CLASSES_CONDICAO_PASTO.filter((c) => {
    if (verTodas) return true;
    if (!IDS_OCULTAVEIS.has(c.id)) return true;
    return Number(linhaDe(p.resumo, c.codigo).area_estimada_percentual) > 0;
  });

  return (
    <div className="rounded-md border border-slate-200 bg-white/95 p-2 shadow-sm" data-testid="legenda-condicao-pasto">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Condição</p>
      <ul className="flex flex-col gap-0.5">
        {visiveis.map((c) => {
          const l = linhaDe(p.resumo, c.codigo);
          const ativo = p.classe === c.codigo;
          const nomeCurto = c.id === "vegetacao_ativa_boa_cobertura" ? "Boa cobertura"
            : c.id === "vegetacao_ativa_cobertura_moderada" ? "Cobertura moderada"
            : c.id === "possivel_estresse_hidrico" ? "Possível estresse"
            : c.id === "solo_exposto_estimado" ? "Solo exposto"
            : c.nome;
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
                <span className="min-w-0 flex-1 truncate text-slate-700">{nomeCurto}</span>
                <span className="tabular-nums text-[10px] text-slate-400" data-testid={`legenda-ha-${c.id}`}>{num(Number(l.area_estimada_ha), 1)} ha</span>
                <span className="w-9 text-right tabular-nums font-medium text-slate-600" data-testid={`legenda-pct-${c.id}`}>{num(Number(l.area_estimada_percentual), 0)}%</span>
              </button>
            </li>
          );
        })}
      </ul>
      {ocultasComZero.length > 0 && (
        <button
          type="button"
          className="mt-1 text-[10px] font-medium text-slate-500 underline hover:text-slate-700"
          data-testid="legenda-ver-todas"
          onClick={() => setVerTodas((v) => !v)}
        >
          {verTodas ? "Ocultar vazias" : "Ver todas"}
        </button>
      )}
      <p className="mt-1 text-[10px] text-slate-500" title={AVISO_CONDICAO_PASTO_EXPERIMENTAL}>Resolução analítica: 20 m</p>
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

/** Top 3 indicadores do resumo (por ha, só com pixels > 0). */
function topIndicadores(resumo: ResumoCondicaoPasto, limite = 3) {
  return [...resumo.classes]
    .filter((c) => c.pixels > 0)
    .sort((a, b) => Number(b.area_estimada_ha) - Number(a.area_estimada_ha) || a.codigo - b.codigo)
    .slice(0, limite);
}

function pontosAtencao(resumo: ResumoCondicaoPasto, limite = 3) {
  const alertas = resumo.classes
    .filter((c) => (c.codigo === 3 || c.codigo === 4 || c.codigo === 5) && Number(c.area_estimada_ha) > 0)
    .sort((a, b) => Number(b.area_estimada_ha) - Number(a.area_estimada_ha));
  return alertas.slice(0, limite).map((c) => `${num(Number(c.area_estimada_ha), 1)} ha com ${c.nome.toLocaleLowerCase("pt-BR")}.`);
}

export function PainelAreaCondicao(p: {
  resumo: ResumoCondicaoPasto | null;
  dataImagem: string | null;
  semAnalise: boolean;
  statsSemMapa?: boolean;
}) {
  const [detalhe, setDetalhe] = React.useState(false);
  const badge = p.resumo ? badgePrincipalCondicao(p.resumo) : null;
  const tops = p.resumo ? topIndicadores(p.resumo) : [];
  const alertas = p.resumo ? pontosAtencao(p.resumo) : [];
  const coberturaPct = p.resumo ? Number((Number(p.resumo.cobertura_valida) * 100).toFixed(0)) : null;

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="painel-area-condicao">
      <p className="text-xs tabular-nums text-slate-500">
        {p.dataImagem ? <>Imagem {p.dataImagem}</> : "Sem data de imagem"} · 20 m
      </p>
      {badge && (
        <p className="text-sm font-medium" style={{ color: badge.cor }} data-testid="painel-area-badge">● {badge.rotulo}</p>
      )}
      {p.semAnalise && (
        <p className="text-xs text-slate-600" data-testid="condicao-pasto-sem-analise">Sem análise de condição</p>
      )}
      {p.statsSemMapa && (
        <p className="text-xs text-slate-600" data-testid="condicao-pasto-stats-sem-mapa">
          Há observação útil desta área; o mapa categórico será gerado na próxima análise em lote.
        </p>
      )}
      {p.resumo && (
        <>
          <BarraEmpilhadaCondicao resumo={p.resumo} />
          <ul className="flex flex-col gap-0.5">
            {(detalhe ? p.resumo.classes.filter((c) => c.pixels > 0 || c.codigo !== 0) : tops).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-xs" data-testid={`card-classe-${c.id}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: c.cor }} aria-hidden />
                  <span className="truncate text-slate-700">{c.nome}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {detalhe ? <>{num(Number(c.area_estimada_ha), 2)} ha · </> : null}
                  {num(Number(c.area_estimada_percentual), 1)}%
                </span>
              </li>
            ))}
          </ul>
          {!detalhe && (
            <button type="button" className="self-start text-xs font-medium text-slate-600 underline hover:text-slate-800" data-testid="painel-area-ver-detalhe" onClick={() => setDetalhe(true)}>
              Ver detalhamento
            </button>
          )}
          {alertas.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-amber-800" data-testid="painel-area-atencao">
              {alertas.map((t) => <li key={t}>· {t}</li>)}
            </ul>
          )}
          {coberturaPct !== null && (
            <p className="text-[11px] tabular-nums text-slate-500" data-testid="condicao-cobertura-valida">
              Cobertura válida: {coberturaPct}%
              {Number(p.resumo.cobertura_valida) < 0.8 ? " — Leitura parcial — nuvens/sombras reduziram a área observável." : ""}
            </p>
          )}
          <p className="text-[11px] text-slate-500" title={AVISO_CONDICAO_PASTO_EXPERIMENTAL}>{AVISO_CONDICAO_PASTO_EXPERIMENTAL}</p>
        </>
      )}
    </div>
  );
}

function ConteudoDetalheArea(p: {
  tema: TemaMapaPasto;
  resumo: ResumoCondicaoPasto | null;
  dataImagem: string | null;
  semAnalise: boolean;
  statsSemMapa?: boolean;
  medias?: Partial<Record<string, string | null>> | null;
  coberturaValida?: string | null;
  mediaIndice?: string | null;
  minimoIndice?: string | null;
  maximoIndice?: string | null;
  distribuicao?: DistribuicaoFaixasArea | null;
  faixaAtiva?: string | null;
  onFaixa?: (id: string | null) => void;
}) {
  if (p.tema === "condicao") {
    return (
      <PainelAreaCondicao
        resumo={p.resumo}
        dataImagem={p.dataImagem}
        semAnalise={p.semAnalise}
        statsSemMapa={p.statsSemMapa}
      />
    );
  }
  if (p.semAnalise) {
    return <p className="text-xs text-slate-600" data-testid="condicao-pasto-sem-analise">Sem análise completa para esta data.</p>;
  }
  return (
    <PainelTemaContinuo
      tema={p.tema}
      medias={p.medias ?? null}
      media={p.mediaIndice}
      minimo={p.minimoIndice}
      maximo={p.maximoIndice}
      coberturaValida={p.coberturaValida}
      dataImagem={p.dataImagem}
      distribuicao={p.distribuicao}
      faixaAtiva={p.faixaAtiva}
      onFaixa={p.onFaixa}
    />
  );
}

export function DialogAreaCondicao(p: {
  aberto: boolean;
  onFechar: () => void;
  nome: string;
  ha: number;
  dataImagem: string | null;
  resumo: ResumoCondicaoPasto | null;
  semAnalise: boolean;
  statsSemMapa?: boolean;
  onDadosTecnicos?: () => void;
  hrefCadastro: string;
  /** Tema operacional ativo — conteúdo do painel muda; não troca análise. */
  tema?: TemaMapaPasto;
  medias?: Partial<Record<string, string | null>> | null;
  coberturaValida?: string | null;
  analiseCompleta?: boolean;
  statusBundle?: string | null;
  mediaIndice?: string | null;
  minimoIndice?: string | null;
  maximoIndice?: string | null;
  distribuicao?: DistribuicaoFaixasArea | null;
  faixaAtiva?: string | null;
  onFaixa?: (id: string | null) => void;
  /**
   * `painel` = lateral desktop / bottom sheet mobile (não modal).
   * `dialog` = modal central (legado / fallback estreito).
   */
  variante?: "painel" | "dialog";
}) {
  const tema = p.tema ?? "condicao";
  const statusObs = p.analiseCompleta ? "● Análise completa"
    : p.semAnalise ? "○ Sem análise"
      : p.statusBundle === "PREPARANDO" ? "◔ Preparando"
        : p.statusBundle === "PARCIAL" ? "◐ Parcial"
          : p.statusBundle === "FALHA" ? "✕ Falha"
            : "● Observação";
  const resumoLinha = `${num(p.ha, 2)} ha · ${p.dataImagem ? `Observação: ${p.dataImagem}` : "Sem data"} · ${statusObs}`;
  const corpo = (
    <ConteudoDetalheArea
      tema={tema}
      resumo={p.resumo}
      dataImagem={p.dataImagem}
      semAnalise={p.semAnalise}
      statsSemMapa={p.statsSemMapa}
      medias={p.medias}
      coberturaValida={p.coberturaValida}
      mediaIndice={p.mediaIndice}
      minimoIndice={p.minimoIndice}
      maximoIndice={p.maximoIndice}
      distribuicao={p.distribuicao}
      faixaAtiva={p.faixaAtiva}
      onFaixa={p.onFaixa}
    />
  );
  const acoes = (
    <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={p.onFechar} data-testid="dialog-area-fechar">Fechar</Button>
      {p.onDadosTecnicos && (
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={p.onDadosTecnicos} data-testid="condicao-pasto-dados-tecnicos">Dados técnicos</Button>
      )}
      <a href={p.hrefCadastro} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="mapa-abrir-cadastro">Abrir cadastro</a>
    </div>
  );

  if (!p.aberto) return null;

  if (p.variante === "painel") {
    return (
      <aside
        className="pointer-events-auto flex max-h-[min(70vh,32rem)] w-full flex-col gap-2 overflow-hidden rounded-t-xl border border-slate-200 bg-white p-3 shadow-lg sm:max-h-none sm:rounded-md lg:h-full lg:max-h-none lg:w-[320px] lg:shrink-0"
        data-testid="mapa-area-selecionada"
        aria-label={`Detalhe de ${p.nome}`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800">{p.nome}</h2>
          <p className="text-xs tabular-nums text-slate-500">{resumoLinha}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{corpo}</div>
        {acoes}
      </aside>
    );
  }

  return (
    <Dialog
      open={p.aberto}
      onOpenChange={(o) => { if (!o) p.onFechar(); }}
      title={p.nome}
      description={resumoLinha}
      size="md"
      profile="content"
      testId="mapa-area-selecionada"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={p.onFechar} data-testid="dialog-area-fechar">Fechar</Button>
          {p.onDadosTecnicos && (
            <Button type="button" variant="outline" onClick={p.onDadosTecnicos} data-testid="condicao-pasto-dados-tecnicos">Dados técnicos</Button>
          )}
          <a href={p.hrefCadastro} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="mapa-abrir-cadastro">Abrir cadastro</a>
        </>
      )}
    >
      {corpo}
    </Dialog>
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
  const totalPct = [...p.resumos.values()].reduce((s, r) => {
    const linha = r.classes.find((x) => x.codigo === p.codigo);
    return s + Number(linha?.area_estimada_percentual ?? 0);
  }, 0);
  const pctMedio = p.resumos.size > 0 ? totalPct / p.resumos.size : 0;

  return (
    <div className="flex flex-col gap-1.5 text-sm" data-testid="painel-classe-condicao">
      <p className="tabular-nums text-slate-700">
        {num(totalHa, 1)} ha · {num(pctMedio, 1)}% · {linhas.length} {linhas.length === 1 ? "pasto afetado" : "pastos afetados"}
      </p>
      <p className="text-xs text-slate-600">{c.interpretacao}</p>
      <p className="text-xs text-slate-600">{c.acao}</p>
      {linhas.length > 0 && (
        <ol className="mt-1 flex flex-col gap-0.5 text-xs">
          {linhas.slice(0, 8).map((x) => (
            <li key={x.id} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate text-slate-700">{x.nome}</span>
              <span>{num(x.ha, 1)} ha</span>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="sr-only" onClick={p.onLimpar} data-testid="painel-classe-limpar">Limpar</button>
    </div>
  );
}

export function DialogClasseCondicao(p: {
  aberto: boolean;
  codigo: CodigoClasseCondicaoPasto | null;
  resumos: ReadonlyMap<string, ResumoCondicaoPasto>;
  nomes: ReadonlyMap<string, string>;
  onFechar: () => void;
}) {
  const c = p.codigo !== null ? CLASSES_CONDICAO_PASTO[p.codigo] : null;
  return (
    <Dialog
      key={p.codigo ?? "nenhuma"}
      open={p.aberto && p.codigo !== null}
      onOpenChange={(o) => { if (!o) p.onFechar(); }}
      title={c?.nome ?? "Classe"}
      description={c ? "Áreas com essa classe na vista atual." : undefined}
      size="md"
      profile="content"
      testId="dialog-classe-condicao"
      footer={<Button type="button" variant="ghost" onClick={p.onFechar} data-testid="dialog-classe-fechar">Fechar</Button>}
    >
      {p.codigo !== null && (
        <PainelClasseCondicao codigo={p.codigo} resumos={p.resumos} nomes={p.nomes} onLimpar={p.onFechar} />
      )}
    </Dialog>
  );
}

/** Alias estável para testes / imports (MAPA-UX-02). */
export const PopupAreaCondicao = DialogAreaCondicao;
export const PopupClasseCondicao = DialogClasseCondicao;
