"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { num } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Dialog, Field, Input, Textarea, Confirm } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, type ItemRow, type Row } from "@/features/docs/shared";
type Formula = Row & { items: { product_id: string; product_name: string; quantity: string; percentage: string }[] | null };
export default function Page() {
  const { can } = useAuth(); const qc = useQueryClient(); const [open, setOpen] = React.useState(false); const [edit, setEdit] = React.useState<string | null>(null); const [del, setDel] = React.useState<string | null>(null);
  const [v, setV] = React.useState({ name: "", description: "", product_id: "" }); const [items, setItems] = React.useState<ItemRow[]>([]);
  const q = useQuery({ queryKey: ["formulas"], queryFn: () => api<{ items: Formula[] }>("/api/stock/feed-formulas") });
  const save = useMutation({ mutationFn: () => api(edit ? `/api/stock/feed-formulas/${edit}` : "/api/stock/feed-formulas", { method: edit ? "PUT" : "POST", body: { ...v, product_id: v.product_id || null, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })) } }), onSuccess: () => { toast.success("Formulação salva"); setOpen(false); void qc.invalidateQueries({ queryKey: ["formulas"] }); }, onError: (e) => toast.error((e as Error).message) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/stock/feed-formulas/${id}`, { method: "DELETE" }), onSuccess: () => { setDel(null); void qc.invalidateQueries({ queryKey: ["formulas"] }); } });
  const openNew = () => { setEdit(null); setV({ name: "", description: "", product_id: "" }); setItems([]); setOpen(true); };
  const openEdit = (f: Formula) => { setEdit(String(f["id"])); setV({ name: String(f["name"]), description: String(f["description"] ?? ""), product_id: String(f["product_id"] ?? "") }); setItems((f.items ?? []).map((i) => ({ product_id: i.product_id, quantity: i.quantity }))); setOpen(true); };
  return <Card><CardHeader title="Formulação (Fábrica de Ração)" subtitle="Receita: matérias-primas e quantidades; vincule o produto acabado para a batida gerar estoque" actions={can("feed_formulas.create") && <Button size="sm" onClick={openNew}>Adicionar Novo</Button>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} loading={q.isLoading} columns={[{ key: "code", label: "Código" }, { key: "name", label: "Nome" }, { key: "product_name", label: "Produto acabado" }, { key: "total_quantity", label: "Qtd. total", align: "right", render: (r) => num(r["total_quantity"] as string, 4) }, { key: "items", label: "Matéria prima", render: (r) => ((r as Formula).items ?? []).map((i) => `${i.product_name} (${num(i.percentage)}%)`).join(", ") }]}
      actions={(r) => <div className="flex gap-1 justify-end">{can("feed_formulas.edit") && <Button size="sm" variant="ghost" onClick={() => openEdit(r as Formula)}>Editar</Button>}{can("feed_formulas.delete") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDel(String(r["id"]))}>Excluir</Button>}</div>} />
    <Dialog open={open} onOpenChange={setOpen} size="lg" title={edit ? "Editar formulação" : "Nova formulação"} footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-12 gap-3 mb-3"><Field label="Nome" required span={5}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field><Field label="Produto acabado (gera estoque na batida)" span={7}><RefSelect resource="products" value={v.product_id} onChange={(x) => setV({ ...v, product_id: x ?? "" })} /></Field><Field label="Descrição" span={12}><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></div>
      <ItemsEditor items={items} onChange={setItems} fields={["product", "quantity"]} />
    </Dialog>
    <Confirm open={Boolean(del)} onOpenChange={() => setDel(null)} title="Excluir formulação" danger onConfirm={() => del && remove.mutate(del)} />
  </CardBody></Card>;
}
