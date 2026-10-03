import { z } from "zod";
import { buildInstallments, normalizeApportionment, type ApportionmentLine } from "@agro/domain";
import { D, DomainError, money, isISODate } from "@agro/shared";
import type { ServiceCtx } from "../lib/context.js";
import { nextCode, assertPeriodOpen } from "../lib/service.js";
import { validation } from "../lib/errors.js";
import { atribuirIdGlobal } from "../lib/id-global.js";
import { resolverImovelDoMovimento } from "../lib/imovel-rural.js";

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
  empresaId: string; direction: "payable" | "receivable"; number: string; titleTypeId?: string | null; personId: string | null; proprietaryId?: string | null; branchId?: string | null;
  paymentType?: "single" | "installments" | "recurring" | "advance" | "invoice_group"; recurrenceType?: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  classification?: "unclassified" | "capex" | "opex"; documentType?: string | null; isDeductible?: boolean; isTax?: boolean;
  amount: string; discount?: string; emissionDate: string; dueDate: string; note: string; harvestId?: string | null;
  appropriation?: "direct" | "indirect"; appropriationType?: string | null; apportionment: ApportionmentLine[]; sourceType?: string; sourceId?: string;
  plan?: InstallmentPlan | null;
  /**
   * OPERACOES-01 F7 (decisão 284): as parcelas EXPLÍCITAS (as duplicatas da nota guardadas na compra), na ordem —
   * vencimento e valor de cada uma. A soma é EXATAMENTE `amount` (senão 422); não anda com `plan` (quem chama manda
   * um ou outro — os dois juntos é erro de programação). Ausente ou vazia = a conta de hoje (`plan` ou parcela única).
   */
  parcelas?: readonly { dueDate: string; amount: string }[] | null;
  /**
   * OPERACOES-01 F9 (decisão 286), todos opcionais — ausentes = o título de hoje. `tipoOperacaoId` e
   * `tipoOperacaoVersaoId` andam em PAR (a TOP e a versão de origem; o CHECK da 0045 recusa um sem o outro) e vão em
   * TODAS as parcelas. `contaPrevistaId` é a conta prevista do fluxo (0042), já conferida por quem chama.
   */
  tipoOperacaoId?: string | null;
  tipoOperacaoVersaoId?: string | null;
  contaPrevistaId?: string | null;
  /**
   * O título PREVISTO da provisão pela TOP (situação `previsto`, fora das baixas e das listas padrão; o banco o guarda
   * pela 0045). Só a provisão de um DOCUMENTO o cria (origem obrigatória pelo CHECK). Previsão não é lançamento
   * realizado: NÃO passa pelo congelamento do período (congelar o mês não impede salvar o pedido que provisiona).
   */
  previsto?: boolean;
}

/**
 * As parcelas de um título — valor e vencimento de cada uma. É a conta que `createTitles` grava; a prévia da
 * confirmação de venda (VENDAS-A5-1) lê daqui o PRIMEIRO vencimento em vez de repetir a regra do parcelamento
 * (entrada, intervalo, dia fixo), que envelheceria em silêncio na primeira mudança dela.
 */
export function parcelasDoTitulo(input: Pick<TitleInput, "amount" | "dueDate" | "plan" | "parcelas">) {
  const total = money(input.amount);
  if (input.parcelas?.length) {
    if (input.plan) throw new Error("parcelasDoTitulo: parcelas explícitas e plano de parcelamento juntos");
    const soma = input.parcelas.reduce((a, p) => a.plus(D(p.amount)), D(0));
    if (!soma.eq(D(total))) throw validation("As parcelas não fecham o valor do título", [{ path: "parcelas", message: "As parcelas não fecham o valor do título" }]);
    return input.parcelas.map((p, i) => ({ number: i + 1, dueDate: p.dueDate, amount: money(p.amount), isDownPayment: false }));
  }
  return input.plan && (input.plan.installments > 1 || input.plan.has_down_payment)
    ? buildInstallments({ totalAmount: total, installments: input.plan.installments, firstDueDate: input.plan.first_due_date, mode: input.plan.mode, intervalDays: input.plan.interval_days, dueDay: input.plan.due_day, hasDownPayment: input.plan.has_down_payment, downPaymentValue: input.plan.down_payment_value !== undefined ? String(input.plan.down_payment_value) : undefined, downPaymentDate: input.plan.down_payment_date })
    : [{ number: 1, dueDate: input.dueDate, amount: total, isDownPayment: false }];
}

/**
 * RATEIO SÓ EM ANALÍTICO (CADASTROS Fase 7 e R1-5, decisão 256): natureza e centro de resultado sintéticos
 * agrupam, não recebem lançamento. TODO id do rateio precisa existir NESTA organização, estar vivo (sem
 * `deleted_at`), ATIVO e ser analítico. Inexistente, de outra organização, excluído, inativo e sintético caem
 * na MESMA recusa, com a MESMA mensagem: distinguir seria um oráculo de existência sobre o cadastro vizinho.
 *
 * A CONTA CONTÁBIL da linha (opcional) é conferida só quanto ao TENANT e à vida: existir nesta organização e
 * não estar excluída. A FK `chart_account_id` é de coluna única — não prova a organização —, e sem esta
 * conferência um título de A gravaria a conta de B. Situação ativa e analítico da conta NÃO são conferidos:
 * a tela oferece qualquer conta do plano, e exigi-los é regra de produto em aberto (decisão 256 (4)(c)).
 *
 * `for share` (como a venda, `validarClassificacaoFinanceira`): as linhas lidas ficam travadas contra
 * alteração até o fim da transação — uma inativação ou uma troca para sintético concorrente espera o lançamento
 * terminar, em vez de commitar entre a conferência e a gravação. Uma consulta por cadastro para o rateio
 * inteiro (sem N+1; `for share` não combina com `union`).
 *
 * Vale para rateio NOVO (título, movimento, NF, entrada, venda — criação e edição). A BAIXA não passa por aqui:
 * ela copia o rateio JÁ GRAVADO no título para o movimento (`BankMovementInput.rateioJaGravado`), e valor que
 * não muda não é reconferido (decisão 256). Reconferir travaria o título em aberto cuja natureza ou centro foi
 * inativado, excluído (sem volta pela API) ou é sintético do acervo — com o período da emissão fechado, nem o
 * rateio nem o cancelamento do título teriam conserto.
 */
export const MENSAGEM_RATEIO_NATUREZA = "Natureza sintética ou inativa não recebe lançamento. Escolha uma natureza analítica e ativa.";
export const MENSAGEM_RATEIO_CENTRO = "Centro de resultado sintético ou inativo não recebe lançamento. Escolha um centro de resultado analítico e ativo.";
export const MENSAGEM_RATEIO_CONTA = "Conta contábil não encontrada no plano de contas. Escolha outra conta contábil.";
/** Linha de rateio que se confere: a conta contábil é chave OBRIGATÓRIA do tipo (mesmo nula), para nenhum chamador esquecê-la. */
export type LinhaDeRateioConferida = Pick<ApportionmentLine, "financialCategoryId" | "costCenterId"> & { chartAccountId: string | null | undefined };
export async function exigirRateioAnalitico(ctx: ServiceCtx, lines: readonly LinhaDeRateioConferida[]): Promise<void> {
  const conferir = async (tabela: "financial_categories" | "cost_centers" | "chart_accounts", ids: string[], campo: string, message: string) => {
    if (!ids.length) return;
    // whitelist estática: a tabela nunca vem da entrada. A conta só confere tenant e vida (ver acima).
    const situacao = tabela === "chart_accounts" ? "" : " and is_active and kind='analytic'";
    const r = await ctx.tx.query<{ id: string }>(
      `select id::text as id from erp.${tabela} where organization_id=$1 and id = any($2::uuid[]) and deleted_at is null${situacao} for share`,
      [ctx.orgId, ids]);
    const ok = new Set(r.rows.map((x) => x.id));
    if (ids.some((x) => !ok.has(x))) throw validation(message, [{ path: ["apportionment", campo], message }]);
  };
  await conferir("financial_categories", [...new Set(lines.map((l) => l.financialCategoryId))], "financial_category_id", MENSAGEM_RATEIO_NATUREZA);
  await conferir("cost_centers", [...new Set(lines.map((l) => l.costCenterId))], "cost_center_id", MENSAGEM_RATEIO_CENTRO);
  await conferir("chart_accounts", [...new Set(lines.flatMap((l) => (l.chartAccountId ? [l.chartAccountId] : [])))], "chart_account_id", MENSAGEM_RATEIO_CONTA);
}
/** As linhas do rateio de domínio no formato da conferência (a conta contábil, opcional no domínio, vira chave explícita). */
const linhasConferidas = (lines: readonly ApportionmentLine[]): LinhaDeRateioConferida[] =>
  lines.map((l) => ({ financialCategoryId: l.financialCategoryId, costCenterId: l.costCenterId, chartAccountId: l.chartAccountId }));

/** Cria título(s) financeiro(s) com rateio; se houver plano de parcelamento, cria uma linha por parcela (group_id comum). */
export async function createTitles(ctx: ServiceCtx, input: TitleInput): Promise<{ ids: string[]; groupId: string | null }> {
  if (!input.previsto) await assertPeriodOpen(ctx.tx, ctx.orgId, input.empresaId, input.emissionDate);
  const semTop = !input.tipoOperacaoId; const semVersao = !input.tipoOperacaoVersaoId;
  if (semTop !== semVersao) throw validation("A TOP e a versão do título andam juntas");
  const total = money(input.amount);
  if (D(total).lte(0)) throw validation("Valor do título deve ser positivo");
  await exigirRateioAnalitico(ctx, linhasConferidas(input.apportionment));
  const lines = normalizeApportionment(money(D(total).minus(input.discount ?? 0)), input.apportionment);
  const parts = parcelasDoTitulo(input);
  const groupId = parts.length > 1 ? (await ctx.tx.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id : null;
  const ids: string[] = [];
  const count = parts.length;
  for (const [i, p] of parts.entries()) {
    const code = await nextCode(ctx.tx, ctx.orgId, `title_${input.direction}`, 4);
    const discount = i === parts.length - 1 ? money(input.discount ?? 0) : "0.00";
    const r = await ctx.tx.query<{ id: string }>(
      `insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,title_type_id,proprietary_id,person_id,branch_id,payment_type,recurrence_type,classification,document_type,is_deductible,is_tax,amount,discount,emission_date,due_date,installment_number,installment_count,group_id,appropriation,appropriation_type,note,harvest_id,source_type,source_id,created_by,tipo_operacao_id,tipo_operacao_versao_id,conta_prevista_id,status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) returning id`,
      [ctx.orgId, input.empresaId, code, input.direction, count > 1 ? `${input.number}-${p.isDownPayment ? "E" : p.number}` : input.number, input.titleTypeId ?? null, input.proprietaryId ?? null, input.personId, input.branchId ?? null,
        input.paymentType ?? (count > 1 ? "installments" : "single"), input.recurrenceType ?? null, input.classification ?? "unclassified", input.documentType ?? null, input.isDeductible ?? false, input.isTax ?? false,
        p.amount, discount, input.emissionDate, p.dueDate, p.isDownPayment ? 0 : p.number, count, groupId, input.appropriation ?? "direct", input.appropriationType ?? null, input.note, input.harvestId ?? null, input.sourceType ?? null, input.sourceId ?? null, ctx.user.id,
        input.tipoOperacaoId ?? null, input.tipoOperacaoVersaoId ?? null, input.contaPrevistaId ?? null, input.previsto ? "previsto" : "open"]);
    const id = r.rows[0]!.id; ids.push(id);
    await atribuirIdGlobal(ctx, "financial_titles", id);
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
  empresaId: string | null; bankAccountId: string; date: string; type: "in" | "out"; categoryType?: string; amount: string; interest?: string; document?: string | null; note?: string | null;
  proprietaryId?: string | null; personId?: string | null; harvestId?: string | null; isDeductible?: boolean; generatesObligation?: boolean; sourceType?: string; sourceId?: string; destinationAccountId?: string | null;
  apportionment?: ApportionmentLine[];
  /**
   * O rateio é a CÓPIA do rateio já gravado num título (baixa): não passa por `exigirRateioAnalitico`, que é a
   * regra da classificação NOVA. Só a baixa liga isto; rateio vindo do cliente nunca.
   */
  rateioJaGravado?: boolean;
  /**
   * Rótulo da transferência entre contas (OPERACOES-01 F8, decisão 285): transferencia, deposito, saque, aplicacao,
   * resgate. Só vale em `internal_transfer` (CHECK da 0042) e é gravado nas DUAS pontas. Nulo = como hoje.
   */
  tipoTransferencia?: "transferencia" | "deposito" | "saque" | "aplicacao" | "resgate" | null;
  /**
   * O imóvel rural do LCDPR (OPERACOES-01 F9, decisão 286; `lib/imovel-rural.ts`): ausente = o imóvel PADRÃO da empresa
   * quando o movimento é de entrada ou saída e tem empresa (empresa sem padrão → nenhum, como antes); `null` = nenhum;
   * um id = conferido contra a empresa do movimento. Transferência e saldo inicial recusam o informado; o PAR da
   * transferência nunca leva imóvel.
   */
  imovelRuralId?: string | null;
  /** A TOP e a versão do movimento (família do movimento bancário), em par; ausentes = sem TOP, como hoje. */
  tipoOperacaoId?: string | null;
  tipoOperacaoVersaoId?: string | null;
}

/**
 * A CONTA DESTINO da transferência vem do corpo e é gravada numa FK de COLUNA ÚNICA (`destination_account_id`) e no
 * movimento-par: sem esta conferência, um id de outra organização, excluído ou inativo virava a outra ponta de uma
 * transferência (OPERACOES-01 F8, o defeito "transferência sem validar a conta destino"). Inexistente, de outra
 * organização, excluída e inativa caem na MESMA recusa: distinguir seria um oráculo de existência sobre o vizinho.
 */
export const MENSAGEM_CONTA_DESTINO_INVALIDA = "Conta destino inválida";
export const MENSAGEM_CONTAS_IGUAIS = "Conta de origem e destino iguais";
export async function createBankMovement(ctx: ServiceCtx, i: BankMovementInput): Promise<string> {
  await assertPeriodOpen(ctx.tx, ctx.orgId, i.empresaId, i.date);
  const acc = await ctx.tx.query<{ is_active: boolean }>("select is_active from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null", [i.bankAccountId, ctx.orgId]);
  if (!acc.rows[0]) throw validation("Conta bancária inválida"); if (!acc.rows[0].is_active) throw validation("Conta bancária inativa");
  if (i.destinationAccountId) {
    if (i.destinationAccountId.toLowerCase() === i.bankAccountId.toLowerCase()) throw validation(MENSAGEM_CONTAS_IGUAIS, [{ path: ["destination_account_id"], message: MENSAGEM_CONTAS_IGUAIS }]);
    const destino = await ctx.tx.query("select 1 from erp.bank_accounts where id=$1 and organization_id=$2 and deleted_at is null and is_active", [i.destinationAccountId, ctx.orgId]);
    if (destino.rowCount !== 1) throw validation(MENSAGEM_CONTA_DESTINO_INVALIDA, [{ path: ["destination_account_id"], message: MENSAGEM_CONTA_DESTINO_INVALIDA }]);
  }
  const tipoTransferencia = i.tipoTransferencia ?? null;
  if (tipoTransferencia && i.categoryType !== "internal_transfer") throw validation("O tipo de transferência só vale em transferência entre contas");
  if (!i.tipoOperacaoId !== !i.tipoOperacaoVersaoId) throw validation("A TOP e a versão do movimento andam juntas");
  const imovelRuralId = await resolverImovelDoMovimento(ctx, { pedido: i.imovelRuralId, empresaId: i.empresaId, categoria: i.categoryType ?? i.type });
  const code = await nextCode(ctx.tx, ctx.orgId, "bank_movement", 5);
  const r = await ctx.tx.query<{ id: string }>(
    "insert into erp.bank_movements(organization_id,empresa_id,code,bank_account_id,movement_date,type,category_type,destination_account_id,amount,interest,document,generates_obligation,is_deductible,note,proprietary_id,person_id,harvest_id,source_type,source_id,created_by,tipo_transferencia,imovel_rural_id,tipo_operacao_id,tipo_operacao_versao_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning id",
    [ctx.orgId, i.empresaId, code, i.bankAccountId, i.date, i.type, i.categoryType ?? i.type, i.destinationAccountId ?? null, money(i.amount), money(i.interest ?? 0), i.document ?? null, i.generatesObligation ?? false, i.isDeductible ?? false, i.note ?? null, i.proprietaryId ?? null, i.personId ?? null, i.harvestId ?? null, i.sourceType ?? null, i.sourceId ?? null, ctx.user.id, tipoTransferencia,
      imovelRuralId, i.tipoOperacaoId ?? null, i.tipoOperacaoVersaoId ?? null]);
  const id = r.rows[0]!.id;
  await atribuirIdGlobal(ctx, "bank_movements", id);
  if (i.apportionment?.length && !i.rateioJaGravado) await exigirRateioAnalitico(ctx, linhasConferidas(i.apportionment));
  if (i.apportionment?.length) for (const l of normalizeApportionment(money(i.amount), i.apportionment)) await ctx.tx.query("insert into erp.bank_movement_apportionments(movement_id,financial_category_id,chart_account_id,cost_center_id,harvest_id,percentage,amount) values ($1,$2,$3,$4,$5,$6,$7)", [id, l.financialCategoryId, l.chartAccountId, l.costCenterId, l.harvestId, l.percentage, l.amount]);
  // transferência interna: cria o par na conta destino
  if (i.categoryType === "internal_transfer" && i.destinationAccountId) {
    const pair = await ctx.tx.query<{ id: string }>("insert into erp.bank_movements(organization_id,empresa_id,code,bank_account_id,movement_date,type,category_type,destination_account_id,transfer_pair_id,amount,document,note,proprietary_id,source_type,source_id,created_by,tipo_transferencia) values ($1,$2,$3,$4,$5,$6,'internal_transfer',$7,$8,$9,$10,$11,$12,'bank_movement',$8,$13,$14) returning id",
      [ctx.orgId, i.empresaId, await nextCode(ctx.tx, ctx.orgId, "bank_movement", 5), i.destinationAccountId, i.date, i.type === "out" ? "in" : "out", i.bankAccountId, id, money(i.amount), i.document ?? null, i.note ?? null, i.proprietaryId ?? null, ctx.user.id, tipoTransferencia]);
    // O PAR da transferência interna é outro movimento bancário com identidade própria: ele aparece no
    // extrato da conta de destino e tem tela própria. Efeito colateral também é registro, e recebe número.
    await atribuirIdGlobal(ctx, "bank_movements", pair.rows[0]!.id);
    // ROW COUNT SOB RLS: o movimento de origem acabou de nascer nesta transação; zero linha aqui seria um par
    // sem volta (a origem sem `transfer_pair_id`) gravado como sucesso.
    const ligado = await ctx.tx.query("update erp.bank_movements set transfer_pair_id=$2 where id=$1 and organization_id=$3", [id, pair.rows[0]!.id, ctx.orgId]);
    if (ligado.rowCount !== 1) throw new DomainError("NOT_FOUND", "Movimento não encontrado");
  }
  return id;
}
