"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Badge, Dialog, Menu } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";
import { useUrlParam } from "@/components/workspace";
import { LocateAnimalPanel } from "./locate";
import { ProcessingsPanel } from "./processings";
import { HerdActionDialog, useHerdAction } from "./herd-actions";
import { Plus, MapPin, MoreHorizontal } from "lucide-react";
/**
 * Animais (Compactação V2): a listagem recebe a pesquisa por identificação (brinco, SISBOV, chip, nome), o
 * localizador físico (diálogo `?locate=1`), o indicador "Processamento pendente: N" (abre o painel, `?processing=1`)
 * e as ações contextuais por animal (mover para lote, transferir de fazenda).
 */
export function AnimalsList() {
  const { can } = useAuth(); const router = useRouter();
  const [locate, setLocate] = useUrlParam("locate", ""); const [processing, setProcessing] = useUrlParam("processing", "");
  const herd = useHerdAction();
  const pend = useQuery({ queryKey: ["processings"], queryFn: () => api<{ items: Row[] }>("/api/livestock/processings"), enabled: can("processings.view"), staleTime: 60_000 });
  const pendCount = pend.data?.items.filter((p) => p["status"] !== "finished").length ?? 0;
  const { f, set, reset } = useFilters(); const [applied, setApplied] = React.useState<Record<string, string>>({}); const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50);
  const q = useQuery({ queryKey: ["animals", applied, page, pageSize], queryFn: () => api<{ items: Row[]; total: number; totals: { weight: string; value: string } }>(`/api/livestock/animals${qs({ ...applied, page, pageSize })}`) });
  const rowMenu = (r: Row) => [
    ...(can("animal_batch_transfer.create") ? [{ label: "Mover para lote", onClick: () => herd.open("animais-lote", { animalIds: [String(r["id"])] }) }] : []),
    ...(can("batch_farm_transfer.create") ? [{ label: "Transferir de fazenda", onClick: () => herd.open("fazendas", { animalIds: [String(r["id"])] }) }] : []),
    { label: "Abrir registro", onClick: () => router.push(`/pecuaria/animais/${r["id"]}`) }
  ];
  return <><Card><CardHeader title="Animais (rebanho individualizado)" actions={<>
    {can("processings.view") && pendCount > 0 && <button type="button" className="ws-chip" data-testid="animals-processing" title="Animais comprados por contagem aguardando identificação individual" onClick={() => setProcessing("1")}>Processamento pendente <span className="ws-chip__count">{pendCount}</span></button>}
    {can("locate_animals.view") && <Button size="sm" variant="outline" onClick={() => setLocate("1")} data-testid="animals-locate"><MapPin className="h-3.5 w-3.5" /> Localizar animal</Button>}
    {can("animals.create") && <Link href="/pecuaria/animais/new"><Button size="sm"><Plus className="h-3.5 w-3.5" /> Cadastrar animal</Button></Link>}</>} /><CardBody>
    <FilterBar f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} filters={[{ name: "search", label: "Identificação (brinco, SISBOV, chip, nome)", type: "text" }, { name: "batch_id", label: "Lote", type: "ref", resource: "batches" }, { name: "category_id", label: "Categoria", type: "ref", resource: "animal_categories" }, { name: "breed_id", label: "Raça", type: "ref", resource: "breeds" }, { name: "sex", label: "Sexo", type: "select", options: [{ value: "M", label: "Macho" }, { value: "F", label: "Fêmea" }] }, { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Ativo" }, { value: "sold", label: "Vendido" }, { value: "dead", label: "Morto" }, { value: "lost", label: "Perdido" }, { value: "transferred", label: "Transferido" }] }, { name: "farm_id", label: "Fazenda", type: "ref", resource: "farms" }]} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} onRowClick={(r) => router.push(`/pecuaria/animais/${r["id"]}`)} actions={(r) => <Menu trigger={<button type="button" className="tb-btn tb-btn-icon tb-btn-sm" aria-label="Mais opções do animal" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></button>} items={rowMenu(r)} />} onExport={can("animals.export") ? (fmt) => download(`/api/reports/animals${qs({ ...applied, format: fmt })}`, `animais.${fmt}`) : undefined}
      columns={[{ key: "identifications", label: "Identificação" }, { key: "category_name", label: "Categoria" }, { key: "breed_name", label: "Raça" }, { key: "sex", label: "Sexo" }, { key: "batch_name", label: "Lote" }, { key: "farm_name", label: "Fazenda" }, { key: "birth_date", label: "Nascimento", render: (r) => r["birth_date"] ? dateBR(r["birth_date"] as string) : "" }, { key: "entry_date", label: "Entrada", render: (r) => dateBR(r["entry_date"] as string) }, { key: "current_weight", label: "Peso (kg)", align: "right", render: (r) => r["current_weight"] ? num(r["current_weight"] as string, 1) : "" }, { key: "unit_value", label: "Valor", align: "right", render: (r) => r["unit_value"] ? brl(r["unit_value"] as string) : "" }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "active" ? "green" : "slate"}>{String(r["status"])}</Badge> }]}
      footer={q.data && <tr><td colSpan={8} className="px-2 py-1">Totais</td><td className="num">{num(q.data.totals.weight, 1)} kg</td><td className="num">{brl(q.data.totals.value)}</td><td /></tr>} />
  </CardBody></Card>
  <Dialog open={locate === "1"} onOpenChange={(o) => { if (!o) setLocate(""); }} title="Localizar animal" size="xl"><LocateAnimalPanel /></Dialog>
  <Dialog open={processing === "1"} onOpenChange={(o) => { if (!o) setProcessing(""); }} title="Processamento de animais comprados" size="xl"><ProcessingsPanel /></Dialog>
  <HerdActionDialog action={herd.action} ctx={herd.ctx} onClose={herd.close} />
  </>;
}
