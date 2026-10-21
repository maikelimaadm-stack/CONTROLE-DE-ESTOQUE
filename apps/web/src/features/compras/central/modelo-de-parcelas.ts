/**
 * SSOT do cronograma de pagamento na Central de Compras (COMPRAS-UX-CONSISTENCIA-01).
 *
 * Fonte preferida (persistida, nesta ordem):
 *   1. `parcelas[]` do plano (lista manual / gravada);
 *   2. `parcelas_nota` (duplicatas da NF-e — compra importada);
 *   3. títulos gerados (consulta confirmada) — só leitura, com situação;
 *   4. plano descritivo sem lista → resumo honesto, sem inventar datas.
 *
 * `installments` no plano = parcelas ALÉM da entrada (`buildInstallments`). A lista pode incluir a entrada
 * como primeira linha quando `has_down_payment`.
 */

export type LinhaDeParcelaNaTela = {
  vencimento: string;
  valor: string;
  observacao: string;
  entrada: boolean;
  /** Origem da linha — não inventar data/valor a partir de “hoje”. */
  origem: "plano" | "nota" | "titulo" | "resumo";
  situacaoTitulo?: string;
};

export type ModeloDeParcelasNaTela =
  | { especie: "lista"; linhas: LinhaDeParcelaNaTela[]; comEntrada: boolean }
  | { especie: "resumo"; texto: string; comEntrada: boolean; installments: number | null; primeiroVencimento: string | null }
  | { especie: "vazio" };

type ParcelaCrua = { vencimento?: unknown; valor?: unknown; observacao?: unknown; dueDate?: unknown; amount?: unknown; note?: unknown; isDownPayment?: unknown; entrada?: unknown };
type TituloCru = { due_date?: unknown; amount?: unknown; note?: unknown; installment_number?: unknown; status?: unknown; situacao?: unknown };

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const tem = (v: unknown) => v !== null && v !== undefined && v !== "";

function listaDoPlano(plano: unknown): ParcelaCrua[] | null {
  if (plano === null || typeof plano !== "object" || Array.isArray(plano)) return null;
  const parcelas = (plano as { parcelas?: unknown }).parcelas;
  return Array.isArray(parcelas) && parcelas.length ? parcelas as ParcelaCrua[] : null;
}

function listaDaNota(parcelasNota: unknown): ParcelaCrua[] | null {
  if (!Array.isArray(parcelasNota) || !parcelasNota.length) return null;
  return parcelasNota as ParcelaCrua[];
}

function planoTemEntrada(plano: unknown): boolean {
  if (plano === null || typeof plano !== "object" || Array.isArray(plano)) return false;
  return (plano as { has_down_payment?: unknown }).has_down_payment === true;
}

function linhaDe(p: ParcelaCrua, k: number, comEntrada: boolean, origem: LinhaDeParcelaNaTela["origem"]): LinhaDeParcelaNaTela {
  const entrada = p.entrada === true || p.isDownPayment === true || (comEntrada && k === 0);
  return {
    vencimento: texto(p.vencimento ?? p.dueDate),
    valor: texto(p.valor ?? p.amount),
    observacao: texto(p.observacao ?? p.note),
    entrada,
    origem
  };
}

/**
 * Resolve o que a tela de Financeiro deve mostrar — criação/edição/consulta usam a mesma conta.
 */
export function modeloDeParcelasParaTela(entrada: {
  plano?: unknown;
  parcelasNota?: unknown;
  titulos?: readonly TituloCru[] | null;
  /** Compra já confirmada: preferir títulos reais quando existirem. */
  preferirTitulos?: boolean;
}): ModeloDeParcelasNaTela {
  const titulos = entrada.titulos?.filter((t) => tem(t.due_date) || tem(t.amount)) ?? [];
  if (entrada.preferirTitulos && titulos.length) {
    const linhas = titulos.map((t, k) => {
      const n = typeof t.installment_number === "number" ? t.installment_number : Number(t.installment_number);
      return {
        vencimento: texto(t.due_date),
        valor: texto(t.amount),
        observacao: texto(t.note),
        entrada: n === 0,
        origem: "titulo" as const,
        situacaoTitulo: texto(t.status ?? t.situacao) || undefined
      };
    });
    return { especie: "lista", linhas, comEntrada: linhas.some((l) => l.entrada) };
  }

  const doPlano = listaDoPlano(entrada.plano);
  if (doPlano) {
    const comEntrada = planoTemEntrada(entrada.plano);
    return {
      especie: "lista",
      linhas: doPlano.map((p, k) => linhaDe(p, k, comEntrada, "plano")),
      comEntrada
    };
  }

  const daNota = listaDaNota(entrada.parcelasNota);
  if (daNota) {
    return {
      especie: "lista",
      linhas: daNota.map((p, k) => linhaDe(p, k, false, "nota")),
      comEntrada: false
    };
  }

  if (titulos.length) {
    const linhas = titulos.map((t, k) => {
      const n = typeof t.installment_number === "number" ? t.installment_number : Number(t.installment_number);
      return {
        vencimento: texto(t.due_date),
        valor: texto(t.amount),
        observacao: texto(t.note),
        entrada: n === 0,
        origem: "titulo" as const,
        situacaoTitulo: texto(t.status ?? t.situacao) || undefined
      };
    });
    return { especie: "lista", linhas, comEntrada: linhas.some((l) => l.entrada) };
  }

  if (entrada.plano !== null && typeof entrada.plano === "object" && !Array.isArray(entrada.plano)) {
    const p = entrada.plano as { installments?: unknown; first_due_date?: unknown; has_down_payment?: unknown };
    const n = typeof p.installments === "number" && Number.isInteger(p.installments) ? p.installments : null;
    if (n !== null && n >= 1) {
      return {
        especie: "resumo",
        texto: n === 1 ? "À vista / 1 parcela (plano sem cronograma linha a linha)." : `Parcelado em ${n} parcela(s) além da entrada, sem lista gravada.`,
        comEntrada: p.has_down_payment === true,
        installments: n,
        primeiroVencimento: tem(p.first_due_date) ? texto(p.first_due_date) : null
      };
    }
  }

  return { especie: "vazio" };
}

/** Contagem de parcelas (entrada não conta) — alinhada a `buildInstallments.installments`. */
export const contarParcelasDoModelo = (linhas: readonly { entrada?: boolean }[]) =>
  linhas.filter((l) => !l.entrada).length;
