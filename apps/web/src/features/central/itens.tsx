"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, EyeOff, FileText, Grid3x3, Lock, MoreVertical, PanelLeft, Plus, Scaling, Search, Trash2 } from "lucide-react";
import { getResource } from "@agro/domain";
import { preferenciasDeLista, type ItensPreferences } from "@agro/shared";
import { cn, brl, num, dateBR } from "@/lib/utils";
import { CHROME_ICONE_NA_CELULA, fonteDaCelula, medirLarguraColuna } from "@/lib/largura-coluna";
import { api } from "@/lib/api";
import { EntradaNumero, Input } from "@/components/ui";
import { B1Popover, MenuList } from "@/features/base1/ui";
import { StockCell, totalDaLinhaExibido, type ItemRow } from "@/features/docs/shared";
import { EstoqueDisponivelDoItem } from "@/features/stock/reserva-estoque";
import { PainelDePesquisa } from "./pesquisa";
import { useFonteDaPesquisaDeProdutos } from "./pesquisa-de-produtos";
import { CampoDaCentral } from "./campo";
import { ConfigurarColunas } from "./configurar-colunas";
import { BotaoAmpliar } from "./moldura";
import { recomputarDescontoAposBruto, sincronizarDesconto } from "./desconto-da-linha";
import { useItensPrefs, blocoDeLista } from "./itens-prefs";
import estilos from "./moldura.module.css";
import grade from "./grade.module.css";
import { maximoDaQuantidade, type ChaveCampoDoItem, type ChaveColunaDoItem, type LayoutDosItens, type OpcaoReal, type Preferencia, type PropsDosItens,
  type TravasDaLinha, type Visao } from "./contrato";

export type { ChaveCampoDoItem, ChaveColunaDoItem, ItensDaOrigem, LayoutDosItens, LoteDosItens, PropsDosItens, TravasDaLinha } from "./contrato";

/**
 * ITENS DA CENTRAL — o MOTOR (VISUAL-UX-04): duas VISÕES (e as duas juntas) do MESMO `items`.
 *
 * Cópia fiel da grade/formulário da criação (VISUAL-UX-01 R1, VISUAL-UX-02): fonte única (`items`/`onChange` da
 * página, nenhuma cópia), marcação pela linha (sem checkbox), Duplicar/Remover sempre visíveis, Configurar colunas
 * com preferência por usuário (decisão 351), unidade do produto só para exibir e `efeitosDoEstoque` sempre montado
 * (o custo médio do unitário vazio não depende da coluna Estoque estar à vista; `custoMedioNoUnitario={false}`
 * desliga só a escrita, e a leitura continua).
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
 * OPERACOES-01 F10 (decisão 287): `linhaUnica` (padrão `false`) deixa a grade com a linha que a página criou — sem
 * Adicionar, Duplicar e Remover (o abastecimento); sem a prop, nada muda.
 * OPERACOES-01 F5b (decisão 282): `linhaNovaEmBranco` (a linha nova sem quantidade nem unitário), `subtotal={false}`
 * (o rodapé sem "Subtotal dos itens") e `casasDaQuantidade` (a quantidade da célula não ativa) — acréscimos com o
 * padrão de hoje: sem eles, nada muda.
 * EDITAR-02 (decisão 313): `travasDaLinha` (o que a edição do documento salvo recusa em cada linha: o item salvo que não
 * sai, o produto, a quantidade, o valor unitário e os descontos — o controle de sempre em leitura, pelos MESMOS ramos do
 * modo "da origem" e da célula não ativa; o teto da quantidade pelo MESMO `max` do receber, `maximoDaQuantidade`; o
 * motivo da trava na `dica` do campo do formulário do item) e `aceitaLinhaNova={false}` (sem Adicionar e Duplicar). Sem
 * eles, nada muda.
 * EDITAR-03 (decisão 315): `TravasDaLinha.armazem` (o local de estoque que a edição da venda recusa trocar naquela
 * linha) — a MESMA `CelulaTravada` do produto na grade (`warehouses`, o mesmo testid) e o MESMO ramo travado do produto
 * no formulário do item, com o motivo na `dica`. Desligada por padrão: sem ela, o local de hoje.
 */

/**
 * A linha nova: quantidade e unitário VAZIOS até haver produto (decisão 347); ao escolher o produto a qtd vira 1.
 * `emBranco` permanece na assinatura (OPERACOES-01 F5b) e hoje é o comportamento único.
 */
const linhaNova = (armazem?: string, _emBranco = false): ItemRow => ({
  product_id: "", quantity: "", unit_value: "", generate_stock: true, ...(armazem ? { warehouse_id: armazem } : {})
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
/** Largura mínima ao redimensionar coluna da grade. */
const LARGURA_MIN_COLUNA = 48;
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
function CelulaDeReferencia({ recurso, id, conhecido, vazio, erro, aberto, onAbrir, rotuloAcao, testId, tabulavel }: {
  recurso: string; id?: string; conhecido?: OpcaoReal; vazio: string; erro?: boolean; aberto: boolean; onAbrir: (el: HTMLElement) => void;
  rotuloAcao: (o: OpcaoReal | null) => string; testId: string; tabulavel?: boolean;
}) {
  const o = useRotulo(recurso, id || undefined, conhecido);
  return <button type="button" className={grade.celulaBotao} aria-haspopup="listbox" aria-expanded={aberto} aria-label={rotuloAcao(o)}
    tabIndex={tabulavel === false ? -1 : 0}
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
  armazemPorItem, armazemForcado = false, estoqueNaGrade = true, custoMedioNoUnitario = true, lote = null, daOrigem = null, linhaUnica = false,
  linhaNovaEmBranco = false, subtotal: comSubtotal = true, casasDaQuantidade = 2, travasDaLinha = null, aceitaLinhaNova = true,
  semSimboloDeMoeda = false
}: PropsDosItens) {
  const tid = (sufixo: string) => `${prefixoTestid}-${sufixo}`;
  /** Dinheiro na tela: com o símbolo (o de sempre) ou pt-BR sem `R$` — sempre 2 casas (315 → 315,00). */
  const dinheiro = (v: string | number) => (semSimboloDeMoeda ? num(v, 2) : brl(v));
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
    if (k === "estoque") return estoqueNaGrade !== false;
    return true;
  }, [daOrigem, lote, armazemPorItem, estoqueNaGrade]);
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

  const chavesDisponiveisColunas = React.useMemo(
    () => (layout ? chavesDoLayout(layout) : chavesColunas),
    [layout, chavesDoLayout, chavesColunas]
  );
  const chavesDisponiveisCampos = React.useMemo(
    () => (layout ? camposDoLayout(layout) : chavesCampos),
    [layout, camposDoLayout, chavesCampos]
  );
  const p = useItensPrefs(prefixoTestid, "itens", chavesDisponiveisColunas, chavesDisponiveisCampos);
  const prefs = p.prefs;
  const updCols = (fn: (c: ItensPreferences["columns"]) => ItensPreferences["columns"]) => p.update((x) => ({ ...x, columns: fn(x.columns) }));
  const updFields = (fn: (f: ItensPreferences["fields"]) => ItensPreferences["fields"]) => p.update((x) => ({ ...x, fields: fn(x.fields) }));

  const visao: Visao = prefs.visao === "formulario" ? "formulario" : "grade";
  const setVisao = (v: Visao) => p.update((x) => ({ ...x, visao: v }));
  /** A linha marcada (uma por vez) — -1: nenhuma. */
  const [selecionado, setSelecionado] = React.useState<number>(-1);
  const [pesquisa, setPesquisa] = React.useState<{ linha: number; campo: "product_id" | "warehouse_id"; ancora: HTMLElement | null; modo: "flutuante" | "fluxo" } | null>(null);
  /** Rótulos das escolhas feitas nesta sessão — só apresentação, nunca entra no payload. */
  const [conhecidos, setConhecidos] = React.useState<Record<string, OpcaoReal>>({});
  const larguras = (prefs.columns.widths ?? {}) as Partial<Record<ChaveColunaDoItem, number>>;
  /** Prefixo congelado: N = primeiras N colunas sticky (congelar a 3ª congela 1+2+3). */
  const setCongeladas = (n: number | ((prev: number) => number)) => {
    const atual = prefs.columns.frozen ?? 0;
    const next = typeof n === "function" ? n(atual) : n;
    updCols((c) => ({ ...c, frozen: Math.max(0, next) }));
  };
  /** Auto ajustar — preferência do usuário até desativar ou redimensionar à mão. */
  const autoFitKeys = React.useMemo(() => new Set((prefs.columns.autoFit ?? []) as ChaveColunaDoItem[]), [prefs.columns.autoFit]);
  const [menuColuna, setMenuColuna] = React.useState<ChaveColunaDoItem | null>(null);
  const raizItens = React.useRef<HTMLDivElement | null>(null);
  const colsRef = React.useRef<Partial<Record<ChaveColunaDoItem, HTMLTableColElement | null>>>({});
  const tabelaRef = React.useRef<HTMLTableElement | null>(null);
  const colunas = React.useMemo(
    () => preferenciasDeLista(chavesDisponiveisColunas, prefs.columns) as Preferencia<ChaveColunaDoItem>[],
    [chavesDisponiveisColunas, prefs.columns]
  );
  const campos = React.useMemo(
    () => preferenciasDeLista(chavesDisponiveisCampos, prefs.fields) as Preferencia<ChaveCampoDoItem>[],
    [chavesDisponiveisCampos, prefs.fields]
  );
  const setColunas = (lista: Preferencia<ChaveColunaDoItem>[]) => updCols((c) => ({ ...c, ...blocoDeLista(lista) }));
  const setCampos = (lista: Preferencia<ChaveCampoDoItem>[]) => updFields(() => blocoDeLista(lista));
  const restaurarColunas = () => updCols(() => ({}));
  const restaurarCampos = () => updFields(() => ({}));
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

  const mostraGrade = visao === "grade";
  const mostraFormulario = visao === "formulario";
  const atual = sel >= 0 ? sel : items.length ? 0 : -1;
  const corrente = mostraFormulario ? atual : sel;

  /** Modo "da origem": não se acrescenta nem duplica; com a quantidade travada, também não se remove. */
  const podeAdicionar = !daOrigem && !linhaUnica && aceitaLinhaNova;
  const podeRemover = !daOrigem?.quantidadeTravada && !linhaUnica;
  /** EDITAR-02: as travas da linha (nenhuma sem `travasDaLinha`). */
  const travas = (it: ItemRow | undefined): TravasDaLinha => (it && travasDaLinha ? travasDaLinha(it) : {});
  /** A linha marcada pode sair: sem as travas, a regra de sempre; com elas, nunca o item salvo (`fixa`). */
  const podeRemoverA = (i: number) => podeRemover && !travas(items[i]).fixa;

  const atualizar = (i: number, chave: string, v: unknown) => onChange(items.map((it, j) => {
    if (j !== i) return it;
    const prox = { ...it, [chave]: v };
    if (chave === "quantity" || chave === "unit_value") return { ...prox, ...recomputarDescontoAposBruto(prox) };
    return prox;
  }));
  const atualizarDesconto = (i: number, campo: "discount" | "discount_percent", v: string) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...sincronizarDesconto(it, campo, v) } : it)));
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
    if (!podeAdicionar || corrente < 0) return;
    const c = corrente;
    const original = items[c];
    if (!original) return;
    onChange([...items.slice(0, c + 1), { ...original }, ...items.slice(c + 1)]);
    setPesquisa(null);
    setSelecionado(c + 1);
  };
  const remover = () => {
    const c = corrente;
    if (c < 0 || !podeRemoverA(c)) return;
    if (!items[c]) return;
    onChange(items.filter((_, j) => j !== c));
    setPesquisa(null);
    setSelecionado(items.length - 1 > 0 ? Math.max(0, c - 1) : -1);
  };
  const escolher = (o: OpcaoReal) => {
    if (!pesquisa) return;
    setConhecidos((c) => ({ ...c, [o.id]: o }));
    const i = pesquisa.linha;
    const campo = pesquisa.campo;
    onChange(items.map((it, j) => {
      if (j !== i) return it;
      if (campo === "product_id") {
        const qtd = it.quantity === "" || it.quantity == null ? "1" : it.quantity;
        return { ...it, product_id: o.id, quantity: qtd };
      }
      return { ...it, [campo]: o.id };
    }));
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

  // Clique fora da região de itens desmarca a linha (decisão 347). A pesquisa flutuante vai no body (portal).
  React.useEffect(() => {
    if (sel < 0) return;
    const tidPesquisa = tid("pesquisa");
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (raizItens.current?.contains(alvo)) return;
      if (alvo instanceof Element && alvo.closest(`[data-testid="${tidPesquisa}"]`)) return;
      setSelecionado(-1);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [sel, prefixoTestid]);

  const cliqueNaGrade = (e: React.MouseEvent<HTMLDivElement>) => {
    const alvo = e.target as Element;
    if (!alvo.closest("tr[data-testid]") && sel >= 0) setSelecionado(-1);
  };

  const colunasVisiveis = React.useMemo(
    () => colunas.filter((c) => c.visivel && ligada(c.chave) && (!permitidas || permitidas.has(c.chave))).map((c) => c.chave),
    [colunas, ligada, permitidas]
  );
  const congeladas = Math.min(prefs.columns.frozen ?? 0, colunasVisiveis.length);
  const larguraDe = (k: ChaveColunaDoItem) => larguras[k] ?? COLUNAS[k].largura;
  const larguraMinima = colunasVisiveis.reduce((a, k) => a + larguraDe(k), 0);

  /** Resize igual ao Base1: DOM ao arrastar, estado só no mouseup; colunas com width=min=max (sem redistribuir). */
  const iniciarResize = (e: React.MouseEvent, k: ChaveColunaDoItem) => {
    if (e.detail > 1) return; // duplo clique → auto ajustar, não arrastar
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    const table = th.closest("table");
    const col = colsRef.current[k];
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    const aplicar = (w: number) => {
      const px = `${w}px`;
      if (col) col.style.width = col.style.minWidth = col.style.maxWidth = px;
      th.style.width = th.style.minWidth = th.style.maxWidth = px;
      if (table) {
        let soma = 0;
        for (const chave of colunasVisiveis) {
          const c = colsRef.current[chave];
          const lida = c?.style.width ? Number.parseInt(c.style.width, 10) : NaN;
          soma += Number.isFinite(lida) ? lida : larguraDe(chave);
        }
        table.style.width = table.style.minWidth = `${soma}px`;
      }
    };
    const move = (ev: MouseEvent) => aplicar(Math.max(LARGURA_MIN_COLUNA, Math.round(w0 + ev.clientX - x0)));
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const w = Math.max(LARGURA_MIN_COLUNA, Math.round(w0 + ev.clientX - x0));
      updCols((c) => ({
        ...c,
        widths: { ...(c.widths ?? {}), [k]: w },
        autoFit: (c.autoFit ?? []).filter((x) => x !== k)
      }));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const subtotal = items.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const item = atual >= 0 ? items[atual] : undefined;

  /** O saldo de ESTOQUE mostrado. Só exibe — quem preenche o custo médio (com `custoMedioNoUnitario`) é `efeitosDoEstoque`. */
  const saldoDoItem = (it: ItemRow) => (reservaEstoque
    ? <EstoqueDisponivelDoItem warehouseId={it.warehouse_id} productId={it.product_id} />
    : <StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={() => { /* só exibe */ }} />);
  const loteDe = (it: ItemRow) => (lote ? lote.daLinha(it) : { lote: false, validade: false });
  const maxDaOrigem = (it: ItemRow) => (daOrigem ? daOrigem.saldo(it) : undefined);
  /** O `max` da quantidade: o saldo da origem (o receber) ou o teto das travas da linha (a edição); senão nenhum. */
  const maxDaQuantidade = (it: ItemRow) => maximoDaQuantidade(daOrigem, travas(it), it);

  const celula = (k: ChaveColunaDoItem, it: ItemRow, i: number, ativa: boolean) => {
    switch (k) {
      case "codigo": return <td key={k}><CodigoDoProduto id={it.product_id} conhecido={conhecidos[it.product_id]} /></td>;
      case "produto": return <td key={k}>{daOrigem || travas(it).produto
        ? <CelulaTravada recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} testId={tid("produto")} />
        : <CelulaDeReferencia recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} vazio="Selecione o produto" erro={pendente(i)}
          rotuloAcao={(o) => (o ? `Trocar o produto do item ${i + 1}` : `Selecionar o produto do item ${i + 1}`)}
          aberto={pesquisa?.linha === i && pesquisa.campo === "product_id"} testId={tid("produto")} tabulavel={ativa}
          onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "product_id", ancora: el, modo: "flutuante" }); }} />}</td>;
      case "armazem": return <td key={k}>{travas(it).armazem
        ? <CelulaTravada recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} testId={tid("armazem")} />
        : <CelulaDeReferencia recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} vazio="—"
          rotuloAcao={(o) => (o ? `Local de estoque: ${o.label}` : "Local de estoque")}
          aberto={pesquisa?.linha === i && pesquisa.campo === "warehouse_id"} testId={tid("armazem")} tabulavel={ativa}
          onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "warehouse_id", ancora: el, modo: "flutuante" }); }} />}</td>;
      case "estoque": return <td key={k} className={cn(grade.numero, grade.estoque)}>{saldoDoItem(it)}</td>;
      case "saldo": return <td key={k} className={grade.numero} data-testid={tid("saldo-da-origem")}>{num(maxDaOrigem(it) ?? "0", casasDaQuantidade ?? 2)}</td>;
      case "quantidade": return <td key={k} className={grade.numero}><span className={grade.quantidade}>
        {ativa && !daOrigem?.quantidadeTravada && !travas(it).quantidade
          ? <EntradaNumero semChrome className={grade.entrada} aria-label={`Quantidade do item ${i + 1}`} casas={casasDaQuantidade ?? 2} value={it.quantity} onChange={(v) => atualizar(i, "quantity", v)} />
          : <span data-testid={tid("quantidade")}>{num(it.quantity, casasDaQuantidade ?? 2)}</span>}
        <Unidade produto={it.product_id} testId={tid("unidade")} />
      </span></td>;
      case "unitario": return <td key={k} className={grade.numero}>{ativa && !travas(it).unitario
        ? <EntradaNumero semChrome className={grade.entrada} aria-label={`Valor unitário do item ${i + 1}`} casas={2} value={it.unit_value ?? ""} onChange={(v) => atualizar(i, "unit_value", v)} />
        : (it.unit_value !== undefined && it.unit_value !== "" ? (semSimboloDeMoeda ? num(it.unit_value, 2) : brl(it.unit_value)) : "—")}</td>;
      case "desconto": return <td key={k} className={grade.numero}>{ativa && !travas(it).desconto
        ? <EntradaNumero semChrome className={grade.entrada} aria-label={`Desconto do item ${i + 1}`} casas={2} value={it.discount ?? ""} onChange={(v) => atualizarDesconto(i, "discount", v)} />
        : (Number(it.discount || 0) ? dinheiro(it.discount!) : "—")}</td>;
      case "descontoPercentual": return <td key={k} className={grade.numero}>{ativa && !travas(it).desconto
        ? <EntradaNumero semChrome className={grade.entrada} aria-label={`Desconto % do item ${i + 1}`} casas={2} value={it.discount_percent ?? ""} onChange={(v) => atualizarDesconto(i, "discount_percent", v)} />
        : (Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : "—")}</td>;
      case "total": return <td key={k} className={cn(grade.numero, grade.forte)}>{dinheiro(totalDaLinhaExibido(it))}</td>;
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

  /** Textos da coluna: rótulo + dados conhecidos + DOM (produto/armazém com rótulo cheio). */
  const textosDaColuna = (k: ChaveColunaDoItem): string[] => {
    const out = [rotuloColuna(k)];
    const casasQ = casasDaQuantidade ?? 2;
    for (const it of items) {
      let t = "";
      switch (k) {
        case "codigo": t = conhecidos[it.product_id]?.code ?? ""; break;
        case "produto": t = conhecidos[it.product_id]?.label ?? ""; break;
        case "armazem": t = it.warehouse_id ? (conhecidos[it.warehouse_id]?.label ?? "") : ""; break;
        case "saldo": t = num(maxDaOrigem(it) ?? "0", casasQ); break;
        case "quantidade": t = num(it.quantity, casasQ); break;
        case "unitario": t = it.unit_value !== undefined && it.unit_value !== "" ? (semSimboloDeMoeda ? num(it.unit_value, 2) : brl(it.unit_value)) : ""; break;
        case "desconto": t = Number(it.discount || 0) ? dinheiro(it.discount!) : ""; break;
        case "descontoPercentual": t = Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : ""; break;
        case "total": t = dinheiro(totalDaLinhaExibido(it)); break;
        case "lote": t = it.provider_lot ?? ""; break;
        case "validade": t = it.expiration_date ? dateBR(it.expiration_date) : ""; break;
        default: t = "";
      }
      t = String(t).replace(/\s+/g, " ").trim();
      if (t && t !== "—") out.push(t);
    }
    const idx = colunasVisiveis.indexOf(k);
    const corpo = tabelaRef.current?.tBodies[0];
    if (idx >= 0 && corpo) {
      for (const row of Array.from(corpo.rows)) {
        const td = row.cells[idx];
        if (!td) continue;
        const rotulo = td.querySelector(`.${grade.celulaBotao} > span:first-child`) as HTMLElement | null;
        const input = td.querySelector("input") as HTMLInputElement | null;
        const bruto = rotulo?.textContent || (input ? input.value : "") || td.innerText || td.textContent || "";
        const t = bruto.replace(/\s+/g, " ").trim();
        if (t && t !== "—" && t !== "…") out.push(t);
      }
    }
    return out;
  };

  /** Mini-ícones no th: auto + âncora de congelar (cada um reserva chrome no autofit). */
  const iconesNoCabecalho = (k: ChaveColunaDoItem, opts?: { forcarAuto?: boolean }) => {
    const i = colunasVisiveis.indexOf(k);
    const ehAncora = i >= 0 && i === congeladas - 1 && congeladas > 0;
    const fitOn = Boolean(opts?.forcarAuto || autoFitKeys.has(k));
    return (fitOn ? 1 : 0) + (ehAncora ? 1 : 0);
  };
  /** Cabeçalho (rótulo + ícones) e células — o max dos dois; cabeçalho nunca fica de fora. */
  const larguraPorConteudo = (k: ChaveColunaDoItem, opts?: { forcarAuto?: boolean }) => {
    const th = tabelaRef.current?.tHead?.rows[0]?.cells[colunasVisiveis.indexOf(k)] ?? null;
    const [rotulo, ...celulas] = textosDaColuna(k);
    return medirLarguraColuna({
      rotulo: rotulo ?? rotuloColuna(k),
      textosCelulas: celulas,
      fontCabecalho: fonteDaCelula(th),
      iconesEstado: iconesNoCabecalho(k, opts),
      chromeExtraCelula: k === "produto" || k === "armazem" ? CHROME_ICONE_NA_CELULA : 0
    });
  };

  /** Grava largura no estado e no DOM (col/th/tabela) — mesma trava width=min=max do resize. */
  const gravarLargura = (k: ChaveColunaDoItem, w: number) => {
    const px = `${w}px`;
    const col = colsRef.current[k];
    if (col) col.style.width = col.style.minWidth = col.style.maxWidth = px;
    const th = tabelaRef.current?.tHead?.rows[0]?.cells[colunasVisiveis.indexOf(k)] as HTMLElement | undefined;
    if (th) th.style.width = th.style.minWidth = th.style.maxWidth = px;
    const table = tabelaRef.current;
    if (table) {
      let soma = 0;
      for (const chave of colunasVisiveis) {
        soma += chave === k ? w : larguraDe(chave);
      }
      table.style.width = table.style.minWidth = `${soma}px`;
    }
    updCols((c) => (c.widths?.[k] === w ? c : { ...c, widths: { ...(c.widths ?? {}), [k]: w } }));
  };

  /** Menu: liga = mede + marca; desliga = só tira o estado. */
  const aplicarAutoAjuste = (k: ChaveColunaDoItem, jaLigado: boolean) => {
    if (jaLigado) {
      updCols((c) => ({ ...c, autoFit: (c.autoFit ?? []).filter((x) => x !== k) }));
      return;
    }
    const w = larguraPorConteudo(k, { forcarAuto: true });
    const px = `${w}px`;
    const col = colsRef.current[k];
    if (col) col.style.width = col.style.minWidth = col.style.maxWidth = px;
    const th = tabelaRef.current?.tHead?.rows[0]?.cells[colunasVisiveis.indexOf(k)] as HTMLElement | undefined;
    if (th) th.style.width = th.style.minWidth = th.style.maxWidth = px;
    updCols((c) => {
      const autoFit = [...new Set([...(c.autoFit ?? []), k])];
      return { ...c, widths: { ...(c.widths ?? {}), [k]: w }, autoFit };
    });
  };

  /** Duplo clique na alça: só ajusta a largura uma vez — NÃO liga o modo auto ajustar. */
  const ajustarLarguraUmaVez = (k: ChaveColunaDoItem) => {
    gravarLargura(k, larguraPorConteudo(k));
  };

  /** Enquanto o modo está ligado, reaplica quando mudam itens/rótulos (reconta cabeçalho + ícones). */
  React.useEffect(() => {
    if (!autoFitKeys.size) return;
    for (const k of autoFitKeys) {
      if (!colunasVisiveis.includes(k)) continue;
      const w = larguraPorConteudo(k);
      if (larguras[k] !== w) gravarLargura(k, w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando dados/autofit/congelar mudam
  }, [autoFitKeys, items, conhecidos, colunasVisiveis, congeladas]);

  const ocultarColuna = (k: ChaveColunaDoItem) => {
    if (colunasVisiveis.length <= 1) return;
    const idx = colunasVisiveis.indexOf(k);
    const lista = colunas.map((c) => (c.chave === k ? { ...c, visivel: false } : c));
    updCols((c) => ({
      ...c,
      ...blocoDeLista(lista),
      frozen: idx >= 0 && idx < (c.frozen ?? 0) ? (c.frozen ?? 0) - 1 : c.frozen,
      autoFit: (c.autoFit ?? []).filter((x) => x !== k)
    }));
  };

  const leftsCongeladas = React.useMemo(() => {
    const out: Partial<Record<ChaveColunaDoItem, number>> = {};
    let acc = 0;
    for (let i = 0; i < congeladas && i < colunasVisiveis.length; i++) {
      const k = colunasVisiveis[i]!;
      out[k] = acc;
      acc += larguraDe(k);
    }
    return out;
  }, [congeladas, colunasVisiveis, larguras]);

  const tabela = <div className={grade.rolagem} onClick={cliqueNaGrade}>
    <table ref={tabelaRef} className={grade.grade} style={{ width: larguraMinima, minWidth: larguraMinima }} aria-label="Itens do documento" data-testid={tid("grade")}>
      <colgroup>{colunasVisiveis.map((k) => {
        const w = larguraDe(k);
        return <col key={k} ref={(el) => { colsRef.current[k] = el; }} style={{ width: w, minWidth: w, maxWidth: w }} />;
      })}</colgroup>
      <thead><tr>
        {colunasVisiveis.map((k, i) => {
          const w = larguraDe(k);
          const estaCongelada = i < congeladas;
          const ehAncora = estaCongelada && i === congeladas - 1;
          const fitOn = autoFitKeys.has(k);
          /** Mini-ícones: auto; congelar só na âncora (não nas colunas à esquerda). */
          const temIcones = fitOn || ehAncora;
          return <th key={k} scope="col" className={cn(grade.cabecalhoColuna, estaCongelada && grade.congelada, ehAncora && grade.congeladaAncora)}
            style={{ width: w, minWidth: w, maxWidth: w, ...(estaCongelada ? { left: leftsCongeladas[k] ?? 0 } : {}) }} {...dataCampo(k)}>
            <div className={grade.cabecalhoLinha}>
              <span className={grade.cabecalhoRotulo}>{rotuloColuna(k)}{obrigatoria(k) && !doSistema.has(catalogo(k)) && <span className="req text-red-500"> *</span>}</span>
              {temIcones && <span className={grade.iconesEstado} aria-hidden>
                {fitOn && <Scaling className={grade.iconeEstado} strokeWidth={2.25} />}
                {ehAncora && <PanelLeft className={grade.iconeEstado} strokeWidth={2.25} />}
              </span>}
              <B1Popover className="w-52 p-1" align="start" open={menuColuna === k} onOpenChange={(o) => setMenuColuna(o ? k : null)}
                trigger={<button type="button" className={grade.menuCabecalho} aria-label={`Abrir menu da coluna ${rotuloColuna(k)}`} onClick={(e) => e.stopPropagation()}><MoreVertical className={grade.iconeEstado} strokeWidth={2.25} /></button>}>
                <MenuList onPick={(acao) => {
                  setMenuColuna(null);
                  if (acao === "fit") aplicarAutoAjuste(k, fitOn);
                  if (acao === "freeze") setCongeladas(ehAncora ? 0 : i + 1);
                  if (acao === "hide") ocultarColuna(k);
                }} items={[
                  { key: "fit", label: fitOn ? "Desativar auto ajustar" : "Auto ajustar coluna", icon: <Scaling className="h-4 w-4" /> },
                  { key: "freeze", label: ehAncora ? "Descongelar colunas" : estaCongelada ? "Congelar até esta coluna" : "Congelar coluna", icon: <PanelLeft className="h-4 w-4" /> },
                  { key: "hide", label: "Ocultar coluna", icon: <EyeOff className="h-4 w-4" />, disabled: colunasVisiveis.length <= 1 }
                ]} />
              </B1Popover>
            </div>
            <span role="separator" aria-label={`Redimensionar ${rotuloColuna(k)}`} title="Arraste para redimensionar · duplo clique para ajustar à largura"
              className={grade.alcaResize}
              onMouseDown={(e) => iniciarResize(e, k)}
              onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); ajustarLarguraUmaVez(k); }} />
          </th>;
        })}
      </tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={colunasVisiveis.length || 1} className={grade.vazio}>
          <div className={grade.vazioConteudo}>
            <span>Nenhum item adicionado.</span>
            {podeAdicionar && <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoAdicionar)} aria-label="Adicionar produto" data-dica="Adicionar produto" data-testid={tid("adicionar-vazio")} onClick={(e) => { e.stopPropagation(); adicionar(); }}><Plus aria-hidden /></button>}
          </div>
        </td></tr>}
        {items.map((it, i) => {
          const ativa = i === sel;
          return <tr key={i} className={cn(grade.linha, ativa && grade.linhaMarcada, pendente(i) && grade.linhaComErro)}
            aria-selected={ativa} data-testid={daOrigem?.testIdDaLinha ? daOrigem.testIdDaLinha(it) : tid("linha")}
            onClick={() => setSelecionado(i)}>
            {colunasVisiveis.map((k, ci) => {
              const td = celula(k, it, i, ativa);
              const erro = erroDe(i, k);
              const congelada = ci < congeladas;
              const ancora = congelada && ci === congeladas - 1;
              return React.cloneElement(td, {
                className: cn(td.props.className, congelada && grade.congelada, ancora && grade.congeladaAncora),
                style: { ...(td.props.style as React.CSSProperties | undefined), ...(congelada ? { left: leftsCongeladas[k] ?? 0 } : {}) },
                ...(layout ? dataCampo(k) : {}),
                ...(erro ? { "aria-invalid": true as const, title: erro, "data-erro": erro } : {})
              });
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
    const chave = campo === "product_id" ? "produto" : "armazem";
    const d = doCampo(chave);
    // o produto trava no modo "da origem" e pela trava da linha; o local, só pela trava da linha (EDITAR-03, decisão 315)
    if (campo === "product_id" ? daOrigem || travas(item).produto : travas(item).armazem) {
      return <CampoDaCentral rotulo={d.label} estado="travado" dica={travas(item).motivos?.[chave]} {...d.attrs}><RotuloTravado recurso={recurso} id={id} /></CampoDaCentral>;
    }
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} icone="pesquisa" preenchido={Boolean(id)} {...d.attrs}>
      <CampoReferenciaBotao recurso={recurso} valor={id} conhecido={id ? conhecidos[id] : undefined} aberto={Boolean(pesquisa?.modo === "fluxo" && pesquisa.campo === campo)}
        onAbrir={(el) => setPesquisa(pesquisa?.modo === "fluxo" && pesquisa.campo === campo ? null : { linha: atual, campo, ancora: el, modo: "fluxo" })} />
    </CampoDaCentral>;
  };
  const campoNumerico = (k: "quantidade" | "unitario" | "desconto" | "descontoPercentual", chave: "quantity" | "unit_value" | "discount" | "discount_percent", valor: string, extra: { casas: number; desabilitado?: boolean; dica?: string }) => {
    const d = doCampo(k);
    const onNum = (v: string) => {
      if (chave === "discount" || chave === "discount_percent") atualizarDesconto(atual, chave, v);
      else atualizar(atual, chave, v);
    };
    return <CampoDaCentral rotulo={d.label} obrigatorio={d.required} erro={d.error} preenchido={valor !== ""} dica={extra.dica} {...(extra.desabilitado ? { estado: "desabilitado" as const } : {})} {...d.attrs}>
      <EntradaNumero casas={extra.casas} disabled={extra.desabilitado || undefined} value={valor} onChange={onNum} />
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
      case "saldo": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" testId={tid("item-saldo")}>{num(maxDaOrigem(it) ?? "0", casasDaQuantidade ?? 2)}</CampoDaCentral>;
      case "unidade": return <CampoDaCentral rotulo="Unidade" estado="travado" testId={tid("item-unidade")}><UnidadeTravada produto={it.product_id} /></CampoDaCentral>;
      case "quantidade": return campoNumerico(k, "quantity", it.quantity, { casas: casasDaQuantidade ?? 2, ...(daOrigem ? { desabilitado: daOrigem.quantidadeTravada } : {}), ...(travas(it).quantidade ? { desabilitado: true, dica: travas(it).motivos?.quantidade } : {}) });
      case "unitario": return campoNumerico(k, "unit_value", it.unit_value ?? "", { casas: 2, ...(travas(it).unitario ? { desabilitado: true, dica: travas(it).motivos?.unitario } : {}) });
      case "desconto": return campoNumerico(k, "discount", it.discount ?? "", { casas: 2, ...(travas(it).desconto ? { desabilitado: true, dica: travas(it).motivos?.desconto } : {}) });
      case "descontoPercentual": return campoNumerico(k, "discount_percent", it.discount_percent ?? "", { casas: 2, ...(travas(it).desconto ? { desabilitado: true, dica: travas(it).motivos?.desconto } : {}) });
      case "total": return <CampoDaCentral rotulo={rotuloCampo(k)} estado="travado" data-campo={layout ? "total" : undefined}><span data-testid={tid("item-total")}>{dinheiro(totalDaLinhaExibido(it))}</span></CampoDaCentral>;
      case "lote": return campoDeTexto(k, "provider_lot", it.provider_lot ?? "", loteDe(it).lote);
      case "validade": return campoDeTexto(k, "expiration_date", it.expiration_date ?? "", loteDe(it).validade);
    }
  };

  const formulario = <div className={grade.form} data-testid={tid("item-form")}>
    {!item ? <div className={grade.formVazio}>Nenhum item adicionado.</div> : <>
      <div className={grade.formNav}>
        <span className={grade.formNavTitulo} data-testid={tid("item-posicao")}>Item {atual + 1} de {items.length}</span>
        <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoItem)} aria-label="Item anterior" data-dica="Item anterior" disabled={atual <= 0} onClick={() => { setPesquisa(null); setSelecionado(atual - 1); }}><ChevronLeft aria-hidden /></button>
        <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoItem)} aria-label="Próximo item" data-dica="Próximo item" disabled={atual >= items.length - 1} onClick={() => { setPesquisa(null); setSelecionado(atual + 1); }}><ChevronRight aria-hidden /></button>
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
    if (v === "formulario") mostrarFormulario();
  };

  const podeDuplicarAgora = podeAdicionar && corrente >= 0;
  const podeRemoverAgora = corrente >= 0 && podeRemoverA(corrente);

  return <div ref={raizItens} className={grade.raiz}>
    <div className={grade.barra} role="toolbar" aria-label="Itens">
      <BotaoAmpliar regiao="itens" />
      <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar produto" data-dica="Adicionar produto" data-testid={tid("adicionar-item")} disabled={!podeAdicionar} onClick={adicionar}><Plus aria-hidden /></button>
      <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoAcaoItem, estilos.dicaInicio)} aria-label="Duplicar item" data-dica="Duplicar item" data-testid={tid("duplicar-item")} disabled={!podeDuplicarAgora} onClick={duplicar}><Copy aria-hidden /></button>
      <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoAcaoItem, grade.botaoRemover, estilos.dicaInicio)} aria-label="Remover item" data-dica="Remover item" data-testid={tid("remover-item")} disabled={!podeRemoverAgora} onClick={remover}><Trash2 aria-hidden /></button>
      <span className={grade.espaco} />
      <div className={grade.segmento} role="group" aria-label="Visualização dos itens">
        <button type="button" aria-pressed={visao === "grade"} aria-label="Grade" data-dica="Grade" onClick={() => escolherVisao("grade")}><Grid3x3 aria-hidden /></button>
        <button type="button" aria-pressed={visao === "formulario"} aria-label="Formulário" data-dica="Formulário" data-visao="formulario" onClick={() => escolherVisao("formulario")}><FileText aria-hidden /></button>
      </div>
      {configDoFormulario
        ? <ConfigurarColunas<ChaveCampoDoItem> prefixoTestid={prefixoTestid} titulo="Visualização do formulário"
            rotulos={Object.fromEntries(chavesCampos.map((k) => [k, rotuloCampo(k)])) as Record<ChaveCampoDoItem, string>}
            lista={campos} onLista={setCampos} onRestaurar={restaurarCampos} />
        : <ConfigurarColunas<ChaveColunaDoItem> prefixoTestid={prefixoTestid} titulo="Colunas da grade"
            rotulos={Object.fromEntries(chavesColunas.map((k) => [k, rotuloColuna(k)])) as Record<ChaveColunaDoItem, string>}
            lista={colunas} onLista={setColunas} onRestaurar={restaurarColunas} />}
    </div>
    <div className={grade.corpo} data-visao={visao} data-testid={tid("itens-corpo")}>
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
      {comSubtotal && <span>Subtotal dos itens <b className={grade.rodapeValor} data-testid={tid("subtotal")}>{dinheiro(subtotal)}</b></span>}
    </div>
    {pesquisa?.modo === "flutuante" && <PainelDePesquisa recurso={pesquisa.campo === "product_id" ? "products" : "warehouses"}
      rotulo={pesquisa.campo === "product_id" ? "Pesquisar produto" : "Pesquisar local de estoque"} valor={items[pesquisa.linha]?.[pesquisa.campo] as string | undefined}
      modo="flutuante" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId={tid("pesquisa")}
      produto={pesquisa.campo === "product_id" ? produtoNaPesquisa(pesquisa.linha) : null} />}
  </div>;
}

/** O controle da pesquisa no formulário do item: o `CampoDaCentral` injeta `id` e `className`. */
function CampoReferenciaBotao({ recurso, valor, conhecido, aberto, onAbrir, id: idDoCampo, className }: { recurso: string; valor?: string; conhecido?: OpcaoReal; aberto: boolean; onAbrir: (el: HTMLElement) => void; id?: string; className?: string }) {
  const o = useRotulo(recurso, valor, conhecido);
  const rotuloAcao = recurso === "products" ? "Pesquisar produto" : "Pesquisar local de estoque";
  return <button type="button" id={idDoCampo} className={cn("cmd-display", !o && "is-empty", className)} aria-haspopup="listbox" aria-expanded={aberto} aria-label={o ? undefined : rotuloAcao} onClick={(e) => onAbrir(e.currentTarget)}>
    {/* vazio: "—" (mesmo do RefSelect); com rótulo à frente o CSS esconde o placeholder — sem texto "Pesquisar" na caixa */}
    {o ? <span>{o.code ? `${o.code} · ` : ""}{o.label}</span> : <span className="cmd-display-placeholder">—</span>}
  </button>;
}
