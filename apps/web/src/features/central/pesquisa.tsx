"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, qs } from "@/lib/api";
import grade from "./grade.module.css";
import type { OpcaoReal, PropsDaPesquisa } from "./contrato";

export type { OpcaoReal, PropsDaPesquisa } from "./contrato";

/**
 * PESQUISA DA CENTRAL — o painel de vidro sobre a FONTE REAL de opções (`/api/resources/<recurso>/options`, a mesma
 * chave de cache do `RefSelect`). Mostra Código e Descrição. Dois modos: FLUTUANTE (preso à célula, para baixo) e EM
 * FLUXO (dentro do formulário do item). Teclado: ↑ ↓ movem, Enter escolhe, Esc fecha. Não conhece espécie nenhuma.
 */

export function useOpcoes(recurso: string, busca: string, filtro: Record<string, string> | undefined, ativo: boolean) {
  const f = Object.fromEntries(Object.entries(filtro ?? {}).filter(([, v]) => v));
  return useQuery({
    queryKey: ["options", recurso, busca, f, undefined],
    queryFn: () => api<OpcaoReal[]>(`/api/resources/${recurso}/options${qs({ search: busca, ...f })}`),
    enabled: ativo,
    staleTime: 60_000
  });
}

export function PainelDePesquisa({ recurso, rotulo, filtro, valor, modo, ancora, onEscolher, onFechar, testId }: PropsDaPesquisa) {
  // a busca ZERA ao reabrir: cada abertura monta o painel de novo
  const [busca, setBusca] = React.useState("");
  const [ativa, setAtiva] = React.useState(0);
  const { data, isLoading } = useOpcoes(recurso, busca, filtro, true);
  const opcoes = data ?? [];
  const painel = React.useRef<HTMLDivElement>(null);
  const lista = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; largura: number } | null>(null);
  const idLista = React.useId();

  React.useEffect(() => { setAtiva(Math.max(0, (data ?? []).findIndex((o) => o.id === valor))); }, [data, valor]);

  // flutuante: preso à célula, para baixo, sem sair da janela pela direita
  React.useLayoutEffect(() => {
    if (modo !== "flutuante" || !ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const linha = (ancora.closest("tr") ?? ancora).getBoundingClientRect();
      const bordaDeBaixo = parseFloat(getComputedStyle(ancora).borderBottomWidth) || 0;
      const largura = Math.min(640, linha.width, window.innerWidth - 24);
      const left = Math.max(linha.left, Math.min(r.left, linha.right - largura));
      setPos({ top: r.bottom - bordaDeBaixo + 2, left: Math.max(12, Math.min(left, window.innerWidth - largura - 12)), largura });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [modo, ancora]);

  // fecha ao clicar fora (a célula que abriu o painel conta como "dentro")
  React.useEffect(() => {
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (painel.current?.contains(alvo) || ancora?.contains(alvo)) return;
      onFechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [ancora, onFechar]);

  React.useEffect(() => { (lista.current?.children[ativa] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" }); }, [ativa]);

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAtiva((i) => Math.min(opcoes.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtiva((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = opcoes[ativa]; if (o) onEscolher(o); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFechar(); }
  };

  if (modo === "flutuante" && !pos) return null;
  return <div
    ref={painel}
    aria-label={rotulo}
    data-testid={testId}
    data-modo={modo}
    className={cn(grade.pesquisa, modo === "flutuante" ? grade.pesquisaFlutuante : grade.pesquisaFluxo)}
    style={modo === "flutuante" && pos ? { top: pos.top, left: pos.left, width: pos.largura } : undefined}
    onKeyDown={teclado}
  >
    <label className={grade.pesquisaBusca}>
      <Search aria-hidden />
      <input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Pesquisar pela descrição"
        aria-label={rotulo}
        aria-controls={idLista}
        aria-activedescendant={opcoes[ativa] ? `${idLista}-${ativa}` : undefined}
        role="combobox"
        aria-expanded="true"
      />
    </label>
    <div className={cn(grade.pesquisaLinha, grade.pesquisaCabecalho)} aria-hidden><span>Código</span><span>Descrição</span></div>
    <div ref={lista} id={idLista} role="listbox" aria-label={rotulo} className={grade.pesquisaLista}>
      {isLoading && <div className={grade.pesquisaEstado}>Carregando…</div>}
      {!isLoading && opcoes.length === 0 && <div className={grade.pesquisaEstado}>Nenhuma opção encontrada</div>}
      {opcoes.map((o, i) => <button
        type="button"
        key={o.id}
        id={`${idLista}-${i}`}
        role="option"
        aria-selected={i === ativa}
        data-ativa={i === ativa ? "true" : "false"}
        className={grade.pesquisaLinha}
        tabIndex={-1}
        onMouseEnter={() => setAtiva(i)}
        onClick={() => onEscolher(o)}
      >
        <span className={grade.pesquisaCodigo}>{o.code ?? "—"}</span>
        <span className={grade.pesquisaNome}>{o.label}</span>
      </button>)}
    </div>
  </div>;
}
