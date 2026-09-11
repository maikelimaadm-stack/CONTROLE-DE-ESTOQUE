"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { SupplyRequestsList, STAGES } from "./requests-list";

/**
 * Compras › Processos (Compactação V2): UMA lista. Escopo (Todos / Meus) e Etapa são filtros na URL (`?scope=`,
 * `?stage=`), não sub-abas; os contadores vêm de uma única consulta agregada por status.
 */
const STAGE_PERM: Record<string, string> = { all: "purchase_requests.view", request: "purchase_requests.view", quotation: "purchase_quotations.view", authorization: "purchase_authorization.view", buy: "purchase_buy.view", receipts: "purchase_receipts.view", finished: "purchase_receipts.view", rejected: "rejected_requests.view" };
export const STAGE_ORDER = ["all", "request", "quotation", "authorization", "buy", "receipts", "finished", "rejected"];
export function SupplyProcesses() {
  const { can } = useAuth();
  const [scope, setScope] = useUrlParam("scope", "all"); const [stageRaw, setStage] = useUrlParam("stage", "all");
  const stage = STAGES[stageRaw] && STAGE_PERM[stageRaw] && can(STAGE_PERM[stageRaw]!) ? stageRaw : "all";
  const counts = useQuery({ queryKey: ["supply-counts", scope], queryFn: () => api<Record<string, number>>(`/api/supply/requests/counts${qs({ scope: scope === "mine" ? "mine" : undefined })}`), staleTime: 30_000 });
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print">
      <FilterChips label="Escopo" testId="supply-scope" value={scope} onChange={(v) => setScope(v)} options={[{ value: "all", label: "Todos", hint: "Todos os processos, em qualquer etapa" }, { value: "mine", label: "Meus", hint: "Solicitações em que sou responsável ou solicitante" }]} />
      <FilterChips label="Etapa" testId="supply-stage" value={stage} onChange={(v) => setStage(v)} options={STAGE_ORDER.map((k) => ({ value: k, label: STAGES[k]!.title, hint: STAGES[k]!.hint, perm: STAGE_PERM[k], count: counts.data?.[k] }))} />
    </div>
    <SupplyRequestsList stage={stage} scope={scope === "mine" ? "mine" : "all"} />
  </div>;
}
