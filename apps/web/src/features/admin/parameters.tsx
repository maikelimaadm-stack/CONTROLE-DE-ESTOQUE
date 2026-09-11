"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, CardBody, Field, NativeSelect, Input, Spinner } from "@/components/ui";
import { useAction } from "@/features/docs/actions";
export function ParametersPanel() {
  const { can } = useAuth(); const q = useQuery({ queryKey: ["params"], queryFn: () => api<{ parameters: Record<string, unknown> }>("/api/admin/parameters") });
  const [p, setP] = React.useState<Record<string, unknown>>({}); React.useEffect(() => { if (q.data) setP(q.data.parameters ?? {}); }, [q.data]);
  const act = useAction();
  const str = (k: string) => String(p[k] ?? "");
  return <Card><CardHeader title="Parametrizações da Organização" subtitle="Regras configuráveis por tenant (armazenadas em JSON versionado pela auditoria)." actions={can("tenant_parameters.edit") && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "/api/admin/parameters", method: "PUT", body: p })}>Salvar</Button>} /><CardBody>{q.isLoading ? <Spinner /> : <div className="grid grid-cols-12 gap-3">
    <Field label="Escopo do congelamento financeiro" span={4} help="Congelar períodos por organização inteira ou por fazenda"><NativeSelect value={str("financial_freeze_scope") || "organization"} onChange={(e) => setP({ ...p, financial_freeze_scope: e.target.value })}><option value="organization">Organização</option><option value="farm">Fazenda</option></NativeSelect></Field>
    <Field label="Calcular ICMS desonerado (NF-e)" span={4}><NativeSelect value={p["calc_icms_desonerado"] ? "1" : "0"} onChange={(e) => setP({ ...p, calc_icms_desonerado: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
    <Field label="Fluxo de compras simplificado (padrão)" span={4} help="Novas fazendas pulam cotação/autorização"><NativeSelect value={p["simplified_purchase_flow"] ? "1" : "0"} onChange={(e) => setP({ ...p, simplified_purchase_flow: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
    <Field label="Permitir estoque negativo" span={4} help="Bloqueado por padrão (ledger rejeita saída maior que o saldo)"><NativeSelect value={p["allow_negative_stock"] ? "1" : "0"} onChange={(e) => setP({ ...p, allow_negative_stock: e.target.value === "1" })}><option value="0">Não (recomendado)</option><option value="1">Sim</option></NativeSelect></Field>
    <Field label="Dias de aviso de vencimento" span={4}><Input type="number" min={0} value={str("due_alert_days") || "3"} onChange={(e) => setP({ ...p, due_alert_days: Number(e.target.value) })} /></Field>
    <Field label="Moeda / locale" span={4}><Input value={str("locale") || "pt-BR"} onChange={(e) => setP({ ...p, locale: e.target.value })} /></Field>
  </div>}</CardBody></Card>;
}
