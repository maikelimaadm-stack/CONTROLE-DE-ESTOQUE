"use client";
import * as React from "react";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
import { enumLabel } from "@/lib/copy";

/** Detalhe de um abastecimento — GET /api/fleet/fuel-supplies/:id; cancelar estorna o estoque (regra existente). */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false);
  const q = useDoc<Row>(`/api/fleet/fuel-supplies/${id}`); const act = useAction(() => setC(false)); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Abastecimento ${String(d["code"])}`} back="/frota?tab=abastecimentos" status={String(d["status"])} actions={d["status"] !== "cancelled" && can("fuel_supplies.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar abastecimento</Button>}>
    <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["supply_date"] as string)], ["Equipamento", `${d["equipment_code"] ?? ""} ${d["equipment_name"] ?? ""}`.trim()], ["Combustível", String(d["product_name"])], ["Armazém / tanque", String(d["warehouse_name"] ?? "—")], ["Operador", String(d["operator_name"] ?? "—")], ["Litros", num(String(d["quantity"] ?? "0"), 3)], ["Valor unitário", brl(String(d["unit_value"] ?? "0"))], ["Total", brl(String(d["total"] ?? "0"))], ["Horímetro", d["hour_meter"] ? num(d["hour_meter"] as string, 2) : "—"], ["Km", d["mileage"] ? num(d["mileage"] as string, 2) : "—"], ["Centro de custo", String(d["cost_center_name"] ?? "—")], ["Safra", String(d["harvest_name"] ?? "—")], ["Origem", enumLabel("origin", d["origin"] ?? "manual")], ["Observação", String(d["note"] ?? "—")]]} />
    <Confirm open={c} onOpenChange={setC} title="Cancelar abastecimento" text="Estorna a baixa de combustível no estoque e registra na auditoria." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/fleet/fuel-supplies/${id}/cancel`, body: {} })} />
  </DetailShell>}</LoadingOr>;
}
