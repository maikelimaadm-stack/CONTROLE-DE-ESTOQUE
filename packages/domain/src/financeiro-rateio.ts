import { D, DomainError, money, sum, type Decimal } from "@agro/shared";

/** Lê um valor de rateio; vazio ou texto que não é número não vira zero em silêncio. */
function valorDaLinha(v: string | number | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") throw new DomainError("VALIDATION_ERROR", "Informe o valor de cada linha do rateio");
  try {
    return D(v);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Informe o valor de cada linha do rateio");
  }
}

/** Quanto falta (positivo) ou sobra (negativo) para o rateio fechar no total: `total − Σ valores`, 2 casas. */
export function diferencaDoRateio(total: string, valores: readonly (string | number)[]): string {
  return money(D(total).minus(sum([...valores])));
}

/**
 * O rateio em R$ tem de fechar EXATAMENTE no total (diferença zero) — sem a tolerância de R$ 0,05 do
 * `normalizeApportionment`, que joga a sobra na última linha: no lançamento novo o usuário vê a diferença e decide.
 * Os valores da mensagem e dos detalhes vão com ponto decimal; quem formata para a tela é a web.
 */
export function exigirRateioFechado(total: string, linhas: readonly { amount?: string | number | null }[]): void {
  const valores = linhas.map((l) => valorDaLinha(l.amount));
  const t = D(total);
  const soma = sum(valores);
  const diferenca = t.minus(soma);
  if (diferenca.isZero()) return;
  throw new DomainError(
    "APPORTIONMENT_MISMATCH",
    `O rateio soma R$ ${money(soma)} e o título vale R$ ${money(t)}: ajuste R$ ${money(diferenca.abs())} para fechar.`,
    { total: money(t), soma: money(soma), diferenca: money(diferenca) }
  );
}

/**
 * Escala os valores da base ao `total`, mantendo a proporção de cada linha (juros, multa e acréscimo da baixa
 * herdam os centros e safras do título; o movimento único do lote junta os rateios dos títulos). Cada linha com
 * 2 casas (`money`, meio-para-par) e o resíduo de arredondamento na ÚLTIMA linha: a soma é exatamente o total.
 */
export function ratearPorProporcao<T extends { amount: string }>(total: string, base: readonly T[]): (T & { amount: string })[] {
  if (!base.length) throw new DomainError("VALIDATION_ERROR", "Rateio base vazio");
  const somaBase = sum(base.map((l) => l.amount));
  if (somaBase.isZero()) throw new DomainError("VALIDATION_ERROR", "Rateio base vazio");
  const t = D(total);
  if (t.isZero()) return base.map((l) => ({ ...l, amount: money(0) }));
  const out: (T & { amount: string })[] = [];
  let acumulado = D(0);
  base.forEach((l, i) => {
    const valor = i === base.length - 1 ? money(t.minus(acumulado)) : money(t.mul(D(l.amount)).div(somaBase));
    acumulado = acumulado.plus(D(valor));
    out.push({ ...l, amount: valor });
  });
  return out;
}
