import { PURCHASE_STATUS_LABELS } from "./supply-workflow.js";
import { TITLE_STATUS_LABELS } from "./financial.js";
import { ACTION_LABELS } from "./permissions.js";

/**
 * Rótulos PT-BR dos valores técnicos (enums) que chegam do banco/API e são exibidos ao usuário.
 * Fonte única (docs/UI-STANDARD.md, "Idioma e terminologia"): valor interno ≠ rótulo exibido.
 * A função de apresentação (`enumLabel`) nunca devolve o valor cru: vazio → "Não informado";
 * valor sem rótulo → "Desconhecido". Cada domínio mantém o seu contexto (um `open` de título é
 * "A vencer"; um `open` de documento é "Aberto") — não existe um mapa universal.
 */
export const NOT_INFORMED = "Não informado";
export const UNKNOWN_VALUE = "Desconhecido";

/** Situação genérica de documentos/registros (StatusBadge, colunas "Situação", DetailShell). */
const STATUS: Record<string, string> = {
  confirmed: "Confirmado", cancelled: "Cancelado", pending: "Pendente", draft: "Rascunho", reversed: "Estornado", open: "Aberto",
  paid: "Baixado", partially_paid: "Baixa parcial", settled: "Quitado", finished: "Finalizado", signed: "Assinado", awaiting_signature: "Aguardando assinatura",
  approved: "Aprovado", rejected: "Reprovado", not_approved: "Não aprovado", converted: "Convertido", invoiced: "Faturado", in_progress: "Em andamento", evaluated: "Avaliado",
  scheduled: "Agendada", done: "Realizada", active: "Ativo", inactive: "Inativo", closed: "Encerrado", expired: "Vencido", archived: "Arquivado",
  sold: "Vendido", dead: "Morto", lost: "Perdido", transferred: "Transferido", inventoried: "Inventariado", written_off: "Baixado",
  imported: "Importado", reconciling: "Conciliando", reconciled: "Conciliado", matched: "Conciliado", launched: "Lançado", ignored: "Ignorado",
  financial_generated: "Financeiro gerado", under_review: "Em análise", queued: "Na fila", running: "Em execução", failed: "Falhou",
  // etapas do processo de compra (rótulo curto; a tela de Compras usa `purchase_status`)
  request: "Solicitação", awaiting_awareness: "Aguardando ciência", quotation_in_progress: "Cotação em andamento", awaiting_approval: "Aguardando aprovação",
  awaiting_purchase: "Aguardando a compra", purchase_done: "Compra efetuada", purchase_received: "Compra recebida"
};

export const ENUM_LABELS = {
  status: STATUS,
  purchase_status: PURCHASE_STATUS_LABELS as Record<string, string>,
  /** Situação persistida do título (a exibida na lista deriva da data — `displayTitleStatus`). */
  title_status: { ...TITLE_STATUS_LABELS, overdue: "Vencida" } as Record<string, string>,
  payment_type: { single: "À vista", installments: "Parcelado", recurring: "Recorrente", advance: "Adiantamento", invoice_group: "Fatura" },
  recurrence_type: { weekly: "Semanal", monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual" },
  classification: { unclassified: "Não classificado", capex: "CAPEX", opex: "OPEX" },
  appropriation: { direct: "Direta", indirect: "Indireta" },
  direction: { payable: "A pagar", receivable: "A receber" },
  settlement_kind: { bank_movement: "Movimento bancário", cross_settlement: "Encontro de contas", advance_compensation: "Compensação de adiantamento" },
  bank_category_type: { in: "Entrada", out: "Saída", internal_transfer: "Transferência interna", financing: "Financiamento", check_return: "Devolução de cheque", opening_balance: "Saldo inicial" },
  bank_movement_type: { in: "Entrada", out: "Saída" },
  bank_account_type: { checking: "Corrente", savings: "Poupança", investment: "Investimento", cash: "Caixa" },
  /** Origem de um lançamento gerado por outro módulo (bank_movements.source_type, stock_movements.source_type). */
  source_type: { manual: "Manual", ofx: "Conciliação OFX", opening_movement: "Saldo inicial", opening_balances: "Estoque inicial", title_settlements: "Baixa de título", title_settlement_batch: "Baixa de títulos em lote", bank_movements: "Movimento bancário", invoices: "Documento fiscal", dfe_documents: "DFe recebida", sales_documents: "Venda", purchase_requests: "Solicitação de compra", animal_movements: "Movimentação do rebanho", animal_handlings: "Manejo", warehouse_transfers: "Transferência de armazém", input_entries: "Entrada de insumos", requisitions: "Requisição", devolutions: "Devolução", stock_writeoffs: "Baixa de estoque", stock_corrections: "Ajuste de estoque", feed_batches: "Produção de ração", diet_batches: "Dieta", fuel_supplies: "Abastecimento", maintenances: "Manutenção", service_orders: "Ordem de serviço", earnings: "Folha de pagamento", salary_advances: "Adiantamento salarial" },
  document_type: { nfe: "NF-e", cte: "CT-e", nfse: "NFS-e", nfce: "NFC-e", danfe: "DANFE", darf: "DARF", dare: "DARE", gru: "GRU", other: "Outro" },
  /** Origem do registro (documentos fiscais, abastecimentos). */
  origin: { manual: "Manual", xml: "XML importado", dfe: "DFe recebida", purchase_request: "Solicitação de compra", cta_smart: "CTA Smart", import: "Importação" },
  manifest_status: { none: "Não manifestada", awareness: "Ciência", confirmed: "Confirmada", unknown: "Desconhecimento", not_performed: "Não realizada" },
  launch_status: { pending: "Pendente", draft: "Rascunho (aprovação)", launched: "Lançada", ignored: "Ignorada" },
  invoice_destination: { product_invoice: "Nota de produto", expense_invoice: "Nota de despesa", animal_invoice: "Nota de animal" },
  apportionment_type: { by_product: "Por produto", by_value: "Por valor" },
  stock_movement_type: { opening_balance: "Estoque inicial", entry: "Entrada/insumos", invoice_entry: "Documento fiscal", receipt: "Recebimento", devolution: "Devolução", requisition: "Requisição", writeoff: "Baixa", correction_in: "Correção (+)", correction_out: "Correção (−)", transfer_out: "Transferência (saída)", transfer_in: "Transferência (entrada)", farm_transfer_out: "Transferência entre fazendas (saída)", farm_transfer_in: "Transferência entre fazendas (entrada)", sale: "Venda", production_in: "Produção (entrada)", production_out: "Produção (consumo)", maintenance: "Manutenção", fuel_supply: "Abastecimento", nutrition: "Nutrição/Sanitário", reversal: "Estorno" },
  stock_direction: { "1": "Entrada", "-1": "Saída" },
  transfer_kind: { warehouse: "Entre armazéns", farm: "Entre fazendas" },
  writeoff_reason: { loss: "Perda", deterioration: "Deterioração", theft: "Roubo", damage: "Avaria", inventory: "Inventário", accounting: "Contabilização", burglary: "Furto", expiration: "Prazo de validade", gift: "Brinde", donation: "Doação", consumption: "Consumo", other: "Outro" },
  request_type: { product: "Produto", service: "Serviço", advance: "Adiantamento", refund: "Reembolso", daily: "Diária", contract: "Contrato", finished_product: "Produto acabado" },
  priority: { low: "Baixa", medium: "Média", high: "Alta" },
  decision: { approved: "Aprovada", rejected: "Reprovada", awareness: "Ciência" },
  sales_kind: { budget: "Orçamento", order: "Pedido", sale: "Venda" },
  animal_movement_type: { purchase: "Compra", sale: "Venda", birth: "Nascimento", death: "Morte", loss: "Perda/desaparecimento", animal_batch_transfer: "Transferência de animais → lote", batch_transfer: "Transferência de animais → lote", batch_grouping: "Agrupamento de lotes", batch_module_area_transfer: "Transferência de lote → módulo/área", module_area_transfer: "Transferência de lote → módulo/área", farm_transfer: "Transferência entre fazendas", evolution: "Evolução de categoria", weaning: "Desmama", separation: "Apartação", inventory: "Inventário", processing: "Processamento" },
  handling_type: { nutrition: "Nutrição", sanitary: "Sanitário", weaning: "Desmama", separation: "Apartação", pasture: "Manejo de pastagem", locate: "Localização" },
  sex: { M: "Macho", F: "Fêmea" },
  reproductive_status: { pregnant: "Prenha", empty: "Vazia", calved: "Parida" },
  reproductive_stage: { lactation: "Lactação", multiparous: "Multípara", heifer: "Novilha", nulliparous: "Nulípara", primiparous: "Primípara" },
  diagnosis_result: { pending: "Pendente", pregnant: "Prenha", empty: "Vazia" },
  mating_type: { natural: "Monta natural", ai: "Inseminação artificial (IA)", fta: "IATF", embryo_transfer: "Transferência de embrião (TE)" },
  herd_control: { individual: "Individual", batch: "Por lote" },
  trigger_type: { hours: "Horas", km: "Km", days: "Dias" },
  equipment_type: { own: "Próprio", outsourced: "Terceirizado" },
  os_section: { labor: "Mão de obra", machine: "Equipamentos", input: "Insumos", ppe: "EPIs", production: "Produção" },
  hr_event_kind: { absence: "Falta", justified: "Falta justificada", half_day: "Meio período", delay: "Atraso" },
  notification_kind: { purchase_pending: "Compras pendentes", stock_min: "Estoque mínimo", title_due: "Títulos a vencer", birthday: "Aniversário", document_expiring: "Documento vencendo" },
  /** Ações registradas na auditoria: as ações de permissão (Visualizar, Criar, …) mais as operações internas. */
  audit_action: { ...ACTION_LABELS, create: "Criação", update: "Alteração", delete: "Exclusão", login: "Acesso", logout: "Saída", reject: "Reprovação", reverse: "Estorno", sign: "Assinatura", read: "Leitura", restore: "Restauração", cancel: "Cancelamento", approve: "Aprovação", transfer: "Transferência", settle: "Baixa", process: "Processamento", manifest: "Manifestação", launch: "Lançamento", ignore: "Ignorado", duplicate: "Duplicação", import: "Importação", export: "Exportação" },
  yes_no: { true: "Sim", false: "Não" }
} as const satisfies Record<string, Record<string, string>>;

export type EnumDomain = keyof typeof ENUM_LABELS;

/** Rótulo PT-BR de um valor técnico. Nunca devolve o valor cru. */
export function enumLabel(domain: EnumDomain, value: unknown): string {
  if (value === null || value === undefined || value === "") return NOT_INFORMED;
  const map = ENUM_LABELS[domain] as Record<string, string>;
  const key = String(value);
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : UNKNOWN_VALUE;
}

/** Opções `{ value, label }` de um domínio (filtros e seletores), na ordem declarada ou na ordem de `keys`. */
export function enumOptions(domain: EnumDomain, keys?: readonly string[]): { value: string; label: string }[] {
  const map = ENUM_LABELS[domain] as Record<string, string>;
  return (keys ?? Object.keys(map)).map((value) => ({ value, label: map[value] ?? UNKNOWN_VALUE }));
}

/** Indica se o domínio conhece o valor (útil para escolher entre rótulo e texto livre). */
export function hasEnumLabel(domain: EnumDomain, value: unknown): boolean {
  return value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(ENUM_LABELS[domain], String(value));
}
