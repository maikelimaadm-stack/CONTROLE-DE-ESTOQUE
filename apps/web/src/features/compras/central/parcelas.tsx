"use client";
import * as React from "react";
import { buildInstallments } from "@agro/domain";
import { dateBR, num } from "@/lib/utils";
import { Input } from "@/components/ui";
import { MgSelect } from "@/components/ui/mg-controls";
import { CampoDaCentral, ChaveSimNao, DataDaCentral } from "@/features/central/campo";
import type { Plan } from "@/features/docs/shared";
import type { EstadoDaCriacao } from "./estado";

/**
 * PARCELAS DA COMPRA — o pagamento na aba Financeiro, COMPACTO (decisão do usuário, 10/2026).
 *
 * A aba abre pelo "Possui entrada?" (o interruptor). Com entrada, aparecem SÓ o valor e o vencimento dela — e o plano
 * passa a ir no corpo (a entrada não existe sem `plano_parcelas`). Depois vêm "Parcelas" (pela condição ou ajuste),
 * o Nº de parcelas e o 1º vencimento. "Intervalo (dias)" e "Modo" NÃO aparecem: o plano da compra vence a cada 30
 * dias, que é o padrão do plano — o valor continua no `plano` e vai no corpo como sempre.
 *
 * A lista abaixo não é decoração: vem do MESMO `buildInstallments` do domínio que o servidor usa para gerar os
 * títulos, então mostra exatamente os vencimentos e valores que serão gravados (e desaparece quando o plano ainda
 * não fecha, em vez de inventar número). A entrada é a primeira linha.
 */
export function ParcelasDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const p = e.plano;
  const mudar = (novo: Partial<Plan>) => e.setPlano({ ...p, ...novo });
  const entrada = p.down_payment_value ?? "";

  /** Ligar a entrada exige o plano no corpo: sem `ajustarParcelas`, as parcelas da condição seriam gravadas sem ela. */
  const mudarEntrada = (ligada: boolean) => {
    if (ligada) e.setAjustarParcelas(true);
    mudar(ligada
      ? { has_down_payment: true, ...(p.down_payment_date ? {} : { down_payment_date: p.first_due_date }) }
      : { has_down_payment: false, down_payment_value: "", down_payment_date: undefined });
  };

  const parcelas = React.useMemo(() => {
    if (e.totalExibido <= 0 || !Number.isInteger(p.installments) || p.installments < 1) return null;
    try {
      return buildInstallments({
        totalAmount: e.totalExibido.toFixed(2), installments: p.installments, firstDueDate: p.first_due_date,
        mode: p.mode, intervalDays: p.interval_days || 30, dueDay: p.due_day,
        hasDownPayment: p.has_down_payment, downPaymentValue: p.down_payment_value || undefined,
        downPaymentDate: p.down_payment_date || undefined
      });
    } catch { return null; }
  }, [e.totalExibido, p]);

  return <>
    <ChaveSimNao rotulo="Possui entrada?" valor={p.has_down_payment} onChange={mudarEntrada} testId="compras-possui-entrada" />

    {p.has_down_payment && <>
      <CampoDaCentral rotulo="Valor da entrada" preenchido={entrada !== ""} testId="compras-entrada-campo">
        <Input data-testid="compras-entrada" type="number" step="0.01" min="0" inputMode="decimal" value={entrada}
          onChange={(ev) => mudar({ down_payment_value: ev.target.value })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Venc. da entrada" icone="data" preenchido={Boolean(p.down_payment_date)} testId="compras-entrada-data-campo">
        <DataDaCentral rotulo="Vencimento da entrada" value={p.down_payment_date ?? ""} onChange={(v) => mudar({ down_payment_date: v })} />
      </CampoDaCentral>
    </>}

    <CampoDaCentral rotulo="Parcelas" icone="selecao" preenchido testId="compras-parcelas-campo">
      <MgSelect data-testid="compras-parcelas" value={e.ajustarParcelas ? "ajustar" : "padrao"}
        onChange={(v) => e.setAjustarParcelas(v === "ajustar")}
        options={[{ value: "padrao", label: "Pela condição (ou à vista)" }, { value: "ajustar", label: "Ajustar parcelas" }]} />
    </CampoDaCentral>

    {e.ajustarParcelas && <>
      <CampoDaCentral rotulo="Nº de parcelas" preenchido testId="compras-parcelas-numero-campo">
        <Input data-testid="compras-parcelas-numero" type="number" min={1} max={120} value={p.installments}
          onChange={(ev) => mudar({ installments: Number(ev.target.value) })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="1º vencimento" icone="data" preenchido={Boolean(p.first_due_date)} testId="compras-parcelas-vencimento-campo">
        <DataDaCentral rotulo="1º vencimento" value={p.first_due_date} onChange={(v) => mudar({ first_due_date: v })} />
      </CampoDaCentral>

      {parcelas && <div data-testid="compras-parcelas-lista" className="mt-0.5 overflow-hidden rounded-md border border-slate-200">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 bg-slate-50 px-2 py-1 text-[10.5px] font-medium text-slate-500">
          <span>Parcela</span><span>Vencimento</span><span className="text-right">Valor</span>
        </div>
        {parcelas.map((x) => <div key={x.number} data-testid="compras-parcela" data-entrada={x.isDownPayment ? "true" : undefined}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-slate-100 px-2 py-1 text-[12px]">
          <span className="text-slate-600">{x.isDownPayment ? "Entrada" : `${x.number}ª`}</span>
          <span className="tabular-nums text-slate-700">{dateBR(x.dueDate)}</span>
          <span className="text-right font-medium tabular-nums text-slate-900">{num(x.amount, 2)}</span>
        </div>)}
      </div>}
    </>}
  </>;
}
