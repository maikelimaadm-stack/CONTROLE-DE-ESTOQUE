"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { brl, dateBR, num } from "@/lib/utils";
import { EmptyState, LoadingState } from "@/components/ui";
import { Base1List, type PageParams } from "@/features/base1/list";
import { paginaLocal } from "@/features/base1/local-page";
import type { Base1Column, Base1FilterDef, Row } from "@/features/base1/types";
import { varianteDeCompra } from "./variantes";

/**
 * OS PRODUTOS DO DOCUMENTO SELECIONADO — o painel mestre-detalhe do Portal de Compras: a grade de cima lista os
 * documentos; esta grade mostra os itens da nota SELECIONADA, sem abrir a consulta.
 *
 * MESMO MODELO DA GRADE DE CIMA (pedido do dono): a tabela é a `Base1Grid` do Modelo Base1 — colunas
 * redimensionáveis por arraste, menu por coluna (filtro avançado, auto ajustar, congelar, ocultar), congelamento,
 * ordenação por clique, faixa de chips de filtro por coluna, "Configurar colunas", pesquisa, exportação e as
 * preferências por usuário. Nada de um segundo desenho de tabela dentro da mesma tela.
 *
 * A leitura é a da consulta do documento (`/api/compras/<segmento>/<id>`), a MESMA porta da tela de detalhe: a
 * tela não inventa recorte e não decide acesso — a linha só aparece para quem já pode lê-la, e a porta reaplica
 * capacidade e escopo. O documento vem INTEIRO numa requisição, e filtro/ordem/busca/página daqui são
 * apresentação sobre essas linhas (`paginaLocal`), nunca consulta nova: nenhuma por linha, nada de N+1.
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
  // Toda coluna é um chip da faixa (operadores por família: contém/igual/maior/entre…), como na grade de cima.
  const filtros = React.useMemo<Base1FilterDef[]>(() => colunas.map((c) => ({ key: c.key, label: c.label, kind: c.kind ?? "text", mode: "advanced" as const })), [colunas]);
  const linhas = React.useMemo<Row[]>(() => itens.map((it, i) => ({ ...it, __seq: i + 1 })), [itens]);
  const buscarPagina = React.useCallback((p: PageParams) => Promise.resolve(paginaLocal({
    rows: linhas, columns: colunas, filters: filtros, params: p.filters, search: p.search, sort: p.sort, dir: p.dir, page: p.page, pageSize: p.pageSize
  })), [linhas, colunas, filtros]);

  const totalQtd = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["quantidade"]) || "0")), D(0)), [itens]);
  const totalPendente = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["saldo"]) || "0")), D(0)), [itens]);
  const desconto = texto(d?.desconto ?? documento?.["desconto"] ?? "0") || "0";
  const totalDoDocumento = texto(d?.valor_total ?? documento?.["valor_total"] ?? "0") || "0";

  return <section data-testid="compras-itens-da-nota" aria-label="Itens do documento selecionado"
    className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ height: altura }}>
    {!documento
      ? <div className="mg-card flex flex-1 items-center justify-center">
        <EmptyState compact icon={<Boxes className="h-4 w-4" />} title="Nenhum documento selecionado" description="Selecione um documento acima para ver os produtos." />
      </div>
      : q.isPending
        ? <div className="mg-card flex flex-1 items-center justify-center"><LoadingState variant="compact" /></div>
        : q.error
          ? <div role="alert" className="mg-card px-3 py-2 text-[12px] text-red-700">Não foi possível ler os itens deste documento.</div>
          : itens.length === 0
            ? <div className="mg-card flex flex-1 items-center justify-center">
              <EmptyState compact icon={<Boxes className="h-4 w-4" />} title="Documento sem itens" description={`${codigo || "O documento"} ainda não tem produtos lançados.`} />
            </div>
            : <>
              <Base1List key={`${segmento}:${id}`} moduleId="compras.itens" title="Itens do documento" columns={colunas} filters={filtros}
                queryKeyExtra={[segmento, id]} fetchPage={buscarPagina} searchable searchPlaceholder="Buscar item" canCreate={false}
                csvName={`compras-itens-${codigo || id}`} />
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--mg-divider)] px-2 py-1.5 text-[11.5px] text-slate-600">
                <span>Itens <b className="text-slate-800">{itens.length}</b></span>
                <span>Quantidade <b className="text-slate-800">{num(totalQtd.toFixed(4), 4)}</b></span>
                {ehPedido && totalPendente.gt(0) && <span>Pendente <b className="text-slate-800">{num(totalPendente.toFixed(4), 4)}</b></span>}
                <span>Desconto <b className="text-slate-800">{brl(desconto)}</b></span>
                <span className="ml-auto font-semibold text-slate-700">Total do documento <b className="text-slate-900">{brl(totalDoDocumento)}</b></span>
              </div>
            </>}
  </section>;
}
