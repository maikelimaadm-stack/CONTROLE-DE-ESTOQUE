"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { SimpleTable, useCreate, type Row } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["acc-bal"], queryFn: () => api<{ items: Row[]; total_balance: string }>("/api/financial/bank-accounts/balances") });
  const [h, setH] = React.useState({ bank_account_id: "", date: todayISO(), amount: "", document: "", note: "" });
  const create = useCreate("/api/financial/opening-movements", () => { setH({ ...h, bank_account_id: "", amount: "" }); void q.refetch(); });
  return <div className="space-y-3">
    {can("opening_movements.create") && <Card><CardHeader title="Saldo Inicial de Conta Bancária" subtitle="Um único lançamento de saldo inicial por conta (categoria 'saldo inicial'). Tentativas duplicadas são rejeitadas." /><CardBody><div className="grid grid-cols-12 gap-3">
      <Field label="Conta" required span={4}><RefSelect resource="bank_accounts" value={h.bank_account_id} onChange={(v) => setH({ ...h, bank_account_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
      <Field label="Valor" required span={2}><Input type="number" step="0.01" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
      <Field label="Documento" span={2}><Input value={h.document} onChange={(e) => setH({ ...h, document: e.target.value })} /></Field>
      <div className="col-span-2 flex items-end"><Button size="sm" loading={create.isPending} disabled={!h.bank_account_id || !h.amount} onClick={() => create.mutate({ ...h, document: h.document || null, note: h.note || null })}>Lançar</Button></div>
    </div></CardBody></Card>}
    <Card><CardHeader title="Saldos atuais por conta" /><CardBody><SimpleTable rows={q.data?.items ?? []} cols={[{ key: "code", label: "Cód." }, { key: "description", label: "Conta" }, { key: "bank_code", label: "Banco" }, { key: "opening_balance", label: "Saldo inicial (cadastro)", align: "right", render: (r) => brl(r["opening_balance"] as string) }, { key: "balance", label: "Saldo atual", align: "right", render: (r) => brl(r["balance"] as string) }]} /></CardBody></Card>
  </div>;
}
