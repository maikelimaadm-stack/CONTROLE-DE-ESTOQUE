"use client";
import * as React from "react";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
import { MOV_PT } from "@/features/livestock/shared";
export default function Page({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false); const [proc, setProc] = React.useState(false);
  const q = useDoc<Row & { items: Row[] }>(`/api/livestock/movements/${id}`); const act = useAction(() => { setC(false); setProc(false); }); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`${MOV_PT[String(d["movement_type"])] ?? type} ${String(d["code"])}`} back={`/pecuaria/movimentacoes/${type}`} status={String(d["status"])} actions={<>
    {d["movement_type"] === "farm_transfer" && d["status"] === "pending" && can("batch_farm_transfer.process") && <Button size="sm" onClick={() => setProc(true)}>Processar recebimento</Button>}
    {d["status"] !== "cancelled" && can("animal_sales.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar</Button>}</>}>
    <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["movement_date"] as string)], ["Pessoa", String(d["person_name"] ?? "—")], ["Lote", String(d["batch_name"] ?? "—")], ["Cabeças", String(d["quantity"] ?? "")], ["Peso total", d["total_weight"] ? `${num(d["total_weight"] as string, 1)} kg` : "—"], ["Valor", d["total_value"] ? brl(d["total_value"] as string) : "—"], ["NF", String(d["invoice_number"] ?? "—")], ["Causa", String(d["cause"] ?? "—")], ["Financeiro", d["title_id"] ? "Gerado" : "Não gerado"], ["Observação", String(d["note"] ?? "")]]} />
    <SimpleTable rows={d.items} cols={[{ key: "identifications", label: "Identificação", render: (r) => String(r["identifications"] ?? "(por contagem)") }, { key: "category_name", label: "Categoria" }, { key: "sex", label: "Sexo" }, { key: "quantity", label: "Cabeças", align: "right" }, { key: "weight", label: "Peso", align: "right", render: (r) => r["weight"] ? num(r["weight"] as string, 1) : "" }, { key: "unit_value", label: "Valor unit.", align: "right", render: (r) => r["unit_value"] ? brl(r["unit_value"] as string) : "" }]} />
    <Confirm open={c} onOpenChange={setC} title="Cancelar movimento" text="Reverte o efeito no rebanho (status dos animais/contagem do lote) e estorna títulos vinculados." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/livestock/movements/${id}/cancel`, body: { reason: "Cancelado pelo usuário" } })} />
    <Confirm open={proc} onOpenChange={setProc} title="Processar transferência" text="Os animais passam para a fazenda/lote de destino." loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/livestock/transfers/${id}/process`, body: {} })} />
  </DetailShell>}</LoadingOr>;
}
