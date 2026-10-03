import type { RegrasGeraisDaCentral } from "./contrato";

export type { RegrasGeraisDaCentral } from "./contrato";

/**
 * MOTOR DA CENTRAL — AS REGRAS GERAIS DA TOP NA TELA (OPERACOES-01 F2, decisão 279). Puro: nada de React, nada de API.
 *
 * O servidor declara, em `/regras-da-operacao`, o bloco `regrasGerais` da TOP escolhida — calculado pela MESMA função
 * que a gravação executa, e só na variante que executa regra geral (a venda e a compra). A Central lê esse bloco para
 * dizer ANTES de salvar o que vai acontecer:
 *   · Confirmação Automática → o Salvar se chama "Salvar e confirmar";
 *   · Documento sem itens permitido → a pendência "ao menos um item" deixa de bloquear o Salvar.
 *
 * COMPATIBILIDADE: a API anterior não manda o bloco. Ausente, ou fora da forma, é o NEUTRO inteiro — o rótulo "Salvar"
 * e a pendência de item, exatamente como antes. Nunca meio-lido: uma chave boa ao lado de uma ruim não liga nada.
 */

/** O neutro: a Central de antes (o Salvar não confirma, e o documento pede ao menos um item). Congelado. */
export const REGRAS_GERAIS_NEUTRAS: Readonly<RegrasGeraisDaCentral> = Object.freeze({ confirmacaoAutomatica: false, aceitaSemItens: false });

/**
 * O bloco `regrasGerais` de `/regras-da-operacao`. Ausente (API anterior), não objeto, ou QUALQUER das duas chaves que
 * não seja boolean → o neutro inteiro. Chave a mais é ignorada (o contrato pode crescer). Devolve sempre um objeto novo.
 */
export function lerRegrasGerais(bruto: unknown): RegrasGeraisDaCentral {
  if (typeof bruto !== "object" || bruto === null) return { ...REGRAS_GERAIS_NEUTRAS };
  const { confirmacaoAutomatica, aceitaSemItens } = bruto as Record<string, unknown>;
  if (typeof confirmacaoAutomatica !== "boolean" || typeof aceitaSemItens !== "boolean") return { ...REGRAS_GERAIS_NEUTRAS };
  return { confirmacaoAutomatica, aceitaSemItens };
}

export const ROTULO_SALVAR = "Salvar";
export const ROTULO_SALVAR_E_CONFIRMAR = "Salvar e confirmar";

/**
 * O rótulo (e a dica) do Salvar: "Salvar e confirmar" só quando o servidor declarou a Confirmação Automática E quem
 * salva pode confirmar o documento (`podeConfirmar`: a capacidade de confirmar da espécie, pelo `can()` da tela). Sem a
 * capacidade o servidor salva e responde "sem permissão": o rótulo não promete o que não vai acontecer, e fica o
 * "Salvar" de antes (o aviso do Salvar explica o resto). `can()` só muda a apresentação; quem decide é o servidor.
 */
export const rotuloDoSalvar = (r: RegrasGeraisDaCentral | null | undefined, podeConfirmar: boolean): string =>
  (r?.confirmacaoAutomatica === true && podeConfirmar ? ROTULO_SALVAR_E_CONFIRMAR : ROTULO_SALVAR);

/** A pendência "ao menos um item" vale? Sim, a não ser que o servidor tenha declarado que a TOP aceita documento sem itens. */
export const exigeAoMenosUmItem = (r: RegrasGeraisDaCentral | null | undefined): boolean => r?.aceitaSemItens !== true;
