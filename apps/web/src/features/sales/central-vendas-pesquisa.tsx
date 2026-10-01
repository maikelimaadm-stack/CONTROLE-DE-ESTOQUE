"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, qs } from "@/lib/api";
import grade from "./central-vendas-grade.module.css";

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
 *
 * APRESENTAÇÃO DO DESENHO (VISUAL-UX-02): painel de 640px, busca de 40px, cabeçalho de 31px e linhas de 30px, nas
 * classes de `central-vendas-grade.module.css`. O flutuante abre 2px abaixo do CONTEÚDO da linha (a borda de baixo da
 * célula não conta), preso à coluna da célula e sem passar da borda direita da linha — o `calc(100% + 2px)` e o
 * `max(0, min(coluna, 100% - 640px))` do desenho, medidos na tela porque o painel é `fixed`. Props, testids, papéis e
 * teclado são os de antes: a grade da criação consome este painel e não muda. A opção ATIVA (a do teclado e do ponteiro,
 * a que o `aria-activedescendant` aponta e o Enter escolhe) é a `aria-selected="true"`; as outras, "false".
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
