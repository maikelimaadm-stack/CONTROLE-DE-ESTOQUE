"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Columns3, ChevronDown, ChevronUp, X } from "lucide-react";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { brl, dateBR, num } from "@/lib/utils";
import { Base1Grid } from "@/features/base1/grid";
import { DicaDeAcao } from "@/components/ui";
import { FiltroDeColuna, casa, type FiltroAtivo, type Tipo } from "./filtro-de-coluna";
import { ColunasDosItens } from "./colunas-dos-itens";
import type { Base1Column, Row } from "@/features/base1/types";
import { varianteDeCompra } from "./variantes";

/**
 * OS PRODUTOS DO DOCUMENTO SELECIONADO — o painel mestre-detalhe do Portal de Compras: a grade de cima lista os
 * documentos; este painel mostra os itens da nota SELECIONADA, sem abrir a consulta.
 *
 * Decisão 339: barra só com ações (sem título "Itens" / código / aviso); ampliar = ícone da Central;
 * divisor = linha + grip da Central. Sem toolbar de listagem, sem faixa de filtros.
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

/** O mesmo traço do `BotaoAmpliar` da Central (cantos; invertido quando maximizado). */
function IconeAmpliar({ restaurar }: { restaurar: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {restaurar ? <><path d="M13.5 4.5v6h6" /><path d="M10.5 19.5v-6h-6" /></> : <><path d="M13.5 4.5h6v6" /><path d="M10.5 19.5h-6v-6" /></>}
  </svg>;
}

export function ItensDaNota({ documento, altura, recolhido, onRecolher, maximizado, onMaximizar }: { documento: Row | null; altura: number; recolhido: boolean; onRecolher: () => void; maximizado: boolean; onMaximizar: () => void }) {
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
  const [ordem, setOrdem] = React.useState<string[]>([]);
  const [congeladas, setCongeladas] = React.useState(0);
  const [ocultas, setOcultas] = React.useState<Set<string>>(new Set());
  const [filtros, setFiltros] = React.useState<Record<string, FiltroAtivo>>({});
  const [filtrando, setFiltrando] = React.useState<string | null>(null);
  const [menuColunas, setMenuColunas] = React.useState(false);
  React.useEffect(() => { setFiltros({}); setFiltrando(null); }, [id]);

  const textoDaCelula = React.useCallback((k: string, r: Row) => { const c = colunas.find((x) => x.key === k); return c?.text ? c.text(r) : texto(r[k]); }, [colunas]);
  // filtro de cabeçalho: apresentação sobre as linhas já lidas (valores marcados por coluna), nunca consulta nova
  const tipoDe = React.useCallback((k: string): Tipo => (colunas.find((c) => c.key === k)?.kind === "number" ? "num" : "texto"), [colunas]);
  const filtradas = React.useMemo(() => linhas.filter((r) => Object.entries(filtros).every(([k, f]) => casa(f, tipoDe(k), textoDaCelula(k, r)))), [linhas, filtros, textoDaCelula, tipoDe]);

  const sortedRows = React.useMemo(() => {
    const linhas = filtradas;
    if (!sort) return linhas;
    const col = colunas.find((c) => c.key === sort.key);
    if (!col) return linhas;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const av = col.text ? col.text(a) : String(a[sort.key] ?? "");
      const bv = col.text ? col.text(b) : String(b[sort.key] ?? "");
      if (col.kind === "number") { const na = Number(a[sort.key]) || 0; const nb = Number(b[sort.key]) || 0; return dir * (na - nb); }
      return dir * av.localeCompare(bv, "pt-BR", { numeric: true, sensitivity: "base" });
    });
  }, [filtradas, sort, colunas]);

  const colunasOrdenadas = React.useMemo(() => [...colunas].sort((a, b) => (ordem.indexOf(a.key) < 0 ? 999 : ordem.indexOf(a.key)) - (ordem.indexOf(b.key) < 0 ? 999 : ordem.indexOf(b.key))), [colunas, ordem]);
  const visibleColumns = React.useMemo(() => colunasOrdenadas.filter((c) => !ocultas.has(c.key)).map((c) => ({ ...c, width: colWidths[c.key] ?? c.width })), [colunasOrdenadas, colWidths, ocultas]);

  const totalQtd = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["quantidade"]) || "0")), D(0)), [itens]);
  const totalPendente = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["saldo"]) || "0")), D(0)), [itens]);
  const desconto = texto(d?.desconto ?? documento?.["desconto"] ?? "0") || "0";
  const totalDoDocumento = texto(d?.valor_total ?? documento?.["valor_total"] ?? "0") || "0";

  const onSort = (k: string) => setSort((s) => s?.key === k && s.dir === "asc" ? { key: k, dir: "desc" } : { key: k, dir: "asc" });

  return <section data-testid="compras-itens-da-nota" aria-label="Itens do documento selecionado" className={recolhido ? "itpan recolhido" : maximizado ? "itpan cheio" : "itpan"} style={maximizado ? undefined : { height: recolhido ? 34 : altura }}>
    {/* Barra só de ações — sem título/código/aviso (decisão 339). */}
    <div className="itbar">
      <span style={{ flexGrow: 1 }} />
      {documento && itens.length > 0 && !recolhido && <>
        {Object.keys(filtros).length > 0 && <button type="button" className="fchip-lim" onClick={() => setFiltros({})}><X className="h-3 w-3" /> Limpar filtros</button>}
        <span className="grp">
          <DicaDeAcao texto={`Configurar colunas · ${colunas.length - ocultas.size} de ${colunas.length} colunas`}><button type="button" className="ib" aria-label="Configurar colunas dos itens" onClick={() => setMenuColunas(true)}><Columns3 /></button></DicaDeAcao>
        </span>
        <span className="vdiv" aria-hidden="true" />
      </>}
      {menuColunas && <ColunasDosItens colunas={colunasOrdenadas} ocultas={ocultas} onOrdenar={setOrdem}
        onMudar={(k, ocultar) => setOcultas((p) => { const n = new Set(p); if (ocultar) n.add(k); else n.delete(k); return n; })}
        onRestaurar={() => { setOcultas(new Set()); setColWidths({}); setOrdem([]); setCongeladas(0); }} onFechar={() => setMenuColunas(false)} />}
      <span className="grp">
        <DicaDeAcao texto={maximizado ? "Restaurar layout" : "Ampliar Itens"}>
          <button type="button" className="ib" data-testid="itens-maximizar" aria-label={maximizado ? "Restaurar layout" : "Ampliar Itens"} aria-pressed={maximizado} onClick={onMaximizar}>
            <IconeAmpliar restaurar={maximizado} />
          </button>
        </DicaDeAcao>
        <DicaDeAcao texto={recolhido ? "Abrir o painel" : "Recolher o painel"}>
          <button type="button" className="ib" data-testid="itens-recolher" aria-expanded={!recolhido} aria-label={recolhido ? "Abrir o painel" : "Recolher o painel"} onClick={onRecolher}>{recolhido ? <ChevronUp /> : <ChevronDown />}</button>
        </DicaDeAcao>
      </span>
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
                referenceHeaders
                selecaoSticky={false}
                frozen={congeladas} onFreeze={setCongeladas}
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
                className="b1-portal-compras"
                ancora={`[data-testid="compras-itens-da-nota"] [aria-label="Abrir menu da coluna ${colunas.find((c) => c.key === filtrando)?.label ?? ""}"]`}
                valores={linhas.map((r) => textoDaCelula(filtrando, r))}
                tipo={tipoDe(filtrando)}
                atual={filtros[filtrando] ?? null}
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
