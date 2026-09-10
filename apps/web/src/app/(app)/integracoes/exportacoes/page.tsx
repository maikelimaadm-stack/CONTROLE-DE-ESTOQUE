"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
interface R { key: string; label: string; labelPlural: string; permission: string }
export default function Page() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["resources"], queryFn: () => api<R[]>("/api/resources") }); const [busy, setBusy] = React.useState("");
  const exp = async (k: string, fmt: "csv" | "xlsx") => { setBusy(k + fmt); try { await download(`/api/exports/${k}?format=${fmt}`, `${k}.${fmt}`); } finally { setBusy(""); } };
  return <Card><CardHeader title="Integrações › Exportações" subtitle="Exporte qualquer cadastro em CSV/XLSX (respeita permissão de exportação). Relatórios transacionais exportam pela própria tela do relatório." /><CardBody>{q.isLoading ? <Spinner /> : <table className="table-dense w-full max-w-3xl text-sm"><thead><tr><th>Cadastro</th><th className="w-48">Exportar</th></tr></thead><tbody>{q.data?.filter((r) => can(`${r.permission}.export`)).map((r) => <tr key={r.key}><td>{r.labelPlural}</td><td className="flex gap-1"><Button size="sm" variant="outline" loading={busy === r.key + "csv"} onClick={() => exp(r.key, "csv")}>CSV</Button><Button size="sm" variant="outline" loading={busy === r.key + "xlsx"} onClick={() => exp(r.key, "xlsx")}>XLSX</Button></td></tr>)}</tbody></table>}
    <div className="mt-4 rounded border bg-slate-50 p-3 text-xs text-slate-600"><b>Integrações externas do sistema de referência</b> (CTA Smart abastecimentos, WhatsApp de pedidos, e-mail): o envio de pedido de compra por WhatsApp/e-mail está implementado via links; importação CTA Smart e API pública documentadas como gap em docs/parity/GAP-ANALYSIS.md.</div>
  </CardBody></Card>;
}
