"use client";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import type { Row } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dfe-drafts"], queryFn: () => api<{ items: Row[] }>("/api/stock/dfe-drafts") });
  const approve = useMutation({ mutationFn: (id: string) => api(`/api/stock/dfe-drafts/${id}/approve`, { method: "POST" }), onSuccess: () => { toast.success("Nota aprovada e lançada no financeiro"); void qc.invalidateQueries(); }, onError: (e) => toast.error((e as Error).message) });
  const ignore = useMutation({ mutationFn: (dfeId: string) => api(`/api/stock/dfe/${dfeId}/ignore`, { method: "POST" }), onSuccess: () => void qc.invalidateQueries() });
  return <Card><CardHeader title="Aprovação de Notas Fiscais" subtitle="Rascunhos gerados automaticamente a partir dos Perfis de Lançamento por fornecedor" actions={<Link href="/estoque/dfe"><Button size="sm" variant="outline">DFe Recebidas</Button></Link>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} loading={q.isLoading} emptyText="Nenhuma nota aguardando aprovação." columns={[{ key: "number", label: "Nº" }, { key: "issuer_name", label: "Emitente" }, { key: "emission_date", label: "Emissão", render: (r) => dateBR(r["emission_date"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }, { key: "proposed", label: "Lançar como", render: (r) => { const p = r["proposed"] as { destination: string; apportionment: unknown[] }; return `${{ product_invoice: "Nota de Produto", expense_invoice: "Nota de Despesa", animal_invoice: "Nota de Animal" }[p.destination] ?? p.destination} · ${p.apportionment?.length ?? 0} linha(s) de rateio`; } }]}
      actions={(r) => <div className="flex justify-end gap-1">{can("dfe_drafts.approve") && <Button size="sm" onClick={() => approve.mutate(String(r["id"]))}>Aprovar</Button>}<Link href={`/estoque/documentos-fiscais/new?dfe_id=${r["dfe_id"]}`}><Button size="sm" variant="outline">Lançar manualmente</Button></Link>{can("dfe_drafts.ignore") && <Button size="sm" variant="ghost" onClick={() => ignore.mutate(String(r["dfe_id"]))}>Ignorar</Button>}</div>} />
  </CardBody></Card>;
}
