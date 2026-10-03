"use client";
import * as React from "react";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, ConfirmDialog, DetailShell } from "@/components/ui";
import { KV, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
import { enumLabel } from "@/lib/copy";

/** A linha "Tipo de operação" do detalhe: só com a TOP gravada (`<nome> · versão <n>`). */
function topDoLancamento(d: Row): [string, string][] {
  const nome = d["tipo_operacao_nome"]; const versao = d["tipo_operacao_versao"];
  if (typeof nome !== "string" || !nome) return [];
  return [["Tipo de operação", versao === null || versao === undefined ? nome : `${nome} · versão ${String(versao)}`]];
}

/**
 * Detalhe de um abastecimento — GET /api/fleet/fuel-supplies/:id; cancelar estorna o estoque (regra existente).
 * OPERACOES-01 F10 (decisão 287): "Tipo de operação" só quando o lançamento tem TOP (o nome e a versão congelados que a
 * API nova devolve; a anterior não tem a chave, e o lançamento sem TOP também não mostra a linha).
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [c, setC] = React.useState(false);
  const q = useDoc<Row>(`/api/fleet/fuel-supplies/${id}`); const act = useAction(() => setC(false)); const d = q.data;
  return <LoadingOr q={q}>{d && <DetailShell title={`Abastecimento ${String(d["code"])}`} subtitle={`${String(d["empresa_name"])} · ${dateBR(d["supply_date"] as string)}`} backHref="/frota?tab=abastecimentos" breadcrumbs={[{ label: "Frota e Ativos", href: "/frota" }, { label: "Abastecimentos", href: "/frota?tab=abastecimentos" }, { label: String(d["code"]) }]} status={String(d["status"])} statusDomain="status" actions={d["status"] !== "cancelled" && can("fuel_supplies.delete") && <Button size="sm" variant="danger" onClick={() => setC(true)}>Cancelar abastecimento</Button>}>
    <KV items={[["Empresa", String(d["empresa_name"])], ["Data", dateBR(d["supply_date"] as string)], ...topDoLancamento(d), ["Equipamento", `${d["equipment_code"] ?? ""} ${d["equipment_name"] ?? ""}`.trim()], ["Combustível", String(d["product_name"])], ["Local de estoque / tanque", String(d["warehouse_name"] ?? "—")], ["Operador", String(d["operator_name"] ?? "—")], ["Litros", num(String(d["quantity"] ?? "0"), 3)], ["Valor unitário", brl(String(d["unit_value"] ?? "0"))], ["Total", brl(String(d["total"] ?? "0"))], ["Horímetro", d["hour_meter"] ? num(d["hour_meter"] as string, 2) : "—"], ["Km", d["mileage"] ? num(d["mileage"] as string, 2) : "—"], ["Centro de resultado", String(d["cost_center_name"] ?? "—")], ["Safra", String(d["harvest_name"] ?? "—")], ["Origem", enumLabel("origin", d["origin"] ?? "manual")], ["Observação", String(d["note"] ?? "—")]]} />
    <ConfirmDialog open={c} onOpenChange={setC} title="Cancelar abastecimento" text="Estorna a baixa de combustível no estoque e registra na auditoria." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/fleet/fuel-supplies/${id}/cancel`, body: {} })} />
  </DetailShell>}</LoadingOr>;
}
