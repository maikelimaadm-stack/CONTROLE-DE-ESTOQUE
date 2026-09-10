"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ApportionmentEditor, toAppLines, useCreate, useFarmDefault, type AppLine } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", bank_account_id: "", movement_date: todayISO(), type: "out", category_type: "out", destination_account_id: "", amount: "", interest: "0", document: "", generates_obligation: false, is_deductible: false, note: "", proprietary_id: "", person_id: "", harvest_id: "" });
  const [lines, setLines] = React.useState<AppLine[]>([{ financial_category_id: "", cost_center_id: "", percentage: "100" }]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/financial/bank-movements", () => router.push("/financeiro/movimentos"));
  const transfer = h.category_type === "internal_transfer";
  const submit = () => create.mutate({ ...h, farm_id: h.farm_id || null, destination_account_id: transfer ? h.destination_account_id : null, document: h.document || null, note: h.note || null, proprietary_id: h.proprietary_id || null, person_id: h.person_id || null, harvest_id: h.harvest_id || null, apportionment: transfer ? undefined : toAppLines(lines) });
  return <Card><CardHeader title="Novo Movimento Bancário" subtitle="Transferência interna gera saída na origem e entrada no destino em uma única transação." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.bank_account_id || Number(h.amount) <= 0 || (transfer && !h.destination_account_id)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Conta bancária" required span={4}><RefSelect resource="bank_accounts" value={h.bank_account_id} onChange={(v) => setH({ ...h, bank_account_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.movement_date} onChange={(e) => setH({ ...h, movement_date: e.target.value })} /></Field>
      <Field label="Categoria do movimento" span={3}><NativeSelect value={h.category_type} onChange={(e) => { const ct = e.target.value; setH({ ...h, category_type: ct, type: ct === "in" || ct === "check_return" || ct === "financing" ? "in" : "out" }); }}><option value="in">Entrada</option><option value="out">Saída</option><option value="internal_transfer">Transferência interna</option><option value="financing">Financiamento</option><option value="check_return">Devolução de cheque</option></NativeSelect></Field>
      {transfer && <Field label="Conta destino" required span={4}><RefSelect resource="bank_accounts" value={h.destination_account_id} onChange={(v) => setH({ ...h, destination_account_id: v ?? "" })} /></Field>}
      <Field label="Valor" required span={2}><Input type="number" step="0.01" min="0.01" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
      <Field label="Juros" span={2}><Input type="number" step="0.01" value={h.interest} onChange={(e) => setH({ ...h, interest: e.target.value })} /></Field>
      <Field label="Documento" span={2}><Input value={h.document} onChange={(e) => setH({ ...h, document: e.target.value })} /></Field>
      <Field label="Pessoa" span={3}><RefSelect resource="people" value={h.person_id} onChange={(v) => setH({ ...h, person_id: v ?? "" })} /></Field>
      <Field label="Proprietário" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Safra" span={2}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Gera obrigação" span={2}><NativeSelect value={h.generates_obligation ? "1" : "0"} onChange={(e) => setH({ ...h, generates_obligation: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Dedutível" span={2}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    {!transfer && <><h3 className="text-xs font-semibold uppercase text-brand-700">Rateio</h3><ApportionmentEditor lines={lines} onChange={setLines} total={Number(h.amount || 0)} /></>}
  </CardBody></Card>;
}
