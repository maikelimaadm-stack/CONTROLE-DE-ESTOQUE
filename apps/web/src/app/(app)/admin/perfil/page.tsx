"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, CardBody, Field, Input } from "@/components/ui";
import { useAction } from "@/features/docs/actions";
import { favoriteOptions } from "@/lib/nav";
export default function Page() {
  const { ctx, refresh, can } = useAuth(); const [f, setF] = React.useState({ name: "", phone: "", current_password: "", password: "" }); const [fav, setFav] = React.useState<{ route: string; label: string }[]>([]);
  React.useEffect(() => { if (ctx) { setF((o) => ({ ...o, name: ctx.user.name })); setFav(ctx.favorites); } }, [ctx]);
  const act = useAction(() => { void refresh(); setF((o) => ({ ...o, current_password: "", password: "" })); });
  const leaves = React.useMemo(() => favoriteOptions(can), [can]);
  return <div className="space-y-3">
    <Card><CardHeader title="Meu perfil" subtitle={ctx?.user.email} actions={<Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "/api/admin/profile", method: "PUT", body: { name: f.name, phone: f.phone || null, password: f.password || undefined, current_password: f.current_password || undefined } })}>Salvar</Button>} /><CardBody><div className="grid grid-cols-12 gap-2"><Field label="Nome" span={6}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Telefone" span={6}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="Senha atual" span={6}><Input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field><Field label="Nova senha (mínimo 8 caracteres)" span={6}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field></div></CardBody></Card>
    <Card><CardHeader title="Favoritos (atalhos do menu)" actions={<Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ path: "/api/admin/favorites", method: "PUT", body: fav })}>Salvar favoritos</Button>} /><CardBody className="space-y-2">
      <div className="flex flex-wrap gap-1">{fav.map((x) => <span key={x.route} className="flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs">{x.label}<button onClick={() => setFav(fav.filter((y) => y.route !== x.route))}>×</button></span>)}</div>
      <select className="h-8 rounded border px-2 text-sm" value="" onChange={(e) => { const l = leaves.find((x) => x.href === e.target.value); if (l && !fav.some((y) => y.route === l.href) && fav.length < 30) setFav([...fav, { route: l.href, label: l.short }]); }}><option value="">Adicionar atalho…</option>{leaves.map((l) => <option key={l.href} value={l.href}>{l.label}</option>)}</select>
    </CardBody></Card>
  </div>;
}
