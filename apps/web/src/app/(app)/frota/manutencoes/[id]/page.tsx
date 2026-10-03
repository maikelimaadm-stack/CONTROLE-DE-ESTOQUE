"use client";
import * as React from "react";
import { use } from "react";
import { D, money } from "@agro/shared";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Confirm } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";

/** Texto decimal da resposta → `Decimal`; ausente ou fora da forma decimal conta zero. */
const decimal = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? D(v.trim()) : D(0));

/** A linha "Tipo de operação" do detalhe: só com a TOP gravada (`<nome> · versão <n>`). */
function topDoLancamento(d: Row): [string, string][] {
  const nome = d["tipo_operacao_nome"]; const versao = d["tipo_operacao_versao"];
  if (typeof nome !== "string" || !nome) return [];
  return [["Tipo de operação", versao === null || versao === undefined ? nome : `${nome} · versão ${String(versao)}`]];
}

/**
 * Detalhe de uma manutenção — GET /api/fleet/maintenances/:id; cancelar estorna o estoque (regra existente).
 * OPERACOES-01 F10 (decisão 287): os totais são os que a API devolve (`total_parts`, `total_services`; o total é a soma
 * dos dois, em decimal) — a tela lia chaves que a resposta não tem e mostrava vazio; "Tipo de operação" só com a TOP
 * gravada; a "Observação" é a gravada (a coluna nasceu nesta fase: antes a API a descartava).
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false);
  const q = useDoc<Row & { machines: (Row & { items: Row[] | null })[] }>(`/api/fleet/maintenances/${id}`); const act = useAction(() => setC(false)); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Manutenção ${String(d["code"])}`} back="/frota?tab=manutencoes" status={String(d["status"])} actions={d["status"] !== "cancelled" && can("maintenances.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar (estorna estoque)</Button>}>
    <KV items={[["Data", dateBR(d["maintenance_date"] as string)], ...topDoLancamento(d), ["Responsável", String(d["responsible_name"] ?? "")], ["Peças/insumos", brl(String(d["total_parts"] ?? "0"))], ["Serviços", brl(String(d["total_services"] ?? "0"))], ["Total", brl(money(decimal(d["total_parts"]).plus(decimal(d["total_services"]))))], ["Observação", String(d["note"] ?? "—")]]} />
    {d.machines.map((m) => <div key={String(m["id"])} className="space-y-2 rounded border p-3" data-testid="manutencao-maquina">
      <KV items={[["Equipamento", `${m["equipment_code"] ?? ""} ${m["equipment_name"]}`], ["Horímetro", String(m["hour_meter"] ?? "—")], ["Km", String(m["mileage"] ?? "—")], ["Executor", String(m["executor_name"] ?? "—")], ["Horas", String(m["hours"] ?? "—")], ["Serviço", brl(m["service_total"] as string)], ["Descrição", String(m["service_description"] ?? "")]]} />
      <SimpleTable rows={m.items ?? []} cols={[{ key: "product_name", label: "Produto" }, { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) }, { key: "unit_value", label: "Valor unitário", align: "right", render: (r) => brl(r["unit_value"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }]} />
    </div>)}
    <Confirm open={c} onOpenChange={setC} title="Cancelar manutenção" danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/fleet/maintenances/${id}/cancel` })} />
  </DetailShell>}</LoadingOr>;
}
