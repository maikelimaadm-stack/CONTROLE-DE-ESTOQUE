/**
 * OPERACOES-01 F4 (decisão 281) — O PONTO DE EXTENSÃO DO FORMATO 5 DA CONFIGURAÇÃO DA TOP.
 *
 * ┌─ O QUE ESTE ARQUIVO É ─────────────────────────────────────────────────────────────────────────────┐
 * │ O formato 5 é o formato 4 + SEÇÕES DE EXTENSÃO na raiz do JSON, uma por assunto novo das fases F5   │
 * │ a F10 (Destino, Fluxo, Divergência com o pedido, Financeiro padrão…). Cada seção é DECLARADA aqui,  │
 * │ numa `DefinicaoSecaoV5`, e o leitor do formato 5 (`lerConfiguracaoTop`), a normalização, a vista de  │
 * │ edição, a comparação, a auditoria e o catálogo por tipo a leem DA LISTA — nenhum deles muda quando  │
 * │ uma fase acrescenta a sua seção. Nasceu VAZIA na F4; hoje traz as da F5a, da F6a e da F9.           │
 * │                                                                                                     │
 * │ É UM ARQUIVO FOLHA: não importa `tipo-operacao-configuracao.ts` (que o importa). Quem declara uma    │
 * │ seção importa este arquivo e nada que importe a configuração — senão vira ciclo de import.          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS SEIS REGRAS DO PONTO DE EXTENSÃO (para as fases F5 a F10) ─────────────────────────────────────┐
 * │ 1. SEÇÃO NOVA = CHAVE DE RAIZ NOVA. Nunca uma chave nova dentro de `geral`, `estoque`, `financeiro`,│
 * │    `fiscal`, `aprovacao` ou `execucao`: `validarExecucaoTop` recusa qualquer chave nova em         │
 * │    `estoque`/`financeiro`, e o formato 4 nunca muda de forma. O nome nunca é uma das chaves de      │
 * │    hoje (`CHAVES_RAIZ_RESERVADAS_TOP`) — o compilador recusa em `definirSecaoV5`.                   │
 * │ 2. Num 5, a seção AUSENTE é lida como `neutro()` (o 5 cresce por fase, e o 5 gravado antes da fase │
 * │    continua legível); PRESENTE é lida estrita. Nos formatos 1 a 4 a chave é RECUSADA               │
 * │    (`campo_desconhecido`): o 4 nunca carrega seção nova.                                           │
 * │ 3. O arquivo da seção só importa ESTE arquivo (os tipos) e módulos que NÃO importam                │
 * │    `tipo-operacao-configuracao.ts` (o registry, `estoque-documento.ts`…) — senão vira ciclo.       │
 * │ 4. NADA DE UUID NO JSON (cabeçalho de `tipo-operacao-configuracao.ts`): alvo concreto (natureza,     │
 * │    conta, centro…) vai em TABELA da versão, no molde de `erp.tipos_operacao_versao_condicoes` (0033).│
 * │ 5. O compilador cobra o resto: acrescentar a definição à lista obriga a entrada da aba no web       │
 * │    (`COMPONENTES_DAS_SECOES_V5`, `apps/web/src/features/admin/top-secoes-formato5.tsx`).            │
 * │ 6. Não usar o tipo literal `{}` (regra `@typescript-eslint/no-empty-object-type`); o tipo mapeado    │
 * │    vazio (`SecoesExtensaoV5` na F4) é permitido.                                                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * COMO UMA FASE ACRESCENTA A SUA SEÇÃO: (a) um arquivo `tipo-operacao-secao-<nome>.ts` com o tipo da seção e
 * `export const SECAO_<NOME>: DefinicaoSecaoV5<"<nome>", T> = Object.freeze({ … })`, com `import type` deste arquivo
 * (importar `definirSecaoV5` como VALOR fecha um ciclo em tempo de execução); (b) UMA linha em `DEFINICOES_SECOES_V5`
 * (+ o import); (c) o componente da aba no registro do web; (d) os testes da seção (o contrato de
 * `top-formato5.test.ts` passa a valer para ela sozinho). O leitor, a normalização, a comparação e o catálogo NÃO mudam.
 *
 * AS REGRAS QUE TRAVAM NASCEM DESLIGADAS (decisão 281, item (4) da decisão 240): o `neutro()` de toda seção é
 * o comportamento de hoje — nenhuma regra nova vale numa TOP até alguém ligá-la, TOP por TOP.
 */

// As seções das fases. Cada arquivo de seção importa deste SÓ TIPOS (`import type`): este arquivo importa o dele
// para montar a lista, e um VALOR importado de volta faria o ciclo existir em tempo de execução (quem fosse avaliado
// primeiro leria o outro ainda não inicializado). Ver o cabeçalho de `tipo-operacao-secao-fluxo-compra.ts`.
// OPERACOES-01 F5a (decisão 282):
import { SECAO_DESTINO } from "./tipo-operacao-secao-destino.js";
import { SECAO_FLUXO } from "./tipo-operacao-secao-fluxo.js";
// OPERACOES-01 F6a (decisão 283):
import { SECAO_FLUXO_COMPRA } from "./tipo-operacao-secao-fluxo-compra.js";
import { SECAO_DIVERGENCIA_PEDIDO } from "./tipo-operacao-secao-divergencia-pedido.js";
// OPERACOES-01 F9 (decisão 286):
import { SECAO_FINANCEIRO_PADRAO } from "./tipo-operacao-secao-financeiro-padrao.js";

/**
 * As chaves de raiz que o formato 4 já usa. Uma seção de extensão NUNCA tem um destes nomes: colidir
 * reescreveria uma seção de hoje com o leitor de outra. É a lista `["versaoSchema", ...SECOES_CONFIGURACAO_TOP_V2]`
 * de `tipo-operacao-configuracao.ts` — escrita aqui porque este arquivo é folha; o teste confere as duas iguais.
 */
export const CHAVES_RAIZ_RESERVADAS_TOP = [
  "versaoSchema", "geral", "estoque", "financeiro", "fiscal", "aprovacao", "execucao",
] as const;
export type ChaveRaizReservadaTop = (typeof CHAVES_RAIZ_RESERVADAS_TOP)[number];

/**
 * O que a leitura estrita oferece a uma seção nova. Cada chamada lê UM campo da seção e acumula a recusa no
 * caminho `"<secao>.<campo>"`; o valor devolvido numa recusa é só PREENCHIMENTO e nunca escapa: o leitor recusa
 * o corpo inteiro quando há qualquer recusa.
 */
export interface LeitorDeSecaoTop {
  /** `true`/`false`; qualquer outro tipo → `tipo_invalido`. */
  booleano(campo: string): boolean;
  /** Texto da lista; fora dela → `valor_invalido` (nunca o vizinho nem o padrão); não-texto → `tipo_invalido`. */
  enumerado<T extends string>(campo: string, aceitos: readonly T[]): T;
  /** Inteiro no intervalo fechado; fora dele → `valor_invalido`; não-inteiro → `tipo_invalido`. */
  inteiro(campo: string, minimo: number, maximo: number): number;
  /**
   * Decimal em STRING (`^\d{1,13}(\.\d{1,casas})?$`), de 0 a `maximo` — `numeric` no banco, `decimal.js` no código,
   * string na API. Nunca ponto flutuante. Fora da forma ou acima do máximo → `valor_invalido`; não-texto → `tipo_invalido`.
   */
  decimal(campo: string, casas: number, maximo: string): string;
  /** Texto com até `maximo` caracteres; acima → `valor_invalido`; não-texto → `tipo_invalido`. */
  texto(campo: string, maximo: number): string;
}

/**
 * UMA seção nova do formato 5.
 *
 * MÉTODOS, E NÃO PROPRIEDADES-FUNÇÃO, DE PROPÓSITO: o parâmetro de método é bivariante no TypeScript, e é isso que
 * deixa a lista heterogênea (`DefinicaoSecaoV5<"destino", Destino>`, `DefinicaoSecaoV5<"fluxo", Fluxo>`…) caber em
 * `readonly DefinicaoSecaoV5[]` sem conversão nenhuma.
 */
export interface DefinicaoSecaoV5<N extends string = string, T extends object = object> {
  /** A chave de RAIZ no JSON e o nome da aba (ex.: `"destino"`). Nunca uma de `CHAVES_RAIZ_RESERVADAS_TOP`. */
  readonly nome: N;
  /** O rótulo da aba, da auditoria, do histórico e das mensagens (ex.: `"Destino"`). */
  readonly rotulo: string;
  /** O texto de ajuda da aba no editor. */
  readonly ajuda: string;
  /** As chaves aceitas DENTRO da seção. Leitura estrita: outra chave → `campo_desconhecido` em `<nome>.<chave>`. */
  readonly chaves: readonly string[];
  /** O PADRÃO DE HOJE: toda regra que trava nasce desligada. Devolve um objeto NOVO a cada chamada. */
  neutro(): T;
  /** Lê a seção campo a campo, SÓ pelo leitor (que acumula as recusas). */
  ler(leitor: LeitorDeSecaoTop): T;
  /** Zera o que não decide nada, dado o resto da seção. Idempotente; não muta a entrada; devolve objeto NOVO. */
  normalizar(valor: T): T;
  /** A família mostra e aceita a seção? Perguntado ao registry (pela tabela, pela variante) — nunca por literal. */
  usadaPor(familia: string): boolean;
  /** `[rótulo, valor]` de cada campo, para o histórico (só leitura). */
  linhas(valor: T): readonly (readonly [string, string])[];
}

/**
 * Declara uma seção. Devolve a própria definição, congelada, com o nome LITERAL no tipo (`const N`) — é o que faz
 * `NomeSecaoExtensaoV5` e `SecoesExtensaoV5` saírem da lista sem segunda declaração. Um nome reservado
 * (`CHAVES_RAIZ_RESERVADAS_TOP`) não compila: o tipo do parâmetro vira `never` no nome.
 */
export const definirSecaoV5 = <const N extends string, T extends object>(
  d: DefinicaoSecaoV5<N extends ChaveRaizReservadaTop ? never : N, T>,
): DefinicaoSecaoV5<N extends ChaveRaizReservadaTop ? never : N, T> => Object.freeze(d);

/**
 * A LISTA. Nasceu VAZIA na F4 — cada fase F5 a F10 acrescenta a SUA definição aqui (uma linha + o import) e mais nada
 * no leitor. A ordem é a das abas no editor (depois de Estoque) e a da auditoria (depois de Execução).
 */
export const DEFINICOES_SECOES_V5 = [
  // OPERACOES-01 F5a (decisão 282): o destino (requisição, consumo e saída) e o fluxo (consumo).
  SECAO_DESTINO,
  SECAO_FLUXO,
  // OPERACOES-01 F6a (decisão 283): o fluxo do pedido de compra e a divergência da compra com o pedido.
  SECAO_FLUXO_COMPRA,
  SECAO_DIVERGENCIA_PEDIDO,
  // OPERACOES-01 F9 (decisão 286): os padrões financeiros e a provisão (venda, pedido, financeiro, solicitação).
  SECAO_FINANCEIRO_PADRAO,
] as const satisfies readonly DefinicaoSecaoV5[];
export type DefinicoesSecoesV5 = typeof DEFINICOES_SECOES_V5;

/** O nome de cada seção de extensão (`never` na F4). */
export type NomeSecaoExtensaoV5 = DefinicoesSecoesV5[number]["nome"];

/** As seções de extensão como aparecem na configuração do formato 5: nome → valor da seção (vazio na F4). */
export type SecoesExtensaoV5 = { [D in DefinicoesSecoesV5[number] as D["nome"]]: ReturnType<D["neutro"]> };

// ---------------------------------------------------------------------------------------------------
// A CONVERSÃO CONTROLADA — a única deste ponto de extensão
// ---------------------------------------------------------------------------------------------------
//
// O tipo `SecoesExtensaoV5` sai da LISTA DO PRODUTO, mas quem percorre as definições percorre um
// `readonly DefinicaoSecaoV5[]` (o parâmetro `definicoes` das funções da configuração e do catálogo, que só o
// TESTE troca por outra lista). Juntar o resultado desse percurso no tipo da lista do produto exige uma
// conversão — e ela mora AQUI, uma vez, em vez de espalhada. Com a lista do produto ela é exata: cada nome da
// lista vira uma chave, e o valor de cada chave é o `T` da definição daquele nome. Com uma lista de teste ela é
// só a forma que o teste confere em tempo de execução.

/** O nome da definição, no tipo dos nomes do produto. Ver "a conversão controlada" acima. */
export const nomeDaSecaoV5 = (d: DefinicaoSecaoV5): NomeSecaoExtensaoV5 => d.nome as NomeSecaoExtensaoV5;

/**
 * Monta as seções de extensão, uma por definição, na ordem da lista, com o valor que `valor` dá a cada uma.
 * Objeto NOVO; `valor` é quem garante que nenhuma seção aponta para a entrada. Ver "a conversão controlada" acima.
 */
export function montarSecoesExtensaoV5(
  definicoes: readonly DefinicaoSecaoV5[],
  valor: (d: DefinicaoSecaoV5) => object,
): SecoesExtensaoV5 {
  return Object.fromEntries(definicoes.map((d) => [d.nome, valor(d)])) as SecoesExtensaoV5;
}

/** Os nomes das seções de extensão do produto, na ordem da lista (`[]` na F4). */
export const SECOES_EXTENSAO_V5: readonly NomeSecaoExtensaoV5[] = Object.freeze(DEFINICOES_SECOES_V5.map(nomeDaSecaoV5));

/** O rótulo de cada seção de extensão do produto (auditoria, histórico, mensagens). */
export const ROTULOS_SECOES_EXTENSAO_V5: Readonly<Record<NomeSecaoExtensaoV5, string>> = Object.freeze(
  Object.fromEntries(DEFINICOES_SECOES_V5.map((d: DefinicaoSecaoV5) => [d.nome, d.rotulo])) as Record<NomeSecaoExtensaoV5, string>,
);

/**
 * A definição da seção deste nome, ou `undefined` (nome que não é seção de extensão — quem chama NEGA, nunca
 * escolhe uma vizinha). `definicoes` é parâmetro só para teste.
 */
export function definicaoDaSecaoV5(
  nome: string,
  definicoes: readonly DefinicaoSecaoV5[] = DEFINICOES_SECOES_V5,
): DefinicaoSecaoV5 | undefined {
  return definicoes.find((d) => d.nome === nome);
}
