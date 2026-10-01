"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Grid3x3, Plus, Search, Trash2 } from "lucide-react";
import { getResource, CATALOGO_VENDAS, type ColunaDoLayout } from "@agro/domain";
import { cn, brl, num } from "@/lib/utils";
import { api } from "@/lib/api";
import { Input } from "@/components/ui";
import { StockCell, totalDaLinhaExibido, type ItemRow } from "@/features/docs/shared";
import { EstoqueDisponivelDoItem } from "@/features/stock/reserva-estoque";
import { PainelDePesquisa, type OpcaoReal } from "./central-vendas-pesquisa";
import { CampoDaCentral } from "./central-vendas-campo";
import { ConfigurarColunas } from "./central-vendas-consulta";
import { BotaoAmpliar } from "./central-vendas-workspace";
import estilos from "./central-vendas-workspace.module.css";
import grade from "./central-vendas-grade.module.css";

/**
 * ITENS DA CENTRAL DE VENDAS — duas VISÕES (e as duas juntas) do MESMO `items` (VISUAL-UX-01 R1; desenho na VISUAL-UX-02).
 *
 * ┌─ A FONTE ÚNICA ────────────────────────────────────────────────────────────────────────────────┐
 * │ `items` e `onChange` são os da página, os mesmos que o `ItemsEditor` recebia. Grade, Formulário  │
 * │ e Grade + Formulário são maneiras de OLHAR para esse array — nenhuma guarda cópia. O que esta    │
 * │ camada tem de próprio é só apresentação: qual linha está marcada, qual visão está ativa, qual    │
 * │ pesquisa está aberta e o rótulo já conhecido de cada produto escolhido.                          │
 * │                                                                                                  │
 * │ Por isso o payload não muda: adicionar cria a MESMA linha que o editor criava (quantidade 1,     │
 * │ unitário 0, gera estoque), remover faz o MESMO filtro, duplicar copia as MESMAS chaves do item   │
 * │ (nenhuma a mais), e cada campo grava a MESMA chave. O valor da linha e o subtotal são os que o   │
 * │ editor sempre EXIBIU (`totalDaLinhaExibido`) — e continuam sendo exibição: quem calcula o        │
 * │ documento é o servidor.                                                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ NO DESENHO (VISUAL-UX-02, Fase B) ────────────────────────────────────────────────────────────┐
 * │ A mesma geometria dos itens da CONSULTA (`ItensSalvos`, `central-vendas-grade.module.css`):      │
 * │ barra de 36px [Ampliar] [Adicionar produto] [Duplicar item] [Remover item] … [Grade | Formulário] │
 * │ [Configurar colunas]; cabeçalho de 28px, linha de 23px; rodapé de 32px com "Itens (N)", o ponto  │
 * │ de pendência e o subtotal EXIBIDO. "Mostrar grade e formulário" mora no Configurar colunas.      │
 * │                                                                                                  │
 * │ MARCAÇÃO: só o círculo da 1ª coluna marca e desmarca (um item por vez). Clicar na linha não      │
 * │ marca; clicar na área da grade fora de qualquer linha desmarca. No círculo: Enter e Espaço       │
 * │ alternam, ↓ ↑ passam a marca à linha vizinha e levam o foco ao círculo dela; só o círculo da     │
 * │ linha marcada (ou o da 1ª, sem marca) é tabulável. Abrir a pesquisa de produto ou de armazém     │
 * │ também marca a linha. Os campos editáveis só aparecem na linha marcada.                          │
 * │                                                                                                  │
 * │ ITEM CORRENTE (o que Duplicar e Remover usam): na Grade sozinha, a linha MARCADA; com o           │
 * │ formulário à vista, o item do formulário (o marcado, ou o 1º quando nada está marcado). Sem item │
 * │ corrente, os dois botões somem. Remover nunca deixa marca órfã: ela vai ao item anterior.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CONFIGURAR COLUNAS / CAMPOS (R2): SÓ O QUE SE VÊ ─────────────────────────────────────────────┐
 * │ O "Configurar colunas" (o mesmo da consulta) liga, desliga e reordena as colunas da grade ou os  │
 * │ campos do formulário do item — a lista da visão que está na tela. É ESTADO DESTA TELA:           │
 * │ `useState`, sem `localStorage`, `sessionStorage`, perfil ou API (COLUMN_CONFIG_PERSISTENCE =     │
 * │ NONE); remontar a Central devolve o padrão. Esconder uma coluna não toca o item: `ItemRow` e o   │
 * │ payload continuam com todas as chaves. E o que a célula de estoque FAZ (preencher o unitário    │
 * │ vazio com o custo médio) não depende de a coluna estar à vista — ver `efeitosDoEstoque`.         │
 * │ Largura e "span" por campo não entram: o handoff exclui de propósito ("sem larguras/spans").    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ UNIDADE (R2): DO PRODUTO, SÓ PARA EXIBIR ─────────────────────────────────────────────────────┐
 * │ A leitura do produto que esta tela já faz (`/api/resources/products/<id>`) devolve               │
 * │ `measurement_id_label` — o símbolo da 1ª unidade de medida, rótulo de referência resolvido pela  │
 * │ API. Ele vira o sufixo da quantidade e o campo travado "Unidade", e NÃO entra no item: unidade   │
 * │ não é chave de `ItemRow` nem do contrato de criação.                                             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

type Visao = "grade" | "formulario";

/**
 * A linha nova é a MESMA que o `ItemsEditor` cria — para o payload não perceber a troca de apresentação. Com armazém
 * padrão (VENDAS-A3-1b), ele entra como o `defaults` do editor: só o `warehouse_id` a mais.
 */
const linhaNova = (armazem?: string): ItemRow => ({ product_id: "", quantity: "1", unit_value: "0", generate_stock: true, ...(armazem ? { warehouse_id: armazem } : {}) });

/** Colunas da grade, na ordem padrão do design. `largura` é a do protótipo; Produto é a coluna elástica (mínimo). */
type ChaveColuna = "codigo" | "produto" | "armazem" | "estoque" | "quantidade" | "unitario" | "desconto" | "descontoPercentual" | "total";
const COLUNAS: Record<ChaveColuna, { rotulo: string; largura: number; numero?: boolean; elastica?: boolean }> = {
  codigo: { rotulo: "Código", largura: 70 },
  produto: { rotulo: "Produto", largura: 170, elastica: true },
  armazem: { rotulo: "Armazém", largura: 108 },
  estoque: { rotulo: "Estoque", largura: 74, numero: true },
  quantidade: { rotulo: "Quantidade", largura: 104, numero: true },
  unitario: { rotulo: "Valor unitário", largura: 108, numero: true },
  desconto: { rotulo: "Desconto", largura: 88, numero: true },
  descontoPercentual: { rotulo: "Desconto %", largura: 90, numero: true },
  total: { rotulo: "Total", largura: 102, numero: true }
};
/** A coluna do círculo de seleção, do desenho. */
const LARGURA_SELECAO = 34;

/** Campos do formulário do item, na ordem padrão do design. */
type ChaveCampo = "produto" | "armazem" | "estoque" | "unidade" | "quantidade" | "unitario" | "desconto" | "descontoPercentual" | "total";
const CAMPOS: Record<ChaveCampo, string> = {
  produto: "Produto", armazem: "Armazém", estoque: "Estoque", unidade: "Unidade", quantidade: "Quantidade",
  unitario: "Valor unitário", desconto: "Desconto", descontoPercentual: "Desconto %", total: "Total"
};

interface Preferencia<K extends string> { chave: K; visivel: boolean }
const padrao = <K extends string>(chaves: K[]): Preferencia<K>[] => chaves.map((chave) => ({ chave, visivel: true }));
const COLUNAS_PADRAO = () => padrao(Object.keys(COLUNAS) as ChaveColuna[]);
const CAMPOS_PADRAO = () => padrao(Object.keys(CAMPOS) as ChaveCampo[]);

/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1): a chave do catálogo (`@agro/domain`, a da linha do item no corpo) ↔ a coluna
 * e o campo desta tela. "Unidade" não é chave do item nem do catálogo: aparece no formulário sempre, antes da
 * Quantidade. Com layout, a grade e o formulário só oferecem o que o layout tem, na ordem dele; a preferência de
 * mostrar/esconder/reordenar do usuário continua valendo DENTRO dessas colunas.
 */
const COLUNA_DO_CATALOGO: Record<string, ChaveColuna> = {
  codigo: "codigo", product_id: "produto", warehouse_id: "armazem", estoque: "estoque", quantity: "quantidade",
  unit_price: "unitario", discount: "desconto", discount_percent: "descontoPercentual", total: "total"
};
const CHAVE_DO_CATALOGO = Object.fromEntries(Object.entries(COLUNA_DO_CATALOGO).map(([k, v]) => [v, k])) as Record<ChaveColuna, string>;
const ehChaveColuna = (k: string): k is ChaveColuna => k in COLUNAS;
/**
 * Colunas do SISTEMA (produto, quantidade, valor unitário): a grade de hoje não as marca com "*" — quem as exige é o
 * formulário do item e o Salvar desabilitado, como sempre. O "*" da GRADE marca só o que o layout tornou obrigatório,
 * para o layout do sistema desenhar exatamente a Central de hoje.
 *
 * COMPRAS-03 (decisão 269): o catálogo de VENDAS pelo nome — não "a primeira família com layout". Com as famílias de
 * compras na lista, a posição deixou de ser uma promessa de que o catálogo é o da venda (e um catálogo de compras aqui
 * poria "*" errado na grade de Vendas).
 */
const COLUNAS_DO_SISTEMA: ReadonlySet<string> = new Set(
  CATALOGO_VENDAS.filter((c) => c.parte === "itens" && c.sistema).map((c) => c.chave)
);

/** O layout dos itens como esta tela o usa: colunas na ordem do layout, com rótulo e obrigatoriedade. */
export interface LayoutDosItens { colunas: readonly ColunaDoLayout[] }
function colunasDoLayout(l: LayoutDosItens): { chave: ChaveColuna; rotulo?: string; obrigatorio: boolean }[] {
  return l.colunas.flatMap((c) => { const k = COLUNA_DO_CATALOGO[c.campo]; return k ? [{ chave: k, rotulo: c.rotulo, obrigatorio: c.obrigatorio }] : []; });
}
function camposDoLayout(l: LayoutDosItens): ChaveCampo[] {
  const lista: ChaveCampo[] = colunasDoLayout(l).map((c) => c.chave).filter((k): k is Exclude<ChaveColuna, "codigo"> => k !== "codigo");
  const i = lista.indexOf("quantidade");
  lista.splice(i >= 0 ? i : lista.length, 0, "unidade");
  return lista;
}

/** Rótulo de um registro já escolhido: o que a pesquisa devolveu, ou o próprio registro (como o `RefSelect` faz). */
function useRotulo(recurso: string, id: string | undefined, conhecido: OpcaoReal | undefined) {
  const def = React.useMemo(() => getResource(recurso), [recurso]);
  const { data } = useQuery({
    queryKey: ["option-one", recurso, id],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/${recurso}/${id}`),
    enabled: Boolean(id) && !conhecido,
    staleTime: 60_000
  });
  if (!id) return null;
  if (conhecido) return conhecido;
  if (!data) return { id, label: "…", code: null };
  return { id, label: String(data[def?.labelField ?? "name"] ?? data["description"] ?? data["name"] ?? ""), code: (data["code"] as string | null) ?? null };
}

/**
 * Símbolo da unidade do produto, pela MESMA leitura e MESMA chave de cache de `useRotulo` — uma
 * pergunta por produto escolhido, nunca uma por opção da pesquisa.
 */
function useUnidadeDoProduto(id: string | undefined) {
  const { data } = useQuery({
    queryKey: ["option-one", "products", id],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000
  });
  const u = data?.["measurement_id_label"];
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function Unidade({ produto }: { produto?: string }) {
  const u = useUnidadeDoProduto(produto || undefined);
  return u ? <span className={grade.unidade} data-testid="central-vendas-unidade">{u}</span> : null;
}

function UnidadeTravada({ produto }: { produto?: string }) {
  const u = useUnidadeDoProduto(produto || undefined);
  return <>{u ?? "—"}</>;
}

/**
 * A célula de pesquisa da grade (produto, armazém): o botão do desenho, com a lupa à esquerda. `rotuloAcao` é o nome
 * acessível — a função recebe o registro escolhido (ou null) e devolve o texto.
 */
function CelulaDeReferencia({ recurso, id, conhecido, vazio, erro, aberto, onAbrir, rotuloAcao, testId }: {
  recurso: string; id?: string; conhecido?: OpcaoReal; vazio: string; erro?: boolean; aberto: boolean; onAbrir: (el: HTMLElement) => void;
  rotuloAcao: (o: OpcaoReal | null) => string; testId: string;
}) {
  const o = useRotulo(recurso, id || undefined, conhecido);
  return <button type="button" className={grade.celulaBotao} aria-haspopup="listbox" aria-expanded={aberto} aria-label={rotuloAcao(o)}
    data-testid={testId} onClick={(e) => { e.stopPropagation(); onAbrir(e.currentTarget.closest("td") ?? e.currentTarget); }}>
    <span className={o ? undefined : erro ? grade.celulaErro : grade.celulaVazia}>{o?.label ?? vazio}</span>
    <span className={grade.celulaIcone} aria-hidden><Search /></span>
  </button>;
}

function CodigoDoProduto({ id, conhecido }: { id?: string; conhecido?: OpcaoReal }) {
  const o = useRotulo("products", id || undefined, conhecido);
  return <span>{o?.code ?? (id ? "" : "—")}</span>;
}

export function ItensDaCentral({ items, onChange, layout, erros, armazemPadrao, reservaEstoque = null }: {
  items: ItemRow[]; onChange: (i: ItemRow[]) => void;
  /** Só com a capacidade `layoutDocumento`: sem ele a grade é a de hoje, idêntica. */
  layout?: LayoutDosItens | null;
  /** Erros por caminho `items[i].<chave do catálogo>` (os mesmos de `camposObrigatoriosFaltando` e do 422). */
  erros?: Record<string, string>;
  /**
   * TOP-CONFIG-07 — a versão da TOP escolhida RESERVA estoque (a página só passa com `regras.reservaEstoque === true`).
   * `obrigatorias`: chaves do catálogo do item que a reserva exige (o "*" soma com o do layout); a célula Estoque passa a
   * mostrar o DISPONÍVEL do armazém. Ausente/null: a grade de hoje, idêntica.
   */
  reservaEstoque?: { obrigatorias: readonly string[] } | null;
  /**
   * VENDAS-A3-1b: armazém padrão do layout que vale AGORA (a página só o passa quando é da empresa do documento). Toda
   * linha NOVA nasce com ele, com o rótulo já conhecido; as linhas que existem não mudam. Ausente/null: como hoje.
   */
  armazemPadrao?: { id: string; rotulo: string } | null;
}) {
  const [visao, setVisao] = React.useState<Visao>("grade");
  const [ambos, setAmbos] = React.useState(false);
  /** A linha marcada (uma por vez) — -1: nenhuma. */
  const [selecionado, setSelecionado] = React.useState<number>(-1);
  const [pesquisa, setPesquisa] = React.useState<{ linha: number; campo: "product_id" | "warehouse_id"; ancora: HTMLElement | null; modo: "flutuante" | "fluxo" } | null>(null);
  /** Rótulos das escolhas feitas nesta sessão — só apresentação, nunca entra no payload. */
  const [conhecidos, setConhecidos] = React.useState<Record<string, OpcaoReal>>({});
  /** Os círculos de seleção, para o ↓ ↑ levarem o foco ao da linha vizinha. */
  const circulos = React.useRef<(HTMLButtonElement | null)[]>([]);
  /** Colunas e campos visíveis e sua ordem — apresentação desta tela, sem persistência. */
  const [colunas, setColunas] = React.useState<Preferencia<ChaveColuna>[]>(COLUNAS_PADRAO);
  const [campos, setCampos] = React.useState<Preferencia<ChaveCampo>[]>(CAMPOS_PADRAO);
  /** Com layout: o padrão é o do layout; trocar de layout devolve a preferência ao padrão dele. */
  const colunasPadrao = React.useCallback(() => (layout ? padrao(colunasDoLayout(layout).map((c) => c.chave)) : COLUNAS_PADRAO()), [layout]);
  const camposPadrao = React.useCallback(() => (layout ? padrao(camposDoLayout(layout)) : CAMPOS_PADRAO()), [layout]);
  const layoutAplicado = React.useRef<LayoutDosItens | null | undefined>(undefined);
  React.useEffect(() => {
    if (layoutAplicado.current === layout) return;
    const primeiro = layoutAplicado.current === undefined;
    layoutAplicado.current = layout;
    if (primeiro && !layout) return;
    setColunas(colunasPadrao()); setCampos(camposPadrao());
  }, [layout, colunasPadrao, camposPadrao]);
  const doLayout = React.useMemo(() => (layout ? new Map(colunasDoLayout(layout).map((c) => [c.chave, c])) : null), [layout]);
  const rotuloColuna = (k: ChaveColuna) => doLayout?.get(k)?.rotulo || COLUNAS[k].rotulo;
  const rotuloCampo = (k: ChaveCampo) => (ehChaveColuna(k) && doLayout?.get(k)?.rotulo) || CAMPOS[k];
  const obrigatoria = (k: ChaveColuna) => Boolean(doLayout?.get(k)?.obrigatorio) || Boolean(reservaEstoque?.obrigatorias.includes(CHAVE_DO_CATALOGO[k]));
  /** `data-campo` só existe com layout: sem a capacidade o DOM é o de hoje. */
  const dataCampo = (k: ChaveColuna) => (layout ? { "data-campo": CHAVE_DO_CATALOGO[k] } : {});
  const erroDe = (i: number, k: ChaveColuna) => erros?.[`items[${i}].${CHAVE_DO_CATALOGO[k]}`];
  const errosDosItens = erros ? Object.entries(erros).filter(([c]) => c.startsWith("items[")) : [];
  /** O item tem pendência (algum erro com o caminho dele): fundo de erro na linha e "Selecione o produto" em vermelho. */
  const pendente = (i: number) => errosDosItens.some(([c]) => c.startsWith(`items[${i}]`));

  // marca nunca órfã: se o array encolheu, a marca vem junto
  const sel = selecionado >= items.length ? items.length - 1 : selecionado;
  React.useEffect(() => { if (sel !== selecionado) setSelecionado(sel); }, [sel, selecionado]);

  const mostraGrade = visao === "grade" || ambos;
  const mostraFormulario = visao === "formulario";
  /** O item do formulário: o marcado; sem marca, o 1º (como o desenho). */
  const atual = sel >= 0 ? sel : items.length ? 0 : -1;
  /** O item corrente de Duplicar/Remover: na Grade sozinha, a linha marcada; com o formulário à vista, o item dele. */
  const corrente = mostraFormulario ? atual : sel;

  const atualizar = (i: number, chave: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [chave]: v } : it)));
  const adicionar = () => {
    if (armazemPadrao) {
      const { id, rotulo } = armazemPadrao;
      setConhecidos((c) => (c[id] ? c : { ...c, [id]: { id, label: rotulo, code: null } }));
    }
    onChange([...items, linhaNova(armazemPadrao?.id)]); setSelecionado(items.length);
  };
  /** A cópia do item corrente — as MESMAS chaves, nenhuma a mais — entra logo abaixo e fica marcada. */
  const duplicar = () => {
    const c = corrente;
    const original = items[c];
    if (!original) return;
    onChange([...items.slice(0, c + 1), { ...original }, ...items.slice(c + 1)]);
    setPesquisa(null);
    setSelecionado(c + 1);
  };
  /** Tira o item corrente; a marca vai ao anterior (o 1º, se era ele), ou a nenhum quando não sobra item. */
  const remover = () => {
    const c = corrente;
    if (!items[c]) return;
    onChange(items.filter((_, j) => j !== c));
    setPesquisa(null);
    setSelecionado(items.length - 1 > 0 ? Math.max(0, c - 1) : -1);
  };
  const escolher = (o: OpcaoReal) => {
    if (!pesquisa) return;
    setConhecidos((c) => ({ ...c, [o.id]: o }));
    atualizar(pesquisa.linha, pesquisa.campo, o.id);
    setPesquisa(null);
  };
  const fechar = React.useCallback(() => setPesquisa(null), []);
  const marcarEFocar = (i: number) => { setSelecionado(i); requestAnimationFrame(() => circulos.current[i]?.focus()); };

  /**
   * Enter e Espaço alternam pelo próprio botão (o clique nativo do `<button>` chama o mesmo `onClick`) — tratá-los aqui
   * também alternaria duas vezes onde o navegador dispara o clique do Espaço mesmo com o keydown cancelado.
   */
  const tecladoDoCirculo = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (i + 1 < items.length) marcarEFocar(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (i > 0) marcarEFocar(i - 1); }
  };
  /** Clicar na área da grade fora de qualquer linha de item desmarca (o cabeçalho e o espaço vazio contam como fora). */
  const cliqueNaGrade = (e: React.MouseEvent<HTMLDivElement>) => {
    const alvo = e.target as Element;
    if (!alvo.closest("tr[aria-selected]") && sel >= 0) setSelecionado(-1);
  };

  const subtotal = items.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const item = atual >= 0 ? items[atual] : undefined;

  const colunasVisiveis = colunas.filter((c) => c.visivel && (!doLayout || doLayout.has(c.chave))).map((c) => c.chave);
  // largura mínima DERIVADA das colunas visíveis (o círculo + cada coluna), nunca contada à mão
  const larguraMinima = LARGURA_SELECAO + colunasVisiveis.reduce((a, k) => a + COLUNAS[k].largura, 0);

  /**
   * O saldo mostrado na coluna/campo Estoque. Só EXIBE — quem preenche o custo médio é `efeitosDoEstoque`, montado
   * sempre. Com a reserva (TOP-CONFIG-07), o DISPONÍVEL do armazém; sem ela, a `StockCell` de hoje.
   */
  const saldoDoItem = (it: ItemRow) => (reservaEstoque
    ? <EstoqueDisponivelDoItem warehouseId={it.warehouse_id} productId={it.product_id} />
    : <StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={() => { /* só exibe */ }} />);

  const celula = (k: ChaveColuna, it: ItemRow, i: number, ativa: boolean) => {
    switch (k) {
      case "codigo": return <td key={k}><CodigoDoProduto id={it.product_id} conhecido={conhecidos[it.product_id]} /></td>;
      case "produto": return <td key={k}><CelulaDeReferencia recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} vazio="Selecione o produto" erro={pendente(i)}
        rotuloAcao={(o) => (o ? `Trocar o produto do item ${i + 1}` : `Selecionar o produto do item ${i + 1}`)}
        aberto={pesquisa?.linha === i && pesquisa.campo === "product_id"} testId="central-vendas-produto"
        onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "product_id", ancora: el, modo: "flutuante" }); }} /></td>;
      case "armazem": return <td key={k}><CelulaDeReferencia recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} vazio="—"
        rotuloAcao={(o) => (o ? `Armazém: ${o.label}` : "Armazém")}
        aberto={pesquisa?.linha === i && pesquisa.campo === "warehouse_id"} testId="central-vendas-armazem"
        onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "warehouse_id", ancora: el, modo: "flutuante" }); }} /></td>;
      case "estoque": return <td key={k} className={cn(grade.numero, grade.estoque)}>{saldoDoItem(it)}</td>;
      case "quantidade": return <td key={k} className={grade.numero}><span className={grade.quantidade}>
        {ativa ? <input className={grade.entrada} aria-label={`Quantidade do item ${i + 1}`} type="number" step="0.0001" min="0" value={it.quantity} onChange={(e) => atualizar(i, "quantity", e.target.value)} />
          : <span data-testid="central-vendas-quantidade">{num(it.quantity || "0", 2)}</span>}
        <Unidade produto={it.product_id} />
      </span></td>;
      case "unitario": return <td key={k} className={grade.numero}>{ativa ? <input className={grade.entrada} aria-label={`Valor unitário do item ${i + 1}`} type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => atualizar(i, "unit_value", e.target.value)} /> : brl(it.unit_value ?? "0")}</td>;
      case "desconto": return <td key={k} className={grade.numero}>{Number(it.discount || 0) ? brl(it.discount!) : "—"}</td>;
      case "descontoPercentual": return <td key={k} className={grade.numero}>{Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : "—"}</td>;
      case "total": return <td key={k} className={cn(grade.numero, grade.forte)}>{brl(totalDaLinhaExibido(it))}</td>;
    }
  };

  // o círculo tabulável: o da linha marcada, ou o da 1ª quando nada está marcado (tabindex itinerante)
  const tabulavel = sel >= 0 ? sel : 0;

  const tabela = <div className={grade.rolagem} onClick={cliqueNaGrade}>
    <table className={grade.grade} style={{ minWidth: larguraMinima }} aria-label="Itens do documento" data-testid="central-vendas-grade">
      <colgroup><col style={{ width: LARGURA_SELECAO }} />{colunasVisiveis.map((k) => <col key={k} style={COLUNAS[k].elastica ? { minWidth: COLUNAS[k].largura } : { width: COLUNAS[k].largura }} />)}</colgroup>
      <thead><tr>
        <th scope="col" className={grade.celulaSelecao} aria-label="Seleção" />
        {colunasVisiveis.map((k) => <th key={k} scope="col" {...dataCampo(k)}>{rotuloColuna(k)}{obrigatoria(k) && !COLUNAS_DO_SISTEMA.has(CHAVE_DO_CATALOGO[k]) && <span className="req text-red-500"> *</span>}</th>)}
      </tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={1 + colunasVisiveis.length} className={grade.vazio}>
          <div className={grade.vazioConteudo}>
            <span>Nenhum item adicionado.</span>
            <button type="button" className={grade.botaoTexto} data-testid="central-vendas-adicionar-vazio" onClick={(e) => { e.stopPropagation(); adicionar(); }}><Plus aria-hidden />Adicionar produto</button>
          </div>
        </td></tr>}
        {items.map((it, i) => {
          const ativa = i === sel;
          return <tr key={i} className={cn(grade.linha, ativa && grade.linhaMarcada, pendente(i) && grade.linhaComErro)}
            aria-selected={ativa} data-testid="central-vendas-linha">
            <td className={grade.celulaSelecao}>
              <button type="button" role="checkbox" aria-checked={ativa} aria-label={`Selecionar item ${i + 1}`} className={grade.circulo} data-testid="central-vendas-selecionar-item"
                ref={(el) => { circulos.current[i] = el; }} tabIndex={i === tabulavel ? 0 : -1}
                onClick={(e) => { e.stopPropagation(); setSelecionado(ativa ? -1 : i); }} onKeyDown={(e) => tecladoDoCirculo(e, i)}>
                {ativa && <Check aria-hidden strokeWidth={2} />}
              </button>
            </td>
            {colunasVisiveis.map((k) => {
              const td = celula(k, it, i, ativa);
              // Sem layout E sem erros, a célula de hoje. Os erros sem layout só chegam com a reserva (TOP-CONFIG-07).
              if (!layout && !erros) return td;
              const erro = erroDe(i, k);
              return React.cloneElement(td, { ...dataCampo(k), ...(erro ? { "aria-invalid": true, title: erro, "data-erro": erro } : {}) });
            })}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;

  const pesquisaEmFluxo = (campo: "product_id" | "warehouse_id") => pesquisa && pesquisa.modo === "fluxo" && pesquisa.campo === campo && pesquisa.linha === atual
    ? <PainelDePesquisa key={`fluxo-${campo}`} recurso={campo === "product_id" ? "products" : "warehouses"} rotulo={campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"}
        valor={item?.[campo] as string | undefined} modo="fluxo" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />
    : null;

  /** Atributos do campo do formulário do item com layout: `data-campo`, obrigatório e erro do item do formulário. */
  const doCampo = (k: ChaveColuna) => ({ attrs: dataCampo(k), required: obrigatoria(k), error: erroDe(atual, k), label: rotuloColuna(k) });
  const campoDeReferencia = (campo: "product_id" | "warehouse_id", recurso: string) => {
    const id = (item?.[campo] as string | undefined) || undefined;
    const d = doCampo(campo === "product_id" ? "produto" : "armazem");
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} icone="pesquisa" preenchido={Boolean(id)} {...d.attrs}>
      <CampoReferenciaBotao recurso={recurso} valor={id} conhecido={id ? conhecidos[id] : undefined} aberto={Boolean(pesquisa?.modo === "fluxo" && pesquisa.campo === campo)}
        onAbrir={(el) => setPesquisa(pesquisa?.modo === "fluxo" && pesquisa.campo === campo ? null : { linha: atual, campo, ancora: el, modo: "fluxo" })} />
    </CampoDaCentral>;
  };
  const campoNumerico = (k: "quantidade" | "unitario" | "desconto" | "descontoPercentual", chave: "quantity" | "unit_value" | "discount" | "discount_percent", valor: string, extra: { step: string; max?: string }) => {
    const d = doCampo(k);
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} preenchido={valor !== ""} {...d.attrs}>
      <Input type="number" step={extra.step} min="0" max={extra.max} value={valor} onChange={(e) => atualizar(atual, chave, e.target.value)} />
    </CampoDaCentral>;
  };

  const campoDoItem = (k: ChaveCampo, it: ItemRow): React.ReactNode => {
    switch (k) {
      case "produto": return <>{campoDeReferencia("product_id", "products")}{pesquisaEmFluxo("product_id")}</>;
      case "armazem": return <>{campoDeReferencia("warehouse_id", "warehouses")}{pesquisaEmFluxo("warehouse_id")}</>;
      case "estoque": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" data-campo={layout ? "estoque" : undefined}>{saldoDoItem(it)}</CampoDaCentral>;
      case "unidade": return <CampoDaCentral rotulo="Unidade" estado="travado" testId="central-vendas-item-unidade"><UnidadeTravada produto={it.product_id} /></CampoDaCentral>;
      case "quantidade": return campoNumerico(k, "quantity", it.quantity, { step: "0.0001" });
      case "unitario": return campoNumerico(k, "unit_value", it.unit_value ?? "", { step: "0.000001" });
      case "desconto": return campoNumerico(k, "discount", it.discount ?? "", { step: "0.01" });
      case "descontoPercentual": return campoNumerico(k, "discount_percent", it.discount_percent ?? "", { step: "0.01", max: "100" });
      case "total": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" data-campo={layout ? "total" : undefined}><span data-testid="central-vendas-item-total">{brl(totalDaLinhaExibido(it))}</span></CampoDaCentral>;
    }
  };

  const formulario = <div className={grade.form} data-testid="central-vendas-item-form">
    {!item ? <div className={grade.formVazio}>Nenhum item adicionado.</div> : <>
      <div className={grade.formNav}>
        <span className={grade.formNavTitulo} data-testid="central-vendas-item-posicao">Item {atual + 1} de {items.length}</span>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Item anterior" data-dica="Item anterior" disabled={atual <= 0} onClick={() => { setPesquisa(null); setSelecionado(atual - 1); }}><ChevronLeft aria-hidden /></button>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Próximo item" data-dica="Próximo item" disabled={atual >= items.length - 1} onClick={() => { setPesquisa(null); setSelecionado(atual + 1); }}><ChevronRight aria-hidden /></button>
        {/* "novo": o item ainda sem produto (a regra do desenho) */}
        {!item.product_id && <span className={grade.selo} data-testid="central-vendas-item-novo">novo</span>}
      </div>
      <div className={grade.formCampos}>
        {campos.filter((c) => c.visivel && (!doLayout || !ehChaveColuna(c.chave) || doLayout.has(c.chave))).map((c) => <React.Fragment key={c.chave}>{campoDoItem(c.chave, item)}</React.Fragment>)}
      </div>
    </>}
  </div>;

  /*
    A célula de estoque é quem, ao chegar o saldo, preenche o unitário VAZIO com o custo médio — é o
    comportamento do editor antigo, em que cada linha tinha UMA célula, montada a vida inteira da linha.
    Aqui essa célula é `efeitosDoEstoque`: uma por linha, fora da vista e SEMPRE montada. As células
    visíveis (grade e formulário) só exibem o saldo. Se o preenchimento morasse na célula visível,
    esconder a coluna Estoque ou trocar de visão a remontaria, o saldo em cache chegaria de novo no
    primeiro render e o unitário que o usuário zerou de propósito voltaria a ser o custo médio — uma
    ação só de apresentação mudando o POST.
  */
  const efeitosDoEstoque = <div hidden>{items.map((it, i) => <StockCell key={i} warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c); }} />)}</div>;

  // a configuração é a da visão na tela: o formulário quando ele aparece (sozinho ou ao lado da grade), senão a grade
  const configDoFormulario = visao === "formulario";
  /** Com o formulário à vista e nada marcado, o 1º item passa a ser o marcado — grade e formulário falam do MESMO item. */
  const mostrarFormulario = () => { if (sel < 0 && items.length) setSelecionado(0); };
  const escolherVisao = (v: Visao) => {
    setVisao(v); setPesquisa(null);
    if (v === "grade") setAmbos(false); else mostrarFormulario();
  };
  const alternarAmbos = () => {
    const novo = !ambos; setAmbos(novo); setPesquisa(null);
    if (novo) { setVisao("formulario"); mostrarFormulario(); }
  };

  return <>
    <div className={grade.barra} role="toolbar" aria-label="Itens">
      <BotaoAmpliar regiao="itens" />
      <button type="button" className={cn(grade.botao, grade.botaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar produto" data-dica="Adicionar produto" data-testid="central-vendas-adicionar-item" onClick={adicionar}><Plus aria-hidden /></button>
      {corrente >= 0 && <>
        <button type="button" className={cn(grade.botao, grade.botaoAcaoItem, estilos.dicaInicio)} aria-label="Duplicar item" data-dica="Duplicar item" data-testid="central-vendas-duplicar-item" onClick={duplicar}><Copy aria-hidden /></button>
        <button type="button" className={cn(grade.botao, grade.botaoAcaoItem, grade.botaoRemover, estilos.dicaInicio)} aria-label="Remover item" data-dica="Remover item" data-testid="central-vendas-remover-item" onClick={remover}><Trash2 aria-hidden /></button>
      </>}
      <span className={grade.espaco} />
      <div className={grade.segmento} role="group" aria-label="Visualização dos itens">
        <button type="button" aria-pressed={visao === "grade"} aria-label="Grade" data-dica="Grade" onClick={() => escolherVisao("grade")}><Grid3x3 aria-hidden /></button>
        <button type="button" aria-pressed={visao === "formulario"} aria-label="Formulário" data-dica="Formulário" data-visao="formulario" onClick={() => escolherVisao("formulario")}><FileText aria-hidden /></button>
      </div>
      {configDoFormulario
        ? <ConfigurarColunas<ChaveCampo> titulo="Visualização do formulário" subtitulo="Campos visíveis e ordem"
            rotulos={Object.fromEntries((Object.keys(CAMPOS) as ChaveCampo[]).map((k) => [k, rotuloCampo(k)])) as Record<ChaveCampo, string>}
            lista={campos} onLista={setCampos} onRestaurar={() => setCampos(camposPadrao())} ambos={ambos} onAmbos={alternarAmbos} />
        : <ConfigurarColunas<ChaveColuna> titulo="Colunas da grade" subtitulo="Colunas visíveis e ordem"
            rotulos={Object.fromEntries((Object.keys(COLUNAS) as ChaveColuna[]).map((k) => [k, rotuloColuna(k)])) as Record<ChaveColuna, string>}
            lista={colunas} onLista={setColunas} onRestaurar={() => setColunas(colunasPadrao())} ambos={ambos} onAmbos={alternarAmbos} />}
    </div>
    <div className={grade.corpo} data-visao={ambos ? "ambos" : visao} data-testid="central-vendas-itens-corpo">
      {mostraGrade && tabela}
      {mostraFormulario && formulario}
      {efeitosDoEstoque}
    </div>
    {errosDosItens.length > 0 && <div role="alert" data-testid="central-vendas-itens-erros" className="px-3 py-1 text-[11px] text-red-600">
      {errosDosItens.map(([caminho, msg]) => { const n = /^items\[(\d+)\]/.exec(caminho); return <p key={caminho} data-erro-campo={caminho}>{n ? `Item ${Number(n[1]) + 1}: ` : ""}{msg}</p>; })}
    </div>}
    <div className={grade.rodape} data-testid="central-vendas-itens-rodape">
      <span className={grade.rodapeTitulo}>Itens <span className={grade.rodapeContagem} data-testid="central-vendas-itens-contagem">({items.length})</span>
        {errosDosItens.length > 0 && <span className={grade.pontoErro} data-testid="central-vendas-itens-erro" title="Há itens com pendência" />}</span>
      {/* o subtotal EXIBIDO de sempre: exibição — quem calcula o documento é o servidor */}
      <span>Subtotal dos itens <b className={grade.rodapeValor} data-testid="central-vendas-subtotal">{brl(subtotal)}</b></span>
    </div>
    {pesquisa?.modo === "flutuante" && <PainelDePesquisa recurso={pesquisa.campo === "product_id" ? "products" : "warehouses"}
      rotulo={pesquisa.campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"} valor={items[pesquisa.linha]?.[pesquisa.campo] as string | undefined}
      modo="flutuante" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />}
  </>;
}

/**
 * O controle da pesquisa no formulário do item (produto, armazém): o `CampoDaCentral` injeta `id` (que liga o rótulo ao
 * botão — sem ele o leitor de tela não o nomeia) e `className` (que o põe dentro da caixa do desenho).
 */
function CampoReferenciaBotao({ recurso, valor, conhecido, aberto, onAbrir, id: idDoCampo, className }: { recurso: string; valor?: string; conhecido?: OpcaoReal; aberto: boolean; onAbrir: (el: HTMLElement) => void; id?: string; className?: string }) {
  const o = useRotulo(recurso, valor, conhecido);
  return <button type="button" id={idDoCampo} className={cn("cmd-display", !o && "is-empty", className)} aria-haspopup="listbox" aria-expanded={aberto} onClick={(e) => onAbrir(e.currentTarget)}>
    {o ? <span>{o.code ? `${o.code} · ` : ""}{o.label}</span> : <span className="cmd-display-placeholder">Pesquisar</span>}
  </button>;
}
