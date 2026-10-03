"use client";
import * as React from "react";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR } from "@/lib/utils";
import Link from "next/link";
import { Button, Confirm, buttonVariants } from "@/components/ui";
import { DetailShell, KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { ActionDialog, useAction } from "@/features/docs/actions";
import { enumLabel } from "@/lib/copy";

/** A linha "Tipo de operação" do detalhe: só com a TOP gravada (`<nome> · versão <n>`). */
function topDoLancamento(d: Row): [string, string][] {
  const nome = d["tipo_operacao_nome"]; const versao = d["tipo_operacao_versao"];
  if (typeof nome !== "string" || !nome) return [];
  return [["Tipo de operação", versao === null || versao === undefined ? nome : `${nome} · versão ${String(versao)}`]];
}

/**
 * Detalhe da OS — GET /api/service-orders/:id; Iniciar, Finalizar (baixa insumos e EPIs com local), Avaliar e Cancelar
 * (regras existentes). OPERACOES-01 F10 (decisão 287): "Editar" leva à Central da OS (`/os/<id>/editar`, o PUT de
 * sempre), com a permissão de editar e enquanto a OS está aberta ou em andamento — as mesmas situações que o servidor
 * aceita; "Tipo de operação" só com a TOP gravada.
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can } = useAuth(); const [st, setSt] = React.useState<string | null>(null); const [rate, setRate] = React.useState(false);
  const q = useDoc<Row & { lines: Row[] }>(`/api/service-orders/${id}`); const act = useAction(() => { setSt(null); setRate(false); }); const d = q.data;
  const s = String(d?.["status"]);
  return <LoadingOr q={q}>{d && <DetailShell title={`OS ${String(d["code"])}`} back="/os" status={s} actions={can("service_orders.edit") && <>
    {(s === "open" || s === "in_progress") && <Link href={`/os/${id}/editar`} className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="os-editar">Editar</Link>}
    {s === "open" && <Button size="sm" onClick={() => setSt("in_progress")}>Iniciar execução</Button>}
    {s === "in_progress" && <Button size="sm" onClick={() => setSt("finished")}>Finalizar (baixa insumos)</Button>}
    {s === "finished" && can("service_orders.rate") && <Button size="sm" variant="outline" onClick={() => setRate(true)}>Avaliar</Button>}
    {(s === "open" || s === "in_progress") && <Button size="sm" variant="danger" onClick={() => setSt("cancelled")}>Cancelar</Button>}
  </>}>
    <KV items={[["Data", dateBR(d["order_date"] as string)], ...topDoLancamento(d), ["Atividade", String(d["activity_name"] ?? "—")], ["Operação", String(d["operation_name"] ?? "—")], ["Centro de resultado", String(d["cost_center_name"] ?? "—")], ["Responsável", String(d["responsible_name"] ?? "—")], ["Equipe", String(d["team_name"] ?? "—")], ["Previsto", `${d["planned_start"] ? dateBR(d["planned_start"] as string) : "—"} a ${d["planned_end"] ? dateBR(d["planned_end"] as string) : "—"}`], ["Iniciada", d["started_at"] ? dateTimeBR(d["started_at"] as string) : "—"], ["Finalizada", d["finished_at"] ? dateTimeBR(d["finished_at"] as string) : "—"], ["Custo total", brl(d["total"] as string)], ["Avaliação", d["rating"] ? `${"★".repeat(Number(d["rating"]))} ${d["rating_note"] ?? ""}` : "—"], ["Descrição", String(d["description"] ?? "")]]} />
    <SimpleTable rows={d.lines} cols={[{ key: "section", label: "Seção", render: (r) => enumLabel("os_section", r["section"]) }, { key: "x", label: "Recurso", render: (r) => String(r["person_name"] ?? r["equipment_name"] ?? r["product_name"] ?? "") }, { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 2) }, { key: "unit_value", label: "Valor unitário", align: "right", render: (r) => brl(r["unit_value"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }, { key: "hours", label: "Horas", align: "right" }, { key: "note", label: "Observação" }]} />
    <Confirm open={Boolean(st)} onOpenChange={() => setSt(null)} title={st === "cancelled" ? "Cancelar OS" : st === "finished" ? "Finalizar OS" : "Iniciar OS"} text={st === "finished" ? "Insumos e EPIs com local de estoque serão baixados do estoque." : undefined} danger={st === "cancelled"} loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/service-orders/${id}/status`, body: { status: st } })} />
    <ActionDialog open={rate} onOpenChange={setRate} title="Avaliar execução" loading={act.isPending} fields={[{ name: "rating", label: "Nota (1-5)", type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) })) }, { name: "rating_note", label: "Comentário", type: "textarea" }]} onSubmit={(v) => act.mutate({ path: `/api/service-orders/${id}/rate`, body: { rating: Number(v["rating"]), rating_note: v["rating_note"] || null } })} />
  </DetailShell>}</LoadingOr>;
}
