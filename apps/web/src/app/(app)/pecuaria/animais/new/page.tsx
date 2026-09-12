"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
import { Trash2, Plus } from "lucide-react";
export default function Page() {
  const router = useRouter(); const farm = useFarmDefault();
  const [h, setH] = React.useState({ farm_id: "", species_id: "", category_id: "", breed_id: "", batch_id: "", sex: "", entry_date: todayISO(), birth_date: "", reproductive_stage: "", reproductive_status: "", current_weight: "", unit_value: "", mother_id: "", father_id: "", origin_provider_id: "", note: "" });
  const [ids, setIds] = React.useState<{ identification_type_id: string; value: string }[]>([{ identification_type_id: "", value: "" }]);
  React.useEffect(() => { setH((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate<{ id: string }>("/api/livestock/animals", (r) => router.push(`/pecuaria/animais/${r.id}`));
  const submit = () => create.mutate({ ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v === "" ? null : v])), farm_id: h.farm_id, species_id: h.species_id, category_id: h.category_id, entry_date: h.entry_date, identifications: ids.filter((i) => i.identification_type_id && i.value) });
  return <Card><CardHeader title="Cadastrar animal" subtitle="Entrada avulsa no rebanho (sem movimento de compra). Para compras use Pecuária › Movimentações › Compra." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.species_id || !h.category_id || !ids.some((i) => i.identification_type_id && i.value)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="Fazenda" required span={3}><RefSelect resource="farms" value={h.farm_id} onChange={(v) => setH({ ...h, farm_id: v ?? "" })} /></Field>
      <Field label="Espécie" required span={3}><RefSelect resource="animal_species" value={h.species_id} onChange={(v) => setH({ ...h, species_id: v ?? "" })} /></Field>
      <Field label="Categoria" required span={3}><RefSelect resource="animal_categories" value={h.category_id} onChange={(v) => setH({ ...h, category_id: v ?? "" })} /></Field>
      <Field label="Raça" span={3}><RefSelect resource="breeds" value={h.breed_id} onChange={(v) => setH({ ...h, breed_id: v ?? "" })} /></Field>
      <Field label="Lote" span={3}><RefSelect resource="batches" value={h.batch_id} onChange={(v) => setH({ ...h, batch_id: v ?? "" })} /></Field>
      <Field label="Sexo" span={2}><NativeSelect value={h.sex} onChange={(e) => setH({ ...h, sex: e.target.value })}><option value="">—</option><option value="M">Macho</option><option value="F">Fêmea</option></NativeSelect></Field>
      <Field label="Data de entrada" required span={2}><Input type="date" value={h.entry_date} onChange={(e) => setH({ ...h, entry_date: e.target.value })} /></Field>
      <Field label="Nascimento" span={2}><Input type="date" value={h.birth_date} onChange={(e) => setH({ ...h, birth_date: e.target.value })} /></Field>
      <Field label="Peso atual (kg)" span={2}><Input type="number" step="0.1" value={h.current_weight} onChange={(e) => setH({ ...h, current_weight: e.target.value })} /></Field>
      <Field label="Valor (R$)" span={2}><Input type="number" step="0.01" value={h.unit_value} onChange={(e) => setH({ ...h, unit_value: e.target.value })} /></Field>
      <Field label="Estágio reprodutivo" span={3}><NativeSelect value={h.reproductive_stage} onChange={(e) => setH({ ...h, reproductive_stage: e.target.value })}><option value="">—</option><option value="nulliparous">Nulípara</option><option value="heifer">Novilha</option><option value="primiparous">Primípara</option><option value="multiparous">Multípara</option><option value="lactation">Lactação</option></NativeSelect></Field>
      <Field label="Situação reprodutiva" span={3}><NativeSelect value={h.reproductive_status} onChange={(e) => setH({ ...h, reproductive_status: e.target.value })}><option value="">—</option><option value="empty">Vazia</option><option value="pregnant">Prenha</option><option value="calved">Parida</option></NativeSelect></Field>
      <Field label="Fornecedor de origem" span={3}><RefSelect resource="people" value={h.origin_provider_id} onChange={(v) => setH({ ...h, origin_provider_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Identificações (brinco, SISBOV, chip…)</h3>
    <table className="table-dense w-full max-w-2xl text-[12.5px]"><tbody>{ids.map((i, k) => <tr key={k}><td className="w-64"><RefSelect resource="identification_types" value={i.identification_type_id} onChange={(v) => setIds(ids.map((x, j) => (j === k ? { ...x, identification_type_id: v ?? "" } : x)))} /></td><td><Input value={i.value} onChange={(e) => setIds(ids.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)))} /></td><td className="w-8"><button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setIds(ids.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table>
    <Button size="sm" variant="outline" onClick={() => setIds([...ids, { identification_type_id: "", value: "" }])}><Plus className="h-3.5 w-3.5" /> Identificação</Button>
  </CardBody></Card>;
}
