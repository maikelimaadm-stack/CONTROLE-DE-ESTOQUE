import { z } from "zod";
import { buildInstallments, normalizeApportionment, type ApportionmentLine } from "@agro/domain";
import { D, money, isISODate } from "@agro/shared";
import type { ServiceCtx } from "../lib/context.js";
import { nextCode, assertPeriodOpen } from "../lib/service.js";
import { validation } from "../lib/errors.js";

export const apportionmentSchema = z.array(z.object({
  financial_category_id: z.string().uuid(), cost_center_id: z.string().uuid(), chart_account_id: z.string().uuid().nullable().optional(),
  harvest_id: z.string().uuid().nullable().optional(), area_id: z.string().uuid().nullable().optional(),
  percentage: z.union([z.number(), z.string()]).optional(), amount: z.union([z.number(), z.string()]).optional()
})).min(1);
export const installmentPlanSchema = z.object({
  installments: z.number().int().min(1).max(120).default(1), first_due_date: z.string().refine(isISODate), mode: z.enum(["interval", "fixed_day"]).default("interval"),
  interval_days: z.number().int().min(1).max(366).default(30), due_day: z.number().int().min(1).max(31).optional(),
  has_down_payment: z.boolean().default(false), down_payment_value: z.union([z.number(), z.string()]).optional(), down_payment_date: z.string().refine(isISODate).optional()
});
export type InstallmentPlan = z.infer<typeof installmentPlanSchema>;

export interface TitleInput {
  farmId: string; direction: "payable" | "receivable"; number: string; titleTypeId?: string | null; personId: string | null; proprietaryId?: string | null; branchId?: string | null;
  paymentType?: "single" | "installments" | "recurring" | "advance" | "invoice_group"; recurrenceType?: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  classification?: "unclassified" | "capex" | "opex"; documentType?: string | null; isDeductible?: boolean; isTax?: boolean;
  amount: string; discount?: string; emissionDate: string; dueDate: string; note: string; harvestId?: string | null;
  appropriation?: "direct" | "indirect"; appropriationType?: string | null; apportionment: ApportionmentLine[]; sourceType?: string; sourceId?: string;
  plan?: InstallmentPlan | null;
}

/** Cria título(s) financeiro(s) com rateio; se houver plano de parcelamento, cria uma linha por parcela (group_id comum). */
export async function createTitles(ctx: ServiceCtx, input: TitleInput): Promise<{ ids: string[]; groupId: string | null }> {
  await assertPeriodOpen(ctx.tx, ctx.orgId, input.farmId, input.emissionDate);
  const total = money(input.amount);
  if (D(total).lte(0)) throw validation("Valor do título deve ser positivo");
  const lines = normalizeApportionment(money(D(total).minus(input.discount ?? 0)), input.apportionment);
  const parts = input.plan && (input.plan.installments > 1 || input.plan.has_down_payment)
    ? buildInstallments({ totalAmount: total, installments: input.plan.installments, firstDueDate: input.plan.first_due_date, mode: input.plan.mode, intervalDays: input.plan.interval_days, dueDay: input.plan.due_day, hasDownPayment: input.plan.has_down_payment, downPaymentValue: input.plan.down_payment_value !== undefined ? String(input.plan.down_payment_value) : undefined, downPaymentDate: input.plan.down_payment_date })
    : [{ number: 1, dueDate: input.dueDate, amount: total, isDownPayment: false }];
  const groupId = parts.length > 1 ? (await ctx.tx.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id : null;
  const ids: string[] = [];
  const count = parts.length;
  for (const [i, p] of parts.entries()) {
    const code = await nextCode(ctx.tx, ctx.orgId, `title_${input.direction}`, 4);
    const discount = i === parts.length - 1 ? money(input.discount ?? 0) : "0.00";
    const r = await ctx.tx.query<{ id: string }>(
      `insert into erp.financial_titles(organization_id,farm_id,code,direction,number,title_type_id,proprietary_id,person_id,branch_id,payment_type,recurrence_type,classification,document_type,is_deductible,is_tax,amount,discount,emission_date,due_date,installment_number,installment_count,group_id,appropriation,appropriation_type,note,harvest_id,source_type,source_id,created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) returning id`,
      [ctx.orgId, input.farmId, code, input.direction, count > 1 ? `${input.number}-${p.isDownPayment ? "E" : p.number}` : input.number, input.titleTypeId ?? null, input.proprietaryId ?? null, input.personId, input.branchId ?? null,
        input.paymentType ?? (count > 1 ? "installments" : "single"), input.recurrenceType ?? null, input.classification ?? "unclassified", input.documentType ?? null, input.isDeductible ?? false, input.isTax ?? false,
        p.amount, discount, input.emissionDate, p.dueDate, p.isDownPayment ? 0 : p.number, count, groupId, input.appropriation ?? "direct", input.appropriationType ?? null, input.note, input.harvestId ?? null, input.sourceType ?? null, input.sourceId ?? null, ctx.user.id]);
    const id = r.rows[0]!.id; ids.push(id);
    // rateio proporcional por parcela
    const partNet = D(p.amount).minus(discount);
    const factor = D(total).minus(input.discount ?? 0).isZero() ? D(0) : partNet.div(D(total).minus(input.discount ?? 0));
    let acc = D(0);
    for (const [j, l] of lines.entries()) {
      const amt = j === lines.length - 1 ? partNet.minus(acc) : D(l.amount).mul(factor).toDecimalPlaces(2);
      acc = acc.plus(amt);
      await ctx.tx.query("insert into erp.title_apportionments(title_id,financial_category_id,chart_account_id,cost_center_id,area_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.areaId, l.harvestId, l.percentage, money(amt)]);
    }
  }
  return { ids, groupId };
}

export interface BankMovementInput {
  farmId: string | null; bankAccountId: string; date: string; type: "in" | "out"; categoryType?: string; amount: string; interest?: string; document?: string | null; note?: string | null;
  proprietaryId?: string | null; personId?: string | null; harvestId?: string | null; isDeductible?: boolean; generatesObligation?: boolean; sourceType?: string; sourceId?: string; destinationAccountId?: string | null;
  apportionment?: ApportionmentLine[];
}
export async function createBankMovement(ctx: ServiceCtx, i: BankMovementInput): Promise<string> {
  await assertPeriodOpen(ctx.tx, ctx.orgId, i.farmId, i.date);
  const acc = await ctx.tx.query<{ is_active: boolean }>("select is_active from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null", [i.bankAccountId, ctx.orgId]);
  if (!acc.rows[0]) throw validation("Conta bancária inválida"); if (!acc.rows[0].is_active) throw validation("Conta bancária inativa");
  const code = await nextCode(ctx.tx, ctx.orgId, "bank_movement", 5);
  const r = await ctx.tx.query<{ id: string }>(
    "insert into erp.bank_movements(organization_id,farm_id,code,bank_account_id,movement_date,type,category_type,destination_account_id,amount,interest,document,generates_obligation,is_deductible,note,proprietary_id,person_id,harvest_id,source_type,source_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id",
    [ctx.orgId, i.farmId, code, i.bankAccountId, i.date, i.type, i.categoryType ?? i.type, i.destinationAccountId ?? null, money(i.amount), money(i.interest ?? 0), i.document ?? null, i.generatesObligation ?? false, i.isDeductible ?? false, i.note ?? null, i.proprietaryId ?? null, i.personId ?? null, i.harvestId ?? null, i.sourceType ?? null, i.sourceId ?? null, ctx.user.id]);
  const id = r.rows[0]!.id;
  if (i.apportionment?.length) for (const l of normalizeApportionment(money(i.amount), i.apportionment)) await ctx.tx.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,chart_account_id,cost_center_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.harvestId, l.percentage, l.amount]);
  // transferência interna: cria o par na conta destino
  if (i.categoryType === "internal_transfer" && i.destinationAccountId) {
    const pair = await ctx.tx.query<{ id: string }>("insert into erp.bank_movements(organization_id,farm_id,code,bank_account_id,movement_date,type,category_type,destination_account_id,transfer_pair_id,amount,document,note,proprietary_id,source_type,source_id,created_by) values ($1,$2,$3,$4,$5,$6,'internal_transfer',$7,$8,$9,$10,$11,$12,'bank_movement',$8,$13) returning id",
      [ctx.orgId, i.farmId, await nextCode(ctx.tx, ctx.orgId, "bank_movement", 5), i.destinationAccountId, i.date, i.type === "out" ? "in" : "out", i.bankAccountId, id, money(i.amount), i.document ?? null, i.note ?? null, i.proprietaryId ?? null, ctx.user.id]);
    await ctx.tx.query("update erp.bank_movements set transfer_pair_id=$2 where id=$1", [id, pair.rows[0]!.id]);
  }
  return id;
}
