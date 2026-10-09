/**
 * COLORAÇÃO DO MAPA — MAPA-MANEJO-02.
 *
 * Funções PURAS (sem I/O): em que FAIXA cada área cai em cada modo de coloração do mapa operacional
 * (`GET /api/mapa/operacional?coloracao=`). A API agrega no SQL e entrega aqui; a tela pinta. Ninguém redigita
 * estas regras — API, tela e testes consomem DESTE arquivo.
 *
 * A COR NÃO MORA NO DOMÍNIO. A faixa leva só chave, rótulo, número e unidade (`FaixaDoMapa`); qual cor cada chave
 * ganha é decisão de apresentação, da tela. Assim a regra (onde a área cai) e a paleta (como se mostra) mudam
 * cada uma no seu dono, e nenhum hex se espalha pelo servidor.
 *
 * Os rótulos saem de `labels.ts` (fonte única); o de uso da área, do catálogo `tipos-de-uso-da-area.ts`. As contas
 * de lotação e de dias são as de `ocupacao-de-area.ts` — reusadas, nunca reescritas.
 */
import { D, type DecimalString, type ISODate } from "@agro/shared";
import { diasDeDescanso, diasDeOcupacao, uaPorHectare } from "./ocupacao-de-area.js";
import { TIPOS_DE_USO_DA_AREA } from "./tipos-de-uso-da-area.js";
import { normalizarCategoria } from "./configuracao-de-icone.js";
import { UNKNOWN_VALUE, enumLabel } from "./labels.js";

/** Modos de coloração do mapa operacional, na ordem de apresentação. `padrao` = a cor cadastrada da área (sem faixa). */
export const MODOS_DE_COLORACAO = ["padrao", "uso_da_area", "lotacao_ua_ha", "situacao_pasto", "categoria"] as const;
export type ModoDeColoracao = (typeof MODOS_DE_COLORACAO)[number];

/** Unidade do número da faixa; nula quando a faixa não tem número. */
export const UNIDADES_DA_FAIXA = ["ua_ha", "dias", "cabecas"] as const;
export type UnidadeDaFaixa = (typeof UNIDADES_DA_FAIXA)[number];

/**
 * A faixa de UMA área num modo de coloração.
 * - `chave`: o que a tela usa para escolher a cor (estável; nunca texto exibido).
 * - `rotulo`: o texto exibido (pt-BR, de `labels.ts` ou do catálogo do dono).
 * - `numero` e `unidade`: o número que justifica a faixa (UA/ha como string decimal; dias e cabeças inteiros), ou
 *   os dois nulos quando a faixa não tem número.
 */
export interface FaixaDoMapa {
  chave: string;
  rotulo: string;
  numero: DecimalString | number | null;
  unidade: UnidadeDaFaixa | null;
}

// --------------------------------------------------------------------------------------------------
// Uso da área
// --------------------------------------------------------------------------------------------------

/**
 * Faixa pelo uso da área (`erp.areas.land_use`): a chave é o próprio uso, o rótulo é o do catálogo
 * `TIPOS_DE_USO_DA_AREA`. Uso fora do catálogo (o banco impede) leva "Desconhecido" — nunca o valor cru.
 */
export function faixaDeUsoDaArea(landUse: string): FaixaDoMapa {
  const rotulo = TIPOS_DE_USO_DA_AREA.find(([valor]) => valor === landUse)?.[1] ?? UNKNOWN_VALUE;
  return { chave: landUse, rotulo, numero: null, unidade: null };
}

// --------------------------------------------------------------------------------------------------
// Lotação (UA/ha)
// --------------------------------------------------------------------------------------------------

/** Faixas de lotação em UA/ha, da menor para a maior, e a da área sem denominador. */
export const FAIXAS_DE_LOTACAO_UA_HA = ["sublotacao", "moderada", "ideal", "alta", "superlotacao", "sem_area_util"] as const;
export type FaixaDeLotacaoUaHa = (typeof FAIXAS_DE_LOTACAO_UA_HA)[number];

/**
 * CORTES DA LOTAÇÃO (UA/ha). Cada limite é o PRIMEIRO valor da faixa que ele nomeia (inclusivo):
 * `< 0.8` sublotação · `[0.8, 1.2)` moderada · `[1.2, 1.8)` ideal · `[1.8, 2.4)` alta · `>= 2.4` superlotação.
 * São cortes GERAIS, os mesmos para toda área; a capacidade cadastrada da própria área (águas/seca e lotação
 * máxima) é outra leitura — a `situacao_de_lotacao` de `ocupacao-de-area.ts` —, e uma não substitui a outra.
 */
export const LIMITE_UA_HA_MODERADA: DecimalString = "0.8";
export const LIMITE_UA_HA_IDEAL: DecimalString = "1.2";
export const LIMITE_UA_HA_ALTA: DecimalString = "1.8";
export const LIMITE_UA_HA_SUPERLOTACAO: DecimalString = "2.4";

/** Entrada de `faixaDeLotacaoUaHa`. */
export interface EntradaFaixaDeLotacao {
  /** UA total presente na área (`uaDoRebanho` / soma dos lotes), string decimal. */
  uaTotal: DecimalString;
  /** `erp.areas.usable_area_ha` — o DENOMINADOR. */
  usableAreaHa: DecimalString | null;
  /** `erp.areas.area_ha` — recebido e IGNORADO de propósito (ver `faixaDeLotacaoUaHa`). */
  areaHa: DecimalString | null;
}

/**
 * Faixa de lotação da área em UA/ha.
 *
 * 1 UA (unidade animal) = 450 kg de peso vivo (`animalUnits`, `livestock.ts`). O número é `uaPorHectare(uaTotal,
 * usableAreaHa)`: o denominador é a área ÚTIL (`usable_area_ha`, a pastejável), NUNCA a total (`area_ha`, que
 * inclui reserva, estrada e benfeitoria e por isso subestima a lotação). `areaHa` entra na assinatura e é
 * ignorado DE PROPÓSITO: é a armadilha que a verificação reversa usa — trocar o denominador por ele tem de
 * reprovar os testes.
 *
 * Classifica o número EXIBIDO (2 casas, meio para cima): 0,795 aparece "0.80" e cai em moderada — a cor nunca
 * desmente o número escrito ao lado. Comparação em decimal.js, nunca em ponto flutuante.
 *
 * Área útil nula ou ≤ 0 → `sem_area_util`, sem número (sem denominador não há lotação — nunca 0, nunca divide por
 * zero). Área vazia (UA 0) com área útil → `sublotacao` com "0.00".
 */
export function faixaDeLotacaoUaHa(entrada: EntradaFaixaDeLotacao): FaixaDoMapa {
  const exibido = uaPorHectare(entrada.uaTotal, entrada.usableAreaHa);
  if (exibido === null) return faixa("faixa_de_lotacao_ua_ha", "sem_area_util", null, null);
  const n = D(exibido);
  const chave: FaixaDeLotacaoUaHa =
    n.lt(LIMITE_UA_HA_MODERADA) ? "sublotacao"
      : n.lt(LIMITE_UA_HA_IDEAL) ? "moderada"
        : n.lt(LIMITE_UA_HA_ALTA) ? "ideal"
          : n.lt(LIMITE_UA_HA_SUPERLOTACAO) ? "alta"
            : "superlotacao";
  return faixa("faixa_de_lotacao_ua_ha", chave, exibido, "ua_ha");
}

// --------------------------------------------------------------------------------------------------
// Situação do pasto (dias de ocupação / descanso)
// --------------------------------------------------------------------------------------------------

/** Situações do pasto: as três da área ocupada, a da vazia que já teve saída, e a da que nunca foi ocupada. */
export const SITUACOES_DO_PASTO = ["normal", "atencao", "critico", "em_descanso", "sem_registro"] as const;
export type SituacaoDoPasto = (typeof SITUACOES_DO_PASTO)[number];

/**
 * CORTES DA ÁREA OCUPADA, em dias desde a entrada do lote aberto MAIS ANTIGO (inclusivos):
 * `<= 45` normal · `<= 90` atenção · `> 90` crítico. São cortes GERAIS, os mesmos para toda área: o planejado do
 * módulo de pastejo (`occupation_days`) é outra leitura — o rodízio realizado × planejado de `ocupacao-de-area.ts`.
 */
export const LIMITE_DIAS_PASTO_NORMAL = 45;
export const LIMITE_DIAS_PASTO_ATENCAO = 90;

/** Entrada de `faixaDeSituacaoDoPasto`. */
export interface EntradaFaixaDeSituacaoDoPasto {
  /** `data_inicio` da ocupação ABERTA mais antiga da área; `null` = área vazia. */
  inicioDaAbertaMaisAntiga: ISODate | null;
  /** A última `data_fim` das ocupações da área; `null` = nunca teve saída. */
  ultimaSaida: ISODate | null;
  hoje: ISODate;
}

/**
 * Faixa da situação do pasto.
 * - OCUPADA: dias = `diasDeOcupacao(inicioDaAbertaMaisAntiga, null, hoje)` — o tempo contínuo de ocupação da área
 *   é o do lote que está lá há mais tempo; `normal` / `atencao` / `critico` pelos cortes, número em dias.
 * - VAZIA com saída registrada: `em_descanso`, número = `diasDeDescanso(ultimaSaida, hoje)`.
 * - Nunca ocupada (nem aberta nem saída): `sem_registro`, sem número — "sem registro" não é "0 dias".
 */
export function faixaDeSituacaoDoPasto(entrada: EntradaFaixaDeSituacaoDoPasto): FaixaDoMapa {
  if (entrada.inicioDaAbertaMaisAntiga !== null) {
    const dias = diasDeOcupacao(entrada.inicioDaAbertaMaisAntiga, null, entrada.hoje);
    const chave: SituacaoDoPasto = dias <= LIMITE_DIAS_PASTO_NORMAL ? "normal" : dias <= LIMITE_DIAS_PASTO_ATENCAO ? "atencao" : "critico";
    return faixa("situacao_do_pasto", chave, dias, "dias");
  }
  const descanso = diasDeDescanso(entrada.ultimaSaida, entrada.hoje);
  if (descanso !== null) return faixa("situacao_do_pasto", "em_descanso", descanso, "dias");
  return faixa("situacao_do_pasto", "sem_registro", null, null);
}

// --------------------------------------------------------------------------------------------------
// Categoria animal predominante
// --------------------------------------------------------------------------------------------------

/** Chave da área sem nenhuma cabeça presente no modo `categoria`. */
export const FAIXA_SEM_REBANHO = "sem_rebanho";

/** Uma categoria de animal presente na área, com as cabeças dela (de todos os lotes abertos). */
export interface CategoriaPresente {
  nome: string;
  cabecas: number;
}

/**
 * Faixa pela categoria animal PREDOMINANTE da área.
 *
 * Soma as cabeças por categoria NORMALIZADA (`normalizarCategoria`: `btrim` + maiúsculas — "Boi" e "BOI " são a
 * mesma); ganha a de mais cabeças; empate → a de menor chave em ordem de código (determinístico, sem idioma).
 * `chave` = a categoria normalizada; `rotulo` = o nome COMO CADASTRADO (se dois nomes normalizam igual, o menor em
 * ordem de código); número = as cabeças, unidade `cabecas`.
 *
 * Categoria com 0 cabeça ou nome vazio não conta. Sem nenhuma cabeça → `sem_rebanho`, sem número. Cabeças negativas
 * ou fracionárias são dado corrompido e LANÇAM (não viram predominância menor em silêncio).
 */
export function faixaDeCategoria(categorias: readonly CategoriaPresente[]): FaixaDoMapa {
  const porChave = new Map<string, { cabecas: number; rotulo: string }>();
  for (const [i, c] of categorias.entries()) {
    if (!Number.isInteger(c.cabecas) || c.cabecas < 0) throw new RangeError(`categorias[${i}].cabecas: esperado inteiro >= 0, recebido ${String(c.cabecas)}`);
    if (c.cabecas === 0 || typeof c.nome !== "string") continue;
    const chave = normalizarCategoria(c.nome);
    if (chave === "") continue;
    const atual = porChave.get(chave);
    if (!atual) porChave.set(chave, { cabecas: c.cabecas, rotulo: c.nome });
    else {
      atual.cabecas += c.cabecas;
      if (c.nome < atual.rotulo) atual.rotulo = c.nome;
    }
  }
  let vencedora: { chave: string; cabecas: number; rotulo: string } | null = null;
  for (const [chave, v] of porChave) {
    if (!vencedora || v.cabecas > vencedora.cabecas || (v.cabecas === vencedora.cabecas && chave < vencedora.chave)) {
      vencedora = { chave, ...v };
    }
  }
  if (!vencedora) return faixa("faixa_de_categoria", FAIXA_SEM_REBANHO, null, null);
  return { chave: vencedora.chave, rotulo: vencedora.rotulo, numero: vencedora.cabecas, unidade: "cabecas" };
}

// --------------------------------------------------------------------------------------------------
// Despacho por modo
// --------------------------------------------------------------------------------------------------

/** Tudo o que os modos precisam de UMA área (cada modo lê só a sua parte). */
export interface EntradaFaixaDaArea {
  /** `erp.areas.land_use`. */
  landUse: string;
  uaTotal: DecimalString;
  usableAreaHa: DecimalString | null;
  areaHa: DecimalString | null;
  inicioDaAbertaMaisAntiga: ISODate | null;
  ultimaSaida: ISODate | null;
  hoje: ISODate;
  categorias: readonly CategoriaPresente[];
}

/**
 * Faixa da área no modo pedido. `padrao` → `null` (a área usa a cor cadastrada; não há faixa). Modo desconhecido
 * LANÇA: discriminador desconhecido nega, nunca cai em `padrao` (a API valida o modo antes, com a mesma lista).
 */
export function faixaDaArea(modo: ModoDeColoracao, dados: EntradaFaixaDaArea): FaixaDoMapa | null {
  switch (modo) {
    case "padrao": return null;
    case "uso_da_area": return faixaDeUsoDaArea(dados.landUse);
    case "lotacao_ua_ha": return faixaDeLotacaoUaHa({ uaTotal: dados.uaTotal, usableAreaHa: dados.usableAreaHa, areaHa: dados.areaHa });
    case "situacao_pasto":
      return faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: dados.inicioDaAbertaMaisAntiga, ultimaSaida: dados.ultimaSaida, hoje: dados.hoje });
    case "categoria": return faixaDeCategoria(dados.categorias);
    default: throw new RangeError(`modo de coloração desconhecido: ${String(modo)}`);
  }
}

/** Faixa com rótulo do domínio de `labels.ts` (dono único do texto). */
function faixa(
  dominio: "faixa_de_lotacao_ua_ha" | "situacao_do_pasto" | "faixa_de_categoria",
  chave: string,
  numero: DecimalString | number | null,
  unidade: UnidadeDaFaixa | null
): FaixaDoMapa {
  return { chave, rotulo: enumLabel(dominio, chave), numero, unidade };
}
