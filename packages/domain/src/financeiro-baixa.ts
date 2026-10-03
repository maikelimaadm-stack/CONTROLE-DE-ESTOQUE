import { D, DomainError, money, type Decimal } from "@agro/shared";

/**
 * Baixa de título na SEMÂNTICA B (decisão 285).
 *
 * `valor` é o valor BAIXADO do título e JÁ INCLUI o desconto: é o que sai do saldo. O caixa do principal é
 * `valor − desconto`; juros, multa, acréscimo e ajuste cambial somam ao caixa sem tocar o saldo. Antes, o banco
 * (`erp.refresh_title_status`) contava `amount + discount` como baixado e o domínio calculava o caixa como
 * `amount − discount`: o desconto era abatido duas vezes (título 1000, baixa 550 com desconto 50 quitava 600 e
 * movimentava 500 — 50 sumiam). A tela de hoje já pensa em B ("Valor" = saldo, "Desconto" à parte).
 *
 * - Valor menor que o saldo, sem desconto: "deixar o saldo em aberto" (baixa parcial).
 * - Valor = saldo com desconto: "dar como desconto" (quita o título; o caixa é saldo − desconto).
 * - Valor maior que o saldo com `excedente: "credito"`: quita pelo saldo e o excedente vira crédito do parceiro.
 * - A tarifa NUNCA entra no líquido: é um movimento de saída próprio, com a natureza "tarifa bancária".
 */
export interface ValoresDaBaixa {
  valor: string;
  desconto?: string;
  juros?: string;
  multa?: string;
  acrescimo?: string;
  ajusteCambial?: string;
  tarifa?: string;
  excedente?: "credito" | null;
}

export interface BaixaConferida {
  /** O que quita o título (nunca maior que o saldo). */
  aplicado: string;
  desconto: string;
  juros: string;
  multa: string;
  acrescimo: string;
  ajusteCambial: string;
  tarifa: string;
  /** Excedente que vira crédito do parceiro (zero sem excedente). */
  credito: string;
  /** Caixa do principal: `aplicado − desconto + credito`. */
  liquidoPrincipal: string;
  /** `liquidoPrincipal + juros + multa + acrescimo + ajusteCambial` (= `settlementNet` com amount = aplicado + credito). */
  liquidoTotal: string;
}

/** Lê um componente da baixa; ausente vale zero, texto que não é número é recusado (nunca vira zero). */
function componente(v: string | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return D(0);
  try {
    return D(v);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Valor inválido na baixa", { valor: v });
  }
}

/**
 * Confere os valores de uma baixa contra o saldo do título. Os erros saem nesta ORDEM: valor não positivo;
 * componente negativo; desconto maior que o valor; excedente com desconto; valor acima do saldo sem excedente.
 */
export function conferirValoresDaBaixa(saldo: string, v: ValoresDaBaixa): BaixaConferida {
  const valor = componente(v.valor);
  const desconto = componente(v.desconto);
  const juros = componente(v.juros);
  const multa = componente(v.multa);
  const acrescimo = componente(v.acrescimo);
  const ajusteCambial = componente(v.ajusteCambial);
  const tarifa = componente(v.tarifa);
  const s = componente(saldo);
  const comExcedente = v.excedente === "credito";

  if (valor.lte(0)) throw new DomainError("VALIDATION_ERROR", "Valor baixado deve ser positivo");
  if ([desconto, juros, multa, acrescimo, tarifa].some((x) => x.lt(0))) {
    throw new DomainError("VALIDATION_ERROR", "Juros, multa, acréscimo, desconto e tarifa não podem ser negativos");
  }
  if (desconto.gt(valor)) throw new DomainError("VALIDATION_ERROR", "O desconto não pode ser maior que o valor baixado");
  // Com desconto, "valor maior que o saldo" seria ambíguo (desconto sobre o título ou sobre o crédito?): recusa.
  if (comExcedente && desconto.gt(0)) throw new DomainError("VALIDATION_ERROR", "O excedente só vira crédito sem desconto");
  if (valor.gt(s) && !comExcedente) {
    throw new DomainError("PAYMENT_EXCEEDS_BALANCE", "Valor baixado excede o saldo do título", { saldo: money(s), valor: money(valor) });
  }

  const aplicado = comExcedente && valor.gt(s) ? s : valor;
  const credito = comExcedente && valor.gt(s) ? valor.minus(s) : D(0);
  const liquidoPrincipal = aplicado.minus(desconto).plus(credito);
  const liquidoTotal = liquidoPrincipal.plus(juros).plus(multa).plus(acrescimo).plus(ajusteCambial);
  return {
    aplicado: money(aplicado),
    desconto: money(desconto),
    juros: money(juros),
    multa: money(multa),
    acrescimo: money(acrescimo),
    ajusteCambial: money(ajusteCambial),
    tarifa: money(tarifa),
    credito: money(credito),
    liquidoPrincipal: money(liquidoPrincipal),
    liquidoTotal: money(liquidoTotal)
  };
}

/** Componentes da baixa que viram lançamento próprio, cada um com a sua natureza padrão. */
export const COMPONENTES_BAIXA = ["juros", "multa", "acrescimo", "tarifa"] as const;
export type ComponenteBaixa = (typeof COMPONENTES_BAIXA)[number];

/** Colunas de `erp.financeiro_naturezas_padrao` (Configurações › Financeiro › "Naturezas padrão da baixa"). */
export type ChaveNaturezaPadrao =
  | "juros_pagos_id"
  | "juros_recebidos_id"
  | "multa_paga_id"
  | "multa_recebida_id"
  | "acrescimo_pago_id"
  | "acrescimo_recebido_id"
  | "desconto_obtido_id"
  | "desconto_concedido_id"
  | "tarifa_bancaria_id";

/**
 * A natureza depende da DIREÇÃO do título: no a pagar, juros/multa/acréscimo são pagos e o desconto é OBTIDO
 * (receita); no a receber, são recebidos e o desconto é CONCEDIDO (despesa). A tarifa é sempre a do banco.
 */
const CHAVE_POR_COMPONENTE: Readonly<Record<ComponenteBaixa | "desconto", Readonly<Record<"payable" | "receivable", ChaveNaturezaPadrao>>>> = {
  juros: { payable: "juros_pagos_id", receivable: "juros_recebidos_id" },
  multa: { payable: "multa_paga_id", receivable: "multa_recebida_id" },
  acrescimo: { payable: "acrescimo_pago_id", receivable: "acrescimo_recebido_id" },
  desconto: { payable: "desconto_obtido_id", receivable: "desconto_concedido_id" },
  tarifa: { payable: "tarifa_bancaria_id", receivable: "tarifa_bancaria_id" }
};

export function chaveDaNaturezaPadrao(componente: ComponenteBaixa | "desconto", direcao: "payable" | "receivable"): ChaveNaturezaPadrao {
  const porDirecao = Object.prototype.hasOwnProperty.call(CHAVE_POR_COMPONENTE, componente) ? CHAVE_POR_COMPONENTE[componente] : undefined;
  const chave = porDirecao && Object.prototype.hasOwnProperty.call(porDirecao, direcao) ? porDirecao[direcao] : undefined;
  // Discriminador desconhecido (chamada fora do tipo) é recusado; nunca cai numa natureza vizinha.
  if (!chave) throw new DomainError("VALIDATION_ERROR", "Componente ou direção da baixa desconhecidos", { componente, direcao });
  return chave;
}

/** Tipo de natureza esperado em cada chave (uma natureza `both` é sempre aceita). */
export const NATUREZA_ESPERADA: Record<ChaveNaturezaPadrao, "income" | "expense"> = {
  juros_pagos_id: "expense",
  juros_recebidos_id: "income",
  multa_paga_id: "expense",
  multa_recebida_id: "income",
  acrescimo_pago_id: "expense",
  acrescimo_recebido_id: "income",
  desconto_obtido_id: "income",
  desconto_concedido_id: "expense",
  tarifa_bancaria_id: "expense"
};
