"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { Button, Card, CardHeader, CardBody, Input, Badge } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
export function LocateAnimalPanel() {
  const [s, setS] = React.useState(""); const [search, setSearch] = React.useState("");
  const q = useQuery({ queryKey: ["locate", search], queryFn: () => api<{ items: Row[] }>(`/api/livestock/locate${qs({ search })}`), enabled: Boolean(search) });
  return <Card><CardHeader title="Localizar Animal" subtitle="Busca por qualquer identificação (brinco, SISBOV, chip) e mostra fazenda, lote, módulo e área atuais" /><CardBody className="space-y-3">
    <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(s); }}><Input value={s} onChange={(e) => setS(e.target.value)} placeholder="Identificação…" autoFocus /><Button type="submit" size="sm">Buscar</Button></form>
    <SimpleTable rows={q.data?.items ?? []} cols={[{ key: "identification", label: "Identificação", render: (r) => <Link className="text-brand-700 underline" href={`/pecuaria/animais/${r["id"]}`}>{String(r["identification"])}</Link> }, { key: "identification_type", label: "Tipo" }, { key: "category_name", label: "Categoria" }, { key: "farm_name", label: "Fazenda" }, { key: "batch_name", label: "Lote" }, { key: "module_name", label: "Módulo" }, { key: "area_name", label: "Área" }, { key: "status", label: "Status", render: (r) => <Badge tone={r["status"] === "active" ? "green" : "slate"}>{String(r["status"])}</Badge> }]} />
  </CardBody></Card>;
}
