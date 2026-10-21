"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { brl, dateBR, num } from "@/lib/utils";
import { EmptyState, LoadingState } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { varianteDeCompra } from "./variantes";

/**
 * OS PRODUTOS DO DOCUMENTO SELECIONADO — o painel mestre-detalhe do Portal de Compras (desenho do sistema de
 * referência): a grade de cima lista os documentos; esta grade mostra os itens da nota SELECIONADA, sem abrir a
 * consulta. Só a listagem, como pedido: sem filtro de cabeçalho nem configuração de colunas.
 *
 * A leitura é a da consulta do documento (`/api/compras/<segmento>/<id>`), a MESMA porta da tela de detalhe: a
 * tela não inventa recorte, não soma item a item (subtotal, desconto e total vêm do servidor) e não decide acesso —
 * a linha só aparece na lista de quem já pode lê-la, e a porta reaplica capacidade e escopo.
 *
 * A ÚNICA soma feita aqui é a de QUANTIDADE e de PENDENTE (números decimais, por `D` de `@agro/shared`): são
 * grandezas da apresentação, não dinheiro. Quantidade mistura unidades (kg, L, saca) — a soma é a do rodapé do
 * sistema de referência, um total de itens, e não um saldo de estoque.
 */

const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

interface DocumentoComItens extends Row {
  itens?: Row[];
  valor_itens?: string;
  desconto?: string;
  valor_total?: string;
  tipo_operacao?: { codigo?: string; nome?: string } | null;
}

const loteEValidade = (it: Row) => {
  const lote = texto(it["lote"]);
  const validade = texto(it["validade"]) ? dateBR(texto(it["validade"])) : "";
  return [lote, validade].filter(Boolean).join(" · ") || "—";
};

export function ItensDaNota({ documento }: { documento: Row | null }) {
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
  const top = d?.tipo_operacao;
  const rotuloDaTop = top ? [texto(top.codigo), texto(top.nome)].filter(Boolean).join(" · ") : "";

  const totalQtd = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["quantidade"]) || "0")), D(0)), [itens]);
  const totalPendente = React.useMemo(() => itens.reduce((acc, it) => acc.plus(D(texto(it["saldo"]) || "0")), D(0)), [itens]);
  const desconto = texto(d?.desconto ?? documento?.["desconto"] ?? "0") || "0";
  const totalDoDocumento = texto(d?.valor_total ?? documento?.["valor_total"] ?? "0") || "0";

  return <section data-testid="compras-itens-da-nota" aria-label="Itens do documento selecionado"
    className="mg-card flex shrink-0 flex-col overflow-hidden">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--mg-divider)] px-3">
      <span className="text-[12px] font-semibold text-slate-700">Itens</span>
      {documento ? <>
        <span data-testid="compras-itens-da-nota-codigo" className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{codigo || "—"}</span>
        {q.isSuccess && <span className="text-[11px] text-slate-500">{itens.length} {itens.length === 1 ? "item" : "itens"}</span>}
        {rotuloDaTop && <span className="truncate text-[11px] text-slate-500">{rotuloDaTop}</span>}
      </> : <span className="text-[11.5px] text-slate-400">Selecione um documento acima para ver os produtos.</span>}
      <span className="ml-auto text-[10.5px] uppercase tracking-wide text-slate-400">somente consulta</span>
    </div>

    {documento && <div className="flex min-h-0 flex-col">
      {q.isPending
        ? <LoadingState variant="compact" />
        : q.error
          ? <div role="alert" className="px-3 py-2 text-[12px] text-red-700">Não foi possível ler os itens deste documento.</div>
          : itens.length === 0
            ? <EmptyState compact icon={<Boxes className="h-4 w-4" />} title="Documento sem itens" description={`${codigo || "O documento"} ainda não tem produtos lançados.`} />
            : <>
              <div className="max-h-[248px] overflow-auto">
                <table className="table-dense w-full text-[12.5px]">
                  <caption className="sr-only">Itens do documento {codigo}</caption>
                  <thead>
                    <tr>
                      <th className="w-12 text-right" scope="col">Seq.</th>
                      <th scope="col">Produto</th>
                      <th scope="col">Descrição</th>
                      <th scope="col">Lote / Validade</th>
                      <th className="text-right" scope="col">Quantidade</th>
                      {ehPedido && <th className="text-right" scope="col">Quantidade pendente</th>}
                      <th scope="col">Un.</th>
                      <th className="text-right" scope="col">Vlr. unitário</th>
                      <th className="text-right" scope="col">Desconto</th>
                      <th className="text-right" scope="col">Vlr. total</th>
                      <th scope="col">Local origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((it, i) => <tr key={texto(it["id"]) || i} data-testid="compras-itens-da-nota-linha">
                      <td className="num">{i + 1}</td>
                      <td>{texto(it["produto_codigo"]) || "—"}</td>
                      <td>{texto(it["produto_nome"]) || "—"}</td>
                      <td>{loteEValidade(it)}</td>
                      <td className="num">{num(texto(it["quantidade"]) || "0", 4)}</td>
                      {ehPedido && <td className="num">{num(texto(it["saldo"]) || "0", 4)}</td>}
                      <td>{texto(it["unidade"]) || "—"}</td>
                      <td className="num">{brl(texto(it["valor_unitario"]) || "0")}</td>
                      <td className="num">{Number(texto(it["desconto"]) || 0) ? brl(texto(it["desconto"])) : "—"}</td>
                      <td className="num">{brl(texto(it["valor_total"]) || "0")}</td>
                      <td>{texto(it["armazem_nome"]) || "—"}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--mg-divider)] px-3 py-1.5 text-[11.5px] text-slate-600">
                <span>Itens <b className="text-slate-800">{itens.length}</b></span>
                <span>Quantidade <b className="text-slate-800">{num(totalQtd.toFixed(4), 4)}</b></span>
                {ehPedido && totalPendente.gt(0) && <span>Pendente <b className="text-slate-800">{num(totalPendente.toFixed(4), 4)}</b></span>}
                <span>Desconto <b className="text-slate-800">{brl(desconto)}</b></span>
                <span className="ml-auto font-semibold text-slate-700">Total do documento <b className="text-slate-900">{brl(totalDoDocumento)}</b></span>
              </div>
            </>}
    </div>}
  </section>;
}
