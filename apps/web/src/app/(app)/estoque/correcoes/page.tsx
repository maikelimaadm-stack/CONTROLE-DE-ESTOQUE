"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { num, dateBR, todayISO } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault, StatusBadge, type Row } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth(); const qc = useQueryClient(); const farm = useFarmDefault(); const [open, setOpen] = React.useState(false); const [page, setPage] = React.useState(1);
  const [v, setV] = React.useState({ farm_id: "", correction_date: todayISO(), warehouse_id: "", product_id: "", provider_lot: "", new_quantity: "", unit_value: "", justification: "" });
  React.useEffect(() => { setV((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const q = useQuery({ queryKey: ["corrections", page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/stock/corrections${qs({ page, pageSize: 30 })}`) });
  const bal = useQuery({ queryKey: ["bal", v.warehouse_id, v.product_id], queryFn: () => api<{ quantity: string; averageCost: string }>(`/api/stock/balances/${v.warehouse_id}/${v.product_id}`), enabled: Boolean(v.warehouse_id && v.product_id) });
  const create = useCreate("/api/stock/corrections", () => { setOpen(false); void qc.invalidateQueries({ queryKey: ["corrections"] }); });
  return <Card><CardHeader title="Correção de Estoque" subtitle="Ajusta o saldo para a quantidade informada com justificativa (gera movimento de correção)" actions={can("stock_corrections.create") && <Button size="sm" onClick={() => setOpen(true)}>Adicionar Novo</Button>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={30} onPage={setPage} loading={q.isLoading} columns={[{ key: "code", label: "Código" }, { key: "correction_date", label: "Data", render: (r) => dateBR(r["correction_date"] as string) }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "previous_quantity", label: "Saldo anterior", align: "right", render: (r) => num(r["previous_quantity"] as string, 4) }, { key: "new_quantity", label: "Novo saldo", align: "right", render: (r) => num(r["new_quantity"] as string, 4) }, { key: "difference", label: "Diferença", align: "right", render: (r) => num(r["difference"] as string, 4) }, { key: "justification", label: "Justificativa" }, { key: "created_by_name", label: "Usuário" }, { key: "status", label: "Status", render: (r) => <StatusBadge s={String(r["status"])} /> }]} />
    <Dialog open={open} onOpenChange={setOpen} title="Nova correção de estoque" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={create.isPending} onClick={() => create.mutate({ ...v, provider_lot: v.provider_lot || null, unit_value: v.unit_value || null })}>Salvar</Button></>}>
      <div className="grid grid-cols-12 gap-3">
        <Field label="Fazenda" required span={6}><RefSelect resource="farms" value={v.farm_id} onChange={(x) => setV({ ...v, farm_id: x ?? "", warehouse_id: "" })} /></Field>
        <Field label="Armazém" required span={6}><RefSelect resource="warehouses" value={v.warehouse_id} onChange={(x) => setV({ ...v, warehouse_id: x ?? "" })} filter={{ farm_id: v.farm_id }} /></Field>
        <Field label="Produto" required span={8}><RefSelect resource="products" value={v.product_id} onChange={(x) => setV({ ...v, product_id: x ?? "" })} /></Field>
        <Field label="Lote" span={4}><Input value={v.provider_lot} onChange={(e) => setV({ ...v, provider_lot: e.target.value })} /></Field>
        <Field label="Saldo atual" span={3}><Input readOnly value={bal.data ? num(bal.data.quantity, 4) : ""} /></Field>
        <Field label="Nova quantidade" required span={3}><Input type="number" step="0.0001" value={v.new_quantity} onChange={(e) => setV({ ...v, new_quantity: e.target.value })} /></Field>
        <Field label="Data" required span={3}><Input type="date" value={v.correction_date} onChange={(e) => setV({ ...v, correction_date: e.target.value })} /></Field>
        <Field label="Vl. unit. (opcional)" span={3}><Input type="number" step="0.000001" value={v.unit_value} onChange={(e) => setV({ ...v, unit_value: e.target.value })} /></Field>
        <Field label="Justificativa" required span={12}><Textarea value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></Field>
      </div>
    </Dialog>
  </CardBody></Card>;
}
