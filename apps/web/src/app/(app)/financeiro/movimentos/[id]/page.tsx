"use client";
import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false);
  const q = useDoc<Row & { apportionments: Row[]; settlements: Row[] }>(`/api/financial/bank-movements/${id}`); const act = useAction(() => setC(false)); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Movimento bancário ${String(d["code"] ?? "")}`} back="/financeiro?tab=caixa&sub=extrato" status={String(d["status"])} actions={d["status"] === "confirmed" && can("bank_movements.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar movimento</Button>}>
    <KV items={[["Conta", `${d["bank_account_name"]} (${d["agency"] ?? ""}/${d["account_number"] ?? ""})`], ["Data", dateBR(d["movement_date"] as string)], ["Tipo", d["type"] === "in" ? "Entrada" : "Saída"], ["Categoria", String(d["category_type"])], ["Valor", brl(d["amount"] as string)], ["Juros", brl(d["interest"] as string)], ["Documento", String(d["document"] ?? "—")], ["Fazenda", String(d["farm_name"] ?? "—")], ["Pessoa", String(d["person_name"] ?? "—")], ["Proprietário", String(d["proprietary_name"] ?? "—")], ["Conta destino", String(d["destination_account_name"] ?? "—")], ["Origem", String(d["source_type"] ?? "Manual")], ["Conciliado", d["reconciled_at"] ? dateTimeBR(d["reconciled_at"] as string) : "Não"], ["Observação", String(d["note"] ?? "")]]} />
    <h3 className="text-xs font-semibold uppercase text-brand-700">Rateio</h3>
    <SimpleTable rows={d.apportionments} cols={[{ key: "category_code", label: "Cód." }, { key: "category_name", label: "Categoria" }, { key: "cost_center_name", label: "Centro de Custo" }, { key: "chart_account_name", label: "Conta contábil" }, { key: "percentage", label: "%", align: "right", render: (r) => num(r["percentage"] as string) }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }]} />
    {d.settlements.length > 0 && <><h3 className="text-xs font-semibold uppercase text-brand-700">Baixas de títulos vinculadas</h3><SimpleTable rows={d.settlements} cols={[{ key: "code", label: "Cód." }, { key: "number", label: "Título", render: (r) => <Link className="text-brand-700 underline" href={`/financeiro/contas-a-pagar/${r["title_id"]}`}>{String(r["number"])}</Link> }, { key: "net_amount", label: "Líquido", align: "right", render: (r) => brl(r["net_amount"] as string) }]} /><p className="text-xs text-amber-700">Movimentos gerados por baixa de título só podem ser cancelados pela tela do título (cancelar baixa).</p></>}
    <Confirm open={c} onOpenChange={setC} title="Cancelar movimento" text="O movimento é marcado como cancelado e o saldo da conta recalculado." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/financial/bank-movements/${id}/cancel`, body: { reason: "Cancelado pelo usuário" } })} />
  </DetailShell>}</LoadingOr>;
}
