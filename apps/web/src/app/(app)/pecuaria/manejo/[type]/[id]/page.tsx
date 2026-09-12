"use client";
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { brl, num, dateBR } from "@/lib/utils";
import { DetailShell } from "@/components/ui";
import { KV, SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { HANDLING_PT } from "@/features/livestock/shared";

/**
 * Detalhe de um manejo (rota canônica /pecuaria/manejo/:tipo/:id — GET /api/livestock/handlings/:id, permissão de
 * visualização do próprio tipo no servidor). `weighing` não é manejo comum: redireciona para /pecuaria/pesagens/:id.
 * "Voltar" devolve à lista de Manejos com o filtro de tipo anterior.
 */
export default function Page({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = use(params); const router = useRouter();
  const isWeighing = type === "weighing";
  React.useEffect(() => { if (isWeighing) router.replace(`/pecuaria/pesagens/${id}`); }, [isWeighing, id, router]);
  const q = useDoc<Row & { items: Row[] }>(`/api/livestock/handlings/${id}`, !isWeighing); const d = q.data;
  if (isWeighing) return null;
  const kind = String(d?.["handling_type"] ?? type);
  return <LoadingOr q={q}>{d && <DetailShell title={`${HANDLING_PT[kind] ?? "Manejo"} ${String(d["code"])}`} subtitle={`${String(d["farm_name"])} · ${dateBR(d["handling_date"] as string)}`} backHref={`/pecuaria?tab=manejos&type=${kind}`} breadcrumbs={[{ label: "Pecuária", href: "/pecuaria" }, { label: "Manejos", href: `/pecuaria?tab=manejos&type=${kind}` }, { label: String(d["code"]) }]}>
    <KV items={[["Fazenda", String(d["farm_name"])], ["Data", dateBR(d["handling_date"] as string)], ["Lote", String(d["batch_name"] ?? "—")], ["Produto", String(d["product_name"] ?? "—")], ["Armazém", String(d["warehouse_name"] ?? "—")], ["Quantidade total", d["quantity"] ? num(d["quantity"] as string, 4) : "—"], ["Custo", d["total"] ? brl(d["total"] as string) : "—"], ["Carência até", d["withdrawal_until"] ? dateBR(d["withdrawal_until"] as string) : "—"], ["Animais", String(d["animals_count"] ?? "")], ["Responsável", String(d["responsible"] ?? "—")], ["Registrado por", String(d["created_by_name"] ?? "—")], ["Observação", String(d["note"] ?? "—")]]} />
    <SimpleTable rows={d.items} cols={[{ key: "identifications", label: "Animal / lote", render: (r) => String(r["identifications"] ?? (r["herd_lot_category"] ? `Lote por contagem — ${r["herd_lot_category"]}` : "(por contagem)")) }, { key: "category_name", label: "Categoria" }, { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(String(r["quantity"] ?? "0"), 4) }, { key: "dose", label: "Dose", align: "right", render: (r) => r["dose"] ? num(r["dose"] as string, 4) : "" }, { key: "new_batch_name", label: "Novo lote" }, { key: "new_category_name", label: "Nova categoria" }]} />
  </DetailShell>}</LoadingOr>;
}
