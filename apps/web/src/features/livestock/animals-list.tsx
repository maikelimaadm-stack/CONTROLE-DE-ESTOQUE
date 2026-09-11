"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";
import { Plus } from "lucide-react";
export function AnimalsList() {
  const { can } = useAuth(); const router = useRouter();
  const { f, set, reset } = useFilters(); const [applied, setApplied] = React.useState<Record<string, string>>({}); const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50);
  const q = useQuery({ queryKey: ["animals", applied, page, pageSize], queryFn: () => api<{ items: Row[]; total: number; totals: { weight: string; value: string } }>(`/api/livestock/animals${qs({ ...applied, page, pageSize })}`) });
  return <Card><CardHeader title="Animais (rebanho individualizado)" actions={<>{can("animals.create") && <Link href="/pecuaria/animais/new"><Button size="sm"><Plus className="h-3.5 w-3.5" /> Cadastrar animal</Button></Link>}</>} /><CardBody>
    <FilterBar f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} filters={[{ name: "search", label: "Identificação", type: "text" }, { name: "batch_id", label: "Lote", type: "ref", resource: "batches" }, { name: "category_id", label: "Categoria", type: "ref", resource: "animal_categories" }, { name: "breed_id", label: "Raça", type: "ref", resource: "breeds" }, { name: "sex", label: "Sexo", type: "select", options: [{ value: "M", label: "Macho" }, { value: "F", label: "Fêmea" }] }, { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Ativo" }, { value: "sold", label: "Vendido" }, { value: "dead", label: "Morto" }, { value: "lost", label: "Perdido" }, { value: "transferred", label: "Transferido" }] }, { name: "farm_id", label: "Fazenda", type: "ref", resource: "farms" }]} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} onRowClick={(r) => router.push(`/pecuaria/animais/${r["id"]}`)} onExport={can("animals.export") ? (fmt) => download(`/api/reports/animals${qs({ ...applied, format: fmt })}`, `animais.${fmt}`) : undefined}
      columns={[{ key: "identifications", label: "Identificação" }, { key: "category_name", label: "Categoria" }, { key: "breed_name", label: "Raça" }, { key: "sex", label: "Sexo" }, { key: "batch_name", label: "Lote" }, { key: "farm_name", label: "Fazenda" }, { key: "birth_date", label: "Nascimento", render: (r) => r["birth_date"] ? dateBR(r["birth_date"] as string) : "" }, { key: "entry_date", label: "Entrada", render: (r) => dateBR(r["entry_date"] as string) }, { key: "current_weight", label: "Peso (kg)", align: "right", render: (r) => r["current_weight"] ? num(r["current_weight"] as string, 1) : "" }, { key: "unit_value", label: "Valor", align: "right", render: (r) => r["unit_value"] ? brl(r["unit_value"] as string) : "" }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "active" ? "green" : "slate"}>{String(r["status"])}</Badge> }]}
      footer={q.data && <tr><td colSpan={8} className="px-2 py-1">Totais</td><td className="num">{num(q.data.totals.weight, 1)} kg</td><td className="num">{brl(q.data.totals.value)}</td><td /></tr>} />
  </CardBody></Card>;
}
