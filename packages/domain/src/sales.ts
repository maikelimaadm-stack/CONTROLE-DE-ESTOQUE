import { D, DomainError, money, type DecimalString } from "@agro/shared";
export type SalesKind = "budget" | "order" | "sale";
export type SalesStatus = "open" | "approved" | "converted" | "confirmed" | "invoiced" | "cancelled";
const FLOW: Record<SalesKind, SalesKind | null> = { budget: "order", order: "sale", sale: null };
export function nextSalesKind(k: SalesKind): SalesKind { const n = FLOW[k]; if (!n) throw new DomainError("INVALID_STATUS_TRANSITION", "Venda não pode ser convertida"); return n; }
export function assertConvertible(doc: { kind: SalesKind; status: SalesStatus }) {
  if (doc.status === "cancelled") throw new DomainError("ALREADY_CANCELLED", "Documento cancelado");
  if (doc.status === "converted") throw new DomainError("ALREADY_CONFIRMED", "Documento já convertido");
}
export interface SalesItemInput { quantity: DecimalString; unitPrice: DecimalString; discount?: DecimalString; discountPercent?: DecimalString }
/** Total do item = qtd × preço − desconto (valor) − desconto (%) sobre o bruto. */
export function itemTotal(i: SalesItemInput): DecimalString {
  const gross = D(i.quantity).mul(i.unitPrice);
  const pct = gross.mul(D(i.discountPercent ?? 0)).div(100);
  const t = gross.minus(D(i.discount ?? 0)).minus(pct);
  if (t.lt(0)) throw new DomainError("VALIDATION_ERROR", "Desconto maior que o valor do item");
  return money(t);
}
export function documentTotals(items: SalesItemInput[], h: { freight?: DecimalString; freightIcms?: DecimalString; otherValues?: DecimalString; discount?: DecimalString }): { subtotal: DecimalString; total: DecimalString } {
  const subtotal = items.reduce((a, i) => a.plus(itemTotal(i)), D(0));
  const total = subtotal.plus(D(h.freight ?? 0)).plus(D(h.freightIcms ?? 0)).plus(D(h.otherValues ?? 0)).minus(D(h.discount ?? 0));
  if (total.lt(0)) throw new DomainError("VALIDATION_ERROR", "Total negativo");
  return { subtotal: money(subtotal), total: money(total) };
}
