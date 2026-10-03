/**
 * OPERACOES-01 F5a (decisão 282) — A SEÇÃO "DESTINO" DO FORMATO 5 (`destino`, na raiz da configuração).
 *
 * O destino diz para onde vai o que sai do estoque: centro de resultado, máquina/equipamento, ordem de serviço, lote
 * de animais, área/talhão e safra (as seis dimensões de `CAMPOS_DESTINO_ESTOQUE`, o dono da lista). Para cada uma, a
 * TOP diz se ela é NÃO USADA, OPCIONAL ou OBRIGATÓRIA. Vale para a requisição de material, o consumo e a saída; o
 * consumo que atende uma requisição leva o destino dela, e a devolução de consumo leva o do consumo (por isso a seção
 * não é dela: o destino da devolução nunca se informa).
 *
 * A REGRA QUE TRAVA NASCE DESLIGADA (decisão 281, item (4) da 240): o neutro é "opcional" em todas (OPERACOES-01 F11,
 * decisão 288 — era "não usada" na F5a) — a TOP aceita o destino como a baixa e a requisição antigas aceitavam, e nada
 * é exigido ("Opcional" nunca recusa). "Não usada" e "Obrigatória" são escolhas da TOP, gravadas pelo Maike, TOP por
 * TOP. Quem executa é a API, no lançamento (`recusasDoDestinoPelaTop`, com o valor FINAL de cada dimensão — o
 * informado ou o herdado da origem).
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e `estoque-documento.ts` (que lê o registry e não importa a configuração). A família é PERGUNTADA ao
 * registry pela espécie (`familiaOperacionalDeDocumentoEstoque`) — nenhum código de família escrito aqui
 * (`familia-operacional-ssot-audit`).
 *
 * SÓ TIPOS DO PONTO DE EXTENSÃO, E NÃO `definirSecaoV5`, DE PROPÓSITO: o ponto de extensão importa ESTE arquivo para
 * montar `DEFINICOES_SECOES_V5`. Um VALOR importado de volta (`definirSecaoV5`) faria o ciclo existir em tempo de
 * execução, e quem fosse avaliado primeiro leria o outro ainda não inicializado. Com `import type` o ciclo some na
 * compilação. O congelamento é o mesmo de `definirSecaoV5` (`Object.freeze`), o nome é o literal do tipo, e o teste
 * de contrato (`top-formato5.test.ts`, F5-D1) recusa nome reservado. (O mesmo molde da F6a.)
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import {
  CAMPOS_DESTINO_ESTOQUE,
  familiaOperacionalDeDocumentoEstoque,
  type ColunaDestinoEstoque,
  type DimensaoDestinoEstoque,
  type EspecieEstoque,
} from "./estoque-documento.js";

/** O que a TOP diz de cada dimensão do destino. */
export const EXIGENCIAS_DESTINO_TOP = ["nao_usada", "opcional", "obrigatoria"] as const;
export type ExigenciaDestinoTop = (typeof EXIGENCIAS_DESTINO_TOP)[number];

/** O rótulo de cada exigência (editor e histórico). */
export const ROTULOS_EXIGENCIA_DESTINO_TOP: Readonly<Record<ExigenciaDestinoTop, string>> = Object.freeze({
  nao_usada: "Não usada",
  opcional: "Opcional",
  obrigatoria: "Obrigatória",
});

/** O valor da seção `destino`: a exigência de cada uma das seis dimensões (as chaves de `CAMPOS_DESTINO_ESTOQUE`). */
export type SecaoDestinoTop = { [D in DimensaoDestinoEstoque]: ExigenciaDestinoTop };

/** As espécies cujas TOPs CONFIGURAM o destino. A devolução de consumo leva o destino copiado do consumo. */
export const ESPECIES_COM_DESTINO_PELA_TOP: readonly EspecieEstoque[] = Object.freeze(["requisicao", "consumo", "saida"] as const);

/**
 * A seção com o valor de cada dimensão dado por `valor`, perguntado NA ORDEM de `CAMPOS_DESTINO_ESTOQUE` (é a ordem
 * das recusas do leitor). As seis chaves escritas aqui são cobradas pelo compilador (`SecaoDestinoTop` exige todas).
 */
function porDimensao(valor: (d: DimensaoDestinoEstoque) => ExigenciaDestinoTop): SecaoDestinoTop {
  const lidos = new Map<DimensaoDestinoEstoque, ExigenciaDestinoTop>(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.chave, valor(c.chave)]));
  const de = (d: DimensaoDestinoEstoque): ExigenciaDestinoTop => lidos.get(d) ?? "opcional";
  return {
    centroCusto: de("centroCusto"),
    equipamento: de("equipamento"),
    ordemServico: de("ordemServico"),
    loteAnimais: de("loteAnimais"),
    area: de("area"),
    safra: de("safra"),
  };
}

/** O texto de ajuda da aba Destino no editor da TOP. */
const AJUDA_DESTINO =
  "O destino diz para onde vai o que sai do estoque: centro de resultado, máquina/equipamento, ordem de serviço, lote de animais, área/talhão e safra. Cada um pode ser não usado, opcional ou obrigatório nesta operação; o padrão é opcional (aceita o destino, nada é exigido). Vale para a requisição, o consumo e a saída; o consumo que atende uma requisição leva o destino dela, e a devolução de consumo leva o do consumo.";

export const SECAO_DESTINO: DefinicaoSecaoV5<"destino", SecaoDestinoTop> = Object.freeze({
  nome: "destino",
  rotulo: "Destino",
  ajuda: AJUDA_DESTINO,
  chaves: Object.freeze(CAMPOS_DESTINO_ESTOQUE.map((c) => c.chave)),
  // O neutro (OPERACOES-01 F11, decisão 288): "opcional" nas seis — aceita o destino, nada é exigido.
  neutro: (): SecaoDestinoTop => porDimensao(() => "opcional"),
  ler: (l: LeitorDeSecaoTop): SecaoDestinoTop => porDimensao((d) => l.enumerado(d, EXIGENCIAS_DESTINO_TOP)),
  // Cada dimensão decide sozinha: nada a zerar. Cópia nova, que não aponta para a entrada.
  normalizar: (v: SecaoDestinoTop): SecaoDestinoTop => porDimensao((d) => v[d]),
  usadaPor: (familia: string): boolean =>
    typeof familia === "string" && ESPECIES_COM_DESTINO_PELA_TOP.some((e) => familiaOperacionalDeDocumentoEstoque(e) === familia),
  linhas: (v: SecaoDestinoTop): readonly (readonly [string, string])[] =>
    CAMPOS_DESTINO_ESTOQUE.map((c) => [c.rotulo, ROTULOS_EXIGENCIA_DESTINO_TOP[v[c.chave]]] as const),
});

/** Uma recusa do destino pela TOP: a dimensão, a coluna do documento (o `path` do 422) e a mensagem. */
export interface RecusaDestinoTop {
  readonly chave: DimensaoDestinoEstoque;
  readonly coluna: ColunaDestinoEstoque;
  readonly mensagem: string;
}

/** O rótulo da dimensão no meio da frase ("Esta operação exige centro de resultado."). */
const rotuloNaFrase = (rotulo: string): string => rotulo.toLocaleLowerCase("pt-BR");

/**
 * O que a seção Destino da TOP recusa neste documento, na ordem das dimensões (`CAMPOS_DESTINO_ESTOQUE`):
 *   · dimensão INFORMADA no corpo com a TOP dizendo "não usada" → `Esta operação não usa <dimensão>.`;
 *   · dimensão OBRIGATÓRIA com o valor FINAL vazio → `Esta operação exige <dimensão>.`.
 * `valores` é o valor FINAL de cada dimensão (o informado ou o herdado da requisição de origem); `informadas`, as que
 * vieram no corpo. Uma dimensão herdada satisfaz a obrigatória, e a herdada que a TOP não usa NÃO é recusada (quem
 * a escolheu foi a requisição, sob a TOP dela). Opcional nunca recusa. `[]` quando nada é recusado.
 */
export function recusasDoDestinoPelaTop(
  secao: SecaoDestinoTop,
  valores: Readonly<Record<DimensaoDestinoEstoque, string | null>>,
  informadas: ReadonlySet<DimensaoDestinoEstoque>,
): RecusaDestinoTop[] {
  const recusas: RecusaDestinoTop[] = [];
  for (const c of CAMPOS_DESTINO_ESTOQUE) {
    const exigencia = secao[c.chave];
    if (exigencia === "nao_usada" && informadas.has(c.chave)) {
      recusas.push({ chave: c.chave, coluna: c.coluna, mensagem: `Esta operação não usa ${rotuloNaFrase(c.rotulo)}.` });
    } else if (exigencia === "obrigatoria" && (valores[c.chave] ?? null) === null) {
      recusas.push({ chave: c.chave, coluna: c.coluna, mensagem: `Esta operação exige ${rotuloNaFrase(c.rotulo)}.` });
    }
  }
  return recusas;
}
