"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tractor } from "lucide-react";
import { api, setSession } from "@/lib/api";
import { Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const router = useRouter();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try { const r = await api<{ token: string; user: { id: string; email: string; name: string } }>("/api/auth/login", { method: "POST", body: { email, password } }); setSession({ token: r.token, orgId: null, farmId: null, user: r.user }); router.replace("/"); }
    catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-2"><Tractor className="h-7 w-7 text-brand-600" /><div><h1 className="text-lg font-semibold">Agro ERP</h1><p className="text-xs text-slate-500">Acesso ao sistema</p></div></div>
        <div className="space-y-3">
          <div><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><Label htmlFor="password">Senha</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={loading}>Entrar</Button>
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-400">Ambiente de demonstração: admin@demo.local / Demo@12345</p>
      </form>
    </div>
  );
}
