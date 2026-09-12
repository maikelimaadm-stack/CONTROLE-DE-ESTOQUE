"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Dialog, Field, Input, NativeSelect, LoadingState, StatusBadge } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { HerdLotSelect } from "@/features/livestock/shared";
import { useAction } from "@/features/docs/actions";
import { Trash2 } from "lucide-react";
import { COPY } from "@/lib/copy";
interface A { herd_lot_id: string; category_id: string; breed_id: string; sex: string; weight: string; batch_id: string; identifications: { identification_type_id: string; value: string }[] }
export function ProcessingsPanel() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["processings"], queryFn: () => api<{ items: Row[] }>("/api/livestock/processings") });
  const [p, setP] = React.useState<Row | null>(null); const [animals, setAnimals] = React.useState<A[]>([]); const [finish, setFinish] = React.useState(false); const [typeId, setTypeId] = React.useState("");
  const act = useAction(() => { setP(null); setAnimals([]); });
  const add = () => setAnimals([...animals, { herd_lot_id: "", category_id: "", breed_id: "", sex: "", weight: "", batch_id: String(p?.["pre_batch_id"] ?? ""), identifications: [{ identification_type_id: typeId, value: "" }] }]);
  const upd = (i: number, x: Partial<A>) => setAnimals(animals.map((a, j) => (j === i ? { ...a, ...x } : a)));
  return <Card><CardHeader title="Processamentos (identificação de animais comprados)" subtitle="Animais que entraram por contagem (compra) são individualizados aqui com brinco/identificação, categoria, sexo e peso." /><CardBody>
    {q.isLoading ? <LoadingState /> : <SimpleTable rows={q.data?.items ?? []} cols={[{ key: "processing_date", label: "Data", render: (r) => dateBR(r["processing_date"] as string) }, { key: "purchase_code", label: "Compra" }, { key: "farm_name", label: "Fazenda" }, { key: "pre_batch_name", label: "Lote pré" }, { key: "expected_quantity", label: "Esperado", align: "right" }, { key: "processed_quantity", label: "Processado", align: "right" }, { key: "status", label: COPY.situacao, render: (r) => <StatusBadge domain="status" value={r["status"]} /> }, { key: "x", label: "", render: (r) => !["finished", "cancelled"].includes(String(r["status"])) && can("processings.process") ? <Button size="sm" onClick={() => setP(r)}>Processar</Button> : null }]} />}
    <Dialog open={Boolean(p)} onOpenChange={() => setP(null)} title={`Processar compra ${String(p?.["purchase_code"] ?? "")}`} size="xl" footer={<><label className="mr-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} /> Encerrar processamento após salvar</label><Button size="sm" loading={act.isPending} disabled={!animals.length || animals.some((a) => !a.herd_lot_id || !a.category_id || !a.identifications[0]?.value || !a.identifications[0]?.identification_type_id)} onClick={() => act.mutate({ path: `/api/livestock/processings/${p?.["id"]}/process`, body: { finish, animals: animals.map((a) => ({ ...a, breed_id: a.breed_id || null, sex: a.sex || null, weight: a.weight || null, batch_id: a.batch_id || null })) } })}>Salvar {animals.length} animal(is)</Button></>}>
      <div className="mb-2 grid grid-cols-12 gap-2"><Field label="Tipo de identificação padrão" span={6}><RefSelect resource="identification_types" value={typeId} onChange={(v) => setTypeId(v ?? "")} /></Field><div className="col-span-6 flex items-end"><Button size="sm" variant="outline" onClick={add}>+ animal</Button></div></div>
      <table className="table-dense w-full text-[12px]"><thead><tr><th className="min-w-[220px]">Lote de origem (contagem)</th><th className="min-w-[150px]">Categoria</th><th className="min-w-[120px]">Raça</th><th>Sexo</th><th className="w-24">Peso</th><th className="min-w-[140px]">Lote destino</th><th className="min-w-[140px]">Identificação</th><th /></tr></thead><tbody>
        {animals.map((a, i) => <tr key={i}><td><HerdLotSelect value={a.herd_lot_id} onChange={(v, r) => upd(i, { herd_lot_id: v, category_id: a.category_id || String(r?.["category_id"] ?? ""), breed_id: a.breed_id || String(r?.["breed_id"] ?? ""), sex: a.sex || String(r?.["sex"] ?? "") })} farmId={String(p?.["farm_id"] ?? "")} /></td><td><RefSelect resource="animal_categories" value={a.category_id} onChange={(v) => upd(i, { category_id: v ?? "" })} /></td><td><RefSelect resource="breeds" value={a.breed_id} onChange={(v) => upd(i, { breed_id: v ?? "" })} /></td><td><NativeSelect value={a.sex} onChange={(e) => upd(i, { sex: e.target.value })}><option value="">—</option><option value="M">Macho</option><option value="F">Fêmea</option></NativeSelect></td><td><Input type="number" step="0.1" value={a.weight} onChange={(e) => upd(i, { weight: e.target.value })} /></td><td><RefSelect resource="batches" value={a.batch_id} onChange={(v) => upd(i, { batch_id: v ?? "" })} /></td><td><Input value={a.identifications[0]?.value ?? ""} onChange={(e) => upd(i, { identifications: [{ identification_type_id: a.identifications[0]?.identification_type_id || typeId, value: e.target.value }] })} /></td><td><button className="text-slate-400 hover:text-red-600" onClick={() => setAnimals(animals.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td></tr>)}
      </tbody></table>
    </Dialog>
  </CardBody></Card>;
}
