/**
 * OPERACOES-01 F11 (decisão 288) — A SEÇÃO "IMPLANTAÇÃO" DO FORMATO 5 (`implantacao`, na raiz da configuração).
 *
 * A implantação diz se a ENTRADA de estoque desta TOP lança o SALDO INICIAL (o I-2 da F5a): ligada, a confirmação
 * grava o movimento "Estoque inicial" (`opening_balance`) em vez da entrada comum (`entry`), e o mesmo produto, local
 * de estoque e lote não recebe dois saldos iniciais vivos — venha o primeiro da tela antiga ou de outro documento. É
 * da entrada e só dela (a família da espécie `entrada`, perguntada ao registry).
 *
 * A REGRA QUE TRAVA NASCE DESLIGADA (decisão 281, item (4) da 240): o neutro é `saldoInicial: false` — a entrada é
 * comum, como hoje. Quem executa é a API, na confirmação do documento (`saldoInicialPelaTop`, em
 * `estoque-regras-da-operacao.ts`).
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e `estoque-documento.ts`. A família é PERGUNTADA ao registry pela espécie — nenhum código de família
 * escrito aqui. Só `import type` do ponto de extensão, pelo mesmo motivo de `tipo-operacao-secao-destino.ts` (o
 * ponto de extensão importa este arquivo; um valor importado de volta faria o ciclo existir em tempo de execução).
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import { familiaOperacionalDeDocumentoEstoque } from "./estoque-documento.js";

/** O valor da seção `implantacao`. */
export interface SecaoImplantacaoTop {
  /** A entrada lança o saldo inicial? `false` (neutro) = entrada comum, como hoje. */
  saldoInicial: boolean;
}

/** O texto de ajuda da aba Implantação no editor da TOP. */
const AJUDA_IMPLANTACAO =
  "Marque quando esta entrada lança o saldo inicial do estoque (a implantação). O movimento passa a ser \"Estoque inicial\" e o mesmo produto, local de estoque e lote não recebe dois saldos iniciais: o segundo é recusado até o primeiro ser cancelado. No padrão, a entrada é comum.";

export const SECAO_IMPLANTACAO: DefinicaoSecaoV5<"implantacao", SecaoImplantacaoTop> = Object.freeze({
  nome: "implantacao",
  rotulo: "Implantação",
  ajuda: AJUDA_IMPLANTACAO,
  chaves: Object.freeze(["saldoInicial"] as const),
  // A regra que trava nasce desligada: a entrada é comum.
  neutro: (): SecaoImplantacaoTop => ({ saldoInicial: false }),
  ler: (l: LeitorDeSecaoTop): SecaoImplantacaoTop => ({ saldoInicial: l.booleano("saldoInicial") }),
  // Um campo só, que decide sozinho: nada a zerar. Cópia nova, que não aponta para a entrada.
  normalizar: (v: SecaoImplantacaoTop): SecaoImplantacaoTop => ({ saldoInicial: v.saldoInicial }),
  usadaPor: (familia: string): boolean => typeof familia === "string" && familiaOperacionalDeDocumentoEstoque("entrada") === familia,
  linhas: (v: SecaoImplantacaoTop): readonly (readonly [string, string])[] => [["Lança o saldo inicial", v.saldoInicial ? "Sim" : "Não"]],
});

/**
 * A capacidade que a API declara em `capacidades.saldoInicial` de `/api/estoque/entradas/operation-types` (só na
 * entrada): a TOP de entrada pode lançar o saldo inicial (seção `implantacao`), e cada item diz qual lança.
 */
export const CAPACIDADE_SALDO_INICIAL_ESTOQUE = 1 as const;

/**
 * A API declarou o saldo inicial pela TOP? Só um objeto com `saldoInicial` IGUAL a `CAPACIDADE_SALDO_INICIAL_ESTOQUE`
 * responde `true`; qualquer outra forma (ausente, `null`, texto, outro número, lista, herdada do protótipo) responde
 * `false` — a tela trata a API como a de antes (fail-closed). O molde de `entendeMovimentacaoInterna`.
 */
export function entendeSaldoInicialEstoque(capacidades: unknown): boolean {
  if (typeof capacidades !== "object" || capacidades === null || Array.isArray(capacidades)) return false;
  // Só a propriedade PRÓPRIA e de dado: nem herdada do protótipo, nem um getter executado aqui.
  const valor: unknown = Object.getOwnPropertyDescriptor(capacidades, "saldoInicial")?.value;
  return valor === CAPACIDADE_SALDO_INICIAL_ESTOQUE;
}
