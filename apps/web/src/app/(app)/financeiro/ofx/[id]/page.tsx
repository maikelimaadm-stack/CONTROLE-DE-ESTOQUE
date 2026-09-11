"use client";
import * as React from "react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Badge, Button, Dialog, Field, NativeSelect, Input } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, ApportionmentEditor, toAppLines, type Row, type AppLine } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth();
  const q = useDoc<Row & { transactions: Row[] }>(`/api/financial/ofx-imports/${id}`); const d = q.data;
  const [tx, setTx] = React.useState<Row | null>(null); const act = useAction(() => setTx(null));
  const [mode, setMode] = React.useState<"match" | "create">("match"); const [mid, setMid] = React.useState(""); const [note, setNote] = React.useState(""); const [lines, setLines] = React.useState<AppLine[]>([{ financial_category_id: "", cost_center_id: "", percentage: "100" }]);
  const cand = useQuery({ queryKey: ["ofx-cand", d?.["bank_account_id"], tx?.["posted_date"]], queryFn: () => api<{ items: Row[] }>(`/api/financial/bank-movements${qs({ bank_account_id: d?.["bank_account_id"], start_date: tx?.["posted_date"], end_date: tx?.["posted_date"], pageSize: 100 })}`), enabled: Boolean(tx && d) });
  const submit = () => tx && act.mutate({ path: `/api/financial/ofx-imports/${id}/transactions/${tx["id"]}/match`, body: mode === "match" ? { bank_movement_id: mid } : { create: { note: note || undefined, apportionment: toAppLines(lines) } } });
  return <LoadingOr q={q}>{d && <DetailShell title={`OFX ${String(d["code"])} — ${String(d["description"])}`} back="/financeiro?tab=caixa&sub=conciliacao" status={String(d["status"])}>
    <KV items={[["Período", `${dateBR(d["start_date"] as string)} a ${dateBR(d["end_date"] as string)}`], ["Transações", String(d.transactions.length)], ["Pendentes", String(d.transactions.filter((t) => t["status"] === "pending").length)], ["Conciliadas", String(d.transactions.filter((t) => t["status"] === "matched").length)]]} />
    <SimpleTable rows={d.transactions} cols={[{ key: "posted_date", label: "Data", render: (r) => dateBR(r["posted_date"] as string) }, { key: "fitid", label: "FITID" }, { key: "memo", label: "Descrição" }, { key: "amount", label: "Valor", align: "right", render: (r) => <span className={Number(r["amount"]) < 0 ? "text-red-600" : "text-green-700"}>{brl(r["amount"] as string)}</span> }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "matched" ? "green" : r["status"] === "ignored" ? "slate" : "amber"}>{String(r["status"])}</Badge> }, { key: "x", label: "", render: (r) => r["status"] === "pending" && can("ofx_imports.reconcile") ? <span className="flex gap-1"><Button size="sm" onClick={() => { setTx(r); setMode("match"); setMid(""); }}>Conciliar</Button><Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/financial/ofx-imports/${id}/transactions/${r["id"]}/match`, body: { ignore: true } })}>Ignorar</Button></span> : null }]} />
    <Dialog open={Boolean(tx)} onOpenChange={() => setTx(null)} title="Conciliar transação" size="lg" footer={<Button size="sm" loading={act.isPending} disabled={mode === "match" && !mid} onClick={submit}>Confirmar</Button>}>
      {tx && <div className="space-y-3"><p className="text-sm">{dateBR(tx["posted_date"] as string)} · {String(tx["memo"] ?? "")} · <b>{brl(tx["amount"] as string)}</b></p>
        <Field label="Ação"><NativeSelect value={mode} onChange={(e) => setMode(e.target.value as "match" | "create")}><option value="match">Vincular a movimento existente (mesma data)</option><option value="create">Criar novo movimento bancário</option></NativeSelect></Field>
        {mode === "match" ? <Field label="Movimento" span={12}><NativeSelect value={mid} onChange={(e) => setMid(e.target.value)}><option value="">Selecione</option>{cand.data?.items.filter((m) => !m["reconciled_at"]).map((m) => <option key={String(m["id"])} value={String(m["id"])}>{String(m["document"] ?? m["code"] ?? "")} {String(m["note"] ?? "")} — {m["type"] === "in" ? "+" : "−"}{brl(m["amount"] as string)}</option>)}</NativeSelect></Field>
          : <><Field label="Observação" span={12}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={String(tx["memo"] ?? "")} /></Field><ApportionmentEditor lines={lines} onChange={setLines} total={Math.abs(Number(tx["amount"]))} /></>}
      </div>}
    </Dialog>
  </DetailShell>}</LoadingOr>;
}
