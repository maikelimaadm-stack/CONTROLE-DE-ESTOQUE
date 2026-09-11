"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Workspace, SubTabs, NewChooser } from "@/components/workspace";
import { StockOverview } from "@/features/stock/overview";
import { BalancesPanel } from "@/features/stock/balances";
import { MovementsPanel } from "@/features/stock/movements";
import { CorrectionsPanel, CorrectionDialog, type CorrectionPrefill } from "@/features/stock/corrections";
import { InvoicesList } from "@/features/stock/invoices-list";
import { InputEntriesList } from "@/features/stock/input-entries-list";
import { DfeQueue } from "@/features/stock/dfe-queue";
import { DfeApprovals } from "@/features/stock/dfe-approvals";
import { RequisitionsList } from "@/features/stock/requisitions-list";
import { WriteoffsList } from "@/features/stock/writeoffs-list";
import { DevolutionsList } from "@/features/stock/devolutions-list";
import { TransfersList } from "@/features/stock/transfers-list";
import { FeedFormulasPanel } from "@/features/stock/feed-formulas";
import { FeedBatchesList } from "@/features/stock/feed-batches-list";

/**
 * Estoque: Visão Geral, Saldo, Movimentações (ledger + ajustes), Entradas e Recebimentos, Saídas, Transferências
 * e Fábrica de Ração. Cada operação continua usando seu próprio endpoint/regra; aqui só muda a navegação.
 */
function Inner() {
  const router = useRouter(); const sp = useSearchParams();
  const [adjust, setAdjust] = React.useState<{ open: boolean; prefill?: CorrectionPrefill }>({ open: sp.get("new") === "ajuste" });
  const openAdjust = (prefill?: CorrectionPrefill) => setAdjust({ open: true, prefill });
  return <>
    <Workspace title="Estoque" actions={<NewChooser items={[
      { label: "Entrada manual (insumos)", href: "/estoque/entradas/new", perm: "input_entries.create" },
      { label: "Documento fiscal / importar XML", href: "/estoque/documentos-fiscais/new", perm: "invoices.create" },
      { label: "Requisição (saída)", href: "/estoque/requisicoes/new", perm: "requisitions.create" },
      { label: "Saída direta (baixa)", href: "/estoque/baixas/new", perm: "stock_writeoffs.create" },
      { label: "Transferência entre armazéns", href: "/estoque/transferencias/new?kind=warehouse", perm: "warehouse_transfers.create" },
      { label: "Transferência entre fazendas", href: "/estoque/transferencias/new?kind=farm", perm: "farm_transfers.create" },
      { label: "Devolução (entrada)", href: "/estoque/devolucoes/new", perm: "devolutions.create" },
      { label: "Ajuste de estoque", onClick: () => openAdjust(), perm: "stock_corrections.create" },
      { label: "Produção de ração", href: "/estoque/batidas/new", perm: "feed_batches.create" }
    ]} />} tabs={[
      { key: "visao-geral", label: "Visão Geral", perm: "stocks.view", content: <StockOverview /> },
      { key: "saldo", label: "Saldo", perm: "stocks.view", content: <BalancesPanel onAdjust={(r) => openAdjust({ farm_id: String(r["farm_id"] ?? ""), warehouse_id: String(r["warehouse_id"] ?? ""), product_id: String(r["product_id"] ?? ""), provider_lot: String(r["provider_lot"] ?? "") })} /> },
      { key: "movimentacoes", label: "Movimentações", perm: ["stocks.view", "stock_corrections.view"], content: <SubTabs tabs={[
        { key: "ledger", label: "Ledger (todas)", perm: "stocks.view", content: <MovementsPanel /> },
        { key: "correcoes", label: "Ajustes de estoque", perm: "stock_corrections.view", content: <CorrectionsPanel /> }
      ]} /> },
      { key: "entradas", label: "Entradas e Recebimentos", perm: ["invoices.view", "input_entries.view", "dfe.view", "dfe_drafts.view"], content: <SubTabs tabs={[
        { key: "lancadas", label: "Lançadas (documentos fiscais)", perm: "invoices.view", content: <InvoicesList /> },
        { key: "manuais", label: "Entradas manuais", perm: "input_entries.view", content: <InputEntriesList /> },
        { key: "dfe", label: "DFe / XML recebidos", perm: "dfe.view", content: <div className="ws-scroll"><DfeQueue /></div> },
        { key: "conferencia", label: "Em conferência", perm: "dfe_drafts.view", content: <div className="ws-scroll"><DfeApprovals /></div> }
      ]} /> },
      { key: "saidas", label: "Saídas", perm: ["requisitions.view", "stock_writeoffs.view", "devolutions.view"], content: <SubTabs tabs={[
        { key: "requisicoes", label: "Requisições", perm: "requisitions.view", content: <RequisitionsList /> },
        { key: "diretas", label: "Saídas diretas (baixas)", perm: "stock_writeoffs.view", content: <WriteoffsList /> },
        { key: "devolucoes", label: "Devoluções", perm: "devolutions.view", content: <DevolutionsList /> }
      ]} /> },
      { key: "transferencias", label: "Transferências", perm: ["warehouse_transfers.view", "farm_transfers.view"], content: <SubTabs tabs={[
        { key: "warehouse", label: "Entre armazéns", perm: "warehouse_transfers.view", content: <TransfersList kind="warehouse" /> },
        { key: "farm", label: "Entre fazendas", perm: "farm_transfers.view", content: <TransfersList kind="farm" /> }
      ]} /> },
      { key: "fabrica", label: "Fábrica de Ração", perm: ["feed_formulas.view", "feed_batches.view"], content: <SubTabs tabs={[
        { key: "formulas", label: "Fórmulas", perm: "feed_formulas.view", content: <div className="ws-scroll"><FeedFormulasPanel /></div> },
        { key: "producoes", label: "Produções", perm: "feed_batches.view", content: <FeedBatchesList /> },
        { key: "consumo", label: "Consumo de matéria-prima", perm: "stocks.view", content: <MovementsPanel fixed={{ movement_type: "production_out" }} title="Consumo de matéria-prima (ledger)" /> },
        { key: "custos", label: "Custos (produto acabado)", perm: "stocks.view", content: <MovementsPanel fixed={{ movement_type: "production_in" }} title="Entradas de produto acabado (ledger)" /> }
      ]} /> }
    ]} />
    <CorrectionDialog open={adjust.open} onOpenChange={(o) => { setAdjust((a) => ({ ...a, open: o })); if (!o && sp.get("new")) router.replace("/estoque?tab=saldo"); }} prefill={adjust.prefill} />
  </>;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
