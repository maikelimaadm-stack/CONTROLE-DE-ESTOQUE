/**
 * CONDIÇÃO DE PAGAMENTO (VENDAS-A4, decisão 258) — o MODELO que deriva o plano de parcelas de um documento.
 *
 * A condição é cadastro da organização; o PLANO gravado no documento continua sendo o retrato e a autoridade dos
 * títulos. Esta é a ÚNICA conta que transforma condição em plano: a API grava com ela e a tela mostra com ela —
 * ninguém reescreve a conta em outro lugar. Pura, sem relógio (a data vem do documento): roda na API e no navegador.
 *
 * O plano sai no MESMO formato do `installment_plan` gravado hoje (installmentPlanSchema da API / Plan da web). A
 * função NÃO recusa por valor: total zero ou entrada que não cabe no total continuam recusados onde são hoje
 * (buildInstallments, na confirmação e na prévia), com a mesma mensagem.
 */
import { D, addDays, money, type DecimalString, type ISODate } from "@agro/shared";

export const MODOS_CONDICAO_PAGAMENTO = ["intervalo", "dia_fixo"] as const;
export type ModoCondicaoPagamento = (typeof MODOS_CONDICAO_PAGAMENTO)[number];

export interface CondicaoPagamento {
  /** parcelas SEM contar a entrada, 1..120 */
  parcelas: number;
  /** dias da data do documento até a 1ª parcela, 0..366 (0 = na data do documento) */
  dias_primeira_parcela: number;
  modo: ModoCondicaoPagamento;
  /** 1..366 */
  intervalo_dias: number;
  /** 1..31, só em "dia_fixo" */
  dia_vencimento: number | null;
  entrada: boolean;
  /** > 0 e < 100, até 2 casas, só com entrada */
  entrada_percentual: DecimalString | number | null;
}

/** O plano no formato gravado em erp.sales_documents.installment_plan. */
export interface PlanoDerivado {
  installments: number;
  first_due_date: ISODate;
  mode: "interval" | "fixed_day";
  interval_days: number;
  due_day?: number;
  has_down_payment: boolean;
  down_payment_value?: DecimalString;
  down_payment_date?: ISODate;
}

export interface ErroCondicaoPagamento { caminho: keyof CondicaoPagamento; mensagem: string }

/** O campo que a regra esconde vira null (dia_vencimento fora de "dia_fixo"; entrada_percentual sem entrada). */
export function normalizarCondicaoPagamento<T extends CondicaoPagamento>(c: T): T {
  return { ...c, dia_vencimento: c.modo === "dia_fixo" ? c.dia_vencimento : null, entrada_percentual: c.entrada ? c.entrada_percentual : null };
}

const inteiroEntre = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Regras da condição → erros no campo (vazio = válida). Valida a condição NORMALIZADA. */
export function validarCondicaoPagamento(c: CondicaoPagamento): ErroCondicaoPagamento[] {
  const e: ErroCondicaoPagamento[] = [];
  if (!inteiroEntre(c.parcelas, 1, 120)) e.push({ caminho: "parcelas", mensagem: "Informe de 1 a 120 parcelas (sem contar a entrada)." });
  if (!inteiroEntre(c.dias_primeira_parcela, 0, 366)) e.push({ caminho: "dias_primeira_parcela", mensagem: "Informe de 0 a 366 dias até a 1ª parcela (0 = na data do documento)." });
  if (!(MODOS_CONDICAO_PAGAMENTO as readonly string[]).includes(c.modo)) e.push({ caminho: "modo", mensagem: "Escolha Intervalo em dias ou Dia fixo do mês." });
  if (!inteiroEntre(c.intervalo_dias, 1, 366)) e.push({ caminho: "intervalo_dias", mensagem: "Informe um intervalo de 1 a 366 dias." });
  if (c.modo === "dia_fixo" && !inteiroEntre(c.dia_vencimento, 1, 31)) e.push({ caminho: "dia_vencimento", mensagem: "No Dia fixo, informe o dia do vencimento (1 a 31)." });
  if (c.entrada) {
    const p = c.entrada_percentual;
    let ok = false;
    if (p !== null && p !== undefined && String(p).trim() !== "") {
      try { const d = D(p); ok = d.gt(0) && d.lt(100) && d.decimalPlaces() <= 2; } catch { ok = false; }
    }
    if (!ok) e.push({ caminho: "entrada_percentual", mensagem: "Com entrada, informe o percentual (maior que 0 e menor que 100, até 2 casas)." });
  }
  return e;
}

/** Último dia do mês de uma data ISO. */
function ultimoDiaDoMes(ano: number, mes: number): number { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }

/** O primeiro dia ≥ base cujo dia é `dia` — ou o último dia do mês quando o mês não tem esse dia. */
function primeiroDiaFixo(base: ISODate, dia: number): ISODate {
  let ano = Number(base.slice(0, 4)), mes = Number(base.slice(5, 7));
  const diaBase = Number(base.slice(8, 10));
  for (let i = 0; i < 2; i++) {
    const d = Math.min(dia, ultimoDiaDoMes(ano, mes));
    if (i > 0 || d >= diaBase) return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    mes += 1; if (mes > 12) { mes = 1; ano += 1; }
  }
  /* inalcançável: o segundo mês sempre retorna */
  return base;
}

/**
 * Condição → plano, na data e no total do documento. `condicao` deve estar normalizada e válida.
 *   base = dataDocumento + dias_primeira_parcela
 *   first_due_date = base ("intervalo") | o primeiro dia fixo ≥ base ("dia_fixo")
 *   down_payment_value = total × entrada_percentual / 100 (money(): meio-para-par), na data do documento
 */
export function planoDaCondicao(condicao: CondicaoPagamento, doc: { dataDocumento: ISODate; total: DecimalString | number }): PlanoDerivado {
  const c = normalizarCondicaoPagamento(condicao);
  const base = addDays(doc.dataDocumento, c.dias_primeira_parcela);
  const diaFixo = c.modo === "dia_fixo";
  const plano: PlanoDerivado = {
    installments: c.parcelas,
    first_due_date: diaFixo ? primeiroDiaFixo(base, c.dia_vencimento as number) : base,
    mode: diaFixo ? "fixed_day" : "interval",
    interval_days: c.intervalo_dias,
    has_down_payment: c.entrada
  };
  if (diaFixo) plano.due_day = c.dia_vencimento as number;
  if (c.entrada) {
    plano.down_payment_value = money(D(doc.total).times(D(c.entrada_percentual as DecimalString)).div(100));
    plano.down_payment_date = doc.dataDocumento;
  }
  return plano;
}

/** Capacidade declarada pela API em GET /api/sales/<variante>/operation-types (capacidades.condicaoPagamento). */
export const CAPACIDADE_CONDICAO_PAGAMENTO = 1;
/** Código da recusa: condição inexistente, de outra organização, excluída ou inativa — a MESMA resposta. */
export const ERRO_CONDICAO_PAGAMENTO_INVALIDA = "CONDICAO_PAGAMENTO_INVALIDA";
export const MSG_CONDICAO_PAGAMENTO_INVALIDA = "Condição de pagamento inválida: escolha uma condição ativa desta organização.";
