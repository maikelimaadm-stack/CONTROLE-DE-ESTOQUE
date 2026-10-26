import { D } from "@agro/shared";
import type { ItemRow } from "@/features/docs/shared";

/** Bruto da linha (qtd × unitário) em decimal — base do desconto ↔ %. */
export function brutoDaLinha(it: Pick<ItemRow, "quantity" | "unit_value">): ReturnType<typeof D> {
  try {
    return D(it.quantity || "0").times(D(it.unit_value || "0"));
  } catch {
    return D(0);
  }
}

/**
 * Desconto em R$ e % são a MESMA coisa sob dois ângulos (decisão 347).
 * Editar um recalcula o outro; o total da linha usa só o valor em R$.
 */
export function sincronizarDesconto(
  it: ItemRow,
  campo: "discount" | "discount_percent",
  valor: string
): Pick<ItemRow, "discount" | "discount_percent"> {
  const bruto = brutoDaLinha(it);
  const v = valor.trim();
  if (!v) return { discount: "", discount_percent: "" };
  try {
    if (campo === "discount") {
      const pct = bruto.gt(0) ? D(v).times(100).div(bruto).toFixed(4) : "";
      return { discount: v, discount_percent: pct };
    }
    const abs = bruto.gt(0) ? bruto.times(D(v)).div(100).toFixed(2) : "";
    return { discount_percent: v, discount: abs };
  } catch {
    return campo === "discount" ? { discount: v, discount_percent: it.discount_percent ?? "" } : { discount_percent: v, discount: it.discount ?? "" };
  }
}

/** Depois de mudar qtd/unitário: mantém o % e recalcula o R$ (se houver %); senão recalcula o % a partir do R$. */
export function recomputarDescontoAposBruto(it: ItemRow): Pick<ItemRow, "discount" | "discount_percent"> {
  const pct = (it.discount_percent ?? "").trim();
  const abs = (it.discount ?? "").trim();
  if (pct) return sincronizarDesconto(it, "discount_percent", pct);
  if (abs) return sincronizarDesconto(it, "discount", abs);
  return { discount: it.discount ?? "", discount_percent: it.discount_percent ?? "" };
}
