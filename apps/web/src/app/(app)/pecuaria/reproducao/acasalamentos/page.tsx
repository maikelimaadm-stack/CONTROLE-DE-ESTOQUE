"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateBR, todayISO } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Dialog, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable } from "@/components/ui/data-table";
import { useCreate, type Row } from "@/features/docs/shared";
import { AnimalPicker } from "@/features/livestock/shared";
import { ActionDialog, useAction } from "@/features/docs/actions";
export default function Page() {
  const { can } = useAuth(); const [season, setSeason] = React.useState(""); const [page, setPage] = React.useState(1); const [open, setOpen] = React.useState(false); const [diag, setDiag] = React.useState<string | null>(null);
  const q = useQuery({ queryKey: ["matings", season, page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/livestock/matings${qs({ season_id: season, page, pageSize: 50 })}`) });
  const [f, setF] = React.useState({ season_id: "", sire_id: "", protocol_id: "", mating_type: "natural", mating_date: todayISO(), inseminator_person_id: "", note: "" }); const [dams, setDams] = React.useState<string[]>([]);
  const create = useCreate("/api/livestock/matings", () => { setOpen(false); setDams([]); void q.refetch(); }); const act = useAction(() => setDiag(null));
  return <Card><CardHeader title="Acasalamentos / Coberturas" actions={can("matings.create") && <Button size="sm" onClick={() => setOpen(true)}>Nova cobertura</Button>} /><CardBody>
    <div className="mb-3 max-w-sm"><Field label="Estação de monta"><RefSelect resource="breeding_seasons" value={season} onChange={(v) => setSeason(v ?? "")} /></Field></div>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={50} onPage={setPage} loading={q.isLoading} columns={[{ key: "mating_date", label: "Data", render: (r) => dateBR(r["mating_date"] as string) }, { key: "season_name", label: "Estação" }, { key: "dam_identification", label: "Matriz" }, { key: "sire_name", label: "Touro / sêmen" }, { key: "mating_type", label: "Tipo" }, { key: "inseminator_name", label: "Inseminador" }, { key: "result", label: "Diagnóstico", render: (r) => <Badge tone={r["result"] === "pregnant" ? "green" : r["result"] === "empty" ? "red" : "amber"}>{String(r["result"])}</Badge> }, { key: "expected_birth_date", label: "Parto previsto", render: (r) => r["expected_birth_date"] ? dateBR(r["expected_birth_date"] as string) : "" }, { key: "x", label: "", render: (r) => r["result"] === "pending" && can("pregnancy_diagnosis.create") ? <Button size="sm" variant="outline" onClick={() => setDiag(String(r["id"]))}>Diagnóstico</Button> : null }]} />
    <Dialog open={open} onOpenChange={setOpen} title="Nova cobertura (uma por matriz selecionada)" size="xl" footer={<Button size="sm" loading={create.isPending} disabled={!f.season_id || !dams.length} onClick={() => create.mutate({ ...f, dam_ids: dams, sire_id: f.sire_id || null, protocol_id: f.protocol_id || null, inseminator_person_id: f.inseminator_person_id || null, note: f.note || null })}>Salvar</Button>}>
      <div className="mb-2 grid grid-cols-12 gap-2"><Field label="Estação" required span={4}><RefSelect resource="breeding_seasons" value={f.season_id} onChange={(v) => setF({ ...f, season_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.mating_date} onChange={(e) => setF({ ...f, mating_date: e.target.value })} /></Field><Field label="Tipo" span={2}><NativeSelect value={f.mating_type} onChange={(e) => setF({ ...f, mating_type: e.target.value })}><option value="natural">Monta natural</option><option value="ai">IA</option><option value="fta">IATF</option><option value="embryo_transfer">TE</option></NativeSelect></Field><Field label="Touro / sêmen" span={4}><RefSelect resource="breeding_sires" value={f.sire_id} onChange={(v) => setF({ ...f, sire_id: v ?? "" })} /></Field><Field label="Protocolo" span={4}><RefSelect resource="breeding_protocols" value={f.protocol_id} onChange={(v) => setF({ ...f, protocol_id: v ?? "" })} /></Field><Field label="Inseminador" span={4}><RefSelect resource="people" value={f.inseminator_person_id} onChange={(v) => setF({ ...f, inseminator_person_id: v ?? "" })} /></Field><Field label="Obs." span={4}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
      <AnimalPicker selected={dams} onChange={setDams} />
    </Dialog>
    <ActionDialog open={Boolean(diag)} onOpenChange={() => setDiag(null)} title="Diagnóstico de gestação" loading={act.isPending} fields={[{ name: "result", label: "Resultado", type: "select", required: true, options: [{ value: "pregnant", label: "Prenha" }, { value: "empty", label: "Vazia" }] }, { name: "diagnosis_date", label: "Data", type: "date", required: true, default: todayISO() }]} onSubmit={(v) => act.mutate({ path: `/api/livestock/matings/${diag}/diagnosis`, body: v })} />
  </CardBody></Card>;
}
