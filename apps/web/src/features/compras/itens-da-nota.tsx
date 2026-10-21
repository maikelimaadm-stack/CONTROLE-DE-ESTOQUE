"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Columns3, ChevronDown, ChevronUp, X } from "lucide-react";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { brl, dateBR, num } from "@/lib/utils";
import { Base1Grid } from "@/features/base1/grid";
import { B1Popover, MgCheck } from "@/features/base1/ui";
import { FiltroDeColuna } from "./filtro-de-coluna";
import type { Base1Column, Row } from "@/features/base1/types";
import { varianteDeCompra } from "./variantes";

/**
 * OS PRODUTOS DO DOCUMENTO SELECIONADO — o painel mestre-detalhe do Portal de Compras: a grade de cima lista os
 * documentos; este painel mostra os itens da nota SELECIONADA, sem abrir a consulta.
 *
 * Padrão de referência (itpan): barra de título simples (itbar), tabela rolável (itrolo) com cabeçalhos que têm
 * ordenação e redimensionamento, e rodapé de totais (itfoot). Sem toolbar de listagem, sem faixa de filtros.
 *
 * A leitura é a da consulta do documento (`/api/compras/<segmento>/<id>`), a MESMA porta da tela de detalhe: a
 * tela não inventa recorte e não decide acesso — a linha só aparece para quem já pode lê-la, e a porta reaplica
 * capacidade e escopo. O documento vem INTEIRO numa requisição, e filtro/ordem daqui são apresentação sobre essas
 * linhas, nunca consulta nova: nenhuma por linha, nada de N+1.
 *
 * Subtotal, desconto e total NÃO são recalculados aqui: vêm do servidor. A única soma feita nesta tela é a de
 * QUANTIDADE e de PENDENTE (decimais, por `D` de `@agro/shared`): são grandezas da apresentação, não dinheiro —
 * e quantidade mistura unidades (kg, L, saca), é um total de itens, não um saldo de estoque.
 */

const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

interface DocumentoComItens extends Row {
  itens?: Row[];
  desconto?: string;
  valor_total?: string;
}

const loteEValidade = (it: Row) => {
  const lote = texto(it["lote"]);
  const validade = texto(it["validade"]) ? dateBR(texto(it["validade"])) : "";
  return [lote, validade].filter(Boolean).join(" · ") || "—";
};

export function ItensDaNota({ documento, altura }: { documento: Row | null; /** altura do painel, vinda do divisor arrastável */ altura: number }) {
  const especie = documento ? texto(documento["especie"]) : "";
  const id = documento ? texto(documento["id"]) : "";
  const variante = varianteDeCompra(especie);
  const segmento = variante?.segmento ?? "";
  const q = useQuery<DocumentoComItens>({
    queryKey: ["compras-itens-da-nota", segmento, id],
    queryFn: () => api<DocumentoComItens>(`/api/compras/${segmento}/${encodeURIComponent(id)}`),
    enabled: Boolean(segmento && id),
    staleTime: 30_000
  });
  const d = q.data;
  const itens = React.useMemo(() => d?.itens ?? [], [d]);
  const ehPedido = especie === "pedido";
  const codigo = documento ? texto(documento["codigo"]) : "";

  const colunas = React.useMemo<Base1Column[]>(() => {
    const cs: Base1Column[] = [
      { key: "__seq", label: "Seq.", kind: "number", align: "right", width: 64, text: (r) => texto(r["__seq"]) },
      { key: "produto_codigo", label: "Produto", kind: "text", width: 96 },
      { key: "produto_nome", label: "Descrição", kind: "text" },
      { key: "lote_validade", label: "Lote / Validade", kind: "text", text: (r) => loteEValidade(r) },
      { key: "quantidade", label: "Quantidade", kind: "number", align: "right", text: (r) => num(texto(r["quantidade"]) || "0", 4), render: (r) => num(texto(r["quantidade"]) || "0", 4) }
    ];
    if (ehPedido) cs.push({ key: "saldo", label: "Quantidade pendente", kind: "number", align: "right", text: (r) => num(texto(r["saldo"]) || "0", 4), render: (r) => <span className="tabular-nums">{num(texto(r["saldo"]) || "0", 4)}</span> });
    cs.push(
      { key: "unidade", label: "Un.", kind: "text", width: 64 },
      { key: "valor_unitario", label: "Vlr. unitário", kind: "number", align: "right", text: (r) => brl(texto(r["valor_unitario"]) || "0") },
      { key: "desconto", label: "Desconto", kind: "number", align: "right", text: (r) => brl(texto(r["desconto"]) || "0"), render: (r) => (Number(texto(r["desconto"]) || 0) ? brl(texto(r["desconto"])) : "—") },
      { key: "valor_total", label: "Vlr. total", kind: "number", align: "right", text: (r) => brl(texto(r["valor_total"]) || "0") },
      { key: "armazem_nome", label: "Local origem", kind: "text" }
    );
    return cs;
  }, [ehPedido]);

  const linhas = React.useMemo<Row[]>(() => itens.map((it, i) => ({ ...it, __seq: i + 1 })), [itens]);

  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [colWidths, setColWidths] = React.useState<Record<string, number>>({});
  const [ocultas, setOcultas] = React.useState<Set<string>>(new Set());
  const [filtros, setFiltros] = React.useState<Record<string, Set<string>>>({});
  const [filtrando, setFiltrando] = React.useState<string | null>(null);
  const [recolhido, setRecolhido] = React.useState(false);
  const [menuColunas, setMenuColunas] = React.useState(false);
  React.useEffect(() => { setFiltros({}); setFiltrando(null); }, [id]);

  const textoDaCelula = React.useCallback((k: string, r: Row) => { const c = colunas.find((x) => x.key === k); return c?.text ? c.text(r) : texto(r[k]); }, [colunas]);
  // filtro de cabeçalho: apresentação sobre as linhas já lidas (valores marcados por coluna), nunca consulta nova
  const filtradas = React.useMemo(() => linhas.filter((r) => Object.entries(filtros).every(([k, vs]) => vs.has(textoDaCelula(k, r)))), [linhas, filtros, textoDaCelula]);

  const sortedRows = React.useMemo(() => {
    const linhas = filtradas;
    if (!sort) return linhas;
    const col = colunas.find((c) => c.key === sort.key);
    if (!col) return linhas;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const av = col.text ? col.text(a) : String(a[sort.key] ?? "");
      const bv = col.text ? col.text(b) : String(b[sort.key] ?? "");
      if (col.kind === "number") { const na = Number(av) || 0; const nb = Number(bv) || 0; return dir * (na - nb); }
      return dir * av.localeCompare(bv, "pt-BR", { numeric: true, sensitivity: "base" });
    });
  }, [filtradas, sort, colunas]);

  const visibleColumns = React.useMemo(() => colunas.filter((c) => !ocultas.has(c.key)).map((c) => ({ ...c, width: colWidths[c.key] ?? c.width })), [colunas, colWidths, ocultas]);

  const totalQtd = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["quantidade"]) || "0")), D(0)), [itens]);
  const totalPendente = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["saldo"]) || "0")), D(0)), [itens]);
  const desconto = texto(d?.desconto ?? documento?.["desconto"] ?? "0") || "0";
  const totalDoDocumento = texto(d?.valor_total ?? documento?.["valor_total"] ?? "0") || "0";

  const onSort = (k: string) => setSort((s) => s?.key === k && s.dir === "asc" ? { key: k, dir: "desc" } : { key: k, dir: "asc" });

  return <section data-testid="compras-itens-da-nota" aria-label="Itens do documento selecionado" className={recolhido ? "itpan recolhido" : "itpan"} style={{ maxHeight: altura }}>
    <div className="itbar">
      <span className="itt">Itens</span>
      {documento && <>
        <span className="code">{codigo}</span>
        <span className="itbar-qtd">{itens.length} {itens.length === 1 ? "item" : "itens"}</span>
        <span className="vdiv" aria-hidden="true" />
        <span className="itbar-info">somente consulta · para lançar item, abra o documento</span>
      </>}
      {!documento && <span className="itbar-info">nenhum documento selecionado</span>}
      <span style={{ flexGrow: 1 }} />
      {documento && itens.length > 0 && !recolhido && <>
        {Object.keys(filtros).length > 0 && <button type="button" className="fchip-lim" onClick={() => setFiltros({})}><X className="h-3 w-3" /> Limpar filtros</button>}
        <span className="grp">
          <B1Popover open={menuColunas} onOpenChange={setMenuColunas} className="w-60 p-1" title="Colunas dos itens"
            trigger={<button type="button" className="ib" aria-label="Configurar colunas dos itens" title={`Configurar colunas · ${colunas.length - ocultas.size} de ${colunas.length} colunas`}><Columns3 /></button>}
            footer={<button type="button" className="tb-btn tb-btn-out sm" onClick={() => { setOcultas(new Set()); setColWidths({}); }}>Restaurar padrão</button>}>
            {colunas.map((c) => { const on = !ocultas.has(c.key); return <label key={c.key} className="fval cursor-pointer">
              <MgCheck checked={on} disabled={on && ocultas.size >= colunas.length - 1} onChange={() => setOcultas((p) => { const n = new Set(p); if (on) n.add(c.key); else n.delete(c.key); return n; })} />
              <span className="fval-l">{c.label}</span>
            </label>; })}
          </B1Popover>
        </span>
        <span className="vdiv" aria-hidden="true" />
      </>}
      {documento && <span className="grp"><button type="button" className="ib" aria-label={recolhido ? "Abrir o painel" : "Recolher o painel"} title={recolhido ? "Abrir o painel" : "Recolher o painel"} onClick={() => setRecolhido((v) => !v)}>{recolhido ? <ChevronUp /> : <ChevronDown />}</button></span>}
    </div>
    {recolhido ? null : !documento
      ? <div className="itvazio">
        <Boxes className="h-4 w-4" />
        <b>Nenhum documento selecionado</b>
        <span>Selecione um documento acima para ver os produtos.</span>
      </div>
      : q.isPending
        ? <div className="itvazio"><b>Carregando…</b></div>
        : q.error
          ? <div className="itvazio"><b>Não foi possível ler os itens deste documento.</b></div>
          : itens.length === 0
            ? <div className="itvazio">
              <Boxes className="h-4 w-4" />
              <b>Documento sem itens</b>
              <span>{codigo || "O documento"} ainda não tem produtos lançados.</span>
            </div>
            : <div className="itrolo">
              <Base1Grid
                columns={visibleColumns}
                rows={sortedRows}
                sort={sort ?? undefined}
                onSort={onSort}
                selected={new Set()}
                onSelectClick={() => {}}
                onToggle={() => {}}
                onToggleAll={() => {}}
                onResize={(k, w) => setColWidths((p) => ({ ...p, [k]: w }))}
                onAutoFit={(k) => setColWidths((p) => { const n = { ...p }; delete n[k]; return n; })}
                onHide={(k) => setOcultas((p) => new Set(p).add(k))}
                onFilter={(k) => setFiltrando(k)}
                filteredKeys={new Set(Object.keys(filtros))}
              />
              {filtrando && <FiltroDeColuna
                rotulo={colunas.find((c) => c.key === filtrando)?.label ?? ""}
                ancora={`[data-testid="compras-itens-da-nota"] [aria-label="Abrir menu da coluna ${colunas.find((c) => c.key === filtrando)?.label ?? ""}"]`}
                valores={linhas.map((r) => textoDaCelula(filtrando, r))}
                marcados={filtros[filtrando] ?? null}
                onAplicar={(vs) => { const k = filtrando; setFiltros((p) => { const n = { ...p }; if (vs) n[k] = vs; else delete n[k]; return n; }); setFiltrando(null); }}
                onFechar={() => setFiltrando(null)} />}
            </div>}
    {documento && itens.length > 0 && !recolhido && (
      <div className="itfoot">
        <span className="itf">Itens <b>{filtradas.length === itens.length ? itens.length : `${filtradas.length} de ${itens.length}`}</b></span>
        <span className="itf">Quantidade <b>{num(totalQtd.toFixed(4), 4)}</b></span>
        {ehPedido && totalPendente.gt(0) && <span className="itf">Pendente <b>{num(totalPendente.toFixed(4), 4)}</b></span>}
        <span className="itf">Desconto <b>{brl(desconto)}</b></span>
        <span className="itf forte" style={{ marginLeft: "auto" }}>Total do documento <b>{brl(totalDoDocumento)}</b></span>
      </div>
    )}
  </section>;
}
