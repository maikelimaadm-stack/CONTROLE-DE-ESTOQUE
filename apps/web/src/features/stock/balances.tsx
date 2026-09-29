"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { api, qs, download } from "@/lib/api";
import { brl, num, dateBR } from "@/lib/utils";
import { Card, CardBody, Button, Badge, PageHeader } from "@/components/ui";
import { DataTable, colSpanAteColuna, type Column } from "@/components/ui/data-table";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";
import { EXPLICACAO_DISPONIVEL_NEGATIVO, disponivelNegativo, ehDecimalDaApi } from "@/features/stock/reserva-estoque";

interface TotaisDoSaldo { quantity: string; value: string }

/**
 * TOP-CONFIG-07 — A RESERVA NO SALDO. O servidor manda `reservado` e `disponivel` do PAR (armazém, produto) em cada
 * linha — num produto com lote, o MESMO valor em todas as linhas dele, porque a reserva não é por lote. Por isso o
 * rótulo diz "no armazém", e o rodapé não os soma (somaria o mesmo par uma vez por lote).
 *
 * As duas colunas só existem quando a página veio com eles (API anterior não os manda: a tela é a de antes, sem
 * coluna vazia que "aparece e não funciona"). Disponível negativo — o físico ficou abaixo do reservado, o que só um
 * acerto de inventário faz — aparece em destaque, com a explicação em texto para quem não vê a cor.
 */
const COLUNAS_DA_RESERVA: Column<Row>[] = [
  {
    key: "reservado", label: "Reservado no armazém", align: "right",
    text: (r) => (ehDecimalDaApi(r["reservado"]) ? num(r["reservado"], 4) : ""),
    render: (r) => (ehDecimalDaApi(r["reservado"]) ? <span data-testid="saldo-reservado">{num(r["reservado"], 4)}</span> : "—")
  },
  {
    key: "disponivel", label: "Disponível no armazém", align: "right",
    text: (r) => (ehDecimalDaApi(r["disponivel"]) ? num(r["disponivel"], 4) : ""),
    render: (r) => {
      const v = r["disponivel"];
      if (!ehDecimalDaApi(v)) return "—";
      const negativo = disponivelNegativo(v);
      return <>
        <span data-testid="saldo-disponivel" data-negativo={negativo ? "1" : undefined} title={negativo ? EXPLICACAO_DISPONIVEL_NEGATIVO : undefined}
          className={negativo ? "font-semibold text-red-600" : undefined}>{num(v, 4)}</span>
        {negativo && <span className="sr-only"> ({EXPLICACAO_DISPONIVEL_NEGATIVO})</span>}
      </>;
    }
  }
];

/** Os totais que o rodapé mostra, pela chave da coluna em cima da qual cada um fica. */
const TOTAIS_DO_RODAPE: Partial<Record<string, (t: TotaisDoSaldo) => React.ReactNode>> = {
  quantity: (t) => num(t.quantity, 4),
  total_value: (t) => brl(t.value)
};

/** Saldo de estoque (antes: /estoque/saldo). `onAdjust` habilita a ação contextual "Ajustar estoque" por linha. */
export function BalancesPanel({ onAdjust }: { onAdjust?: (row: Row) => void } = {}) {
  const sp = useSearchParams();
  const { f, set, reset } = useFilters({ product_id: sp.get("product_id") ?? "", below_min: sp.get("below_min") ?? "", expiring_days: sp.get("expiring_days") ?? "" }); const [applied, setApplied] = React.useState(f);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50); const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" }>();
  const q = useQuery({ queryKey: ["balances", applied, page, pageSize, sort], queryFn: () => api<{ items: Row[]; total: number; totals: TotaisDoSaldo }>(`/api/stock/balances${qs({ ...applied, page, pageSize, sort: sort?.key, dir: sort?.dir })}`) });
  const linhas = React.useMemo(() => q.data?.items ?? [], [q.data]);
  /** A página trouxe a reserva? Basta uma linha com os dois decimais: a API que os conhece os manda em todas. */
  const comReserva = React.useMemo(() => linhas.some((r) => ehDecimalDaApi(r["reservado"]) && ehDecimalDaApi(r["disponivel"])), [linhas]);
  /** UMA lista de colunas: a grade e o rodapé leem a mesma (colSpan derivado, nunca contado à mão). */
  const colunas = React.useMemo<Column<Row>[]>(() => [
    { key: "product_code", label: "Código" },
    { key: "product_name", label: "Produto", sortable: true, render: (r) => <span>{String(r["product_name"])}{Number(r["min_stock"]) > 0 && Number(r["quantity"]) <= Number(r["min_stock"]) && <Badge tone="amber" className="ml-1">mínimo</Badge>}</span> },
    { key: "ncm_code", label: "NCM" },
    { key: "warehouse_name", label: "Armazém", sortable: true, render: (r) => `${r["warehouse_initials"]}-${r["warehouse_name"]}` },
    { key: "provider_lot", label: "Lote" },
    { key: "expiration_date", label: "Validade", sortable: true, render: (r) => dateBR(r["expiration_date"] as string) },
    { key: "quantity", label: "Quantidade total", align: "right", sortable: true, render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` },
    ...(comReserva ? COLUNAS_DA_RESERVA : []),
    { key: "average_cost", label: "Custo médio unitário", align: "right", render: (r) => brl(r["average_cost"] as string) },
    { key: "total_value", label: "Valor total", align: "right", sortable: true, render: (r) => brl(r["total_value"] as string) },
    { key: "updated_at", label: "Atualizado", render: (r) => dateBR(r["updated_at"] as string) }
  ], [comReserva]);
  const aPartirDoTotal = colunas.slice(colunas.findIndex((c) => c.key === "quantity"));
  return <Card className="flex min-h-0 flex-1 flex-col"><PageHeader inCard title="Saldo de Estoque" actions={<><Button size="sm" variant="outline" onClick={() => download(`/api/reports/stocks_consolidated?format=xlsx`, "estoque.xlsx")}>Exportar</Button></>} /><CardBody>
    <FilterBar filters={[{ name: "search", label: "Pesquisar por produto/lote/princípio ativo", type: "text" }, { name: "product_id", label: "Produto", type: "ref", resource: "products" }, { name: "warehouse_id", label: "Armazém", type: "ref", resource: "warehouses" }, { name: "below_min", label: "Abaixo do mínimo", type: "select", options: [{ value: "true", label: "Sim" }] }, { name: "expiring_days", label: "Vence em (dias)", type: "text" }]} f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} />
    <DataTable rows={linhas} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} sort={sort} onSort={(k) => setSort((s) => ({ key: k, dir: s?.key === k && s.dir === "asc" ? "desc" : "asc" }))}
      rowKey={(r) => `${r["warehouse_id"]}-${r["product_id"]}-${r["provider_lot"]}`}
      actions={onAdjust ? (r) => <Button size="sm" variant="ghost" onClick={() => onAdjust(r)}>Ajustar estoque</Button> : undefined}
      columns={colunas}
      footer={q.data && <tr>
        <td colSpan={colSpanAteColuna(colunas, "quantity")} className="px-2 py-1">Total</td>
        {aPartirDoTotal.map((c) => { const total = TOTAIS_DO_RODAPE[c.key]; return <td key={c.key} className={total ? "num" : undefined}>{total ? total(q.data.totals) : null}</td>; })}
        {onAdjust && <td />}
      </tr>} />
  </CardBody></Card>;
}
