"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Grid3x3, Lock, Plus, Search, Trash2 } from "lucide-react";
import { getResource } from "@agro/domain";
import { cn, brl, num, dateBR } from "@/lib/utils";
import { api } from "@/lib/api";
import { Input } from "@/components/ui";
import { StockCell, totalDaLinhaExibido, type ItemRow } from "@/features/docs/shared";
import { EstoqueDisponivelDoItem } from "@/features/stock/reserva-estoque";
import { PainelDePesquisa } from "./pesquisa";
import { useFonteDaPesquisaDeProdutos } from "./pesquisa-de-produtos";
import { CampoDaCentral } from "./campo";
import { ConfigurarColunas } from "./configurar-colunas";
import { BotaoAmpliar } from "./moldura";
import estilos from "./moldura.module.css";
import grade from "./grade.module.css";
import type {
  ChaveCampoDoItem, ChaveColunaDoItem, LayoutDosItens, OpcaoReal, Preferencia, PropsDosItens, Visao
} from "./contrato";

export type { ChaveCampoDoItem, ChaveColunaDoItem, ItensDaOrigem, LayoutDosItens, LoteDosItens, PropsDosItens } from "./contrato";

/**
 * ITENS DA CENTRAL — o MOTOR (VISUAL-UX-04): duas VISÕES (e as duas juntas) do MESMO `items`.
 *
 * Cópia fiel da grade/formulário da criação (VISUAL-UX-01 R1, VISUAL-UX-02): fonte única (`items`/`onChange` da
 * página, nenhuma cópia), marcação por círculo, item corrente de Duplicar/Remover, Configurar colunas sem persistência,
 * unidade do produto só para exibir e `efeitosDoEstoque` sempre montado (o custo médio do unitário vazio não depende da
 * coluna Estoque estar à vista; `custoMedioNoUnitario={false}` desliga só a escrita, e a leitura continua).
 *
 * O que é da ESPÉCIE chega por props: o prefixo dos testids, as colunas do sistema e o mapa catálogo → coluna. Os
 * recursos novos — lote/validade por linha (`lote`), armazém permitido por item (`armazemPorItem`), armazém forçado
 * sobre o layout (`armazemForcado`) e o modo "da origem" (`daOrigem`) — são opcionais e desligados por padrão: sem eles
 * o DOM, as classes e o payload são os de antes. `custoMedioNoUnitario` é ligado por padrão (o de antes).
 *
 * OPERACOES-01 F3b (decisão 280): o Local vem antes do produto (sem layout e na coluna forçada; com layout, manda o
 * layout); a linha nova nasce com o `armazemPadrao` (o "Local de estoque" do cabeçalho, estado da tela); a pesquisa de
 * produto usa o local da LINHA e o sentido da espécie (`pesquisaDeProduto`; ausente = entrada) — com a capacidade da
 * pesquisa nova; sem ela, a de hoje.
 *
 * OPERACOES-01 F5b (decisão 282): `linhaNovaEmBranco` (a linha nova sem quantidade nem unitário), `subtotal={false}`
 * (o rodapé sem "Subtotal dos itens") e `casasDaQuantidade` (a quantidade da célula não ativa) — acréscimos com o
 * padrão de hoje: sem eles, nada muda.
 */

/**
 * A linha nova: quantidade 1, unitário 0, gera estoque; com armazém padrão, só o `warehouse_id` a mais. `emBranco`
 * (OPERACOES-01 F5b): quantidade e unitário VAZIOS — o resto igual.
 */
const linhaNova = (armazem?: string, emBranco = false): ItemRow => ({
  product_id: "", quantity: emBranco ? "" : "1", unit_value: emBranco ? "" : "0", generate_stock: true, ...(armazem ? { warehouse_id: armazem } : {})
});

/** Colunas da grade. `largura` é a do protótipo; Produto é a coluna elástica (mínimo). */
const COLUNAS: Record<ChaveColunaDoItem, { rotulo: string; largura: number; numero?: boolean; elastica?: boolean }> = {
  codigo: { rotulo: "Código", largura: 70 },
  produto: { rotulo: "Produto", largura: 170, elastica: true },
  // 122, não os 108 do protótipo: "Local de estoque" (OPERACOES-01 F3a) cabe inteiro também com o "*" de coluna obrigatória
  armazem: { rotulo: "Local de estoque", largura: 122 },
  estoque: { rotulo: "Estoque", largura: 74, numero: true },
  saldo: { rotulo: "Saldo", largura: 90, numero: true },
  quantidade: { rotulo: "Quantidade", largura: 104, numero: true },
  unitario: { rotulo: "Valor unitário", largura: 108, numero: true },
  desconto: { rotulo: "Desconto", largura: 88, numero: true },
  descontoPercentual: { rotulo: "Desconto %", largura: 90, numero: true },
  total: { rotulo: "Total", largura: 102, numero: true },
  lote: { rotulo: "Lote", largura: 110 },
  validade: { rotulo: "Validade", largura: 112 }
};
/** A coluna do círculo de seleção, do desenho. */
const LARGURA_SELECAO = 34;
/**
 * A ordem de sempre (as nove de hoje), com o Local antes do produto (decisão 280: é o local que decide o saldo; o
 * Código fica junto do Produto). `saldo`, `lote` e `validade` só entram quando ligados.
 */
const ORDEM_COLUNAS: readonly ChaveColunaDoItem[] = ["armazem", "codigo", "produto", "estoque", "saldo", "quantidade", "unitario", "desconto", "descontoPercentual", "total", "lote", "validade"];
const OPCIONAIS: ReadonlySet<ChaveColunaDoItem> = new Set(["saldo", "lote", "validade"]);

const CAMPOS: Record<ChaveCampoDoItem, string> = {
  produto: "Produto", armazem: "Local de estoque", estoque: "Estoque", saldo: "Saldo", unidade: "Unidade", quantidade: "Quantidade",
  unitario: "Valor unitário", desconto: "Desconto", descontoPercentual: "Desconto %", total: "Total", lote: "Lote", validade: "Validade"
};
/** O formulário na mesma ordem da grade (decisão 280: o Local antes do produto). */
const ORDEM_CAMPOS: readonly ChaveCampoDoItem[] = ["armazem", "produto", "estoque", "saldo", "unidade", "quantidade", "unitario", "desconto", "descontoPercentual", "total", "lote", "validade"];

/** Chave do ITEM (`ItemRow`) de cada coluna — usada quando o catálogo da espécie não mapeia a coluna (caminho de erro). */
const CHAVE_DO_ITEM: Partial<Record<ChaveColunaDoItem, string>> = {
  produto: "product_id", armazem: "warehouse_id", quantidade: "quantity", unitario: "unit_value", desconto: "discount",
  descontoPercentual: "discount_percent", lote: "provider_lot", validade: "expiration_date"
};

const padrao = <K extends string>(chaves: readonly K[]): Preferencia<K>[] => chaves.map((chave) => ({ chave, visivel: true }));
const ehChaveColuna = (k: string): k is ChaveColunaDoItem => k in COLUNAS;

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

/** Símbolo da unidade do produto, pela MESMA leitura e MESMA chave de cache de `useRotulo`. */
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

function Unidade({ produto, testId }: { produto?: string; testId: string }) {
  const u = useUnidadeDoProduto(produto || undefined);
  return u ? <span className={grade.unidade} data-testid={testId}>{u}</span> : null;
}

function UnidadeTravada({ produto }: { produto?: string }) {
  const u = useUnidadeDoProduto(produto || undefined);
  return <>{u ?? "—"}</>;
}

/** A célula de pesquisa da grade (produto, armazém): o botão do desenho, com a lupa à esquerda. */
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

/** Modo "da origem": o produto vem do documento de origem e não se troca — o rótulo, sem pesquisa. */
function CelulaTravada({ recurso, id, conhecido, testId }: { recurso: string; id?: string; conhecido?: OpcaoReal; testId: string }) {
  const o = useRotulo(recurso, id || undefined, conhecido);
  return <span className={grade.celulaBotao} data-testid={testId} data-travado="">
    <span className={o ? undefined : grade.celulaVazia}>{o?.label ?? "—"}</span>
    <span className={grade.celulaIcone} aria-hidden><Lock /></span>
  </span>;
}

function RotuloTravado({ recurso, id }: { recurso: string; id?: string }) {
  const o = useRotulo(recurso, id || undefined, undefined);
  return <>{o ? `${o.code ? `${o.code} · ` : ""}${o.label}` : "—"}</>;
}

function CodigoDoProduto({ id, conhecido }: { id?: string; conhecido?: OpcaoReal }) {
  const o = useRotulo("products", id || undefined, conhecido);
  return <span>{o?.code ?? (id ? "" : "—")}</span>;
}

export function ItensDaCentral({
  prefixoTestid, colunas: colunasDaEspecie, items, onChange, layout, erros, armazemPadrao, pesquisaDeProduto = null, reservaEstoque = null,
  armazemPorItem, armazemForcado = false, custoMedioNoUnitario = true, lote = null, daOrigem = null,
  linhaNovaEmBranco = false, subtotal: comSubtotal = true, casasDaQuantidade = 2
}: PropsDosItens) {
  const tid = (sufixo: string) => `${prefixoTestid}-${sufixo}`;
  // a capacidade da pesquisa nova é perguntada ao montar os itens (uma vez por sessão): ao abrir a pesquisa ela já chegou
  const fonteDaPesquisa = useFonteDaPesquisaDeProdutos();
  const { doSistema, doCatalogo } = colunasDaEspecie;
  /** Coluna → chave do catálogo da espécie (inverso de `doCatalogo`); sem catálogo, a chave do item. */
  const chaveDoCatalogo = React.useMemo(() => {
    const m = new Map<ChaveColunaDoItem, string>();
    for (const [campo, coluna] of Object.entries(doCatalogo)) m.set(coluna, campo);
    return m;
  }, [doCatalogo]);
  const catalogo = (k: ChaveColunaDoItem) => chaveDoCatalogo.get(k) ?? CHAVE_DO_ITEM[k] ?? k;

  /** Quais colunas este uso liga. Desligado tudo: as nove de hoje. */
  const ligada = React.useCallback((k: ChaveColunaDoItem) => {
    if (k === "saldo") return Boolean(daOrigem);
    if (k === "lote" || k === "validade") return Boolean(lote);
    if (k === "armazem") return armazemPorItem !== false;
    return true;
  }, [daOrigem, lote, armazemPorItem]);
  const chavesColunas = React.useMemo(() => ORDEM_COLUNAS.filter(ligada), [ligada]);
  const chavesCampos = React.useMemo(() => ORDEM_CAMPOS.filter((k) => k === "unidade" || ligada(k)), [ligada]);

  const colunasDoLayout = React.useCallback((l: LayoutDosItens) =>
    l.colunas.flatMap((c) => { const k = doCatalogo[c.campo]; return k && ligada(k) ? [{ chave: k, rotulo: c.rotulo, obrigatorio: c.obrigatorio }] : []; }),
  [doCatalogo, ligada]);
  /** Com layout: as do layout, na ordem dele, mais as ligadas que o catálogo não conhece (na posição de sempre). */
  const chavesDoLayout = React.useCallback((l: LayoutDosItens): ChaveColunaDoItem[] => {
    const lista = colunasDoLayout(l).map((c) => c.chave);
    for (const k of chavesColunas) {
      if (lista.includes(k) || !OPCIONAIS.has(k) || chaveDoCatalogo.has(k)) continue;
      const depois = ORDEM_COLUNAS.slice(0, ORDEM_COLUNAS.indexOf(k)).filter((x) => lista.includes(x)).pop();
      lista.splice(depois ? lista.indexOf(depois) + 1 : 0, 0, k);
    }
    // PERMITIR (`armazemPorItem`, em `ligada`) não é FORÇAR: só `armazemForcado` passa por cima do layout — e o põe
    // logo ANTES do Código/Produto (decisão 280: o local antes do produto); sem nenhum dos dois, no início
    if (armazemForcado === true && ligada("armazem") && !lista.includes("armazem")) {
      const ancoras = (["codigo", "produto"] as const).map((k) => lista.indexOf(k)).filter((x) => x >= 0);
      lista.splice(ancoras.length ? Math.min(...ancoras) : 0, 0, "armazem");
    }
    return lista;
  }, [colunasDoLayout, chavesColunas, armazemForcado, ligada, chaveDoCatalogo]);
  const camposDoLayout = React.useCallback((l: LayoutDosItens): ChaveCampoDoItem[] => {
    const lista: ChaveCampoDoItem[] = chavesDoLayout(l).filter((k): k is Exclude<ChaveColunaDoItem, "codigo"> => k !== "codigo");
    const i = lista.indexOf("quantidade");
    lista.splice(i >= 0 ? i : lista.length, 0, "unidade");
    return lista;
  }, [chavesDoLayout]);

  const [visao, setVisao] = React.useState<Visao>("grade");
  const [ambos, setAmbos] = React.useState(false);
  /** A linha marcada (uma por vez) — -1: nenhuma. */
  const [selecionado, setSelecionado] = React.useState<number>(-1);
  const [pesquisa, setPesquisa] = React.useState<{ linha: number; campo: "product_id" | "warehouse_id"; ancora: HTMLElement | null; modo: "flutuante" | "fluxo" } | null>(null);
  /** Rótulos das escolhas feitas nesta sessão — só apresentação, nunca entra no payload. */
  const [conhecidos, setConhecidos] = React.useState<Record<string, OpcaoReal>>({});
  const circulos = React.useRef<(HTMLButtonElement | null)[]>([]);
  const colunasPadrao = React.useCallback(() => (layout ? padrao(chavesDoLayout(layout)) : padrao(chavesColunas)), [layout, chavesDoLayout, chavesColunas]);
  const camposPadrao = React.useCallback(() => (layout ? padrao(camposDoLayout(layout)) : padrao(chavesCampos)), [layout, camposDoLayout, chavesCampos]);
  const [colunas, setColunas] = React.useState<Preferencia<ChaveColunaDoItem>[]>(colunasPadrao);
  const [campos, setCampos] = React.useState<Preferencia<ChaveCampoDoItem>[]>(camposPadrao);
  const layoutAplicado = React.useRef<LayoutDosItens | null | undefined>(undefined);
  React.useEffect(() => {
    if (layoutAplicado.current === layout) return;
    const primeiro = layoutAplicado.current === undefined;
    layoutAplicado.current = layout;
    if (primeiro && !layout) return;
    setColunas(colunasPadrao()); setCampos(camposPadrao());
  }, [layout, colunasPadrao, camposPadrao]);
  const doLayout = React.useMemo(() => (layout ? new Map(colunasDoLayout(layout).map((c) => [c.chave, c])) : null), [layout, colunasDoLayout]);
  /** As colunas que o layout permite (as dele, mais as ligadas que ele não conhece). */
  const permitidas = React.useMemo(() => (layout ? new Set(chavesDoLayout(layout)) : null), [layout, chavesDoLayout]);
  const rotuloColuna = (k: ChaveColunaDoItem) => doLayout?.get(k)?.rotulo || COLUNAS[k].rotulo;
  const rotuloCampo = (k: ChaveCampoDoItem) => (ehChaveColuna(k) && doLayout?.get(k)?.rotulo) || CAMPOS[k];
  const obrigatoria = (k: ChaveColunaDoItem) => Boolean(doLayout?.get(k)?.obrigatorio) || Boolean(reservaEstoque?.obrigatorias.includes(catalogo(k)));
  /** `data-campo` só existe com layout: sem a capacidade o DOM é o de hoje. */
  const dataCampo = (k: ChaveColunaDoItem) => (layout ? { "data-campo": catalogo(k) } : {});
  const erroDe = (i: number, k: ChaveColunaDoItem) => erros?.[`items[${i}].${catalogo(k)}`];
  const errosDosItens = erros ? Object.entries(erros).filter(([c]) => c.startsWith("items[")) : [];
  const pendente = (i: number) => errosDosItens.some(([c]) => c.startsWith(`items[${i}]`));

  // marca nunca órfã: se o array encolheu, a marca vem junto
  const sel = selecionado >= items.length ? items.length - 1 : selecionado;
  React.useEffect(() => { if (sel !== selecionado) setSelecionado(sel); }, [sel, selecionado]);

  const mostraGrade = visao === "grade" || ambos;
  const mostraFormulario = visao === "formulario";
  const atual = sel >= 0 ? sel : items.length ? 0 : -1;
  const corrente = mostraFormulario ? atual : sel;

  /** Modo "da origem": não se acrescenta nem duplica; com a quantidade travada, também não se remove. */
  const podeAdicionar = !daOrigem;
  const podeRemover = !daOrigem?.quantidadeTravada;

  const atualizar = (i: number, chave: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [chave]: v } : it)));
  const adicionar = () => {
    if (!podeAdicionar) return;
    // rótulo vazio não vira "conhecido": a célula lê o rótulo do cadastro
    if (armazemPadrao && armazemPadrao.rotulo) {
      const { id, rotulo } = armazemPadrao;
      setConhecidos((c) => (c[id] ? c : { ...c, [id]: { id, label: rotulo, code: null } }));
    }
    onChange([...items, linhaNova(armazemPadrao?.id, linhaNovaEmBranco)]); setSelecionado(items.length);
  };
  const duplicar = () => {
    if (!podeAdicionar) return;
    const c = corrente;
    const original = items[c];
    if (!original) return;
    onChange([...items.slice(0, c + 1), { ...original }, ...items.slice(c + 1)]);
    setPesquisa(null);
    setSelecionado(c + 1);
  };
  const remover = () => {
    if (!podeRemover) return;
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
  /**
   * O que a pesquisa de PRODUTO sabe: a fonte (capacidade), o local da LINHA (o que vai no POST — nunca o do cabeçalho)
   * e o sentido (ausente = entrada). A pesquisa de local não o recebe.
   */
  const produtoNaPesquisa = (linha: number) => ({
    fonte: fonteDaPesquisa,
    armazemId: items[linha]?.warehouse_id || undefined,
    sentido: pesquisaDeProduto?.sentido ?? "entrada",
    soControlaEstoque: pesquisaDeProduto?.soControlaEstoque
  });
  const marcarEFocar = (i: number) => { setSelecionado(i); requestAnimationFrame(() => circulos.current[i]?.focus()); };

  const tecladoDoCirculo = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (i + 1 < items.length) marcarEFocar(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (i > 0) marcarEFocar(i - 1); }
  };
  const cliqueNaGrade = (e: React.MouseEvent<HTMLDivElement>) => {
    const alvo = e.target as Element;
    if (!alvo.closest("tr[aria-selected]") && sel >= 0) setSelecionado(-1);
  };

  const subtotal = items.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const item = atual >= 0 ? items[atual] : undefined;

  const colunasVisiveis = colunas.filter((c) => c.visivel && ligada(c.chave) && (!permitidas || permitidas.has(c.chave))).map((c) => c.chave);
  // largura mínima DERIVADA das colunas visíveis (o círculo + cada coluna), nunca contada à mão
  const larguraMinima = LARGURA_SELECAO + colunasVisiveis.reduce((a, k) => a + COLUNAS[k].largura, 0);

  /** O saldo de ESTOQUE mostrado. Só exibe — quem preenche o custo médio (com `custoMedioNoUnitario`) é `efeitosDoEstoque`. */
  const saldoDoItem = (it: ItemRow) => (reservaEstoque
    ? <EstoqueDisponivelDoItem warehouseId={it.warehouse_id} productId={it.product_id} />
    : <StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={() => { /* só exibe */ }} />);
  const loteDe = (it: ItemRow) => (lote ? lote.daLinha(it) : { lote: false, validade: false });
  const maxDaOrigem = (it: ItemRow) => (daOrigem ? daOrigem.saldo(it) : undefined);

  const celula = (k: ChaveColunaDoItem, it: ItemRow, i: number, ativa: boolean) => {
    switch (k) {
      case "codigo": return <td key={k}><CodigoDoProduto id={it.product_id} conhecido={conhecidos[it.product_id]} /></td>;
      case "produto": return <td key={k}>{daOrigem
        ? <CelulaTravada recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} testId={tid("produto")} />
        : <CelulaDeReferencia recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} vazio="Selecione o produto" erro={pendente(i)}
          rotuloAcao={(o) => (o ? `Trocar o produto do item ${i + 1}` : `Selecionar o produto do item ${i + 1}`)}
          aberto={pesquisa?.linha === i && pesquisa.campo === "product_id"} testId={tid("produto")}
          onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "product_id", ancora: el, modo: "flutuante" }); }} />}</td>;
      case "armazem": return <td key={k}><CelulaDeReferencia recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} vazio="—"
        rotuloAcao={(o) => (o ? `Local de estoque: ${o.label}` : "Local de estoque")}
        aberto={pesquisa?.linha === i && pesquisa.campo === "warehouse_id"} testId={tid("armazem")}
        onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "warehouse_id", ancora: el, modo: "flutuante" }); }} /></td>;
      case "estoque": return <td key={k} className={cn(grade.numero, grade.estoque)}>{saldoDoItem(it)}</td>;
      case "saldo": return <td key={k} className={grade.numero} data-testid={tid("saldo-da-origem")}>{num(maxDaOrigem(it) ?? "0", 4)}</td>;
      case "quantidade": return <td key={k} className={grade.numero}><span className={grade.quantidade}>
        {ativa && !daOrigem?.quantidadeTravada
          ? <input className={grade.entrada} aria-label={`Quantidade do item ${i + 1}`} type="number" step="0.0001" min="0" max={maxDaOrigem(it)} value={it.quantity} onChange={(e) => atualizar(i, "quantity", e.target.value)} />
          : <span data-testid={tid("quantidade")}>{num(linhaNovaEmBranco ? it.quantity : it.quantity || "0", casasDaQuantidade)}</span>}
        <Unidade produto={it.product_id} testId={tid("unidade")} />
      </span></td>;
      case "unitario": return <td key={k} className={grade.numero}>{ativa ? <input className={grade.entrada} aria-label={`Valor unitário do item ${i + 1}`} type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => atualizar(i, "unit_value", e.target.value)} /> : brl(it.unit_value ?? "0")}</td>;
      case "desconto": return <td key={k} className={grade.numero}>{Number(it.discount || 0) ? brl(it.discount!) : "—"}</td>;
      case "descontoPercentual": return <td key={k} className={grade.numero}>{Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : "—"}</td>;
      case "total": return <td key={k} className={cn(grade.numero, grade.forte)}>{brl(totalDaLinhaExibido(it))}</td>;
      case "lote": {
        const aceita = loteDe(it).lote;
        return <td key={k} data-testid={tid("lote")}>{ativa && aceita
          ? <input className={grade.entrada} aria-label={`Lote do item ${i + 1}`} value={it.provider_lot ?? ""} onChange={(e) => atualizar(i, "provider_lot", e.target.value)} />
          : it.provider_lot || "—"}</td>;
      }
      case "validade": {
        const aceita = loteDe(it).validade;
        return <td key={k} data-testid={tid("validade")}>{ativa && aceita
          ? <input className={grade.entrada} aria-label={`Validade do item ${i + 1}`} type="date" value={it.expiration_date ?? ""} onChange={(e) => atualizar(i, "expiration_date", e.target.value)} />
          : it.expiration_date ? dateBR(it.expiration_date) : "—"}</td>;
      }
    }
  };

  const tabulavel = sel >= 0 ? sel : 0;

  const tabela = <div className={grade.rolagem} onClick={cliqueNaGrade}>
    <table className={grade.grade} style={{ minWidth: larguraMinima }} aria-label="Itens do documento" data-testid={tid("grade")}>
      <colgroup><col style={{ width: LARGURA_SELECAO }} />{colunasVisiveis.map((k) => <col key={k} style={COLUNAS[k].elastica ? { minWidth: COLUNAS[k].largura } : { width: COLUNAS[k].largura }} />)}</colgroup>
      <thead><tr>
        <th scope="col" className={grade.celulaSelecao} aria-label="Seleção" />
        {colunasVisiveis.map((k) => <th key={k} scope="col" {...dataCampo(k)}>{rotuloColuna(k)}{obrigatoria(k) && !doSistema.has(catalogo(k)) && <span className="req text-red-500"> *</span>}</th>)}
      </tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={1 + colunasVisiveis.length} className={grade.vazio}>
          <div className={grade.vazioConteudo}>
            <span>Nenhum item adicionado.</span>
            {podeAdicionar && <button type="button" className={grade.botaoTexto} data-testid={tid("adicionar-vazio")} onClick={(e) => { e.stopPropagation(); adicionar(); }}><Plus aria-hidden />Adicionar produto</button>}
          </div>
        </td></tr>}
        {items.map((it, i) => {
          const ativa = i === sel;
          return <tr key={i} className={cn(grade.linha, ativa && grade.linhaMarcada, pendente(i) && grade.linhaComErro)}
            aria-selected={ativa} data-testid={daOrigem?.testIdDaLinha ? daOrigem.testIdDaLinha(it) : tid("linha")}>
            <td className={grade.celulaSelecao}>
              <button type="button" role="checkbox" aria-checked={ativa} aria-label={`Selecionar item ${i + 1}`} className={grade.circulo} data-testid={tid("selecionar-item")}
                ref={(el) => { circulos.current[i] = el; }} tabIndex={i === tabulavel ? 0 : -1}
                onClick={(e) => { e.stopPropagation(); setSelecionado(ativa ? -1 : i); }} onKeyDown={(e) => tecladoDoCirculo(e, i)}>
                {ativa && <Check aria-hidden strokeWidth={2} />}
              </button>
            </td>
            {colunasVisiveis.map((k) => {
              const td = celula(k, it, i, ativa);
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
    ? <PainelDePesquisa key={`fluxo-${campo}`} recurso={campo === "product_id" ? "products" : "warehouses"} rotulo={campo === "product_id" ? "Pesquisar produto" : "Pesquisar local de estoque"}
        valor={item?.[campo] as string | undefined} modo="fluxo" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId={tid("pesquisa")}
        produto={campo === "product_id" ? produtoNaPesquisa(pesquisa.linha) : null} />
    : null;

  const doCampo = (k: ChaveColunaDoItem) => ({ attrs: dataCampo(k), required: obrigatoria(k), error: erroDe(atual, k), label: rotuloColuna(k) });
  const campoDeReferencia = (campo: "product_id" | "warehouse_id", recurso: string) => {
    const id = (item?.[campo] as string | undefined) || undefined;
    const d = doCampo(campo === "product_id" ? "produto" : "armazem");
    if (campo === "product_id" && daOrigem) {
      return <CampoDaCentral rotulo={d.label} estado="travado" {...d.attrs}><RotuloTravado recurso={recurso} id={id} /></CampoDaCentral>;
    }
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} icone="pesquisa" preenchido={Boolean(id)} {...d.attrs}>
      <CampoReferenciaBotao recurso={recurso} valor={id} conhecido={id ? conhecidos[id] : undefined} aberto={Boolean(pesquisa?.modo === "fluxo" && pesquisa.campo === campo)}
        onAbrir={(el) => setPesquisa(pesquisa?.modo === "fluxo" && pesquisa.campo === campo ? null : { linha: atual, campo, ancora: el, modo: "fluxo" })} />
    </CampoDaCentral>;
  };
  const campoNumerico = (k: "quantidade" | "unitario" | "desconto" | "descontoPercentual", chave: "quantity" | "unit_value" | "discount" | "discount_percent", valor: string, extra: { step: string; max?: string; desabilitado?: boolean }) => {
    const d = doCampo(k);
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} preenchido={valor !== ""} {...(extra.desabilitado ? { estado: "desabilitado" as const } : {})} {...d.attrs}>
      <Input type="number" step={extra.step} min="0" max={extra.max} disabled={extra.desabilitado || undefined} value={valor} onChange={(e) => atualizar(atual, chave, e.target.value)} />
    </CampoDaCentral>;
  };
  const campoDeTexto = (k: "lote" | "validade", chave: "provider_lot" | "expiration_date", valor: string, aceita: boolean) => {
    const d = doCampo(k);
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} preenchido={valor !== ""} {...(aceita ? {} : { estado: "desabilitado" as const })} testId={tid(`item-${k}`)} {...d.attrs}>
      <Input type={k === "validade" ? "date" : "text"} disabled={!aceita || undefined} value={valor} onChange={(e) => atualizar(atual, chave, e.target.value)} />
    </CampoDaCentral>;
  };

  const campoDoItem = (k: ChaveCampoDoItem, it: ItemRow): React.ReactNode => {
    switch (k) {
      case "produto": return <>{campoDeReferencia("product_id", "products")}{pesquisaEmFluxo("product_id")}</>;
      case "armazem": return <>{campoDeReferencia("warehouse_id", "warehouses")}{pesquisaEmFluxo("warehouse_id")}</>;
      case "estoque": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" data-campo={layout ? "estoque" : undefined}>{saldoDoItem(it)}</CampoDaCentral>;
      case "saldo": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" testId={tid("item-saldo")}>{num(maxDaOrigem(it) ?? "0", 4)}</CampoDaCentral>;
      case "unidade": return <CampoDaCentral rotulo="Unidade" estado="travado" testId={tid("item-unidade")}><UnidadeTravada produto={it.product_id} /></CampoDaCentral>;
      case "quantidade": return campoNumerico(k, "quantity", it.quantity, { step: "0.0001", ...(daOrigem ? { max: maxDaOrigem(it), desabilitado: daOrigem.quantidadeTravada } : {}) });
      case "unitario": return campoNumerico(k, "unit_value", it.unit_value ?? "", { step: "0.000001" });
      case "desconto": return campoNumerico(k, "discount", it.discount ?? "", { step: "0.01" });
      case "descontoPercentual": return campoNumerico(k, "discount_percent", it.discount_percent ?? "", { step: "0.01", max: "100" });
      case "total": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" data-campo={layout ? "total" : undefined}><span data-testid={tid("item-total")}>{brl(totalDaLinhaExibido(it))}</span></CampoDaCentral>;
      case "lote": return campoDeTexto(k, "provider_lot", it.provider_lot ?? "", loteDe(it).lote);
      case "validade": return campoDeTexto(k, "expiration_date", it.expiration_date ?? "", loteDe(it).validade);
    }
  };

  const formulario = <div className={grade.form} data-testid={tid("item-form")}>
    {!item ? <div className={grade.formVazio}>Nenhum item adicionado.</div> : <>
      <div className={grade.formNav}>
        <span className={grade.formNavTitulo} data-testid={tid("item-posicao")}>Item {atual + 1} de {items.length}</span>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Item anterior" data-dica="Item anterior" disabled={atual <= 0} onClick={() => { setPesquisa(null); setSelecionado(atual - 1); }}><ChevronLeft aria-hidden /></button>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Próximo item" data-dica="Próximo item" disabled={atual >= items.length - 1} onClick={() => { setPesquisa(null); setSelecionado(atual + 1); }}><ChevronRight aria-hidden /></button>
        {!item.product_id && <span className={grade.selo} data-testid={tid("item-novo")}>novo</span>}
      </div>
      <div className={grade.formCampos}>
        {campos.filter((c) => c.visivel && (c.chave === "unidade" || ligada(c.chave)) && (!permitidas || !ehChaveColuna(c.chave) || permitidas.has(c.chave))).map((c) => <React.Fragment key={c.chave}>{campoDoItem(c.chave, item)}</React.Fragment>)}
      </div>
    </>}
  </div>;

  /*
    `efeitosDoEstoque`: uma `StockCell` por linha, fora da vista e SEMPRE montada — é ela quem preenche o unitário
    VAZIO com o custo médio. Se morasse na célula visível, esconder a coluna ou trocar de visão a remontaria e o
    unitário zerado de propósito voltaria a ser o custo médio (apresentação mudando o POST).
    Com `custoMedioNoUnitario={false}` (a compra: o unitário é o preço do fornecedor, e "0" é bonificação) a célula
    continua montada e lendo o saldo, mas não escreve nada: o "0" digitado é o que vai no POST.
  */
  const preencherCusto = (it: ItemRow, i: number, c: string) => {
    if (!custoMedioNoUnitario) return;
    if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c);
  };
  const efeitosDoEstoque = <div hidden>{items.map((it, i) => <StockCell key={i} warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => preencherCusto(it, i, c)} />)}</div>;

  const configDoFormulario = visao === "formulario";
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
      {podeAdicionar && <button type="button" className={cn(grade.botao, grade.botaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar produto" data-dica="Adicionar produto" data-testid={tid("adicionar-item")} onClick={adicionar}><Plus aria-hidden /></button>}
      {corrente >= 0 && <>
        {podeAdicionar && <button type="button" className={cn(grade.botao, grade.botaoAcaoItem, estilos.dicaInicio)} aria-label="Duplicar item" data-dica="Duplicar item" data-testid={tid("duplicar-item")} onClick={duplicar}><Copy aria-hidden /></button>}
        {podeRemover && <button type="button" className={cn(grade.botao, grade.botaoAcaoItem, grade.botaoRemover, estilos.dicaInicio)} aria-label="Remover item" data-dica="Remover item" data-testid={tid("remover-item")} onClick={remover}><Trash2 aria-hidden /></button>}
      </>}
      <span className={grade.espaco} />
      <div className={grade.segmento} role="group" aria-label="Visualização dos itens">
        <button type="button" aria-pressed={visao === "grade"} aria-label="Grade" data-dica="Grade" onClick={() => escolherVisao("grade")}><Grid3x3 aria-hidden /></button>
        <button type="button" aria-pressed={visao === "formulario"} aria-label="Formulário" data-dica="Formulário" data-visao="formulario" onClick={() => escolherVisao("formulario")}><FileText aria-hidden /></button>
      </div>
      {configDoFormulario
        ? <ConfigurarColunas<ChaveCampoDoItem> prefixoTestid={prefixoTestid} titulo="Visualização do formulário" subtitulo="Campos visíveis e ordem"
            rotulos={Object.fromEntries(chavesCampos.map((k) => [k, rotuloCampo(k)])) as Record<ChaveCampoDoItem, string>}
            lista={campos} onLista={setCampos} onRestaurar={() => setCampos(camposPadrao())} ambos={ambos} onAmbos={alternarAmbos} />
        : <ConfigurarColunas<ChaveColunaDoItem> prefixoTestid={prefixoTestid} titulo="Colunas da grade" subtitulo="Colunas visíveis e ordem"
            rotulos={Object.fromEntries(chavesColunas.map((k) => [k, rotuloColuna(k)])) as Record<ChaveColunaDoItem, string>}
            lista={colunas} onLista={setColunas} onRestaurar={() => setColunas(colunasPadrao())} ambos={ambos} onAmbos={alternarAmbos} />}
    </div>
    <div className={grade.corpo} data-visao={ambos ? "ambos" : visao} data-testid={tid("itens-corpo")}>
      {mostraGrade && tabela}
      {mostraFormulario && formulario}
      {efeitosDoEstoque}
    </div>
    {errosDosItens.length > 0 && <div role="alert" data-testid={tid("itens-erros")} className="px-3 py-1 text-[11px] text-red-600">
      {errosDosItens.map(([caminho, msg]) => { const n = /^items\[(\d+)\]/.exec(caminho); return <p key={caminho} data-erro-campo={caminho}>{n ? `Item ${Number(n[1]) + 1}: ` : ""}{msg}</p>; })}
    </div>}
    <div className={grade.rodape} data-testid={tid("itens-rodape")}>
      <span className={grade.rodapeTitulo}>Itens <span className={grade.rodapeContagem} data-testid={tid("itens-contagem")}>({items.length})</span>
        {errosDosItens.length > 0 && <span className={grade.pontoErro} data-testid={tid("itens-erro")} title="Há itens com pendência" />}</span>
      {comSubtotal && <span>Subtotal dos itens <b className={grade.rodapeValor} data-testid={tid("subtotal")}>{brl(subtotal)}</b></span>}
    </div>
    {pesquisa?.modo === "flutuante" && <PainelDePesquisa recurso={pesquisa.campo === "product_id" ? "products" : "warehouses"}
      rotulo={pesquisa.campo === "product_id" ? "Pesquisar produto" : "Pesquisar local de estoque"} valor={items[pesquisa.linha]?.[pesquisa.campo] as string | undefined}
      modo="flutuante" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId={tid("pesquisa")}
      produto={pesquisa.campo === "product_id" ? produtoNaPesquisa(pesquisa.linha) : null} />}
  </>;
}

/** O controle da pesquisa no formulário do item: o `CampoDaCentral` injeta `id` e `className`. */
function CampoReferenciaBotao({ recurso, valor, conhecido, aberto, onAbrir, id: idDoCampo, className }: { recurso: string; valor?: string; conhecido?: OpcaoReal; aberto: boolean; onAbrir: (el: HTMLElement) => void; id?: string; className?: string }) {
  const o = useRotulo(recurso, valor, conhecido);
  return <button type="button" id={idDoCampo} className={cn("cmd-display", !o && "is-empty", className)} aria-haspopup="listbox" aria-expanded={aberto} onClick={(e) => onAbrir(e.currentTarget)}>
    {o ? <span>{o.code ? `${o.code} · ` : ""}{o.label}</span> : <span className="cmd-display-placeholder">Pesquisar</span>}
  </button>;
}
