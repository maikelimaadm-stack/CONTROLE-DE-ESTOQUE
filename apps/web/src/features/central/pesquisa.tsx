"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn, num } from "@/lib/utils";
import { api, qs } from "@/lib/api";
import { MSG_LISTA_FALHOU } from "@/components/ui/ref-select";
import { opcaoDoProduto, usePesquisaDeProdutos, type PaginaDaPesquisa } from "./pesquisa-de-produtos";
import grade from "./grade.module.css";
import type { FonteDaPesquisaDeProdutos, OpcaoDaPesquisa, OpcaoReal, PropsDaPesquisa } from "./contrato";

export type { OpcaoReal, PropsDaPesquisa } from "./contrato";

/**
 * PESQUISA DA CENTRAL — o painel de vidro sobre DUAS fontes:
 *  · a de hoje, `/api/resources/<recurso>/options` (a mesma chave de cache do `RefSelect`), com Código e Descrição —
 *    a pesquisa de LOCAL sempre, e a de PRODUTO sem a capacidade da pesquisa nova (API anterior);
 *  · para o PRODUTO com a capacidade (OPERACOES-01 F3b, decisão 280), `/api/produtos/pesquisa`: o saldo do local da
 *    linha na coluna Estoque (só para quem o vê), "Só com saldo neste local" nas saídas e a página no servidor
 *    ("Mostrar mais").
 * Dois modos: FLUTUANTE (preso à célula, para baixo) e EM FLUXO (dentro do formulário do item). Teclado na busca e na
 * lista: ↑ ↓ movem (por todas as páginas carregadas), Enter escolhe; Esc fecha. Não conhece espécie nenhuma.
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

const MSG_SEM_SALDO_NO_LOCAL = "Nenhum produto com saldo neste local.";
const MSG_NENHUMA_OPCAO = "Nenhuma opção encontrada";

/** Os ids da primeira página da busca, na ordem do servidor (a de hoje é uma lista; a nova, uma página). */
const idsDaPrimeira = (primeira: readonly OpcaoReal[] | PaginaDaPesquisa | undefined): string[] =>
  !primeira ? [] : "itens" in primeira ? primeira.itens.map((it) => it.id) : primeira.map((o) => o.id);

export function PainelDePesquisa({ recurso, rotulo, filtro, valor, modo, ancora, onEscolher, onFechar, testId, produto = null }: PropsDaPesquisa) {
  // a busca ZERA ao reabrir: cada abertura monta o painel de novo (e com ela o filtro e o saldo à vista)
  const [busca, setBusca] = React.useState("");
  const [ativa, setAtiva] = React.useState(0);
  /** Sem `produto` (a pesquisa de local) é a fonte de hoje. */
  const fonte: FonteDaPesquisaDeProdutos = produto ? produto.fonte : "legado";
  const nova = fonte === "nova";
  const saida = produto?.sentido === "saida";
  const armazemId = produto?.armazemId || undefined;

  // a de HOJE: mesma URL e mesma chave de cache; o recorte "só controla estoque" é o filtro que o `/options` já entende
  const filtroDeHoje = produto?.soControlaEstoque ? { ...filtro, control_stock: "true" } : filtro;
  const deHoje = useOpcoes(recurso, busca, filtroDeHoje, fonte === "legado");
  // a NOVA: "Só com saldo neste local" começa ligado na saída
  const [soComSaldo, setSoComSaldo] = React.useState(saida);
  const daPesquisa = usePesquisaDeProdutos({ busca, armazemId, soComSaldo, soControlaEstoque: produto?.soControlaEstoque, ativo: nova });
  const paginas = nova ? daPesquisa.data?.pages : undefined;

  const opcoes: OpcaoDaPesquisa[] = React.useMemo(() => {
    if (!nova) return deHoje.data ?? [];
    // as páginas se acumulam na ordem do servidor; um produto que mudou de página entre uma e outra aparece uma vez só
    const vistos = new Set<string>();
    const lista: OpcaoDaPesquisa[] = [];
    for (const p of paginas ?? []) for (const it of p.itens) if (!vistos.has(it.id)) { vistos.add(it.id); lista.push(opcaoDoProduto(it)); }
    return lista;
  }, [nova, deHoje.data, paginas]);
  /** A primeira página da busca atual: só ela (uma busca nova) reposiciona a opção ativa — "Mostrar mais" não. */
  const primeira = nova ? paginas?.[0] : deHoje.data;

  // o saldo do local está à vista quando uma página o disse e fica PRESO enquanto o painel está aberto: uma busca sem
  // resultado e sem o filtro não tira a coluna nem o controle de quem vê o saldo
  const saldoNestaBusca = Boolean(paginas?.some((p) => p.estoqueDoArmazem || p.filtradoPorSaldo));
  const [saldoPreso, setSaldoPreso] = React.useState(false);
  React.useEffect(() => { if (saldoNestaBusca) setSaldoPreso(true); }, [saldoNestaBusca]);
  const saldoVisivel = nova && (saldoPreso || saldoNestaBusca);
  const mostraFiltro = nova && saida && Boolean(armazemId) && saldoVisivel;

  const carregando = fonte === "carregando" || (nova ? daPesquisa.isLoading : deHoje.isLoading);
  const textoDoVazio = nova && daPesquisa.isError ? MSG_LISTA_FALHOU : paginas?.[0]?.filtradoPorSaldo ? MSG_SEM_SALDO_NO_LOCAL : MSG_NENHUMA_OPCAO;
  const maisUmaPagina = nova && daPesquisa.hasNextPage && opcoes.length > 0;

  const painel = React.useRef<HTMLDivElement>(null);
  const entrada = React.useRef<HTMLInputElement>(null);
  const lista = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; largura: number } | null>(null);
  const idLista = React.useId();

  React.useEffect(() => { setAtiva(Math.max(0, idsDaPrimeira(primeira).findIndex((id) => id === valor))); }, [primeira, valor]);

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

  /** A escolha leva id, rótulo e código — o saldo não (`conhecidos` não guarda saldo). A de hoje passa a opção como veio. */
  const escolher = (o: OpcaoDaPesquisa) => onEscolher(nova ? { id: o.id, label: o.label, code: o.code ?? null } : o);

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFechar(); return; }
    // ↑ ↓ Enter só com o alvo na busca ou na lista: no controle do filtro e no "Mostrar mais" vale o comportamento nativo
    const alvo = e.target as Node;
    if (alvo !== entrada.current && !lista.current?.contains(alvo)) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAtiva((i) => Math.min(opcoes.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtiva((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = opcoes[ativa]; if (o) escolher(o); }
  };

  const comEstoque = saldoVisivel ? grade.pesquisaLinhaComEstoque : undefined;
  // "carregando" só enquanto a capacidade não chegou (nada sai); depois, a fonte que de fato responde
  const dataFonte = nova ? "pesquisa" : fonte === "carregando" ? "carregando" : "opcoes";

  if (modo === "flutuante" && !pos) return null;
  return <div
    ref={painel}
    aria-label={rotulo}
    data-testid={testId}
    data-modo={modo}
    data-fonte={dataFonte}
    className={cn(grade.pesquisa, modo === "flutuante" ? grade.pesquisaFlutuante : grade.pesquisaFluxo)}
    style={modo === "flutuante" && pos ? { top: pos.top, left: pos.left, width: pos.largura } : undefined}
    onKeyDown={teclado}
  >
    <label className={grade.pesquisaBusca}>
      <Search aria-hidden />
      <input
        ref={entrada}
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
    {mostraFiltro && <label className={grade.pesquisaFiltro} data-testid={testId ? `${testId}-so-com-saldo` : undefined}>
      <input type="checkbox" checked={soComSaldo} onChange={(e) => { setSoComSaldo(e.target.checked); entrada.current?.focus(); }} />
      Só com saldo neste local
    </label>}
    <div className={cn(grade.pesquisaLinha, grade.pesquisaCabecalho, comEstoque)} aria-hidden>
      <span data-coluna="codigo">Código</span>
      <span data-coluna="descricao">Descrição</span>
      {saldoVisivel && <span className={grade.pesquisaEstoque} data-coluna="estoque">Estoque</span>}
    </div>
    <div ref={lista} id={idLista} role="listbox" aria-label={rotulo} className={grade.pesquisaLista}>
      {carregando && <div className={grade.pesquisaEstado}>Carregando…</div>}
      {!carregando && opcoes.length === 0 && <div className={grade.pesquisaEstado}>{textoDoVazio}</div>}
      {opcoes.map((o, i) => <button
        type="button"
        key={o.id}
        id={`${idLista}-${i}`}
        role="option"
        aria-selected={i === ativa}
        data-ativa={i === ativa ? "true" : "false"}
        className={cn(grade.pesquisaLinha, comEstoque)}
        tabIndex={-1}
        onMouseEnter={() => setAtiva(i)}
        onClick={() => escolher(o)}
      >
        <span className={grade.pesquisaCodigo} data-coluna="codigo">{o.code ?? "—"}</span>
        <span className={grade.pesquisaNome} data-coluna="descricao">{o.label}</span>
        {saldoVisivel && <span className={grade.pesquisaEstoque} data-coluna="estoque">{o.estoque ? num(o.estoque, 4) : "—"}</span>}
      </button>)}
    </div>
    {maisUmaPagina && <button type="button" className={grade.pesquisaMais} data-testid={testId ? `${testId}-mais` : undefined}
      disabled={daPesquisa.isFetchingNextPage}
      onClick={() => { void daPesquisa.fetchNextPage(); entrada.current?.focus(); }}>
      {daPesquisa.isFetchingNextPage ? "Carregando…" : "Mostrar mais"}
    </button>}
  </div>;
}
