"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, qs } from "@/lib/api";
import estilos from "./central-vendas-workspace.module.css";

/**
 * PESQUISA DA CENTRAL DE VENDAS — o painel de vidro do design aprovado, sobre a FONTE REAL de opções.
 *
 * ┌─ DE ONDE VÊM OS DADOS ─────────────────────────────────────────────────────────────────────────┐
 * │ Da mesma rota que o `RefSelect` oficial já consulta — `/api/resources/<recurso>/options` —, com  │
 * │ a MESMA chave de cache (`["options", recurso, busca, filtro, undefined]`). Nenhum endpoint novo. │
 * │ A rota devolve `id`, `label` e `code`, e o painel mostra EXATAMENTE isso: Código e Descrição.    │
 * │ Referência, unidade e estoque do desenho não existem nessa resposta, então não aparecem — uma    │
 * │ coluna vazia ou estimada seria dado inventado (FUNCTIONAL_DEPENDENCY_PRODUCT_LOOKUP_ENRICHED_    │
 * │ COLUMNS). A busca é a do servidor, que casa pela descrição.                                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Dois modos, como o design fixa: FLUTUANTE, ancorado à célula da grade e abrindo para baixo (as linhas
 * não se movem, o cabeçalho da grade não é coberto); e EM FLUXO, dentro do formulário do item,
 * empurrando os campos seguintes. Teclado: ↑ ↓ movem, Enter escolhe, Esc fecha. Sem rodapé, sem X.
 */

export interface OpcaoReal { id: string; label: string; code?: string | null }

export function useOpcoes(recurso: string, busca: string, filtro: Record<string, string> | undefined, ativo: boolean) {
  const f = Object.fromEntries(Object.entries(filtro ?? {}).filter(([, v]) => v));
  return useQuery({
    queryKey: ["options", recurso, busca, f, undefined],
    queryFn: () => api<OpcaoReal[]>(`/api/resources/${recurso}/options${qs({ search: busca, ...f })}`),
    enabled: ativo,
    staleTime: 60_000
  });
}

export function PainelDePesquisa({ recurso, rotulo, filtro, valor, modo, ancora, onEscolher, onFechar, testId }: {
  recurso: string;
  /** Nome da lista, para leitores de tela ("Pesquisar produto"). */
  rotulo: string;
  filtro?: Record<string, string>;
  valor?: string | null;
  modo: "flutuante" | "fluxo";
  /** Elemento ao qual o painel flutuante se prende (a célula). */
  ancora?: HTMLElement | null;
  onEscolher: (o: OpcaoReal) => void;
  onFechar: () => void;
  testId?: string;
}) {
  // a busca ZERA ao reabrir: cada abertura monta o painel de novo
  const [busca, setBusca] = React.useState("");
  const [ativa, setAtiva] = React.useState(0);
  const { data, isLoading } = useOpcoes(recurso, busca, filtro, true);
  const opcoes = data ?? [];
  const painel = React.useRef<HTMLDivElement>(null);
  const lista = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const idLista = React.useId();

  React.useEffect(() => { setAtiva(Math.max(0, (data ?? []).findIndex((o) => o.id === valor))); }, [data, valor]);

  // flutuante: preso à célula, para baixo, sem sair da janela pela direita
  React.useLayoutEffect(() => {
    if (modo !== "flutuante" || !ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const largura = Math.min(640, window.innerWidth - 24);
      setPos({ top: r.bottom + 2, left: Math.max(12, Math.min(r.left, window.innerWidth - largura - 12)) });
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
    className={cn(estilos.pesquisa, modo === "flutuante" ? estilos.pesquisaFlutuante : estilos.pesquisaFluxo)}
    style={modo === "flutuante" && pos ? { top: pos.top, left: pos.left } : undefined}
    onKeyDown={teclado}
  >
    <label className={estilos.pesquisaBusca}>
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
    <div className={estilos.pesquisaCabecalho} aria-hidden><span>Código</span><span>Descrição</span></div>
    <div ref={lista} id={idLista} role="listbox" aria-label={rotulo} className={estilos.pesquisaLista}>
      {isLoading && <div className={estilos.pesquisaEstado}>Carregando…</div>}
      {!isLoading && opcoes.length === 0 && <div className={estilos.pesquisaEstado}>Nenhuma opção encontrada</div>}
      {opcoes.map((o, i) => <button
        type="button"
        key={o.id}
        id={`${idLista}-${i}`}
        role="option"
        aria-selected={o.id === valor}
        data-ativa={i === ativa ? "true" : "false"}
        className={estilos.pesquisaOpcao}
        tabIndex={-1}
        onMouseEnter={() => setAtiva(i)}
        onClick={() => onEscolher(o)}
      >
        <span className={estilos.codigo}>{o.code ?? "—"}</span>
        <span>{o.label}</span>
      </button>)}
    </div>
  </div>;
}
