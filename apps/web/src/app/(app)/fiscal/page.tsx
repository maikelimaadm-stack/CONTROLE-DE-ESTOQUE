"use client";
import { Suspense } from "react";
import { Workspace, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { DoubleEntryPanel } from "@/features/fiscal/ledger";
import { InvoicesList } from "@/features/stock/invoices-list";

/**
 * Fiscal (V2): abre direto no que funciona — documentos de entrada, partida dobrada e livro caixa. O status das
 * capacidades fiscais (NF-e/MDF-e/SPED não iniciados) fica em Configurações › Fiscal › Capacidades.
 */
function Inner() {
  return <Workspace title="Fiscal" tabs={[
    tab("fiscal.documentos", <InvoicesList />),
    tab("fiscal.partida-dobrada", <div className="ws-scroll"><DoubleEntryPanel /></div>),
    tab("fiscal.livro-caixa", <Dashboard k="livro-caixa" title="Livro Caixa (LCDPR)" />)
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
