"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Columns2, FileText, LayoutGrid, Lock, Plus, Search, Trash2 } from "lucide-react";
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
 */

type Visao = "grade" | "formulario" | "ambos";
const VISOES: { v: Visao; rotulo: string; Icone: typeof LayoutGrid }[] = [
  { v: "grade", rotulo: "Grade", Icone: LayoutGrid },
  { v: "formulario", rotulo: "Formulário", Icone: FileText },
  { v: "ambos", rotulo: "Grade e formulário", Icone: Columns2 }
];

/** A linha nova é a MESMA que o `ItemsEditor` cria — para o payload não perceber a troca de apresentação. */
const linhaNova = (): ItemRow => ({ product_id: "", quantity: "1", unit_value: "0", generate_stock: true });

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

  const grade = <div className={estilos.gradeRolagem}>
    <table className={estilos.grade} aria-label="Itens do documento" data-testid="central-vendas-grade">
      <colgroup><col style={{ width: 36 }} /><col style={{ width: 70 }} /><col style={{ minWidth: 170 }} /><col style={{ width: 108 }} /><col style={{ width: 74 }} /><col style={{ width: 104 }} /><col style={{ width: 108 }} /><col style={{ width: 88 }} /><col style={{ width: 90 }} /><col style={{ width: 102 }} /></colgroup>
      <thead><tr>
        <th aria-label="Excluir" /><th>Código</th><th>Produto</th><th>Armazém</th><th className={estilos.numero}>Estoque</th>
        <th className={estilos.numero}>Quantidade</th><th className={estilos.numero}>Valor unitário</th><th className={estilos.numero}>Desconto</th>
        <th className={estilos.numero}>Desconto %</th><th className={estilos.numero}>Total</th>
      </tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={10} className={estilos.vazio}>Nenhum item. Use o botão verde para adicionar.</td></tr>}
        {items.map((it, i) => {
          const ativa = i === sel;
          return <tr key={i} ref={(el) => { linhas.current[i] = el; }} className={cn(estilos.linha, !it.product_id && estilos.linhaSemProduto)}
            aria-selected={ativa} tabIndex={ativa || (sel < 0 && i === 0) ? 0 : -1} data-testid="central-vendas-linha"
            onClick={() => setSelecionado(i)} onKeyDown={(e) => tecladoDaLinha(e, i)}>
            <td className={estilos.excluir}><button type="button" className={estilos.remover} aria-label={`Excluir item ${i + 1}`} data-dica="Excluir item" onClick={(e) => { e.stopPropagation(); remover(i); }}><Trash2 aria-hidden /></button></td>
            <td><CodigoDoProduto id={it.product_id} conhecido={conhecidos[it.product_id]} /></td>
            <td><CelulaDeReferencia recurso="products" id={it.product_id} conhecido={conhecidos[it.product_id]} vazio="Pesquisar produto" rotuloAcao="Produto"
              aberto={pesquisa?.linha === i && pesquisa.campo === "product_id"} testId="central-vendas-produto"
              onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "product_id", ancora: el, modo: "flutuante" }); }} /></td>
            <td><CelulaDeReferencia recurso="warehouses" id={it.warehouse_id} conhecido={it.warehouse_id ? conhecidos[it.warehouse_id] : undefined} vazio="—" rotuloAcao="Armazém"
              aberto={pesquisa?.linha === i && pesquisa.campo === "warehouse_id"} testId="central-vendas-armazem"
              onAbrir={(el) => { setSelecionado(i); setPesquisa({ linha: i, campo: "warehouse_id", ancora: el, modo: "flutuante" }); }} /></td>
            <td className={cn(estilos.numero, estilos.estoque)}><StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c); }} /></td>
            <td className={estilos.numero}>{ativa ? <input className={estilos.entrada} aria-label="Quantidade" type="number" step="0.0001" min="0" value={it.quantity} onChange={(e) => atualizar(i, "quantity", e.target.value)} onClick={(e) => e.stopPropagation()} /> : num(it.quantity || "0", 2)}</td>
            <td className={estilos.numero}>{ativa ? <input className={estilos.entrada} aria-label="Valor unitário" type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => atualizar(i, "unit_value", e.target.value)} onClick={(e) => e.stopPropagation()} /> : brl(it.unit_value ?? "0")}</td>
            <td className={estilos.numero}>{Number(it.discount || 0) ? brl(it.discount!) : "—"}</td>
            <td className={estilos.numero}>{Number(it.discount_percent || 0) ? `${num(it.discount_percent!, 2)}%` : "—"}</td>
            <td className={cn(estilos.numero, estilos.forte)}>{brl(totalDaLinhaExibido(it))}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;

  const pesquisaEmFluxo = (campo: "product_id" | "warehouse_id") => pesquisa && pesquisa.modo === "fluxo" && pesquisa.campo === campo && pesquisa.linha === sel
    ? <PainelDePesquisa recurso={campo === "product_id" ? "products" : "warehouses"} rotulo={campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"}
        valor={item?.[campo] as string | undefined} modo="fluxo" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />
    : null;

  const campoDeReferencia = (campo: "product_id" | "warehouse_id", rotulo: string, recurso: string) => {
    const id = (item?.[campo] as string | undefined) || undefined;
    return <div className={cn(estilos.campo, estilos.campoPesquisa)}>
      <Field label={rotulo} span={12}>
        <CampoReferenciaBotao recurso={recurso} valor={id} conhecido={id ? conhecidos[id] : undefined} aberto={Boolean(pesquisa?.modo === "fluxo" && pesquisa.campo === campo)}
          onAbrir={(el) => setPesquisa(pesquisa?.modo === "fluxo" && pesquisa.campo === campo ? null : { linha: sel, campo, ancora: el, modo: "fluxo" })} />
      </Field>
      <span className={estilos.adorno} aria-hidden><Search /></span>
    </div>;
  };

  const formulario = <div className={estilos.formRolagem} data-testid="central-vendas-item-form">
    {!item ? <div className={estilos.itemVazio}>{items.length ? "Selecione um item na grade." : "Nenhum item. Use o botão verde para adicionar."}</div> : <div className={estilos.itemForm}>
      <div className={estilos.itemNav}>
        <span data-testid="central-vendas-item-posicao">Item {sel + 1} de {items.length}</span>
        <button type="button" className={estilos.itemNavBotao} aria-label="Item anterior" data-dica="Item anterior" disabled={sel <= 0} onClick={() => setSelecionado(sel - 1)}><ChevronLeft aria-hidden /></button>
        <button type="button" className={estilos.itemNavBotao} aria-label="Próximo item" data-dica="Próximo item" disabled={sel >= items.length - 1} onClick={() => setSelecionado(sel + 1)}><ChevronRight aria-hidden /></button>
      </div>
      {campoDeReferencia("product_id", "Produto", "products")}
      {pesquisaEmFluxo("product_id")}
      {campoDeReferencia("warehouse_id", "Armazém", "warehouses")}
      {pesquisaEmFluxo("warehouse_id")}
      <Travado rotulo="Estoque"><StockCell warehouseId={item.warehouse_id} productId={item.product_id} onCost={() => { /* o custo médio já é aplicado pela célula da linha, montada sempre */ }} /></Travado>
      <div className={estilos.campo}><Field label="Quantidade" span={12}><Input type="number" step="0.0001" min="0" value={item.quantity} onChange={(e) => atualizar(sel, "quantity", e.target.value)} /></Field></div>
      <div className={estilos.campo}><Field label="Valor unitário" span={12}><Input type="number" step="0.000001" min="0" value={item.unit_value ?? ""} onChange={(e) => atualizar(sel, "unit_value", e.target.value)} /></Field></div>
      <div className={estilos.campo}><Field label="Desconto" span={12}><Input type="number" step="0.01" min="0" value={item.discount ?? ""} onChange={(e) => atualizar(sel, "discount", e.target.value)} /></Field></div>
      <div className={estilos.campo}><Field label="Desconto %" span={12}><Input type="number" step="0.01" min="0" max="100" value={item.discount_percent ?? ""} onChange={(e) => atualizar(sel, "discount_percent", e.target.value)} /></Field></div>
      <Travado rotulo="Total"><span data-testid="central-vendas-item-total">{brl(totalDaLinhaExibido(item))}</span></Travado>
    </div>}
  </div>;

  /*
    A célula de estoque é quem, ao chegar o saldo, preenche o unitário VAZIO com o custo médio — é o
    comportamento do editor antigo. Na visão Formulário a grade não está na tela, então as células
    ficam montadas fora da vista: o comportamento não pode depender de qual visão o usuário escolheu.
  */
  const efeitosSemGrade = visao === "formulario" && <div hidden>{items.map((it, i) => <StockCell key={i} warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") atualizar(i, "unit_value", c); }} />)}</div>;

  return <>
    <div className={estilos.itensBarra} role="toolbar" aria-label="Itens">
      <button type="button" className={cn(estilos.acao, estilos.acaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar item" data-dica="Adicionar item" onClick={adicionar}><Plus aria-hidden /></button>
      <span className={estilos.barraDivisor} aria-hidden />
      <span className={estilos.itensTitulo}>Itens <span className={estilos.itensContagem} data-testid="central-vendas-itens-contagem">({items.length})</span></span>
      <span className={estilos.barraEspaco} />
      <div className={estilos.visoes} role="group" aria-label="Visualização dos itens">
        {VISOES.map(({ v, rotulo, Icone }) => <button key={v} type="button" aria-pressed={visao === v} aria-label={rotulo} data-dica={rotulo}
          className={v === "ambos" ? estilos.dicaFim : undefined}
          onClick={() => { setVisao(v); setPesquisa(null); if (v !== "grade" && sel < 0 && items.length) setSelecionado(0); }}><Icone aria-hidden /></button>)}
      </div>
    </div>
    <div className={estilos.itensCorpo} data-visao={visao} data-testid="central-vendas-itens-corpo">
      {visao !== "formulario" && grade}
      {visao !== "grade" && formulario}
      {efeitosSemGrade}
    </div>
    <div className={estilos.itensRodape}>Subtotal dos itens <b data-testid="central-vendas-subtotal">{brl(subtotal)}</b></div>
    {pesquisa?.modo === "flutuante" && <PainelDePesquisa recurso={pesquisa.campo === "product_id" ? "products" : "warehouses"}
      rotulo={pesquisa.campo === "product_id" ? "Pesquisar produto" : "Pesquisar armazém"} valor={items[pesquisa.linha]?.[pesquisa.campo] as string | undefined}
      modo="flutuante" ancora={pesquisa.ancora} onEscolher={escolher} onFechar={fechar} testId="central-vendas-pesquisa" />}
  </>;
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
