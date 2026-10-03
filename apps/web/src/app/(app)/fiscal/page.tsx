"use client";
import { Suspense } from "react";
import { Workspace, tab } from "@/components/workspace";
import { useAuth } from "@/lib/auth";
import { Dashboard } from "@/features/dashboards/dashboard";
import { DoubleEntryPanel } from "@/features/fiscal/ledger";
import { ConferenciaLcdpr } from "@/features/fiscal/lcdpr-conferencia";
import { useLcdpr } from "@/features/financial/central/capacidade";
import { InvoicesList } from "@/features/stock/invoices-list";

/**
 * A aba LIVRO CAIXA: o painel de hoje e, com `capacidades.lcdpr` declarado e a permissão do relatório do Livro Caixa,
 * a CONFERÊNCIA DO LCDPR embaixo (OPERACOES-01 F9, decisão 286) — sem entrada nova no menu. Sem a capacidade (a API
 * anterior) ou sem a permissão, a aba é a de hoje, idêntica: só o painel, e nenhum pedido à conferência.
 */
function LivroCaixa() {
  const lcdpr = useLcdpr(); const { can } = useAuth();
  if (!lcdpr || !can("report.cash_book.view")) return <Dashboard k="livro-caixa" title="Livro Caixa (LCDPR)" />;
  return <div className="ws-scroll space-y-4">
    <Dashboard k="livro-caixa" title="Livro Caixa (LCDPR)" />
    <ConferenciaLcdpr />
  </div>;
}

/**
 * Fiscal (V2): abre direto no que funciona — documentos de entrada, partida dobrada e livro caixa. O status das
 * capacidades fiscais (NF-e/MDF-e/SPED não iniciados) fica em Configurações › Fiscal › Capacidades.
 */
function Inner() {
  return <Workspace title="Fiscal" tabs={[
    tab("fiscal.documentos", <InvoicesList />),
    tab("fiscal.partida-dobrada", <div className="ws-scroll"><DoubleEntryPanel /></div>),
    tab("fiscal.livro-caixa", <LivroCaixa />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
