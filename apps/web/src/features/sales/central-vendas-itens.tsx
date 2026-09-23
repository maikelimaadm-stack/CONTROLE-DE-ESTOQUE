"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, Columns3, FileText, LayoutGrid, Lock, Plus, Search, Trash2 } from "lucide-react";
import { getResource } from "@agro/domain";
import { cn, brl, num } from "@/lib/utils";
import { api } from "@/lib/api";
import { Field, Input } from "@/components/ui";
import { StockCell, totalDaLinhaExibido, type ItemRow } from "@/features/docs/shared";
import { PainelDePesquisa, type OpcaoReal } from "./central-vendas-pesquisa";
import estilos from "./central-vendas-workspace.module.css";

/**
 * ITENS DA CENTRAL DE VENDAS — três VISÕES do MESMO `items` (VISUAL-UX-01 R1).
 *
 * ┌─ A FONTE ÚNICA ────────────────────────────────────────────────────────────────────────────────┐
 * │ `items` e `onChange` são os da página, os mesmos que o `ItemsEditor` recebia. Grade, Formulário  │
 * │ e Grade + Formulário são três maneiras de OLHAR para esse array — nenhuma guarda cópia. O que    │
 * │ esta camada tem de próprio é só apresentação: qual linha está selecionada, qual visão está       │
 * │ ativa, qual pesquisa está aberta e o rótulo já conhecido de cada produto escolhido.              │
 * │                                                                                                  │
 * │ Por isso o payload não muda: adicionar cria a MESMA linha que o editor criava (quantidade 1,     │
 * │ unitário 0, gera estoque), remover faz o MESMO filtro, e cada campo grava a MESMA chave.         │
 * │ O valor da linha e o subtotal são os que o editor sempre EXIBIU (`totalDaLinhaExibido`) — e      │
 * │ continuam sendo exibição: quem calcula o documento é o servidor.                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Seleção: clicar em qualquer ponto da linha seleciona; a linha selecionada é a única tabulável, ↑ ↓
 * andam entre linhas, Enter e Espaço selecionam. Os campos editáveis só aparecem na linha selecionada.
 * Excluir nunca deixa seleção órfã.
 *
 * ┌─ CONFIGURAR COLUNAS / CAMPOS (R2): SÓ O QUE SE VÊ ─────────────────────────────────────────────┐
 * │ O botão "Configurar colunas" liga, desliga e reordena as colunas da grade ou os campos do        │
 * │ formulário do item — a lista da visão que está na tela, como no protótipo. É ESTADO DESTA TELA:  │
 * │ `useState`, sem `localStorage`, `sessionStorage`, perfil ou API (COLUMN_CONFIG_PERSISTENCE =     │
 * │ NONE); remontar a Central devolve o padrão. Esconder uma coluna não toca o item: `ItemRow` e o   │
 * │ payload continuam com todas as chaves. E o que a célula de estoque FAZ (preencher o unitário    │
 * │ vazio com o custo médio) não depende de a coluna estar à vista — ver `efeitosForaDaVista`.       │
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

type Visao = "grade" | "formulario" | "ambos";
const VISOES: { v: Visao; rotulo: string; Icone: typeof LayoutGrid }[] = [
  { v: "grade", rotulo: "Grade", Icone: LayoutGrid },
  { v: "formulario", rotulo: "Formulário", Icone: FileText },
  { v: "ambos", rotulo: "Grade e formulário", Icone: Columns2 }
];

/** A linha nova é a MESMA que o `ItemsEditor` cria — para o payload não perceber a troca de apresentação. */
const linhaNova = (): ItemRow => ({ product_id: "", quantity: "1", unit_value: "0", generate_stock: true });

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
const LARGURA_EXCLUIR = 36;

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
  return u ? <span className={estilos.unidade} data-testid="central-vendas-unidade">{u}</span> : null;
}

function UnidadeTravada({ produto }: { produto?: string }) {
  const u = useUnidadeDoProduto(produto || undefined);
  return <>{u ?? "—"}</>;
}

function CelulaDeReferencia({ recurso, id, conhecido, vazio, aberto, onAbrir, rotuloAcao, testId, children }: {
  recurso: string; id?: string; conhecido?: OpcaoReal; vazio: string; aberto: boolean; onAbrir: (el: HTMLElement) => void;
  rotuloAcao: string; testId: string; children?: (o: OpcaoReal | null) => React.ReactNode;
}) {
  const o = useRotulo(recurso, id || undefined, conhecido);
  return <button type="button" className={estilos.celulaBotao} aria-haspopup="listbox" aria-expanded={aberto} aria-label={o ? `${rotuloAcao}: ${o.label}` : rotuloAcao}
    data-testid={testId} onClick={(e) => { e.stopPropagation(); onAbrir(e.currentTarget.closest("td") ?? e.currentTarget); }}>
    <span className={o ? undefined : estilos.celulaVazia}>{children ? children(o) : (o?.label ?? vazio)}</span>
    <span className={estilos.celulaIcone} aria-hidden><Search /></span>
  </button>;
}

function CodigoDoProduto({ id, conhecido }: { id?: string; conhecido?: OpcaoReal }) {
  const o = useRotulo("products", id || undefined, conhecido);
  return <span className={estilos.codigo}>{o?.code ?? (id ? "" : "—")}</span>;
}

export function ItensDaCentral({ items, onChange }: { items: ItemRow[]; onChange: (i: ItemRow[]) => void }) {
  const [visao, setVisao] = React.useState<Visao>("grade");
  const [selecionado, setSelecionado] = React.useState<number>(-1);
  const [pesquisa, setPesquisa] = React.useState<{ linha: number; campo: "product_id" | "warehouse_id"; ancora: HTMLElement | null; modo: "flutuante" | "fluxo" } | null>(null);
  /** Rótulos das escolhas feitas nesta sessão — só apresentação, nunca entra no payload. */
  const [conhecidos, setConhecidos] = React.useState<Record<string, OpcaoReal>>({});
  const linhas = React.useRef<(HTMLTableRowElement | null)[]>([]);
  /** Colunas e campos visíveis e sua ordem — apresentação desta tela, sem persistência. */
  const [colunas, setColunas] = React.useState<Preferencia<ChaveColuna>[]>(COLUNAS_PADRAO);
  const [campos, setCampos] = React.useState<Preferencia<ChaveCampo>[]>(CAMPOS_PADRAO);
  const [configurando, setConfigurando] = React.useState(false);

  // seleção nunca órfã: se o array encolheu, a seleção vem junto
  const sel = selecionado >= items.length ? items.length - 1 : selecionado;
  React.useEffect(() => { if (sel !== selecionado) setSelecionado(sel); }, [sel, selecionado]);

  const atualizar = (i: number, chave: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [chave]: v } : it)));
  const adicionar = () => { onChange([...items, linhaNova()]); setSelecionado(items.length); };
  const remover = (i: number) => {
    onChange(items.filter((_, j) => j !== i));
    setPesquisa(null);
    setSelecionado((s) => (items.length - 1 === 0 ? -1 : s > i ? s - 1 : s === i ? Math.min(i, items.length - 2) : s));
  };
  const escolher = (o: OpcaoReal) => {
    if (!pesquisa) return;
    setConhecidos((c) => ({ ...c, [o.id]: o }));
    atualizar(pesquisa.linha, pesquisa.campo, o.id);
    setPesquisa(null);
  };
  const fechar = React.useCallback(() => setPesquisa(null), []);
  const focarLinha = (i: number) => { setSelecionado(i); requestAnimationFrame(() => linhas.current[i]?.focus()); };

  const tecladoDaLinha = (e: React.KeyboardEvent<HTMLTableRowElement>, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown") { e.preventDefault(); focarLinha(Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focarLinha(Math.max(0, i - 1)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelecionado(i); }
  };

  const subtotal = items.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const item = sel >= 0 ? items[sel] : undefined;

  const colunasVisiveis = colunas.filter((c) => c.visivel).map((c) => c.chave);
  // largura mínima DERIVADA das colunas visíveis (a lixeira + cada coluna), nunca contada à mão
  const larguraMinima = LARGURA_EXCLUIR + colunasVisiveis.reduce((a, k) => a + COLUNAS[k].largura, 0);

  const celula = (k: ChaveColuna, it: ItemRow, i: number, ativa: boolean) => {
    switch (k) {
      case "codigo": return <td key={k}><CodigoDoProduto id={it.product_id} conhecido={conhecidos[it.product_id]} /></td>;
      case "produto": return <td key={k}><CelulaDeReferencia recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} vazio="Pesquisar produto" rotuloAcao="Produto"
        aberto={pesquisa?.linha === i && pesquisa.campo === "product_id"} testId="central-vendas-produto"
        onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "product_id", ancora: el, modo: "flutuante" }); }} /></td>;
      case "armazem": return <td key={k}><CelulaDeReferencia recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} vazio="—" rotuloAcao="Armazém"
        aberto={pesquisa?.linha === i && pesquisa.campo === "warehouse_id"} testId="central-vendas-armazem"
        onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "warehouse_id", ancora: el, modo: "flutuante" }); }} /></td>;
      case "estoque": return <td key={k} className={cn(estilos.numero, estilos.estoque)}><StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c); }} /></td>;
      case "quantidade": return <td key={k} className={estilos.numero}><span className={estilos.quantidade}>
        {ativa ? <input className={estilos.entrada} aria-label="Quantidade" type="number" step="0.0001" min="0" value={it.quantity} onChange={(e) => atualizar(i, "quantity", e.target.value)} onClick={(e) => e.stopPropagation()} />
          : <span data-testid="central-vendas-quantidade">{num(it.quantity || "0", 2)}</span>}
        <Unidade produto={it.product_id} />
      </span></td>;
      case "unitario": return <td key={k} className={estilos.numero}>{ativa ? <input className={estilos.entrada} aria-label="Valor unitário" type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => atualizar(i, "unit_value", e.target.value)} onClick={(e) => e.stopPropagation()} /> : brl(it.unit_value ?? "0")}</td>;
      case "desconto": return <td key={k} className={estilos.numero}>{Number(it.discount || 0) ? brl(it.discount!) : "—"}</td>;
      case "descontoPercentual": return <td key={k} className={estilos.numero}>{Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : "—"}</td>;
      case "total": return <td key={k} className={cn(estilos.numero, estilos.forte)}>{brl(totalDaLinhaExibido(it))}</td>;
    }
  };

  const grade = <div className={estilos.gradeRolagem}>
    <table className={estilos.grade} style={{ minWidth: larguraMinima }} aria-label="Itens do documento" data-testid="central-vendas-grade">
      <colgroup><col style={{ width: LARGURA_EXCLUIR }} />{colunasVisiveis.map((k) => <col key={k} style={COLUNAS[k].elastica ? { minWidth: COLUNAS[k].largura } : { width: COLUNAS[k].largura }} />)}</colgroup>
      <thead><tr>
        <th aria-label="Excluir" />
        {colunasVisiveis.map((k) => <th key={k} className={COLUNAS[k].numero ? estilos.numero : undefined}>{COLUNAS[k].rotulo}</th>)}
      </tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={1 + colunasVisiveis.length} className={estilos.vazio}>Nenhum item. Use o botão verde para adicionar.</td></tr>}
        {items.map((it, i) => {
          const ativa = i === sel;
          return <tr key={i} ref={(el) => { linhas.current[i] = el; }} className={cn(estilos.linha, !it.product_id && estilos.linhaSemProduto)}
            aria-selected={ativa} tabIndex={ativa || (sel < 0 && i === 0) ? 0 : -1} data-testid="central-vendas-linha"
            onClick={() => setSelecionado(i)} onKeyDown={(e) => tecladoDaLinha(e, i)}>
            <td className={estilos.excluir}><button type="button" className={estilos.remover} aria-label={`Excluir item ${i + 1}`} data-dica="Excluir item" onClick={(e) => { e.stopPropagation(); remover(i); }}><Trash2 aria-hidden /></button></td>
            {colunasVisiveis.map((k) => celula(k, it, i, ativa))}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;

  const pesquisaEmFluxo = (campo: "product_id" | "warehouse_id") => pesquisa && pesquisa.modo === "fluxo" && pesquisa.campo === campo && pesquisa.linha === sel
    ? <PainelDePesquisa key={`fluxo-${campo}`} recurso={campo === "product_id" ? "products" : "warehouses"} rotulo={campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"}
        valor={item?.[campo] as string | undefined} modo="fluxo" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />
    : null;

  const campoDeReferencia = (campo: "product_id" | "warehouse_id", rotulo: string, recurso: string) => {
    const id = (item?.[campo] as string | undefined) || undefined;
    return <div key={campo} className={cn(estilos.campo, estilos.campoPesquisa)}>
      <Field label={rotulo} span={12}>
        <CampoReferenciaBotao recurso={recurso} valor={id} conhecido={id ? conhecidos[id] : undefined} aberto={Boolean(pesquisa?.modo === "fluxo" && pesquisa.campo === campo)}
          onAbrir={(el) => setPesquisa(pesquisa?.modo === "fluxo" && pesquisa.campo === campo ? null : { linha: sel, campo, ancora: el, modo: "fluxo" })} />
      </Field>
      <span className={estilos.adorno} aria-hidden><Search /></span>
    </div>;
  };

  const campoDoItem = (k: ChaveCampo, it: ItemRow): React.ReactNode => {
    switch (k) {
      case "produto": return [campoDeReferencia("product_id", "Produto", "products"), pesquisaEmFluxo("product_id")];
      case "armazem": return [campoDeReferencia("warehouse_id", "Armazém", "warehouses"), pesquisaEmFluxo("warehouse_id")];
      case "estoque": return <Travado key={k} rotulo="Estoque"><StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={() => { /* o custo médio é aplicado pelas células de estoque da linha, montadas sempre */ }} /></Travado>;
      case "unidade": return <Travado key={k} rotulo="Unidade" testId="central-vendas-item-unidade"><UnidadeTravada produto={it.product_id} /></Travado>;
      case "quantidade": return <div key={k} className={estilos.campo}><Field label="Quantidade" span={12}><Input type="number" step="0.0001" min="0" value={it.quantity} onChange={(e) => atualizar(sel, "quantity", e.target.value)} /></Field></div>;
      case "unitario": return <div key={k} className={estilos.campo}><Field label="Valor unitário" span={12}><Input type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => atualizar(sel, "unit_value", e.target.value)} /></Field></div>;
      case "desconto": return <div key={k} className={estilos.campo}><Field label="Desconto" span={12}><Input type="number" step="0.01" min="0" value={it.discount ?? ""} onChange={(e) => atualizar(sel, "discount", e.target.value)} /></Field></div>;
      case "descontoPercentual": return <div key={k} className={estilos.campo}><Field label="Desconto %" span={12}><Input type="number" step="0.01" min="0" max="100" value={it.discount_percent ?? ""} onChange={(e) => atualizar(sel, "discount_percent", e.target.value)} /></Field></div>;
      case "total": return <Travado key={k} rotulo="Total"><span data-testid="central-vendas-item-total">{brl(totalDaLinhaExibido(it))}</span></Travado>;
    }
  };

  const formulario = <div className={estilos.formRolagem} data-testid="central-vendas-item-form">
    {!item ? <div className={estilos.itemVazio}>{items.length ? "Selecione um item na grade." : "Nenhum item. Use o botão verde para adicionar."}</div> : <div className={estilos.itemForm}>
      <div className={estilos.itemNav}>
        <span data-testid="central-vendas-item-posicao">Item {sel + 1} de {items.length}</span>
        <button type="button" className={estilos.itemNavBotao} aria-label="Item anterior" data-dica="Item anterior" disabled={sel <= 0} onClick={() => setSelecionado(sel - 1)}><ChevronLeft aria-hidden /></button>
        <button type="button" className={estilos.itemNavBotao} aria-label="Próximo item" data-dica="Próximo item" disabled={sel >= items.length - 1} onClick={() => setSelecionado(sel + 1)}><ChevronRight aria-hidden /></button>
      </div>
      {campos.filter((c) => c.visivel).map((c) => <React.Fragment key={c.chave}>{campoDoItem(c.chave, item)}</React.Fragment>)}
    </div>}
  </div>;

  /*
    A célula de estoque é quem, ao chegar o saldo, preenche o unitário VAZIO com o custo médio — é o
    comportamento do editor antigo. Quando a grade não está na tela (visão Formulário) ou a coluna
    Estoque foi escondida pela configuração, as células ficam montadas fora da vista: o comportamento
    não pode depender de qual visão ou quais colunas o usuário escolheu.
  */
  const estoqueNaGrade = visao !== "formulario" && colunasVisiveis.includes("estoque");
  const efeitosForaDaVista = !estoqueNaGrade && <div hidden>{items.map((it, i) => <StockCell key={i} warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c); }} />)}</div>;

  // a configuração é a da visão na tela: o formulário quando ele aparece (sozinho ou ao lado da grade), senão a grade
  const configDoFormulario = visao !== "grade";

  return <>
    <div className={estilos.itensBarra} role="toolbar" aria-label="Itens">
      <button type="button" className={cn(estilos.acao, estilos.acaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar item" data-dica="Adicionar item" onClick={adicionar}><Plus aria-hidden /></button>
      <span className={estilos.barraDivisor} aria-hidden />
      <span className={estilos.itensTitulo}>Itens <span className={estilos.itensContagem} data-testid="central-vendas-itens-contagem">({items.length})</span></span>
      <span className={estilos.barraEspaco} />
      <div className={estilos.visoes} role="group" aria-label="Visualização dos itens">
        {VISOES.map(({ v, rotulo, Icone }) => <button key={v} type="button" aria-pressed={visao === v} aria-label={rotulo} data-dica={rotulo}
          onClick={() => { setVisao(v); setPesquisa(null); setConfigurando(false); if (v !== "grade" && sel < 0 && items.length) setSelecionado(0); }}><Icone aria-hidden /></button>)}
      </div>
      {configDoFormulario
        ? <ConfiguracaoDeVisao<ChaveCampo> titulo="Visualização do formulário" subtitulo="Campos visíveis e ordem" rotulos={CAMPOS} lista={campos} onLista={setCampos} onRestaurar={() => setCampos(CAMPOS_PADRAO())} aberta={configurando} onAberta={setConfigurando} />
        : <ConfiguracaoDeVisao<ChaveColuna> titulo="Colunas da grade" subtitulo="Colunas visíveis e ordem" rotulos={Object.fromEntries(Object.entries(COLUNAS).map(([k, c]) => [k, c.rotulo])) as Record<ChaveColuna, string>} lista={colunas} onLista={setColunas} onRestaurar={() => setColunas(COLUNAS_PADRAO())} aberta={configurando} onAberta={setConfigurando} />}
    </div>
    <div className={estilos.itensCorpo} data-visao={visao} data-testid="central-vendas-itens-corpo">
      {visao !== "formulario" && grade}
      {visao !== "grade" && formulario}
      {efeitosForaDaVista}
    </div>
    <div className={estilos.itensRodape}>Subtotal dos itens <b data-testid="central-vendas-subtotal">{brl(subtotal)}</b></div>
    {pesquisa?.modo === "flutuante" && <PainelDePesquisa recurso={pesquisa.campo === "product_id" ? "products" : "warehouses"}
      rotulo={pesquisa.campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"} valor={items[pesquisa.linha]?.[pesquisa.campo] as string | undefined}
      modo="flutuante" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />}
  </>;
}

/**
 * "Configurar colunas": o popover de vidro do protótipo (340px, ancorado ao botão, abrindo para baixo),
 * com uma caixa por coluna/campo, subir/descer e "Restaurar padrão". Só muda a lista que recebe — que é
 * estado da tela. É um DISCLOSURE (`aria-expanded` + `aria-controls`), não um diálogo modal: a tela
 * continua viva por trás, e Esc ou clicar fora fecham.
 */
function ConfiguracaoDeVisao<K extends string>({ titulo, subtitulo, rotulos, lista, onLista, onRestaurar, aberta, onAberta }: {
  titulo: string; subtitulo: string; rotulos: Record<K, string>; lista: Preferencia<K>[]; onLista: (l: Preferencia<K>[]) => void; onRestaurar: () => void;
  aberta: boolean; onAberta: (a: boolean) => void;
}) {
  const ancora = React.useRef<HTMLSpanElement>(null);
  const botao = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => { if (!ancora.current?.contains(e.target as Node)) onAberta(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { onAberta(false); botao.current?.focus(); } };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberta, onAberta]);
  const alternar = (i: number) => onLista(lista.map((c, j) => (j === i ? { ...c, visivel: !c.visivel } : c)));
  const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= lista.length) return; const n = lista.slice(); [n[i], n[j]] = [n[j]!, n[i]!]; onLista(n); };

  return <span className={estilos.configAncora} ref={ancora}>
    <button ref={botao} type="button" className={cn(estilos.acao, estilos.acaoPequena, estilos.dicaFim, aberta && estilos.acaoAberta)} aria-label="Configurar colunas" data-dica="Configurar colunas"
      aria-expanded={aberta} aria-controls={aberta ? id : undefined} data-testid="central-vendas-configurar" onClick={() => onAberta(!aberta)}><Columns3 aria-hidden /></button>
    {aberta && <div id={id} className={cn(estilos.popover, estilos.config)} role="group" aria-label={titulo} data-testid="central-vendas-configuracao">
      <div className={estilos.configCabecalho}><span className={estilos.configTitulo}>{titulo}</span><span className={estilos.configSub}>{subtitulo}</span></div>
      <ul className={estilos.configLista}>
        {lista.map((c, i) => <li key={c.chave} className={estilos.configLinha}>
          <button type="button" role="checkbox" aria-checked={c.visivel} aria-label={`Mostrar ${rotulos[c.chave]}`} className={estilos.caixa} onClick={() => alternar(i)}>{c.visivel && <Check aria-hidden />}</button>
          <span className={estilos.configRotulo}>{rotulos[c.chave]}</span>
          <button type="button" className={estilos.mover} aria-label={`Subir ${rotulos[c.chave]}`} title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ChevronUp aria-hidden /></button>
          <button type="button" className={estilos.mover} aria-label={`Descer ${rotulos[c.chave]}`} title="Descer" disabled={i === lista.length - 1} onClick={() => mover(i, 1)}><ChevronDown aria-hidden /></button>
        </li>)}
      </ul>
      <div className={estilos.popoverRodape}><span>Campos disponíveis para esta operação</span><button type="button" className={estilos.link} onClick={onRestaurar}>Restaurar padrão</button></div>
    </div>}
  </span>;
}

/** `idDoCampo` chega pelo `Field` (que injeta `id` no filho) e liga o rótulo ao botão — sem ele o leitor de tela não o nomeia. */
function CampoReferenciaBotao({ recurso, valor, conhecido, aberto, onAbrir, id: idDoCampo }: { recurso: string; valor?: string; conhecido?: OpcaoReal; aberto: boolean; onAbrir: (el: HTMLElement) => void; id?: string }) {
  const o = useRotulo(recurso, valor, conhecido);
  return <button type="button" id={idDoCampo} className={cn("cmd-display", !o && "is-empty")} aria-haspopup="listbox" aria-expanded={aberto} onClick={(e) => onAbrir(e.currentTarget)}>
    {o ? <span>{o.code ? `${o.code} · ` : ""}{o.label}</span> : <span className="cmd-display-placeholder">Pesquisar</span>}
  </button>;
}

/** Valor travado pelo sistema (fundo cinza-azulado, cadeado): leitura, nunca entrada. */
export function Travado({ rotulo, children, testId }: { rotulo: string; children: React.ReactNode; testId?: string }) {
  return <div className={estilos.travado} role="group" aria-label={rotulo} data-testid={testId}>
    <span className={estilos.travadoRotulo}>{rotulo}</span>
    <span className={estilos.travadoValor}>{children}</span>
    <span className={estilos.adorno} aria-hidden><Lock /></span>
  </div>;
}
