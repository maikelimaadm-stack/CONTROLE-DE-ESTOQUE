"use client";
import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
const K: Record<string, { perm: string; label: string; next?: string; nextLabel?: string; nextPerm?: string }> = { budgets: { perm: "budgets", label: "Orçamento", next: "orders", nextLabel: "Converter em pedido", nextPerm: "orders.create" }, orders: { perm: "orders", label: "Pedido de venda", next: "sales", nextLabel: "Converter em venda", nextPerm: "sales.create" }, sales: { perm: "sales", label: "Venda" } };
export default function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params); const k = K[kind] ?? K["sales"]!; const { can } = useAuth(); const router = useRouter();
  const q = useDoc<Row & { items: Row[]; titles: Row[]; derived: Row[] }>(`/api/sales/${kind}/${id}`); const d = q.data;
  const [confirm, setConfirm] = React.useState<"confirm" | "cancel" | "convert" | null>(null);
  const act = useAction<{ id?: string }>((r) => { setConfirm(null); if (confirm === "convert" && r?.id && k.next) router.push(`/vendas/${k.next}/${r.id}`); });
  return <LoadingOr q={q}>{d && <DetailShell title={`${k.label} ${String(d["code"])}`} back={`/vendas/${kind}`} status={String(d["status"])} actions={<>
    {kind === "sales" && ["open", "approved"].includes(String(d["status"])) && can("sales.edit") && <Button size="sm" onClick={() => setConfirm("confirm")}>Confirmar venda</Button>}
    {k.next && ["open", "approved"].includes(String(d["status"])) && can(k.nextPerm!) && <Button size="sm" onClick={() => setConfirm("convert")}>{k.nextLabel}</Button>}
    {!["cancelled", "confirmed", "invoiced"].includes(String(d["status"])) && can(`${k.perm}.delete`) && <Button size="sm" variant="danger" onClick={() => setConfirm("cancel")}>Cancelar</Button>}
    <Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir</Button>
  </>}>
    <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["document_date"] as string)], ["Saída", d["shipping_date"] ? dateBR(d["shipping_date"] as string) : "—"], ["Vencimento", d["due_date"] ? dateBR(d["due_date"] as string) : "—"], ["Cliente", `${d["client_name"]} ${d["client_document"] ?? ""}`], ["Transportadora", String(d["transporter_name"] ?? "—")], ["Motorista", String(d["driver_name"] ?? "—")], ["Forma pagto", String(d["payment_method_name"] ?? "—")], ["Responsável", String(d["responsible_name"] ?? "")], ["Subtotal", brl(d["subtotal"] as string)], ["Frete", brl(d["freight"] as string)], ["ICMS frete", brl(d["freight_icms"] as string)], ["Outros", brl(d["other_values"] as string)], ["Desconto", brl(d["discount"] as string)], ["Total", <b key="t">{brl(d["total"] as string)}</b>], ["Origem", d["origin_document_id"] ? "Convertido" : "Manual"], ["Observação", String(d["note"] ?? "")]]} />
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <SimpleTable rows={d.items} cols={[{ key: "product_code", label: "Cód." }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "quantity", label: "Qtd.", align: "right", render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` }, { key: "unit_price", label: "Vl. unit.", align: "right", render: (r) => brl(r["unit_price"] as string) }, { key: "discount", label: "Desconto", align: "right", render: (r) => `${brl(r["discount"] as string)} / ${num(r["discount_percent"] as string)}%` }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }]} />
    {d.titles.length > 0 && <><h3 className="text-xs font-semibold uppercase text-brand-700">Contas a receber geradas</h3><SimpleTable rows={d.titles} cols={[{ key: "number", label: "Título", render: (r) => <Link className="text-brand-700 underline" href={`/financeiro/contas-a-receber/${r["id"]}`}>{String(r["number"])}</Link> }, { key: "due_date", label: "Vencimento", render: (r) => dateBR(r["due_date"] as string) }, { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }, { key: "balance", label: "Saldo", align: "right", render: (r) => brl(r["balance"] as string) }, { key: "status", label: "Status" }]} /></>}
    {d.derived.length > 0 && <><h3 className="text-xs font-semibold uppercase text-brand-700">Documentos derivados</h3><SimpleTable rows={d.derived} cols={[{ key: "kind", label: "Tipo" }, { key: "code", label: "Código", render: (r) => <Link className="text-brand-700 underline" href={`/vendas/${r["kind"]}s/${r["id"]}`}>{String(r["code"])}</Link> }, { key: "status", label: "Status" }]} /></>}
    <Confirm open={confirm === "confirm"} onOpenChange={() => setConfirm(null)} title="Confirmar venda" text="Baixa o estoque dos itens com armazém e gera as contas a receber. Operação atômica e idempotente." loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/sales/sales/${id}/confirm`, idem: true })} />
    <Confirm open={confirm === "convert"} onOpenChange={() => setConfirm(null)} title={k.nextLabel ?? ""} loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/sales/${kind}/${id}/convert`, idem: true })} />
    <Confirm open={confirm === "cancel"} onOpenChange={() => setConfirm(null)} title="Cancelar documento" text="Vendas confirmadas têm estoque e títulos estornados." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/sales/${kind}/${id}/cancel`, body: { reason: "Cancelado pelo usuário" } })} />
  </DetailShell>}</LoadingOr>;
}
