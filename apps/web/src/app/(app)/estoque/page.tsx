"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Workspace, ViewSegment, NewChooser, FilterChips, useUrlParam, tab } from "@/components/workspace";
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
import { MovimentacoesEstoque } from "@/features/estoque/movimentacoes-lista";
import type { Row } from "@/features/docs/shared";
import { rotaDoAjusteAPartirDoSaldo, useAjusteDoSaldoNaCentral } from "@/features/estoque/movimentacoes-variantes";

/**
 * Estoque (Compactação V2): Visão Geral · Estoque (saldo / movimentações / ajustes) · Recebimentos · Operações ·
 * Fábrica de Ração. Fontes de dados diferentes ficam num seletor compacto (`?sub=`); "+ Novo" tem dois níveis
 * (Entrada / Saída / Transferência / Produção). Ajuste de estoque nasce do saldo (ação por linha, permissão própria)
 * e devolução nasce da requisição/saída original — nenhum dos dois é opção cotidiana do "+ Novo".
 * Cada operação continua usando seu próprio endpoint/regra.
 *
 * ESTOQUE-01 (decisão 274): "Movimentações", logo depois de Visão Geral, é a lista única do DOCUMENTO de estoque,
 * com o `Novo` que pergunta a TOP e abre a Central de Estoque. As abas e o "+ Novo" acima continuam como estão — as
 * telas antigas não mudam até uma fatia própria trocá-las.
 *
 * OPERACOES-01 F5b (decisão 282): a aba Movimentações tem as SETE espécies (entrada, saída, transferência, ajuste,
 * requisição, consumo e devolução de consumo) quando a API declara a movimentação interna, e as quatro de antes quando
 * não declara. O "Ajustar estoque" da linha do Saldo abre a CENTRAL de ajuste já preenchida (empresa, Local de estoque,
 * produto e lote da linha; custo informável) quando o usuário pode lançar ajuste (`ajustes_estoque.create`) e a API
 * declara a capacidade numa lista de TOPs de ajuste pronta; senão, o diálogo de correção de sempre
 * (`stock_corrections.create`). Enquanto a capacidade é perguntada, a ação não aparece. A aba Ajustes e o
 * `?new=ajuste` continuam no diálogo antigo.
 */
const scroll = (c: React.ReactNode) => <div className="ws-scroll">{c}</div>;
function Transfers() {
  const [kind, setKind] = useUrlParam("kind", "warehouse");
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Tipo" testId="stock-transfer-kind" value={kind} onChange={setKind} options={[{ value: "warehouse", label: "Entre locais de estoque", perm: "warehouse_transfers.view" }, { value: "farm", label: "Entre empresas", perm: "farm_transfers.view" }]} /></div>
    <TransfersList kind={kind} />
  </div>;
}
/**
 * O Saldo com o "Ajustar estoque" por linha (F5b). A pergunta da capacidade só sai com o Saldo na tela: a Central de
 * ajuste (preenchida pela linha) com `ajustes_estoque.create` e a capacidade; nada enquanto a pergunta não volta; o
 * diálogo de sempre (`ajustarNoDialogo`, só com `stock_corrections.create`) no resto.
 */
function Saldo({ ajustarNoDialogo }: { ajustarNoDialogo?: (r: Row) => void }) {
  const router = useRouter();
  const ajusteNaCentral = useAjusteDoSaldoNaCentral();
  const onAdjust = ajusteNaCentral === true
    ? (r: Row) => router.push(rotaDoAjusteAPartirDoSaldo(r))
    : ajusteNaCentral === "carregando" ? undefined : ajustarNoDialogo;
  return <BalancesPanel onAdjust={onAdjust} />;
}
function Inner() {
  const router = useRouter(); const sp = useSearchParams(); const { can } = useAuth();
  const [adjust, setAdjust] = React.useState<{ open: boolean; prefill?: CorrectionPrefill }>({ open: sp.get("new") === "ajuste" });
  const openAdjust = (prefill?: CorrectionPrefill) => setAdjust({ open: true, prefill });
  return <>
    <Workspace title="Estoque" defaultTab="estoque" actions={<NewChooser items={[
      { label: "Entrada", children: [{ label: "Entrada manual (insumos)", href: "/estoque/entradas/new", perm: "input_entries.create" }, { label: "Documento fiscal / importar XML", href: "/estoque/documentos-fiscais/new", perm: "invoices.create" }] },
      { label: "Saída", children: [{ label: "Requisição", href: "/estoque/requisicoes/new", perm: "requisitions.create" }, { label: "Saída direta (baixa)", href: "/estoque/baixas/new", perm: "stock_writeoffs.create" }] },
      { label: "Transferência", children: [{ label: "Entre locais de estoque", href: "/estoque/transferencias/new?kind=warehouse", perm: "warehouse_transfers.create" }, { label: "Entre empresas", href: "/estoque/transferencias/new?kind=farm", perm: "farm_transfers.create" }] },
      { label: "Produção", children: [{ label: "Produção de ração", href: "/estoque/batidas/new", perm: "feed_batches.create" }] }
    ]} />} tabs={[
      tab("estoque.visao-geral", <StockOverview />),
      tab("estoque.movimentacoes", <MovimentacoesEstoque />),
      tab("estoque.estoque", <ViewSegment tabs={[
        tab("estoque.estoque.saldo", <Saldo ajustarNoDialogo={can("stock_corrections.create") ? (r) => openAdjust({ empresa_id: String(r["empresa_id"] ?? ""), warehouse_id: String(r["warehouse_id"] ?? ""), product_id: String(r["product_id"] ?? ""), provider_lot: String(r["provider_lot"] ?? "") }) : undefined} />),
        tab("estoque.estoque.ledger", <MovementsPanel />),
        tab("estoque.estoque.ajustes", <CorrectionsPanel />)
      ]} />),
      tab("estoque.recebimentos", <ViewSegment tabs={[
        tab("estoque.recebimentos.fiscais", <InvoicesList />),
        tab("estoque.recebimentos.manuais", <InputEntriesList />),
        tab("estoque.recebimentos.dfe", scroll(<DfeQueue />)),
        tab("estoque.recebimentos.conferencia", scroll(<DfeApprovals />))
      ]} />),
      tab("estoque.operacoes", <ViewSegment tabs={[
        tab("estoque.operacoes.requisicoes", <RequisitionsList />),
        tab("estoque.operacoes.diretas", <WriteoffsList />),
        tab("estoque.operacoes.transferencias", <Transfers />),
        tab("estoque.operacoes.devolucoes", <DevolutionsList />)
      ]} />),
      tab("estoque.fabrica", <ViewSegment tabs={[
        tab("estoque.fabrica.formulas", scroll(<FeedFormulasPanel />)),
        tab("estoque.fabrica.producoes", <FeedBatchesList />),
        tab("estoque.fabrica.consumo", <MovementsPanel fixed={{ movement_type: "production_out" }} title="Consumo de matéria-prima (ledger)" />),
        tab("estoque.fabrica.custos", <MovementsPanel fixed={{ movement_type: "production_in" }} title="Entradas de produto acabado (ledger)" />)
      ]} />)
    ]} />
    <CorrectionDialog open={adjust.open} onOpenChange={(o) => { setAdjust((a) => ({ ...a, open: o })); if (!o && sp.get("new")) router.replace("/estoque?tab=estoque&sub=saldo"); }} prefill={adjust.prefill} />
  </>;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
