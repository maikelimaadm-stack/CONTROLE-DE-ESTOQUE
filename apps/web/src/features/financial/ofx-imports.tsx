"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateBR, dateTimeBR } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Dialog, Field, Input, Spinner } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable } from "@/components/ui/data-table";
import { useCreate, type Row } from "@/features/docs/shared";
/** Importações OFX (antes: /financeiro/ofx). `pendingOnly` mostra só importações ainda não conciliadas. */
export function OfxImportsPanel({ pendingOnly }: { pendingOnly?: boolean } = {}) {
  const { can } = useAuth(); const router = useRouter(); const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: ["ofx"], queryFn: () => api<{ items: Row[] }>("/api/financial/ofx-imports") });
  const [h, setH] = React.useState({ bank_account_id: "", description: "", content: "" });
  const create = useCreate<{ id: string }>("/api/financial/ofx-imports", (r) => router.push(`/financeiro/ofx/${r.id}`));
  return <Card><CardHeader title="Conciliação Bancária (OFX)" subtitle="Importe o extrato OFX e concilie cada transação com um movimento existente ou crie um novo." actions={can("ofx_imports.create") && <Button size="sm" onClick={() => setOpen(true)}>Importar OFX</Button>} /><CardBody>
    {q.isLoading ? <Spinner /> : <DataTable rows={(q.data?.items ?? []).filter((r) => !pendingOnly || r["status"] !== "reconciled")} emptyText={pendingOnly ? "Nenhuma importação pendente de conciliação." : undefined} onRowClick={(r) => router.push(`/financeiro/ofx/${r["id"]}`)} columns={[{ key: "code", label: "Cód." }, { key: "description", label: "Descrição" }, { key: "bank_account_name", label: "Conta" }, { key: "start_date", label: "De", render: (r) => dateBR(r["start_date"] as string) }, { key: "end_date", label: "Até", render: (r) => dateBR(r["end_date"] as string) }, { key: "transaction_count", label: "Transações", align: "right" }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "reconciled" ? "green" : "amber"}>{String(r["status"])}</Badge> }, { key: "created_at", label: "Importado em", render: (r) => dateTimeBR(r["created_at"] as string) }]} />}
    <Dialog open={open} onOpenChange={setOpen} title="Importar arquivo OFX" footer={<Button size="sm" loading={create.isPending} disabled={!h.bank_account_id || !h.description || h.content.length < 10} onClick={() => create.mutate(h)}>Importar</Button>}>
      <div className="grid grid-cols-12 gap-2"><Field label="Conta bancária" required span={7}><RefSelect resource="bank_accounts" value={h.bank_account_id} onChange={(v) => setH({ ...h, bank_account_id: v ?? "" })} /></Field><Field label="Descrição" required span={5}><Input value={h.description} onChange={(e) => setH({ ...h, description: e.target.value })} /></Field>
      <Field label="Arquivo OFX" required span={12}><Input type="file" accept=".ofx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => setH({ ...h, content: t, description: h.description || f.name })); }} /></Field></div>
    </Dialog>
  </CardBody></Card>;
}
