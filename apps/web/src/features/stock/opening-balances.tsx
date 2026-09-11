"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, qs, newIdem } from "@/lib/api";
import { brl, num, dateBR } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardBody, Button, Dialog, Field, Input, Confirm } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { StatusBadge, useFarmDefault, type Row } from "@/features/docs/shared";
export function OpeningBalancesPanel() {
  const qc = useQueryClient(); const { can } = useAuth(); const farm = useFarmDefault();
  const [open, setOpen] = React.useState(false); const [rev, setRev] = React.useState<string | null>(null); const [page, setPage] = React.useState(1);
  const [v, setV] = React.useState({ farm_id: "", warehouse_id: "", product_id: "", quantity: "", unit_value: "", provider_lot: "", expiration_date: "" });
  React.useEffect(() => { setV((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const q = useQuery({ queryKey: ["opening", page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/stock/opening-balances${qs({ page, pageSize: 30 })}`) });
  const create = useMutation({ mutationFn: () => api("/api/stock/opening-balances", { method: "POST", body: { ...v, provider_lot: v.provider_lot || null, expiration_date: v.expiration_date || null }, idempotencyKey: newIdem() }), onSuccess: () => { toast.success("Estoque inicial lançado"); setOpen(false); setV((o) => ({ ...o, product_id: "", quantity: "", unit_value: "", provider_lot: "", expiration_date: "" })); void qc.invalidateQueries({ queryKey: ["opening"] }); }, onError: (e) => toast.error((e as Error).message) });
  const reverse = useMutation({ mutationFn: (id: string) => api(`/api/stock/opening-balances/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Estornado"); setRev(null); void qc.invalidateQueries({ queryKey: ["opening"] }); }, onError: (e) => toast.error((e as Error).message) });
  return <Card><CardHeader title="Estoques Iniciais" subtitle="Saldo de abertura por produto/armazém/lote (gera lançamento no ledger)" actions={can("opening_balances.create") && <Button size="sm" onClick={() => setOpen(true)}>Adicionar Novo</Button>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={30} onPage={setPage} loading={q.isLoading} columns={[{ key: "product_code", label: "Código" }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Armazém" }, { key: "quantity", label: "Qtde. Total", align: "right", render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` }, { key: "unit_value", label: "Vl. Unit.", align: "right", render: (r) => brl(r["unit_value"] as string) }, { key: "total_value", label: "Valor Total", align: "right", render: (r) => brl(r["total_value"] as string) }, { key: "provider_lot", label: "Lote Fornecedor" }, { key: "expiration_date", label: "Validade", render: (r) => dateBR(r["expiration_date"] as string) }, { key: "status", label: "Status", render: (r) => <StatusBadge s={String(r["status"])} /> }]}
      actions={(r) => r["status"] === "confirmed" && can("opening_balances.delete") ? <Button size="sm" variant="ghost" onClick={() => setRev(String(r["id"]))}>Estornar</Button> : null} />
    <Dialog open={open} onOpenChange={setOpen} title="Novo estoque inicial" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-12 gap-3">
        <Field label="Fazenda" required span={6}><RefSelect resource="farms" value={v.farm_id} onChange={(x) => setV({ ...v, farm_id: x ?? "", warehouse_id: "" })} /></Field>
        <Field label="Armazém" required span={6}><RefSelect resource="warehouses" value={v.warehouse_id} onChange={(x) => setV({ ...v, warehouse_id: x ?? "" })} filter={{ farm_id: v.farm_id }} /></Field>
        <Field label="Produto" required span={12}><RefSelect resource="products" value={v.product_id} onChange={(x) => setV({ ...v, product_id: x ?? "" })} /></Field>
        <Field label="Qtde. Total" required span={3}><Input type="number" step="0.0001" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Field>
        <Field label="Vl. Unit." required span={3}><Input type="number" step="0.000001" value={v.unit_value} onChange={(e) => setV({ ...v, unit_value: e.target.value })} /></Field>
        <Field label="Valor Total" span={3}><Input readOnly value={brl(Number(v.quantity || 0) * Number(v.unit_value || 0))} /></Field>
        <Field label="Lote Fornecedor" span={3}><Input value={v.provider_lot} onChange={(e) => setV({ ...v, provider_lot: e.target.value })} /></Field>
        <Field label="Data de Validade" span={3}><Input type="date" value={v.expiration_date} onChange={(e) => setV({ ...v, expiration_date: e.target.value })} /></Field>
      </div>
    </Dialog>
    <Confirm open={Boolean(rev)} onOpenChange={() => setRev(null)} title="Estornar estoque inicial" text="Gera lançamento inverso no ledger. Continuar?" danger loading={reverse.isPending} onConfirm={() => rev && reverse.mutate(rev)} />
  </CardBody></Card>;
}
