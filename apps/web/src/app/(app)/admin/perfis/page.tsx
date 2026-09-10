"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { type Row } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth(); const router = useRouter(); const q = useQuery({ queryKey: ["roles"], queryFn: () => api<{ items: Row[] }>("/api/admin/roles") });
  return <Card><CardHeader title="Perfis de Acesso" subtitle="Cada perfil concede permissões por recurso e ação; a autorização é aplicada no servidor em todas as rotas." actions={can("roles.create") && <Link href="/admin/perfis/new"><Button size="sm">Novo perfil</Button></Link>} /><CardBody>{q.isLoading ? <Spinner /> : <DataTable rows={q.data?.items ?? []} onRowClick={(r) => router.push(`/admin/perfis/${r["id"]}`)} columns={[{ key: "name", label: "Perfil" }, { key: "description", label: "Descrição" }, { key: "permission_count", label: "Permissões", align: "right" }, { key: "member_count", label: "Usuários", align: "right" }, { key: "is_system", label: "Tipo", render: (r) => r["is_system"] ? <Badge tone="blue">Sistema</Badge> : <Badge>Personalizado</Badge> }, { key: "updated_at", label: "Atualizado", render: (r) => dateTimeBR(r["updated_at"] as string) }]} />}</CardBody></Card>;
}
