/**
 * MAPA-MANEJO-04 (F2) — A PALETA DO MAPA OPERACIONAL: o ÚNICO lugar onde a tela decide alguma coisa.
 *
 * A API (`GET /api/mapa/operacional?coloracao=`) já entrega a FAIXA de cada área — `{ chave, rotulo, numero, unidade }`,
 * resolvida pelo domínio (`cores-do-mapa.ts`). A cor NÃO mora no domínio, de propósito: aqui a chave da faixa vira hex,
 * e nada mais. Nenhuma conta, nenhum corte, nenhum limite: a faixa chega pronta e a tela só a pinta.
 *
 * Os hex são os valores da casa: os tokens de `globals.css` (acento verde, azul, vermelho e os cinzas de texto) e a
 * paleta fechada do cadastro de área (`CORES_DA_AREA`, @agro/domain). As chaves são as do domínio, lidas das listas
 * do dono (`FAIXAS_DE_LOTACAO_UA_HA`, `SITUACOES_DO_PASTO`, `TIPOS_DE_USO_DA_AREA`, `FAIXA_SEM_REBANHO`) — o teste
 * prova que toda chave tem cor e que faixas vizinhas não se confundem.
 *
 * Cor nunca carrega significado sozinha: toda faixa aparece também como TEXTO (legenda e rótulo da área).
 */
import {
  FAIXA_SEM_REBANHO,
  type FaixaDeLotacaoUaHa,
  type ModoDeColoracao,
  type SituacaoDoPasto
} from "@agro/domain";

/** Valores da casa usados pela paleta (tokens de `globals.css` e `CORES_DA_AREA`). */
const CASA = {
  acento: "#40de63",
  azul: "#2899f5",
  vermelho: "#dc2626",
  cinzaTexto: "#9ca3af",
  cinzaIcone: "#5b6b80",
  cinzaClaro: "#e5e7eb",
  verdeClaro: "#92ca25",
  verde: "#16a34a",
  verdeEscuro: "#0f766e",
  turquesa: "#14b8a6",
  amarelo: "#efcb19",
  laranja: "#f5a01b",
  marrom: "#92400e",
  roxo: "#966fe1",
  rosa: "#db2777",
  azulCeleste: "#61aad9",
  azulForte: "#2563eb",
  azulEscuro: "#0d67ad",
  cinzaAzulado: "#94a3b8",
  preto: "#1e293b"
} as const;

/** Cor da área sem faixa reconhecida (chave fora do catálogo, ausência de dado): neutra, nunca a de uma vizinha. */
export const COR_SEM_FAIXA = CASA.cinzaTexto;

/** Lotação em UA/ha, da sublotação (azul) ao ideal (acento verde) à superlotação (vermelho). */
export const PALETA_LOTACAO_UA_HA = {
  sublotacao: CASA.azul,
  moderada: CASA.turquesa,
  ideal: CASA.acento,
  alta: CASA.laranja,
  superlotacao: CASA.vermelho,
  sem_area_util: CASA.cinzaTexto
} as const satisfies Record<FaixaDeLotacaoUaHa, string>;

/** Situação do pasto: ocupação normal → atenção → crítica; descanso em azul; nunca ocupado em cinza. */
export const PALETA_SITUACAO_DO_PASTO = {
  normal: CASA.acento,
  atencao: CASA.amarelo,
  critico: CASA.vermelho,
  em_descanso: CASA.azul,
  sem_registro: CASA.cinzaTexto
} as const satisfies Record<SituacaoDoPasto, string>;

/**
 * Uso da área: uma cor por valor de `TIPOS_DE_USO_DA_AREA` (as chaves do catálogo do domínio). Cores vizinhas na ordem
 * do catálogo são distintas; o teste confere cada chave do catálogo contra este mapa.
 */
export const PALETA_USO_DA_AREA: Readonly<Record<string, string>> = {
  pastagem: CASA.verdeClaro,
  lavoura: CASA.amarelo,
  ilp: CASA.laranja,
  ilpf: CASA.marrom,
  silvipastoril: CASA.turquesa,
  floresta: CASA.verde,
  confinamento: CASA.roxo,
  reserva_legal: CASA.verdeEscuro,
  app: CASA.azulCeleste,
  uso_restrito: CASA.rosa,
  vegetacao_nativa: CASA.acento,
  benfeitoria: CASA.preto,
  curral: CASA.cinzaIcone,
  estrada: CASA.cinzaAzulado,
  aguada: CASA.azulForte,
  degradada: CASA.vermelho,
  nao_produtiva: CASA.cinzaClaro
};

/**
 * Categoria animal predominante: as chaves são DINÂMICAS (a categoria normalizada que a API mandou). A cor sai da
 * POSIÇÃO da chave entre as presentes, ordenadas por código — a mesma resposta pinta sempre igual. Passando do fim da
 * lista, ela recomeça (o texto da legenda e do painel continua dizendo qual é qual).
 */
export const CORES_DE_CATEGORIA: readonly string[] = [
  CASA.azul,
  CASA.laranja,
  CASA.roxo,
  CASA.turquesa,
  CASA.rosa,
  CASA.amarelo,
  CASA.marrom,
  CASA.acento,
  CASA.azulEscuro,
  CASA.vermelho
];

/** A área sem cabeça no modo `categoria` (`FAIXA_SEM_REBANHO`): neutra. */
export const COR_SEM_REBANHO = CASA.cinzaTexto;

/** Ordem por código (determinística, sem depender do idioma do navegador). */
const porCodigo = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * As chaves de categoria presentes, sem repetição e sem `sem_rebanho`, em ordem de código: a ordem que fixa a cor de
 * cada uma.
 */
export function categoriasOrdenadas(chaves: readonly string[]): string[] {
  return [...new Set(chaves)].filter((c) => c !== FAIXA_SEM_REBANHO).sort(porCodigo);
}

/**
 * A cor de uma chave de faixa no modo pedido. `chavesPresentes` só importa em `categoria` (a posição da chave entre
 * as presentes escolhe a cor); sem ela, a chave conta como a única. Chave fora do catálogo do modo → `COR_SEM_FAIXA`.
 * `padrao` não tem faixa (a área usa a cor do cadastro): também `COR_SEM_FAIXA`, e quem pinta não deve pedir.
 */
export function corDaFaixa(modo: ModoDeColoracao, chave: string, chavesPresentes?: readonly string[]): string {
  switch (modo) {
    case "lotacao_ua_ha":
      return (PALETA_LOTACAO_UA_HA as Readonly<Record<string, string>>)[chave] ?? COR_SEM_FAIXA;
    case "situacao_pasto":
      return (PALETA_SITUACAO_DO_PASTO as Readonly<Record<string, string>>)[chave] ?? COR_SEM_FAIXA;
    case "uso_da_area":
      return PALETA_USO_DA_AREA[chave] ?? COR_SEM_FAIXA;
    case "categoria": {
      if (chave === FAIXA_SEM_REBANHO) return COR_SEM_REBANHO;
      const ordem = categoriasOrdenadas([...(chavesPresentes ?? []), chave]);
      const i = ordem.indexOf(chave);
      return CORES_DE_CATEGORIA[i % CORES_DE_CATEGORIA.length] ?? COR_SEM_FAIXA;
    }
    default:
      return COR_SEM_FAIXA;
  }
}
