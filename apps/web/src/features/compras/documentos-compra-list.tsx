"use client";
import type * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { brl } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { enumLabel, enumOptions } from "@/lib/copy";
import { COPY } from "@/lib/copy";
import { LoadingState, StatusBadge } from "@/components/ui";
import { type Column } from "@/components/ui/data-table";
import { DocList, colDate, colMoney, type Row } from "@/features/docs/shared";
import { colTipoOperacao } from "@/features/sales/tipo-operacao-select";
import { useOpcoesDeTopDeCompras, varianteDeCompra } from "./variantes";

/**
 * A LISTA ÚNICA DE DOCUMENTOS DE COMPRA (COMPRAS-01, decisão 267) — o mesmo desenho da lista de Vendas.
 *
 * Porta: `/api/compras/documentos`. Quem recorta linha é o servidor (capacidade de LEITURA de cada espécie no
 * WHERE, escopo de empresa do módulo compras); o `?especie=` daqui é pedido de recorte, nunca autorização.
 *
 * Toda coluna é `filterable: false` pelo mesmo motivo da lista de vendas: a porta unificada não lê o filtro
 * avançado por coluna, e chip que aparenta recortar e não recorta é pior que chip ausente. Os filtros de verdade
 * são os declarados abaixo.
 *
 * SKEW (web nova, API anterior): a API anterior não tem a porta, e responde 404. A aba então diz que a lista está
 * indisponível nesta versão do servidor — e não mostra uma lista vazia, que afirmaria "não há documentos".
 */
export function DocumentosDeCompraList({ especie, barra }: { especie: string; barra?: React.ReactNode }) {
  const disponivel = usePortaDisponivel(especie);
  const opcoesTop = useOpcoesDeTopDeCompras();

  if (disponivel === "carregando") return <LoadingState />;
  if (disponivel === "ausente") {
    return <div className="flex flex-col gap-3">
      {barra && <div className="flex items-center gap-2">{barra}</div>}
      <p data-testid="compras-documentos-indisponivel" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
        A lista de documentos de compra está indisponível nesta versão do servidor. Os processos de compra continuam na aba Processos.
      </p>
    </div>;
  }

  const colunas: Column<Row>[] = [
    { key: "codigo", label: "Código", filterable: false },
    { ...colDate("data_documento", "Data"), filterable: false },
    { key: "especie", label: "Tipo de documento", render: (r) => rotuloDaEspecie(r["especie"]), text: (r) => rotuloDaEspecie(r["especie"]), filterable: false },
    colTipoOperacao(),
    { key: "fornecedor_nome", label: "Fornecedor", filterable: false },
    { key: "empresa_nome", label: "Empresa", filterable: false },
    { key: "numero_nota", label: "Nota", filterable: false },
    { ...colMoney("valor_itens", "Itens"), filterable: false },
    { ...colMoney("frete", "Frete"), filterable: false },
    { ...colMoney("desconto", "Desconto"), filterable: false },
    { ...colMoney("valor_total", "Total"), filterable: false },
    {
      key: "situacao", label: COPY.situacao, filterable: false,
      render: (r) => <StatusBadge domain="situacao_documento_compra" value={r["situacao"]} />,
      text: (r) => enumLabel("situacao_documento_compra", r["situacao"])
    }
  ];
  // `colSpan` do rodapé DERIVADO da lista de colunas (mesma conta da lista de vendas).
  const indiceDoTotal = colunas.findIndex((c) => c.key === "valor_total");
  const depoisDoTotal = colunas.length - indiceDoTotal - 1;

  return <DocList key={especie} title="Documentos de compra" endpoint="/api/compras/documentos" base="/compras" entity="documentos_compra"
    // A rota do detalhe sai da ESPÉCIE DA LINHA (o que o servidor classificou), nunca do filtro ativo.
    rowHref={(r) => rotaDoDocumento(r)}
    canCreate={false} canCancel={false} extraActions={barra}
    defaultFilters={especie ? { especie } : undefined}
    filters={[
      { name: "start_date", label: "Data inicial", type: "date" },
      { name: "end_date", label: "Data final", type: "date" },
      { name: "fornecedor_id", label: "Fornecedor", type: "ref", resource: "people", extra: { is_provider: "true" } },
      { name: "empresa_id", label: "Empresa", type: "ref", resource: "empresas" },
      { name: "situacao", label: COPY.situacao, type: "select", options: enumOptions("situacao_documento_compra") },
      { name: "search", label: "Código / fornecedor / nota", type: "text" },
      ...(opcoesTop.length ? [{ name: "tipo_operacao_id", label: "Tipo de Operação", type: "select" as const, options: opcoesTop }] : [])
    ]}
    columns={colunas}
    totals={(t) => <tr><td colSpan={indiceDoTotal} className="px-2 py-1">Total (filtro)</td><td className="num">{brl(t["valor_total"] ?? t["total"] ?? "0")}</td>{Array.from({ length: depoisDoTotal }, (_, i) => <td key={i} />)}</tr>} />;
}

const rotuloDaEspecie = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : enumLabel("especie_documento_compra", v));

/** `/compras/<segmento>/<id>` pela espécie da linha; espécie desconhecida cai na aba (nada de rota inventada). */
export function rotaDoDocumento(r: Row): string {
  const v = varianteDeCompra(typeof r["especie"] === "string" ? r["especie"] : null);
  return v ? `/compras/${v.segmento}/${String(r["id"])}` : "/compras?tab=documentos";
}

/**
 * A porta da lista existe neste servidor? Uma pergunta de uma linha, só para distinguir a API anterior (404) do
 * resto. 403 (sem nenhuma capacidade de leitura) e os demais erros NÃO são "ausente": a lista monta e mostra o
 * erro que o servidor deu. A sonda leva a MESMA espécie que a lista pede (OPERACOES-01 F6b, decisão 283): quem só lê
 * orçamento de compra tem a lista no Tipo dele, e a sonda sem a espécie lhe responderia 403 por nada.
 */
function usePortaDisponivel(especie: string): "carregando" | "ausente" | "presente" {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-documentos-porta", especie],
    queryFn: () => api<unknown>(`/api/compras/documentos?${new URLSearchParams({ limit: "1", ...(especie ? { especie } : {}) }).toString()}`),
    // Trocar o Tipo não pisca a aba: a resposta da sonda anterior vale enquanto a da espécie nova chega.
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5 * 60_000
  });
  if (q.isPending) return "carregando";
  if (q.error && q.error.status === 404) return "ausente";
  return "presente";
}
