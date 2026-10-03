"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workspace, ViewSegment, NewChooser, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { BudgetPlanningPanel } from "@/features/financial/budget-planning";
import { ResourceList } from "@/features/resources/resource-list";
import { useCentralFinanceira } from "@/features/financial/central/capacidade";
import { FinanceiroLegado, NOVOS_DE_HOJE, abaContasDeHoje, abaCaixaDeHoje } from "@/features/financial/central/legado";
import { CentralTitulos } from "@/features/financial/central/titulos";
import { AbaBancosECaixa, AbaConciliacao, AbaFluxoEResultado, AbaAdiantamentos } from "@/features/financial/bancos/abas";

/**
 * FINANCEIRO (OPERACOES-01 F8, decisão 285). A página pergunta à API se ela declara a Central Financeira
 * (`useCentralFinanceira`):
 *   · carregando → nada (a tela antiga não pisca antes da nova);
 *   · legado     → o Financeiro de HOJE, idêntico (a API anterior: skew sentido 1);
 *   · central    → o menu Financeiro com as abas na ordem pedida: Títulos, Bancos e caixa, Conciliação, Fluxo e
 *                  resultado, Adiantamentos; depois Visão Geral, Planejamento e Compromissos.
 * As áreas antigas (Contas, Caixa e Bancos) saíram do menu e continuam pela URL: só são montadas quando a URL as pede
 * (`tab=contas` / `tab=caixa`), exatamente como hoje — favoritos, links e testes antigos não quebram.
 */
function CentralFinanceira() {
  const sp = useSearchParams();
  const pedida = sp.get("tab"); const status = sp.get("status") ?? undefined; const dueSoon = sp.get("due_soon") ?? undefined;
  const antigas = pedida === "contas" ? [abaContasDeHoje(status, dueSoon)] : pedida === "caixa" ? [abaCaixaDeHoje()] : [];
  return <Workspace title="Financeiro" defaultTab="titulos" actions={<NewChooser items={[...NOVOS_DE_HOJE, { label: "Nova transferência entre contas", href: "/financeiro?tab=bancos&sub=transferencias&nova=1", perm: "bank_movements.create" }]} />} tabs={[
    tab("financeiro.titulos", <ViewSegment tabs={[
      tab("financeiro.titulos.receber", <CentralTitulos key="receivable" direcao="receivable" />),
      tab("financeiro.titulos.pagar", <CentralTitulos key="payable" direcao="payable" />),
      tab("financeiro.titulos.todos", <CentralTitulos key="todos" direcao="todos" />)
    ]} />),
    tab("financeiro.bancos", <AbaBancosECaixa />),
    tab("financeiro.conciliacao", <AbaConciliacao />),
    tab("financeiro.fluxo", <AbaFluxoEResultado />),
    tab("financeiro.adiantamentos", <AbaAdiantamentos />),
    tab("financeiro.visao-geral", <Dashboard k="financeiro" title="Indicadores financeiros" />),
    tab("financeiro.planejamento", <div className="ws-scroll"><BudgetPlanningPanel /></div>),
    tab("financeiro.compromissos", <ResourceList resourceKey="contracts" />),
    ...antigas
  ]} />;
}

function Inner() {
  const estado = useCentralFinanceira();
  if (estado === "carregando") return null;
  if (estado === "legado") return <FinanceiroLegado />;
  return <CentralFinanceira />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
