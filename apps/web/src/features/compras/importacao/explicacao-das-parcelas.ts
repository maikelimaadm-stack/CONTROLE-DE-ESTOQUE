import { D } from "@agro/shared";
import type { ParcelasDaNota } from "@agro/domain";
import { brl } from "@/lib/utils";

/**
 * POR QUE AS PARCELAS DA NOTA NÃO SERVEM (XML-04, decisão 318: "a duplicata diz por quê") — leitura PURA, sem React e
 * sem rede (a aba Financeiro e o estado da conferência só a chamam; o teste de unidade a prova).
 *
 * A REGRA não muda (`parcelasDaNota` do domínio decide; a tela só explica): a explicação é a do MESMO resultado que
 * decide "Usar a condição de pagamento" — o da conferência, ou o que a tela recalcula com o total dela. Os campos da
 * XML-04 são lidos por PROPRIEDADE PRÓPRIA (a resposta de uma API anterior não os traz):
 *   · `nao_conferem` — os TRÊS números (Σ das duplicatas; o líquido, dizendo se veio da fatura (vLiq) ou do total da
 *     nota (vNF); o total da compra) e CADA comparação que falhou, com a diferença em dinheiro. Sem os campos novos: a
 *     soma e o líquido, e nada inventado;
 *   · `sem_duplicatas` — a nota não traz duplicatas, ou trouxe e elas vieram sem vencimento (o leitor as descarta).
 */

export interface ExplicacaoDasParcelas {
  /** A frase de sempre: por que a compra usa a condição de pagamento. */
  resumo: string;
  /** Os números comparados, como a tela escreve dinheiro (`null` em `sem_duplicatas`). */
  numeros: string | null;
  /** Cada comparação que falhou, com a diferença (a falha que a tela não conhece não aparece). */
  falhas: { codigo: string; texto: string }[];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const propria = (o: unknown, k: string): unknown => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const decimal = (v: unknown): v is string => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v);

/** "fica R$ 279,00 abaixo do líquido" / "acima" / "é diferente do líquido" — a diferença com sinal, dita em palavras. */
function comparacao(diferenca: unknown, alvo: string): string {
  if (!decimal(diferenca) || D(diferenca).isZero()) return `é diferente ${alvo}`;
  return `fica ${brl(D(diferenca).abs().toFixed(2))} ${D(diferenca).isNegative() ? "abaixo" : "acima"} ${alvo}`;
}

/** A explicação de um resultado que NÃO confere (`conferem` ⇒ `null`: a tabela das duplicatas é a explicação). */
export function explicacaoDasParcelas(p: ParcelasDaNota): ExplicacaoDasParcelas | null {
  if (p.situacao === "conferem") return null;
  if (p.situacao === "sem_duplicatas") {
    return {
      resumo: propria(p, "motivo") === "duplicata_sem_vencimento"
        ? "A nota trouxe duplicatas sem vencimento: a compra usa a condição de pagamento."
        : "A nota não traz duplicatas: a compra usa a condição de pagamento.",
      numeros: null, falhas: []
    };
  }
  const origem = propria(p, "origemDoLiquido");
  const rotuloDoLiquido = origem === "fatura" ? "Líquido da fatura (vLiq)" : origem === "nota" ? "Líquido (o total da nota, vNF: a nota não traz o líquido da fatura)" : "Líquido";
  const total = propria(p, "total");
  const numeros = [`Soma das duplicatas: ${brl(p.soma)}`, `${rotuloDoLiquido}: ${brl(p.liquido)}`,
    ...(decimal(total) ? [`Total da compra: ${brl(total)}`] : [])].join(" · ");
  const lidas = propria(p, "falhas");
  const falhas: ExplicacaoDasParcelas["falhas"] = [];
  for (const codigo of Array.isArray(lidas) ? new Set(lidas) : []) {
    if (codigo === "soma_diferente_do_liquido") {
      falhas.push({ codigo, texto: `A soma das duplicatas ${comparacao(propria(p, "diferencaSomaLiquido"), "do líquido")}.` });
    } else if (codigo === "liquido_diferente_do_total") {
      falhas.push({ codigo, texto: `O líquido ${comparacao(propria(p, "diferencaLiquidoTotal"), "do total da compra")}.` });
    } else if (codigo === "ultima_parcela_nao_positiva") {
      falhas.push({ codigo, texto: "A soma e o líquido conferem com o total, mas a última duplicata, ajustada para a soma fechar no total da compra, ficaria com valor zero ou negativo." });
    }
  }
  return { resumo: "As duplicatas da nota não conferem: a compra usa a condição de pagamento.", numeros: `${numeros}.`, falhas };
}
