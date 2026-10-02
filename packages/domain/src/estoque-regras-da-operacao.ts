/**
 * OPERACOES-01 F5b (decisão 282) — AS REGRAS DA TOP QUE A CENTRAL DE ESTOQUE LÊ ANTES DE SALVAR.
 *
 * `GET /api/estoque/<segmento>/regras-da-operacao?tipo_operacao_id=` devolve, da versão ATUAL da TOP escolhida, o que
 * o lançamento do documento de estoque vai cobrar dela — e a tela mostra e pede o mesmo antes do POST:
 *   · as EXIGÊNCIAS GERAIS pelo mapa PRÓPRIO do estoque (`EXIGENCIAS_GERAIS_ESTOQUE_TOP`: só a observação); formatos
 *     1 e 2 não executam restrições (`camposExigidosTop` devolve `[]`);
 *   · as REGRAS GERAIS: a confirmação automática (o "Salvar e confirmar"), pela MESMA régua do POST
 *     (`regrasGeraisDaVersaoTop`, a de `lib/confirmacao-automatica.ts`); "aceita sem itens" é SEMPRE `false` — o POST
 *     do estoque recusa documento sem itens em toda versão, e a tela nunca pode prometer o contrário;
 *   · a seção DESTINO (requisição, consumo e saída) e a seção FLUXO (só o consumo), pela pergunta do ponto de extensão
 *     (`secoesExtensaoDaVersaoTop`): formatos 1 a 4 e versão ilegível respondem o NEUTRO de cada seção — nada novo
 *     é exigido (decisão 281: as regras que travam nascem desligadas). É a MESMA leitura do lançamento
 *     (`lerConfiguracaoDoLancamento`, `apps/api/src/routes/estoque-documentos.ts`). A família que não usa a seção
 *     recebe `null` (a tela nem mostra o campo).
 * O servidor continua a autoridade: o lançamento cobra tudo de novo, pela versão que ele mesmo congela.
 *
 * `lerRegrasDaOperacaoDoEstoque` é o leitor ESTRITO do fio, para a tela: qualquer forma errada → `null`, e a Central
 * TRAVA o Salvar ("As regras da operação não carregaram") — nunca esconde um destino obrigatório. Chave a mais é
 * ignorada (a API pode crescer sem quebrar a tela de antes).
 *
 * ARQUIVO FOLHA: nenhum outro arquivo do domínio o importa (só o `index.ts`) — sem ciclo.
 */
import { lerConfiguracaoTop, secoesExtensaoDaVersaoTop, secoesExtensaoNeutrasTop } from "./tipo-operacao-configuracao.js";
import { camposExigidosTop, EXIGENCIAS_GERAIS_ESTOQUE_TOP } from "./tipo-operacao-restricoes.js";
import { regrasGeraisDaVersaoTop } from "./tipo-operacao-regras-gerais.js";
import { EXIGENCIAS_DESTINO_TOP, SECAO_DESTINO, type SecaoDestinoTop } from "./tipo-operacao-secao-destino.js";
import { EXIGENCIAS_REQUISICAO_TOP, SECAO_FLUXO, type SecaoFluxoTop } from "./tipo-operacao-secao-fluxo.js";
import { CAMPOS_DESTINO_ESTOQUE } from "./estoque-documento.js";

/** A versão do contrato de `/api/estoque/<segmento>/regras-da-operacao`. */
export const CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE = 1 as const;

/** As regras gerais da TOP que a Central de Estoque usa. */
export interface RegrasGeraisDoEstoque {
  /** "Confirmação: Automática" na versão: a Central oferece "Salvar e confirmar". */
  readonly confirmacaoAutomatica: boolean;
  /** Sempre `false`: o documento de estoque nunca é gravado sem itens. */
  readonly aceitaSemItens: false;
}

/** A resposta de `/api/estoque/<segmento>/regras-da-operacao` (e o que o leitor do fio devolve). */
export interface RegrasDaOperacaoDoEstoque {
  readonly contractVersion: typeof CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE;
  /** Os campos do corpo que a TOP exige (as exigências gerais; no estoque só "observacao"). Formato 1/2: []. */
  readonly exigencias: readonly string[];
  readonly regrasGerais: RegrasGeraisDoEstoque;
  /** null = a família não usa a seção Destino (entrada, transferência, ajuste, devolução de consumo). */
  readonly destino: SecaoDestinoTop | null;
  /** null = a família não usa a seção Fluxo (só o consumo usa). */
  readonly fluxo: SecaoFluxoTop | null;
}

/**
 * As regras da operação desta `configuracao` (a da versão ATUAL da TOP) para a `familia` (o código-base da TOP).
 * Objeto NOVO a cada chamada, sem referência à entrada. Configuração nula ou ilegível: exigências `[]`, sem
 * confirmação automática e as seções no neutro — o comportamento de hoje.
 */
export function regrasDaOperacaoDoEstoque(familia: string, configuracao: unknown): RegrasDaOperacaoDoEstoque {
  const lida = lerConfiguracaoTop(configuracao);
  const secoes = lida.ok ? secoesExtensaoDaVersaoTop(lida.valor) : secoesExtensaoNeutrasTop();
  const exigencias = lida.ok ? camposExigidosTop(lida.valor, EXIGENCIAS_GERAIS_ESTOQUE_TOP) : [];
  const rg = regrasGeraisDaVersaoTop({ codigoBase: familia, configuracao });
  return {
    contractVersion: CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE,
    exigencias,
    regrasGerais: { confirmacaoAutomatica: rg.ok && rg.regras.confirmacaoAutomatica, aceitaSemItens: false },
    destino: SECAO_DESTINO.usadaPor(familia) ? SECAO_DESTINO.normalizar(secoes.destino) : null,
    fluxo: SECAO_FLUXO.usadaPor(familia) ? SECAO_FLUXO.normalizar(secoes.fluxo) : null,
  };
}

// ─────────────── o leitor do fio (a tela) ───────────────

const ehObjeto = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);

/** Só a propriedade PRÓPRIA e de dado: nem herdada do protótipo, nem um getter executado aqui. */
const dado = (o: object, chave: string): unknown => Object.getOwnPropertyDescriptor(o, chave)?.value;

/** As seis dimensões do dono (`CAMPOS_DESTINO_ESTOQUE`), cada uma em `EXIGENCIAS_DESTINO_TOP`; faltou uma → `null`. */
function lerDestino(v: unknown): SecaoDestinoTop | null {
  if (!ehObjeto(v)) return null;
  const lido = SECAO_DESTINO.neutro();
  for (const c of CAMPOS_DESTINO_ESTOQUE) {
    const x = dado(v, c.chave);
    const exigencia = EXIGENCIAS_DESTINO_TOP.find((e) => e === x);
    if (exigencia === undefined) return null;
    lido[c.chave] = exigencia;
  }
  return lido;
}

/** `exigeRequisicao` em `EXIGENCIAS_REQUISICAO_TOP` e `permiteParcial` booleano; outra forma → `null`. */
function lerFluxo(v: unknown): SecaoFluxoTop | null {
  if (!ehObjeto(v)) return null;
  const x = dado(v, "exigeRequisicao");
  const exigeRequisicao = EXIGENCIAS_REQUISICAO_TOP.find((e) => e === x);
  const permiteParcial = dado(v, "permiteParcial");
  if (exigeRequisicao === undefined || typeof permiteParcial !== "boolean") return null;
  return { exigeRequisicao, permiteParcial };
}

/** Lista de textos (cópia), ou `null` se não for lista ou tiver um item que não é texto. */
function lerTextos(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const itens: readonly unknown[] = v;
  const textos = itens.filter((x): x is string => typeof x === "string");
  return textos.length === itens.length ? textos : null;
}

/**
 * O leitor ESTRITO da resposta de `/regras-da-operacao` do estoque. Recusa (`null`): não-objeto; `contractVersion`
 * diferente de 1; `exigencias` que não é lista de textos; `regrasGerais` sem `confirmacaoAutomatica` e
 * `aceitaSemItens` booleanos; `destino` que não é `null` nem as seis dimensões com exigência conhecida; `fluxo` que não
 * é `null` nem `{ exigeRequisicao, permiteParcial }` válidos. Chave a mais é ignorada. O lido é sempre um objeto NOVO,
 * com `aceitaSemItens: false` (o documento de estoque nunca é gravado sem itens).
 */
export function lerRegrasDaOperacaoDoEstoque(bruto: unknown): RegrasDaOperacaoDoEstoque | null {
  if (!ehObjeto(bruto) || dado(bruto, "contractVersion") !== CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE) return null;
  const exigencias = lerTextos(dado(bruto, "exigencias"));
  if (exigencias === null) return null;
  const rg = dado(bruto, "regrasGerais");
  if (!ehObjeto(rg)) return null;
  const confirmacaoAutomatica = dado(rg, "confirmacaoAutomatica");
  if (typeof confirmacaoAutomatica !== "boolean" || typeof dado(rg, "aceitaSemItens") !== "boolean") return null;
  const destinoBruto = dado(bruto, "destino");
  const destino = destinoBruto === null ? null : lerDestino(destinoBruto);
  if (destinoBruto !== null && destino === null) return null;
  const fluxoBruto = dado(bruto, "fluxo");
  const fluxo = fluxoBruto === null ? null : lerFluxo(fluxoBruto);
  if (fluxoBruto !== null && fluxo === null) return null;
  return {
    contractVersion: CONTRATO_REGRAS_DA_OPERACAO_ESTOQUE,
    exigencias,
    regrasGerais: { confirmacaoAutomatica, aceitaSemItens: false },
    destino,
    fluxo,
  };
}
