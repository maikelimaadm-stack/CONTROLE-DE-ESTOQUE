"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useCreate, useFarmDefault } from "@/features/docs/shared";
const SCORES = [["-1", "-1 · Cocho vazio, lambido"], ["0", "0 · Vazio"], ["1", "1 · Sobras mínimas"], ["2", "2 · Sobras moderadas"], ["3", "3 · Muitas sobras"], ["4", "4 · Não comeu"]];
export function TroughReadingsPanel() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", reading_date: todayISO(), corral_id: "", score: "0", leftover_kg: "", note: "" }); React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const create = useCreate("/api/feedlot/trough-readings", () => setF({ ...f, corral_id: "", leftover_kg: "", note: "" }));
  return <Card><CardHeader title="Leitura de Cocho" subtitle="Escore de sobras por curral/dia (uma leitura por curral e data; nova leitura substitui a anterior). O escore mais recente aparece no mapa do confinamento." /><CardBody><div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={3}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.reading_date} onChange={(e) => setF({ ...f, reading_date: e.target.value })} /></Field><Field label="Curral" required span={3}><RefSelect resource="feedlot_corrals" value={f.corral_id} onChange={(v) => setF({ ...f, corral_id: v ?? "" })} /></Field><Field label="Escore" span={3}><NativeSelect value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })}>{SCORES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field><Field label="Sobras (kg)" span={2}><Input type="number" step="0.1" value={f.leftover_kg} onChange={(e) => setF({ ...f, leftover_kg: e.target.value })} /></Field><Field label="Observação" span={6}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field><div className="col-span-2 flex items-end"><Button size="sm" loading={create.isPending} disabled={!f.corral_id} onClick={() => create.mutate({ ...f, score: Number(f.score), leftover_kg: f.leftover_kg || null, note: f.note || null })}>Registrar</Button></div></div></CardBody></Card>;
}
