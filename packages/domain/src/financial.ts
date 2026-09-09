import { D, DomainError, addDays, addMonths, money, splitEvenly, sum, type DecimalString, type ISODate } from "@agro/shared";

export type TitleStatus = "open" | "partially_paid" | "paid" | "cancelled";
export const TITLE_STATUS_LABELS: Record<TitleStatus, string> = { open: "Á vencer", partially_paid: "Baixa Parcial", paid: "Baixada", cancelled: "Cancelada" };

/** Status exibido na listagem (à vencer / vencida derivam da data). */
export function displayTitleStatus(t: { status: TitleStatus; dueDate: ISODate; paymentType?: string }, today: ISODate): string {
  if (t.status === "paid") return t.paymentType === "advance" ? "Adiantamento/Baixado" : t.paymentType === "invoice_group" ? "Fatura/Baixado" : "Baixada";
  if (t.status === "cancelled") return "Cancelada";
  if (t.status === "partially_paid") return "Baixa Parcial";
  if (t.paymentType === "advance") return "Adiantamento/Pendente";
  if (t.paymentType === "invoice_group") return "Fatura/Pendente";
  return t.dueDate < today ? "Vencida" : "Á vencer";
}

export interface InstallmentPlanInput {
  totalAmount: DecimalString;
  installments: number;
  firstDueDate: ISODate;
  mode: "interval" | "fixed_day";
  intervalDays?: number;
  dueDay?: number;
  hasDownPayment?: boolean;
  downPaymentValue?: DecimalString;
  downPaymentDate?: ISODate;
}
export interface Installment { number: number; dueDate: ISODate; amount: DecimalString; isDownPayment: boolean }

/**
 * Gera o parcelamento como no modal "Parcelamento" (Nª parcelas, venc. 1ª PC, por intervalo de dias ou dia fixo,
 * entrada opcional). Garante soma exata.
 */
export function buildInstallments(input: InstallmentPlanInput): Installment[] {
  if (!Number.isInteger(input.installments) || input.installments < 1) throw new DomainError("VALIDATION_ERROR", "Número de parcelas deve ser >= 1");
  const total = D(input.totalAmount);
  if (total.lte(0)) throw new DomainError("VALIDATION_ERROR", "Valor total deve ser positivo");
  const out: Installment[] = [];
  let remaining = total;
  if (input.hasDownPayment) {
    const dp = D(input.downPaymentValue ?? 0);
    if (dp.lte(0) || dp.gte(total)) throw new DomainError("VALIDATION_ERROR", "Entrada deve ser maior que zero e menor que o total");
    out.push({ number: 0, dueDate: input.downPaymentDate ?? input.firstDueDate, amount: money(dp), isDownPayment: true });
    remaining = total.minus(dp);
  }
  const parts = splitEvenly(remaining, input.installments);
  for (let i = 0; i < input.installments; i++) {
    let due: ISODate;
    if (input.mode === "fixed_day") {
      const base = addMonths(input.firstDueDate, i);
      const day = input.dueDay ?? Number(input.firstDueDate.slice(8, 10));
      const y = base.slice(0, 4), m = base.slice(5, 7);
      const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
      due = `${y}-${m}-${String(Math.min(day, last)).padStart(2, "0")}`;
    } else {
      due = addDays(input.firstDueDate, i * (input.intervalDays ?? 30));
    }
    out.push({ number: i + 1, dueDate: due, amount: parts[i]!, isDownPayment: false });
  }
  const check = sum(out.map((x) => x.amount));
  if (!check.eq(total)) throw new DomainError("INSTALLMENTS_MISMATCH", "Soma das parcelas difere do total", { total: total.toFixed(2), sum: check.toFixed(2) });
  return out;
}

export interface ApportionmentLine { financialCategoryId: string; costCenterId: string; percentage?: DecimalString | number; amount?: DecimalString | number; chartAccountId?: string | null; harvestId?: string | null; areaId?: string | null }

/**
 * Valida/normaliza o rateio (tela "Rateio": categoria, centro de custo, % e valor). Aceita percentuais OU valores;
 * a soma dos valores deve fechar exatamente com o total (resíduo na última linha), percentuais somam 100.
 */
export interface NormalizedApportionment { financialCategoryId: string; costCenterId: string; percentage: DecimalString; amount: DecimalString; chartAccountId: string | null; harvestId: string | null; areaId: string | null }
export function normalizeApportionment(total: DecimalString, lines: ApportionmentLine[]): NormalizedApportionment[] {
  if (!lines.length) throw new DomainError("APPORTIONMENT_MISMATCH", "Informe ao menos uma linha de rateio");
  const t = D(total);
  const byAmount = lines.every((l) => l.amount !== undefined && l.amount !== null && l.amount !== "");
  const result = lines.map((l) => {
    const amount = byAmount ? D(l.amount!) : t.mul(D(l.percentage ?? 0)).div(100).toDecimalPlaces(2);
    const percentage = t.isZero() ? D(0) : amount.div(t).mul(100).toDecimalPlaces(4);
    return { financialCategoryId: l.financialCategoryId, costCenterId: l.costCenterId, chartAccountId: l.chartAccountId ?? null, harvestId: l.harvestId ?? null, areaId: l.areaId ?? null, amount, percentage };
  });
  const s = sum(result.map((r) => r.amount));
  const diff = t.minus(s);
  if (diff.abs().gt(0.05)) throw new DomainError("APPORTIONMENT_MISMATCH", "Soma do rateio difere do valor do título", { total: t.toFixed(2), sum: s.toFixed(2) });
  if (!diff.isZero()) { const last = result[result.length - 1]!; last.amount = last.amount.plus(diff); last.percentage = t.isZero() ? D(0) : last.amount.div(t).mul(100).toDecimalPlaces(4); }
  return result.map((r) => ({ ...r, amount: money(r.amount), percentage: r.percentage.toFixed(4) }));
}

export interface SettlementInput { amount: DecimalString; discount?: DecimalString; penalty?: DecimalString; interest?: DecimalString; increase?: DecimalString; exchangeAdjustment?: DecimalString }
/** Valor líquido da baixa = valor baixado − desconto + multa + juros + acréscimo ± ajuste cambial (como no modal "Baixar Contas"). */
export function settlementNet(i: SettlementInput): DecimalString {
  return money(D(i.amount).minus(D(i.discount ?? 0)).plus(D(i.penalty ?? 0)).plus(D(i.interest ?? 0)).plus(D(i.increase ?? 0)).plus(D(i.exchangeAdjustment ?? 0)));
}
/** Regra: baixa não pode exceder o saldo do título. */
export function assertSettlementWithinBalance(balance: DecimalString, i: SettlementInput) {
  const applied = D(i.amount).plus(D(i.discount ?? 0));
  if (applied.gt(D(balance))) throw new DomainError("PAYMENT_EXCEEDS_BALANCE", "Valor baixado + desconto excede o saldo do título", { balance, applied: applied.toFixed(2) });
  if (D(i.amount).lte(0)) throw new DomainError("VALIDATION_ERROR", "Valor baixado deve ser positivo");
}

/** Recorrência (semanal/mensal/trimestral/anual): gera as próximas N ocorrências a partir da 1ª data. */
export function recurrenceDates(first: ISODate, type: "weekly" | "monthly" | "quarterly" | "yearly", count: number): ISODate[] {
  const out: ISODate[] = [];
  for (let i = 0; i < count; i++) {
    out.push(type === "weekly" ? addDays(first, 7 * i) : type === "monthly" ? addMonths(first, i) : type === "quarterly" ? addMonths(first, 3 * i) : addMonths(first, 12 * i));
  }
  return out;
}
