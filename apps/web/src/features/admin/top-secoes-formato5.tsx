"use client";
import type * as React from "react";
import {
  SECOES_EXTENSAO_V5, secoesExtensaoDaVersaoTop,
  type ConfiguracaoTipoOperacaoV5, type NomeSecaoExtensaoV5, type SecoesExtensaoV5
} from "@agro/domain";
// OPERACOES-01 F5a (decisão 282): as abas Destino e Fluxo.
import { AbaDestino } from "./top-secao-destino";
import { AbaFluxo } from "./top-secao-fluxo";

/**
 * O REGISTRO DAS ABAS DAS SEÇÕES DE EXTENSÃO DO FORMATO 5 (OPERACOES-01 F4, decisão 281).
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE ──────────────────────────────────────────────────────────────────────┐
 * │ O formato 5 cresce por fase: cada fase F5 a F10 declara a SUA seção no domínio                       │
 * │ (`DEFINICOES_SECOES_V5`, em `packages/domain/src/tipo-operacao-secoes-v5.ts`) e a aba dela entra     │
 * │ AQUI — uma linha em `COMPONENTES_DAS_SECOES_V5` —, sem tocar no editor (`top-editor.tsx`). O editor  │
 * │ mostra a aba quando o perfil do tipo a lista e entrega a ela o valor da seção; a aba devolve o valor │
 * │ novo inteiro. Nada mais.                                                                             │
 * │                                                                                                      │
 * │ O COMPILADOR COBRA O RESTO (regra 5 do ponto de extensão): o tipo do registro é um mapa com UMA chave│
 * │ por nome de seção. Acrescentar a definição no domínio sem a aba aqui não compila; a aba de uma seção │
 * │ que não existe também não. Na F4 a lista está vazia, e o registro também.                           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** O que a aba de uma seção recebe: o valor DELA (já lido e normalizado), a família, os erros do servidor e a troca. */
export interface PropsDaSecaoV5<K extends NomeSecaoExtensaoV5> {
  valor: SecoesExtensaoV5[K];
  /** A família da TOP (`codigoBase`), para a aba dizer o que vale para ela. Nunca autoriza nada. */
  familia: string;
  /** Os erros de campo (caminho → mensagem) — os da seção são os de caminho `<nome>.<campo>`. */
  erros: Readonly<Record<string, string>>;
  /** O valor NOVO da seção inteira. A normalização do domínio vem depois, no editor (`mudarConfig…`). */
  onChange: (v: SecoesExtensaoV5[K]) => void;
}

/** O componente da aba de UMA seção. */
export type ComponenteDaSecaoV5<K extends NomeSecaoExtensaoV5> = (p: PropsDaSecaoV5<K>) => React.ReactNode;

/** UMA ENTRADA POR SEÇÃO DE EXTENSÃO — as fases F5 a F10 acrescentam a sua aqui (o compilador cobra). Vazio na F4. */
export const COMPONENTES_DAS_SECOES_V5: { readonly [K in NomeSecaoExtensaoV5]: ComponenteDaSecaoV5<K> } = {
  destino: AbaDestino,
  fluxo: AbaFluxo,
};

/**
 * A aba é de uma seção de extensão? É a pergunta do editor para escolher entre as abas de hoje e `SecaoDoFormato5`,
 * feita à lista do domínio (`SECOES_EXTENSAO_V5`) — nunca a uma lista daqui.
 */
export const ehSecaoDeExtensaoV5 = (aba: string): aba is NomeSecaoExtensaoV5 => {
  const nomes: readonly string[] = SECOES_EXTENSAO_V5;
  return nomes.includes(aba);
};

/**
 * A aba da seção `nome`, com o valor dela nesta configuração do formato 5. A troca devolve a configuração INTEIRA com
 * só aquela seção substituída (as outras e as de hoje como estão).
 */
export function SecaoDoFormato5({ nome, configuracao, familia, erros, onChange }: {
  nome: NomeSecaoExtensaoV5;
  configuracao: ConfiguracaoTipoOperacaoV5;
  familia: string;
  erros: Readonly<Record<string, string>>;
  onChange: (c: ConfiguracaoTipoOperacaoV5) => void;
}): React.ReactNode {
  return renderizarSecao(nome, configuracao, familia, erros, onChange);
}

/**
 * Genérica no NOME, para o valor, o componente e a troca falarem da MESMA seção.
 *
 * ┌─ A CONVERSÃO CONTROLADA — A ÚNICA DESTE ARQUIVO ───────────────────────────────────────────────────┐
 * │ `COMPONENTES_DAS_SECOES_V5[nome]` é, pelo tipo do registro, o componente da seção `K` — mas o        │
 * │ TypeScript não leva a correspondência "chave K → valor de K" de um tipo mapeado para dentro de uma   │
 * │ função genérica (o acesso indexado por um `K` genérico não é simplificado ao modelo do mapa). A      │
 * │ conversão abaixo diz isso a ele, e é EXATA por construção: o registro tem o tipo                     │
 * │ `{ [K in NomeSecaoExtensaoV5]: ComponenteDaSecaoV5<K> }`, e é dele que o valor sai. Sem `any`, sem   │
 * │ supressão de erro, e num lugar só — o editor nunca muda quando uma fase acrescenta seção.            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function renderizarSecao<K extends NomeSecaoExtensaoV5>(
  nome: K,
  configuracao: ConfiguracaoTipoOperacaoV5,
  familia: string,
  erros: Readonly<Record<string, string>>,
  onChange: (c: ConfiguracaoTipoOperacaoV5) => void
): React.ReactNode {
  const Componente = COMPONENTES_DAS_SECOES_V5[nome] as ComponenteDaSecaoV5<K>;
  // O valor da seção pela leitura do domínio (normalizada e copiada), nunca `configuracao[nome]` direto.
  const secoes: SecoesExtensaoV5 = secoesExtensaoDaVersaoTop(configuracao);
  return <Componente
    valor={secoes[nome]}
    familia={familia}
    erros={erros}
    onChange={(v) => onChange({ ...configuracao, [nome]: v })}
  />;
}
