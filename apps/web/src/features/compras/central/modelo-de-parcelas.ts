/**
 * Projeção de LEITURA do cronograma de pagamento na Central de Compras (COMPRAS-UX-CONSISTENCIA-01).
 *
 * NÃO é a SSOT da edição: a criação/edição continua em `parcelas.tsx` (estado + `buildInstallments` /
 * condição). Esta conta só monta a grade/resumo a partir do documento persistido — a mesma função de
 * domínio `buildInstallments` usada na geração, quando o plano tem dados inequívocos e o total.
 *
 * Fonte preferida (persistida, nesta ordem):
 *   1. `parcelas[]` do plano (lista manual / gravada);
 *   2. derivação inequívoca do plano descritivo via `buildInstallments` (exige total + first_due_date + installments);
 *   3. `parcelas_nota` (duplicatas da NF-e — compra importada);
 *   4. títulos gerados (consulta confirmada) — situação real; observação do título NÃO vem no GET atual;
 *   5. plano descritivo sem dados suficientes → resumo honesto, sem inventar datas/valores.
 *
 * `installments` no plano = parcelas ALÉM da entrada (`buildInstallments`). A lista pode incluir a entrada
 * como primeira linha quando `has_down_payment`.
 */

import { buildInstallments } from "@agro/domain";

export type LinhaDeParcelaNaTela = {
  vencimento: string;
  valor: string;
  observacao: string;
  entrada: boolean;
  /** Origem da linha — não inventar data/valor a partir de “hoje”. */
  origem: "plano" | "plano_derivado" | "nota" | "titulo";
  situacaoTitulo?: string;
  /**
   * Observação do plano (`parcelas[]`), só quando o match por `installment_number` é inequívoco.
   * NÃO é a nota do título (a API de detalhe não devolve `note`).
   */
  observacaoDoPlano?: string;
};

export type ModeloDeParcelasNaTela =
  | {
      especie: "lista";
      linhas: LinhaDeParcelaNaTela[];
      comEntrada: boolean;
      /** Aviso honesto: títulos sem `note` no GET; observações do plano vêm em `observacaoDoPlano` quando há match. */
      avisoObservacaoTitulos?: string;
    }
  | { especie: "resumo"; texto: string; comEntrada: boolean; installments: number | null; primeiroVencimento: string | null }
  | { especie: "vazio" };

type ParcelaCrua = {
  vencimento?: unknown; valor?: unknown; observacao?: unknown;
  dueDate?: unknown; amount?: unknown; note?: unknown;
  isDownPayment?: unknown; entrada?: unknown;
};
type TituloCru = {
  due_date?: unknown; amount?: unknown; note?: unknown;
  installment_number?: unknown; status?: unknown; situacao?: unknown;
};

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

function linhaDe(p: ParcelaCrua, indice: number, comEntrada: boolean, origem: LinhaDeParcelaNaTela["origem"]): LinhaDeParcelaNaTela {
  const entrada = p.entrada === true || p.isDownPayment === true || (comEntrada && indice === 0);
  return {
    vencimento: texto(p.vencimento ?? p.dueDate),
    valor: texto(p.valor ?? p.amount),
    observacao: texto(p.observacao ?? p.note),
    entrada,
    origem
  };
}

type PlanoDescritivo = {
  installments?: unknown;
  first_due_date?: unknown;
  mode?: unknown;
  interval_days?: unknown;
  due_day?: unknown;
  has_down_payment?: unknown;
  down_payment_value?: unknown;
  down_payment_date?: unknown;
};

/**
 * Deriva o cronograma com a MESMA `buildInstallments` do domínio.
 * Só quando o plano tem installments + first_due_date + total positivo inequívocos.
 * Falha ⇒ null (nunca inventa).
 */
export function linhasDerivadasDoPlano(plano: unknown, totalAmount: string | null | undefined): LinhaDeParcelaNaTela[] | null {
  if (plano === null || typeof plano !== "object" || Array.isArray(plano)) return null;
  const p = plano as PlanoDescritivo;
  const n = typeof p.installments === "number" && Number.isInteger(p.installments) ? p.installments : null;
  const first = tem(p.first_due_date) ? texto(p.first_due_date) : "";
  const total = tem(totalAmount) ? String(totalAmount).trim() : "";
  if (n === null || n < 1 || !first || !total) return null;
  const mode = p.mode === "fixed_day" ? "fixed_day" as const : "interval" as const;
  try {
    return buildInstallments({
      totalAmount: total,
      installments: n,
      firstDueDate: first,
      mode,
      intervalDays: typeof p.interval_days === "number" ? p.interval_days : 30,
      dueDay: typeof p.due_day === "number" ? p.due_day : undefined,
      hasDownPayment: p.has_down_payment === true,
      downPaymentValue: tem(p.down_payment_value) ? texto(p.down_payment_value) : undefined,
      downPaymentDate: tem(p.down_payment_date) ? texto(p.down_payment_date) : undefined
    }).map((x) => ({
      vencimento: x.dueDate,
      valor: x.amount,
      observacao: x.isDownPayment ? "Entrada" : "",
      entrada: x.isDownPayment,
      origem: "plano_derivado" as const
    }));
  } catch {
    return null;
  }
}

/** Observação do plano por `installment_number` (0 = entrada), só se o índice existir e for único no sentido do contrato. */
function observacaoDoPlanoPorNumero(parcelas: ParcelaCrua[] | null, installmentNumber: number, comEntrada: boolean): string {
  if (!parcelas?.length) return "";
  if (comEntrada) {
    if (installmentNumber === 0) return texto(parcelas[0]?.observacao ?? parcelas[0]?.note);
    const idx = installmentNumber; // 1 → segunda linha (índice 1)
    return texto(parcelas[idx]?.observacao ?? parcelas[idx]?.note);
  }
  // Sem entrada: installment_number 1 = primeira linha (índice 0)
  const idx = installmentNumber - 1;
  if (idx < 0 || idx >= parcelas.length) return "";
  return texto(parcelas[idx]?.observacao ?? parcelas[idx]?.note);
}

function linhasDosTitulos(
  titulos: readonly TituloCru[],
  parcelasPlano: ParcelaCrua[] | null,
  comEntradaPlano: boolean
): { linhas: LinhaDeParcelaNaTela[]; aviso?: string } {
  let houveObsPlano = false;
  const linhas = titulos.map((t) => {
    const nRaw = typeof t.installment_number === "number" ? t.installment_number : Number(t.installment_number);
    const n = Number.isFinite(nRaw) ? nRaw : NaN;
    const entrada = n === 0;
    const noteTitulo = texto(t.note);
    const obsPlano = Number.isFinite(n) ? observacaoDoPlanoPorNumero(parcelasPlano, n, comEntradaPlano) : "";
    if (obsPlano && !noteTitulo) houveObsPlano = true;
    return {
      vencimento: texto(t.due_date),
      valor: texto(t.amount),
      // GET /compras/:id não seleciona `note` — não fingir observação do título.
      observacao: noteTitulo,
      entrada,
      origem: "titulo" as const,
      situacaoTitulo: texto(t.status ?? t.situacao) || undefined,
      ...(obsPlano && !noteTitulo ? { observacaoDoPlano: obsPlano } : {})
    };
  });
  return {
    linhas,
    aviso: houveObsPlano
      ? "Observações do plano gravado (a API de títulos não devolve a nota do título)."
      : (!titulos.some((t) => tem(t.note))
        ? "Situação e valores dos títulos gerados. A observação do título não vem neste GET."
        : undefined)
  };
}

/**
 * Resolve o que a tela de Financeiro mostra em LEITURA (consulta e projeção).
 * Edição/criação usam `ParcelasDaCriacao` — compartilham `buildInstallments` via `linhasDerivadasDoPlano`.
 */
export function modeloDeParcelasParaTela(entrada: {
  plano?: unknown;
  parcelasNota?: unknown;
  titulos?: readonly TituloCru[] | null;
  /** Total do documento (string decimal) — necessário para derivar cronograma sem `parcelas[]`. */
  totalAmount?: string | null;
  /** Compra já confirmada: preferir títulos reais quando existirem. */
  preferirTitulos?: boolean;
}): ModeloDeParcelasNaTela {
  const titulos = entrada.titulos?.filter((t) => tem(t.due_date) || tem(t.amount)) ?? [];
  const parcelasPlano = listaDoPlano(entrada.plano);
  const comEntradaPlano = planoTemEntrada(entrada.plano);

  if (entrada.preferirTitulos && titulos.length) {
    const { linhas, aviso } = linhasDosTitulos(titulos, parcelasPlano, comEntradaPlano);
    return {
      especie: "lista",
      linhas,
      comEntrada: linhas.some((l) => l.entrada),
      avisoObservacaoTitulos: aviso
    };
  }

  if (parcelasPlano) {
    return {
      especie: "lista",
      linhas: parcelasPlano.map((p, indice) => linhaDe(p, indice, comEntradaPlano, "plano")),
      comEntrada: comEntradaPlano
    };
  }

  const derivadas = linhasDerivadasDoPlano(entrada.plano, entrada.totalAmount);
  if (derivadas?.length) {
    return { especie: "lista", linhas: derivadas, comEntrada: derivadas.some((l) => l.entrada) };
  }

  const daNota = listaDaNota(entrada.parcelasNota);
  if (daNota) {
    return {
      especie: "lista",
      linhas: daNota.map((p, indice) => linhaDe(p, indice, false, "nota")),
      comEntrada: false
    };
  }

  if (titulos.length) {
    const { linhas, aviso } = linhasDosTitulos(titulos, parcelasPlano, comEntradaPlano);
    return {
      especie: "lista",
      linhas,
      comEntrada: linhas.some((l) => l.entrada),
      avisoObservacaoTitulos: aviso
    };
  }

  if (entrada.plano !== null && typeof entrada.plano === "object" && !Array.isArray(entrada.plano)) {
    const p = entrada.plano as PlanoDescritivo;
    const n = typeof p.installments === "number" && Number.isInteger(p.installments) ? p.installments : null;
    if (n !== null && n >= 1) {
      return {
        especie: "resumo",
        texto: n === 1
          ? "À vista / 1 parcela (plano sem cronograma linha a linha e sem total para derivar)."
          : `Parcelado em ${n} parcela(s) além da entrada, sem lista gravada nem total para derivar o cronograma.`,
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
