"use client";
import * as React from "react";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useEmpresaPadrao, DocList, colDate } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
export function HerdEvolutionPanel() {
  const empresa = useEmpresaPadrao(); const [f, setF] = React.useState({ empresa_id: "", movement_date: todayISO() }); React.useEffect(() => { setF((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  const act = useAction<{ evolved: number }>();
  return <div className="space-y-3"><Card><CardHeader title="Evolução de Rebanho" subtitle="Reclassifica automaticamente a categoria dos animais ativos pela idade (faixas etárias das categorias)." /><CardBody><div className="grid grid-cols-12 gap-2"><Field label="Empresa" span={4}><RefSelect resource="empresas" value={f.empresa_id} onChange={(v) => setF({ ...f, empresa_id: v ?? "" })} /></Field><Field label="Data" span={2}><Input type="date" value={f.movement_date} onChange={(e) => setF({ ...f, movement_date: e.target.value })} /></Field><div className="col-span-3 flex items-end"><Button size="sm" loading={act.isPending} disabled={!f.empresa_id} onClick={() => act.mutate({ path: "/api/livestock/evolution/run", idem: true, body: f })}>Executar evolução</Button></div></div>{act.data && <p className="mt-2 text-sm">Animais evoluídos: <b>{act.data.evolved}</b></p>}</CardBody></Card>
    <DocList title="Histórico de evoluções" endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes/evolution" defaultFilters={{ movement_type: "evolution" }} columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "empresa_name", label: "Empresa" }, { key: "quantity", label: "Animais", align: "right" }]} hideNew /></div>;
}
