"use client";
import * as React from "react";
import { Plus, X } from "lucide-react";
import { buildInstallments } from "@agro/domain";
import { cn, num } from "@/lib/utils";
import { Button, Input } from "@/components/ui";
import { MgSelect } from "@/components/ui/mg-controls";
import { CampoDaCentral, DataDaCentral } from "@/features/central/campo";
import type { ParcelaDoPlano, Plan } from "@/features/docs/shared";
import type { EstadoDaCriacao } from "./estado";

/**
 * PARCELAS DA COMPRA — o pagamento na aba Financeiro, PARCELA POR PARCELA (decisão do usuário, 10/2026).
 *
 * A tabela é o pagamento: data, valor e observação de cada parcela, com "Adicionar parcela" e o remover de cada linha.
 * Não há mais "Possui entrada?", valor/vencimento da entrada, Nº de parcelas nem 1º vencimento: a lista é o cronograma
 * (o plano grava `parcelas` e a confirmação gera os títulos a partir dela). "Pela condição" continua como antes — sem
 * lista, o plano da condição (ou à vista) vale. Quando o plano gravado ainda não tem `parcelas` (documento antigo, ou
 * derivado da condição), a lista é a que `buildInstallments` já mostrava; o primeiro ajuste materializa as linhas.
 */
/** A grade da tabela: vencimento, valor e observação na MESMA linha (decisão do usuário, 10/2026). */
const GRADE = "grid grid-cols-[124px_104px_minmax(0,1fr)_auto] items-center gap-2";

export function ParcelasDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const p = e.plano;
  const mudar = (novo: Partial<Plan>) => e.setPlano({ ...p, ...novo });

  /* O cronograma que o plano (ou a condição) produz hoje — a mesma conta do domínio que o servidor usa. */
  const derivadas = React.useMemo<ParcelaDoPlano[]>(() => {
    if (!Number.isInteger(p.installments) || p.installments < 1 || e.totalExibido <= 0) return [];
    try {
      return buildInstallments({
        totalAmount: e.totalExibido.toFixed(2), installments: p.installments, firstDueDate: p.first_due_date,
        mode: p.mode, intervalDays: p.interval_days || 30, dueDay: p.due_day,
        hasDownPayment: p.has_down_payment, downPaymentValue: p.down_payment_value || undefined,
        downPaymentDate: p.down_payment_date || undefined
      }).map((x) => ({ vencimento: x.dueDate, valor: x.amount }));
    } catch { return []; }
  }, [e.totalExibido, p]);
  const linhas = p.parcelas ?? derivadas;

  /** A lista passa a ser a do plano: o número de parcelas e o 1º vencimento acompanham (entrada deixa de existir). */
  const definir = (novas: ParcelaDoPlano[]) => {
    const primeira = novas[0]?.vencimento || p.first_due_date;
    mudar({ parcelas: novas.length ? novas : undefined, installments: Math.max(1, novas.length), first_due_date: primeira,
      has_down_payment: false, down_payment_value: undefined, down_payment_date: undefined });
  };
  const mudarLinha = (i: number, campo: keyof ParcelaDoPlano, valor: string) =>
    definir(linhas.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const somaLinhas = linhas.reduce((a, l) => a + Number(l.valor || 0), 0);

  return <>
    <CampoDaCentral rotulo="Parcelas" icone="selecao" preenchido testId="compras-parcelas-campo">
      <MgSelect data-testid="compras-parcelas" value={e.ajustarParcelas ? "ajustar" : "padrao"}
        onChange={(v) => e.setAjustarParcelas(v === "ajustar")}
        options={[{ value: "padrao", label: "Pela condição (ou à vista)" }, { value: "ajustar", label: "Ajustar parcelas" }]} />
    </CampoDaCentral>

    {e.ajustarParcelas && <div data-testid="compras-parcelas-lista" className="mt-0.5 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
      <div aria-hidden className={GRADE + " border-b border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500"}>
        <span>vencimento</span><span>valor</span><span>observação</span><span />
      </div>
      {linhas.length === 0 && <p className="px-2 py-2 text-[12px] text-slate-500">Nenhuma parcela. Use “Adicionar parcela”.</p>}
      {linhas.map((l, k) => <div key={k} data-testid="compras-parcela" className={GRADE + " px-2 py-1.5"}>
        <DataDaCentral className="mg-input" rotulo={`Vencimento da parcela ${k + 1}`} value={l.vencimento} onChange={(v) => mudarLinha(k, "vencimento", v)} />
        <Input className="min-w-0" data-testid={`compras-parcela-valor-${k}`} type="number" step="0.01" min="0" inputMode="decimal"
          placeholder="0,00" value={l.valor} onChange={(ev) => mudarLinha(k, "valor", ev.target.value)} />
        <Input className="min-w-0" data-testid={`compras-parcela-observacao-${k}`} value={l.observacao ?? ""} maxLength={500}
          placeholder="Observação" onChange={(ev) => mudarLinha(k, "observacao", ev.target.value)} />
        <Button size="sm" variant="ghost" className="!h-6 !w-6 !min-h-6 !p-0 justify-self-end text-slate-400 hover:text-rose-600"
          data-testid={`compras-parcela-remover-${k}`} aria-label={`Remover parcela ${k + 1}`} title="Remover parcela"
          onClick={() => definir(linhas.filter((_, j) => j !== k))}><X className="h-3.5 w-3.5" aria-hidden /></Button>
      </div>)}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-[12px]">
        <Button size="sm" data-testid="compras-parcela-adicionar"
          onClick={() => definir([...linhas, { vencimento: "", valor: "", observacao: "" }])} disabled={linhas.length >= 120}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar parcela
        </Button>
        <span data-testid="compras-parcelas-soma" className={cn("ml-auto", Math.abs(somaLinhas - e.totalExibido) > 0.005 ? "text-amber-700" : "text-slate-600")}>
          Soma: {num(somaLinhas, 2)}{Math.abs(somaLinhas - e.totalExibido) > 0.005 ? ` (deve fechar o total: ${num(e.totalExibido, 2)})` : ""}
        </span>
      </div>
    </div>}
  </>;
}
