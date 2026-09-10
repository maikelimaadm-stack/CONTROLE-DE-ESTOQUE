"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useFarmDefault, DocList, colDate } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
export default function Page() {
  const farm = useFarmDefault(); const [f, setF] = React.useState({ farm_id: "", movement_date: todayISO() }); React.useEffect(() => { setF((o) => ({ ...o, farm_id: o.farm_id || farm })); }, [farm]);
  const act = useAction<{ evolved: number }>();
  return <div className="space-y-3"><Card><CardHeader title="Evolução de Rebanho" subtitle="Reclassifica automaticamente a categoria dos animais ativos pela idade (faixas etárias das categorias)." /><CardBody><div className="grid grid-cols-12 gap-2"><Field label="Fazenda" span={4}><RefSelect resource="farms" value={f.farm_id} onChange={(v) => setF({ ...f, farm_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><div className="col-span-3 flex items-end"><Button size="sm" loading={act.isPending} disabled={!f.farm_id} onClick={() => act.mutate({ path: "/api/livestock/evolution/run", idem: true, body: f })}>Executar evolução</Button></div></div>{act.data && <p className="mt-2 text-sm">Animais evoluídos: <b>{act.data.evolved}</b></p>}</CardBody></Card>
    <DocList title="Histórico de evoluções" endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes/evolution" defaultFilters={{ movement_type: "evolution" }} columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "farm_name", label: "Fazenda" }, { key: "quantity", label: "Animais", align: "right" }]} hideNew /></div>;
}
