"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { num, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault, type Row } from "@/features/docs/shared";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", batch_date: todayISO(), formula_id: "", origin_warehouse_id: "", destination_warehouse_id: "", quantity_produced: "", multiplier: "1" });
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const formulas = useQuery({ queryKey: ["formulas"], queryFn: () => api<{ items: (Row & { items: { product_name: string; quantity: string }[] | null })[] }>("/api/stock/feed-formulas") });
  const f = formulas.data?.items.find((x) => x["id"] === h.formula_id);
  const create = useCreate("/api/stock/feed-batches", () => router.push("/estoque/batidas"));
  return <Card><CardHeader title="Nova Batida" actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.formula_id || !h.quantity_produced} onClick={() => create.mutate(h)}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.batch_date} onChange={(e) => setH({ ...h, batch_date: e.target.value })} /></Field>
      <Field label="Formulação" required span={4}><NativeSelect value={h.formula_id} onChange={(e) => setH({ ...h, formula_id: e.target.value })}><option value="">Selecione</option>{formulas.data?.items.map((x) => <option key={String(x["id"])} value={String(x["id"])}>{String(x["name"])}</option>)}</NativeSelect></Field>
      <Field label="Multiplicador da receita" span={3} help="Ex.: 2 = duas vezes as quantidades da formulação"><Input type="number" step="0.0001" value={h.multiplier} onChange={(e) => setH({ ...h, multiplier: e.target.value })} /></Field>
      <Field label="Armazém de matérias-primas" required span={4}><RefSelect resource="warehouses" value={h.origin_warehouse_id} onChange={(v) => setH({ ...h, origin_warehouse_id: v ?? "" })} filter={{ farm_id: h.farm_id }} /></Field>
      <Field label="Armazém do produto acabado" required span={4}><RefSelect resource="warehouses" value={h.destination_warehouse_id} onChange={(v) => setH({ ...h, destination_warehouse_id: v ?? "" })} filter={{ farm_id: h.farm_id }} /></Field>
      <Field label="Quantidade produzida" required span={4}><Input type="number" step="0.0001" value={h.quantity_produced} onChange={(e) => setH({ ...h, quantity_produced: e.target.value })} /></Field>
    </div>
    {f && <div className="rounded border p-3 text-xs"><div className="mb-1 font-semibold">Matéria prima consumida</div>{(f.items ?? []).map((i, k) => <div key={k}>{i.product_name}: {num(Number(i.quantity) * Number(h.multiplier || 1), 4)}</div>)}<div className="mt-1 text-slate-500">Produto acabado: {String(f["product_name"] ?? "(vincule na formulação)")}</div></div>}
  </CardBody></Card>;
}
