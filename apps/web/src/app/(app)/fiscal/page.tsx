"use client";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { FiscalStatusPanel } from "@/features/fiscal/status";
import { DoubleEntryPanel } from "@/features/fiscal/ledger";
import { InvoicesList } from "@/features/stock/invoices-list";

/**
 * Fiscal: só o que funciona hoje aparece como aba (documentos de entrada, partida dobrada, livro caixa). Emissão de
 * NF-e/MDF-e/SPED continua documentada como não iniciada na aba "Situação" — nada incompleto é exposto como pronto.
 */
function Inner() {
  return <Workspace title="Fiscal" tabs={[
    { key: "situacao", label: "Situação", content: <div className="ws-scroll"><FiscalStatusPanel /></div> },
    { key: "documentos", label: "Documentos de entrada", perm: "invoices.view", content: <InvoicesList /> },
    { key: "partida-dobrada", label: "Partida dobrada", perm: "journal_entries.view", content: <div className="ws-scroll"><DoubleEntryPanel /></div> },
    { key: "livro-caixa", label: "Livro Caixa", perm: ["dashboard.cash_book.view", "report.cash_book.view"], content: <Dashboard k="livro-caixa" title="Livro Caixa (LCDPR)" /> }
  ]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
