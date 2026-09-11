"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { encodeList } from "@agro/shared";
import { Dialog } from "@/components/ui";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { DocList, colDate, colStatus } from "@/features/docs/shared";
import { MOV_PT } from "@/features/livestock/shared";
import { TransferAnimalsToBatch } from "./transfer-animals-batch";
import { TransferBatchLocation } from "./transfer-batch-location";
import { TransferToFarm } from "./transfer-farm";
import { GroupBatches } from "./transfer-group-batches";

/**
 * Movimentar rebanho como AÇÃO CONTEXTUAL (Compactação V2): as quatro operações nascem do registro de origem
 * (animal → mover para lote / transferir; lote → mover de local / transferir de fazenda / agrupar) e abrem em diálogo.
 * O histórico continua consultável em Rebanho › Transferências. Endpoints, permissões e regras não mudaram.
 */
export type HerdAction = "animais-lote" | "lote-local" | "fazendas" | "agrupar";
export const HERD_ACTION_LABEL: Record<HerdAction, string> = { "animais-lote": "Mover animais para lote", "lote-local": "Mover lote de local", fazendas: "Transferir de fazenda", agrupar: "Agrupar lotes" };
export const HERD_ACTION_PERM: Record<HerdAction, string> = { "animais-lote": "animal_batch_transfer.create", "lote-local": "batch_module_area_transfer.create", fazendas: "batch_farm_transfer.create", agrupar: "batch_grouping.create" };
export interface HerdActionCtx { animalIds?: string[]; batchId?: string; batchIds?: string[] }
export function HerdActionDialog({ action, ctx, onClose }: { action: HerdAction | null; ctx?: HerdActionCtx; onClose: () => void }) {
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: ["animals"] }); void qc.invalidateQueries({ queryKey: ["b1"] }); onClose(); };
  return <Dialog open={Boolean(action)} onOpenChange={(o) => { if (!o) onClose(); }} title={action ? HERD_ACTION_LABEL[action] : ""} size="xl">
    {action === "animais-lote" && <TransferAnimalsToBatch animalIds={ctx?.animalIds} onDone={done} />}
    {action === "lote-local" && <TransferBatchLocation batchId={ctx?.batchId} onDone={done} history={false} />}
    {action === "fazendas" && <TransferToFarm batchId={ctx?.batchId} animalIds={ctx?.animalIds} onDone={done} history={false} />}
    {action === "agrupar" && <GroupBatches sourceBatchIds={ctx?.batchIds} onDone={done} />}
  </Dialog>;
}
/** Lê `?action=` da URL (links antigos de Movimentar Rebanho) e devolve estado/controles do diálogo. */
export function useHerdAction() {
  const [param, setParam] = useUrlParam("action", "");
  const [state, setState] = React.useState<{ action: HerdAction | null; ctx?: HerdActionCtx }>({ action: null });
  React.useEffect(() => { if (param && param in HERD_ACTION_LABEL) setState({ action: param as HerdAction }); }, [param]);
  const open = (action: HerdAction, ctx?: HerdActionCtx) => setState({ action, ctx });
  const close = () => { setState({ action: null }); if (param) setParam(""); };
  return { ...state, open, close };
}

const TRANSFER_TYPES = ["batch_transfer", "module_area_transfer", "farm_transfer"];
const TRANSFER_PT: Record<string, string> = { batch_transfer: "Animais → lote / agrupamento", module_area_transfer: "Lote → módulo / área / curral", farm_transfer: "Entre fazendas" };
/** Histórico de transferências do rebanho (uma lista, filtro por tipo). */
export function HerdTransfersHistory() {
  const [type, setType] = useUrlParam("type", "");
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Tipo" testId="herd-transfer-type" value={type || "all"} onChange={(v) => setType(v === "all" ? "" : v)} options={[{ value: "all", label: "Todas" }, ...TRANSFER_TYPES.map((t) => ({ value: t, label: TRANSFER_PT[t]! }))]} /></div>
    <DocList key={type || "all"} title="Transferências do rebanho" endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes" rowHref={(r) => `/pecuaria/movimentacoes/${String(r["movement_type"])}/${r["id"]}`} defaultFilters={type ? { movement_type: type } : { movement_type__in: encodeList(TRANSFER_TYPES) }} hideNew entity="animal_movements"
      columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "movement_type", label: "Tipo", kind: "enum", options: TRANSFER_TYPES.map((v) => ({ value: v, label: TRANSFER_PT[v]! })), render: (r) => TRANSFER_PT[String(r["movement_type"])] ?? MOV_PT[String(r["movement_type"])] ?? String(r["movement_type"]) }, { key: "farm_name", label: "Fazenda" }, { key: "batch_name", label: "Lote" }, { key: "quantity", label: "Cabeças", align: "right" }, { key: "note", label: "Destino / obs." }, colStatus()]} />
  </div>;
}
